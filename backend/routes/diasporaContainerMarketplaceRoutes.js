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
  openBooking,
  cancelSailing,
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
  confirmLogisticsItemMeasurements,
  findCompatibleSailings,
  requestSpaceForAward,
  cancelMyLogisticsRequest,
  closeMyLogisticsRequest,
} from '../services/diaspora/diasporaLogisticsRfqService.js';
import { ensureLogisticsConversation } from '../services/diaspora/diasporaLogisticsConversationService.js';
import { listActiveCorridors } from '../services/diaspora/tradeCorridorService.js';
import { addChargeComponents, listChargeComponents, projectComponentsForDisplay, composeLandedEstimate, readQuoteCommercials } from '../services/diaspora/tradeChargeComponentService.js';
import { materialStagesFor } from '../services/diaspora/tradeCommercialContract.js';
import { supabase as sharedSupabase } from '../db/supabase.js';

/** Read the quote header a breakdown belongs to, so totals come from the SERVER's row. */
async function loadQuoteHeader(target, options = {}) {
  const client = options.supabaseClient || sharedSupabase;
  const table = target.importQuoteId ? 'diaspora_import_quotes' : 'diaspora_logistics_quotes';
  const id = target.importQuoteId || target.logisticsQuoteId;
  const { data } = await client.from(table).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  return data || null;
}
import { compareQuotes, compareCorridorEconomics, adviseOptions } from '../services/diaspora/tradeQuoteComparisonService.js';
import { allocateSharedCharge, listAllocations, listContainerSharedCharges } from '../services/diaspora/tradeChargeAllocationService.js';
import { getReferenceRate } from '../services/diaspora/tradeFxRateService.js';
import { recordObservation, listObservations, corridorBenchmark } from '../services/diaspora/tradeRateObservationService.js';
import { getTransactionPassport, continueToLogistics } from '../services/diaspora/tradeTransactionPassportService.js';
import { setReadiness, listReadiness, summarizeReadiness } from '../services/diaspora/tradeDocumentReadinessService.js';
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
    // Deterministic: dimensions that round to 0.000 CBM will violate the column CHECK after the
    // header write. The service repeats this refusal; here it runs before any mutation.
    const unit = String(item?.dimension_unit ?? item?.dimensionUnit ?? '').toLowerCase();
    const l = Number(item?.length_value ?? item?.length); const w = Number(item?.width_value ?? item?.width); const h = Number(item?.height_value ?? item?.height);
    if ((unit === 'cm' || unit === 'm') && l > 0 && w > 0 && h > 0) {
      const d = unit === 'cm' ? 100 : 1;
      const qty = Math.max(1, Math.round(Number(item?.quantity) || 1));
      const cbm = Math.round(((l / d) * (w / d) * (h / d) * qty + Number.EPSILON) * 1000) / 1000;
      if (!(cbm > 0)) {
        throw new ValidationError(`Cargo item ${index + 1}'s measurements round to 0.000 CBM — check the unit (cm vs m), or use "I know the total volume" with the group's combined volume`);
      }
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
  // Requester visibility is an ALLOW-LIST of states, the same set the conversation gate uses.
  // Excluding only DRAFT leaked a quote withdrawn from DRAFT: it was never shown while private,
  // and the act of withdrawing flipped it past the filter with its full price and terms attached.
  // WITHDRAWN rows are therefore not projected at all — a retracted offer no longer stands, and
  // the row does not record whether it was ever submitted, so hiding is the only rule that cannot
  // disclose a never-submitted draft. (Telling the requester ABOUT a retraction is the separate,
  // deliberately deferred quote_withdrawn notification recorded in the receipt.)
  const REQUESTER_VISIBLE = new Set(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
  const quotes = (data.quotes || [])
    .filter((quote) => REQUESTER_VISIBLE.has(quote.status))
    .map(projectLogisticsQuoteForRequester);
  res.json({ data: { ...data, quotes } });
}));
router.patch('/logistics-requests/:id', participantAuth, asyncHandler(async (req, res) => {
  prevalidateLogisticsItems(req.body?.items);
  await preauthorizeLogisticsVehicleLinks(req.body?.items, req.userContext);
  res.json({ data: await updateLogisticsRequest(req.params.id, req.body, req.userContext, { req }) });
}));
// T5.7 — the requester's own lifecycle controls (the standing §36.10 gap). Cancel before an
// acceptance; close after one. Both refuse while a live container reservation is attached.
router.post('/logistics-requests/:id/cancel', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await cancelMyLogisticsRequest(req.params.id, req.userContext, { req }) });
}));
router.post('/logistics-requests/:id/close', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await closeMyLogisticsRequest(req.params.id, req.userContext, { req }) });
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
router.post('/logistics-requests/:id/confirm-measurements', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await confirmLogisticsItemMeasurements(req.params.id, req.body, req.userContext, { req }) });
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
// T5.2 — corridor reference data: route composition only, projected through an explicit
// allow-list. Order is by code; nothing here ranks or prefers a corridor.
// ── T6.5 research / operations rate workspace ───────────────────────────
//
// PLATFORM authority only, enforced in the service — a commercial profile grants nothing here.
// Deliberately NOT under the customer marketplace prefix: a research observation must never be
// reachable as though it were an offer a provider made to a customer.
router.get('/trade-rate-observations', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listObservations(req.query, req.userContext, { req }) });
}));

router.post('/trade-rate-observations', participantAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await recordObservation(req.body, req.userContext, { req }) });
}));

router.get('/trade-rate-observations/corridor-benchmark', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await corridorBenchmark(req.query, req.userContext, { req }) });
}));

// ── T6 commercial transparency ──────────────────────────────────────────
//
// A provider records the components of their OWN offer; the server derives who they are from the
// quote row, never from the request body. Reference USD is computed server-side too — a client
// that could send `normalized_usd` could manufacture a price comparison.

const quoteTarget = (req) => (req.params.kind === 'import-quotes'
  ? { importQuoteId: req.params.id }
  : { logisticsQuoteId: req.params.id });

router.get('/:kind(import-quotes|logistics-quotes)/:id/charge-components', participantAuth, asyncHandler(async (req, res) => {
  const target = quoteTarget(req);
  const quote = await loadQuoteHeader(target, { req });
  res.json({ data: await readQuoteCommercials(target, quote, { req }) });
}));

router.post('/:kind(import-quotes|logistics-quotes)/:id/charge-components', participantAuth, asyncHandler(async (req, res) => {
  // `breakdown_complete` is a DECLARATION by the provider, enforced server-side: a complete
  // breakdown must reconcile against their own stated total or the write is refused.
  const saved = await addChargeComponents(quoteTarget(req), req.body?.components, req.userContext, {
    req, breakdownComplete: req.body?.breakdown_complete === true,
  });
  res.status(201).json({ data: saved });
}));

// Compare two or more offers. The response deliberately carries `comparable` and the reasons, so
// a caller cannot render a winner CarUp did not name.
router.post('/quote-comparison', participantAuth, asyncHandler(async (req, res) => {
  const targets = Array.isArray(req.body?.quotes) ? req.body.quotes : [];
  if (targets.length < 2) throw new ValidationError('At least two offers are needed for a comparison');
  const quotes = [];
  for (const t of targets) {
    const target = t.kind === 'import' ? { importQuoteId: t.id } : { logisticsQuoteId: t.id };
    const components = await projectComponentsForDisplay(await listChargeComponents(target, { req }), { req });
    quotes.push({
      id: t.id, label: t.label || null, components,
      estimate: composeLandedEstimate(components, { materialStages: materialStagesFor(t.kind === 'import' ? 'procurement' : 'logistics') }),
    });
  }
  res.json({ data: { quotes, comparison: compareQuotes(quotes), advice: adviseOptions({ options: quotes, cargo: req.body?.cargo || {}, objective: req.body?.objective || null }) } });
}));

// Corridor economics over the FROZEN T5 corridor authority — route truth is read, never changed.
router.post('/corridor-economics', participantAuth, asyncHandler(async (req, res) => {
  const options = Array.isArray(req.body?.corridors) ? req.body.corridors : [];
  const enriched = [];
  for (const o of options) {
    const target = o.quote_kind === 'import' ? { importQuoteId: o.quote_id } : { logisticsQuoteId: o.quote_id };
    const components = o.quote_id ? await projectComponentsForDisplay(await listChargeComponents(target, { req }), { req }) : [];
    enriched.push({ corridor_code: o.corridor_code, corridor_name: o.corridor_name || null, planning_status: o.planning_status || null, components });
  }
  res.json({ data: compareCorridorEconomics(enriched) });
}));

// Reference FX for display. Reference ONLY — settlement is T13 and customs valuation is T12.
router.get('/fx/reference', participantAuth, asyncHandler(async (req, res) => {
  // Named `from`/`to` deliberately: `base` is the module-level route prefix, and shadowing it
  // here would be a trap for the next person adding a route below.
  const from = String(req.query.base || '').toUpperCase();
  const to = String(req.query.quote || 'USD').toUpperCase();
  res.json({ data: { ...await getReferenceRate(from, to, { req }), purpose: 'REFERENCE_DISPLAY_ONLY' } });
}));

router.post(`${base}/charge-components/:id/allocate`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await allocateSharedCharge(req.params.id, {
    containerId: req.body?.container_id, basis: req.body?.basis, explicit: req.body?.explicit || null,
  }, req.userContext, { req }) });
}));

// The shared charges an operator can allocate on one sailing, with each charge's current split.
router.get(`${base}/:id/shared-charges`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listContainerSharedCharges(req.params.id, req.userContext, { req }) });
}));

router.get(`${base}/charge-components/:id/allocations`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listAllocations(req.params.id, { req }) });
}));

router.get('/trade-corridors', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listActiveCorridors({ req }) });
}));

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
// T5.3 — deliberate lifecycle: a DRAFT sailing is opened explicitly; a sailing with no live
// reservations may be cancelled. Both operator-only, both audited in the service.
router.post(`${base}/containers/:id/open-booking`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await openBooking(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/containers/:id/cancel`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await cancelSailing(req.params.id, req.userContext, { req }) });
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

// ── Intake 2.0 — document READINESS ───────────────────────────────────────
//
// What the customer says they have, for either anchor. It is not the document lifecycle: no file
// is stored, nothing is verified, and the payload states that in the response rather than leaving
// a consumer to infer it. T8 owns actual documents.
router.get('/:kind(import-orders|logistics-requests)/:id/document-readiness', participantAuth, asyncHandler(async (req, res) => {
  const subject = req.params.kind === 'import-orders' ? 'import_order' : 'logistics_request';
  const rows = await listReadiness(subject, req.params.id, { req });
  res.json({ data: { documents: rows, summary: summarizeReadiness(rows) } });
}));

router.post('/:kind(import-orders|logistics-requests)/:id/document-readiness', participantAuth, asyncHandler(async (req, res) => {
  const subject = req.params.kind === 'import-orders' ? 'import_order' : 'logistics_request';
  await setReadiness(subject, req.params.id, req.body?.entries || req.body, req.userContext, { req });
  const rows = await listReadiness(subject, req.params.id, { req });
  res.status(201).json({ data: { documents: rows, summary: summarizeReadiness(rows) } });
}));

// ── Trade OS T4 — Order & Booking Passport ────────────────────────────────
//
// One projection, two anchors. `kind` is part of the PATH rather than a query flag so that the
// two origins can never be silently conflated by a missing parameter: a procurement passport and
// a logistics passport are different transactions, not one endpoint with a mode.
//
// The service performs participant-scoped authorization itself, because who may read a
// transaction depends on facts (who the awarded provider is) that a route-level role check cannot
// see. `participantAuth` here only establishes that there IS an identity.
router.get('/trade-transactions/:kind/:id', participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getTransactionPassport({ kind: req.params.kind, id: req.params.id }, req.userContext, { req }) });
}));

// Continue an awarded purchase into shipping. Idempotent by database constraint, not by UI state.
router.post('/import-orders/:id/continue-to-logistics', participantAuth, asyncHandler(async (req, res) => {
  const result = await continueToLogistics(req.params.id, req.userContext, { req });
  res.status(result.idempotentReplay ? 200 : 201).json({ data: result });
}));

export default router;
