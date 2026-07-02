/**
 * Vehicle History Report routes — Milestone 4 (master plan §10.5, §15).
 *
 *   GET  /api/vehicles/:vin/report              assembled public-safe report (audience by role)
 *   POST /api/vehicles/:vin/report/versions     snapshot an immutable version [owner/dealer/admin]
 *   POST /api/report-versions/:id/share         create an expiring share link  [owner/dealer/admin]
 *   POST /api/report-versions/:id/revoke        revoke a shared report          [owner/dealer/admin]
 *   GET  /api/reports/shared/:token             open a shared report (public, expiring, no auth)
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { authorizeRole, optionalAuth } from '../middleware/authMiddleware.js';
import {
  assembleReport, generateReportVersion, createShareLink, getReportByShareToken, revokeShare,
} from '../services/report/reportService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/api/vehicles/:vin/report', optionalAuth(), asyncHandler(async (req, res) => {
  const audience = req.userContext?.role || 'public';
  const report = await assembleReport(supabase, req.params.vin, { audience });
  res.json(report);
}));

router.post('/api/vehicles/:vin/report/versions', authorizeRole(['owner', 'dealer', 'admin', 'government']), asyncHandler(async (req, res) => {
  const version = await generateReportVersion(supabase, req.params.vin, { actorId: req.userContext?.id || null, audience: 'public' });
  res.status(201).json({ id: version.id, version: version.version, content_hash: version.content_hash, completeness: version.completeness });
}));

router.post('/api/report-versions/:id/share', authorizeRole(['owner', 'dealer', 'admin', 'government']), asyncHandler(async (req, res) => {
  const ttlSeconds = Number(req.body.ttl_seconds) || undefined;
  const link = await createShareLink(supabase, req.params.id, ttlSeconds ? { ttlSeconds } : {});
  res.status(201).json(link);
}));

router.post('/api/report-versions/:id/revoke', authorizeRole(['owner', 'dealer', 'admin', 'government']), asyncHandler(async (req, res) => {
  await revokeShare(supabase, req.params.id, { correctionNotice: req.body.correction_notice || null });
  res.json({ revoked: true });
}));

router.get('/api/reports/shared/:token', asyncHandler(async (req, res) => {
  const result = await getReportByShareToken(supabase, req.params.token);
  if (!result.ok) {
    if (result.reason === 'not_found') throw new NotFoundError('Shared report not found');
    return res.status(410).json({ error: `Shared report ${result.reason}` }); // 410 Gone for expired/revoked
  }
  res.json({ version: result.version, generated_at: result.generated_at, correction_notice: result.correction_notice, report: result.report });
}));

export default router;
