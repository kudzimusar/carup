import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  requireDealerOnboardingContext,
  getDealerOnboardingOverview,
  updateOwnDealerProfile,
  uploadOwnDealerEvidence,
  getOwnDealerEvidencePreview,
  runOwnDealerDocumentOcr,
  addOwnDealerBranch,
  DEALER_DOCUMENT_TYPES,
} from '../services/dealer/dealerOnboardingService.js';
import {
  proposeSemanticMapping,
  confirmSemanticMapping,
  requireLiveMappingConfirmation,
  parseRawWorkbookHeaders,
  parseRawWorkbookRows,
  applyConfirmedMapping,
  MAPPING_VERSION,
} from '../services/dealer/workbookSemanticMappingService.js';
import { getProfile } from '../services/dealer/dealerComplianceService.js';
import {
  assertAllowedSpreadsheet,
  normalizeFilename,
  sha256Checksum,
  DEFAULT_LIMITS,
  XLSX_UPLOAD_MIME,
} from '../services/diaspora/workbook/diasporaWorkbookUploadSecurity.js';
import { runAndPersistDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookSyncService.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

/**
 * O2-X5 — Dealer ONBOARDING self-service (applicant lane).
 *
 * Access = proven caller whose OWN registration profile says business+dealer
 * (requireDealerOnboardingContext) — onboarding capability only, never Dealer authority. Every
 * route is self-scoped by construction; the workbook lane is a mapping FRONT-END to the
 * existing engine: headers are inspected, deterministically+AI mapped (headers only), the
 * human confirms a checksum-bound mapping, and the normalized payload then goes through the
 * UNCHANGED runAndPersistDiasporaWorkbookDryRun — with the engine's own validation, blockers,
 * confirmation tokens and execution chain untouched behind it.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const onboarding = [authorizeRole(), requireDealerOnboardingContext()];

function decodeWorkbook(fileBase64) {
  if (typeof fileBase64 !== 'string' || !fileBase64.trim()) {
    throw new ValidationError('Request body must include a base64-encoded "fileBase64" workbook.');
  }
  const buffer = Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length) throw new ValidationError('Decoded workbook is empty.');
  return buffer;
}

async function requireOwnDealerId(req) {
  const profile = await getProfile(req.userContext.id);
  if (!profile || profile.user_id !== req.userContext.id) {
    throw new NotFoundError('Create your dealer application before using workbook migration.');
  }
  return profile.id;
}

router.get('/api/dealer-onboarding/overview', ...onboarding, asyncHandler(async (req, res) => {
  const overview = await getDealerOnboardingOverview(undefined, req.userContext);
  res.json({ success: true, ...overview, document_types: DEALER_DOCUMENT_TYPES });
}));

router.put('/api/dealer-onboarding/profile', ...onboarding, asyncHandler(async (req, res) => {
  const result = await updateOwnDealerProfile(undefined, req.userContext, req.body || {}, { req });
  res.json({ success: true, ...result });
}));

router.post('/api/dealer-onboarding/documents', ...onboarding, asyncHandler(async (req, res) => {
  const document = await uploadOwnDealerEvidence(undefined, req.userContext, req.body || {}, { req });
  res.status(201).json({ success: true, document });
}));

router.get('/api/dealer-onboarding/documents/:docId/preview', ...onboarding, asyncHandler(async (req, res) => {
  const preview = await getOwnDealerEvidencePreview(undefined, req.userContext, req.params.docId, { req });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, preview });
}));

router.post('/api/dealer-onboarding/documents/:docId/ocr', ...onboarding, asyncHandler(async (req, res) => {
  const result = await runOwnDealerDocumentOcr(undefined, req.userContext, req.params.docId, { req });
  res.json({ success: true, ...result });
}));

router.post('/api/dealer-onboarding/branches', ...onboarding, asyncHandler(async (req, res) => {
  const branch = await addOwnDealerBranch(undefined, req.userContext, req.body || {}, { req });
  res.status(201).json({ success: true, branch });
}));

// ── workbook migration lane ────────────────────────────────────────────────────────────

router.post('/api/dealer-onboarding/workbook/inspect', ...onboarding, asyncHandler(async (req, res) => {
  await requireOwnDealerId(req);
  const { fileBase64, filename, templateType = 'seller', sheetName } = req.body || {};
  const buffer = decodeWorkbook(fileBase64);
  const safeFilename = normalizeFilename(filename || 'upload.xlsx');
  assertAllowedSpreadsheet({ filename: safeFilename, mimeType: XLSX_UPLOAD_MIME, sizeBytes: buffer.length, limits: DEFAULT_LIMITS });

  const checksum = sha256Checksum(buffer);
  const raw = await parseRawWorkbookHeaders(buffer);
  const targetSheet = sheetName || 'CARGO_RESERVATIONS';
  const proposal = await proposeSemanticMapping({ headers: raw.headers, templateType, sheetName: targetSheet });

  res.json({
    success: true,
    checksum,
    filename: safeFilename,
    source_sheet: raw.sheetName,
    row_count: raw.rowCount,
    headers: raw.headers,
    template_type: templateType,
    sheet_name: targetSheet,
    ...proposal,
  });
}));

router.post('/api/dealer-onboarding/workbook/mapping/confirm', ...onboarding, asyncHandler(async (req, res) => {
  const dealerId = await requireOwnDealerId(req);
  const confirmation = await confirmSemanticMapping(undefined, req.userContext, {
    dealerId,
    templateType: req.body?.template_type,
    sheetName: req.body?.sheet_name,
    workbookChecksum: req.body?.workbook_checksum,
    mappings: req.body?.mappings,
  }, { req });
  res.status(201).json({
    success: true,
    confirmation: {
      id: confirmation.id,
      workbook_checksum: confirmation.workbook_checksum,
      template_type: confirmation.template_type,
      sheet_name: confirmation.sheet_name,
      mapping: confirmation.mapping,
      mapping_version: MAPPING_VERSION,
    },
  });
}));

router.post('/api/dealer-onboarding/workbook/dry-run', ...onboarding, asyncHandler(async (req, res) => {
  await requireOwnDealerId(req);
  const { fileBase64, filename, templateType = 'seller', sheetName = 'CARGO_RESERVATIONS' } = req.body || {};
  const buffer = decodeWorkbook(fileBase64);
  const safeFilename = normalizeFilename(filename || 'upload.xlsx');
  assertAllowedSpreadsheet({ filename: safeFilename, mimeType: XLSX_UPLOAD_MIME, sizeBytes: buffer.length, limits: DEFAULT_LIMITS });

  // The checksum of THESE bytes must have a live human-confirmed mapping — edited bytes make
  // every earlier confirmation stale by construction.
  const checksum = sha256Checksum(buffer);
  const confirmation = await requireLiveMappingConfirmation(undefined, {
    userId: req.userContext.id,
    workbookChecksum: checksum,
    templateType,
    sheetName,
  });

  const rawRows = await parseRawWorkbookRows(buffer);
  const mappedRows = applyConfirmedMapping(rawRows, confirmation);
  if (!mappedRows.length) {
    throw new ValidationError('The confirmed mapping produced no importable rows — map at least one column.');
  }

  // The EXISTING engine remains the truth gate: same entry, same validation, same blockers,
  // same persistence, same confirm/execute chain afterwards.
  const payload = { templateType, sheets: { [sheetName]: mappedRows } };
  const dryRun = await runAndPersistDiasporaWorkbookDryRun(payload, req.userContext, {
    req,
    sourceFilename: safeFilename,
    sourceChecksum: checksum,
  });

  res.json({ success: true, checksum, mapping_confirmation_id: confirmation.id, data: dryRun });
}));

export default router;
