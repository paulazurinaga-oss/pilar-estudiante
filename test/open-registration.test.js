const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('allows production account registration without invitations when explicitly enabled', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-open-registration-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const output = execFileSync(process.execPath, ['-e', `
    const auth = require('./src/services/authService');
    const result = auth.register({
      name: 'Cuenta pública',
      email: 'publica@example.test',
      password: 'ClavePublicaSegura-2026',
      legalConsent: true,
    });
    process.stdout.write(JSON.stringify(result.user));
  `], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PILAR_DATA_PATH: dataDir,
      PILAR_OPEN_REGISTRATION: 'true',
      PILAR_REGISTRATION_CODES: '',
    },
  });

  const user = JSON.parse(output);
  assert.equal(user.email, 'publica@example.test');
  assert.ok(fs.existsSync(path.join(dataDir, 'auth', 'users.json')));
});
