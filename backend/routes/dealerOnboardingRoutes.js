import express from 'express';
import { authorizeRole, authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  requireDealerOnboardingContext,
  getDealerOnboardingOverview,
  updateOwnDealerProfile,
  uploadOwnDealerEvidence,
  getOwnDealerEvidencePreview,
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
 * O2-X5 — Dealer ONBOARDING self-service (applicant lane; ported by OC-5C from PR #208).
 *
 * Access = a caller whose OWN registration profile says business+dealer (requireDealerOnboardingContext)
 * — onboarding capability only, never Dealer authority. Every route is self-scoped by construction:
 * the subject is req.userContext, never a path or body parameter. Writes need a real session.
 * Company-document OCR is not offered (deferred to the governed OCR pattern).
 *
 * The workbook lane is a mapping FRONT-END to the existing engine: headers are inspected,
 * deterministically + advisory-AI mapped (headers only), the human confirms a checksum-bound mapping,
 * and the normalized payload then goes through the UNCHANGED runAndPersistDiasporaWorkbookDryRun —
 * with the engine's own validation, blockers, feature gate, confirmation tokens and execution chain
 * untouched behind it. Every workbook route needs a real session: inspecting spends AI.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const read = [authorizeRole(), requireDealerOnboardingContext()];
const write = [authorizeSessionRole(), requireDealerOnboardingContext()];

router.get('/api/dealer-onboarding/overview', ...read, asyncHandler(async (req, res) => {
  const overview = await getDealerOnboardingOverview(undefined, req.userContext);
  res.json({ success: true, ...overview, document_types: DEALER_DOCUMENT_TYPES });
}));

router.put('/api/dealer-onboarding/profile', ...write, asyncHandler(async (req, res) => {
  const result = await updateOwnDealerProfile(undefined, req.userContext, req.body || {}, { req });
  res.json({ success: true, ...result });
}));

router.post('/api/dealer-onboarding/documents', ...write, asyncHandler(async (req, res) => {
  const result = await uploadOwnDealerEvidence(undefined, req.userContext, req.body || {}, { req });
  res.status(201).json({ success: true, ...result });
}));

router.get('/api/dealer-onboarding/documents/:docId/preview', ...read, asyncHandler(async (req, res) => {
  const preview = await getOwnDealerEvidencePreview(undefined, req.userContext, req.params.docId, { req });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, preview });
}));

router.post('/api/dealer-onboarding/branches', ...write, asyncHandler(async (req, res) => {
  const result = await addOwnDealerBranch(undefined, req.userContext, req.body || {}, { req });
  res.status(201).json({ success: true, ...result });
}));

// ── workbook migration lane ────────────────────────────────────────────────────────────

function decodeWorkbook(fileBase64) {
  if (typeof fileBase64 !== 'string' || !fileBase64.trim()) {
    throw new ValidationError('Request body must include a base64-encoded "fileBase64" workbook.');
  }
  const buffer = Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length) throw new ValidationError('Decoded workbook is empty.');
  return buffer;
}

function acceptedWorkbook(body = {}) {
  const buffer = decodeWorkbook(body.fileBase64);
  const filename = normalizeFilename(body.filename || 'upload.xlsx');
  assertAllowedSpreadsheet({ filename, mimeType: XLSX_UPLOAD_MIME, sizeBytes: buffer.length, limits: DEFAULT_LIMITS });
  return { buffer, filename, checksum: sha256Checksum(buffer) };
}

async function requireOwnDealerId(req) {
  const profile = await getProfile(req.userContext.id);
  if (!profile || String(profile.user_id) !== String(req.userContext.id)) {
    throw new NotFoundError('Create your dealer application before using workbook migration.');
  }
  return profile.id;
}

router.post('/api/dealer-onboarding/workbook/inspect', ...write, asyncHandler(async (req, res) => {
  await requireOwnDealerId(req);
  const { templateType = 'seller', sheetName = 'CARGO_RESERVATIONS' } = req.body || {};
  const { buffer, filename, checksum } = acceptedWorkbook(req.body);
  const raw = await parseRawWorkbookHeaders(buffer);
  const proposal = await proposeSemanticMapping({ headers: raw.headers, templateType, sheetName });
  res.json({
    success: true,
    checksum,
    filename,
    source_sheet: raw.sheetName,
    row_count: raw.rowCount,
    headers: raw.headers,
    template_type: templateType,
    sheet_name: sheetName,
    ...proposal,
  });
}));

router.post('/api/dealer-onboarding/workbook/mapping/confirm', ...write, asyncHandler(async (req, res) => {
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
    audit_recorded: confirmation.audit_recorded,
  });
}));

router.post('/api/dealer-onboarding/workbook/dry-run', ...write, asyncHandler(async (req, res) => {
  await requireOwnDealerId(req);
  const { templateType = 'seller', sheetName = 'CARGO_RESERVATIONS' } = req.body || {};
  const { buffer, filename, checksum } = acceptedWorkbook(req.body);

  // The checksum of THESE bytes must have a live human-confirmed mapping — edited bytes make every
  // earlier confirmation stale by construction.
  const confirmation = await requireLiveMappingConfirmation(undefined, {
    userId: req.userContext.id,
    workbookChecksum: checksum,
    templateType,
    sheetName,
  });

  const mappedRows = applyConfirmedMapping(await parseRawWorkbookRows(buffer), confirmation);
  if (!mappedRows.length) {
    throw new ValidationError('The confirmed mapping produced no importable rows — map at least one column.');
  }

  // The EXISTING engine remains the truth gate: same entry, same validation, same blockers, same
  // feature gate, same persistence, same confirm/execute chain afterwards.
  const payload = { templateType, sheets: { [sheetName]: mappedRows } };
  const dryRun = await runAndPersistDiasporaWorkbookDryRun(payload, req.userContext, {
    req,
    sourceFilename: filename,
    sourceChecksum: checksum,
  });

  res.json({ success: true, checksum, mapping_confirmation_id: confirmation.id, data: dryRun });
}));

export default router;
