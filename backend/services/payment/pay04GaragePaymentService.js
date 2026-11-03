/**
 * CARUP-PAY-04-LR01 — garage invoice payments: payment instructions (Mode 1), provider-confirmed garage payments
 * (Mode 2, Level 1 simulator), the garage's financial overview and the operator exception surface.
 *
 *  - One invoice authority: Garage OPS07 (garage_invoices). One money ledger: payment_transactions. PAY-04 adds the
 *    provider path beside OPS07's declared payments and never writes either authority's rows directly — every money
 *    write is a canonical SECURITY DEFINER function of migration 20261102110000.
 *  - Money truth is a FRESH provider read applied through pay04_apply_garage_provider_snapshot. A browser return, a
 *    webhook body or a reference string is never payment authority.
 *  - A failed read is an error, never an empty list: every query result is checked.
 *  - Garage revenue is the garage's. No view adds money across currencies or calls it CarUp's.
 */
import { supabase as defaultDb } from '../../db/supabase.js';
import { followedCases } from '../garageOperations/garageEstimateService.js';
import { GARAGE_NOTIFICATION_EVENTS, notifyCaseAudience } from '../garageOperations/garageNotificationService.js';
import {
  PAY04_LABELS, PAY04_SIMULATOR_GATEWAY, Pay04Error, isPay04Enabled, isPay04ProductionRuntime, pay04Failure, pay04IdempotencyKey,
  pay04Money, pay04Reason, requirePay04Enabled,
} from './pay04Contract.js';
import { pay04AdapterFor } from './pay04ProviderAdapters.js';
import { PAY05_GATEWAY, PAY05_LABELS, Pay05Error, isPay05Enabled } from './pay05Contract.js';

// PAY-05: a collection through the garage's own Paynow merchant is served by the Paynow service (loaded on demand, so the
// two modules never import each other at load time).
const paynowService = () => import('./pay05PaynowCollectionService.js');

const COLLECTION_TTL_SECONDS = 1800;
/**
 * PAY-05: a disposable UAT runtime may shorten CarUp's collection expiry (5–3600 s) to exercise expiry, stop and hold
 * release physically; any production runtime always uses the accepted 30 minutes.
 */
export function collectionTtlSeconds(env = process.env) {
  if (isPay04ProductionRuntime(env)) return COLLECTION_TTL_SECONDS;
  const v = Number(env.CARUP_PAY04_UAT_COLLECTION_TTL_SECONDS);
  return Number.isInteger(v) && v >= 5 && v <= 3600 ? v : COLLECTION_TTL_SECONDS;
}
const OVERVIEW_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);
const list = (data) => (Array.isArray(data) ? data : data ? [data] : []);

function actorIdOf(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new Pay04Error('PAY04_ACTOR_REQUIRED', 401);
  return String(id);
}
function requireId(value, code = 'PAY04_ID_INVALID') {
  const id = String(value ?? '').trim();
  if (!UUID.test(id)) throw new Pay04Error(code, 422);
  return id;
}
async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw pay04Failure(error);
  return data;
}
async function read(promise, code = 'PAY04_READ_UNAVAILABLE') {
  const { data, error } = await promise;
  if (error) throw new Pay04Error(code, 503);
  return data;
}

// ───────────────────────────── money and provider-payment views ─────────────────────────────

export function moneyView(row) {
  if (!row) return null;
  const c = row.currency;
  return {
    currency: c,
    invoice_status: row.invoice_status,
    total_amount: pay04Money(row.total_amount, c),
    declared_paid: pay04Money(row.declared_paid, c),
    provider_paid: pay04Money(row.provider_paid, c),
    paid_amount: pay04Money(row.paid_amount, c),
    balance_amount: pay04Money(row.balance_amount, c),
    provider_reserved: pay04Money(row.provider_reserved, c),
    uncommitted_balance: pay04Money(row.uncommitted_balance, c),
    payment_status: row.payment_status,
  };
}

export async function invoiceMoney(db, invoiceId) {
  return moneyView(one(await rpc(db, 'pay04_invoice_money', { p_invoice_id: invoiceId })));
}

/** The customer- and garage-readable state of one provider collection. Never 'paid' before the provider says so. */
const MISMATCH_TYPES = new Set(['amount_mismatch', 'currency_mismatch', 'merchant_mismatch',
  // PAY-05 (Paynow): money held in a dispute, or a status no one has reviewed, is not confirmed
  'provider_disputed', 'provider_status_unrecognized']);
/**
 * The state a person reads. Nothing is "closed" or "nothing was charged" until the PROVIDER says so (a stop or CarUp's
 * own expiry only starts that), and paid money whose evidence disagrees is under review, not confirmed.
 */
export function collectionState(collection, payment, { now = Date.now(), openDiscrepancies = [] } = {}) {
  const status = payment?.status || 'unknown';
  if (status === 'pending') {
    if (openDiscrepancies.some((d) => d.discrepancy_type !== 'unallocated_provider_money')) return 'under_review';
    if (collection.cancelled_at) return 'stopping';
    if (Date.parse(collection.expires_at) <= now) return 'expired';
    return 'awaiting_provider';
  }
  if (status === 'paid') {
    if (openDiscrepancies.some((d) => MISMATCH_TYPES.has(d.discrepancy_type))) return 'under_review';
    return openDiscrepancies.some((d) => d.discrepancy_type === 'unallocated_provider_money') ? 'confirmed_unallocated' : 'confirmed';
  }
  if (status === 'cancelled') {
    // PAY-05: Paynow took money after CarUp had closed this payment — an operator settles it
    if (openDiscrepancies.some((d) => d.discrepancy_type === 'provider_paid_after_close')) return 'under_review';
    return collection.cancelled_at && collection.cancelled_by !== 'system:expiry' ? 'stopped' : 'cancelled';
  }
  if (status === 'reconciliation_hold') return 'under_review';
  return status; // refund_pending, refunded, partially_refunded
}

const STATE_LABELS = Object.freeze({
  awaiting_provider: 'Waiting for the provider to confirm',
  stopping: 'Stopped — CarUp is confirming with the provider that nothing was paid (not counted)',
  expired: 'Expired — CarUp is confirming with the provider that nothing was paid (not counted)',
  stopped: 'Stopped before payment — the provider confirmed nothing was charged',
  confirmed: 'Confirmed by the provider',
  confirmed_unallocated: 'Confirmed by the provider — not counted on this invoice (under review)',
  under_review: 'Under review — not counted',
  refund_pending: 'Refund in progress — not counted',
  refunded: 'Refunded to the customer',
  partially_refunded: 'Partly refunded — the remainder counts',
  cancelled: 'Closed before payment — nothing was charged',
  unknown: 'Unavailable',
});

/**
 * Provider collections, receipts and (for the garage and operators) open discrepancies of the given invoices.
 * `available: false` only when the PAY-04 schema is not installed (then no provider money can exist and the OPS07
 * balance is OPS07's own); any other failure throws — a failed read never renders as "no payments".
 */
export async function loadProviderParts(db, invoiceIds, { payerUserId = null, includeDiscrepancies = false } = {}) {
  const empty = { available: true, collections: new Map(), receipts: new Map() };
  if (!invoiceIds.length) return empty;
  let q = db.from('pay04_garage_collections').select('*').in('invoice_id', invoiceIds).order('initiated_at', { ascending: false });
  if (payerUserId) q = q.eq('payer_user_id', payerUserId);
  const { data: collections, error } = await q;
  if (error) {
    if (/^(42P01|PGRST205)$/.test(String(error.code || '')) || /pay04_garage_collections.*(does not exist|schema cache)/i.test(String(error.message || ''))) {
      return { available: false, collections: new Map(), receipts: new Map() };
    }
    throw new Pay04Error('PAY04_PROVIDER_PAYMENTS_UNAVAILABLE', 503);
  }
  const rows = list(collections);
  const refs = rows.map((c) => c.payment_reference);
  const ids = rows.map((c) => c.id);
  const [payments, receipts, discrepancies] = await Promise.all([
    refs.length ? read(db.from('payment_transactions').select('reference, status, updated_at').in('reference', refs), 'PAY04_PROVIDER_PAYMENTS_UNAVAILABLE') : [],
    read(db.from('pay04_garage_provider_receipts').select('*').in('invoice_id', invoiceIds).order('issued_at', { ascending: true }), 'PAY04_PROVIDER_PAYMENTS_UNAVAILABLE'),
    ids.length ? read(db.from('pay04_garage_payment_discrepancies').select('*').in('collection_id', ids), 'PAY04_PROVIDER_PAYMENTS_UNAVAILABLE') : [],
  ]);
  const paymentByRef = new Map(list(payments).map((p) => [p.reference, p]));
  const paynowIds = rows.filter((c) => c.gateway === PAY05_GATEWAY).map((c) => c.id);
  const paynowModule = paynowIds.length ? await paynowService() : null;
  const paynow = paynowModule ? await paynowModule.paynowDetails(db, paynowIds, { customer: Boolean(payerUserId) }) : new Map();
  const openByCollection = new Map();
  for (const d of list(discrepancies).filter((x) => x.status === 'open')) {
    openByCollection.set(d.collection_id, [...(openByCollection.get(d.collection_id) || []), d]);
  }
  const ownCollectionIds = new Set(ids);
  const out = { available: true, collections: new Map(), receipts: new Map() };
  for (const c of rows) {
    const payment = paymentByRef.get(c.payment_reference) || null;
    const open = openByCollection.get(c.id) || [];
    // PAY-05: Paynow cannot cancel or expire a request, and what counts is what was counted (PAY-05-R1, ICR-W1, W3)
    const isPaynow = c.gateway === PAY05_GATEWAY;
    const counted = list(receipts).find((r) => r.collection_id === c.id && r.status === 'issued')?.amount ?? 0;
    const state = isPaynow ? paynowModule.paynowCollectionState(c, payment, paynow.get(c.id) ?? null, { openDiscrepancies: open, counted })
      : collectionState(c, payment, { openDiscrepancies: open });
    const stateLabel = isPaynow ? paynowModule.PAYNOW_STATE_LABELS[state] : STATE_LABELS[state];
    const view = {
      id: c.id, amount: pay04Money(c.amount, c.currency), currency: c.currency, initiated_at: c.initiated_at,
      expires_at: c.expires_at, cancelled_at: c.cancelled_at ?? null, state, state_label: stateLabel || STATE_LABELS.unknown,
      payment_status: payment?.status ?? null, gateway: c.gateway,
      simulated: c.gateway === PAY04_SIMULATOR_GATEWAY || Boolean(paynow.get(c.id)?.simulated),
      source_label: c.gateway === PAY05_GATEWAY ? PAY05_LABELS.paynowChannel : PAY04_LABELS.providerChannel,
      // PAY-05: Paynow's word is shown as Paynow's word; CarUp's count, its review and the next step are separate facts
      ...(isPaynow ? { counted_amount: pay04Money(counted, c.currency),
        paynow: paynowModule.withCollectionState(paynow.get(c.id) ?? null, state, { counted, currency: c.currency, customer: Boolean(payerUserId) }) } : {}),
      ...(includeDiscrepancies ? {
        payer_user_id: c.payer_user_id, payment_reference: c.payment_reference, provider_payment_id: c.provider_payment_id,
        open_discrepancies: open.map((d) => ({ id: d.id, type: d.discrepancy_type, amount: pay04Money(d.detected_amount, d.currency),
          first_detected_at: d.first_detected_at, observation_count: d.observation_count })),
      } : {}),
    };
    out.collections.set(c.invoice_id, [...(out.collections.get(c.invoice_id) || []), view]);
  }
  for (const r of list(receipts)) {
    // a customer sees only the receipts of their own payments
    if (payerUserId && !ownCollectionIds.has(r.collection_id)) continue;
    out.receipts.set(r.invoice_id, [...(out.receipts.get(r.invoice_id) || []), {
      id: r.id, receipt_number: r.receipt_number, collection_id: r.collection_id, amount: pay04Money(r.amount, r.currency),
      currency: r.currency, status: r.status, issued_at: r.issued_at, voided_at: r.voided_at ?? null,
      payment_source: r.payment_source, payment_source_label: PAY04_LABELS.providerSource,
    }]);
  }
  return out;
}

// ───────────────────────────── payment instructions (Mode 1) ─────────────────────────────

function instructionsView(row) {
  if (!row) return null;
  return {
    id: row.id, version: row.version, status: row.status, payee_name: row.payee_name, instructions: row.instructions,
    accepted_methods: row.accepted_methods, currencies: row.currencies, created_at: row.created_at,
    superseded_at: row.superseded_at ?? null, disclosure: PAY04_LABELS.instructionsDisclosure,
  };
}

export async function activeInstructions(db, tenantId) {
  const row = await read(db.from('pay04_garage_payment_instructions').select('*').eq('tenant_id', tenantId).eq('status', 'active').maybeSingle(),
    'PAY04_INSTRUCTIONS_UNAVAILABLE');
  return instructionsView(row);
}

export async function getGaragePaymentInstructions({ db = defaultDb, actor = {} } = {}) {
  const tenantId = actor.tenantId;
  if (!tenantId) throw new Pay04Error('PAY04_TENANT_CONTEXT_REQUIRED', 400);
  const rows = await read(db.from('pay04_garage_payment_instructions').select('*').eq('tenant_id', tenantId).order('version', { ascending: false }),
    'PAY04_INSTRUCTIONS_UNAVAILABLE');
  const all = list(rows).map(instructionsView);
  return { active: all.find((r) => r.status === 'active') || null, history: all.filter((r) => r.status !== 'active'),
    disclosure: PAY04_LABELS.instructionsDisclosure };
}

export async function setGaragePaymentInstructions({ db = defaultDb, actor = {}, body = {} } = {}) {
  const tenantId = actor.tenantId;
  if (!tenantId) throw new Pay04Error('PAY04_TENANT_CONTEXT_REQUIRED', 400);
  const asArray = (v) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  await rpc(db, 'pay04_set_garage_payment_instructions', {
    p_tenant_id: tenantId, p_actor_user_id: actorIdOf(actor),
    p_payee_name: String(body.payee_name ?? '').slice(0, 200), p_instructions: String(body.instructions ?? '').slice(0, 4000),
    p_accepted_methods: asArray(body.accepted_methods), p_currencies: asArray(body.currencies),
  });
  return getGaragePaymentInstructions({ db, actor });
}

// ───────────────────────────── customer: pay an invoice through the garage's provider ─────────────────────────────

export async function customerInvoice(db, userId, invoiceId) {
  const id = requireId(invoiceId, 'PAY04_INVOICE_NOT_FOUND');
  const inv = await read(db.from('garage_invoices').select('*').eq('id', id).maybeSingle(), 'PAY04_INVOICE_UNAVAILABLE');
  // Not following the case and not existing look the same: an invoice id never discloses another customer's invoice.
  if (!inv) throw new Pay04Error('PAY04_INVOICE_NOT_FOUND', 404);
  const { cases } = await followedCases(db, userId);
  if (!cases.some((c) => c.id === inv.service_case_id)) throw new Pay04Error('PAY04_INVOICE_NOT_FOUND', 404);
  return inv;
}

/** What the customer can do to pay: the garage's instructions always; online payment only when it really exists. */
export async function onlinePaymentOption(db, env, invoice, money) {
  if (!isPay04Enabled(env)) return { available: false, reason: 'not_offered' };
  if (invoice.status !== 'issued') return { available: false, reason: 'invoice_not_payable' };
  // the live merchant pay04_begin_garage_collection would choose: the latest simulated one, or a verified Paynow one (PAY-05)
  const account = one(await read(db.from('pay04_garage_merchant_accounts').select('id, gateway, status, currencies, display_name')
    .eq('tenant_id', invoice.tenant_id).in('status', ['simulated', 'verified']).order('registered_at', { ascending: false }).limit(1),
    'PAY04_MERCHANT_UNAVAILABLE'));
  if (!account) return { available: false, reason: 'garage_not_connected' };
  if (account.gateway === PAY05_GATEWAY) return (await paynowService()).paynowOnlineOption(db, env, invoice, money, account);
  if (!(account.currencies || []).includes(invoice.currency)) return { available: false, reason: 'currency_not_supported' };
  const permitted = await rpc(db, 'pay04_gateway_permitted', { p_gateway: account.gateway });
  if (permitted !== true) return { available: false, reason: 'provider_not_enabled' };
  if (Number(money.uncommitted_balance) <= 0) {
    return { available: false, reason: Number(money.provider_reserved) > 0 ? 'payment_in_progress' : 'nothing_due' };
  }
  return { available: true, simulated: account.gateway === PAY04_SIMULATOR_GATEWAY, merchant_display_name: account.display_name,
    max_amount: money.uncommitted_balance, currency: invoice.currency,
    simulation_notice: account.gateway === PAY04_SIMULATOR_GATEWAY ? PAY04_LABELS.simulatedProvider : null };
}

export async function getCustomerInvoicePayment({ db = defaultDb, env = process.env, provider = null, actor = {}, invoiceId } = {}) {
  const userId = actorIdOf(actor);
  const invoice = await customerInvoice(db, userId, invoiceId);
  await refreshClosingCollections({ db, env, provider, invoiceId: invoice.id });
  const money = await invoiceMoney(db, invoice.id);
  const [instructions, providerParts, option] = await Promise.all([
    activeInstructions(db, invoice.tenant_id),
    loadProviderParts(db, [invoice.id], { payerUserId: userId }),
    onlinePaymentOption(db, env, invoice, money),
  ]);
  return {
    invoice_id: invoice.id, invoice_number: invoice.invoice_number, status: invoice.status, currency: invoice.currency,
    money, payment_instructions: instructions, instructions_missing_label: instructions ? null : PAY04_LABELS.noInstructions,
    online_payment: option, provider_payments: providerParts.collections.get(invoice.id) || [],
    provider_receipts: providerParts.receipts.get(invoice.id) || [],
    labels: { declared: PAY04_LABELS.declaredSource, provider: PAY04_LABELS.providerSource, in_flight: PAY04_LABELS.inFlight },
  };
}

export function returnOrigin(env) {
  const origin = String(env.CARUP_PAY04_RETURN_ORIGIN || env.CARUP_PAY01A_RETURN_ORIGIN || '').replace(/\/$/, '');
  if (!/^https?:\/\/[^/]+$/.test(origin)) throw new Pay04Error('PAY04_RETURN_ORIGIN_INVALID', 503);
  return origin;
}

export async function startGarageInvoicePayment({
  db = defaultDb, env = process.env, provider = null, actor = {}, invoiceId, body = {}, idempotencyKey,
} = {}) {
  requirePay04Enabled(env);
  const userId = actorIdOf(actor);
  const invoice = await customerInvoice(db, userId, invoiceId);
  const key = pay04IdempotencyKey(idempotencyKey);
  // a retry of the same request (same payer, same key) replays it, whatever the balance is now
  const prior = one(await read(db.from('pay04_garage_collections').select('invoice_id, amount, currency')
    .eq('payer_user_id', userId).eq('idempotency_key', key).limit(1), 'PAY04_COLLECTION_UNAVAILABLE'));
  // checkouts the provider may have closed (stopped or expired) hold room until the provider is read: read them first
  if (!prior) await refreshClosingCollections({ db, env, provider, invoiceId: invoice.id });
  const money = await invoiceMoney(db, invoice.id);
  const omitted = body.amount === undefined || body.amount === null || body.amount === '';
  const raw = omitted ? (prior && prior.invoice_id === invoice.id ? pay04Money(prior.amount, prior.currency) : money.uncommitted_balance)
    : String(body.amount).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(raw)) throw new Pay04Error('PAY04_AMOUNT_INVALID', 422);
  // PAY-05: a Paynow request's own inputs (method, phone, the payer's e-mail) are checked before any room is reserved
  if (!prior) await (await paynowService()).prevalidatePaynowStart({ db, env, invoice, body, actorId: userId });
  const begun = await rpc(db, 'pay04_begin_garage_collection', {
    p_invoice_id: invoice.id, p_payer_user_id: userId, p_amount: raw, p_currency: invoice.currency, p_idempotency_key: key,
    p_ttl_seconds: collectionTtlSeconds(env),
  });
  const collection = begun.collection;
  if (collection.gateway === PAY05_GATEWAY) {
    return (await paynowService()).startPaynowCheckout({ db, env, actor: { id: userId }, invoice, collection, begun, body });
  }
  const account = await read(db.from('pay04_garage_merchant_accounts').select('merchant_reference, gateway')
    .eq('id', collection.merchant_account_id).maybeSingle(), 'PAY04_MERCHANT_UNAVAILABLE');
  if (!account) throw new Pay04Error('PAY04_MERCHANT_UNAVAILABLE', 503);
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  const origin = returnOrigin(env);
  const back = `${origin}/dashboard/service-requests?invoice=${invoice.id}&collection=${collection.id}`;
  const checkout = await adapter.createCheckout({
    collectionId: collection.id, merchantReference: account.merchant_reference, amountMinor: Number(collection.amount_minor),
    currency: collection.currency, successUrl: `${back}&pay04=returned`, cancelUrl: `${back}&pay04=cancelled`,
    expiresAt: collection.expires_at,
  });
  try {
    await rpc(db, 'pay04_attach_garage_collection', {
      p_collection_id: collection.id, p_provider_checkout_id: checkout.checkoutId, p_provider_payment_id: checkout.paymentId,
    });
  } catch (error) {
    // the collection closed meanwhile: its room is no longer held, so the provider checkout must not stay payable
    if (error?.code === 'PAY04_COLLECTION_CLOSED') await adapter.cancelCheckout(checkout.checkoutId).catch(() => null);
    throw error;
  }
  return {
    collection_id: collection.id, checkout_url: checkout.url, replayed: Boolean(begun.replayed),
    simulated: collection.gateway === PAY04_SIMULATOR_GATEWAY, amount: pay04Money(collection.amount, collection.currency),
    currency: collection.currency, expires_at: collection.expires_at, money: moneyView(begun.money),
    notice: PAY04_LABELS.inFlight,
  };
}

// ───────────────────────────── provider truth -> the one governed writer ─────────────────────────────

export async function loadCollection(db, collectionId) {
  const id = requireId(collectionId, 'PAY04_COLLECTION_NOT_FOUND');
  const c = await read(db.from('pay04_garage_collections').select('*').eq('id', id).maybeSingle(), 'PAY04_COLLECTION_UNAVAILABLE');
  if (!c) throw new Pay04Error('PAY04_COLLECTION_NOT_FOUND', 404);
  return c;
}

/** Apply a FRESH provider read for a collection. `event` (verified webhook) only names the trigger and dedupes it. */
async function applyProviderTruth(db, adapter, collection, { event = null } = {}) {
  if (!collection.provider_payment_id) throw new Pay04Error('PAY04_COLLECTION_NOT_ATTACHED', 409);
  const truth = await adapter.getPaymentTruth({ paymentId: collection.provider_payment_id });
  const result = await rpc(db, 'pay04_apply_garage_provider_snapshot', {
    p_collection_id: collection.id, p_status: truth.status, p_provider_payment_id: truth.paymentId, p_refund_id: truth.refundId ?? null,
    p_event_id: event?.id ?? null, p_event_type: event?.type ?? null, p_amount_minor: truth.amountMinor, p_currency: truth.currency,
    p_merchant_reference: truth.merchantReference, p_refunded_minor: truth.refundedMinor ?? null,
    p_pending_refund_minor: truth.pendingRefundMinor ?? null, p_refund_ids: truth.refundIds ?? null, p_mismatch: truth.mismatch ?? null,
    p_detected_via: event ? 'signed_webhook' : 'provider_readback',
  });
  return { truth, result };
}

/** Best-effort, after the money is written: the customer hears only what the provider confirmed. Never undoes it. */
export async function notifyCollectionOutcome(db, collection, result, deps = {}) {
  try {
    const issued = result?.projection?.receipt?.issued || null;
    const refunded = result?.applied && result?.payment_status === 'refunded' && result?.prior_payment_status !== 'refunded';
    if (!issued && !refunded) return { attempted: 0, emitted: 0, failures: [] };
    const { data: inv } = await db.from('garage_invoices').select('service_case_id').eq('id', collection.invoice_id).maybeSingle();
    const { data: serviceCase } = await db.from('service_cases').select('id, vin, garage_tenant_id, requester_user_id')
      .eq('id', inv?.service_case_id).maybeSingle();
    if (!serviceCase) return { attempted: 0, emitted: 0, failures: ['case unavailable'] };
    return await notifyCaseAudience(db, {
      eventType: issued ? GARAGE_NOTIFICATION_EVENTS.paymentConfirmed : GARAGE_NOTIFICATION_EVENTS.paymentRefunded,
      serviceCase,
      entity: { field: 'collectionId', id: issued ? `${collection.id}:${issued}` : collection.id },
    }, deps);
  } catch (error) {
    return { attempted: 0, emitted: 0, failures: [error?.message || 'notification failed'] };
  }
}

export async function collectionOutcome(db, collection, result, notification) {
  const fresh = await loadCollection(db, collection.id);
  const provider = await loadProviderParts(db, [fresh.invoice_id], { includeDiscrepancies: true });
  const view = (provider.collections.get(fresh.invoice_id) || []).find((c) => c.id === fresh.id) || null;
  return {
    collection: view, applied: Boolean(result?.applied), refused: result?.refused ?? null,
    duplicate_event: Boolean(result?.duplicate_event), payment_status: result?.payment_status ?? view?.payment_status ?? null,
    money: await invoiceMoney(db, fresh.invoice_id), notification,
  };
}

/** The payer (after returning from the provider) asks CarUp to check with the provider. */
export async function verifyCustomerCollection({ db = defaultDb, env = process.env, provider = null, actor = {}, collectionId, deps = {} } = {}) {
  requirePay04Enabled(env);
  const userId = actorIdOf(actor);
  const collection = await loadCollection(db, collectionId);
  if (collection.payer_user_id !== userId) throw new Pay04Error('PAY04_COLLECTION_NOT_FOUND', 404);
  if (collection.gateway === PAY05_GATEWAY) return (await paynowService()).verifyCustomerPaynow({ db, env, collection, deps });
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  const { result } = await applyProviderTruth(db, adapter, collection);
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  const out = await collectionOutcome(db, collection, result, notification);
  return forCustomer(out);
}

/** The customer sees their payment's state, not the garage's discrepancy detail or CarUp's internal references. */
/** PAY-05: the garage-side Paynow reference and provider error are not the customer's to read (independent review S4). */
const customerPaynow = (view) => (view ? { ...view, paynow_reference: null, provider_error: null } : view);

export function forCustomer(out) {
  if (out?.collection) {
    delete out.collection.open_discrepancies; delete out.collection.payer_user_id;
    delete out.collection.payment_reference; delete out.collection.provider_payment_id;
    if (out.collection.paynow) out.collection.paynow = customerPaynow(out.collection.paynow);
  }
  if (out?.paynow) out.paynow = customerPaynow(out.paynow);
  return out;
}

export async function cancelCustomerCollection({ db = defaultDb, env = process.env, provider = null, actor = {}, collectionId, body = {} } = {}) {
  requirePay04Enabled(env);
  const userId = actorIdOf(actor);
  const collection = await loadCollection(db, collectionId);
  if (collection.payer_user_id !== userId) throw new Pay04Error('PAY04_COLLECTION_NOT_FOUND', 404);
  return forCustomer(await cancelCollection(db, env, provider, collection, userId,
    pay04Reason(body.reason ?? 'Stopped by the customer', { min: 3 })));
}

/**
 * Stop a checkout. The PROVIDER is asked first: if it cannot be reached nothing changes (the money stays held). If it
 * had already taken the money, that truth wins and the payment counts in its held room. Otherwise CarUp records who
 * stopped it and why, and the fresh provider read (closed, unpaid) releases the room. A collection that never reached the
 * provider closes at once in the database.
 */
async function cancelCollection(db, env, provider, collection, actorUserId, reason) {
  if (collection.gateway === PAY05_GATEWAY) {
    // PAY-05: Paynow cannot cancel a request — the stop is recorded and the room stays held until Paynow says it closed
    return (await paynowService()).cancelPaynowCollection({ db, env, collection, actorUserId, reason });
  }
  const record = () => rpc(db, 'pay04_cancel_garage_collection', { p_collection_id: collection.id, p_actor_user_id: actorUserId, p_reason: reason });
  let result = null;
  if (collection.provider_checkout_id) {
    const adapter = pay04AdapterFor(collection.gateway, { env, provider });
    let closed;
    try {
      closed = await adapter.cancelCheckout(collection.provider_checkout_id);
    } catch {
      throw new Pay04Error('PAY04_PROVIDER_CANCEL_UNAVAILABLE', 502);
    }
    if (closed?.status !== 'complete') await record();
    ({ result } = await applyProviderTruth(db, adapter, collection));
  } else {
    await record();
  }
  return collectionOutcome(db, collection, result, { attempted: 0, emitted: 0, failures: [] });
}

/**
 * A stopped or expired checkout holds its room until the provider is read. Before room is reused (a new payment, the
 * customer's view, a garage cash record or void), read the provider for every such checkout of the invoice; one that
 * never reached the provider closes in the database once expired. Best effort and fail closed: a checkout that cannot
 * be read stays held, and the caller's own guard decides. No-op where PAY-04 is off or not installed.
 */
export async function refreshClosingCollections({ db = defaultDb, env = process.env, provider = null, invoiceId } = {}) {
  if (!isPay04Enabled(env) || !invoiceId) return { refreshed: 0 };
  const { data, error } = await db.from('pay04_garage_collections').select('*').eq('invoice_id', invoiceId);
  if (error) return { refreshed: 0, unavailable: true };
  const now = Date.now();
  // PAY-05: a request settled outside CarUp stays re-readable, at its own slow pace, whatever its canonical status
  const paynowRows = list(data).filter((c) => c.gateway === PAY05_GATEWAY);
  if (paynowRows.length) {
    await (await paynowService()).refreshSettledPaynowCollections({ db, env, collections: paynowRows }).catch(() => null);
  }
  const closing = list(data).filter((c) => c.cancelled_at || Date.parse(c.expires_at) <= now);
  if (!closing.length) return { refreshed: 0 };
  const { data: payments, error: paymentError } = await db.from('payment_transactions').select('reference, status')
    .in('reference', closing.map((c) => c.payment_reference));
  if (paymentError) return { refreshed: 0, unavailable: true };
  const pending = new Set(list(payments).filter((p) => p.status === 'pending').map((p) => p.reference));
  let refreshed = 0;
  for (const c of closing.filter((x) => pending.has(x.payment_reference))) {
    try {
      if (c.gateway === PAY05_GATEWAY) {
        // PAY-05 switched off: no Paynow call from a PAY-04 view (independent review S3)
        if (!isPay05Enabled(env)) continue;
        await (await paynowService()).refreshPaynowCollection({ db, env, collection: c });
      }
      else if (c.provider_payment_id) await applyProviderTruth(db, pay04AdapterFor(c.gateway, { env, provider }), c);
      else if (Date.parse(c.expires_at) <= now) await rpc(db, 'pay04_close_expired_unattached_collection', { p_collection_id: c.id });
      refreshed += 1;
    } catch {
      // stays held: the provider could not confirm it closed
    }
  }
  return { refreshed };
}

/**
 * Room on an invoice changed (a declared payment was reversed): re-project its provider money. Best effort — the
 * reversal itself already happened; money left uncounted is re-projected again on the next provider read. No-op where
 * PAY-04 is off (no provider money exists there).
 */
export async function reprojectInvoiceRoom({ db = defaultDb, env = process.env, invoiceId } = {}) {
  if (!isPay04Enabled(env) || !invoiceId) return { reprojected: false };
  try {
    const { error } = await db.rpc('pay04_reproject_invoice', { p_invoice_id: invoiceId });
    return { reprojected: !error };
  } catch {
    return { reprojected: false };
  }
}

/** Signed provider webhook: the event is a trigger and an identity; the money truth is a fresh provider read. */
export async function processGarageProviderEvent({ db = defaultDb, env = process.env, provider, event, deps = {} } = {}) {
  requirePay04Enabled(env);
  const paymentId = String(event?.data?.payment?.id || '');
  const collection = await read(db.from('pay04_garage_collections').select('*').eq('provider_payment_id', paymentId).maybeSingle(),
    'PAY04_COLLECTION_UNAVAILABLE');
  if (!collection) return { ignored: 'unknown_provider_payment', event_id: event?.id ?? null };
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  const { result } = await applyProviderTruth(db, adapter, collection, { event });
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  return { event_id: event.id, collection_id: collection.id, applied: Boolean(result?.applied), refused: result?.refused ?? null,
    duplicate_event: Boolean(result?.duplicate_event), payment_status: result?.payment_status ?? null, notification };
}

/** Used by the PAY-03B F5 operator surface: fresh provider truth for a garage collection's canonical payment. */
export async function pay04ProviderTruthForReference({ reference, db = defaultDb, env = process.env, provider = null }) {
  const collection = await read(db.from('pay04_garage_collections').select('*').eq('payment_reference', reference).maybeSingle(),
    'PAY04_COLLECTION_UNAVAILABLE');
  if (!collection || !collection.provider_payment_id) throw new Pay04Error('PAY04_COLLECTION_NOT_FOUND', 404);
  // PAY-05: a Paynow payment never enters an F5 partial-refund hold (Paynow reports no refund amounts)
  if (collection.gateway === PAY05_GATEWAY) throw new Pay05Error('PAY05_F5_NOT_APPLICABLE', 409);
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  // Taken BEFORE the read: evidence observed after this instant supersedes it (enforced in SQL).
  const verifiedAt = new Date().toISOString();
  const truth = await adapter.getPaymentTruth({ paymentId: collection.provider_payment_id });
  if (truth.amountMinor !== Number(collection.amount_minor) || truth.currency !== collection.currency) {
    throw new Pay04Error('PAY04_PROVIDER_PAYMENT_AMOUNT_MISMATCH', 409);
  }
  const account = one(await read(db.from('pay04_garage_merchant_accounts').select('merchant_reference')
    .eq('id', collection.merchant_account_id).limit(1), 'PAY04_MERCHANT_UNAVAILABLE'));
  if (!account || truth.merchantReference !== account.merchant_reference) {
    throw new Pay04Error('PAY04_PROVIDER_PAYMENT_MERCHANT_MISMATCH', 409);
  }
  const reviews = await read(db.from('pay04_garage_payment_discrepancies').select('id').eq('collection_id', collection.id)
    .eq('status', 'open').in('discrepancy_type', [...MISMATCH_TYPES]), 'PAY04_DISCREPANCIES_UNAVAILABLE');
  if (list(reviews).length) throw new Pay04Error('PAY04_PROVIDER_MISMATCH_UNDER_REVIEW', 409);
  const refundedMinor = truth.status === 'paid' ? 0 : (truth.refundedMinor ?? 0);
  const pendingRefundMinor = truth.status === 'paid' ? 0 : (truth.pendingRefundMinor ?? 0);
  return { reference, status: truth.status, intentId: truth.paymentId, refundedMinor, pendingRefundMinor,
    refundIds: truth.refundIds || [], mismatch: truth.mismatch, verifiedAt };
}

// ───────────────────────────── garage administrator ─────────────────────────────

export async function garageCollection(db, actor, collectionId) {
  const collection = await loadCollection(db, collectionId);
  if (!actor.tenantId || collection.tenant_id !== actor.tenantId) throw new Pay04Error('PAY04_COLLECTION_NOT_FOUND', 404);
  return collection;
}

export async function getGarageInvoicePayments({ db = defaultDb, env = process.env, actor = {}, invoiceId } = {}) {
  const tenantId = actor.tenantId;
  if (!tenantId) throw new Pay04Error('PAY04_TENANT_CONTEXT_REQUIRED', 400);
  const id = requireId(invoiceId, 'PAY04_INVOICE_NOT_FOUND');
  const invoice = await read(db.from('garage_invoices').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle(), 'PAY04_INVOICE_UNAVAILABLE');
  if (!invoice) throw new Pay04Error('PAY04_INVOICE_NOT_FOUND', 404);
  const money = await invoiceMoney(db, invoice.id);
  const [provider, events] = await Promise.all([
    loadProviderParts(db, [invoice.id], { includeDiscrepancies: true }),
    read(db.from('pay04_garage_collection_events').select('event_type, actor, detail, created_at, collection_id').eq('invoice_id', invoice.id)
      .order('seq', { ascending: true }), 'PAY04_PROVIDER_PAYMENTS_UNAVAILABLE'),
  ]);
  return {
    invoice_id: invoice.id, invoice_number: invoice.invoice_number, currency: invoice.currency, money,
    provider_payments_enabled: isPay04Enabled(env), provider_payments: provider.collections.get(invoice.id) || [],
    provider_receipts: provider.receipts.get(invoice.id) || [], history: list(events),
    labels: { declared: PAY04_LABELS.declaredSource, provider: PAY04_LABELS.providerSource },
  };
}

/** The garage (the merchant) refunds a provider-confirmed payment in full, through CarUp, then CarUp re-reads. */
export async function refundGarageCollection({ db = defaultDb, env = process.env, provider = null, actor = {}, collectionId, body = {}, deps = {} } = {}) {
  requirePay04Enabled(env);
  const collection = await garageCollection(db, actor, collectionId);
  // PAY-05: Paynow has no merchant refund API — the garage refunds in its Paynow dashboard; CarUp records it when Paynow reports it
  if (collection.gateway === PAY05_GATEWAY) throw new Pay05Error('PAY05_PROVIDER_REFUND_UNSUPPORTED', 409, { guidance: PAY05_LABELS.refundsInPaynow });
  const reason = pay04Reason(body.reason);
  const requested = await rpc(db, 'pay04_request_garage_collection_refund', {
    p_collection_id: collection.id, p_actor_user_id: actorIdOf(actor), p_reason: reason,
  });
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  let providerError = null;
  try {
    // one provider key per refund REQUEST: a refund the provider refused is asked for again under a new key
    await adapter.refund({ paymentId: collection.provider_payment_id, amountMinor: Number(collection.amount_minor),
      idempotencyKey: `pay04-refund-${collection.id}-${Number(requested?.request_seq) || 1}` });
  } catch (error) {
    providerError = error?.code || 'PAY04_PROVIDER_REFUND_FAILED';
  }
  // Whatever happened at the provider, the canonical state follows a fresh read: a refused refund returns the
  // payment to 'paid' (re-counted, new receipt); a confirmed one makes it 'refunded'.
  const { result } = await applyProviderTruth(db, adapter, collection);
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  const out = await collectionOutcome(db, collection, result, notification);
  // the provider refused and still holds the payment: say so — never "refund sent"
  if (providerError && out.payment_status === 'paid') throw new Pay04Error('PAY04_PROVIDER_REFUND_REFUSED', 502);
  return { ...out, refund_requested: !requested.replayed, provider_error: providerError };
}

export async function reconcileGarageCollection({ db = defaultDb, env = process.env, provider = null, actor = {}, collectionId, deps = {} } = {}) {
  requirePay04Enabled(env);
  const collection = await garageCollection(db, actor, collectionId);
  if (collection.gateway === PAY05_GATEWAY) return (await paynowService()).reconcilePaynowCollection({ db, env, collection, deps });
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  const { result } = await applyProviderTruth(db, adapter, collection);
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  return collectionOutcome(db, collection, result, notification);
}

export async function cancelGarageCollection({ db = defaultDb, env = process.env, provider = null, actor = {}, collectionId, body = {} } = {}) {
  requirePay04Enabled(env);
  const collection = await garageCollection(db, actor, collectionId);
  return cancelCollection(db, env, provider, collection, actorIdOf(actor), pay04Reason(body.reason, { min: 3 }));
}

/**
 * The garage's money, per currency, never summed across currencies: what it invoiced, what it says it received,
 * what its provider confirmed, what is still owed and what is in flight. Every figure comes from the canonical
 * functions; the list is the most recent OVERVIEW_LIMIT invoices and says so when truncated.
 */
export async function getGarageFinancialOverview({ db = defaultDb, env = process.env, actor = {} } = {}) {
  const tenantId = actor.tenantId;
  if (!tenantId) throw new Pay04Error('PAY04_TENANT_CONTEXT_REQUIRED', 400);
  const invoices = list(await read(db.from('garage_invoices').select('id, invoice_number, currency, status, total_amount, issued_at')
    .eq('tenant_id', tenantId).order('issued_at', { ascending: false }).limit(OVERVIEW_LIMIT), 'PAY04_OVERVIEW_UNAVAILABLE'));
  const monies = await Promise.all(invoices.map((i) => invoiceMoney(db, i.id)));
  const byCurrency = new Map();
  const add = (map, key, value) => map.set(key, (map.get(key) || 0) + Math.round(Number(value) * 100));
  for (const m of monies) {
    if (!byCurrency.has(m.currency)) {
      byCurrency.set(m.currency, { cents: new Map(), counts: { issued: 0, voided: 0, unpaid: 0, partially_paid: 0, paid: 0 } });
    }
    const bucket = byCurrency.get(m.currency);
    if (m.invoice_status === 'voided') { bucket.counts.voided += 1; continue; }
    bucket.counts.issued += 1;
    bucket.counts[m.payment_status] += 1;
    add(bucket.cents, 'invoiced', m.total_amount);
    add(bucket.cents, 'declared_paid', m.declared_paid);
    add(bucket.cents, 'provider_paid', m.provider_paid);
    add(bucket.cents, 'outstanding', m.balance_amount);
    add(bucket.cents, 'in_flight', m.provider_reserved);
  }
  const currencies = [...byCurrency.entries()].map(([currency, b]) => {
    const fmt = (k) => pay04Money((b.cents.get(k) || 0) / 100, currency);
    return { currency, invoiced: fmt('invoiced'), declared_paid: fmt('declared_paid'), provider_paid: fmt('provider_paid'),
      outstanding: fmt('outstanding'), in_flight: fmt('in_flight'), counts: b.counts };
  });
  const [discrepancies, merchant, instructions] = await Promise.all([
    read(db.from('pay04_garage_payment_discrepancies').select('id, discrepancy_type, status').eq('tenant_id', tenantId).eq('status', 'open'),
      'PAY04_OVERVIEW_UNAVAILABLE'),
    read(db.from('pay04_garage_merchant_accounts').select('id, gateway, status, display_name, currencies, registered_at')
      .eq('tenant_id', tenantId).order('registered_at', { ascending: false }), 'PAY04_OVERVIEW_UNAVAILABLE'),
    activeInstructions(db, tenantId),
  ]);
  // PAY-05: a Paynow merchant awaiting verification or rejected is not connected, and a simulator-mode one is simulated (ICR-W8)
  const live = list(merchant).find((m) => m.status !== 'suspended' && m.status !== 'rejected') || null;
  const collecting = live && ['simulated', 'verified'].includes(live.status);
  const paynowSimulated = live?.gateway === PAY05_GATEWAY
    ? list(await read(db.from('pay05_merchant_integrations').select('mode').eq('merchant_account_id', live.id), 'PAY04_OVERVIEW_UNAVAILABLE')).some((i) => i.mode === 'simulator')
    : false;
  return {
    currencies, truncated: invoices.length >= OVERVIEW_LIMIT, invoice_count: invoices.length,
    open_discrepancies: list(discrepancies).length,
    provider: live ? { connected: Boolean(collecting), gateway: live.gateway, simulated: live.gateway === PAY04_SIMULATOR_GATEWAY || paynowSimulated,
      display_name: live.display_name, currencies: live.currencies, status: live.status } : { connected: false },
    provider_payments_enabled: isPay04Enabled(env),
    payment_instructions: instructions,
    revenue_owner_note: 'All amounts are the garage’s own invoices and receipts. CarUp is not paid any of this money.',
    labels: { declared: PAY04_LABELS.declaredSource, provider: PAY04_LABELS.providerSource },
  };
}

// ───────────────────────────── platform operator ─────────────────────────────

export async function listGaragePaymentExceptions({ db = defaultDb, env = process.env } = {}) {
  requirePay04Enabled(env);
  const [discrepancies, holds] = await Promise.all([
    read(db.from('pay04_garage_payment_discrepancies').select('*').eq('status', 'open').order('first_detected_at', { ascending: false }),
      'PAY04_EXCEPTIONS_UNAVAILABLE'),
    read(db.from('pay03b_payment_reconciliation_exceptions').select('id, payment_reference, status, gateway, payment_amount_minor, currency, mismatch, detected_refunded_minor, detected_pending_refund_minor, first_detected_at, observation_count, acknowledged_at')
      .eq('gateway', PAY04_SIMULATOR_GATEWAY).eq('status', 'open'), 'PAY04_EXCEPTIONS_UNAVAILABLE'),
  ]);
  const tenantIds = [...new Set(list(discrepancies).map((d) => d.tenant_id))];
  const refs = list(holds).map((h) => h.payment_reference);
  const discrepancyCollectionIds = [...new Set(list(discrepancies).map((d) => d.collection_id))];
  // which provider each review concerns: the operator's options differ for Paynow (independent review, D3a)
  const gateways = new Map(list(discrepancyCollectionIds.length ? await read(db.from('pay04_garage_collections').select('id, gateway')
    .in('id', discrepancyCollectionIds), 'PAY04_EXCEPTIONS_UNAVAILABLE') : []).map((c) => [c.id, c.gateway]));
  const [tenants, holdCollections] = await Promise.all([
    tenantIds.length ? read(db.from('tenants').select('id, name').in('id', tenantIds), 'PAY04_EXCEPTIONS_UNAVAILABLE') : [],
    refs.length ? read(db.from('pay04_garage_collections').select('id, tenant_id, invoice_id, payment_reference').in('payment_reference', refs),
      'PAY04_EXCEPTIONS_UNAVAILABLE') : [],
  ]);
  const nameOf = new Map(list(tenants).map((t) => [t.id, t.name]));
  const collectionOf = new Map(list(holdCollections).map((c) => [c.payment_reference, c]));
  // the audit trail of every collection under review (append-only pay04_garage_collection_events)
  const trailIds = [...new Set([...list(discrepancies).map((d) => d.collection_id), ...list(holdCollections).map((c) => c.id)])];
  const events = trailIds.length ? list(await read(db.from('pay04_garage_collection_events').select('collection_id, event_type, actor, detail, created_at')
    .in('collection_id', trailIds).order('seq', { ascending: true }), 'PAY04_EXCEPTIONS_UNAVAILABLE')) : [];
  const trailOf = (collectionId) => events.filter((e) => e.collection_id === collectionId)
    .map(({ event_type, actor, detail, created_at }) => ({ event_type, actor, detail, created_at }));
  return {
    discrepancies: list(discrepancies).map((d) => ({
      id: d.id, type: d.discrepancy_type, garage: nameOf.get(d.tenant_id) || null, tenant_id: d.tenant_id, invoice_id: d.invoice_id,
      collection_id: d.collection_id, gateway: gateways.get(d.collection_id) ?? null, amount: pay04Money(d.detected_amount, d.currency), currency: d.currency, evidence: d.evidence,
      detected_via: d.detected_via, first_detected_at: d.first_detected_at, observation_count: d.observation_count,
      history: trailOf(d.collection_id),
    })),
    reconciliation_holds: list(holds).map((h) => ({
      ...h, collection: collectionOf.get(h.payment_reference) || null, resolve_via: '/api/pay03b/admin/reconciliation-exceptions',
      history: collectionOf.get(h.payment_reference) ? trailOf(collectionOf.get(h.payment_reference).id) : [],
    })),
  };
}

export async function resolveGaragePaymentDiscrepancy({ db = defaultDb, env = process.env, actor = {}, discrepancyId, body = {} } = {}) {
  requirePay04Enabled(env);
  const id = requireId(discrepancyId, 'PAY04_DISCREPANCY_NOT_FOUND');
  const resolution = String(body.resolution || '');
  // 'acknowledged' is offered by the database and the operator UI (PAY-04 refund_after_resolution; PAY-05 reviews) but was
  // refused here (independent review D9)
  if (!['refunded_to_customer', 'settled_off_platform', 'provider_corrected', 'acknowledged'].includes(resolution)) {
    throw new Pay04Error('PAY04_RESOLUTION_INVALID', 422);
  }
  return rpc(db, 'pay04_resolve_garage_payment_discrepancy', {
    p_discrepancy_id: id, p_resolution: resolution, p_actor_id: actorIdOf(actor), p_actor_role: actor.platformRole || 'admin',
    p_note: pay04Reason(body.note, { max: 1000 }),
  });
}

export async function listGarageMerchantAccounts({ db = defaultDb, env = process.env } = {}) {
  requirePay04Enabled(env);
  const rows = list(await read(db.from('pay04_garage_merchant_accounts').select('*').order('registered_at', { ascending: false }),
    'PAY04_MERCHANT_UNAVAILABLE'));
  return { accounts: rows, simulated_only: true,
    note: 'Level 1: only simulated garage merchant accounts exist. A real provider needs the garage’s merchant contract and Owner authority.' };
}

export async function registerGarageMerchantAccount({ db = defaultDb, env = process.env, actor = {}, body = {} } = {}) {
  requirePay04Enabled(env);
  const row = one(await rpc(db, 'pay04_register_garage_merchant_account', {
    p_tenant_id: requireId(body.tenant_id, 'PAY04_GARAGE_NOT_ACTIVE'), p_gateway: String(body.gateway || PAY04_SIMULATOR_GATEWAY),
    p_merchant_reference: String(body.merchant_reference || ''), p_display_name: String(body.display_name || ''),
    p_currencies: Array.isArray(body.currencies) ? body.currencies.map(String) : [], p_actor_id: actorIdOf(actor),
    p_actor_role: actor.platformRole || 'admin', p_authority_note: String(body.authority_note || ''),
  }));
  return { account: row };
}

export async function suspendGarageMerchantAccount({ db = defaultDb, env = process.env, actor = {}, accountId, body = {} } = {}) {
  requirePay04Enabled(env);
  const row = one(await rpc(db, 'pay04_suspend_garage_merchant_account', {
    p_account_id: requireId(accountId, 'PAY04_MERCHANT_ACCOUNT_NOT_FOUND'), p_actor_id: actorIdOf(actor),
    p_actor_role: actor.platformRole || 'admin', p_reason: pay04Reason(body.reason),
  }));
  return { account: row };
}

export default {
  getCustomerInvoicePayment, startGarageInvoicePayment, verifyCustomerCollection, cancelCustomerCollection,
  processGarageProviderEvent, pay04ProviderTruthForReference, getGarageInvoicePayments, refundGarageCollection,
  reconcileGarageCollection, cancelGarageCollection, getGarageFinancialOverview, getGaragePaymentInstructions,
  setGaragePaymentInstructions, listGaragePaymentExceptions, resolveGaragePaymentDiscrepancy, listGarageMerchantAccounts,
  registerGarageMerchantAccount, suspendGarageMerchantAccount, loadProviderParts, invoiceMoney, collectionState,
};
