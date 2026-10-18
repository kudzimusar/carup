/**
 * CA-OWNER-02 (C) — Finance: real operational money facts under their own names, strictly apart from accounting facts.
 *
 * Proven here:
 *   · escrow / transaction sessions, the Marketplace deposit workflow, finance applications, referral reward obligations and
 *     subscription billing are reported as named states (K2B-operational records only, where a principal exists);
 *   · a provider mode is always named — sandbox is never settlement, cash or revenue; live-mode sessions are counted apart;
 *   · amounts appear only as per-currency breakdown entries of an operational fact (a requested amount, a programme
 *     obligation) — never summed across currencies and never relabelled GMV, revenue, payable or cash;
 *   · finance exceptions are named product states (failed / disputed / payment unknown / settlement pending; reconciliation
 *     mismatches; held / rejected rewards);
 *   · every accounting measure is a PENDING_CA_FIN statement with its reason — never a value;
 *   · a failed source degrades only its own facts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { readFinanceFacts, ACCOUNTING_STATEMENTS } = await import('../services/corporate/management/financeFacts.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const REAL = 'u_aaaaaaaaaaaaaaaa';
const BUYER = 'u_bbbbbbbbbbbbbbbb';
const UAT = 'u_cccccccccccccccc';

const seed = () => createSupabaseWorld({
  users: [
    { id: REAL, email: 'tendai@gmail.com', name: 'Tendai Moyo' },
    { id: BUYER, email: 'rudo@gmail.com', name: 'Rudo Banda' },
    { id: UAT, email: 'uat@carup-staging.test', name: 'UAT buyer' },
  ],
  vehicles: [{ vin: 'JTDBR32E520000001', owner_id: REAL, make: 'Toyota', status: 'Available', publication_status: 'published' }],
  marketplace_inquiries: [
    { id: 'i-real', buyer_id: BUYER, listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'qualified' },
    { id: 'i-uat', buyer_id: UAT, listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'new' },
  ],
  escrow_trust_sessions: [
    { id: 'es1', inquiry_id: 'i-real', buyer_id: BUYER, vin: 'JTDBR32E520000001', status: 'funds_held', payment_state: 'captured', payment_provider_mode: 'sandbox', deposit_eligibility: 'eligible', deposit_amount: 500, deposit_currency: 'USD', listing_amount: 9000, listing_currency: 'USD', settlement_operation_state: null, created_at: '2026-10-10T00:00:00Z' },
    { id: 'es2', inquiry_id: 'i-real', buyer_id: BUYER, vin: 'JTDBR32E520000001', status: 'failed', payment_state: 'failed', payment_provider_mode: 'sandbox', deposit_eligibility: 'eligible', deposit_amount: 500, deposit_currency: 'USD', listing_amount: 9000, listing_currency: 'USD', settlement_operation_state: 'pending', created_at: '2026-10-11T00:00:00Z' },
    { id: 'es3', inquiry_id: 'i-uat', buyer_id: UAT, vin: 'JTDBR32E520000001', status: 'settled', payment_state: 'released', payment_provider_mode: 'sandbox', deposit_eligibility: 'eligible', deposit_amount: 500, deposit_currency: 'USD', listing_amount: 9000, listing_currency: 'USD', settlement_operation_state: null, created_at: '2026-10-12T00:00:00Z' },
  ],
  finance_applications: [
    { id: 'fa1', user_id: BUYER, status: 'Pending', requested_amount: 4000, requested_currency: 'USD', created_at: '2026-10-01T00:00:00Z' },
    { id: 'fa2', user_id: BUYER, status: 'Approved', requested_amount: 25000, requested_currency: 'ZWG', created_at: '2026-10-02T00:00:00Z' },
    { id: 'fa3', user_id: UAT, status: 'Pending', requested_amount: 99999, requested_currency: 'USD', created_at: '2026-10-03T00:00:00Z' },
  ],
  referral_wallet_transactions: [
    { id: 'rw1', user_id: BUYER, status: 'payable', amount: 20, currency: 'USD', created_at: '2026-10-01T00:00:00Z' },
    { id: 'rw2', user_id: BUYER, status: 'held', amount: 10, currency: 'USD', created_at: '2026-10-02T00:00:00Z' },
    { id: 'rw3', user_id: UAT, status: 'payable', amount: 500, currency: 'USD', created_at: '2026-10-03T00:00:00Z' },
  ],
  diaspora_subscriptions: [],
  reconciliation_mismatches: [{ id: 'rm1', resolution: 'open', created_at: '2026-10-05T00:00:00Z' }],
  escrow_reconciliation_ledger: [],
});

const factsOf = async (client) => Object.fromEntries((await readFinanceFacts(client, { now: NOW })).facts.map((f) => [f.id, f]));
const entry = (fact, key) => fact.breakdown.find((e) => e.key === key);

test('escrow sessions are named states per provider mode; sandbox is labelled and amounts are not summed', async () => {
  const f = await factsOf(seed().client);
  const s = f['finance.escrow.sessions'];
  assert.equal(s.value, 2, 'the session on the UAT inquiry is set aside');
  assert.equal(entry(s, 'sandbox:funds_held').value, 1);
  assert.equal(entry(s, 'sandbox:failed').value, 1);
  assert.match(s.detail, /sandbox.*never.*settlement/i);
  assert.equal(JSON.stringify(s).includes('9000'), false, 'the listing amount is commercial intent and is not shown');
  assert.equal(f['finance.escrow.live_sessions'].value, 0);
  assert.match(f['finance.escrow.live_sessions'].detail, /no live settlement authority/i);
});

test('the deposit workflow is reported by payment state, never as a transaction value', async () => {
  const f = await factsOf(seed().client);
  const d = f['finance.deposit.workflow'];
  assert.equal(d.value, 2);
  assert.equal(entry(d, 'payment:captured').value, 1);
  assert.match(d.detail, /not a transaction value/i);
});

test('finance applications keep requested amounts per currency — a requested amount is not a disbursement', async () => {
  const f = await factsOf(seed().client);
  const a = f['finance.application.status'];
  assert.equal(a.value, 2);
  assert.equal(entry(a, 'status:Pending').value, 1);
  assert.equal(entry(a, 'requested:USD').value, 4000);
  assert.equal(entry(a, 'requested:USD').currency, 'USD');
  assert.equal(entry(a, 'requested:ZWG').value, 25000);
  assert.equal(a.breakdown.some((e) => e.value === 29000), false, 'currencies are never added together');
  assert.match(a.detail, /not a disbursement/i);
});

test('referral rewards are programme obligations per currency — never accounts payable', async () => {
  const f = await factsOf(seed().client);
  const r = f['finance.referral.obligations'];
  assert.equal(r.value, 2);
  assert.equal(entry(r, 'status:payable').value, 1);
  assert.equal(entry(r, 'amount:payable:USD').value, 20);
  assert.match(r.detail, /not accounts payable/i);
});

test('billing, exceptions and the accounting statements are truthful', async () => {
  const f = await factsOf(seed().client);
  assert.equal(f['finance.billing.subscriptions'].value, 0);
  assert.match(f['finance.billing.subscriptions'].detail, /no live billing provider/i);
  const ex = f['finance.exceptions.escrow'];
  assert.equal(entry(ex, 'status:failed').value, 1);
  assert.equal(entry(ex, 'settlement:pending').value, 1);
  assert.equal(f['finance.exceptions.reconciliation'].value, 1);
  assert.equal(entry(f['finance.exceptions.referral'], 'status:held').value, 1);
  for (const s of ACCOUNTING_STATEMENTS) {
    const fact = f[s.id];
    assert.equal(fact.state, 'PENDING_CA_FIN', s.id);
    assert.equal(fact.value, null, s.id);
    assert.ok(fact.reason, s.id);
  }
  assert.ok(f['finance.accounting.gmv'] && f['finance.accounting.cash'] && f['finance.accounting.take_rate']);
});

test('a failed escrow read degrades only the escrow-based facts', async () => {
  const w = seed();
  const client = {
    from(t) {
      if (t !== 'escrow_trust_sessions') return w.client.from(t);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'down' } }) };
      return q;
    },
  };
  const f = await factsOf(client);
  assert.equal(f['finance.escrow.sessions'].state, 'DEGRADED');
  assert.equal(f['finance.deposit.workflow'].state, 'DEGRADED');
  assert.equal(f['finance.referral.obligations'].state, 'TECHNICAL_OPERATIONAL');
});
