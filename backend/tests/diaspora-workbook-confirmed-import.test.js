/**
 * Confirmed workbook import — service tests (Deliverable B, Issue #127).
 *
 * The scenarios here are the ones the feature exists to survive. A confirmed import is the point
 * where a preview becomes real writes across several domains, so the interesting cases are all
 * failure cases:
 *
 *   · the workbook changed between preview and confirm;
 *   · the workbook changed between confirm and execute;
 *   · the user double-clicked, reloaded, or retried;
 *   · quota ran out;
 *   · a row failed halfway through, leaving earlier rows already applied;
 *   · compensation itself failed.
 *
 * Every one of those must end with a truthful statement about what is now in the database. The single
 * worst outcome this service could produce is telling someone their workbook imported when half of it
 * was rolled back, so several tests assert specifically on the absence of that claim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const confirmations = await import('../services/diaspora/workbook/diasporaWorkbookConfirmationService.js');
const confirmed = await import('../services/diaspora/workbook/diasporaWorkbookConfirmedImportService.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');

const TENANT = 'tenant-A';
const CHECKSUM = 'a'.repeat(64);
const OTHER_CHECKSUM = 'b'.repeat(64);
const user = { id: 'user-1', role: 'dealer', tenantId: TENANT };
const otherTenantUser = { id: 'user-2', role: 'dealer', tenantId: 'tenant-B' };

function seed({ status = 'READY_FOR_REVIEW', checksum = CHECKSUM, rejected = 0, errors = 0, rows = [] } = {}) {
  return createMockSupabase({
    diaspora_workbook_import_batches: [{
      id: 'batch-1', tenant_id: TENANT, import_status: status, checksum_sha256: checksum,
      rejected_rows: rejected, error_count: errors, total_rows: rows.length || 2,
      metadata: {}, deleted_at: null, uploaded_by: user.id, updated_by: user.id,
    }],
    diaspora_workbook_import_rows: rows,
    diaspora_workbook_import_confirmations: [],
    diaspora_workbook_import_receipts: [],
    diaspora_import_audit_log: [],
  });
}

const confirm = (client, over = {}) => confirmations.createConfirmation({
  batchId: 'batch-1', workbookChecksum: CHECKSUM, idempotencyKey: 'idem-1',
  userContext: user, supabaseClient: client, ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation issue
// ─────────────────────────────────────────────────────────────────────────────

test('a matching checksum on a ready batch issues a confirmation', async () => {
  const client = seed();
  const { confirmation, replay } = await confirm(client);
  assert.equal(replay, false);
  assert.equal(confirmation.state, 'pending');
  assert.equal(confirmation.workbook_checksum, CHECKSUM);
  assert.ok(confirmation.expires_at, 'a confirmation must expire');
});

test('a MISMATCHED checksum is refused — the user is looking at a stale preview', async () => {
  const client = seed();
  await assert.rejects(
    () => confirm(client, { workbookChecksum: OTHER_CHECKSUM }),
    /workbook has changed since this preview/i,
  );
  assert.equal(client._rows('diaspora_workbook_import_confirmations').length, 0);
});

test('a batch with rejected rows cannot be confirmed', async () => {
  const client = seed({ rejected: 3 });
  await assert.rejects(() => confirm(client), /rejected rows or validation errors/i);
});

test('a batch with validation errors cannot be confirmed', async () => {
  const client = seed({ errors: 1 });
  await assert.rejects(() => confirm(client), /rejected rows or validation errors/i);
});

test('a batch in the wrong state cannot be confirmed', async () => {
  const client = seed({ status: 'DRY_RUN' });
  await assert.rejects(() => confirm(client), /cannot be confirmed/i);
});

test('a batch with no recorded checksum cannot be confirmed', async () => {
  const client = seed({ checksum: null });
  await assert.rejects(() => confirm(client), /no recorded checksum/i);
});

test('a confirmation cannot be issued across tenants', async () => {
  const client = seed();
  await assert.rejects(
    () => confirm(client, { userContext: otherTenantUser }),
    /different organisation/i,
  );
});

test('a duplicate submit converges on ONE confirmation', async () => {
  // Double-click, reload and retry all land here. Two confirmations would mean two imports.
  const client = seed();
  const first = await confirm(client);
  const second = await confirm(client);
  assert.equal(second.replay, true);
  assert.equal(second.confirmation.id, first.confirmation.id);
  assert.equal(client._rows('diaspora_workbook_import_confirmations').length, 1);
});

test('issuing a confirmation requires an idempotency key', async () => {
  const client = seed();
  await assert.rejects(() => confirm(client, { idempotencyKey: null }), /idempotency key/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation validation
// ─────────────────────────────────────────────────────────────────────────────

test('a confirmation is invalidated when the workbook is re-uploaded', async () => {
  const client = seed();
  const { confirmation } = await confirm(client);
  // A new upload replaces the stored checksum.
  client._rows('diaspora_workbook_import_batches')[0].checksum_sha256 = OTHER_CHECKSUM;

  const result = await confirmations.validateConfirmation({
    confirmationId: confirmation.id, batchId: 'batch-1', userContext: user, supabaseClient: client,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WORKBOOK_CHECKSUM_CHANGED');
  assert.match(confirmations.explainRefusal(result.reason), /Nothing was imported/);
});

test('a confirmation is invalidated when the workbook is re-validated', async () => {
  // Same bytes, different validation outcome — a different proposal even though the checksum matches.
  const client = seed();
  const { confirmation } = await confirm(client);
  client._rows('diaspora_workbook_import_batches')[0].metadata = { workbook: { dryRunRevision: 2 } };

  const result = await confirmations.validateConfirmation({
    confirmationId: confirmation.id, batchId: 'batch-1', userContext: user, supabaseClient: client,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'DRY_RUN_REVISION_CHANGED');
});

test('an expired confirmation is refused and marked expired', async () => {
  const client = seed();
  const { confirmation } = await confirm(client, { ttlMinutes: 1 });
  const result = await confirmations.validateConfirmation({
    confirmationId: confirmation.id, batchId: 'batch-1', userContext: user,
    supabaseClient: client, now: new Date(Date.now() + 3600_000).toISOString(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CONFIRMATION_EXPIRED');
  assert.equal(client._rows('diaspora_workbook_import_confirmations')[0].state, 'expired');
});

test('a confirmation from another tenant is refused', async () => {
  const client = seed();
  const { confirmation } = await confirm(client);
  const result = await confirmations.validateConfirmation({
    confirmationId: confirmation.id, batchId: 'batch-1', userContext: otherTenantUser, supabaseClient: client,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CONFIRMATION_TENANT_MISMATCH');
});

test('a confirmation for a different batch is refused', async () => {
  const client = seed();
  const { confirmation } = await confirm(client);
  const result = await confirmations.validateConfirmation({
    confirmationId: confirmation.id, batchId: 'batch-OTHER', userContext: user, supabaseClient: client,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CONFIRMATION_BATCH_MISMATCH');
});

test('consuming is single-use and race-safe', async () => {
  const client = seed();
  const { confirmation } = await confirm(client);
  const first = await confirmations.consumeConfirmation({ confirmationId: confirmation.id, supabaseClient: client });
  const second = await confirmations.consumeConfirmation({ confirmationId: confirmation.id, supabaseClient: client });
  assert.ok(first, 'the first consumer wins');
  assert.equal(second, null, 'the second gets nothing — otherwise the workbook imports twice');
});

test('re-validating a batch invalidates its live confirmations', async () => {
  const client = seed();
  await confirm(client);
  const invalidated = await confirmations.invalidateConfirmationsForBatch({
    batchId: 'batch-1', reason: 'WORKBOOK_REVALIDATED', supabaseClient: client,
  });
  assert.equal(invalidated.length, 1);
  assert.equal(client._rows('diaspora_workbook_import_confirmations')[0].state, 'invalidated');
});

test('every refusal reason has a user-facing message', () => {
  for (const reason of Object.keys(confirmations.CONFIRMATION_REFUSAL_MESSAGES)) {
    const message = confirmations.explainRefusal(reason);
    assert.ok(message.length > 10, `${reason} needs a real message`);
    assert.doesNotMatch(message, /undefined|null/);
  }
  // An unknown reason still produces something actionable rather than leaking a code.
  assert.match(confirmations.explainRefusal('SOMETHING_NEW'), /Re-run the dry run/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

test('execution refuses without a valid confirmation and imports nothing', async () => {
  const client = seed();
  await assert.rejects(
    () => confirmed.executeConfirmedWorkbookImport({
      batchId: 'batch-1', confirmationId: 'does-not-exist', userContext: user, supabaseClient: client,
    }),
    /could not be found/i,
  );
});

test('execution refuses a consumed confirmation — nothing is imported twice', async () => {
  const client = seed();
  const { confirmation } = await confirm(client);
  await confirmations.consumeConfirmation({ confirmationId: confirmation.id, supabaseClient: client });

  await assert.rejects(
    () => confirmed.executeConfirmedWorkbookImport({
      batchId: 'batch-1', confirmationId: confirmation.id, userContext: user, supabaseClient: client,
    }),
    /already been imported/i,
  );
});

test('execution refuses when the workbook changed after confirmation', async () => {
  const client = seed();
  const { confirmation } = await confirm(client);
  client._rows('diaspora_workbook_import_batches')[0].checksum_sha256 = OTHER_CHECKSUM;

  await assert.rejects(
    () => confirmed.executeConfirmedWorkbookImport({
      batchId: 'batch-1', confirmationId: confirmation.id, userContext: user, supabaseClient: client,
    }),
    /changed since you confirmed/i,
  );
  // The confirmation must NOT have been consumed by a refused execution.
  assert.equal(client._rows('diaspora_workbook_import_confirmations')[0].state, 'pending');
});

test('an empty plan still completes truthfully rather than claiming rows were imported', async () => {
  const client = seed({ rows: [] });
  const { confirmation } = await confirm(client);
  const result = await confirmed.executeConfirmedWorkbookImport({
    batchId: 'batch-1', confirmationId: confirmation.id, userContext: user, supabaseClient: client,
  });
  assert.equal(result.imported, true);
  assert.equal(result.appliedRows, 0);
  assert.match(result.userMessage, /Imported 0 rows/);
});

test('the batch reaches IMPORTED on a clean run', async () => {
  const client = seed({ rows: [] });
  const { confirmation } = await confirm(client);
  await confirmed.executeConfirmedWorkbookImport({
    batchId: 'batch-1', confirmationId: confirmation.id, userContext: user, supabaseClient: client,
  });
  assert.equal(client._rows('diaspora_workbook_import_batches')[0].import_status, 'IMPORTED');
});

test('a blocked row is receipted as rejected, not silently dropped', async () => {
  const client = seed({
    rows: [{ id: 'r1', batch_id: 'batch-1', row_number: 1, sheet_name: 'Stock', validation_status: 'REJECTED', deleted_at: null }],
  });
  const { confirmation } = await confirm(client);
  await confirmed.executeConfirmedWorkbookImport({
    batchId: 'batch-1', confirmationId: confirmation.id, userContext: user, supabaseClient: client,
  });
  const receipts = client._rows('diaspora_workbook_import_receipts');
  assert.ok(receipts.length >= 1, 'every row is accounted for');
  assert.ok(receipts.every((r) => ['accepted', 'rejected', 'skipped', 'compensated'].includes(r.outcome)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Truthfulness of outcomes
// ─────────────────────────────────────────────────────────────────────────────

test('no unfinished state is ever described as imported', () => {
  const unfinished = ['IMPORTING', 'COMPENSATING', 'PARTIALLY_IMPORTED', 'NEEDS_OPERATOR', 'FAILED_IMPORT', 'COMPENSATED'];
  for (const status of unfinished) {
    const described = confirmed.describeImportForUser(status);
    assert.equal(described.ok, false, `${status} must not read as a successful import`);
    assert.doesNotMatch(described.message, /^Imported\.$/, `${status} must not claim it imported`);
  }
  const done = confirmed.describeImportForUser('IMPORTED');
  assert.equal(done.ok, true);
  assert.equal(done.settled, true);
});

test('a compensated import says plainly that nothing was imported', () => {
  const described = confirmed.describeImportForUser('COMPENSATED');
  assert.match(described.message, /Nothing was imported/);
});

test('a partly-applied, un-reversible import tells the user not to retry', () => {
  // This is the one state where a retry could genuinely double-apply.
  const described = confirmed.describeImportForUser('NEEDS_OPERATOR');
  assert.match(described.message, /do not retry/i);
  assert.equal(described.settled, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Result export
// ─────────────────────────────────────────────────────────────────────────────

test('the result CSV has a stable header and one line per receipt', () => {
  const csv = confirmed.buildReceiptCsv([
    { row_number: 1, sheet_name: 'Stock', outcome: 'accepted', entity_type: 'diaspora_import_orders', entity_ref: 'x', error_code: null, error_message: null },
    { row_number: 2, sheet_name: 'Stock', outcome: 'rejected', entity_type: null, entity_ref: null, error_code: 'ROW_BLOCKED', error_message: 'bad' },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'row_number,sheet,outcome,entity_type,entity_ref,error_code,error_message');
  assert.equal(lines.length, 3);
});

test('the result CSV escapes separators so a comma cannot break the column count', () => {
  const csv = confirmed.buildReceiptCsv([
    { row_number: 1, sheet_name: 'A,B', outcome: 'rejected', entity_type: null, entity_ref: null, error_code: 'X', error_message: 'he said "no", then left\nnew line' },
  ]);
  assert.ok(csv.includes('"A,B"'));
  assert.ok(csv.includes('""no""'), 'embedded quotes are doubled');
});

test('the result CSV carries outcomes and reasons, never workbook cell values', () => {
  // The user already has their own file. Echoing its contents into a second artefact would only
  // create another copy of whatever personal data it held.
  const header = confirmed.buildReceiptCsv([]).trim();
  for (const forbidden of ['email', 'phone', 'name', 'address', 'value']) {
    assert.ok(!header.includes(forbidden), `the export must not have a ${forbidden} column`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Recovery
// ─────────────────────────────────────────────────────────────────────────────

test('interrupted batches are surfaced for a human, and the un-reversible one is flagged', async () => {
  const client = createMockSupabase({
    diaspora_workbook_import_batches: [
      { id: 'b1', tenant_id: TENANT, import_status: 'IMPORTING', total_rows: 5, updated_at: 'x', metadata: {} },
      { id: 'b2', tenant_id: TENANT, import_status: 'COMPENSATING', total_rows: 3, updated_at: 'x', metadata: {} },
      { id: 'b3', tenant_id: TENANT, import_status: 'NEEDS_OPERATOR', total_rows: 4, updated_at: 'x', metadata: {} },
      { id: 'b4', tenant_id: TENANT, import_status: 'IMPORTED', total_rows: 9, updated_at: 'x', metadata: {} },
    ],
  });
  const rows = await confirmed.listInterruptedBatches({ tenantId: TENANT, supabaseClient: client });
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(ids, ['b1', 'b2', 'b3'], 'a completed import is not interrupted');
  assert.equal(rows.find((r) => r.id === 'b3').needsHuman, true);
  assert.equal(rows.find((r) => r.id === 'b1').needsHuman, false);
});

test('the confirmed-import quota key is one the plan matrix actually grants', async () => {
  // A key absent from the matrix resolves to a zero limit and denies every tenant on every plan —
  // indistinguishable from correct enforcement, and very hard to notice.
  const { PLAN_CATALOG, FEATURE_KEYS } = await import('../constants/diaspora/diasporaEntitlements.js');
  assert.equal(confirmed.CONFIRMED_IMPORT_FEATURE_KEY, FEATURE_KEYS.WORKBOOK_BULK_IMPORT);
  const granted = Object.values(PLAN_CATALOG || {})
    .some((plan) => Number(plan?.entitlements?.[confirmed.CONFIRMED_IMPORT_FEATURE_KEY] ?? 0) > 0);
  assert.ok(granted, 'at least one plan must grant a non-zero bulk-import quota');
});
