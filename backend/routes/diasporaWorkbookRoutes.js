import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getDiasporaWorkbookTemplateSchema, listSupportedWorkbookTemplates } from '../services/diaspora/diasporaWorkbookTemplateService.js';
import {
  cancelDiasporaWorkbookImportBatch,
  getDiasporaWorkbookImportBatch,
  getWorkbookImportBatchSummary,
  listDiasporaWorkbookImportBatches,
  listDiasporaWorkbookImportRows,
  markDiasporaWorkbookImportBatchReady,
} from '../services/diaspora/diasporaWorkbookReviewService.js';
import { buildWorkbookImportPlan } from '../services/diaspora/diasporaWorkbookImportPlanningService.js';
import { executeDiasporaWorkbookDraftImport } from '../services/diaspora/diasporaWorkbookImportExecutionService.js';
import {
  buildDiasporaWorkbookDraftImportRetryPlan,
  getDiasporaWorkbookDraftImportAudit,
  listDiasporaWorkbookDraftImportExecutionRows,
  listDiasporaWorkbookDraftImportFailedRows,
} from '../services/diaspora/diasporaWorkbookImportAuditService.js';
import {
  getDiasporaWorkbookOperatorDashboard,
  getDiasporaWorkbookOperatorBatchSummary,
  getDiasporaWorkbookOperatorNextActions,
  addDiasporaWorkbookOperatorNote,
  setDiasporaWorkbookOperatorHold,
  clearDiasporaWorkbookOperatorHold,
} from '../services/diaspora/diasporaWorkbookOperatorConsoleService.js';
import { exportDiasporaWorkbook, importDiasporaWorkbook, runAndPersistDiasporaWorkbookDryRun, saveDiasporaWorkbookToDrive } from '../services/diaspora/diasporaWorkbookSyncService.js';
// Confirmed workbook import (Deliverable B, Issue #127).
import {
  createConfirmation,
} from '../services/diaspora/workbook/diasporaWorkbookConfirmationService.js';
import {
  executeConfirmedWorkbookImport,
  listReceipts,
  buildReceiptCsv,
  listInterruptedBatches,
} from '../services/diaspora/workbook/diasporaWorkbookConfirmedImportService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = authorizeRole();
const IMPORT_PLAN_PAGE_SIZE = 500;

async function listAllWorkbookImportRows(batchId, userContext) {
  const rows = [];
  let offset = 0;

  while (true) {
    const result = await listDiasporaWorkbookImportRows(
      batchId,
      { limit: IMPORT_PLAN_PAGE_SIZE, offset },
      userContext,
    );
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < IMPORT_PLAN_PAGE_SIZE) break;
    offset += IMPORT_PLAN_PAGE_SIZE;
  }

  return rows;
}

router.get('/workbook/template-schema', auth, asyncHandler(async (req, res) => {
  res.json({
    data: getDiasporaWorkbookTemplateSchema(req.query.templateType),
    supportedTemplates: listSupportedWorkbookTemplates(),
  });
}));

router.get('/workbook/download-template', auth, asyncHandler(async (req, res) => {
  res.json({
    data: getDiasporaWorkbookTemplateSchema(req.query.templateType),
    downloadReady: true,
    template_xlsx_path: '/api/diaspora/workbook/template.xlsx',
    message: 'Binary XLSX template download is available at /api/diaspora/workbook/template.xlsx.',
  });
}));

router.post('/workbook/dry-run', auth, asyncHandler(async (req, res) => {
  const data = await runAndPersistDiasporaWorkbookDryRun(req.body, req.userContext, { req });
  res.json({ data });
}));

router.get('/workbook/import-batches', auth, asyncHandler(async (req, res) => {
  const result = await listDiasporaWorkbookImportBatches(req.query, req.userContext);
  res.json(result);
}));

router.get('/workbook/import-batches/:id', auth, asyncHandler(async (req, res) => {
  const data = await getDiasporaWorkbookImportBatch(req.params.id, req.userContext);
  res.json({ data });
}));

router.get('/workbook/import-batches/:id/summary', auth, asyncHandler(async (req, res) => {
  const data = await getWorkbookImportBatchSummary(req.params.id, req.userContext);
  res.json({ data });
}));

router.get('/workbook/import-batches/:id/import-plan', auth, asyncHandler(async (req, res) => {
  const batch = await getDiasporaWorkbookImportBatch(req.params.id, req.userContext);
  const rows = await listAllWorkbookImportRows(req.params.id, req.userContext);
  const data = buildWorkbookImportPlan(batch, rows, req.userContext);
  res.json({ data });
}));

router.get('/workbook/import-batches/:id/execution-audit', auth, asyncHandler(async (req, res) => {
  const data = await getDiasporaWorkbookDraftImportAudit(req.params.id, req.userContext);
  res.json({ data });
}));

router.get('/workbook/import-batches/:id/execution-rows', auth, asyncHandler(async (req, res) => {
  const result = await listDiasporaWorkbookDraftImportExecutionRows(req.params.id, req.query, req.userContext);
  res.json(result);
}));

router.get('/workbook/import-batches/:id/failed-execution-rows', auth, asyncHandler(async (req, res) => {
  const result = await listDiasporaWorkbookDraftImportFailedRows(req.params.id, req.query, req.userContext);
  res.json(result);
}));

router.get('/workbook/operator-dashboard', auth, asyncHandler(async (req, res) => {
  const result = await getDiasporaWorkbookOperatorDashboard(req.query, req.userContext);
  res.json(result);
}));

router.get('/workbook/import-batches/:id/operator-summary', auth, asyncHandler(async (req, res) => {
  const data = await getDiasporaWorkbookOperatorBatchSummary(req.params.id, req.userContext);
  res.json({ data });
}));

router.get('/workbook/import-batches/:id/next-actions', auth, asyncHandler(async (req, res) => {
  const data = await getDiasporaWorkbookOperatorNextActions(req.params.id, req.userContext);
  res.json({ data });
}));

router.post('/workbook/import-batches/:id/operator-notes', auth, asyncHandler(async (req, res) => {
  const result = await addDiasporaWorkbookOperatorNote(req.params.id, req.body, req.userContext);
  res.json(result);
}));

router.post('/workbook/import-batches/:id/operator-hold', auth, asyncHandler(async (req, res) => {
  const data = await setDiasporaWorkbookOperatorHold(req.params.id, req.body, req.userContext);
  res.json({ data });
}));

router.delete('/workbook/import-batches/:id/operator-hold', auth, asyncHandler(async (req, res) => {
  const data = await clearDiasporaWorkbookOperatorHold(req.params.id, req.userContext);
  res.json({ data });
}));

router.get('/workbook/import-batches/:id/retry-plan', auth, asyncHandler(async (req, res) => {
  const data = await buildDiasporaWorkbookDraftImportRetryPlan(req.params.id, req.userContext);
  res.json({ data });
}));

router.get('/workbook/import-batches/:id/rows', auth, asyncHandler(async (req, res) => {
  const result = await listDiasporaWorkbookImportRows(req.params.id, req.query, req.userContext);
  res.json(result);
}));

router.post('/workbook/import-batches/:id/cancel', auth, asyncHandler(async (req, res) => {
  const result = await cancelDiasporaWorkbookImportBatch(req.params.id, req.userContext);
  res.json(result);
}));

router.post('/workbook/import-batches/:id/mark-ready', auth, asyncHandler(async (req, res) => {
  const result = await markDiasporaWorkbookImportBatchReady(req.params.id, req.userContext);
  res.json(result);
}));

router.post('/workbook/import-batches/:id/execute-drafts', auth, asyncHandler(async (req, res) => {
  const data = await executeDiasporaWorkbookDraftImport(req.params.id, req.userContext, { req });
  res.status(202).json({ data });
}));

// ── Confirmed workbook import (Deliverable B, Issue #127) ────────────────────
//
// Two steps, deliberately separate. POST /confirm issues a token bound to the exact workbook the user
// previewed; POST /execute spends it. Splitting them is what makes "the workbook changed since you
// confirmed" detectable — a single combined call has nothing to compare against.

// POST /workbook/import-batches/:id/confirm — issue a confirmation for a previewed workbook.
router.post('/workbook/import-batches/:id/confirm', auth, asyncHandler(async (req, res) => {
  const result = await createConfirmation({
    batchId: req.params.id,
    // The checksum of the workbook the CLIENT previewed. Compared against the stored one; a mismatch
    // means the user is looking at a stale preview and the confirmation is refused.
    workbookChecksum: req.body?.workbookChecksum,
    idempotencyKey: req.body?.idempotencyKey || req.headers['x-idempotency-key'],
    userContext: req.userContext,
    req,
  });
  res.status(result.replay ? 200 : 201).json({
    data: result.confirmation,
    idempotentReplay: result.replay,
  });
}));

// POST /workbook/import-batches/:id/execute — spend a confirmation and run the import.
router.post('/workbook/import-batches/:id/execute', auth, asyncHandler(async (req, res) => {
  const data = await executeConfirmedWorkbookImport({
    batchId: req.params.id,
    confirmationId: req.body?.confirmationId,
    userContext: req.userContext,
    req,
  });
  // 200 either way: a compensated import is a COMPLETED request that truthfully reports failure, not
  // a transport error. `imported` carries the actual outcome.
  res.json({ data });
}));

// GET /workbook/import-batches/:id/receipts — per-row outcomes.
//
// Authorize the BATCH, not merely the session. These two endpoints previously ran on `auth` alone —
// which is "any authenticated user" — so batch ownership was never checked, and listReceipts skips
// its tenant filter entirely when the caller sends no x-tenant-id. A request without that header
// could therefore read any organisation's receipts by batch id, and because the backend uses the
// service-role client, RLS does not backstop it. getDiasporaWorkbookImportBatch applies the same
// reviewer/tenant/creator scope as the rest of the review surface (404 otherwise); scoping the
// receipt query to the authorized batch's own tenant_id then holds regardless of request headers.
router.get('/workbook/import-batches/:id/receipts', auth, asyncHandler(async (req, res) => {
  const batch = await getDiasporaWorkbookImportBatch(req.params.id, req.userContext);
  const data = await listReceipts({ batchId: batch.id, tenantId: batch.tenant_id });
  res.json({ data });
}));

// GET /workbook/import-batches/:id/receipts.csv — the downloadable result.
router.get('/workbook/import-batches/:id/receipts.csv', auth, asyncHandler(async (req, res) => {
  const batch = await getDiasporaWorkbookImportBatch(req.params.id, req.userContext);
  const receipts = await listReceipts({ batchId: batch.id, tenantId: batch.tenant_id });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import-result-${req.params.id}.csv"`);
  res.send(buildReceiptCsv(receipts));
}));

// GET /workbook/interrupted-imports — operator recovery view.
// Tenant-wide, so it fails closed: with no tenant context the service returns nothing rather than
// every tenant's interrupted batches.
router.get('/workbook/interrupted-imports', auth, asyncHandler(async (req, res) => {
  const data = await listInterruptedBatches({ tenantId: req.userContext.tenantId, requireTenant: true });
  res.json({ data });
}));

router.post('/workbook/import', auth, asyncHandler(async (req, res) => {
  const data = await importDiasporaWorkbook(req.body, req.userContext);
  res.status(202).json({ data });
}));

router.post('/workbook/export', auth, asyncHandler(async (req, res) => {
  const data = await exportDiasporaWorkbook(req.body, req.userContext);
  res.json({ data });
}));

router.post('/workbook/save-to-drive', auth, asyncHandler(async (req, res) => {
  const data = await saveDiasporaWorkbookToDrive(req.body, req.userContext);
  res.json({ data });
}));

export default router;
