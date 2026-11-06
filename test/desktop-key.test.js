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
let envPath;
let cookie;

async function getPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function startServer(port) {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'desktop',
      PILAR_DATA_PATH: dataDir,
      PILAR_ENV_PATH: envPath,
      PILAR_ALLOW_USER_API_KEY: '1',
      PILAR_REGISTRATION_CODES: '',
      PILAR_LICENSE_CODES: '',
      GEMINI_API_KEY: '',
    },
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El backend desktop de prueba no inició.');
}

async function call(pathname, { method = 'GET', body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-desktop-key-'));
  envPath = path.join(dataDir, 'settings', '.env');
  const port = await getPort();
  baseUrl = `http://127.0.0.1:${port}`;
  await startServer(port);
  const registration = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Comprador', email: 'comprador@example.test', password: 'ClaveDesktop-2026', legalConsent: true },
  });
  assert.equal(registration.status, 200);
  cookie = registration.headers.get('set-cookie')?.split(';')[0];
});

after(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('stores the desktop buyer key in their private profile and reloads it without exposing it', async () => {
  const settings = await call('/api/config/ai');
  assert.deepEqual(await settings.json(), { canSetPersonalKey: true, geminiConfigured: false });

  const set = await call('/api/config/ai-key', {
    method: 'POST',
    body: { apiKey: 'test-buyer-gemini-key-never-a-real-secret-12345' },
  });
  assert.equal(set.status, 200);
  assert.equal((await set.json()).geminiConfigured, true);
  const saved = fs.readFileSync(envPath, 'utf8');
  assert.match(saved, /^GEMINI_API_KEY=/);
  assert.match(saved, /test-buyer-gemini-key-never-a-real-secret-12345/);
  assert.equal((await call('/api/config/ai').then((response) => response.json())).canSetPersonalKey, true);

  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
  const port = new URL(baseUrl).port;
  await startServer(port);
  const health = await call('/api/health');
  assert.equal((await health.json()).providerConfigured, true);
  const publicSettings = await call('/api/config/ai').then((response) => response.json());
  assert.deepEqual(publicSettings, { canSetPersonalKey: true, geminiConfigured: true });
  assert.ok(!JSON.stringify(publicSettings).includes('test-buyer-gemini-key'));
});
