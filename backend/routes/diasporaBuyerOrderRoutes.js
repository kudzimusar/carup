/**
 * Phase 4 — Buyer Orders & Reverse RFQ routes. Mounted under /api/diaspora.
 * Distinct from the legacy /import-orders flow; service layer enforces tenant/role/participant access.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  createBuyerOrder,
  listBuyerOrders,
  getBuyerOrder,
  updateBuyerOrder,
  publishRfq,
  getOrderMatches,
  acceptQuote,
} from '../services/diaspora/diasporaBuyerOrderService.js';
import {
  listRfqs,
  createQuote,
  updateQuote,
  submitQuoteById,
  withdrawQuote,
} from '../services/diaspora/diasporaRfqService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = authorizeRole();

// --- Buyer orders ---
router.get('/buyer-orders', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listBuyerOrders(req.query, req.userContext, { req }) });
}));
router.post('/buyer-orders', auth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createBuyerOrder(req.body, req.userContext, { req }) });
}));
router.get('/buyer-orders/:id', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getBuyerOrder(req.params.id, req.userContext, { req }) });
}));
router.patch('/buyer-orders/:id', auth, asyncHandler(async (req, res) => {
  res.json({ data: await updateBuyerOrder(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/buyer-orders/:id/publish-rfq', auth, asyncHandler(async (req, res) => {
  res.json({ data: await publishRfq(req.params.id, req.userContext, { req }) });
}));
router.get('/buyer-orders/:id/matches', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getOrderMatches(req.params.id, req.userContext, { req }) });
}));
router.post('/buyer-orders/:id/quotes', auth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createQuote(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/buyer-orders/:id/accept-quote', auth, asyncHandler(async (req, res) => {
  res.json({ data: await acceptQuote(req.params.id, req.body?.quoteId, req.userContext, { req }) });
}));

// --- RFQ marketplace + quotes ---
router.get('/rfqs', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listRfqs(req.query, req.userContext, { req }) });
}));
router.patch('/quotes/:id', auth, asyncHandler(async (req, res) => {
  res.json({ data: await updateQuote(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/quotes/:id/submit', auth, asyncHandler(async (req, res) => {
  res.json({ data: await submitQuoteById(req.params.id, req.userContext, { req }) });
}));
router.post('/quotes/:id/withdraw', auth, asyncHandler(async (req, res) => {
  res.json({ data: await withdrawQuote(req.params.id, req.userContext, { req }) });
}));

export default router;
