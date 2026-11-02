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
  PAY04_LABELS, PAY04_SIMULATOR_GATEWAY, Pay04Error, isPay04Enabled, pay04Failure, pay04IdempotencyKey, pay04Money,
  pay04Reason, requirePay04Enabled,
} from './pay04Contract.js';
import { pay04AdapterFor } from './pay04ProviderAdapters.js';

const COLLECTION_TTL_SECONDS = 1800;
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
export function collectionState(collection, payment, { now = Date.now(), openDiscrepancies = [] } = {}) {
  const status = payment?.status || 'unknown';
  if (status === 'pending') {
    if (openDiscrepancies.some((d) => d.discrepancy_type !== 'unallocated_provider_money')) return 'under_review';
    if (collection.cancelled_at) return 'stopped';
    if (Date.parse(collection.expires_at) <= now) return 'expired';
    return 'awaiting_provider';
  }
  if (status === 'paid') return openDiscrepancies.some((d) => d.discrepancy_type === 'unallocated_provider_money') ? 'confirmed_unallocated' : 'confirmed';
  if (status === 'reconciliation_hold') return 'under_review';
  return status; // refund_pending, refunded, partially_refunded, cancelled
}

const STATE_LABELS = Object.freeze({
  awaiting_provider: 'Waiting for the provider to confirm',
  stopped: 'Stopped before payment',
  expired: 'Checkout expired before payment',
  confirmed: 'Confirmed by the provider',
  confirmed_unallocated: 'Confirmed by the provider — not counted on this invoice (under review)',
  under_review: 'Under review — not counted',
  refund_pending: 'Refund in progress — not counted',
  refunded: 'Refunded to the customer',
  partially_refunded: 'Partly refunded — the remainder counts',
  cancelled: 'Cancelled by the provider',
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
  const openByCollection = new Map();
  for (const d of list(discrepancies).filter((x) => x.status === 'open')) {
    openByCollection.set(d.collection_id, [...(openByCollection.get(d.collection_id) || []), d]);
  }
  const ownCollectionIds = new Set(ids);
  const out = { available: true, collections: new Map(), receipts: new Map() };
  for (const c of rows) {
    const payment = paymentByRef.get(c.payment_reference) || null;
    const open = openByCollection.get(c.id) || [];
    const state = collectionState(c, payment, { openDiscrepancies: open });
    const view = {
      id: c.id, amount: pay04Money(c.amount, c.currency), currency: c.currency, initiated_at: c.initiated_at,
      expires_at: c.expires_at, cancelled_at: c.cancelled_at ?? null, state, state_label: STATE_LABELS[state] || STATE_LABELS.unknown,
      payment_status: payment?.status ?? null, gateway: c.gateway, simulated: c.gateway === PAY04_SIMULATOR_GATEWAY,
      source_label: PAY04_LABELS.providerSource,
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

async function customerInvoice(db, userId, invoiceId) {
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
  const account = await read(db.from('pay04_garage_merchant_accounts').select('id, gateway, status, currencies, display_name')
    .eq('tenant_id', invoice.tenant_id).eq('status', 'simulated').maybeSingle(), 'PAY04_MERCHANT_UNAVAILABLE');
  if (!account) return { available: false, reason: 'garage_not_connected' };
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

export async function getCustomerInvoicePayment({ db = defaultDb, env = process.env, actor = {}, invoiceId } = {}) {
  const userId = actorIdOf(actor);
  const invoice = await customerInvoice(db, userId, invoiceId);
  const money = await invoiceMoney(db, invoice.id);
  const [instructions, provider, option] = await Promise.all([
    activeInstructions(db, invoice.tenant_id),
    loadProviderParts(db, [invoice.id], { payerUserId: userId }),
    onlinePaymentOption(db, env, invoice, money),
  ]);
  return {
    invoice_id: invoice.id, invoice_number: invoice.invoice_number, status: invoice.status, currency: invoice.currency,
    money, payment_instructions: instructions, instructions_missing_label: instructions ? null : PAY04_LABELS.noInstructions,
    online_payment: option, provider_payments: provider.collections.get(invoice.id) || [],
    provider_receipts: provider.receipts.get(invoice.id) || [],
    labels: { declared: PAY04_LABELS.declaredSource, provider: PAY04_LABELS.providerSource, in_flight: PAY04_LABELS.inFlight },
  };
}

function returnOrigin(env) {
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
  const money = await invoiceMoney(db, invoice.id);
  const raw = body.amount === undefined || body.amount === null || body.amount === '' ? money.uncommitted_balance : String(body.amount).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(raw)) throw new Pay04Error('PAY04_AMOUNT_INVALID', 422);
  const begun = await rpc(db, 'pay04_begin_garage_collection', {
    p_invoice_id: invoice.id, p_payer_user_id: userId, p_amount: raw, p_currency: invoice.currency, p_idempotency_key: key,
    p_ttl_seconds: COLLECTION_TTL_SECONDS,
  });
  const collection = begun.collection;
  const account = await read(db.from('pay04_garage_merchant_accounts').select('merchant_reference, gateway')
    .eq('id', collection.merchant_account_id).maybeSingle(), 'PAY04_MERCHANT_UNAVAILABLE');
  if (!account) throw new Pay04Error('PAY04_MERCHANT_UNAVAILABLE', 503);
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  const origin = returnOrigin(env);
  const back = `${origin}/dashboard/service-invoices?invoice=${invoice.id}&collection=${collection.id}`;
  const checkout = await adapter.createCheckout({
    collectionId: collection.id, merchantReference: account.merchant_reference, amountMinor: Number(collection.amount_minor),
    currency: collection.currency, successUrl: `${back}&pay04=returned`, cancelUrl: `${back}&pay04=cancelled`,
  });
  await rpc(db, 'pay04_attach_garage_collection', {
    p_collection_id: collection.id, p_provider_checkout_id: checkout.checkoutId, p_provider_payment_id: checkout.paymentId,
  });
  return {
    collection_id: collection.id, checkout_url: checkout.url, replayed: Boolean(begun.replayed),
    simulated: collection.gateway === PAY04_SIMULATOR_GATEWAY, amount: pay04Money(collection.amount, collection.currency),
    currency: collection.currency, expires_at: collection.expires_at, money: moneyView(begun.money),
    notice: PAY04_LABELS.inFlight,
  };
}

// ───────────────────────────── provider truth -> the one governed writer ─────────────────────────────

async function loadCollection(db, collectionId) {
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
async function notifyCollectionOutcome(db, collection, result, deps = {}) {
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

async function collectionOutcome(db, collection, result, notification) {
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
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  const { result } = await applyProviderTruth(db, adapter, collection);
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  const out = await collectionOutcome(db, collection, result, notification);
  // the customer sees their payment's state, not the garage's discrepancy detail
  if (out.collection) {
    delete out.collection.open_discrepancies; delete out.collection.payer_user_id;
    delete out.collection.payment_reference; delete out.collection.provider_payment_id;
  }
  return out;
}

export async function cancelCustomerCollection({ db = defaultDb, env = process.env, provider = null, actor = {}, collectionId, body = {} } = {}) {
  requirePay04Enabled(env);
  const userId = actorIdOf(actor);
  const collection = await loadCollection(db, collectionId);
  if (collection.payer_user_id !== userId) throw new Pay04Error('PAY04_COLLECTION_NOT_FOUND', 404);
  return cancelCollection(db, env, provider, collection, userId, pay04Reason(body.reason ?? 'Stopped by the customer', { min: 3 }));
}

async function cancelCollection(db, env, provider, collection, actorUserId, reason) {
  await rpc(db, 'pay04_cancel_garage_collection', { p_collection_id: collection.id, p_actor_user_id: actorUserId, p_reason: reason });
  let result = null;
  if (collection.provider_checkout_id) {
    const adapter = pay04AdapterFor(collection.gateway, { env, provider });
    await adapter.cancelCheckout(collection.provider_checkout_id);
    ({ result } = await applyProviderTruth(db, adapter, collection));
  }
  return collectionOutcome(db, collection, result, { attempted: 0, emitted: 0, failures: [] });
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
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  // Taken BEFORE the read: evidence observed after this instant supersedes it (enforced in SQL).
  const verifiedAt = new Date().toISOString();
  const truth = await adapter.getPaymentTruth({ paymentId: collection.provider_payment_id });
  if (truth.amountMinor !== Number(collection.amount_minor) || truth.currency !== collection.currency) {
    throw new Pay04Error('PAY04_PROVIDER_PAYMENT_AMOUNT_MISMATCH', 409);
  }
  const refundedMinor = truth.status === 'paid' ? 0 : (truth.refundedMinor ?? 0);
  const pendingRefundMinor = truth.status === 'paid' ? 0 : (truth.pendingRefundMinor ?? 0);
  return { reference, status: truth.status, intentId: truth.paymentId, refundedMinor, pendingRefundMinor,
    refundIds: truth.refundIds || [], mismatch: truth.mismatch, verifiedAt };
}

// ───────────────────────────── garage administrator ─────────────────────────────

async function garageCollection(db, actor, collectionId) {
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
  const reason = pay04Reason(body.reason);
  const requested = await rpc(db, 'pay04_request_garage_collection_refund', {
    p_collection_id: collection.id, p_actor_user_id: actorIdOf(actor), p_reason: reason,
  });
  const adapter = pay04AdapterFor(collection.gateway, { env, provider });
  let providerError = null;
  try {
    await adapter.refund({ paymentId: collection.provider_payment_id, amountMinor: Number(collection.amount_minor),
      idempotencyKey: `pay04-refund-${collection.id}` });
  } catch (error) {
    providerError = error?.code || 'PAY04_PROVIDER_REFUND_FAILED';
  }
  // Whatever happened at the provider, the canonical state follows a fresh read: a refused refund returns the
  // payment to 'paid' (re-counted, new receipt); a confirmed one makes it 'refunded'.
  const { result } = await applyProviderTruth(db, adapter, collection);
  const notification = await notifyCollectionOutcome(db, collection, result, deps);
  const out = await collectionOutcome(db, collection, result, notification);
  return { ...out, refund_requested: !requested.replayed, provider_error: providerError };
}

export async function reconcileGarageCollection({ db = defaultDb, env = process.env, provider = null, actor = {}, collectionId, deps = {} } = {}) {
  requirePay04Enabled(env);
  const collection = await garageCollection(db, actor, collectionId);
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
  const live = list(merchant).find((m) => m.status !== 'suspended') || null;
  return {
    currencies, truncated: invoices.length >= OVERVIEW_LIMIT, invoice_count: invoices.length,
    open_discrepancies: list(discrepancies).length,
    provider: live ? { connected: true, gateway: live.gateway, simulated: live.gateway === PAY04_SIMULATOR_GATEWAY,
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
  const [tenants, holdCollections] = await Promise.all([
    tenantIds.length ? read(db.from('tenants').select('id, name').in('id', tenantIds), 'PAY04_EXCEPTIONS_UNAVAILABLE') : [],
    refs.length ? read(db.from('pay04_garage_collections').select('id, tenant_id, invoice_id, payment_reference').in('payment_reference', refs),
      'PAY04_EXCEPTIONS_UNAVAILABLE') : [],
  ]);
  const nameOf = new Map(list(tenants).map((t) => [t.id, t.name]));
  const collectionOf = new Map(list(holdCollections).map((c) => [c.payment_reference, c]));
  return {
    discrepancies: list(discrepancies).map((d) => ({
      id: d.id, type: d.discrepancy_type, garage: nameOf.get(d.tenant_id) || null, tenant_id: d.tenant_id, invoice_id: d.invoice_id,
      collection_id: d.collection_id, amount: pay04Money(d.detected_amount, d.currency), currency: d.currency, evidence: d.evidence,
      detected_via: d.detected_via, first_detected_at: d.first_detected_at, observation_count: d.observation_count,
    })),
    reconciliation_holds: list(holds).map((h) => ({
      ...h, collection: collectionOf.get(h.payment_reference) || null, resolve_via: '/api/pay03b/admin/reconciliation-exceptions',
    })),
  };
}

export async function resolveGaragePaymentDiscrepancy({ db = defaultDb, env = process.env, actor = {}, discrepancyId, body = {} } = {}) {
  requirePay04Enabled(env);
  const id = requireId(discrepancyId, 'PAY04_DISCREPANCY_NOT_FOUND');
  const resolution = String(body.resolution || '');
  if (!['refunded_to_customer', 'settled_off_platform', 'provider_corrected'].includes(resolution)) {
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
