/**
 * Mobile device certification — admin read console (Full Activation).
 *
 * Read-only visibility over the native offline evidence-workflow certification matrix
 * (the append-only mobile_certification_results ledger). Admin/government only.
 * Certification runs/results are recorded by the certification harness (service-role);
 * this surface never mutates them.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getRunMatrix } from '../services/mobileCertification/certificationService.js';

const router = express.Router();
const ADMIN = ['admin', 'government'];

router.get('/api/admin/mobile-certification/matrix', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    const matrix = await getRunMatrix({
      actor: { id: req.userContext?.userId, role: req.userContext?.role },
      platform: req.query.platform,
      tenant_id: req.query.tenant_id,
    });
    res.json({ matrix });
  } catch (err) {
    if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message });
    next(err);
  }
});

export default router;
