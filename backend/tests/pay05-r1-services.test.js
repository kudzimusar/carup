/**
 * CARUP-PAY-05-R1 — the corrected Paynow services against REAL PostgreSQL (PAY-04 + PAY-05 + R1 migrations) and the local
 * Paynow protocol simulator over REAL HTTP. Status updates enter the real webhook service, as the resulturl route does.
 *
 * Requires PAY05_TEST_PGURL (or PAY04_TEST_PGURL) naming a DISPOSABLE pay01c_sandbox_ci database prepared by
 * scripts/ci/pay05-postgres-certification.sh. Skipped with a reason otherwise (CI treats a skip as a failure).
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
const A = await import('../services/payment/pay05PaynowAdapter.js');
const { startPaynowSimulatorServer } = await import('../../scripts/uat/pay05-paynow-simulator-server.mjs');
const { createPgSupabase } = await import('./helpers/pgSupabaseShim.js');

const run = crypto.randomBytes(4).toString('hex');
const u = (name) => `p5r_${name}_${run}`;
const ids = { admin: u('admin'), mech: u('mech'), adminB: u('adminb'), mechB: u('mechb'), cust: u('cust'), op: u('op') };
const deps = { emitDomainEvent: async () => ({ id: crypto.randomUUID() }) };
let db;
let sim;
let env;
const world = {};
const deliveries = [];

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

async function invoice(amount, { currency = 'USD' } = {}) {
  const tenant = world.g; const branch = world.branch; const admin = ids.admin; const mech = ids.mech;
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
const money = (invoiceId) => S.invoiceMoney(db, invoiceId);
const txOf = (collectionId) => one('SELECT * FROM pay05_paynow_transactions WHERE collection_id = $1', [collectionId]);
const guidOf = async (collectionId) => new URL((await txOf(collectionId)).poll_url).searchParams.get('guid');
const start = (inv, body, key) => S.startGarageInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id, body, idempotencyKey: key });
const count = async (sql, params) => Number((await one(`SELECT count(*)::int AS n FROM ${sql}`, params)).n);
const observations = (id) => count('pay05_paynow_observations WHERE collection_id = $1', [id]);
const liveReceipts = (id) => count("pay04_garage_provider_receipts WHERE collection_id = $1 AND status = 'issued'", [id]);
const allocations = (id) => count('pay04_garage_payment_allocations WHERE collection_id = $1', [id]);
const openReview = (id, type) => count("pay04_garage_payment_discrepancies WHERE collection_id = $1 AND discrepancy_type = $2 AND status = 'open'", [id, type]);
const statusMessage = (guid) => sim.simulator.statusMessage(sim.simulator.transactions.get(guid));
const webhook = (id, rawBody, extra = {}) => P.processPaynowStatusUpdate({ db, env, collectionId: id, rawBody, deps, ...extra });
/** A transport that counts every call the webhook makes to Paynow. */
const counting = () => { const calls = []; const t = async (url, opts) => { calls.push(url); return A.httpTransport()(url, opts); }; t.calls = calls; return t; };
/** What an operator supplies at verification: each integration's own reviewed settlement currency. */
const reviewBody = async (merchantId, note) => {
  const rows = (await q('SELECT id, currency FROM pay05_merchant_integrations WHERE merchant_account_id = $1', [merchantId])).rows;
  return { legal_identity_reviewed: true, settlement_account_reviewed: true, currency_configuration_reviewed: true, note,
    currency_evidence: Object.fromEntries(rows.map((r) => [r.id, { settlement_currency: r.currency, reference: 'Simulated Paynow merchant settlement page reviewed' }])) };
};

before(async () => {
  if (skip) return;
  db = createPgSupabase(PGURL);
  sim = await startPaynowSimulatorServer({
    deliver: async (url, body) => {
      const m = /\/api\/pay05\/paynow\/webhook\/([0-9a-f-]{36})$/.exec(new URL(url).pathname);
      if (!m) return 404;
      try {
        await P.processPaynowStatusUpdate({ db, env, collectionId: m[1], rawBody: body, deps });
        deliveries.push({ id: m[1], status: 200 });
        return 200;
      } catch (err) {
        deliveries.push({ id: m[1], status: err?.status || 500, code: err?.code });
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
    await q("INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,$3,'2026-01-01')", [id, `${id}@example.invalid`, id === ids.op ? 'admin' : 'owner']);
  }
  world.vin = `P5R${run.toUpperCase()}000000`.slice(0, 17);
  await q("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ($1,'Toyota','Hilux',2020,60000,1000,$2)", [world.vin, ids.cust]);
  Object.assign(world, await seedGarage('p5r', ids.admin, ids.mech));
  const b = await seedGarage('p5q', ids.adminB, ids.mechB);
  world.gB = b.g;
  await q('UPDATE pay05_runtime_guard SET paynow_simulator_enabled = true, paynow_available = true');
  world.usd = sim.simulator.issueIntegration({ currency: 'USD', methods: ['web', 'ecocash', 'innbucks', 'omari'], name: 'P5R Motors USD' });
  const connected = await M.connectGaragePaynow({ db, env, actor: garageA(), body: { ...profile('P5R Motors (Pvt) Ltd'), integrations: [
    { currency: 'USD', integration_id: world.usd.integrationId, integration_key: world.usd.key, methods: world.usd.methods }] } });
  world.merchant = connected.merchant.id;
  await M.verifyPaynowMerchant({ db, env, actor: operator(), merchantAccountId: world.merchant, body: await reviewBody(world.merchant, 'Reviewed for the R1 service tests.') });
});

after(async () => {
  if (skip) return;
  await q('UPDATE pay05_runtime_guard SET paynow_simulator_enabled = false');
  await sim.close();
  await db.end();
});

// ────────────────────────────── status-update identity (ICR-M2, S1) ──────────────────────────────

test('ICR-M2: Paid, Disputed, Paid, Disputed through signed updates: the second dispute de-counts; none is a resend', { skip }, async () => {
  const inv = await invoice(50);
  const s = await start(inv, { method: 'ecocash', phone: '0779000201' }, `r1-m2-${run}-1`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid');
  assert.equal((await money(inv.id)).provider_paid, '50.00');
  await sim.simulator.setStatus(guid, 'Disputed');
  assert.equal((await money(inv.id)).provider_paid, '0.00');
  await sim.simulator.setStatus(guid, 'Paid');
  assert.equal((await money(inv.id)).provider_paid, '50.00', 'the dispute is over');
  await sim.simulator.setStatus(guid, 'Disputed');
  assert.equal((await money(inv.id)).provider_paid, '0.00', 'the second dispute is not swallowed: money must not stay counted while Paynow says Disputed');
  assert.equal(await openReview(s.collection_id, 'provider_disputed'), 1);
  await sim.simulator.setStatus(guid, 'Paid');
  assert.equal((await money(inv.id)).provider_paid, '50.00', 'the second "Paid again" is not swallowed either');
  assert.equal(await liveReceipts(s.collection_id), 1, 'one live receipt');
  const events = (await q("SELECT event_id FROM pay05_paynow_observations WHERE collection_id = $1 AND via = 'status_update' ORDER BY seq", [s.collection_id])).rows.map((r) => r.event_id);
  assert.equal(events.length, 5);
  assert.equal(new Set(events).size, 5, 'each is its own event');
});

test('ICR-M2 02b: a dispute learned by poll, then Paid, twice: the second Paid still counts', { skip }, async () => {
  const inv = await invoice(30);
  const s = await start(inv, { method: 'ecocash', phone: '0779000202' }, `r1-m2-${run}-2`);
  const guid = await guidOf(s.collection_id);
  for (let i = 0; i < 2; i += 1) {
    await sim.simulator.setStatus(guid, 'Paid');
    assert.equal((await money(inv.id)).provider_paid, '30.00', `Paid ${i + 1} counts`);
    await sim.simulator.setStatus(guid, 'Disputed', { notify: false });
    await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
    assert.equal((await money(inv.id)).provider_paid, '0.00', `dispute ${i + 1} holds the money`);
  }
  await sim.simulator.setStatus(guid, 'Paid');
  assert.equal((await money(inv.id)).provider_paid, '30.00', 'a third Paid counts');
});

test('ICR-S1: trivially different variants of one signed update are one event: no read, no row, no money', { skip }, async () => {
  const inv = await invoice(60);
  const s = await start(inv, { method: 'ecocash', phone: '0779000203' }, `r1-s1-${run}-1`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid');
  const message = statusMessage(guid);
  const rows = await observations(s.collection_id);
  const variants = [
    message,
    `${message}&x=`,                                              // an extra empty field
    message.replace('status=Paid', 'status=Paid%20'),             // padding the hash ignores
    message.replace('status=Paid', 'status=%20Paid'),
    message.replace(/hash=([0-9A-F]+)/, (_, h) => `hash=${h.toLowerCase()}`), // the hash in lower case
    `extra=&${message}`,
  ];
  const t = counting();
  for (const v of variants) {
    const out = await webhook(s.collection_id, v, { transport: t });
    assert.equal(out.duplicate_event, true, `a variant is a duplicate: ${v.slice(0, 40)}`);
  }
  assert.equal(t.calls.length, 0, 'no variant makes CarUp read Paynow');
  assert.equal(await observations(s.collection_id), rows, 'no variant writes a row');
  assert.equal(await liveReceipts(s.collection_id), 1);
  assert.equal(await allocations(s.collection_id), 1);
});

test('non-2xx when the confirming poll did not confirm: Paynow resends and the money then applies', { skip }, async () => {
  const inv = await invoice(20);
  const s = await start(inv, { method: 'ecocash', phone: '0779000204' }, `r1-unconf-${run}`);
  const guid = await guidOf(s.collection_id);
  // Paynow's update says Paid, but its own poll still lags at Sent
  await sim.simulator.setStatus(guid, 'Paid', { notify: false });
  const paid = statusMessage(guid);
  await sim.simulator.setStatus(guid, 'Sent', { notify: false });
  const err = await rejectsWith(webhook(s.collection_id, paid), 'PAY05_STATUS_UPDATE_UNCONFIRMED');
  assert.ok(err.status >= 500, 'a retryable answer, so Paynow resends');
  assert.equal((await money(inv.id)).provider_paid, '0.00');
  await sim.simulator.setStatus(guid, 'Paid', { notify: false });
  const out = await webhook(s.collection_id, paid);
  assert.equal(out.applied, true);
  assert.equal((await money(inv.id)).provider_paid, '20.00');
  // a poll further along than the update confirms it
  const inv2 = await invoice(21);
  const s2 = await start(inv2, { method: 'ecocash', phone: '0779000205' }, `r1-unconf2-${run}`);
  const guid2 = await guidOf(s2.collection_id);
  await sim.simulator.setStatus(guid2, 'Delivered', { notify: false });
  const delivered = statusMessage(guid2);
  await sim.simulator.setStatus(guid2, 'Paid', { notify: false });
  assert.equal((await webhook(s2.collection_id, delivered)).applied, true);
  assert.equal((await money(inv2.id)).provider_paid, '21.00');
});

test('non-2xx when the confirming poll was superseded by a newer read', { skip }, async () => {
  const inv = await invoice(22);
  const s = await start(inv, { method: 'ecocash', phone: '0779000206' }, `r1-sup-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Sent', { notify: false });
  const sent = statusMessage(guid);
  let raced = false;
  // while the update's poll is in flight, a newer read is taken and evaluated first
  const slow = async (url, opts) => {
    const reply = await A.httpTransport()(url, opts);
    if (!raced) {
      raced = true;
      await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
    }
    return reply;
  };
  await rejectsWith(webhook(s.collection_id, sent, { transport: slow }), 'PAY05_STATUS_UPDATE_UNCONFIRMED');
  // Paynow's resend of that same message reads again: the superseded read did not use the message up
  const t = counting();
  const out = await webhook(s.collection_id, sent, { transport: t });
  assert.equal(t.calls.length, 1, 'a resend after an unevaluated read takes a new read');
  assert.equal(out.duplicate_event, false);
});

test('ICR-S1: a per-collection budget bounds the reads status updates can trigger; other collections and polls are unaffected', { skip }, async () => {
  const inv = await invoice(23);
  const s = await start(inv, { method: 'ecocash', phone: '0779000207' }, `r1-budget-${run}`);
  const guid = await guidOf(s.collection_id);
  // a captured Disputed message replayed while Paynow says Paid: it differs from the held status, so each costs a read, up to the budget
  await sim.simulator.setStatus(guid, 'Disputed', { notify: false });
  const stale = statusMessage(guid);
  await sim.simulator.setStatus(guid, 'Paid');
  const before2 = (await txOf(s.collection_id)).status_update_reads_in_window;
  const t = counting();
  const outcomes = [];
  for (let i = 0; i < 16; i += 1) {
    try { await webhook(s.collection_id, stale, { transport: t }); outcomes.push('ok'); } catch (err) { outcomes.push(err.code); }
  }
  assert.ok(outcomes.includes('PAY05_STATUS_UPDATE_READS_UNAVAILABLE'), `over budget: ${outcomes.join(',')}`);
  assert.equal(t.calls.length, 12 - before2, 'no read past the budget');
  assert.equal((await money(inv.id)).provider_paid, '23.00', 'the money is untouched');
  // an ordinary read still works
  const out = await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
  assert.equal(out.collection.state, 'confirmed');
});

test('concurrency: the same signed update delivered five times at once applies once: one allocation, one receipt', { skip }, async () => {
  const inv = await invoice(24);
  const s = await start(inv, { method: 'ecocash', phone: '0779000208' }, `r1-conc-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid', { notify: false });
  const paid = statusMessage(guid);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => webhook(s.collection_id, paid)));
  assert.ok(results.some((r) => r.status === 'fulfilled'), 'at least one is answered 2xx');
  assert.equal(await allocations(s.collection_id), 1, 'one allocation');
  assert.equal(await liveReceipts(s.collection_id), 1, 'one receipt');
  assert.equal((await money(inv.id)).provider_paid, '24.00');
});

test('concurrency: a settlement racing a Paynow Paid never leaves money counted or a live receipt', { skip }, async () => {
  for (let i = 0; i < 4; i += 1) {
    const inv = await invoice(25);
    const s = await start(inv, { method: 'ecocash', phone: `07790003${String(i).padStart(2, '0')}` }, `r1-race-${run}-${i}`);
    const guid = await guidOf(s.collection_id);
    await sim.simulator.setStatus(guid, 'Paid', { amount: '24.00' });
    assert.equal(await openReview(s.collection_id, 'amount_mismatch'), 1);
    const disc = (await one("SELECT id FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND discrepancy_type = 'amount_mismatch'", [s.collection_id])).id;
    const c = await one('SELECT * FROM pay04_garage_collections WHERE id = $1', [s.collection_id]);
    await Promise.allSettled([
      q("SELECT pay04_resolve_garage_payment_discrepancy($1,'settled_off_platform',$2,'admin','Settled with the customer outside CarUp.')", [disc, ids.op]),
      q("SELECT pay05_apply_paynow_observation($1,'poll',NULL,'paid','Paid',$2,$3,'9510',$4,NULL,pay05_begin_paynow_read($1))", [s.collection_id, c.amount_minor, c.payment_reference, c.provider_payment_id]),
    ]);
    const counted = (await one('SELECT pay04_collection_allocated($1) AS n', [s.collection_id])).n;
    assert.equal(Number(counted), 0, 'settled money never counts, whichever transaction ran first');
    assert.equal(await liveReceipts(s.collection_id), 0);
  }
});

test('concurrency, reordered reads: Paid and Disputed racing on tickets leave the count and the latest word in agreement', { skip }, async () => {
  for (let i = 0; i < 6; i += 1) {
    const inv = await invoice(34);
    const s = await start(inv, { method: 'ecocash', phone: `07790004${String(i).padStart(2, '0')}` }, `r1-order-${run}-${i}`);
    const c = await one('SELECT * FROM pay04_garage_collections WHERE id = $1', [s.collection_id]);
    const read = (word, ticket) => q("SELECT pay05_apply_paynow_observation($1,'poll',NULL,$2,$3,$4,$5,'9510',$6,NULL,$7)", [c.id, word, word, c.amount_minor, c.payment_reference, c.provider_payment_id, ticket]);
    const [t1, t2] = [(await one('SELECT pay05_begin_paynow_read($1) AS t', [c.id])).t, (await one('SELECT pay05_begin_paynow_read($1) AS t', [c.id])).t];
    // tickets in one order, arrivals in whichever order the connections reach the lock
    const racers = i % 2 ? [read('paid', t1), read('disputed', t2)] : [read('disputed', t2), read('paid', t1)];
    await Promise.all(racers);
    const row = await one('SELECT pay04_collection_allocated($1) AS counted, pay05_latest_provider_status($1) AS latest', [c.id]);
    assert.ok(Number(row.counted) === 0 || row.latest === 'paid', `counted ${row.counted} while the latest word is ${row.latest}`);
    assert.equal(await liveReceipts(c.id), Number(row.counted) > 0 ? 1 : 0, 'a receipt only for money that counts');
    assert.equal(await openReview(c.id, 'provider_disputed'), 1, 'the dispute is never lost, whichever read arrived first');
    assert.equal(Number(row.counted), 0, 'and it holds the money');
  }
});

test('concurrency, transaction replay: the same closure sent five times at once closes once and counts nothing', { skip }, async () => {
  const inv = await invoice(35);
  const s = await start(inv, { method: 'ecocash', phone: '0779000217' }, `r1-replay-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid');
  await sim.simulator.setStatus(guid, 'Reversed');
  const disc = (await one("SELECT id FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND status = 'open'", [s.collection_id])).id;
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => q("SELECT pay04_resolve_garage_payment_discrepancy($1,'settled_off_platform',$2,'admin','Settled with the customer outside CarUp.')", [disc, ids.op])));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'one closes it');
  assert.equal(await allocations(s.collection_id), 2, 'the allocation and its one reversal');
  assert.equal(await count('pay04_garage_provider_receipts WHERE collection_id = $1', [s.collection_id]), 1, 'no second receipt');
  assert.equal(await liveReceipts(s.collection_id), 0);
});

// ────────────────────────────── settled and released stay visible and re-readable (ICR-M3) ──────────────────────────────

test('ICR-M3: settled and released requests stay on the operator list and are re-read, at a slow pace', { skip }, async () => {
  const inv = await invoice(26);
  const s = await start(inv, { method: 'ecocash', phone: '0779000209' }, `r1-vis-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid', { amount: '25.00' });
  await q("SELECT pay04_resolve_garage_payment_discrepancy((SELECT id FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND status = 'open'),'settled_off_platform',$2,'admin','Settled with the customer outside CarUp.')", [s.collection_id, ids.op]);
  const listed = (await P.listHeldPaynowCollections({ db, env })).held.find((h) => h.collection_id === s.collection_id);
  assert.ok(listed, 'a settled request stays visible to the operator');
  assert.equal(listed.settled, true);
  assert.equal(listed.can_release, false);
  // the customer's views re-read it at a slow pace, so late money is found even if Paynow's own update was lost
  await sim.simulator.setStatus(guid, 'Paid', { notify: false, amount: '26.00' });
  await q("SET session_replication_role = replica");
  await q("UPDATE pay05_paynow_observations SET observed_at = clock_timestamp() - interval '2 hours' WHERE collection_id = $1", [s.collection_id]);
  await q("SET session_replication_role = origin");
  const c = await one('SELECT * FROM pay04_garage_collections WHERE id = $1', [s.collection_id]);
  await P.refreshPaynowCollection({ db, env, collection: c });
  assert.equal(await openReview(s.collection_id, 'provider_paid_after_close'), 1, 'the re-read found new money: a review');
  assert.equal(Number((await one('SELECT pay04_collection_allocated($1) AS n', [s.collection_id])).n), 0, 'never allocated');
  // and not on every view: five minutes after a read, a request still waiting would be read again, a settled one is not
  await q("SET session_replication_role = replica");
  await q("UPDATE pay05_paynow_observations SET observed_at = clock_timestamp() - interval '5 minutes' WHERE collection_id = $1", [s.collection_id]);
  await q("SET session_replication_role = origin");
  const t = counting();
  await P.refreshPaynowCollection({ db, env, transport: t, collection: c });
  assert.equal(t.calls.length, 0, 'no read within the slow window');
});

test('ICR-M3: looking at an invoice re-reads a request settled outside CarUp, whatever its canonical status', { skip }, async () => {
  const inv = await invoice(33);
  const s = await start(inv, { method: 'ecocash', phone: '0779000216' }, `r1-vis2-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid');
  await sim.simulator.setStatus(guid, 'Reversed');
  await q("SELECT pay04_resolve_garage_payment_discrepancy((SELECT id FROM pay04_garage_payment_discrepancies WHERE collection_id = $1 AND status = 'open'),'settled_off_platform',$2,'admin','Settled with the customer outside CarUp.')", [s.collection_id, ids.op]);
  assert.equal((await one('SELECT p.status FROM pay04_garage_collections c JOIN payment_transactions p ON p.reference = c.payment_reference WHERE c.id = $1', [s.collection_id])).status, 'paid');
  await sim.simulator.setStatus(guid, 'Paid', { notify: false });
  await q("SET session_replication_role = replica");
  await q("UPDATE pay05_paynow_observations SET observed_at = clock_timestamp() - interval '2 hours' WHERE collection_id = $1", [s.collection_id]);
  await q("SET session_replication_role = origin");
  await S.refreshClosingCollections({ db, env, invoiceId: inv.id });
  assert.equal(await openReview(s.collection_id, 'provider_paid_after_close'), 1, 'the view found the new money');
});

test('ICR Info: a garage does not read CarUp operators\' identities or notes about its own merchant', { skip }, async () => {
  const view = await M.getGaragePaynowConnection({ db, env, actor: garageA() });
  assert.ok(view.merchant.integrations.length);
  for (const i of view.merchant.integrations) assert.equal(i.verified_by, null);
  const wire = JSON.stringify(view);
  assert.ok(!wire.includes(ids.op), 'no operator id');
  assert.ok(!wire.includes('Reviewed for the R1 service tests.'), 'no operator note');
  const operatorView = (await M.listPaynowMerchants({ db, env })).merchants.find((m) => m.id === world.merchant);
  assert.equal(operatorView.integrations[0].verified_by, ids.op, 'operators still see who did it');
  assert.equal(operatorView.integrations[0].currency_evidence.settlement_currency, operatorView.integrations[0].currency);
});

// ────────────────────────────── duplicate-payment prompts ──────────────────────────────

test('pay again: an earlier released request is re-read first; money at Paynow on it refuses a new request', { skip }, async () => {
  const inv = await invoice(27);
  const s = await start(inv, { method: 'ecocash', phone: '0779000210' }, `r1-again-${run}-1`);
  const guid = await guidOf(s.collection_id);
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
  await q("SET session_replication_role = replica");
  await q("UPDATE pay04_garage_collections SET initiated_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute' WHERE id = $1", [s.collection_id]);
  await q("SET session_replication_role = origin");
  await P.releasePaynowHold({ db, env, actor: operator(), collectionId: s.collection_id, body: { reason: 'Unpaid request past its time.' } });
  // Paynow has the money in escrow but its update was lost: the room looks free
  await sim.simulator.setStatus(guid, 'Delivered', { notify: false });
  await q("SET session_replication_role = replica");
  await q("UPDATE pay05_paynow_observations SET observed_at = clock_timestamp() - interval '5 minutes' WHERE collection_id = $1", [s.collection_id]);
  await q("SET session_replication_role = origin");
  await rejectsWith(start(inv, { method: 'ecocash', phone: '0779000211' }, `r1-again-${run}-2`), 'PAY05_EARLIER_REQUEST_UNRESOLVED');
  assert.equal(await count("pay04_garage_collections WHERE invoice_id = $1", [inv.id]), 1, 'no second request was created');
  const seen = await txOf(s.collection_id);
  assert.equal(seen.provider_status, 'delivered', 'the fresh read recorded what Paynow now says');
  // Paynow cancels it: now a new request may start
  await sim.simulator.setStatus(guid, 'Cancelled');
  await q("SELECT pay04_resolve_garage_payment_discrepancy(d.id,'acknowledged',$2,'admin','Paynow reports the held money returned.') FROM pay04_garage_payment_discrepancies d WHERE d.collection_id = $1 AND d.status = 'open'", [s.collection_id, ids.op]);
  const next = await start(inv, { method: 'ecocash', phone: '0779000211' }, `r1-again-${run}-3`);
  assert.ok(next.collection_id);
  assert.notEqual(next.collection_id, s.collection_id);
});

// ────────────────────────────── onboarding (ICR-S2) ──────────────────────────────

test('ICR-S2: an integration ID is reserved only with its key proved at connect; the refusal is generic; failures cool down', { skip }, async () => {
  const real = sim.simulator.issueIntegration({ currency: 'USD', methods: ['web'], name: 'The real merchant' });
  const attempt = (key) => M.connectGaragePaynow({ db, env, actor: garageB(), body: { ...profile('P5Q Auto Ltd'), integrations: [
    { currency: 'USD', integration_id: real.integrationId, integration_key: key, methods: ['web'] }] } });
  const wrong = await rejectsWith(attempt(crypto.randomUUID()), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  assert.equal(await count('pay05_merchant_integrations WHERE integration_id = $1', [real.integrationId]), 0, 'nothing reserved');
  assert.equal(await count('pay04_garage_merchant_accounts WHERE tenant_id = $1', [world.gB]), 0, 'no merchant left behind');
  // the ID of another live merchant, with the right key, reads exactly the same
  const live = await rejectsWith(M.connectGaragePaynow({ db, env, actor: garageB(), body: { ...profile('P5Q Auto Ltd'), integrations: [
    { currency: 'USD', integration_id: world.usd.integrationId, integration_key: world.usd.key, methods: ['web'] }] } }), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  assert.equal(wrong.status, live.status, 'the same answer: an attacker cannot tell which');
  assert.deepEqual(wrong.details, live.details);
  // repeated failed proofs cool down without calling Paynow
  for (let i = 0; i < 6; i += 1) await rejectsWith(attempt(crypto.randomUUID()), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  const t = counting();
  await rejectsWith(M.connectGaragePaynow({ db, env, transport: t, actor: garageB(), body: { ...profile('P5Q Auto Ltd'), integrations: [
    { currency: 'USD', integration_id: real.integrationId, integration_key: real.key, methods: ['web'] }] } }), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  assert.equal(t.calls.length, 0, 'cooling down: no probe at all');
});

test('ICR-S2: Paynow unreachable at connect is not a refusal of the merchant, and reserves nothing', { skip }, async () => {
  const real = sim.simulator.issueIntegration({ currency: 'USD', methods: ['web'], name: 'Another merchant' });
  const down = async () => { throw new Error('connection refused'); };
  await q('DELETE FROM pay05_provider_errors WHERE false');
  const garage = await seedGarage('p5u', u('adminc'), u('mechc')).catch(async () => null);
  assert.equal(garage, null, 'the seed needs users first');
  await q("INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,'owner','2026-01-01'),($3,$3,$4,'owner','2026-01-01')",
    [u('adminc'), `${u('adminc')}@example.invalid`, u('mechc'), `${u('mechc')}@example.invalid`]);
  const g3 = await seedGarage('p5u', u('adminc'), u('mechc'));
  await rejectsWith(M.connectGaragePaynow({ db, env, transport: down, actor: { id: u('adminc'), tenantId: g3.g, platformRole: 'owner' }, body: { ...profile('P5U Auto Ltd'), integrations: [
    { currency: 'USD', integration_id: real.integrationId, integration_key: real.key, methods: ['web'] }] } }), 'PAY05_CONNECT_PROBE_UNAVAILABLE');
  assert.equal(await count('pay05_merchant_integrations WHERE integration_id = $1', [real.integrationId]), 0);
});

// ────────────────────────────── the resulturl's answers (ICR-S6, P5) ──────────────────────────────

test('ICR-S6: a key that cannot be opened answers exactly as a missing collection does', { skip }, async () => {
  const inv = await invoice(28);
  const s = await start(inv, { method: 'ecocash', phone: '0779000212' }, `r1-s6-${run}`);
  const guid = await guidOf(s.collection_id);
  const message = statusMessage(guid);
  const rotated = { ...env, CARUP_PAY05_CREDENTIAL_KEK: crypto.randomBytes(32).toString('base64') };
  const existing = await P.processPaynowStatusUpdate({ db, env: rotated, collectionId: s.collection_id, rawBody: message, deps }).catch((e) => e);
  const missing = await P.processPaynowStatusUpdate({ db, env: rotated, collectionId: crypto.randomUUID(), rawBody: message, deps }).catch((e) => e);
  assert.ok(existing.status < 500 && missing.status < 500, `no retry-class answer reveals existence (${existing.status}, ${missing.status})`);
});

test('ICR-P5: a poll URL differing only in case or encoding still binds; another poll URL does not', { skip }, async () => {
  const inv = await invoice(29);
  const s = await start(inv, { method: 'ecocash', phone: '0779000213' }, `r1-p5-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid', { notify: false });
  const key = world.usd.key;
  const { signPairs, encodeForm, parseForm } = await import('../services/payment/pay05PaynowProtocol.js');
  const pairs = parseForm(statusMessage(guid)).filter(([k]) => k !== 'hash');
  const withPoll = (url) => encodeForm(signPairs(pairs.map(([k, v]) => [k, k === 'pollurl' ? url : v]), key));
  const poll = (await txOf(s.collection_id)).poll_url;
  await rejectsWith(webhook(s.collection_id, withPoll(poll.replace(guid, crypto.randomUUID()))), 'PAY05_PROVIDER_BINDING_MISMATCH');
  const shifted = poll.replace('/Interface/CheckPayment/', '/interface/checkpayment/');
  assert.notEqual(shifted, poll);
  const out = await webhook(s.collection_id, withPoll(shifted));
  assert.equal(out.applied, true, 'a case difference in the path is the same poll URL');
  assert.equal((await money(inv.id)).provider_paid, '29.00');
});

// ────────────────────────────── currency authority (ICR-P1) ──────────────────────────────

test('ICR-P1: without its reviewed settlement currency an integration is not offered and collects nothing', { skip }, async () => {
  await rejectsWith(M.verifyPaynowMerchant({ db, env, actor: operator(), merchantAccountId: world.merchant,
    body: { legal_identity_reviewed: true, settlement_account_reviewed: true, currency_configuration_reviewed: true, note: 'Already verified.' } }), 'PAY05_MERCHANT_NOT_PENDING');
  const row = await one("SELECT * FROM pay05_merchant_integrations WHERE merchant_account_id = $1 AND currency = 'USD'", [world.merchant]);
  assert.equal(row.currency_evidence.settlement_currency, 'USD');
  assert.equal(row.currency_evidence.reviewed_by, ids.op);
  await q("SET session_replication_role = replica");
  await q('UPDATE pay05_merchant_integrations SET currency_evidence = NULL WHERE id = $1', [row.id]);
  await q("SET session_replication_role = origin");
  try {
    assert.equal(await P.verifiedIntegration(db, world.merchant, 'USD'), null, 'not an integration CarUp may use');
    const inv = await invoice(31);
    const options = await S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id });
    assert.equal(options.online_payment.available, false, 'not offered');
  } finally {
    await q("SET session_replication_role = replica");
    await q('UPDATE pay05_merchant_integrations SET currency_evidence = $2::jsonb WHERE id = $1', [row.id, JSON.stringify(row.currency_evidence)]);
    await q("SET session_replication_role = origin");
  }
});

// ────────────────────────────── what real Paynow may do that the simulator did not (ICR-P3, P4) ──────────────────────────────

test('ICR-P3: if Paynow reports an amount including customer fees, it stays an amount review and counts nothing', { skip }, async () => {
  const inv = await invoice(100);
  const s = await start(inv, { method: 'ecocash', phone: '0779000214' }, `r1-p3-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Paid', { amount: '103.50' });
  assert.equal(await openReview(s.collection_id, 'amount_mismatch'), 1);
  assert.equal((await money(inv.id)).provider_paid, '0.00');
  assert.equal(await liveReceipts(s.collection_id), 0);
  const out = await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
  assert.equal(out.collection.state, 'under_review');
});

test('ICR-P4: an O\'mari request recovered by trace has no address for the code: no form, words instead, and the code is refused if sent', { skip }, async () => {
  const inv = await invoice(32);
  sim.simulator.inject('initiate', { kind: 'drop_response' });
  const s = await start(inv, { method: 'omari', phone: '0719000215' }, `r1-p4-${run}`);
  const tx = await txOf(s.collection_id);
  assert.equal(tx.initiation_state, 'attached', 'recovered by trace');
  assert.equal(tx.remote_otp_url, null);
  const out = await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
  assert.equal(out.paynow.needs_otp, false);
  assert.equal(out.paynow.otp_unavailable, true);
  await rejectsWith(P.submitPaynowOtp({ db, env, actor: customer(), collectionId: s.collection_id, body: { otp: '123456' }, deps }), 'PAY05_OTP_NOT_EXPECTED');
});

// ────────────────────────────── the invariant across this whole file ──────────────────────────────

test('every Paynow collection this file made: counted money has Paynow\'s applied Paid as its latest word and exactly one live receipt', { skip }, async () => {
  const bad = (await q(`SELECT c.id FROM pay04_garage_collections c
     WHERE c.tenant_id = $1 AND c.gateway = 'paynow_zimbabwe' AND pay04_collection_allocated(c.id) > 0
       AND (pay05_latest_provider_status(c.id) IS DISTINCT FROM 'paid'
            OR (SELECT count(*) FROM pay04_garage_provider_receipts r WHERE r.collection_id = c.id AND r.status = 'issued') <> 1)`, [world.g])).rows;
  assert.deepEqual(bad, []);
});
