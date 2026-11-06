const fs = require('fs');
const path = require('path');
const { apiConfig } = require('./appConfig');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveUserDir(userId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) throw new Error('Cuenta no válida.');
  return path.join(apiConfig.storage.baseDir, 'users', userId);
}

function resolveFolder(userId, folder) {
  if (!['pdfs', 'uploads'].includes(folder)) throw new Error('Carpeta de almacenamiento no válida.');
  return path.join(resolveUserDir(userId), folder);
}

function metadataPath(userId, folder) {
  const targetDir = resolveFolder(userId, folder);
  return path.join(targetDir, '.pilar-metadata.json');
}

function readMetadata(userId, folder) {
  try {
    return JSON.parse(fs.readFileSync(metadataPath(userId, folder), 'utf8'));
  } catch {
    return {};
  }
}

function writeMetadata(userId, folder, metadata) {
  fs.writeFileSync(metadataPath(userId, folder), JSON.stringify(metadata, null, 2), 'utf8');
}

function saveBinaryFile({ userId, fileName, buffer, mimeType = 'application/octet-stream', folder = 'uploads' }) {
  const targetDir = resolveFolder(userId, folder);
  ensureDir(targetDir);

  const safeName = path.basename(fileName).replace(/[\\/:*?"<>|]/g, '_');
  const fullPath = path.join(targetDir, safeName);
  fs.writeFileSync(fullPath, buffer);

  const metadata = readMetadata(userId, folder);
  metadata[safeName] = { mimeType, originalName: fileName };
  writeMetadata(userId, folder, metadata);

  return {
    fileName: safeName,
    fullPath,
    relativePath: `/storage/${userId}/${folder}/${encodeURIComponent(safeName)}`,
    folder,
  };
}

function listFiles({ userId, folder = 'uploads' }) {
  const targetDir = resolveFolder(userId, folder);
  ensureDir(targetDir);
  const metadata = readMetadata(userId, folder);

  return fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== '.pilar-metadata.json')
    .map((entry) => {
      const fullPath = path.join(targetDir, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        fileName: entry.name,
        originalName: metadata[entry.name]?.originalName || entry.name,
        mimeType: metadata[entry.name]?.mimeType || 'application/octet-stream',
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        relativePath: `/storage/${userId}/${folder}/${encodeURIComponent(entry.name)}`,
        folder,
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function deleteFile({ userId, folder = 'uploads', fileName }) {
  const targetDir = resolveFolder(userId, folder);
  const safeName = path.basename(fileName);
  const fullPath = path.join(targetDir, safeName);

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  fs.unlinkSync(fullPath);
  const metadata = readMetadata(userId, folder);
  delete metadata[safeName];
  writeMetadata(userId, folder, metadata);
  return true;
}

function saveTextFile({ userId, fileName, content, folder = 'uploads' }) {
  return saveBinaryFile({
    userId,
    fileName,
    buffer: Buffer.from(content || '', 'utf8'),
    mimeType: 'text/plain',
    folder,
  });
}

module.exports = {
  ensureDir,
  saveBinaryFile,
  saveTextFile,
  listFiles,
  deleteFile,
};
