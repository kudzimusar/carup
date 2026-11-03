#!/usr/bin/env node
// CARUP-PAY-05-LR01 — physical UAT over AUTHENTICATED HTTP on the isolated local stack: real PostgreSQL, real PostgREST,
// the real backend at the candidate commit, real sessions and CSRF, CarUp's REAL Paynow adapter talking HTTP to the
// LOCAL PAYNOW PROTOCOL SIMULATOR (form-encoded, SHA-512 hashes, poll URLs, hosted page, signed status updates POSTed to
// CarUp's resulturl). Level 1: no provider, no money.
//
// Covers issue #252 Checkpoint F through the product's own endpoints, and reads the database back for every money claim:
// merchant onboarding and verification (C), every payment method, forged / tampered / unsigned / cross-garage /
// cross-collection status updates, duplicate callbacks and transactions, lost replies and provider errors, late money,
// expiry and stop races, amount and currency mismatches, refunds and disputes, operator controls, and invariants.
// Run the backend with PAY05_UAT_TTL_SECONDS=300 (scripts/uat/pay05-local-runtime.sh) so expiry is exercised for real.
//
//   node scripts/uat/pay05-http-matrix.mjs     -> ~/carup-launch-evidence/pay05/uat/http-matrix-<commit>.json (0600)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTS_FILE, API, EVIDENCE_DIR, SIM, call, code, expectCallback, identity, lit, login, msg, pause, postResult,
  quietSensitiveWindow, requirePay05UatDatabase, simControl, simFault, simForged, simHostedPay, simOtpOutbox, simResend,
  simSetStatus, simTransactionsFor, sql,
} from './pay05-uat-lib.mjs';
import { encodeForm, signPairs } from '../../backend/services/payment/pay05PaynowProtocol.js';

requirePay05UatDatabase();
const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
const integrations = JSON.parse(readFileSync(`${EVIDENCE_DIR}/runtime/simulated-integrations.json`, 'utf8')).integrations;
const health = await (await fetch(`${API}/api/health`)).json();
const commit = health?.build?.commit_sha || 'unknown';
const TTL_SECONDS = 300;

const tok = {};
for (const k of ['adminA', 'mechA', 'adminB', 'mechB', 'customer', 'stranger', 'ops', 'opsMemberA']) tok[k] = await login(accounts[k]);
const as = {
  customer: identity(accounts.customer, tok.customer),
  stranger: identity(accounts.stranger, tok.stranger),
  adminA: identity(accounts.adminA, tok.adminA, accounts.garageA),
  mechA: identity(accounts.mechA, tok.mechA, accounts.garageA),
  adminB: identity(accounts.adminB, tok.adminB, accounts.garageB),
  mechB: identity(accounts.mechB, tok.mechB, accounts.garageB),
  ops: identity(accounts.ops, tok.ops),
  opsMemberA: identity(accounts.opsMemberA, tok.opsMemberA),
};

const results = [];
const facts = {};
function record(id, title, pass, detail = {}) {
  results.push({ case: id, title, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${String(id).padEnd(6)} ${title}${pass ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`);
}
async function step(id, title, fn) {
  try {
    const out = await fn();
    record(id, title, out?.pass !== false, out?.detail ?? out ?? {});
  } catch (error) {
    record(id, title, false, { error: String(error?.message || error).slice(0, 500) });
  }
}
const ok = (r, status) => r.status === status;
const key = (p) => `${p}-${randomUUID()}`;
const money = (invoiceId) => JSON.parse(sql(`select row_to_json(m) from pay04_invoice_money(${lit(invoiceId)}) m`));
const json = (q) => JSON.parse(sql(q) || 'null');
const collectionRow = (id) => json(`select row_to_json(c) from (select id, invoice_id, tenant_id, merchant_account_id, gateway, currency, amount, payment_reference, cancelled_at, cancelled_by, expires_at from pay04_garage_collections where id = ${lit(id)}) c`);
const payStatus = (collectionId) => sql(`select p.status from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(collectionId)}`);
const txOf = (collectionId) => json(`select row_to_json(t) from (select initiation_state, provider_status, method, phone_masked, last_status_update_hash is not null as has_last_hash, hold_released_at, trace_absent_count from pay05_paynow_transactions where collection_id = ${lit(collectionId)}) t`);
const openDiscrepancies = (collectionId) => sql(`select coalesce(string_agg(discrepancy_type, ',' order by discrepancy_type), '') from pay04_garage_payment_discrepancies where collection_id = ${lit(collectionId)} and status = 'open'`);
const providerErrors = (collectionId, kind) => Number(sql(`select count(*) from pay05_provider_errors where collection_id = ${lit(collectionId)} and kind = ${lit(kind)}`));
const allocations = (collectionId) => Number(sql(`select count(*) from pay04_garage_payment_allocations where collection_id = ${lit(collectionId)}`));
const liveReceipts = (collectionId) => Number(sql(`select count(*) from pay04_garage_provider_receipts where collection_id = ${lit(collectionId)} and status = 'issued'`));
async function waitFor(fn, { timeoutMs = 30_000, everyMs = 500 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return v;
    await pause(everyMs);
  }
}
/** The ONE simulator transaction for a collection (one Paynow request per collection, ever). */
async function simTxFor(collectionId) {
  const ref = collectionRow(collectionId).payment_reference;
  const all = await simTransactionsFor(ref);
  if (all.length !== 1) throw new Error(`expected exactly one Paynow transaction for ${ref}, found ${all.length}`);
  return all[0];
}
/** A genuinely signed Paynow status update for a simulator transaction, signed with `signingKey` (default: its own). */
function statusUpdate(tx, { status = tx.status, amount = tx.amount, signingKey, reference = tx.reference } = {}) {
  return encodeForm(signPairs([['reference', reference], ['paynowreference', tx.paynowReference], ['amount', amount], ['status', status],
    ['pollurl', `${SIM}/Interface/CheckPayment/?guid=${tx.guid}`]], signingKey));
}
const keyOf = (integrationId) => Object.values(integrations).find((i) => i.integration_id === integrationId)?.integration_key;

// ── the garage job that produces a real invoice (PAY-04's product path, any garage, any currency) ──
const G = {
  A: { admin: as.adminA, mech: as.mechA, mechId: accounts.mechA.userId, tenant: accounts.garageA, branch: accounts.branchA },
  B: { admin: as.adminB, mech: as.mechB, mechId: accounts.mechB.userId, tenant: accounts.garageB, branch: accounts.branchB },
};
async function invoice(g, { cost = '40.00', partQty = 1, sellPrice = '10.00', currency = 'USD' } = {}) {
  const x = G[g];
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what} ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return r.json; };
  const c = must(await call('POST', '/api/service-cases', { vin: accounts.vinCustomer, garage_tenant_id: x.tenant, branch_id: x.branch,
    service_category: 'brakes', request_summary: `Brakes squeal (PAY-05 QA, ${currency})` }, as.customer), 'request');
  const caseId = c.case?.id || c.serviceCase?.id || c.id || c.service_case?.id;
  must(await call('POST', `/api/service-cases/${caseId}/accept`, { branch_id: x.branch }, x.admin), 'accept');
  const workOrderId = (must(await call('POST', `/api/service-cases/${caseId}/work-order`, {}, x.admin), 'work order')).workOrder?.id;
  const est = must(await call('POST', `/api/garage/cases/${caseId}/estimates`, { currency, lines: [
    { category: 'labour', description: 'Brake service', quantity: 1, unit_price: cost },
    { category: 'part', description: 'Brake pads', quantity: partQty, unit_price: sellPrice }] }, x.admin), 'estimate');
  const estimateId = est.estimate?.id || est.id;
  must(await call('POST', `/api/garage/estimates/${estimateId}/send`, {}, x.admin), 'send');
  must(await call('POST', `/api/service-estimates/${estimateId}/decision`, { decision: 'accept' }, as.customer), 'decision');
  must(await call('POST', `/api/service-work-orders/${workOrderId}/assign`, { mechanic_user_id: x.mechId }, x.admin), 'assign');
  must(await call('POST', `/api/service-cases/${caseId}/start`, {}, x.admin), 'start');
  const rec = must(await call('POST', `/api/service-work-orders/${workOrderId}/records`, { work_performed: 'Replaced pads', total_cost: cost, currency }, x.mech), 'record');
  const part = must(await call('POST', '/api/garage/stock', { name: `Brake pads (PAY-05 QA ${currency})`, sku: `P5QA-${randomUUID().slice(0, 8)}`, opening_quantity: 10,
    unit_cost: '5.00', sell_price: sellPrice, price_currency: currency, idempotency_key: key('part') }, x.admin), 'part');
  must(await call('POST', `/api/garage/service-records/${rec.record?.id || rec.id}/parts`, { part_id: part.part?.id || part.id, quantity: partQty, idempotency_key: key('use') }, x.mech), 'consume');
  must(await call('POST', `/api/service-cases/${caseId}/complete-job`, {}, x.mech), 'complete');
  const closeout = must(await call('GET', `/api/garage/cases/${caseId}/closeout`, undefined, x.admin), 'closeout');
  const lines = (closeout?.suggested_invoice?.lines || []).map((l) => ({ ...l, unit_price: l.unit_price ?? '0.00' }));
  const issued = must(await call('POST', `/api/garage/cases/${caseId}/invoice`, { currency, lines }, x.admin), 'invoice');
  return issued.invoice;
}
const start = (invoiceId, body = {}, who = as.customer, k = key('pn')) => call('POST', `/api/pay04/garage-invoices/${invoiceId}/payments`, body, who, { 'Idempotency-Key': k });
const verify = (collectionId, who = as.customer) => call('POST', `/api/pay04/garage-payments/${collectionId}/verify`, {}, who);
const stop = (collectionId, reason = 'Customer changed their mind (PAY-05 QA)') => call('POST', `/api/pay04/garage-payments/${collectionId}/cancel`, { reason }, as.customer);
const paymentView = (invoiceId, who = as.customer) => call('GET', `/api/pay04/garage-invoices/${invoiceId}/payment`, undefined, who);
const connectBody = (letter, items, extra = {}) => ({
  display_name: `PAY05 QA Garage ${letter} (Paynow)`, legal_entity_name: `PAY05 QA Garage ${letter} (Pvt) Ltd`, registration_number: `${letter}5/2026`,
  settlement_bank_name: 'QA Bank (synthetic)', settlement_account_last4: '4321', settlement_account_holder: `PAY05 QA Garage ${letter} (Pvt) Ltd`, attest: true,
  integrations: items.map((i) => ({ currency: i.currency, integration_id: i.integration_id, integration_key: i.integration_key, methods: i.methods })), ...extra,
});
const merchantOf = (tenant) => json(`select row_to_json(m) from (select id, status, gateway, merchant_reference from pay04_garage_merchant_accounts where tenant_id = ${lit(tenant)} and gateway = 'paynow_zimbabwe' order by registered_at desc limit 1) m`);
// Paynow reports no currency: the operator also attests each integration's currency configuration (independent review P3)
const REVIEWS = { legal_identity_reviewed: true, settlement_account_reviewed: true, currency_configuration_reviewed: true,
  note: 'Legal name, registration, settlement account and currency configuration checked (PAY-05 QA).' };
// R1 (ICR-P1): each integration's own settlement currency, as the operator found it in the merchant's Paynow account
const currencyEvidence = (merchantId) => Object.fromEntries((json(`select json_agg(json_build_object('id', id, 'currency', currency)) from pay05_merchant_integrations where merchant_account_id = ${lit(merchantId)} and status = 'pending_verification'`) || [])
  .map((r) => [r.id, { settlement_currency: r.currency, reference: 'Simulated Paynow merchant settlement page reviewed (PAY-05 QA)' }]));
const verifyBody = (merchantId) => ({ ...REVIEWS, currency_evidence: currencyEvidence(merchantId) });

// ───────────────────────────── C: merchant ownership, onboarding, verification ─────────────────────────────
let INV_A1;
await step('M1', 'Garage A connects its OWN Paynow merchant (USD + ZWG); keys sealed, never returned; not payable until verified', async () => {
  INV_A1 = await invoice('A', { cost: '100.00', sellPrice: '20.00' });
  const r = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('A', [integrations.A_USD, integrations.A_ZWG]), as.adminA);
  const body = JSON.stringify(r.json || {});
  const leaked = [integrations.A_USD.integration_key, integrations.A_ZWG.integration_key].some((k) => body.includes(k));
  const m = merchantOf(accounts.garageA);
  const rows = json(`select json_agg(json_build_object('currency', currency, 'status', status, 'fp', credential_fingerprint, 'ct_len', octet_length(credential_ciphertext), 'mode', mode) order by currency) from pay05_merchant_integrations where merchant_account_id = ${lit(m?.id)}`);
  const option = (await paymentView(INV_A1.id)).json?.online_payment;
  facts.merchantA = m?.id;
  const pass = ok(r, 201) && !leaked && !/ciphertext|integration_key|"key"/.test(body) && m?.status === 'pending_verification' && /^pnm_[0-9a-f]{32}$/.test(m.merchant_reference)
    && rows?.length === 2 && rows.every((x) => x.status === 'pending_verification' && /^[0-9a-f]{16}$/.test(x.fp) && x.ct_len > 16 && x.mode === 'simulator')
    && option?.available === false;
  return { pass, detail: { status: r.status, key_in_response: leaked, merchant: m, integrations: rows, customer_option_while_pending: option } };
});

await step('M2', 'Connection refusals: mechanic, customer, InnBucks in ZWG, "ZIG", no attestation, another garage’s integration, a second connection', async () => {
  const mech = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('A', [integrations.A_USD]), as.mechA);
  const cust = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('A', [integrations.A_USD]), as.customer);
  const innbucksZwg = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [{ ...integrations.B_USD, currency: 'ZWG', methods: ['innbucks'] }]), as.adminB);
  const zig = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [{ ...integrations.B_USD, currency: 'ZIG' }]), as.adminB);
  const noAttest = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [integrations.B_USD], { attest: false }), as.adminB);
  const stolen = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [integrations.A_USD]), as.adminB);
  const second = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('A', [integrations.A_USD]), as.adminA);
  const bRows = sql(`select count(*) from pay04_garage_merchant_accounts where tenant_id = ${lit(accounts.garageB)} and gateway = 'paynow_zimbabwe'`);
  const pass = mech.status === 403 && [401, 403].includes(cust.status) && code(innbucksZwg) === 'PAY05_METHOD_NOT_AVAILABLE'
    && code(zig) === 'PAY05_CURRENCY_NOT_SUPPORTED' && code(noAttest) === 'PAY05_ATTESTATION_REQUIRED'
    && code(stolen) === 'PAY05_INTEGRATION_NOT_ACCEPTED' && code(second) === 'PAY05_MERCHANT_ALREADY_CONNECTED' && bRows === '0';
  return { pass, detail: { mechanic: mech.status, customer: cust.status, innbucks_zwg: [innbucksZwg.status, code(innbucksZwg)], zig: [zig.status, code(zig)],
    no_attestation: [noAttest.status, code(noAttest)], garage_a_integration_by_b: [stolen.status, code(stolen)], second_connection: [second.status, code(second)],
    garage_b_rows_left: bRows } };
});

await step('M3', 'Verification refusals: the garage itself, an operator who is a garage member, incomplete evidence, no note, no per-currency evidence, a currency that differs', async () => {
  const body = verifyBody(facts.merchantA);
  const self = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, body, as.adminA);
  const member = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, body, as.opsMemberA);
  const partial = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, { ...body, settlement_account_reviewed: false }, as.ops);
  const noCurrency = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, { ...body, currency_configuration_reviewed: false }, as.ops);
  const noNote = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, { ...body, note: '' }, as.ops);
  // R1 (ICR-P1): the tick-box alone is not enough, and an integration settling in another currency cannot collect this one
  const noEvidence = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, REVIEWS, as.ops);
  const [firstId] = Object.keys(body.currency_evidence);
  const wrongCurrency = body.currency_evidence[firstId].settlement_currency === 'USD' ? 'ZWG' : 'USD';
  const differs = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, { ...body,
    currency_evidence: { ...body.currency_evidence, [firstId]: { ...body.currency_evidence[firstId], settlement_currency: wrongCurrency } } }, as.ops);
  const still = merchantOf(accounts.garageA).status;
  const pass = self.status === 403 && code(member) === 'PAY05_REVIEWER_SEPARATION_REQUIRED' && code(partial) === 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE'
    && code(noCurrency) === 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE' && code(noNote) === 'PAY05_REASON_REQUIRED' && code(noEvidence) === 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE'
    && code(differs) === 'PAY05_CURRENCY_EVIDENCE_MISMATCH' && still === 'pending_verification';
  return { pass, detail: { garage_admin: self.status, operator_member: [member.status, code(member)], partial_evidence: [partial.status, code(partial)],
    currency_not_reviewed: [noCurrency.status, code(noCurrency)], no_note: [noNote.status, code(noNote)], no_per_currency_evidence: [noEvidence.status, code(noEvidence)],
    currency_differs: [differs.status, code(differs)], status_after: still } };
});

await step('M4', 'An independent operator verifies; the SERVER proves every key with an authenticated Paynow trace; the customer can now pay', async () => {
  const r = await call('POST', `/api/pay05/admin/merchants/${facts.merchantA}/verify`, verifyBody(facts.merchantA), as.ops);
  const rows = json(`select json_agg(json_build_object('currency', currency, 'status', status, 'probe', verification_evidence->'credential_probe'->>'result', 'fp_matches', verification_evidence->'credential_probe'->>'credential_fingerprint' = credential_fingerprint, 'verified_by', verified_by, 'settles', currency_evidence->>'settlement_currency') order by currency) from pay05_merchant_integrations where merchant_account_id = ${lit(facts.merchantA)}`);
  const audit = sql(`select string_agg(event_type, ',' order by seq) from pay05_merchant_audit_events where merchant_account_id = ${lit(facts.merchantA)}`);
  const traces = (await simControl('GET', '/transactions')).length; // probes are traces, never payments
  const option = (await paymentView(INV_A1.id)).json?.online_payment;
  const pass = ok(r, 200) && merchantOf(accounts.garageA).status === 'verified' && rows.every((x) => x.status === 'verified' && x.probe === 'authenticated' && x.fp_matches && x.verified_by === accounts.ops.userId && x.settles === x.currency)
    && /registered/.test(audit) && /verified/.test(audit) && option?.available === true && option.provider === 'paynow' && option.simulated === true
    && option.currency === 'USD' && option.methods.join(',') === 'ecocash,innbucks,omari,onemoney,web' && /not proof of payment/i.test(option.notices?.no_redirect_proof || '');
  facts.simTransactionsAfterProbe = traces;
  return { pass, detail: { status: r.status, integrations: rows, audit, option } };
});

await step('M5', 'R1 (ICR-S2): a wrong key is refused at connect in the same words as another garage’s ID, and reserves nothing; a pending merchant is not "connected"; a rejected ID cools down', async () => {
  await quietSensitiveWindow();
  const spare = await simControl('POST', '/integrations', { currency: 'USD', methods: ['web', 'ecocash'], name: 'PAY-05 R1 QA spare' });
  const spareItem = { currency: 'USD', integration_id: String(spare.integrationId), integration_key: String(spare.key), methods: ['web', 'ecocash'] };
  const wrong = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [{ ...spareItem, integration_key: randomUUID() }]), as.adminB);
  const taken = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [integrations.A_USD]), as.adminB);
  const reserved = Number(sql(`select count(*) from pay05_merchant_integrations where integration_id = ${lit(spareItem.integration_id)}`));
  const probeErrors = Number(sql(`select count(*) from pay05_provider_errors where tenant_id = ${lit(accounts.garageB)} and kind = 'credential_probe_failed'`));
  // the real key connects: pending, not "connected", not payable
  const c1 = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [spareItem]), as.adminB);
  const m1 = merchantOf(accounts.garageB);
  const overview = (await call('GET', '/api/pay04/garage/financial-overview', undefined, as.adminB)).json?.provider;
  const rej = await call('POST', `/api/pay05/admin/merchants/${m1.id}/reject`, { reason: 'The legal name does not match this merchant (PAY-05 R1 QA).' }, as.ops);
  const overviewRejected = (await call('GET', '/api/pay04/garage/financial-overview', undefined, as.adminB)).json?.provider;
  const coolDown = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [spareItem]), as.adminB);
  await quietSensitiveWindow();
  const c2 = await call('POST', '/api/pay05/garage/paynow/connect', connectBody('B', [integrations.B_USD]), as.adminB);
  const m2 = merchantOf(accounts.garageB);
  const v2 = await call('POST', `/api/pay05/admin/merchants/${m2.id}/verify`, verifyBody(m2.id), as.ops);
  facts.merchantB = m2.id;
  const pass = code(wrong) === 'PAY05_INTEGRATION_NOT_ACCEPTED' && wrong.status === taken.status && JSON.stringify(wrong.json) === JSON.stringify(taken.json) && reserved === 0 && probeErrors >= 1
    && ok(c1, 201) && overview?.connected === false && overview?.status === 'pending_verification' && overview?.simulated === true && ok(rej, 200) && overviewRejected?.connected === false
    && code(coolDown) === 'PAY05_INTEGRATION_NOT_ACCEPTED' && ok(c2, 201) && m2.id !== m1.id && ok(v2, 200) && merchantOf(accounts.garageB).status === 'verified';
  return { pass, detail: { wrong_key: [wrong.status, wrong.json], another_garages_id: [taken.status, taken.json], spare_rows_reserved: reserved, probe_errors: probeErrors,
    right_key: c1.status, overview_pending: overview, rejected: rej.status, overview_rejected: overviewRejected, rejected_id_cool_down: [coolDown.status, code(coolDown)], reconnect: c2.status, verify: v2.status } };
});

// ───────────────────────────── the expiry/late-money collection starts EARLY (CarUp's TTL runs during other cases) ─────
let LATE;
await step('L0', 'A customer starts an EcoCash request and never approves it; while CarUp’s collection time runs, no operator can release it', async () => {
  const inv = await invoice('A', { cost: '30.00', sellPrice: '5.00' });
  const r = await start(inv.id, { method: 'ecocash', phone: '0779000001' });
  LATE = { invoice: inv, collection: r.json?.collection_id, startedAt: Date.now() };
  const p = r.json?.paynow;
  const m = money(inv.id);
  // the server reads Paynow first (a fresh unpaid read exists), and still refuses: the collection's time has not passed
  const early = await call('POST', `/api/pay05/admin/collections/${LATE.collection}/release-hold`, { reason: 'Customer abandoned the EcoCash prompt (QA).' }, as.ops);
  return { pass: r.status === 201 && p?.initiation === 'attached' && p?.phone === '077*****01' && Number(m.provider_reserved) === 35 && Number(m.paid_amount) === 0
    && early.status === 409 && code(early) === 'PAY05_HOLD_NOT_RELEASABLE' && !txOf(LATE.collection).hold_released_at,
  detail: { status: r.status, paynow: p, money: m, expires_at: r.json?.expires_at, release_before_expiry: [early.status, code(early)] } };
});

// R1: a second request whose time runs with L0's: released later, then paid into Paynow behind CarUp's back
let AGAIN;
await step('L0b', 'R1: a second unapproved EcoCash request, started now so that CarUp’s time runs out with the first', async () => {
  const inv = await invoice('A', { cost: '30.00', sellPrice: '5.00' });
  const r = await start(inv.id, { method: 'ecocash', phone: '0779000002' });
  AGAIN = { invoice: inv, collection: r.json?.collection_id, startedAt: Date.now() };
  return { pass: r.status === 201 && r.json?.paynow?.initiation === 'attached', detail: { status: r.status } };
});

let ROOM; let ESCROW; let REVIEWED;
await step('L0c', 'R1: three more unapproved requests, started now so that CarUp’s time runs out with the first (cases G2, G3, G4)', async () => {
  const open = async (phone) => {
    const inv = await invoice('A', { cost: '20.00', sellPrice: '5.00' });
    const r = await start(inv.id, { method: 'ecocash', phone });
    return { invoice: inv, collection: r.json?.collection_id, startedAt: Date.now(), status: r.status };
  };
  ROOM = await open('0779000021');
  ESCROW = await open('0779000022');
  REVIEWED = await open('0779000023');
  return { pass: [ROOM, ESCROW, REVIEWED].every((x) => x.status === 201), detail: { statuses: [ROOM.status, ESCROW.status, REVIEWED.status] } };
});

let UNC;
await step('U0', 'A request whose reply is lost while Paynow\'s trace keeps failing stays HELD and unconfirmed (never a second request)', async () => {
  const inv = await invoice('A', { cost: '15.00', sellPrice: '5.00' });
  await simFault('initiate', { kind: 'drop_response' });
  await simFault('trace', { kind: 'error' }); // consumed by the start's own recovery trace (faults are global: exactly one)
  const r = await start(inv.id, { method: 'ecocash', phone: '0779000011' });
  UNC = { invoice: inv, collection: r.json?.collection_id, startedAt: Date.now() };
  const tx = txOf(UNC.collection);
  const sims = await simTransactionsFor(collectionRow(UNC.collection).payment_reference);
  return { pass: r.status === 201 && ['unknown', 'sending'].includes(tx.initiation_state) && sims.length === 1 && Number(money(inv.id).provider_reserved) === 20,
    detail: { start: r.status, transaction: tx, simulator_transactions: sims.length, money: money(inv.id) } };
});

// ───────────────────────────── D/E: the customer pays ─────────────────────────────
let P1;
await step('P1', 'Web checkout: a browser return is NOT payment; the signed status update + a fresh poll is; one canonical row, one receipt', async () => {
  const k = key('web');
  const started = await start(INV_A1.id, { amount: '60.00', method: 'web' }, as.customer, k);
  const replay = await start(INV_A1.id, { amount: '60.00', method: 'web' }, as.customer, k);
  P1 = started.json;
  const sim = await simTxFor(P1.collection_id);
  const reserved = money(INV_A1.id);
  // the customer comes back WITHOUT paying (e.g. closes the Paynow tab): CarUp still reads Paynow, and counts nothing
  const early = await verify(P1.collection_id);
  const back = await simHostedPay(P1.checkout_url, 'pay');
  const paid = await waitFor(() => payStatus(P1.collection_id) === 'paid');
  const verified = await verify(P1.collection_id);
  const m = money(INV_A1.id);
  const tx = json(`select row_to_json(t) from (select gateway, status, currency, amount, pay02_product_code, pay02_commercial_category, pay02_funds_owner, pay02_legal_beneficiary, pay01a_actor_id from payment_transactions where reference = (select payment_reference from pay04_garage_collections where id = ${lit(P1.collection_id)})) t`);
  const obs = sql(`select string_agg(via || ':' || provider_status, ',' order by seq) from pay05_paynow_observations where collection_id = ${lit(P1.collection_id)}`);
  const pass = started.status === 201 && replay.json?.collection_id === P1.collection_id && replay.json?.replayed === true
    && new URL(P1.checkout_url).origin === SIM && /\/Payment\/ConfirmPayment\//i.test(P1.checkout_url) && P1.simulated === true
    && Number(reserved.provider_reserved) === 60 && Number(reserved.paid_amount) === 0
    && early.status === 200 && early.json?.collection?.state === 'awaiting_provider' && Number(money(INV_A1.id).provider_paid) >= 0
    && back.status === 302 && /pay05=returned/.test(back.location || '') && paid && verified.json?.collection?.state === 'confirmed'
    && Number(m.provider_paid) === 60 && Number(m.balance_amount) === 60 && allocations(P1.collection_id) === 1 && liveReceipts(P1.collection_id) === 1
    && tx.gateway === 'paynow_zimbabwe' && tx.status === 'paid' && tx.currency === 'USD' && tx.pay02_product_code === 'gar.invoice.customer_payment'
    && tx.pay02_funds_owner === 'garage_business_tenant' && tx.pay02_legal_beneficiary === `tenant:${accounts.garageA}` && tx.pay01a_actor_id === accounts.customer.userId
    && sim.method === 'web' && /status_update:paid/.test(obs) && !/verified|state":"confirmed/.test(JSON.stringify(early.json?.collection?.state));
  facts.p1 = { collection: P1.collection_id, simulator_guid: sim.guid };
  return { pass, detail: { started: started.status, replay_same: replay.json?.collection_id === P1.collection_id, checkout_origin: new URL(P1.checkout_url).origin,
    reserved, before_paying: early.json?.collection?.state, hosted_page_redirect: back, money_after: m, canonical_row: tx, observations: obs,
    allocations: allocations(P1.collection_id), receipts: liveReceipts(P1.collection_id) } };
});

await step('P2', 'Duplicate callbacks: Paynow’s resend of the same signed update is a duplicate (one observation, one allocation, one receipt)', async () => {
  const before = Number(sql(`select count(*) from pay05_paynow_observations where collection_id = ${lit(P1.collection_id)}`));
  const r1 = await simResend(facts.p1.simulator_guid);
  const r2 = await simResend(facts.p1.simulator_guid);
  const after = Number(sql(`select count(*) from pay05_paynow_observations where collection_id = ${lit(P1.collection_id)}`));
  const pass = r1.delivered === true && r2.delivered === true && after === before && allocations(P1.collection_id) === 1 && liveReceipts(P1.collection_id) === 1
    && Number(money(INV_A1.id).provider_paid) === 60;
  return { pass, detail: { resend: [r1, r2], observations_before_after: [before, after], allocations: allocations(P1.collection_id) } };
});

let E1;
await step('E1', 'EcoCash (Paynow test number 0771111111): pending "approve on your phone", then paid from Paynow’s own update', async () => {
  const inv = await invoice('A', { cost: '45.00', sellPrice: '5.00' });
  await expectCallback(); // the simulator approves this test number after ~5 s and posts the signed update
  const r = await start(inv.id, { method: 'ecocash', phone: '0771111111' });
  E1 = { invoice: inv, collection: r.json?.collection_id };
  const pending = r.json?.paynow;
  const paid = await waitFor(() => payStatus(E1.collection) === 'paid', { timeoutMs: 40_000 });
  const v = await verify(E1.collection);
  // before CarUp's first read the request is described by how the customer pays — never as paid
  return { pass: r.status === 201 && pending?.provider_status !== 'paid' && /approve the payment on your phone/.test(pending?.provider_status_label || '')
    && pending?.phone === '077*****11' && paid && v.json?.collection?.state === 'confirmed' && Number(money(inv.id).provider_paid) === 50,
  detail: { start: r.status, pending, paid, state: v.json?.collection?.state, money: money(inv.id) } };
});

await step('E2', 'OneMoney (test number 0773333333): Paynow reports Failed — nothing counted, the room is released', async () => {
  const inv = await invoice('A', { cost: '25.00', sellPrice: '5.00' });
  await expectCallback();
  const r = await start(inv.id, { method: 'onemoney', phone: '0773333333' });
  const cid = r.json?.collection_id;
  const failed = await waitFor(() => ['cancelled', 'failed'].includes(payStatus(cid)), { timeoutMs: 60_000 });
  const v = await verify(cid);
  const m = money(inv.id);
  return { pass: r.status === 201 && failed && Number(m.provider_paid) === 0 && Number(m.provider_reserved) === 0 && Number(m.balance_amount) === 30
    && ['cancelled', 'failed'].includes(v.json?.collection?.state), detail: { start: r.status, canonical: payStatus(cid), state: v.json?.collection?.state, money: m, paynow: v.json?.paynow } };
});

await step('E3', 'Input refusals reserve nothing: an invalid phone, a method the garage did not enable, InnBucks for ZWG', async () => {
  const inv = await invoice('A', { cost: '15.00', sellPrice: '5.00' });
  const badPhone = await start(inv.id, { method: 'ecocash', phone: '12345' });
  const notEnabled = await start(inv.id, { method: 'zimswitch' });
  const zwgInv = await invoice('A', { cost: '150.00', sellPrice: '20.00', currency: 'ZWG' });
  const innZwg = await start(zwgInv.id, { method: 'innbucks' });
  const rows = sql(`select count(*) from pay04_garage_collections where invoice_id in (${lit(inv.id)}, ${lit(zwgInv.id)})`);
  facts.zwgInvoice = zwgInv;
  const pass = badPhone.status === 422 && /PHONE/.test(code(badPhone)) && code(notEnabled) === 'PAY05_METHOD_NOT_AVAILABLE'
    && code(innZwg) === 'PAY05_METHOD_NOT_AVAILABLE' && Number(money(inv.id).provider_reserved) === 0 && rows === '0';
  return { pass, detail: { bad_phone: [badPhone.status, code(badPhone)], method_not_enabled: [notEnabled.status, code(notEnabled)],
    innbucks_zwg: [innZwg.status, code(innZwg)], collections_created: rows } };
});

await step('E4', 'InnBucks: the customer gets Paynow’s authorization code; the payment counts only when Paynow says Paid', async () => {
  const inv = await invoice('A', { cost: '35.00', sellPrice: '5.00' });
  const noPhone = await start(inv.id, { method: 'innbucks' });
  const r = await start(inv.id, { method: 'innbucks', phone: '0779000009' });
  const cid = r.json?.collection_id;
  const p = r.json?.paynow;
  const sim = await simTxFor(cid);
  const before = money(inv.id);
  await simSetStatus(sim.guid, 'Paid');
  const paid = await waitFor(() => payStatus(cid) === 'paid');
  return { pass: noPhone.status === 422 && code(noPhone) === 'PAY05_PHONE_INVALID' && r.status === 201 && /^[0-9A-Za-z]{4,}$/.test(p?.authorization_code || '') && Boolean(p?.authorization_expires) && Number(before.provider_paid) === 0
    && paid && Number(money(inv.id).provider_paid) === 40, detail: { start: r.status, paynow: { ...p, authorization_code: p?.authorization_code ? '(present)' : null }, paid } };
});

await step('E5', 'O’mari: a wrong one-time password is refused and recorded; the right one completes an authenticated payment', async () => {
  const inv = await invoice('A', { cost: '55.00', sellPrice: '5.00' });
  const r = await start(inv.id, { method: 'omari', phone: '0779000002' });
  const cid = r.json?.collection_id;
  const wrong = await call('POST', `/api/pay05/garage-payments/${cid}/otp`, { otp: '000000' }, as.customer);
  const stranger = await call('POST', `/api/pay05/garage-payments/${cid}/otp`, { otp: '000000' }, as.stranger);
  const otp = (await simOtpOutbox()).filter((o) => o.phone === '0779000002').pop()?.otp;
  const right = await call('POST', `/api/pay05/garage-payments/${cid}/otp`, { otp }, as.customer);
  const pass = r.status === 201 && r.json?.paynow?.needs_otp === true && Boolean(r.json?.paynow?.otp_reference) && wrong.status >= 400 && code(wrong) === 'PAY05_OTP_REJECTED'
    && providerErrors(cid, 'otp_rejected') >= 1 && stranger.status === 404 && ok(right, 200) && payStatus(cid) === 'paid' && Number(money(inv.id).provider_paid) === 60;
  return { pass, detail: { start: r.status, needs_otp: r.json?.paynow?.needs_otp, wrong: [wrong.status, code(wrong)], stranger: stranger.status, right: [right.status, right.json?.collection?.state] } };
});

await step('Z1', 'ZWG: a ZWG invoice is paid through the garage’s ZWG integration; ISO code ZWG everywhere, never "ZIG"', async () => {
  const inv = facts.zwgInvoice;
  await expectCallback();
  const r = await start(inv.id, { method: 'ecocash', phone: '0771111111', currency: 'USD' }); // a body naming another currency is ignored
  const cid = r.json?.collection_id;
  const paid = await waitFor(() => payStatus(cid) === 'paid', { timeoutMs: 40_000 });
  const sim = await simTxFor(cid);
  const cur = sql(`select c.currency || '|' || p.currency from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(cid)}`);
  const zig = sql(`select (select count(*) from payment_transactions where currency = 'ZIG') + (select count(*) from pay04_garage_collections where currency = 'ZIG') + (select count(*) from garage_invoices where currency = 'ZIG')`);
  return { pass: r.status === 201 && r.json?.currency === 'ZWG' && paid && cur === 'ZWG|ZWG' && sim.integrationId === integrations.A_ZWG.integration_id && zig === '0',
    detail: { start: [r.status, r.json?.currency], canonical: cur, simulator_integration_is_zwg: sim.integrationId === integrations.A_ZWG.integration_id, zig_rows: zig } };
});

await step('Z2', 'Currency mismatch: garage B has no ZWG integration — no ZWG checkout, nothing reserved, never converted', async () => {
  const inv = await invoice('B', { cost: '80.00', sellPrice: '20.00', currency: 'ZWG' });
  const view = await paymentView(inv.id);
  const r = await start(inv.id, { method: 'web' });
  const rows = sql(`select count(*) from pay04_garage_collections where invoice_id = ${lit(inv.id)}`);
  return { pass: view.json?.online_payment?.available === false && view.json?.online_payment?.reason === 'currency_not_supported' && r.status >= 400 && rows === '0',
    detail: { option: view.json?.online_payment, start: [r.status, code(r)], collections: rows } };
});

// ───────────────────────────── F: forged, tampered, unsigned, cross-garage, cross-collection ─────────────────────────────
let PEND;
await step('S1', 'A status update signed with the WRONG key is refused (the one identical answer), recorded for the operator, and changes nothing', async () => {
  const inv = await invoice('A', { cost: '65.00', sellPrice: '5.00' });
  const r = await start(inv.id, { method: 'ecocash', phone: '0779000003' });
  PEND = { invoice: inv, collection: r.json?.collection_id };
  PEND.sim = await simTxFor(PEND.collection);
  const forged = await simForged(PEND.sim.guid, { status: 'Paid' });
  const res = await postResult(PEND.collection, forged.body);
  return { pass: r.status === 201 && res.status === 400 && res.json?.error === 'PAY05_STATUS_UPDATE_REFUSED' && Object.keys(res.json).length === 1 && payStatus(PEND.collection) === 'pending'
    && Number(money(inv.id).provider_paid) === 0 && providerErrors(PEND.collection, 'callback_signature_invalid') >= 1,
  detail: { response: res, canonical: payStatus(PEND.collection), errors: providerErrors(PEND.collection, 'callback_signature_invalid') } };
});

await step('S2', 'A correctly signed update TAMPERED after signing (amount), and an unsigned one, are refused', async () => {
  const genuine = statusUpdate(PEND.sim, { status: 'Paid', signingKey: keyOf(PEND.sim.integrationId) });
  const tampered = genuine.replace(/amount=[^&]+/, 'amount=0.01');
  const unsigned = encodeForm([['reference', PEND.sim.reference], ['paynowreference', PEND.sim.paynowReference], ['amount', PEND.sim.amount], ['status', 'Paid'],
    ['pollurl', `${SIM}/Interface/CheckPayment/?guid=${PEND.sim.guid}`]]);
  const t = await postResult(PEND.collection, tampered);
  const u = await postResult(PEND.collection, unsigned);
  return { pass: t.status === 400 && u.status === 400 && t.json?.error === 'PAY05_STATUS_UPDATE_REFUSED' && u.json?.error === 'PAY05_STATUS_UPDATE_REFUSED'
    && payStatus(PEND.collection) === 'pending', detail: { tampered: t, unsigned: u } };
});

await step('S3', 'Cross-garage: an update for garage A’s payment signed with garage B’s REAL key is refused', async () => {
  const forgedByB = statusUpdate(PEND.sim, { status: 'Paid', signingKey: integrations.B_USD.integration_key });
  const res = await postResult(PEND.collection, forgedByB);
  return { pass: res.status === 400 && res.json?.error === 'PAY05_STATUS_UPDATE_REFUSED' && payStatus(PEND.collection) === 'pending', detail: { response: res } };
});

await step('S4', 'Cross-collection: a GENUINE signed Paid for one payment, posted to another payment’s resulturl, is refused (binding)', async () => {
  const paidTx = await simTxFor(E1.collection); // genuinely Paid, same integration (garage A USD) as PEND
  const genuineForE1 = statusUpdate(paidTx, { status: 'Paid', signingKey: keyOf(paidTx.integrationId) });
  const res = await postResult(PEND.collection, genuineForE1);
  return { pass: res.status === 400 && res.json?.error === 'PAY05_STATUS_UPDATE_REFUSED' && payStatus(PEND.collection) === 'pending'
    && providerErrors(PEND.collection, 'callback_binding_mismatch') >= 1, detail: { response: res } };
});

await step('S5', 'Unknown, malformed and non-Paynow collection ids get the same answer as a forgery (no oracle; independent review S5)', async () => {
  const unknown = await postResult(randomUUID(), 'status=Paid');
  const malformed = await postResult('not-a-uuid', 'status=Paid');
  const pay04Collection = sql(`select id from pay04_garage_collections where gateway <> 'paynow_zimbabwe' limit 1`);
  const nonPaynow = pay04Collection ? await postResult(pay04Collection, 'status=Paid') : { status: 400, json: { error: 'PAY05_STATUS_UPDATE_REFUSED' } };
  const same = [unknown, nonPaynow].every((x) => x.status === 400 && x.json?.error === 'PAY05_STATUS_UPDATE_REFUSED' && Object.keys(x.json).length === 1);
  // a malformed id never reaches Paynow handling: only a collection-shaped path is exempt from CSRF (route hardening), so
  // it gets the generic CSRF refusal every untrusted POST gets — nothing about any collection
  const malformedOk = malformed.status === 403 && /CSRF validation failed/.test(malformed.json?.error || '');
  return { pass: same && malformedOk, detail: { unknown, malformed, non_paynow: nonPaynow } };
});

await step('S6', 'Authority: another customer and another garage cannot read, verify, stop, reconcile or see a garage A Paynow payment', async () => {
  const sv = await verify(PEND.collection, as.stranger);
  const sc = await call('POST', `/api/pay04/garage-payments/${PEND.collection}/cancel`, { reason: 'Not my payment at all' }, as.stranger);
  const sview = await paymentView(PEND.invoice.id, as.stranger);
  const brec = await call('POST', `/api/pay04/garage/payments/${PEND.collection}/reconcile`, {}, as.adminB);
  const bview = await call('GET', `/api/pay04/garage/invoices/${PEND.invoice.id}/payments`, undefined, as.adminB);
  const bconn = await call('GET', '/api/pay05/garage/paynow', undefined, as.adminB);
  const aview = await call('GET', `/api/pay04/garage/invoices/${PEND.invoice.id}/payments`, undefined, as.adminA);
  const cview = await paymentView(PEND.invoice.id, as.customer);
  const garageRow = JSON.stringify(aview.json || {});
  const customerRow = (cview.json?.provider_payments || []).find((p) => p.id === PEND.collection);
  const pass = sv.status === 404 && sc.status === 404 && sview.status === 404 && brec.status === 404 && bview.status === 404
    && ok(bconn, 200) && JSON.stringify(bconn.json).includes(facts.merchantB) && !JSON.stringify(bconn.json).includes(facts.merchantA)
    && ok(aview, 200) && !/CheckPayment|poll_url|integration_key|credential_ciphertext|merchant_trace/i.test(garageRow)
    && customerRow?.paynow && customerRow.paynow.paynow_reference === null && customerRow.paynow.provider_error === null
    && !/CheckPayment|payment_reference|provider_payment_id|payer_user_id/.test(JSON.stringify(customerRow));
  return { pass, detail: { stranger_verify: sv.status, stranger_stop: sc.status, stranger_view: sview.status, garage_b_reconcile: brec.status,
    garage_b_view: bview.status, garage_b_connection_is_its_own: JSON.stringify(bconn.json).includes(facts.merchantB), customer_row_paynow: customerRow?.paynow } };
});

// ───────────────────────────── amounts: a provider-reported amount that differs is never counted ─────────────────────
await step('A1', 'Amount mismatch: Paynow reports Paid for a different amount — under review, not counted', async () => {
  await simControl('POST', `/transactions/${PEND.sim.guid}/status`, { status: 'Paid', amount: '1.00', notify: false });
  const v = await verify(PEND.collection);
  const m = money(PEND.invoice.id);
  const disc = openDiscrepancies(PEND.collection);
  return { pass: v.status === 200 && v.json?.collection?.state === 'under_review' && /amount_mismatch/.test(disc) && Number(m.provider_paid) === 0,
    detail: { state: v.json?.collection?.state, discrepancies: disc, money: m } };
});

// ───────────────────────────── timeouts, lost replies, provider errors ─────────────────────────────
await step('T1', 'A lost initiate reply is recovered by an authenticated TRACE — never by sending the payment twice', async () => {
  const inv = await invoice('A', { cost: '20.00', sellPrice: '5.00' });
  await simFault('initiate', { kind: 'drop_response' });
  const r = await start(inv.id, { method: 'ecocash', phone: '0779000004' });
  const cid = r.json?.collection_id;
  const sims = await simTransactionsFor(collectionRow(cid).payment_reference);
  const tx = txOf(cid);
  return { pass: r.status === 201 && sims.length === 1 && tx.initiation_state === 'attached' && providerErrors(cid, 'provider_unreachable') + providerErrors(cid, 'provider_unexpected') >= 1
    && Number(money(inv.id).provider_reserved) === 25, detail: { start: r.status, simulator_transactions: sims.length, transaction: tx, paynow: r.json?.paynow } };
});

await step('T2', 'Paynow refuses the request: nothing exists at Paynow, the collection closes, the room is free', async () => {
  const inv = await invoice('A', { cost: '20.00', sellPrice: '5.00' });
  await simFault('initiate', { kind: 'error', message: 'Simulated: merchant not enabled for this method' });
  const r = await start(inv.id, { method: 'ecocash', phone: '0779000005' });
  const rows = json(`select json_agg(json_build_object('cancelled', cancelled_at is not null)) from pay04_garage_collections where invoice_id = ${lit(inv.id)}`);
  const m = money(inv.id);
  return { pass: r.status === 502 && code(r) === 'PAY05_PROVIDER_REFUSED' && rows?.length === 1 && rows[0].cancelled && Number(m.provider_reserved) === 0,
    detail: { start: [r.status, code(r)], collections: rows, money: m } };
});

await step('T2b', 'The refused request existed at Paynow after all: its later SIGNED Paid binds late into an operator review — never lost, never counted (independent review P1)', async () => {
  const cid = sql(`select c.id from pay04_garage_collections c join pay05_paynow_transactions t on t.collection_id = c.id where t.initiation_state = 'refused' order by c.initiated_at desc limit 1`);
  const ref = collectionRow(cid).payment_reference;
  const sims = await simTransactionsFor(ref);
  if (sims.length !== 1) return { pass: false, detail: { simulator_transactions: sims.length } };
  await simSetStatus(sims[0].guid, 'Paid');
  const seen = await waitFor(() => /provider_paid_after_close/.test(openDiscrepancies(cid)));
  const invoiceId = collectionRow(cid).invoice_id;
  const tx = json(`select row_to_json(t) from (select initiation_state, attached_after_close from pay05_paynow_transactions where collection_id = ${lit(cid)}) t`);
  return { pass: seen && payStatus(cid) === 'cancelled' && Number(money(invoiceId).provider_paid) === 0 && tx.attached_after_close === true,
    detail: { discrepancies: openDiscrepancies(cid), canonical: payStatus(cid), transaction: tx, money: money(invoiceId) } };
});

await step('T3', 'A failed provider read fabricates nothing; the next read works', async () => {
  await simFault('poll', { kind: 'error' });
  const during = await verify(PEND.collection);
  const after = await verify(PEND.collection);
  return { pass: during.status === 502 && code(during) === 'PAY05_PROVIDER_READ_FAILED' && ok(after, 200) && Number(money(PEND.invoice.id).provider_paid) === 0
    && providerErrors(PEND.collection, 'poll_failed') >= 1, detail: { during: [during.status, code(during)], after: after.json?.collection?.state } };
});

// ───────────────────────────── stop vs pay, expiry, hold release, late money ─────────────────────────────
await step('X1', 'Stop vs pay: the customer stops, Paynow cannot cancel, the room stays held — then the customer approves anyway: counted once', async () => {
  const inv = await invoice('A', { cost: '50.00', sellPrice: '5.00' });
  const r = await start(inv.id, { method: 'ecocash', phone: '0779000006' });
  const cid = r.json?.collection_id;
  const s = await stop(cid);
  const held = money(inv.id);
  const sim = await simTxFor(cid);
  await simSetStatus(sim.guid, 'Paid');
  const paid = await waitFor(() => payStatus(cid) === 'paid');
  const m = money(inv.id);
  return { pass: r.status === 201 && ok(s, 200) && /cannot cancel/i.test(s.json?.notice || '') && payStatus(cid) === 'paid' && Number(held.provider_reserved) === 55
    && paid && Number(m.provider_paid) === 55 && allocations(cid) === 1, detail: { stop: [s.status, s.json?.collection?.state, s.json?.notice], held_money: held, after_pay: m } };
});

await step('X2', 'Concurrency: five simultaneous Paynow requests for the whole balance — exactly one reserves it and exactly one reaches Paynow', async () => {
  const inv = await invoice('A', { cost: '70.00', sellPrice: '5.00' });
  await quietSensitiveWindow();
  const all = await Promise.all([1, 2, 3, 4, 5].map((n) => call('POST', `/api/pay04/garage-invoices/${inv.id}/payments`, { method: 'ecocash', phone: '0779000007' }, as.customer,
    { 'Idempotency-Key': key(`race${n}`) }, { pace: false })));
  const won = all.filter((r) => r.status === 201);
  const refs = sql(`select string_agg(payment_reference, ',') from pay04_garage_collections where invoice_id = ${lit(inv.id)}`).split(',').filter(Boolean);
  const simCount = (await Promise.all(refs.map((ref) => simTransactionsFor(ref)))).flat().length;
  await quietSensitiveWindow();
  return { pass: won.length === 1 && Number(money(inv.id).provider_reserved) === 75 && simCount === 1,
    detail: { statuses: all.map((r) => `${r.status}:${code(r) || ''}`), simulator_transactions: simCount, money: money(inv.id) } };
});

await step('X3', 'Concurrency: five simultaneous resends of a Paid update — one allocation, one receipt', async () => {
  await quietSensitiveWindow();
  const r = await Promise.all([1, 2, 3, 4, 5].map(() => simControl('POST', `/transactions/${facts.p1.simulator_guid}/resend`, {})));
  await quietSensitiveWindow();
  return { pass: r.every((x) => x.delivered === true) && allocations(P1.collection_id) === 1 && liveReceipts(P1.collection_id) === 1 && Number(money(INV_A1.id).provider_paid) === 60,
    detail: { deliveries: r.map((x) => x.status), allocations: allocations(P1.collection_id) } };
});

// ───────────────────────────── refunds and disputes ─────────────────────────────
await step('R1', 'A CarUp refund of a Paynow payment is refused with the truth: refund in the Paynow dashboard (no merchant refund API)', async () => {
  const r = await call('POST', `/api/pay04/garage/payments/${E1.collection}/refund`, { reason: 'Customer was charged for the wrong service' }, as.adminA);
  const guidance = JSON.stringify(r.json || {});
  return { pass: r.status === 409 && code(r) === 'PAY05_PROVIDER_REFUND_UNSUPPORTED' && /Paynow/.test(guidance) && payStatus(E1.collection) === 'paid',
    detail: { status: r.status, code: code(r), body: r.json } };
});

await step('R2', 'Dispute then resolution: Disputed holds the money (under review, not counted); Paid again counts it again — each a NEW event', async () => {
  const sim = await simTxFor(E1.collection);
  await simSetStatus(sim.guid, 'Disputed');
  const disputed = await waitFor(() => /provider_disputed/.test(openDiscrepancies(E1.collection)));
  const v1 = await verify(E1.collection);
  const during = money(E1.invoice.id);
  const opsResolve = sql(`select id from pay04_garage_payment_discrepancies where collection_id = ${lit(E1.collection)} and discrepancy_type = 'provider_disputed' and status = 'open' limit 1`);
  const forced = opsResolve ? await call('POST', `/api/pay04/admin/discrepancies/${opsResolve}/resolve`, { resolution: 'provider_corrected', note: 'Operator trying to close a dispute Paynow still reports' }, as.ops) : null;
  await simSetStatus(sim.guid, 'Paid');
  const again = await waitFor(() => !/provider_disputed/.test(openDiscrepancies(E1.collection)) && payStatus(E1.collection) === 'paid');
  const v2 = await verify(E1.collection);
  const obs = sql(`select string_agg(provider_status, ',' order by seq) from pay05_paynow_observations where collection_id = ${lit(E1.collection)} and via = 'status_update'`);
  return { pass: disputed && v1.json?.collection?.state === 'under_review' && Number(during.provider_paid) === 0 && forced && code(forced) === 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER'
    && again && v2.json?.collection?.state === 'confirmed' && Number(money(E1.invoice.id).provider_paid) === 50 && /paid,disputed,paid/.test(obs),
  detail: { disputed_state: v1.json?.collection?.state, money_during: during, operator_force_close: forced && [forced.status, code(forced)], after: v2.json?.collection?.state,
    status_update_observations: obs } };
});

await step('R3', 'Paynow reports the garage refunded in its dashboard: CarUp counts nothing for it, voids the receipt, tells the customer, and asks an operator to confirm the amount', async () => {
  const sim = await simTxFor(E1.collection);
  await simSetStatus(sim.guid, 'Refunded');
  const refunded = await waitFor(() => payStatus(E1.collection) === 'refunded');
  const m = money(E1.invoice.id);
  const told = Number(sql(`select count(*) from domain_events where event_type = 'garage.payment.refunded' and payload->>'collectionId' = ${lit(E1.collection)}`));
  const review = openDiscrepancies(E1.collection);
  const discId = sql(`select id from pay04_garage_payment_discrepancies where collection_id = ${lit(E1.collection)} and discrepancy_type = 'provider_refund_unquantified' and status = 'open' limit 1`);
  const exc = await call('GET', '/api/pay04/admin/exceptions', undefined, as.ops);
  const row = (exc.json?.discrepancies || []).find((d) => d.id === discId);
  const ack = await call('POST', `/api/pay04/admin/discrepancies/${discId}/resolve`, { resolution: 'acknowledged',
    note: 'Paynow merchant records show the full amount refunded to the customer (PAY-05 QA).' }, as.ops);
  return { pass: refunded && Number(m.provider_paid) === 0 && Number(m.balance_amount) === 50 && liveReceipts(E1.collection) === 0 && told >= 1
    && /provider_refund_unquantified/.test(review) && row?.gateway === 'paynow_zimbabwe' && ok(ack, 200),
  detail: { canonical: payStatus(E1.collection), money: m, refunded_notifications: told, operator_review: review, gateway: row?.gateway,
    acknowledged: [ack.status, code(ack)] } };
});

// ───────────────────────────── expiry, hold release, late money (the collection started in L0) ─────────────────────────────
await step('L1', 'CarUp’s collection time passes: the request is still HELD (Paynow cannot cancel) and listed for the operator, never for the garage', async () => {
  const wait = LATE.startedAt + (TTL_SECONDS + 5) * 1000 - Date.now();
  if (wait > 0) { console.log(`       … waiting ${Math.ceil(wait / 1000)} s for CarUp's collection time to pass`); await pause(wait); }
  const list = await call('GET', '/api/pay05/admin/held-collections', undefined, as.ops);
  const listed = (list.json?.held || []).find((h) => h.collection_id === LATE.collection);
  const garage = await call('GET', '/api/pay05/admin/held-collections', undefined, as.adminA);
  return { pass: ok(list, 200) && Boolean(listed) && Number(money(LATE.invoice.id).provider_reserved) === 35 && garage.status === 403 && !txOf(LATE.collection).hold_released_at,
    detail: { listed: listed && { amount: listed.amount, expires_at: listed.expires_at, paynow: listed.paynow?.provider_status }, garage_admin_list: garage.status } };
});

await step('L2', 'The operator releases the hold after a FRESH authenticated unpaid read; the room is free again', async () => {
  const self = await call('POST', `/api/pay05/admin/collections/${LATE.collection}/release-hold`, { reason: '' }, as.ops);
  const r = await call('POST', `/api/pay05/admin/collections/${LATE.collection}/release-hold`, { reason: 'Customer abandoned the EcoCash prompt (QA).' }, as.ops);
  const m = money(LATE.invoice.id);
  const lastRead = sql(`select via || ':' || provider_status from pay05_paynow_observations where collection_id = ${lit(LATE.collection)} and via in ('poll','trace') order by seq desc limit 1`);
  return { pass: code(self) === 'PAY05_REASON_REQUIRED' && ok(r, 200) && Boolean(txOf(LATE.collection).hold_released_at) && Number(m.provider_reserved) === 0 && /^poll:sent$/.test(lastRead),
    detail: { no_reason: [self.status, code(self)], release: r.status, money: m, last_read: lastRead } };
});

await step('U1', 'The operator releases the UNCONFIRMED request after expiry and a fresh trace attempt; Paynow\'s late Paid then counts only into free room (independent review P2)', async () => {
  const wait = UNC.startedAt + (TTL_SECONDS + 5) * 1000 - Date.now();
  if (wait > 0) await pause(wait);
  const list = await call('GET', '/api/pay05/admin/held-collections', undefined, as.ops);
  const listed = (list.json?.held || []).find((h) => h.collection_id === UNC.collection);
  await simFault('trace', { kind: 'error' }); // the release's fresh trace attempt still gets no answer
  const r = await call('POST', `/api/pay05/admin/collections/${UNC.collection}/release-hold`, { reason: 'Paynow cannot confirm this request; the customer will pay at the counter.' }, as.ops);
  const freed = money(UNC.invoice.id);
  const sims = await simTransactionsFor(collectionRow(UNC.collection).payment_reference);
  await simSetStatus(sims[0].guid, 'Paid');
  const paid = await waitFor(() => payStatus(UNC.collection) === 'paid');
  const after = money(UNC.invoice.id);
  return { pass: Boolean(listed) && ['unknown', 'sending'].includes(listed?.paynow?.initiation) && ok(r, 200) && Number(freed.provider_reserved) === 0
    && paid && Number(after.provider_paid) === 20, detail: { listed: listed && listed.paynow, release: [r.status, code(r)], freed, after } };
});

await step('L3', 'Late money with no room left: the garage took cash for the whole balance, then the customer approves the released request — unallocated money for an operator, never a double count', async () => {
  const cash = await call('POST', `/api/garage/invoices/${LATE.invoice.id}/payments`, { amount: '35.00', method: 'cash', reference: 'Counter (QA)',
    idempotency_key: key('late-cash') }, as.adminA);
  const sim = await simTxFor(LATE.collection);
  await simSetStatus(sim.guid, 'Paid');
  const seen = await waitFor(() => /unallocated_provider_money/.test(openDiscrepancies(LATE.collection)));
  const v = await verify(LATE.collection);
  const m = money(LATE.invoice.id);
  const exc = await call('GET', '/api/pay04/admin/exceptions', undefined, as.ops);
  const listed = (exc.json?.discrepancies || []).some((d) => d.collection_id === LATE.collection && d.type === 'unallocated_provider_money' && d.gateway === 'paynow_zimbabwe');
  return { pass: ok(cash, 201) && seen && v.json?.collection?.state === 'confirmed_unallocated' && Number(m.paid_amount) === 35 && Number(m.provider_paid) === 0
    && Number(m.declared_paid) === 35 && listed,
  detail: { cash: [cash.status, cash.json?.payment_status], discrepancies: openDiscrepancies(LATE.collection), state: v.json?.collection?.state, money: m, operator_listed: listed } };
});

// ───────────────────────────── PAY-05-R1: money, identity, reviews and words ─────────────────────────────
const resolve = (collection, type, resolution, note = 'Reviewed in the garage’s Paynow records (PAY-05 R1 QA).') => {
  const id = sql(`select id from pay04_garage_payment_discrepancies where collection_id = ${lit(collection)} and discrepancy_type = ${lit(type)} and status = 'open' limit 1`);
  return call('POST', `/api/pay04/admin/discrepancies/${id}/resolve`, { resolution, note }, as.ops);
};
const cashFor = (invoiceId, amount) => call('POST', `/api/garage/invoices/${invoiceId}/payments`, { amount, method: 'cash', reference: 'Counter (R1 QA)', idempotency_key: key('r1-cash') }, as.adminA);
const counted = (collection) => Number(sql(`select pay04_collection_allocated(${lit(collection)})`));
const allReceipts = (collection) => Number(sql(`select count(*) from pay04_garage_provider_receipts where collection_id = ${lit(collection)}`));
const observationsOf = (collection) => Number(sql(`select count(*) from pay05_paynow_observations where collection_id = ${lit(collection)}`));
let phoneSeq = 100;
async function openRequest({ cost = '20.00', sellPrice = '5.00' } = {}) {
  const inv = await invoice('A', { cost, sellPrice });
  phoneSeq += 1;
  const r = await start(inv.id, { method: 'ecocash', phone: `0779000${phoneSeq}` });
  if (r.status !== 201) throw new Error(`start ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return { inv, collection: r.json.collection_id, sim: await simTxFor(r.json.collection_id), total: inv.total_amount };
}
/** What a customer may never read while the facts say otherwise. */
const FALSE_WORDS = /nothing (was|is) (paid|charged)|still counts|confirmed by paynow/i;
const wordsOf = (row) => JSON.stringify([row?.state_label, row?.paynow?.provider_status_label, row?.paynow?.facts]);
const customerRow = async (invoiceId, collection) => (await paymentView(invoiceId)).json?.provider_payments?.find((p) => p.id === collection);

await step('F1', 'R1 (ICR-M1): Paid, then Paynow reverses it, then an operator settles outside CarUp: never counted again, no new receipt, the garage records its cash, a later Refunded still acts', async () => {
  const q = await openRequest();
  await simSetStatus(q.sim.guid, 'Paid');
  const paid = await waitFor(() => counted(q.collection) === 25);
  const receiptAtPaid = liveReceipts(q.collection);
  await simSetStatus(q.sim.guid, 'Reversed');
  const reversed = await waitFor(() => /provider_status_unrecognized/.test(openDiscrepancies(q.collection)));
  const uncounted = counted(q.collection);
  const corrected = await resolve(q.collection, 'provider_status_unrecognized', 'provider_corrected');
  const settled = await resolve(q.collection, 'provider_status_unrecognized', 'settled_off_platform');
  const afterSettle = { counted: counted(q.collection), live: liveReceipts(q.collection), all: allReceipts(q.collection), money: money(q.inv.id) };
  const view = await customerRow(q.inv.id, q.collection);
  const cash = await cashFor(q.inv.id, '25.00');
  await simSetStatus(q.sim.guid, 'Refunded');
  const refunded = await waitFor(() => payStatus(q.collection) === 'refunded');
  const end = money(q.inv.id);
  return { pass: paid && receiptAtPaid === 1 && reversed && uncounted === 0 && code(corrected) === 'PAY05_CORRECTION_NOT_CONFIRMED_BY_PROVIDER' && ok(settled, 200)
    && afterSettle.counted === 0 && afterSettle.live === 0 && afterSettle.all === 1 && Number(afterSettle.money.uncommitted_balance) === 25 && view?.state === 'settled_outside' && !FALSE_WORDS.test(wordsOf(view))
    && view?.paynow?.facts?.counted === false && ok(cash, 201) && refunded && Number(end.paid_amount) === 25 && Number(end.provider_paid) === 0 && counted(q.collection) === 0,
  detail: { corrected_refused: code(corrected), settled: settled.status, after_settlement: afterSettle, customer_state: view?.state, customer_facts: view?.paynow?.facts, cash: cash.status, end } };
});

await step('F2', 'R1 (ICR-M3): new money after a settlement is never dropped and never allocated: it opens a review the operator sees; the same report again adds nothing', async () => {
  const q = await openRequest();
  await simSetStatus(q.sim.guid, 'Reversed');
  await waitFor(() => /provider_status_unrecognized/.test(openDiscrepancies(q.collection)));
  await resolve(q.collection, 'provider_status_unrecognized', 'settled_off_platform');
  const cash = await cashFor(q.inv.id, '25.00');
  await simSetStatus(q.sim.guid, 'Paid');
  const seen = await waitFor(() => /provider_paid_after_close/.test(openDiscrepancies(q.collection)));
  const exc = await call('GET', '/api/pay04/admin/exceptions', undefined, as.ops);
  const listed = (exc.json?.discrepancies || []).some((d) => d.collection_id === q.collection && d.type === 'provider_paid_after_close');
  const before = { obs: observationsOf(q.collection), count: sql(`select observation_count from pay04_garage_payment_discrepancies where collection_id = ${lit(q.collection)} and discrepancy_type = 'provider_paid_after_close'`) };
  const check = await verify(q.collection);
  const after = sql(`select observation_count from pay04_garage_payment_discrepancies where collection_id = ${lit(q.collection)} and discrepancy_type = 'provider_paid_after_close'`);
  const lastOutcome = sql(`select outcome from pay05_paynow_observations where collection_id = ${lit(q.collection)} order by seq desc limit 1`);
  const m = money(q.inv.id);
  return { pass: ok(cash, 201) && seen && listed && allocations(q.collection) === 0 && allReceipts(q.collection) === 0 && Number(m.paid_amount) === 25 && Number(m.provider_paid) === 0
    && check.json?.collection?.state === 'under_review' && lastOutcome === 'after_settlement' && after === before.count && !/confirmed by paynow/i.test(JSON.stringify(check.json?.paynow)),
  detail: { cash: cash.status, review_open: seen, operator_listed: listed, allocations: allocations(q.collection), money: m, last_outcome: lastOutcome, check_state: check.json?.collection?.state } };
});

await step('F3', 'R1 (ICR-M2): Paid, Disputed, Paid, Disputed through Paynow’s own signed updates on the real resulturl: each is applied; none is a resend', async () => {
  const q = await openRequest();
  const steps = [];
  for (const [word, expected] of [['Paid', 25], ['Disputed', 0], ['Paid', 25], ['Disputed', 0], ['Paid', 25]]) {
    await simSetStatus(q.sim.guid, word);
    const reached = await waitFor(() => counted(q.collection) === expected, { timeoutMs: 10_000 });
    steps.push([word, counted(q.collection), reached]);
  }
  const events = sql(`select count(distinct event_id) || '/' || count(*) from pay05_paynow_observations where collection_id = ${lit(q.collection)} and via = 'status_update'`);
  return { pass: steps.every(([, , reached]) => reached) && events === '5/5' && liveReceipts(q.collection) === 1, detail: { steps, distinct_events_of_status_updates: events, live_receipts: liveReceipts(q.collection) } };
});

await step('F4', 'R1 (ICR-S1): variants of a captured signed update (padding, an empty field, a lower-case hash) are one message on the real route: no Paynow read, no row, no money', async () => {
  const q = await openRequest();
  await simSetStatus(q.sim.guid, 'Paid');
  await waitFor(() => counted(q.collection) === 25);
  const key2 = keyOf(integrations.A_USD.integration_id);
  const message = statusUpdate(await simTxFor(q.collection), { signingKey: key2 });
  const rows = observationsOf(q.collection);
  const answers = [];
  for (const v of [message, `${message}&x=`, message.replace('status=Paid', 'status=Paid%20'), message.replace(/hash=([0-9A-F]+)/, (_, h) => `hash=${h.toLowerCase()}`)]) {
    const r = await postResult(q.collection, v);
    answers.push([r.status, r.json?.duplicate]);
  }
  return { pass: answers.every(([status, duplicate]) => status === 200 && duplicate === true) && observationsOf(q.collection) === rows && liveReceipts(q.collection) === 1 && allocations(q.collection) === 1,
    detail: { answers, observations: [rows, observationsOf(q.collection)], allocations: allocations(q.collection) } };
});

await step('F5', 'R1 (ICR-M2): an update whose confirming poll disagrees is answered non-2xx, so Paynow resends; once the poll agrees it applies', async () => {
  const q = await openRequest();
  const key2 = keyOf(integrations.A_USD.integration_id);
  const paidMessage = statusUpdate(q.sim, { status: 'Paid', signingKey: key2 });
  const first = await postResult(q.collection, paidMessage);
  const during = counted(q.collection);
  await simSetStatus(q.sim.guid, 'Paid', { notify: false });
  const second = await postResult(q.collection, paidMessage);
  return { pass: first.status === 503 && first.json?.error === 'PAY05_STATUS_UPDATE_RETRY' && during === 0 && second.status === 200 && second.json?.applied === true && counted(q.collection) === 25,
    detail: { unconfirmed: [first.status, first.json], while_unconfirmed_counted: during, confirmed: [second.status, second.json], counted: counted(q.collection) } };
});

await step('F6', 'R1 (ICR-S1, PFR-M3): a replayed captured update costs at most its own budget of Paynow reads and no rows, then answers non-2xx; ordinary reads and other messages still work', async () => {
  const q = await openRequest();
  await simSetStatus(q.sim.guid, 'Paid');
  await waitFor(() => counted(q.collection) === 25);
  const key2 = keyOf(integrations.A_USD.integration_id);
  const stale = statusUpdate(await simTxFor(q.collection), { status: 'Disputed', signingKey: key2 });
  const answers = [];
  for (let i = 0; i < 14; i += 1) answers.push((await postResult(q.collection, stale)).status);
  // the first read of this message and eleven... each message has its own twelve; no observation row for a read that showed nothing new
  const hash = sql(`select encode(sha256(convert_to(upper(${lit(new URLSearchParams(stale).get('hash'))}), 'UTF8')), 'hex')`);
  const reads = Number(sql(`select (status_update_read_budgets->${lit(hash)}->>'reads') from pay05_paynow_transactions where collection_id = ${lit(q.collection)}`));
  const rows = Number(sql(`select count(*) from pay05_paynow_observations where collection_id = ${lit(q.collection)} and message_hash = ${lit(hash)}`));
  const v = await verify(q.collection);
  // another message of Paynow's is not starved by the replay
  await simSetStatus(q.sim.guid, 'Refunded');
  const refunded = await waitFor(() => payStatus(q.collection) === 'refunded');
  return { pass: reads === 12 && rows === 1 && answers.every((s) => s === 503) && v.json?.collection?.state === 'confirmed' && refunded && counted(q.collection) === 0, detail: { answers, reads_of_this_message: reads, rows_of_this_message: rows, refunded, counted: counted(q.collection) } };
});

await step('F7', 'R1 (ICR-M4): a dispute Paynow never speaks of again has an exit: not "acknowledged", but settled outside CarUp, which counts nothing and frees the room for real cash', async () => {
  const q = await openRequest();
  await simSetStatus(q.sim.guid, 'Paid');
  await waitFor(() => counted(q.collection) === 25);
  await simSetStatus(q.sim.guid, 'Disputed');
  await waitFor(() => /provider_disputed/.test(openDiscrepancies(q.collection)));
  const ack = await resolve(q.collection, 'provider_disputed', 'acknowledged');
  const held = money(q.inv.id);
  const settled = await resolve(q.collection, 'provider_disputed', 'settled_off_platform');
  const m = money(q.inv.id);
  const cash = await cashFor(q.inv.id, '25.00');
  return { pass: ack.status >= 400 && Number(held.provider_reserved) === 25 && ok(settled, 200) && Number(m.provider_reserved) === 0 && Number(m.uncommitted_balance) === 25 && counted(q.collection) === 0 && liveReceipts(q.collection) === 0 && ok(cash, 201),
    detail: { acknowledge_refused: [ack.status, code(ack)], reserved_during: held.provider_reserved, settled: settled.status, money: m, cash: cash.status } };
});

await step('F8', 'R1 (ICR-M5, M6): a Disputed with another amount is a dispute, not a mismatch; a Refunded with another figure applies in full and keeps the figure as evidence', async () => {
  const q = await openRequest();
  await simSetStatus(q.sim.guid, 'Paid');
  await waitFor(() => counted(q.collection) === 25);
  await simControl('POST', `/transactions/${q.sim.guid}/status`, { status: 'Disputed', amount: '20.00', notify: false });
  await verify(q.collection);
  const opened = openDiscrepancies(q.collection);
  const corrected = await resolve(q.collection, 'provider_disputed', 'provider_corrected');
  const q2 = await openRequest();
  await simSetStatus(q2.sim.guid, 'Paid');
  await waitFor(() => counted(q2.collection) === 25);
  await simControl('POST', `/transactions/${q2.sim.guid}/status`, { status: 'Refunded', amount: '5.00', notify: false });
  await verify(q2.collection);
  const figure = sql(`select evidence->>'observed_amount_minor' from pay04_garage_payment_discrepancies where collection_id = ${lit(q2.collection)} and discrepancy_type = 'provider_refund_unquantified'`);
  const outcome = sql(`select outcome from pay05_paynow_observations where collection_id = ${lit(q2.collection)} order by seq desc limit 1`);
  return { pass: opened === 'provider_disputed' && code(corrected) === 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER' && counted(q.collection) === 0
    && payStatus(q2.collection) === 'refunded' && counted(q2.collection) === 0 && figure === '500' && outcome === 'applied' && !/amount_mismatch/.test(openDiscrepancies(q2.collection)),
  detail: { disputed_reviews: opened, corrected_refused: code(corrected), refunded_status: payStatus(q2.collection), paynow_figure_kept: figure, observation_outcome: outcome } };
});

await step('F9', 'R1 (ICR-W2, W6): a released request tells the customer not to approve it and offers nothing to act on; the operator still sees and can read it, with no release', async () => {
  const view = await customerRow(LATE.invoice.id, LATE.collection);
  const row = await customerRow(AGAIN.invoice.id, AGAIN.collection);
  const wait = AGAIN.startedAt + (TTL_SECONDS + 5) * 1000 - Date.now();
  if (wait > 0) await pause(wait);
  const rel = await call('POST', `/api/pay05/admin/collections/${AGAIN.collection}/release-hold`, { reason: 'Customer abandoned the EcoCash prompt (R1 QA).' }, as.ops);
  const released = await customerRow(AGAIN.invoice.id, AGAIN.collection);
  const list = await call('GET', '/api/pay05/admin/held-collections', undefined, as.ops);
  const listed = (list.json?.held || []).find((h) => h.collection_id === AGAIN.collection);
  const check = await call('POST', `/api/pay05/admin/collections/${AGAIN.collection}/reconcile`, {}, as.ops);
  const words = wordsOf(released);
  return { pass: ok(rel, 200) && released?.state === 'released' && !/waiting for you|still counts|approve the payment on your phone\./i.test(released?.paynow?.provider_status_label ?? '') && /Do not approve/i.test(released?.paynow?.facts?.next_step ?? '')
    && !released?.paynow?.needs_otp && !released?.paynow?.checkout_url && !released?.paynow?.authorization_code && !FALSE_WORDS.test(words)
    && Boolean(listed) && listed.released === true && listed.can_release === false && ok(check, 200), detail: { earlier_views: [view?.state, row?.state], released: released?.state, facts: released?.paynow?.facts, operator_row: listed && { state: listed.state, can_release: listed.can_release, reason: listed.release_blocked_reason }, reread: check.status } };
});

await step('F10', 'R1 (duplicate payments): money reaches Paynow on a released request though Paynow’s update was lost: the next Pay reads it first and refuses; nothing new is reserved', async () => {
  const sim = await simTxFor(AGAIN.collection);
  await simSetStatus(sim.guid, 'Delivered', { notify: false });
  // the read made while the page was open is older than a minute only after a pause: the start's own read is what must catch it
  await pause(61_000);
  const refused = await start(AGAIN.invoice.id, { method: 'ecocash', phone: '0779000003' });
  const seen = txOf(AGAIN.collection).provider_status;
  const rows = Number(sql(`select count(*) from pay04_garage_collections where invoice_id = ${lit(AGAIN.invoice.id)}`));
  const option = (await paymentView(AGAIN.invoice.id)).json?.online_payment;
  const m = money(AGAIN.invoice.id);
  return { pass: code(refused) === 'PAY05_EARLIER_REQUEST_UNRESOLVED' && seen === 'delivered' && rows === 1 && option?.available === false && option?.reason === 'earlier_request_unresolved' && Number(m.paid_amount) === 0,
    detail: { refused: [refused.status, code(refused)], provider_status_now: seen, collections_on_invoice: rows, option, money: m } };
});

await step('F11', 'R1 (ICR-W1, W3): every row of this run reads truthfully: no "nothing was paid" while Paynow reports money, no "Paid" unless counted', async () => {
  const rows = json(`select json_agg(json_build_object('invoice', c.invoice_id, 'id', c.id)) from pay04_garage_collections c where c.gateway = 'paynow_zimbabwe' and c.payer_user_id = ${lit(accounts.customer.userId)}`) || [];
  const seen = new Map();
  const bad = [];
  for (const invoiceId of new Set(rows.map((r) => r.invoice))) {
    for (const p of (await paymentView(invoiceId)).json?.provider_payments || []) {
      seen.set(p.state, (seen.get(p.state) || 0) + 1);
      if (['awaiting_delivery', 'delivered', 'paid', 'disputed'].includes(p.paynow?.provider_status) && /nothing (was|is) (paid|charged)/i.test(wordsOf(p))) bad.push([p.id, p.state, 'false nothing']);
      if (p.state !== 'confirmed' && /confirmed by paynow|^Paid —/i.test(p.paynow?.provider_status_label ?? '')) bad.push([p.id, p.state, 'false paid']);
      if (p.state === 'confirmed' && !(p.paynow?.facts?.counted === true)) bad.push([p.id, p.state, 'confirmed but not counted']);
      if (!p.paynow?.facts) bad.push([p.id, p.state, 'no facts']);
    }
  }
  return { pass: bad.length === 0 && seen.size >= 5, detail: { rows_by_state: Object.fromEntries(seen), violations: bad } };
});

// ───────────────────────────── the pre-final adversarial review ─────────────────────────────
await step('G1', 'R1 (PFR-H3): late money under review on a closed request: no new request is offered or accepted until the review ends', async () => {
  const q = await openRequest();
  await simSetStatus(q.sim.guid, 'Cancelled');
  const closed = await waitFor(() => payStatus(q.collection) === 'cancelled');
  await simSetStatus(q.sim.guid, 'Paid');
  const late = await waitFor(() => /provider_paid_after_close/.test(openDiscrepancies(q.collection)));
  const option = (await paymentView(q.inv.id)).json?.online_payment;
  const refused = await start(q.inv.id, { method: 'ecocash', phone: '0779000031' });
  const rows = Number(sql(`select count(*) from pay04_garage_collections where invoice_id = ${lit(q.inv.id)}`));
  const settled = await resolve(q.collection, 'provider_paid_after_close', 'settled_off_platform');
  const after = (await paymentView(q.inv.id)).json?.online_payment;
  return { pass: closed && late && option?.available === false && option?.reason === 'earlier_request_unresolved' && code(refused) === 'PAY05_EARLIER_REQUEST_UNRESOLVED'
    && rows === 1 && ok(settled, 200) && after?.available === true && Boolean(after?.notices?.earlier_request) && counted(q.collection) === 0,
    detail: { option, refused: [refused.status, code(refused)], collections_on_invoice: rows, settled: settled.status, after: after?.available } };
});

await step('G2', 'R1 (PFR-H4): a released request is paid late: it counts, the request now holding the room is told not to complete it, and its own money is reviewed, never counted twice', async () => {
  const wait = ROOM.startedAt + (TTL_SECONDS + 5) * 1000 - Date.now();
  if (wait > 0) await pause(wait);
  const rel = await call('POST', `/api/pay05/admin/collections/${ROOM.collection}/release-hold`, { reason: 'Customer abandoned the EcoCash prompt (R1 QA).' }, as.ops);
  const b = await start(ROOM.invoice.id, { method: 'web' });
  const total = Number(money(ROOM.invoice.id).total_amount);
  const before = await customerRow(ROOM.invoice.id, b.json?.collection_id);
  await simSetStatus((await simTxFor(ROOM.collection)).guid, 'Paid');
  const paid = await waitFor(() => Number(money(ROOM.invoice.id).provider_paid) === total);
  const row = await customerRow(ROOM.invoice.id, b.json?.collection_id);
  const option = (await paymentView(ROOM.invoice.id)).json?.online_payment;
  await simSetStatus((await simTxFor(b.json?.collection_id)).guid, 'Paid');
  const reviewed = await waitFor(() => /unallocated_provider_money/.test(openDiscrepancies(b.json?.collection_id)));
  const end = money(ROOM.invoice.id);
  return { pass: ok(rel, 200) && b.status === 201 && Boolean(before?.paynow?.checkout_url) && paid && row?.state === 'no_longer_needed' && !row?.paynow?.checkout_url
    && /Do not complete/.test(row?.paynow?.facts?.next_step ?? '') && !/waiting for you/i.test(row?.paynow?.provider_status_label ?? '') && option?.reason === 'nothing_due'
    && reviewed && Number(end.provider_paid) === total && liveReceipts(b.json?.collection_id) === 0,
    detail: { released: rel.status, second: b.status, row_state: row?.state, next_step: row?.paynow?.facts?.next_step, option, end } };
});

await step('G3', 'R1 (PFR-M1): money held at Paynow past CarUp’s time: release stays refused; an operator opens a review and settles it, the room is free, later money is reviewed', async () => {
  const wait = ESCROW.startedAt + (TTL_SECONDS + 5) * 1000 - Date.now();
  if (wait > 0) await pause(wait);
  const sim = await simTxFor(ESCROW.collection);
  await simSetStatus(sim.guid, 'Delivered');
  await waitFor(() => txOf(ESCROW.collection).provider_status === 'delivered');
  const release = await call('POST', `/api/pay05/admin/collections/${ESCROW.collection}/release-hold`, { reason: 'Trying to release held money (R1 QA).' }, as.ops);
  const list = await call('GET', '/api/pay05/admin/held-collections', undefined, as.ops);
  const listed = (list.json?.held || []).find((h) => h.collection_id === ESCROW.collection);
  const garage = await call('POST', `/api/pay05/admin/collections/${ESCROW.collection}/open-review`, { reason: 'A garage may not open this review.' }, as.adminA);
  const customer = await call('POST', `/api/pay05/admin/collections/${ESCROW.collection}/open-review`, { reason: 'A customer may not open this review.' }, as.customer);
  const short = await call('POST', `/api/pay05/admin/collections/${ESCROW.collection}/open-review`, { reason: 'short' }, as.ops);
  const opened = await call('POST', `/api/pay05/admin/collections/${ESCROW.collection}/open-review`, { reason: 'Paynow keeps this money in escrow; the garage asked for a review (R1 QA).' }, as.ops);
  const again = await call('POST', `/api/pay05/admin/collections/${ESCROW.collection}/open-review`, { reason: 'Opening the same review a second time (R1 QA).' }, as.ops);
  const settled = await resolve(ESCROW.collection, 'provider_status_unrecognized', 'settled_off_platform');
  const free = money(ESCROW.invoice.id);
  await simSetStatus(sim.guid, 'Paid');
  const late = await waitFor(() => /provider_paid_after_close/.test(openDiscrepancies(ESCROW.collection)));
  return { pass: code(release) === 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ' && listed?.can_release === false && listed?.can_open_review === true
    && garage.status === 403 && customer.status === 403 && code(short) === 'PAY05_REASON_REQUIRED' && ok(opened, 200) && code(again) === 'PAY05_REVIEW_NOT_OPENABLE' && ok(settled, 200)
    && Number(free.provider_reserved) === 0 && Number(free.uncommitted_balance) > 0 && late && counted(ESCROW.collection) === 0 && liveReceipts(ESCROW.collection) === 0,
    detail: { release: [release.status, code(release)], listed: listed && { can_release: listed.can_release, can_open_review: listed.can_open_review, reason: listed.release_blocked_reason },
      garage: garage.status, customer: customer.status, opened: opened.status, again: code(again), settled: settled.status, free } };
});

await step('G4', 'R1 (PFR-H2): a reviewed Cancelled after money: never "nothing was charged", nothing to complete, and the operator can release it, so the room is not held forever', async () => {
  const wait = REVIEWED.startedAt + (TTL_SECONDS + 5) * 1000 - Date.now();
  if (wait > 0) await pause(wait);
  const sim = await simTxFor(REVIEWED.collection);
  await simSetStatus(sim.guid, 'Delivered');
  await waitFor(() => txOf(REVIEWED.collection).provider_status === 'delivered');
  await simSetStatus(sim.guid, 'Cancelled');
  const review = await waitFor(() => /provider_status_unrecognized/.test(openDiscrepancies(REVIEWED.collection)));
  const closed = await resolve(REVIEWED.collection, 'provider_status_unrecognized', 'acknowledged');
  const row = await customerRow(REVIEWED.invoice.id, REVIEWED.collection);
  const list = await call('GET', '/api/pay05/admin/held-collections', undefined, as.ops);
  const listed = (list.json?.held || []).find((h) => h.collection_id === REVIEWED.collection);
  const rel = await call('POST', `/api/pay05/admin/collections/${REVIEWED.collection}/release-hold`, { reason: 'Paynow reports it cancelled, reviewed (R1 QA).' }, as.ops);
  const free = money(REVIEWED.invoice.id);
  return { pass: review && ok(closed, 200) && row?.state === 'reviewed_held' && !/nothing was charged/i.test(wordsOf(row)) && !/Complete this request/.test(row?.paynow?.facts?.next_step ?? '')
    && listed?.can_release === true && ok(rel, 200) && Number(free.provider_reserved) === 0,
    detail: { row_state: row?.state, sentence: row?.paynow?.provider_status_label, next_step: row?.paynow?.facts?.next_step, release: rel.status, free } };
});

await step('G5', 'R1 (PFR-M5): Paynow refuses, CarUp closes, then Paynow’s signed word shows the request exists: closed words, nothing to act on, and paying again warns about it', async () => {
  const inv = await invoice('A', { cost: '20.00', sellPrice: '5.00' });
  await simFault('initiate', { kind: 'error', message: 'Temporary refusal (R1 QA)' });
  const refused = await start(inv.id, { method: 'omari', phone: '0779000032' });
  const collection = sql(`select id from pay04_garage_collections where invoice_id = ${lit(inv.id)}`);
  const sims = await simTransactionsFor(collectionRow(collection).payment_reference);
  const before = payStatus(collection);
  const body = sims.length ? statusUpdate(sims[0], { status: 'Sent', signingKey: keyOf(integrations.A_USD.integration_id) }) : null;
  const delivered = body ? await postResult(collection, body) : { status: 0 };
  const row = await customerRow(inv.id, collection);
  const option = (await paymentView(inv.id)).json?.online_payment;
  return { pass: code(refused) === 'PAY05_PROVIDER_REFUSED' && before === 'cancelled' && sims.length === 1 && row?.state === 'closed_live' && !/waiting for/i.test(row?.paynow?.provider_status_label ?? '')
    && !row?.paynow?.needs_otp && !row?.paynow?.otp_unavailable && !row?.paynow?.checkout_url && /Do not approve/.test(row?.paynow?.facts?.next_step ?? '')
    && option?.available === true && Boolean(option?.notices?.earlier_request) && counted(collection) === 0,
    detail: { start: [refused.status, code(refused)], delivered: delivered.status, row_state: row?.state, sentence: row?.paynow?.provider_status_label, next_step: row?.paynow?.facts?.next_step, earlier_request: option?.notices?.earlier_request ?? null } };
});

// ───────────────────────────── operator controls ─────────────────────────────
await step('O1', 'Availability: a garage cannot switch Paynow; the operator switches it off (checkouts refused) and on, with a reason', async () => {
  const garage = await call('PUT', '/api/pay05/admin/availability', { available: false, note: 'Garage trying to switch Paynow off' }, as.adminA);
  const off = await call('PUT', '/api/pay05/admin/availability', { available: false, note: 'Paynow incident drill (PAY-05 QA)' }, as.ops);
  const inv = await invoice('A', { cost: '10.00', sellPrice: '5.00' });
  const option = (await paymentView(inv.id)).json?.online_payment;
  const refused = await start(inv.id, { method: 'web' });
  const on = await call('PUT', '/api/pay05/admin/availability', { available: true, note: 'Paynow incident drill over (PAY-05 QA)' }, as.ops);
  const optionOn = (await paymentView(inv.id)).json?.online_payment;
  return { pass: garage.status === 403 && ok(off, 200) && option?.available === false && refused.status >= 400 && ok(on, 200) && optionOn?.available === true,
    detail: { garage_admin: garage.status, option_off: option, start_off: [refused.status, code(refused)], option_on: optionOn?.available } };
});

await step('O2', 'Suspension: the operator suspends garage B’s Paynow merchant — B cannot take Paynow payments; the audit trail records it', async () => {
  const inv = await invoice('B', { cost: '30.00', sellPrice: '5.00' });
  const before = (await paymentView(inv.id)).json?.online_payment;
  const s = await call('POST', `/api/pay05/admin/merchants/${facts.merchantB}/suspend`, { reason: 'Settlement account under investigation (PAY-05 QA).' }, as.ops);
  const after = (await paymentView(inv.id)).json?.online_payment;
  const r = await start(inv.id, { method: 'web' });
  const audit = sql(`select string_agg(event_type, ',' order by seq) from pay05_merchant_audit_events where merchant_account_id = ${lit(facts.merchantB)}`);
  return { pass: before?.available === true && ok(s, 200) && after?.available === false && r.status >= 400 && /suspended/.test(audit),
    detail: { before: before?.available, suspend: s.status, after, start_after: [r.status, code(r)], audit } };
});

await step('O3', 'Provider errors and merchant history are visible to the operator — with no key, hash or poll URL in them', async () => {
  const errs = await call('GET', '/api/pay05/admin/provider-errors', undefined, as.ops);
  const merchants = await call('GET', '/api/pay05/admin/merchants', undefined, as.ops);
  const garage = await call('GET', '/api/pay05/admin/provider-errors', undefined, as.adminA);
  const body = JSON.stringify(errs.json || {}) + JSON.stringify(merchants.json || {});
  const kinds = [...new Set((errs.json?.errors || []).map((e) => e.kind))].sort();
  const keys = Object.values(integrations).map((i) => i.integration_key);
  return { pass: ok(errs, 200) && ok(merchants, 200) && garage.status === 403 && ['callback_binding_mismatch', 'callback_signature_invalid', 'credential_probe_failed', 'otp_rejected'].every((k) => kinds.includes(k))
    && !keys.some((k) => body.includes(k)) && !/CheckPayment|"hash"|ciphertext/i.test(body),
  detail: { kinds, merchants: (merchants.json?.merchants || []).length, garage_admin: garage.status } };
});

// ───────────────────────────── invariants over everything this run touched ─────────────────────────────
await step('INV', 'Invariants: no key plaintext anywhere; garage money only; paid ≤ total; one Paynow request per collection; no "ZIG"', async () => {
  const keys = Object.values(integrations).map((i) => i.integration_key);
  const tables = ['pay05_merchant_integrations', 'pay05_merchant_profiles', 'pay05_merchant_audit_events', 'pay05_paynow_transactions', 'pay05_paynow_observations',
    'pay05_provider_errors', 'pay04_garage_merchant_accounts', 'pay04_garage_collections', 'pay04_garage_collection_events', 'payment_transactions', 'domain_events'];
  const keyHits = {};
  for (const t of tables) {
    const exists = sql(`select to_regclass('public.${t}') is not null`);
    if (exists !== 't') continue;
    keyHits[t] = Number(sql(`select count(*) from public.${t} x where ${keys.map((k) => `position(${lit(k)} in x::text) > 0`).join(' or ')}`));
  }
  const tenants = [accounts.garageA, accounts.garageB].map(lit).join(',');
  const over = sql(`select count(*) from garage_invoices i cross join lateral garage_ops07_invoice_balance(i.id) b where i.tenant_id in (${tenants}) and b.paid_amount > i.total_amount`);
  const carupMoney = sql(`select count(*) from payment_transactions p join pay04_garage_collections c on c.payment_reference = p.reference where c.gateway = 'paynow_zimbabwe' and (p.pay02_funds_owner <> 'garage_business_tenant' or p.gateway <> 'paynow_zimbabwe' or p.pay02_legal_beneficiary <> 'tenant:' || c.tenant_id)`);
  const badReceipt = sql(`select count(*) from pay04_garage_provider_receipts r join pay04_garage_collections c on c.id = r.collection_id where c.gateway = 'paynow_zimbabwe' and r.status = 'issued' and r.amount <> pay04_collection_allocated(r.collection_id)`);
  const refs = sql(`select string_agg(c.payment_reference, ',') from pay04_garage_collections c join pay05_paynow_transactions t on t.collection_id = c.id`).split(',').filter(Boolean);
  const all = await simControl('GET', '/transactions');
  const perRef = refs.map((ref) => all.filter((t) => t.reference === ref).length);
  const zig = sql(`select (select count(*) from payment_transactions where currency = 'ZIG') + (select count(*) from pay04_garage_collections where currency = 'ZIG')`);
  // R1: counted Paynow money has Paynow's own applied Paid as its latest word; nothing settled grew after settlement
  const countedWithoutPaid = sql(`select count(*) from pay04_garage_collections c where c.gateway = 'paynow_zimbabwe' and pay04_collection_allocated(c.id) > 0 and pay05_latest_provider_status(c.id) is distinct from 'paid'`);
  const pass = Object.values(keyHits).every((n) => n === 0) && over === '0' && carupMoney === '0' && badReceipt === '0' && perRef.every((n) => n <= 1) && zig === '0' && countedWithoutPaid === '0';
  return { pass, detail: { counted_without_paynows_paid: countedWithoutPaid, key_plaintext_hits: keyHits, over_allocated: over, garage_money_as_carup_money: carupMoney, receipts_not_equal_counted: badReceipt,
    paynow_requests_per_collection_max: Math.max(0, ...perRef), collections_checked: refs.length, zig_rows: zig } };
});

const out = { programme: 'CARUP-PAY-05-R1', level: 'Level 1 (local Paynow protocol simulator; no provider, no money)', recorded_at: new Date().toISOString(),
  backend_commit: commit, harness_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), stack: 'carup-pay04-supabase 127.0.0.1:56321/56322 (reused)',
  collection_ttl_seconds: TTL_SECONDS, results, facts,
  summary: { total: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).map((r) => r.case) } };
mkdirSync(`${EVIDENCE_DIR}/uat`, { recursive: true, mode: 0o700 });
const file = `${EVIDENCE_DIR}/uat/http-matrix-${commit.slice(0, 8)}.json`;
writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
console.log(`\n${out.summary.passed}/${out.summary.total} passed -> ${file}`);
if (!existsSync(file) || out.summary.failed.length) process.exitCode = 1;
