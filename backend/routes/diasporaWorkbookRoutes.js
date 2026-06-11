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
import { exportDiasporaWorkbook, importDiasporaWorkbook, runAndPersistDiasporaWorkbookDryRun, saveDiasporaWorkbookToDrive } from '../services/diaspora/diasporaWorkbookSyncService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = authorizeRole();

router.get('/workbook/template-schema', auth, asyncHandler(async (req, res) => {
  res.json({
    data: getDiasporaWorkbookTemplateSchema(req.query.templateType),
    supportedTemplates: listSupportedWorkbookTemplates(),
  });
}));

router.get('/workbook/download-template', auth, asyncHandler(async (req, res) => {
  res.json({
    data: getDiasporaWorkbookTemplateSchema(req.query.templateType),
    downloadReady: false,
    message: 'Phase 1C persists dry-run batches. Binary XLSX template generation is scheduled for the workbook template generation phase.',
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
