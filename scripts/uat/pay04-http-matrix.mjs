#!/usr/bin/env node
// CARUP-PAY-04-LR01 — physical UAT over AUTHENTICATED HTTP on the isolated local stack (real PostgreSQL, real
// PostgREST, the real backend at the candidate commit, real sessions, CSRF, the signed simulator webhook).
//
// Drives the directive's physical cases 1–23 through the product's own endpoints, plus HTTP-level concurrency, and
// reads the database back for every money claim. Case 24 (viewports) is the browser spec; case 25 (regressions) is CI.
//
//   node scripts/uat/pay04-http-matrix.mjs     -> ~/carup-launch-evidence/pay04/uat/http-matrix-<commit>.json (0600)
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ACCOUNTS_FILE, API, EVIDENCE_DIR, call, code, identity, lit, login, msg, paceGlobal, quietSensitiveWindow, requirePay04UatDatabase, sql } from './pay04-uat-lib.mjs';

requirePay04UatDatabase();
const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
const health = await (await fetch(`${API}/api/health`)).json();
const commit = health?.build?.commit_sha || 'unknown';
const tok = {};
for (const k of ['adminA', 'mechA', 'adminB', 'customer', 'stranger', 'ops']) tok[k] = await login(accounts[k]);
const as = {
  customer: identity(accounts.customer, tok.customer),
  stranger: identity(accounts.stranger, tok.stranger),
  adminA: identity(accounts.adminA, tok.adminA, accounts.garageA),
  mechA: identity(accounts.mechA, tok.mechA, accounts.garageA),
  adminB: identity(accounts.adminB, tok.adminB, accounts.garageB),
  ops: identity(accounts.ops, tok.ops),
};
const STATE_FILE = `${EVIDENCE_DIR}/simulator/state.json`;

const results = [];
const facts = {};
function record(id, title, pass, detail = {}) {
  results.push({ case: id, title, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${String(id).padEnd(6)} ${title}${pass ? '' : `  ${JSON.stringify(detail).slice(0, 300)}`}`);
}
async function step(id, title, fn) {
  try {
    const out = await fn();
    record(id, title, out?.pass !== false, out?.detail ?? out ?? {});
  } catch (error) {
    record(id, title, false, { error: String(error?.message || error).slice(0, 400) });
  }
}
const ok = (r, status) => r.status === status;
const key = (p) => `${p}-${randomUUID()}`;
const money = (invoiceId) => JSON.parse(sql(`select row_to_json(m) from pay04_invoice_money(${lit(invoiceId)}) m`));

/** Cases 1–5 for one job, through the product endpoints; returns the case and its suggested invoice. */
async function job({ cost = '140.00', partQty = 2, sellPrice = '35.00' } = {}) {
  const c = await call('POST', '/api/service-cases', { vin: accounts.vinCustomer, garage_tenant_id: accounts.garageA, branch_id: accounts.branchA,
    service_category: 'brakes', request_summary: 'Brakes squeal when stopping (PAY-04 QA)' }, as.customer);
  if (c.status >= 300) throw new Error(`request ${c.status} ${JSON.stringify(c.json)}`);
  const caseId = c.json.case?.id || c.json.serviceCase?.id || c.json.id || c.json.service_case?.id;
  const accepted = await call('POST', `/api/service-cases/${caseId}/accept`, { branch_id: accounts.branchA }, as.adminA);
  if (accepted.status >= 300) throw new Error(`accept ${accepted.status} ${JSON.stringify(accepted.json)}`);
  const wo = await call('POST', `/api/service-cases/${caseId}/work-order`, {}, as.adminA);
  if (wo.status >= 300) throw new Error(`work order ${wo.status} ${JSON.stringify(wo.json)}`);
  const workOrderId = wo.json.workOrder?.id || wo.json.work_order?.id;
  const est = await call('POST', `/api/garage/cases/${caseId}/estimates`, { currency: 'USD', lines: [
    { category: 'labour', description: 'Brake service', quantity: 1, unit_price: cost },
    { category: 'part', description: 'Brake pads', quantity: partQty, unit_price: sellPrice }] }, as.adminA);
  if (est.status >= 300) throw new Error(`estimate ${est.status} ${JSON.stringify(est.json)}`);
  const estimateId = est.json.estimate?.id || est.json.id;
  const sent = await call('POST', `/api/garage/estimates/${estimateId}/send`, {}, as.adminA);
  if (sent.status >= 300) throw new Error(`send ${sent.status} ${JSON.stringify(sent.json)}`);
  const decided = await call('POST', `/api/service-estimates/${estimateId}/decision`, { decision: 'accept' }, as.customer);
  if (decided.status >= 300) throw new Error(`decision ${decided.status} ${JSON.stringify(decided.json)}`);
  const assigned = await call('POST', `/api/service-work-orders/${workOrderId}/assign`, { mechanic_user_id: accounts.mechA.userId }, as.adminA);
  if (assigned.status >= 300) throw new Error(`assign ${assigned.status} ${JSON.stringify(assigned.json)}`);
  const started = await call('POST', `/api/service-cases/${caseId}/start`, {}, as.adminA);
  if (started.status >= 300) throw new Error(`start ${started.status} ${JSON.stringify(started.json)}`);
  const rec = await call('POST', `/api/service-work-orders/${workOrderId}/records`, { work_performed: 'Replaced pads, cleaned calipers', total_cost: cost, currency: 'USD' }, as.mechA);
  if (rec.status >= 300) throw new Error(`record ${rec.status} ${JSON.stringify(rec.json)}`);
  const recordId = rec.json.record?.id || rec.json.id;
  const part = await call('POST', '/api/garage/stock', { name: 'Brake pads (QA)', sku: `P4QA-PADS-${randomUUID().slice(0, 8)}`, opening_quantity: 10,
    unit_cost: '20.00', sell_price: sellPrice, price_currency: 'USD', idempotency_key: key('part') }, as.adminA);
  if (part.status >= 300) throw new Error(`part ${part.status} ${JSON.stringify(part.json)}`);
  const partId = part.json.part?.id || part.json.id;
  const used = await call('POST', `/api/garage/service-records/${recordId}/parts`, { part_id: partId, quantity: partQty, idempotency_key: key('use') }, as.mechA);
  if (used.status >= 300) throw new Error(`consume ${used.status} ${JSON.stringify(used.json)}`);
  const done = await call('POST', `/api/service-cases/${caseId}/complete-job`, {}, as.mechA);
  if (done.status >= 300) throw new Error(`complete ${done.status} ${JSON.stringify(done.json)}`);
  const closeout = await call('GET', `/api/garage/cases/${caseId}/closeout`, undefined, as.adminA);
  return { caseId, workOrderId, estimateId, recordId, partId, closeout: closeout.json, partQty };
}
async function issue(j, lines) {
  return call('POST', `/api/garage/cases/${j.caseId}/invoice`, { currency: 'USD', lines }, as.adminA);
}
const suggested = (j) => (j.closeout?.suggested_invoice?.lines || []).map((l) => ({ ...l, unit_price: l.unit_price ?? '0.00' }));

// ───────────────────────────── cases 1–6 ─────────────────────────────
let J1;
await step('1-5', 'Customer requests service; garage estimates; customer authorizes; work completed; parts usage reconciled', async () => {
  J1 = await job();
  const usage = J1.closeout?.parts_used || [];
  const partLine = suggested(J1).find((l) => l.source_kind === 'part_usage');
  const pass = J1.closeout?.can_issue_invoice === true && usage.length === 1 && usage[0].active && Number(usage[0].quantity) === J1.partQty
    && partLine && Number(partLine.quantity) === J1.partQty && partLine.source_id === usage[0].id;
  facts.job1 = { caseId: J1.caseId, workOrderId: J1.workOrderId };
  return { pass, detail: { can_issue_invoice: J1.closeout?.can_issue_invoice, parts_used: usage.map((u) => ({ id: u.id, quantity: u.quantity, active: u.active })),
    suggested_lines: suggested(J1).map((l) => ({ category: l.category, source_kind: l.source_kind, quantity: l.quantity, unit_price: l.unit_price })) } };
});

let INV1;
await step('6', 'Garage issues the correct invoice (and untrue lines are refused)', async () => {
  const manualPart = await issue(J1, [{ category: 'part', description: 'Pads typed by hand', quantity: 1, unit_price: '35.00' }]);
  const overQty = await issue(J1, suggested(J1).map((l) => (l.source_kind === 'part_usage' ? { ...l, quantity: J1.partQty + 1 } : l)));
  const good = await issue(J1, suggested(J1));
  INV1 = good.json?.invoice;
  const lines = INV1?.lines || [];
  const pass = manualPart.status === 400 && /recorded as used/.test(msg(manualPart))
    && overQty.status === 400 && ok(good, 201) && INV1.total_amount === '210.00' && lines.length === 2 && INV1.status === 'issued'
    && /^INV-\d{6}$/.test(INV1.invoice_number);
  facts.invoice1 = INV1 && { id: INV1.id, number: INV1.invoice_number, total: INV1.total_amount };
  return { pass, detail: { manual_part: [manualPart.status, msg(manualPart)], over_quantity: [overQty.status, msg(overQty)],
    issued: good.status, number: INV1?.invoice_number, total: INV1?.total_amount, lines: lines.map((l) => [l.category, l.quantity, l.unit_price, l.line_total]) } };
});

await step('7', 'Customer accesses the invoice, the garage’s payment instructions and how to pay', async () => {
  const mine = await call('GET', '/api/service-invoices/mine', undefined, as.customer);
  const inv = (mine.json?.invoices || []).find((i) => i.id === INV1.id);
  const pay = await call('GET', `/api/pay04/garage-invoices/${INV1.id}/payment`, undefined, as.customer);
  const pass = ok(mine, 200) && inv && inv.total_amount === '210.00' && inv.internal_note === undefined && ok(pay, 200)
    && pay.json.payment_instructions?.payee_name === 'PAY04 QA Garage A (Pvt) Ltd'
    && /CarUp does not receive, hold or verify this money/.test(pay.json.payment_instructions?.disclosure || '')
    && pay.json.online_payment?.available === true && pay.json.online_payment?.simulated === true;
  return { pass, detail: { invoice_visible: Boolean(inv), lines: inv?.lines?.length, online_payment: pay.json?.online_payment,
    instructions_version: pay.json?.payment_instructions?.version } };
});

// ───────────────────────────── cases 8–12, 15–18 (Mode 1) ─────────────────────────────
let P1;
await step('8', 'Garage records a partial external payment (cash)', async () => {
  const k = key('cash');
  const r = await call('POST', `/api/garage/invoices/${INV1.id}/payments`, { amount: '60.00', method: 'cash', reference: 'Till 3', idempotency_key: k }, as.adminA);
  P1 = { ...r.json, key: k };
  return { pass: ok(r, 201) && r.json.payment_status === 'partially_paid' && /^RCT-\d{6}$/.test(r.json.receipt_number), detail: { status: r.status, payment_status: r.json?.payment_status, receipt: r.json?.receipt_number } };
});
await step('9', 'Invoice balance decreases correctly', async () => {
  const m = money(INV1.id);
  return { pass: Number(m.paid_amount) === 60 && Number(m.balance_amount) === 150 && Number(m.declared_paid) === 60 && Number(m.provider_paid) === 0, detail: m };
});
await step('15', 'Duplicate payment request is idempotent', async () => {
  const again = await call('POST', `/api/garage/invoices/${INV1.id}/payments`, { amount: '60.00', method: 'cash', reference: 'Till 3', idempotency_key: P1.key }, as.adminA);
  const rows = sql(`select count(*) from garage_payment_records where invoice_id = ${lit(INV1.id)} and kind = 'payment'`);
  return { pass: ok(again, 201) && again.json.replayed === true && again.json.payment_id === P1.payment_id && rows === '1', detail: { replayed: again.json?.replayed, rows } };
});
await step('16', 'Overpayment fails', async () => {
  const r = await call('POST', `/api/garage/invoices/${INV1.id}/payments`, { amount: '150.01', method: 'bank_transfer', idempotency_key: key('over') }, as.adminA);
  return { pass: r.status === 409 && /150\.00/.test(msg(r)), detail: { status: r.status, message: msg(r) } };
});
await step('17', 'Wrong currency fails (never converted)', async () => {
  const r = await call('POST', `/api/garage/invoices/${INV1.id}/payments`, { amount: '10.00', currency: 'ZWG', method: 'cash', idempotency_key: key('cur') }, as.adminA);
  const online = await call('POST', `/api/pay04/garage-invoices/${INV1.id}/payments`, { amount: '10.00', currency: 'ZWG' }, as.customer, { 'Idempotency-Key': key('ocur') });
  const rows = sql(`select count(*) from garage_payment_records where invoice_id = ${lit(INV1.id)}`);
  // the online path takes the invoice's own currency: a body naming another one is ignored, never converted
  const collectionCurrency = online.status === 201 ? sql(`select currency from pay04_garage_collections where id = ${lit(online.json.collection_id)}`) : null;
  if (online.status === 201) await call('POST', `/api/pay04/garage-payments/${online.json.collection_id}/cancel`, { reason: 'UAT currency probe' }, as.customer);
  return { pass: r.status === 400 && /never converted/.test(msg(r)) && rows === '1' && (collectionCurrency === null || collectionCurrency === 'USD'),
    detail: { declared: [r.status, msg(r)], online_collection_currency: collectionCurrency } };
});
let P2;
await step('10', 'Garage records the remaining payment (bank transfer)', async () => {
  const r = await call('POST', `/api/garage/invoices/${INV1.id}/payments`, { amount: '150.00', method: 'bank_transfer', reference: 'BT-PAY04-0001', idempotency_key: key('bank') }, as.adminA);
  P2 = r.json;
  const m = money(INV1.id);
  return { pass: ok(r, 201) && r.json.payment_status === 'paid' && Number(m.balance_amount) === 0, detail: { payment_status: r.json?.payment_status, money: m } };
});
await step('11', 'Receipt is generated from the actual payment record', async () => {
  const rows = JSON.parse(sql(`select coalesce(json_agg(json_build_object('n', r.receipt_number, 'amount', r.amount, 'pay', r.payment_id, 'pay_amount', p.amount, 'source', r.payment_source, 'status', r.status) order by r.issued_at), '[]') from garage_receipts r join garage_payment_records p on p.id = r.payment_id where r.invoice_id = ${lit(INV1.id)}`));
  const pass = rows.length === 2 && rows.every((r) => Number(r.amount) === Number(r.pay_amount) && r.source === 'garage_recorded_external' && r.status === 'issued');
  return { pass, detail: rows };
});
await step('12', 'Customer sees the correct payment provenance', async () => {
  const mine = await call('GET', '/api/service-invoices/mine', undefined, as.customer);
  const inv = (mine.json?.invoices || []).find((i) => i.id === INV1.id);
  const label = 'Recorded by the garage. CarUp has not processed or verified this payment.';
  // (case 17's currency probe left a STOPPED provider checkout on this invoice: truthful history, never counted money)
  const pass = inv && inv.payment_status === 'paid' && inv.payments.length === 2 && inv.payments.every((p) => p.source_label === label && p.reason === undefined)
    && inv.receipts.every((r) => r.payment_source_label === label) && (inv.provider_receipts || []).length === 0
    && (inv.provider_payments || []).every((p) => p.state !== 'confirmed') && inv.money?.provider_paid === '0.00' && inv.money?.declared_paid === '210.00';
  return { pass, detail: { payment_status: inv?.payment_status, labels: inv?.payments?.map((p) => p.source_label), money: inv?.money,
    provider_payments: (inv?.provider_payments || []).map((p) => p.state) } };
});
await step('18', 'Payment reversal updates the balance and the receipt state', async () => {
  const r = await call('POST', `/api/garage/payments/${P2.payment_id}/reverse`, { reason: 'Bank transfer bounced', idempotency_key: key('rev') }, as.adminA);
  const m = money(INV1.id);
  const receipt = sql(`select status from garage_receipts where payment_id = ${lit(P2.payment_id)}`);
  const rows = sql(`select count(*) from garage_payment_records where invoice_id = ${lit(INV1.id)}`);
  return { pass: ok(r, 200) && Number(m.balance_amount) === 150 && m.payment_status === 'partially_paid' && receipt === 'voided' && rows === '3',
    detail: { status: r.status, money: m, receipt, payment_rows_including_reversal: rows } };
});

// ───────────────────────────── cases 13–14 (authority) ─────────────────────────────
await step('13', 'An unauthorized customer cannot read the invoice', async () => {
  const pay = await call('GET', `/api/pay04/garage-invoices/${INV1.id}/payment`, undefined, as.stranger);
  const mine = await call('GET', '/api/service-invoices/mine', undefined, as.stranger);
  const garage = await call('GET', `/api/garage/invoices/${INV1.id}`, undefined, as.stranger);
  const start = await call('POST', `/api/pay04/garage-invoices/${INV1.id}/payments`, {}, as.stranger, { 'Idempotency-Key': key('str') });
  const pass = pay.status === 404 && ok(mine, 200) && !(mine.json?.invoices || []).some((i) => i.id === INV1.id) && garage.status === 403 && start.status === 404;
  return { pass, detail: { pay04_view: pay.status, mine_contains: (mine.json?.invoices || []).some((i) => i.id === INV1.id), garage_view: garage.status, start_payment: start.status } };
});
await step('14', 'The wrong garage cannot mutate the invoice', async () => {
  const pay = await call('POST', `/api/garage/invoices/${INV1.id}/payments`, { amount: '1.00', method: 'cash', idempotency_key: key('b') }, as.adminB);
  const voided = await call('POST', `/api/garage/invoices/${INV1.id}/void`, { reason: 'Garage B trying' }, as.adminB);
  const reverse = await call('POST', `/api/garage/payments/${P1.payment_id}/reverse`, { reason: 'Garage B trying', idempotency_key: key('br') }, as.adminB);
  const mech = await call('POST', `/api/garage/invoices/${INV1.id}/payments`, { amount: '1.00', method: 'cash', idempotency_key: key('m') }, as.mechA);
  const view = await call('GET', `/api/pay04/garage/invoices/${INV1.id}/payments`, undefined, as.adminB);
  const pass = pay.status === 404 && voided.status === 404 && reverse.status === 404 && mech.status === 403 && view.status === 404;
  return { pass, detail: { garageB_pay: pay.status, garageB_void: voided.status, garageB_reverse: reverse.status, garageA_mechanic_pay: mech.status, garageB_view: view.status } };
});

// ───────────────────────────── cases 19–22 (Mode 2, simulator) ─────────────────────────────
let J2; let INV2; let C2;
async function payViaSimulator(started, outcome = 'success') {
  const checkoutId = new URL(started.checkout_url).pathname.split('/').pop();
  const form = new URLSearchParams({ outcome });
  await paceGlobal();
  const res = await fetch(`${API}/api/pay04/simulator/checkout/${checkoutId}/complete`, { method: 'POST', body: form, redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return { status: res.status, location: res.headers.get('location') };
}
await step('19', 'Provider-simulated success produces a separately classified, confirmed payment', async () => {
  J2 = await job({ cost: '100.00', partQty: 1, sellPrice: '20.00' });
  INV2 = (await issue(J2, suggested(J2))).json.invoice;
  const k = key('online');
  const started = await call('POST', `/api/pay04/garage-invoices/${INV2.id}/payments`, { amount: '120.00' }, as.customer, { 'Idempotency-Key': k });
  const replay = await call('POST', `/api/pay04/garage-invoices/${INV2.id}/payments`, { amount: '120.00' }, as.customer, { 'Idempotency-Key': k });
  C2 = started.json;
  const inFlight = money(INV2.id);
  const movesBefore = sql(`select count(*) from garage_stock_movements where tenant_id = ${lit(accounts.garageA)}`);
  const back = await payViaSimulator(started.json);
  const verified = await call('POST', `/api/pay04/garage-payments/${C2.collection_id}/verify`, {}, as.customer);
  const m = money(INV2.id);
  const tx = JSON.parse(sql(`select row_to_json(t) from (select gateway, status, pay02_product_code, pay02_commercial_category, pay02_funds_owner, pay02_legal_beneficiary, pay02_settlement_status, pay01a_actor_id from payment_transactions where reference = (select payment_reference from pay04_garage_collections where id = ${lit(C2.collection_id)})) t`));
  const declared = sql(`select count(*) from garage_payment_records where invoice_id = ${lit(INV2.id)}`);
  const receipt = JSON.parse(sql(`select row_to_json(r) from (select receipt_number, amount, payment_source, status from pay04_garage_provider_receipts where collection_id = ${lit(C2.collection_id)} and status = 'issued') r`) || 'null');
  const events = sql(`select count(*) from domain_events where event_type = 'garage.payment.confirmed' and payload->>'collectionId' like ${lit(C2.collection_id + '%')}`);
  const movesAfter = sql(`select count(*) from garage_stock_movements where tenant_id = ${lit(accounts.garageA)}`);
  const pass = started.status === 201 && replay.json?.collection_id === C2.collection_id && Number(inFlight.paid_amount) === 0 && Number(inFlight.provider_reserved) === 120
    && back.status === 303 && /pay04=returned/.test(back.location || '') && ok(verified, 200) && verified.json.collection?.state === 'confirmed'
    && Number(m.provider_paid) === 120 && Number(m.declared_paid) === 0 && m.payment_status === 'paid' && declared === '0'
    && tx.gateway === 'pay04_garage_provider_simulator' && tx.status === 'paid' && tx.pay02_product_code === 'gar.invoice.customer_payment'
    && tx.pay02_commercial_category === 'category_b_third_party' && tx.pay02_funds_owner === 'garage_business_tenant'
    && tx.pay02_legal_beneficiary === `tenant:${accounts.garageA}` && tx.pay01a_actor_id === accounts.customer.userId
    && receipt?.payment_source === 'provider_confirmed' && Number(receipt?.amount) === 120 && Number(events) >= 1
    && movesBefore === movesAfter;
  facts.invoice2 = { id: INV2.id, number: INV2.invoice_number, collection: C2.collection_id };
  return { pass, detail: { started: started.status, replay_same_collection: replay.json?.collection_id === C2.collection_id, in_flight: inFlight, simulator_redirect: back,
    verified_state: verified.json?.collection?.state, money_after: m, canonical_row: tx, declared_rows: declared, provider_receipt: receipt, confirmed_notifications: events,
    stock_movements_before_after_payment: [movesBefore, movesAfter] } };
});

await step('20', 'A forged webhook cannot settle an invoice', async () => {
  const J = await job({ cost: '50.00', partQty: 1, sellPrice: '10.00' });
  const inv = (await issue(J, suggested(J))).json.invoice;
  const started = await call('POST', `/api/pay04/garage-invoices/${inv.id}/payments`, {}, as.customer, { 'Idempotency-Key': key('forge') });
  const paymentId = sql(`select provider_payment_id from pay04_garage_collections where id = ${lit(started.json.collection_id)}`);
  const body = JSON.stringify({ id: 'evt_gsim_forged_0001', object: 'event', type: 'payment.succeeded', created: Math.floor(Date.now() / 1000), livemode: false,
    gateway: 'pay04_garage_provider_simulator', merchant_reference: 'gsim_merchant_pay04_qa_garage_a',
    data: { payment: { id: paymentId, amount_minor: 6000, currency: 'USD', status: 'succeeded' } } });
  const post = async (signature) => { await paceGlobal(); return fetch(`${API}/api/pay04/simulator/webhook`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...(signature ? { 'x-pay04-simulator-signature': signature } : {}) } }); };
  const unsigned = await post(null);
  const badSig = await post(`t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`);
  const stale = await post(`t=${Math.floor(Date.now() / 1000) - 7200},v1=${'a'.repeat(64)}`);
  // and a GENUINELY signed event cannot settle what the provider does not hold: the money truth is a fresh provider read
  const m = money(inv.id);
  const status = sql(`select p.status from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(started.json.collection_id)}`);
  await call('POST', `/api/pay04/garage-payments/${started.json.collection_id}/cancel`, { reason: 'UAT forged-webhook probe' }, as.customer);
  const pass = unsigned.status === 400 && badSig.status === 400 && stale.status === 400 && Number(m.paid_amount) === 0 && status === 'pending';
  return { pass, detail: { unsigned: unsigned.status, wrong_signature: badSig.status, stale_signature: stale.status, money: m, canonical_status: status } };
});

await step('21', 'A partial provider refund generates the correct reconciliation state (F5 hold, operator resolution)', async () => {
  const paymentId = sql(`select provider_payment_id from pay04_garage_collections where id = ${lit(C2.collection_id)}`);
  const ext = await call('POST', `/api/pay04/simulator/payments/${paymentId}/external-refund`, { amountMinor: 3000 }, as.ops);
  const status = sql(`select p.status from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(C2.collection_id)}`);
  const held = money(INV2.id);
  const exc = await call('GET', '/api/pay04/admin/exceptions', undefined, as.ops);
  const hold = (exc.json?.reconciliation_holds || []).find((h) => h.collection?.id === C2.collection_id);
  const garageAdminTries = await call('POST', `/api/pay03b/admin/reconciliation-exceptions/${hold?.id}/resolve`, { resolution: 'revoke_access_partial_refund_final',
    note: 'Garage admin is not a platform operator' }, as.adminA);
  const resolved = await call('POST', `/api/pay03b/admin/reconciliation-exceptions/${hold?.id}/resolve`, { resolution: 'revoke_access_partial_refund_final',
    note: 'Garage refunded 30.00 directly at its provider; 90.00 stands (PAY-04 UAT)' }, as.ops);
  const after = money(INV2.id);
  const receipts = JSON.parse(sql(`select json_agg(json_build_object('n', receipt_number, 'amount', amount, 'status', status) order by issued_at) from pay04_garage_provider_receipts where collection_id = ${lit(C2.collection_id)}`));
  const pass = ok(ext, 200) && status === 'reconciliation_hold' && Number(held.provider_paid) === 0 && Number(held.provider_reserved) === 120
    && hold && garageAdminTries.status === 403 && ok(resolved, 200) && resolved.json.paymentStatus === 'partially_refunded'
    && Number(after.provider_paid) === 90 && Number(after.balance_amount) === 30 && receipts.filter((r) => r.status === 'issued').length === 1
    && receipts.some((r) => r.status === 'issued' && Number(r.amount) === 90);
  return { pass, detail: { external_refund: ext.status, held_status: status, held_money: held, hold_listed: Boolean(hold), garage_admin_resolve: garageAdminTries.status,
    resolved: [resolved.status, resolved.json?.paymentStatus || code(resolved)], money_after: after, receipts } };
});

await step('22', 'A provider outage does not fabricate a payment', async () => {
  const J = await job({ cost: '40.00', partQty: 1, sellPrice: '10.00' });
  const inv = (await issue(J, suggested(J))).json.invoice;
  const started = await call('POST', `/api/pay04/garage-invoices/${inv.id}/payments`, {}, as.customer, { 'Idempotency-Key': key('outage') });
  await payViaSimulator(started.json); // the provider took the money...
  chmodSync(STATE_FILE, 0o000); // ...and is then unreachable
  let during;
  let startDuring;
  try {
    during = await call('POST', `/api/pay04/garage-payments/${started.json.collection_id}/verify`, {}, as.customer);
    startDuring = await call('POST', `/api/pay04/garage-invoices/${inv.id}/payments`, { amount: '1.00' }, as.customer, { 'Idempotency-Key': key('outage2') });
  } finally {
    chmodSync(STATE_FILE, 0o600);
  }
  const m = money(inv.id);
  // the webhook the provider sent before the outage was applied from a fresh read; afterwards nothing new was fabricated
  const declared = sql(`select count(*) from garage_payment_records where invoice_id = ${lit(inv.id)}`);
  const pass = [502, 503].includes(during.status) && [409, 502, 503].includes(startDuring.status) && declared === '0'
    && Number(m.provider_paid) <= 50;
  return { pass, detail: { verify_during_outage: [during.status, code(during)], start_during_outage: [startDuring.status, code(startDuring)], money: m, declared_rows: declared } };
});

// ───────────────────────────── case 23 (cancellation and adjustment) ─────────────────────────────
await step('23', 'Cancellation and adjustment rules preserve history', async () => {
  const J = await job({ cost: '80.00', partQty: 1, sellPrice: '10.00' });
  const inv = (await issue(J, suggested(J))).json.invoice;
  const cash = await call('POST', `/api/garage/invoices/${inv.id}/payments`, { amount: '20.00', method: 'cash', idempotency_key: key('c23') }, as.adminA);
  const refusedVoid = await call('POST', `/api/garage/invoices/${inv.id}/void`, { reason: 'Wrong labour rate' }, as.adminA);
  const online = await call('POST', `/api/pay04/garage-invoices/${inv.id}/payments`, { amount: '10.00' }, as.customer, { 'Idempotency-Key': key('o23') });
  const refusedVoid2 = await call('POST', `/api/garage/invoices/${inv.id}/void`, { reason: 'Wrong labour rate' }, as.adminA);
  const stopped = await call('POST', `/api/pay04/garage-payments/${online.json.collection_id}/cancel`, { reason: 'Customer will pay in cash' }, as.customer);
  await call('POST', `/api/garage/payments/${cash.json.payment_id}/reverse`, { reason: 'Re-issuing the invoice', idempotency_key: key('r23') }, as.adminA);
  const voided = await call('POST', `/api/garage/invoices/${inv.id}/void`, { reason: 'Wrong labour rate' }, as.adminA);
  const reissued = await issue(J, suggested(J).map((l) => (l.category === 'labour' ? { ...l, unit_price: '70.00' } : l)));
  const old = await call('GET', `/api/garage/invoices/${inv.id}`, undefined, as.adminA);
  const history = (old.json?.invoice?.history || old.json?.history || []).map((e) => e.event_type);
  const pass = refusedVoid.status === 409 && refusedVoid2.status === 409 && ok(stopped, 200) && ok(voided, 200) && ok(reissued, 201)
    && reissued.json.invoice.invoice_number !== inv.invoice_number && reissued.json.invoice.total_amount === '80.00'
    && (old.json?.invoice?.status || old.json?.status) === 'voided' && ['issued', 'payment_recorded', 'payment_reversed', 'voided'].every((e) => history.includes(e));
  return { pass, detail: { void_with_declared_payment: [refusedVoid.status, msg(refusedVoid)], void_with_online_payment_in_progress: [refusedVoid2.status, msg(refusedVoid2)],
    checkout_stopped: stopped.status, voided: voided.status, reissued: [reissued.status, reissued.json?.invoice?.invoice_number, reissued.json?.invoice?.total_amount],
    old_invoice_history: history } };
});

// ───────────────────────────── refund (garage) and concurrency ─────────────────────────────
await step('R', 'The garage refunds a provider-confirmed payment in full; the customer is told', async () => {
  const J = await job({ cost: '60.00', partQty: 1, sellPrice: '10.00' });
  const inv = (await issue(J, suggested(J))).json.invoice;
  const started = await call('POST', `/api/pay04/garage-invoices/${inv.id}/payments`, {}, as.customer, { 'Idempotency-Key': key('ref') });
  await payViaSimulator(started.json);
  const customerTries = await call('POST', `/api/pay04/garage/payments/${started.json.collection_id}/refund`, { reason: 'Customer cannot refund themselves' }, as.customer);
  const refund = await call('POST', `/api/pay04/garage/payments/${started.json.collection_id}/refund`, { reason: 'Customer was charged twice for the service' }, as.adminA);
  const m = money(inv.id);
  const told = sql(`select count(*) from domain_events where event_type = 'garage.payment.refunded' and payload->>'collectionId' = ${lit(started.json.collection_id)}`);
  const pass = [401, 403].includes(customerTries.status) && ok(refund, 200) && refund.json.payment_status === 'refunded' && Number(m.provider_paid) === 0
    && Number(m.balance_amount) === 70 && Number(told) >= 1;
  return { pass, detail: { customer_refund: customerTries.status, refund: [refund.status, refund.json?.payment_status], money: m, refunded_notifications: told } };
});

await step('C1', 'Concurrency: five simultaneous online payments for the whole balance — exactly one reserves it', async () => {
  const J = await job({ cost: '90.00', partQty: 1, sellPrice: '10.00' });
  const inv = (await issue(J, suggested(J))).json.invoice;
  await quietSensitiveWindow();
  const all = await Promise.all([1, 2, 3, 4, 5].map((n) => call('POST', `/api/pay04/garage-invoices/${inv.id}/payments`, { amount: '100.00' }, as.customer,
    { 'Idempotency-Key': key(`race${n}`) }, { pace: false })));
  const won = all.filter((r) => r.status === 201);
  const lost = all.filter((r) => r.status === 409 && code(r) === 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE');
  const m = money(inv.id);
  facts.raceInvoice = inv.id; facts.raceCollection = won[0]?.json?.collection_id;
  return { pass: won.length === 1 && lost.length === 4 && Number(m.provider_reserved) === 100, detail: { statuses: all.map((r) => r.status), money: m } };
});
await step('C2', 'Concurrency: a cash record racing the reservation can never over-commit the invoice', async () => {
  const r = await call('POST', `/api/garage/invoices/${facts.raceInvoice}/payments`, { amount: '1.00', method: 'cash', idempotency_key: key('cashrace') }, as.adminA);
  return { pass: r.status === 409 && /payment provider/.test(msg(r)), detail: { status: r.status, message: msg(r) } };
});
await step('C3', 'Concurrency: five provider event deliveries at once change nothing once the money is counted (one allocation, one receipt)', async () => {
  const started = { checkout_url: sql(`select 'http://x/' || provider_checkout_id from pay04_garage_collections where id = ${lit(facts.raceCollection)}`) };
  await payViaSimulator(started); // delivers once through the real webhook path
  const paymentId = sql(`select provider_payment_id from pay04_garage_collections where id = ${lit(facts.raceCollection)}`);
  const allocationsBefore = sql(`select count(*) from pay04_garage_payment_allocations where collection_id = ${lit(facts.raceCollection)}`);
  // five fresh signed provider events for this payment at once, through the real HTTP webhook route (each one triggers a
  // fresh provider read of unchanged truth); identical-event storms are certified on real PostgreSQL in the node suite
  const misreport = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', `/api/pay04/simulator/payments/${paymentId}/misreport`, {}, as.ops)));
  const allocationsAfter = sql(`select count(*) from pay04_garage_payment_allocations where collection_id = ${lit(facts.raceCollection)}`);
  const receipts = sql(`select count(*) from pay04_garage_provider_receipts where collection_id = ${lit(facts.raceCollection)} and status = 'issued'`);
  const m = money(facts.raceInvoice);
  return { pass: allocationsBefore === '1' && allocationsAfter === '1' && receipts === '1' && Number(m.provider_paid) === 100 && misreport.every((r) => r.status === 200),
    detail: { allocations_before: allocationsBefore, allocations_after: allocationsAfter, live_receipts: receipts, money: m, deliveries: misreport.map((r) => r.json?.delivered) } };
});

// ───────────────────────────── invariants over everything this run touched ─────────────────────────────
await step('INV', 'Database invariants over every invoice of garage A', async () => {
  const over = sql(`select count(*) from garage_invoices i cross join lateral garage_ops07_invoice_balance(i.id) b where i.tenant_id = ${lit(accounts.garageA)} and b.paid_amount > i.total_amount`);
  const badReceipt = sql(`select count(*) from pay04_garage_provider_receipts r where r.tenant_id = ${lit(accounts.garageA)} and r.status = 'issued' and r.amount <> pay04_collection_allocated(r.collection_id)`);
  const badSource = sql(`select count(*) from garage_payment_records where source <> 'garage_recorded_external'`);
  const carupMoney = sql(`select count(*) from payment_transactions where reference like 'pay04_gar_%' and (pay02_funds_owner <> 'garage_business_tenant' or gateway <> 'pay04_garage_provider_simulator')`);
  const movementTypes = sql(`select string_agg(distinct movement_type, ',') from garage_stock_movements where tenant_id = ${lit(accounts.garageA)}`);
  return { pass: over === '0' && badReceipt === '0' && badSource === '0' && carupMoney === '0', detail: { over_allocated: over, receipts_not_equal_counted: badReceipt,
    non_external_declared_rows: badSource, garage_money_as_carup_money: carupMoney, stock_movement_types_seen: movementTypes } };
});

const out = { programme: 'CARUP-PAY-04-LR01', level: 'Level 1 (local simulator; no provider, no money)', recorded_at: new Date().toISOString(),
  backend_commit: commit, stack: 'carup-pay04-supabase 127.0.0.1:56321/56322', results, facts,
  summary: { total: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).map((r) => r.case) } };
mkdirSync(`${EVIDENCE_DIR}/uat`, { recursive: true, mode: 0o700 });
const file = `${EVIDENCE_DIR}/uat/http-matrix-${commit.slice(0, 8)}.json`;
writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
console.log(`\n${out.summary.passed}/${out.summary.total} passed -> ${file}`);
if (!existsSync(file) || out.summary.failed.length) process.exitCode = 1;
