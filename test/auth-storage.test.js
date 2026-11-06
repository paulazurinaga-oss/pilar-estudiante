const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { after, before, test } = require('node:test');

let server;
let baseUrl;
let dataDir;
let firstCookie;
let secondCookie;
let firstFilePath;
let serverPort;

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitUntilReady() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El servidor de prueba no inició a tiempo.');
}

async function api(pathname, { cookie, method = 'GET', body, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-integration-'));
  serverPort = await reservePort();
  baseUrl = `http://127.0.0.1:${serverPort}`;
  await startServer();
});

async function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(serverPort),
      NODE_ENV: 'test',
      PILAR_DATA_PATH: dataDir,
      PILAR_REGISTRATION_CODES: [
        'integration-invite-one', 'integration-invite-two', 'integration-invite-three', 'integration-invite-four', 'integration-invite-five', 'integration-invite-six',
      ].join(','),
      PILAR_REGISTRATION_CODE: '',
      GEMINI_API_KEY: 'integration-central-gemini-key-not-secret',
      MERCADOPAGO_ACCESS_TOKEN: 'TEST-MP-TOKEN-NOT-REAL',
      MERCADOPAGO_WEBHOOK_SECRET: 'MP-WEBHOOK-SECRET-NOT-REAL',
      PILAR_WEB_PRICE_ARS: '15000',
      PILAR_PUBLIC_URL: 'https://pilar.example.test',
      PILAR_LICENSE_CODES: 'PILAR-TEST-LICENSE-ONLY-1234567890',
    },
  });
  await waitUntilReady();
}

async function restartServer() {
  const previous = server;
  previous.kill();
  await new Promise((resolve) => previous.once('exit', resolve));
  await startServer();
}

after(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('denies private APIs and hidden files without a session', async () => {
  const files = await api('/api/storage/files');
  assert.equal(files.status, 401);
  const secret = await fetch(`${baseUrl}/.env`);
  assert.equal(secret.status, 404);
  const source = await fetch(`${baseUrl}/server.js`);
  assert.equal(source.status, 404);
  assert.ok(secret.headers.get('content-security-policy'));
});

test('does not allow changing the central Gemini key from the web service', async () => {
  const registration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Web account', email: 'web-config@example.test', password: 'ClaveWeb-Segura-123', registrationCode: 'integration-invite-five', legalConsent: true },
  });
  assert.equal(registration.status, 200);
  const cookie = cookieFrom(registration);
  const settings = await api('/api/config/ai', { cookie });
  assert.deepEqual(await settings.json(), { canSetPersonalKey: false, geminiConfigured: true });
  const writeAttempt = await api('/api/config/ai-key', {
    cookie,
    method: 'POST',
    body: { apiKey: 'fake-customer-key-that-must-not-replace-central' },
  });
  assert.equal(writeAttempt.status, 404);
});

test('exposes fixed-price web checkout but refuses forged payment notifications', async () => {
  const registration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Checkout', email: 'checkout@example.test', password: 'Checkout-Seguro-2026', registrationCode: 'integration-invite-six', legalConsent: true },
  });
  const cookie = cookieFrom(registration);
  const config = await api('/api/payments/config', { cookie });
  assert.deepEqual(await config.json(), {
    enabled: true,
    desktop: false,
    amount: 15000,
    currency: 'ARS',
    description: 'Licencia web de pago único para una cuenta.',
  });
  const forged = await fetch(`${baseUrl}/api/payments/webhook?data.id=99887766`, {
    method: 'POST',
    headers: { 'x-signature': 'ts=1700000000,v1=00', 'x-request-id': 'forged-test' },
    body: JSON.stringify({ type: 'payment', data: { id: '99887766' } }),
  });
  assert.equal(forged.status, 401);
});

test('registers separate users and isolates files and folders', async () => {
  const firstRegistration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Estudiante Uno', email: 'uno@example.test', password: 'UnaClaveSegura-123', registrationCode: 'integration-invite-one', legalConsent: true },
  });
  assert.equal(firstRegistration.status, 200);
  firstCookie = cookieFrom(firstRegistration);
  assert.ok(firstCookie);
  const firstUser = (await firstRegistration.json()).user;
  const activeSession = await api('/api/auth/me', { cookie: firstCookie });
  assert.equal((await activeSession.json()).user.trialExpired, false);
  const persistedUsers = JSON.parse(fs.readFileSync(path.join(dataDir, 'auth', 'users.json'), 'utf8'));
  const storedUser = persistedUsers.find((user) => user.id === firstUser.id);
  assert.equal(storedUser.legalVersion, 'draft-2026-10-06');
  assert.ok(storedUser.legalAcceptedAt);
  const missingConsent = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Sin aceptación', email: 'consent@example.test', password: 'ClaveConsent-123', registrationCode: 'integration-invite-two' },
  });
  assert.equal(missingConsent.status, 400);
  const reusedInvite = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Invitación repetida', email: 'repetida@example.test', password: 'ClaveRepetida-123', registrationCode: 'integration-invite-one', legalConsent: true },
  });
  assert.equal(reusedInvite.status, 400);

  const saved = await api('/api/storage/text', {
    cookie: firstCookie,
    method: 'POST',
    body: { fileName: 'nota.txt', content: 'contenido privado' },
  });
  assert.equal(saved.status, 200);
  firstFilePath = (await saved.json()).savedFile.relativePath;
  const privateFile = await fetch(`${baseUrl}${firstFilePath}`, { headers: { cookie: firstCookie } });
  assert.equal(await privateFile.text(), 'contenido privado');
  assert.equal(privateFile.headers.get('content-disposition'), 'attachment');

  const folders = await api('/api/folders', {
    cookie: firstCookie,
    method: 'PUT',
    body: { folders: [{ name: 'Biología', items: ['nota.txt'] }] },
  });
  assert.equal(folders.status, 200);
  assert.equal((await folders.json()).folders[0].name, 'Biología');

  const secondRegistration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Estudiante Dos', email: 'dos@example.test', password: 'OtraClaveSegura-456', registrationCode: 'integration-invite-two', legalConsent: true },
  });
  assert.equal(secondRegistration.status, 200);
  secondCookie = cookieFrom(secondRegistration);
  assert.ok(secondCookie);

  const secondFiles = await api('/api/storage/files', { cookie: secondCookie });
  assert.deepEqual((await secondFiles.json()).files, []);
  const forbiddenFile = await fetch(`${baseUrl}${firstFilePath}`, { headers: { cookie: secondCookie } });
  assert.equal(forbiddenFile.status, 404);
  const secondFolders = await api('/api/folders', { cookie: secondCookie });
  assert.deepEqual((await secondFolders.json()).folders, []);

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: firstUser.email, password: 'UnaClaveSegura-123' },
  });
  assert.equal(login.status, 200);
  firstCookie = cookieFrom(login);
  assert.ok(firstCookie);
});

test('enforces invitation codes and trial expiration server-side', async () => {
  const noCode = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Sin código', email: 'sin-codigo@example.test', password: 'OtraClaveSegura-789', legalConsent: true },
  });
  assert.equal(noCode.status, 400);
  const legacyCode = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Código legado', email: 'legado@example.test', password: 'ClaveLegado-123', registrationCode: 'legacy-code', legalConsent: true },
  });
  assert.equal(legacyCode.status, 400);

  const usersPath = path.join(dataDir, 'auth', 'users.json');
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  const trialUser = users.find((user) => user.email === 'uno@example.test');
  assert.ok(trialUser);
  trialUser.trialExpiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(usersPath, JSON.stringify(users));

  const expiredAi = await api('/api/ai/chat', {
    cookie: firstCookie,
    method: 'POST',
    body: { prompt: 'Esto no debe llamar al proveedor.' },
  });
  assert.equal(expiredAi.status, 402);

  const activation = await api('/api/auth/activate', {
    cookie: firstCookie,
    method: 'POST',
    body: { code: 'PILAR-TEST-LICENSE-ONLY-1234567890' },
  });
  assert.equal(activation.status, 200);
  assert.equal((await activation.json()).user.plan, 'paid');

  const reactivation = await api('/api/auth/activate', {
    cookie: secondCookie,
    method: 'POST',
    body: { code: 'PILAR-TEST-LICENSE-ONLY-1234567890' },
  });
  assert.equal(reactivation.status, 400);
});

test('rejects incorrect login and logs out the session', async () => {
  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'uno@example.test', password: 'incorrecta' },
  });
  assert.equal(badLogin.status, 400);

  const logout = await api('/api/auth/logout', { cookie: firstCookie, method: 'POST', body: {} });
  assert.equal(logout.status, 200);
  const session = await api('/api/auth/me', { cookie: firstCookie });
  assert.equal(session.status, 401);
});

test('persists hashed sessions across restart and deletes account data on request', async () => {
  const registration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Persistencia', email: 'persistencia@example.test', password: 'ClavePersistente-789', registrationCode: 'integration-invite-three', legalConsent: true },
  });
  const cookie = cookieFrom(registration);
  const token = cookie.slice('pilar_session='.length);
  const sessions = JSON.parse(fs.readFileSync(path.join(dataDir, 'auth', 'sessions.json'), 'utf8'));
  assert.equal(sessions[0].tokenHash.length, 64);
  assert.ok(!JSON.stringify(sessions).includes(token));

  await restartServer();
  const restored = await api('/api/auth/me', { cookie });
  assert.equal(restored.status, 200);

  const account = (await restored.json()).user;
  await api('/api/storage/text', {
    cookie,
    method: 'POST',
    body: { fileName: 'borrar.txt', content: 'borrar con cuenta' },
  });
  const deletion = await api('/api/auth/account', {
    cookie,
    method: 'DELETE',
    body: { password: 'ClavePersistente-789' },
  });
  assert.equal(deletion.status, 200);
  assert.equal((await api('/api/auth/me', { cookie })).status, 401);
  assert.ok(!fs.existsSync(path.join(dataDir, 'users', account.id)));
});

test('sets Secure cookies behind HTTPS proxy and rejects cross-origin writes', async () => {
  const registration = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'x-forwarded-proto': 'https' },
    body: { name: 'Seguridad', email: 'seguridad@example.test', password: 'ClaveSeguridad-456', registrationCode: 'integration-invite-four', legalConsent: true },
  });
  assert.equal(registration.status, 200);
  const cookie = cookieFrom(registration);
  assert.ok(cookie);
  const secureCookie = registration.headers.get('set-cookie');
  assert.match(secureCookie, /; Secure(?:;|$)/);

  const blockedWrite = await api('/api/storage/text', {
    cookie,
    method: 'POST',
    headers: { origin: 'https://attacker.example' },
    body: { fileName: 'csrf.txt', content: 'no' },
  });
  assert.equal(blockedWrite.status, 403);

  const appResponse = await fetch(`${baseUrl}/`);
  const policy = appResponse.headers.get('content-security-policy');
  assert.match(policy, /script-src 'self'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.equal((await fetch(`${baseUrl}/PRIVACIDAD.md`)).status, 200);
});
