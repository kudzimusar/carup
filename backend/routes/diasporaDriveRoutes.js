/**
 * Phase 7 — Diaspora Drive routes. Mounted under /api/diaspora.
 * Token material is never returned. The OAuth callback validates signed state bound to the user.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  getDriveStatus,
  getAuthorizationUrl,
  handleOAuthCallback,
  disconnectDrive,
  listDriveFiles,
  uploadDriveFile,
  exportToDrive,
  syncDrive,
  getEntitySyncAttempts,
} from '../services/diaspora/diasporaDriveSyncService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// H4: Drive is per-user trade-document storage; the service scopes every call to the caller's own
// connection/files. Restrict to authenticated trade participants.
const auth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

router.get('/drive/status', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getDriveStatus(req.userContext, { req }) });
}));
router.get('/drive/google/authorize', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getAuthorizationUrl(req.userContext, { req }) });
}));
router.get('/drive/google/callback', auth, asyncHandler(async (req, res) => {
  res.json({ data: await handleOAuthCallback({ code: req.query.code, state: req.query.state }, req.userContext, { req }) });
}));
router.post('/drive/disconnect', auth, asyncHandler(async (req, res) => {
  res.json({ data: await disconnectDrive(req.userContext, { req }) });
}));
router.get('/drive/files', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listDriveFiles(req.userContext, { req }) });
}));
router.post('/drive/upload', auth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await uploadDriveFile(req.body, req.userContext, { req }) });
}));
router.post('/drive/export', auth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await exportToDrive(req.body, req.userContext, { req }) });
}));
router.post('/drive/sync', auth, asyncHandler(async (req, res) => {
  res.json({ data: await syncDrive(req.userContext, { req }) });
}));
// The durable answer to "did my document actually reach Drive?" — queued, retrying, or dead-lettered.
// Scoped to the caller's tenant inside the service; no attempt row for another tenant is reachable.
router.get('/drive/sync-attempts/:entityType/:entityId', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getEntitySyncAttempts({ entityType: req.params.entityType, entityId: req.params.entityId }, req.userContext, { req }) });
}));

export default router;
