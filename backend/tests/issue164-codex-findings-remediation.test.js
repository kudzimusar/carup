import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { assembleDecision, getTrustDecision } from '../services/trustDecision/trustDecisionService.js';
import {
  assertCanonicalStaging,
  createPgSupabaseAdapter,
  runTrustRefresh,
  tlsConfig,
} from '../scripts/issue164-refresh-canonical-trust.mjs';
import {
  verifySchemaAndSecurity,
  verifyPopulationTrust,
} from '../scripts/issue164-staging-truth-cutover.mjs';

/**
 * Deterministic canonical decision via the exported pure assembleDecision() from
 * trustDecisionService.js. This satisfies the canonical decision contract without
 * requiring Supabase, evidence DB reads, or any external dependency.
 */
function cheapDecide(vin) {
  return assembleDecision({
    vin,
    vehicle: { vin, make: 'Honda', model: 'Accord', year: 2023 },
    completeness: {
      is_publishable: true,
      completeness_percent: 80,
      blocking_gaps: [],
      pending_gaps: [],
    },
    coverage: [],
    now: new Date().toISOString(),
  });
}

/**
 * Decision that returns not_evaluated: assembleDecision with now=null means
 * canonicalFromDecision sees evaluatedAt===null → NOT_EVALUATED state →
 * buildCachePatch returns null → legitimate non-write skip.
 */
function notEvaluatedDecide(vin) {
  return assembleDecision({
    vin,
    vehicle: { vin },
    completeness: null,
    coverage: [],
    now: null,
  });
}

/** Empty fact reader — no DB dependency. */
const noopRead = () => Promise.resolve({ rows: [] });

test('Finding 1 (P1) — Schema verification succeeds pre-refresh; population verification fails until post-refresh', async () => {
  const db = await PGlite.create();
  const testVin = '1HGCR2F83HA000001';
  try {
    await db.exec(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      END $$;

      CREATE TABLE vehicles (
        vin text PRIMARY KEY,
        created_at timestamptz DEFAULT now(),
        seller_id uuid,
        current_seller_id uuid,
        import_source text DEFAULT 'manual',
        duty_paid boolean DEFAULT true,
        police_verified boolean DEFAULT true,
        zimra_verified boolean DEFAULT true,
        passport_verified boolean DEFAULT true,
        safe_pay_ready boolean DEFAULT true,
        inspection_ready boolean DEFAULT true,
        currency_source text DEFAULT 'seller',
        trust_score numeric(5,2) DEFAULT NULL,
        trust_calculation_version text DEFAULT NULL,
        trust_evaluated_at timestamptz DEFAULT NULL,
        trust_band text DEFAULT NULL,
        trust_confidence text DEFAULT NULL,
        trust_known_limitations jsonb DEFAULT NULL,
        trust_evidence_basis jsonb DEFAULT NULL
      );

      CREATE TABLE marketplace_transactions (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE marketplace_transactions ENABLE ROW LEVEL SECURITY;
      CREATE TABLE marketplace_inquiries (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE marketplace_inquiries ENABLE ROW LEVEL SECURITY;
      CREATE TABLE marketplace_reservations (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE marketplace_reservations ENABLE ROW LEVEL SECURITY;
      CREATE TABLE marketplace_deposits (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE marketplace_deposits ENABLE ROW LEVEL SECURITY;
      CREATE TABLE finance_applications (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE finance_applications ENABLE ROW LEVEL SECURITY;
      CREATE TABLE escrow_trust_sessions (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE escrow_trust_sessions ENABLE ROW LEVEL SECURITY;
      CREATE TABLE escrow_trust_events (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE escrow_trust_events ENABLE ROW LEVEL SECURITY;
      CREATE TABLE escrow_trust_webhook_events (
        id text PRIMARY KEY, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE escrow_trust_webhook_events ENABLE ROW LEVEL SECURITY;
      CREATE TABLE vehicle_reservations (
        id text PRIMARY KEY, vin text NOT NULL, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE vehicle_reservations ENABLE ROW LEVEL SECURITY;
      CREATE TABLE safetrade_sandbox_payment_intents (
        id text PRIMARY KEY, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE safetrade_sandbox_payment_intents ENABLE ROW LEVEL SECURITY;
      CREATE TABLE safetrade_sandbox_payment_operations (
        id text PRIMARY KEY, created_at timestamptz DEFAULT now()
      );
      ALTER TABLE safetrade_sandbox_payment_operations ENABLE ROW LEVEL SECURITY;
    `);

    await db.exec(`
      INSERT INTO vehicles (vin, currency_source, trust_score, trust_calculation_version)
      VALUES ('${testVin}', 'seller', 80.0, NULL);
    `);

    await assert.doesNotReject(
      () => verifySchemaAndSecurity(db, [], { requireLedger: false }),
      'Pre-refresh schema verification must pass even when unversioned legacy scores exist',
    );
    await assert.rejects(
      () => verifyPopulationTrust(db),
      /1 post-refresh population trust contract violation/,
    );

    const adapter = createPgSupabaseAdapter(db);
    const summary = await runTrustRefresh(adapter, { batchSize: 50, decide: cheapDecide, read: noopRead });
    assert.equal(summary.considered, 1);
    assert.equal(summary.written, 1);

    await assert.doesNotReject(
      () => verifyPopulationTrust(db),
      'Post-refresh population verification must pass after canonical Trust refresh',
    );
  } finally {
    await db.close();
  }
});

test('Finding 2 (P1) — Target verification fails closed on mismatched or non-staging endpoints', () => {
  const stagingRef = 'eoyenigwevnxwwhyhaer';
  const prodRef = ['vhmnajoeicasa', 'igiophh'].join('');

  assert.doesNotThrow(() => {
    assertCanonicalStaging({
      DIASPORA_STAGING_DATABASE_URL: `postgres://user:pass@db.${stagingRef}.supabase.co:5432/postgres`,
      SUPABASE_URL: `https://${stagingRef}.supabase.co`,
    });
  });

  let exitedCode = null;
  const origExit = process.exit;
  process.exit = (code) => { exitedCode = code; throw new Error(`process.exit:${code}`); };
  try {
    assert.throws(
      () => {
        assertCanonicalStaging({
          DIASPORA_STAGING_DATABASE_URL: `postgres://user:pass@db.${stagingRef}.supabase.co:5432/postgres`,
          SUPABASE_URL: `https://${prodRef}.supabase.co`,
        });
      },
      /process\.exit:2/,
    );
    assert.equal(exitedCode, 2, 'Must exit with code 2 on forbidden production target');
  } finally {
    process.exit = origExit;
  }
});

test('Finding 3 (P1) — Narrow lazy client resolution leaves backend/db/supabase.js fail-fast intact', () => {
  const scriptFailFast = `
    (async () => {
      try {
        await import('./backend/db/supabase.js');
        process.exit(1);
      } catch (err) {
        if (err.message.includes('Missing SUPABASE_URL')) process.exit(0);
        process.exit(2);
      }
    })();
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', scriptFailFast], {
    cwd: process.cwd(),
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  });

  const scriptInjectedPass = `
    (async () => {
      const { refreshCanonicalTrust } = await import('./backend/services/trustDecision/canonicalTrustService.js');
      if (typeof refreshCanonicalTrust !== 'function') process.exit(1);
      process.exit(0);
    })();
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', scriptInjectedPass], {
    cwd: process.cwd(),
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  });
});

test('Finding 4 (P2) & Real PostgreSQL .gt() Adapter — >500 vehicle pagination proof on real PGlite', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE vehicles (
        vin text PRIMARY KEY,
        created_at timestamptz DEFAULT now(),
        seller_id uuid, current_seller_id uuid,
        import_source text DEFAULT 'manual',
        duty_paid boolean DEFAULT true, police_verified boolean DEFAULT true,
        zimra_verified boolean DEFAULT true, passport_verified boolean DEFAULT true,
        safe_pay_ready boolean DEFAULT true, inspection_ready boolean DEFAULT true,
        currency_source text DEFAULT 'seller',
        trust_score numeric(5,2) DEFAULT NULL,
        trust_calculation_version text DEFAULT NULL,
        trust_evaluated_at timestamptz DEFAULT NULL,
        trust_band text DEFAULT NULL,
        trust_confidence text DEFAULT NULL,
        trust_known_limitations jsonb DEFAULT NULL,
        trust_evidence_basis jsonb DEFAULT NULL
      );
    `);

    const inserts = [];
    for (let i = 1; i <= 505; i++) {
      const vin = `1HGCR2F83HA${String(i).padStart(6, '0')}`;
      inserts.push(`('${vin}', 'seller', NULL, NULL)`);
    }
    await db.exec(`
      INSERT INTO vehicles (vin, currency_source, trust_score, trust_calculation_version)
      VALUES ${inserts.join(', ')};
    `);

    const adapter = createPgSupabaseAdapter(db);

    // Inject cheapDecide + noopRead so the test proves pagination/DB, not Trust engine latency
    const summary = await runTrustRefresh(adapter, {
      batchSize: 200,
      decide: cheapDecide,
      read: noopRead,
    });

    assert.equal(summary.considered, 505, 'All 505 vehicles across 3 pages must be considered');
    assert.equal(summary.written, 505, 'All 505 vehicles must be refreshed and written');

    const vehicle501 = '1HGCR2F83HA000501';
    const res501 = await db.query('SELECT vin, trust_calculation_version FROM vehicles WHERE vin = $1', [vehicle501]);
    assert.equal(res501.rows.length, 1, 'Vehicle #501 must exist in the database');
    assert.equal(res501.rows[0].trust_calculation_version, 'trust-decision-1.0.0', 'Vehicle #501 must carry refreshed calculation version');

    // --limit semantics
    await db.exec('UPDATE vehicles SET trust_calculation_version = NULL');
    const summaryLimited = await runTrustRefresh(adapter, { batchSize: 100, limit: 250, decide: cheapDecide, read: noopRead });
    assert.equal(summaryLimited.considered, 250, 'Total limit=250 must stop exactly at 250 vehicles');
  } finally {
    await db.close();
  }
});

test('Finding 5 (P2) — Dispatcher documentation candidate SHA and migration tree split match workflow and code', () => {
  const workflowYaml = readFileSync('.github/workflows/issue164-staging-truth-cutover.yml', 'utf8');
  const matchSha = /CANDIDATE_SHA:\s*([a-f0-9]{40})/.exec(workflowYaml);
  assert.ok(matchSha, 'CANDIDATE_SHA must be present in issue164-staging-truth-cutover.yml');
  const pinnedSha = matchSha[1];

  const dispatcherDoc = readFileSync('docs/canonical-vehicle-truth/ISSUE164_STAGING_CUTOVER_DISPATCHER.md', 'utf8');
  assert.ok(dispatcherDoc.includes(pinnedSha),
    `ISSUE164_STAGING_CUTOVER_DISPATCHER.md must cite exact pinned CANDIDATE_SHA ${pinnedSha}`);
  assert.ok(dispatcherDoc.includes('12 pre-existing migrations are byte-identical'),
    'Documentation must explicitly cite 12 byte-identical pre-existing migrations');
  assert.ok(dispatcherDoc.includes('Four Issue #164 migrations'),
    'Documentation must explicitly cite 4 exempted Issue #164 migrations');
  assert.ok(dispatcherDoc.includes('Historical source anchor:'),
    'Documentation must explicitly identify the historical source anchor');
  assert.ok(dispatcherDoc.includes('Cutover candidate & workflow pinned SHA:'),
    'Documentation must explicitly identify the cutover candidate & workflow pinned SHA');
});

test('Findings 6+7 (P1) — Trust cache write_failed:* returns exit failure; non-write skips remain non-fatal', async () => {
  const testVin = '1HGCR2F83HA000001';

  // Client adapter whose update query fails deterministically
  const failingClient = {
    from: (table) => {
      if (table === 'vehicles') {
        return {
          select: () => ({
            order: () => ({
              gt: () => ({ limit: () => Promise.resolve({ data: [{ vin: testVin }], error: null }) }),
              limit: () => Promise.resolve({ data: [{ vin: testVin }], error: null }),
            }),
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { vin: testVin }, error: null }),
              single: () => Promise.resolve({ data: { vin: testVin }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: 'simulated DB write error' } }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
  };

  // 1. Single-VIN: valid canonical decision + failed cache update → failed=1, skipped=0
  const singleSummary = await runTrustRefresh(failingClient, {
    singleVin: testVin,
    decide: cheapDecide,
    read: noopRead,
  });
  assert.equal(singleSummary.failed, 1, 'single-VIN write_failed:* must increment summary.failed');
  assert.equal(singleSummary.skipped, 0, 'single-VIN write_failed:* must NOT increment summary.skipped');
  assert.ok(singleSummary.skips['write_failed:simulated DB write error'] === 1,
    'single-VIN write_failed reason must be recorded in summary.skips');

  // 2. Paginated: valid canonical decision + failed cache update → failed counted
  const pageSummary = await runTrustRefresh(failingClient, {
    decide: cheapDecide,
    read: noopRead,
    batchSize: 10,
  });
  assert.equal(pageSummary.failed, 1, 'paginated write_failed:* must increment summary.failed');
  assert.equal(pageSummary.skipped, 0, 'paginated write_failed:* must NOT increment summary.skipped');
  assert.ok(pageSummary.skips['write_failed:simulated DB write error'] === 1,
    'paginated write_failed reason must be recorded in summary.skips');

  // 3. Legitimate non-write skip (not_evaluated decision) → skipped=1, failed=0
  const skipSummary = await runTrustRefresh(failingClient, {
    singleVin: testVin,
    decide: notEvaluatedDecide,
    read: noopRead,
  });
  assert.equal(skipSummary.failed, 0, 'legitimate non-write skip must NOT increment summary.failed');
  assert.equal(skipSummary.skipped, 1, 'legitimate non-write skip must increment summary.skipped');
  assert.ok(skipSummary.skips['not_canonical:not_evaluated'] === 1,
    'legitimate skip reason not_canonical:not_evaluated must be recorded in summary.skips');
});

test('P1-A — PostgreSQL-only refresh forwards client to default getTrustDecision without Supabase env or default client import', async () => {
  const db = await PGlite.create();
  const testVin = '1HGCR2F83HA000001';
  try {
    await db.exec(`
      CREATE TABLE vehicles (
        vin text PRIMARY KEY,
        created_at timestamptz DEFAULT now(),
        seller_id uuid, current_seller_id uuid,
        import_source text DEFAULT 'manual',
        duty_paid boolean DEFAULT true, police_verified boolean DEFAULT true,
        zimra_verified boolean DEFAULT true, passport_verified boolean DEFAULT true,
        safe_pay_ready boolean DEFAULT true, inspection_ready boolean DEFAULT true,
        currency_source text DEFAULT 'seller',
        make text DEFAULT 'Honda', model text DEFAULT 'Accord', year integer DEFAULT 2023,
        chassis_number text DEFAULT 'CH123', engine_number text DEFAULT 'ENG123', plate_number text DEFAULT 'ABC123',
        temp_plate_id text DEFAULT NULL, tenant_id uuid DEFAULT NULL, publication_status text DEFAULT 'draft',
        trust_score numeric(5,2) DEFAULT NULL,
        trust_calculation_version text DEFAULT NULL,
        trust_evaluated_at timestamptz DEFAULT NULL,
        trust_band text DEFAULT NULL,
        trust_confidence text DEFAULT NULL,
        trust_known_limitations jsonb DEFAULT NULL,
        trust_evidence_basis jsonb DEFAULT NULL
      );

      CREATE TABLE vehicle_evidence (id text PRIMARY KEY, vin text, evidence_type text, verification_status text);
      CREATE TABLE eligibility_requests (id text PRIMARY KEY, vin text, capability text, status text, conditions jsonb, mode text, validity_until timestamptz, created_at timestamptz);
      CREATE TABLE fraud_cases (id text PRIMARY KEY, vin text, status text, highest_severity text, blocks_publication boolean);
      CREATE TABLE insurance_provider_decisions (id text PRIMARY KEY, vin text, decision text, verified_at timestamptz);
      CREATE TABLE finance_provider_decisions (id text PRIMARY KEY, vin text, decision text, verified_at timestamptz);
      CREATE TABLE escrow_trust_sessions (id text PRIMARY KEY, vin text, session_status text, created_at timestamptz);
      CREATE TABLE source_verification_results (id text PRIMARY KEY, vin text, provider text, status text, mode text, created_at timestamptz);
      CREATE VIEW source_verification_coverage_public AS SELECT vin, provider, status, mode FROM source_verification_results;

      INSERT INTO vehicles (vin) VALUES ('${testVin}');
    `);

    const adapter = createPgSupabaseAdapter(db);
    // NO injected decide function — must use default getTrustDecision with forwarded adapter client
    const summary = await runTrustRefresh(adapter, { singleVin: testVin, read: noopRead });

    assert.equal(summary.considered, 1, 'Single VIN must be considered');
    assert.equal(summary.written, 1, 'Single VIN must be written');
    assert.equal(summary.failed, 0, 'Refresh must not fail when client is forwarded');

    const res = await db.query('SELECT vin, trust_score, trust_calculation_version FROM vehicles WHERE vin = $1', [testVin]);
    assert.equal(res.rows.length, 1);
    assert.ok(res.rows[0].trust_score !== null, 'Trust score must be materialized in PGlite DB');
    assert.equal(res.rows[0].trust_calculation_version, 'trust-decision-1.0.0', 'Calculation version must be trust-decision-1.0.0');
  } finally {
    await db.close();
  }
});

test('P1-B — Post-refresh population trust verification rejects stale/legacy calculation versions (fail-closed)', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE vehicles (
        vin text PRIMARY KEY,
        trust_score numeric(5,2) DEFAULT NULL,
        trust_calculation_version text DEFAULT NULL
      );
    `);

    // Case 1: Current version ('trust-decision-1.0.0') passes
    await db.exec(`INSERT INTO vehicles (vin, trust_score, trust_calculation_version) VALUES ('VIN1', 75.0, 'trust-decision-1.0.0');`);
    await assert.doesNotReject(
      () => verifyPopulationTrust(db),
      'Current calculation version trust-decision-1.0.0 must pass verification',
    );

    // Case 2: Stale version ('2026.06.21.v1') fails
    await db.exec(`INSERT INTO vehicles (vin, trust_score, trust_calculation_version) VALUES ('VIN2', 75.0, '2026.06.21.v1');`);
    await assert.rejects(
      () => verifyPopulationTrust(db),
      /1 post-refresh population trust contract violation/,
      'Stale calculation version 2026.06.21.v1 must fail verification',
    );
    await db.exec(`DELETE FROM vehicles WHERE vin = 'VIN2';`);

    // Case 3: Unversioned non-null score fails
    await db.exec(`INSERT INTO vehicles (vin, trust_score, trust_calculation_version) VALUES ('VIN3', 80.0, NULL);`);
    await assert.rejects(
      () => verifyPopulationTrust(db),
      /1 post-refresh population trust contract violation/,
      'Unversioned non-null score must fail verification',
    );
    await db.exec(`DELETE FROM vehicles WHERE vin = 'VIN3';`);

    // Case 4: Legitimate not-evaluated row (score NULL, version NULL) passes
    await db.exec(`INSERT INTO vehicles (vin, trust_score, trust_calculation_version) VALUES ('VIN4', NULL, NULL);`);
    await assert.doesNotReject(
      () => verifyPopulationTrust(db),
      'Legitimate not-evaluated row (score NULL, version NULL) must pass verification',
    );
  } finally {
    await db.close();
  }
});

/**
 * Wraps a PGlite instance to simulate node-postgres parameter serialization.
 *
 * node-postgres (pg) serializes JS arrays as PostgreSQL array literals via
 * prepareValue→arrayString: ["a","b"] → '{"a","b"}'. This is correct for
 * PostgreSQL array columns (text[], uuid[]) but produces invalid JSON for
 * JSONB columns, causing: "invalid input syntax for type json".
 *
 * JS objects are JSON.stringified by node-postgres, which is correct for JSONB.
 *
 * This wrapper applies the same transform so PGlite reproduces the real
 * staging failure without requiring a remote PostgreSQL connection.
 */
function wrapWithNodePgArraySerialization(pgliteClient) {
  function arrayToPostgresLiteral(arr) {
    return '{' + arr.map((v) => {
      if (v === null || v === undefined) return 'NULL';
      if (Array.isArray(v)) return arrayToPostgresLiteral(v);
      return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }).join(',') + '}';
  }

  return {
    query(sql, params) {
      if (params) {
        const serialized = params.map((p) => {
          if (Array.isArray(p)) return arrayToPostgresLiteral(p);
          if (p !== null && p !== undefined && typeof p === 'object'
              && !(p instanceof Date)) {
            return JSON.stringify(p);
          }
          return p;
        });
        return pgliteClient.query(sql, serialized);
      }
      return pgliteClient.query(sql, params);
    },
    exec: pgliteClient.exec?.bind(pgliteClient),
  };
}

test('JSONB serialization regression — adapter handles trust_known_limitations and trust_evidence_basis through node-postgres wire format', async () => {
  const db = await PGlite.create();
  const testVin = '1HGCR2F83HA099001';
  try {
    await db.exec(`
      CREATE TABLE vehicles (
        vin text PRIMARY KEY,
        created_at timestamptz DEFAULT now(),
        seller_id uuid, current_seller_id uuid,
        import_source text DEFAULT 'manual',
        duty_paid boolean DEFAULT true, police_verified boolean DEFAULT true,
        zimra_verified boolean DEFAULT true, passport_verified boolean DEFAULT true,
        safe_pay_ready boolean DEFAULT true, inspection_ready boolean DEFAULT true,
        currency_source text DEFAULT 'seller',
        make text DEFAULT 'Honda', model text DEFAULT 'Accord', year integer DEFAULT 2023,
        chassis_number text DEFAULT 'CH123', engine_number text DEFAULT 'ENG123', plate_number text DEFAULT 'ABC123',
        trust_score numeric(5,2) DEFAULT NULL,
        trust_calculation_version text DEFAULT NULL,
        trust_evaluated_at timestamptz DEFAULT NULL,
        trust_band text DEFAULT NULL,
        trust_confidence text DEFAULT NULL,
        trust_known_limitations jsonb DEFAULT NULL,
        trust_evidence_basis jsonb DEFAULT NULL
      );

      CREATE TABLE fraud_cases (id text PRIMARY KEY, vin text, status text, highest_severity text, blocks_publication boolean);
      CREATE TABLE insurance_provider_decisions (id text PRIMARY KEY, vin text, decision text, verified_at timestamptz);
      CREATE TABLE finance_provider_decisions (id text PRIMARY KEY, vin text, decision text, verified_at timestamptz);
      CREATE TABLE escrow_trust_sessions (id text PRIMARY KEY, vin text, session_status text, created_at timestamptz);
      CREATE TABLE source_verification_results (id text PRIMARY KEY, vin text, provider text, status text, mode text, created_at timestamptz);
      CREATE VIEW source_verification_coverage_public AS SELECT vin, provider, status, mode FROM source_verification_results;

      INSERT INTO vehicles (vin) VALUES ('${testVin}');
    `);

    // 1. Wrap PGlite to simulate node-postgres array serialization.
    //    Pre-fix adapter passes raw JS arrays → wrapper converts to PG array literals →
    //    jsonb column rejects them. Post-fix adapter JSON.stringifies first → wrapper
    //    sees strings → passes through → jsonb accepts valid JSON.
    const pgSimClient = wrapWithNodePgArraySerialization(db);
    const adapter = createPgSupabaseAdapter(pgSimClient);

    const summary = await runTrustRefresh(adapter, {
      singleVin: testVin,
      decide: cheapDecide,
      read: noopRead,
    });

    assert.equal(summary.considered, 1, 'VIN must be considered');
    assert.equal(summary.written, 1, 'Trust refresh must write successfully through node-postgres serialization');
    assert.equal(summary.failed, 0, 'No write failures — JSONB columns must accept adapter output');

    // 2. Round-trip verification: read back and confirm valid JSON structures.
    const res = await db.query(
      'SELECT trust_known_limitations, trust_evidence_basis, trust_score, trust_calculation_version FROM vehicles WHERE vin = $1',
      [testVin],
    );
    const row = res.rows[0];

    assert.ok(row.trust_score !== null, 'trust_score must be materialized');
    assert.equal(row.trust_calculation_version, 'trust-decision-1.0.0');

    // trust_known_limitations: non-empty JSON array (cheapDecide with coverage:[] produces limitations)
    const limitations = typeof row.trust_known_limitations === 'string'
      ? JSON.parse(row.trust_known_limitations)
      : row.trust_known_limitations;
    assert.ok(Array.isArray(limitations), 'trust_known_limitations must be a JSON array');
    assert.ok(limitations.length > 0, 'trust_known_limitations must be non-empty for cheapDecide with no coverage');

    // trust_evidence_basis: non-null JSON object
    const basis = typeof row.trust_evidence_basis === 'string'
      ? JSON.parse(row.trust_evidence_basis)
      : row.trust_evidence_basis;
    assert.ok(basis !== null && typeof basis === 'object' && !Array.isArray(basis),
      'trust_evidence_basis must be a JSON object');

    // 3. Empty limitations array: must write valid JSON []
    await db.exec(`INSERT INTO vehicles (vin) VALUES ('EMPTY_LIMS_VIN')`);
    const emptyLimsResult = await adapter.from('vehicles')
      .update({ trust_known_limitations: [], trust_evidence_basis: null })
      .eq('vin', 'EMPTY_LIMS_VIN');
    assert.equal(emptyLimsResult.error, null, 'Empty array write must succeed');

    const emptyRes = await db.query(
      'SELECT trust_known_limitations, trust_evidence_basis FROM vehicles WHERE vin = $1',
      ['EMPTY_LIMS_VIN'],
    );
    const emptyLims = typeof emptyRes.rows[0].trust_known_limitations === 'string'
      ? JSON.parse(emptyRes.rows[0].trust_known_limitations)
      : emptyRes.rows[0].trust_known_limitations;
    assert.deepStrictEqual(emptyLims, [], 'Empty array must round-trip as JSON []');
    assert.equal(emptyRes.rows[0].trust_evidence_basis, null, 'Null JSONB must remain null');

    // 4. .in() / array filtering semantics must remain unchanged.
    //    The JSONB fix must NOT break .in() which uses = ANY($N) with real PostgreSQL arrays.
    await db.exec(`INSERT INTO vehicles (vin) VALUES ('IN_TEST_A'), ('IN_TEST_B')`);
    const inResult = await adapter.from('vehicles').select('vin')
      .in('vin', [testVin, 'IN_TEST_A', 'IN_TEST_B']);
    assert.equal(inResult.error, null, '.in() array filter must not error');
    assert.equal(inResult.data.length, 3, '.in() must return all matching rows');
  } finally {
    await db.close();
  }
});

test('P1-READ — getTrustDecision fails closed on dependency read errors; no write/cache occurs when dependency fails', async () => {
  const testVin = '1HGCR2F83HA000099';

  function createMockQueryBuilder(result = { data: [], error: null }) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] : (result.data || null), error: result.error }),
      single: () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] : result.data, error: result.error }),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  }

  const vehData = { vin: testVin, make: 'Honda', model: 'Accord', year: 2023 };

  // 1. Client where 'vehicles' query succeeds but 'fraud_cases' fails with DB error
  const failingFraudClient = {
    from: (table) => {
      if (table === 'vehicles') return createMockQueryBuilder({ data: vehData, error: null });
      if (table === 'fraud_cases') {
        return createMockQueryBuilder({ data: null, error: { message: 'DB connection error on fraud_cases' } });
      }
      return createMockQueryBuilder({ data: [], error: null });
    },
  };

  // getTrustDecision MUST reject on DB read failure
  await assert.rejects(
    () => getTrustDecision(testVin, { client: failingFraudClient }),
    /Fraud summary read error/,
    'getTrustDecision must fail closed and throw when fraud summary query fails',
  );

  // 2. Client where completeness query fails
  const failingCompletenessClient = {
    from: (table) => {
      if (table === 'vehicles') return createMockQueryBuilder({ data: vehData, error: null });
      if (table === 'vehicle_evidence') {
        return createMockQueryBuilder({ data: null, error: { message: 'DB query failure on vehicle_evidence' } });
      }
      return createMockQueryBuilder({ data: [], error: null });
    },
  };

  await assert.rejects(
    () => getTrustDecision(testVin, { client: failingCompletenessClient }),
    /Vehicle not found|DB query failure on vehicle_evidence/,
    'getTrustDecision must fail closed and throw when evaluateCompleteness dependency fails',
  );

  // 3. Client where source coverage query fails
  const failingCoverageClient = {
    from: (table) => {
      if (table === 'vehicles') return createMockQueryBuilder({ data: vehData, error: null });
      if (table === 'source_verification_coverage_public') {
        return createMockQueryBuilder({ data: null, error: { message: 'DB query failure on coverage' } });
      }
      return createMockQueryBuilder({ data: [], error: null });
    },
  };

  await assert.rejects(
    () => getTrustDecision(testVin, { client: failingCoverageClient }),
    /DB query failure on coverage/,
    'getTrustDecision must fail closed and throw when getCoverage dependency fails',
  );

  // 4. Legitimate empty/no-evidence inputs produce canonical decision cleanly without throwing
  const emptyEvidenceClient = {
    from: (table) => {
      if (table === 'vehicles') return createMockQueryBuilder({ data: vehData, error: null });
      return createMockQueryBuilder({ data: [], error: null });
    },
  };

  const cleanDecision = await getTrustDecision(testVin, { client: emptyEvidenceClient });
  assert.equal(cleanDecision.vin, testVin);
  assert.equal(cleanDecision.calculation_version, 'trust-decision-1.0.0');
  assert.ok(['low', 'insufficient_evidence'].includes(cleanDecision.overall_trust.status));
});

test('P1-TLS — PostgreSQL connection configuration enforces rejectUnauthorized: true across all environments', () => {
  // 1. Supplied CA
  const suppliedTls = tlsConfig({ DIASPORA_STAGING_CA_CERT: '-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----' });
  assert.equal(suppliedTls.rejectUnauthorized, true, 'Supplied CA must enforce rejectUnauthorized: true');
  assert.equal(suppliedTls.ca, '-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----');

  // 2. Empty env (uses bundled CA or system roots)
  const defaultTls = tlsConfig({});
  assert.equal(defaultTls.rejectUnauthorized, true, 'Default TLS must enforce rejectUnauthorized: true');

  // 3. Invalid/blank CA cert string
  const blankTls = tlsConfig({ DIASPORA_STAGING_CA_CERT: '' });
  assert.equal(blankTls.rejectUnauthorized, true, 'Blank CA cert must enforce rejectUnauthorized: true');

  // 4. Verify no branch returns rejectUnauthorized: false
  for (const envVal of [undefined, '', 'invalid-cert-string', '-----BEGIN CERTIFICATE-----\nfoo\n-----END CERTIFICATE-----']) {
    const config = tlsConfig({ DIASPORA_STAGING_CA_CERT: envVal });
    assert.equal(config.rejectUnauthorized, true, `rejectUnauthorized must be true for env value: ${envVal}`);
  }
});
