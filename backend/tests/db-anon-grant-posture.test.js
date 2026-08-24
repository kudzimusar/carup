/**
 * PERMANENT DATABASE SECURITY GATE — what the `anon` role may read.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four anonymous APPLICATION doors were closed on the evidence data, and none of it mattered to the
 * fifth: PostgREST. With the PUBLIC anon key — which ships in the browser bundle, so everyone holds
 * it — an anonymous caller read the raw tables directly, verified live on staging:
 *
 *   GET /rest/v1/vehicle_evidence?vin=eq.<VIN>&select=*
 *     -> 54 columns: uploaded_by, verified_by, file_path, storage_bucket, plate_number,
 *        normalized_plate_number, chassis_number, engine_number, tenant_id, verification_notes
 *
 *   GET /rest/v1/vehicles?vin=eq.<VIN>&select=*
 *     -> 66 columns: owner_id, current_seller_id, plate_number, chassis_number, engine_number
 *     -> AND draft rows: Golden B (publication_status='draft') was fully readable
 *
 * THE LESSON THIS FILE ENCODES: **RLS IS ROW SECURITY, NOT A COLUMN CONTRACT.**
 * The policies were correct and did their job — they restricted which ROWS anon could see. The leak
 * was the column privilege sitting beside them. `select=*` then returned every column of every
 * admitted row. Reviewing policies alone would never have found it, which is why this gate asserts
 * GRANTS, not policies.
 *
 * HOW IT RUNS
 * -----------
 * Structural assertions run everywhere and need no database. The live adversarial probes run only
 * when a real anon key and project URL are supplied, so CI without credentials still enforces the
 * static contract instead of silently skipping the whole file:
 *
 *   CARUP_ANON_PROBE_URL=https://<ref>.supabase.co CARUP_ANON_PROBE_KEY=<anon key> node --test ...
 *
 * The key used here is the PUBLIC anon key. It is not a secret — that is precisely the point: an
 * attacker has it too, so proving what it CANNOT reach is the whole exercise.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../database/migrations');

/** Every migration, oldest first — grant posture is the LAST statement to touch a privilege. */
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }));

/**
 * The net effect of the migration tree on `GRANT SELECT ... TO anon` for one table.
 *
 * Deliberately literal: it reads the statements in order and reports whichever came last, rather
 * than trying to model Postgres. A migration that grants and then revokes in the same file is
 * handled because statements are scanned in order within the file too.
 */
function netAnonSelectPosture(table) {
  let posture = 'none';
  let decidedBy = null;
  const statementRe = new RegExp(
    String.raw`(GRANT|REVOKE)\s+([A-Z, ]+?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?${table}\s+(?:TO|FROM)\s+([^;]+);`,
    'gi',
  );
  for (const { file, sql } of MIGRATIONS) {
    // Ignore the rollback half: it documents how to restore the old posture on purpose.
    const upOnly = sql.split(/^--\s*\+migrate\s+Down\s*$/mi)[0];
    for (const m of upOnly.matchAll(statementRe)) {
      const [, verb, privileges, roles] = m;
      if (!/\banon\b/i.test(roles)) continue;
      if (!/\bSELECT\b|\bALL\b/i.test(privileges)) continue;
      posture = verb.toUpperCase() === 'GRANT' ? 'granted' : 'none';
      decidedBy = `${file} (${verb.toUpperCase()} ${privileges.trim()})`;
    }
  }
  return { posture, decidedBy };
}

// ── The static contract: the migration tree must not re-grant these ──────────────────────────────

test('anon holds no SELECT on vehicle_evidence in the migration tree', () => {
  const { posture, decidedBy } = netAnonSelectPosture('vehicle_evidence');
  assert.equal(
    posture, 'none',
    `anon SELECT on vehicle_evidence was last set by ${decidedBy}. RLS restricts rows, not columns: `
    + 'with this privilege, select=* returns all 54 columns of every row the policy admits.',
  );
});

test('the revoke migration exists and is read-side only', () => {
  const revoke = MIGRATIONS.find((m) => /revoke_anon_vehicle_evidence_select/.test(m.file));
  assert.ok(revoke, 'the vehicle_evidence revoke migration must be present');
  const up = revoke.sql.split(/^--\s*\+migrate\s+Down\s*$/mi)[0];
  assert.match(up, /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.vehicle_evidence\s+FROM\s+anon/i);
  // Read-side only: it must not disturb the write posture a previous hardening migration set.
  assert.doesNotMatch(up, /GRANT\s+(INSERT|UPDATE|DELETE)/i, 'this migration must not alter writes');
  // ...and must not touch the roles the application depends on.
  assert.doesNotMatch(up, /REVOKE[^;]+FROM\s+service_role/i, 'the backend reads as service_role');
  assert.doesNotMatch(up, /REVOKE[^;]+FROM\s+authenticated/i, 'owner/reviewer paths read as authenticated');
});

test('a rollback exists and is honest about what it restores', () => {
  const revoke = MIGRATIONS.find((m) => /revoke_anon_vehicle_evidence_select/.test(m.file));
  const parts = revoke.sql.split(/^--\s*\+migrate\s+Down\s*$/mi);
  assert.equal(parts.length, 2, 'the migration must declare a Down section');
  assert.match(parts[1], /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.vehicle_evidence\s+TO\s+anon/i,
    'the rollback must restore the exact prior posture, exposure included, rather than a half-state');
});

// ── The live adversarial probes ──────────────────────────────────────────────────────────────────

const PROBE_URL = process.env.CARUP_ANON_PROBE_URL;
const PROBE_KEY = process.env.CARUP_ANON_PROBE_KEY;
const liveProbe = Boolean(PROBE_URL && PROBE_KEY);

/** Query PostgREST exactly as an attacker holding the public anon key would. */
async function anonSelect(pathAndQuery) {
  const res = await fetch(`${PROBE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: PROBE_KEY, Authorization: `Bearer ${PROBE_KEY}` },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

test('LIVE: anon cannot select * from vehicle_evidence', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  const { status, body } = await anonSelect('vehicle_evidence?select=*&limit=5');
  const rows = Array.isArray(body) ? body : [];
  assert.equal(rows.length, 0,
    `anon read ${rows.length} evidence row(s) with ${rows[0] ? Object.keys(rows[0]).length : 0} columns `
    + '— the raw evidence table must be unreachable with the public key');
  assert.ok(status === 401 || status === 403 || rows.length === 0,
    `expected a refusal or an empty result, got HTTP ${status}`);
});

test('LIVE: anon cannot reach the private document locator by naming columns', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // select=* is the obvious probe; naming the columns explicitly is the one an attacker uses next.
  const { body } = await anonSelect('vehicle_evidence?select=file_path,storage_bucket,uploaded_by,verified_by&limit=5');
  const rows = Array.isArray(body) ? body : [];
  assert.equal(rows.length, 0, 'a private storage locator must not be reachable under any projection');
});

test('LIVE: anon cannot retrieve a draft vehicle', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // Golden B is deliberately draft. "Golden B is absent from public surfaces" is a release
  // invariant, and it must hold at the database boundary too, not only in the marketplace query.
  const { body } = await anonSelect('vehicles?publication_status=eq.draft&select=vin&limit=5');
  const rows = Array.isArray(body) ? body : [];
  assert.equal(rows.length, 0,
    `anon retrieved ${rows.length} draft vehicle(s) — an unpublished listing must not be readable`);
});

test('LIVE: anon cannot retrieve private vehicle identifiers or internal ids', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  for (const column of [
    'owner_id', 'current_seller_id', 'tenant_id',
    'plate_number', 'chassis_number', 'engine_number',
  ]) {
    const { status, body } = await anonSelect(`vehicles?select=${column}&limit=1`);
    const rows = Array.isArray(body) ? body : [];
    const leaked = rows.filter((r) => r && r[column] !== undefined && r[column] !== null);
    assert.equal(leaked.length, 0,
      `anon retrieved ${column} — this is a field the passport withholds as "Not shown publicly" `
      + `(HTTP ${status})`);
  }
});

test('LIVE: anon cannot select * from vehicles', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  const { body } = await anonSelect('vehicles?select=*&limit=1');
  const rows = Array.isArray(body) ? body : [];
  if (rows.length > 0) {
    const columns = Object.keys(rows[0]);
    assert.fail(
      `anon read the raw vehicles table with select=* (${columns.length} columns). `
      + 'A public projection must expose an explicit column list, never the base table.',
    );
  }
});

// ── The enumeration sweep: catch the NEXT table before it becomes an incident ────────────────────

test('LIVE: no unexpected table grants anon a wide-open select=*', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // Measured during the incident: RLS correctly denied rows on messages, message_threads,
  // notification_queue, referral_wallet_transactions, webhook_logs, communication_preferences and
  // partsentry_logs — but their column grants were equally wide, so a single permissive policy
  // added later would expose them. This sweep is the early warning for that.
  const watched = [
    'vehicle_evidence', 'vehicles', 'messages', 'message_threads', 'notification_queue',
    'referral_wallet_transactions', 'webhook_logs', 'communication_preferences', 'partsentry_logs',
    'users', 'user_sessions', 'mechanic_work_orders',
  ];
  const exposed = [];
  for (const table of watched) {
    const { body } = await anonSelect(`${table}?select=*&limit=1`);
    const rows = Array.isArray(body) ? body : [];
    if (rows.length > 0) exposed.push(`${table} (${Object.keys(rows[0]).length} columns)`);
  }
  assert.deepEqual(exposed, [],
    `anon can select=* from: ${exposed.join(', ')}. Each is a raw base table reachable with the `
    + 'public browser key.');
});
