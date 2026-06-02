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

  try {
    const analysis = await DocumentIntelligenceService.extractDocumentData(docType, capturedFront);
    
    // Automatically perform a fraud scan on the submission
    const fraudScan = await FraudService.scanFraudRisk('system_user', {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || '127.0.0.1'
    });

    res.json({
      ...analysis,
      fraudReport: fraudScan
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
  const { actorId, vin, overrideJustification } = req.body;

  if (!actorId || !vin) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: actorId and vin are mandatory.'
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
