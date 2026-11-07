const http = require('http');
const fs = require('fs');
const path = require('path');
const { apiConfig } = require('./src/services/appConfig');
const localAuth = require('./src/services/authService');
const localUserData = require('./src/services/userDataService');
const localPayments = require('./src/services/paymentService');
const localStorage = require('./src/services/storageService');
const localTranscription = require('./src/services/transcriptionQueue');
const localAiJobs = require('./src/services/aiJobQueue');
const { generateAssistantReplyStream } = require('./src/services/aiService');
const { useFirebasePersistence: selectFirebasePersistence } = require('./src/services/persistenceConfig');

const useFirebasePersistence = selectFirebasePersistence();
const firebaseService = useFirebasePersistence ? require('./src/services/firebaseService') : null;
if (useFirebasePersistence) firebaseService.assertConfigured();

const persistence = useFirebasePersistence ? firebaseService : {
  ...localAuth,
  ...localUserData,
  ...localPayments,
  ...localStorage,
  createAiJob: localAiJobs.createAiJob,
  getAiJob: localAiJobs.getAiJob,
  getTranscriptionJob: localTranscription.getJob,
  cancelTranscriptionJob: localTranscription.cancelJob,
};

const hostname = apiConfig.host;
const port = apiConfig.port;
const rootDir = __dirname;
const requestBuckets = new Map();
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = (useFirebasePersistence ? 50 : 100) * 1024 * 1024;
const PUBLIC_FILES = new Set([
  'index.html', 'script.js', 'sw.js', 'manifest.json', 'icon.svg', 'icon.ico', path.join('css', 'styles.css'),
  'PRIVACIDAD.md', 'CONDICIONES-DE-USO.md',
  'PRELANZAMIENTO-COMERCIAL.md',
]);

console.log(`[PILAR] Configuración cargada. provider=gemini configured=${Boolean(apiConfig.gemini.apiKey)} persistence=${useFirebasePersistence ? 'firebase' : 'local'} envPath=${process.env.PILAR_ENV_PATH || 'auto'}`);

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
  '.md': 'text/markdown; charset=utf-8',
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

function writeSse(res, event, payload) {
  if (res.destroyed || res.writableEnded) return Promise.reject(new Error('El cliente cerró la conexión.'));
  if (res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.removeListener('drain', onDrain);
      res.removeListener('close', onClose);
      res.removeListener('error', onError);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('El cliente cerró la conexión.')); };
    const onError = (error) => { cleanup(); reject(error); };
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
  });
}

function getClientAddress(req) {
  if (process.env.RENDER_SERVICE_ID && req.headers['x-forwarded-for']) {
    const forwardedClient = req.headers['x-forwarded-for'].split(',')[0].trim();
    if (forwardedClient) return forwardedClient;
  }
  return req.socket.remoteAddress || 'local';
}

function allowRequest(req, key, limit, windowMs) {
  const bucketKey = `${req.user?.id || getClientAddress(req)}:${key}`;
  const now = Date.now();
  const bucket = requestBuckets.get(bucketKey) || { startedAt: now, count: 0 };

  if (requestBuckets.size > 10000) {
    for (const [staleKey, staleBucket] of requestBuckets) {
      if (now - staleBucket.startedAt > windowMs * 2) requestBuckets.delete(staleKey);
    }
  }

  if (now - bucket.startedAt >= windowMs) {
    bucket.startedAt = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  requestBuckets.set(bucketKey, bucket);
  return bucket.count <= limit;
}

function readRequestBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;

    if (Number(req.headers['content-length']) > maxBytes) {
      reject(new Error('El archivo o solicitud supera el tamaño permitido.'));
      req.resume();
      return;
    }

    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > maxBytes) {
        exceeded = true;
        reject(new Error('El archivo o solicitud supera el tamaño permitido.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartForm(data, boundary) {
  if (!boundary) throw new Error('El encabezado multipart no incluye un límite válido.');
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const nextPartMarker = Buffer.from(`\r\n--${boundary}`);
  const headerSeparator = Buffer.from('\r\n\r\n');
  const files = [];
  const fields = {};
  let cursor = 0;
  while (true) {
    const markerIndex = data.indexOf(boundaryMarker, cursor);
    if (markerIndex < 0) break;
    let partStart = markerIndex + boundaryMarker.length;
    if (data.subarray(partStart, partStart + 2).toString() === '--') break;
    if (data.subarray(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
    const nextMarkerIndex = data.indexOf(nextPartMarker, partStart);
    if (nextMarkerIndex < 0) break;
    cursor = nextMarkerIndex + 2;
    const part = data.subarray(partStart, nextMarkerIndex);
    const separatorIndex = part.indexOf(headerSeparator);
    if (separatorIndex < 0) {
      continue;
    }

    const headerBlock = part.subarray(0, separatorIndex).toString('latin1');
    const headerMatch = headerBlock.match(/name="([^"]+)"(?:; filename="([^"]*)")?/i);

    if (!headerMatch) continue;

    const fieldName = headerMatch[1];
    const fileName = headerMatch[2]
      ? Buffer.from(headerMatch[2], 'binary').toString('utf8')
      : undefined;
    const rawData = part.subarray(separatorIndex + headerSeparator.length);

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
  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (mutatingMethods.has(req.method) && req.headers.origin) {
    const forwardedProtocol = req.headers['x-forwarded-proto']?.split(',')[0].trim();
    const expectedProtocol = forwardedProtocol || (req.socket.encrypted ? 'https' : 'http');
    const expectedOrigin = `${expectedProtocol}://${req.headers.host}`;
    if (req.headers.origin !== expectedOrigin) {
      sendJson(res, 403, { error: 'Origen de solicitud no permitido.' });
      return;
    }
  }
  if (process.env.PILAR_DEBUG === '1') {
    console.log(`[PILAR] ${req.method} ${url.pathname}`);
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      app: apiConfig.appName,
      environment: apiConfig.environment,
      provider: 'gemini',
      providerConfigured: Boolean(apiConfig.gemini.apiKey),
      persistence: useFirebasePersistence ? 'firebase' : 'local',
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/payments/webhook') {
    let notification = {};
    try {
      const rawBody = await readRequestBody(req, 64 * 1024);
      notification = rawBody.length ? JSON.parse(rawBody.toString()) : {};
    } catch {
      sendJson(res, 400, { error: 'Notificación de pago no válida.' });
      return;
    }
    const paymentId = url.searchParams.get('data.id')
      || url.searchParams.get('id')
      || notification?.data?.id;
    const config = persistence.getPaymentConfig();
    if (!config.enabled) {
      sendJson(res, 503, { error: 'Webhook de pagos no configurado.' });
      return;
    }
    if (!persistence.verifyWebhookSignature({
      signatureHeader: req.headers['x-signature'],
      requestId: req.headers['x-request-id'],
      paymentId,
      secret: config.webhookSecret,
    })) {
      sendJson(res, 401, { error: 'Firma de notificación no válida.' });
      return;
    }
    try {
      const result = await persistence.processPaymentNotification(paymentId);
      sendJson(res, 200, { received: true, applied: result.applied });
    } catch (error) {
      console.error(`[PILAR][payments] webhook ${String(paymentId).slice(0, 32)} failed: ${error.message}`);
      sendJson(res, 503, { error: 'No se pudo verificar el pago; Mercado Pago puede reintentar la notificación.' });
    }
    return;
  }

  if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
    const action = url.pathname.endsWith('/register') ? 'register' : 'login';
    const attemptLimit = action === 'register' ? 10 : 5;
    if (!allowRequest(req, `auth-${action}`, attemptLimit, 15 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.' });
      return;
    }

    try {
      const payload = JSON.parse((await readRequestBody(req)).toString() || '{}');
      const session = action === 'register' ? await persistence.register(payload) : await persistence.login(payload);
      const secure = req.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https' || req.socket.encrypted;
      const cookie = `pilar_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(persistence.SESSION_DURATION_MS / 1000)}${secure ? '; Secure' : ''}`;
      res.setHeader('Set-Cookie', cookie);
      sendJson(res, 200, { user: session.user, expiresAt: session.expiresAt });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'No se pudo iniciar la sesión.' });
    }
    return;
  }

  const sessionToken = (req.headers.cookie || '').split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('pilar_session='))
    ?.slice('pilar_session='.length);
  const sessionUser = await persistence.getSession(sessionToken);

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    await persistence.destroySession(sessionToken);
    res.setHeader('Set-Cookie', 'pilar_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/auth/account') {
    const activeUser = sessionUser;
    if (!activeUser) {
      sendJson(res, 401, { error: 'Inicia sesión para eliminar la cuenta.' });
      return;
    }
    try {
      if (!allowRequest(req, 'account-delete', 3, 60 * 60 * 1000)) {
        sendJson(res, 429, { error: 'Demasiados intentos. Inténtalo más tarde.' });
        return;
      }
      const payload = JSON.parse((await readRequestBody(req)).toString() || '{}');
      await persistence.deleteAccount(activeUser.id, payload.password);
      res.setHeader('Set-Cookie', 'pilar_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      sendJson(res, 200, { ok: true, message: 'La cuenta y sus archivos se eliminaron.' });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'No se pudo eliminar la cuenta.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = sessionUser;
    if (!user) {
      sendJson(res, 401, { error: 'Inicia sesión para continuar.' });
      return;
    }
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/activate') {
    const activeUser = sessionUser;
    if (!activeUser) {
      sendJson(res, 401, { error: 'Inicia sesión para activar una licencia.' });
      return;
    }
    if (!allowRequest(req, 'license-activate', 10, 60 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Se alcanzó el límite de intentos de activación. Inténtalo más tarde.' });
      return;
    }
    try {
      const payload = JSON.parse((await readRequestBody(req)).toString() || '{}');
      const user = await persistence.redeemLicense(activeUser.id, payload.code);
      sendJson(res, 200, { user, message: 'Licencia activada correctamente.' });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'No se pudo activar la licencia.' });
    }
    return;
  }

  if (url.pathname.startsWith('/api/') && !sessionUser) {
    sendJson(res, 401, { error: 'Inicia sesión para continuar.' });
    return;
  }

  req.user = sessionUser;

  if (req.method === 'GET' && url.pathname === '/api/payments/config') {
    const paymentConfig = persistence.getPaymentConfig();
    sendJson(res, 200, {
      enabled: paymentConfig.enabled && process.env.NODE_ENV !== 'desktop',
      desktop: process.env.NODE_ENV === 'desktop',
      amount: paymentConfig.enabled ? paymentConfig.price : null,
      currency: paymentConfig.enabled ? 'ARS' : null,
      description: 'Licencia web de pago único para una cuenta.',
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/payments/checkout') {
    if (process.env.NODE_ENV === 'desktop') {
      sendJson(res, 404, { error: 'La compra web se realiza desde el sitio de PILAR.' });
      return;
    }
    if (!allowRequest(req, 'payment-checkout', 3, 60 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Se alcanzó el límite de intentos de compra. Inténtalo más tarde.' });
      return;
    }
    try {
      const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host;
      const protocol = req.headers['x-forwarded-proto']?.split(',')[0].trim() || (req.socket.encrypted ? 'https' : 'http');
      const publicBaseUrl = process.env.PILAR_PUBLIC_URL || `${protocol}://${host}`;
      const checkout = await persistence.createCheckout({ user: req.user, publicBaseUrl });
      sendJson(res, 200, checkout);
    } catch (error) {
      sendJson(res, 503, { error: error.message || 'No se pudo iniciar la compra.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/payments/status') {
    const order = await persistence.getOrder(url.searchParams.get('orderId'));
    if (!order || order.userId !== req.user.id) {
      sendJson(res, 404, { error: 'Compra no encontrada.' });
      return;
    }
    sendJson(res, 200, { orderId: order.id, status: order.status, amount: order.amount, currency: order.currency });
    return;
  }

  if (req.user?.trialExpired && ['POST /api/ai/chat', 'POST /api/generate-infographic', 'POST /api/transcribe'].includes(`${req.method} ${url.pathname}`)) {
    sendJson(res, 402, { error: 'Tu período de prueba terminó. Contacta a PILAR para activar una licencia.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/folders') {
    sendJson(res, 200, { folders: await persistence.listFolders(req.user.id) });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/ai/jobs/')) {
    if (!allowRequest(req, 'ai-job-status', 60, 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas consultas de trabajos de IA. Espera un minuto.' });
      return;
    }
    const jobId = decodeURIComponent(url.pathname.slice('/api/ai/jobs/'.length));
    const job = await persistence.getAiJob(req.user.id, jobId);
    if (!job) {
      sendJson(res, 404, { error: 'Trabajo de IA no encontrado.' });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config/ai') {
    sendJson(res, 200, {
      canSetPersonalKey: process.env.PILAR_ALLOW_USER_API_KEY === '1',
      geminiConfigured: Boolean(apiConfig.gemini.apiKey),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/config/ai-key') {
    if (process.env.PILAR_ALLOW_USER_API_KEY !== '1') {
      sendJson(res, 404, { error: 'La clave personal solo se configura en PILAR de escritorio.' });
      return;
    }
    if (!allowRequest(req, 'personal-ai-key', 5, 60 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiados cambios de clave. Inténtalo más tarde.' });
      return;
    }
    try {
      const payload = JSON.parse((await readRequestBody(req)).toString() || '{}');
      const apiKey = String(payload.apiKey || '').trim();
      if (apiKey.length < 20 || apiKey.length > 256 || /[\r\n\0]/.test(apiKey)) {
        sendJson(res, 400, { error: 'La clave debe tener entre 20 y 256 caracteres válidos.' });
        return;
      }
      const envPath = process.env.PILAR_ENV_PATH;
      if (!envPath || path.basename(envPath).toLowerCase() !== '.env') {
        sendJson(res, 500, { error: 'No se pudo determinar el archivo privado de configuración de este equipo.' });
        return;
      }
      fs.mkdirSync(path.dirname(envPath), { recursive: true });
      const temporaryPath = `${envPath}.${process.pid}.tmp`;
      const existingConfig = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const retainedConfig = existingConfig
        .split(/\r?\n/)
        .filter((line) => line && !/^\s*GEMINI_API_KEY\s*=/.test(line))
        .join('\n');
      const savedConfig = `${retainedConfig ? `${retainedConfig}\n` : ''}GEMINI_API_KEY=${JSON.stringify(apiKey)}\n`;
      fs.writeFileSync(temporaryPath, savedConfig, { mode: 0o600 });
      fs.renameSync(temporaryPath, envPath);
      process.env.GEMINI_API_KEY = apiKey;
      apiConfig.gemini.apiKey = apiKey;
      sendJson(res, 200, { ok: true, geminiConfigured: true, message: 'Clave guardada en el perfil privado de este equipo.' });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo guardar la clave en este equipo.' });
    }
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/folders') {
    try {
      const payload = JSON.parse((await readRequestBody(req)).toString() || '{}');
      sendJson(res, 200, { folders: await persistence.saveFolders(req.user.id, payload.folders) });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'No se pudieron guardar las carpetas.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    if (!allowRequest(req, 'ai-chat', 30, 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas solicitudes de IA. Espera un minuto e inténtalo nuevamente.' });
      return;
    }

    try {
      const body = await readRequestBody(req, 16 * 1024 * 1024);
      const payload = JSON.parse(body.toString() || '{}');
      const abortController = new AbortController();
      const abortOnDisconnect = () => {
        if (!res.writableEnded) abortController.abort(new Error('El cliente cerró la conexión.'));
      };
      res.once('close', abortOnDisconnect);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      res.write(': connected\n\n');
      const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n');
      }, 15_000);
      heartbeat.unref();

      try {
        const result = await generateAssistantReplyStream(
          payload.prompt || '',
          payload.context || '',
          payload.attachments || [],
          (text) => writeSse(res, 'delta', { text }),
          abortController.signal,
        );
        await writeSse(res, 'done', { fallback: result.fallback, quotaExceeded: result.quotaExceeded });
      } catch (error) {
        if (!abortController.signal.aborted && !res.destroyed) {
          await writeSse(res, 'error', { error: error.message || 'No se pudo completar la respuesta de IA.' });
        }
      } finally {
        clearInterval(heartbeat);
        res.removeListener('close', abortOnDisconnect);
        if (!res.writableEnded && !res.destroyed) res.end();
      }
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: error.message || 'No se pudo procesar la solicitud de IA.' });
      else if (!res.destroyed && !res.writableEnded) res.end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/image') {
    if (req.user?.trialExpired) {
      sendJson(res, 402, { error: 'Tu período de prueba terminó. Contacta a PILAR para activar una licencia.' });
      return;
    }
    if (!allowRequest(req, 'ai-image', 5, 60 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Se alcanzó el límite horario de imágenes. Inténtalo más tarde.' });
      return;
    }
    try {
      const payload = JSON.parse((await readRequestBody(req)).toString() || '{}');
      if (!String(payload.prompt || '').trim() || String(payload.prompt).length > 4000) {
        sendJson(res, 400, { error: 'Describe la imagen en un máximo de 4000 caracteres.' });
        return;
      }
      const job = await persistence.createAiJob({ userId: req.user.id, type: 'image', prompt: payload.prompt.trim() });
      sendJson(res, 202, { jobId: job.id, status: job.status, message: job.message });
    } catch (error) {
      const status = /cola de IA está llena/i.test(error.message || '') ? 429 : 503;
      sendJson(res, status, { error: error.message || 'No se pudo poner la generación de imagen en cola.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate-infographic') {
    if (!allowRequest(req, 'ai-infographic', 20, 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas solicitudes visuales. Espera un minuto e inténtalo nuevamente.' });
      return;
    }
    try {
      const payload = JSON.parse((await readRequestBody(req)).toString() || '{}');
      const prompt = String(payload.prompt || '').trim();
      if (!prompt || prompt.length > 4000) {
        sendJson(res, 400, { error: 'Describe el mapa mental o la infografía en un máximo de 4000 caracteres.' });
        return;
      }
      const job = await persistence.createAiJob({ userId: req.user.id, type: 'infographic', prompt });
      sendJson(res, 202, { jobId: job.id, status: job.status, message: job.message });
    } catch (error) {
      const status = /cola de IA está llena/i.test(error.message || '') ? 429 : 503;
      sendJson(res, status, { success: false, error: error.message || 'No se pudo poner el mapa visual en cola.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/transcribe') {
    if (!allowRequest(req, 'transcribe', 5, 10 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas transcripciones. Espera unos minutos e inténtalo nuevamente.' });
      return;
    }
    const userActiveJobs = useFirebasePersistence
      ? await firebaseService.countActiveJobs(req.user.id, 'transcription')
      : localTranscription.activeJobCount(req.user.id);
    if (userActiveJobs >= 2 || (!useFirebasePersistence && localTranscription.activeJobCount() >= 20)) {
      sendJson(res, 429, { error: 'La cola de transcripción está llena. Espera a que termine un trabajo activo.' });
      return;
    }

    try {
      const body = await readRequestBody(req, MAX_UPLOAD_BODY_BYTES);
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
      if (!file.mimeType.startsWith('audio/') || !file.buffer.length) {
        sendJson(res, 400, { error: 'El archivo recibido no es un audio válido.' });
        return;
      }

      const saved = await persistence.saveBinaryFile({
        userId: req.user.id,
        fileName: `${Date.now()}-${file.fileName || 'audio'}`,
        buffer: file.buffer,
        mimeType: file.mimeType,
        folder: 'uploads',
      });

      const chunkSeconds = Number(process.env.PILAR_AUDIO_CHUNK_SECONDS || 20 * 60);
      const savedFile = {
        fileName: saved.fileName,
        originalName: file.fileName || 'audio',
        mimeType: file.mimeType,
        size: file.buffer.length,
        relativePath: saved.relativePath,
      };
      let job;
      try {
        job = useFirebasePersistence
          ? await firebaseService.enqueueTranscription({
            userId: req.user.id,
            fileId: saved.fileName,
            fileName: file.fileName || 'audio',
            mimeType: file.mimeType,
            chunkSeconds,
            savedFile,
          })
          : localTranscription.createJob({
            userId: req.user.id,
            filePath: saved.fullPath,
            fileName: file.fileName || 'audio',
            mimeType: file.mimeType,
            chunkSeconds,
          });
      } catch (error) {
        try {
          await persistence.deleteFile({ userId: req.user.id, folder: 'uploads', fileName: saved.fileName });
        } catch (cleanupError) {
          console.error(`[PILAR][transcribe] No se pudo limpiar el archivo no programado: ${cleanupError.message}`);
        }
        if (/cola de transcripción está llena/i.test(error.message || '')) {
          sendJson(res, 429, { error: error.message });
          return;
        }
        throw error;
      }
      if (!useFirebasePersistence) job.savedFile = savedFile;

      sendJson(res, 202, {
        jobId: job.id,
        savedFile: job.savedFile,
        status: job.status,
        message: job.message,
        limitRecommendedMinutes: 240,
        chunkMinutes: Math.round(chunkSeconds / 60),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo transcribir el archivo.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/transcribe/jobs/')) {
    if (!allowRequest(req, 'transcription-job-status', 60, 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas consultas de transcripción. Espera un minuto.' });
      return;
    }
    const jobId = decodeURIComponent(url.pathname.slice('/api/transcribe/jobs/'.length));
    const isCancelPath = jobId.endsWith('/cancel');
    const cleanJobId = isCancelPath ? jobId.replace(/\/cancel$/, '') : jobId;
    const job = useFirebasePersistence
      ? await firebaseService.getTranscriptionJob(req.user.id, cleanJobId)
      : localTranscription.getJob(cleanJobId, req.user.id);

    if (!job) {
      sendJson(res, 404, { error: 'Trabajo de transcripción no encontrado.' });
      return;
    }

    if (isCancelPath) {
      const cancelled = useFirebasePersistence
        ? await firebaseService.cancelTranscriptionJob(req.user.id, cleanJobId)
        : (localTranscription.cancelJob(cleanJobId, req.user.id), job);
      sendJson(res, 200, { ok: true, jobId: cleanJobId, status: cancelled?.status || job.status, message: 'Cancelación solicitada. El proceso intentará limpiar los fragmentos.' });
      return;
    }

    sendJson(res, 200, useFirebasePersistence ? job : localTranscription.publicJob(job));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/transcribe/jobs/')) {
    if (!allowRequest(req, 'transcription-job-status', 60, 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas consultas de transcripción. Espera un minuto.' });
      return;
    }
    const jobId = decodeURIComponent(url.pathname.slice('/api/transcribe/jobs/'.length));
    const job = useFirebasePersistence
      ? await firebaseService.getTranscriptionJob(req.user.id, jobId)
      : localTranscription.getJob(jobId, req.user.id);

    if (!job) {
      sendJson(res, 404, { error: 'Trabajo de transcripción no encontrado.' });
      return;
    }

    sendJson(res, 200, useFirebasePersistence ? job : localTranscription.publicJob(job));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/storage/text') {
    if (!allowRequest(req, 'storage-text', 60, 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas operaciones de guardado. Espera un minuto.' });
      return;
    }
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString() || '{}');
      const fileName = payload.fileName || `PILAR-${Date.now()}.txt`;
      const content = String(payload.content || '');

      if (!content.trim()) {
        sendJson(res, 400, { error: 'No hay contenido para guardar.' });
        return;
      }

      const saved = await persistence.saveTextFile({ userId: req.user.id, fileName, content, folder: 'uploads' });
      sendJson(res, 200, { message: `Contenido guardado: ${saved.fileName}`, savedFile: saved });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo guardar el contenido.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/storage/image') {
    try {
      const payload = JSON.parse((await readRequestBody(req, 16 * 1024 * 1024)).toString() || '{}');
      const mimeType = String(payload.mimeType || '');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
        sendJson(res, 400, { error: 'Formato de imagen no admitido.' });
        return;
      }
      const encoded = String(payload.data || '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > 14 * 1024 * 1024) {
        sendJson(res, 400, { error: 'Los datos de imagen no son válidos o superan el límite.' });
        return;
      }
      const buffer = Buffer.from(encoded, 'base64');
      if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
        sendJson(res, 400, { error: 'La imagen supera el límite de 10 MB.' });
        return;
      }
      const savedFile = await persistence.saveBinaryFile({
        userId: req.user.id,
        fileName: `PILAR-imagen-${Date.now()}.${mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'}`,
        buffer,
        mimeType,
        folder: 'uploads',
      });
      sendJson(res, 200, { savedFile });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'No se pudo guardar la imagen.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/storage/files') {
    const folder = url.searchParams.get('folder') === 'pdfs' ? 'pdfs' : 'uploads';
    sendJson(res, 200, { files: await persistence.listFiles({ userId: req.user.id, folder }) });
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

    if (!await persistence.deleteFile({ userId: req.user.id, folder: safeFolder, fileName })) {
      sendJson(res, 404, { error: 'Archivo no encontrado.' });
      return;
    }

    sendJson(res, 200, { message: `Archivo eliminado: ${fileName}` });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    if (!allowRequest(req, 'upload', 30, 10 * 60 * 1000)) {
      sendJson(res, 429, { error: 'Demasiadas cargas de archivos. Espera unos minutos.' });
      return;
    }
    try {
      const body = await readRequestBody(req, MAX_UPLOAD_BODY_BYTES);
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

      const saved = await persistence.saveBinaryFile({
        userId: req.user.id,
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
      const body = await readRequestBody(req, MAX_UPLOAD_BODY_BYTES);
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

      const saved = await persistence.saveBinaryFile({ userId: req.user.id, fileName: file.fileName || 'document.pdf', buffer: file.buffer, mimeType: file.mimeType, folder: 'pdfs' });
      sendJson(res, 200, { message: `PDF guardado en la carpeta ${apiConfig.storage.pdfDir}.`, savedFile: saved });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'No se pudo guardar el PDF.' });
    }
    return;
  }

  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;

  if (requestPath.startsWith('/storage/')) {
    if (!req.user) {
      sendJson(res, 401, { error: 'Inicia sesión para acceder a tus archivos.' });
      return;
    }
    let storageParts;
    try {
      storageParts = decodeURIComponent(requestPath).split('/').filter(Boolean);
    } catch {
      sendJson(res, 400, { error: 'Ruta de archivo no válida.' });
      return;
    }
    if (storageParts[1] !== req.user.id || !['uploads', 'pdfs'].includes(storageParts[2])) {
      sendJson(res, 404, { error: 'Archivo no encontrado.' });
      return;
    }
    if (useFirebasePersistence) {
      if (storageParts.length !== 5 || !/^[0-9a-f-]{36}$/i.test(storageParts[3])) {
        sendJson(res, 404, { error: 'Archivo no encontrado.' });
        return;
      }
      try {
        const found = await firebaseService.streamFile({
          userId: req.user.id,
          folder: storageParts[2],
          id: storageParts[3],
          res,
        });
        if (!found) sendJson(res, 404, { error: 'Archivo no encontrado.' });
      } catch (error) {
        console.error(`[PILAR][firebase-storage] No se pudo descargar ${storageParts[3]}: ${error.message}`);
        if (!res.headersSent) sendJson(res, 500, { error: 'No se pudo descargar el archivo.' });
        else if (!res.destroyed && !res.writableEnded) res.destroy(error);
      }
      return;
    }
    if (storageParts.length !== 4) {
      sendJson(res, 404, { error: 'Archivo no encontrado.' });
      return;
    }
    const userStorageDir = path.resolve(apiConfig.storage.baseDir, 'users', req.user.id);
    const storagePath = path.resolve(userStorageDir, storageParts[2], storageParts[3]);
    if (!storagePath.startsWith(`${userStorageDir}${path.sep}`)) {
      sendJson(res, 404, { error: 'Archivo no encontrado.' });
      return;
    }
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
      const safeInlineTypes = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.pdf']);
      const contentType = safeInlineTypes.has(ext) ? mimeTypes[ext] || 'application/octet-stream' : 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': safeInlineTypes.has(ext) ? 'inline' : 'attachment',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });
      res.end(content);
    });
    return;
  }

  let decodedRequestPath;
  try {
    decodedRequestPath = decodeURIComponent(requestPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Ruta no válida');
    return;
  }

  const filePath = path.resolve(rootDir, `.${decodedRequestPath}`);
  const relativeFilePath = path.relative(rootDir, filePath);
  if (relativeFilePath.startsWith('..') || path.isAbsolute(relativeFilePath)
    || relativeFilePath.split(path.sep).some((segment) => segment.startsWith('.'))
    || !PUBLIC_FILES.has(relativeFilePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Archivo no encontrado');
    return;
  }

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

if (!useFirebasePersistence) ensureRootStorage();

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  handleRoutes(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message || 'Error del servidor.' });
  });
});

async function startServer() {
  if (useFirebasePersistence) await firebaseService.resumeOutstandingJobs();
  server.listen(port, hostname, () => {
    console.log(`PILAR del estudiante está corriendo en http://${hostname}:${port}`);
    console.log(`API health: http://${hostname}:${port}/api/health`);
  });
}

startServer().catch((error) => {
  console.error(`[PILAR] No se pudo iniciar el servidor: ${error.message}`);
  process.exitCode = 1;
});
