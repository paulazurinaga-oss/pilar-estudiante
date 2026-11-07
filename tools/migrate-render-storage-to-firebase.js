require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const CHUNK_BYTES = 5 * 1024 * 1024;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`No se pudo leer ${filePath}: ${error.message}`);
  }
}

function requireEnvironment() {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) {
    const required = [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
      'FIREBASE_DATABASE_URL',
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) throw new Error(`Faltan variables Firebase: ${missing.join(', ')}.`);
  }
  if (!process.env.PILAR_LEGACY_STORAGE) {
    throw new Error('Define PILAR_LEGACY_STORAGE con la ruta al respaldo exportado de la carpeta storage.');
  }
  if (dryRun) return null;
  const { cert, initializeApp } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  }, `pilar-storage-migration-${process.pid}`);
  return { firestore: getFirestore(app), database: getDatabase(app) };
}

function deterministicFileId(userId, folder, fileName) {
  const hash = crypto.createHash('sha256').update(`${userId}/${folder}/${fileName}`).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

function safeFileName(fileName) {
  const baseName = path.basename(String(fileName || 'archivo').replace(/\\/g, '/'));
  const safeName = baseName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
  return safeName || 'archivo';
}

async function writeFile(database, userId, folder, id, filePath) {
  const size = fs.statSync(filePath).size;
  if (size > MAX_FILE_BYTES) throw new Error(`El archivo ${path.basename(filePath)} supera el límite de 100 MB.`);
  const root = database.ref(`users/${userId}/files/${folder}/${id}`);
  await root.remove();
  const handle = await fs.promises.open(filePath, 'r');
  try {
    for (let position = 0, index = 0; position < size; index += 1) {
      const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) throw new Error(`Lectura incompleta del archivo ${path.basename(filePath)}.`);
      await root.child(`chunks/${index}`).set(buffer.subarray(0, bytesRead).toString('base64'));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return size;
}

async function migrate() {
  const services = requireEnvironment();
  const storageDir = path.resolve(process.env.PILAR_LEGACY_STORAGE);
  const userRecords = readJson(path.join(storageDir, 'auth', 'users.json'), []);
  const orders = readJson(path.join(storageDir, 'payments', 'orders.json'), []);
  const redeemedLicenses = readJson(path.join(storageDir, 'licenses', 'redeemed.json'), []);
  const redeemedInvites = readJson(path.join(storageDir, 'licenses', 'invites.json'), []);
  if (!Array.isArray(userRecords) || !Array.isArray(orders)
    || !Array.isArray(redeemedLicenses) || !Array.isArray(redeemedInvites)) {
    throw new Error('El respaldo contiene un formato inesperado.');
  }

  const users = [];
  const files = [];
  for (const sourceUser of userRecords) {
    if (!/^[0-9a-f-]{36}$/i.test(String(sourceUser.id || ''))
      || !sourceUser.email || !sourceUser.passwordHash || !sourceUser.passwordSalt) {
      throw new Error('Se encontró una cuenta sin identificador o credenciales legadas válidas.');
    }
    const user = { ...sourceUser };
    delete user.passwordHash;
    delete user.passwordSalt;
    users.push({ sourceUser, user });
    const profilePath = path.join(storageDir, 'users', sourceUser.id, 'profile.json');
    const profile = readJson(profilePath, { folders: [] });
    if (profile.folders !== undefined && !Array.isArray(profile.folders)) {
      throw new Error(`El perfil de ${sourceUser.id} tiene carpetas con formato no válido.`);
    }
    const fileOwnerDir = path.join(storageDir, 'users', sourceUser.id);
    for (const folder of ['uploads', 'pdfs']) {
      const folderPath = path.join(fileOwnerDir, folder);
      if (!fs.existsSync(folderPath)) continue;
      const fileMetadata = readJson(path.join(folderPath, '.pilar-metadata.json'), {});
      for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name === '.pilar-metadata.json') continue;
        const filePath = path.join(folderPath, entry.name);
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_BYTES) throw new Error(`El archivo ${entry.name} supera el límite de 100 MB.`);
        files.push({
          userId: sourceUser.id,
          folder,
          id: deterministicFileId(sourceUser.id, folder, entry.name),
          filePath,
          fileName: entry.name,
          originalName: safeFileName(fileMetadata[entry.name]?.originalName || entry.name),
          mimeType: fileMetadata[entry.name]?.mimeType || 'application/octet-stream',
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          chunkCount: Math.ceil(stat.size / CHUNK_BYTES),
        });
      }
    }
  }
  if (process.argv.includes('--dry-run')) {
    console.log(`Respaldo válido: ${users.length} cuentas, ${files.length} archivos, ${orders.length} compras.`);
    return;
  }

  const { firestore, database } = services;
  for (const { sourceUser, user } of users) {
    const userRef = firestore.collection('users').doc(user.id);
    await userRef.set(user);
    const legacyId = crypto.createHash('sha256').update(String(sourceUser.email).trim().toLowerCase()).digest('hex');
    await firestore.collection('legacyAuth').doc(legacyId).set({
      id: user.id,
      email: String(sourceUser.email).trim().toLowerCase(),
      name: user.name,
      passwordSalt: sourceUser.passwordSalt,
      passwordHash: sourceUser.passwordHash,
      importedAt: new Date().toISOString(),
    });

    const profile = readJson(path.join(storageDir, 'users', sourceUser.id, 'profile.json'), { folders: [] });
    const folderCollection = userRef.collection('folders');
    const batch = firestore.batch();
    for (const folder of profile.folders || []) {
      const folderId = String(folder.id || '');
      if (!/^[\w-]{1,128}$/.test(folderId)) throw new Error(`Identificador de carpeta inválido en la cuenta ${user.id}.`);
      batch.set(folderCollection.doc(folderId), {
        id: folderId,
        name: String(folder.name || '').trim(),
        items: Array.isArray(folder.items) ? folder.items : [],
      });
    }
    if ((profile.folders || []).length) await batch.commit();
  }

  for (const file of files) {
    await writeFile(database, file.userId, file.folder, file.id, file.filePath);
    await firestore.collection('users').doc(file.userId).collection('files').doc(file.id).set({
      id: file.id,
      fileName: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      folder: file.folder,
      modifiedAt: file.modifiedAt,
      chunkCount: file.chunkCount,
    });
  }

  for (const order of orders) {
    if (!order.id || String(order.id).includes('/')) throw new Error('El respaldo contiene una compra con ID no válido.');
    await firestore.collection('orders').doc(String(order.id)).set(order);
  }
  for (const redemption of redeemedLicenses) {
    const id = String(redemption.licenseId || redemption.hash || '');
    if (!id || id.includes('/')) throw new Error('El respaldo contiene una licencia canjeada con ID no válido.');
    await firestore.collection('redeemedLicenses').doc(id).set(redemption);
  }
  for (const invitation of redeemedInvites) {
    const id = String(invitation.hash || '');
    if (!/^[a-f0-9]{64}$/i.test(id)) throw new Error('El respaldo contiene una invitación canjeada no válida.');
    await firestore.collection('redeemedInvites').doc(id).set({
      userId: invitation.userId,
      redeemedAt: invitation.redeemedAt,
    });
  }
  console.log(`Migración completada: ${users.length} cuentas, ${files.length} archivos, ${orders.length} compras.`);
  console.log('Las contraseñas legadas se verificarán una vez al iniciar sesión y sus hashes se eliminarán después.');
}

migrate().catch((error) => {
  console.error(`[PILAR][migración Firebase] ${error.message}`);
  process.exitCode = 1;
});
