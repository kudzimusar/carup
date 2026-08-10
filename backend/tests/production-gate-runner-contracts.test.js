import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression tests for the production publication-gate runner's trust-shape
 * validation (PR #144 Codex P1s). The runner cannot be imported (top-level
 * env guards call process.exit), so these tests EXTRACT its shipped SQL and
 * contract constants from source and execute them against PGlite — the same
 * bytes the dispatcher runs, not a reimplementation.
 */

const runnerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'production-apply-publication-gate.mjs');
const src = fs.readFileSync(runnerPath, 'utf8');

const VIN_QUERY_RE = /select count\(\*\)::int c from pg_constraint\s*\n\s*where conrelid = to_regclass\('public\.rolling_integrity_checkpoints'\) and contype in \('p','u'\)[\s\S]*?array\['vin'\]/;

function extractVinQuery() {
  const m = src.match(VIN_QUERY_RE);
  assert.ok(m, 'runner must ship a vin-exact constraint query (conkey/pg_attribute semantics)');
  return m[0];
}

function extractExpectedTrustShape() {
  const m = src.match(/const EXPECTED_TRUST_SHAPE = \[([\s\S]*?)\];/);
  assert.ok(m, 'runner must define EXPECTED_TRUST_SHAPE');
  return new Function(`return [${m[1]}]`)();
}

function extractShapeIntrospectionQuery() {
  const m = src.match(/select table_name, column_name, data_type, is_nullable\s*\n\s*from information_schema\.columns\s*\n\s*where table_schema='public' and table_name in \('trust_score_history','rolling_integrity_checkpoints'\)/);
  assert.ok(m, 'runner must ship the trust-shape introspection query');
  return m[0];
}

test("P1-1: unrelated or composite UNIQUE must NOT satisfy the vin constraint check; PK(vin) must", async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const vinQuery = extractVinQuery();

  // Unrelated UNIQUE on another column only — the old bare-existence count
  // would return 1 here; the vin-exact check must return 0 (FAIL detection).
  await db.exec(`
    CREATE TABLE rolling_integrity_checkpoints (
      vin TEXT,
      last_verified_event_id BIGINT,
      rolling_hash TEXT,
      verified_at TEXT,
      other_col TEXT,
      CONSTRAINT other_uq UNIQUE (other_col)
    );`);
  let r = await db.query(vinQuery);
  assert.equal(r.rows[0].c, 0, 'a UNIQUE on a non-vin column must not pass the vin-exact check');

  // Composite UNIQUE including vin is still not enough for onConflict:'vin'.
  await db.exec('ALTER TABLE rolling_integrity_checkpoints ADD CONSTRAINT pair_uq UNIQUE (vin, other_col);');
  r = await db.query(vinQuery);
  assert.equal(r.rows[0].c, 0, 'a composite UNIQUE (vin, other) must not pass the vin-exact check');

  // A PK covering exactly [vin] passes.
  await db.exec('ALTER TABLE rolling_integrity_checkpoints ADD PRIMARY KEY (vin);');
  r = await db.query(vinQuery);
  assert.equal(r.rows[0].c, 1, 'PK on exactly [vin] must pass');
  await db.close();
});

test('P1-2: divergent live trust shape is detected by the shipped introspection + contract', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const expected = extractExpectedTrustShape();
  const introspection = extractShapeIntrospectionQuery();
  assert.equal(expected.length, 11, 'contract covers all 11 columns');

  // Divergent shapes: trigger_event missing entirely; new_score is double
  // precision (not real); id is a bare bigint with NO backing sequence;
  // rolling_integrity_checkpoints carries only an unrelated UNIQUE.
  await db.exec(`
    CREATE TABLE trust_score_history (
      id BIGINT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      previous_score REAL,
      new_score DOUBLE PRECISION,
      "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE rolling_integrity_checkpoints (
      vin TEXT NOT NULL,
      last_verified_event_id BIGINT,
      rolling_hash TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      other_col TEXT,
      CONSTRAINT other_uq UNIQUE (other_col)
    );`);

  // Same comparison the runner performs over the same query results.
  const { rows } = await db.query(introspection);
  const actual = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));
  const mismatches = [];
  for (const [t, col, type, nullable] of expected) {
    const a = actual.get(`${t}.${col}`);
    if (!(a && a.data_type === type && a.is_nullable === nullable)) {
      mismatches.push(`${t}.${col}`);
    }
  }
  assert.ok(mismatches.includes('trust_score_history.trigger_event'), 'missing column detected');
  assert.ok(mismatches.includes('trust_score_history.new_score'), 'type divergence detected');

  const seq = await db.query("select pg_get_serial_sequence('public.trust_score_history','id') as s");
  assert.equal(seq.rows[0].s, null, 'bare bigint id has no backing sequence — must be flagged');

  const vin = await db.query(extractVinQuery());
  assert.equal(vin.rows[0].c, 0, 'unrelated UNIQUE must not satisfy the vin-exact check');
  await db.close();
});

test('P1-2 control flow: a recorded 20260809100000 can never bypass the shape contract', () => {
  // The pre-apply loop guard protects only a NOT-yet-recorded migration (its
  // `continue` skips everything for recorded versions), so the runner MUST
  // also enforce the shape in the post-apply contract section, which executes
  // on every apply invocation including verify-only re-dispatches.
  assert.ok(
    src.includes('trust-side tables pre-exist with a divergent shape'),
    'pre-apply guard present (fresh-apply path)');
  assert.ok(
    src.includes('trust-side migration recorded but the live shape diverges'),
    'post-apply recorded-version contract present (verify-only path)');
  assert.ok(
    src.includes('const after = post.dep;') && /after\.trustShapeMismatches/.test(src),
    'recorded-version contract must consume the freshly recomputed post-apply shape report');
  const contractIdx = src.indexOf('trust-side migration recorded but the live shape diverges');
  const postInspectIdx = src.indexOf("inspect(client, 'post-apply')");
  assert.ok(postInspectIdx !== -1 && contractIdx > postInspectIdx,
    'contract must run AFTER the post-apply inspection that recomputes the shape');
  // And the vin-exact mismatch feeds the same fail-closed report.
  assert.ok(
    src.includes("lacks a PK/UNIQUE covering exactly [vin]"),
    'vin-exact failure must land in trustShapeMismatches');
});
