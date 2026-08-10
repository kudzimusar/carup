import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Proof battery for 20260810120000_trust_side_convergence.sql against the
 * EXACT production legacy shape reported by preflight-v2 (run 31360753528):
 *   trust_score_history: previous_score/new_score REAL NOT NULL,
 *     trigger_event TEXT NOT NULL, "timestamp" TEXT NOT NULL, id bigserial;
 *   rolling_integrity_checkpoints: vin TEXT PK (NO foreign key),
 *     last_verified_event_id INTEGER NOT NULL, rolling_hash/verified_at TEXT NOT NULL.
 */

const MIG = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..',
  'database', 'migrations', '20260810120000_trust_side_convergence.sql');
const UP = fs.readFileSync(MIG, 'utf8').split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');

// vehicles is the FK target the convergence restores; the legacy checkpoint
// table deliberately carries only a PK on vin, exactly as production does.
const VEHICLES_FIXTURE = `
  CREATE TABLE vehicles (vin TEXT PRIMARY KEY);
  INSERT INTO vehicles (vin) VALUES ('VIN-1'), ('VIN-2'), ('VIN-3');
`;

const PRODUCTION_LEGACY_FIXTURE = `
  CREATE TABLE trust_score_history (
    id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    previous_score REAL NOT NULL,
    new_score REAL NOT NULL,
    trigger_event TEXT NOT NULL,
    "timestamp" TEXT NOT NULL
  );
  CREATE TABLE rolling_integrity_checkpoints (
    vin TEXT PRIMARY KEY,
    last_verified_event_id INTEGER NOT NULL,
    rolling_hash TEXT NOT NULL,
    verified_at TEXT NOT NULL
  );
  INSERT INTO trust_score_history (entity_type, entity_id, previous_score, new_score, trigger_event, "timestamp") VALUES
    ('vehicle', 'VIN-1', 10.5, 20.25, 'evidence_added',    '2026-08-08T02:05:01.372Z'),
    ('vehicle', 'VIN-2', 0,    99.9,  'verification',      '2026-07-30T13:42:05.705+00:00'),
    ('dealer',  'D-1',   50,   55,    'dispute_resolved',  '2026-01-15T08:00:00+02:00');
  INSERT INTO rolling_integrity_checkpoints (vin, last_verified_event_id, rolling_hash, verified_at) VALUES
    ('VIN-1', 41, 'hash-a', '2026-08-08T02:05:01.372Z'),
    ('VIN-2', 2147483647, 'hash-b', '2026-08-08T02:23:05.653Z');
`;

async function legacyDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(VEHICLES_FIXTURE);
  await db.exec(PRODUCTION_LEGACY_FIXTURE);
  return db;
}

/** The vin FK contract: → vehicles(vin) with ON DELETE CASCADE. */
const FK_QUERY = `
  SELECT count(*)::int c FROM pg_constraint
   WHERE conrelid = to_regclass('public.rolling_integrity_checkpoints') AND contype='f'
     AND confrelid = to_regclass('public.vehicles') AND confdeltype='c'
     AND (SELECT array_agg(attname::text) FROM unnest(conkey) k JOIN pg_attribute a
           ON a.attrelid = conrelid AND a.attnum = k) = array['vin']
     AND (SELECT array_agg(attname::text) FROM unnest(confkey) k JOIN pg_attribute a
           ON a.attrelid = confrelid AND a.attnum = k) = array['vin']`;

test('convergence on the production legacy shape: rows, values, types, sequence, keys all proven', async () => {
  const db = await legacyDb();
  // Precondition: the legacy shape has NO vin foreign key.
  assert.equal((await db.query(FK_QUERY)).rows[0].c, 0, 'fixture must start without the FK');
  await db.exec(UP);

  // Row counts unchanged.
  assert.equal((await db.query('SELECT count(*)::int c FROM trust_score_history')).rows[0].c, 3);
  assert.equal((await db.query('SELECT count(*)::int c FROM rolling_integrity_checkpoints')).rows[0].c, 2);

  // Existing values preserved — timestamps land on the same instant.
  const t = await db.query(`SELECT entity_id, previous_score, new_score, trigger_event,
      to_char("timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS ts_utc
      FROM trust_score_history ORDER BY id`);
  assert.equal(t.rows[0].previous_score, 10.5);
  assert.equal(t.rows[0].new_score, 20.25);
  assert.equal(t.rows[0].trigger_event, 'evidence_added');
  assert.ok(String(t.rows[0].ts_utc).startsWith('2026-08-08 02:05:01.372'), `instant preserved, got ${t.rows[0].ts_utc}`);
  assert.ok(String(t.rows[2].ts_utc).startsWith('2026-01-15 06:00:00'), `+02:00 zone honored, got ${t.rows[2].ts_utc}`);
  const rc = await db.query('SELECT vin, last_verified_event_id, rolling_hash FROM rolling_integrity_checkpoints ORDER BY vin');
  assert.equal(Number(rc.rows[1].last_verified_event_id), 2147483647);
  assert.equal(rc.rows[0].rolling_hash, 'hash-a');

  // Final types/nullability exact (the runtime contract).
  const shape = await db.query(`SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('trust_score_history','rolling_integrity_checkpoints')`);
  const m = new Map(shape.rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));
  for (const [key, typ, nul] of [
    ['trust_score_history.previous_score', 'real', 'YES'],
    ['trust_score_history.new_score', 'real', 'YES'],
    ['trust_score_history.trigger_event', 'text', 'YES'],
    ['trust_score_history.timestamp', 'timestamp with time zone', 'NO'],
    ['rolling_integrity_checkpoints.last_verified_event_id', 'bigint', 'YES'],
  ]) {
    const a = m.get(key);
    assert.ok(a && a.data_type === typ && a.is_nullable === nul, `${key} => ${a?.data_type}/${a?.is_nullable}, want ${typ}/${nul}`);
  }

  // id sequence intact; vin-exact PK/UNIQUE intact; vin FK now present.
  assert.ok((await db.query("SELECT pg_get_serial_sequence('public.trust_score_history','id') s")).rows[0].s);
  const vin = await db.query(`SELECT count(*)::int c FROM pg_constraint
     WHERE conrelid = to_regclass('public.rolling_integrity_checkpoints') AND contype IN ('p','u')
       AND (SELECT array_agg(attname::text) FROM unnest(conkey) k JOIN pg_attribute a
             ON a.attrelid = conrelid AND a.attnum = k) = array['vin']`);
  assert.equal(vin.rows[0].c, 1);
  assert.equal((await db.query(FK_QUERY)).rows[0].c, 1, 'legacy PK-only shape must gain the canonical FK');

  // Runtime inserts/upserts succeed post-convergence (ISO-string timestamp,
  // omitted nullable columns, bigint beyond int range, onConflict:'vin').
  await db.exec(`INSERT INTO trust_score_history (entity_type, entity_id, "timestamp")
                 VALUES ('vehicle', 'VIN-3', '2026-08-10T12:00:00.000Z');`);
  await db.exec(`INSERT INTO rolling_integrity_checkpoints (vin, last_verified_event_id, rolling_hash, verified_at)
                 VALUES ('VIN-1', 9999999999, 'hash-a2', '2026-08-10T12:00:00.000Z')
                 ON CONFLICT (vin) DO UPDATE SET last_verified_event_id = EXCLUDED.last_verified_event_id,
                   rolling_hash = EXCLUDED.rolling_hash, verified_at = EXCLUDED.verified_at;`);
  assert.equal(Number((await db.query("SELECT last_verified_event_id FROM rolling_integrity_checkpoints WHERE vin='VIN-1'")).rows[0].last_verified_event_id), 9999999999);
  assert.equal((await db.query('SELECT count(*)::int c FROM trust_score_history')).rows[0].c, 4);

  // Rerun idempotent: same session, zero changes, no duplicate FK, no errors.
  await db.exec(UP);
  assert.equal((await db.query('SELECT count(*)::int c FROM trust_score_history')).rows[0].c, 4);
  assert.equal((await db.query(FK_QUERY)).rows[0].c, 1, 'rerun must not duplicate the FK');
  const fkCount = await db.query(`SELECT count(*)::int c FROM pg_constraint
     WHERE conrelid = to_regclass('public.rolling_integrity_checkpoints') AND contype='f'`);
  assert.equal(fkCount.rows[0].c, 1, 'exactly one vin FK after rerun');
  await db.close();
});

test('FK enforcement after convergence: nonexistent VIN rejected, vehicle delete cascades', async () => {
  const db = await legacyDb();
  await db.exec(UP);

  // Checkpoints for nonexistent vehicles are now impossible.
  await assert.rejects(
    () => db.exec(`INSERT INTO rolling_integrity_checkpoints (vin, last_verified_event_id, rolling_hash, verified_at)
                   VALUES ('VIN-GHOST', 1, 'h', '2026-08-10T12:00:00Z');`),
    (e) => String(e?.message || e).toLowerCase().includes('foreign key'));

  // Existing valid rows are untouched by convergence.
  assert.equal((await db.query('SELECT count(*)::int c FROM rolling_integrity_checkpoints')).rows[0].c, 2);
  assert.equal((await db.query("SELECT rolling_hash FROM rolling_integrity_checkpoints WHERE vin='VIN-2'")).rows[0].rolling_hash, 'hash-b');

  // ON DELETE CASCADE: removing a vehicle removes its checkpoint only.
  await db.exec("DELETE FROM vehicles WHERE vin='VIN-1';");
  const left = await db.query('SELECT vin FROM rolling_integrity_checkpoints ORDER BY vin');
  assert.deepEqual(left.rows.map((r) => r.vin), ['VIN-2'], 'VIN-1 checkpoint cascaded, VIN-2 retained');
  await db.close();
});

test('fail-closed: orphaned checkpoint rows abort convergence before any ledgering', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(VEHICLES_FIXTURE);
  await db.exec(PRODUCTION_LEGACY_FIXTURE);
  // Legacy tables have no FK, so an orphan can already exist on production.
  await db.exec(`INSERT INTO rolling_integrity_checkpoints (vin, last_verified_event_id, rolling_hash, verified_at)
                 VALUES ('VIN-ORPHAN', 7, 'hash-orphan', '2026-08-08T02:23:05.653Z');`);
  await assert.rejects(() => db.exec(UP), (e) =>
    String(e?.message || e).includes('reference a nonexistent vehicles.vin'));
  // Nothing converged: no FK added and the orphan is left for an operator.
  assert.equal((await db.query(FK_QUERY)).rows[0].c, 0);
  assert.equal((await db.query('SELECT count(*)::int c FROM rolling_integrity_checkpoints')).rows[0].c, 3);
  await db.close();
});

test('timestamp gate: date-only, zone-less, and invalid values FAIL; Z and ±HH[:MM] PASS', async () => {
  const cases = [
    // [value, shouldConverge, label]
    ['2026-08-08', false, 'date-only (castable, and its trailing -08 even looks like an offset)'],
    ['2026-08-08 12:30:00', false, 'datetime without timezone'],
    ['2026-08-08T12:30:00', false, 'ISO datetime without timezone'],
    ['not-a-timestamp', false, 'invalid timestamp'],
    ['2026-13-45T99:99:99Z', false, 'zone-suffixed but not a real instant'],
    ['2026-08-08T12:30:00Z', true, 'Z timezone'],
    ['2026-08-08 12:30:00+09', true, '+HH offset with space separator'],
    ['2026-08-08T12:30:00+09:00', true, '+HH:MM offset'],
    ['2026-08-08T12:30:00-05:00', true, '-HH:MM offset'],
    ['2026-08-08T12:30:00.372+0900', true, 'fractional seconds with +HHMM offset'],
  ];
  for (const [value, shouldConverge, label] of cases) {
    const db = await legacyDb();
    await db.exec(`INSERT INTO trust_score_history (entity_type, entity_id, previous_score, new_score, trigger_event, "timestamp")
                   VALUES ('vehicle', 'VIN-1', 1, 2, 'probe', ${JSON.stringify(value).replace(/"/g, "'")});`);
    if (shouldConverge) {
      await db.exec(UP);
      const col = await db.query(`SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='trust_score_history' AND column_name='timestamp'`);
      assert.equal(col.rows[0].data_type, 'timestamp with time zone', `${label} must PASS the gate`);
    } else {
      await assert.rejects(() => db.exec(UP),
        (e) => String(e?.message || e).includes('cannot be converted deterministically'),
        `${label} must FAIL the gate`);
      const col = await db.query(`SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='trust_score_history' AND column_name='timestamp'`);
      assert.equal(col.rows[0].data_type, 'text', `${label} must leave the column unconverted`);
    }
    await db.close();
  }
});

test('fresh database: every step no-ops and the canonical migration owns creation', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(UP); // both tables absent — must succeed silently
  assert.equal((await db.query("SELECT to_regclass('public.trust_score_history') t")).rows[0].t, null);
  // Canonical fresh-create still applies cleanly afterwards (it FKs
  // rolling_integrity_checkpoints.vin to vehicles.vin and grants to the
  // Supabase API roles, so stub both — as the main PGlite harness does).
  await db.exec(VEHICLES_FIXTURE);
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const canonical = fs.readFileSync(path.join(path.dirname(MIG), '20260809100000_trust_side_tables.sql'), 'utf8')
    .split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  await db.exec(canonical);
  const shape = await db.query(`SELECT count(*)::int c FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('trust_score_history','rolling_integrity_checkpoints')`);
  assert.equal(shape.rows[0].c, 11);
  // The canonical shape already satisfies the contract, FK included.
  assert.equal((await db.query(FK_QUERY)).rows[0].c, 1);
  // And a convergence rerun over the fresh canonical shape is a clean no-op.
  await db.exec(UP);
  assert.equal((await db.query(FK_QUERY)).rows[0].c, 1);
  await db.close();
});

test('convergence preserves RLS state and grants untouched', async () => {
  const db = await legacyDb();
  await db.exec('ALTER TABLE trust_score_history ENABLE ROW LEVEL SECURITY;');
  await db.exec(UP);
  const rls = await db.query(`SELECT relname, relrowsecurity FROM pg_class
     WHERE relname IN ('trust_score_history','rolling_integrity_checkpoints') ORDER BY relname`);
  assert.equal(rls.rows[1].relrowsecurity, true, 'enabled RLS stays enabled');
  assert.equal(rls.rows[0].relrowsecurity, false, 'disabled RLS stays disabled (posture is 20260809100000 business)');
  await db.close();
});
