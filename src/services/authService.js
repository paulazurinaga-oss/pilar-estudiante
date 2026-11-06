const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const licensePublicKey = require('./licensePublicKey');

const STORAGE_ROOT = process.env.PILAR_DATA_PATH || path.join(__dirname, '..', '..', 'storage');
const USERS_FILE = path.join(STORAGE_ROOT, 'auth', 'users.json');
const REDEEMED_LICENSES_FILE = path.join(STORAGE_ROOT, 'licenses', 'redeemed.json');
const REDEEMED_INVITES_FILE = path.join(STORAGE_ROOT, 'licenses', 'invites.json');
const SESSIONS_FILE = path.join(STORAGE_ROOT, 'auth', 'sessions.json');
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function readJsonFile(filePath, fallback, errorMessage) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(errorMessage);
  }
}

function writeJsonFile(filePath, value, errorMessage) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, filePath);
}

function readSessions() {
  const sessions = readJsonFile(SESSIONS_FILE, [], 'No se pudo leer la sesión de la cuenta.');
  return Array.isArray(sessions) ? sessions : [];
}

function configuredInviteCodes() {
  return String(process.env.PILAR_REGISTRATION_CODES || '').split(',')
    .map((code) => String(code || '').trim())
    .filter(Boolean);
}

function redeemInviteCode(code, userId) {
  const configured = configuredInviteCodes();
  if (!configured.length) return false;
  const candidateHash = crypto.createHash('sha256').update(code).digest('hex');
  const match = configured.some((value) => crypto.createHash('sha256').update(value).digest('hex') === candidateHash);
  if (!match) throw new Error('El código de invitación no es válido.');
  const redeemed = readJsonFile(REDEEMED_INVITES_FILE, [], 'No se pudieron verificar las invitaciones.');
  if (!Array.isArray(redeemed)) throw new Error('No se pudieron verificar las invitaciones.');
  if (redeemed.some((entry) => entry.hash === candidateHash)) throw new Error('Este código de invitación ya fue utilizado.');
  redeemed.push({ hash: candidateHash, userId, redeemedAt: new Date().toISOString() });
  writeJsonFile(REDEEMED_INVITES_FILE, redeemed, 'No se pudo registrar el uso de la invitación.');
  return true;
}

function readUsers() {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(users) ? users : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('No se pudo leer la base local de cuentas.');
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  const temporaryFile = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, USERS_FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    trialExpiresAt: user.trialExpiresAt,
    plan: user.plan,
  };
}

function createSession(user) {
  const now = Date.now();
  const sessions = readSessions().filter((session) => session.expiresAt > now && session.userId !== user.id);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_DURATION_MS;
  sessions.push({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: user.id, expiresAt });
  writeJsonFile(SESSIONS_FILE, sessions, 'No se pudo iniciar una sesión segura.');
  return { token, expiresAt, user: publicUser(user) };
}

function register({ name, email, password, registrationCode, legalConsent }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const safeName = String(name || '').trim();
  const safePassword = String(password || '');
  const inviteCode = String(registrationCode || '').trim();
  const hasInviteCodes = configuredInviteCodes().length > 0;

  if (process.env.NODE_ENV === 'production' && !hasInviteCodes) {
    throw new Error('El registro no está habilitado todavía. El administrador debe configurar códigos individuales de invitación.');
  }
  if (hasInviteCodes && !inviteCode) throw new Error('El código de invitación es obligatorio.');
  if (safeName.length < 2 || safeName.length > 100) throw new Error('El nombre debe tener entre 2 y 100 caracteres.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('Escribe un correo electrónico válido.');
  }
  if (safePassword.length < 12 || safePassword.length > 256) {
    throw new Error('La contraseña debe tener entre 12 y 256 caracteres.');
  }
  if (legalConsent !== true) throw new Error('Debes aceptar las condiciones de uso y el aviso de privacidad.');

  const users = readUsers();
  if (users.some((user) => user.email === normalizedEmail)) throw new Error('Ya existe una cuenta con ese correo.');

  const credentials = hashPassword(safePassword);
  const user = {
    id: crypto.randomUUID(),
    name: safeName,
    email: normalizedEmail,
    passwordSalt: credentials.salt,
    passwordHash: credentials.hash,
    createdAt: new Date().toISOString(),
    trialExpiresAt: new Date(Date.now() + TRIAL_DURATION_MS).toISOString(),
    plan: 'trial',
    legalAcceptedAt: new Date().toISOString(),
    legalVersion: process.env.PILAR_LEGAL_VERSION || 'draft-2026-10-06',
  };
  if (hasInviteCodes) redeemInviteCode(inviteCode, user.id);
  users.push(user);
  writeUsers(users);
  return createSession(user);
}

function login({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const safePassword = String(password || '');
  if (safePassword.length > 256) throw new Error('Correo o contraseña incorrectos.');
  const user = readUsers().find((account) => account.email === normalizedEmail);
  const suppliedHash = crypto.scryptSync(safePassword, user?.passwordSalt || 'pilar-invalid-user-salt', 64);
  const storedHash = Buffer.from(user?.passwordHash || '00'.repeat(64), 'hex');
  const matches = suppliedHash.length === storedHash.length && crypto.timingSafeEqual(suppliedHash, storedHash);

  if (!user || !matches) throw new Error('Correo o contraseña incorrectos.');
  return createSession(user);
}

function getSession(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessions = readSessions();
  const session = sessions.find((item) => item.tokenHash === tokenHash);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    writeJsonFile(SESSIONS_FILE, sessions.filter((item) => item.tokenHash !== tokenHash), 'No se pudo limpiar la sesión vencida.');
    return null;
  }
  const user = readUsers().find((account) => account.id === session.userId);
  if (!user) {
    writeJsonFile(SESSIONS_FILE, sessions.filter((item) => item.tokenHash !== tokenHash), 'No se pudo limpiar la sesión inválida.');
    return null;
  }
  const trialExpired = user.plan === 'trial' && Date.now() >= Date.parse(user.trialExpiresAt);
  const licenseRevoked = user.plan === 'revoked';
  const licenseExpired = user.plan === 'paid' && user.licenseExpiresAt && Date.now() >= Date.parse(user.licenseExpiresAt);
  return { ...publicUser(user), licenseExpiresAt: user.licenseExpiresAt || null, trialExpired: Boolean(trialExpired || licenseExpired || licenseRevoked) };
}

function redeemLicense(userId, code) {
  const normalizedCode = String(code || '').trim();
  if (normalizedCode.length < 20 || normalizedCode.length > 4096) throw new Error('El código de licencia no es válido.');
  const signedLicense = verifySignedLicense(normalizedCode, userId);
  if (signedLicense) return signedLicense;

  const candidateHash = crypto.createHash('sha256').update(normalizedCode).digest();
  const validCodes = String(process.env.PILAR_LICENSE_CODES || '').split(',').map((value) => value.trim()).filter(Boolean);
  const matchingCode = validCodes.find((value) => crypto.timingSafeEqual(
    crypto.createHash('sha256').update(value).digest(), candidateHash,
  ));
  if (!matchingCode) throw new Error('El código de licencia no es válido.');

  let redemptions = [];
  try {
    redemptions = JSON.parse(fs.readFileSync(REDEEMED_LICENSES_FILE, 'utf8'));
    if (!Array.isArray(redemptions)) redemptions = [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('No se pudo verificar el código de licencia.');
  }
  const codeHash = candidateHash.toString('hex');
  const previousRedemption = redemptions.find((entry) => entry.hash === codeHash);
  if (previousRedemption && previousRedemption.userId !== userId) {
    throw new Error('Este código ya fue utilizado.');
  }

  const users = readUsers();
  const user = users.find((account) => account.id === userId);
  if (!user) throw new Error('No se encontró la cuenta para activar.');
  if (!previousRedemption) {
    redemptions.push({ hash: codeHash, userId, redeemedAt: new Date().toISOString() });
    fs.mkdirSync(path.dirname(REDEEMED_LICENSES_FILE), { recursive: true });
    const temporaryFile = `${REDEEMED_LICENSES_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(redemptions, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, REDEEMED_LICENSES_FILE);
  }

  user.plan = 'paid';
  user.licenseExpiresAt = null;
  writeUsers(users);
  return { ...publicUser(user), trialExpired: false, licenseExpiresAt: null };
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

  const users = readUsers();
  const user = users.find((account) => account.id === userId);
  if (!user || String(payload.email || '').trim().toLowerCase() !== user.email) {
    throw new Error('Esta licencia fue emitida para otro correo.');
  }

  const redeemed = readJsonFile(REDEEMED_LICENSES_FILE, [], 'No se pudo verificar la licencia.');
  if (!Array.isArray(redeemed)) throw new Error('No se pudo verificar la licencia.');
  const existing = redeemed.find((item) => item.licenseId === payload.licenseId);
  if (existing && existing.userId !== userId) throw new Error('Esta licencia ya fue utilizada por otra cuenta.');
  if (!existing) {
    redeemed.push({ licenseId: payload.licenseId, userId, redeemedAt: new Date().toISOString() });
    writeJsonFile(REDEEMED_LICENSES_FILE, redeemed, 'No se pudo registrar el uso de la licencia.');
  }

  user.plan = 'paid';
  user.licenseExpiresAt = null;
  user.paymentEntitlement = { provider: 'signed-license', licenseId: payload.licenseId, activatedAt: new Date().toISOString() };
  writeUsers(users);
  return { ...publicUser(user), trialExpired: false, licenseExpiresAt: null };
}

function grantPaidLicense(userId, paymentDetails) {
  const users = readUsers();
  const user = users.find((account) => account.id === userId);
  if (!user) throw new Error('No se encontró la cuenta para activar.');
  const paymentId = String(paymentDetails?.paymentId || '');
  if (!paymentId || paymentId.length > 64) throw new Error('Referencia de pago no válida.');
  if (user.paymentEntitlement?.paymentId === paymentId && user.plan === 'paid') return publicUser(user);
  user.plan = 'paid';
  user.licenseExpiresAt = null;
  user.paymentEntitlement = {
    provider: String(paymentDetails.paymentProvider || 'manual'),
    paymentId,
    orderId: String(paymentDetails.orderId || '').slice(0, 64),
    activatedAt: new Date().toISOString(),
  };
  writeUsers(users);
  return publicUser(user);
}

function revokePaidLicense(userId, paymentId, reason) {
  const users = readUsers();
  const user = users.find((account) => account.id === userId);
  if (!user || user.paymentEntitlement?.provider !== 'mercadopago'
    || user.paymentEntitlement.paymentId !== String(paymentId)) return false;
  user.plan = 'revoked';
  user.licenseExpiresAt = null;
  user.paymentEntitlement.revokedAt = new Date().toISOString();
  user.paymentEntitlement.revocationReason = String(reason || 'payment_reversed').slice(0, 40);
  writeUsers(users);
  return true;
}

function destroySession(token) {
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  writeJsonFile(SESSIONS_FILE, readSessions().filter((session) => session.tokenHash !== tokenHash), 'No se pudo cerrar la sesión.');
}

function deleteAccount(userId, password) {
  const users = readUsers();
  const user = users.find((account) => account.id === userId);
  if (!user) throw new Error('No se encontró la cuenta.');
  const safePassword = String(password || '');
  if (safePassword.length > 256) throw new Error('La contraseña no coincide.');
  const suppliedHash = crypto.scryptSync(safePassword, user.passwordSalt, 64);
  const storedHash = Buffer.from(user.passwordHash, 'hex');
  if (suppliedHash.length !== storedHash.length || !crypto.timingSafeEqual(suppliedHash, storedHash)) {
    throw new Error('La contraseña no coincide.');
  }

  writeUsers(users.filter((account) => account.id !== userId));
  writeJsonFile(SESSIONS_FILE, readSessions().filter((session) => session.userId !== userId), 'No se pudieron invalidar las sesiones de la cuenta.');
  fs.rmSync(path.join(STORAGE_ROOT, 'users', userId), { recursive: true, force: true });
}

module.exports = { register, login, getSession, redeemLicense, grantPaidLicense, revokePaidLicense, destroySession, deleteAccount, SESSION_DURATION_MS };
