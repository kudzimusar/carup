/**
 * Issue #164 Phase 8 — test-environment database containment.
 *
 * These fail on the physically-tested baseline `993c1179`, where `backend/db/supabase.js` called
 * `dotenv.config()` with no containment at all. On a maintainer's machine that loads the PRODUCTION
 * `.env`, so `provision-staging-qa-accounts.test.js` opened a `pg.Client` against the production
 * database from a `NODE_ENV=test` process. It failed only because the password had been rotated
 * (`28P01`) — the connection attempt itself was the breach, and nothing reported it as one.
 *
 * No production credential, host or connection is required to prove any of this: the guard is a pure
 * function over an environment object, and it rejects BEFORE a client is constructed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTestDatabaseContainment,
  guardedDotfileValues,
  referencesProductionDatabase,
  ProductionDatabaseInTestError,
  GUARDED_DATABASE_VARS,
} from '../db/testDatabaseContainment.js';

/** The production project ref, assembled the same way the guard does — never a literal. */
const PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');

// Credential-FREE URIs. These carried a `postgres:redacted@` userinfo section until the CR-1 scanner
// flagged them as credential-bearing postgres URIs — correctly, because the shape is what it matches,
// and a scanner that learns to ignore a shape because "this one is fake" is no longer a scanner. The
// guard compares on the project ref alone, so userinfo was never needed to exercise it.
const PROD_DB_URL = `postgresql://db.${PROD_REF}.supabase.co:5432/postgres`;
const LOCAL_DB_URL = 'postgres://localhost:5432/postgres';
const STAGING_DB_URL = 'postgresql://db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres';

// ── Rule 2 — a production target under test mode is refused before any connection ─────────────────

test('THE DEFECT: a DELIBERATELY exported production database under NODE_ENV=test is refused', () => {
  for (const variable of GUARDED_DATABASE_VARS) {
    // NOT defined by the dotfile, i.e. the real environment exported it — an explicit export is not
    // consent to point a test suite at production.
    const env = { NODE_ENV: 'test', [variable]: PROD_DB_URL };
    assert.throws(
      () => applyTestDatabaseContainment(env, guardedDotfileValues(null)),
      ProductionDatabaseInTestError,
      `${variable} must be refused`,
    );
  }
});

test('THE OBSERVED VECTOR: an INHERITED production database is dropped, not thrown on', () => {
  // This is the exact situation on a maintainer's machine: `.env` IS the production file, and
  // dotenv.config() injects its SUPABASE_DB_URL into a test process that had none. Throwing here
  // would make the whole backend suite unrunnable and block certification rather than protect it;
  // dropping restores precisely the behaviour CI has always had.
  const env = { NODE_ENV: 'test', SUPABASE_DB_URL: PROD_DB_URL };
  // dotenv reports what the file defines; the value in the environment matches it.
  const result = applyTestDatabaseContainment(env, guardedDotfileValues({ SUPABASE_DB_URL: PROD_DB_URL }));

  assert.equal(env.SUPABASE_DB_URL, undefined, 'production must not survive into the test process');
  assert.deepEqual(result.removed, ['SUPABASE_DB_URL (PRODUCTION)'], 'and it must be reported as such');
});

test('the rejection names the variable and happens before any client is constructed', () => {
  const env = { NODE_ENV: 'test', SUPABASE_DB_URL: PROD_DB_URL };
  try {
    // Not supplied by the dotfile, so the environment exported it — the refusal path.
    applyTestDatabaseContainment(env, guardedDotfileValues(null));
    assert.fail('expected a ProductionDatabaseInTestError');
  } catch (err) {
    assert.equal(err.name, 'ProductionDatabaseInTestError');
    assert.equal(err.variable, 'SUPABASE_DB_URL');
    assert.match(err.message, /NODE_ENV=test/);
    // The guard must not leak the credential it refused.
    // The message names the VARIABLE, never the value it refused.
    assert.doesNotMatch(err.message, /postgresql:\/\/|postgres:\/\/|supabase\.co/);
  }
});

test('production is detected in any URL shape, and nothing else is mistaken for it', () => {
  assert.equal(referencesProductionDatabase(PROD_DB_URL), true);
  assert.equal(referencesProductionDatabase(`https://${PROD_REF}.supabase.co`), true);
  assert.equal(referencesProductionDatabase(STAGING_DB_URL), false);
  assert.equal(referencesProductionDatabase(LOCAL_DB_URL), false);
  assert.equal(referencesProductionDatabase(undefined), false);
});

// ── Rule 1 — a dotfile may not inject a database into a test process ──────────────────────────────

test('THE VECTOR: a database URL injected by a dotfile into a test process is dropped', () => {
  // Exactly the observed sequence: the process had no SUPABASE_DB_URL, dotenv.config() added one.
  const env = { NODE_ENV: 'test', SUPABASE_DB_URL: STAGING_DB_URL };
  const result = applyTestDatabaseContainment(env, guardedDotfileValues({ SUPABASE_DB_URL: STAGING_DB_URL }));

  assert.equal(env.SUPABASE_DB_URL, undefined, 'the inherited URL must not survive');
  assert.deepEqual(result.removed, ['SUPABASE_DB_URL']);
  // The live-database branch then simply does not run — the same behaviour CI has always had.
});

test('a DELIBERATELY exported non-production database URL is preserved', () => {
  // CI's own harnesses: postgres service containers and PGlite, exported by the workflow.
  const env = { NODE_ENV: 'test', SUPABASE_DB_URL: LOCAL_DB_URL };
  const result = applyTestDatabaseContainment(env, guardedDotfileValues(null));

  assert.equal(env.SUPABASE_DB_URL, LOCAL_DB_URL, 'an explicit test database must still work');
  assert.deepEqual(result.removed, []);
});

test('an explicitly exported STAGING database is preserved — this guard is about production', () => {
  const env = { NODE_ENV: 'test', DIASPORA_STAGING_DATABASE_URL: STAGING_DB_URL };
  applyTestDatabaseContainment(env, guardedDotfileValues(null));
  assert.equal(env.DIASPORA_STAGING_DATABASE_URL, STAGING_DB_URL);
});

test('an environment value that OVERRIDES the dotfile is treated as deliberate', () => {
  // dotenv does not overwrite an existing variable, so this is a real shape: the file says one thing,
  // the environment says another, and the environment's value is the one in force.
  const env = { NODE_ENV: 'test', SUPABASE_DB_URL: LOCAL_DB_URL };
  const result = applyTestDatabaseContainment(env, guardedDotfileValues({ SUPABASE_DB_URL: STAGING_DB_URL }));
  assert.equal(env.SUPABASE_DB_URL, LOCAL_DB_URL, 'the deliberate value must survive');
  assert.deepEqual(result.removed, []);
});

// ── Blast radius ──────────────────────────────────────────────────────────────────────────────────

test('CI is unaffected: with no dotfile there is nothing to inherit and nothing changes', () => {
  const env = { NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', JWT_SECRET: 'test-jwt-secret' };
  const before = { ...env };
  const result = applyTestDatabaseContainment(env, guardedDotfileValues(null));
  assert.deepEqual(env, before, 'no variable may be added or removed');
  assert.deepEqual(result.removed, []);
});

test('non-test processes are untouched — the server still reads its own environment', () => {
  for (const NODE_ENV of ['production', 'development', undefined]) {
    const env = { NODE_ENV, SUPABASE_DB_URL: PROD_DB_URL };
    const result = applyTestDatabaseContainment(env, {});
    assert.equal(result.applied, false);
    assert.equal(env.SUPABASE_DB_URL, PROD_DB_URL, 'production runtime must keep its own database');
  }
});

test('only the three connectable database variables are guarded, and no others are inspected', () => {
  assert.deepEqual([...GUARDED_DATABASE_VARS].sort(),
    ['DATABASE_URL', 'DIASPORA_STAGING_DATABASE_URL', 'SUPABASE_DB_URL']);
  // COMMUNICATION_STAGING_DATABASE_URL is supplied explicitly by its own workflow under NODE_ENV=test
  // and is deliberately none of this guard's business.
  const env = { NODE_ENV: 'test', COMMUNICATION_STAGING_DATABASE_URL: STAGING_DB_URL, OTHER_URL: PROD_DB_URL };
  applyTestDatabaseContainment(env, {});
  assert.equal(env.COMMUNICATION_STAGING_DATABASE_URL, STAGING_DB_URL);
  assert.equal(env.OTHER_URL, PROD_DB_URL);
});

// ── The wiring, not just the function ─────────────────────────────────────────────────────────────

test('supabase.js applies containment at import, after dotenv and before any client use', async () => {
  const raw = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../db/supabase.js', import.meta.url), 'utf8'));
  // Comments in this file legitimately quote `dotenv.config()` while explaining the vector, and a
  // naive search matched the prose instead of the call. Order is a property of the CODE.
  const source = raw.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

  const dotenvAt = source.indexOf('dotenv.config()');
  const containAt = source.indexOf('applyTestDatabaseContainment(process.env');
  const clientAt = source.indexOf('createClient(');

  assert.ok(dotenvAt > -1 && containAt > -1, 'must load dotenv and then contain');
  assert.ok(source.includes('guardedDotfileValues(dotfile.parsed)'),
    'containment must be fed the dotfile contents, not a process.env snapshot');
  assert.ok(dotenvAt < containAt, 'containment must run AFTER dotenv, or there is nothing to contain');
  assert.ok(containAt < clientAt, 'containment must run BEFORE any client is constructed');
});

// ── Codex P1: the Supabase REST endpoint, not only the Postgres URLs ─────────────────────────────
// `db/supabase.js` builds a SERVICE-ROLE client from SUPABASE_URL right after dotenv.config(). On a
// maintainer's machine that dotfile supplies the PRODUCTION project, and 24 backend test files do
// `process.env.SUPABASE_URL ||= 'http://localhost:54321'` — which PRESERVES the inherited value. So
// every Supabase read and write in those files was aimed at production with an RLS-bypassing key,
// while the earlier guard only ever looked at Postgres connection strings.

test('a dotfile-supplied PRODUCTION Supabase endpoint is neutralised under test', () => {
  const env = {
    NODE_ENV: 'test',
    SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'a-real-production-service-role-key',
  };
  const result = applyTestDatabaseContainment(env, guardedDotfileValues({ ...env }));

  assert.equal(env.SUPABASE_URL, 'http://localhost:54321', 'the REST endpoint must not stay on production');
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, 'test-service-role-key', 'the service-role key must not survive');
  assert.ok(result.removed.some((r) => r.startsWith('SUPABASE_URL')));
});

test('the endpoint is SUBSTITUTED, never deleted — db/supabase.js throws without it', () => {
  const env = { NODE_ENV: 'test', SUPABASE_URL: `https://${PROD_REF}.supabase.co` };
  applyTestDatabaseContainment(env, guardedDotfileValues({ ...env }));
  assert.ok(env.SUPABASE_URL, 'a value must remain, or every test aborts at import');
  assert.doesNotMatch(env.SUPABASE_URL, new RegExp(PROD_REF));
});

test('an explicitly exported production endpoint is REFUSED, not silently rewritten', () => {
  const env = { NODE_ENV: 'test', SUPABASE_URL: `https://${PROD_REF}.supabase.co` };
  assert.throws(() => applyTestDatabaseContainment(env, guardedDotfileValues(null)),
    ProductionDatabaseInTestError);
});

test('CI is still byte-identical: explicit localhost values are untouched', () => {
  const env = {
    NODE_ENV: 'test',
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    SUPABASE_ANON_KEY: 'test-anon-key',
  };
  const before = { ...env };
  const result = applyTestDatabaseContainment(env, guardedDotfileValues(null));
  assert.deepEqual(env, before);
  assert.deepEqual(result.removed, []);
});

test('a non-test process keeps its own Supabase endpoint', () => {
  const env = { NODE_ENV: 'production', SUPABASE_URL: `https://${PROD_REF}.supabase.co` };
  applyTestDatabaseContainment(env, guardedDotfileValues({ ...env }));
  assert.match(env.SUPABASE_URL, new RegExp(PROD_REF), 'production runtime must keep its own project');
});
