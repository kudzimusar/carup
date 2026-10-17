/**
 * OC-5F — #213 slice B, the seller funnel's compare column, on real PostgreSQL (PGlite).
 *
 * #213 had no test for this migration at all — its only proof was a column count inside a certified
 * staging gate. Built here over the repository's own Intelligence rollup migration (20260827130000),
 * with Supabase's default privileges applied:
 *   · Up adds a non-negative, NOT NULL `compare_adds` that existing rows read as 0, and re-applies
 *     cleanly (staging already holds the column — #213's gate applied the SQL directly);
 *   · the table keeps its posture: RLS forced, no client role can read the new column;
 *   · Down, twice, then Up again, round-trips;
 *   · and — beyond #213 — on a database WITHOUT the Intelligence tables, Up RAISES. #213's
 *     `ALTER TABLE IF EXISTS` did nothing there and raised nothing, while the production runner
 *     records the migration as applied either way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const ALL = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const FILE = '20261004200000_seller_intelligence_compare_funnel.sql';
const ROLLUPS = '20260827130000_intelligence_rollups.sql';

const read = (file) => readFileSync(`${MIGRATIONS}${file}`, 'utf8');
const up = (file) => read(file).split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = (file) => read(file).split('-- +migrate Down')[1];

async function database({ withRollups = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  `);
  if (withRollups) await db.exec(up(ROLLUPS));
  return db;
}

const refusal = async (promise) => { try { await promise; return null; } catch (error) { return error.message; } };

test('order: re-stamped into OC-5F\'s range, after what it alters, sharing no timestamp; #213\'s stamp is gone', () => {
  assert.ok(ALL.includes(FILE));
  assert.ok(!ALL.includes('20260928133000_seller_intelligence_compare_funnel.sql'), '#213\'s copy would sort ahead of 18 lineage migrations');
  assert.ok(ROLLUPS < FILE);
  assert.match(FILE, /^2026100420\d{4}_/);
  assert.deepEqual(ALL.filter((f) => f !== FILE && f.slice(0, 14) === FILE.slice(0, 14)), []);
  assert.ok(ALL.filter((f) => /^2026100419\d{4}_/.test(f)).every((f) => f < FILE), 'OC-5F follows OC-5E');
});

test('Up: a non-negative NOT NULL column that existing rows read as 0 — and it re-applies cleanly', async () => {
  const db = await database();
  try {
    await db.query(`INSERT INTO seller_daily_metrics (metric_date, seller_user_id, calculation_version) VALUES ('2026-10-01', 'seller-1', 'rollup@1')`);
    await db.exec(up(FILE));
    await db.exec(up(FILE));
    const { rows: [col] } = await db.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
                                            WHERE table_name = 'seller_daily_metrics' AND column_name = 'compare_adds'`);
    assert.deepEqual({ type: col.data_type, nullable: col.is_nullable, def: col.column_default }, { type: 'integer', nullable: 'NO', def: '0' });
    const { rows: [existing] } = await db.query(`SELECT compare_adds FROM seller_daily_metrics WHERE seller_user_id = 'seller-1'`);
    assert.equal(existing.compare_adds, 0, 'a rollup@1 row reads 0 — not null, not invented');
    assert.match(await refusal(db.query(`INSERT INTO seller_daily_metrics (metric_date, seller_user_id, calculation_version, compare_adds) VALUES ('2026-10-02', 'seller-1', 'rollup@2', -1)`)),
      /sdm_compare_adds_nonnegative/);
    const { rows: constraints } = await db.query(`SELECT conname FROM pg_constraint WHERE conname = 'sdm_compare_adds_nonnegative'`);
    assert.equal(constraints.length, 1, 're-applying does not duplicate the constraint');
  } finally { await db.close(); }
});

test('posture: RLS stays forced and no client role can read the new column', async () => {
  const db = await database();
  try {
    await db.exec(up(FILE));
    const { rows: [t] } = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.seller_daily_metrics'::regclass`);
    assert.deepEqual(t, { relrowsecurity: true, relforcerowsecurity: true });
    const { rows: [p] } = await db.query(`
      SELECT has_column_privilege('anon', 'public.seller_daily_metrics', 'compare_adds', 'SELECT') AS anon,
             has_column_privilege('authenticated', 'public.seller_daily_metrics', 'compare_adds', 'SELECT') AS auth,
             has_column_privilege('service_role', 'public.seller_daily_metrics', 'compare_adds', 'SELECT') AS service`);
    assert.deepEqual(p, { anon: false, auth: false, service: true });
  } finally { await db.close(); }
});

test('Down, twice, then Up again round-trips', async () => {
  const db = await database();
  try {
    await db.exec(up(FILE));
    await db.exec(down(FILE));
    await db.exec(down(FILE));
    const { rows: gone } = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'seller_daily_metrics' AND column_name = 'compare_adds'`);
    assert.equal(gone.length, 0);
    await db.exec(up(FILE));
    const { rows: back } = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'seller_daily_metrics' AND column_name = 'compare_adds'`);
    assert.equal(back.length, 1);
  } finally { await db.close(); }
});

test('beyond #213: without the Intelligence tables, Up raises instead of recording a silent no-op', async () => {
  const db = await database({ withRollups: false });
  try {
    assert.match(await refusal(db.exec(up(FILE))), /seller_daily_metrics is missing/);
  } finally { await db.close(); }
});
