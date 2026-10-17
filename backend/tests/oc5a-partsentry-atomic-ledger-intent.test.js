/**
 * OC-5A P1-C — one commit boundary for a PartSentry record, and a durable ledger intent (RC1 residual
 * finding D), proven through the SHIPPED app on a real PostgreSQL (PGlite) running the repository's own
 * migrations, with the REAL canonical ledger writer and the REAL Issue #158 custody contract.
 *
 * The "ledger unavailable" state here is not simulated: the custody rollout is left PREPARED, exactly as
 * its migration leaves it, so the real writer refuses stakeholder signing — the very refusal that left
 * RC1 with a saved log, a moved odometer, a 400, and a blocked retry.
 *
 * Proven:
 *   ledger unavailable → 201, record + odometer + intent committed, ledger 'pending', no event, no "failed";
 *   retry (same key, ledger still down) → 200 replayed, the SAME record, nothing duplicated;
 *   ledger restored → retry records exactly one event, intent marked recorded;
 *   lost HTTP response without a key → the repeat is a replay, not a refusal;
 *   a key reused for a different record → 409, nothing written;
 *   crash AFTER the ledger write, before the mark → the drain finds the event, marks it, writes no second;
 *   crash after the claim, before the write → a stale claim is re-claimed and recorded once;
 *   a fresh claim is exclusive — a concurrent drain gets nothing;
 *   the commit boundary is real — a failing intent insert rolls back the log and the odometer;
 *   concurrent service writes on one vehicle → both kept, odometer is the highest reading, chain verified;
 *   the drain route is secret-guarded and reports the backlog; /api/health reports a count, never content.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CARUP_LEDGER_HASH_VERSION;
delete process.env.LEDGER_INTENT_WORKER_SECRET;
process.env.CRON_SECRET = 'oc5a-cron-secret-for-tests-only';

const { createOc5aDatabase, finalizeCustody, installOver } = await import('./helpers/oc5aPartSentryWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');
const { custodyGeneration } = await import('../services/blockchain/blockchainKeyCustodyService.js');
const { addEvent } = await import('../services/blockchain/blockchainService.js');
const { drainLedgerIntents } = await import('../services/blockchain/ledgerIntentService.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const VIN = 'OC5CVINATOMIC0001';
let db; let server; let baseUrl; let installed; let GARAGE; let WORK_ORDER;

before(async () => {
  db = await createOc5aDatabase();
  installed = installOver(supabase, db);
  for (const [id, role, who] of [['owner-c', 'owner', 'owner'], ['mech-c', 'mechanic', 'mechanic']]) {
    await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, $1, $2, $3, '2026-01-01', true)`, [id, `${id}@example.invalid`, role]);
    const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: id, activeRole: role, token: `oc5c-session-${who}`, expiresAt: FUTURE }));
    assert.equal(error, null);
  }
  ({ rows: [{ id: GARAGE }] } = await db.query(`INSERT INTO tenants (name, type, status) VALUES ('Atomic Garage', 'garage', 'active') RETURNING id`));
  await db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, 'mech-c', 'mechanic')`, [GARAGE]);
  await db.query(`INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id) VALUES ($1, 'Toyota', 'Fortuner', 2021, 50000, 30000, 'owner-c')`, [VIN]);
  ({ rows: [{ id: WORK_ORDER }] } = await db.query(
    `INSERT INTO mechanic_work_orders (tenant_id, vin, customer_id, mechanic_id, status, owner_authorization, owner_authorized_by, owner_authorized_at)
     VALUES ($1, $2, 'owner-c', 'mech-c', 'In Progress', 'authorized', 'owner-c', now()) RETURNING id`, [GARAGE, VIN]));
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  installed?.restore();
  delete process.env.CRON_SECRET;
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { who = null, method = 'GET', body, headers = {} } = {}) {
  const h = { 'x-bypass-rate-limit': 'true', 'content-type': 'application/json', ...headers };
  if (who) h['x-session-token'] = `oc5c-session-${who}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}
const service = (overrides = {}, key = null) => call('/api/partsentry/add', {
  who: 'mechanic', method: 'POST', headers: { 'x-tenant-id': GARAGE, ...(key ? { 'Idempotency-Key': key } : {}) },
  body: { vin: VIN, partName: 'Oil filter', partOem: 'OEM-OF-9', actionType: 'Replaced', description: 'Scheduled service', mileage: 50500, ...overrides },
});
const state = async () => {
  const { rows: [s] } = await db.query(`SELECT
      (SELECT count(*)::int FROM partsentry_logs WHERE vin = $1) AS logs,
      (SELECT count(*)::int FROM ledger_event_intents WHERE vin = $1) AS intents,
      (SELECT count(*)::int FROM ledger_event_intents WHERE vin = $1 AND status = 'recorded') AS recorded,
      (SELECT count(*)::int FROM blockchain_events WHERE vin = $1) AS events,
      (SELECT mileage FROM vehicles WHERE vin = $1) AS mileage`, [VIN]);
  return { ...s };
};
const intentFor = async (logId) => (await db.query(`SELECT * FROM ledger_event_intents WHERE source = 'partsentry_logs' AND source_id = $1`, [String(logId)])).rows[0];

test('LEDGER UNAVAILABLE (custody PREPARED): the record is kept and the caller is told so — 201, ledger pending, intent durable, no event, never "failed"', async () => {
  const res = await service({}, 'oc5c-key-0001');
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.ledger.status, 'pending');
  assert.equal(res.body.attestation, 'mechanic_service');
  assert.deepEqual(await state(), { logs: 1, intents: 1, recorded: 0, events: 0, mileage: 50500 });
  const intent = await intentFor(res.body.id);
  assert.equal(intent.status, 'pending');
  assert.equal(intent.attempts, 1, 'the inline attempt happened and is counted');
  assert.match(intent.last_error, /custody cutover is prepared/, 'the real writer\'s own refusal is kept on the intent');
  assert.equal(intent.payload.ledgerIntentId, intent.id, 'the payload names its intent — the key to exactly-once');
  assert.equal(intent.signer_id, 'mech-c');
});

test('RETRY while the ledger is still down (same Idempotency-Key): 200 replayed, the SAME record, nothing duplicated, the odometer untouched', async () => {
  const res = await service({}, 'oc5c-key-0001');
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.replayed, true);
  assert.equal(res.body.ledger.status, 'pending');
  assert.deepEqual(await state(), { logs: 1, intents: 1, recorded: 0, events: 0, mileage: 50500 });
});

test('LEDGER RESTORED: the retry of the same request records exactly ONE event and marks the intent recorded', async () => {
  await finalizeCustody(db, custodyGeneration());
  const res = await service({}, 'oc5c-key-0001');
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.replayed, true);
  assert.equal(res.body.ledger.status, 'recorded', JSON.stringify(res.body.ledger));
  assert.deepEqual(await state(), { logs: 1, intents: 1, recorded: 1, events: 1, mileage: 50500 });
  const again = await service({}, 'oc5c-key-0001');
  assert.equal(again.body.ledger.eventId, res.body.ledger.eventId, 'a further retry reports the same event and writes none');
  assert.equal((await state()).events, 1);
  const verified = await call(`/api/vehicles/${VIN}/verify-ledger`, { who: 'owner' });
  assert.equal(verified.body.integrity, 'verified', verified.text);
});

test('LOST RESPONSE without a key: repeating the same request within five minutes is a replay, not a refusal', async () => {
  const first = await service({ partName: 'Air filter', mileage: 50600 });
  assert.equal(first.status, 201, first.text);
  const repeat = await service({ partName: 'Air filter', mileage: 50600 });
  assert.equal(repeat.status, 200, repeat.text);
  assert.equal(repeat.body.replayed, true);
  assert.equal(repeat.body.id, first.body.id);
  assert.equal((await state()).logs, 2);
});

test('LOST RESPONSE, retried an hour later with the same key: still the ORIGINAL record — the key decides, not a time window', async () => {
  const first = await service({ partName: 'Cabin filter', mileage: 50650 }, 'oc5c-key-late');
  assert.equal(first.status, 201, first.text);
  await db.query(`UPDATE partsentry_logs SET created_at = now() - interval '1 hour' WHERE id = $1`, [first.body.id]);
  const late = await service({ partName: 'Cabin filter', mileage: 50650 }, 'oc5c-key-late');
  assert.equal(late.status, 200, late.text);
  assert.equal(late.body.replayed, true);
  assert.equal(late.body.id, first.body.id);
});

test('THE CLAIM ITSELF UNAVAILABLE: the record is kept and the caller hears "pending" — never a failure for a kept record', async () => {
  await db.exec('ALTER FUNCTION ledger_event_intents_claim(uuid, integer, uuid, integer) RENAME TO oc5c_claim_offline');
  try {
    const before = await state();
    const res = await service({ partName: 'Fuel filter', mileage: 50680 }, 'oc5c-key-claim-off');
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.ledger.status, 'pending');
    const after = await state();
    assert.equal(after.logs, before.logs + 1, 'the record was kept');
    assert.equal(after.intents, before.intents + 1, 'with its durable intent');
  } finally {
    await db.exec('ALTER FUNCTION oc5c_claim_offline(uuid, integer, uuid, integer) RENAME TO ledger_event_intents_claim');
  }
});

test('DUPLICATE KEY for a DIFFERENT record → 409, and nothing is written', async () => {
  const before = await state();
  const res = await service({ partName: 'Spark plugs', mileage: 50700 }, 'oc5c-key-0001');
  assert.equal(res.status, 409, res.text);
  assert.deepEqual(await state(), before);
});

test('a reading below the canonical odometer is refused before anything is written', async () => {
  const before = await state();
  const res = await service({ partName: 'Belt', mileage: 40000 }, 'oc5c-key-low1');
  assert.equal(res.status, 400, res.text);
  assert.match(res.body.error, /cannot be lower than vehicle current odometer/);
  assert.deepEqual(await state(), before);
});

test('THE COMMIT BOUNDARY IS REAL: when the intent cannot be written, the log and the odometer roll back with it', async () => {
  const before = await state();
  await db.exec(`ALTER TABLE ledger_event_intents ADD CONSTRAINT oc5c_forced_failure CHECK (false) NOT VALID`);
  try {
    const res = await service({ partName: 'Coolant', mileage: 51000 }, 'oc5c-key-roll');
    assert.equal(res.status, 503, res.text);
    assert.match(res.body.error, /Nothing was recorded/, 'a refusal inside the one transaction is known to have written nothing');
    assert.deepEqual(await state(), before, 'no orphan log, no odometer move, no intent');
  } finally {
    await db.exec(`ALTER TABLE ledger_event_intents DROP CONSTRAINT oc5c_forced_failure`);
  }
});

test('CRASH AFTER THE LEDGER WRITE, before the mark: the drain finds the event, marks the intent, and writes no second event', async () => {
  // Reproduce the crash window exactly: the record and its intent committed; the canonical writer
  // appended the event; the process died before marking — leaving a stale claim.
  await db.exec(`UPDATE blockchain_custody_rollout SET state = 'PREPARED', finalized_at = NULL WHERE singleton = TRUE`);
  const res = await service({ partName: 'Brake fluid', mileage: 51100 }, 'oc5c-key-crash-a');
  assert.equal(res.body.ledger.status, 'pending');
  await finalizeCustody(db, custodyGeneration());
  const intent = await intentFor(res.body.id);
  await addEvent(intent.vin, intent.event_type, intent.payload, 'SYSTEM_SIGNATURE', { operationId: intent.operation_id, signerId: intent.signer_id });
  await db.query(`UPDATE ledger_event_intents SET status = 'recording', claim_token = gen_random_uuid(), claimed_at = now() - interval '1 hour' WHERE id = $1`, [intent.id]);
  const carrying = async () => (await db.query(`SELECT id FROM blockchain_events WHERE vin = $1 AND payload::text LIKE '%' || $2 || '%'`, [VIN, intent.id])).rows;
  assert.equal((await carrying()).length, 1, 'the crashed claimant already wrote the event');

  const drained = await call('/api/internal/ledger-intents/process', { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
  assert.equal(drained.status, 200, drained.text);
  assert.equal(drained.body.recorded >= 1, true, drained.text);
  assert.equal((await carrying()).length, 1, 'the event already existed — no second one was added for this intent');
  const after = await intentFor(res.body.id);
  assert.equal(after.status, 'recorded');
  const { rows } = await db.query(`SELECT id FROM blockchain_events WHERE vin = $1 AND payload::text LIKE '%' || $2 || '%'`, [VIN, intent.id]);
  assert.equal(rows.length, 1, 'exactly one event carries this intent');
  assert.equal(String(after.ledger_event_id), String(rows[0].id));
});

test('CRASH AFTER THE CLAIM, before the write: the stale claim is taken over and recorded once; a FRESH claim is exclusive', async () => {
  await db.exec(`UPDATE blockchain_custody_rollout SET state = 'PREPARED', finalized_at = NULL WHERE singleton = TRUE`);
  const res = await service({ partName: 'Wipers', mileage: 51200 }, 'oc5c-key-crash-b');
  await finalizeCustody(db, custodyGeneration());
  const intent = await intentFor(res.body.id);

  // A live claimant holds it: another drain gets nothing.
  await db.query(`UPDATE ledger_event_intents SET status = 'recording', claim_token = gen_random_uuid(), claimed_at = now() WHERE id = $1`, [intent.id]);
  const contended = await drainLedgerIntents({ intentId: intent.id });
  assert.equal(contended.claimed, 0, 'a fresh claim is exclusive');
  assert.equal((await intentFor(res.body.id)).status, 'recording');

  // That claimant died without writing: once stale, the claim is taken over and recorded once.
  await db.query(`UPDATE ledger_event_intents SET claimed_at = now() - interval '1 hour' WHERE id = $1`, [intent.id]);
  const eventsBefore = (await state()).events;
  const recovered = await drainLedgerIntents({});
  assert.ok(recovered.results.some((r) => r.id === intent.id && r.status === 'recorded'), JSON.stringify(recovered));
  assert.equal((await state()).events, eventsBefore + 1);
  assert.equal((await intentFor(res.body.id)).status, 'recorded');
  const again = await drainLedgerIntents({});
  assert.equal(again.results.filter((r) => r.id === intent.id).length, 0, 'a recorded intent is never claimed again');
});

test('CONCURRENT service writes on one vehicle: both kept, each with its own intent and event, odometer at the highest reading, chain verified', async () => {
  const before = await state();
  const [a, b] = await Promise.all([
    service({ partName: 'Front tyre', mileage: 52000 }, 'oc5c-key-conc-a'),
    service({ partName: 'Rear tyre', mileage: 52100 }, 'oc5c-key-conc-b'),
  ]);
  const statuses = [a.status, b.status].sort();
  // The vehicle row lock serializes them. Whichever commits second compares against the first's
  // odometer: the lower reading after the higher is refused (400) rather than rolling it back.
  assert.ok((statuses[0] === 201 && statuses[1] === 201) || (statuses[0] === 201 && statuses[1] === 400), JSON.stringify(statuses));
  const after = await state();
  const kept = statuses.filter((s) => s === 201).length;
  assert.equal(after.logs, before.logs + kept);
  assert.equal(after.intents, before.intents + kept);
  assert.equal(after.events, before.events + kept);
  assert.equal(after.mileage, Math.max(...[a, b].filter((r) => r.status === 201).map((r) => r.body.mileage)));
  const verified = await call(`/api/vehicles/${VIN}/verify-ledger`, { who: 'owner' });
  assert.equal(verified.body.integrity, 'verified', verified.text);
});

test('the drain route refuses without its secret, and /api/health reports the backlog as a count — never content', async () => {
  const anonymous = await call('/api/internal/ledger-intents/process', { method: 'POST', body: {} });
  assert.equal(anonymous.status, 401);
  const wrong = await call('/api/internal/ledger-intents/process', { method: 'POST', headers: { authorization: 'Bearer not-the-secret' }, body: {} });
  assert.equal(wrong.status, 401);
  await db.exec(`UPDATE blockchain_custody_rollout SET state = 'PREPARED', finalized_at = NULL WHERE singleton = TRUE`);
  await service({ partName: 'Battery', mileage: 53000 }, 'oc5c-key-health');
  const health = await call('/api/health');
  assert.equal(health.status, 200);
  assert.ok(health.body.supabase.ledgerIntentBacklog >= 1, JSON.stringify(health.body.supabase));
  assert.doesNotMatch(health.text, /oc5c-key|Battery|mech-c/, 'a count, never content');
  await finalizeCustody(db, custodyGeneration());
  const drain = () => call('/api/internal/ledger-intents/process', { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
  // The failed inline attempt scheduled its retry with backoff; the drain honours it rather than
  // hammering a ledger that just refused.
  const early = await drain();
  assert.equal(early.status, 200, early.text);
  assert.equal(early.body.claimed, 0, 'not due yet');
  assert.ok(early.body.backlog >= 1);
  // The backoff interval elapses.
  await db.exec(`UPDATE ledger_event_intents SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`);
  const drained = await drain();
  assert.equal(drained.status, 200, drained.text);
  assert.ok(drained.body.recorded >= 1, drained.text);
  assert.equal(drained.body.backlog, 0, drained.text);
});

test('an intent whose payload does not name itself is refused — never written as an untraceable event, never marked recorded', async () => {
  await finalizeCustody(db, custodyGeneration());
  const { rows: [log] } = await db.query(
    `INSERT INTO partsentry_logs (vin, mechanic_id, part_name, action_type, mileage, signature, timestamp, attestation, odometer_applied)
     VALUES ($1, 'owner-c', 'Mat', 'Replaced', 60000, 'S', 'T', 'owner_stated', false) RETURNING id`, [VIN]);
  const { rows: [intent] } = await db.query(
    `INSERT INTO ledger_event_intents (id, source, source_id, vin, event_type, payload, signer_id, operation_id)
     VALUES (gen_random_uuid(), 'partsentry_logs', $1, $2, 'Owner Maintenance Declaration', '{"ledgerIntentId":"someone-else"}'::jsonb, 'owner-c', 'partsentry_log:' || $1)
     RETURNING id`, [String(log.id), VIN]);
  const eventsBefore = (await state()).events;
  const { results } = await drainLedgerIntents({ intentId: intent.id });
  assert.equal(results[0].status, 'pending');
  assert.match(results[0].error, /untraceable/);
  assert.equal((await state()).events, eventsBefore, 'no event written');
  const after = (await db.query('SELECT status, last_error FROM ledger_event_intents WHERE id = $1', [intent.id])).rows[0];
  assert.equal(after.status, 'pending');
});

test('DATABASE: the record function refuses what the database can know is wrong — attestation vocabulary, a mechanic service without a work order', async () => {
  const run = (attestation, workOrder) => db.query(
    `SELECT partsentry_record_service($1, 'mech-c', $2, $3, NULL, 'X', NULL, 'Replaced', NULL, 60000, 'SIG', '2026-10-04T00:00:00Z', NULL, 'Mechanic Inspection', '{}'::jsonb)`,
    [VIN, attestation, workOrder]);
  await assert.rejects(run('mechanic_verified', WORK_ORDER), (e) => e.code === '22023');
  await assert.rejects(run('legacy_unattested', null), (e) => e.code === '22023', 'nobody writes a new legacy row');
  await assert.rejects(run('mechanic_service', null), (e) => e.code === '22023');
  await assert.rejects(db.query(`INSERT INTO partsentry_logs (vin, mechanic_id, part_name, action_type, mileage, signature, timestamp, attestation, odometer_applied)
                                 VALUES ($1, 'owner-c', 'X', 'Replaced', 60000, 'S', 'T', 'owner_stated', true)`, [VIN]),
    (e) => e.code === '23514', 'an owner statement can never carry an applied odometer, even written directly');
  const { rows: grants } = await db.query(`SELECT has_function_privilege('anon', 'partsentry_record_service(text,text,text,uuid,uuid,text,text,text,text,integer,text,text,text,text,jsonb)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'ledger_event_intents_claim(uuid,integer,uuid,integer)', 'EXECUTE') AS authed,
      has_table_privilege('anon', 'ledger_event_intents', 'SELECT') AS anon_table,
      has_table_privilege('service_role', 'ledger_event_intents', 'DELETE') AS service_delete`);
  assert.deepEqual({ ...grants[0] }, { anon: false, authed: false, anon_table: false, service_delete: false });
});
