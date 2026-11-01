/**
 * PAY-01A local-first provider integration. The existing payment_transactions row is the only
 * money-state record; Stripe webhook receipts are evidence/unique-event claims, not a second ledger.
 * No vehicle, SafeTrade session, order, ownership or seller settlement is touched here.
 */
import { supabase } from '../../db/supabase.js';
import {
  Pay01aError, PAY01A_ACCOUNT, PAY01A_AMOUNT_JPY, PAY01A_CURRENCY, PAY01A_CHECKOUT_LABEL,
  pay01aIdempotency, pay01aMetadata, requirePay01aSandbox, validatePay01aRequestKey,
  evaluatePay01aProviderSnapshot, isPay01aSandboxRefund, pay01aProviderId,
  pay01aIntegrationIdentifier,
} from './pay01aContract.js';

const COLUMNS = 'reference, gateway, amount, currency, status, pay01a_actor_id, pay01a_account_id, pay01a_checkout_id, pay01a_intent_id, pay01a_refund_id, created_at, updated_at';
const allowedEvents = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
  'payment_intent.succeeded', 'payment_intent.payment_failed',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
]);

function guardRow(row, actorId = null) {
  if (!row || !String(row.reference || '').startsWith('pay01a_')
    || row.gateway !== 'stripe_carup_japan_sandbox'
    || Number(row.amount) !== PAY01A_AMOUNT_JPY
    || String(row.currency).toUpperCase() !== 'JPY'
    || row.pay01a_account_id !== PAY01A_ACCOUNT
    || (actorId && row.pay01a_actor_id !== actorId)) {
    throw new Pay01aError('PAY01A_CANONICAL_RECORD_MISMATCH', 403);
  }
  return row;
}

function publicRecord(row) {
  return {
    reference: row.reference,
    amount: Number(row.amount),
    currency: String(row.currency).toUpperCase(),
    status: row.status,
    checkoutId: row.pay01a_checkout_id || null,
    paymentIntentId: row.pay01a_intent_id || null,
    refundId: row.pay01a_refund_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Pay01aError('PAY01A_CANONICAL_RPC_UNAVAILABLE', 503);
  return data;
}

async function getRow(db, reference, actorId = null) {
  const { data, error } = await db.from('payment_transactions')
    .select(COLUMNS).eq('reference', reference).maybeSingle();
  if (error) throw new Pay01aError('PAY01A_CANONICAL_READ_UNAVAILABLE', 503);
  return guardRow(data, actorId);
}

async function stripeForSandbox({ env, stripe = null, webhook = false } = {}) {
  requirePay01aSandbox(env, { webhook });
  let client = stripe;
  if (!client) {
    const { default: Stripe } = await import('stripe');
    client = new Stripe(env.CARUP_PAY01A_STRIPE_SECRET_KEY);
  }
  // This is a real account read, not a claim inferred from the sandbox-looking API key.
  let account;
  try { account = await client.accounts.retrieve(); }
  catch { throw new Pay01aError('PAY01A_ACCOUNT_VERIFICATION_UNAVAILABLE', 503); }
  if (account?.id !== PAY01A_ACCOUNT) throw new Pay01aError('PAY01A_STRIPE_ACCOUNT_REFUSED', 503);
  return client;
}

/** The only supported starting amount comes from the canonical DB claim RPC, never the request. */
export async function createPay01aCheckout({
  actorId, requestKey, db = supabase, env = process.env, stripe = null, internalDemo = false,
} = {}) {
  const config = requirePay01aSandbox(env);
  if (internalDemo && env.CARUP_PAY01C_ENABLED !== 'true') {
    throw new Pay01aError('PAY01C_DEMO_DISABLED', 404);
  }
  if (!actorId) throw new Pay01aError('PAY01A_AUTHENTICATION_REQUIRED', 403);
  validatePay01aRequestKey(requestKey);
  const api = await stripeForSandbox({ env, stripe });
  const claim = await rpc(db, internalDemo ? 'pay01c_claim_demo_checkout' : 'pay01a_claim_checkout', {
    p_actor_id: actorId, p_request_key: requestKey,
  });
  const row = guardRow(claim, actorId);
  const metadata = internalDemo
    ? { ...pay01aMetadata(row.reference), carup_demo_product: 'vehicle_history_demo' }
    : pay01aMetadata(row.reference);
  let checkout;
  try {
    checkout = await api.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: row.reference,
      metadata,
      payment_intent_data: { metadata },
      integration_identifier: pay01aIntegrationIdentifier(row.reference),
      line_items: [{ price_data: {
        currency: PAY01A_CURRENCY,
        unit_amount: PAY01A_AMOUNT_JPY,
        product_data: { name: internalDemo ? 'CarUp Vehicle History Report — Demo Edition (TEST ONLY)' : PAY01A_CHECKOUT_LABEL },
      }, quantity: 1 }],
      success_url: config.origin + (internalDemo ? '/demo/vehicle-history?carup_pay01c=returned' : '/admin/payments?carup_pay01a=returned') + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: config.origin + (internalDemo ? '/demo/vehicle-history?carup_pay01c=cancelled' : '/admin/payments?carup_pay01a=cancelled'),
      // Stripe owns expiry; a mutable timestamp would break idempotent request replay.
    }, { idempotencyKey: pay01aIdempotency(row.reference, 'checkout') });
  } catch { throw new Pay01aError('PAY01A_CHECKOUT_PROVIDER_UNAVAILABLE', 502); }
  if (!checkout?.id || !checkout.url || checkout.livemode !== false
    || checkout.currency !== PAY01A_CURRENCY || checkout.amount_total !== PAY01A_AMOUNT_JPY
    || checkout.client_reference_id !== row.reference
    || Object.entries(metadata).some(([key, value]) => checkout.metadata?.[key] !== value)) {
    throw new Pay01aError('PAY01A_CHECKOUT_PROVIDER_MISMATCH', 502);
  }
  const attached = guardRow(await rpc(db, 'pay01a_attach_checkout', {
    p_reference: row.reference, p_checkout_id: checkout.id,
  }), actorId);
  // Checkout must use the same canonical payment read model as history/reconciliation/refunds.
  return {
    ...publicRecord(attached), checkoutUrl: checkout.url,
    merchant: 'CarUp Japan', live: false, sandboxAccountId: PAY01A_ACCOUNT,
    ...(internalDemo ? { orderId: row.pay01c_order_id } : {}),
  };
}

/**
 * Admin-only read model for the integrated sandbox console. It is deliberately
 * a projection of canonical payment_transactions: no actor identity, raw
 * provider payload or credential-bearing field crosses the API boundary.
 */
export async function listPay01aPayments({ db = supabase, env = process.env } = {}) {
  requirePay01aSandbox(env);
  const { data, error } = await db.from('payment_transactions')
    .select(COLUMNS)
    .eq('gateway', 'stripe_carup_japan_sandbox')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw new Pay01aError('PAY01A_CANONICAL_READ_UNAVAILABLE', 503);
  return { payments: (data || []).map((row) => publicRecord(guardRow(row))) };
}

async function retrieveSnapshot(api, row) {
  if (!row.pay01a_checkout_id) throw new Pay01aError('PAY01A_CHECKOUT_NOT_LINKED');
  let checkout, intent, refunds = [];
  try {
    checkout = await api.checkout.sessions.retrieve(row.pay01a_checkout_id);
    if (checkout.payment_intent) {
      const id = pay01aProviderId(checkout.payment_intent);
      if (!id) throw new Pay01aError('PAY01A_PROVIDER_INTENT_MISSING');
      intent = await api.paymentIntents.retrieve(id);
      const listed = await api.refunds.list({ payment_intent: id, limit: 100 });
      if (listed.has_more) throw new Pay01aError('PAY01A_REFUND_EVIDENCE_INCOMPLETE');
      refunds = listed.data || [];
    }
  } catch (err) {
    if (err instanceof Pay01aError) throw err;
    throw new Pay01aError('PAY01A_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
  }
  if (checkout.id !== row.pay01a_checkout_id) throw new Pay01aError('PAY01A_CHECKOUT_REFERENCE_MISMATCH');
  const snapshot = evaluatePay01aProviderSnapshot({ checkout, intent, refunds, reference: row.reference });
  return { snapshot, refunds };
}

async function reconcileKnownRow({ row, db, api, eventId = null, eventType = null }) {
  const { snapshot, refunds } = await retrieveSnapshot(api, row);
  const applied = await rpc(db, 'pay01a_apply_provider_snapshot', {
    p_reference: row.reference,
    p_status: snapshot.status,
    p_intent_id: snapshot.intentId,
    p_refund_id: refunds.find((refund) => refund.status === 'succeeded')?.id || null,
    p_event_id: eventId,
    p_event_type: eventType,
  });
  guardRow(applied);
  // Never return a partial record: the UI must receive canonical financial and timestamp
  // fields even for a refund, an idempotent retry, or a provider-triggered reconciliation.
  return {
    ...publicRecord(applied),
    duplicateEvent: Boolean(applied.duplicate_event), live: false,
  };
}

export async function reconcilePay01aPayment({
  reference, actorId, db = supabase, env = process.env, stripe = null,
} = {}) {
  requirePay01aSandbox(env);
  if (!actorId) throw new Pay01aError('PAY01A_AUTHENTICATION_REQUIRED', 403);
  const row = await getRow(db, reference, actorId);
  const api = await stripeForSandbox({ env, stripe });
  return reconcileKnownRow({ row, db, api });
}

export async function refundPay01aPayment({
  reference, actorId, db = supabase, env = process.env, stripe = null,
} = {}) {
  requirePay01aSandbox(env);
  if (!actorId) throw new Pay01aError('PAY01A_AUTHENTICATION_REQUIRED', 403);
  const api = await stripeForSandbox({ env, stripe });
  const row = await getRow(db, reference, actorId);
  const preflight = await reconcileKnownRow({ row, db, api });
  if (preflight.status === 'refunded') return { ...preflight, idempotentReplay: true };
  const claimed = guardRow(await rpc(db, 'pay01a_begin_refund', {
    p_reference: reference, p_actor_id: actorId,
  }), actorId);
  if (!claimed.pay01a_intent_id) throw new Pay01aError('PAY01A_REFUND_INTENT_UNAVAILABLE');
  try {
    const refund = await api.refunds.create({
      payment_intent: claimed.pay01a_intent_id, metadata: pay01aMetadata(reference),
    }, { idempotencyKey: pay01aIdempotency(reference, 'refund') });
    if (!isPay01aSandboxRefund(refund) || pay01aProviderId(refund.payment_intent) !== claimed.pay01a_intent_id
      || refund.amount !== PAY01A_AMOUNT_JPY) {
      throw new Pay01aError('PAY01A_REFUND_PROVIDER_MISMATCH');
    }
  } catch (err) {
    if (err instanceof Pay01aError) throw err;
    throw new Pay01aError('PAY01A_REFUND_PROVIDER_UNAVAILABLE', 502);
  }
  return reconcileKnownRow({ row: claimed, db, api });
}

/** Verify exact raw bytes first. A valid provider event only triggers a fresh authoritative read. */
export async function processPay01aWebhook({
  rawBody, signature, db = supabase, env = process.env, stripe = null,
} = {}) {
  requirePay01aSandbox(env, { webhook: true });
  if (!Buffer.isBuffer(rawBody) || !signature) throw new Pay01aError('PAY01A_RAW_SIGNATURE_REQUIRED', 400);
  let api = stripe;
  if (!api) {
    const { default: Stripe } = await import('stripe');
    api = new Stripe(env.CARUP_PAY01A_STRIPE_SECRET_KEY);
  }
  let event;
  try {
    event = api.webhooks.constructEvent(rawBody, signature, env.CARUP_PAY01A_STRIPE_WEBHOOK_SECRET);
  } catch { throw new Pay01aError('PAY01A_SIGNATURE_INVALID', 400); }
  if (!event || event.livemode !== false || (event.account && event.account !== PAY01A_ACCOUNT)) {
    throw new Pay01aError('PAY01A_EVENT_ENVIRONMENT_MISMATCH', 400);
  }
  // Authenticated provider data may now trigger the sandbox account-identity network read.
  await stripeForSandbox({ env, stripe: api, webhook: true });
  if (!allowedEvents.has(event.type)) return { ignored: true, live: false };
  const reference = event.data?.object?.metadata?.carup_reference
    || event.data?.object?.client_reference_id || null;
  if (!reference || !/^pay01a_[0-9a-f-]{36}$/.test(reference)) {
    return { ignored: true, live: false };
  }
  const row = await getRow(db, reference);
  const result = await reconcileKnownRow({ row, db, api, eventId: event.id, eventType: event.type });
  if (env.CARUP_PAY01C_ENABLED === 'true') {
    // Fail closed on fulfillment failure so the same signed event can be retried.
    await rpc(db, 'pay01c_sync_demo_entitlement', { p_reference: reference });
  }
  if (env.CARUP_PAY02_ENABLED === 'true' || env.CARUP_PAY03A_ENABLED === 'true') {
    const syncData = await rpc(db, 'pay02_sync_quote_from_canonical_payment', { p_reference: reference });
    if (syncData && syncData.report_order_id && result.status === 'paid') {
      const { deliverVerifiedVehicleHistoryReport } = await import('./pay02Service.js');
      await deliverVerifiedVehicleHistoryReport({
        buyerId: row.pay01a_actor_id,
        vin: syncData.vin || undefined,
        orderId: syncData.report_order_id,
        quoteId: syncData.quote_id,
        db,
        env,
      });
    }
  }
  return { ...result, verified: true };
}
