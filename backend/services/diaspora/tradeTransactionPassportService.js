/**
 * Trade OS T4 — the Order & Booking Passport projection.
 *
 * This service OWNS NO FACTS. Every value it returns is read from the authority that already owns
 * it: procurement from `diaspora_import_orders`, logistics from `diaspora_logistics_requests`,
 * capacity from the container authority, documents from the trade-document authority, messages
 * from canonical Communications. T4 adds exactly one edge to the schema — a nullable
 * `import_order_id` on a shipping request — and otherwise only aggregates and projects.
 *
 * Two origins, never conflated:
 *
 *   PROCUREMENT-ORIGIN  someone bought something. Anchor: the import order.
 *   LOGISTICS-ORIGIN    someone already owns something and needs it moved. Anchor: the shipping
 *                       request. No procurement order is manufactured for it — the cargo was
 *                       never bought through CarUp, and inventing an order to hold it would be a
 *                       lie with a primary key.
 *
 * The projection is PARTICIPANT-SCOPED. The same transaction renders differently for the requester
 * and for the awarded provider, because T3's privacy contract does not lapse just because T4
 * aggregates more domains: a provider still never learns the requester's identity or a cargo VIN.
 */
import {
  requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId,
  assertCanReadImportOrder,
} from './diasporaAuthorization.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { computeCapacity } from './diasporaContainerMarketplaceService.js';
import { deriveTransactionStage, buildLifecycleRail } from './tradeTransactionStage.js';

const REQUESTS = 'diaspora_logistics_requests';
const REQUEST_ITEMS = 'diaspora_logistics_request_items';
const QUOTES = 'diaspora_logistics_quotes';
const RESERVATIONS = 'diaspora_cargo_reservations';
const CONTAINERS = 'diaspora_container_shipments';
const ORDERS = 'diaspora_import_orders';
const ORDER_QUOTES = 'diaspora_import_quotes';
const ORDER_PARTICIPANTS = 'diaspora_import_order_participants';
const TRADE_DOCUMENTS = 'diaspora_trade_documents';

/**
 * A provider's DRAFT offer is theirs alone until submitted. T3 enforces this in its ROUTE, so a
 * service-level caller like this one would otherwise read straight past it. The set is duplicated
 * here deliberately rather than imported from a route, and a test pins the two copies equal so
 * they cannot drift apart silently.
 */
export const REQUESTER_VISIBLE_QUOTE_STATUSES = Object.freeze(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

export const TRANSACTION_KINDS = Object.freeze(['procurement', 'logistics']);

const isPrivileged = (context) => isPlatformAdmin(context) || isPlatformReviewer(context);

/** Short, stable, human-facing references. Never expose a bare uuid as "the reference". */
const shortRef = (prefix, id) => `${prefix}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/**
 * A value CarUp does not know is reported as unknown — never as zero, never as an empty string
 * that reads like a real answer. DESIGN.md §8.1.
 */
const stated = (value) => (value === null || value === undefined || value === '' ? null : value);

/**
 * The live reservation for a shipping request.
 *
 * T3 records the edge in `diaspora_cargo_reservations.metadata->>'logistics_request_id'`, so the
 * lookup is scoped by `container_id` (which is indexed) and then matched on metadata in JS —
 * exactly how T3's own `requestSpaceForAward` finds its idempotent replay. Querying the JSONB path
 * directly would be tidier SQL but would scan every reservation on the platform, since no index
 * covers that expression outside the partial unique one.
 *
 * Without a container there can be no reservation, so the absence is reported as such rather than
 * searched for.
 */
async function loadLiveReservation(client, requestId, containerId) {
  if (!containerId) return null;
  const { data } = await client.from(RESERVATIONS).select('*')
    .eq('container_id', containerId)
    .is('deleted_at', null);
  return (data || []).find((row) =>
    normalizeId(row.metadata?.logistics_request_id) === normalizeId(requestId)
    && ['REQUESTED', 'APPROVED'].includes(String(row.reservation_status || '').toUpperCase())) || null;
}

/**
 * Capacity is READ from the container authority and never recomputed from a local copy.
 * `computeCapacity` derives used volume from APPROVED reservations only — the invariant T3 was
 * built to protect, and which T4 must not restate in its own words.
 */
async function loadContainerFacts(client, containerId) {
  if (!containerId) return null;
  const { data: container } = await client.from(CONTAINERS).select('*').eq('id', containerId).is('deleted_at', null).maybeSingle();
  if (!container) return null;
  const { data: reservations } = await client.from(RESERVATIONS).select('*').eq('container_id', containerId).is('deleted_at', null);
  const capacity = computeCapacity(container, reservations || []);
  return {
    reference: shortRef('SAIL', container.id),
    origin: { city: stated(container.origin_city), country: stated(container.origin_country) },
    destination: { city: stated(container.destination_city), country: stated(container.destination_country) },
    departure_date: stated(container.departure_date),
    booking_deadline: stated(container.booking_deadline),
    container_type: stated(container.container_type),
    capacity: {
      total_cbm: capacity.totalVolume,
      used_cbm: capacity.usedVolume,
      available_cbm: capacity.availableVolume,
    },
  };
}

/** Documents, from the document authority only. Never a storage path, never a URL. */
async function loadDocuments(client, importOrderId) {
  if (!importOrderId) {
    // A pure logistics-origin transaction has no document anchor yet — that belongs to T8. Saying
    // "no documents" here would be a claim we cannot support; saying so explicitly is the truth.
    return { authority_available: false, records: [], note: 'No document record is connected to this transaction yet.' };
  }
  const { data } = await client.from(TRADE_DOCUMENTS).select('id, document_type, verification_status, created_at')
    .eq('import_order_id', importOrderId).is('deleted_at', null);
  return {
    authority_available: true,
    records: (data || []).map((row) => ({
      id: row.id,
      document_type: stated(row.document_type),
      verification_status: stated(row.verification_status),
      recorded_at: stated(row.created_at),
    })),
  };
}

/** The canonical conversation entry point. T4 opens no second messaging system (§11). */
function conversationEntry(kind, anchorId) {
  return {
    workflow: 'marketplace',
    subject_type: kind === 'logistics' ? 'diaspora_logistics_request' : 'diaspora_rfq',
    subject_anchor_id: anchorId,
    note: 'Messages stay in the transaction conversation CarUp already governs; T4 adds no second inbox.',
  };
}

// ─────────────────────────── LOGISTICS-ORIGIN ────────────────────────────

async function projectLogisticsTransaction(client, request, context) {
  const requestId = request.id;
  const [itemsRes, quotesRes] = await Promise.all([
    client.from(REQUEST_ITEMS).select('*').eq('logistics_request_id', requestId).is('deleted_at', null).order('line_number', { ascending: true }),
    client.from(QUOTES).select('*').eq('logistics_request_id', requestId).is('deleted_at', null),
  ]);
  const items = itemsRes.data || [];
  const allQuotes = quotesRes.data || [];

  const isRequester = [request.requester_id, request.created_by].some((c) => normalizeId(c) === context.id);
  const acceptedQuote = allQuotes.find((q) => normalizeId(q.id) === normalizeId(request.accepted_quote_id)) || null;
  const isAwardedProvider = Boolean(acceptedQuote && normalizeId(acceptedQuote.provider_id) === context.id);
  const privileged = isPrivileged(context);

  if (!isRequester && !isAwardedProvider && !privileged) {
    throw new ForbiddenError('You do not have access to this transaction');
  }
  const viewer = isRequester ? 'requester' : isAwardedProvider ? 'provider' : 'privileged';

  // DRAFT offers are the provider's own until submitted (T3 privacy, preserved).
  const visibleQuotes = (isRequester || privileged)
    ? allQuotes.filter((q) => REQUESTER_VISIBLE_QUOTE_STATUSES.includes(String(q.status || '').toUpperCase()))
    : allQuotes.filter((q) => normalizeId(q.provider_id) === context.id);

  const containerId = acceptedQuote?.compatible_container_id || null;
  const reservation = await loadLiveReservation(client, requestId, containerId);
  const container = await loadContainerFacts(client, containerId);

  const { stage, evidence } = deriveTransactionStage({
    status: request.status,
    visibleOfferCount: visibleQuotes.length,
    hasAcceptedOffer: Boolean(request.accepted_quote_id),
    reservationStatus: reservation?.reservation_status || null,
  });

  return {
    kind: 'logistics',
    viewer_role: viewer,
    identity: {
      reference: shortRef('SHIP', requestId),
      anchor_id: requestId,
      context: 'Moving goods you already own',
      stage,
      stage_evidence: evidence,
      origin: { city: stated(request.origin_city), country: stated(request.origin_country) },
      destination: { city: stated(request.destination_city), country: stated(request.destination_country) },
      // The continuation edge, stated only when it exists. NULL is the normal case.
      continued_from_order: request.import_order_id
        ? { reference: shortRef('ORD', request.import_order_id), anchor_id: request.import_order_id }
        : null,
    },
    // A provider never learns who asked; that is T3's contract and it does not lapse here.
    participants: {
      requester: (isRequester || privileged)
        ? { user_id: request.requester_id, role: 'Shipper' }
        : { user_id: null, role: 'Shipper', withheld: true },
      provider: acceptedQuote ? { user_id: acceptedQuote.provider_id, role: 'Logistics provider' } : null,
    },
    commercial: acceptedQuote ? {
      quote_reference: shortRef('OFR', acceptedQuote.id),
      total_amount: stated(acceptedQuote.total_amount),
      currency: stated(acceptedQuote.currency),
      service_mode: stated(acceptedQuote.service_mode),
      valid_until: stated(acceptedQuote.valid_until),
      agreed_at: stated(request.updated_at),
    } : null,
    offers_visible: visibleQuotes.length,
    cargo: items.map((item) => ({
      line_number: item.line_number,
      description: stated(item.description),
      quantity: stated(item.quantity),
      estimated_volume_cbm: stated(item.estimated_volume_cbm),
      estimated_weight_kg: stated(item.estimated_weight_kg),
      measurement_basis: item.measurement_basis || 'UNKNOWN',
      // VIN is private vehicle identity and never crosses to a provider.
      has_linked_vehicle: Boolean(item.linked_vehicle_vin),
      linked_vehicle_vin: (isRequester || privileged) ? stated(item.linked_vehicle_vin) : undefined,
    })),
    booking: {
      sailing: container,
      reservation: reservation ? {
        reference: shortRef('RES', reservation.id),
        state: reservation.reservation_status,
        reserved_cbm: stated(reservation.estimated_volume),
        // Stated explicitly, because this is the distinction the whole product rests on.
        consumes_capacity: reservation.reservation_status === 'APPROVED',
      } : null,
    },
    documents: await loadDocuments(client, request.import_order_id || null),
    lifecycle: buildLifecycleRail(stage),
    communications: conversationEntry('logistics', requestId),
  };
}

// ────────────────────────── PROCUREMENT-ORIGIN ───────────────────────────

async function projectProcurementTransaction(client, order, context) {
  const orderId = order.id;
  const [participantsRes, quotesRes, continuationRes] = await Promise.all([
    client.from(ORDER_PARTICIPANTS).select('*').eq('import_order_id', orderId),
    client.from(ORDER_QUOTES).select('*').eq('import_order_id', orderId).is('deleted_at', null),
    client.from(REQUESTS).select('id, status, accepted_quote_id').eq('import_order_id', orderId).is('deleted_at', null),
  ]);
  const participants = participantsRes.data || [];
  assertCanReadImportOrder(order, participants, context);

  const quotes = quotesRes.data || [];
  const acceptedQuote = quotes.find((q) => String(q.status || '').toUpperCase() === 'ACCEPTED') || null;
  const continuation = (continuationRes.data || []).find((r) => !['CANCELLED', 'CLOSED'].includes(String(r.status || '').toUpperCase())) || null;

  // A procurement transaction's shipping position comes from its continuation, if one exists.
  let reservation = null;
  if (continuation?.accepted_quote_id) {
    const { data: lq } = await client.from(QUOTES).select('compatible_container_id')
      .eq('id', continuation.accepted_quote_id).is('deleted_at', null).maybeSingle();
    reservation = await loadLiveReservation(client, continuation.id, lq?.compatible_container_id || null);
  }

  const { stage, evidence } = deriveTransactionStage({
    status: order.status,
    visibleOfferCount: quotes.length,
    hasAcceptedOffer: Boolean(acceptedQuote),
    reservationStatus: reservation?.reservation_status || null,
  });

  return {
    kind: 'procurement',
    viewer_role: isPrivileged(context) ? 'privileged' : normalizeId(order.buyer_id) === context.id ? 'buyer' : 'participant',
    identity: {
      reference: shortRef('ORD', orderId),
      anchor_id: orderId,
      context: 'Buying and importing a vehicle',
      stage,
      stage_evidence: evidence,
      origin: { city: null, country: stated(order.origin_country) },
      destination: { city: null, country: stated(order.destination_country) },
      // Whether shipping has been arranged for this purchase — the T4 edge, read not copied.
      shipping_continuation: continuation
        ? { reference: shortRef('SHIP', continuation.id), anchor_id: continuation.id, status: continuation.status }
        : null,
    },
    participants: {
      buyer: { user_id: order.buyer_id, role: 'Buyer' },
      supplier: acceptedQuote ? { user_id: acceptedQuote.seller_id, role: 'Supplier' } : null,
      others: participants.map((p) => ({ user_id: p.user_id, role: stated(p.participant_role), verification: stated(p.verification_status) })),
    },
    commercial: acceptedQuote ? {
      quote_reference: shortRef('QTE', acceptedQuote.id),
      total_amount: stated(acceptedQuote.quote_amount),
      currency: stated(acceptedQuote.quote_currency),
      stock_item_id: stated(acceptedQuote.stock_item_id),
      agreed_at: stated(acceptedQuote.updated_at || acceptedQuote.created_at),
    } : null,
    offers_visible: quotes.length,
    booking: continuation ? {
      reservation: reservation ? {
        reference: shortRef('RES', reservation.id),
        state: reservation.reservation_status,
        reserved_cbm: stated(reservation.estimated_volume),
        consumes_capacity: reservation.reservation_status === 'APPROVED',
      } : null,
    } : null,
    documents: await loadDocuments(client, orderId),
    lifecycle: buildLifecycleRail(stage, { procurement: true }),
    communications: conversationEntry('procurement', orderId),
  };
}

// ────────────────────────────── ENTRY POINT ──────────────────────────────

export async function getTransactionPassport({ kind, id } = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!TRANSACTION_KINDS.includes(kind)) throw new ValidationError('Unknown transaction kind');
  if (!id) throw new ValidationError('A transaction id is required');
  const client = await resolveClient(options);

  if (kind === 'logistics') {
    const { data: request } = await client.from(REQUESTS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
    if (!request) throw new NotFoundError('Transaction not found');
    return projectLogisticsTransaction(client, request, context);
  }

  const { data: order } = await client.from(ORDERS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!order) throw new NotFoundError('Transaction not found');
  return projectProcurementTransaction(client, order, context);
}

// ─────────────────── PROCUREMENT → LOGISTICS CONTINUATION ────────────────

/** Postgres unique-violation. The loser of a genuine race, not a programming error. */
const UNIQUE_VIOLATION = '23505';

/**
 * Continue an awarded purchase into shipping — WITHOUT asking the buyer to retype what CarUp
 * already knows (§8).
 *
 * The route and the purchased vehicle come straight from the order, so the buyer never faces a
 * blank shipping form after selecting a supplier. What CarUp genuinely does not know — the crate
 * dimensions, the real weight — stays UNKNOWN rather than being invented: `measurement_basis` is
 * 'UNKNOWN' and the volume is null, exactly as if the buyer had said "I don't know yet". T3 then
 * refuses to request container space until a real volume exists, which is the correct behaviour
 * and must not be papered over here with a plausible-looking default.
 *
 * Idempotency (§9) is enforced by the DATABASE. Two concurrent clicks both attempt the insert;
 * the partial unique index lets exactly one through and the loser receives 23505, which is
 * translated into a replay of the winner rather than an error. A disabled button is not a
 * concurrency control.
 */
export async function continueToLogistics(importOrderId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const { data: order } = await client.from(ORDERS).select('*').eq('id', importOrderId).is('deleted_at', null).maybeSingle();
  if (!order) throw new NotFoundError('Import order not found');

  const { data: participants } = await client.from(ORDER_PARTICIPANTS).select('*').eq('import_order_id', importOrderId);
  assertCanReadImportOrder(order, participants || [], context);
  if (normalizeId(order.buyer_id) !== context.id && !isPrivileged(context)) {
    throw new ForbiddenError('Only the buyer can arrange shipping for this order');
  }

  // You can only ship what you have actually bought. An order with no accepted supplier offer has
  // nothing to move, and manufacturing a shipping request for it would fake a commercial position.
  const { data: quotes } = await client.from(ORDER_QUOTES).select('*')
    .eq('import_order_id', importOrderId).is('deleted_at', null);
  const accepted = (quotes || []).find((q) => String(q.status || '').toUpperCase() === 'ACCEPTED');
  if (!accepted) throw new ValidationError('Accept a supplier offer before arranging shipping for this order');

  const live = await findLiveContinuation(client, importOrderId);
  if (live) return { request: live, idempotentReplay: true };

  const vin = order.vin || order.linked_vehicle_vin || null;
  const describedVehicle = [order.requested_make, order.requested_model].filter(Boolean).join(' ').trim();

  const row = {
    tenant_id: order.tenant_id || context.tenantId || null,
    requester_id: context.id,
    import_order_id: importOrderId,
    origin_country: order.origin_country,
    origin_city: order.origin_city || null,
    destination_country: order.destination_country,
    destination_city: order.destination_city || null,
    service_preference: 'flexible',
    status: 'DRAFT',
    metadata: { continued_from_import_order_id: importOrderId },
    created_by: context.id,
    updated_by: context.id,
  };

  let created;
  try {
    const { data, error } = await client.from(REQUESTS).insert(row).select().single();
    if (error) throw error;
    created = data;
  } catch (error) {
    if (error?.code === UNIQUE_VIOLATION) {
      const winner = await findLiveContinuation(client, importOrderId);
      if (winner) return { request: winner, idempotentReplay: true };
    }
    throw new ValidationError(`Could not start shipping for this order: ${error?.message || 'unknown error'}`);
  }

  // The purchased vehicle becomes the cargo line. Measurements stay UNKNOWN — see the header.
  await client.from(REQUEST_ITEMS).insert({
    logistics_request_id: created.id,
    line_number: 1,
    cargo_category: 'VEHICLE',
    description: describedVehicle || 'Vehicle purchased through CarUp',
    quantity: 1,
    measurement_basis: 'UNKNOWN',
    linked_vehicle_vin: vin,
    metadata: { prefilled_from_import_order_id: importOrderId },
    created_by: context.id,
    updated_by: context.id,
  });

  return { request: created, idempotentReplay: false };
}

/** The one live shipping continuation for an order, if any. Mirrors the partial unique index. */
async function findLiveContinuation(client, importOrderId) {
  const { data } = await client.from(REQUESTS).select('*')
    .eq('import_order_id', importOrderId).is('deleted_at', null);
  return (data || []).find((r) => !['CANCELLED', 'CLOSED'].includes(String(r.status || '').toUpperCase())) || null;
}
