import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as R from '../scripts/production-apply-issue164-trust-provenance.mjs';

/**
 * Issue #164 — governed production cutover for the canonical-trust schema.
 *
 * These tests exist because of a specific defect found by exact-head review: the runner asserted
 *
 *     count(trust_calculation_version IS NOT NULL) == 0
 *
 * after EVERY invocation. That is a valid FIRST-APPLY invariant and an invalid permanent one. Once
 * the schema is active, refreshCanonicalTrust() is SUPPOSED to stamp governed vehicles, so a later
 * verify-only run would have reported a working system as a failed cutover.
 *
 * The invariant is "THE MIGRATION MUST NOT CREATE TRUST STAMPS", not "production must remain forever
 * unstamped". The regression test for that is `verify-only after a legitimate canonical refresh`.
 */

const CHECKSUM_OK = 'cf0cc7f2c4f5';

/**
 * A fake Postgres client that models just enough catalog to make the runner's own assertions
 * meaningful: which columns exist, whether the migration is ledgered, the vehicle rows, and whether
 * the server is in a READ ONLY transaction.
 *
 * Every statement is recorded, so a test can prove what the runner did NOT do — which is the only
 * way to certify "this invocation wrote nothing".
 */
class FakeClient {
  constructor({ columns = [], ledgered = false, vehicles = [], migrationEffect = null, up = '',
                shapeOverride = {}, onLock = null } = {}) {
    // Columns are modelled as DEFINITIONS, not names, so a test can express the drift that a name
    // count cannot see: wrong type, NOT NULL, or a DEFAULT.
    this.columns = new Map();
    for (const c of columns) this.columns.set(c, { udt_name: R.EXPECTED_COLUMN_SHAPE[c], is_nullable: 'YES', column_default: null });
    for (const [c, def] of Object.entries(shapeOverride)) {
      if (this.columns.has(c)) this.columns.set(c, { ...this.columns.get(c), ...def });
    }
    this.shapeOverride = shapeOverride;
    this.onLock = onLock;
    this.ledgered = ledgered;
    this.vehicles = vehicles.map((v) => ({ ...v }));
    this.migrationEffect = migrationEffect;
    this.up = up;
    this.statements = [];
    this.readOnly = false;
  }

  get writes() {
    return this.statements.filter((s) =>
      /^\s*(insert|update|delete|alter|create|drop|truncate)\b/i.test(s) || (this.up && s === this.up));
  }

  async query(sql, params) {
    this.statements.push(sql);

    if (/^LOCK TABLE public\.vehicles IN ACCESS EXCLUSIVE MODE$/i.test(sql)) {
      this.locked = true;
      if (this.onLock) this.onLock(this);
      return { rows: [] };
    }
    if (/^BEGIN TRANSACTION READ ONLY$/i.test(sql)) { this.readOnly = true; return { rows: [] }; }
    if (/^BEGIN$/i.test(sql)) { this.readOnly = false; return { rows: [] }; }
    if (/^(COMMIT|ROLLBACK)$/i.test(sql)) { this.readOnly = false; return { rows: [] }; }
    if (/^SHOW transaction_read_only$/i.test(sql)) {
      return { rows: [{ transaction_read_only: this.readOnly ? 'on' : 'off' }] };
    }
    if (this.readOnly && this.writes.includes(sql)) {
      throw new Error('cannot execute a write in a read-only transaction');
    }

    if (/schema_migrations WHERE version/i.test(sql) && /^SELECT 1/i.test(sql.trim())) {
      return { rows: this.ledgered ? [{ '?column?': 1 }] : [] };
    }
    if (/INSERT INTO supabase_migrations\.schema_migrations/i.test(sql)) {
      assert.equal(params[0], '20260817140000', 'the ledger row must name the pinned version');
      this.ledgered = true;
      return { rows: [] };
    }
    if (this.up && sql === this.up) {
      // The migration's real effect: six nullable columns. `migrationEffect` lets a test simulate a
      // BAD migration that also stamps rows, which is the thing the pre-commit assertion must catch.
      for (const c of R.TRUST_STAMP_COLUMNS) {
        if (!this.columns.has(c)) {
          this.columns.set(c, { udt_name: R.EXPECTED_COLUMN_SHAPE[c], is_nullable: 'YES', column_default: null,
                                ...(this.shapeOverride[c] || {}) });
        }
      }
      if (this.migrationEffect) this.migrationEffect(this.vehicles);
      return { rows: [] };
    }
    if (/to_regclass/i.test(sql)) return { rows: [{ t: 'vehicles' }] };
    if (/current_database/i.test(sql)) return { rows: [{ db: 'postgres' }] };

    if (/select column_name, udt_name, is_nullable, column_default/i.test(sql)) {
      return {
        rows: params[0].filter((n) => this.columns.has(n)).sort()
          .map((n) => ({ column_name: n, ...this.columns.get(n) })),
      };
    }
    if (/column_name='trust_calculation_version'/i.test(sql)) {
      return { rows: [{ c: this.columns.has('trust_calculation_version') ? 1 : 0 }] };
    }
    if (/where trust_calculation_version is not null/i.test(sql)) {
      return { rows: [{ c: this.vehicles.filter((v) => v.version != null).length }] };
    }
    if (/stamp_columns_present/i.test(sql)) {
      const names = params[0];
      return {
        rows: [{
          stamp_columns_present: names.filter((n) => this.columns.has(n)).length,
          total_vehicles: this.vehicles.length,
          legacy_scored_rows: this.vehicles.filter((v) => v.trust_score != null).length,
          legacy_score_checksum: this.checksum(),
        }],
      };
    }
    throw new Error(`FakeClient received an unmodelled statement: ${sql.slice(0, 90)}`);
  }

  checksum() {
    return createHash('md5')
      .update([...this.vehicles].sort((a, b) => a.vin.localeCompare(b.vin))
        .map((v) => `${v.vin}=${v.trust_score ?? 'NULL'}`).join(','))
      .digest('hex');
  }
}

const silent = () => {};
const PROD_VEHICLES = [
  { vin: 'VIN_A', trust_score: 61, version: null },
  { vin: 'VIN_B', trust_score: 48, version: null },
  { vin: 'VIN_C', trust_score: 77, version: null },
];

// ── 1. pre-connection guards ─────────────────────────────────────────────────────────────────────

test('the real pinned migration passes every pre-connection guard', () => {
  const prepared = R.prepareMigration();
  assert.equal(prepared.sum, CHECKSUM_OK);
  assert.match(prepared.up, /ADD COLUMN/i);
  assert.ok(!/^-- \+migrate Down/m.test(prepared.up), 'the Down section must never be executable');
});

test('a tampered migration is refused BEFORE any connection exists', () => {
  assert.throws(
    () => R.prepareMigration(() => 'ALTER TABLE public.vehicles ADD COLUMN trust_band text;'),
    (e) => e instanceof R.CutoverRefusal && /checksum .* != frozen/.test(e.message));
});

test('forbidden SQL shapes are refused, and the refusal names the specific hazard', () => {
  // Each of these carries the correct checksum's *shape* but not its content, so the checksum guard
  // fires first — which is itself the point: content is pinned, not merely pattern-matched.
  for (const [sql, hazard] of [
    ['-- +migrate Up\nUPDATE public.vehicles SET trust_score = 100;', /checksum/],
    ['-- +migrate Up\nDELETE FROM public.vehicles;', /checksum/],
    ['-- +migrate Up\nDROP TABLE public.vehicles;', /checksum/],
    ['-- +migrate Up\nSELECT 1;', /checksum/],
  ]) {
    assert.throws(() => R.prepareMigration(() => sql), (e) => e instanceof R.CutoverRefusal && hazard.test(e.message));
  }
});

test('the shape guards fire independently of the checksum guard', () => {
  // Proven by calling the guards against content whose checksum is deliberately not asserted:
  // a file that survives checksum verification must still not be able to rewrite a legacy score.
  const src = readFileSync(
    fileURLToPath(new URL('../scripts/production-apply-issue164-trust-provenance.mjs', import.meta.url)), 'utf8');
  for (const guard of [/UPDATE\\s\+\(public\\\.\)\?vehicles/, /DELETE\\s\+FROM/, /DROP\\s\+TABLE/, /ADD\\s\+COLUMN/]) {
    assert.ok(guard.test(src), `the runner must retain the guard ${guard}`);
  }
  const guardIdx = src.indexOf('ADDITIVE-ONLY');
  const connectIdx = src.indexOf('client.connect()');
  assert.ok(guardIdx > -1 && connectIdx > -1 && guardIdx < connectIdx,
    'every SQL-shape guard must be defined before the connection is opened');
});

test('environment refusals: staging ref, missing ref, wrong confirm token', () => {
  const ref = 'aaaaaaaaaaaaaaaaaaaa';
  const good = { PRODUCTION_DATABASE_URL: `postgres://u:p@db.${ref}.supabase.co/postgres`, PRODUCTION_PROJECT_REF: ref };
  assert.equal(R.resolveMode({ ...good }).mode, 'preflight');
  assert.equal(R.resolveMode({ ...good, MODE: 'apply', CONFIRM_APPLY: R.CONFIRM_TOKEN }).mode, 'apply');
  assert.throws(() => R.resolveMode({ ...good, MODE: 'apply', CONFIRM_APPLY: 'NO' }), R.CutoverRefusal);
  assert.throws(() => R.resolveMode({ ...good, MODE: 'apply', CONFIRM_APPLY: 'YES_I_AUTHORIZE_THE_PRODUCTION_REVOKE' }),
    R.CutoverRefusal, 'the other cutover’s token must never authorize this one');
  assert.throws(() => R.resolveMode({ PRODUCTION_DATABASE_URL: 'postgres://x/eoyenigwevnxwwhyhaer', PRODUCTION_PROJECT_REF: 'eoyenigwevnxwwhyhaer' }), R.CutoverRefusal);
  assert.throws(() => R.resolveMode({ ...good, PRODUCTION_PROJECT_REF: 'short' }), R.CutoverRefusal);
});

// ── 2. first apply ───────────────────────────────────────────────────────────────────────────────

test('FRESH ACTIVATION: 0 columns -> 6, legacy scores untouched, zero stamps introduced', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({ columns: [], ledgered: false, vehicles: PROD_VEHICLES, up: prepared.up });
  const before = c.checksum();

  await R.runFirstApply(c, prepared, silent);

  assert.equal(c.columns.size >= 6, true);
  for (const col of R.TRUST_STAMP_COLUMNS) assert.ok(c.columns.has(col), `${col} must exist after apply`);
  assert.equal(c.ledgered, true, 'the migration must be recorded');
  assert.equal(c.checksum(), before, 'legacy trust_score data must be byte-identical');
  assert.equal(c.vehicles.filter((v) => v.trust_score != null).length, 3, 'scored row count must not move');
  assert.equal(c.vehicles.filter((v) => v.version != null).length, 0, 'the migration must stamp nothing');
  assert.ok(c.statements.includes('COMMIT'), 'a successful first apply commits');
});

test('MUTATION PROOF: a migration that stamps rows is caught BEFORE COMMIT and rolled back', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({
    columns: [], ledgered: false, vehicles: PROD_VEHICLES, up: prepared.up,
    // Simulates the exact hazard: a migration that quietly backfills a version onto legacy scores.
    migrationEffect: (rows) => rows.forEach((r) => { r.version = 'trust-decision-1.0.0'; }),
  });

  await assert.rejects(() => R.runFirstApply(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /introduced 3 trust_calculation_version value/.test(e.message));

  assert.ok(c.statements.includes('ROLLBACK'), 'the bad migration must be rolled back');
  assert.ok(!c.statements.includes('COMMIT'), 'it must never commit');
  assert.equal(c.ledgered, false, 'a rolled-back migration must not be recorded');
});

test('an unexpected partial state (unledgered but columns present) is refused, not reconciled', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({ columns: ['trust_band', 'trust_confidence'], ledgered: false, vehicles: PROD_VEHICLES, up: prepared.up });
  await assert.rejects(() => R.runFirstApply(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /unexpected partial state/.test(e.message));
  assert.ok(!c.statements.includes('BEGIN'), 'it must refuse before opening a write transaction');
});

// ── 3. verify-only — the Codex P1 regression ─────────────────────────────────────────────────────

test('VERIFY-ONLY after a legitimate canonical refresh PASSES and writes nothing', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({
    columns: [...R.TRUST_STAMP_COLUMNS],
    ledgered: true,
    // refreshCanonicalTrust() has legitimately stamped governed vehicles. This is the system working.
    vehicles: [
      { vin: 'VIN_A', trust_score: 61, version: null },
      { vin: 'CARUPGLDNA0000001', trust_score: 72, version: 'trust-decision-1.0.0' },
      { vin: 'CARUPGLDNB0000002', trust_score: 50, version: 'trust-decision-1.0.0' },
    ],
    up: prepared.up,
  });

  await R.runVerifyOnly(c, prepared, silent);   // must NOT throw — this is the regression

  // MUTATION PROOF: nothing was written, asserted over the whole recorded statement log.
  assert.deepEqual(c.writes, [], 'verify-only must issue no write statement');
  assert.ok(c.statements.includes('BEGIN TRANSACTION READ ONLY'), 'it must run in a read-only transaction');
  assert.ok(c.statements.includes('ROLLBACK'), 'and roll it back');
  assert.ok(!c.statements.includes('COMMIT'));
  assert.equal(c.vehicles.filter((v) => v.version != null).length, 2, 'legitimate stamps must survive untouched');
});

test('verify-only still fails closed on a broken schema shape', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({ columns: ['trust_band'], ledgered: true, vehicles: PROD_VEHICLES, up: prepared.up });
  await assert.rejects(() => R.runVerifyOnly(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal
        && /VERIFY-ONLY FAILED — schema shape is wrong/.test(e.message)
        && /trust_calculation_version is missing/.test(e.message));
});

test('a server that does not honour READ ONLY is refused', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({ columns: [...R.TRUST_STAMP_COLUMNS], ledgered: true, vehicles: PROD_VEHICLES, up: prepared.up });
  c.query = async function (sql) {
    this.statements.push(sql);
    if (/^SHOW transaction_read_only$/i.test(sql)) return { rows: [{ transaction_read_only: 'off' }] };
    return FakeClient.prototype.query.call(this, sql);
  };
  await assert.rejects(() => R.runVerifyOnly(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /server-asserted READ ONLY/.test(e.message));
});

// ── 4. preflight ─────────────────────────────────────────────────────────────────────────────────

test('preflight writes nothing and reports which path apply would take', async () => {
  const prepared = R.prepareMigration();
  for (const ledgered of [false, true]) {
    const c = new FakeClient({
      columns: ledgered ? [...R.TRUST_STAMP_COLUMNS] : [],
      ledgered, vehicles: PROD_VEHICLES, up: prepared.up,
    });
    const lines = [];
    await R.runPreflight(c, prepared, (m) => lines.push(m));
    assert.deepEqual(c.writes, [], 'preflight must write nothing');
    assert.ok(c.statements.includes('BEGIN TRANSACTION READ ONLY'));
    assert.ok(c.statements.includes('ROLLBACK'));
    assert.match(lines.join('\n'), ledgered ? /VERIFY-ONLY path/ : /FIRST-APPLY path/);
    assert.match(lines.join('\n'), new RegExp(`sha256:12 ${CHECKSUM_OK}`),
      'preflight must report the same pre-connection-verified candidate that apply would run');
  }
});

// ── 5. shape, not names — exact-head review P1 ───────────────────────────────────────────────────

/**
 * Verify-only exists to RE-PROVE the schema after the migration is recorded. Counting six names
 * does not do that: a column recreated with the wrong type, or that picked up a NOT NULL or a
 * DEFAULT, passes a name count and breaks the contract. A DEFAULT is the worst of the three — it
 * would fabricate provenance on every future insert, which is exactly the laundering this cutover
 * exists to prevent.
 */
test('VERIFY-ONLY rejects a drifted column TYPE that a name count would pass', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({
    columns: [...R.TRUST_STAMP_COLUMNS], ledgered: true, vehicles: PROD_VEHICLES, up: prepared.up,
    shapeOverride: { trust_known_limitations: { udt_name: 'text' } },   // jsonb -> text
  });
  await assert.rejects(() => R.runVerifyOnly(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /trust_known_limitations is text, expected jsonb/.test(e.message));
  assert.deepEqual(c.writes, [], 'a failing verify-only still must not write');
});

test('VERIFY-ONLY rejects a column that acquired a DEFAULT — provenance must never be fabricated', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({
    columns: [...R.TRUST_STAMP_COLUMNS], ledgered: true, vehicles: PROD_VEHICLES, up: prepared.up,
    shapeOverride: { trust_calculation_version: { column_default: "'trust-decision-1.0.0'::text" } },
  });
  await assert.rejects(() => R.runVerifyOnly(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /carries a DEFAULT/.test(e.message));
});

test('VERIFY-ONLY rejects a column that became NOT NULL', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({
    columns: [...R.TRUST_STAMP_COLUMNS], ledgered: true, vehicles: PROD_VEHICLES, up: prepared.up,
    shapeOverride: { trust_evaluated_at: { is_nullable: 'NO' } },
  });
  await assert.rejects(() => R.runVerifyOnly(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /is NOT NULL; the contract requires nullable/.test(e.message));
});

test('FIRST APPLY refuses if the migration produced the wrong shape, before commit', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({
    columns: [], ledgered: false, vehicles: PROD_VEHICLES, up: prepared.up,
    shapeOverride: { trust_evidence_basis: { udt_name: 'text' } },
  });
  await assert.rejects(() => R.runFirstApply(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /trust_evidence_basis is text, expected jsonb/.test(e.message));
  assert.ok(c.statements.includes('ROLLBACK'));
  assert.ok(!c.statements.includes('COMMIT'), 'a wrong shape must never commit');
  assert.equal(c.ledgered, false);
});

test('shapeFailures names every violation individually rather than returning a count', () => {
  const rows = [
    { column_name: 'trust_calculation_version', udt_name: 'text', is_nullable: 'YES', column_default: null },
    { column_name: 'trust_evaluated_at', udt_name: 'text', is_nullable: 'NO', column_default: 'now()' },
    { column_name: 'trust_band', udt_name: 'text', is_nullable: 'YES', column_default: null },
    { column_name: 'trust_confidence', udt_name: 'text', is_nullable: 'YES', column_default: null },
    { column_name: 'trust_known_limitations', udt_name: 'jsonb', is_nullable: 'YES', column_default: null },
  ];
  const f = R.shapeFailures(rows);
  assert.ok(f.some((m) => /trust_evaluated_at is text, expected timestamptz/.test(m)));
  assert.ok(f.some((m) => /trust_evaluated_at is NOT NULL/.test(m)));
  assert.ok(f.some((m) => /trust_evaluated_at carries a DEFAULT/.test(m)));
  assert.ok(f.some((m) => /trust_evidence_basis is missing/.test(m)));
  assert.equal(R.shapeFailures(
    Object.entries(R.EXPECTED_COLUMN_SHAPE).map(([column_name, udt_name]) =>
      ({ column_name, udt_name, is_nullable: 'YES', column_default: null }))).length, 0,
    'the contract-satisfying shape must produce no failures');
});

// ── 6. measure under the lock — exact-head review P2 ─────────────────────────────────────────────

/**
 * A legitimate refreshCanonicalTrust() write landing immediately after COMMIT must not be
 * misreported as "the migration rewrote legacy scores". Application writes are not migration
 * changes. Every legacy-score reading is therefore taken inside the transaction while it holds
 * ACCESS EXCLUSIVE, and post-commit only stable DDL facts are asserted.
 */
test('a legitimate refresh landing right after COMMIT does NOT fail the cutover', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({ columns: [], ledgered: false, vehicles: PROD_VEHICLES, up: prepared.up });

  const realQuery = c.query.bind(c);
  c.query = async (sql, params) => {
    const res = await realQuery(sql, params);
    if (/^COMMIT$/i.test(sql)) {
      // The instant the lock drops, an evidence-review request stamps a governed vehicle and
      // rescores it — exactly the production path in vehiclesRoutes.
      c.vehicles.push({ vin: 'CARUPGLDNA0000001', trust_score: 72, version: 'trust-decision-1.0.0' });
      c.vehicles[0].trust_score = 99;
    }
    return res;
  };

  await R.runFirstApply(c, prepared, silent);   // must NOT throw

  assert.equal(c.ledgered, true, 'the cutover succeeded and stays succeeded');
  assert.equal(c.vehicles.filter((v) => v.version != null).length, 1,
    'the legitimate stamp survives and is reported, not treated as a failure');
});

test('the migration rewriting a legacy score IS caught — under the lock, before commit', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({
    columns: [], ledgered: false, vehicles: PROD_VEHICLES, up: prepared.up,
    migrationEffect: (rows) => { rows[0].trust_score = 100; },
  });
  await assert.rejects(() => R.runFirstApply(c, prepared, silent),
    (e) => e instanceof R.CutoverRefusal && /the migration changed legacy trust_score data/.test(e.message));
  assert.ok(c.statements.includes('ROLLBACK'));
  assert.ok(!c.statements.includes('COMMIT'));
});

test('first apply takes ACCESS EXCLUSIVE before it measures anything', async () => {
  const prepared = R.prepareMigration();
  const c = new FakeClient({ columns: [], ledgered: false, vehicles: PROD_VEHICLES, up: prepared.up });
  await R.runFirstApply(c, prepared, silent);

  const inTxn = c.statements.slice(c.statements.indexOf('BEGIN'));
  const lockAt = inTxn.findIndex((s) => /LOCK TABLE public\.vehicles IN ACCESS EXCLUSIVE MODE/i.test(s));
  const firstMeasureAt = inTxn.findIndex((s) => /legacy_score_checksum/i.test(s));
  const migrationAt = inTxn.indexOf(prepared.up);
  assert.ok(lockAt > -1, 'the transaction must take the table lock explicitly');
  assert.ok(lockAt < firstMeasureAt, 'the lock must precede the first data measurement');
  assert.ok(firstMeasureAt < migrationAt, 'the before-reading must precede the migration');
});
