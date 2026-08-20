import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FULL_CHAIN_TEST = path.join(HERE, 'issue164-phase6-full-postgres-chain.test.js');
const GENERATED_TEST = path.join(HERE, '.issue164-phase6-full-chain-1290.generated.test.js');

const MIGRATION_1280 = "  '../../database/migrations/20260819128000_issue164_phase6_payment_race_recovery.sql',";
const MIGRATION_1290 = "  '../../database/migrations/20260819129000_issue164_phase6_settlement_recovery_fence.sql',";
const EXECUTION_SENTINEL = 'Phase 6 full migration chain is order-safe and server-authoritative on PostgreSQL';

/**
 * Closure-audit guard.
 *
 * The historical Phase 6 full-chain harness was written before migration 1290 and therefore stopped
 * at 1280 even though the focused recovery-race harness exercised 1270 -> 1280 -> 1290. Phase 6
 * certification requires the accumulated schema chain itself to be order-safe, so this test executes
 * the real full-chain harness with 1290 appended when the historical harness has not yet been updated.
 *
 * Keeping this as a separate guard makes the omission mechanically visible: if the main harness is
 * later updated to include 1290, this test simply executes that exact source without double-inserting
 * the migration.
 */
test('Phase 6 closure audit — accumulated PostgreSQL chain executes through migration 1290', () => {
  const original = readFileSync(FULL_CHAIN_TEST, 'utf8');
  assert.match(original, /20260819128000_issue164_phase6_payment_race_recovery\.sql/);

  let certifiedSource = original;
  if (!certifiedSource.includes('20260819129000_issue164_phase6_settlement_recovery_fence.sql')) {
    assert.ok(
      certifiedSource.includes(MIGRATION_1280),
      'full-chain harness no longer contains the expected migration 1280 anchor',
    );
    certifiedSource = certifiedSource.replace(
      MIGRATION_1280,
      `${MIGRATION_1280}\n${MIGRATION_1290}`,
    );
  }

  const orderedMigrations = [
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

  let cursor = -1;
  for (const migration of orderedMigrations) {
    const next = certifiedSource.indexOf(migration);
    assert.ok(next > cursor, `${migration} must appear in Phase 6 dependency order`);
    cursor = next;
  }

  try {
    writeFileSync(GENERATED_TEST, certifiedSource, 'utf8');

    // `node --test` marks child test workers with NODE_TEST_CONTEXT. Propagating that marker into a
    // nested runner makes Node treat the invocation as recursive and it can exit 0 without loading
    // the generated test. Remove it so this is a real second test process, then require an execution
    // sentinel in TAP output so a future silent-skip behavior cannot certify the chain vacuously.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;

    const result = spawnSync(process.execPath, ['--test', GENERATED_TEST], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });

    assert.equal(
      result.status,
      0,
      `full Phase 6 PostgreSQL chain through 1290 failed\nSTDOUT:\n${result.stdout || ''}\nSTDERR:\n${result.stderr || ''}`,
    );
    assert.match(
      result.stdout || '',
      new RegExp(EXECUTION_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `nested Phase 6 chain runner exited without executing the generated PostgreSQL test\nSTDOUT:\n${result.stdout || ''}\nSTDERR:\n${result.stderr || ''}`,
    );
  } finally {
    try { unlinkSync(GENERATED_TEST); } catch { /* best-effort cleanup */ }
  }
});
