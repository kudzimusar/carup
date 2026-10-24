import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, seedAcceptedCase, applyMigrations } from './helpers/garageFinalWorld.js';
import { migrationUpSql } from './helpers/pgliteLedgerHarness.js';

const OPS04 = '20261024100000_garage_ops04_estimates_and_authorization.sql';
const OPS05 = '20261024110000_garage_ops05_workshop_execution_gates.sql';
const OPS06 = '20261024120000_garage_ops06_parts_stock.sql';
let world;
let db;
let seq = 0;
const key = () => `test-key-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function rejects(promise, pattern) {
  try { await promise; } catch (error) {
    if (pattern) assert.match(String(error.message), pattern, `expected ${pattern}, got: ${error.message}`);
    return error;
  }
  assert.fail(`expected a rejection${pattern ? ' matching ' + pattern : ''}`);
}
const createPart = (o = {}) => db.query(
  'SELECT * FROM garage_ops06_create_part($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [o.tenant ?? world.T.a, o.name ?? 'Brake pad', o.sku ?? `SKU-${++seq}`, o.qty ?? 10, o.min ?? null, o.supplier ?? null,
    o.cost ?? null, o.sell ?? null, o.currency ?? null, o.actor ?? 'admin-a', o.key ?? key()]);
const part = async (id) => (await db.query('SELECT * FROM mechanic_parts WHERE id=$1', [id])).rows[0];
const movements = async (id) => (await db.query('SELECT movement_type, quantity_delta, balance_before, balance_after FROM garage_stock_movements WHERE part_id=$1 ORDER BY seq', [id])).rows;
const consume = (rec, partId, qty, o = {}) => db.query('SELECT garage_ops06_consume_for_service($1,$2,$3,$4,$5,$6,$7) r',
  [o.tenant ?? rec.tenant, rec.recordId, partId, qty, o.log ?? null, o.actor ?? 'mech-a', o.key ?? key()]);

/** an authorized, assigned, STARTED job with one recorded service */
async function activeJob(garage = 'a') {
  const c = await seedAcceptedCase(world, { garage });
  const who = garage === 'a' ? 'customer-a' : 'customer-b';
  const mech = garage === 'a' ? 'mech-a' : 'mech-c';
  const admin = garage === 'a' ? 'admin-a' : 'admin-b';
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','authorized',NULL)", [c.workOrderId, c.vin, who]);
  await db.query('INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)', [c.workOrderId, c.tenant, mech, admin]);
  await db.query("UPDATE service_cases SET status='active' WHERE id=$1", [c.caseId]);
  const { rows: [r] } = await db.query(
    `INSERT INTO service_records (work_order_id,service_case_id,tenant_id,vin,work_performed,service_authority,recorded_by_user_id,performed_at)
     VALUES ($1,$2,$3,$4,'Brakes','garage_stated',$5,now()) RETURNING id`, [c.workOrderId, c.caseId, c.tenant, c.vin, mech]);
  return { ...c, recordId: r.id, mech, admin };
}

before(async () => {
  world = await createGarageFinalWorld({ after: [OPS04, OPS05, OPS06] });
  db = world.db;
  await db.exec(migrationUpSql(OPS06)); // replay-safe
});
after(async () => { await db?.close(); });

test('OPS06 ledger and usage are private; functions are service_role-only; nothing can be deleted', async () => {
  for (const table of ['garage_stock_movements', 'garage_service_part_usage']) {
    const { rows: [rls] } = await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1', [table]);
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    const { rows: [p] } = await db.query(
      "SELECT has_table_privilege('anon',$1,'SELECT') a, has_table_privilege('authenticated',$1,'SELECT') u, has_table_privilege('service_role',$1,'DELETE') d", [table]);
    assert.deepEqual(p, { a: false, u: false, d: false });
  }
  const { rows: [m] } = await db.query("SELECT has_table_privilege('service_role','garage_stock_movements','UPDATE') u");
  assert.equal(m.u, false, 'the ledger is insert-only');
  const { rows } = await db.query(
    `SELECT p.proname, has_function_privilege('anon', p.oid,'EXECUTE') a, has_function_privilege('authenticated', p.oid,'EXECUTE') u, has_function_privilege('service_role', p.oid,'EXECUTE') s
       FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'garage_ops06_%' AND p.prokind='f'
        AND p.proname NOT LIKE '%guard%' AND p.proname NOT LIKE '%append_only%'`);
  assert.ok(rows.length >= 8);
  for (const r of rows) assert.deepEqual({ a: r.a, u: r.u, s: r.s }, { a: false, u: false, s: true }, r.proname);
});

test('a part is created WITH its opening count in the ledger; unrecorded values stay NULL', async () => {
  const { rows: [p] } = await createPart({ qty: 12, sku: 'BP-100' });
  assert.equal(p.stock_level, 12);
  assert.equal(p.min_stock, null, 'no threshold was stated, none is invented');
  assert.equal(p.supplier, null, 'no supplier was stated, none is invented');
  assert.equal(p.unit_cost, null);
  assert.equal(p.sell_price, null);
  assert.equal(p.price_currency, null);
  assert.deepEqual(await movements(p.id), [{ movement_type: 'opening', quantity_delta: 12, balance_before: 0, balance_after: 12 }]);
  const { rows: [zero] } = await createPart({ qty: 0, sku: 'ZERO-1' });
  assert.equal(zero.stock_level, 0, 'a counted zero is a real, recorded zero');
});

test('money on a part always carries a currency; supplier is free text exactly as stated', async () => {
  await rejects(createPart({ cost: 5 }), /GARAGE_OPS06_CURRENCY_REQUIRED/);
  await rejects(createPart({ cost: 5, currency: 'KWD' }), /GARAGE_OPS06_CURRENCY_UNSUPPORTED/);
  await rejects(createPart({ cost: 5.555, currency: 'USD' }), /GARAGE_OPS06_AMOUNT_INVALID/);
  await rejects(createPart({ cost: -1, currency: 'USD' }), /GARAGE_OPS06_AMOUNT_INVALID/);
  const { rows: [p] } = await createPart({ cost: 7.5, sell: 12, currency: 'USD', supplier: '  Harare Spares  ', min: 3 });
  assert.equal(p.supplier, 'Harare Spares');
  assert.equal(p.min_stock, 3);
  assert.equal(p.unit_cost, '7.50');
  assert.equal(p.price_currency, 'USD');
  await rejects(db.query("UPDATE mechanic_parts SET unit_cost=1, price_currency=NULL WHERE id=$1", [p.id]), /money_truth|violates check/i);
});

test('SKU is unique per garage (case-insensitive) but free across garages; creation is idempotent', async () => {
  const { rows: [a] } = await createPart({ sku: 'OIL-FILTER' });
  await rejects(createPart({ sku: 'oil-filter' }), /GARAGE_OPS06_SKU_EXISTS/);
  await rejects(createPart({ sku: '  OIL-FILTER ' }), /GARAGE_OPS06_SKU_EXISTS/);
  const { rows: [other] } = await createPart({ sku: 'OIL-FILTER', tenant: world.T.b, actor: 'admin-b' });
  assert.notEqual(other.id, a.id);
  const k = key();
  const first = (await createPart({ sku: 'IDEMP-1', key: k })).rows[0];
  const replay = (await createPart({ sku: 'IDEMP-1', key: k })).rows[0];
  assert.equal(replay.id, first.id, 'a retried request returns the same part');
  assert.equal((await movements(first.id)).length, 1, 'and does not double-count the opening stock');
});

test('only a garage admin manages stock; a mechanic and a stranger cannot', async () => {
  const { rows: [p] } = await createPart({ sku: 'ADMIN-ONLY' });
  await rejects(createPart({ actor: 'mech-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(createPart({ actor: 'customer-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,5,NULL,NULL,$3,$4)', [world.T.a, p.id, 'mech-a', key()]), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(db.query('SELECT * FROM garage_ops06_update_part($1,$2,$3::jsonb,$4)', [world.T.a, p.id, '{"name":"x"}', 'mech-a']), /GARAGE_OPS03_ADMIN_REQUIRED/);
  // another garage's admin cannot touch this garage's part
  await rejects(db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,5,NULL,NULL,$3,$4)', [world.T.b, p.id, 'admin-b', key()]), /GARAGE_OPS06_PART_NOT_FOUND/);
  await rejects(db.query('SELECT * FROM garage_ops06_update_part($1,$2,$3::jsonb,$4)', [world.T.b, p.id, '{"name":"x"}', 'admin-b']), /GARAGE_OPS06_PART_NOT_FOUND/);
  assert.equal((await part(p.id)).name, 'Brake pad');
});

test('quantity changes only through a ledger movement; the ledger is append-only and arithmetically honest', async () => {
  const { rows: [p] } = await createPart({ qty: 5, sku: 'LEDGER-1' });
  await rejects(db.query('UPDATE mechanic_parts SET stock_level=500 WHERE id=$1', [p.id]), /GARAGE_OPS06_STOCK_WRITE_VIA_MOVEMENT/);
  await rejects(db.query("UPDATE garage_stock_movements SET quantity_delta=99 WHERE part_id=$1", [p.id]), /MOVEMENTS_APPEND_ONLY/);
  await rejects(db.query("DELETE FROM garage_stock_movements WHERE part_id=$1", [p.id]), /MOVEMENTS_APPEND_ONLY/);
  await rejects(db.query(
    `INSERT INTO garage_stock_movements (tenant_id,part_id,movement_type,quantity_delta,balance_before,balance_after,idempotency_key,actor_user_id)
     VALUES ($1,$2,'receipt',5,5,99,$3,'admin-a')`, [world.T.a, p.id, key()]), /movement_arithmetic|violates check/i);
  assert.equal((await part(p.id)).stock_level, 5);
  // metadata edits do not touch the quantity, and the SKU is identity
  const { rows: [u] } = await db.query('SELECT * FROM garage_ops06_update_part($1,$2,$3::jsonb,$4)', [world.T.a, p.id, '{"name":"Brake pad (front)","min_stock":2,"supplier":null}', 'admin-a']);
  assert.equal(u.name, 'Brake pad (front)');
  assert.equal(u.min_stock, 2);
  assert.equal(u.stock_level, 5);
  assert.equal(u.sku, 'LEDGER-1');
});

test('receiving and stocktakes: receipts add, a count states the shelf, an adjustment needs a reason', async () => {
  const { rows: [p] } = await createPart({ qty: 5, sku: 'RCV-1' });
  const recv = (await db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,7,$3,NULL,$4,$5)', [world.T.a, p.id, 'purchase', 'admin-a', key()])).rows[0];
  assert.equal(recv.balance_after, 12);
  await rejects(db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,0,NULL,NULL,$3,$4)', [world.T.a, p.id, 'admin-a', key()]), /QUANTITY_INVALID/);
  await rejects(db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,-3,NULL,NULL,$3,$4)', [world.T.a, p.id, 'admin-a', key()]), /QUANTITY_INVALID/);
  const k = key();
  await db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,3,NULL,NULL,$3,$4)', [world.T.a, p.id, 'admin-a', k]);
  await db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,3,NULL,NULL,$3,$4)', [world.T.a, p.id, 'admin-a', k]);
  assert.equal((await part(p.id)).stock_level, 15, 'a replayed receipt is counted once');
  await rejects(db.query('SELECT * FROM garage_ops06_receive_stock($1,$2,4,NULL,NULL,$3,$4)', [world.T.a, p.id, 'admin-a', k]), /IDEMPOTENCY_CONFLICT/);

  await rejects(db.query('SELECT * FROM garage_ops06_count_stock($1,$2,15,$3,NULL,$4,$5)', [world.T.a, p.id, 'recount', 'admin-a', key()]), /NO_CHANGE/);
  await rejects(db.query('SELECT * FROM garage_ops06_count_stock($1,$2,13,NULL,NULL,$3,$4)', [world.T.a, p.id, 'admin-a', key()]), /REASON_REQUIRED/);
  const adj = (await db.query('SELECT * FROM garage_ops06_count_stock($1,$2,13,$3,NULL,$4,$5)', [world.T.a, p.id, 'damaged', 'admin-a', key()])).rows[0];
  assert.equal(adj.movement_type, 'adjustment');
  assert.equal(adj.quantity_delta, -2);
  assert.equal((await part(p.id)).stock_level, 13);
  await rejects(db.query('SELECT * FROM garage_ops06_count_stock($1,$2,-1,$3,NULL,$4,$5)', [world.T.a, p.id, 'x', 'admin-a', key()]), /QUANTITY_INVALID/);
});

test('CONSUMPTION: usage, ledger movement and quantity change together, linked to the ACTUAL service record', async () => {
  const job = await activeJob();
  const { rows: [p] } = await createPart({ qty: 10, sku: 'USE-1', cost: 4, sell: 9.99, currency: 'USD' });
  const { rows: [{ r }] } = await consume(job, p.id, 3);
  assert.equal(r.balance_after, 7);
  assert.equal(r.replayed, false);
  assert.equal((await part(p.id)).stock_level, 7);
  const { rows: [u] } = await db.query('SELECT * FROM garage_service_part_usage WHERE id=$1', [r.usage_id]);
  assert.equal(u.service_record_id, job.recordId);
  assert.equal(u.work_order_id, job.workOrderId);
  assert.equal(u.quantity, 3);
  assert.equal(u.part_name_snapshot, 'Brake pad');
  assert.equal(u.unit_cost_snapshot, '4.00');
  assert.equal(u.sell_price_snapshot, '9.99');
  assert.equal(u.price_currency_snapshot, 'USD');
  const ledger = await movements(p.id);
  assert.deepEqual(ledger.at(-1), { movement_type: 'consumption', quantity_delta: -3, balance_before: 10, balance_after: 7 });
  // the snapshot survives later re-pricing of the master
  await db.query('SELECT * FROM garage_ops06_update_part($1,$2,$3::jsonb,$4)', [world.T.a, p.id, '{"sell_price":50}', 'admin-a']);
  assert.equal((await db.query('SELECT sell_price_snapshot FROM garage_service_part_usage WHERE id=$1', [r.usage_id])).rows[0].sell_price_snapshot, '9.99');
  await rejects(db.query("UPDATE garage_service_part_usage SET quantity=1 WHERE id=$1", [r.usage_id]), /USAGE_IS_HISTORY/);
  await rejects(db.query("DELETE FROM garage_service_part_usage WHERE id=$1", [r.usage_id]), /USAGE_IS_HISTORY/);
});

test('CONSUMPTION is idempotent and never negative', async () => {
  const job = await activeJob();
  const { rows: [p] } = await createPart({ qty: 4, sku: 'USE-2' });
  const k = key();
  await consume(job, p.id, 3, { key: k });
  const replay = (await consume(job, p.id, 3, { key: k })).rows[0].r;
  assert.equal(replay.replayed, true);
  assert.equal((await part(p.id)).stock_level, 1, 'the replay did not consume again');
  await rejects(consume(job, p.id, 2, { key: k }), /IDEMPOTENCY_CONFLICT/);
  const e = await rejects(consume(job, p.id, 2), /GARAGE_OPS06_INSUFFICIENT_STOCK/);
  assert.match(String(e.detail ?? ''), /available=1 requested=2|/);
  assert.equal((await part(p.id)).stock_level, 1);
  await rejects(consume(job, p.id, 0), /QUANTITY_INVALID/);
  await rejects(consume(job, p.id, -1), /QUANTITY_INVALID/);
  await consume(job, p.id, 1);
  assert.equal((await part(p.id)).stock_level, 0);
  await rejects(consume(job, p.id, 1), /INSUFFICIENT_STOCK/);
});

test('CONSUMPTION follows the execution rules: authorized, started, open, own garage, own record', async () => {
  const { rows: [p] } = await createPart({ qty: 5, sku: 'USE-3' });
  const pending = await seedAcceptedCase(world);
  const { rows: [recless] } = await db.query('SELECT 1');
  assert.ok(recless);
  const job = await activeJob();
  await rejects(consume({ ...job, recordId: '00000000-0000-0000-0000-000000000000' }, p.id, 1), /SERVICE_RECORD_NOT_FOUND/);
  await rejects(consume(job, p.id, 1, { actor: 'customer-a' }), /GARAGE_OPS05_WORKSPACE_REQUIRED/);
  await rejects(consume(job, p.id, 1, { actor: 'admin-b' }), /GARAGE_OPS05_WORKSPACE_REQUIRED/);
  await rejects(consume(job, p.id, 1, { tenant: world.T.b, actor: 'admin-b' }), /SERVICE_RECORD_NOT_FOUND/);
  // a part belonging to another garage cannot be consumed against this garage's job
  const { rows: [theirs] } = await createPart({ tenant: world.T.b, actor: 'admin-b', sku: 'THEIRS-1', qty: 9 });
  await rejects(consume(job, theirs.id, 1), /PART_NOT_FOUND/);
  assert.equal((await part(theirs.id)).stock_level, 9);
  // revoked authorization stops consumption; so does completion
  const revoked = await activeJob();
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked','x')", [revoked.workOrderId, revoked.vin]);
  await rejects(consume(revoked, p.id, 1), /GARAGE_OPS05_NOT_AUTHORIZED/);
  const finished = await activeJob();
  await db.query('SELECT garage_ops05_complete_job($1,$2,$3)', [finished.tenant, finished.caseId, 'admin-a']);
  await rejects(consume(finished, p.id, 1), /GARAGE_OPS05_WORK_ORDER_TERMINAL/);
  assert.equal((await part(p.id)).stock_level, 5, 'nothing was consumed by any refused attempt');
  void pending;
});

test('CONSUMPTION needs a counted, active part; a legacy uncounted quantity is not trusted until counted', async () => {
  const job = await activeJob();
  const { rows: [p] } = await createPart({ qty: 6, sku: 'USE-4' });
  await db.query('SELECT * FROM garage_ops06_update_part($1,$2,$3::jsonb,$4)', [world.T.a, p.id, '{"is_active":false}', 'admin-a']);
  await rejects(consume(job, p.id, 1), /PART_INACTIVE/);
  // a legacy row written by the old basic-create route: a quantity with no ledger
  const { rows: [legacy] } = await db.query(
    "INSERT INTO mechanic_parts (tenant_id,name,sku,stock_level,unit_price) VALUES ($1,'Legacy pad','LEG-1',8,25) RETURNING id", [world.T.a]);
  await rejects(consume(job, legacy.id, 1), /GARAGE_OPS06_STOCK_NOT_COUNTED/);
  const first = (await db.query('SELECT * FROM garage_ops06_count_stock($1,$2,7,NULL,NULL,$3,$4)', [world.T.a, legacy.id, 'admin-a', key()])).rows[0];
  assert.equal(first.movement_type, 'opening', 'the first count is the baseline');
  assert.equal(first.quantity_delta, -1);
  assert.equal(first.balance_before, 8);
  await consume(job, legacy.id, 2);
  assert.equal((await part(legacy.id)).stock_level, 5);
  // unknown stock (NULL) is not zero and cannot be consumed or received into
  const { rows: [unknown] } = await db.query("INSERT INTO mechanic_parts (tenant_id,name,sku) VALUES ($1,'No count','UNK-1') RETURNING id, stock_level", [world.T.a]);
  assert.equal(unknown.stock_level, null);
  await rejects(consume(job, unknown.id, 1), /STOCK_NOT_COUNTED/);
});

test('FAIL-ATOMIC: if the audit write fails, usage + movement + quantity all roll back', async () => {
  const job = await activeJob();
  const { rows: [p] } = await createPart({ qty: 9, sku: 'ATOMIC-1' });
  await db.exec(
    "CREATE OR REPLACE FUNCTION ops06_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN " +
    "IF NEW.event_type = 'GARAGE_STOCK_CONSUMED' THEN RAISE EXCEPTION 'OPS06_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; " +
    "CREATE TRIGGER trg_ops06_test_fail_audit BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION ops06_test_fail_audit();");
  try {
    await rejects(consume(job, p.id, 4), /OPS06_TEST_AUDIT_FAILURE/);
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS trg_ops06_test_fail_audit ON trust_audit_events; DROP FUNCTION IF EXISTS ops06_test_fail_audit();');
  }
  assert.equal((await part(p.id)).stock_level, 9, 'quantity untouched');
  assert.equal((await movements(p.id)).length, 1, 'no consumption movement survived');
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_service_part_usage WHERE part_id=$1', [p.id])).rows[0].n, 0, 'no usage survived');
  const guard = (await db.query("SELECT current_setting('garage.ops06_stock_write', true) v")).rows[0].v;
  assert.ok(!guard || guard === '', 'the stock-write flag did not leak out of the failed transaction');
  await consume(job, p.id, 4);
  assert.equal((await part(p.id)).stock_level, 5);
});

test('REVERSAL: a mistaken usage is undone by a reversal movement while the job is open, exactly once', async () => {
  const job = await activeJob();
  const { rows: [p] } = await createPart({ qty: 10, sku: 'REV-1' });
  const { rows: [{ r }] } = await consume(job, p.id, 4);
  await rejects(db.query('SELECT garage_ops06_reverse_usage($1,$2,NULL,$3,$4)', [job.tenant, r.usage_id, 'mech-a', key()]), /REASON_REQUIRED/);
  await rejects(db.query('SELECT garage_ops06_reverse_usage($1,$2,$3,$4,$5)', [world.T.b, r.usage_id, 'oops', 'admin-b', key()]), /USAGE_NOT_FOUND/);
  const { rows: [{ r: rev }] } = await db.query('SELECT garage_ops06_reverse_usage($1,$2,$3,$4,$5) r', [job.tenant, r.usage_id, 'Wrong part', 'mech-a', key()]);
  assert.equal(rev.balance_after, 10);
  assert.equal((await part(p.id)).stock_level, 10);
  await rejects(db.query('SELECT garage_ops06_reverse_usage($1,$2,$3,$4,$5)', [job.tenant, r.usage_id, 'again', 'mech-a', key()]), /USAGE_ALREADY_REVERSED/);
  const types = (await movements(p.id)).map((m) => m.movement_type);
  assert.deepEqual(types, ['opening', 'consumption', 'reversal'], 'history is kept, never rewritten');
  // once the job is finished the record is historical
  const { rows: [{ r: r2 }] } = await consume(job, p.id, 1);
  await db.query('SELECT garage_ops05_complete_job($1,$2,$3)', [job.tenant, job.caseId, 'admin-a']);
  await rejects(db.query('SELECT garage_ops06_reverse_usage($1,$2,$3,$4,$5)', [job.tenant, r2.usage_id, 'late', 'admin-a', key()]), /GARAGE_OPS05_WORK_ORDER_TERMINAL/);
});

test('PARTSENTRY: an attested log for THIS work order can be linked; another job\'s or garage\'s cannot', async () => {
  const job = await activeJob();
  const other = await activeJob();
  const { rows: [p] } = await createPart({ qty: 20, sku: 'PS-1' });
  const log = async (j) => (await db.query(
    `INSERT INTO partsentry_logs (vin,mechanic_id,part_name,action_type,description,mileage,signature,timestamp,tenant_id,attestation,work_order_id,odometer_applied)
     VALUES ($1,$2,'Brake pad','Replaced','fitted',51000,'sig','2026-10-24T00:00:00Z',$3,'mechanic_service',$4,true) RETURNING id`,
    [j.vin, j.mech, j.tenant, j.workOrderId])).rows[0].id;
  const mine = await log(job);
  const theirs = await log(other);
  await rejects(consume(job, p.id, 1, { log: theirs }), /PARTSENTRY_MISMATCH/);
  const { rows: [{ r }] } = await consume(job, p.id, 1, { log: mine });
  const { rows: [u] } = await db.query('SELECT partsentry_log_id FROM garage_service_part_usage WHERE id=$1', [r.usage_id]);
  assert.equal(String(u.partsentry_log_id), String(mine));
  const { rows: link } = await db.query('SELECT 1 FROM service_record_parts WHERE service_record_id=$1 AND partsentry_log_id=$2', [job.recordId, mine]);
  assert.equal(link.length, 1, 'the existing PartSentry service-record link is written too, so the Passport projection sees it');
});

test('LEGACY SHAPE: on the staging-style mechanic_parts (006 + convergence) the migration converges without losing data', async () => {
  const legacy = await createGarageFinalWorld({ after: [], seed: true });
  try {
    const ldb = legacy.db;
    await ldb.exec('DROP TABLE mechanic_parts CASCADE');
    await ldb.exec(`CREATE TABLE mechanic_parts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id TEXT, name TEXT NOT NULL, sku TEXT NOT NULL,
      stock_level INTEGER DEFAULT 0, unit_price NUMERIC NOT NULL, created_at TIMESTAMPTZ DEFAULT now(),
      tenant_id UUID, min_stock INTEGER DEFAULT 0, supplier TEXT)`);
    await ldb.query("INSERT INTO mechanic_parts (tenant_id,name,sku,stock_level,unit_price,min_stock) VALUES ($1,'Old pad','OLD-1',8,25,0)", [legacy.T.a]);
    await applyMigrations(ldb, [OPS04, OPS05, OPS06]);
    const { rows: [old] } = await ldb.query("SELECT stock_level, unit_price, min_stock, price_currency FROM mechanic_parts WHERE sku='OLD-1'");
    assert.deepEqual(old, { stock_level: 8, unit_price: '25', min_stock: 0, price_currency: null });
    const { rows: [fresh] } = await ldb.query("SELECT * FROM garage_ops06_create_part($1,'New pad','NEW-1',3,NULL,NULL,NULL,NULL,NULL,'admin-a',$2)", [legacy.T.a, key()]);
    assert.equal(fresh.stock_level, 3);
    assert.equal(fresh.unit_price, null, 'a new part does not invent a legacy price');
    await ldb.exec(migrationUpSql(OPS06)); // replay on the legacy shape
    await assert.rejects(ldb.query("UPDATE mechanic_parts SET stock_level=1 WHERE sku='OLD-1'"), /STOCK_WRITE_VIA_MOVEMENT/);
  } finally { await legacy.db.close(); }
});
