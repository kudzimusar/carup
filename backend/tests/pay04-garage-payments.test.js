/**
 * CARUP-PAY-04-LR01 — garage payment services against REAL PostgreSQL (the integrated Payments + Garage schema and the
 * PAY-04 SECURITY DEFINER functions), with the clearly-labelled local garage-provider simulator as the provider.
 *
 * Requires PAY04_TEST_PGURL pointing at a DISPOSABLE database prepared by scripts/ci/pay04-postgres-certification.sh
 * (database name pay01c_sandbox_ci on 127.0.0.1/localhost). Every run uses fresh identities. Skipped, with a reason,
 * when no disposable database is configured.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const PGURL = process.env.PAY04_TEST_PGURL || '';
const disposable = /^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/pay01c_sandbox_ci$/.test(PGURL) && !PGURL.includes(':54322/');
const skip = disposable ? false : 'PAY04_TEST_PGURL must name a disposable pay01c_sandbox_ci database (see scripts/ci/pay04-postgres-certification.sh)';

const S = await import('../services/payment/pay04GaragePaymentService.js');
const R = await import('../services/payment/pay03bReconciliationService.js');
const I = await import('../services/garageOperations/garageInvoiceService.js');
const { Pay04GarageSimulatorProvider } = await import('../services/payment/pay04GarageSimulator.js');
const { Pay04Error } = await import('../services/payment/pay04Contract.js');
const { createPgSupabase } = await import('./helpers/pgSupabaseShim.js');

const run = crypto.randomBytes(4).toString('hex');
const u = (name) => `p4t_${name}_${run}`;
const ids = { admin: u('admin'), mech: u('mech'), cust: u('cust'), out: u('out'), op: u('op'), adminB: u('adminb'), mechB: u('mechb') };
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay04-svc-'));
const env = {
  NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY04_ENABLED: 'true', CARUP_PAY04_PROVIDER_MODE: 'local_simulator',
  CARUP_PAY04_SIMULATOR_STATE_FILE: path.join(stateDir, 'state.json'), CARUP_PAY04_SIMULATOR_WEBHOOK_SECRET: 'gsimsec_serviceTestFixture00000',
  CARUP_PAY04_RETURN_ORIGIN: 'http://127.0.0.1:5193', CARUP_PAY04_SIMULATOR_PUBLIC_ORIGIN: 'http://127.0.0.1:5041',
};
let db;
let sim;
const world = {};
const emitted = [];
const deps = { emitDomainEvent: async (_t, eventType, payload) => { emitted.push({ eventType, payload }); return { id: crypto.randomUUID() }; } };

const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params = []) => (await q(sql, params)).rows[0];
const customer = () => ({ id: ids.cust });
const garageAdmin = () => ({ id: ids.admin, tenantId: world.g });
const operator = () => ({ id: ids.op, platformRole: 'admin' });

async function rejectsWith(promise, code) {
  try { await promise; } catch (err) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code || err?.message}`);
    return err;
  }
  assert.fail(`expected ${code}`);
}

async function seedGarage(prefix, admin, mech) {
  const g = (await one("INSERT INTO tenants (name,type,status) VALUES ($1,'garage','active') RETURNING id", [`${prefix} Garage ${run}`])).id;
  await q('INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,$2,$4),($1,$3,$4)', [g, admin, mech, 'admin']);
  const branch = (await one("INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,$2,$3,'Africa/Harare',true) RETURNING id",
    [g, `${prefix} Central`, `${prefix}-${run}`.toUpperCase()])).id;
  const profile = (await one("INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,$2,$3,'employee','active','2026-10-01',$4) RETURNING id",
    [g, mech, `${prefix}-M-${run}`.toUpperCase(), admin])).id;
  await q('INSERT INTO garage_workforce_branch_assignments (tenant_id,workforce_profile_id,branch_id,is_primary,assigned_by_user_id) VALUES ($1,$2,$3,true,$4)', [g, profile, branch, admin]);
  await q("UPDATE tenant_users SET role='mechanic' WHERE tenant_id=$1 AND user_id=$2", [g, mech]);
  return { g, branch };
}

/** A completed, owner-authorized job invoiced through OPS07 for `amount` (one labour line from its service record). */
async function invoice(amount, { tenant = world.g, branch = world.branch, admin = ids.admin, mech = ids.mech, currency = 'USD' } = {}) {
  const c = (await one("INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,$4,'accepted') RETURNING id", [world.vin, tenant, branch, ids.cust])).id;
  const wo = (await one("INSERT INTO mechanic_work_orders (tenant_id,vin,customer_id,service_case_id,branch_id,status,owner_authorization) VALUES ($1,$2,$3,$4,$5,'In Progress','pending') RETURNING id", [tenant, world.vin, ids.cust, c, branch])).id;
  await q("SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','authorized',NULL)", [wo, world.vin, ids.cust]);
  await q('INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)', [wo, tenant, mech, admin]);
  await q("UPDATE service_cases SET status='active' WHERE id=$1", [c]);
  const rec = (await one("INSERT INTO service_records (work_order_id,service_case_id,tenant_id,vin,work_performed,service_authority,total_cost,currency,recorded_by_user_id,performed_at) VALUES ($1,$2,$3,$4,'Service','garage_stated',$5,$6,$7,now()) RETURNING id",
    [wo, c, tenant, world.vin, amount, currency, mech])).id;
  await q('SELECT garage_ops05_complete_job($1,$2,$3)', [tenant, c, admin]);
  const lines = JSON.stringify([{ category: 'labour', description: 'Workshop service', quantity: 1, unit_price: amount, source_kind: 'service_record', source_id: rec }]);
  return one('SELECT * FROM garage_ops07_issue_invoice($1,$2,$3,$4::jsonb,NULL,NULL,NULL,$5)', [tenant, wo, currency, lines, admin]);
}

/** Pay the simulated checkout and deliver its signed events the way the webhook route does. */
async function payAndDeliver(started, outcome = 'success') {
  const checkoutId = new URL(started.checkout_url).pathname.split('/').pop();
  const result = await sim.completeCheckout(checkoutId, { outcome });
  const out = [];
  for (const event of result.events) {
    const signed = sim.signEvent(event);
    out.push(await S.processGarageProviderEvent({ db, env, provider: sim, event: sim.verifyWebhook(signed), deps }));
  }
  return out;
}
const collectionOf = (collectionId) => one('SELECT c.*, p.status AS payment_status FROM pay04_garage_collections c JOIN payment_transactions p ON p.reference = c.payment_reference WHERE c.id = $1', [collectionId]);

before(async () => {
  if (skip) return;
  db = createPgSupabase(PGURL);
  sim = new Pay04GarageSimulatorProvider({ env });
  for (const id of Object.values(ids)) {
    await q("INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,$3,'2026-01-01')", [id, `${id}@example.invalid`, id === ids.op ? 'admin' : 'owner']);
  }
  world.vin = `P4T${run.toUpperCase()}000000`.slice(0, 17);
  await q("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ($1,'Toyota','Hilux',2020,60000,1000,$2)", [world.vin, ids.cust]);
  Object.assign(world, await seedGarage('p4t', ids.admin, ids.mech));
  const b = await seedGarage('p4u', ids.adminB, ids.mechB);
  world.gB = b.g; world.branchB = b.branch;
  await q('UPDATE pay04_runtime_guard SET garage_simulator_enabled = true, note = $1', [`pay04 service test ${run}`]);
});

after(async () => {
  if (skip) return;
  await q('UPDATE pay04_runtime_guard SET garage_simulator_enabled = false, note = $1', [`pay04 service test ${run} finished`]);
  await db.end();
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test('payment instructions are the garage\'s own versioned words, with the CarUp disclosure', { skip }, async () => {
  const empty = await S.getGaragePaymentInstructions({ db, actor: garageAdmin() });
  assert.equal(empty.active, null);
  const set = await S.setGaragePaymentInstructions({ db, actor: garageAdmin(), body: {
    payee_name: 'Hilux Motors (Pvt) Ltd', instructions: 'Pay at the front desk or by bank transfer quoting the invoice number.',
    accepted_methods: ['cash', 'bank_transfer'], currencies: ['USD'] } });
  assert.equal(set.active.version, 1);
  assert.match(set.active.disclosure, /CarUp does not receive, hold or verify this money/);
  await rejectsWith(S.setGaragePaymentInstructions({ db, actor: { id: ids.mech, tenantId: world.g }, body: {
    payee_name: 'Mechanic', instructions: 'Pay me personally please, cash only.', accepted_methods: ['cash'], currencies: ['USD'] } }),
  'GARAGE_OPS03_ADMIN_REQUIRED');
});

test('a customer sees how to pay; online payment exists only once the garage has a (simulated) merchant', { skip }, async () => {
  const inv = await invoice(150);
  world.inv = inv;
  const before = await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id });
  assert.equal(before.online_payment.available, false);
  assert.equal(before.online_payment.reason, 'garage_not_connected');
  assert.equal(before.payment_instructions.payee_name, 'Hilux Motors (Pvt) Ltd');
  assert.equal(before.money.balance_amount, '150.00');
  await rejectsWith(S.getCustomerInvoicePayment({ db, env, actor: { id: ids.out }, invoiceId: inv.id }), 'PAY04_INVOICE_NOT_FOUND');

  await rejectsWith(S.registerGarageMerchantAccount({ db, env, actor: { id: ids.admin, platformRole: 'owner' }, body: {
    tenant_id: world.g, merchant_reference: `gsim_merchant_${run}`, display_name: 'Hilux Motors (simulated)', currencies: ['USD'],
    authority_note: 'Level 1 simulation for the PAY-04 service test' } }), 'PAY04_MERCHANT_AUTHORITY_REFUSED');
  const { account } = await S.registerGarageMerchantAccount({ db, env, actor: operator(), body: {
    tenant_id: world.g, merchant_reference: `gsim_merchant_${run}`, display_name: 'Hilux Motors (simulated)', currencies: ['USD'],
    authority_note: 'Level 1 simulation for the PAY-04 service test' } });
  assert.equal(account.status, 'simulated');
  const after = await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id });
  assert.equal(after.online_payment.available, true);
  assert.equal(after.online_payment.simulated, true);
  assert.equal(after.online_payment.max_amount, '150.00');
  // dark when PAY-04 is not enabled
  const dark = await S.getCustomerInvoicePayment({ db, env: { ...env, CARUP_PAY04_ENABLED: 'false' }, actor: customer(), invoiceId: inv.id });
  assert.equal(dark.online_payment.available, false);
});

test('start -> simulated pay -> signed webhook -> fresh readback -> counted, receipted, notified once; replay changes nothing', { skip }, async () => {
  const key = `p4t-start-${run}-0001`;
  const started = await S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(), invoiceId: world.inv.id, body: { amount: '100.00' }, idempotencyKey: key });
  assert.equal(started.simulated, true);
  assert.match(started.checkout_url, /\/api\/pay04\/simulator\/checkout\/gsim_co_/);
  const replay = await S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(), invoiceId: world.inv.id, body: { amount: '100.00' }, idempotencyKey: key });
  assert.equal(replay.collection_id, started.collection_id);
  assert.equal(replay.replayed, true);
  assert.equal(replay.checkout_url, started.checkout_url);
  await rejectsWith(S.startGarageInvoicePayment({ db, env, provider: sim, actor: { id: ids.out }, invoiceId: world.inv.id, body: {}, idempotencyKey: `p4t-out-${run}-01` }), 'PAY04_INVOICE_NOT_FOUND');

  // in flight: reserved, not counted, not "paid"
  const pending = await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: world.inv.id });
  assert.equal(pending.money.paid_amount, '0.00');
  assert.equal(pending.money.provider_reserved, '100.00');
  assert.equal(pending.provider_payments[0].state, 'awaiting_provider');

  const [delivered] = await payAndDeliver(started);
  assert.equal(delivered.applied, true);
  assert.equal(delivered.payment_status, 'paid');
  assert.equal(delivered.notification.emitted, 1, 'the customer is told once');
  assert.equal(emitted.at(-1).eventType, 'garage.payment.confirmed');
  world.collection = started.collection_id;

  // OPS07's own invoice view is self-consistent: the provider money it counts is listed beside the declared payments
  const view = await I.getInvoice(db, { id: ids.admin, activeTenant: { id: world.g, type: 'garage', role: 'admin' } }, world.inv.id);
  assert.equal(view.provider_payments_supported, true);
  assert.equal(view.paid_amount, '100.00');
  assert.equal(view.money.provider_paid, '100.00');
  assert.equal(view.money.declared_paid, '0.00');
  assert.equal(view.provider_payments.length, 1);
  assert.equal(view.provider_payments[0].state, 'confirmed');
  assert.equal(view.provider_receipts.filter((r) => r.status === 'issued').length, 1);
  assert.equal(view.payments.length, 0, 'no declared payment was fabricated for provider money');
  assert.deepEqual(view.provider_history.map((e) => e.event_type),
    ['initiated', 'provider_attached', 'provider_observed', 'allocated', 'receipt_issued'], 'the append-only provider activity, in order');
  assert.equal(view.provider_history[0].actor, ids.cust, 'the payer started it');
  assert.equal(view.provider_history[3].actor, 'provider:pay04_garage_provider_simulator', 'the provider confirmed it');
  const mine = await I.listMyInvoices(db, { id: ids.cust });
  const myInv = mine.invoices.find((x) => x.id === world.inv.id);
  assert.equal(myInv.provider_receipts.length, 1);
  assert.equal(myInv.internal_note, undefined, 'the customer view keeps the garage-only fields out');
  const money = await S.invoiceMoney(db, world.inv.id);
  assert.deepEqual([money.paid_amount, money.provider_paid, money.balance_amount, money.payment_status], ['100.00', '100.00', '50.00', 'partially_paid']);

  // the same signed event again: a duplicate, and nobody is told twice
  const events = (await sim.load());
  const before = emitted.length;
  const replayEvent = { id: `evt_gsim_${events.namespace}_replay`, object: 'event', type: 'payment.succeeded', created: Math.floor(Date.now() / 1000),
    livemode: false, gateway: 'pay04_garage_provider_simulator', merchant_reference: `gsim_merchant_${run}`,
    data: { payment: { id: (await collectionOf(world.collection)).provider_payment_id } } };
  const first = await S.processGarageProviderEvent({ db, env, provider: sim, event: replayEvent, deps });
  const second = await S.processGarageProviderEvent({ db, env, provider: sim, event: replayEvent, deps });
  assert.equal(second.duplicate_event, true);
  assert.equal(first.applied, true, 'a new event id with unchanged truth is applied idempotently');
  assert.equal(emitted.length, before, 'no new notification for unchanged money');
  assert.equal(Number((await one('SELECT count(*) n FROM pay04_garage_payment_allocations WHERE collection_id=$1', [world.collection])).n), 1);
});

test('a forged or stale webhook is refused before anything is read or written', { skip }, async () => {
  const event = { id: 'evt_gsim_forged_0001', object: 'event', type: 'payment.succeeded', created: 1, livemode: false,
    gateway: 'pay04_garage_provider_simulator', data: { payment: { id: 'sim_pi_gar_forged' } } };
  const signed = sim.signEvent(event);
  assert.throws(() => sim.verifyWebhook({ rawBody: signed.rawBody, signature: signed.signature.replace(/v1=./, 'v1=0') }), { code: 'PAY04_SIMULATOR_SIGNATURE_INVALID' });
  const stale = `t=${Math.floor(Date.now() / 1000) - 3600},${signed.signature.split(',')[1]}`;
  assert.throws(() => sim.verifyWebhook({ rawBody: signed.rawBody, signature: stale }), { code: 'PAY04_SIMULATOR_SIGNATURE_INVALID' });
  const other = new Pay04GarageSimulatorProvider({ env: { ...env, CARUP_PAY04_SIMULATOR_WEBHOOK_SECRET: 'gsimsec_anotherSecretValue0000' } });
  assert.throws(() => sim.verifyWebhook(other.signEvent(event)), { code: 'PAY04_SIMULATOR_SIGNATURE_INVALID' });
  assert.throws(() => new Pay04GarageSimulatorProvider({ env: { ...env, CARUP_ENV: 'production' } }), { code: 'PAY04_SIMULATOR_REFUSED' });
  assert.throws(() => new Pay04GarageSimulatorProvider({ env: { ...env, CARUP_PAY04_SIMULATOR_WEBHOOK_SECRET: 'whsec_stripeLikeSecret000000' } }), { code: 'PAY04_SIMULATOR_REFUSED' });
});

test('the garage refunds in full through CarUp: refund_pending (not counted) -> provider confirms -> refunded, customer told', { skip }, async () => {
  await rejectsWith(S.refundGarageCollection({ db, env, provider: sim, actor: { id: ids.adminB, tenantId: world.gB }, collectionId: world.collection,
    body: { reason: 'Another garage trying to refund' } }), 'PAY04_COLLECTION_NOT_FOUND');
  await rejectsWith(S.refundGarageCollection({ db, env, provider: sim, actor: { id: ids.mech, tenantId: world.g }, collectionId: world.collection,
    body: { reason: 'Mechanic trying to refund the customer' } }), 'GARAGE_OPS03_ADMIN_REQUIRED');
  const out = await S.refundGarageCollection({ db, env, provider: sim, actor: garageAdmin(), collectionId: world.collection,
    body: { reason: 'Customer paid twice for the same service' }, deps });
  assert.equal(out.payment_status, 'refunded');
  assert.equal(out.collection.state, 'refunded');
  assert.equal(out.money.provider_paid, '0.00');
  assert.equal(out.money.balance_amount, '150.00');
  assert.equal(emitted.at(-1).eventType, 'garage.payment.refunded');
  const receipts = (await q('SELECT status FROM pay04_garage_provider_receipts WHERE collection_id=$1', [world.collection])).rows.map((r) => r.status);
  assert.deepEqual(receipts, ['voided'], 'the receipt of refunded money is voided, never deleted');
});

test('a partial refund made at the provider holds the payment (F5); the operator resolves it through the F5 surface', { skip }, async () => {
  const inv = await invoice(80);
  const started = await S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(), invoiceId: inv.id, body: {}, idempotencyKey: `p4t-hold-${run}-01` });
  await payAndDeliver(started);
  const c = await collectionOf(started.collection_id);
  const ext = await sim.createExternalRefund({ paymentId: c.provider_payment_id, amountMinor: 2000 });
  for (const event of ext.events) await S.processGarageProviderEvent({ db, env, provider: sim, event: sim.verifyWebhook(sim.signEvent(event)), deps });
  assert.equal((await collectionOf(started.collection_id)).payment_status, 'reconciliation_hold');
  assert.equal((await S.invoiceMoney(db, inv.id)).provider_paid, '0.00', 'a held payment is not counted');
  const exception = await one("SELECT id FROM pay03b_payment_reconciliation_exceptions WHERE payment_reference=$1 AND status='open'", [c.payment_reference]);
  const listed = await S.listGaragePaymentExceptions({ db, env });
  assert.ok(listed.reconciliation_holds.some((h) => h.id === exception.id));
  // the garage admin is not a platform operator; a platform operator who is the payer is conflicted (R5, extended)
  await rejectsWith(R.resolvePay03bReconciliationException({ db, env, pay04Provider: sim, exceptionId: exception.id, resolution: 'revoke_access_partial_refund_final',
    note: 'Garage keeps the remaining amount', adminActorId: ids.admin, adminActorRole: 'admin' }), 'PAY03B_RESOLUTION_AUTHORITY_REFUSED');
  const resolved = await R.resolvePay03bReconciliationException({ db, env, pay04Provider: sim, exceptionId: exception.id,
    resolution: 'revoke_access_partial_refund_final', note: 'The garage refunded 20.00 at the provider; 60.00 stands', adminActorId: ids.op, adminActorRole: 'admin' });
  assert.equal(resolved.paymentStatus, 'partially_refunded');
  const money = await S.invoiceMoney(db, inv.id);
  assert.deepEqual([money.provider_paid, money.balance_amount, money.payment_status], ['60.00', '20.00', 'partially_paid']);
});

test('a provider that misreports the amount opens a discrepancy and changes no money; the operator closes it once corrected', { skip }, async () => {
  const inv = await invoice(45);
  const started = await S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(), invoiceId: inv.id, body: {}, idempotencyKey: `p4t-mis-${run}-01` });
  const c = await collectionOf(started.collection_id);
  await sim.misreport({ paymentId: c.provider_payment_id, amountMinor: 4400 });
  const [delivered] = await payAndDeliver(started);
  assert.equal(delivered.applied, false);
  assert.equal(delivered.refused, 'amount_mismatch');
  assert.equal((await collectionOf(started.collection_id)).payment_status, 'pending');
  assert.equal((await S.invoiceMoney(db, inv.id)).provider_reserved, '45.00', 'uncertain money stays reserved');
  const { discrepancies } = await S.listGaragePaymentExceptions({ db, env });
  const d = discrepancies.find((x) => x.collection_id === started.collection_id && x.type === 'amount_mismatch');
  assert.ok(d);
  assert.ok(d.history.some((e) => e.event_type === 'discrepancy_opened'), 'the operator sees the audit trail');
  await rejectsWith(S.resolveGaragePaymentDiscrepancy({ db, env, actor: { id: ids.cust, platformRole: 'admin' }, discrepancyId: d.id,
    body: { resolution: 'provider_corrected', note: 'Customer says it is fine' } }), 'PAY04_RESOLUTION_AUTHORITY_REFUSED');
  await sim.misreport({ paymentId: c.provider_payment_id });
  await S.resolveGaragePaymentDiscrepancy({ db, env, actor: operator(), discrepancyId: d.id,
    body: { resolution: 'provider_corrected', note: 'Provider corrected the reported amount to 45.00' } });
  const garage = await S.reconcileGarageCollection({ db, env, provider: sim, actor: garageAdmin(), collectionId: started.collection_id, deps });
  assert.equal(garage.payment_status, 'paid');
  assert.equal(garage.money.payment_status, 'paid');
});

test('a provider read outage never fabricates a payment: the webhook fails safe, the money stays uncounted, and it is confirmed once the provider is back', { skip }, async () => {
  const inv = await invoice(55);
  const started = await S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(), invoiceId: inv.id, body: {}, idempotencyKey: `p4t-outage-${run}-01` });
  const c = await collectionOf(started.collection_id);
  await sim.misreport({ paymentId: c.provider_payment_id, unavailable: true });
  // the customer pays at the provider; the provider's webhook arrives, but CarUp cannot read the provider
  const checkoutId = new URL(started.checkout_url).pathname.split('/').pop();
  const { events } = await sim.completeCheckout(checkoutId, { outcome: 'success' });
  await rejectsWith(S.processGarageProviderEvent({ db, env, provider: sim, event: sim.verifyWebhook(sim.signEvent(events[0])), deps }), 'PAY04_PROVIDER_RETRIEVAL_UNAVAILABLE');
  await rejectsWith(S.verifyCustomerCollection({ db, env, provider: sim, actor: customer(), collectionId: started.collection_id, deps }), 'PAY04_PROVIDER_RETRIEVAL_UNAVAILABLE');
  assert.equal((await collectionOf(started.collection_id)).payment_status, 'pending', 'nothing was fabricated');
  let m = await S.invoiceMoney(db, inv.id);
  assert.deepEqual([m.paid_amount, m.provider_reserved], ['0.00', '55.00'], 'uncounted and still reserved');
  // the provider is back: the same webhook (redelivered) is applied from a fresh read
  await sim.misreport({ paymentId: c.provider_payment_id });
  const delivered = await S.processGarageProviderEvent({ db, env, provider: sim, event: sim.verifyWebhook(sim.signEvent(events[0])), deps });
  assert.equal(delivered.applied, true);
  m = await S.invoiceMoney(db, inv.id);
  assert.deepEqual([m.provider_paid, m.payment_status], ['55.00', 'paid']);
});

test('a declined card changes nothing; the customer can stop the checkout and the reservation is released', { skip }, async () => {
  const inv = await invoice(30);
  const started = await S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(), invoiceId: inv.id, body: {}, idempotencyKey: `p4t-dec-${run}-01` });
  const delivered = await payAndDeliver(started, 'decline');
  assert.deepEqual(delivered, [], 'a declined attempt produces no provider event');
  const verified = await S.verifyCustomerCollection({ db, env, provider: sim, actor: customer(), collectionId: started.collection_id, deps });
  assert.equal(verified.payment_status, 'pending');
  assert.equal(verified.money.paid_amount, '0.00');
  await rejectsWith(S.verifyCustomerCollection({ db, env, provider: sim, actor: { id: ids.out }, collectionId: started.collection_id }), 'PAY04_COLLECTION_NOT_FOUND');
  const stopped = await S.cancelCustomerCollection({ db, env, provider: sim, actor: customer(), collectionId: started.collection_id, body: { reason: 'Will pay cash' } });
  assert.equal(stopped.payment_status, 'cancelled');
  const money = await S.invoiceMoney(db, inv.id);
  assert.equal(money.provider_reserved, '0.00');
  assert.equal(money.uncommitted_balance, '30.00');
});

test('the garage overview reports per currency, never sums currencies, and never calls garage money CarUp\'s', { skip }, async () => {
  await invoice(20, { currency: 'ZWG' });
  const overview = await S.getGarageFinancialOverview({ db, env, actor: garageAdmin() });
  const usd = overview.currencies.find((c) => c.currency === 'USD');
  const zwg = overview.currencies.find((c) => c.currency === 'ZWG');
  assert.ok(usd && zwg, 'one bucket per currency');
  assert.equal(zwg.invoiced, '20.00');
  assert.equal(overview.provider.simulated, true);
  assert.match(overview.revenue_owner_note, /CarUp is not paid any of this money/);
  assert.equal(overview.truncated, false);
});

test('races on real PostgreSQL: one winner for the last unit of balance; webhook storms apply once; refunds once', { skip }, async () => {
  const inv = await invoice(60);
  // two customers' requests (different keys) for the whole balance at the same instant
  const attempts = await Promise.allSettled([1, 2, 3].map((n) => S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(),
    invoiceId: inv.id, body: { amount: '60.00' }, idempotencyKey: `p4t-race-${run}-${n}` })));
  const won = attempts.filter((a) => a.status === 'fulfilled');
  assert.equal(won.length, 1, 'exactly one collection reserves the balance');
  for (const lost of attempts.filter((a) => a.status === 'rejected')) assert.equal(lost.reason.code, 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE');
  // a declared payment racing a collection on another invoice can never over-commit it
  const inv2 = await invoice(50);
  const [declared, online] = await Promise.allSettled([
    q("SELECT garage_ops07_record_payment($1,$2,50,'USD','cash',NULL,now(),$3,$4)", [world.g, inv2.id, ids.admin, `p4t-cash-${run}-01`]),
    S.startGarageInvoicePayment({ db, env, provider: sim, actor: customer(), invoiceId: inv2.id, body: { amount: '50.00' }, idempotencyKey: `p4t-race2-${run}-01` }),
  ]);
  assert.equal([declared, online].filter((r) => r.status === 'fulfilled').length, 1, 'cash and online cannot both take the same 50');
  const m2 = await S.invoiceMoney(db, inv2.id);
  assert.ok(Number(m2.paid_amount) + Number(m2.provider_reserved) <= 50);

  // the winner pays; the same provider event is delivered five times at once
  const started = won[0].value;
  const checkoutId = new URL(started.checkout_url).pathname.split('/').pop();
  const { events } = await sim.completeCheckout(checkoutId, { outcome: 'success' });
  const event = sim.verifyWebhook(sim.signEvent(events[0]));
  const storm = await Promise.allSettled(Array.from({ length: 5 }, () => S.processGarageProviderEvent({ db, env, provider: sim, event, deps })));
  assert.ok(storm.every((s) => s.status === 'fulfilled'), JSON.stringify(storm.filter((s) => s.status === 'rejected').map((s) => s.reason?.code)));
  assert.equal(storm.filter((s) => s.value.applied).length, 1, 'one delivery applies');
  assert.equal(Number((await one('SELECT count(*) n FROM pay04_garage_payment_allocations WHERE collection_id=$1', [started.collection_id])).n), 1);
  assert.equal(Number((await one("SELECT count(*) n FROM pay04_garage_provider_receipts WHERE collection_id=$1 AND status='issued'", [started.collection_id])).n), 1);
  // two refund clicks at once: one refund at the provider
  const refunds = await Promise.allSettled([1, 2].map(() => S.refundGarageCollection({ db, env, provider: sim, actor: garageAdmin(),
    collectionId: started.collection_id, body: { reason: 'Duplicate charge for the same service' }, deps })));
  assert.ok(refunds.some((r) => r.status === 'fulfilled'));
  const c = await collectionOf(started.collection_id);
  assert.equal(c.payment_status, 'refunded');
  const providerRefunds = Object.values((await sim.load()).refunds).filter((r) => r.payment_intent === c.provider_payment_id);
  assert.equal(providerRefunds.length, 1, 'exactly one provider refund');
  // invariant over everything this test touched
  const bad = await one(`SELECT count(*) n FROM garage_invoices i CROSS JOIN LATERAL garage_ops07_invoice_balance(i.id) b
    WHERE i.tenant_id = $1 AND b.paid_amount > i.total_amount`, [world.g]);
  assert.equal(Number(bad.n), 0);
});

test('Pay04Error codes map to the HTTP shape the routes return', { skip: false }, async () => {
  const { pay04Failure } = await import('../services/payment/pay04Contract.js');
  assert.equal(pay04Failure({ message: 'PAY04_INVOICE_NOT_FOUND' }).status, 404);
  assert.equal(pay04Failure({ message: 'GARAGE_OPS03_ADMIN_REQUIRED' }).status, 403);
  assert.equal(pay04Failure({ message: 'PAY04_GATEWAY_NOT_PERMITTED' }).status, 503);
  assert.equal(pay04Failure({ message: 'PAY04_AMOUNT_INVALID' }).status, 422);
  assert.equal(pay04Failure({ message: 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE', details: 'uncommitted=10.00 reserved=0.00' }).details.detail, 'uncommitted=10.00 reserved=0.00');
  const unknown = pay04Failure({ message: 'connection reset; password=hunter2' });
  assert.equal(unknown.code, 'PAY04_OPERATION_UNAVAILABLE');
  assert.ok(!JSON.stringify(unknown).includes('hunter2'), 'an unknown failure never leaks its text');
  assert.ok(new Pay04Error('X') instanceof Error);
});
