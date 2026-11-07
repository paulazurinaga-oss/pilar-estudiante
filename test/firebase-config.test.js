const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { useFirebasePersistence } = require('../src/services/persistenceConfig');

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

test('selects Firebase on Render when persistence is unset and service-account credentials exist', () => {
  assert.equal(useFirebasePersistence({
    RENDER_SERVICE_ID: 'test-render-service',
    FIREBASE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
  }), true);
});

test('does not silently select local persistence on Render without Firebase credentials', () => {
  assert.throws(() => useFirebasePersistence({
    RENDER_SERVICE_ID: 'test-render-service',
  }), /Render requiere PILAR_PERSISTENCE=firebase o credenciales de Firebase configuradas/);
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
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      FIREBASE_DATABASE_URL: '',
      FIREBASE_WEB_API_KEY: '',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Faltan variables obligatorias de Firebase/);
  assert.match(result.stderr, /FIREBASE_PROJECT_ID/);
});

test('accepts a Firebase service account JSON environment variable', () => {
  const result = spawnSync(process.execPath, [
    '-e',
    "require('./src/services/firebaseService').assertConfigured();",
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FIREBASE_PROJECT_ID: '',
      FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '',
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'pilar-test-project',
        client_email: 'firebase-admin@pilar-test-project.iam.gserviceaccount.com',
        private_key: 'test-private-key',
      }),
      FIREBASE_DATABASE_URL: 'https://pilar-test-project-default-rtdb.firebaseio.com',
      FIREBASE_WEB_API_KEY: 'test-web-api-key',
    },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects malformed Firebase service account JSON without exposing its contents', () => {
  const result = spawnSync(process.execPath, [
    '-e',
    "require('./src/services/firebaseService').assertConfigured();",
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FIREBASE_PROJECT_ID: '',
      FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"private_key":"do-not-print"',
      FIREBASE_DATABASE_URL: 'https://pilar-test-project-default-rtdb.firebaseio.com',
      FIREBASE_WEB_API_KEY: 'test-web-api-key',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FIREBASE_SERVICE_ACCOUNT_JSON debe contener una credencial JSON válida/);
  assert.doesNotMatch(result.stderr, /do-not-print/);
});
