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
  publishStockItem,
  unpublishStockItem,
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
// Stock & supply documents are seller-scoped (H4 authorization matrix). Buyers/owners cannot create
// seller stock merely by being authenticated; service layer enforces ownership/tenant on top.
const sellerAuth = authorizeRole(['dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

// --- Stock items ---
router.get('/stock', sellerAuth, asyncHandler(async (req, res) => {
  const data = await listStockItems(req.query, req.userContext, { req });
  res.json({ data });
}));

router.post('/stock', sellerAuth, asyncHandler(async (req, res) => {
  const data = await createStockItem(req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.get('/stock/:id', sellerAuth, asyncHandler(async (req, res) => {
  const data = await getStockItem(req.params.id, req.userContext, { req });
  res.json({ data });
}));

router.patch('/stock/:id', sellerAuth, asyncHandler(async (req, res) => {
  const data = await updateStockItem(req.params.id, req.body, req.userContext, { req });
  res.json({ data });
}));

router.post('/stock/:id/publish', sellerAuth, asyncHandler(async (req, res) => {
  const data = await publishStockItem(req.params.id, req.body, req.userContext, { req });
  res.json({ data });
}));

router.post('/stock/:id/unpublish', sellerAuth, asyncHandler(async (req, res) => {
  const data = await unpublishStockItem(req.params.id, req.body, req.userContext, { req });
  res.json({ data });
}));

router.get('/stock/:id/ledger', sellerAuth, asyncHandler(async (req, res) => {
  const data = await listStockLedger(req.params.id, req.query, req.userContext, { req });
  res.json({ data });
}));

router.post('/stock/:id/ledger', sellerAuth, asyncHandler(async (req, res) => {
  const data = await appendStockMovement(req.params.id, req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.post('/stock/:id/reserve', sellerAuth, asyncHandler(async (req, res) => {
  const data = await reserveStock(req.params.id, req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.post('/stock/:id/release-reservation', sellerAuth, asyncHandler(async (req, res) => {
  const data = await releaseReservation(req.params.id, req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

// --- Supply documents ---
router.get('/supply-documents', sellerAuth, asyncHandler(async (req, res) => {
  const data = await listSupplyDocuments(req.query, req.userContext, { req });
  res.json({ data });
}));

router.post('/supply-documents', sellerAuth, asyncHandler(async (req, res) => {
  const data = await createSupplyDocument(req.body, req.userContext, { req });
  res.status(201).json({ data });
}));

router.get('/supply-documents/:id', sellerAuth, asyncHandler(async (req, res) => {
  const data = await getSupplyDocument(req.params.id, req.userContext, { req });
  res.json({ data });
}));

router.patch('/supply-documents/:id', sellerAuth, asyncHandler(async (req, res) => {
  const data = await updateSupplyDocument(req.params.id, req.body, req.userContext, { req });
  res.json({ data });
}));

router.post('/supply-documents/:id/publish', sellerAuth, asyncHandler(async (req, res) => {
  const data = await publishSupplyDocument(req.params.id, req.userContext, { req });
  res.json({ data });
}));

router.post('/supply-documents/:id/unpublish', sellerAuth, asyncHandler(async (req, res) => {
  const data = await unpublishSupplyDocument(req.params.id, req.userContext, { req });
  res.json({ data });
}));

export default router;
