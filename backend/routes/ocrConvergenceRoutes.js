import express from 'express';
import { authorizeRole, requireProvenIdentity } from '../middleware/authMiddleware.js';
import { runVehicleEvidenceOcr } from '../services/evidence/vehicleDocumentOcrService.js';

/**
 * OCR Path Convergence hardening.
 *
 * This router is intentionally mounted before the historical generic AI and Diaspora routers.
 * The two retired endpoints therefore fail closed before their old handlers can execute, while
 * the vehicle path below is the one governed local Owner/Seller entry into Document Intelligence.
 */
const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Problem 1 closure: the old endpoint called runOcrParsing(), which sent a truncated base64 prefix
// to a text-only Gemini call and could substitute a confidence. There is no safe compatibility
// behavior for that contract, so it is retired rather than silently redirected without vehicle or
// evidence context.
router.post('/api/ai/ocr', authorizeRole(), (_req, res) => {
  res.status(410).json({
    success: false,
    code: 'LEGACY_OCR_PATH_RETIRED',
    error: 'The generic OCR endpoint has been retired. Use the governed identity, dealer, diaspora reviewer, or vehicle-evidence OCR workflow for the document you are processing.',
  });
});

// Problem 2 closure: a client may not submit provider/confidence/extracted_fields and have them
// recorded as OCR evidence. Provider-generated Diaspora extraction is owned by /run-ocr.
router.post('/api/diaspora/documents/:documentId/extractions', authorizeRole(), (_req, res) => {
  res.status(410).json({
    success: false,
    code: 'CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED',
    error: 'Client-authored OCR extraction records are not accepted. Use the governed Diaspora run-ocr workflow so provider execution and provenance are observed server-side.',
  });
});

// Problem 3 closure: local vehicle documents now enter the same canonical Document Intelligence
// provider boundary as identity/dealer/diaspora. The service performs object scope, document-class
// resolution and candidate-only persistence; this route owns no truth decision.
router.post(
  '/api/vehicles/:vin/evidence/:evidenceId/run-ocr',
  authorizeRole(['owner', 'dealer', 'admin', 'government']),
  requireProvenIdentity(),
  asyncHandler(async (req, res) => {
    const result = await runVehicleEvidenceOcr(
      undefined,
      req.userContext,
      req.params.vin,
      req.params.evidenceId,
      { req },
    );
    res.status(result.success ? 201 : 200).json(result);
  }),
);

export default router;
