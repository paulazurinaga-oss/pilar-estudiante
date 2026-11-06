const crypto = require('crypto');

const mode = ['invite', 'license'].includes(process.argv[2]) ? process.argv[2] : 'license';
const countArgument = mode === 'license' && process.argv[2] !== 'license' ? process.argv[2] : process.argv[3];
const count = Number(countArgument || 1);
if (!Number.isInteger(count) || count < 1 || count > 100) {
  console.error('Uso: node tools/generate-license-codes.js invite|license [cantidad: 1-100]');
  process.exit(1);
}

console.log(`${mode === 'invite' ? 'Invitaciones' : 'Licencias'} PILAR de un solo uso. Guarda esta salida; no se puede recuperar después.`);
for (let index = 0; index < count; index += 1) {
  console.log(`PILAR-${mode === 'invite' ? 'INV' : 'LIC'}-${crypto.randomBytes(32).toString('base64url')}`);
}
