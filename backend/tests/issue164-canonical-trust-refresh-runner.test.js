import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as R from '../scripts/production-refresh-canonical-trust-uatprd.mjs';

/**
 * Issue #164 — the one-off production canonical Trust refresh.
 *
 * This runner writes to production, so the tests are written around what it must REFUSE. The fake
 * database records every statement and the fake writer records every VIN it was asked for, which is
 * what lets a test prove the negative: that only one row was reachable, that a dry run persisted
 * nothing, and that no hand-written UPDATE was ever issued.
 */

const VIN = R.TARGET_VIN;
const CV = 'trust-decision-1.0.0';
const silent = () => {};

const GOOD_AFTER = {
  vin: VIN, trust_score: 12, trust_calculation_version: CV,
  trust_evaluated_at: '2026-08-26T00:00:00.000Z', trust_band: 'insufficient_evidence',
  trust_confidence: 'not_evaluated',
  trust_known_limitations: ['No governed vehicle fact is backed by an authoritative record.'],
  trust_evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 0 },
};

/** A fake production database. `state` is mutated only by the fake writer, never by the runner. */
class FakeDb {
  constructor({ target = { vin: VIN, ...R.BASELINE }, checksum = R.NONTARGET_CHECKSUM,
                rows = R.NONTARGET_ROWS, stamped = 0, unversioned = 352, total = 352, ledger = 61,
                inputs = R.DECISION_INPUT_FINGERPRINT } = {}) {
    Object.assign(this, { target, checksum, rows, stamped, unversioned, total, ledger, inputs });
    this.statements = [];
  }
  get writes() { return this.statements.filter((s) => /^\s*(insert|update|delete|alter|drop|truncate)\b/i.test(s)); }
  async query(sql, params) {
    this.statements.push(sql);
    if (/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/i.test(sql)) { this.snapshot = true; return { rows: [] }; }
    if (/^(COMMIT|ROLLBACK)$/i.test(sql)) { this.snapshot = false; return { rows: [] }; }
    if (/to_regclass\(\$1\)/i.test(sql)) {
      // trust_fact_requests is absent from production; its absence is part of what is pinned.
      return { rows: [{ t: String(params?.[0]).includes('trust_fact_requests') ? null : params[0] }] };
    }
    if (/to_regclass/i.test(sql)) return { rows: [{ t: 'vehicles' }] };
    if (/from public\.vehicles x where x\.vin/i.test(sql)) return { rows: [{ h: 'vh' }] };
    if (/string_agg\(to_jsonb\(x\)::text/i.test(sql) && /from public\.[a-z_]+ x where x\.vin/i.test(sql)) {
      return { rows: [{ h: 'h' }] };
    }
    if (/current_database/i.test(sql)) return { rows: [{ db: 'postgres' }] };
    if (/nontarget_checksum/i.test(sql)) {
      assert.equal(params[0], VIN, 'measurement must be scoped to the pinned VIN');
      return { rows: [{
        target: this.target, nontarget_checksum: this.checksum, nontarget_rows: this.rows,
        stamped: this.stamped, unversioned: this.unversioned, total_vehicles: this.total,
        ledger_rows: this.ledger, decision_inputs: this.inputs,
      }] };
    }
    throw new Error(`unmodelled statement: ${sql.slice(0, 70)}`);
  }
}

/** A fake canonical writer. Records the VINs asked for; honours dryRun. */
function fakeWriter(db, { after = GOOD_AFTER, written = true, record = { evaluation_state: 'evaluated' },
                          patch = null, persistOnDryRun = false } = {}) {
  patch = patch ?? { ...after };
  const calls = [];
  const fn = async (vin, opts = {}) => {
    calls.push({ vin, opts });
    const dry = opts.dryRun === true;
    if (!dry || persistOnDryRun) {
      db.target = { ...after }; db.stamped += 1; db.unversioned -= 1;
    }
    return { record, patch, written: dry ? (persistOnDryRun ? true : false) : written,
             reason: dry ? 'dry_run' : undefined };
  };
  fn.calls = calls;
  return fn;
}
const deps = (fn) => ({ refreshCanonicalTrust: fn, CALCULATION_VERSION: CV });

// ── the pin itself ───────────────────────────────────────────────────────────────────────────────

test('the VIN is a hard-pinned constant with no argument or environment override', () => {
  assert.equal(R.TARGET_VIN, 'UATPRD17830287622');
  const src = readFileSync(fileURLToPath(new URL('../scripts/production-refresh-canonical-trust-uatprd.mjs', import.meta.url)), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\S\r\n]*\/\/.*$/gm, '');
  assert.ok(!/process\.argv\[2\]|argv\.slice/.test(body), 'no CLI argument may reach the VIN');
  assert.ok(!/env\.(TARGET_)?VIN|VIN\s*=\s*process\.env/.test(body), 'no environment variable may override the VIN');
  assert.ok(!/for\s*\(.*of\s+VINS|VINS\s*=|vins\.map/i.test(body), 'no list or batch path may exist');
});

test('the runner never writes a trust column itself — the canonical writer is the only writer', () => {
  const src = readFileSync(fileURLToPath(new URL('../scripts/production-refresh-canonical-trust-uatprd.mjs', import.meta.url)), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\S\r\n]*\/\/.*$/gm, '');
  assert.ok(!/UPDATE\s+public\.vehicles|update\(\s*\{/i.test(body), 'no hand-written UPDATE may exist');
  assert.ok(!/SET\s+trust_/i.test(body), 'no direct trust column assignment may exist');
  assert.ok(/refreshCanonicalTrust\(TARGET_VIN/.test(body), 'it must call the real canonical writer');
});

// ── preflight ────────────────────────────────────────────────────────────────────────────────────

test('PREFLIGHT writes nothing, asks for exactly one VIN, and re-proves nothing moved', async () => {
  const db = new FakeDb();
  const w = fakeWriter(db);
  await R.runPreflight(db, deps(w), silent);

  assert.deepEqual(db.writes, [], 'preflight must issue no write statement');
  assert.equal(w.calls.length, 1, 'exactly one refresh call');
  assert.equal(w.calls[0].vin, VIN, 'and it must be the pinned VIN');
  assert.equal(w.calls[0].opts.dryRun, true, 'preflight must be a dry run');
  assert.deepEqual(db.target, { vin: VIN, ...R.BASELINE }, 'the target row must be untouched');
  assert.equal(db.stamped, 0);
});

test('PREFLIGHT refuses if the dry run reports a write', async () => {
  const db = new FakeDb();
  await assert.rejects(() => R.runPreflight(db, deps(fakeWriter(db, { persistOnDryRun: true })), silent),
    (e) => e instanceof R.RefreshRefusal && /DRY RUN REPORTED A WRITE/.test(e.message));
});

test('PREFLIGHT refuses if the dry run silently mutated production', async () => {
  const db = new FakeDb();
  // A writer that persists but still claims written:false — the receipt lies, the measurement does not.
  const sneaky = async (vin, opts) => {
    if (opts?.dryRun) { db.target = { ...GOOD_AFTER }; db.stamped = 1; db.unversioned = 351; }
    return { record: {}, patch: {}, written: false, reason: 'dry_run' };
  };
  await assert.rejects(() => R.runPreflight(db, deps(sneaky), silent),
    (e) => e instanceof R.RefreshRefusal && /PREFLIGHT MUTATED PRODUCTION/.test(e.message));
});

// ── baseline pinning ─────────────────────────────────────────────────────────────────────────────

test('APPLY refuses when the target has drifted from the certified baseline', async () => {
  for (const [field, value, rx] of [
    ['trust_score', 81, /target trust_score is 81/],
    ['trust_calculation_version', CV, /target trust_calculation_version is/],
    ['trust_band', 'high', /target trust_band is/],
  ]) {
    const db = new FakeDb({ target: { vin: VIN, ...R.BASELINE, [field]: value } });
    await assert.rejects(() => R.runApply(db, deps(fakeWriter(db)), silent),
      (e) => e instanceof R.RefreshRefusal && /PRODUCTION HAS MOVED SINCE CERTIFICATION/.test(e.message) && rx.test(e.message));
  }
});

test('APPLY refuses when the NON-TARGET checksum has moved before it starts', async () => {
  const db = new FakeDb({ checksum: 'deadbeefdeadbeefdeadbeefdeadbeef' });
  const w = fakeWriter(db);
  await assert.rejects(() => R.runApply(db, deps(w), silent),
    (e) => e instanceof R.RefreshRefusal && /non-target trust checksum is deadbeef/.test(e.message));
  assert.equal(w.calls.length, 0, 'it must refuse BEFORE invoking the writer');
});

test('APPLY refuses when the target is unexpectedly already stamped', async () => {
  const db = new FakeDb({ target: { vin: VIN, ...R.BASELINE, trust_calculation_version: CV }, stamped: 1, unversioned: 351 });
  await assert.rejects(() => R.runApply(db, deps(fakeWriter(db)), silent),
    (e) => e instanceof R.RefreshRefusal && /already stamped|trust_calculation_version is/.test(e.message));
});

test('APPLY refuses when the target VIN does not exist', async () => {
  const db = new FakeDb({ target: null });
  await assert.rejects(() => R.runApply(db, deps(fakeWriter(db)), silent),
    (e) => e instanceof R.RefreshRefusal && /does not exist in this database/.test(e.message));
});

// ── apply and blast radius ───────────────────────────────────────────────────────────────────────

test('APPLY: one refresh, one VIN, one row stamped, 351 untouched', async () => {
  const db = new FakeDb();
  const w = fakeWriter(db);
  const { after } = await R.runApply(db, deps(w), silent);

  assert.equal(w.calls.length, 2, 'apply proposes, then persists');
  assert.ok(w.calls.every((c) => c.vin === VIN), 'every call must name the pinned VIN');
  assert.equal(w.calls[0].opts?.dryRun, true, 'the first call proposes');
  assert.notEqual(w.calls[1].opts?.dryRun, true, 'the second call persists');
  assert.deepEqual(db.writes, [], 'the runner itself issues no SQL write — the writer does the writing');
  assert.equal(after.stamped, 1);
  assert.equal(after.unversioned, 351);
  assert.equal(after.nontarget_checksum, R.NONTARGET_CHECKSUM);
  assert.equal(db.ledger, 61, 'the migrations ledger must not be touched');
});

test('a low score with insufficient_evidence is a PASS, not a failure', async () => {
  const db = new FakeDb();
  const zero = { ...GOOD_AFTER, trust_score: 0, trust_band: 'insufficient_evidence', trust_confidence: 'not_evaluated' };
  await R.runApply(db, deps(fakeWriter(db, { after: zero })), silent);   // must not throw
  assert.equal(db.target.trust_score, 0);
});

test('BLAST RADIUS: a single non-target row changing is a production incident', async () => {
  const db = new FakeDb();
  const w = async (vin, opts = {}) => {
    if (opts.dryRun) return { record: {}, patch: { ...GOOD_AFTER }, written: false, reason: 'dry_run' };
    db.target = { ...GOOD_AFTER }; db.stamped += 1; db.unversioned -= 1;
    db.checksum = 'ffffffffffffffffffffffffffffffff';   // one other row moved
    return { record: {}, patch: { ...GOOD_AFTER }, written: true };
  };
  await assert.rejects(() => R.runApply(db, deps(w), silent),
    (e) => e instanceof R.RefreshRefusal && /PRODUCTION INCIDENT: a non-target trust field changed/.test(e.message));
});

test('BLAST RADIUS: a second VIN acquiring a version is refused', async () => {
  const db = new FakeDb();
  const w = async (vin, opts = {}) => {
    if (opts.dryRun) return { record: {}, patch: { ...GOOD_AFTER }, written: false, reason: 'dry_run' };
    db.target = { ...GOOD_AFTER }; db.stamped += 2; db.unversioned -= 2;
    return { record: {}, patch: { ...GOOD_AFTER }, written: true };
  };
  await assert.rejects(() => R.runApply(db, deps(w), silent),
    (e) => e instanceof R.RefreshRefusal && /canonically stamped is 2, expected exactly 1/.test(e.message));
});

test('BLAST RADIUS: writing the migrations ledger is refused — this is not a migration', async () => {
  const db = new FakeDb();
  const w = async (vin, opts = {}) => {
    if (opts.dryRun) return { record: {}, patch: { ...GOOD_AFTER }, written: false, reason: 'dry_run' };
    db.target = { ...GOOD_AFTER }; db.stamped += 1; db.unversioned -= 1; db.ledger += 1;
    return { record: {}, patch: { ...GOOD_AFTER }, written: true };
  };
  await assert.rejects(() => R.runApply(db, deps(w), silent),
    (e) => e instanceof R.RefreshRefusal && /not a migration/.test(e.message));
});

test('APPLY refuses when the writer persisted nothing', async () => {
  const db = new FakeDb();
  const w = async () => ({ record: { evaluation_state: 'not_evaluated' }, patch: null, written: false, reason: 'not_canonical:not_evaluated' });
  await assert.rejects(() => R.runApply(db, deps(w), silent),
    (e) => e instanceof R.RefreshRefusal && /persisted nothing/.test(e.message));
});

// ── the after-state contract ─────────────────────────────────────────────────────────────────────

test('assertTargetAdvanced rejects every incomplete or invalid stamp', () => {
  const ok = { target: GOOD_AFTER };
  assert.doesNotThrow(() => R.assertTargetAdvanced(ok, CV));
  for (const [patch, rx] of [
    [{ trust_calculation_version: 'trust-decision-0.9.0' }, /expected the running/],
    [{ trust_calculation_version: null }, /expected the running/],
    [{ trust_evaluated_at: null }, /trust_evaluated_at is null/],
    [{ trust_score: null }, /not numeric within 0\.\.100/],
    [{ trust_score: 101 }, /not numeric within 0\.\.100/],
    [{ trust_score: -1 }, /not numeric within 0\.\.100/],
    [{ trust_band: 'excellent' }, /not a canonical band/],
    [{ trust_confidence: 'certain' }, /not a canonical confidence/],
    [{ trust_evidence_basis: {} }, /trust_evidence_basis is empty/],
    [{ trust_evidence_basis: null }, /trust_evidence_basis is empty/],
    [{ trust_known_limitations: [] }, /trust_known_limitations is empty/],
  ]) {
    assert.throws(() => R.assertTargetAdvanced({ target: { ...GOOD_AFTER, ...patch } }, CV),
      (e) => e instanceof R.RefreshRefusal && rx.test(e.message), `expected refusal for ${JSON.stringify(patch)}`);
  }
  // A score of 0 is legitimate and must NOT be rejected by a truthiness slip.
  assert.doesNotThrow(() => R.assertTargetAdvanced({ target: { ...GOOD_AFTER, trust_score: 0 } }, CV));
});

// ── environment / identity ───────────────────────────────────────────────────────────────────────

test('environment: production identity, confirmation, and the generic-secret trap', () => {
  const ref = 'aaaaaaaaaaaaaaaaaaaa';
  const good = {
    PRODUCTION_DATABASE_URL: `postgres://u:p@db.${ref}.supabase.co/postgres`,
    PRODUCTION_PROJECT_REF: ref,
    PRODUCTION_SUPABASE_SERVICE_ROLE_KEY: 'svc',
  };
  assert.equal(R.resolveMode(good).mode, 'preflight');
  assert.equal(R.resolveMode({ ...good, MODE: 'apply', CONFIRM_APPLY: R.CONFIRM_TOKEN }).mode, 'apply');
  assert.equal(R.resolveMode(good).apiUrl, `https://${ref}.supabase.co`, 'the API URL is derived from the production ref');

  assert.throws(() => R.resolveMode({ ...good, MODE: 'apply', CONFIRM_APPLY: 'NO' }), R.RefreshRefusal);
  assert.throws(() => R.resolveMode({ ...good, MODE: 'apply' }), R.RefreshRefusal, 'apply without confirmation is refused');
  assert.throws(() => R.resolveMode({ ...good, MODE: 'apply', CONFIRM_APPLY: 'YES_I_AUTHORIZE_THE_TRUST_SCHEMA_ACTIVATION' }),
    R.RefreshRefusal, 'another cutover’s token must not authorize this one');
  assert.throws(() => R.resolveMode({ ...good, PRODUCTION_SUPABASE_SERVICE_ROLE_KEY: undefined }), R.RefreshRefusal);
  assert.throws(() => R.resolveMode({ ...good, PRODUCTION_PROJECT_REF: 'eoyenigwevnxwwhyhaer',
    PRODUCTION_DATABASE_URL: 'postgres://u:p@db.eoyenigwevnxwwhyhaer.supabase.co/postgres' }), R.RefreshRefusal);
  // The repo holds generic SUPABASE_URL secrets that are NOT proven to be production. A Supabase
  // API URL that does not name the production ref must be refused even when everything else is right.
  assert.throws(() => R.resolveMode({ ...good, PRODUCTION_SUPABASE_URL: 'https://someotherproject.supabase.co' }),
    (e) => e instanceof R.RefreshRefusal && /expected exactly aaaaaaaaaaaaaaaaaaaa\.supabase\.co/.test(e.message));
});

// ── credential exfiltration via lookalike hosts ──────────────────────────────────────────────────

/**
 * Found by exact-head review. The identity pin was `url.includes(ref)`, and a substring test is not
 * a host test: `https://<ref>.supabase.co.attacker.example` contains the ref, as does
 * `https://attacker.example/?x=<ref>`. Either would have satisfied it and then received the
 * production service-role key. The database URL had the same hole and would have leaked the
 * database password the same way.
 */
const REF = 'aaaaaaaaaaaaaaaaaaaa';
const baseEnv = {
  PRODUCTION_DATABASE_URL: `postgres://u:p@db.${REF}.supabase.co:5432/postgres`,
  PRODUCTION_PROJECT_REF: REF,
  PRODUCTION_SUPABASE_SERVICE_ROLE_KEY: 'svc',
};

test('the Supabase API origin must be EXACTLY https://<ref>.supabase.co', () => {
  assert.doesNotThrow(() => R.assertApiOrigin(`https://${REF}.supabase.co`, REF));
  for (const [url, rx] of [
    [`https://${REF}.supabase.co.attacker.example`, /expected exactly/],   // suffix
    [`https://evil-${REF}.supabase.co`,             /expected exactly/],   // prefix
    [`https://attacker.example/?x=${REF}`,          /expected exactly/],   // query-string
    [`https://attacker.example/${REF}`,             /expected exactly/],   // path
    [`https://${REF}.supabase.co.evil.co`,          /expected exactly/],
    [`http://${REF}.supabase.co`,                   /must be https/],      // downgrade
    [`https://${REF}.supabase.co:8443`,             /carries port/],
    ['not a url',                                   /not a parseable URL/],
  ]) {
    assert.throws(() => R.assertApiOrigin(url, REF),
      (e) => e instanceof R.RefreshRefusal && rx.test(e.message), `expected refusal for ${url}`);
  }
});

test('the database credential may only be sent to a Supabase-owned host', () => {
  // Both legitimate shapes: direct (ref in the host) and pooler (ref in the username).
  assert.doesNotThrow(() => R.assertDbHost(`postgres://u:p@db.${REF}.supabase.co:5432/postgres`, REF));
  assert.doesNotThrow(() => R.assertDbHost(`postgres://postgres.${REF}:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`, REF));

  for (const [url, rx] of [
    [`postgres://u:p@db.${REF}.supabase.co.attacker.example:5432/postgres`, /is not a Supabase host/],
    [`postgres://u:p@attacker.example:5432/${REF}`,                          /is not a Supabase host/],
    [`postgres://u:p@notsupabase.co:5432/postgres?ref=${REF}`,               /is not a Supabase host/],
    ['postgres://u:p@db.supabase.co:5432/postgres',                          /pinned to neither/],
  ]) {
    assert.throws(() => R.assertDbHost(url, REF),
      (e) => e instanceof R.RefreshRefusal && rx.test(e.message), `expected refusal for ${url}`);
  }
});

test('resolveMode refuses a lookalike API host end to end', () => {
  assert.equal(R.resolveMode(baseEnv).mode, 'preflight');
  assert.throws(() => R.resolveMode({ ...baseEnv, PRODUCTION_SUPABASE_URL: `https://${REF}.supabase.co.attacker.example` }),
    (e) => e instanceof R.RefreshRefusal && /expected exactly/.test(e.message));
  assert.throws(() => R.resolveMode({ ...baseEnv, PRODUCTION_DATABASE_URL: `postgres://u:p@evil.example/${REF}` }),
    (e) => e instanceof R.RefreshRefusal && /is not a Supabase host/.test(e.message));
});

// ── decision INPUTS are pinned, not just outputs — exact-head review, round two ──────────────────

/**
 * Pinning the seven cached OUTPUT columns is not enough. If evidence, source coverage, a fraud case,
 * escrow state, an eligibility request, or a governed vehicle column moves between certification and
 * apply, the outputs still look exactly as certified while the decision that gets persisted is one
 * nobody reviewed.
 */
test('APPLY refuses when the decision INPUTS have moved since certification', async () => {
  const db = new FakeDb({ inputs: 'ffffffffffffffffffffffffffffffff' });
  const w = fakeWriter(db);
  await assert.rejects(() => R.runApply(db, deps(w), silent),
    (e) => e instanceof R.RefreshRefusal && /the DECISION INPUTS for the target have changed/.test(e.message));
  assert.equal(w.calls.length, 0, 'it must refuse before invoking the writer');
});

test('PREFLIGHT refuses when the decision inputs have moved, and when a dry run changes them', async () => {
  await assert.rejects(() => R.runPreflight(new FakeDb({ inputs: 'aaaa' }), deps(fakeWriter(new FakeDb())), silent),
    (e) => e instanceof R.RefreshRefusal && /DECISION INPUTS/.test(e.message));

  const db = new FakeDb();
  const mutatesInputs = async () => { db.inputs = 'cccccccccccccccccccccccccccccccc'; return { record: {}, patch: {}, written: false, reason: 'dry_run' }; };
  await assert.rejects(() => R.runPreflight(db, deps(mutatesInputs), silent),
    (e) => e instanceof R.RefreshRefusal && /PREFLIGHT MUTATED PRODUCTION/.test(e.message));
});

test('APPLY refuses when what was persisted is not what was proposed seconds earlier', async () => {
  const db = new FakeDb();
  let call = 0;
  // The dry run proposes a score of 12; the real write lands 97 because an input moved mid-apply.
  const shifty = async (vin, opts = {}) => {
    call++;
    if (opts.dryRun) return { record: {}, patch: { ...GOOD_AFTER, trust_score: 12 }, written: false, reason: 'dry_run' };
    db.target = { ...GOOD_AFTER, trust_score: 97 }; db.stamped += 1; db.unversioned -= 1;
    return { record: {}, patch: { ...GOOD_AFTER, trust_score: 97 }, written: true };
  };
  await assert.rejects(() => R.runApply(db, deps(shifty), silent),
    (e) => e instanceof R.RefreshRefusal
        && /PERSISTED DECISION DOES NOT MATCH/.test(e.message)
        && /trust_score: proposed 12, persisted 97/.test(e.message));
});

test('the apply-time timestamp is allowed to differ from the proposed one', () => {
  const target = { ...GOOD_AFTER, trust_evaluated_at: '2026-08-26T09:99:99.000Z' };
  assert.doesNotThrow(() => R.assertPersistedMatchesProposed({ ...GOOD_AFTER }, target, () => {}));
});

// ── the pooler ref must be where Postgres actually routes ────────────────────────────────────────

/**
 * `dbUrl.includes(ref)` is satisfied by the ref sitting in the password, path or query string while
 * the connection routes to a different project entirely. Postgres routes a pooler connection on the
 * USERNAME, so that is where the ref must be read from.
 */
test('the pooler form binds the ref to the parsed username, not to the raw string', () => {
  assert.doesNotThrow(() => R.assertDbHost(`postgres://postgres.${REF}:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`, REF));
  assert.doesNotThrow(() => R.assertDbHost(`postgres://u:p@db.${REF}.supabase.co:5432/postgres`, REF));

  for (const [url, why] of [
    [`postgres://postgres.bbbbbbbbbbbbbbbbbbbb:p@aws-0-eu.pooler.supabase.com/postgres?x=${REF}`, 'ref in the query string, routes elsewhere'],
    [`postgres://postgres.bbbbbbbbbbbbbbbbbbbb:${REF}@aws-0-eu.pooler.supabase.com/postgres`, 'ref in the password'],
    [`postgres://postgres.bbbbbbbbbbbbbbbbbbbb:p@aws-0-eu.pooler.supabase.com/${REF}`, 'ref in the path'],
    [`postgres://u:p@db.bbbbbbbbbbbbbbbbbbbb.supabase.co/postgres?x=${REF}`, 'direct host of another project'],
  ]) {
    assert.throws(() => R.assertDbHost(url, REF),
      (e) => e instanceof R.RefreshRefusal && /pinned to neither/.test(e.message), `expected refusal: ${why}`);
  }
});

// ── JSONB key order, and inputs moving during apply — exact-head review, round three ────────────

/**
 * `trust_evidence_basis` is a JSONB column. Postgres does not preserve the JavaScript object's key
 * order when it returns the value through `row_to_json`, so a textual comparison reports drift
 * between two identical objects — and that failure lands AFTER the production write has already
 * succeeded, reporting a failed cutover for a write that worked. Comparison must be structural.
 */
test('a JSONB value that comes back with different key order is NOT drift', () => {
  const proposed = { trust_evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 0, connected_sources: 0 } };
  // Same content, keys in the order Postgres happened to serialize them.
  const persisted = { trust_evidence_basis: { connected_sources: 0, governed_facts_substantiated: 0, governed_facts_total: 7 } };
  assert.doesNotThrow(() => R.assertPersistedMatchesProposed(proposed, persisted, () => {}));

  // Nested objects and arrays too.
  assert.doesNotThrow(() => R.assertPersistedMatchesProposed(
    { trust_evidence_basis: { a: { x: 1, y: 2 }, list: [{ p: 1, q: 2 }] } },
    { trust_evidence_basis: { a: { y: 2, x: 1 }, list: [{ q: 2, p: 1 }] } }, () => {}));
});

test('a genuine JSONB content difference IS still drift', () => {
  assert.throws(() => R.assertPersistedMatchesProposed(
    { trust_evidence_basis: { governed_facts_total: 7 } },
    { trust_evidence_basis: { governed_facts_total: 8 } }, () => {}),
    (e) => e instanceof R.RefreshRefusal && /PERSISTED DECISION DOES NOT MATCH/.test(e.message));
  // Array ORDER is content, not formatting: a reordered list must not be waved through.
  assert.throws(() => R.assertPersistedMatchesProposed(
    { trust_known_limitations: ['a', 'b'] },
    { trust_known_limitations: ['b', 'a'] }, () => {}), R.RefreshRefusal);
});

/**
 * If an input moves after the writer's last read but before the post-apply measurement, the
 * persisted patch still equals the earlier proposal and every other check passes — while the cache
 * that just landed is already stale against the production state this run measured.
 */
test('APPLY refuses to declare success when an input moved during the write', async () => {
  const db = new FakeDb();
  const w = async (vin, opts = {}) => {
    if (opts.dryRun) return { record: {}, patch: { ...GOOD_AFTER }, written: false, reason: 'dry_run' };
    db.target = { ...GOOD_AFTER }; db.stamped += 1; db.unversioned -= 1;
    db.inputs = 'dddddddddddddddddddddddddddddddd';   // a fraud case is inserted mid-apply
    return { record: {}, patch: { ...GOOD_AFTER }, written: true };
  };
  await assert.rejects(() => R.runApply(db, deps(w), silent),
    (e) => e instanceof R.RefreshRefusal && /the decision INPUTS moved during apply/.test(e.message));
});

test('the fingerprint covers every VIN-scoped decision input, including the fact tables', async () => {
  // The nine FACT_INPUT_TABLES reached through resolveVehicleFacts determine trust_evidence_basis
  // and trust_known_limitations, so they belong in the pin as much as vehicle_evidence does.
  for (const t of ['vehicle_evidence', 'source_verification_coverage_public', 'fraud_cases',
                   'escrow_trust_sessions', 'eligibility_requests', 'zimra_declarations',
                   'cid_clearance_records', 'cvr_ownership_records', 'vid_inspections',
                   'insurance_records', 'zinara_licensing_records', 'trust_fact_requests',
                   'trust_audit_events', 'source_verification_results']) {
    assert.ok(R.DECISION_INPUT_TABLES.includes(t), `${t} must be part of the pinned fingerprint`);
  }
  const { FACT_INPUT_TABLES } = await import('../services/evidence/vehicleFactResolver.js');
  for (const t of FACT_INPUT_TABLES) {
    assert.ok(R.DECISION_INPUT_TABLES.includes(t), `FACT_INPUT_TABLES member ${t} is missing from the pin`);
  }
});

test('an ABSENT input table contributes a marker, so a table appearing later changes the digest', async () => {
  const db = new FakeDb();
  const digest = await R.decisionInputDigest(db, VIN);
  assert.ok(digest.includes('absent'), 'the absent trust_fact_requests must contribute a marker');
  assert.equal(digest.split('absent').length - 1, 1, 'exactly one table is absent in this model');
});

// ── the measurement must be one coherent snapshot ────────────────────────────────────────────────

/**
 * The digest is assembled from a query per input table, and the target state is read by another. Run
 * outside a snapshot, a row changing partway through yields a fingerprint describing no state
 * production was ever in — `vehicles` hashed before the change, a fact table after it — and apply
 * could then declare success over a cache that is already stale.
 */
test('every read in a measurement happens inside one REPEATABLE READ READ ONLY snapshot', async () => {
  const db = new FakeDb();
  await R.measureTrustState(db, VIN);

  const begin = db.statements.findIndex((x) => /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/i.test(x));
  const end = db.statements.findIndex((x) => /^ROLLBACK$/i.test(x));
  assert.ok(begin > -1, 'the measurement must open a snapshot');
  assert.ok(end > begin, 'and close it');

  const reads = db.statements
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => /select|to_regclass|md5/i.test(x));
  assert.ok(reads.length > 10, 'the measurement really is many queries');
  for (const { x, i } of reads) {
    assert.ok(i > begin && i < end, `read outside the snapshot: ${x.slice(0, 60)}`);
  }
  assert.deepEqual(db.writes, [], 'a measurement never writes');
});

test('the snapshot is released even when a measurement query throws', async () => {
  const db = new FakeDb();
  let n = 0;
  const real = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/to_regclass\(\$1\)/i.test(sql) && ++n === 3) throw new Error('connection reset');
    return real(sql, params);
  };
  await assert.rejects(() => R.measureTrustState(db, VIN), /connection reset/);
  assert.ok(db.statements.some((x) => /^ROLLBACK$/i.test(x)), 'the snapshot must still be rolled back');
});
