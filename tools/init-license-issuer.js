const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const issuerDir = path.join(os.homedir(), '.pilar-license-issuer');
const privatePath = path.join(issuerDir, 'private.pem');
const publicPath = path.join(issuerDir, 'public.pem');

if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) {
  console.error(`Ya existe una clave del emisor en ${issuerDir}. No se sobrescribió.`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(issuerDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
console.log('Clave privada creada fuera del proyecto. No la envíes ni la subas a GitHub.');
console.log('Clave pública para src/services/licensePublicKey.js:\n');
console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString());
