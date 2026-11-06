const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-payment-service-'));
process.env.PILAR_DATA_PATH = dataDir;
process.env.NODE_ENV = 'test';
process.env.PILAR_REGISTRATION_CODES = '';
process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST_ACCESS_TOKEN_NOT_REAL';
process.env.MERCADOPAGO_WEBHOOK_SECRET = 'TEST_WEBHOOK_SECRET_NOT_REAL';
process.env.PILAR_WEB_PRICE_ARS = '12500';
process.env.PILAR_PUBLIC_URL = 'https://pilar.example.test';

const auth = require('../src/services/authService');
const payments = require('../src/services/paymentService');
const originalFetch = global.fetch;
let user;
let checkout;
let preferenceRequest;

before(async () => {
  user = auth.register({
    name: 'Cuenta web test',
    email: 'pago-test@example.test',
    password: 'PagoTest-Seguro-2026',
    legalConsent: true,
  }).user;
  global.fetch = async (url, options) => {
    preferenceRequest = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ id: 'test-preference-01', init_point: 'https://www.mercadopago.com.ar/checkout/01' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  checkout = await payments.createCheckout({ user, publicBaseUrl: 'https://pilar.example.test' });
});

after(() => {
  global.fetch = originalFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('creates a fixed-amount ARS preference tied to the authenticated account', () => {
  assert.equal(preferenceRequest.url, 'https://api.mercadopago.com/checkout/preferences');
  assert.equal(preferenceRequest.options.headers.Authorization, 'Bearer TEST_ACCESS_TOKEN_NOT_REAL');
  assert.equal(preferenceRequest.body.items[0].unit_price, 12500);
  assert.equal(preferenceRequest.body.items[0].currency_id, 'ARS');
  assert.equal(preferenceRequest.body.external_reference, checkout.orderId);
  assert.equal(preferenceRequest.body.notification_url, 'https://pilar.example.test/api/payments/webhook');
  assert.equal(checkout.checkoutUrl, 'https://www.mercadopago.com.ar/checkout/01');
});

test('reuses the pending checkout instead of creating a duplicate charge', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => { throw new Error('No debe crear una segunda preferencia.'); };
  try {
    const secondClick = await payments.createCheckout({ user, publicBaseUrl: 'https://pilar.example.test' });
    assert.equal(secondClick.orderId, checkout.orderId);
    assert.equal(secondClick.checkoutUrl, checkout.checkoutUrl);
    assert.equal(secondClick.reused, true);
  } finally {
    global.fetch = previousFetch;
  }
});

test('validates the Mercado Pago HMAC signature and rejects altered identifiers', () => {
  const paymentId = '99887766';
  const requestId = 'request-id-test';
  const timestamp = '1700000000';
  const manifest = `id:${paymentId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const signature = crypto.createHmac('sha256', process.env.MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest('hex');
  const signatureHeader = `ts=${timestamp},v1=${signature}`;
  assert.equal(payments.verifyWebhookSignature({ signatureHeader, requestId, paymentId, secret: process.env.MERCADOPAGO_WEBHOOK_SECRET }), true);
  assert.equal(payments.verifyWebhookSignature({ signatureHeader, requestId, paymentId: '99887767', secret: process.env.MERCADOPAGO_WEBHOOK_SECRET }), false);
  assert.equal(payments.verifyWebhookSignature({ signatureHeader, requestId, paymentId, secret: 'wrong-secret' }), false);
});

test('grants a license only after API-confirmed approved amount/currency and is idempotent', async () => {
  const order = payments.getOrder(checkout.orderId);
  assert.ok(order);
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.mercadopago.com/v1/payments/99887766');
    assert.equal(options.headers.Authorization, 'Bearer TEST_ACCESS_TOKEN_NOT_REAL');
    return new Response(JSON.stringify({
      id: 99887766,
      status: 'approved',
      transaction_amount: 12500,
      currency_id: 'ARS',
      external_reference: order.id,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const applied = await payments.processPaymentNotification('99887766');
  assert.deepEqual(applied, { applied: true, orderId: order.id });
  const session = auth.login({ email: user.email, password: 'PagoTest-Seguro-2026' });
  assert.equal(auth.getSession(session.token).plan, 'paid');
  await assert.rejects(
    payments.createCheckout({ user: auth.getSession(session.token), publicBaseUrl: 'https://pilar.example.test' }),
    /ya tiene una licencia/i,
  );

  const duplicate = await payments.processPaymentNotification('99887766');
  assert.deepEqual(duplicate, { applied: true, duplicate: true, orderId: order.id });
});

test('does not grant a license when the approved payment amount does not match the order', async () => {
  const other = auth.register({
    name: 'Cuenta mismatch',
    email: 'pago-mismatch@example.test',
    password: 'PagoMismatch-Seguro-2026',
    legalConsent: true,
  });
  global.fetch = async () => new Response(JSON.stringify({ id: 'preference-mismatch', init_point: 'https://www.mercadopago.com.ar/checkout/02' }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
  const mismatchCheckout = await payments.createCheckout({ user: other.user, publicBaseUrl: 'https://pilar.example.test' });
  global.fetch = async () => new Response(JSON.stringify({
    id: 99887767,
    status: 'approved',
    transaction_amount: 1,
    currency_id: 'ARS',
    external_reference: mismatchCheckout.orderId,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await payments.processPaymentNotification('99887767');
  assert.deepEqual(result, { applied: false, reason: 'payment_mismatch' });
  assert.equal(auth.getSession(other.token).plan, 'trial');
});

test('revokes a web license after Mercado Pago confirms a refund', async () => {
  const refundUser = auth.register({
    name: 'Refund buyer',
    email: 'refund-buyer@example.test',
    password: 'RefundBuyer-Seguro-2026',
    legalConsent: true,
  });
  global.fetch = async () => new Response(JSON.stringify({ id: 'preference-refund', init_point: 'https://www.mercadopago.com.ar/checkout/refund' }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
  const refundCheckout = await payments.createCheckout({ user: refundUser.user, publicBaseUrl: 'https://pilar.example.test' });
  global.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer TEST_ACCESS_TOKEN_NOT_REAL');
    return new Response(JSON.stringify({
      id: 99887768,
      status: 'approved',
      transaction_amount: 12500,
      currency_id: 'ARS',
      external_reference: refundCheckout.orderId,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await payments.processPaymentNotification('99887768');
  let session = auth.login({ email: refundUser.user.email, password: 'RefundBuyer-Seguro-2026' });
  assert.equal(auth.getSession(session.token).plan, 'paid');

  global.fetch = async () => new Response(JSON.stringify({
    id: 99887768,
    status: 'refunded',
    transaction_amount: 12500,
    currency_id: 'ARS',
    external_reference: refundCheckout.orderId,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const reversed = await payments.processPaymentNotification('99887768');
  assert.equal(reversed.reversed, true);
  assert.equal(auth.getSession(session.token).trialExpired, true);
  assert.equal(payments.getOrder(refundCheckout.orderId).status, 'refunded');
});
