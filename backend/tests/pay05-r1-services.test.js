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

const customerView = (inv) => S.getCustomerInvoicePayment({ db, env, actor: customer(), invoiceId: inv.id });
const rowOf = (view, id) => view.provider_payments.find((p) => p.id === id);
const pastItsTime = async (id) => {
  await q('SET session_replication_role = replica');
  await q("UPDATE pay04_garage_collections SET initiated_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute' WHERE id = $1", [id]);
  await q('SET session_replication_role = origin');
};
const ageReads = async (id, minutes = 20) => {
  await q('SET session_replication_role = replica');
  await q('UPDATE pay05_paynow_observations SET observed_at = observed_at - make_interval(mins => $2) WHERE collection_id = $1', [id, minutes]);
  await q('UPDATE pay05_paynow_transactions SET last_read_attempt_at = last_read_attempt_at - make_interval(mins => $2) WHERE collection_id = $1', [id, minutes]);
  await q('SET session_replication_role = origin');
};
const resolve = (id, type, resolution) => q("SELECT pay04_resolve_garage_payment_discrepancy(d.id, $3, $4, 'admin', 'The operator reviewed the Paynow merchant records.') FROM pay04_garage_payment_discrepancies d WHERE d.collection_id = $1 AND d.discrepancy_type = $2 AND d.status = 'open'", [id, type, resolution, ids.op]);
const release = (id) => P.releasePaynowHold({ db, env, actor: operator(), collectionId: id, body: { reason: 'Past its time, and Paynow shows it unpaid.' } });
const answer = (id, body, extra) => webhook(id, body, extra).then((out) => ({ ok: true, out }), (err) => ({ ok: false, code: err?.code, status: err?.status }));
const down = async () => { throw new Error('ECONNREFUSED'); };

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

test('ICR-S1: a budget per message bounds the reads status updates can trigger; other messages and polls are unaffected', { skip }, async () => {
  const inv = await invoice(23);
  const s = await start(inv, { method: 'ecocash', phone: '0779000207' }, `r1-budget-${run}`);
  const guid = await guidOf(s.collection_id);
  // a captured Disputed message replayed while Paynow says Paid: it differs from the held status, so each costs a read, up to the budget
  await sim.simulator.setStatus(guid, 'Disputed', { notify: false });
  const stale = statusMessage(guid);
  await sim.simulator.setStatus(guid, 'Paid');
  const t = counting();
  const outcomes = [];
  for (let i = 0; i < 16; i += 1) {
    try { await webhook(s.collection_id, stale, { transport: t }); outcomes.push('ok'); } catch (err) { outcomes.push(err.code); }
  }
  assert.ok(outcomes.includes('PAY05_STATUS_UPDATE_READS_UNAVAILABLE'), `over budget: ${outcomes.join(',')}`);
  assert.equal(t.calls.length, 12, 'no read past this message\'s budget');
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
  await q("UPDATE pay05_paynow_transactions SET last_read_attempt_at = clock_timestamp() - interval '2 hours' WHERE collection_id = $1", [s.collection_id]);
  await q("SET session_replication_role = origin");
  const c = await one('SELECT * FROM pay04_garage_collections WHERE id = $1', [s.collection_id]);
  await P.refreshPaynowCollection({ db, env, collection: c });
  assert.equal(await openReview(s.collection_id, 'provider_paid_after_close'), 1, 'the re-read found new money: a review');
  assert.equal(Number((await one('SELECT pay04_collection_allocated($1) AS n', [s.collection_id])).n), 0, 'never allocated');
  // and not on every view: five minutes after a read, a request still waiting would be read again, a settled one is not
  await q("SET session_replication_role = replica");
  await q("UPDATE pay05_paynow_observations SET observed_at = clock_timestamp() - interval '5 minutes' WHERE collection_id = $1", [s.collection_id]);
  await q("UPDATE pay05_paynow_transactions SET last_read_attempt_at = clock_timestamp() - interval '5 minutes' WHERE collection_id = $1", [s.collection_id]);
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
  await q("UPDATE pay05_paynow_transactions SET last_read_attempt_at = clock_timestamp() - interval '2 hours' WHERE collection_id = $1", [s.collection_id]);
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
  await q("UPDATE pay05_paynow_transactions SET last_read_attempt_at = clock_timestamp() - interval '5 minutes' WHERE collection_id = $1", [s.collection_id]);
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

// ────────────────────────────── the pre-final adversarial review (PFR) ──────────────────────────────

test('PFR-H2: a reviewed Cancelled after money says what is true, offers no way to complete it, and an operator can release it', { skip }, async () => {
  const inv = await invoice(31);
  const s = await start(inv, { method: 'ecocash', phone: '0779000310' }, `r1-pfr-h2-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Delivered');
  await sim.simulator.setStatus(guid, 'Cancelled');
  assert.equal(rowOf(await customerView(inv), s.collection_id).state, 'under_review');
  await resolve(s.collection_id, 'provider_status_unrecognized', 'acknowledged');
  const row = rowOf(await customerView(inv), s.collection_id);
  assert.equal(row.state, 'reviewed_held');
  assert.doesNotMatch(row.paynow.provider_status_label, /nothing was charged/i);
  assert.doesNotMatch(row.paynow.facts.next_step, /Complete this request/);
  assert.equal(row.paynow.checkout_url, null);
  assert.equal(row.paynow.needs_otp, false);
  await pastItsTime(s.collection_id);
  await ageReads(s.collection_id);
  const listed = (await P.listHeldPaynowCollections({ db, env })).held.find((h) => h.collection_id === s.collection_id);
  assert.equal(listed.can_release, true);
  await release(s.collection_id);
  const m = await money(inv.id);
  assert.equal(Number(m.provider_reserved), 0);
  assert.equal(Number(m.uncommitted_balance), 31);
});

test('PFR-H2: a reviewed word CarUp does not know can be released; the list and the database agree', { skip }, async () => {
  const inv = await invoice(32);
  const s = await start(inv, { method: 'ecocash', phone: '0779000311' }, `r1-pfr-h2b-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Reversed');
  await pastItsTime(s.collection_id);
  let listed = (await P.listHeldPaynowCollections({ db, env })).held.find((h) => h.collection_id === s.collection_id);
  assert.equal(listed.can_release, false);
  assert.match(listed.release_blocked_reason, /review/i);
  await resolve(s.collection_id, 'provider_status_unrecognized', 'acknowledged');
  listed = (await P.listHeldPaynowCollections({ db, env })).held.find((h) => h.collection_id === s.collection_id);
  assert.equal(listed.can_release, true);
  assert.doesNotMatch(listed.paynow.facts.next_step, /\byou\b|\byour\b/i, 'the operator list does not address the operator as the garage');
  await release(s.collection_id);
  assert.equal(Number((await money(inv.id)).provider_reserved), 0);
});

test('PFR-H3: late money under review on a closed request: no new request is offered or accepted until the review ends', { skip }, async () => {
  const inv = await invoice(70);
  const s = await start(inv, { method: 'ecocash', phone: '0779000312' }, `r1-pfr-h3-1-${run}`);
  const guid = await guidOf(s.collection_id);
  await sim.simulator.setStatus(guid, 'Cancelled');
  await sim.simulator.setStatus(guid, 'Paid');
  assert.equal(await openReview(s.collection_id, 'provider_paid_after_close'), 1);
  const view = await customerView(inv);
  assert.equal(view.online_payment.available, false);
  assert.equal(view.online_payment.reason, 'earlier_request_unresolved');
  await rejectsWith(start(inv, { method: 'ecocash', phone: '0779000312' }, `r1-pfr-h3-2-${run}`), 'PAY05_EARLIER_REQUEST_UNRESOLVED');
  assert.equal(await count('pay04_garage_collections WHERE invoice_id = $1', [inv.id]), 1, 'no second request was created');
  await resolve(s.collection_id, 'provider_paid_after_close', 'settled_off_platform');
  assert.equal((await customerView(inv)).online_payment.available, true, 'the review ended: a new request may start');
  assert.ok((await start(inv, { method: 'ecocash', phone: '0779000312' }, `r1-pfr-h3-3-${run}`)).collection_id);
});

test('PFR-H4: late money takes the room; the request still holding it is told not to complete it, and its own money is reviewed, never counted twice', { skip }, async () => {
  const inv = await invoice(100);
  const a = await start(inv, { method: 'ecocash', phone: '0779000313' }, `r1-pfr-h4-1-${run}`);
  const aGuid = await guidOf(a.collection_id);
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: a.collection_id, deps });
  await pastItsTime(a.collection_id);
  await release(a.collection_id);
  const b = await start(inv, { method: 'web' }, `r1-pfr-h4-2-${run}`);
  assert.ok(rowOf(await customerView(inv), b.collection_id).paynow.checkout_url, 'before: the request can be completed');
  await sim.simulator.setStatus(aGuid, 'Paid');
  const m = await money(inv.id);
  assert.equal(Number(m.provider_paid), 100);
  const view = await customerView(inv);
  const row = rowOf(view, b.collection_id);
  assert.equal(row.state, 'no_longer_needed');
  assert.equal(row.paynow.checkout_url, null);
  assert.match(row.paynow.facts.next_step, /Do not complete/);
  assert.doesNotMatch(row.paynow.provider_status_label, /Waiting for you/);
  assert.equal(view.online_payment.reason, 'nothing_due');
  await sim.simulator.setStatus(await guidOf(b.collection_id), 'Paid');
  assert.equal(Number((await money(inv.id)).provider_paid), 100, 'never more than the invoice');
  assert.equal(await openReview(b.collection_id, 'unallocated_provider_money'), 1);
  assert.equal(await liveReceipts(b.collection_id), 0);
});

test('PFR-H5: the operator\'s queue is chosen in the database, and says how many there are', { skip }, async () => {
  const inv = await invoice(20);
  const done = await start(inv, { method: 'ecocash', phone: '0779000314', amount: '10.00' }, `r1-pfr-h5-1-${run}`);
  await sim.simulator.setStatus(await guidOf(done.collection_id), 'Paid');
  await pastItsTime(done.collection_id);
  const stuck = await start(inv, { method: 'ecocash', phone: '0779000314', amount: '10.00' }, `r1-pfr-h5-2-${run}`);
  await pastItsTime(stuck.collection_id);
  const all = await P.listHeldPaynowCollections({ db, env, limit: 500 });
  assert.ok(all.held.some((h) => h.collection_id === stuck.collection_id));
  assert.ok(!all.held.some((h) => h.collection_id === done.collection_id));
  assert.equal(typeof all.held_total, 'number');
  assert.ok(all.held_total >= 1);
  const one_ = await P.listHeldPaynowCollections({ db, env, limit: 1 });
  assert.equal(one_.held.filter((h) => !h.released).length, 1);
  assert.equal(one_.held_total, all.held_total);
});

test('PFR-M1: a hold Paynow cannot be read for has an exit: an operator opens a review and settles it; the garage can then record cash', { skip }, async () => {
  const inv = await invoice(44);
  const s = await start(inv, { method: 'ecocash', phone: '0779000315' }, `r1-pfr-m1-${run}`);
  await pastItsTime(s.collection_id);
  await rejectsWith(P.releasePaynowHold({ db, env, transport: down, actor: operator(), collectionId: s.collection_id, body: { reason: 'Past its time, but Paynow cannot be read.' } }), 'PAY05_PROVIDER_READ_FAILED');
  let listed = (await P.listHeldPaynowCollections({ db, env })).held.find((h) => h.collection_id === s.collection_id);
  assert.equal(listed.can_open_review, true);
  await rejectsWith(P.openPaynowReview({ db, env, actor: garageA(), collectionId: s.collection_id, body: { reason: 'A garage may not open this review.' } }), 'PAY05_REVIEW_AUTHORITY_REFUSED');
  await P.openPaynowReview({ db, env, actor: operator(), collectionId: s.collection_id, body: { reason: 'The merchant replaced its key, so Paynow cannot be read.' } });
  listed = (await P.listHeldPaynowCollections({ db, env })).held.find((h) => h.collection_id === s.collection_id);
  assert.equal(listed.can_open_review, false);
  assert.equal(listed.state, 'under_review');
  await resolve(s.collection_id, 'provider_status_unrecognized', 'settled_off_platform');
  assert.equal(Number((await money(inv.id)).provider_reserved), 0);
  // a settled request whose read fails no longer refuses a new one: an operator took responsibility for it
  const input = await P.prevalidatePaynowStart({ db, env, transport: down, invoice: inv, body: { method: 'ecocash', phone: '0779000315' }, actorId: ids.cust });
  assert.ok(input);
  await q("SELECT garage_ops07_record_payment($1, $2, 44.00, 'USD', 'cash', 'PFR-M1-CASH', now(), $3, $4)", [world.g, inv.id, ids.admin, `r1-pfr-m1-cash-${run}`]);
  assert.equal(Number((await money(inv.id)).balance_amount), 0);
});

test('PFR-M1: money held at Paynow past CarUp\'s time: release stays refused, a review is the exit', { skip }, async () => {
  const inv = await invoice(45);
  const s = await start(inv, { method: 'ecocash', phone: '0779000316' }, `r1-pfr-m1b-${run}`);
  await sim.simulator.setStatus(await guidOf(s.collection_id), 'Delivered');
  await pastItsTime(s.collection_id);
  const listed = (await P.listHeldPaynowCollections({ db, env })).held.find((h) => h.collection_id === s.collection_id);
  assert.equal(listed.state, 'at_paynow');
  assert.equal(listed.can_release, false);
  assert.equal(listed.can_open_review, true);
  assert.match(listed.release_blocked_reason, /money/i);
});

test('PFR-M2: a second delivery whose read saw Paid is not thrown away because an older read wrote first', { skip, timeout: 60_000 }, async () => {
  const inv = await invoice(50);
  const s = await start(inv, { method: 'ecocash', phone: '0779000317' }, `r1-pfr-m2-${run}`);
  const id = s.collection_id;
  const guid = await guidOf(id);
  await sim.simulator.setStatus(guid, 'Paid', { notify: false });
  const paid = statusMessage(guid);
  await sim.simulator.setStatus(guid, 'Sent', { notify: false });
  const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
  const aReached = gate(); const aGo = gate(); const bReached = gate(); const bGo = gate();
  const slow = (reached, go) => async (url, opts) => { const reply = await A.httpTransport()(url, opts); reached.open(); await go.p; return reply; };
  const first = answer(id, paid, { transport: slow(aReached, aGo) });
  await aReached.p;
  await sim.simulator.setStatus(guid, 'Paid', { notify: false });
  const second = answer(id, paid, { transport: slow(bReached, bGo) });
  await bReached.p;
  aGo.open();
  const a = await first;
  bGo.open();
  const b = await second;
  assert.equal(a.ok, false, 'the first read did not show Paid: Paynow is asked to resend');
  const tx = await txOf(id);
  assert.equal(tx.provider_status, 'paid', 'the second read is what CarUp holds');
  assert.equal(Number((await money(inv.id)).provider_paid), 50);
  assert.equal(b.ok, true, 'it was applied, so Paynow may stop resending');
  assert.equal((await answer(id, paid)).ok, true, 'a resend is now a duplicate');
  assert.equal(await liveReceipts(id), 1);
});

test('PFR-M3: replaying a stale message costs no rows and cannot use up a genuine message\'s reads', { skip }, async () => {
  const inv = await invoice(60);
  const s = await start(inv, { method: 'ecocash', phone: '0779000318' }, `r1-pfr-m3-${run}`);
  const id = s.collection_id;
  const guid = await guidOf(id);
  await sim.simulator.setStatus(guid, 'Delivered');
  const stale = statusMessage(guid);
  await sim.simulator.setStatus(guid, 'Paid');
  assert.equal(Number((await money(inv.id)).provider_paid), 60);
  const rows = await observations(id);
  const events = await count('pay04_garage_collection_events WHERE collection_id = $1', [id]);
  const answers = [];
  for (let i = 0; i < 40; i += 1) answers.push((await answer(id, stale)).ok);
  assert.equal(answers.filter(Boolean).length, 11, 'twelve reads in ten minutes for this message, the first when it was new');
  assert.equal(await observations(id), rows, 'no observation rows');
  assert.equal(await count('pay04_garage_collection_events WHERE collection_id = $1', [id]), events, 'no event rows');
  await sim.simulator.setStatus(guid, 'Disputed', { notify: false });
  const genuine = statusMessage(guid);
  assert.equal((await answer(id, genuine)).ok, true, 'the genuine message has its own reads');
  assert.equal(Number((await money(inv.id)).provider_paid), 0);
  assert.equal(await openReview(id, 'provider_disputed'), 1);
});

test('PFR-M3: a signed message re-split across a field boundary is the same message: it costs reads, never rows, and changes nothing', { skip }, async () => {
  const inv = await invoice(50);
  const s = await start(inv, { method: 'ecocash', phone: '0779000319' }, `r1-pfr-m3b-${run}`);
  const id = s.collection_id;
  const guid = await guidOf(id);
  await sim.simulator.setStatus(guid, 'Paid');
  const params = new URLSearchParams(statusMessage(guid));
  const amount = params.get('amount'); const word = params.get('status');
  params.set('amount', `${amount}${word[0]}`); params.set('status', word.slice(1));
  const shifted = params.toString();
  const rows = await observations(id);
  const replies = [];
  for (let i = 0; i < 15; i += 1) replies.push(await answer(id, shifted));
  assert.equal(await observations(id), rows, 'no rows');
  assert.ok(replies.every((r) => !r.ok), 'it does not confirm itself');
  assert.equal(Number((await money(inv.id)).provider_paid), 50, 'the money is untouched');
  assert.equal(await liveReceipts(id), 1);
});

test('PFR-M4: room a refund frees counts the money waiting for it, through the real status update', { skip }, async () => {
  const inv = await invoice(100);
  const a = await start(inv, { method: 'ecocash', phone: '0779000320' }, `r1-pfr-m4-1-${run}`);
  const aGuid = await guidOf(a.collection_id);
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: a.collection_id, deps });
  await pastItsTime(a.collection_id);
  await release(a.collection_id);
  const b = await start(inv, { method: 'ecocash', phone: '0779000320' }, `r1-pfr-m4-2-${run}`);
  const bGuid = await guidOf(b.collection_id);
  await sim.simulator.setStatus(bGuid, 'Paid');
  await sim.simulator.setStatus(aGuid, 'Paid');
  assert.equal(await openReview(a.collection_id, 'unallocated_provider_money'), 1);
  await sim.simulator.setStatus(bGuid, 'Refunded');
  const m = await money(inv.id);
  assert.equal(Number(m.provider_paid), 100);
  assert.equal(await openReview(a.collection_id, 'unallocated_provider_money'), 0);
  assert.equal(await liveReceipts(a.collection_id), 1);
  assert.equal(await liveReceipts(b.collection_id), 0);
  assert.equal((await customerView(inv)).online_payment.reason, 'nothing_due');
});

test('PFR-M5: a closed request never gets waiting words or a way to pay it, and paying again warns about it', { skip }, async () => {
  const inv = await invoice(66);
  sim.simulator.inject('initiate', { kind: 'error', message: 'Temporary refusal' });
  await rejectsWith(start(inv, { method: 'omari', phone: '0779000321' }, `r1-pfr-m5-${run}`), 'PAY05_PROVIDER_REFUSED');
  const id = (await one('SELECT id FROM pay04_garage_collections WHERE invoice_id = $1', [inv.id])).id;
  const live = sim.simulator.list().at(-1);
  const delivered = await answer(id, sim.simulator.statusMessage(sim.simulator.transactions.get(live.guid)));
  assert.equal(delivered.status === 400, false, 'Paynow\'s signed word is not refused');
  const view = await customerView(inv);
  const row = rowOf(view, id);
  assert.equal(row.payment_status, 'cancelled');
  assert.equal(row.state, 'closed_live');
  assert.doesNotMatch(row.paynow.provider_status_label, /Waiting for/);
  assert.equal(row.paynow.needs_otp, false);
  assert.equal(row.paynow.otp_unavailable, false);
  assert.equal(row.paynow.checkout_url, null);
  assert.match(row.paynow.facts.next_step, /Do not approve/);
  assert.equal(view.online_payment.available, true);
  assert.ok(view.online_payment.notices.earlier_request, 'paying again warns that Paynow may still have the old request');
});

test('PFR-M5: a page left open cannot pay a request that can no longer be paid, and a replay of it offers nothing', { skip }, async () => {
  const inv = await invoice(36);
  const key = `r1-pfr-m5b-${run}`;
  const s = await start(inv, { method: 'omari', phone: '0779000327' }, key);
  assert.equal(s.paynow.needs_otp, true, 'at first: the form');
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, deps });
  await pastItsTime(s.collection_id);
  await release(s.collection_id);
  await rejectsWith(P.submitPaynowOtp({ db, env, actor: customer(), collectionId: s.collection_id, body: { otp: '123456' } }), 'PAY05_OTP_NOT_EXPECTED');
  const replay = await start(inv, { method: 'omari', phone: '0779000327' }, key);
  assert.equal(replay.replayed, true);
  assert.equal(replay.paynow.needs_otp, false);
  assert.equal(replay.checkout_url, null);
});

test('PFR-H4: a replay of a request the invoice no longer needs offers no way to pay it', { skip }, async () => {
  const inv = await invoice(100);
  const a = await start(inv, { method: 'ecocash', phone: '0779000328' }, `r1-pfr-h4b-1-${run}`);
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: a.collection_id, deps });
  await pastItsTime(a.collection_id);
  await release(a.collection_id);
  const key = `r1-pfr-h4b-2-${run}`;
  const b = await start(inv, { method: 'omari', phone: '0779000328' }, key);
  assert.equal(b.paynow.needs_otp, true, 'at first: the form');
  await sim.simulator.setStatus(await guidOf(a.collection_id), 'Paid');
  assert.equal(Number((await money(inv.id)).provider_paid), 100);
  const replay = await start(inv, { method: 'omari', phone: '0779000328' }, key);
  assert.equal(replay.replayed, true);
  assert.equal(replay.paynow.needs_otp, false);
  await rejectsWith(P.submitPaynowOtp({ db, env, actor: customer(), collectionId: b.collection_id, body: { otp: '123456' } }), 'PAY05_OTP_NOT_EXPECTED');
});

test('PFR-L1: Paid, then a read of another amount, then Paid again: a resend reads again, so the operator can close it on Paynow\'s word', { skip }, async () => {
  const inv = await invoice(50);
  const s = await start(inv, { method: 'ecocash', phone: '0779000322' }, `r1-pfr-l1-${run}`);
  const id = s.collection_id;
  const guid = await guidOf(id);
  await sim.simulator.setStatus(guid, 'Paid');
  await sim.simulator.setStatus(guid, 'Paid', { notify: false, amount: '49.00' });
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: id, deps });
  assert.equal(await openReview(id, 'amount_mismatch'), 1);
  await sim.simulator.setStatus(guid, 'Paid', { notify: false, amount: '50.00' });
  const polls = counting();
  await answer(id, statusMessage(guid), { transport: polls });
  assert.equal(polls.calls.length, 1, 'it was read again, not swallowed as a duplicate');
  assert.equal((await one('SELECT pay05_latest_provider_status($1) AS l', [id])).l, 'paid');
  await resolve(id, 'amount_mismatch', 'provider_corrected');
  assert.equal(Number((await money(inv.id)).provider_paid), 50);
});

test('PFR-L3: a payment counted in part says so, with the part', { skip }, async () => {
  const inv = await invoice(60);
  const s = await start(inv, { method: 'ecocash', phone: '0779000323' }, `r1-pfr-l3-${run}`);
  const id = s.collection_id;
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: id, deps });
  await pastItsTime(id);
  await release(id);
  await q("SELECT garage_ops07_record_payment($1, $2, 30.00, 'USD', 'cash', 'PFR-L3-CASH', now(), $3, $4)", [world.g, inv.id, ids.admin, `r1-pfr-l3-cash-${run}`]);
  await sim.simulator.setStatus(await guidOf(id), 'Paid');
  const row = rowOf(await customerView(inv), id);
  assert.equal(row.state, 'confirmed_partial');
  assert.match(row.state_label, /part/i);
  assert.match(row.paynow.provider_status_label, /part/i);
  assert.match(row.paynow.facts.allocation, /30\.00/);
  assert.equal(await liveReceipts(id), 1);
});

test('PFR-L5: "last read" moves with a read recorded only because it repeats what CarUp holds', { skip }, async () => {
  const inv = await invoice(33);
  const s = await start(inv, { method: 'ecocash', phone: '0779000324' }, `r1-pfr-l5-${run}`);
  const id = s.collection_id;
  const guid = await guidOf(id);
  await sim.simulator.setStatus(guid, 'Delivered');
  await sim.simulator.setStatus(guid, 'Cancelled');
  await resolve(id, 'provider_status_unrecognized', 'acknowledged');
  await q('SET session_replication_role = replica');
  await q("UPDATE pay05_paynow_transactions SET last_read_at = clock_timestamp() - interval '3 days', provider_status_at = clock_timestamp() - interval '3 days' WHERE collection_id = $1", [id]);
  await q('SET session_replication_role = origin');
  await S.verifyCustomerCollection({ db, env, actor: customer(), collectionId: id, deps });
  const row = rowOf(await customerView(inv), id);
  assert.ok(Date.now() - Date.parse(row.paynow.facts.last_read_at) < 60_000, 'it shows the read just made');
});

test('PFR-L7: the customer\'s stop answer carries the customer\'s next step, not the garage\'s', { skip }, async () => {
  const inv = await invoice(34);
  const s = await start(inv, { method: 'ecocash', phone: '0779000325' }, `r1-pfr-l7-${run}`);
  const out = await S.cancelCustomerCollection({ db, env, actor: customer(), collectionId: s.collection_id, body: { reason: 'Stopped by the customer' } });
  assert.match(out.collection.paynow.facts.next_step, /If you already paid/);
  assert.doesNotMatch(out.collection.paynow.facts.next_step, /record this amount/i);
  assert.match(out.paynow.facts.next_step, /If you already paid/);
  assert.equal(out.collection.paynow.paynow_reference, null);
});

test('PFR-L11: a garage does not read the operator\'s free-text currency reference', { skip }, async () => {
  const out = await M.getGaragePaynowConnection({ db, env, actor: garageA() });
  const usd = out.merchant.integrations.find((i) => i.currency === 'USD');
  assert.equal(usd.currency_evidence.settlement_currency, 'USD');
  assert.equal(usd.currency_evidence.reference, undefined);
});

test('PFR-L12: an operator\'s failed verification probes do not refuse the garage\'s own connection', { skip }, async () => {
  for (const id of [u('adminl'), u('mechl')]) await q("INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,'owner','2026-01-01') ON CONFLICT (id) DO NOTHING", [id, `${id}@example.invalid`]);
  const g = (await seedGarage('p5l', u('adminl'), u('mechl'))).g;
  for (let i = 0; i < 6; i += 1) {
    await q("SELECT pay05_record_provider_error('credential_probe_failed', $1, NULL, NULL, $2::jsonb)", [g, JSON.stringify({ integration_row_id: crypto.randomUUID(), currency: 'USD', result: 'unreachable' })]);
  }
  const usd = sim.simulator.issueIntegration({ currency: 'USD', methods: ['web'], name: 'P5L Motors USD' });
  const out = await M.connectGaragePaynow({ db, env, actor: { id: u('adminl'), tenantId: g, platformRole: 'owner' }, body: { ...profile('P5L Motors (Pvt) Ltd'), integrations: [
    { currency: 'USD', integration_id: usd.integrationId, integration_key: usd.key, methods: usd.methods }] } });
  assert.ok(out.merchant.id);
});

test('PFR-L13: reads that fail keep the slow pace: looking at an invoice again does not read Paynow again', { skip }, async () => {
  const inv = await invoice(100);
  const a = await start(inv, { method: 'ecocash', phone: '0779000326', amount: '40.00' }, `r1-pfr-l13-${run}`);
  await sim.simulator.setStatus(await guidOf(a.collection_id), 'Paid', { amount: '39.00' });
  await resolve(a.collection_id, 'amount_mismatch', 'settled_off_platform');
  await ageReads(a.collection_id, 120);
  const failing = (() => { const calls = []; const t = async (url) => { calls.push(url); throw new Error('ECONNREFUSED'); }; t.calls = calls; return t; })();
  const collection = await one('SELECT * FROM pay04_garage_collections WHERE id = $1', [a.collection_id]);
  for (let i = 0; i < 5; i += 1) await P.refreshPaynowCollection({ db, env, transport: failing, collection }).catch(() => null);
  assert.equal(failing.calls.length, 1, 'one attempt an hour, whether or not it worked');
});

test('every Paynow collection this file made: counted money has Paynow\'s applied Paid as its latest word and exactly one live receipt', { skip }, async () => {
  const bad = (await q(`SELECT c.id FROM pay04_garage_collections c
     WHERE c.tenant_id = $1 AND c.gateway = 'paynow_zimbabwe' AND pay04_collection_allocated(c.id) > 0
       AND (pay05_latest_provider_status(c.id) IS DISTINCT FROM 'paid'
            OR (SELECT count(*) FROM pay04_garage_provider_receipts r WHERE r.collection_id = c.id AND r.status = 'issued') <> 1)`, [world.g])).rows;
  assert.deepEqual(bad, []);
});
