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
const auth = authorizeRole();

router.post('/ai-commands/parse', auth, asyncHandler(async (req, res) => {
  res.json({ data: parseAiCommand(req.body?.rawCommand || req.body?.raw_command, req.userContext) });
}));
router.post('/ai-commands', auth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createAiCommand(req.body, req.userContext, { req }) });
}));
router.get('/ai-commands', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listAiCommands(req.query, req.userContext, { req }) });
}));
router.get('/ai-commands/:id', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/confirm', auth, asyncHandler(async (req, res) => {
  res.json({ data: await confirmAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/approve', auth, asyncHandler(async (req, res) => {
  res.json({ data: await approveAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/reject', auth, asyncHandler(async (req, res) => {
  res.json({ data: await rejectAiCommand(req.params.id, req.userContext, { req }) });
}));
router.post('/ai-commands/:id/execute', auth, asyncHandler(async (req, res) => {
  res.json({ data: await executeAiCommand(req.params.id, req.userContext, { req }) });
}));

export default router;
