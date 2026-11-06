const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const embeddedPublicKey = require('../src/services/licensePublicKey');

const product = process.argv[2];
const email = String(process.argv[3] || '').trim().toLowerCase();
if (!['desktop', 'web'].includes(product) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Uso: node tools/generate-signed-license.js desktop|web correo-del-comprador');
  process.exit(1);
}

const privatePath = process.env.PILAR_LICENSE_PRIVATE_KEY_PATH
  || path.join(os.homedir(), '.pilar-license-issuer', 'private.pem');
if (!fs.existsSync(privatePath)) {
  console.error('No se encontró la clave privada del emisor. Ejecuta primero node tools/init-license-issuer.js.');
  process.exit(1);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath));
const derivedPublicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString().trim();
if (derivedPublicKey !== embeddedPublicKey.trim()) {
  console.error('La clave privada del emisor no corresponde a la clave pública de esta versión de PILAR.');
  process.exit(1);
}

const payload = Buffer.from(JSON.stringify({
  version: 1,
  product: `pilar-${product}`,
  email,
  licenseId: crypto.randomUUID(),
  issuedAt: new Date().toISOString(),
})).toString('base64url');
const signature = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url');
console.log(`${payload}.${signature}`);
