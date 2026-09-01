const fs = require('fs');
const path = require('path');
const { apiConfig } = require('./appConfig');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function metadataPath(folder) {
  const targetDir = folder === 'pdfs' ? apiConfig.storage.pdfDir : apiConfig.storage.uploadsDir;
  return path.join(targetDir, '.aurapilar-metadata.json');
}

function readMetadata(folder) {
  try {
    return JSON.parse(fs.readFileSync(metadataPath(folder), 'utf8'));
  } catch {
    return {};
  }
}

function writeMetadata(folder, metadata) {
  fs.writeFileSync(metadataPath(folder), JSON.stringify(metadata, null, 2), 'utf8');
}

function saveBinaryFile({ fileName, buffer, mimeType = 'application/octet-stream', folder = 'uploads' }) {
  const targetDir = folder === 'pdfs' ? apiConfig.storage.pdfDir : apiConfig.storage.uploadsDir;
  ensureDir(targetDir);

  const safeName = path.basename(fileName).replace(/[\\/:*?"<>|]/g, '_');
  const fullPath = path.join(targetDir, safeName);
  fs.writeFileSync(fullPath, buffer);

  const metadata = readMetadata(folder);
  metadata[safeName] = { mimeType, originalName: fileName };
  writeMetadata(folder, metadata);

  return {
    fileName: safeName,
    fullPath,
    relativePath: `/storage/${folder}/${safeName}`,
    folder,
  };
}

function listFiles(folder = 'uploads') {
  const targetDir = folder === 'pdfs' ? apiConfig.storage.pdfDir : apiConfig.storage.uploadsDir;
  ensureDir(targetDir);
  const metadata = readMetadata(folder);

  return fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== '.aurapilar-metadata.json')
    .map((entry) => {
      const fullPath = path.join(targetDir, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        fileName: entry.name,
        originalName: metadata[entry.name]?.originalName || entry.name,
        mimeType: metadata[entry.name]?.mimeType || 'application/octet-stream',
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        relativePath: `/storage/${folder}/${encodeURIComponent(entry.name)}`,
        folder,
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function deleteFile({ folder = 'uploads', fileName }) {
  const targetDir = folder === 'pdfs' ? apiConfig.storage.pdfDir : apiConfig.storage.uploadsDir;
  const safeName = path.basename(fileName);
  const fullPath = path.join(targetDir, safeName);

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  fs.unlinkSync(fullPath);
  const metadata = readMetadata(folder);
  delete metadata[safeName];
  writeMetadata(folder, metadata);
  return true;
}

function saveTextFile({ fileName, content, folder = 'uploads' }) {
  return saveBinaryFile({
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
