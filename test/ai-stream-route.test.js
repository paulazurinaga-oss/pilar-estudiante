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
let cookie;

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitUntilReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El servidor de streaming no inició a tiempo.');
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-ai-stream-'));
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const mockGemini = `
    global.fetch = async (url) => {
      if (!String(url).includes(':streamGenerateContent?alt=sse')) throw new Error('Fetch inesperado');
      const parts = [
        { candidates: [{ content: { parts: [{ text: 'Respuesta' }] } }] },
        { candidates: [{ content: { parts: [{ text: ' en streaming.' }] } }] },
      ];
      const body = parts.map((part) => 'data: ' + JSON.stringify(part) + '\\n\\n').join('');
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    };
    require('./server.js');
  `;
  server = spawn(process.execPath, ['-e', mockGemini], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'test',
      PILAR_DATA_PATH: dataDir,
      GEMINI_API_KEY: 'test-gemini-key',
      PILAR_REGISTRATION_CODES: '',
    },
  });
  await waitUntilReady();
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Estudiante Streaming',
      email: 'streaming@example.test',
      password: 'ClaveStreaming-2026',
      legalConsent: true,
    }),
  });
  assert.equal(registration.status, 200);
  cookie = registration.headers.get('set-cookie')?.split(';')[0];
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('streams chat deltas from the authenticated endpoint as server-sent events', async () => {
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, accept: 'text/event-stream' },
    body: JSON.stringify({ prompt: 'Explica el streaming' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');

  const streamText = await response.text();
  assert.match(streamText, /event: delta/);
  assert.match(streamText, /event: done/);
  assert.match(streamText, /"text":"Respuesta"/);
  assert.match(streamText, /"text":" en streaming\."/);
  assert.match(streamText, /"fallback":false/);
});
