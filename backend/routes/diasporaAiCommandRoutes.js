/**
 * Phase 5 — AI command routes. Mounted under /api/diaspora.
 * Execution re-validates permission, risk and approval; high-risk execution is always blocked.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  parseAiCommand,
  createAiCommand,
  listAiCommands,
  getAiCommand,
  confirmAiCommand,
  approveAiCommand,
  rejectAiCommand,
  executeAiCommand,
} from '../services/diaspora/diasporaAiCommandService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// H4: AI command center is for authenticated trade participants; high-risk approval is reviewer-only.
const participantAuth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);
const reviewerAuth = authorizeRole(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

router.post('/ai-commands/parse', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: parseAiCommand(req.body?.rawCommand || req.body?.raw_command, req.userContext) });
}));
router.post('/ai-commands', participantAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createAiCommand(req.body, req.userContext, { req }) });
}));
router.get('/ai-commands', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listAiCommands(req.query, req.userContext, { req }) });
}));
router.get('/ai-commands/:id', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/confirm', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await confirmAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/approve', reviewerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await approveAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/reject', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await rejectAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/execute', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await executeAiCommand(req.params.id, req.userContext, { req }) });
}));

export default router;
