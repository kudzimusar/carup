/**
 * CARUP-PAY-05-LR01 — paying a garage invoice through the garage's OWN Paynow merchant.
 *
 * Reuses the PAY-04 collection, reservation, allocation, receipt and discrepancy machinery; adds only what Paynow needs:
 *  - one Paynow request per collection, recorded (with its merchant trace) BEFORE anything is sent; a retry replays it;
 *  - a lost or unauthenticated reply is recovered by an authenticated trace — never by sending the payment again;
 *  - money state comes only from an authenticated Paynow message applied by pay05_apply_paynow_observation (signed status
 *    update, poll of the stored poll URL, trace, O'mari OTP reply); a signed status update is a trigger and is confirmed
 *    by a fresh poll before anything is applied; a browser return is never proof of payment;
 *  - Paynow cannot cancel a request: a stop is recorded and the room stays held until Paynow reports a terminal status
 *    or an operator releases it after a fresh authenticated unpaid read;
 *  - Paynow has no merchant refund API: refunds happen in the garage's Paynow dashboard and are seen here when Paynow
 *    reports them.
 */
import { supabase as defaultDb } from '../../db/supabase.js';
import { pay04Money } from './pay04Contract.js';
import {
  Pay05Error, PAY05_GATEWAY, PAY05_LABELS, PAY05_PHONE_METHODS, isPay05Enabled, pay05Failure, requirePay05Enabled,
} from './pay05Contract.js';
import { eventIdFor, messageHashFor, newMerchantTrace, normalizeZimbabweMobile } from './pay05PaynowProtocol.js';
import { adapterForIntegrationRow, paynowAvailability } from './pay05MerchantService.js';
import {
  collectionOutcome, forCustomer, invoiceMoney, loadCollection, moneyView, notifyCollectionOutcome, returnOrigin,
} from './pay04GaragePaymentService.js';

const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);
const list = (data) => (Array.isArray(data) ? data : data ? [data] : []);
const TERMINAL = new Set(['paid', 'cancelled', 'failed', 'refunded']);

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw pay05Failure(error);
  return data;
}

async function read(promise, code = 'PAY05_READ_UNAVAILABLE') {
  const { data, error } = await promise;
  if (error) throw new Pay05Error(code, 503);
  return data;
}

export const PROVIDER_STATUS_LABELS = Object.freeze({
  created: 'Waiting for you to pay on Paynow',
  sent: 'Waiting for you to approve the payment on your phone',
  awaiting_delivery: 'Paid to Paynow — held by Paynow until it is released to the garage (not yet counted)',
  delivered: 'Paid to Paynow — Paynow releases it to the garage after its 24-hour window (not yet counted)',
  paid: 'Paid — confirmed by Paynow',
  cancelled: 'Cancelled at Paynow — nothing was charged',
  failed: 'Not completed — Paynow reports the payment was cancelled or failed; nothing was charged',
  disputed: 'Disputed with Paynow — the money is held while the dispute is resolved (not counted)',
  refunded: 'Refunded to the customer by the garage through Paynow',
  unrecognized: 'Paynow reported a status CarUp does not recognise — under review (not counted)',
});

export async function transactionOf(db, collectionId) {
  return one(await read(db.from('pay05_paynow_transactions').select('*').eq('collection_id', collectionId).limit(1)));
}

async function integrationRow(db, id) {
  const row = one(await read(db.from('pay05_merchant_integrations').select('*').eq('id', id).limit(1)));
  if (!row) throw new Pay05Error('PAY05_INTEGRATION_UNAVAILABLE', 503);
  return row;
}

async function merchantAccount(db, id) {
  const row = one(await read(db.from('pay04_garage_merchant_accounts').select('*').eq('id', id).limit(1)));
  if (!row) throw new Pay05Error('PAY05_MERCHANT_NOT_FOUND', 404);
  return row;
}

/** The verified integration for this merchant and currency, in a mode the runtime permits right now (or null). */
export async function verifiedIntegration(db, merchantAccountId, currency) {
  const row = one(await read(db.from('pay05_merchant_integrations').select('*').eq('merchant_account_id', merchantAccountId)
    .eq('currency', currency).eq('status', 'verified').order('verified_at', { ascending: false }).limit(1)));
  if (!row) return null;
  const guard = await paynowAvailability(db);
  return (row.mode === 'simulator' ? guard.simulator_enabled : guard.real_enabled) ? row : null;
}

async function adapterFor(db, env, transport, collection, tx = null) {
  const record = tx ?? await transactionOf(db, collection.id);
  const row = record ? await integrationRow(db, record.integration_row_id)
    : await verifiedIntegration(db, collection.merchant_account_id, collection.currency);
  if (!row) throw new Pay05Error('PAY05_INTEGRATION_UNAVAILABLE', 503);
  return adapterForIntegrationRow(row, await merchantAccount(db, collection.merchant_account_id), { env, transport });
}

const maskPhone = (phone) => `${phone.slice(0, 3)}*****${phone.slice(-2)}`;
const kindFor = (code) => ({
  PAY05_PROVIDER_UNREACHABLE: 'provider_unreachable', PAY05_PROVIDER_HTTP_ERROR: 'provider_unreachable',
  PAY05_PROVIDER_RESPONSE_UNAUTHENTICATED: 'provider_unauthenticated', PAY05_PROVIDER_URL_REFUSED: 'provider_url_refused',
  PAY05_PROVIDER_MESSAGE_MALFORMED: 'provider_unexpected', PAY05_PROVIDER_RESPONSE_UNEXPECTED: 'provider_unexpected',
}[code] || 'provider_unexpected');

async function recordProviderError(db, kind, collection, detail = {}) {
  // Best effort: an operator must see it, but a failed record never changes the money outcome.
  try {
    await db.rpc('pay05_record_provider_error', { p_kind: kind, p_tenant_id: collection?.tenant_id ?? null,
      p_collection_id: collection?.id ?? null, p_merchant_account_id: collection?.merchant_account_id ?? null, p_detail: detail });
  } catch { /* the error is still returned to the caller */ }
}

function publicResultUrl(env, collectionId) {
  const origin = String(env.CARUP_PAY05_RESULT_ORIGIN || '').replace(/\/$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new Pay05Error('PAY05_RESULT_ORIGIN_INVALID', 503);
  return `${origin}/api/pay05/paynow/webhook/${collectionId}`;
}

/** Apply one authenticated Paynow message to a collection through the governed writer. */
async function applyTruth(db, collection, truth, { via, eventId = null, messageHash = null }) {
  try {
    return await rpc(db, 'pay05_apply_paynow_observation', {
      p_collection_id: collection.id, p_via: via, p_event_id: eventId, p_provider_status: truth.providerStatus,
      p_raw_status: truth.rawStatus, p_amount_minor: truth.amountMinor, p_reference: truth.reference,
      p_paynow_reference: truth.paynowReference, p_payment_id: truth.paymentId, p_message_hash: messageHash,
    });
  } catch (error) {
    if (error.code === 'PAY05_PROVIDER_BINDING_MISMATCH') {
      await recordProviderError(db, 'callback_binding_mismatch', collection, { via, observed_reference_matches: truth.reference === collection.payment_reference });
    }
    throw error;
  }
}

// ───────────────────────────── views ─────────────────────────────

/** What a person may read about a Paynow request. Poll / OTP URLs, traces and integrations never leave the server. */
export function paynowView(tx, { customer = false } = {}) {
  if (!tx) return null;
  const status = tx.provider_status ?? null;
  return {
    method: tx.method,
    initiation: tx.initiation_state,
    provider_status: status,
    provider_status_label: status ? PROVIDER_STATUS_LABELS[status] : (tx.initiation_state === 'attached' ? PROVIDER_STATUS_LABELS.created
      : tx.initiation_state === 'refused' ? 'Paynow refused the payment request — nothing was charged'
        : 'CarUp is confirming with Paynow whether the payment request was received (not counted)'),
    checkout_url: customer && tx.method === 'web' && tx.initiation_state === 'attached' && (!status || status === 'created') ? tx.browser_url : null,
    instructions: tx.instructions ?? null,
    authorization_code: customer && tx.method === 'innbucks' && !TERMINAL.has(status) ? tx.authorization_code : null,
    authorization_expires: tx.method === 'innbucks' ? tx.authorization_expires : null,
    otp_reference: tx.method === 'omari' ? tx.otp_reference : null,
    needs_otp: tx.method === 'omari' && tx.initiation_state === 'attached' && (!status || status === 'sent'),
    phone: tx.phone_masked ?? null,
    hold_released: Boolean(tx.hold_released_at),
    paynow_reference: customer ? null : tx.paynow_reference ?? null,
    provider_error: customer ? null : tx.provider_error ?? null,
  };
}

/** Paynow detail for the collections PAY-04's loadProviderParts lists. */
export async function paynowDetails(db, collectionIds, { customer = false } = {}) {
  if (!collectionIds.length) return new Map();
  const rows = await read(db.from('pay05_paynow_transactions').select('*').in('collection_id', collectionIds));
  const modes = new Map();
  const integrationIds = [...new Set(list(rows).map((r) => r.integration_row_id))];
  if (integrationIds.length) {
    for (const i of list(await read(db.from('pay05_merchant_integrations').select('id, mode').in('id', integrationIds)))) modes.set(i.id, i.mode);
  }
  return new Map(list(rows).map((r) => [r.collection_id, { ...paynowView(r, { customer }), simulated: modes.get(r.integration_row_id) === 'simulator' }]));
}

// ───────────────────────────── the customer ─────────────────────────────

/** What the customer may pay with, for an invoice of a garage whose Paynow merchant is verified. */
export async function paynowOnlineOption(db, env, invoice, money, account) {
  if (!isPay05Enabled(env)) return { available: false, reason: 'not_offered' };
  const integration = await verifiedIntegration(db, account.id, invoice.currency);
  if (!integration) return { available: false, reason: 'currency_not_supported' };
  const permitted = await rpc(db, 'pay04_gateway_permitted', { p_gateway: PAY05_GATEWAY });
  if (permitted !== true) return { available: false, reason: 'provider_not_enabled' };
  if (Number(money.uncommitted_balance) <= 0) {
    return { available: false, reason: Number(money.provider_reserved) > 0 ? 'payment_in_progress' : 'nothing_due' };
  }
  return {
    available: true, gateway: PAY05_GATEWAY, provider: 'paynow', simulated: integration.mode === 'simulator',
    merchant_display_name: account.display_name, max_amount: money.uncommitted_balance, currency: invoice.currency,
    methods: integration.methods, simulation_notice: integration.mode === 'simulator' ? PAY05_LABELS.simulated : null,
    notices: { no_redirect_proof: PAY05_LABELS.noRedirectProof, cannot_cancel: PAY05_LABELS.cannotCancel, channel: PAY05_LABELS.paynowChannel },
  };
}

async function checkoutResponse(db, collection, { replayed, money = null }) {
  const tx = await transactionOf(db, collection.id);
  const integration = tx ? await integrationRow(db, tx.integration_row_id) : null;
  return {
    collection_id: collection.id, gateway: PAY05_GATEWAY, replayed: Boolean(replayed),
    simulated: integration?.mode === 'simulator', amount: pay04Money(collection.amount, collection.currency),
    currency: collection.currency, expires_at: collection.expires_at,
    checkout_url: paynowView(tx, { customer: true })?.checkout_url ?? null,
    paynow: paynowView(tx, { customer: true }),
    money: money ?? await invoiceMoney(db, collection.invoice_id),
    notice: PAY05_LABELS.waiting,
    cannot_cancel: PAY05_LABELS.cannotCancel,
  };
}

/** The customer's Paynow inputs for one currency's integration: method enabled, phone, the payer's e-mail for express. */
async function validateStartInput({ db, integration, currency, body, actorId }) {
  const method = String(body.method ?? 'web');
  if (!integration.methods.includes(method) || (method === 'innbucks' && currency !== 'USD')) {
    throw new Pay05Error('PAY05_METHOD_NOT_AVAILABLE', 422);
  }
  const phone = PAY05_PHONE_METHODS.includes(method) ? normalizeZimbabweMobile(body.phone) : null;
  let authEmail = null;
  if (method !== 'web') {
    authEmail = one(await read(db.from('users').select('email').eq('id', actorId).limit(1)))?.email ?? null;
    if (!authEmail) throw new Pay05Error('PAY05_AUTH_EMAIL_REQUIRED', 422);
  }
  return { method, phone, authEmail };
}

/**
 * Called by PAY-04's startGarageInvoicePayment BEFORE pay04_begin_garage_collection: when the garage's live merchant is
 * its Paynow merchant, a mistyped phone or an unavailable method is refused before any room is reserved.
 */
export async function prevalidatePaynowStart({ db = defaultDb, env = process.env, invoice, body = {}, actorId }) {
  const account = one(await read(db.from('pay04_garage_merchant_accounts').select('id, gateway, status').eq('tenant_id', invoice.tenant_id)
    .in('status', ['simulated', 'verified']).order('registered_at', { ascending: false }).limit(1)));
  if (!account || account.gateway !== PAY05_GATEWAY) return null;
  requirePay05Enabled(env);
  const integration = await verifiedIntegration(db, account.id, invoice.currency);
  if (!integration) throw new Pay05Error('PAY05_INTEGRATION_UNAVAILABLE', 503);
  return validateStartInput({ db, integration, currency: invoice.currency, body, actorId });
}

/**
 * Called by PAY-04's startGarageInvoicePayment once pay04_begin_garage_collection chose the garage's Paynow merchant.
 * Every validation happens before the durable intent is written, and the intent before anything is sent.
 */
export async function startPaynowCheckout({ db = defaultDb, env = process.env, transport = null, actor = {}, invoice, collection, begun, body = {} }) {
  requirePay05Enabled(env);
  if (await transactionOf(db, collection.id)) return checkoutResponse(db, collection, { replayed: true });
  let input;
  let integration;
  try {
    integration = await verifiedIntegration(db, collection.merchant_account_id, collection.currency);
    if (!integration) throw new Pay05Error('PAY05_INTEGRATION_UNAVAILABLE', 503);
    input = await validateStartInput({ db, integration, currency: collection.currency, body, actorId: actor.id });
  } catch (error) {
    // nothing was sent and nothing will be: close the just-begun collection so it holds no room
    await rpc(db, 'pay04_cancel_garage_collection', { p_collection_id: collection.id, p_actor_user_id: actor.id,
      p_reason: `Payment request not sent: ${String(error?.code || 'invalid input')}` }).catch(() => null);
    throw error;
  }
  const { method, phone, authEmail } = input;
  const account = await merchantAccount(db, collection.merchant_account_id);
  const adapter = adapterForIntegrationRow(integration, account, { env, transport });
  const back = `${returnOrigin(env)}/dashboard/service-requests?invoice=${invoice.id}&collection=${collection.id}`;
  const resultUrl = publicResultUrl(env, collection.id);
  const trace = newMerchantTrace();
  const sending = await rpc(db, 'pay05_record_paynow_sending', { p_collection_id: collection.id, p_merchant_trace: trace,
    p_method: method, p_phone_masked: phone ? maskPhone(phone) : null });
  if (sending?.replayed) return checkoutResponse(db, collection, { replayed: true });
  try {
    const checkout = await adapter.createCheckout({
      reference: collection.payment_reference, amountMinor: Number(collection.amount_minor), currency: collection.currency, method,
      phone, authEmail, returnUrl: `${back}&pay05=returned`, resultUrl, merchantTrace: trace,
      additionalInfo: `Invoice ${invoice.invoice_number} ${account.display_name}`,
    });
    await rpc(db, 'pay05_attach_paynow_collection', {
      p_collection_id: collection.id, p_merchant_trace: trace, p_poll_url: checkout.pollUrl, p_payment_id: checkout.paymentId,
      p_reply: { browser_url: checkout.url, remote_otp_url: checkout.express?.remoteOtpUrl ?? null,
        instructions: checkout.express?.instructions ?? null, authorization_code: checkout.express?.authorizationCode ?? null,
        authorization_expires: checkout.express?.authorizationExpires ?? null, otp_reference: checkout.express?.otpReference ?? null,
        paynow_reference: checkout.paynowReference ?? null },
    });
  } catch (error) {
    if (error?.details?.outcome === 'refused') {
      // Paynow said no: nothing exists at Paynow, so the collection closes at once and its room is free again
      await recordProviderError(db, 'provider_refused', collection, { code: error.code, provider_error: error.details.provider_error ?? null });
      await rpc(db, 'pay05_mark_paynow_initiation', { p_collection_id: collection.id, p_state: 'refused',
        p_error: String(error.details.provider_error || error.code).slice(0, 160) });
      await rpc(db, 'pay04_cancel_garage_collection', { p_collection_id: collection.id, p_actor_user_id: actor.id,
        p_reason: `Paynow refused the request: ${String(error.details.provider_error || 'no reason given').slice(0, 200)}` });
      throw new Pay05Error('PAY05_PROVIDER_REFUSED', 502, { provider_error: error.details.provider_error ?? null });
    }
    // Anything else after the intent was recorded: a request may exist at Paynow. Hold the room; recover by trace.
    await recordProviderError(db, kindFor(error?.code), collection, { code: error?.code ?? 'unknown', http_status: error?.details?.http_status ?? null });
    await rpc(db, 'pay05_mark_paynow_initiation', { p_collection_id: collection.id, p_state: 'unknown', p_error: String(error?.code || 'unknown') });
    await recoverByTrace({ db, env, transport, collection }).catch(() => null);
  }
  return checkoutResponse(db, collection, { replayed: false });
}

/** A request whose reply was lost: ask Paynow by merchant trace. Found -> bind it; absent -> count authenticated absence. */
export async function recoverByTrace({ db = defaultDb, env = process.env, transport = null, collection }) {
  const tx = await transactionOf(db, collection.id);
  if (!tx || !['sending', 'unknown'].includes(tx.initiation_state)) return { state: tx?.initiation_state ?? null };
  const adapter = await adapterFor(db, env, transport, collection, tx);
  let traced;
  try {
    traced = await adapter.trace({ merchantTrace: tx.merchant_trace });
  } catch (error) {
    await recordProviderError(db, 'trace_failed', collection, { code: error?.code ?? 'unknown' });
    return { state: tx.initiation_state, traced: 'failed' };
  }
  if (!traced.found) {
    const r = await rpc(db, 'pay05_record_paynow_trace_absent', { p_collection_id: collection.id });
    return { state: r?.initiation_state ?? tx.initiation_state, traced: 'absent' };
  }
  await rpc(db, 'pay05_attach_paynow_collection', { p_collection_id: collection.id, p_merchant_trace: tx.merchant_trace,
    p_poll_url: traced.truth.pollUrl, p_payment_id: traced.truth.paymentId,
    p_reply: { paynow_reference: traced.truth.paynowReference, recovered_by_trace: true } });
  const result = await applyTruth(db, await loadCollection(db, collection.id), traced.truth, { via: 'trace' });
  return { state: 'attached', traced: 'found', result };
}

/** A fresh, authenticated read of one Paynow collection, applied through the governed writer. */
export async function checkPaynowCollection({ db = defaultDb, env = process.env, transport = null, collection, deps = {} }) {
  const tx = await transactionOf(db, collection.id);
  let result = null;
  if (tx && ['sending', 'unknown'].includes(tx.initiation_state)) {
    result = (await recoverByTrace({ db, env, transport, collection }))?.result ?? null;
  } else if (tx && tx.initiation_state === 'attached') {
    const adapter = await adapterFor(db, env, transport, collection, tx);
    let truth;
    try {
      truth = await adapter.getPaymentTruth({ pollUrl: tx.poll_url });
    } catch (error) {
      await recordProviderError(db, 'poll_failed', collection, { code: error?.code ?? 'unknown' });
      throw new Pay05Error('PAY05_PROVIDER_READ_FAILED', 502);
    }
    result = await applyTruth(db, collection, truth, { via: 'poll' });
  }
  const notification = result ? await notifyCollectionOutcome(db, collection, result, deps) : { attempted: 0, emitted: 0, failures: [] };
  const out = await collectionOutcome(db, collection, result, notification);
  return { ...out, paynow: paynowView(await transactionOf(db, collection.id)) };
}

export async function verifyCustomerPaynow({ db = defaultDb, env = process.env, transport = null, collection, deps = {} }) {
  const out = await checkPaynowCollection({ db, env, transport, collection, deps });
  return { ...forCustomer(out), paynow: paynowView(await transactionOf(db, collection.id), { customer: true }) };
}

/** O'mari: the customer's one-time password, sent to Paynow's remote OTP URL (allowlisted), then applied. */
export async function submitPaynowOtp({ db = defaultDb, env = process.env, transport = null, actor = {}, collectionId, body = {}, deps = {} }) {
  requirePay05Enabled(env);
  const collection = await loadCollection(db, collectionId);
  if (collection.payer_user_id !== actor.id || collection.gateway !== PAY05_GATEWAY) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  const tx = await transactionOf(db, collection.id);
  if (!tx || tx.method !== 'omari' || tx.initiation_state !== 'attached' || !tx.remote_otp_url) throw new Pay05Error('PAY05_OTP_NOT_EXPECTED', 409);
  const adapter = await adapterFor(db, env, transport, collection, tx);
  let truth;
  try {
    truth = await adapter.submitOtp({ remoteOtpUrl: tx.remote_otp_url, otp: String(body.otp ?? '').trim() });
  } catch (error) {
    if (error?.code === 'PAY05_OTP_REJECTED') await recordProviderError(db, 'otp_rejected', collection, { provider_error: error.details?.provider_error ?? null });
    throw error;
  }
  const result = await applyTruth(db, collection, truth, { via: 'otp_reply' });
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  return { ...forCustomer(await collectionOutcome(db, collection, result, notification)), paynow: paynowView(await transactionOf(db, collection.id), { customer: true }) };
}

// ───────────────────────────── Paynow's status update (resulturl) ─────────────────────────────

/**
 * POST from Paynow to /api/pay05/paynow/webhook/:collectionId. Accepted only if its hash verifies with THIS
 * collection's own integration key and it names this collection's reference and poll URL. It is a trigger: the money
 * effect comes from a fresh poll. A resend (Paynow retries up to ten times) is the same event and is not re-polled.
 */
export async function processPaynowStatusUpdate({ db = defaultDb, env = process.env, transport = null, collectionId, rawBody, deps = {} }) {
  requirePay05Enabled(env);
  const id = String(collectionId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  const collection = one(await read(db.from('pay04_garage_collections').select('*').eq('id', id).limit(1)));
  if (!collection || collection.gateway !== PAY05_GATEWAY) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  let tx = await transactionOf(db, collection.id);
  if (!tx) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  const adapter = await adapterFor(db, env, transport, collection, tx);
  let update;
  try {
    update = adapter.verifyStatusUpdate(rawBody);
  } catch (error) {
    await recordProviderError(db, error?.code === 'PAY05_PROVIDER_MESSAGE_MALFORMED' ? 'callback_malformed' : 'callback_signature_invalid',
      collection, { code: error?.code ?? 'unknown' });
    throw error?.code === 'PAY05_PROVIDER_MESSAGE_MALFORMED' ? new Pay05Error('PAY05_CALLBACK_MALFORMED', 400) : new Pay05Error('PAY05_CALLBACK_SIGNATURE_INVALID', 401);
  }
  if (update.truth.reference !== collection.payment_reference || !update.truth.pollUrl
      || (tx.poll_url && update.truth.pollUrl !== tx.poll_url)) {
    await recordProviderError(db, 'callback_binding_mismatch', collection, { reference_matches: update.truth.reference === collection.payment_reference,
      poll_url_matches: Boolean(tx.poll_url) && update.truth.pollUrl === tx.poll_url });
    throw new Pay05Error('PAY05_PROVIDER_BINDING_MISMATCH', 409);
  }
  // A resend of the message CarUp applied last is a duplicate (no second poll). The same words after a DIFFERENT message
  // (Paid, Disputed, Paid) are a new event: Paynow's messages carry no sequence number.
  const messageHash = messageHashFor(update.pairs);
  if (tx.last_status_update_hash === messageHash) return { duplicate_event: true, applied: false };
  const eventId = eventIdFor(collection.id, update.pairs, tx.last_status_update_hash);
  const seen = one(await read(db.from('pay05_paynow_observations').select('id').eq('event_id', eventId).limit(1)));
  if (seen) return { event_id: eventId, duplicate_event: true, applied: false };
  if (tx.initiation_state !== 'attached') {
    // Paynow's own signed message carries the poll URL our lost reply would have: bind it now
    await rpc(db, 'pay05_attach_paynow_collection', { p_collection_id: collection.id, p_merchant_trace: tx.merchant_trace,
      p_poll_url: update.truth.pollUrl, p_payment_id: update.truth.paymentId,
      p_reply: { paynow_reference: update.truth.paynowReference, recovered_by_status_update: true } });
    tx = await transactionOf(db, collection.id);
  }
  let truth;
  try {
    truth = await adapter.getPaymentTruth({ pollUrl: tx.poll_url });
  } catch (error) {
    await recordProviderError(db, 'poll_failed', collection, { code: error?.code ?? 'unknown', trigger: 'status_update' });
    // an HTTP error makes Paynow resend the update: the poll is retried then
    throw new Pay05Error('PAY05_PROVIDER_READ_FAILED', 503);
  }
  const current = await loadCollection(db, collection.id);
  const result = await applyTruth(db, current, truth, { via: 'status_update', eventId, messageHash });
  const notification = await notifyCollectionOutcome(db, current, result, deps);
  return { event_id: eventId, collection_id: collection.id, applied: Boolean(result?.applied), duplicate_event: Boolean(result?.duplicate_event),
    provider_status: truth.providerStatus, payment_status: result?.payment_status ?? null, notification };
}

// ───────────────────────────── stops, closing, operators ─────────────────────────────

/** A stop: recorded (who, why); the room stays held — Paynow cannot cancel — then one fresh read. */
export async function cancelPaynowCollection({ db = defaultDb, env = process.env, transport = null, collection, actorUserId, reason }) {
  await rpc(db, 'pay04_cancel_garage_collection', { p_collection_id: collection.id, p_actor_user_id: actorUserId, p_reason: reason });
  let out;
  try {
    out = await checkPaynowCollection({ db, env, transport, collection: await loadCollection(db, collection.id) });
  } catch {
    out = await collectionOutcome(db, collection, null, { attempted: 0, emitted: 0, failures: [] });
  }
  return { ...out, paynow: paynowView(await transactionOf(db, collection.id)), notice: PAY05_LABELS.cannotCancel };
}

/** PAY-04's refreshClosingCollections, for one Paynow collection that is stopped or past its time. Fail closed. */
export async function refreshPaynowCollection({ db = defaultDb, env = process.env, transport = null, collection }) {
  const tx = await transactionOf(db, collection.id);
  const expired = Date.parse(collection.expires_at) <= Date.now();
  if (!tx) {
    if (expired) await rpc(db, 'pay04_close_expired_unattached_collection', { p_collection_id: collection.id });
    return;
  }
  if (['sending', 'unknown'].includes(tx.initiation_state)) await recoverByTrace({ db, env, transport, collection });
  const after = await transactionOf(db, collection.id);
  if (after.initiation_state === 'traced_absent' && expired) {
    await rpc(db, 'pay04_close_expired_unattached_collection', { p_collection_id: collection.id });
  } else if (after.initiation_state === 'attached' && tx.initiation_state === 'attached') {
    await checkPaynowCollection({ db, env, transport, collection });
  }
}

export async function releasePaynowHold({ db = defaultDb, env = process.env, transport = null, actor = {}, collectionId, body = {} }) {
  requirePay05Enabled(env);
  const collection = await loadCollection(db, collectionId);
  if (collection.gateway !== PAY05_GATEWAY) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  // a FRESH authenticated read first: the database releases only on an unpaid read from the last 15 minutes
  await checkPaynowCollection({ db, env, transport, collection });
  const released = await rpc(db, 'pay05_release_paynow_hold', { p_collection_id: collection.id, p_actor_id: actor.id,
    p_actor_role: actor.platformRole || null, p_reason: String(body.reason ?? '') });
  return { released, money: moneyView(released?.money ?? null) ?? await invoiceMoney(db, collection.invoice_id),
    paynow: paynowView(await transactionOf(db, collection.id)) };
}

export async function reconcilePaynowCollection({ db = defaultDb, env = process.env, transport = null, collection, deps = {} }) {
  return checkPaynowCollection({ db, env, transport, collection, deps });
}

