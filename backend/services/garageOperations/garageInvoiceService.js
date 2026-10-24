import { randomUUID } from 'node:crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import { GARAGE_ADMIN_ROLES, requireGarageTenant } from '../serviceNetwork/serviceAuthority.js';
import { followedCases } from './garageEstimateService.js';
import { GARAGE_NOTIFICATION_EVENTS, notifyCaseAudience } from './garageNotificationService.js';
import {
  ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError,
} from '../../utils/errors.js';
import { moneyAmount, quantityValue, requireCurrency, sumMoney } from '../../utils/garageMoney.js';

/**
 * GARAGE-1.0 OPS07 — commercial closeout: invoice, payment record, receipt.
 *
 *  - An invoice is a document. It is never evidence of payment.
 *  - A payment record is what the garage SAYS it received off-platform; every view says so.
 *  - Payment state is read from the payment records (the database derives it); it is never inferred
 *    from completion, invoicing, an authorization or a reference string.
 *  - Estimate, actual work, invoice and payment are separate facts. The closeout statement shows them
 *    side by side; it never copies an estimate into history, converts a currency, or sums across them.
 */

export const PAYMENT_METHODS = Object.freeze(['cash', 'bank_transfer', 'mobile_money', 'card_external', 'other']);
export const PAYMENT_SOURCE_LABEL = 'Recorded by the garage. CarUp has not processed or verified this payment.';

const MESSAGES = Object.freeze({
  WORK_ORDER_NOT_FOUND: 'That job could not be found.',
  INVOICE_NOT_FOUND: 'That invoice could not be found.',
  PAYMENT_NOT_FOUND: 'That payment could not be found.',
  JOB_NOT_COMPLETED: 'An invoice can be issued once the job is complete.',
  INVOICE_ALREADY_ISSUED: 'This job already has an invoice. Void it first if it needs to be re-issued.',
  INVOICE_NOT_PAYABLE: 'This invoice is not open for payment records.',
  INVOICE_HAS_PAYMENTS: 'This invoice has payments recorded against it. Reverse them before voiding.',
  PAYMENT_EXCEEDS_BALANCE: 'That is more than the invoice balance.',
  PAYMENT_ALREADY_REVERSED: 'That payment has already been reversed.',
  CURRENCY_MISMATCH: 'The payment currency must match the invoice currency. Amounts are never converted.',
  CURRENCY_UNSUPPORTED: 'That currency cannot be recorded exactly.',
  AMOUNT_INVALID: 'The amount must be positive and have no more decimal places than the currency allows.',
  METHOD_INVALID: 'Choose how the payment was made.',
  PAID_AT_INVALID: 'The payment date cannot be in the future (or before 2020).',
  REASON_REQUIRED: 'Give a reason.',
  IDEMPOTENCY_CONFLICT: 'This request was already used for a different payment. Start again.',
  TOTAL_MUST_BE_POSITIVE: 'The invoice total must be greater than zero.',
  LINE_NOT_PRICED: 'Every invoice line needs a price.',
  LINES_INVALID: 'Add at least one invoice line.',
  TOO_MANY_LINES: 'An invoice can have at most 100 lines.',
  LINE_CATEGORY_INVALID: 'A line category must be labour, part, fee or other.',
  LINE_DESCRIPTION_INVALID: 'Every line needs a description (up to 300 characters).',
  LINE_QUANTITY_INVALID: 'Every line needs a positive quantity.',
  LINE_PRICE_INVALID: 'A price cannot be negative.',
  LINE_NUMBER_INVALID: 'A quantity or price is not a valid number.',
  LINE_SOURCE_INVALID: 'A line\'s source is not valid.',
  AMOUNT_EXCEEDS_CURRENCY_PRECISION: 'An amount has more decimal places than the currency allows.',
  DUE_DATE_INVALID: 'The due date cannot be in the past.',
});
const CONFLICT = new Set([
  'JOB_NOT_COMPLETED', 'INVOICE_ALREADY_ISSUED', 'INVOICE_NOT_PAYABLE', 'INVOICE_HAS_PAYMENTS', 'PAYMENT_EXCEEDS_BALANCE',
  'PAYMENT_ALREADY_REVERSED', 'IDEMPOTENCY_CONFLICT',
]);
const NOT_FOUND = new Set(['WORK_ORDER_NOT_FOUND', 'INVOICE_NOT_FOUND', 'PAYMENT_NOT_FOUND']);

const adminTenant = (actor) => requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}
const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);
const list = (data) => (Array.isArray(data) ? data : data ? [data] : []);

export function invoiceFailure(error, fallback = 'Could not complete the invoice action') {
  const message = String(error?.message || error || '');
  if (/GARAGE_OPS03_ADMIN_REQUIRED/.test(message)) return new ForbiddenError('Only a garage administrator can do that.');
  const match = /GARAGE_OPS07_([A-Z_]+)/.exec(message);
  if (match) {
    const token = match[1];
    let text = MESSAGES[token] || token.toLowerCase().replaceAll('_', ' ');
    if (token === 'PAYMENT_EXCEEDS_BALANCE') {
      const d = /balance=([0-9.]+)/.exec(String(error?.details ?? error?.detail ?? ''));
      if (d) text = `That is more than the invoice balance (${d[1]} remaining).`;
    }
    if (NOT_FOUND.has(token)) return new NotFoundError(text);
    if (CONFLICT.has(token)) return new ConflictError(text);
    return new ValidationError(text);
  }
  if (error?.code === '23505') return new ConflictError(MESSAGES.INVOICE_ALREADY_ISSUED);
  return new DatabaseError(`${fallback}: ${message || 'database error'}`);
}

function text(value, label, max, { required = false } = {}) {
  const t = String(value ?? '').trim();
  if (!t) {
    if (required) throw new ValidationError(`${label} is required`);
    return null;
  }
  if (t.length > max) throw new ValidationError(`${label} must be at most ${max} characters`);
  return t;
}
function idempotencyKey(provided) {
  if (provided === undefined || provided === null || provided === '') return randomUUID();
  const k = String(provided).trim();
  if (k.length < 8 || k.length > 120) throw new ValidationError('Idempotency-Key must be 8 to 120 characters');
  return k;
}

function normalizeInvoiceLines(raw, currency) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError('Add at least one invoice line');
  if (raw.length > 100) throw new ValidationError('An invoice can have at most 100 lines');
  return raw.map((l, i) => {
    const n = i + 1;
    if (!l || typeof l !== 'object') throw new ValidationError(`Line ${n} is malformed`);
    const category = String(l.category ?? '').trim();
    if (!['labour', 'part', 'fee', 'other'].includes(category)) throw new ValidationError(`Line ${n}: category must be labour, part, fee or other`);
    const sourceKind = l.source_kind ? String(l.source_kind) : 'manual';
    if (!['manual', 'service_record', 'part_usage'].includes(sourceKind)) throw new ValidationError(`Line ${n}: unknown source`);
    return {
      category,
      description: text(l.description, `Line ${n} description`, 300, { required: true }),
      quantity: quantityValue(l.quantity, `Line ${n} quantity`),
      // an invoice states amounts: a missing price is an error here, never a silent zero
      unit_price: moneyAmount(l.unit_price, `Line ${n} price`, currency),
      source_kind: sourceKind,
      source_id: sourceKind === 'manual' ? null : text(l.source_id, `Line ${n} source`, 80, { required: true }),
    };
  });
}

// ───────────────────────────── views ─────────────────────────────

function paymentView(p) {
  return {
    id: p.id, kind: p.kind, amount: p.amount, currency: p.currency, method: p.method,
    reference: p.reference ?? null, paid_at: p.paid_at, recorded_at: p.recorded_at,
    source: p.source, source_label: PAYMENT_SOURCE_LABEL, reverses_payment_id: p.reverses_payment_id ?? null,
    reason: p.reason ?? null,
  };
}
function receiptView(r) {
  return {
    id: r.id, receipt_number: r.receipt_number, payment_id: r.payment_id, amount: r.amount, currency: r.currency,
    status: r.status, issued_at: r.issued_at, voided_at: r.voided_at ?? null,
    payment_source: r.payment_source, payment_source_label: PAYMENT_SOURCE_LABEL,
  };
}
function lineView(l) {
  return { line_no: l.line_no, category: l.category, description: l.description, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total };
}

/** Variance between the ACCEPTED estimate and the invoiced total. Only ever same-currency. */
export function varianceOf(invoice) {
  if (!invoice || invoice.estimate_id === null || invoice.estimate_id === undefined) return { state: 'no_estimate' };
  if (invoice.estimate_currency !== invoice.currency) {
    return { state: 'not_comparable', reason: 'The estimate and the invoice are in different currencies; amounts are never converted.' };
  }
  const cents = (v) => Math.round(Number(v) * 100);
  const diff = cents(invoice.total_amount) - cents(invoice.estimate_total_amount);
  const abs = (Math.abs(diff) / 100).toFixed(2);
  return {
    state: 'comparable',
    currency: invoice.currency,
    estimate_total: invoice.estimate_total_amount,
    invoice_total: invoice.total_amount,
    difference: diff === 0 ? '0.00' : `${diff > 0 ? '+' : '-'}${abs}`,
    direction: diff === 0 ? 'same' : (diff > 0 ? 'over_estimate' : 'under_estimate'),
  };
}

async function balanceOf(client, invoiceId) {
  const { data, error } = await client.rpc('garage_ops07_invoice_balance', { p_invoice_id: invoiceId });
  if (error) throw invoiceFailure(error, 'Could not compute the invoice balance');
  const b = one(data);
  if (!b) throw new NotFoundError('Invoice not found');
  return { payment_status: b.payment_status, paid_amount: b.paid_amount, balance_amount: b.balance_amount };
}

async function loadInvoiceParts(client, invoiceIds) {
  const [lines, payments, receipts] = await Promise.all([
    client.from('garage_invoice_lines').select('invoice_id, line_no, category, description, quantity, unit_price, line_total').in('invoice_id', invoiceIds).order('line_no', { ascending: true }),
    client.from('garage_payment_records').select('id, seq, invoice_id, kind, amount, currency, method, reference, paid_at, recorded_at, source, reverses_payment_id, reason').in('invoice_id', invoiceIds).order('seq', { ascending: true }),
    client.from('garage_receipts').select('id, invoice_id, payment_id, receipt_number, amount, currency, status, issued_at, voided_at, payment_source').in('invoice_id', invoiceIds).order('issued_at', { ascending: true }),
  ]);
  for (const r of [lines, payments, receipts]) if (r.error) throw new DatabaseError('Could not load invoice details: ' + r.error.message);
  const group = (rows) => { const m = new Map(); for (const x of list(rows)) { if (!m.has(x.invoice_id)) m.set(x.invoice_id, []); m.get(x.invoice_id).push(x); } return m; };
  return { lines: group(lines.data), payments: group(payments.data), receipts: group(receipts.data) };
}

async function invoiceView(client, inv, parts, { forCustomer = false } = {}) {
  const bal = await balanceOf(client, inv.id);
  const base = {
    id: inv.id,
    invoice_number: inv.invoice_number,
    service_case_id: inv.service_case_id,
    work_order_id: inv.work_order_id,
    status: inv.status,
    currency: inv.currency,
    total_amount: inv.total_amount,
    line_count: inv.line_count,
    customer_note: inv.customer_note ?? null,
    due_date: inv.due_date ?? null,
    issued_at: inv.issued_at,
    voided_at: inv.voided_at ?? null,
    void_reason: forCustomer ? undefined : (inv.void_reason ?? null),
    estimate: inv.estimate_id ? { version: inv.estimate_version, total_amount: inv.estimate_total_amount, currency: inv.estimate_currency } : null,
    variance: varianceOf(inv),
    payment_status: bal.payment_status,
    paid_amount: bal.paid_amount,
    balance_amount: bal.balance_amount,
    payment_source_label: PAYMENT_SOURCE_LABEL,
    lines: (parts.lines.get(inv.id) || []).map(lineView),
    payments: (parts.payments.get(inv.id) || []).map(paymentView),
    receipts: (parts.receipts.get(inv.id) || []).map(receiptView),
  };
  if (forCustomer) { delete base.void_reason; return base; }
  return { ...base, internal_note: inv.internal_note ?? null, issued_by_user_id: inv.issued_by_user_id };
}

// ───────────────────────────── garage side ─────────────────────────────

async function garageCaseJob(client, tenantId, caseId) {
  const id = String(caseId ?? '').trim();
  if (!id) throw new ValidationError('service case id is required');
  const { data: c, error } = await client.from('service_cases')
    .select('id, vin, status, requester_user_id, garage_tenant_id, completed_at, started_at, accepted_at')
    .eq('id', id).eq('garage_tenant_id', tenantId).maybeSingle();
  if (error) throw new DatabaseError('Could not load the service case: ' + error.message);
  if (!c) throw new NotFoundError('Service case not found');
  const { data: wo, error: woError } = await client.from('mechanic_work_orders')
    .select('id, status, owner_authorization, completed_at').eq('service_case_id', c.id).eq('tenant_id', tenantId).maybeSingle();
  if (woError) throw new DatabaseError('Could not load the job: ' + woError.message);
  return { serviceCase: c, workOrder: wo || null };
}

/** A SUGGESTION from what was actually recorded. Nothing here is committed or converted. */
export function suggestLines({ records, usage }) {
  const notes = [];
  const currencies = new Set();
  const lines = [];
  for (const r of records) {
    if (r.total_cost !== null && r.total_cost !== undefined) {
      currencies.add(r.currency);
      lines.push({
        category: 'labour',
        description: `Service${r.service_category ? ` — ${r.service_category}` : ''}`,
        quantity: '1', unit_price: String(r.total_cost), currency: r.currency, source_kind: 'service_record', source_id: r.id,
      });
    } else {
      notes.push('A service record has no recorded cost; price it yourself — a missing cost is not zero.');
      lines.push({
        category: 'labour', description: `Service${r.service_category ? ` — ${r.service_category}` : ''}`,
        quantity: '1', unit_price: null, currency: null, source_kind: 'service_record', source_id: r.id,
      });
    }
  }
  for (const u of usage.filter((x) => !x.reversed_at)) {
    if (u.sell_price_snapshot !== null && u.sell_price_snapshot !== undefined) currencies.add(u.price_currency_snapshot);
    lines.push({
      category: 'part', description: u.part_name_snapshot, quantity: String(u.quantity),
      unit_price: u.sell_price_snapshot ?? null, currency: u.price_currency_snapshot ?? null,
      source_kind: 'part_usage', source_id: u.id,
    });
    if (u.sell_price_snapshot === null || u.sell_price_snapshot === undefined) {
      notes.push(`${u.part_name_snapshot}: no sell price was recorded — price it yourself; it is not free.`);
    }
  }
  const codes = [...currencies].filter(Boolean);
  let currency = null;
  if (codes.length === 1) currency = codes[0];
  if (codes.length > 1) notes.push(`Amounts were recorded in different currencies (${codes.join(', ')}). They are never converted: choose one invoice currency and price the lines in it.`);
  // lines priced in another currency than the chosen one are returned unpriced
  const usable = lines.map((l) => (l.currency && currency && l.currency !== currency ? { ...l, unit_price: null } : l));
  return { currency, lines: usable.map(({ currency: _c, ...rest }) => rest), notes: [...new Set(notes)] };
}

/** The whole commercial picture of a job — estimate, actual, invoice, payment — as separate facts. */
export async function getCloseout(client = defaultClient, actor = {}, caseId) {
  const tenantId = adminTenant(actor);
  const { serviceCase, workOrder } = await garageCaseJob(client, tenantId, caseId);
  const empty = {
    service_case_id: serviceCase.id, case_status: serviceCase.status,
    work_order: workOrder ? { id: workOrder.id, status: workOrder.status, owner_authorization: workOrder.owner_authorization } : null,
    estimate: null, actual_work: [], parts_used: [], recorded_cost_by_currency: [], suggested_invoice: null, invoice: null,
    can_issue_invoice: false, payment_source_label: PAYMENT_SOURCE_LABEL,
  };
  if (!workOrder) return empty;

  const [est, recs, usage, inv] = await Promise.all([
    client.from('garage_estimates').select('id, version, status, currency, sent_total_amount').eq('work_order_id', workOrder.id).eq('tenant_id', tenantId).in('status', ['accepted', 'sent', 'declined']).order('version', { ascending: false }),
    client.from('service_records').select('id, service_category, service_authority, total_cost, currency, performed_at').eq('work_order_id', workOrder.id).eq('tenant_id', tenantId).order('performed_at', { ascending: true }),
    client.from('garage_service_part_usage').select('id, service_record_id, part_id, quantity, part_name_snapshot, part_sku_snapshot, unit_cost_snapshot, sell_price_snapshot, price_currency_snapshot, reversed_at').eq('work_order_id', workOrder.id).eq('tenant_id', tenantId).order('created_at', { ascending: true }),
    client.from('garage_invoices').select('*').eq('work_order_id', workOrder.id).eq('tenant_id', tenantId).order('issued_at', { ascending: false }),
  ]);
  for (const r of [est, recs, usage, inv]) if (r.error) throw new DatabaseError('Could not load the closeout: ' + r.error.message);

  const estimates = list(est.data);
  const accepted = estimates.find((e) => e.status === 'accepted') || null;
  const records = list(recs.data);
  const usages = list(usage.data);
  const invoices = list(inv.data);
  const live = invoices.find((i) => i.status === 'issued') || null;

  const byCurrency = new Map();
  for (const r of records) {
    if (r.total_cost === null || r.total_cost === undefined) continue;
    byCurrency.set(r.currency, [...(byCurrency.get(r.currency) || []), String(r.total_cost)]);
  }
  const jobDone = serviceCase.status === 'completed' && String(workOrder.status).toLowerCase() === 'completed';
  const out = {
    ...empty,
    estimate: accepted ? { id: accepted.id, version: accepted.version, currency: accepted.currency, total_amount: accepted.sent_total_amount } : null,
    // what was ACTUALLY done (the private work narrative stays private: not exposed here)
    actual_work: records.map((r) => ({
      service_record_id: r.id, service_category: r.service_category, service_authority: r.service_authority,
      performed_at: r.performed_at, cost: r.total_cost === null || r.total_cost === undefined ? null : { amount: String(r.total_cost), currency: r.currency },
    })),
    parts_used: usages.map((u) => ({ ...u, active: !u.reversed_at })),
    recorded_cost_by_currency: [...byCurrency.entries()].map(([currency, vals]) => ({ currency, total: sumMoney(vals, currency) })),
    suggested_invoice: jobDone && !live ? suggestLines({ records, usage: usages }) : null,
    can_issue_invoice: jobDone && !live,
  };
  if (live || invoices[0]) {
    const target = live || invoices[0];
    const parts = await loadInvoiceParts(client, [target.id]);
    out.invoice = await invoiceView(client, target, parts);
    out.variance = out.invoice.variance;
  } else {
    out.variance = accepted ? { state: 'awaiting_invoice' } : { state: 'no_estimate' };
  }
  return out;
}

export async function issueInvoice(client = defaultClient, actor = {}, caseId, body = {}, deps = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const { workOrder } = await garageCaseJob(client, tenantId, caseId);
  if (!workOrder) throw new NotFoundError('That job could not be found.');
  const currency = requireCurrency(body.currency);
  const lines = normalizeInvoiceLines(body.lines, currency);
  let due = null;
  if (body.due_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date))) throw new ValidationError('due_date must be YYYY-MM-DD');
    due = String(body.due_date);
  }
  const { data, error } = await client.rpc('garage_ops07_issue_invoice', {
    p_tenant_id: tenantId, p_work_order_id: workOrder.id, p_currency: currency, p_lines: lines,
    p_customer_note: text(body.customer_note, 'customer_note', 2000),
    p_internal_note: text(body.internal_note, 'internal_note', 2000),
    p_due_date: due, p_actor_user_id: actorUserId,
  });
  if (error) throw invoiceFailure(error, 'Could not issue the invoice');
  const invoice = await getInvoice(client, actor, one(data).id);
  const notification = await notifyForCase(client, invoice.service_case_id, GARAGE_NOTIFICATION_EVENTS.invoiceIssued,
    { field: 'invoiceId', id: invoice.id }, deps);
  return { ...invoice, notification };
}

/** Best-effort customer notification; the outcome is returned, never assumed. */
async function notifyForCase(client, serviceCaseId, eventType, entity, deps) {
  try {
    const { data: serviceCase } = await client.from('service_cases')
      .select('id, vin, garage_tenant_id, requester_user_id').eq('id', serviceCaseId).maybeSingle();
    if (!serviceCase) return { attempted: 0, emitted: 0, failures: ['case unavailable'] };
    return await notifyCaseAudience(client, { eventType, serviceCase, entity }, deps);
  } catch (error) {
    return { attempted: 0, emitted: 0, failures: [error?.message || 'notification failed'] };
  }
}

export async function getInvoice(client = defaultClient, actor = {}, invoiceId) {
  const tenantId = adminTenant(actor);
  const id = String(invoiceId ?? '').trim();
  const { data, error } = await client.from('garage_invoices').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new DatabaseError('Could not load the invoice: ' + error.message);
  if (!data) throw new NotFoundError('Invoice not found');
  const parts = await loadInvoiceParts(client, [data.id]);
  const view = await invoiceView(client, data, parts);
  const { data: ev, error: evError } = await client.from('garage_invoice_events')
    .select('event_type, actor_user_id, created_at, detail').eq('invoice_id', data.id).order('seq', { ascending: true });
  if (evError) throw new DatabaseError('Could not load invoice history: ' + evError.message);
  return { ...view, history: list(ev) };
}

export async function listInvoices(client = defaultClient, actor = {}, { status } = {}) {
  const tenantId = adminTenant(actor);
  let q = client.from('garage_invoices').select('*').eq('tenant_id', tenantId).order('issued_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', String(status));
  const { data, error } = await q;
  if (error) throw new DatabaseError('Could not load invoices: ' + error.message);
  const invoices = list(data);
  const parts = invoices.length ? await loadInvoiceParts(client, invoices.map((i) => i.id)) : { lines: new Map(), payments: new Map(), receipts: new Map() };
  const views = [];
  for (const inv of invoices) views.push(await invoiceView(client, inv, parts));
  // Counts are per exact payment state. Totals are per currency; nothing is added across currencies.
  const outstanding = new Map();
  for (const v of views.filter((x) => x.status === 'issued')) {
    outstanding.set(v.currency, [...(outstanding.get(v.currency) || []), v.balance_amount]);
  }
  return {
    invoices: views,
    summary: {
      issued: views.filter((v) => v.status === 'issued').length,
      unpaid: views.filter((v) => v.payment_status === 'unpaid').length,
      partially_paid: views.filter((v) => v.payment_status === 'partially_paid').length,
      paid: views.filter((v) => v.payment_status === 'paid').length,
      outstanding_by_currency: [...outstanding.entries()].map(([currency, vals]) => ({ currency, balance: sumMoney(vals, currency) })),
    },
  };
}

export async function voidInvoice(client = defaultClient, actor = {}, invoiceId, body = {}) {
  const tenantId = adminTenant(actor);
  const { error } = await client.rpc('garage_ops07_void_invoice', {
    p_tenant_id: tenantId, p_invoice_id: String(invoiceId), p_reason: text(body.reason, 'reason', 300, { required: true }), p_actor_user_id: actorId(actor),
  });
  if (error) throw invoiceFailure(error, 'Could not void the invoice');
  return getInvoice(client, actor, invoiceId);
}

export async function recordPayment(client = defaultClient, actor = {}, invoiceId, body = {}, deps = {}) {
  const tenantId = adminTenant(actor);
  const id = String(invoiceId ?? '').trim();
  const { data: inv, error: invError } = await client.from('garage_invoices').select('id, currency, status').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (invError) throw new DatabaseError('Could not load the invoice: ' + invError.message);
  if (!inv) throw new NotFoundError('Invoice not found');
  // the currency is the invoice's own; a body that names another one is refused, not converted
  if (body.currency !== undefined && body.currency !== null && body.currency !== inv.currency) {
    throw new ValidationError(MESSAGES.CURRENCY_MISMATCH);
  }
  const method = String(body.method ?? '').trim();
  if (!PAYMENT_METHODS.includes(method)) throw new ValidationError(`method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  const amount = moneyAmount(body.amount, 'amount', inv.currency);
  if (Number(amount) <= 0) throw new ValidationError('amount must be greater than zero');
  const paidAt = body.paid_at ? new Date(body.paid_at) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new ValidationError('paid_at must be a date and time');
  const { data, error } = await client.rpc('garage_ops07_record_payment', {
    p_tenant_id: tenantId, p_invoice_id: inv.id, p_amount: amount, p_currency: inv.currency, p_method: method,
    p_reference: text(body.reference, 'reference', 120), p_paid_at: paidAt.toISOString(),
    p_actor_user_id: actorId(actor), p_idempotency_key: idempotencyKey(body.idempotency_key),
  });
  if (error) throw invoiceFailure(error, 'Could not record the payment');
  const result = typeof data === 'string' ? JSON.parse(data) : one(data);
  const invoice = await getInvoice(client, actor, inv.id);
  // a replayed request recorded nothing new, so it announces nothing new
  const notification = result.replayed
    ? { attempted: 0, emitted: 0, failures: [], replayed: true }
    : await notifyForCase(client, invoice.service_case_id, GARAGE_NOTIFICATION_EVENTS.paymentRecorded,
      { field: 'paymentId', id: result.payment_id }, deps);
  return { ...result, payment_source_label: PAYMENT_SOURCE_LABEL, invoice, notification };
}

export async function reversePayment(client = defaultClient, actor = {}, paymentId, body = {}) {
  const tenantId = adminTenant(actor);
  const { data: pay, error: payError } = await client.from('garage_payment_records').select('id, invoice_id').eq('id', String(paymentId)).eq('tenant_id', tenantId).maybeSingle();
  if (payError) throw new DatabaseError('Could not load the payment: ' + payError.message);
  if (!pay) throw new NotFoundError('Payment not found');
  const { data, error } = await client.rpc('garage_ops07_reverse_payment', {
    p_tenant_id: tenantId, p_payment_id: pay.id, p_reason: text(body.reason, 'reason', 300, { required: true }),
    p_actor_user_id: actorId(actor), p_idempotency_key: idempotencyKey(body.idempotency_key),
  });
  if (error) throw invoiceFailure(error, 'Could not reverse the payment');
  const result = typeof data === 'string' ? JSON.parse(data) : one(data);
  return { ...result, invoice: await getInvoice(client, actor, pay.invoice_id) };
}

// ───────────────────────────── customer side ─────────────────────────────

/** The customer's own invoices: no internal note, no staff identity, and the payment source stated. */
export async function listMyInvoices(client = defaultClient, actor = {}) {
  const userId = actorId(actor);
  const { cases } = await followedCases(client, userId);
  if (!cases.length) return { invoices: [] };
  const { data, error } = await client.from('garage_invoices').select('*')
    .in('service_case_id', cases.map((c) => c.id)).order('issued_at', { ascending: false });
  if (error) throw new DatabaseError('Could not load invoices: ' + error.message);
  const invoices = list(data);
  const parts = invoices.length ? await loadInvoiceParts(client, invoices.map((i) => i.id)) : { lines: new Map(), payments: new Map(), receipts: new Map() };
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const out = [];
  for (const inv of invoices) {
    const view = await invoiceView(client, inv, parts, { forCustomer: true });
    // the customer sees what was recorded as received and what was reversed, but not the garage's reasons
    out.push({ ...view, vin: caseById.get(inv.service_case_id)?.vin ?? null, payments: view.payments.map(({ reason: _reason, ...rest }) => rest) });
  }
  return { invoices: out };
}

export default {
  getCloseout, issueInvoice, getInvoice, listInvoices, voidInvoice, recordPayment, reversePayment, listMyInvoices, suggestLines, varianceOf,
};
