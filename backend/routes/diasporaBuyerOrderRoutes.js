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
  getRfqForSeller,
  listMyQuotes,
  createQuote,
  updateQuote,
  submitQuoteById,
  withdrawQuote,
} from '../services/diaspora/diasporaRfqService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// H4 authorization matrix: buyer-side vs seller-side allowlists; services re-check ownership.
const buyerAuth = authorizeRole(['owner', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);
const sellerAuth = authorizeRole(['dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

// --- Buyer orders (buyer-owned) ---
router.get('/buyer-orders', buyerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listBuyerOrders(req.query, req.userContext, { req }) });
}));
router.post('/buyer-orders', buyerAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createBuyerOrder(req.body, req.userContext, { req }) });
}));
router.get('/buyer-orders/:id', buyerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getBuyerOrder(req.params.id, req.userContext, { req }) });
}));
router.patch('/buyer-orders/:id', buyerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await updateBuyerOrder(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/buyer-orders/:id/publish-rfq', buyerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await publishRfq(req.params.id, req.userContext, { req }) });
}));
router.get('/buyer-orders/:id/matches', buyerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getOrderMatches(req.params.id, req.userContext, { req }) });
}));
router.post('/buyer-orders/:id/accept-quote', buyerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await acceptQuote(req.params.id, req.body?.quoteId, req.userContext, { req }) });
}));

// --- Seller responses to a published RFQ ---
router.post('/buyer-orders/:id/quotes', sellerAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createQuote(req.params.id, req.body, req.userContext, { req }) });
}));
router.get('/rfqs', sellerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listRfqs(req.query, req.userContext, { req }) });
}));
// A supplier's view of ONE published request — the same sanitized projection as the feed.
router.get('/rfqs/:id', sellerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getRfqForSeller(req.params.id, req.userContext, { req }) });
}));
// The supplier's own quotes across every request (their pipeline: drafts, submitted, won, lost).
router.get('/my-quotes', sellerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listMyQuotes(req.query, req.userContext, { req }) });
}));
router.patch('/quotes/:id', sellerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await updateQuote(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/quotes/:id/submit', sellerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await submitQuoteById(req.params.id, req.userContext, { req }) });
}));
router.post('/quotes/:id/withdraw', sellerAuth, asyncHandler(async (req, res) => {
  res.json({ data: await withdrawQuote(req.params.id, req.userContext, { req }) });
}));

export default router;
