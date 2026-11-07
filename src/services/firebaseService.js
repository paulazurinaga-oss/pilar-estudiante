const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getFirestore } = require('firebase-admin/firestore');
const licensePublicKey = require('./licensePublicKey');
const localTranscriptionQueue = require('./transcriptionQueue');

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const RTDB_CHUNK_BYTES = 5 * 1024 * 1024;
const ACTIVE_JOB_STATUSES = new Set(['queued', 'preparing', 'processing', 'merging']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'paused_quota']);
const MAX_ACTIVE_JOBS = 20;
const activeJobs = new Map();
let workerStarted = false;

function isConfigured() {
  try {
    firebaseConfiguration();
    return true;
  } catch {
    return false;
  }
}

function firebaseConfiguration() {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
    const json = raw.length >= 2 && (
      (raw.startsWith("'") && raw.endsWith("'"))
      || (raw.startsWith('"') && raw.endsWith('"'))
    ) ? raw.slice(1, -1) : raw;
    try {
      serviceAccount = JSON.parse(json);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON debe contener una credencial JSON válida.');
    }
    if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON debe contener un objeto de credenciales.');
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || serviceAccount?.projectId;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || serviceAccount?.client_email || serviceAccount?.clientEmail;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY || serviceAccount?.private_key || serviceAccount?.privateKey;
  if (process.env.FIREBASE_PROJECT_ID && serviceAccount?.project_id
    && process.env.FIREBASE_PROJECT_ID !== serviceAccount.project_id) {
    throw new Error('FIREBASE_PROJECT_ID no coincide con el proyecto de FIREBASE_SERVICE_ACCOUNT_JSON.');
  }

  const missing = [];
  if (!projectId) missing.push(serviceAccount ? 'project_id en FIREBASE_SERVICE_ACCOUNT_JSON' : 'FIREBASE_PROJECT_ID');
  if (!clientEmail) missing.push(serviceAccount ? 'client_email en FIREBASE_SERVICE_ACCOUNT_JSON' : 'FIREBASE_CLIENT_EMAIL');
  if (!privateKey) missing.push(serviceAccount ? 'private_key en FIREBASE_SERVICE_ACCOUNT_JSON' : 'FIREBASE_PRIVATE_KEY');
  if (!process.env.FIREBASE_DATABASE_URL) missing.push('FIREBASE_DATABASE_URL');
  if (!process.env.FIREBASE_WEB_API_KEY) missing.push('FIREBASE_WEB_API_KEY');
  if (missing.length) throw new Error(`Faltan variables obligatorias de Firebase: ${missing.join(', ')}.`);

  return {
    serviceAccount: {
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    },
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  };
}

function assertConfigured() {
  firebaseConfiguration();
}

function firebase() {
  const configuration = firebaseConfiguration();
  const app = getApps().find((entry) => entry.name === 'pilar')
    || initializeApp({
      credential: cert(configuration.serviceAccount),
      databaseURL: configuration.databaseURL,
    }, 'pilar');
  return {
    auth: getAuth(app),
    database: getDatabase(app),
    firestore: getFirestore(app),
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  const licenseExpired = user.plan === 'paid' && user.licenseExpiresAt
    && Date.now() >= Date.parse(user.licenseExpiresAt);
  const trialExpired = user.plan === 'trial' && Date.now() >= Date.parse(user.trialExpiresAt);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    trialExpiresAt: user.trialExpiresAt,
    plan: user.plan,
    licenseExpiresAt: user.licenseExpiresAt || null,
    trialExpired: Boolean(trialExpired || licenseExpired || user.plan === 'revoked'),
  };
}

function validateRegistration({ name, email, password, legalConsent }) {
  const safeName = String(name || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const safePassword = String(password || '');
  if (safeName.length < 2 || safeName.length > 100) throw new Error('El nombre debe tener entre 2 y 100 caracteres.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('Escribe un correo electrónico válido.');
  }
  if (safePassword.length < 12 || safePassword.length > 256) {
    throw new Error('La contraseña debe tener entre 12 y 256 caracteres.');
  }
  if (legalConsent !== true) throw new Error('Debes aceptar las condiciones de uso y el aviso de privacidad.');
  return { safeName, normalizedEmail, safePassword };
}

function authErrorMessage(error) {
  const code = error?.error?.message || error?.message || '';
  if (/EMAIL_EXISTS|email-already-exists/i.test(code)) return 'Ya existe una cuenta con ese correo.';
  if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD|USER_DISABLED/i.test(code)) {
    return 'Correo o contraseña incorrectos.';
  }
  if (/WEAK_PASSWORD/i.test(code)) return 'La contraseña debe tener al menos 12 caracteres.';
  if (/TOO_MANY_ATTEMPTS/i.test(code)) return 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
  if (/INVALID_EMAIL/i.test(code)) return 'Escribe un correo electrónico válido.';
  return 'Firebase Authentication no pudo completar la solicitud.';
}

async function identityToolkit(method, payload) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(process.env.FIREBASE_WEB_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(authErrorMessage(result.error));
    error.status = response.status;
    error.firebaseCode = result.error?.message;
    throw error;
  }
  return result;
}

async function createSession(idToken, userId) {
  const { auth, firestore } = firebase();
  const tokenClaims = await auth.verifyIdToken(idToken);
  if (tokenClaims.uid !== userId) throw new Error('Firebase devolvió una cuenta no válida.');
  const token = await auth.createSessionCookie(idToken, { expiresIn: SESSION_DURATION_MS });
  const userSnapshot = await firestore.collection('users').doc(userId).get();
  if (!userSnapshot.exists) throw new Error('No se encontró el perfil de la cuenta.');
  return {
    token,
    expiresAt: Date.now() + SESSION_DURATION_MS,
    user: publicUser({ id: userId, ...userSnapshot.data() }),
  };
}

function configuredCodes(environmentVariable) {
  return String(process.env[environmentVariable] || '').split(',').map((code) => code.trim()).filter(Boolean);
}

function codeDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function reserveInvite(transaction, inviteCode, userId) {
  const inviteCodes = configuredCodes('PILAR_REGISTRATION_CODES');
  const openRegistration = /^true$/i.test(String(process.env.PILAR_OPEN_REGISTRATION || '').trim());
  if (!openRegistration && process.env.NODE_ENV === 'production' && inviteCodes.length === 0) {
    throw new Error('El registro no está habilitado todavía. El administrador debe configurar códigos individuales de invitación.');
  }
  if (openRegistration || !inviteCodes.length) return;
  if (!inviteCode) throw new Error('El código de invitación es obligatorio.');
  const inviteHash = codeDigest(String(inviteCode).trim());
  if (!inviteCodes.some((code) => crypto.timingSafeEqual(Buffer.from(codeDigest(code)), Buffer.from(inviteHash)))) {
    throw new Error('El código de invitación no es válido.');
  }
  const { firestore } = firebase();
  const inviteRef = firestore.collection('redeemedInvites').doc(inviteHash);
  const existing = await transaction.get(inviteRef);
  if (existing.exists) throw new Error('Este código ya fue utilizado.');
  transaction.create(inviteRef, { userId, redeemedAt: new Date().toISOString() });
}

async function register(payload) {
  const { safeName, normalizedEmail, safePassword } = validateRegistration(payload);
  const { auth, firestore } = firebase();
  const legalAcceptedAt = new Date().toISOString();
  let createdUserId;
  let idToken;
  try {
    const response = await identityToolkit('signUp', {
      email: normalizedEmail,
      password: safePassword,
      displayName: safeName,
      returnSecureToken: true,
    });
    createdUserId = response.localId;
    await auth.getUser(createdUserId);
    idToken = response.idToken;
    await firestore.runTransaction(async (transaction) => {
      await reserveInvite(transaction, payload.registrationCode, createdUserId);
      transaction.create(firestore.collection('users').doc(createdUserId), {
        id: createdUserId,
        name: safeName,
        email: normalizedEmail,
        createdAt: legalAcceptedAt,
        trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        plan: 'trial',
        legalAcceptedAt,
        legalVersion: process.env.PILAR_LEGAL_VERSION || 'draft-2026-10-06',
      });
    });
    return createSession(idToken, createdUserId);
  } catch (error) {
    if (createdUserId) await auth.deleteUser(createdUserId).catch((cleanupError) => {
      console.error(`[PILAR][firebase] No se pudo revertir la creación de cuenta: ${cleanupError.message}`);
    });
    throw error;
  }
}

function legacyEmailId(email) {
  return codeDigest(normalizeEmail(email));
}

function verifyLegacyPassword(password, legacy) {
  if (!legacy?.passwordSalt || !/^[a-f0-9]{128}$/i.test(String(legacy.passwordHash || ''))) return false;
  const supplied = crypto.scryptSync(String(password || ''), legacy.passwordSalt, 64);
  const stored = Buffer.from(legacy.passwordHash, 'hex');
  return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
}

async function migrateLegacyLogin(email, password) {
  const { auth, firestore } = firebase();
  const legacyRef = firestore.collection('legacyAuth').doc(legacyEmailId(email));
  const legacySnapshot = await legacyRef.get();
  if (!legacySnapshot.exists) return null;
  const legacy = legacySnapshot.data();
  if (!verifyLegacyPassword(password, legacy)) throw new Error('Correo o contraseña incorrectos.');

  let userRecord;
  try {
    userRecord = await auth.createUser({
      uid: legacy.id,
      email: normalizeEmail(email),
      displayName: legacy.name,
      password,
    });
  } catch (error) {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error;
    userRecord = await auth.getUserByEmail(normalizeEmail(email));
  }
  if (userRecord.uid !== legacy.id) {
    throw new Error('La cuenta ya existe en Firebase con otro identificador. Contacta al soporte para completar la migración.');
  }
  await legacyRef.delete();
  const authenticated = await identityToolkit('signInWithPassword', {
    email: normalizeEmail(email),
    password,
    returnSecureToken: true,
  });
  return authenticated;
}

async function login({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (String(password || '').length > 256) throw new Error('Correo o contraseña incorrectos.');
  let authenticated;
  try {
    authenticated = await identityToolkit('signInWithPassword', {
      email: normalizedEmail,
      password: String(password || ''),
      returnSecureToken: true,
    });
  } catch (error) {
    if (!['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(error.firebaseCode)) throw error;
    authenticated = await migrateLegacyLogin(normalizedEmail, password);
    if (!authenticated) throw error;
  }
  return createSession(authenticated.idToken, authenticated.localId);
}

async function getSession(token) {
  if (!token) return null;
  try {
    const { auth, firestore } = firebase();
    const claims = await auth.verifySessionCookie(token, true);
    const userSnapshot = await firestore.collection('users').doc(claims.uid).get();
    if (!userSnapshot.exists) return null;
    return publicUser({ id: claims.uid, ...userSnapshot.data() });
  } catch (error) {
    if (['auth/argument-error', 'auth/id-token-expired', 'auth/session-cookie-expired', 'auth/session-cookie-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(error.code)) {
      return null;
    }
    throw error;
  }
}

async function destroySession(token) {
  if (!token) return;
  const { auth } = firebase();
  try {
    const claims = await auth.verifySessionCookie(token);
    await auth.revokeRefreshTokens(claims.uid);
  } catch (error) {
    if (!String(error.code || '').startsWith('auth/')) throw error;
  }
}

async function deleteAccount(userId, password) {
  const { auth, database, firestore } = firebase();
  const userRecord = await auth.getUser(userId);
  const authenticated = await identityToolkit('signInWithPassword', {
    email: userRecord.email,
    password: String(password || ''),
    returnSecureToken: true,
  });
  if (authenticated.localId !== userId) throw new Error('La contraseña no coincide.');
  await database.ref(`users/${userId}`).remove();
  const userRef = firestore.collection('users').doc(userId);
  await firestore.recursiveDelete(userRef);
  const orders = await firestore.collection('orders').where('userId', '==', userId).get();
  const redemptions = await firestore.collection('redeemedLicenses').where('userId', '==', userId).get();
  const invitations = await firestore.collection('redeemedInvites').where('userId', '==', userId).get();
  const batch = firestore.batch();
  orders.docs.forEach((document) => batch.delete(document.ref));
  const legacyRef = firestore.collection('legacyAuth').doc(legacyEmailId(userRecord.email));
  batch.delete(legacyRef);
  const deletedAt = new Date().toISOString();
  for (const document of redemptions.docs) batch.update(document.ref, { userId: null, accountDeletedAt: deletedAt });
  for (const document of invitations.docs) batch.update(document.ref, { userId: null, accountDeletedAt: deletedAt });
  if (orders.size || redemptions.size || invitations.size) await batch.commit();
  await auth.deleteUser(userId);
}

async function redeemLicense(userId, code) {
  const normalizedCode = String(code || '').trim();
  if (normalizedCode.length < 20 || normalizedCode.length > 4096) throw new Error('El código de licencia no es válido.');
  const signed = verifySignedLicense(normalizedCode, userId);
  const { auth, firestore } = firebase();
  const userRef = firestore.collection('users').doc(userId);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) throw new Error('No se encontró la cuenta para activar.');
  const user = userSnapshot.data();
  if (signed) {
    if (String(signed.email || '').trim().toLowerCase() !== user.email) {
      throw new Error('Esta licencia fue emitida para otro correo.');
    }
    const redemptionRef = firestore.collection('redeemedLicenses').doc(signed.licenseId);
    await firestore.runTransaction(async (transaction) => {
      const redemption = await transaction.get(redemptionRef);
      if (redemption.exists && redemption.data().userId !== userId) throw new Error('Esta licencia ya fue utilizada por otra cuenta.');
      if (!redemption.exists) transaction.create(redemptionRef, { userId, redeemedAt: new Date().toISOString() });
      transaction.update(userRef, {
        plan: 'paid',
        licenseExpiresAt: null,
        paymentEntitlement: { provider: 'signed-license', licenseId: signed.licenseId, activatedAt: new Date().toISOString() },
      });
    });
  } else {
    const validCodes = configuredCodes('PILAR_LICENSE_CODES');
    const candidateHash = codeDigest(normalizedCode);
    const matchingCode = validCodes.find((value) => crypto.timingSafeEqual(
      Buffer.from(codeDigest(value)), Buffer.from(candidateHash),
    ));
    if (!matchingCode) throw new Error('El código de licencia no es válido.');
    const redemptionRef = firestore.collection('redeemedLicenses').doc(candidateHash);
    await firestore.runTransaction(async (transaction) => {
      const redemption = await transaction.get(redemptionRef);
      if (redemption.exists && redemption.data().userId !== userId) throw new Error('Este código ya fue utilizado.');
      if (!redemption.exists) transaction.create(redemptionRef, { userId, redeemedAt: new Date().toISOString() });
      transaction.update(userRef, { plan: 'paid', licenseExpiresAt: null });
    });
  }
  return { ...publicUser({ ...user, plan: 'paid', licenseExpiresAt: null }), trialExpired: false };
}

function verifySignedLicense(code, userId) {
  const [payloadPart, signaturePart, extraPart] = code.split('.');
  if (!payloadPart || !signaturePart || extraPart !== undefined) return null;
  let payload;
  let signature;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    signature = Buffer.from(signaturePart, 'base64url');
  } catch {
    throw new Error('El código de licencia no es válido.');
  }
  if (!crypto.verify(null, Buffer.from(payloadPart), licensePublicKey, signature)) {
    throw new Error('El código de licencia no tiene una firma válida.');
  }
  const expectedProduct = process.env.NODE_ENV === 'desktop' ? 'pilar-desktop' : 'pilar-web';
  if (payload.version !== 1 || payload.product !== expectedProduct
    || !/^[0-9a-f-]{36}$/i.test(String(payload.licenseId || ''))
    || !Number.isFinite(Date.parse(payload.issuedAt))) {
    throw new Error('Esta licencia no corresponde a este producto.');
  }
  return payload;
}

async function grantPaidLicense(userId, paymentDetails) {
  const { firestore } = firebase();
  const userRef = firestore.collection('users').doc(userId);
  const paymentId = String(paymentDetails?.paymentId || '');
  if (!paymentId || paymentId.length > 64) throw new Error('Referencia de pago no válida.');
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) throw new Error('No se encontró la cuenta para activar.');
    const user = snapshot.data();
    if (user.paymentEntitlement?.paymentId === paymentId && user.plan === 'paid') return;
    transaction.update(userRef, {
      plan: 'paid',
      licenseExpiresAt: null,
      paymentEntitlement: {
        provider: String(paymentDetails.paymentProvider || 'manual'),
        paymentId,
        orderId: String(paymentDetails.orderId || '').slice(0, 64),
        activatedAt: new Date().toISOString(),
      },
    });
  });
}

async function revokePaidLicense(userId, paymentId, reason) {
  const { firestore } = firebase();
  const userRef = firestore.collection('users').doc(userId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) return false;
    const user = snapshot.data();
    if (user.paymentEntitlement?.provider !== 'mercadopago'
      || user.paymentEntitlement.paymentId !== String(paymentId)) return false;
    transaction.update(userRef, {
      plan: 'revoked',
      licenseExpiresAt: null,
      'paymentEntitlement.revokedAt': new Date().toISOString(),
      'paymentEntitlement.revocationReason': String(reason || 'payment_reversed').slice(0, 40),
    });
    return true;
  });
}

function validateFolderInput(input) {
  if (!Array.isArray(input) || input.length > 500) throw new Error('La lista de carpetas no es válida.');
  const seenNames = new Set();
  return input.map((folder) => {
    const name = String(folder?.name || '').trim();
    if (!name || name.length > 100) throw new Error('Cada carpeta debe tener un nombre de 1 a 100 caracteres.');
    const key = name.toLocaleLowerCase('es');
    if (seenNames.has(key)) throw new Error('No puede haber dos carpetas con el mismo nombre.');
    seenNames.add(key);
    const items = Array.isArray(folder.items) ? folder.items.slice(0, 5000).map((item) => String(item).slice(0, 255)) : [];
    const id = String(folder.id || crypto.randomUUID());
    if (!/^[\w-]{1,128}$/.test(id)) throw new Error('El identificador de una carpeta no es válido.');
    return { id, name, items };
  });
}

async function listFolders(userId) {
  const { firestore } = firebase();
  const snapshot = await firestore.collection('users').doc(userId).collection('folders').get();
  return snapshot.docs.map((document) => document.data()).sort((left, right) => left.name.localeCompare(right.name));
}

async function saveFolders(userId, input) {
  const folders = validateFolderInput(input);
  const { firestore } = firebase();
  const collection = firestore.collection('users').doc(userId).collection('folders');
  const existing = await collection.get();
  const retained = new Set(folders.map((folder) => folder.id));
  let batch = firestore.batch();
  let operations = 0;
  for (const document of existing.docs) {
    if (!retained.has(document.id)) {
      batch.delete(document.ref);
      operations += 1;
    }
  }
  if (operations) await batch.commit();
  batch = firestore.batch();
  for (const folder of folders) {
    batch.set(collection.doc(folder.id), folder);
    operations += 1;
    if (operations % 450 === 0) {
      await batch.commit();
      batch = firestore.batch();
    }
  }
  if (operations % 450) await batch.commit();
  return folders;
}

function sanitizeFileName(fileName) {
  const safeName = path.basename(String(fileName || 'archivo')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('Nombre de archivo no válido.');
  return safeName;
}

async function writeFileChunks(fileRef, { buffer, filePath }) {
  const { database } = firebase();
  const root = database.ref(`users/${fileRef.userId}/files/${fileRef.folder}/${fileRef.id}/chunks`);
  const totalSize = buffer ? buffer.length : fs.statSync(filePath).size;
  if (totalSize > MAX_FILE_BYTES) throw new Error('El archivo supera el límite de 100 MB.');
  const readChunk = async (position) => {
    if (buffer) return buffer.subarray(position, Math.min(position + RTDB_CHUNK_BYTES, totalSize));
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const chunk = Buffer.alloc(Math.min(RTDB_CHUNK_BYTES, totalSize - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      return chunk.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  };
  try {
    for (let position = 0, index = 0; position < totalSize; index += 1) {
      const chunk = await readChunk(position);
      await root.child(String(index)).set(chunk.toString('base64'));
      position += chunk.length;
    }
  } catch (error) {
    await root.parent.remove().catch((cleanupError) => {
      console.error(`[PILAR][firebase-storage] No se pudieron limpiar fragmentos incompletos: ${cleanupError.message}`);
    });
    throw error;
  }
  return totalSize;
}

async function saveBinaryFile({ userId, fileName, buffer, filePath, mimeType = 'application/octet-stream', folder = 'uploads' }) {
  if (!['uploads', 'pdfs'].includes(folder)) throw new Error('Carpeta de almacenamiento no válida.');
  const safeName = sanitizeFileName(fileName);
  const id = crypto.randomUUID();
  const fileRef = { userId, folder, id };
  const size = await writeFileChunks(fileRef, { buffer, filePath });
  const { firestore } = firebase();
  const metadata = {
    id,
    fileName: id,
    originalName: safeName,
    mimeType,
    size,
    folder,
    modifiedAt: new Date().toISOString(),
  };
  metadata.chunkCount = Math.ceil(size / RTDB_CHUNK_BYTES);
  try {
    await firestore.collection('users').doc(userId).collection('files').doc(id).set(metadata);
  } catch (error) {
    await firebase().database.ref(`users/${userId}/files/${folder}/${id}`).remove().catch((cleanupError) => {
      console.error(`[PILAR][firebase-storage] No se pudieron limpiar los datos incompletos: ${cleanupError.message}`);
    });
    throw error;
  }
  return {
    fileName: id,
    originalName: safeName,
    size,
    mimeType,
    relativePath: `/storage/${userId}/${folder}/${id}/${encodeURIComponent(safeName)}`,
    folder,
  };
}

async function saveTextFile({ userId, fileName, content, folder = 'uploads' }) {
  return saveBinaryFile({
    userId,
    fileName,
    buffer: Buffer.from(content || '', 'utf8'),
    mimeType: 'text/plain',
    folder,
  });
}

async function listFiles({ userId, folder = 'uploads' }) {
  if (!['uploads', 'pdfs'].includes(folder)) throw new Error('Carpeta de almacenamiento no válida.');
  const { firestore } = firebase();
  const snapshot = await firestore.collection('users').doc(userId).collection('files')
    .where('folder', '==', folder).get();
  return snapshot.docs.map((document) => document.data())
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .map((file) => ({
      fileName: file.fileName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      modifiedAt: file.modifiedAt,
      relativePath: `/storage/${userId}/${folder}/${file.fileName}/${encodeURIComponent(file.originalName)}`,
      folder,
    }));
}

async function deleteFile({ userId, folder = 'uploads', fileName }) {
  const { database, firestore } = firebase();
  const fileRef = firestore.collection('users').doc(userId).collection('files').doc(String(fileName || ''));
  const snapshot = await fileRef.get();
  if (!snapshot.exists || snapshot.data().folder !== folder) return false;
  await database.ref(`users/${userId}/files/${folder}/${snapshot.id}`).remove();
  await fileRef.delete();
  return true;
}

async function downloadFileToPath({ userId, folder, id, destination }) {
  const { database, firestore } = firebase();
  const metadata = await firestore.collection('users').doc(userId).collection('files').doc(id).get();
  if (!metadata.exists || metadata.data().folder !== folder) return null;
  const file = metadata.data();
  const output = fs.createWriteStream(destination, { mode: 0o600 });
  try {
    for (let index = 0; index < (file.chunkCount ?? Math.ceil(file.size / RTDB_CHUNK_BYTES)); index += 1) {
      const snapshot = await database.ref(`users/${userId}/files/${folder}/${id}/chunks/${index}`).get();
      if (!snapshot.exists()) throw new Error('El archivo no contiene todos sus fragmentos.');
      const chunk = Buffer.from(snapshot.val(), 'base64');
      await new Promise((resolve, reject) => {
        output.write(chunk, (error) => error ? reject(error) : resolve());
      });
    }
    const finished = new Promise((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
    });
    output.end();
    await finished;
  } catch (error) {
    output.destroy();
    await fs.promises.rm(destination, { force: true }).catch((cleanupError) => {
      console.error(`[PILAR][firebase-storage] No se pudo limpiar descarga temporal: ${cleanupError.message}`);
    });
    throw error;
  }
  return file;
}

async function streamFile({ userId, folder, id, res }) {
  const { database, firestore } = firebase();
  const metadata = await firestore.collection('users').doc(userId).collection('files').doc(id).get();
  if (!metadata.exists || metadata.data().folder !== folder) return false;
  const file = metadata.data();
  res.writeHead(200, {
    'Content-Type': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.pdf'].includes(path.extname(file.originalName).toLowerCase())
      ? file.mimeType || 'application/octet-stream'
      : 'application/octet-stream',
    'Content-Disposition': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.pdf'].includes(path.extname(file.originalName).toLowerCase())
      ? 'inline'
      : 'attachment',
    'Content-Length': file.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  const chunkCount = file.chunkCount ?? Math.ceil(file.size / RTDB_CHUNK_BYTES);
  for (let index = 0; index < chunkCount; index += 1) {
    if (res.destroyed || res.writableEnded) return true;
    const snapshot = await database.ref(`users/${userId}/files/${folder}/${id}/chunks/${index}`).get();
    if (!snapshot.exists()) throw new Error('El archivo no contiene todos sus fragmentos.');
    if (!res.write(Buffer.from(snapshot.val(), 'base64'))) {
      await new Promise((resolve, reject) => {
        res.once('drain', resolve);
        res.once('close', () => reject(new Error('El cliente cerró la descarga.')));
        res.once('error', reject);
      });
    }
  }
  res.end();
  return true;
}

async function findUser(userId) {
  const { firestore } = firebase();
  const snapshot = await firestore.collection('users').doc(userId).get();
  return snapshot.exists ? { id: userId, ...snapshot.data() } : null;
}

function getPaymentConfig() {
  return require('./paymentService').getPaymentConfig();
}

async function getOrder(orderId) {
  if (!orderId) return null;
  const { firestore } = firebase();
  const snapshot = await firestore.collection('orders').doc(orderId).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function writeOrder(order) {
  const { firestore } = firebase();
  await firestore.collection('orders').doc(order.id).set(order);
}

async function createCheckout({ user, publicBaseUrl }) {
  const config = getPaymentConfig();
  if (!config.enabled) throw new Error('La compra web todavía no está habilitada por el administrador.');
  if (user.plan === 'paid' && !user.trialExpired) throw new Error('Esta cuenta ya tiene una licencia web activa.');
  const { firestore } = firebase();
  const existing = await firestore.collection('orders').where('userId', '==', user.id).get();
  const reusable = existing.docs.map((entry) => entry.data())
    .filter((order) => order.status === 'pending' && order.checkoutUrl)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (reusable) return { orderId: reusable.id, checkoutUrl: reusable.checkoutUrl, status: 'pending', reused: true };

  const baseUrl = new URL(publicBaseUrl);
  if (process.env.NODE_ENV === 'production'
    && (baseUrl.protocol !== 'https:' || baseUrl.origin !== new URL(process.env.PILAR_PUBLIC_URL).origin)) {
    throw new Error('La URL pública del checkout no coincide con la URL HTTPS configurada por el administrador.');
  }
  const order = {
    id: crypto.randomUUID(),
    userId: user.id,
    email: user.email,
    amount: config.price,
    currency: 'ARS',
    status: 'creating',
    createdAt: new Date().toISOString(),
    paymentId: null,
    preferenceId: null,
  };
  await writeOrder(order);
  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': order.id,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        items: [{
          id: 'pilar-web-lifetime',
          title: 'PILAR del estudiante - Licencia web',
          description: 'Licencia de uso de PILAR del estudiante para una cuenta.',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: config.price,
        }],
        payer: { email: user.email },
        external_reference: order.id,
        notification_url: `${baseUrl.origin}/api/payments/webhook`,
        back_urls: {
          success: `${baseUrl.origin}/?payment=${order.id}`,
          pending: `${baseUrl.origin}/?payment=${order.id}`,
          failure: `${baseUrl.origin}/?payment=${order.id}`,
        },
        auto_return: 'approved',
        statement_descriptor: 'PILAR ESTUDIANTE',
      }),
    });
    const result = await response.json().catch(() => ({}));
    const checkoutUrl = config.accessToken.startsWith('TEST-')
      ? result.sandbox_init_point || result.init_point
      : result.init_point;
    if (!response.ok || !result.id || !checkoutUrl) {
      throw new Error(`Mercado Pago no creó el checkout (HTTP ${response.status}).`);
    }
    const destination = new URL(checkoutUrl);
    if (destination.protocol !== 'https:' || !/\.mercadopago\.com(?:\.ar)?$/.test(destination.hostname)) {
      throw new Error('Mercado Pago devolvió un destino de checkout no permitido.');
    }
    order.preferenceId = String(result.id);
    order.checkoutUrl = destination.href;
    order.status = 'pending';
    await writeOrder(order);
    return { orderId: order.id, checkoutUrl: destination.href, status: 'pending' };
  } catch (error) {
    order.status = 'creation_failed';
    await writeOrder(order);
    throw error;
  }
}

function verifyWebhookSignature(options) {
  return require('./paymentService').verifyWebhookSignature(options);
}

async function applyApprovedPayment({ paymentId, payment }) {
  const { firestore } = firebase();
  const orderRef = firestore.collection('orders').doc(String(payment.external_reference || ''));
  return firestore.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return { applied: false, reason: 'unknown_order' };
    const order = orderSnapshot.data();
    const userRef = firestore.collection('users').doc(order.userId);
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) return { applied: false, reason: 'unknown_user' };
    if (['refunded', 'charged_back'].includes(payment.status)) {
      transaction.update(orderRef, {
        paymentId: String(paymentId),
        status: payment.status,
        reversedAt: new Date().toISOString(),
      });
      const entitlement = userSnapshot.data().paymentEntitlement;
      if (entitlement?.provider === 'mercadopago' && entitlement.paymentId === String(paymentId)) {
        transaction.update(userRef, {
          plan: 'revoked',
          licenseExpiresAt: null,
          'paymentEntitlement.revokedAt': new Date().toISOString(),
          'paymentEntitlement.revocationReason': payment.status,
        });
      }
      return { applied: true, reversed: true, orderId: order.id, status: payment.status };
    }
    if (String(order.paymentId || '') === String(paymentId) && order.status === 'approved') {
      return { applied: true, duplicate: true, orderId: order.id };
    }
    if (order.status === 'approved') return { applied: false, reason: 'already_paid' };
    const amountMatches = Number(payment.transaction_amount) === order.amount
      && payment.currency_id === order.currency
      && String(payment.external_reference) === order.id;
    if (payment.status !== 'approved' || !amountMatches) {
      transaction.update(orderRef, {
        status: payment.status === 'approved' ? 'review_required' : 'pending',
        paymentId: String(paymentId),
      });
      return { applied: false, reason: 'payment_mismatch' };
    }
    transaction.update(userRef, {
      plan: 'paid',
      licenseExpiresAt: null,
      paymentEntitlement: {
        provider: 'mercadopago',
        paymentId: String(paymentId),
        orderId: order.id,
        activatedAt: new Date().toISOString(),
      },
    });
    transaction.update(orderRef, {
      paymentId: String(paymentId),
      status: 'approved',
      approvedAt: new Date().toISOString(),
    });
    return { applied: true, orderId: order.id };
  });
}

async function processPaymentNotification(paymentId) {
  const config = getPaymentConfig();
  if (!config.enabled) throw new Error('Los pagos no están configurados.');
  if (!/^\d{1,32}$/.test(String(paymentId || ''))) throw new Error('Identificador de pago no válido.');
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payment = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`No se pudo consultar el pago (HTTP ${response.status}).`);
  return applyApprovedPayment({ paymentId, payment });
}

function jobCollection(userId, kind) {
  return firebase().firestore.collection('users').doc(userId).collection(`${kind}Jobs`);
}

function publicJob(job) {
  const { ownerId, sourceFileId, ...publicFields } = job;
  return publicFields;
}

async function createAiJob({ userId, type, prompt }) {
  if (!['infographic', 'image'].includes(type)) throw new Error('Tipo de tarea de IA no válido.');
  const id = crypto.randomUUID();
  const job = {
    id,
    type,
    status: 'queued',
    prompt,
    progress: 0,
    message: 'Tarea agregada a la cola.',
    createdAt: new Date().toISOString(),
  };
  const { firestore } = firebase();
  const collection = jobCollection(userId, 'ai');
  await firestore.runTransaction(async (transaction) => {
    const active = await transaction.get(collection.where('status', 'in', [...ACTIVE_JOB_STATUSES]));
    const globalActive = await transaction.get(
      firestore.collectionGroup('aiJobs').where('status', 'in', [...ACTIVE_JOB_STATUSES]),
    );
    if (active.size >= 2 || globalActive.size >= MAX_ACTIVE_JOBS) {
      throw new Error('La cola de IA está llena. Espera a que termine una tarea activa.');
    }
    transaction.create(collection.doc(id), job);
  });
  setImmediate(() => runAiJob(userId, job).catch((error) => {
    console.error(`[PILAR][firebase-ai] ${id}: ${error.message}`);
  }));
  return publicJob(job);
}

async function runAiJob(userId, initialJob) {
  if (activeJobs.has(initialJob.id)) return;
  activeJobs.set(initialJob.id, true);
  const collection = jobCollection(userId, 'ai');
  const document = collection.doc(initialJob.id);
  try {
    await document.update({ status: 'processing', progress: 10, message: 'Gemini está procesando la solicitud.' });
    const result = initialJob.type === 'infographic'
      ? await require('./aiService').generateInfographic(initialJob.prompt)
      : await require('./aiService').generateImage(initialJob.prompt);
    let response = result;
    if (initialJob.type === 'image' && result?.data) {
      const image = await saveBinaryFile({
        userId,
        fileName: `PILAR-imagen-${Date.now()}.${result.mimeType === 'image/jpeg' ? 'jpg' : result.mimeType === 'image/webp' ? 'webp' : 'png'}`,
        buffer: Buffer.from(result.data, 'base64'),
        mimeType: result.mimeType,
        folder: 'uploads',
      });
      response = { savedFile: image, mimeType: result.mimeType };
    }
    await document.update({
      status: 'completed',
      progress: 100,
      message: 'Completado.',
      result: response,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    await document.update({
      status: 'failed',
      progress: 100,
      error: error.message || 'No se pudo completar la tarea de IA.',
      quotaExceeded: Boolean(error.status === 429 || /429|quota/i.test(error.message || '')),
      message: 'La tarea de IA falló.',
      completedAt: new Date().toISOString(),
    });
  } finally {
    activeJobs.delete(initialJob.id);
  }
}

async function getAiJob(userId, id) {
  const snapshot = await jobCollection(userId, 'ai').doc(id).get();
  return snapshot.exists ? publicJob({ ...snapshot.data(), ownerId: userId }) : null;
}

async function countActiveJobs(userId, kind) {
  const snapshot = await jobCollection(userId, kind)
    .where('status', 'in', [...ACTIVE_JOB_STATUSES]).get();
  return snapshot.size;
}

async function enqueueTranscription({ userId, fileId, fileName, mimeType, chunkSeconds, savedFile }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    ownerId: userId,
    sourceFileId: fileId,
    fileName,
    mimeType,
    chunkSeconds,
    savedFile,
    status: 'queued',
    progress: 0,
    completedChunks: 0,
    totalChunks: 0,
    currentChunk: 0,
    text: '',
    error: null,
    pausedReason: null,
    message: 'Preparando audio para transcripción.',
    createdAt: new Date().toISOString(),
  };
  const { firestore } = firebase();
  const collection = jobCollection(userId, 'transcription');
  await firestore.runTransaction(async (transaction) => {
    const active = await transaction.get(collection.where('status', 'in', [...ACTIVE_JOB_STATUSES]));
    const globalActive = await transaction.get(
      firestore.collectionGroup('transcriptionJobs').where('status', 'in', [...ACTIVE_JOB_STATUSES]),
    );
    if (active.size >= 2 || globalActive.size >= MAX_ACTIVE_JOBS) {
      throw new Error('La cola de transcripción está llena. Espera a que termine un trabajo activo.');
    }
    transaction.create(collection.doc(id), job);
  });
  setImmediate(() => runTranscriptionJob(userId, job).catch((error) => {
    console.error(`[PILAR][firebase-transcribe] ${id}: ${error.message}`);
  }));
  return publicJob(job);
}

async function runTranscriptionJob(userId, job) {
  if (activeJobs.has(job.id)) return;
  activeJobs.set(job.id, true);
  const document = jobCollection(userId, 'transcription').doc(job.id);
  const sourcePath = path.join(os.tmpdir(), `pilar-${job.id}-source`);
  let localJob;
  let syncTimer;
  try {
    await document.update({ status: 'preparing', message: 'Recuperando audio almacenado de forma segura.' });
    const metadata = await downloadFileToPath({
      userId,
      folder: 'uploads',
      id: job.sourceFileId,
      destination: sourcePath,
    });
    if (!metadata) throw new Error('No se encontró el audio guardado para esta transcripción.');
    await document.update({ status: 'queued', message: 'Preparando audio para transcripción.' });
    localJob = localTranscriptionQueue.createJob({
      id: job.id,
      userId,
      filePath: sourcePath,
      fileName: job.fileName,
      mimeType: job.mimeType,
      chunkSeconds: job.chunkSeconds,
    });
    localJob.savedFile = job.savedFile;
    syncTimer = setInterval(async () => {
      try {
        await document.set({ ...publicJob(localJob), ownerId: userId, sourceFileId: job.sourceFileId }, { merge: true });
      } catch (error) {
        console.error(`[PILAR][firebase-transcribe] No se pudo guardar el progreso ${job.id}: ${error.message}`);
      }
    }, 30_000);
    syncTimer.unref();
    while (!TERMINAL_JOB_STATUSES.has(localJob.status)) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    await document.set({ ...publicJob(localJob), ownerId: userId, sourceFileId: job.sourceFileId }, { merge: true });
  } catch (error) {
    await document.set({
      ...job,
      status: 'failed',
      error: error.message || 'No se pudo completar la transcripción.',
      message: 'La transcripción falló.',
      completedAt: new Date().toISOString(),
    }, { merge: true });
  } finally {
    if (syncTimer) clearInterval(syncTimer);
    activeJobs.delete(job.id);
    await fs.promises.rm(sourcePath, { force: true }).catch((error) => {
      console.error(`[PILAR][firebase-transcribe] No se pudo limpiar el audio temporal ${job.id}: ${error.message}`);
    });
  }
}

async function getTranscriptionJob(userId, id) {
  const snapshot = await jobCollection(userId, 'transcription').doc(id).get();
  return snapshot.exists ? publicJob(snapshot.data()) : null;
}

async function cancelTranscriptionJob(userId, id) {
  const document = jobCollection(userId, 'transcription').doc(id);
  const snapshot = await document.get();
  if (!snapshot.exists) return null;
  const current = snapshot.data();
  if (TERMINAL_JOB_STATUSES.has(current.status)) return publicJob(current);
  const localJob = localTranscriptionQueue.getJob(id, userId);
  if (localJob) localTranscriptionQueue.cancelJob(id, userId);
  const cancelled = { ...current, status: 'cancelled', message: 'Transcripción cancelada.', error: 'Transcripción cancelada por el usuario.' };
  await document.set(cancelled, { merge: true });
  return publicJob(cancelled);
}

async function resumeOutstandingJobs() {
  if (workerStarted) return;
  workerStarted = true;
  const { firestore } = firebase();
  const users = await firestore.collection('users').get();
  for (const user of users.docs) {
    for (const kind of ['ai', 'transcription']) {
      const snapshot = await user.ref.collection(`${kind}Jobs`)
        .where('status', 'in', [...ACTIVE_JOB_STATUSES]).get();
      for (const document of snapshot.docs) {
        const job = document.data();
        if (kind === 'ai') {
          await document.ref.update({ status: 'queued', message: 'Tarea reanudada después de reiniciar el servicio.' });
          setImmediate(() => runAiJob(user.id, { ...job, status: 'queued' }).catch((error) => {
            console.error(`[PILAR][firebase-ai] ${job.id}: ${error.message}`);
          }));
        } else {
          await document.ref.update({ status: 'queued', message: 'Transcripción reanudada después de reiniciar el servicio.' });
          setImmediate(() => runTranscriptionJob(user.id, { ...job, status: 'queued' }).catch((error) => {
            console.error(`[PILAR][firebase-transcribe] ${job.id}: ${error.message}`);
          }));
        }
      }
    }
  }
}

module.exports = {
  SESSION_DURATION_MS,
  isConfigured,
  assertConfigured,
  register,
  login,
  getSession,
  destroySession,
  deleteAccount,
  redeemLicense,
  grantPaidLicense,
  revokePaidLicense,
  listFolders,
  saveFolders,
  saveBinaryFile,
  saveTextFile,
  listFiles,
  deleteFile,
  streamFile,
  downloadFileToPath,
  findUser,
  getPaymentConfig,
  getOrder,
  createCheckout,
  verifyWebhookSignature,
  processPaymentNotification,
  applyApprovedPayment,
  createAiJob,
  getAiJob,
  countActiveJobs,
  enqueueTranscription,
  getTranscriptionJob,
  cancelTranscriptionJob,
  resumeOutstandingJobs,
  MAX_FILE_BYTES,
};
