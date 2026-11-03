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
import { eventIdFor, isPaynowAuthEmail, messageHashFor, newMerchantTrace, normalizeZimbabweMobile, samePollUrl } from './pay05PaynowProtocol.js';
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
  // Paynow's word, never CarUp's confirmation: "counted" is said only by the collection's state (ICR-W3)
  paid: 'Paynow reports it paid',
  cancelled: 'Cancelled at Paynow — nothing was charged',
  failed: 'Not completed — Paynow reports the payment was cancelled or failed; nothing was charged',
  disputed: 'Disputed with Paynow — the money is held while the dispute is resolved (not counted)',
  refunded: 'Refunded to the customer by the garage through Paynow',
  unrecognized: 'Paynow reported a status CarUp does not recognise — under review (not counted)',
});

/**
 * A request Paynow accepted but has not reported on yet — or reports as Created, as real Express polling may — reads as
 * what the customer must do with it (physical rehearsal, HTTP case E1): the hosted-page words "pay on Paynow" are wrong for
 * a phone prompt, an InnBucks code or an O'mari one-time code. None of these words claim money.
 */
const WAITING_BY_METHOD = Object.freeze({
  web: PROVIDER_STATUS_LABELS.created,
  ecocash: PROVIDER_STATUS_LABELS.sent,
  onemoney: PROVIDER_STATUS_LABELS.sent,
  innbucks: 'Waiting for you to pay with the InnBucks code (not counted yet)',
  omari: 'Waiting for the one-time code sent to your phone (not counted yet)',
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
  // only a reviewed merchant+currency configuration binds a currency (ICR-P1): Paynow's API reports none
  if (!row || row.currency_evidence?.settlement_currency !== currency) return null;
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

/** Paynow's status updates reach CarUp over https: a plain-http resulturl is only ever the local simulator's (ICR-S1). */
export function publicResultUrl(env, collectionId, mode = 'simulator') {
  const origin = String(env.CARUP_PAY05_RESULT_ORIGIN || '').replace(/\/$/, '');
  const allowed = mode === 'simulator' ? /^https?:\/\/[^/\s]+$/ : /^https:\/\/[^/\s]+$/;
  if (!allowed.test(origin)) throw new Pay05Error('PAY05_RESULT_ORIGIN_INVALID', 503);
  return `${origin}/api/pay05/paynow/webhook/${collectionId}`;
}

/**
 * A DB read ticket, taken BEFORE a Paynow read is sent (independent review D1): reads run outside any lock, so the order
 * they arrive in is not the order Paynow answered them; the writer supersedes a read older than one it already evaluated.
 */
const beginRead = (db, collection) => rpc(db, 'pay05_begin_paynow_read', { p_collection_id: collection.id });

/** Apply one authenticated Paynow message to a collection through the governed writer. */
async function applyTruth(db, collection, truth, { via, eventId = null, messageHash = null, readTicket = null }) {
  try {
    return await rpc(db, 'pay05_apply_paynow_observation', {
      p_collection_id: collection.id, p_via: via, p_event_id: eventId, p_provider_status: truth.providerStatus,
      p_raw_status: truth.rawStatus, p_amount_minor: truth.amountMinor, p_reference: truth.reference,
      p_paynow_reference: truth.paynowReference, p_payment_id: truth.paymentId, p_message_hash: messageHash,
      p_read_ticket: readTicket,
    });
  } catch (error) {
    if (error.code === 'PAY05_PROVIDER_BINDING_MISMATCH') {
      await recordProviderError(db, 'callback_binding_mismatch', collection, { via, observed_reference_matches: truth.reference === collection.payment_reference });
    }
    throw error;
  }
}

// ───────────────────────────── views ─────────────────────────────

/**
 * What a person may read about a Paynow request. Poll / OTP URLs, traces and integrations never leave the server. A request
 * CarUp released or settled is not one to act on any more (ICR-W2): no link, code or form, and never "waiting for you".
 */
export function paynowView(tx, { customer = false } = {}) {
  if (!tx) return null;
  const status = tx.provider_status ?? null;
  const released = Boolean(tx.hold_released_at);
  const settled = Boolean(tx.settled_off_platform_at);
  const actionable = !released && !settled && tx.initiation_state === 'attached' && (!status || status === 'created' || status === 'sent');
  const hasOtpUrl = Boolean(tx.remote_otp_url);
  return {
    method: tx.method,
    initiation: tx.initiation_state,
    provider_status: status,
    provider_status_label: released || settled ? (settled ? STATE_SENTENCE.settled_outside : STATE_SENTENCE.released)
      : status && status !== 'created' ? PROVIDER_STATUS_LABELS[status]
      : (tx.initiation_state === 'attached' ? (WAITING_BY_METHOD[tx.method] ?? PROVIDER_STATUS_LABELS.created)
      : tx.initiation_state === 'refused' ? 'Paynow refused the payment request — nothing was charged'
        : tx.initiation_state === 'traced_absent' ? 'Paynow has no record of this request — it did not reach Paynow (not counted)'
          // CarUp does not know whether Paynow has it: never more than that (ICR-W14)
          : 'CarUp has not confirmed that Paynow received this request. It may still exist there (not counted)'),
    checkout_url: customer && tx.method === 'web' && actionable ? tx.browser_url : null,
    instructions: tx.instructions ?? null,
    authorization_code: customer && tx.method === 'innbucks' && !released && !settled && !TERMINAL.has(status) ? tx.authorization_code : null,
    authorization_expires: tx.method === 'innbucks' ? tx.authorization_expires : null,
    otp_reference: tx.method === 'omari' ? tx.otp_reference : null,
    // real express polling may report Created before Sent (independent review P8): the code is still expected. A request
    // recovered by trace has no address for the code (ICR-P4): the form would only be refused, so the words say so instead.
    needs_otp: tx.method === 'omari' && actionable && hasOtpUrl,
    otp_unavailable: tx.method === 'omari' && actionable && !hasOtpUrl,
    phone: tx.phone_masked ?? null,
    hold_released: released,
    settled_outside: settled,
    last_read_at: tx.provider_status_at ?? null,
    paynow_reference: customer ? null : tx.paynow_reference ?? null,
    provider_error: customer ? null : tx.provider_error ?? null,
  };
}

/** Paynow's own money words: it has reported money on this request, whatever CarUp did with it. */
const MONEY_WORDS = new Set(['awaiting_delivery', 'delivered', 'paid', 'disputed']);
const ESCROW_WORDS = new Set(['awaiting_delivery', 'delivered']);
/** Reviews that hold money back. An open "refund to confirm" does not: the money is already gone from the invoice. */
const HOLDING_REVIEW = (d) => !['unallocated_provider_money', 'provider_refund_unquantified'].includes(d.discrepancy_type);

/**
 * The state of a Paynow payment, for every surface (PAY-05-R1, ICR-W1). PAY-04's state words assume a provider that can
 * cancel and expire; Paynow can do neither, so nothing here is "nothing was paid" on CarUp's own say-so. Counted money is
 * what decides "confirmed": a canonical row still reading paid is not enough.
 */
export function paynowCollectionState(collection, payment, view, { now = Date.now(), openDiscrepancies = [], counted = 0 } = {}) {
  const status = payment?.status || 'unknown';
  const word = view?.provider_status ?? null;
  const unallocated = openDiscrepancies.some((d) => d.discrepancy_type === 'unallocated_provider_money');
  if (status === 'reconciliation_hold' || openDiscrepancies.some(HOLDING_REVIEW)) return 'under_review';
  if (status === 'refunded') return 'refunded';
  if (status === 'paid') {
    if (unallocated) return 'confirmed_unallocated';
    if (Number(counted) > 0) return 'confirmed';
    return view?.settled_outside ? 'settled_outside' : 'not_counted';
  }
  if (view?.settled_outside) return 'settled_outside';
  if (status === 'cancelled') {
    if (MONEY_WORDS.has(word)) return 'closed_not_counted';
    return collection.cancelled_at && collection.cancelled_by !== 'system:expiry' ? 'stopped' : 'cancelled';
  }
  if (status === 'pending') {
    if (view?.hold_released) return 'released';
    if (ESCROW_WORDS.has(word)) return 'at_paynow';
    if (collection.cancelled_at) return 'stopping';
    if (Date.parse(collection.expires_at) <= now) return 'expired';
    return 'awaiting_provider';
  }
  return status; // refund_pending, partially_refunded (Paynow reports neither)
}

/** The state in a short phrase (the badge): for the customer, the garage and operators alike. */
export const PAYNOW_STATE_LABELS = Object.freeze({
  awaiting_provider: 'Waiting for Paynow — not counted',
  at_paynow: 'Paid to Paynow and held by Paynow — not counted yet',
  stopping: 'Stopped waiting — the amount stays reserved while CarUp checks with Paynow (not counted)',
  expired: 'Past CarUp’s time — the amount stays reserved while CarUp checks with Paynow (not counted)',
  released: 'Released by CarUp — this request no longer holds the invoice (not counted)',
  settled_outside: 'Settled outside CarUp — not counted on this invoice',
  not_counted: 'No longer counted — Paynow does not report it paid',
  closed_not_counted: 'Closed — Paynow reported money after it closed; reviewed and not counted',
  stopped: 'Closed — Paynow reports it cancelled; no money was reported on it',
  cancelled: 'Closed — no money was reported on it',
  confirmed: 'Paid — counted on this invoice',
  confirmed_unallocated: 'Paid at Paynow — not counted on this invoice (under review)',
  under_review: 'Under review — not counted',
  refunded: 'Paynow reports it refunded — not counted',
  unknown: 'Unavailable',
});

/** The same state as a sentence to the person paying. */
const STATE_SENTENCE = Object.freeze({
  released: 'CarUp released this request after Paynow showed it unpaid. It no longer holds this invoice, and it is not counted.',
  settled_outside: 'This payment was settled outside CarUp. It is not counted on this invoice.',
  not_counted: 'Paynow no longer reports this payment as paid, so CarUp does not count it.',
  closed_not_counted: 'Paynow reported money on this request after it closed. CarUp reviewed it, and it is not counted on this invoice.',
  stopping: 'You stopped waiting, but Paynow cannot cancel a request. The amount stays reserved while CarUp checks with Paynow (not counted).',
  expired: 'CarUp’s time for this request has passed, but Paynow cannot cancel it. The amount stays reserved while CarUp checks with Paynow (not counted).',
  confirmed: 'Paid — counted on this invoice.',
  confirmed_unallocated: 'Paynow reports it paid, but it is not counted on this invoice. CarUp is reviewing it.',
  refunded: 'Paynow reports it refunded. It is not counted on this invoice.',
});

const REPORTED_WORDS = Object.freeze({
  created: 'Waiting for payment', sent: 'Waiting for approval on the phone', awaiting_delivery: 'Paid into Paynow and held by Paynow',
  delivered: 'Paid into Paynow; Paynow releases it after its 24-hour window', paid: 'Paid', cancelled: 'Cancelled', failed: 'Not completed',
  disputed: 'Disputed; Paynow holds the money', refunded: 'Refunded', unrecognized: 'A status CarUp does not recognise',
});
const INITIATION_WORDS = Object.freeze({
  attached: 'Waiting for payment', sending: 'Not confirmed: CarUp has not heard whether Paynow received this request',
  unknown: 'Not confirmed: CarUp has not heard whether Paynow received this request', refused: 'Refused by Paynow',
  traced_absent: 'Paynow has no record of this request',
});
const REVIEW_WORDS = Object.freeze({
  under_review: 'CarUp is reviewing this payment.',
  confirmed_unallocated: 'CarUp is reviewing the money that is not counted.',
  settled_outside: 'Reviewed: settled outside CarUp.',
  not_counted: 'Reviewed: it counts again only if Paynow reports it paid.',
  closed_not_counted: 'Reviewed: it does not count on this invoice.',
});
const NEXT_STEP = Object.freeze({
  customer: Object.freeze({
    awaiting_provider: 'Complete this request, or check its status. Do not start another payment for this amount.',
    expired: 'If you already paid, check its status. Do not start another payment for this amount while it is reserved.',
    stopping: 'If you already paid, check its status. Do not start another payment for this amount while it is reserved.',
    at_paynow: 'Do not pay again. Paynow releases this money to the garage, or CarUp reviews it.',
    under_review: 'Do not pay again until the review ends.',
    confirmed_unallocated: 'Do not pay again until the review ends.',
    released: 'Do not approve the old request on your phone. If you already did, check its status before paying again.',
    settled_outside: 'If you also paid through Paynow, check its status and tell the garage.',
    not_counted: 'Ask the garage before paying again: Paynow may have returned this money.',
    closed_not_counted: 'If Paynow took your money, ask the garage how it was settled.',
    refunded: 'Ask the garage if you still owe anything.',
  }),
  garage: Object.freeze({
    awaiting_provider: 'Nothing to do yet.',
    expired: 'Do not record this amount as paid unless the customer really paid you. CarUp keeps it reserved until Paynow answers or an operator releases it.',
    stopping: 'Do not record this amount as paid unless the customer really paid you. CarUp keeps it reserved until Paynow answers or an operator releases it.',
    at_paynow: 'Paynow holds this money. It counts when Paynow reports it paid.',
    under_review: 'A CarUp operator reviews it. It does not count meanwhile.',
    confirmed_unallocated: 'A CarUp operator reviews the money that is not counted.',
    released: 'The amount is free again. If Paynow later reports it paid, it counts only if room remains.',
    settled_outside: 'Record what you really received. If Paynow reports more money, a new review opens.',
    not_counted: 'Record what you really received. Paynow’s own Paid would count it again.',
    closed_not_counted: 'Record what you really received; refund any money Paynow still holds in your Paynow dashboard.',
    refunded: 'Refunds happen in your Paynow dashboard; this one is recorded.',
  }),
});

/**
 * The label a person reads follows the COLLECTION's state, and every Paynow row carries its truth in separate parts
 * (R1 directive §4): what Paynow reported, what CarUp counted, any review, what can be done next, and when Paynow was last
 * read. While CarUp is reviewing a payment Paynow's word is reported as Paynow's word, never as confirmation.
 */
export function withCollectionState(view, state, { counted = 0, currency = null, customer = false } = {}) {
  if (!view) return view;
  const said = view.provider_status ? STATUS_WORDS[view.provider_status] : null;
  const label = REVIEW_STATES.has(state) && state !== 'confirmed_unallocated'
    ? `Under review — not counted${said ? ` (Paynow reported: ${said})` : ''}`
    : STATE_SENTENCE[state] ?? view.provider_status_label;
  const isCounted = Number(counted) > 0;
  return {
    ...view,
    provider_status_label: label,
    facts: {
      provider: view.provider_status ? REPORTED_WORDS[view.provider_status] : INITIATION_WORDS[view.initiation] ?? 'Not confirmed',
      counted: isCounted,
      allocation: isCounted ? `Counted on this invoice${currency ? `: ${pay04Money(counted, currency)} ${currency}` : ''}` : 'Not counted on this invoice',
      review: REVIEW_WORDS[state] ?? null,
      next_step: (customer ? NEXT_STEP.customer : NEXT_STEP.garage)[state] ?? null,
      last_read_at: view.last_read_at ?? null,
    },
  };
}

const REVIEW_STATES = new Set(['under_review', 'confirmed_unallocated']);
const STATUS_WORDS = Object.freeze({
  created: 'not paid yet', sent: 'waiting for approval on the phone', awaiting_delivery: 'paid into Paynow escrow',
  delivered: 'paid into Paynow escrow', paid: 'paid', cancelled: 'cancelled', failed: 'failed', disputed: 'disputed',
  refunded: 'refunded', unrecognized: 'a status CarUp does not recognise',
});

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
  const earlier = await earlierPaynowRequests(db, invoice.id);
  if (earlier.some((e) => e.unresolved)) return { available: false, reason: 'earlier_request_unresolved' };
  return {
    available: true, gateway: PAY05_GATEWAY, provider: 'paynow', simulated: integration.mode === 'simulator',
    merchant_display_name: account.display_name, max_amount: money.uncommitted_balance, currency: invoice.currency,
    methods: integration.methods, simulation_notice: integration.mode === 'simulator' ? PAY05_LABELS.simulated : null,
    notices: { no_redirect_proof: PAY05_LABELS.noRedirectProof, cannot_cancel: PAY05_LABELS.cannotCancel, channel: PAY05_LABELS.paynowChannel,
      earlier_request: earlier.length ? PAY05_LABELS.earlierRequest : null },
  };
}

/**
 * Requests on this invoice that no longer hold room but that Paynow still has: released by an operator or settled outside
 * CarUp. Paynow cannot cancel them, so the customer could still pay one. One with money held at Paynow, or an open review,
 * leaves the payment unresolved: no new request may start while it stands (R1 directive §4: no duplicate-payment prompts).
 */
async function earlierPaynowRequests(db, invoiceId) {
  const collections = list(await read(db.from('pay04_garage_collections').select('id, payment_reference').eq('invoice_id', invoiceId).eq('gateway', PAY05_GATEWAY)));
  if (!collections.length) return [];
  const ids = collections.map((c) => c.id);
  const txs = list(await read(db.from('pay05_paynow_transactions').select('collection_id, provider_status, hold_released_at, settled_off_platform_at')
    .in('collection_id', ids))).filter((t) => t.hold_released_at || t.settled_off_platform_at);
  if (!txs.length) return [];
  const [payments, reviews] = await Promise.all([
    read(db.from('payment_transactions').select('reference, status').in('reference', collections.map((c) => c.payment_reference))),
    read(db.from('pay04_garage_payment_discrepancies').select('collection_id, discrepancy_type').eq('status', 'open').in('collection_id', txs.map((t) => t.collection_id))),
  ]);
  const closed = new Set(list(payments).filter((p) => ['cancelled', 'refunded'].includes(p.status)).map((p) => p.reference));
  const refOf = new Map(collections.map((c) => [c.id, c.payment_reference]));
  return txs.filter((t) => !closed.has(refOf.get(t.collection_id))).map((t) => ({
    collection_id: t.collection_id,
    unresolved: list(reviews).some((r) => r.collection_id === t.collection_id && HOLDING_REVIEW(r))
      || (!t.settled_off_platform_at && (ESCROW_WORDS.has(t.provider_status) || t.provider_status === 'disputed')),
  }));
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
    const payerEmail = one(await read(db.from('users').select('email').eq('id', actorId).limit(1)))?.email ?? null;
    authEmail = paynowAuthEmailFor(integration, payerEmail);
    // the adapter's own rule, checked before anything is recorded (independent review S8)
    if (!isPaynowAuthEmail(authEmail)) throw new Pay05Error('PAY05_AUTH_EMAIL_REQUIRED', 422);
  }
  return { method, phone, authEmail };
}

/** Paynow test mode authenticates express requests with the merchant's own login e-mail; live mode with the payer's (ICR-P2). */
export function paynowAuthEmailFor(integration, payerEmail) {
  return integration.mode === 'paynow_test' ? integration.test_auth_email ?? null : payerEmail;
}

/**
 * Called by PAY-04's startGarageInvoicePayment BEFORE pay04_begin_garage_collection: when the garage's live merchant is
 * its Paynow merchant, a mistyped phone or an unavailable method is refused before any room is reserved.
 */
export async function prevalidatePaynowStart({ db = defaultDb, env = process.env, transport = null, invoice, body = {}, actorId }) {
  const account = one(await read(db.from('pay04_garage_merchant_accounts').select('id, gateway, status').eq('tenant_id', invoice.tenant_id)
    .in('status', ['simulated', 'verified']).order('registered_at', { ascending: false }).limit(1)));
  if (!account || account.gateway !== PAY05_GATEWAY) return null;
  requirePay05Enabled(env);
  const integration = await verifiedIntegration(db, account.id, invoice.currency);
  if (!integration) throw new Pay05Error('PAY05_INTEGRATION_UNAVAILABLE', 503);
  const input = await validateStartInput({ db, integration, currency: invoice.currency, body, actorId });
  // paying again needs a fresh read of any earlier request Paynow still has: if Paynow cannot be read, nothing starts
  for (const earlier of await earlierPaynowRequests(db, invoice.id)) {
    const collection = await loadCollection(db, earlier.collection_id);
    try {
      await checkPaynowCollection({ db, env, transport, collection });
    } catch {
      throw new Pay05Error('PAY05_EARLIER_REQUEST_UNRESOLVED', 409);
    }
  }
  if ((await earlierPaynowRequests(db, invoice.id)).some((e) => e.unresolved)) throw new Pay05Error('PAY05_EARLIER_REQUEST_UNRESOLVED', 409);
  return input;
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
  const resultUrl = publicResultUrl(env, collection.id, integration.mode);
  const trace = newMerchantTrace();
  let sending;
  try {
    sending = await rpc(db, 'pay05_record_paynow_sending', { p_collection_id: collection.id, p_merchant_trace: trace,
      p_method: method, p_phone_masked: phone ? maskPhone(phone) : null });
  } catch (error) {
    // nothing was sent (Paynow switched off by the operator, the integration gone): the begun collection holds no room
    await rpc(db, 'pay04_cancel_garage_collection', { p_collection_id: collection.id, p_actor_user_id: actor.id,
      p_reason: `Payment request not sent: ${String(error?.code || 'unavailable')}` }).catch(() => null);
    throw error;
  }
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
    const outcome = error?.details?.outcome;
    if (outcome === 'refused' || outcome === 'not_sent') {
      // Paynow said no, or CarUp refused locally before sending: marking the request refused closes the payment and frees
      // its room in the same transaction, even if a stop arrived meanwhile (independent review S1, S8). Should Paynow's
      // signed update ever show the request exists after all, it binds late into an operator review.
      if (outcome === 'refused') {
        await recordProviderError(db, 'provider_refused', collection, { code: error.code, provider_error: error.details.provider_error ?? null });
      }
      await rpc(db, 'pay05_mark_paynow_initiation', { p_collection_id: collection.id, p_state: 'refused',
        p_error: String(outcome === 'refused' ? (error.details.provider_error || error.code) : `not sent: ${error.code}`).slice(0, 160) });
      if (outcome === 'not_sent') throw error;
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
  const readTicket = await beginRead(db, collection);
  let traced;
  try {
    traced = await adapter.trace({ merchantTrace: tx.merchant_trace });
  } catch (error) {
    await recordProviderError(db, 'trace_failed', collection, { code: error?.code ?? 'unknown' });
    // the attempt's time lets an operator release a request Paynow never confirmed (independent review P2)
    await rpc(db, 'pay05_record_paynow_trace_failed', { p_collection_id: collection.id }).catch(() => null);
    return { state: tx.initiation_state, traced: 'failed' };
  }
  if (!traced.found) {
    const r = await rpc(db, 'pay05_record_paynow_trace_absent', { p_collection_id: collection.id });
    return { state: r?.initiation_state ?? tx.initiation_state, traced: 'absent' };
  }
  // a trace reply that names another payment never binds this one (independent review S6)
  if (traced.truth.reference !== collection.payment_reference) {
    await recordProviderError(db, 'callback_binding_mismatch', collection, { via: 'trace', reference_matches: false });
    return { state: tx.initiation_state, traced: 'mismatch' };
  }
  await rpc(db, 'pay05_attach_paynow_collection', { p_collection_id: collection.id, p_merchant_trace: tx.merchant_trace,
    p_poll_url: traced.truth.pollUrl, p_payment_id: traced.truth.paymentId, p_reference: traced.truth.reference,
    p_reply: { browser_url: traced.truth.browserUrl ?? null, paynow_reference: traced.truth.paynowReference, recovered_by_trace: true } });
  const result = await applyTruth(db, await loadCollection(db, collection.id), traced.truth, { via: 'trace', readTicket });
  return { state: 'attached', traced: 'found', result };
}

/** A fresh, authenticated read of one Paynow collection, applied through the governed writer. */
export async function checkPaynowCollection({ db = defaultDb, env = process.env, transport = null, collection, deps = {} }) {
  // PAY-05 switched off: Paynow is not called, whichever route asked (independent review S3)
  requirePay05Enabled(env);
  const tx = await transactionOf(db, collection.id);
  let result = null;
  if (tx && ['sending', 'unknown'].includes(tx.initiation_state)) {
    result = (await recoverByTrace({ db, env, transport, collection }))?.result ?? null;
  } else if (tx && tx.initiation_state === 'attached') {
    const adapter = await adapterFor(db, env, transport, collection, tx);
    const readTicket = await beginRead(db, collection);
    let truth;
    try {
      truth = await adapter.getPaymentTruth({ pollUrl: tx.poll_url });
    } catch (error) {
      await recordProviderError(db, 'poll_failed', collection, { code: error?.code ?? 'unknown' });
      throw new Pay05Error('PAY05_PROVIDER_READ_FAILED', 502);
    }
    result = await applyTruth(db, collection, truth, { via: 'poll', readTicket });
  }
  const notification = result ? await notifyCollectionOutcome(db, collection, result, deps) : { attempted: 0, emitted: 0, failures: [] };
  const out = await collectionOutcome(db, collection, result, notification);
  return { ...out, paynow: out.collection?.paynow ?? paynowView(await transactionOf(db, collection.id)) };
}

/** The customer's view of a request, in the words its current state allows (ICR-W3): "counted" only when it was. */
async function customerPaynowOutcome(db, out, collection) {
  const view = withCollectionState(paynowView(await transactionOf(db, collection.id), { customer: true }), out.collection?.state,
    { counted: out.collection?.counted_amount ?? 0, currency: collection.currency, customer: true });
  const told = forCustomer(out);
  if (told.collection) told.collection.paynow = view;
  return { ...told, paynow: view };
}

export async function verifyCustomerPaynow({ db = defaultDb, env = process.env, transport = null, collection, deps = {} }) {
  const out = await checkPaynowCollection({ db, env, transport, collection, deps });
  return customerPaynowOutcome(db, out, collection);
}

/** O'mari: the customer's one-time password, sent to Paynow's remote OTP URL (allowlisted), then applied. */
export async function submitPaynowOtp({ db = defaultDb, env = process.env, transport = null, actor = {}, collectionId, body = {}, deps = {} }) {
  requirePay05Enabled(env);
  let collection;
  try {
    collection = await loadCollection(db, collectionId);
  } catch (error) {
    // a collection that does not exist looks exactly like someone else's (independent review S5)
    if (error?.code === 'PAY04_COLLECTION_NOT_FOUND') throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
    throw error;
  }
  if (collection.payer_user_id !== actor.id || collection.gateway !== PAY05_GATEWAY) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  const tx = await transactionOf(db, collection.id);
  if (!tx || tx.method !== 'omari' || tx.initiation_state !== 'attached' || !tx.remote_otp_url) throw new Pay05Error('PAY05_OTP_NOT_EXPECTED', 409);
  const adapter = await adapterFor(db, env, transport, collection, tx);
  const readTicket = await beginRead(db, collection);
  let truth;
  try {
    truth = await adapter.submitOtp({ remoteOtpUrl: tx.remote_otp_url, otp: String(body.otp ?? '').trim() });
  } catch (error) {
    if (error?.code === 'PAY05_OTP_REJECTED') await recordProviderError(db, 'otp_rejected', collection, { provider_error: error.details?.provider_error ?? null });
    throw error;
  }
  const result = await applyTruth(db, collection, truth, { via: 'otp_reply', readTicket });
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  return customerPaynowOutcome(db, await collectionOutcome(db, collection, result, notification), collection);
}

// ───────────────────────────── Paynow's status update (resulturl) ─────────────────────────────

/** How far along a Paynow word is. Closed and unrecognised words have no place in that order. */
const WORD_RANK = Object.freeze({ created: 1, sent: 1, awaiting_delivery: 2, delivered: 2, paid: 3, disputed: 4, refunded: 5 });
/** Whether a fresh read confirms what a status update said: the same word, or a word further along. */
export function confirms(said, read) {
  if (said === read) return true;
  const rank = WORD_RANK[said];
  return Boolean(rank) && (WORD_RANK[read] ?? 0) >= rank;
}

/**
 * POST from Paynow to /api/pay05/paynow/webhook/:collectionId. Accepted only if its hash verifies with THIS
 * collection's own integration key and it names this collection's reference and poll URL. It is a trigger: the money
 * effect comes from a fresh poll. A resend (Paynow retries up to ten times) is the same message and is not re-polled.
 */
export async function processPaynowStatusUpdate({ db = defaultDb, env = process.env, transport = null, collectionId, rawBody, deps = {} }) {
  requirePay05Enabled(env);
  const id = String(collectionId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  const collection = one(await read(db.from('pay04_garage_collections').select('*').eq('id', id).limit(1)));
  if (!collection || collection.gateway !== PAY05_GATEWAY) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  let tx = await transactionOf(db, collection.id);
  if (!tx) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  let adapter;
  try {
    adapter = await adapterFor(db, env, transport, collection, tx);
  } catch (error) {
    // before any signature is proved, a key that cannot be opened answers as any other refusal: a retry-class answer here
    // would say this collection exists (ICR-S6). Paynow resends on any HTTP error, so nothing is lost.
    await recordProviderError(db, 'provider_unexpected', collection, { code: error?.code ?? 'unknown', trigger: 'status_update' });
    throw new Pay05Error('PAY05_CALLBACK_SIGNATURE_INVALID', 401);
  }
  let update;
  try {
    update = adapter.verifyStatusUpdate(rawBody);
  } catch (error) {
    // a message that verified but names a poll URL that is not Paynow's is a URL refusal, not a forgery (independent review P6)
    const kind = error?.code === 'PAY05_PROVIDER_MESSAGE_MALFORMED' ? 'callback_malformed'
      : error?.code === 'PAY05_PROVIDER_URL_REFUSED' ? 'provider_url_refused' : 'callback_signature_invalid';
    await recordProviderError(db, kind, collection, { code: error?.code ?? 'unknown' });
    if (kind === 'callback_malformed') throw new Pay05Error('PAY05_CALLBACK_MALFORMED', 400);
    if (kind === 'provider_url_refused') throw new Pay05Error('PAY05_PROVIDER_URL_REFUSED', 409);
    throw new Pay05Error('PAY05_CALLBACK_SIGNATURE_INVALID', 401);
  }
  if (update.truth.reference !== collection.payment_reference || !update.truth.pollUrl
      || (tx.poll_url && !samePollUrl(update.truth.pollUrl, tx.poll_url))) {
    await recordProviderError(db, 'callback_binding_mismatch', collection, { reference_matches: update.truth.reference === collection.payment_reference,
      poll_url_matches: Boolean(tx.poll_url) && samePollUrl(update.truth.pollUrl, tx.poll_url) });
    throw new Pay05Error('PAY05_PROVIDER_BINDING_MISMATCH', 409);
  }
  // A resend of the message CarUp recorded last — while CarUp still holds the status it reported — is a duplicate (no second
  // poll). Anything else takes a ticketed confirming poll: a status that differs from the one CarUp holds is never a duplicate
  // (ICR-M2), and variants of one signed message are one message (ICR-S1).
  const messageHash = messageHashFor(update.pairs);
  if (tx.last_status_update_hash === messageHash && tx.provider_status === update.truth.providerStatus) {
    return { duplicate_event: true, applied: false };
  }
  const eventId = eventIdFor(collection.id, messageHash, tx.status_update_generation ?? 0);
  if (tx.initiation_state !== 'attached') {
    // Paynow's own signed message carries the poll URL our lost reply would have: bind it now — LATE if CarUp had already
    // closed the request as refused or absent, whose money is then an operator review, never lost (independent review P1)
    await rpc(db, 'pay05_attach_paynow_collection', { p_collection_id: collection.id, p_merchant_trace: tx.merchant_trace,
      p_poll_url: update.truth.pollUrl, p_payment_id: update.truth.paymentId, p_reference: update.truth.reference, p_late: true,
      p_reply: { paynow_reference: update.truth.paynowReference, recovered_by_status_update: true } });
    tx = await transactionOf(db, collection.id);
  }
  // the reads status updates can trigger are budgeted per collection (ICR-S1): over budget Paynow is answered non-2xx
  const readTicket = await rpc(db, 'pay05_begin_status_update_read', { p_collection_id: collection.id });
  let truth;
  try {
    truth = await adapter.getPaymentTruth({ pollUrl: tx.poll_url });
  } catch (error) {
    await recordProviderError(db, 'poll_failed', collection, { code: error?.code ?? 'unknown', trigger: 'status_update' });
    // an HTTP error makes Paynow resend the update: the poll is retried then
    throw new Pay05Error('PAY05_PROVIDER_READ_FAILED', 503);
  }
  const current = await loadCollection(db, collection.id);
  const result = await applyTruth(db, current, truth, { via: 'status_update', eventId, messageHash, readTicket });
  const notification = await notifyCollectionOutcome(db, current, result, deps);
  // The confirming read was not evaluated, or does not yet show what Paynow said: answer non-2xx, so Paynow resends and CarUp
  // reads again (ICR-M2). A 200 here would end Paynow's retries with its news unapplied.
  if (['superseded', 'stale_regression'].includes(result?.ignored) || !confirms(update.truth.providerStatus, truth.providerStatus)) {
    throw new Pay05Error('PAY05_STATUS_UPDATE_UNCONFIRMED', 503);
  }
  return { event_id: eventId, collection_id: collection.id, applied: Boolean(result?.applied), duplicate_event: Boolean(result?.duplicate_event),
    provider_status: truth.providerStatus, payment_status: result?.payment_status ?? null, notification };
}

// ───────────────────────────── stops, closing, operators ─────────────────────────────

/** A stop: recorded (who, why); the room stays held — Paynow cannot cancel — then one fresh read. */
export async function cancelPaynowCollection({ db = defaultDb, env = process.env, transport = null, collection, actorUserId, reason }) {
  requirePay05Enabled(env);
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
const RECENT_READ_MS = 60_000;
/** A released or settled request is still Paynow's: it stays re-readable, at a pace that costs nothing (ICR-M3). */
const RESTING_READ_MS = 60 * 60 * 1000;
const recently = (ts, windowMs = RECENT_READ_MS) => Boolean(ts) && Date.now() - Date.parse(ts) < windowMs;

export async function refreshPaynowCollection({ db = defaultDb, env = process.env, transport = null, collection }) {
  if (!isPay05Enabled(env)) return;
  const tx = await transactionOf(db, collection.id);
  const expired = Date.parse(collection.expires_at) <= Date.now();
  // None is read more than once a minute however often a customer looks (independent review S10).
  const windowMs = tx && (tx.hold_released_at || tx.settled_off_platform_at) ? RESTING_READ_MS : RECENT_READ_MS;
  if (tx && recently(tx.last_trace_at, windowMs)) return;
  if (tx) {
    const last = one(await read(db.from('pay05_paynow_observations').select('observed_at').eq('collection_id', collection.id)
      .order('seq', { ascending: false }).limit(1)));
    if (recently(last?.observed_at, windowMs)) return;
  }
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

/** Requests on this invoice settled outside CarUp stay re-readable, whatever their canonical status (ICR-M3). */
export async function refreshSettledPaynowCollections({ db = defaultDb, env = process.env, transport = null, collections = [] }) {
  if (!isPay05Enabled(env) || !collections.length) return;
  const settled = list(await read(db.from('pay05_paynow_transactions').select('collection_id').in('collection_id', collections.map((c) => c.id))
    .not('settled_off_platform_at', 'is', null)));
  for (const t of settled) {
    await refreshPaynowCollection({ db, env, transport, collection: collections.find((c) => c.id === t.collection_id) }).catch(() => null);
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

/**
 * The operator's queue of Paynow requests: those still holding invoice room although stopped or past CarUp's time (Paynow
 * cannot cancel them, so each is closed by Paynow, paid, or released after a fresh read), and those already released or settled,
 * which stay visible and re-readable (ICR-M3). `can_release` is what the database would allow (ICR-W6).
 */
export async function listHeldPaynowCollections({ db = defaultDb, env = process.env } = {}) {
  requirePay05Enabled(env);
  const [holding, resting] = await Promise.all([
    read(db.from('pay05_paynow_transactions').select('*').is('hold_released_at', null)
      .in('initiation_state', ['attached', 'sending', 'unknown']).order('created_at', { ascending: true }).limit(200)),
    read(db.from('pay05_paynow_transactions').select('*').not('hold_released_at', 'is', null).order('hold_released_at', { ascending: false }).limit(50)),
  ]);
  const txs = [...list(holding), ...list(resting)];
  if (!txs.length) return { held: [] };
  const collections = list(await read(db.from('pay04_garage_collections').select('*').in('id', txs.map((t) => t.collection_id))));
  const byId = new Map(collections.map((c) => [c.id, c]));
  const refs = collections.map((c) => c.payment_reference);
  const ids = collections.map((c) => c.id);
  const [paymentRows, reviewRows, receiptRows] = await Promise.all([
    read(db.from('payment_transactions').select('reference, status').in('reference', refs)),
    read(db.from('pay04_garage_payment_discrepancies').select('collection_id, discrepancy_type').eq('status', 'open').in('collection_id', ids)),
    read(db.from('pay04_garage_provider_receipts').select('collection_id, amount').eq('status', 'issued').in('collection_id', ids)),
  ]);
  const payments = new Map(list(paymentRows).map((p) => [p.reference, p.status]));
  const reviewsOf = (id) => list(reviewRows).filter((r) => r.collection_id === id);
  const countedOf = (id) => list(receiptRows).find((r) => r.collection_id === id)?.amount ?? 0;
  const invoiceIds = [...new Set(collections.map((c) => c.invoice_id))];
  const invoices = new Map(list(await read(db.from('garage_invoices').select('id, invoice_number').in('id', invoiceIds))).map((i) => [i.id, i.invoice_number]));
  const tenantIds = [...new Set(collections.map((c) => c.tenant_id))];
  const tenants = new Map(list(await read(db.from('tenants').select('id, name').in('id', tenantIds))).map((t) => [t.id, t.name]));
  const now = Date.now();
  const held = txs.map((t) => ({ tx: t, c: byId.get(t.collection_id) }))
    .filter(({ tx, c }) => c && (tx.hold_released_at
      || (payments.get(c.payment_reference) === 'pending' && (c.cancelled_at || Date.parse(c.expires_at) <= now))))
    .map(({ tx, c }) => {
      const view = paynowView(tx);
      const reviews = reviewsOf(c.id);
      const state = paynowCollectionState(c, { status: payments.get(c.payment_reference) }, view, { now, openDiscrepancies: reviews, counted: countedOf(c.id) });
      const block = paynowReleaseBlock({ tx, paymentStatus: payments.get(c.payment_reference), reviews });
      return {
        collection_id: c.id, garage: tenants.get(c.tenant_id) ?? null, invoice_number: invoices.get(c.invoice_id) ?? null,
        amount: pay04Money(c.amount, c.currency), currency: c.currency, initiated_at: c.initiated_at, expires_at: c.expires_at,
        stopped_at: c.cancelled_at, state, state_label: PAYNOW_STATE_LABELS[state] ?? PAYNOW_STATE_LABELS.unknown,
        released: Boolean(tx.hold_released_at), settled: Boolean(tx.settled_off_platform_at),
        can_release: !block, release_blocked_reason: block,
        paynow: withCollectionState(view, state, { counted: countedOf(c.id), currency: c.currency }),
      };
    });
  return { held };
}

/**
 * Why the database would refuse to release this hold, in words; null when it would allow it after a fresh read and once
 * CarUp's own time has passed (the panel shows that time and opens the action itself when it passes) (ICR-W6).
 */
export function paynowReleaseBlock({ tx, paymentStatus, reviews = [] }) {
  if (tx.hold_released_at) return 'Already released.';
  if (paymentStatus !== 'pending') return 'This payment is no longer waiting on Paynow.';
  if (reviews.length) return 'Close its review first.';
  if (tx.provider_status && !['created', 'sent', 'cancelled', 'failed'].includes(tx.provider_status)) return 'Paynow reports money on this request.';
  return null;
}
