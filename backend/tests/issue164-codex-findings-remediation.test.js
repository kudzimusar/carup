import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { assembleDecision } from '../services/trustDecision/trustDecisionService.js';
import {
  assertCanonicalStaging,
  createPgSupabaseAdapter,
  runTrustRefresh,
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
        trust_known_limitations text[] DEFAULT NULL,
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
        trust_known_limitations text[] DEFAULT NULL,
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
