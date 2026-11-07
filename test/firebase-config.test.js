const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.join(__dirname, '..');

test('refuses to start on Render if Firebase persistence is not selected', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./server.js')"], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      RENDER_SERVICE_ID: 'test-render-service',
      PILAR_PERSISTENCE: 'local',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Render requiere PILAR_PERSISTENCE=firebase/);
});

test('fails fast instead of silently falling back when Firebase credentials are missing', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./server.js')"], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      RENDER_SERVICE_ID: 'test-render-service',
      PILAR_PERSISTENCE: 'firebase',
      FIREBASE_PROJECT_ID: '',
      FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '',
      FIREBASE_DATABASE_URL: '',
      FIREBASE_WEB_API_KEY: '',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Faltan variables obligatorias de Firebase/);
  assert.match(result.stderr, /FIREBASE_PROJECT_ID/);
});
