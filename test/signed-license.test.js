const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-signed-license-'));
process.env.PILAR_DATA_PATH = dataDir;
process.env.NODE_ENV = 'desktop';
process.env.PILAR_REGISTRATION_CODES = '';
process.env.PILAR_LICENSE_CODES = '';
const auth = require('../src/services/authService');
const issuerKeyPath = path.join(os.homedir(), '.pilar-license-issuer', 'private.pem');

function issueDesktopLicense(email, licenseId = crypto.randomUUID()) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    product: 'pilar-desktop',
    email,
    licenseId,
    issuedAt: new Date().toISOString(),
  })).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(payload), fs.readFileSync(issuerKeyPath)).toString('base64url');
  return `${payload}.${signature}`;
}

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('accepts a valid email-bound desktop license once and rejects tampering/reuse', {
  skip: !fs.existsSync(issuerKeyPath),
}, () => {
  const buyer = auth.register({ name: 'Desktop buyer', email: 'desktop-buyer@example.test', password: 'DesktopBuyer-Password-2026', legalConsent: true });
  const other = auth.register({ name: 'Other buyer', email: 'other-buyer@example.test', password: 'OtherBuyer-Password-2026', legalConsent: true });
  const licenseId = crypto.randomUUID();
  const license = issueDesktopLicense('desktop-buyer@example.test', licenseId);

  const activated = auth.redeemLicense(buyer.user.id, license);
  assert.equal(activated.plan, 'paid');
  assert.equal(auth.getSession(buyer.token).trialExpired, false);

  assert.throws(() => auth.redeemLicense(other.user.id, license), /otro correo|utilizada/i);
  const [payload] = license.split('.');
  const invalidSignature = Buffer.alloc(64).toString('base64url');
  assert.throws(() => auth.redeemLicense(buyer.user.id, `${payload}.${invalidSignature}`), /firma válida/i);
});
