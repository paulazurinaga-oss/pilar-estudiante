const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { apiConfig } = require('./appConfig');

function profilePath(userId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) throw new Error('Cuenta no válida.');
  return path.join(apiConfig.storage.baseDir, 'users', userId, 'profile.json');
}

function readProfile(userId) {
  try {
    return JSON.parse(fs.readFileSync(profilePath(userId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { folders: [] };
    throw new Error('No se pudieron leer las preferencias de la cuenta.');
  }
}

function writeProfile(userId, profile) {
  const target = profilePath(userId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(profile, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function listFolders(userId) {
  const profile = readProfile(userId);
  return Array.isArray(profile.folders) ? profile.folders : [];
}

function saveFolders(userId, input) {
  if (!Array.isArray(input) || input.length > 500) throw new Error('La lista de carpetas no es válida.');
  const seenNames = new Set();
  const folders = input.map((folder) => {
    const name = String(folder?.name || '').trim();
    if (!name || name.length > 100) throw new Error('Cada carpeta debe tener un nombre de 1 a 100 caracteres.');
    const key = name.toLocaleLowerCase('es');
    if (seenNames.has(key)) throw new Error('No puede haber dos carpetas con el mismo nombre.');
    seenNames.add(key);
    const items = Array.isArray(folder.items) ? folder.items.slice(0, 5000).map((item) => String(item).slice(0, 255)) : [];
    return { id: String(folder.id || crypto.randomUUID()), name, items };
  });
  const profile = readProfile(userId);
  profile.folders = folders;
  writeProfile(userId, profile);
  return folders;
}

module.exports = { listFolders, saveFolders };
