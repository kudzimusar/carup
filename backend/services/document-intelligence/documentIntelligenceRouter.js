import express from 'express';
import { DocumentIntelligenceService } from './documentIntelligenceService.js';
import { TrustService } from '../trust-service/trustService.js';
import { FraudService } from '../fraud-service/fraudService.js';

const router = express.Router();

// 1. OCR Extraction & Preprocessing
router.post('/ocr', async (req, res) => {
  const { docType, capturedFront } = req.body;

  if (!docType || !capturedFront) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: docType and capturedFront are mandatory parameters.'
    });
  }

  // O2 OCR convergence — reviewer OCR attribution. The extraction is attributed to the PROVEN
  // reviewer session established by the mount's authorizeSessionRole(['admin','government']) — the
  // x-user-id header fallback is disabled there. The reviewer id is NEVER taken from the request
  // body, an arbitrary header, or any default/fallback identity ('u1', 'system_user', …). An
  // unattributed runtime extraction is refused here (and refused again at the service boundary,
  // which requires the authenticated user id outside test mode).
  const reviewerId = req.userContext?.id;
  if (!reviewerId) {
    return res.status(401).json({
      success: false,
      error: 'Authenticated reviewer session is required to run document OCR.'
    });
  }

  try {
    const analysis = await DocumentIntelligenceService.extractDocumentData(docType, capturedFront, reviewerId);

    // Fraud risk is NOT evaluated on this extraction route — and must not be faked.
    //
    // scanFraudRisk(userId, …) evaluates the fraud risk OF that userId (its device sessions,
    // verification-failure history, …). This route establishes no document-subject identity: the
    // reviewer runs the OCR, they are not the document's subject, and there is no server-derived
    // subject to assess. The historical call passed the literal 'system_user', which returned a
    // riskRating:'Low' for a phantom subject (and scanFraudRisk also returns 'Low' on internal
    // failure) — a misleading product truth. Rather than manufacture a subject, the response states
    // explicitly that fraud risk was not evaluated here; it is the owning verification/review
    // workflow's decision, evaluated against a real subject, never a by-product of extraction.
    res.json({
      ...analysis,
      fraudReport: {
        status: 'not_evaluated',
        reason: 'No document-subject identity is established on the OCR extraction route; fraud risk is evaluated by the owning verification/review workflow against a real subject, not by OCR extraction.',
      },
    });
  } catch (error) {
    console.error('OCR verification route failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process document. OCR service error.'
    });
  }
});

// 1b. Admin/Government OCR Verification Approval
router.post('/ocr/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { vin, overrideJustification } = req.body;

  // The actor is WHO IS CALLING, never who the caller says they are. An administrative
  // override is written to administrative_overrides with this id as its accountable
  // reviewer, so accepting req.body.actorId let any caller attribute their own override to
  // someone else. The mount now guarantees a proven admin/government session.
  const actorId = req.userContext?.id;

  if (!actorId || !vin) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: an authenticated reviewer and vin are mandatory.'
    });
  }

  try {
    const approval = await DocumentIntelligenceService.approveDocumentVerification(id, actorId, vin, overrideJustification);
    res.json(approval);
  } catch (error) {
    console.error('OCR approval route failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// 2. Fraud Risk Assessment Scan
router.post('/fraud-scan', async (req, res) => {
  const { userId, ipAddress, userAgent, deviceId, vin } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'Missing required field: userId is mandatory.' });
  }

  try {
    const report = await FraudService.scanFraudRisk(userId, {
      ipAddress: ipAddress || req.ip || '127.0.0.1',
      userAgent: userAgent || req.headers['user-agent'],
      deviceId,
      vin
    });
    res.json(report);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Dynamic User Trust Score Evaluation
router.get('/trust-score/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const score = await TrustService.calculateUserTrustScore(userId);
    res.json({ userId, trustScore: score });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Manual / Admin Trust Level Promotion
// NOTE: this remains a second writer of identity verification level, parallel to the
// governed reviewVerificationSession authority. The mount now requires a proven
// admin/government session, which closes the unauthenticated path; consolidating the two
// writers is recorded as an outstanding authority obligation rather than done here, because
// it changes the governed identity-review contract.
router.post('/promote-trust', async (req, res) => {
  const { userId, trustLevel, details } = req.body;

  if (!userId || trustLevel === undefined) {
    return res.status(400).json({ success: false, error: 'Missing parameters: userId and trustLevel are required.' });
  }

  try {
    const result = await TrustService.assignTrustLevel(userId, trustLevel, details || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
