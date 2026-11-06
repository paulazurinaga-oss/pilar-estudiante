const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { apiConfig } = require('./appConfig');
const { grantPaidLicense, revokePaidLicense } = require('./authService');

const ORDERS_FILE = path.join(apiConfig.storage.baseDir, 'payments', 'orders.json');
const MERCADO_PAGO_API = 'https://api.mercadopago.com';

function getPaymentConfig() {
  const price = Number(process.env.PILAR_WEB_PRICE_ARS);
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
  let publicUrlValid = process.env.NODE_ENV !== 'production';
  try {
    const publicUrl = new URL(process.env.PILAR_PUBLIC_URL || '');
    publicUrlValid = publicUrl.protocol === 'https:';
  } catch {
    publicUrlValid = false;
  }
  return {
    enabled: Boolean(accessToken && webhookSecret && Number.isSafeInteger(price) && price > 0 && publicUrlValid),
    price,
    accessToken,
    webhookSecret,
  };
}

function readOrders() {
  try {
    const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    return Array.isArray(orders) ? orders : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('No se pudo leer el registro de compras.');
  }
}

function writeOrders(orders) {
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  const temporary = `${ORDERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(orders, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, ORDERS_FILE);
}

function getOrder(orderId) {
  return readOrders().find((order) => order.id === orderId) || null;
}

async function createCheckout({ user, publicBaseUrl }) {
  const config = getPaymentConfig();
  if (!config.enabled) throw new Error('La compra web todavía no está habilitada por el administrador.');
  if (user.plan === 'paid' && !user.trialExpired) throw new Error('Esta cuenta ya tiene una licencia web activa.');
  const existingPending = readOrders()
    .filter((order) => order.userId === user.id && order.status === 'pending' && order.checkoutUrl)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (existingPending) {
    return { orderId: existingPending.id, checkoutUrl: existingPending.checkoutUrl, status: 'pending', reused: true };
  }
  const baseUrl = new URL(publicBaseUrl);
  if (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:') {
    throw new Error('El checkout requiere una URL HTTPS pública.');
  }
  if (process.env.NODE_ENV === 'production' && baseUrl.origin !== new URL(process.env.PILAR_PUBLIC_URL).origin) {
    throw new Error('La URL pública del checkout no coincide con la URL configurada por el administrador.');
  }

  const order = {
    id: crypto.randomUUID(),
    userId: user.id,
    email: user.email,
    amount: config.price,
    currency: 'ARS',
    status: 'creating',
    createdAt: new Date().toISOString(),
    paymentId: null,
    preferenceId: null,
  };
  const orders = readOrders();
  orders.push(order);
  writeOrders(orders);

  try {
    const response = await fetch(`${MERCADO_PAGO_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': order.id,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        items: [{
          id: 'pilar-web-lifetime',
          title: 'PILAR del estudiante - Licencia web',
          description: 'Licencia de uso de PILAR del estudiante para una cuenta.',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: config.price,
        }],
        payer: { email: user.email },
        external_reference: order.id,
        notification_url: `${baseUrl.origin}/api/payments/webhook`,
        back_urls: {
          success: `${baseUrl.origin}/?payment=${order.id}`,
          pending: `${baseUrl.origin}/?payment=${order.id}`,
          failure: `${baseUrl.origin}/?payment=${order.id}`,
        },
        auto_return: 'approved',
        statement_descriptor: 'PILAR ESTUDIANTE',
      }),
    });
    const result = await response.json().catch(() => ({}));
    const checkoutUrl = config.accessToken.startsWith('TEST-')
      ? result.sandbox_init_point || result.init_point
      : result.init_point;
    if (!response.ok || !result.id || !checkoutUrl) {
      throw new Error(`Mercado Pago no creó el checkout (HTTP ${response.status}).`);
    }
    const checkoutDestination = new URL(checkoutUrl);
    if (checkoutDestination.protocol !== 'https:' || !/\.mercadopago\.com(?:\.ar)?$/.test(checkoutDestination.hostname)) {
      throw new Error('Mercado Pago devolvió un destino de checkout no permitido.');
    }

    const storedOrders = readOrders();
    const storedOrder = storedOrders.find((item) => item.id === order.id);
    if (!storedOrder) throw new Error('No se encontró la compra después de crear el checkout.');
    storedOrder.preferenceId = String(result.id);
    storedOrder.checkoutUrl = checkoutDestination.href;
    if (storedOrder.status === 'creating') storedOrder.status = 'pending';
    writeOrders(storedOrders);
    return { orderId: order.id, checkoutUrl: checkoutDestination.href, status: 'pending' };
  } catch (error) {
    const storedOrders = readOrders();
    const storedOrder = storedOrders.find((item) => item.id === order.id);
    if (storedOrder && storedOrder.status === 'creating') {
      storedOrder.status = 'creation_failed';
      writeOrders(storedOrders);
    }
    throw error;
  }
}

function verifyWebhookSignature({ signatureHeader, requestId, paymentId, secret }) {
  if (!signatureHeader || !requestId || !paymentId || !secret) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  if (!parts.ts || !/^[a-f0-9]{64}$/i.test(parts.v1 || '')) return false;
  const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function applyApprovedPayment({ paymentId, payment }) {
  const orders = readOrders();
  const order = orders.find((item) => item.id === payment.external_reference);
  if (!order) return { applied: false, reason: 'unknown_order' };
  if (['refunded', 'charged_back'].includes(payment.status)) {
    order.paymentId = String(paymentId);
    order.status = payment.status;
    order.reversedAt = new Date().toISOString();
    revokePaidLicense(order.userId, paymentId, payment.status);
    writeOrders(orders);
    return { applied: true, reversed: true, orderId: order.id, status: payment.status };
  }
  if (String(order.paymentId || '') === String(paymentId) && order.status === 'approved') {
    return { applied: true, duplicate: true, orderId: order.id };
  }
  if (order.status === 'approved') return { applied: false, reason: 'already_paid' };
  const amount = Number(payment.transaction_amount);
  if (payment.status !== 'approved'
    || amount !== order.amount
    || payment.currency_id !== order.currency
    || String(payment.external_reference) !== order.id) {
    order.status = payment.status === 'approved' ? 'review_required' : 'pending';
    order.paymentId = String(paymentId);
    writeOrders(orders);
    return { applied: false, reason: 'payment_mismatch' };
  }

  grantPaidLicense(order.userId, {
    paymentProvider: 'mercadopago',
    paymentId: String(paymentId),
    orderId: order.id,
  });
  order.paymentId = String(paymentId);
  order.status = 'approved';
  order.approvedAt = new Date().toISOString();
  writeOrders(orders);
  return { applied: true, orderId: order.id };
}

async function processPaymentNotification(paymentId) {
  const config = getPaymentConfig();
  if (!config.enabled) throw new Error('Los pagos no están configurados.');
  if (!/^\d{1,32}$/.test(String(paymentId || ''))) throw new Error('Identificador de pago no válido.');
  const response = await fetch(`${MERCADO_PAGO_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payment = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`No se pudo consultar el pago (HTTP ${response.status}).`);
  return applyApprovedPayment({ paymentId, payment });
}

module.exports = {
  getPaymentConfig,
  createCheckout,
  verifyWebhookSignature,
  processPaymentNotification,
  applyApprovedPayment,
  getOrder,
};
