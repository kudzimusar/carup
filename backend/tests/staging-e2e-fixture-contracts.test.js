import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contracts for the staging events-E2E harness (PR #146 review findings).
 *
 * The runner cannot be imported (top-level env guards call process.exit), so
 * these tests EXTRACT its shipped SQL from source and execute it against a
 * PGlite fixture that mirrors staging's real FK semantics — the same bytes the
 * dispatcher runs, not a reimplementation.
 *
 * P2-1: the synthetic recipient must be an existing user whose platform-level
 *       communication preferences permit a transactional in_app notification.
 * P2-2: cleanup must remove every delivery artifact, narrowly scoped, in
 *       FK-safe order, and prove zero residue.
 */

const runnerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'staging-apply-events-cron.mjs');
const src = fs.readFileSync(runnerPath, 'utf8');

function extract(re, label) {
  const m = src.match(re);
  assert.ok(m, `runner must ship ${label}`);
  return m[1] ?? m[0];
}

const ELIGIBLE_SQL = extract(
  /const ELIGIBLE_RECIPIENT_SQL = `([\s\S]*?)`;/, 'ELIGIBLE_RECIPIENT_SQL');

/**
 * The ordered DELETE steps exactly as shipped in purgeSynthetic's STEPS,
 * including each step's declared parameter names — a statement must only ever
 * receive placeholders it references (an unused $n raises 42P18).
 */
function extractSteps() {
  const block = extract(/const STEPS = \[([\s\S]*?)\n  \];/, 'the ordered STEPS cleanup array');
  const steps = [...block.matchAll(/\['([a-z_]+)', `([\s\S]*?)`,\s*\[([^\]]*)\]\]/g)].map((m) => ({
    table: m[1],
    sql: m[2],
    argNames: m[3].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean),
  }));
  assert.ok(steps.length >= 8, `expected >=8 ordered cleanup steps, got ${steps.length}`);
  for (const s of steps) {
    const used = new Set([...s.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(used.size, s.argNames.length,
      `${s.table}: declares ${s.argNames.length} params but references ${used.size} placeholders`);
    for (let i = 1; i <= s.argNames.length; i += 1) {
      assert.ok(used.has(i), `${s.table}: placeholders must be contiguous from $1 — $${i} missing`);
    }
  }
  return steps;
}

const RESIDUE_SQL = extract(/const RESIDUE_SQL = `([\s\S]*?)`;/, 'the zero-residue assertion query');
const RESOLVE_SQL = extract(
  /const \{ rows \} = await client\.query\(`\s*(WITH t AS \([\s\S]*?message_ids)`/, 'the STEP 0 resolve query');

// Staging shape: users.id TEXT; preferences keyed (user_id, tenant_id) with a
// unique index over COALESCE(tenant_id,'platform'); booleans NOT NULL.
const PREFS_FIXTURE = `
  CREATE TABLE users (id TEXT PRIMARY KEY);
  CREATE TABLE communication_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    tenant_id TEXT,
    transactional_enabled BOOLEAN NOT NULL DEFAULT true,
    marketing_enabled BOOLEAN NOT NULL DEFAULT false,
    in_app_enabled BOOLEAN NOT NULL DEFAULT true,
    email_enabled BOOLEAN NOT NULL DEFAULT true,
    push_enabled BOOLEAN NOT NULL DEFAULT true
  );
  CREATE UNIQUE INDEX idx_comm_preferences_user_tenant
    ON communication_preferences (user_id, COALESCE(tenant_id, 'platform'));
`;

async function prefsDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(PREFS_FIXTURE);
  return db;
}

test('P2-1: an existing user with NO preferences row is eligible (service defaults permit)', async () => {
  const db = await prefsDb();
  await db.exec("INSERT INTO users (id) VALUES ('u-no-prefs');");
  const { rows } = await db.query(ELIGIBLE_SQL);
  assert.equal(rows[0].recipient_id, 'u-no-prefs');
  assert.equal(rows[0].eligible_total, 1);
  await db.close();
});

test('P2-1: transactional_enabled=false makes a user ineligible', async () => {
  const db = await prefsDb();
  await db.exec(`INSERT INTO users (id) VALUES ('u-no-transactional');
    INSERT INTO communication_preferences (user_id, tenant_id, transactional_enabled, in_app_enabled)
    VALUES ('u-no-transactional', NULL, false, true);`);
  const { rows } = await db.query(ELIGIBLE_SQL);
  assert.equal(rows[0].eligible_total, 0);
  assert.equal(rows[0].recipient_id, null);
  await db.close();
});

test('P2-1: in_app_enabled=false makes a user ineligible', async () => {
  const db = await prefsDb();
  await db.exec(`INSERT INTO users (id) VALUES ('u-no-inapp');
    INSERT INTO communication_preferences (user_id, tenant_id, transactional_enabled, in_app_enabled)
    VALUES ('u-no-inapp', NULL, true, false);`);
  const { rows } = await db.query(ELIGIBLE_SQL);
  assert.equal(rows[0].eligible_total, 0);
  assert.equal(rows[0].recipient_id, null);
  await db.close();
});

test('P2-1: a compatible explicit preference row is eligible, and suppressed peers are skipped', async () => {
  const db = await prefsDb();
  await db.exec(`INSERT INTO users (id) VALUES ('a-suppressed'), ('b-compatible');
    INSERT INTO communication_preferences (user_id, tenant_id, transactional_enabled, in_app_enabled) VALUES
      ('a-suppressed', NULL, true,  false),
      ('b-compatible', NULL, true,  true);`);
  const { rows } = await db.query(ELIGIBLE_SQL);
  // 'a-suppressed' sorts first but must be skipped — this is the exact bug the
  // review flagged: ORDER BY id LIMIT 1 would have picked the suppressed user.
  assert.equal(rows[0].recipient_id, 'b-compatible');
  assert.equal(rows[0].eligible_total, 1);
  await db.close();
});

test('P2-1: no eligible user yields NULL so the runner fails loudly before inserting', async () => {
  const db = await prefsDb();
  await db.exec(`INSERT INTO users (id) VALUES ('only-suppressed');
    INSERT INTO communication_preferences (user_id, tenant_id, in_app_enabled)
    VALUES ('only-suppressed', NULL, false);`);
  const { rows } = await db.query(ELIGIBLE_SQL);
  assert.equal(rows[0].recipient_id, null);
  // The runner branches on recipient_id being falsy and calls fail() BEFORE the
  // synthetic insert, so nothing is written when no fixture qualifies.
  assert.ok(/if \(!recipRows\[0\]\.recipient_id\) \{[\s\S]*?fail\(/.test(src),
    'runner must fail() on a NULL recipient before inserting the synthetic event');
  const insertIdx = src.indexOf("INSERT INTO domain_events (event_type, payload, status, tenant_id)");
  const guardIdx = src.indexOf('recipRows[0].recipient_id');
  assert.ok(guardIdx !== -1 && guardIdx < insertIdx, 'the guard must precede the synthetic insert');
  await db.close();
});

test('P2-1: predicate uses IS NOT FALSE (NULL is permissive, mirroring `=== false` checks)', async () => {
  assert.ok(/transactional_enabled IS NOT FALSE/.test(ELIGIBLE_SQL), 'must use IS NOT FALSE, not = true');
  assert.ok(/in_app_enabled IS NOT FALSE/.test(ELIGIBLE_SQL), 'must use IS NOT FALSE, not = true');
  assert.ok(/p\.tenant_id IS NULL/.test(ELIGIBLE_SQL),
    'join must scope to the platform-level (tenant_id IS NULL) row the synthetic event resolves');
  assert.ok(!/UPDATE|INSERT|DELETE/i.test(ELIGIBLE_SQL),
    'recipient selection must never modify a real user\'s preferences');
});

// ── P2-2: complete, FK-safe, narrowly scoped cleanup ────────────────────────

// Mirrors staging's live FK map: CASCADE from message_threads into messages /
// participants / escalations; NO ACTION (blocking) from notification_queue and
// message_delivery_attempts into messages; communication_audit_events has NO
// foreign keys at all. notification_queue.id is BIGINT while the two artifact
// tables store notification_id as TEXT.
const COMMS_FIXTURE = `
  CREATE TABLE message_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id TEXT, thread_type TEXT NOT NULL, tenant_id TEXT);
  CREATE TABLE message_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    participant_type TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    direction TEXT NOT NULL, channel TEXT NOT NULL,
    sender_participant_id UUID REFERENCES message_participants(id),
    in_reply_to_message_id UUID REFERENCES messages(id));
  CREATE TABLE notification_queue (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT,
    thread_id UUID REFERENCES message_threads(id),
    message_id UUID REFERENCES messages(id),
    recipient_id TEXT);
  CREATE TABLE message_delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id TEXT, message_id UUID REFERENCES messages(id),
    attempt_number INT, status TEXT);
  CREATE TABLE communication_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id TEXT, thread_id UUID, message_id UUID, event_type TEXT);
  CREATE TABLE communication_escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE);
  CREATE TABLE domain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT, payload JSONB, status TEXT, attempts INT DEFAULT 0, tenant_id TEXT);
`;

/** Build a fully-delivered synthetic footprint plus unrelated neighbour rows. */
async function deliveredFootprint() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(COMMS_FIXTURE);
  const inquiryId = '11111111-1111-4111-8111-111111111111';
  const { rows: ev } = await db.query(
    `INSERT INTO domain_events (event_type, payload, status)
     VALUES ('marketplace.inquiry.created', jsonb_build_object('inquiryId', $1::text, 'source_channel','staging-e2e-synthetic'), 'processed')
     RETURNING id`, [inquiryId]);
  const eventId = ev.rows === undefined ? ev[0].id : ev[0].id;
  const { rows: th } = await db.query(
    `INSERT INTO message_threads (subject_id, thread_type) VALUES ($1, 'marketplace_inquiry') RETURNING id`, [inquiryId]);
  const threadId = th[0].id;
  await db.query(`INSERT INTO message_participants (thread_id, participant_type, role) VALUES ($1,'user','requester')`, [threadId]);
  const { rows: msg } = await db.query(
    `INSERT INTO messages (thread_id, direction, channel) VALUES ($1,'outbound','in_app') RETURNING id`, [threadId]);
  const messageId = msg[0].id;
  const { rows: nq } = await db.query(
    `INSERT INTO notification_queue (event_id, thread_id, message_id, recipient_id)
     VALUES ($1::text, $2, $3, 'u-1') RETURNING id`, [eventId, threadId, messageId]);
  const notifId = String(nq[0].id);
  // Delivery artifacts the live comms cron writes — the rows the old teardown
  // left behind (and which BLOCK the naive thread delete).
  await db.query(`INSERT INTO message_delivery_attempts (notification_id, message_id, attempt_number, status)
                  VALUES ($1, $2, 1, 'sent')`, [notifId, messageId]);
  await db.query(`INSERT INTO communication_audit_events (notification_id, thread_id, message_id, event_type)
                  VALUES ($1,$2,$3,'queue_claimed'), ($1,$2,$3,'delivery_attempt'), ($1,$2,$3,'delivery_receipt')`,
    [notifId, threadId, messageId]);

  // Unrelated neighbour history that must survive untouched.
  const { rows: other } = await db.query(
    `INSERT INTO message_threads (subject_id, thread_type) VALUES ('other-subject','marketplace_inquiry') RETURNING id`);
  const otherThread = other[0].id;
  const { rows: om } = await db.query(
    `INSERT INTO messages (thread_id, direction, channel) VALUES ($1,'outbound','in_app') RETURNING id`, [otherThread]);
  const { rows: onq } = await db.query(
    `INSERT INTO notification_queue (event_id, thread_id, message_id, recipient_id) VALUES ('other-event',$1,$2,'u-2') RETURNING id`,
    [otherThread, om[0].id]);
  await db.query(`INSERT INTO message_delivery_attempts (notification_id, message_id, attempt_number, status) VALUES ($1,$2,1,'sent')`,
    [String(onq[0].id), om[0].id]);
  await db.query(`INSERT INTO communication_audit_events (notification_id, thread_id, message_id, event_type) VALUES ($1,$2,$3,'delivery_receipt')`,
    [String(onq[0].id), otherThread, om[0].id]);
  await db.query(`INSERT INTO domain_events (event_type, payload, status) VALUES ('other.event','{}'::jsonb,'processed')`);
  return { db, eventId, inquiryId, threadId, messageId, notifId };
}

test('P2-2: the naive single-statement thread delete is BLOCKED by delivery artifacts (the leak)', async () => {
  const { db, inquiryId } = await deliveredFootprint();
  await assert.rejects(
    () => db.query('DELETE FROM message_threads WHERE subject_id=$1', [inquiryId]),
    (e) => /foreign key|violates/i.test(String(e?.message || e)),
    'once delivery has happened, deleting the thread must fail — this is why ordering is required');
  await db.close();
});

test('P2-2: shipped ordered cleanup removes every artifact and asserts zero residue', async () => {
  const { db, eventId, inquiryId, threadId, messageId, notifId } = await deliveredFootprint();

  // STEP 0 — resolve exactly as the runner does.
  const { rows: idr } = await db.query(RESOLVE_SQL, [eventId, inquiryId]);
  assert.deepEqual(idr[0].thread_ids, [threadId], 'resolve must find the synthetic thread');
  assert.deepEqual(idr[0].notification_ids, [notifId], 'resolve must find the notification id as TEXT');
  assert.deepEqual(idr[0].message_ids, [messageId], 'resolve must find the message id');

  const params = [eventId, inquiryId, idr[0].thread_ids, idr[0].notification_ids, idr[0].message_ids];
  const bag = {
    eventId, inquiryId,
    threadIds: idr[0].thread_ids, notificationIds: idr[0].notification_ids, messageIds: idr[0].message_ids,
  };
  const steps = extractSteps();
  const order = steps.map((s) => s.table);
  // Ordering contract that makes the sequence FK-safe.
  assert.ok(order.indexOf('communication_audit_events') < order.indexOf('notification_queue'));
  assert.ok(order.indexOf('message_delivery_attempts') < order.indexOf('messages'));
  assert.ok(order.indexOf('notification_queue') < order.indexOf('messages'));
  assert.ok(order.indexOf('messages') < order.indexOf('message_participants'));
  assert.ok(order.indexOf('message_participants') < order.indexOf('message_threads'));
  assert.equal(order[order.length - 1], 'domain_events', 'the outbox row is the last handle — delete it last');

  for (const { table, sql, argNames } of steps) {
    await db.query(sql, argNames.map((n) => bag[n])); // must not throw: proves FK-safe ordering
    assert.ok(!/DELETE FROM \w+\s*;?\s*$/.test(sql.trim()), `${table} delete must be scoped, never unqualified`);
    assert.ok(!/created_at|now\(\)|interval/i.test(sql), `${table} delete must not use a timestamp window`);
  }

  const { rows: residue } = await db.query(RESIDUE_SQL, params);
  assert.equal(residue.length, 8, 'residue assertion must cover all eight tables');
  for (const r of residue) assert.equal(r.residual, 0, `${r.table_name} must have zero residue`);

  // Neighbour history untouched.
  const survivors = await db.query(`SELECT
      (SELECT count(*)::int FROM message_threads)            AS threads,
      (SELECT count(*)::int FROM messages)                   AS messages,
      (SELECT count(*)::int FROM notification_queue)          AS notifications,
      (SELECT count(*)::int FROM message_delivery_attempts)   AS attempts,
      (SELECT count(*)::int FROM communication_audit_events)  AS audits,
      (SELECT count(*)::int FROM domain_events)               AS events`);
  assert.deepEqual(survivors.rows[0], { threads: 1, messages: 1, notifications: 1, attempts: 1, audits: 1, events: 1 },
    'exactly the unrelated neighbour rows survive — cleanup is narrow, not a history sweep');
  await db.close();
});

test('P2-2: cleanup is idempotent and a no-op with empty id arrays', async () => {
  const { db, eventId, inquiryId } = await deliveredFootprint();
  const { rows: idr } = await db.query(RESOLVE_SQL, [eventId, inquiryId]);
  const steps = extractSteps();
  const bagOf = (ids) => ({
    eventId, inquiryId,
    threadIds: ids.thread_ids, notificationIds: ids.notification_ids, messageIds: ids.message_ids,
  });
  const bag1 = bagOf(idr[0]);
  for (const { sql, argNames } of steps) await db.query(sql, argNames.map((n) => bag1[n]));

  // Second sweep: resolve now finds nothing, so every statement runs with empty
  // id arrays and must be a clean, harmless no-op.
  const { rows: idr2 } = await db.query(RESOLVE_SQL, [eventId, inquiryId]);
  assert.deepEqual(idr2[0].thread_ids, []);
  const bag2 = bagOf(idr2[0]);
  for (const { table, sql, argNames } of steps) {
    const r = await db.query(sql, argNames.map((n) => bag2[n]));
    assert.equal(r.affectedRows ?? 0, 0, `${table}: second sweep must remove nothing`);
  }
  const params2 = [eventId, inquiryId, idr2[0].thread_ids, idr2[0].notification_ids, idr2[0].message_ids];
  const { rows: residue } = await db.query(RESIDUE_SQL, params2);
  for (const r of residue) assert.equal(r.residual, 0);
  await db.close();
});

test('P2-2: stale pre-purge resolves artifacts BEFORE deleting the outbox row', async () => {
  // Deleting domain_events first would destroy payload->>'inquiryId', the only
  // handle to that run's thread/messages/attempts/audit rows.
  const staleIdx = src.indexOf("payload->>'source_channel' = 'staging-e2e-synthetic'");
  assert.ok(staleIdx !== -1, 'runner must still detect stale synthetic events');
  const staleStmt = src.slice(staleIdx - 220, staleIdx);
  assert.ok(/SELECT id, payload->>'inquiryId'/.test(staleStmt),
    'the stale sweep must SELECT the inquiry handle, not DELETE the outbox row first');
  assert.ok(/for \(const s of stale\)[\s\S]{0,220}purgeSynthetic\(/.test(src),
    'each stale event must go through the full purge helper');
});

test('P2-2: teardown asserts residue and fails the run if anything survives', () => {
  assert.ok(/const leftover = await purgeSynthetic\(client, \{ eventId, inquiryId, label: 'synthetic' \}\)/.test(src),
    'the finally block must use the full purge helper');
  assert.ok(/synthetic residue survived cleanup/.test(src), 'surviving residue must be surfaced as an error');
  assert.ok(/re-sweeping once/.test(src),
    'must re-sweep once to close the race where the live cron writes artifacts mid-teardown');
  assert.ok(/Assert on COUNTS, never on DELETE rowCount/.test(src),
    'assertion must not rely on DELETE rowCount (RLS is enabled-not-forced)');
});
