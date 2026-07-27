/**
 * Confirmed workbook import — cross-module CONTRACT tests (Deliverable B, Issue #127).
 *
 * The 31 tests in diaspora-workbook-confirmed-import.test.js all passed while the feature could not
 * apply a single row, because the only `appliedRows` assertion in that file runs against an EMPTY
 * row set (`rows: []`, so `appliedRows === 0` is trivially true). Nothing anywhere asserted the
 * shape of the value the orchestrator actually receives from the executor.
 *
 * That gap hid three defects. These tests are written from the seam rather than from either side of
 * it:
 *
 *   A. `executeWorkbookImportAction` reports through `status` + `targetRecordId`. It has never had
 *      an `executed` boolean or a `recordId` field, but the confirmed-import orchestrator read
 *      exactly those. Every row therefore fell into the "skipped" branch: `applied` stayed empty,
 *      compensation had nothing to reverse, and a half-applied run still told the user "every
 *      applied row was reversed. Nothing was imported." while the draft rows sat in the database.
 *   B. The .xlsx upload route hashes the raw bytes and passes `sourceChecksum` as an option, but the
 *      persistence layer only ever read the checksum out of the client payload — so every uploaded
 *      workbook persisted with `checksum_sha256 = NULL` and could never be confirmed.
 *   C. The receipt endpoints authorized the session but never the batch, and the receipt query drops
 *      its tenant filter when the request carries no tenant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const execution = await import('../services/diaspora/diasporaWorkbookImportExecutionService.js');
const confirmed = await import('../services/diaspora/workbook/diasporaWorkbookConfirmedImportService.js');
const persistence = await import('../services/diaspora/diasporaWorkbookPersistenceService.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');

// ─────────────────────────────────────────────────────────────────────────────
// A. The executor→orchestrator result contract
// ─────────────────────────────────────────────────────────────────────────────

test('the executor never returns `executed`/`recordId` — the fields the orchestrator used to read', async () => {
  // A deliberately non-executable action: the point is the SHAPE of the envelope, which is the same
  // for every outcome. If this ever gains an `executed` field the orchestrator can be simplified,
  // and if it loses `status` the orchestrator must change with it.
  const client = createMockSupabase({ diaspora_import_orders: [] });
  const result = await execution.executeWorkbookImportAction(
    { rowId: 'r1', sheetName: 'Stock', workbookRowNumber: 1, targetTable: 'diaspora_import_orders', proposedAction: 'REVIEW_ONLY' },
    { id: 'batch-1', tenant_id: 'tenant-A' },
    { id: 'user-1', role: 'admin', tenantId: 'tenant-A' },
    { supabaseClient: client },
  );

  assert.equal(typeof result.status, 'string', 'the executor reports outcome through `status`');
  assert.ok('targetRecordId' in result, 'and identifies the record through `targetRecordId`');
  assert.equal(result.executed, undefined, 'there is no `executed` boolean to branch on');
  assert.equal(result.recordId, undefined, 'and no `recordId` — reading it yielded undefined');
});

test('the orchestrator treats a status-based executed result as APPLIED, not skipped', () => {
  // Reproduces the exact envelope makeExecutedResult produces and asserts the orchestrator's
  // classification of it. Before the fix this classified as "skipped" and `applied` stayed empty.
  const executed = {
    rowId: 'r1', sheetName: 'Stock', workbookRowNumber: 1,
    targetTable: 'diaspora_import_orders', targetRecordId: 'rec-1',
    status: 'executed', action: 'CREATE_DRAFT',
    message: 'Draft record created from reviewed workbook row.', blockedReason: null, errorCode: null,
  };
  const classified = confirmed.classifyExecutionResult(executed);
  assert.equal(classified.outcome, 'accepted');
  assert.equal(classified.applied, true, 'an executed row must be compensatable');
  assert.equal(classified.recordId, 'rec-1');
});

test('an alreadyExecuted row is accepted but NOT compensatable by this run', () => {
  // A previous run created the record. Reversing it here would undo work this import did not do.
  const already = {
    targetTable: 'diaspora_import_orders', targetRecordId: 'rec-old',
    status: 'alreadyExecuted', errorCode: null, message: 'Workbook row already has a successful draft import result.',
  };
  const classified = confirmed.classifyExecutionResult(already);
  assert.equal(classified.outcome, 'accepted');
  assert.equal(classified.applied, false, 'this run did not create it, so it must not reverse it');
});

test('a skipped row carries the executor\'s errorCode, not an invented one', () => {
  const skipped = {
    targetTable: 'diaspora_import_orders', targetRecordId: null,
    status: 'skipped', errorCode: 'APPROVAL_REQUIRED',
    message: 'Workbook action requires reviewer/admin approval before draft execution.',
  };
  const classified = confirmed.classifyExecutionResult(skipped);
  assert.equal(classified.outcome, 'skipped');
  assert.equal(classified.applied, false);
  // The old code read `result.skipCode` / `result.reason`, neither of which the executor sets, so
  // every skip was recorded as the generic ROW_SKIPPED and the real reason was lost.
  assert.equal(classified.errorCode, 'APPROVAL_REQUIRED');
});

test('a blocked row reports its blockedReason when no errorCode is present', () => {
  const classified = confirmed.classifyExecutionResult({
    status: 'blocked', targetRecordId: null, errorCode: null, blockedReason: 'TARGET_TABLE_NOT_ALLOW_LISTED',
  });
  assert.equal(classified.outcome, 'skipped');
  assert.equal(classified.errorCode, 'TARGET_TABLE_NOT_ALLOW_LISTED');
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Server-computed checksum must reach the batch
// ─────────────────────────────────────────────────────────────────────────────

const CHECKSUM = 'c'.repeat(64);

function persistClient() {
  return createMockSupabase({
    diaspora_workbook_import_batches: [],
    diaspora_workbook_import_rows: [],
  });
}

test('a checksum computed by the upload route is persisted on the batch', async () => {
  // The .xlsx route hashes the raw bytes itself and passes them as options.sourceChecksum. Before
  // the fix this was dropped, checksum_sha256 stayed NULL, and POST /confirm refused the batch with
  // BATCH_CHECKSUM_MISSING — making the entire upload path unconfirmable.
  const client = persistClient();
  await persistence.persistDiasporaWorkbookDryRun(
    { templateType: 'diaspora_v1', idempotencyKey: 'idem-xlsx-1', sheets: {} },
    { canImport: true, totals: { totalRows: 0, acceptedRows: 0, errorCount: 0, warningCount: 0 }, errors: [], warnings: [], summaries: [] },
    { id: 'user-1', tenantId: 'tenant-A' },
    { supabaseClient: client, sourceChecksum: CHECKSUM, sourceFilename: 'stock.xlsx' },
  );

  const batch = client._rows('diaspora_workbook_import_batches')[0];
  assert.equal(batch.checksum_sha256, CHECKSUM, 'the server-computed checksum reaches the batch');
  assert.equal(batch.source_filename, 'stock.xlsx');
});

test('the server-computed checksum wins over a client-declared one', async () => {
  // A client that declares its own checksum must not be able to bind a confirmation to a value the
  // server did not compute from the bytes it actually received.
  const client = persistClient();
  await persistence.persistDiasporaWorkbookDryRun(
    { templateType: 'diaspora_v1', idempotencyKey: 'idem-xlsx-2', sheets: {}, source: { checksumSha256: 'd'.repeat(64) } },
    { canImport: true, totals: { totalRows: 0, acceptedRows: 0, errorCount: 0, warningCount: 0 }, errors: [], warnings: [], summaries: [] },
    { id: 'user-1', tenantId: 'tenant-A' },
    { supabaseClient: client, sourceChecksum: CHECKSUM },
  );
  assert.equal(client._rows('diaspora_workbook_import_batches')[0].checksum_sha256, CHECKSUM);
});

test('a client-declared checksum is still honoured when the server computed none', async () => {
  // The JSON dry-run path has no bytes to hash, so it legitimately relies on the payload value.
  const client = persistClient();
  await persistence.persistDiasporaWorkbookDryRun(
    { templateType: 'diaspora_v1', idempotencyKey: 'idem-json-1', sheets: {}, source: { checksumSha256: CHECKSUM } },
    { canImport: true, totals: { totalRows: 0, acceptedRows: 0, errorCount: 0, warningCount: 0 }, errors: [], warnings: [], summaries: [] },
    { id: 'user-1', tenantId: 'tenant-A' },
    { supabaseClient: client },
  );
  assert.equal(client._rows('diaspora_workbook_import_batches')[0].checksum_sha256, CHECKSUM);
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Tenant-wide reads fail closed
// ─────────────────────────────────────────────────────────────────────────────

test('interrupted imports return nothing when the caller has no tenant context', async () => {
  // The query is unscoped without a tenant, so it would otherwise return every tenant's interrupted
  // batches to any authenticated caller that omitted x-tenant-id.
  const client = createMockSupabase({
    diaspora_workbook_import_batches: [
      { id: 'b1', tenant_id: 'tenant-A', import_status: 'IMPORTING', total_rows: 3, updated_at: null, metadata: {} },
      { id: 'b2', tenant_id: 'tenant-B', import_status: 'NEEDS_OPERATOR', total_rows: 1, updated_at: null, metadata: {} },
    ],
  });

  const leaked = await confirmed.listInterruptedBatches({ supabaseClient: client, tenantId: null, requireTenant: true });
  assert.deepEqual(leaked, [], 'no tenant context must mean no rows, not every row');

  const scoped = await confirmed.listInterruptedBatches({ supabaseClient: client, tenantId: 'tenant-A', requireTenant: true });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].tenantId, 'tenant-A');
});
