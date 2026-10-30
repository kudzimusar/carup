/**
 * PAY-01C: sandbox-only customer demo report. No second money ledger.
 * Existing payment_transactions and PAY-01A Stripe verification remain authoritative.
 */
import { supabase } from '../../db/supabase.js';
import { Pay01aError, requirePay01aSandbox, PAY01A_ACCOUNT } from './pay01aContract.js';
import { createPay01aCheckout, reconcilePay01aPayment, refundPay01aPayment } from './pay01aService.js';

export const PAY01C_PRODUCT = Object.freeze({
  code: 'vehicle_history_demo',
  name: 'CarUp Vehicle History Report — Demo Edition',
  amount: 100,
  currency: 'JPY',
  merchant: 'CarUp Japan sandbox',
  testOnly: true,
  synthetic: true,
});

export function requirePay01cDemo(env = process.env) {
  requirePay01aSandbox(env);
  if (env.CARUP_PAY01C_ENABLED !== 'true') throw new Pay01aError('PAY01C_DEMO_DISABLED', 404);
  return PAY01C_PRODUCT;
}

export function syntheticDemoReport() {
  return Object.freeze({
    title: 'CarUp Vehicle History Report — Demo Edition',
    classification: 'SYNTHETIC SAMPLE — TEST ONLY — NOT A REAL VEHICLE HISTORY',
    vehicleIdentifier: 'DEMO-VEHICLE-NOT-A-VIN',
    summary: 'All vehicle identifiers, events, mileage, inspection and ownership data in this sample are fictional.',
    make: 'Sample Motors (fictional)', model: 'Prototype Demo (fictional)',
    manufactureYear: 2020,
    history: [
      { date: '2021-01-01', event: 'Illustrative initial registration', odometerKm: 300 },
      { date: '2022-06-15', event: 'Illustrative service visit', odometerKm: 12000 },
      { date: '2024-02-20', event: 'Illustrative inspection', odometerKm: 24000 },
    ],
    disclaimer: 'No actual vehicle was queried. This demonstration is not legal, insurance, title, accident, or condition evidence.',
  });
}

function requireBuyer(buyerId) {
  if (typeof buyerId !== 'string' || !buyerId) throw new Pay01aError('PAY01C_SESSION_REQUIRED', 401);
}

function checkOrder(row, buyerId = null) {
  if (!row || row.product_code !== PAY01C_PRODUCT.code ||
      (buyerId && row.buyer_id !== buyerId)) throw new Pay01aError('PAY01C_ORDER_NOT_FOUND', 404);
  return row;
}

async function getOrderRow(db, orderId, buyerId = null) {
  if (!/^[0-9a-f-]{36}$/.test(String(orderId))) throw new Pay01aError('PAY01C_ORDER_NOT_FOUND', 404);
  let query = db.from('pay01c_demo_orders').select('*').eq('id', orderId);
  if (buyerId) query = query.eq('buyer_id', buyerId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Pay01aError('PAY01C_ORDER_READ_UNAVAILABLE', 503);
  return checkOrder(data, buyerId);
}

async function moneyRow(db, order) {
  const { data, error } = await db.from('payment_transactions')
    .select('reference, gateway, amount, currency, status, pay01a_actor_id, pay01a_account_id, pay01a_checkout_id, pay01a_intent_id, pay01a_refund_id, created_at, updated_at')
    .eq('reference', order.payment_reference).maybeSingle();
  if (error) throw new Pay01aError('PAY01C_CANONICAL_READ_UNAVAILABLE', 503);
  if (!data || data.gateway !== 'stripe_carup_japan_sandbox' ||
      data.pay01a_actor_id !== order.buyer_id || data.pay01a_account_id !== PAY01A_ACCOUNT ||
      Number(data.amount) !== 100 || data.currency !== 'JPY') {
    throw new Pay01aError('PAY01C_CANONICAL_AUTHORITY_MISMATCH', 409);
  }
  return data;
}

function project(order, payment) {
  const access = payment.status === 'paid' && !!order.granted_at && !order.revoked_at;
  return {
    id: order.id, product: PAY01C_PRODUCT.name, testOnly: true,
    reference: payment.reference, amount: Number(payment.amount),
    currency: payment.currency, status: payment.status,
    createdAt: order.created_at, paymentUpdatedAt: payment.updated_at,
    checkoutId: payment.pay01a_checkout_id || null,
    paymentIntentId: payment.pay01a_intent_id || null,
    refundId: payment.pay01a_refund_id || null,
    reportAvailable: access,
    entitlement: order.revoked_at ? 'revoked' : access ? 'granted'
      : payment.status === 'refund_pending' ? 'suspended' : 'awaiting_verified_payment',
  };
}

async function sync(db, reference) {
  const { error } = await db.rpc('pay01c_sync_demo_entitlement', { p_reference: reference });
  if (error) throw new Pay01aError('PAY01C_FULFILLMENT_UNAVAILABLE', 503);
}

/** Backend creates order + canonical money row atomically before issuing Checkout. */
export async function createBuyerDemoCheckout({
  buyerId, requestKey, db = supabase, env = process.env, stripe = null,
} = {}) {
  requirePay01cDemo(env); requireBuyer(buyerId);
  if (typeof requestKey !== 'string' || !/^pay01c_[A-Za-z0-9_-]{16,89}$/.test(requestKey)) {
    throw new Pay01aError('PAY01C_REQUEST_KEY_REQUIRED', 400);
  }
  const checkout = await createPay01aCheckout({
    actorId: buyerId, requestKey, db, env, stripe, internalDemo: true,
  });
  if (!checkout.orderId) throw new Pay01aError('PAY01C_ORDER_CLAIM_UNAVAILABLE', 503);
  return { ...checkout, product: PAY01C_PRODUCT.name, testOnly: true };
}

export async function listBuyerDemoOrders({ buyerId, db = supabase, env = process.env } = {}) {
  requirePay01cDemo(env); requireBuyer(buyerId);
  const { data, error } = await db.from('pay01c_demo_orders')
    .select('*').eq('buyer_id', buyerId).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Pay01aError('PAY01C_ORDER_READ_UNAVAILABLE', 503);
  const orders = [];
  for (const row of (data || [])) {
    const order = checkOrder(row, buyerId);
    orders.push(project(order, await moneyRow(db, order)));
  }
  return { orders };
}

export async function readBuyerDemoOrder({
  buyerId, orderId, refresh = false, db = supabase, env = process.env, stripe = null,
} = {}) {
  requirePay01cDemo(env); requireBuyer(buyerId);
  const order = await getOrderRow(db, orderId, buyerId);
  // A browser redirect is NOT payment authority. This service performs fresh Stripe retrieval.
  if (refresh) {
    await reconcilePay01aPayment({ reference: order.payment_reference, actorId: buyerId, db, env, stripe });
    await sync(db, order.payment_reference);
  }
  const fresh = await getOrderRow(db, orderId, buyerId);
  return project(fresh, await moneyRow(db, fresh));
}

export async function readBuyerDemoReport({
  buyerId, orderId, db = supabase, env = process.env, stripe = null,
} = {}) {
  requirePay01cDemo(env); requireBuyer(buyerId);
  const initial = await getOrderRow(db, orderId, buyerId);
  // Report access fails closed if the provider cannot be reached, or a refund happened
  // while a webhook was delayed. A browser-visible "paid" row is never sufficient.
  await reconcilePay01aPayment({
    reference: initial.payment_reference, actorId: buyerId, db, env, stripe,
  });
  await sync(db, initial.payment_reference);
  const row = await getOrderRow(db, orderId, buyerId);
  const payment = await moneyRow(db, row);
  if (payment.status !== 'paid' || !row.granted_at || row.revoked_at) {
    throw new Pay01aError('PAY01C_REPORT_NOT_ENTITLED', 403);
  }
  return { order: project(row, payment), report: syntheticDemoReport() };
}

/** Explicit admin-only route calls this; buyers cannot request refunds. */
export async function refundAdminDemoOrder({
  orderId, db = supabase, env = process.env, stripe = null,
} = {}) {
  requirePay01cDemo(env);
  const order = await getOrderRow(db, orderId);
  await moneyRow(db, order); // Verify canonical account and original buyer before mutation.
  const refund = await refundPay01aPayment({
    reference: order.payment_reference, actorId: order.buyer_id, db, env, stripe,
  });
  await sync(db, order.payment_reference);
  const fresh = await getOrderRow(db, orderId);
  return { ...project(fresh, await moneyRow(db, fresh)), idempotentReplay: Boolean(refund.idempotentReplay) };
}

export async function readAdminDemoOrder({ orderId, db = supabase, env = process.env } = {}) {
  requirePay01cDemo(env);
  const order = await getOrderRow(db, orderId);
  return project(order, await moneyRow(db, order));
}
