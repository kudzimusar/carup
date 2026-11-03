/**
 * CARUP-PAY-05-LR01 — Paynow collections end to end through the SERVICES, against REAL PostgreSQL (PAY-04 + PAY-05
 * migrations) and the local Paynow protocol simulator over REAL HTTP (CarUp's production adapter and transport).
 * Paynow's status updates are delivered into the real webhook service exactly as the resulturl route does.
 *
 * Requires PAY05_TEST_PGURL (or PAY04_TEST_PGURL) naming a DISPOSABLE pay01c_sandbox_ci database prepared by
 * scripts/ci/pay05-postgres-certification.sh. Skipped with a reason otherwise. Fresh identities every run.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const PGURL = process.env.PAY05_TEST_PGURL || process.env.PAY04_TEST_PGURL || '';
const disposable = /^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/pay01c_sandbox_ci$/.test(PGURL) && !PGURL.includes(':54322/');
const skip = disposable ? false : 'PAY05_TEST_PGURL must name a disposable pay01c_sandbox_ci database (see scripts/ci/pay05-postgres-certification.sh)';

const S = await import('../services/payment/pay04GaragePaymentService.js');
const M = await import('../services/payment/pay05MerchantService.js');
const P = await import('../services/payment/pay05PaynowCollectionService.js');
const { startPaynowSimulatorServer } = await import('../../scripts/uat/pay05-paynow-simulator-server.mjs');
const { createPgSupabase } = await import('./helpers/pgSupabaseShim.js');
const A = await import('../services/payment/pay05PaynowAdapter.js');
const { signPairs, encodeForm } = await import('../services/payment/pay05PaynowProtocol.js');

const run = crypto.randomBytes(4).toString('hex');
const u = (name) => `p5s_${name}_${run}`;
const ids = { admin: u('admin'), mech: u('mech'), adminB: u('adminb'), mechB: u('mechb'), cust: u('cust'), op: u('op'), opMember: u('opm') };
const emitted = [];
const deps = { emitDomainEvent: async (_t, eventType, payload) => { emitted.push({ eventType, payload }); return { id: crypto.randomUUID() }; } };
let db;
let sim;
let env;
const world = {};

const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params = []) => (await q(sql, params)).rows[0];
const customer = () => ({ id: ids.cust });
const operator = () => ({ id: ids.op, platformRole: 'admin' });
const garageA = () => ({ id: ids.admin, tenantId: world.g, platformRole: 'owner' });
const garageB = () => ({ id: ids.adminB, tenantId: world.gB, platformRole: 'owner' });

async function rejectsWith(promise, code) {
  try { await promise; } catch (err) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code || err?.message}`);
    return err;
  }
  assert.fail(`expected ${code}`);
}

/** What an operator supplies at verification: each integration's own reviewed settlement currency (R1, ICR-P1). */
const reviewBody = async (merchantId, note) => {
  const rows = (await q('SELECT id, currency FROM pay05_merchant_integrations WHERE merchant_account_id = $1', [merchantId])).rows;
  return { legal_identity_reviewed: true, settlement_account_reviewed: true, currency_configuration_reviewed: true, note,
    currency_evidence: Object.fromEntries(rows.map((r) => [r.id, { settlement_currency: r.currency, reference: 'Simulated Paynow merchant settlement page reviewed' }])) };
};

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

const profile = (name) => ({ display_name: `${name} (Paynow)`, legal_entity_name: name, registration_number: '1234/2026',
  settlement_bank_name: 'CBZ Bank', settlement_account_last4: '4321', settlement_account_holder: name, attest: true });
const money = async (invoiceId) => S.invoiceMoney(db, invoiceId);
const txOf = (collectionId) => one('SELECT * FROM pay05_paynow_transactions WHERE collection_id = $1', [collectionId]);
const guidOf = async (collectionId) => new URL((await txOf(collectionId)).poll_url).searchParams.get('guid');
const paymentStatus = async (collectionId) => (await one('SELECT p.status FROM pay04_garage_collections c JOIN payment_transactions p ON p.reference = c.payment_reference WHERE c.id = $1', [collectionId])).status;
const errorsOf = async (collectionId, kind) => Number((await one('SELECT count(*)::int AS n FROM pay05_provider_errors WHERE collection_id = $1 AND kind = $2', [collectionId, kind])).n);
const start = (inv, body, key, envOverride = env) => S.startGarageInvoicePayment({ db, env: envOverride, actor: customer(), invoiceId: inv.id, body, idempotencyKey: key });

before(async () => {
  if (skip) return;
  db = createPgSupabase(PGURL);
  sim = await startPaynowSimulatorServer({
    deliver: async (url, body) => {
      const m = /\/api\/pay05\/paynow\/webhook\/([0-9a-f-]{36})$/.exec(new URL(url).pathname);
      if (!m) return 404;
      try {
        await P.processPaynowStatusUpdate({ db, env, collectionId: m[1], rawBody: body, deps });
        return 200;
      } catch (err) {
        return err?.status || 500;
      }
    },
    env: { NODE_ENV: 'test' },
  });
  env = {
    NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY04_ENABLED: 'true', CARUP_PAY05_ENABLED: 'true', CARUP_PAY05_PAYNOW_MODE: 'simulator',
    CARUP_PAY05_PAYNOW_SIMULATOR_ORIGIN: sim.origin, CARUP_PAY05_RESULT_ORIGIN: 'http://127.0.0.1:5051',
    CARUP_PAY04_RETURN_ORIGIN: 'http://127.0.0.1:5203', CARUP_PAY05_CREDENTIAL_KEK: crypto.randomBytes(32).toString('base64'),
    CARUP_PAY05_CREDENTIAL_KEK_VERSION: '1',
  };
  for (const id of Object.values(ids)) {
    await q("INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,$3,'2026-01-01')",
      [id, `${id}@example.invalid`, [ids.op, ids.opMember].includes(id) ? 'admin' : 'owner']);
  }
  world.vin = `P5S${run.toUpperCase()}000000`.slice(0, 17);
  await q("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ($1,'Toyota','Hilux',2020,60000,1000,$2)", [world.vin, ids.cust]);
  Object.assign(world, await seedGarage('p5s', ids.admin, ids.mech));
  const b = await seedGarage('p5t', ids.adminB, ids.mechB);
  world.gB = b.g; world.branchB = b.branch;
  await q('INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,$2,$3)', [world.g, ids.opMember, 'admin']);
  await q('UPDATE pay05_runtime_guard SET paynow_simulator_enabled = true, paynow_available = true');
});

after(async () => {
  if (skip) return;
  await q('UPDATE pay05_runtime_guard SET paynow_simulator_enabled = false');
  await sim.close();
  await db.end();
});

test('the garage connects its OWN Paynow merchant; the key is sealed, never returned; verification is independent and probes every key', { skip }, async () => {
  const usd = sim.simulator.issueIntegration({ currency: 'USD', methods: ['web', 'ecocash', 'onemoney', 'innbucks', 'omari'], name: 'P5S Motors USD' });
  const zwg = sim.simulator.issueIntegration({ currency: 'ZWG', methods: ['web', 'ecocash'], name: 'P5S Motors ZWG' });
  world.usd = usd;
  const body = { ...profile('P5S Motors (Pvt) Ltd'), integrations: [
    { currency: 'USD', integration_id: usd.integrationId, integration_key: usd.key, methods: usd.methods },
    // independent review P5: a key pasted in upper case is normalised as Paynow renders a GUID
    { currency: 'ZWG', integration_id: zwg.integrationId, integration_key: ` ${zwg.key.toUpperCase()} `, methods: zwg.methods }] };
  await rejectsWith(M.connectGaragePaynow({ db, env, actor: { id: ids.mech, tenantId: world.g }, body }), 'PAY05_MERCHANT_AUTHORITY_REFUSED');
  await rejectsWith(M.connectGaragePaynow({ db, env, actor: garageA(), body: { ...body, attest: false } }), 'PAY05_ATTESTATION_REQUIRED');
  await rejectsWith(M.connectGaragePaynow({ db, env: { ...env, CARUP_PAY05_PAYNOW_MODE: 'paynow_live' }, actor: garageA(), body }), 'PAY05_REAL_PROVIDER_NOT_AUTHORIZED');
  await rejectsWith(M.connectGaragePaynow({ db, env, actor: garageA(), body: { ...body, integrations: [{ ...body.integrations[1], methods: ['innbucks'] }] } }),
    'PAY05_METHOD_NOT_AVAILABLE');
  const connected = await M.connectGaragePaynow({ db, env, actor: garageA(), body });
  world.merchant = connected.merchant.id;
  assert.equal(connected.merchant.status, 'pending_verification');
  assert.deepEqual(connected.merchant.integrations.map((i) => [i.currency, i.status, i.mode]), [['USD', 'pending_verification', 'simulator'], ['ZWG', 'pending_verification', 'simulator']]);
  const wire = JSON.stringify(connected);
  assert.ok(!wire.includes(usd.key) && !wire.includes(zwg.key), 'no key in any response');
  const stored = await one('SELECT string_agg(credential_ciphertext || credential_iv || credential_tag, \'\') AS s FROM pay05_merchant_integrations WHERE merchant_account_id = $1', [world.merchant]);
  assert.ok(!stored.s.includes(usd.key) && !stored.s.includes(zwg.key) && !stored.s.includes(usd.key.slice(0, 8)), 'no key stored in plaintext');

  // the customer cannot pay through an unverified merchant
  const inv = await invoice(40);
  assert.equal((await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id })).online_payment.reason, 'garage_not_connected');

  // verification: not by the registrant, not by a garage member, not without the reviews; the server probes every key
  await rejectsWith(M.verifyPaynowMerchant({ db, env, actor: { id: ids.admin, platformRole: 'owner' }, merchantAccountId: world.merchant,
    body: { legal_identity_reviewed: true, settlement_account_reviewed: true, note: 'Self verification attempt.' } }), 'PAY05_VERIFICATION_AUTHORITY_REFUSED');
  // independent review S9: a garage member is refused BEFORE any key is opened or Paynow is called
  const probeCalls = [];
  const spy = async (url, opts) => { probeCalls.push(url); return A.httpTransport()(url, opts); };
  await rejectsWith(M.verifyPaynowMerchant({ db, env, transport: spy, actor: { id: ids.opMember, platformRole: 'admin' }, merchantAccountId: world.merchant,
    body: { legal_identity_reviewed: true, settlement_account_reviewed: true, currency_configuration_reviewed: true, note: 'A garage member cannot verify.' } }),
  'PAY05_REVIEWER_SEPARATION_REQUIRED');
  assert.equal(probeCalls.length, 0, 'no probe before the separation check');
  // independent review P3: Paynow reports no currency, so the operator must have checked each integration's currency
  await rejectsWith(M.verifyPaynowMerchant({ db, env, actor: operator(), merchantAccountId: world.merchant,
    body: { legal_identity_reviewed: true, settlement_account_reviewed: true, note: 'Currency configuration not reviewed.' } }), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  await rejectsWith(M.verifyPaynowMerchant({ db, env, actor: operator(), merchantAccountId: world.merchant,
    body: { legal_identity_reviewed: true, settlement_account_reviewed: false, note: 'Settlement account not reviewed.' } }), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  // R1 (ICR-P1): the global tick-box alone is not enough: each integration needs its own reviewed settlement currency
  await rejectsWith(M.verifyPaynowMerchant({ db, env, actor: operator(), merchantAccountId: world.merchant,
    body: { legal_identity_reviewed: true, settlement_account_reviewed: true, currency_configuration_reviewed: true, note: 'No per-integration currency evidence.' } }),
  'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  const verified = await M.verifyPaynowMerchant({ db, env, actor: operator(), merchantAccountId: world.merchant,
    body: await reviewBody(world.merchant, 'Legal name and settlement account match the garage.') });
  assert.equal(verified.merchant.status, 'verified');
  assert.deepEqual(Object.values(verified.probes).map((p) => p.result), ['authenticated', 'authenticated']);

  // garage B pastes a real integration ID with the WRONG key. R1 (ICR-S2): the probe at connect refuses it and nothing is reserved
  const other = sim.simulator.issueIntegration({ currency: 'USD', methods: ['web'] });
  await rejectsWith(M.connectGaragePaynow({ db, env, actor: garageB(), body: { ...profile('P5T Auto Ltd'), integrations: [
    { currency: 'USD', integration_id: other.integrationId, integration_key: crypto.randomUUID(), methods: ['web'] }] } }), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  assert.equal(Number((await one('SELECT count(*)::int AS n FROM pay05_merchant_integrations WHERE integration_id = $1', [other.integrationId])).n), 0, 'nothing reserved');
  assert.equal(Number((await one("SELECT count(*)::int AS n FROM pay05_provider_errors WHERE tenant_id = $1 AND kind = 'credential_probe_failed'", [world.gB])).n), 1);
  // with the right key it connects; an operator can still reject it
  const wrong = await M.connectGaragePaynow({ db, env, actor: garageB(), body: { ...profile('P5T Auto Ltd'), integrations: [
    { currency: 'USD', integration_id: other.integrationId, integration_key: other.key, methods: ['web'] }] } });
  await M.rejectPaynowMerchant({ db, env, actor: operator(), merchantAccountId: wrong.merchant.id, body: { reason: 'The integration key does not match the integration ID.' } });
  // independent review W9: the garage sees why
  const rejectedView = await M.getGaragePaynowConnection({ db, env, actor: garageB() });
  assert.equal(rejectedView.merchant.status, 'rejected');
  assert.equal(rejectedView.merchant.rejected_reason, 'The integration key does not match the integration ID.');
  assert.ok(rejectedView.merchant.rejected_at);
  // ...and garage B can never take over garage A's integration
  await rejectsWith(M.connectGaragePaynow({ db, env, actor: garageB(), body: { ...profile('P5T Auto Ltd'), integrations: [
    { currency: 'USD', integration_id: usd.integrationId, integration_key: usd.key, methods: ['web'] }] } }), 'PAY05_INTEGRATION_NOT_ACCEPTED');
});

test('hosted checkout: returning from Paynow proves nothing; Paynow\'s signed update + a fresh poll count it, with a receipt', { skip }, async () => {
  const inv = await invoice(60);
  world.invWeb = inv;
  const option = (await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id })).online_payment;
  assert.equal(option.available, true);
  assert.equal(option.gateway, 'paynow_zimbabwe');
  assert.equal(option.simulated, true);
  assert.deepEqual([...option.methods].sort(), ['ecocash', 'innbucks', 'omari', 'onemoney', 'web']);
  const started = await start(inv, { method: 'web' }, `p5s-web-${run}-1`);
  assert.ok(started.checkout_url.startsWith(`${sim.origin}/Payment/ConfirmPayment/`));
  assert.equal((await money(inv.id)).provider_reserved, '60.00');
  // a replay of the same request never sends a second Paynow request
  const replay = await start(inv, { method: 'web' }, `p5s-web-${run}-1`);
  assert.equal(replay.replayed, true);
  assert.equal(sim.simulator.list().filter((t) => t.reference === (sim.simulator.list().at(-1).reference)).length, 1);
  // the customer comes back without paying: CarUp asks Paynow — still nothing counted
  const back = await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: started.collection_id, deps });
  assert.equal(back.paynow.provider_status, 'created');
  assert.equal((await money(inv.id)).provider_paid, '0.00');
  // pay on the (simulated) hosted page: Paynow posts its signed update; CarUp polls and counts
  await fetch(started.checkout_url, { method: 'POST', body: 'outcome=pay', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  const after = await money(inv.id);
  assert.deepEqual([after.provider_paid, after.payment_status, after.provider_reserved], ['60.00', 'paid', '0.00']);
  assert.equal(await paymentStatus(started.collection_id), 'paid');
  const receipts = await q("SELECT receipt_number, amount FROM pay04_garage_provider_receipts WHERE collection_id = $1 AND status = 'issued'", [started.collection_id]);
  assert.equal(receipts.rows.length, 1);
  assert.ok(emitted.some((e) => /confirmed/i.test(e.eventType)), 'the confirmed payment is notified');
  // Paynow resends the same update: the same event, not polled or applied again
  const observations = Number((await one('SELECT count(*)::int AS n FROM pay05_paynow_observations WHERE collection_id = $1', [started.collection_id])).n);
  await sim.simulator.resend(await guidOf(started.collection_id));
  assert.equal(Number((await one('SELECT count(*)::int AS n FROM pay05_paynow_observations WHERE collection_id = $1', [started.collection_id])).n), observations);
  world.webCollection = started.collection_id;
});

test('express: EcoCash approval counts; a user-cancelled request closes; "insufficient balance" is refused and frees the room', { skip }, async () => {
  const inv = await invoice(25);
  const ok = await start(inv, { method: 'ecocash', phone: '+263 77 111 1111' }, `p5s-eco-${run}-1`);
  assert.equal(ok.checkout_url, null);
  assert.match(ok.paynow.instructions, /EcoCash/);
  assert.equal(ok.paynow.phone, '077*****11');
  assert.equal((await txOf(ok.collection_id)).method, 'ecocash');
  await sim.simulator.setStatus(await guidOf(ok.collection_id), 'Paid');
  assert.equal((await money(inv.id)).payment_status, 'paid');

  const inv2 = await invoice(30);
  const cancelled = await start(inv2, { method: 'ecocash', phone: '0773333333' }, `p5s-eco-${run}-2`);
  await sim.simulator.setStatus(await guidOf(cancelled.collection_id), 'Failed');
  assert.equal(await paymentStatus(cancelled.collection_id), 'cancelled');
  assert.equal((await money(inv2.id)).uncommitted_balance, '30.00');

  const err = await rejectsWith(start(inv2, { method: 'ecocash', phone: '0774444444' }, `p5s-eco-${run}-3`), 'PAY05_PROVIDER_REFUSED');
  assert.equal(err.details.provider_error, 'Insufficient balance');
  const refusedCollection = (await one("SELECT c.id FROM pay04_garage_collections c WHERE c.invoice_id = $1 AND c.idempotency_key = $2", [inv2.id, `p5s-eco-${run}-3`])).id;
  assert.equal(await paymentStatus(refusedCollection), 'cancelled');
  assert.equal((await txOf(refusedCollection)).initiation_state, 'refused');
  assert.equal((await money(inv2.id)).uncommitted_balance, '30.00', 'a refused request holds nothing');
  await rejectsWith(start(inv2, { method: 'ecocash', phone: '12345' }, `p5s-eco-${run}-4`), 'PAY05_PHONE_INVALID');
  await rejectsWith(start(inv2, { method: 'vmc' }, `p5s-eco-${run}-5`), 'PAY05_METHOD_NOT_AVAILABLE');
  await rejectsWith(start(inv2, { method: 'zimswitch' }, `p5s-eco-${run}-6`), 'PAY05_METHOD_NOT_AVAILABLE');
  // a mistyped phone or an unavailable method is refused BEFORE anything is reserved
  assert.equal((await money(inv2.id)).uncommitted_balance, '30.00');
  assert.equal(Number((await one('SELECT count(*)::int AS n FROM pay04_garage_collections WHERE idempotency_key = ANY($1)',
    [[`p5s-eco-${run}-4`, `p5s-eco-${run}-5`, `p5s-eco-${run}-6`]])).n), 0);
});

test('InnBucks shows its authorization code (USD only); O\'mari completes only with the right one-time password', { skip }, async () => {
  const inv = await invoice(18);
  await rejectsWith(start(inv, { method: 'innbucks' }, `p5s-inn-${run}-0`), 'PAY05_PHONE_INVALID');
  const inn = await start(inv, { method: 'innbucks', phone: '0771234567' }, `p5s-inn-${run}-1`);
  assert.match(inn.paynow.authorization_code, /^\d{9}$/);
  assert.ok(inn.paynow.authorization_expires);
  await sim.simulator.setStatus(await guidOf(inn.collection_id), 'Paid');
  assert.equal((await money(inv.id)).payment_status, 'paid');

  const zwgInv = await invoice(500, { currency: 'ZWG' });
  const zwgOption = (await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: zwgInv.id })).online_payment;
  assert.deepEqual([...zwgOption.methods].sort(), ['ecocash', 'web'], 'ZWG offers what the ZWG integration enables — no InnBucks');
  await rejectsWith(start(zwgInv, { method: 'innbucks', phone: '0771234567' }, `p5s-inn-${run}-2`), 'PAY05_METHOD_NOT_AVAILABLE');

  const inv2 = await invoice(22);
  const om = await start(inv2, { method: 'omari', phone: '0712345678' }, `p5s-om-${run}-1`);
  assert.equal(om.paynow.needs_otp, true);
  assert.match(om.paynow.otp_reference, /^OTP/);
  await rejectsWith(P.submitPaynowOtp({ db, env, actor: customer(), collectionId: om.collection_id, body: { otp: '000000' } }), 'PAY05_OTP_REJECTED');
  await rejectsWith(P.submitPaynowOtp({ db, env, actor: { id: ids.adminB }, collectionId: om.collection_id, body: { otp: '000000' } }), 'PAY05_COLLECTION_NOT_FOUND');
  // independent review S5: a collection that does not exist looks exactly like someone else's
  await rejectsWith(P.submitPaynowOtp({ db, env, actor: { id: ids.adminB }, collectionId: crypto.randomUUID(), body: { otp: '000000' } }), 'PAY05_COLLECTION_NOT_FOUND');
  const { otp } = sim.simulator.otpOutbox.at(-1);
  const done = await P.submitPaynowOtp({ db, env, actor: customer(), collectionId: om.collection_id, body: { otp }, deps });
  assert.equal(done.paynow.provider_status, 'paid');
  assert.equal((await money(inv2.id)).payment_status, 'paid');
});

test('a lost or unauthenticated reply is recovered by trace — never by a second payment request', { skip }, async () => {
  const inv = await invoice(35);
  sim.simulator.inject('initiate', { kind: 'drop_response' });
  const lost = await start(inv, { method: 'ecocash', phone: '0771234567' }, `p5s-lost-${run}-1`);
  assert.equal(lost.paynow.initiation, 'attached', 'Paynow had it: the trace found and bound it');
  assert.equal(await errorsOf(lost.collection_id, 'provider_unreachable'), 1);
  const created = sim.simulator.list().filter((t) => t.reference === (sim.simulator.list().at(-1).reference));
  assert.equal(created.length, 1, 'exactly one Paynow transaction');
  await sim.simulator.setStatus(await guidOf(lost.collection_id), 'Paid');
  assert.equal((await money(inv.id)).payment_status, 'paid');

  const inv2 = await invoice(36);
  sim.simulator.inject('initiate', { kind: 'unsigned_ok' });
  const unsigned = await start(inv2, { method: 'web' }, `p5s-lost-${run}-2`);
  assert.equal(unsigned.paynow.initiation, 'attached');
  assert.equal(unsigned.checkout_url, null, 'a reply recovered by trace has no Paynow page to send the customer to');
  assert.equal(await errorsOf(unsigned.collection_id, 'provider_unauthenticated'), 1);
});

test('status updates: forged, tampered, foreign and cross-garage messages are refused and recorded; nothing moves', { skip }, async () => {
  const inv = await invoice(44);
  const s = await start(inv, { method: 'web' }, `p5s-cb-${run}-1`);
  const guid = await guidOf(s.collection_id);
  await rejectsWith(P.processPaynowStatusUpdate({ db, env, collectionId: s.collection_id, rawBody: sim.simulator.forgedStatusMessage(guid) }),
    'PAY05_CALLBACK_SIGNATURE_INVALID');
  await rejectsWith(P.processPaynowStatusUpdate({ db, env, collectionId: s.collection_id,
    rawBody: sim.simulator.forgedStatusMessage(guid, { key: world.usd.key, tamper: true }) }), 'PAY05_CALLBACK_SIGNATURE_INVALID');
  await rejectsWith(P.processPaynowStatusUpdate({ db, env, collectionId: s.collection_id, rawBody: 'not a paynow message' }), 'PAY05_CALLBACK_MALFORMED');
  // a correctly signed update for ANOTHER payment of the same merchant, posted to this collection's resulturl
  const other = await start(await invoice(45), { method: 'web' }, `p5s-cb-${run}-2`);
  const otherBody = sim.simulator.forgedStatusMessage(await guidOf(other.collection_id), { key: world.usd.key, status: 'Paid' });
  await rejectsWith(P.processPaynowStatusUpdate({ db, env, collectionId: s.collection_id, rawBody: otherBody }), 'PAY05_PROVIDER_BINDING_MISMATCH');
  // independent review S5: repeated refusals for one collection are recorded once a minute
  assert.equal(await errorsOf(s.collection_id, 'callback_signature_invalid'), 1);
  assert.equal(await errorsOf(s.collection_id, 'callback_binding_mismatch'), 1);
  assert.equal(await paymentStatus(s.collection_id), 'pending');
  assert.equal((await money(inv.id)).provider_paid, '0.00');
  await rejectsWith(P.processPaynowStatusUpdate({ db, env, collectionId: crypto.randomUUID(), rawBody: otherBody }), 'PAY05_COLLECTION_NOT_FOUND');
  // independent review P6: a correctly signed update whose poll URL is not Paynow's is a URL refusal, not a forgery
  const tx = sim.simulator.list().find((t) => t.guid === guid);
  const foreign = encodeForm(signPairs([['reference', tx.reference], ['paynowreference', tx.paynowReference], ['amount', tx.amount],
    ['status', 'Paid'], ['pollurl', `https://attacker.example/Interface/CheckPayment/?guid=${guid}`]], world.usd.key));
  await rejectsWith(P.processPaynowStatusUpdate({ db, env, collectionId: s.collection_id, rawBody: foreign }), 'PAY05_PROVIDER_URL_REFUSED');
  assert.equal(await errorsOf(s.collection_id, 'provider_url_refused'), 1);
  assert.equal(await paymentStatus(s.collection_id), 'pending');
});

test('Paynow cannot cancel: a stop keeps the room held; Paynow\'s Cancelled closes it; refunds happen in Paynow; disputes hold', { skip }, async () => {
  const inv = await invoice(50);
  const s = await start(inv, { method: 'web' }, `p5s-stop-${run}-1`);
  const stopped = await S.cancelCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, body: { reason: 'Changed my mind' } });
  assert.match(stopped.notice, /cannot cancel/);
  assert.equal(await paymentStatus(s.collection_id), 'pending');
  assert.equal((await money(inv.id)).provider_reserved, '50.00', 'still held: it can still be paid at Paynow');
  await sim.simulator.setStatus(await guidOf(s.collection_id), 'Cancelled');
  assert.equal(await paymentStatus(s.collection_id), 'cancelled');
  assert.equal((await money(inv.id)).uncommitted_balance, '50.00');

  // a paid Paynow payment: the garage cannot refund through CarUp; when Paynow reports Refunded CarUp records it
  const err = await rejectsWith(S.refundGarageCollection({ db, env, actor: garageA(), collectionId: world.webCollection,
    body: { reason: 'Customer returned the vehicle unserviced.' } }), 'PAY05_PROVIDER_REFUND_UNSUPPORTED');
  assert.match(err.details.guidance, /Paynow dashboard/);
  await sim.simulator.setStatus(await guidOf(world.webCollection), 'Disputed');
  assert.equal((await money(world.invWeb.id)).provider_paid, '0.00', 'disputed money is not counted');
  // physical rehearsal R2: an operator cannot close a dispute Paynow still reports — and is told so, not "unavailable"
  const dispute = await one("SELECT id FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND discrepancy_type = 'provider_disputed' AND status = 'open'", [world.webCollection]);
  await rejectsWith(S.resolveGaragePaymentDiscrepancy({ db, env, actor: operator(), discrepancyId: dispute.id,
    body: { resolution: 'provider_corrected', note: 'Closing a dispute Paynow still reports.' } }), 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER');
  const garageView = await S.getGarageInvoicePayments({ db, env, actor: garageA(), invoiceId: world.invWeb.id });
  assert.equal(garageView.provider_payments[0].state, 'under_review');
  assert.equal(garageView.provider_payments[0].paynow.provider_status, 'disputed');
  await sim.simulator.setStatus(await guidOf(world.webCollection), 'Paid');
  assert.equal((await money(world.invWeb.id)).provider_paid, '60.00', 'Paynow\'s Paid ends the dispute');
  await sim.simulator.setStatus(await guidOf(world.webCollection), 'Refunded');
  assert.equal(await paymentStatus(world.webCollection), 'refunded');
  assert.equal((await money(world.invWeb.id)).provider_paid, '0.00');
  assert.equal(Number((await one("SELECT count(*)::int AS n FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND discrepancy_type = 'provider_refund_unquantified' AND status = 'open'", [world.webCollection])).n), 1);
  // independent review C-exceptions: the operator's list names each discrepancy's gateway
  const exceptions = await S.listGaragePaymentExceptions({ db, env });
  const row = exceptions.discrepancies.find((d) => d.collection_id === world.webCollection && d.type === 'provider_refund_unquantified');
  assert.equal(row?.gateway, 'paynow_zimbabwe');
  // independent review D9: 'acknowledged' was refused by the backend although the database and the operator UI offer it
  const ack = await S.resolveGaragePaymentDiscrepancy({ db, env, actor: operator(), discrepancyId: row.id,
    body: { resolution: 'acknowledged', note: 'Paynow merchant records show the full amount refunded to the customer.' } });
  assert.equal(ack.status, 'resolved');
});

test('hold release: only an operator, only after expiry, only after a fresh unpaid read; late money is never double counted', { skip }, async () => {
  const shortEnv = { ...env, CARUP_PAY04_UAT_COLLECTION_TTL_SECONDS: '5' };
  const inv = await invoice(70);
  const s = await start(inv, { method: 'ecocash', phone: '0779876543' }, `p5s-hold-${run}-1`, shortEnv);
  await rejectsWith(P.releasePaynowHold({ db, env, actor: operator(), collectionId: s.collection_id, body: { reason: 'The customer abandoned the prompt.' } }),
    'PAY05_HOLD_NOT_RELEASABLE');
  await new Promise((resolve) => setTimeout(resolve, 5500));
  await rejectsWith(P.releasePaynowHold({ db, env, actor: { id: ids.opMember, platformRole: 'admin' }, collectionId: s.collection_id,
    body: { reason: 'A garage member cannot release.' } }), 'PAY05_RELEASE_SELF_DEALING_REFUSED');
  const released = await P.releasePaynowHold({ db, env, actor: operator(), collectionId: s.collection_id,
    body: { reason: 'The customer abandoned the EcoCash prompt; Paynow shows it unpaid.' } });
  assert.equal(released.money.provider_reserved, '0.00');
  assert.equal(released.money.uncommitted_balance, '70.00');
  assert.equal(released.paynow.hold_released, true);
  // the garage is paid in cash instead; then Paynow reports the abandoned request paid after all
  await q("SELECT garage_ops07_record_payment($1,$2,70,'USD','cash','P5S-CASH-1',now(),$3,$4)", [world.g, inv.id, ids.admin, `p5s-cash-${run}`]);
  await sim.simulator.setStatus(await guidOf(s.collection_id), 'Paid');
  const after = await money(inv.id);
  assert.deepEqual([after.paid_amount, after.provider_paid, after.payment_status], ['70.00', '0.00', 'paid']);
  assert.equal(Number((await one("SELECT count(*)::int AS n FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND discrepancy_type = 'unallocated_provider_money' AND status = 'open'", [s.collection_id])).n), 1);
});

test('independent review D1: a Paynow read that started before the read CarUp applied is superseded — a stale Sent never reverses counted money', { skip }, async () => {
  const inv = await invoice(41);
  const s = await start(inv, { method: 'ecocash', phone: '0779000101' }, `p5s-race-${run}-1`);
  const guid = await guidOf(s.collection_id);
  const real = A.httpTransport();
  let replied; const gotReply = new Promise((resolve) => { replied = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const slow = async (url, opts) => { const out = await real(url, opts); if (/checkpayment/i.test(url)) { replied(); await gate; } return out; };
  // the customer's check takes its ticket and reads "Sent" ... and is slow to come back
  const stale = P.checkPaynowCollection({ db, env, transport: slow, collection: await S.loadCollection(db, s.collection_id), deps });
  await gotReply;
  // meanwhile Paynow posts its signed "Paid": a later ticket, applied, counted
  await sim.simulator.setStatus(guid, 'Paid');
  assert.equal(await paymentStatus(s.collection_id), 'paid');
  release();
  await stale;
  assert.equal(await paymentStatus(s.collection_id), 'paid');
  assert.equal((await money(inv.id)).provider_paid, '41.00');
  assert.equal((await one('SELECT outcome FROM pay05_paynow_observations WHERE collection_id = $1 ORDER BY seq DESC LIMIT 1', [s.collection_id])).outcome, 'superseded');
  assert.equal(Number((await one("SELECT count(*)::int AS n FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND status = 'open'", [s.collection_id])).n), 0);
});

test('independent review P1/D2/S2: Paynow answered Error but the request existed — its later SIGNED Paid binds late into an operator review', { skip }, async () => {
  const inv = await invoice(43);
  sim.simulator.inject('initiate', { kind: 'error', message: 'Simulated: temporarily unable' });
  await rejectsWith(start(inv, { method: 'ecocash', phone: '0779000102' }, `p5s-late-${run}-1`), 'PAY05_PROVIDER_REFUSED');
  const c = await one('SELECT id, payment_reference FROM pay04_garage_collections WHERE invoice_id = $1', [inv.id]);
  assert.equal(await paymentStatus(c.id), 'cancelled');
  assert.equal((await money(inv.id)).uncommitted_balance, '43.00', 'refused: the room is free');
  const tx = sim.simulator.list().find((t) => t.reference === c.payment_reference);
  assert.ok(tx, 'the (simulated) Paynow had created the transaction before answering Error');
  await sim.simulator.setStatus(tx.guid, 'Paid');
  assert.equal(Number((await one("SELECT count(*)::int AS n FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND discrepancy_type = 'provider_paid_after_close' AND status = 'open'", [c.id])).n), 1);
  assert.equal((await money(inv.id)).provider_paid, '0.00');
  assert.equal((await txOf(c.id)).attached_after_close, true);
});

test('independent review D7: Paynow\'s "Paid" again after a dispute CarUp learned by POLL is a new event, not a resend', { skip }, async () => {
  const inv = await invoice(46);
  const s = await start(inv, { method: 'ecocash', phone: '0779000103' }, `p5s-d7-${run}-1`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid');
  await sim.simulator.setStatus(guid, 'Disputed', { notify: false });
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
  assert.equal((await money(inv.id)).provider_paid, '0.00', 'the dispute, learned by poll, holds the money');
  await sim.simulator.setStatus(guid, 'Paid'); // byte-identical to the first Paid update
  assert.equal((await money(inv.id)).provider_paid, '46.00', 'polled and applied, not dropped as a resend');
});

test('independent review S6: a trace reply naming another payment never binds this one (the service refuses before the database must)', { skip }, async () => {
  const inv = await invoice(48);
  sim.simulator.inject('initiate', { kind: 'drop_response' });
  sim.simulator.inject('trace', { kind: 'error' }); // the start's own recovery gets no answer: the request stays unconfirmed
  const s = await start(inv, { method: 'ecocash', phone: '0779000105' }, `p5s-s6-${run}-1`);
  assert.equal((await txOf(s.collection_id)).initiation_state, 'unknown');
  const real = A.httpTransport();
  // a correctly signed trace reply (re-signed with the integration's own key) that names ANOTHER payment's reference
  const foreign = async (url, opts) => {
    const out = await real(url, opts);
    if (!/\/interface\/trace$/i.test(new URL(url).pathname)) return out;
    const pairs = [...new URLSearchParams(out.text)].filter(([k]) => k !== 'hash')
      .map(([k, v]) => (k === 'reference' ? [k, 'pay04_gar_00000000-0000-0000-0000-000000000000'] : [k, v]));
    return { ...out, text: encodeForm(signPairs(pairs, world.usd.key)) };
  };
  await P.checkPaynowCollection({ db, env, transport: foreign, collection: await S.loadCollection(db, s.collection_id), deps });
  assert.equal((await txOf(s.collection_id)).initiation_state, 'unknown', 'never bound to the foreign request');
  assert.equal(await errorsOf(s.collection_id, 'callback_binding_mismatch'), 1);
});

test('independent review S3/S4/S10: the kill switch reaches PAY-04 routes; customers get the customer view; refresh is throttled', { skip }, async () => {
  const inv = await invoice(47);
  const s = await start(inv, { method: 'ecocash', phone: '0779000104' }, `p5s-ks-${run}-1`);
  const v = await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
  assert.equal(v.collection.paynow?.paynow_reference ?? null, null, 'no garage-side Paynow reference for the customer');
  assert.equal(v.collection.paynow?.provider_error ?? null, null);
  const stopped = await S.cancelCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, body: { reason: 'Changed my mind' } });
  assert.equal(stopped.paynow.paynow_reference, null);
  assert.equal(stopped.collection?.paynow?.paynow_reference ?? null, null);
  const observations = async () => Number((await one('SELECT count(*)::int AS n FROM pay05_paynow_observations WHERE collection_id = $1', [s.collection_id])).n);
  const before = await observations();
  await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id });
  await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id });
  assert.equal(await observations(), before, 'a request read in the last minute is not re-read on every view');
  const off = { ...env, CARUP_PAY05_ENABLED: 'false' };
  await rejectsWith(S.verifyCustomerCollection({ db, env: off, actor: customer(), collectionId: s.collection_id, deps }), 'PAY05_DISABLED');
  await rejectsWith(S.reconcileGarageCollection({ db, env: off, actor: garageA(), collectionId: s.collection_id, deps }), 'PAY05_DISABLED');
  await rejectsWith(S.cancelCustomerCollection({ db, env: off, actor: customer(), collectionId: s.collection_id, body: { reason: 'Again' } }), 'PAY05_DISABLED');
  const view = await S.getCustomerInvoicePayment({ db, env: off, actor: customer(), invoiceId: inv.id });
  assert.equal(view.online_payment.available, false);
  assert.equal(await observations(), before, 'PAY-05 off: nothing called Paynow');
});

test('operations: Paynow availability is the operator\'s switch; a disconnected garage offers no Paynow', { skip }, async () => {
  const inv = await invoice(12);
  await rejectsWith(M.setPaynowAvailability({ db, env, actor: garageA(), body: { available: false, note: 'Garage cannot switch it off.' } }),
    'PAY05_AVAILABILITY_AUTHORITY_REFUSED');
  await M.setPaynowAvailability({ db, env, actor: operator(), body: { available: false, note: 'Paynow incident: paused.' } });
  assert.equal((await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id })).online_payment.reason, 'provider_not_enabled');
  await rejectsWith(start(inv, { method: 'web' }, `p5s-off-${run}-1`), 'PAY04_GATEWAY_NOT_PERMITTED');
  await M.setPaynowAvailability({ db, env, actor: operator(), body: { available: true, note: 'Paynow incident over: resumed.' } });
  const errs = await M.listPaynowProviderErrors({ db, env });
  assert.ok(errs.errors.length >= 1 && errs.errors.every((e) => !JSON.stringify(e).includes(world.usd.key)), 'provider errors never carry a key');
  const merchants = await M.listPaynowMerchants({ db, env });
  assert.ok(merchants.merchants.some((m) => m.id === world.merchant && m.status === 'verified'));
  assert.ok(!JSON.stringify(merchants).includes(world.usd.key), 'the operator never sees a key either');
  await M.disconnectGaragePaynow({ db, env, actor: garageA(), body: { reason: 'Moving to a new Paynow account.' } });
  assert.equal((await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id })).online_payment.reason, 'garage_not_connected');
});
