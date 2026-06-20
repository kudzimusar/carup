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
} from '../services/diaspora/diasporaDriveSyncService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = authorizeRole();

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

export default router;
