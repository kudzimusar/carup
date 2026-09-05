/**
 * Trade OS logistics + container marketplace routes. Mounted under /api/diaspora.
 *
 * The historical /container-marketplace prefix remains for the hardened co-loading kernel. T3 adds
 * /logistics-* routes alongside it because a shipping request exists BEFORE a container reservation
 * and may be answered by a provider without a CarUp sailing.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { resolveVehicleObjectAuthority } from '../middleware/vehicleObjectAuthority.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';
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
const logisticsCargoCategories = new Set([
  'vehicle', 'parts', 'household', 'furniture_appliances', 'boxes',
  'machinery_equipment', 'pallet_crate', 'general', 'other',
]);
const logisticsReservationUniqueness = 'uq_diaspora_cargo_reservation_live_logistics_request';

// Route middleware is deliberately coarse. The services are the authority boundary: participant
// ownership, provider business eligibility, tenant operator authority and object scope are all
// resolved server-side from authenticated context rather than from stakeholder headers.
const participantAuth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);
const operatorAuth = participantAuth;

/**
 * Deterministic item validation before request-header mutation.
 *
 * The service remains the canonical normalizer and repeats these checks. This preflight exists to
 * prevent a malformed cargo array from first creating/updating a request header and only then
 * failing while its items are replaced. It deliberately mirrors only validation that can reject
 * input; measurements that are merely unknown remain valid.
 */
function prevalidateLogisticsItems(items) {
  if (!Array.isArray(items)) return;
  if (!items.length) throw new ValidationError('Add at least one cargo item');
  if (items.length > 50) throw new ValidationError('A shipping request can contain at most 50 cargo item groups');
  items.forEach((item, index) => {
    const category = String(item?.cargo_category ?? item?.cargoCategory ?? 'other').toLowerCase();
    if (!logisticsCargoCategories.has(category)) {
      throw new ValidationError(`Cargo item ${index + 1} has an unsupported category`);
    }
    if (!String(item?.description ?? '').trim()) {
      throw new ValidationError(`Cargo item ${index + 1} needs a plain-language description`);
    }
  });
}

/**
 * HTTP transaction preflight for linked vehicles.
 *
 * The service also checks each link before writing item rows. This route preflight happens BEFORE
 * create/update mutates the request header, so a forged VIN cannot leave behind an orphan draft or
 * partially updated route merely because item authorization later failed.
 */
async function preauthorizeLogisticsVehicleLinks(items, userContext) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const vin = item?.linked_vehicle_vin || item?.linkedVehicleVin || null;
    if (!vin) continue;
    const authority = await resolveVehicleObjectAuthority(vin, userContext);
    if (authority.allowed) continue;
    // Match the canonical vehicle-object boundary: missing and foreign VINs are both 403 so an
    // unrelated caller cannot use status codes to enumerate whether a guessed VIN exists.
    if (authority.reason === 'no_identity') throw new ForbiddenError('Vehicle linkage requires an authenticated user');
    if (authority.reason === 'lookup_failed') throw new ForbiddenError('Vehicle authority could not be established');
    throw new ForbiddenError('You are not authorized to link that vehicle to this shipping request');
  }
}

/**
 * Requester-safe commercial offer projection.
 *
 * A requester legitimately needs an opaque provider id to open the canonical provider conversation,
 * plus the provider's safe commercial identity and the actual offered terms. Provider tenant ids,
 * internal metadata and mutation/audit actor ids have no buyer-facing purpose and never cross this
 * HTTP boundary. The allow-list also means a future quote column cannot leak by default.
 */
function projectLogisticsQuoteForRequester(quote = {}) {
  const validityDate = quote.valid_until ? String(quote.valid_until).slice(0, 10) : null;
  return {
    id: quote.id,
    reference: quote.reference,
    logistics_request_id: quote.logistics_request_id,
    provider_id: quote.provider_id,
    service_mode: quote.service_mode,
    compatible_container_id: quote.compatible_container_id ?? null,
    freight_amount: quote.freight_amount ?? null,
    handling_amount: quote.handling_amount ?? null,
    origin_charges: quote.origin_charges ?? null,
    destination_charges: quote.destination_charges ?? null,
    documentation_fees: quote.documentation_fees ?? null,
    optional_services: Array.isArray(quote.optional_services) ? quote.optional_services : [],
    total_amount: quote.total_amount,
    currency: quote.currency,
    transit_days: quote.transit_days ?? null,
    // The provider UI captures a calendar date, so requester comparison treats that date as
    // inclusive. The DB guard applies the same UTC-calendar rule at submit/award time.
    valid_until: validityDate ? `${validityDate}T23:59:59.999Z` : null,
    pickup_included: quote.pickup_included ?? null,
    delivery_included: quote.delivery_included ?? null,
    inclusions: Array.isArray(quote.inclusions) ? quote.inclusions : [],
    exclusions: Array.isArray(quote.exclusions) ? quote.exclusions : [],
    conditions: quote.conditions ?? null,
    status: quote.status,
    provider: quote.provider || null,
    created_at: quote.created_at,
    updated_at: quote.updated_at,
  };
}

/**
 * The service performs an idempotent read-before-write. The database now also has a unique partial
 * index for one live reservation per logistics request. If two HTTP calls race, exactly one insert
 * wins; the loser is retried once through the normal service path, which now observes that row and
 * returns `idempotentReplay:true` rather than surfacing a duplicate-key implementation detail.
 */
async function requestSpaceWithConcurrentReplay(requestId, userContext, options) {
  try {
    return await requestSpaceForAward(requestId, userContext, options);
  } catch (error) {
    if (!String(error?.message || '').includes(logisticsReservationUniqueness)) throw error;
    return requestSpaceForAward(requestId, userContext, options);
  }
}

// ── T3: Logistics RFQ / "Ship something" ──────────────────────────────────
// Specific collection routes are registered before any /:id route to avoid Express shadowing.
router.get('/logistics-requests/mine', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listMyLogisticsRequests(req.query, req.userContext, { req }) });
}));
router.post('/logistics-requests', participantAuth, asyncHandler(async (req, res) => {
  prevalidateLogisticsItems(req.body?.items);
  await preauthorizeLogisticsVehicleLinks(req.body?.items, req.userContext);
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
  // DRAFT offers are private work-in-progress. Every visible offer then crosses an explicit
  // allow-list projection rather than the database row returned by the service-role client.
  const quotes = (data.quotes || [])
    .filter((quote) => quote.status !== 'DRAFT')
    .map(projectLogisticsQuoteForRequester);
  res.json({ data: { ...data, quotes } });
}));
router.patch('/logistics-requests/:id', participantAuth, asyncHandler(async (req, res) => {
  prevalidateLogisticsItems(req.body?.items);
  await preauthorizeLogisticsVehicleLinks(req.body?.items, req.userContext);
  res.json({ data: await updateLogisticsRequest(req.params.id, req.body, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/publish', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await publishLogisticsRequest(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/accept-quote', participantAuth, asyncHandler(async (req, res) => {
  const data = await acceptLogisticsQuote(req.params.id, req.body?.quoteId, req.userContext, { req });
  res.json({ data: { ...data, acceptedQuote: data.acceptedQuote ? projectLogisticsQuoteForRequester(data.acceptedQuote) : null } });
}));
router.get('/logistics-requests/:id/sailing-matches', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await findCompatibleSailings(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/request-space', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await requestSpaceWithConcurrentReplay(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/conversation', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await ensureLogisticsConversation(req.params.id, req.userContext, {
    req,
    providerId: req.body?.providerId || null,
  }) });
}));

// ── Existing hardened Container Co-Loading kernel ──────────────────────────
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
