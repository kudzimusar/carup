// Mounted by integrator inside /api/diaspora
//
// Binary .xlsx workbook surface (Completion Track W). These routes generate downloadable
// templates, accept .xlsx uploads for a SAFE dry-run, and export normalized rows back to
// .xlsx. They do NOT fork the JSON dry-run logic — uploads are parsed into the existing
// normalized payload shape and handed to the existing validation/persistence entry point
// (runAndPersistDiasporaWorkbookDryRun), so all import-truth rules stay in one place.
//
// Transport note: the dry-run/export endpoints accept/return the file as base64 inside a
// JSON body. This intentionally avoids adding a multipart dependency (e.g. multer) this
// milestone. Streaming/multipart upload for very large files is future work; the base64
// path is bounded by assertAllowedSpreadsheet's size limit so it stays safe meanwhile.
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import {
  assertAllowedSpreadsheet,
  normalizeFilename,
  sha256Checksum,
  DEFAULT_LIMITS,
  XLSX_UPLOAD_MIME,
} from '../services/diaspora/workbook/diasporaWorkbookUploadSecurity.js';
import {
  generateTemplate,
  parseWorkbook,
  exportWorkbook,
} from '../services/diaspora/workbook/diasporaWorkbookXlsxService.js';
import { exportWorkbookFromDatabase } from '../services/diaspora/workbook/diasporaWorkbookDbExportService.js';
import { runAndPersistDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookSyncService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = authorizeRole();

function decodeBase64Workbook(fileBase64) {
  if (typeof fileBase64 !== 'string' || fileBase64.trim() === '') {
    throw new ValidationError('Request body must include a base64-encoded "fileBase64" workbook.', {
      code: 'MISSING_FILE',
    });
  }
  // Strip an optional data-URI prefix if a client sent one.
  const cleaned = fileBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleaned, 'base64');
  if (!buffer.length) {
    throw new ValidationError('Decoded workbook is empty.', { code: 'EMPTY_FILE' });
  }
  return buffer;
}

// GET /workbook/template.xlsx?type=... -> downloadable template.
router.get('/workbook/template.xlsx', auth, asyncHandler(async (req, res) => {
  const templateType = req.query.type || req.query.templateType;
  const buffer = await generateTemplate(templateType, { now: new Date().toISOString() });
  const filename = `diaspora-${String(templateType || 'template')}-template.xlsx`;
  res.setHeader('Content-Type', XLSX_UPLOAD_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}));

// POST /workbook/xlsx/dry-run -> { fileBase64, templateType, filename }
router.post('/workbook/xlsx/dry-run', auth, asyncHandler(async (req, res) => {
  const { fileBase64, templateType, filename } = req.body || {};
  const buffer = decodeBase64Workbook(fileBase64);
  const safeFilename = normalizeFilename(filename || 'upload.xlsx');

  // Allowlist file type/size BEFORE parsing (size derived from the decoded buffer length).
  assertAllowedSpreadsheet({
    filename: safeFilename,
    mimeType: XLSX_UPLOAD_MIME,
    sizeBytes: buffer.length,
    limits: DEFAULT_LIMITS,
  });

  const checksum = sha256Checksum(buffer);
  const parsed = await parseWorkbook(buffer, { templateType, limits: DEFAULT_LIMITS });

  // Hand the normalized payload to the EXISTING dry-run/persist entry point (no fork).
  const payload = { templateType: parsed.templateType, sheets: parsed.sheets };
  const dryRun = await runAndPersistDiasporaWorkbookDryRun(payload, req.userContext, {
    req,
    sourceFilename: safeFilename,
    sourceChecksum: checksum,
  });

  res.json({
    data: dryRun,
    checksum,
    filename: safeFilename,
    duplicates: parsed.meta.duplicates,
  });
}));

// POST /workbook/xlsx/export -> { templateType, rows, redactFields } -> .xlsx buffer.
router.post('/workbook/xlsx/export', auth, asyncHandler(async (req, res) => {
  const { templateType, rows, redactFields } = req.body || {};
  const buffer = await exportWorkbook(templateType, rows, {
    redactFields: Array.isArray(redactFields) ? redactFields : [],
    context: { now: new Date().toISOString() },
  });
  const filename = `diaspora-${String(templateType || 'export')}-export.xlsx`;
  res.setHeader('Content-Type', XLSX_UPLOAD_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}));

// GET /workbook/xlsx/db-export?type=<templateType> -> tenant-scoped, DATABASE-sourced .xlsx.
//
// Unlike POST /workbook/xlsx/export (which serializes rows supplied verbatim in the request body),
// this endpoint builds the workbook FROM THE DATABASE and applies tenant/ownership authorization on
// every sheet. The request body is never a data source here. `?redact=COL1,COL2` optionally adds
// extra header columns to the always-redacted PII/storage set. Same download headers as the
// template.xlsx route. Auth-gated by the shared `authorizeRole()` filter; the service is the
// authority boundary that enforces cross-tenant isolation.
router.get('/workbook/xlsx/db-export', auth, asyncHandler(async (req, res) => {
  const templateType = req.query.type || req.query.templateType;
  const redactFields = typeof req.query.redact === 'string'
    ? req.query.redact.split(',').map((field) => field.trim()).filter(Boolean)
    : [];
  const buffer = await exportWorkbookFromDatabase(templateType, req.userContext, {
    redactFields,
    now: new Date().toISOString(),
  });
  const filename = `diaspora-${String(templateType || 'export')}-db-export.xlsx`;
  res.setHeader('Content-Type', XLSX_UPLOAD_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}));

export default router;
