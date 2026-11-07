const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.join(__dirname, '..');

test('validates an exported Render storage backup without requiring Firebase credentials', (t) => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-render-export-'));
  t.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));
  const userId = 'c41fdb31-73fd-41cc-92d5-62172ab60bc2';
  const authDir = path.join(storageDir, 'auth');
  const uploadDir = path.join(storageDir, 'users', userId, 'uploads');
  fs.mkdirSync(authDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, 'users.json'), JSON.stringify([{
    id: userId,
    name: 'Estudiante',
    email: 'estudiante@example.test',
    passwordSalt: 'legacy-salt',
    passwordHash: 'a'.repeat(128),
  }]));
  fs.writeFileSync(path.join(uploadDir, 'nota.txt'), 'contenido');
  fs.writeFileSync(path.join(uploadDir, '.pilar-metadata.json'), JSON.stringify({
    'nota.txt': { originalName: 'Nota.txt', mimeType: 'text/plain' },
  }));

  const output = execFileSync(process.execPath, [
    'tools/migrate-render-storage-to-firebase.js',
    '--dry-run',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PILAR_LEGACY_STORAGE: storageDir,
      FIREBASE_PROJECT_ID: '',
      FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '',
      FIREBASE_DATABASE_URL: '',
    },
  });
  assert.match(output, /1 cuentas, 1 archivos, 0 compras/);
  assert.doesNotMatch(output, /estudiante@example\.test|legacy-salt/);
});

test('Firebase client rules deny direct access to both persistence databases', () => {
  const firestoreRules = fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');
  const databaseRules = JSON.parse(fs.readFileSync(path.join(projectRoot, 'database.rules.json'), 'utf8'));
  assert.match(firestoreRules, /allow read, write: if false/);
  assert.equal(databaseRules.rules['.read'], false);
  assert.equal(databaseRules.rules['.write'], false);
});
