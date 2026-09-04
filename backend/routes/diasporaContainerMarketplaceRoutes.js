/**
 * Trade OS logistics + container marketplace routes. Mounted under /api/diaspora.
 *
 * The historical /container-marketplace prefix remains for the hardened co-loading kernel. T3 adds
 * /logistics-* routes alongside it because a shipping request exists BEFORE a container reservation
 * and may be answered by a provider without a CarUp sailing.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  createContainer,
  listOpenContainers,
  getContainerCapacity,
  requestReservation,
  listContainerReservations,
  approveReservation,
  rejectReservation,
  cancelReservation,
  closeBooking,
} from '../services/diaspora/diasporaContainerMarketplaceService.js';
import {
  createLogisticsRequest,
  updateLogisticsRequest,
  publishLogisticsRequest,
  listMyLogisticsRequests,
  getMyLogisticsRequest,
  listLogisticsOpportunities,
  getLogisticsOpportunity,
  createLogisticsQuote,
  updateLogisticsQuote,
  submitLogisticsQuote,
  withdrawLogisticsQuote,
  listMyLogisticsQuotes,
  acceptLogisticsQuote,
  findCompatibleSailings,
  requestSpaceForAward,
} from '../services/diaspora/diasporaLogisticsRfqService.js';
import { ensureLogisticsConversation } from '../services/diaspora/diasporaLogisticsConversationService.js';
import { getTradeContext } from '../services/diaspora/tradeContextService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const base = '/container-marketplace';

// Route middleware is deliberately coarse. The services are the authority boundary: participant
// ownership, provider business eligibility, tenant operator authority and object scope are all
// resolved server-side from authenticated context rather than from stakeholder headers.
const participantAuth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);
const operatorAuth = participantAuth;

// ── T3: Logistics RFQ / "Ship something" ──────────────────────────────────
// Specific collection routes are registered before any /:id route to avoid Express shadowing.
router.get('/logistics-requests/mine', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listMyLogisticsRequests(req.query, req.userContext, { req }) });
}));
router.post('/logistics-requests', participantAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createLogisticsRequest(req.body, req.userContext, { req }) });
}));
router.get('/logistics-opportunities', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listLogisticsOpportunities(req.query, req.userContext, { req }) });
}));
router.get('/logistics-opportunities/:id', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getLogisticsOpportunity(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-opportunities/:id/quotes', participantAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createLogisticsQuote(req.params.id, req.body, req.userContext, { req }) });
}));
router.get('/logistics-quotes/mine', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listMyLogisticsQuotes(req.query, req.userContext, { req }) });
}));
router.patch('/logistics-quotes/:id', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await updateLogisticsQuote(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/logistics-quotes/:id/submit', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await submitLogisticsQuote(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-quotes/:id/withdraw', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await withdrawLogisticsQuote(req.params.id, req.userContext, { req }) });
}));
router.get('/logistics-requests/:id', participantAuth, asyncHandler(async (req, res) => {
  const data = await getMyLogisticsRequest(req.params.id, req.userContext, { req });
  // Provider DRAFT offers are private work-in-progress. The service composes the request transaction,
  // but the requester HTTP projection must never reveal a draft's price/terms before submission.
  // Platform reviewers may inspect through governed operational tooling rather than by weakening this
  // customer response.
  res.json({ data: { ...data, quotes: (data.quotes || []).filter((quote) => quote.status !== 'DRAFT') } });
}));
router.patch('/logistics-requests/:id', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await updateLogisticsRequest(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/publish', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await publishLogisticsRequest(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/accept-quote', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await acceptLogisticsQuote(req.params.id, req.body?.quoteId, req.userContext, { req }) });
}));
router.get('/logistics-requests/:id/sailing-matches', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await findCompatibleSailings(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/request-space', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await requestSpaceForAward(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/conversation', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await ensureLogisticsConversation(req.params.id, req.userContext, {
    req,
    providerId: req.body?.providerId || null,
  }) });
}));

// ── Existing hardened Container Co-Loading kernel ──────────────────────────
// Trade OS workspace identity/context projection (read-only; commercial context, never a role).
router.get(`${base}/trade-context`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getTradeContext(req.userContext, { req }) });
}));
router.get(`${base}/containers`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listOpenContainers(req.query, req.userContext, { req }) });
}));
router.post(`${base}/containers`, operatorAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createContainer(req.body, req.userContext, { req }) });
}));
router.get(`${base}/containers/:id/capacity`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getContainerCapacity(req.params.id, req.userContext, { req }) });
}));
router.get(`${base}/containers/:id/reservations`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listContainerReservations(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/containers/:id/reservations`, participantAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await requestReservation(req.params.id, req.body, req.userContext, { req }) });
}));
router.post(`${base}/containers/:id/close-booking`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await closeBooking(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/approve`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await approveReservation(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/reject`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await rejectReservation(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/cancel`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await cancelReservation(req.params.id, req.userContext, { req }) });
}));

export default router;
