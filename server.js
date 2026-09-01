const http = require('http');
const fs = require('fs');
const path = require('path');
const { apiConfig } = require('./src/services/appConfig');
const { generateAssistantReply, textToSpeech } = require('./src/services/aiService');
const { saveBinaryFile, saveTextFile, listFiles, deleteFile } = require('./src/services/storageService');
const { createJob, getJob } = require('./src/services/transcriptionQueue');

const hostname = apiConfig.host;
const port = apiConfig.port;
const rootDir = __dirname;
const requestBuckets = new Map();

console.log(`[PILAR] Configuración cargada. provider=gemini configured=${Boolean(apiConfig.gemini.apiKey)} envPath=${process.env.AURAPILAR_ENV_PATH || 'auto'}`);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function ensureRootStorage() {
  fs.mkdirSync(apiConfig.storage.baseDir, { recursive: true });
  fs.mkdirSync(apiConfig.storage.uploadsDir, { recursive: true });
  fs.mkdirSync(apiConfig.storage.pdfDir, { recursive: true });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function getClientAddress(req) {
  return req.socket.remoteAddress || 'local';
}

function allowRequest(req, key, limit, windowMs) {
  const bucketKey = `${getClientAddress(req)}:${key}`;
  const now = Date.now();
  const bucket = requestBuckets.get(bucketKey) || { startedAt: now, count: 0 };

  if (now - bucket.startedAt >= windowMs) {
    bucket.startedAt = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  requestBuckets.set(bucketKey, bucket);
  return bucket.count <= limit;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartForm(data, boundary) {
  const boundaryMarker = `--${boundary}`;
  const files = [];
  const fields = {};

  const chunks = data.toString('binary').split(boundaryMarker);

  for (const chunk of chunks) {
    if (!chunk || chunk.trim() === '--' || chunk.trim() === '--\r\n') {
      continue;
    }

    const sections = chunk.split('\r\n\r\n');
    if (sections.length < 2) continue;

    const headerBlock = sections[0];
    const content = sections.slice(1).join('\r\n\r\n');
    const headerMatch = headerBlock.match(/name="([^"]+)"(?:; filename="([^"]*)")?/i);

    if (!headerMatch) continue;

    const fieldName = headerMatch[1];
    const fileName = headerMatch[2]
      ? Buffer.from(headerMatch[2], 'binary').toString('utf8')
      : undefined;
    const rawData = Buffer.from(content.replace(/\r\n$/, ''), 'binary');

    if (fileName) {
      const contentTypeMatch = headerBlock.match(/Content-Type:\s*([^\r\n]+)/i);
      files.push({
        fieldName,
        fileName,
        mimeType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        buffer: rawData,
      });
    } else {
      fields[fieldName] = rawData.toString('utf8');
    }
  }

  return { files, fields };
}

async function handleRoutes(req, res) {
  const url = new URL(req.url, `http://${hostname}:${port}`);
  if (process.env.AURAPILAR_DEBUG === '1') {
    console.log(`[PILAR] ${req.method} ${url.pathname}`);
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      app: apiConfig.appName,
      environment: apiConfig.environment,
      provider: 'gemini',
      providerConfigured: Boolean(apiConfig.gemini.apiKey),
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    if (!allowRequest(req, 'ai-chat', 30, 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas solicitudes de IA. Espera un minuto e inténtalo nuevamente.' });
      return;
    }

    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString() || '{}');
      const result = await generateAssistantReply(payload.prompt || '', payload.context || '');
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo procesar la solicitud de IA.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/transcribe') {
    if (!allowRequest(req, 'transcribe', 5, 10 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas transcripciones. Espera unos minutos e inténtalo nuevamente.' });
      return;
    }

    try {
      const body = await readRequestBody(req);
      const contentType = req.headers['content-type'] || '';

      if (!contentType.includes('multipart/form-data')) {
        throw new Error('Se requiere multipart/form-data para subir el audio.');
      }

      const boundaryMatch = contentType.match(/boundary=(.+)$/i);
      const boundary = boundaryMatch ? boundaryMatch[1] : '';
      const parsed = parseMultipartForm(body, boundary);
      const file = parsed.files[0];

      if (!file) {
        sendJson(res, 400, { error: 'No se recibió ningún archivo de audio.' });
        return;
      }

      const saved = saveBinaryFile({
        fileName: `${Date.now()}-${file.fileName || 'audio'}`,
        buffer: file.buffer,
        mimeType: file.mimeType,
        folder: 'uploads',
      });

      const job = createJob({
        filePath: saved.fullPath,
        fileName: file.fileName,
        mimeType: file.mimeType,
      });

      sendJson(res, 202, {
        jobId: job.id,
        savedFile: saved,
        status: job.status,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo transcribir el archivo.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/transcribe/jobs/')) {
    const jobId = decodeURIComponent(url.pathname.slice('/api/transcribe/jobs/'.length));
    const job = getJob(jobId);

    if (!job) {
      sendJson(res, 404, { error: 'Trabajo de transcripción no encontrado.' });
      return;
    }

    sendJson(res, 200, job);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tts') {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString() || '{}');
      const result = await textToSpeech({ text: payload.text || 'Texto sin contenido', voice: payload.voice || 'alloy' });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo generar audio.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/storage/text') {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString() || '{}');
      const fileName = payload.fileName || `PILAR-${Date.now()}.txt`;
      const content = String(payload.content || '');

      if (!content.trim()) {
        sendJson(res, 400, { error: 'No hay contenido para guardar.' });
        return;
      }

      const saved = saveTextFile({ fileName, content, folder: 'uploads' });
      sendJson(res, 200, { message: `Contenido guardado: ${saved.fileName}`, savedFile: saved });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo guardar el contenido.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/storage/files') {
    const folder = url.searchParams.get('folder') === 'pdfs' ? 'pdfs' : 'uploads';
    sendJson(res, 200, { files: listFiles(folder) });
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/storage/files/')) {
    const [, , , , folder, ...fileParts] = url.pathname.split('/');
    const safeFolder = folder === 'pdfs' ? 'pdfs' : 'uploads';
    const fileName = decodeURIComponent(fileParts.join('/'));

    if (!fileName || fileName !== path.basename(fileName)) {
      sendJson(res, 400, { error: 'Nombre de archivo no válido.' });
      return;
    }

    if (!deleteFile({ folder: safeFolder, fileName })) {
      sendJson(res, 404, { error: 'Archivo no encontrado.' });
      return;
    }

    sendJson(res, 200, { message: `Archivo eliminado: ${fileName}` });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    try {
      const body = await readRequestBody(req);
      const contentType = req.headers['content-type'] || '';

      if (!contentType.includes('multipart/form-data')) {
        sendJson(res, 400, { error: 'Se requiere multipart/form-data para subir archivos.' });
        return;
      }

      const boundaryMatch = contentType.match(/boundary=(.+)$/i);
      const parsed = parseMultipartForm(body, boundaryMatch ? boundaryMatch[1] : '');
      const file = parsed.files[0];

      if (!file) {
        sendJson(res, 400, { error: 'No se recibió ningún archivo.' });
        return;
      }

      const saved = saveBinaryFile({
        fileName: file.fileName || 'archivo',
        buffer: file.buffer,
        mimeType: file.mimeType,
        folder: 'uploads',
      });
      sendJson(res, 200, { savedFile: saved, mimeType: file.mimeType });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo subir el archivo.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload/pdf') {
    try {
      const body = await readRequestBody(req);
      const contentType = req.headers['content-type'] || '';

      if (!contentType.includes('multipart/form-data')) {
        throw new Error('Se requiere multipart/form-data para archivos PDF.');
      }

      const boundaryMatch = contentType.match(/boundary=(.+)$/i);
      const boundary = boundaryMatch ? boundaryMatch[1] : '';
      const parsed = parseMultipartForm(body, boundary);
      const file = parsed.files[0];

      if (!file) {
        sendJson(res, 400, { error: 'No se recibió un PDF.' });
        return;
      }

      const saved = saveBinaryFile({ fileName: file.fileName || 'document.pdf', buffer: file.buffer, mimeType: file.mimeType, folder: 'pdfs' });
      sendJson(res, 200, { message: `PDF guardado en la carpeta ${apiConfig.storage.pdfDir}.`, savedFile: saved });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo guardar el PDF.' });
    }
    return;
  }

  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;

  if (requestPath.startsWith('/storage/')) {
    const storagePath = path.normalize(path.join(apiConfig.storage.baseDir, decodeURIComponent(requestPath.slice('/storage/'.length))));
    if (!storagePath.startsWith(path.resolve(apiConfig.storage.baseDir) + path.sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Ruta no válida');
      return;
    }

    fs.readFile(storagePath, (error, content) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(error.code === 'ENOENT' ? 'Archivo no encontrado' : 'Error del servidor');
        return;
      }

      const ext = path.extname(storagePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    });
    return;
  }

  const filePath = path.join(rootDir, decodeURIComponent(requestPath));

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Archivo no encontrado');
        return;
      }

      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error del servidor');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

ensureRootStorage();

const server = http.createServer((req, res) => {
  handleRoutes(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message || 'Error del servidor.' });
  });
});

server.listen(port, hostname, () => {
  console.log(`PILAR del estudiante está corriendo en http://${hostname}:${port}`);
  console.log(`API health: http://${hostname}:${port}/api/health`);
});
