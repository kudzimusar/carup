/**
 * Phase 3 — Diaspora stock & supply-document routes.
 * Mounted under /api/diaspora by diasporaRoutes.js. Service layer enforces tenant/ownership.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  createStockItem,
  listStockItems,
  getStockItem,
  updateStockItem,
  reserveStock,
  releaseReservation,
} from '../services/diaspora/diasporaStockService.js';
import { appendStockMovement, listStockLedger } from '../services/diaspora/diasporaStockLedgerService.js';
import {
  createSupplyDocument,
  listSupplyDocuments,
  getSupplyDocument,
  updateSupplyDocument,
  publishSupplyDocument,
  unpublishSupplyDocument,
} from '../services/diaspora/diasporaSupplyDocumentService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = authorizeRole();

// --- Stock items ---
router.get('/stock', auth, asyncHandler(async (req, res) => {
  const data = await listStockItems(req.query, req.userContext, { req });
  res.json({ data });
}));

router.post('/stock', auth, asyncHandler(async (req, res) => {
  const data = await createStockItem(req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.get('/stock/:id', auth, asyncHandler(async (req, res) => {
  const data = await getStockItem(req.params.id, req.userContext, { req });
  res.json({ data });
}));

router.patch('/stock/:id', auth, asyncHandler(async (req, res) => {
  const data = await updateStockItem(req.params.id, req.body, req.userContext, { req });
  res.json({ data });
}));

router.get('/stock/:id/ledger', auth, asyncHandler(async (req, res) => {
  const data = await listStockLedger(req.params.id, req.query, req.userContext, { req });
  res.json({ data });
}));

router.post('/stock/:id/ledger', auth, asyncHandler(async (req, res) => {
  const data = await appendStockMovement(req.params.id, req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.post('/stock/:id/reserve', auth, asyncHandler(async (req, res) => {
  const data = await reserveStock(req.params.id, req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.post('/stock/:id/release-reservation', auth, asyncHandler(async (req, res) => {
  const data = await releaseReservation(req.params.id, req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

// --- Supply documents ---
router.get('/supply-documents', auth, asyncHandler(async (req, res) => {
  const data = await listSupplyDocuments(req.query, req.userContext, { req });
  res.json({ data });
}));

router.post('/supply-documents', auth, asyncHandler(async (req, res) => {
  const data = await createSupplyDocument(req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.get('/supply-documents/:id', auth, asyncHandler(async (req, res) => {
  const data = await getSupplyDocument(req.params.id, req.userContext, { req });
  res.json({ data });
}));

router.patch('/supply-documents/:id', auth, asyncHandler(async (req, res) => {
  const data = await updateSupplyDocument(req.params.id, req.body, req.userContext, { req });
  res.json({ data });
}));

router.post('/supply-documents/:id/publish', auth, asyncHandler(async (req, res) => {
  const data = await publishSupplyDocument(req.params.id, req.userContext, { req });
  res.json({ data });
}));

router.post('/supply-documents/:id/unpublish', auth, asyncHandler(async (req, res) => {
  const data = await unpublishSupplyDocument(req.params.id, req.userContext, { req });
  res.json({ data });
}));

export default router;
