import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  resolveWorkbookCatalogue,
  requireTemplateAction,
} from '../services/workbook/workbookCatalogueService.js';
import {
  inspectVehicleWorkbook,
  confirmVehicleWorkbookMappings,
  runVehicleWorkbookDryRun,
  executeVehicleWorkbookImport,
  listRecentVehicleImports,
} from '../services/workbook/vehicleWorkbookImportService.js';
import { exportVehicleWorkbookFromDatabase } from '../services/workbook/workbookDbExportService.js';
import {
  explainField,
  explainError,
  suggestCorrections,
  summarizeDryRun,
  attentionReport,
} from '../services/workbook/workbookAiAssistantService.js';
import { generateTemplate } from '../services/diaspora/workbook/diasporaWorkbookXlsxService.js';
import { buildVehicleWorkbookTemplate, isVehicleWorkbookTemplateKey } from '../constants/workbook/workbookFieldRegistry.js';
import { XLSX_UPLOAD_MIME } from '../services/diaspora/workbook/diasporaWorkbookUploadSecurity.js';
import { ValidationError } from '../utils/errors.js';

/**
 * O2-X5A — the common Workbook tools surface: Template · Export · Import ·
 * Recent Imports + the CarUp AI Workbook Assistant.
 *
 * EVERY route re-derives eligibility server-side (requireTemplateAction over
 * the catalogue) — a template_key in the body/query is a REQUEST, never a
 * grant. The diaspora templates keep their existing routes/pipeline; this
 * router serves the catalogue plus the NEW registry-built vehicle templates.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const authed = [authorizeRole()];

// ── Catalogue ───────────────────────────────────────────────────────────────
router.get('/api/workbook/catalogue', ...authed, asyncHandler(async (req, res) => {
  const catalogue = await resolveWorkbookCatalogue(req.userContext);
  res.json({ success: true, ...catalogue });
}));

// ── TEMPLATE (registry-built vehicle templates; diaspora keeps its own route) ─
router.get('/api/workbook/templates/:templateKey', ...authed, asyncHandler(async (req, res) => {
  const { templateKey } = req.params;
  await requireTemplateAction(req.userContext, templateKey, 'template');
  if (!isVehicleWorkbookTemplateKey(templateKey)) {
    throw new ValidationError('Diaspora templates download from their existing workbook surface.');
  }
  const buffer = await generateTemplate(buildVehicleWorkbookTemplate(templateKey));
  res.setHeader('content-type', XLSX_UPLOAD_MIME);
  res.setHeader('content-disposition', `attachment; filename="carup-${templateKey}-template.xlsx"`);
  res.send(buffer);
}));

// ── EXPORT (server-sourced, scoped, redacted) ───────────────────────────────
router.get('/api/workbook/export/:templateKey', ...authed, asyncHandler(async (req, res) => {
  const { templateKey } = req.params;
  await requireTemplateAction(req.userContext, templateKey, 'export');
  if (!isVehicleWorkbookTemplateKey(templateKey)) {
    throw new ValidationError('Diaspora exports run on their existing workbook surface.');
  }
  const result = await exportVehicleWorkbookFromDatabase(templateKey, req.userContext);
  res.setHeader('content-type', XLSX_UPLOAD_MIME);
  res.setHeader('content-disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('x-carup-export-vehicles', String(result.vehicleCount));
  res.send(result.buffer);
}));

// ── IMPORT chain ────────────────────────────────────────────────────────────
router.post('/api/workbook/inspect', ...authed, asyncHandler(async (req, res) => {
  const templateKey = String(req.body?.template_key || '');
  await requireTemplateAction(req.userContext, templateKey, 'import');
  const result = await inspectVehicleWorkbook(
    { file: req.body?.fileBase64, templateKey },
    req.userContext,
    { sourceFilename: req.body?.filename },
  );
  res.json({ success: true, ...result });
}));

router.post('/api/workbook/mapping/confirm', ...authed, asyncHandler(async (req, res) => {
  const templateKey = String(req.body?.template_key || '');
  await requireTemplateAction(req.userContext, templateKey, 'import');
  const result = await confirmVehicleWorkbookMappings(undefined, req.userContext, {
    templateKey,
    workbookChecksum: req.body?.workbook_checksum,
    sheets: req.body?.sheets,
  }, { req });
  res.json({ success: true, ...result });
}));

router.post('/api/workbook/dry-run', ...authed, asyncHandler(async (req, res) => {
  const templateKey = String(req.body?.template_key || '');
  await requireTemplateAction(req.userContext, templateKey, 'import');
  const result = await runVehicleWorkbookDryRun(
    { file: req.body?.fileBase64, templateKey },
    req.userContext,
    { sourceFilename: req.body?.filename, req },
  );
  res.json({
    success: true,
    ...result,
    summary: summarizeDryRun({ dryRun: result }),
    attention: attentionReport({ dryRun: result }),
  });
}));

router.post('/api/workbook/import-batches/:batchId/execute', ...authed, asyncHandler(async (req, res) => {
  const result = await executeVehicleWorkbookImport(
    { batchId: req.params.batchId, confirm: req.body?.confirm === true },
    req.userContext,
    { req },
  );
  res.json({ success: true, ...result });
}));

// ── RECENT IMPORTS ──────────────────────────────────────────────────────────
router.get('/api/workbook/recent-imports', ...authed, asyncHandler(async (req, res) => {
  const imports = await listRecentVehicleImports(req.userContext);
  res.json({ success: true, imports });
}));

// ── CarUp AI Workbook Assistant ─────────────────────────────────────────────
router.post('/api/workbook/assistant/explain-field', ...authed, asyncHandler(async (req, res) => {
  const templateKey = String(req.body?.template_key || '');
  await requireTemplateAction(req.userContext, templateKey, 'import');
  res.json({ success: true, ...explainField({ templateKey, sheetName: req.body?.sheet_name, field: req.body?.field }) });
}));

router.post('/api/workbook/assistant/explain-error', ...authed, asyncHandler(async (req, res) => {
  res.json({ success: true, ...explainError({ code: req.body?.code }) });
}));

router.post('/api/workbook/assistant/suggest-corrections', ...authed, asyncHandler(async (req, res) => {
  const templateKey = String(req.body?.template_key || '');
  await requireTemplateAction(req.userContext, templateKey, 'import');
  const result = await suggestCorrections({ templateKey, issues: req.body?.issues }, {});
  res.json({ success: true, ...result });
}));

export default router;
