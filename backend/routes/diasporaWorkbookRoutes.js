import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getDiasporaWorkbookTemplateSchema, listSupportedWorkbookTemplates } from '../services/diaspora/diasporaWorkbookTemplateService.js';
import { exportDiasporaWorkbook, importDiasporaWorkbook, runDiasporaWorkbookDryRun, saveDiasporaWorkbookToDrive } from '../services/diaspora/diasporaWorkbookSyncService.js';

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
    message: 'Phase 1A exposes the workbook schema contract only. Binary XLSX template generation is scheduled for the next workbook template phase.',
  });
}));

router.post('/workbook/dry-run', auth, asyncHandler(async (req, res) => {
  res.json({ data: runDiasporaWorkbookDryRun(req.body, req.userContext) });
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
