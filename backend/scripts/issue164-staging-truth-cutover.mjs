#!/usr/bin/env node
/**
 * Issue #164 — controlled staging truth cutover.
 *
 * Applies exactly the accumulated 16 Issue #164 migrations authorized after Phase 6 and before
 * Phase 7. This runner is STAGING ONLY, fail-closed, and deliberately all-or-nothing.
 *
 * Safety contract:
 *   - positively requires Supabase staging ref eoyenigwevnxwwhyhaer in the operator URL;
 *   - explicitly refuses the known production ref;
 *   - requires every migration file to be byte-identical to the Phase 6 certified source anchor;
 *   - accepts only 0/16 or 16/16 ledger state; an ambiguous partial cutover aborts;
 *   - preflight executes the complete chain + ledger writes in one transaction, verifies, ROLLBACKs;
 *   - apply executes the complete chain + ledger writes in one transaction, verifies, COMMITs;
 *   - if all 16 are already ledgered with the exact names, the run is verify-only;
 *   - never prints the connection URL or credentials;
 *   - writes a non-secret JSON receipt for Actions artifact retention.
 *
 * This does NOT deploy application code, seed Phase 7, activate Gemini, or touch production.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = 'vhmnajoeicasaigiophh';
const PHASE6_SOURCE_ANCHOR = 'e2d2f8a873ebb2714dc44587b17f9832d1ef69ed';
const RECEIPT_FILE = 'issue164-staging-truth-cutover-receipt.json';

const MIGRATIONS = [
  '20260817090000_issue164_phase0_flagged_table_containment.sql',
  '20260817140000_issue164_trust_cache_provenance.sql',
  '20260818100000_issue164_drop_dead_vehicle_listing_summaries.sql',
  '20260818110000_issue164_listing_location_provenance.sql',
  '20260819100000_issue164_phase6_transaction_terms.sql',
  '20260819110000_issue164_phase6_atomic_reservations.sql',
  '20260819120000_issue164_phase6_deposit_payment_lifecycle.sql',
  '20260819121000_issue164_phase6_atomic_session_actions.sql',
  '20260819122000_issue164_phase6_atomic_transaction_intent.sql',
  '20260819123000_issue164_phase6_finance_truth.sql',
  '20260819124000_issue164_phase6_reservation_expiry_reconciliation.sql',
  '20260819125000_issue164_phase6_provider_reconciliation_hardening.sql',
  '20260819126000_issue164_phase6_payment_operation_hardening.sql',
  '20260819127000_issue164_phase6_settlement_recovery.sql',
  '20260819128000_issue164_phase6_payment_race_recovery.sql',
  '20260819129000_issue164_phase6_settlement_recovery_fence.sql',
];

const TRANSACTION_TABLES = [
  'escrow_trust_sessions',
  'escrow_trust_events',
  'escrow_trust_webhook_events',
  'vehicle_reservations',
  'safetrade_sandbox_payment_intents',
  'safetrade_sandbox_payment_operations',
];

const TRUST_STAMP_COLUMNS = [
  'trust_calculation_version',
  'trust_evaluated_at',
  'trust_band',
  'trust_confidence',
  'trust_known_limitations',
  'trust_evidence_basis',
];

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const MODE = modeArg?.split('=')[1] ?? 'preflight';
if (!['preflight', 'apply', 'verify'].includes(MODE)) {
  console.error(`FAIL-CLOSED: unsupported --mode=${MODE}`);
  process.exit(1);
}

const fail = (message) => {
  console.error(`FAIL-CLOSED: ${message}`);
  process.exit(1);
};

const quoteIdent = (value) => `"${String(value).replaceAll('"', '""')}"`;
const migrationParts = (file) => {
  const match = file.match(/^(\d{14})_(.+)\.sql$/);
  if (!match) fail(`invalid migration filename ${file}`);
  return { version: match[1], name: match[2] };
};

function migrationPath(file) {
  return fileURLToPath(new URL(`../../database/migrations/${file}`, import.meta.url));
}

function assertMigrationTreeFrozen() {
  try {
    execFileSync('git', ['cat-file', '-e', `${PHASE6_SOURCE_ANCHOR}^{commit}`], { stdio: 'ignore' });
  } catch {
    fail(`certified source anchor ${PHASE6_SOURCE_ANCHOR} is unavailable in checkout history`);
  }

  for (const file of MIGRATIONS) {
    const rel = `database/migrations/${file}`;
    try {
      execFileSync('git', ['diff', '--quiet', PHASE6_SOURCE_ANCHOR, 'HEAD', '--', rel]);
    } catch {
      fail(`${rel} differs from certified Phase 6 source anchor ${PHASE6_SOURCE_ANCHOR}`);
    }
  }
}

function loadMigrations() {
  return MIGRATIONS.map((file) => {
    const raw = readFileSync(migrationPath(file), 'utf8');
    if (!/^-- \+migrate Up\s*$/m.test(raw)) fail(`${file} has no +migrate Up marker`);
    const up = raw.split(/^-- \+migrate Down\s*$/m)[0].replace(/^-- \+migrate Up\s*/m, '');
    if (!up.trim()) fail(`${file} has an empty Up block`);
    const prohibited = up.match(/\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|REINDEX\s+CONCURRENTLY|VACUUM|BEGIN\s*;|COMMIT\s*;)\b/i);
    if (prohibited) fail(`${file} contains transaction-incompatible control '${prohibited[0]}'`);
    const { version, name } = migrationParts(file);
    return {
      file,
      version,
      name,
      up,
      sha256: createHash('sha256').update(raw).digest('hex'),
    };
  });
}

async function tableExists(client, table) {
  const result = await client.query(`SELECT to_regclass('public.' || $1) IS NOT NULL AS ok`, [table]);
  return result.rows[0].ok;
}

async function tableCount(client, table) {
  if (!(await tableExists(client, table))) return null;
  const result = await client.query(`SELECT count(*)::bigint::text AS n FROM public.${quoteIdent(table)}`);
  return result.rows[0].n;
}

async function trustScoreChecksum(client) {
  if (!(await tableExists(client, 'vehicles'))) return null;
  const result = await client.query(`
    SELECT md5(coalesce(string_agg(vin || '=' || coalesce(trust_score::text, 'NULL'), ',' ORDER BY vin), '')) AS checksum
    FROM public.vehicles
  `);
  return result.rows[0].checksum;
}

async function migrationLedger(client, migrations) {
  const exists = (await client.query(`SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) fail('supabase_migrations.schema_migrations is absent');
  const versions = migrations.map((m) => m.version);
  const result = await client.query(
    `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[]) ORDER BY version`,
    [versions],
  );
  return result.rows;
}

async function snapshot(client, migrations) {
  const latest = await client.query(`
    SELECT version, name
      FROM supabase_migrations.schema_migrations
     ORDER BY version DESC
     LIMIT 1
  `);
  const clientGrantCount = await client.query(`
    SELECT count(*)::int AS n
      FROM information_schema.role_table_grants
     WHERE table_schema='public'
       AND table_name = ANY($1::text[])
       AND grantee IN ('anon','authenticated')
  `, [TRANSACTION_TABLES]);
  const currencySource = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='vehicles' AND column_name='currency_source'
    ) AS ok
  `);
  const trustStampCount = await client.query(`
    SELECT count(*)::int AS n
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles' AND column_name = ANY($1::text[])
  `, [TRUST_STAMP_COLUMNS]);
  const legacySummary = await client.query(`SELECT to_regclass('public.vehicle_listing_summaries') IS NOT NULL AS exists`);

  return {
    ledgerApplied: (await migrationLedger(client, migrations)).length,
    ledgerLatest: latest.rows[0] ?? null,
    vehicles: await tableCount(client, 'vehicles'),
    vehicleEvidence: await tableCount(client, 'vehicle_evidence'),
    ownershipHistory: await tableCount(client, 'vehicle_ownership_history'),
    escrowSessions: await tableCount(client, 'escrow_trust_sessions'),
    trustScoreChecksum: await trustScoreChecksum(client),
    transactionClientGrantCount: clientGrantCount.rows[0].n,
    currencySourceColumn: currencySource.rows[0].ok,
    trustStampColumns: trustStampCount.rows[0].n,
    vehicleListingSummariesExists: legacySummary.rows[0].exists,
  };
}

async function assertLedgerShape(rows, migrations) {
  const expected = new Map(migrations.map((m) => [m.version, m.name]));
  for (const row of rows) {
    if (expected.get(row.version) !== row.name) {
      fail(`migration version ${row.version} is ledgered as '${row.name}', expected '${expected.get(row.version)}'`);
    }
  }
  if (![0, migrations.length].includes(rows.length)) {
    fail(`ambiguous partial Issue #164 cutover: ${rows.length}/${migrations.length} migrations already ledgered`);
  }
  return rows.length === migrations.length ? 'verify-only' : 'apply';
}

async function insertLedgerRow(client, migration) {
  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)`,
    [migration.version, [migration.up], migration.name],
  );
}

async function verifyCutover(client, migrations, { requireLedger = true } = {}) {
  const errors = [];

  if (requireLedger) {
    const rows = await migrationLedger(client, migrations);
    if (rows.length !== migrations.length) errors.push(`ledger has ${rows.length}/${migrations.length} Issue #164 migrations`);
    const byVersion = new Map(rows.map((r) => [r.version, r.name]));
    for (const m of migrations) {
      if (byVersion.get(m.version) !== m.name) errors.push(`ledger mismatch ${m.version}`);
    }
  }

  if (!(await tableExists(client, 'vehicles'))) errors.push('public.vehicles is missing');

  const currency = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='vehicles' AND column_name='currency_source'
    ) AS ok
  `);
  if (!currency.rows[0].ok) errors.push('vehicles.currency_source is missing');

  const stamp = await client.query(`
    SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles' AND column_name = ANY($1::text[])
  `, [TRUST_STAMP_COLUMNS]);
  if (stamp.rows.length !== TRUST_STAMP_COLUMNS.length) errors.push(`trust stamp is ${stamp.rows.length}/${TRUST_STAMP_COLUMNS.length} columns`);
  for (const row of stamp.rows) {
    if (row.is_nullable !== 'YES' || row.column_default !== null) errors.push(`${row.column_name} must remain nullable/no-default`);
  }

  if (await tableExists(client, 'vehicle_listing_summaries')) errors.push('dead vehicle_listing_summaries still exists');

  for (const table of TRANSACTION_TABLES) {
    if (!(await tableExists(client, table))) {
      errors.push(`${table} is missing`);
      continue;
    }
    const grants = await client.query(`
      SELECT grantee, privilege_type::text
        FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated')
    `, [table]);
    if (grants.rows.length) {
      errors.push(`${table} retains ${grants.rows.length} direct anon/authenticated grant(s)`);
    }
  }

  // Column-level grants are not represented by the table-level query above.
  const columnGrants = await client.query(`
    SELECT count(*)::int AS n
      FROM pg_class k
      JOIN pg_namespace ns ON ns.oid = k.relnamespace
      JOIN pg_attribute a ON a.attrelid = k.oid AND a.attacl IS NOT NULL
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
      JOIN pg_roles r ON r.oid = acl.grantee
     WHERE ns.nspname='public'
       AND k.relname = ANY($1::text[])
       AND r.rolname IN ('anon','authenticated')
  `, [TRANSACTION_TABLES]);
  if (columnGrants.rows[0].n !== 0) errors.push(`${columnGrants.rows[0].n} transaction-table column grant(s) remain`);

  if (errors.length) {
    errors.forEach((error) => console.error(`CONTRACT VIOLATION: ${error}`));
    throw new Error(`${errors.length} post-cutover contract violation(s)`);
  }
}

async function executeChain(client, migrations, { rollback }) {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '15s'`);
    await client.query(`SET LOCAL statement_timeout = '120s'`);
    for (const migration of migrations) {
      console.log(`${rollback ? 'preflight' : 'apply'}: ${migration.file} sha256:12=${migration.sha256.slice(0, 12)}`);
      await client.query(migration.up);
      await insertLedgerRow(client, migration);
    }
    await verifyCutover(client, migrations, { requireLedger: true });
    await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const rawUrl = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!rawUrl) fail('DIASPORA_STAGING_DATABASE_URL is not configured');
  if (rawUrl.includes(FORBIDDEN_PROD_REF)) fail(`operator URL references forbidden production ref ${FORBIDDEN_PROD_REF}`);
  if (!rawUrl.includes(STAGING_REF)) fail(`operator URL must positively reference staging ref ${STAGING_REF}`);

  assertMigrationTreeFrozen();
  const migrations = loadMigrations();
  const url = rawUrl.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120000,
    application_name: 'carup-issue164-staging-truth-cutover',
  });

  await client.connect();
  try {
    const identity = await client.query(`SELECT current_database() AS db, current_user AS db_user, current_setting('server_version') AS server_version`);
    console.log(`staging identity: ref=${STAGING_REF}, db=${identity.rows[0].db}, server=${identity.rows[0].server_version}`);
    const before = await snapshot(client, migrations);
    console.log(`before: issue164=${before.ledgerApplied}/16, latest=${before.ledgerLatest?.version ?? 'none'}, vehicles=${before.vehicles ?? 'absent'}, evidence=${before.vehicleEvidence ?? 'absent'}, escrow_client_grants=${before.transactionClientGrantCount}`);

    const existing = await migrationLedger(client, migrations);
    const state = await assertLedgerShape(existing, migrations);

    if (MODE === 'preflight') {
      if (state === 'verify-only') {
        await verifyCutover(client, migrations, { requireLedger: true });
        console.log('PREFLIGHT PASS: all 16 migrations already ledgered; current postconditions pass (verify-only).');
      } else {
        await executeChain(client, migrations, { rollback: true });
        const afterRollback = await snapshot(client, migrations);
        if (afterRollback.ledgerApplied !== 0) fail('preflight rollback left Issue #164 ledger rows behind');
        if (afterRollback.trustScoreChecksum !== before.trustScoreChecksum) fail('preflight rollback changed vehicles.trust_score');
        console.log('PREFLIGHT PASS: complete 16-migration chain executed against live staging schema and rolled back cleanly.');
      }
      return;
    }

    if (MODE === 'apply') {
      if (state === 'apply') {
        await executeChain(client, migrations, { rollback: false });
        console.log('APPLY PASS: all 16 Issue #164 migrations committed atomically with ledger rows.');
      } else {
        await verifyCutover(client, migrations, { requireLedger: true });
        console.log('APPLY PASS: all 16 migrations were already present; verify-only rerun passed.');
      }
    } else {
      if (state !== 'verify-only') fail('verify mode requires all 16 migrations to already be ledgered');
      await verifyCutover(client, migrations, { requireLedger: true });
      console.log('VERIFY PASS: all 16 Issue #164 migrations and postconditions are present.');
    }

    const after = await snapshot(client, migrations);
    if (after.ledgerApplied !== migrations.length) fail(`post-apply ledger is ${after.ledgerApplied}/${migrations.length}`);
    if (before.vehicles !== after.vehicles) fail(`vehicles row count changed ${before.vehicles} -> ${after.vehicles}`);
    if (before.vehicleEvidence !== after.vehicleEvidence) fail(`vehicle_evidence row count changed ${before.vehicleEvidence} -> ${after.vehicleEvidence}`);
    if (before.ownershipHistory !== after.ownershipHistory) fail(`vehicle_ownership_history row count changed ${before.ownershipHistory} -> ${after.ownershipHistory}`);
    if (before.trustScoreChecksum !== after.trustScoreChecksum) fail('migration cutover rewrote vehicles.trust_score');

    const rls = {};
    for (const table of TRANSACTION_TABLES) {
      const result = await client.query(`
        SELECT c.relrowsecurity AS rls
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname=$1
      `, [table]);
      rls[table] = result.rows[0]?.rls ?? null;
    }

    const receipt = {
      programme: 'issue164-controlled-staging-truth-cutover',
      result: 'PASS',
      stagingRef: STAGING_REF,
      phase6SourceAnchor: PHASE6_SOURCE_ANCHOR,
      operationalHead: process.env.GITHUB_SHA ?? null,
      mode: state === 'verify-only' ? 'verify-only' : 'apply',
      appliedMigrationCount: migrations.length,
      migrations: migrations.map(({ file, version, name, sha256 }) => ({ file, version, name, sha256 })),
      before,
      after,
      transactionTableRls: rls,
      productionTouched: false,
      liveProviderActivated: false,
      geminiActivated: false,
      completedAt: new Date().toISOString(),
    };
    writeFileSync(RECEIPT_FILE, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    console.log(`CUTOVER VERIFY PASS: issue164=16/16, escrow_client_grants=${after.transactionClientGrantCount}, currency_source=${after.currencySourceColumn}, trust_stamp=${after.trustStampColumns}/6, legacy_summary_exists=${after.vehicleListingSummariesExists}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => fail(error?.message ?? String(error)));
