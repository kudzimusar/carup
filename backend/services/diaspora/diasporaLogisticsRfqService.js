/**
 * Trade OS T3 — Logistics RFQ / “Ship something”.
 *
 * This domain is intentionally separate from procurement RFQs. A logistics request means the
 * requester already owns/bought the cargo and is asking qualified logistics businesses how to move
 * it. It is also separate from a cargo reservation: a reservation exists only after a provider has
 * offered a real sailing and the requester chooses to request that space.
 *
 * Security model:
 * - private request rows are requester-only (plus trusted platform review roles);
 * - cross-tenant provider discovery returns an explicit allow-list projection, never the row;
 * - provider eligibility is derived from the caller's registration profile, not a spoofable role;
 * - linked vehicle VINs use the canonical vehicle-object authority before any item write;
 * - a provider may link only a container they actually coordinate / tenant-administer;
 * - award is one atomic PostgreSQL transaction.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from './diasporaAuthorization.js';
import { resolveClient, appendAudit, appendCriticalAudit, paging } from './diasporaServiceUtils.js';
import { normalizeLogisticsIntake, normalizeCargoIntake } from './tradeIntakeNormalizer.js';
import { MARKETPLACE_SAFE_CARGO_FIELDS, MARKETPLACE_SAFE_LOGISTICS_FIELDS } from './tradeIntakeContract.js';
import { resolveVehicleObjectAuthority } from '../../middleware/vehicleObjectAuthority.js';
import { requestReservation, computeCapacity } from './diasporaContainerMarketplaceService.js';
// T3: best-effort canonical Communications events AFTER the audited mutation. Never authoritative.
import {
  notifyLogisticsQuoteSubmitted,
  notifyLogisticsQuoteAccepted,
  notifyLogisticsQuoteNotSelected,
} from './logisticsLifecycleNotifier.js';

const REQUESTS = 'diaspora_logistics_requests';
const ITEMS = 'diaspora_logistics_request_items';
const QUOTES = 'diaspora_logistics_quotes';
const CONTAINERS = 'diaspora_container_shipments';
const RESERVATIONS = 'diaspora_cargo_reservations';
const ACCEPT_RPC = 'diaspora_accept_logistics_quote_atomic';

const REQUEST_STATUSES = new Set(['DRAFT', 'OPEN_FOR_QUOTES', 'AWARDED', 'CLOSED', 'CANCELLED']);
const CARGO_CATEGORIES = new Set([
  'vehicle', 'parts', 'household', 'furniture_appliances', 'boxes',
  'machinery_equipment', 'pallet_crate', 'general', 'other',
]);
const SERVICE_PREFERENCES = new Set(['flexible', 'port_to_port', 'door_to_port', 'port_to_door', 'door_to_door']);
const SERVICE_MODES = new Set(['shared_container', 'lcl', 'fcl', 'road', 'multimodal', 'other']);

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function cleanText(value, max = 1000) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumber(value) {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 30);
}

function normalizeOptionalServices(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((item) => {
    if (typeof item === 'string') return { label: cleanText(item, 200), amount: null };
    return {
      label: cleanText(item?.label, 200),
      amount: nonNegativeNumber(item?.amount),
    };
  }).filter((item) => item.label);
}

function requestReference(id) {
  return `SHIP-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function quoteReference(id) {
  return `LQ-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function isPrivileged(context) {
  return isPlatformAdmin(context) || isPlatformReviewer(context);
}

function ownsRequest(request, context) {
  return [request.requester_id, request.created_by].some((candidate) => normalizeId(candidate) === context.id);
}

async function loadRequest(client, requestId) {
  const { data, error } = await client.from(REQUESTS).select('*').eq('id', requestId).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Shipping request not found');
  return data;
}

async function loadItems(client, requestIds) {
  const ids = [...new Set((Array.isArray(requestIds) ? requestIds : [requestIds]).filter(Boolean))];
  const byRequest = new Map();
  if (!ids.length) return byRequest;
  const { data, error } = await client.from(ITEMS).select('*').in('logistics_request_id', ids).is('deleted_at', null);
  if (error) throw new ValidationError(`Could not load cargo items: ${error.message}`);
  for (const item of data || []) {
    if (!byRequest.has(item.logistics_request_id)) byRequest.set(item.logistics_request_id, []);
    byRequest.get(item.logistics_request_id).push(item);
  }
  for (const list of byRequest.values()) list.sort((a, b) => Number(a.line_number || 0) - Number(b.line_number || 0));
  return byRequest;
}

function assertCanReadRequest(request, context) {
  if (!ownsRequest(request, context) && !isPrivileged(context)) {
    throw new ForbiddenError('You do not have access to this shipping request');
  }
}

/**
 * A logistics provider is a commercial context, not a global platform role. The provider-side
 * marketplace is therefore earned from the canonical signup/business profile. Platform reviewers
 * may inspect it for governance but are not presented as logistics businesses in customer UI.
 */
export async function resolveLogisticsProviderContext(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  if (isPrivileged(context)) return { context, profile: null, privileged: true };

  const { data: profile, error } = await client
    .from('user_registration_profiles')
    .select('user_id, account_kind, business_type, organization_name, country_of_residence, city')
    .eq('user_id', context.id)
    .maybeSingle();
  if (error) throw new ForbiddenError('Logistics provider eligibility could not be established');
  if (!profile || profile.business_type !== 'logistics_provider') {
    throw new ForbiddenError('A logistics-provider business profile is required to quote shipping requests');
  }
  return { context, profile, privileged: false };
}

function normalizeRequestPayload(payload = {}, previous = {}) {
  const originCountry = cleanText(payload.origin_country ?? payload.originCountry ?? previous.origin_country, 100);
  const destinationCountry = cleanText(payload.destination_country ?? payload.destinationCountry ?? previous.destination_country, 100);
  if (!originCountry) throw new ValidationError('Where the cargo is now (origin country) is required');
  if (!destinationCountry) throw new ValidationError('Destination country is required');

  const preference = String(payload.service_preference ?? payload.servicePreference ?? previous.service_preference ?? 'flexible').toLowerCase();
  if (!SERVICE_PREFERENCES.has(preference)) throw new ValidationError('Unsupported shipping service preference');

  return {
    // Intake 2.0 (contract §36) — validated columns, never a metadata blob.
    ...normalizeLogisticsIntake(payload, previous),
    origin_country: originCountry,
    origin_city: cleanText(payload.origin_city ?? payload.originCity ?? previous.origin_city, 150),
    origin_location: cleanText(payload.origin_location ?? payload.originLocation ?? previous.origin_location, 300),
    destination_country: destinationCountry,
    destination_city: cleanText(payload.destination_city ?? payload.destinationCity ?? previous.destination_city, 150),
    destination_location: cleanText(payload.destination_location ?? payload.destinationLocation ?? previous.destination_location, 300),
    needed_by: payload.needed_by ?? payload.neededBy ?? previous.needed_by ?? null,
    service_preference: preference,
  };
}

function normalizeItem(raw = {}, index = 0) {
  const category = String(raw.cargo_category ?? raw.cargoCategory ?? 'other').toLowerCase();
  if (!CARGO_CATEGORIES.has(category)) throw new ValidationError(`Cargo item ${index + 1} has an unsupported category`);
  const description = cleanText(raw.description, 700);
  if (!description) throw new ValidationError(`Cargo item ${index + 1} needs a plain-language description`);
  const quantity = Math.max(1, Math.round(positiveNumber(raw.quantity) || 1));

  const unitRaw = String(raw.dimension_unit ?? raw.dimensionUnit ?? '').toLowerCase();
  const dimensionUnit = unitRaw === 'cm' || unitRaw === 'm' ? unitRaw : null;
  const lengthValue = positiveNumber(raw.length_value ?? raw.length);
  const widthValue = positiveNumber(raw.width_value ?? raw.width);
  const heightValue = positiveNumber(raw.height_value ?? raw.height);
  const providedVolume = positiveNumber(raw.estimated_volume_cbm ?? raw.estimatedVolumeCbm);
  let estimatedVolume = null;
  let measurementBasis = 'UNKNOWN';

  if (lengthValue && widthValue && heightValue && dimensionUnit) {
    const divisor = dimensionUnit === 'cm' ? 100 : 1;
    estimatedVolume = round3((lengthValue / divisor) * (widthValue / divisor) * (heightValue / divisor) * quantity);
    measurementBasis = 'CALCULATED';
  } else if (providedVolume) {
    estimatedVolume = round3(providedVolume);
    measurementBasis = 'PROVIDED';
  }

  // The column CHECK admits NULL or > 0, and round3 floors anything under 0.0005 m³ to exactly 0 —
  // which the insert would then reject AFTER the update path has already deleted the previous
  // items. Refuse it here, before any write, with advice a layman can act on.
  if (estimatedVolume !== null && !(estimatedVolume > 0)) {
    throw new ValidationError(
      `Cargo item ${index + 1}'s measurements round to 0.000 CBM — check the unit (cm vs m), or use "I know the total volume" with the group's combined volume`);
  }

  return {
    // Intake 2.0 — handling characteristics and content DISCLOSURES. A declaration records what the
    // customer says is in the box so a provider can decide; it establishes no carrier eligibility.
    ...normalizeCargoIntake(raw),
    cargo_category: category,
    description,
    quantity,
    length_value: lengthValue,
    width_value: widthValue,
    height_value: heightValue,
    dimension_unit: dimensionUnit,
    estimated_volume_cbm: estimatedVolume,
    estimated_weight_kg: positiveNumber(raw.estimated_weight_kg ?? raw.estimatedWeightKg),
    measurement_basis: measurementBasis,
    linked_vehicle_vin: cleanText(raw.linked_vehicle_vin ?? raw.linkedVehicleVin, 80),
    notes: cleanText(raw.notes, 1000),
  };
}

/** Replace all items on a DRAFT request after authorizing every linked VIN first. */
export async function replaceLogisticsRequestItems(client, request, rawItems, context) {
  if (!Array.isArray(rawItems)) return (await loadItems(client, [request.id])).get(request.id) || [];
  if (request.status !== 'DRAFT') throw new ValidationError('Cargo details cannot be changed after the shipping request is published');
  if (!rawItems.length) throw new ValidationError('Add at least one cargo item');
  if (rawItems.length > 50) throw new ValidationError('A shipping request can contain at most 50 cargo item groups');

  const normalized = rawItems.map(normalizeItem);
  // Authorize ALL links before delete/insert so one forged VIN cannot leave a partial replacement.
  for (const item of normalized) {
    if (!item.linked_vehicle_vin) continue;
    const authority = await resolveVehicleObjectAuthority(item.linked_vehicle_vin, context);
    if (authority.allowed) continue;
    if (authority.reason === 'not_found') throw new NotFoundError('Linked vehicle is not on record');
    throw new ForbiddenError('You are not authorized to link that vehicle to this shipping request');
  }

  const { error: deleteError } = await client.from(ITEMS).delete().eq('logistics_request_id', request.id);
  if (deleteError) throw new ValidationError(`Could not replace cargo items: ${deleteError.message}`);

  const rows = normalized.map((item, index) => ({
    logistics_request_id: request.id,
    line_number: index + 1,
    ...item,
    metadata: {},
    created_by: context.id,
    updated_by: context.id,
  }));
  const { data, error } = await client.from(ITEMS).insert(rows).select();
  if (error) throw new ValidationError(`Could not save cargo items: ${error.message}`);
  return data || [];
}

export async function createLogisticsRequest(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const requestFields = normalizeRequestPayload(payload);
  const row = {
    tenant_id: context.tenantId || null,
    requester_id: context.id,
    ...requestFields,
    status: 'DRAFT',
    metadata: {},
    created_by: context.id,
    updated_by: context.id,
  };
  const { data, error } = await client.from(REQUESTS).insert(row).select().single();
  if (error) throw new ValidationError(`Could not create shipping request: ${error.message}`);
  const items = await replaceLogisticsRequestItems(client, data, payload.items, context);
  await appendAudit(client, {
    actorId: context.id, tenantId: data.tenant_id, action: 'LOGISTICS_REQUEST_CREATED',
    resourceType: 'diaspora_logistics_request', resourceId: data.id, newState: data, req: options.req,
  });
  return { ...data, items, reference: requestReference(data.id) };
}

export async function updateLogisticsRequest(requestId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const previous = await loadRequest(client, requestId);
  assertCanReadRequest(previous, context);
  if (previous.status !== 'DRAFT') throw new ValidationError('Only a draft shipping request can be edited');

  const update = {
    ...normalizeRequestPayload(payload, previous),
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from(REQUESTS).update(update).eq('id', requestId).select().single();
  if (error) throw new ValidationError(`Could not update shipping request: ${error.message}`);
  const items = await replaceLogisticsRequestItems(client, data, payload.items, context);
  await appendAudit(client, {
    actorId: context.id, tenantId: data.tenant_id, action: 'LOGISTICS_REQUEST_UPDATED',
    resourceType: 'diaspora_logistics_request', resourceId: data.id,
    previousState: previous, newState: data, req: options.req,
  });
  return { ...data, items, reference: requestReference(data.id) };
}

export async function publishLogisticsRequest(requestId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const previous = await loadRequest(client, requestId);
  assertCanReadRequest(previous, context);
  if (previous.status === 'OPEN_FOR_QUOTES') return { ...previous, reference: requestReference(previous.id) };
  if (previous.status !== 'DRAFT') throw new ValidationError('Only a draft shipping request can be published');
  const items = (await loadItems(client, [requestId])).get(requestId) || [];
  if (!items.length) throw new ValidationError('Add at least one cargo item before publishing');

  const { data, error } = await client.from(REQUESTS).update({
    status: 'OPEN_FOR_QUOTES', updated_by: context.id, updated_at: new Date().toISOString(),
  }).eq('id', requestId).select().single();
  if (error) throw new ValidationError(`Could not publish shipping request: ${error.message}`);
  await appendCriticalAudit(client, {
    actorId: context.id, tenantId: data.tenant_id, action: 'LOGISTICS_REQUEST_PUBLISHED',
    resourceType: 'diaspora_logistics_request', resourceId: data.id,
    previousState: previous, newState: data, req: options.req,
  });
  return { ...data, items, reference: requestReference(data.id) };
}

export async function listMyLogisticsRequests(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);
  // Ownership and paging belong in the QUERY, not in JavaScript. The previous shape selected every
  // live row platform-wide and filtered/sliced in JS, which (a) read the whole cross-tenant table
  // to serve one requester and (b) let PostgREST's response cap silently hide a user's own rows
  // once the table outgrew it — truncation before the ownership filter is data loss, not paging.
  // requester_id is NOT NULL and always the creator, so the equality filter is the ownership rule.
  let query = client.from(REQUESTS).select('*').is('deleted_at', null);
  if (!isPrivileged(context)) query = query.eq('requester_id', context.id);
  if (filters.status && REQUEST_STATUSES.has(String(filters.status).toUpperCase())) {
    query = query.eq('status', String(filters.status).toUpperCase());
  }
  const { data, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new ValidationError(`Could not list shipping requests: ${error.message}`);
  const rows = (data || []).filter((row) => ownsRequest(row, context) || isPrivileged(context));
  const [itemsByRequest, offerCounts] = await Promise.all([
    loadItems(client, rows.map((row) => row.id)),
    countVisibleOffers(client, rows.map((row) => row.id)),
  ]);
  return rows.map((row) => ({
    ...row,
    reference: requestReference(row.id),
    items: itemsByRequest.get(row.id) || [],
    // A customer whose request has an offer waiting must be able to see that from the list. The
    // count uses EXACTLY the rule the detail screen uses to build its offer list, so the badge can
    // never contradict the page it links to — and a provider's DRAFT is not an offer to anyone.
    //
    // When the count could not be READ, the field is omitted entirely rather than sent as 0.
    // DESIGN.md §8.1: unknown is not zero, and "no offers yet" is a claim we must have earned.
    ...(offerCounts ? { offer_count: offerCounts.get(row.id) || 0 } : {}),
  }));
}

/**
 * Offers the requester can actually act on, per request id.
 *
 * DRAFT is excluded because a draft is the provider's private working copy — counting it would
 * announce an offer that the customer cannot see and the provider has not made. WITHDRAWN is
 * excluded because it has been taken back. Everything else is a real, comparable offer.
 *
 * Returns NULL — never an empty map — when the read fails, so an unreadable count is distinguishable
 * from a genuine absence of offers.
 */
async function countVisibleOffers(client, requestIds) {
  const counts = new Map();
  if (!requestIds.length) return counts;
  const { data, error } = await client.from(QUOTES)
    .select('logistics_request_id, status')
    .in('logistics_request_id', requestIds)
    .is('deleted_at', null);
  // A failed count must not silently become zero — unknown is not none. NULL means "unreadable",
  // and the caller omits the field entirely so the UI can stay silent instead of claiming none.
  if (error) return null;
  for (const quote of data || []) {
    if (quote.status === 'DRAFT' || quote.status === 'WITHDRAWN') continue;
    const key = quote.logistics_request_id;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function attachProviderIdentities(client, quotes) {
  const visible = (quotes || []).filter((quote) => quote.status !== 'DRAFT');
  const providerIds = [...new Set(visible.map((quote) => quote.provider_id).filter(Boolean))];
  if (!providerIds.length) return quotes;
  const [usersRes, profilesRes] = await Promise.all([
    client.from('users').select('id, name').in('id', providerIds),
    client.from('user_registration_profiles').select('user_id, organization_name, business_type, account_kind, country_of_residence, city').in('user_id', providerIds),
  ]);
  const userById = new Map((usersRes.data || []).map((user) => [normalizeId(user.id), user]));
  const profileById = new Map((profilesRes.data || []).map((profile) => [normalizeId(profile.user_id), profile]));
  return (quotes || []).map((quote) => {
    if (quote.status === 'DRAFT') return quote;
    const user = userById.get(normalizeId(quote.provider_id));
    const profile = profileById.get(normalizeId(quote.provider_id));
    return {
      ...quote,
      reference: quoteReference(quote.id),
      provider: {
        display_name: profile?.organization_name || user?.name || 'Logistics provider',
        business_type: profile?.business_type || null,
        country: profile?.country_of_residence || null,
        city: profile?.city || null,
        verified: false,
      },
    };
  });
}

export async function getMyLogisticsRequest(requestId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  assertCanReadRequest(request, context);
  const [itemsByRequest, quotesRes] = await Promise.all([
    loadItems(client, [requestId]),
    client.from(QUOTES).select('*').eq('logistics_request_id', requestId).is('deleted_at', null).order('created_at', { ascending: true }),
  ]);
  if (quotesRes.error) throw new ValidationError(`Could not load shipping offers: ${quotesRes.error.message}`);
  return {
    ...request,
    reference: requestReference(request.id),
    items: itemsByRequest.get(requestId) || [],
    quotes: await attachProviderIdentities(client, quotesRes.data || []),
  };
}

/** Explicit allow-list marketplace projection. No requester id, tenant id or contact facts cross. */
export function projectLogisticsRequestForMarketplace(request = {}, items = [], extra = {}) {
  return {
    id: request.id,
    reference: requestReference(request.id),
    origin_country: request.origin_country || null,
    origin_city: request.origin_city || null,
    destination_country: request.destination_country || null,
    destination_city: request.destination_city || null,
    needed_by: request.needed_by || null,
    service_preference: request.service_preference || 'flexible',
    // Intake 2.0 — the request-level facts that decide what the quote must cover. Allow-listed
    // for the same reason as the cargo rows: a new column stays invisible until it is named here.
    ...Object.fromEntries(MARKETPLACE_SAFE_LOGISTICS_FIELDS
      .map((field) => [field, request[field]])
      .filter(([, value]) => value !== undefined && value !== null)),
    items: (items || []).map((item) => ({
      id: item.id,
      line_number: item.line_number,
      cargo_category: item.cargo_category,
      description: item.description,
      quantity: item.quantity,
      estimated_volume_cbm: item.estimated_volume_cbm ?? null,
      estimated_weight_kg: item.estimated_weight_kg ?? null,
      measurement_basis: item.measurement_basis || 'UNKNOWN',
      // A VIN is private vehicle identity. Providers get the cargo description/category, never VIN.
      has_linked_vehicle: Boolean(item.linked_vehicle_vin),
      // Intake 2.0 — handling characteristics and content disclosures a provider needs to decide
      // whether they can carry it. Allow-listed: `declared_value` is deliberately NOT here (cargo
      // value is commercial, and useful to a thief), nor is export clearance state, which is
      // operational readiness released to an engaged counterparty rather than to a browser.
      ...Object.fromEntries(MARKETPLACE_SAFE_CARGO_FIELDS
        .map((field) => [field, item[field]])
        .filter(([, value]) => value !== undefined && value !== null)),
    })),
    ...extra,
  };
}

export async function listLogisticsOpportunities(filters = {}, userContext = {}, options = {}) {
  const { context } = await resolveLogisticsProviderContext(userContext, options);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);
  const { data, error } = await client.from(REQUESTS).select('*').eq('status', 'OPEN_FOR_QUOTES').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw new ValidationError(`Could not list shipping opportunities: ${error.message}`);
  let rows = (data || []).filter((request) => normalizeId(request.requester_id) !== context.id);
  if (filters.origin_country) rows = rows.filter((row) => String(row.origin_country || '').toLowerCase() === String(filters.origin_country).toLowerCase());
  if (filters.destination_country) rows = rows.filter((row) => String(row.destination_country || '').toLowerCase() === String(filters.destination_country).toLowerCase());
  rows = rows.slice(offset, offset + limit);
  const itemsByRequest = await loadItems(client, rows.map((row) => row.id));
  const quoteCounts = new Map();
  if (rows.length) {
    const { data: quoteRows } = await client.from(QUOTES).select('logistics_request_id, status').in('logistics_request_id', rows.map((row) => row.id)).is('deleted_at', null);
    for (const quote of quoteRows || []) {
      if (quote.status !== 'SUBMITTED') continue;
      quoteCounts.set(quote.logistics_request_id, (quoteCounts.get(quote.logistics_request_id) || 0) + 1);
    }
  }
  return rows.map((row) => projectLogisticsRequestForMarketplace(row, itemsByRequest.get(row.id) || [], {
    quote_count: quoteCounts.get(row.id) || 0,
  }));
}

export async function getLogisticsOpportunity(requestId, userContext = {}, options = {}) {
  const { context } = await resolveLogisticsProviderContext(userContext, options);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  if (request.status !== 'OPEN_FOR_QUOTES') throw new NotFoundError('Shipping opportunity is not open');
  if (normalizeId(request.requester_id) === context.id) throw new ForbiddenError('Use your own shipping-request workspace to read this request');
  const items = (await loadItems(client, [requestId])).get(requestId) || [];
  return projectLogisticsRequestForMarketplace(request, items);
}

async function assertProviderMayOfferContainer(client, containerId, request, context) {
  if (!containerId) return null;
  const { data: container, error } = await client.from(CONTAINERS).select('*').eq('id', containerId).is('deleted_at', null).single();
  if (error || !container) throw new NotFoundError('Offered container sailing not found');
  const mayOperate = isPrivileged(context)
    || normalizeId(container.coordinator_id) === context.id
    || isTenantAdminForRecord(container, context);
  if (!mayOperate) throw new ForbiddenError('You cannot offer a container operated by another organisation');
  if (container.status !== 'BOOKING_OPEN') throw new ValidationError('The offered container is not accepting bookings');
  if (String(container.origin_country || '').toLowerCase() !== String(request.origin_country || '').toLowerCase()
    || String(container.destination_country || '').toLowerCase() !== String(request.destination_country || '').toLowerCase()) {
    throw new ValidationError('The offered container route does not match this shipping request');
  }
  return container;
}

function normalizeQuotePayload(payload = {}, previous = {}) {
  const mode = String(payload.service_mode ?? payload.serviceMode ?? previous.service_mode ?? 'other').toLowerCase();
  if (!SERVICE_MODES.has(mode)) throw new ValidationError('Unsupported logistics service mode');
  const total = positiveNumber(payload.total_amount ?? payload.totalAmount ?? previous.total_amount);
  if (!total) throw new ValidationError('Offer total must be a positive amount');
  // "Key present" decides the merge. `??` cannot express "clear this field": a provider who
  // deletes a charge sends null (or the key is absent when a client strips empties), and falling
  // back to the stored value silently resurrects a number the provider removed — wrong terms on
  // the offer they then submit. An absent key still keeps the previous value, so partial PATCHes
  // remain partial.
  const sent = (...keys) => keys.find((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const money = (snake, camel) => {
    const key = sent(snake, camel);
    return key ? nonNegativeNumber(payload[key]) ?? null : previous[snake] ?? null;
  };
  return {
    service_mode: mode,
    freight_amount: money('freight_amount', 'freightAmount'),
    handling_amount: money('handling_amount', 'handlingAmount'),
    origin_charges: money('origin_charges', 'originCharges'),
    destination_charges: money('destination_charges', 'destinationCharges'),
    documentation_fees: money('documentation_fees', 'documentationFees'),
    optional_services: normalizeOptionalServices(payload.optional_services ?? payload.optionalServices ?? previous.optional_services),
    total_amount: total,
    currency: cleanText(payload.currency ?? previous.currency ?? 'USD', 10) || 'USD',
    transit_days: positiveNumber(payload.transit_days ?? payload.transitDays ?? previous.transit_days)
      ? Math.round(positiveNumber(payload.transit_days ?? payload.transitDays ?? previous.transit_days)) : null,
    valid_until: sent('valid_until', 'validUntil') ? (payload[sent('valid_until', 'validUntil')] || null) : (previous.valid_until ?? null),
    pickup_included: typeof (payload.pickup_included ?? payload.pickupIncluded) === 'boolean'
      ? (payload.pickup_included ?? payload.pickupIncluded) : (previous.pickup_included ?? null),
    delivery_included: typeof (payload.delivery_included ?? payload.deliveryIncluded) === 'boolean'
      ? (payload.delivery_included ?? payload.deliveryIncluded) : (previous.delivery_included ?? null),
    inclusions: normalizeStringArray(sent('inclusions') ? payload.inclusions : previous.inclusions),
    exclusions: normalizeStringArray(sent('exclusions') ? payload.exclusions : previous.exclusions),
    conditions: cleanText(sent('conditions') ? payload.conditions : previous.conditions, 2000) || null,
  };
}

export async function createLogisticsQuote(requestId, payload = {}, userContext = {}, options = {}) {
  const { context } = await resolveLogisticsProviderContext(userContext, options);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  if (request.status !== 'OPEN_FOR_QUOTES') throw new ValidationError('This shipping request is not open for offers');
  if (normalizeId(request.requester_id) === context.id) throw new ForbiddenError('You cannot quote your own shipping request');
  const containerId = payload.compatible_container_id ?? payload.compatibleContainerId ?? null;
  await assertProviderMayOfferContainer(client, containerId, request, context);
  const submit = payload.submit === true;
  const row = {
    logistics_request_id: requestId,
    provider_id: context.id,
    provider_tenant_id: context.tenantId || null,
    compatible_container_id: containerId,
    ...normalizeQuotePayload(payload),
    status: submit ? 'SUBMITTED' : 'DRAFT',
    metadata: {},
    created_by: context.id,
    updated_by: context.id,
  };
  const { data, error } = await client.from(QUOTES).insert(row).select().single();
  if (error) throw new ValidationError(`Could not save logistics offer: ${error.message}`);
  const auditFields = {
    actorId: context.id, tenantId: data.provider_tenant_id,
    action: submit ? 'LOGISTICS_QUOTE_SUBMITTED' : 'LOGISTICS_QUOTE_DRAFTED',
    resourceType: 'diaspora_logistics_quote', resourceId: data.id,
    newState: data, metadata: { logisticsRequestId: requestId }, req: options.req,
  };
  if (submit) await appendCriticalAudit(client, auditFields); else await appendAudit(client, auditFields);
  // A DRAFT is private to the provider — only a real submission is news for the requester.
  if (submit) await notifyLogisticsQuoteSubmitted({ request, quote: data, tenantId: request.tenant_id });
  return { ...data, reference: quoteReference(data.id) };
}

async function loadOwnedQuote(client, quoteId, context) {
  const { data, error } = await client.from(QUOTES).select('*').eq('id', quoteId).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Logistics offer not found');
  if (normalizeId(data.provider_id) !== context.id && !isPrivileged(context)) {
    throw new ForbiddenError('You do not have access to this logistics offer');
  }
  return data;
}

export async function updateLogisticsQuote(quoteId, payload = {}, userContext = {}, options = {}) {
  const { context } = await resolveLogisticsProviderContext(userContext, options);
  const client = await resolveClient(options);
  const previous = await loadOwnedQuote(client, quoteId, context);
  if (previous.status !== 'DRAFT') throw new ValidationError('Only a draft logistics offer can be edited');
  const request = await loadRequest(client, previous.logistics_request_id);
  if (request.status !== 'OPEN_FOR_QUOTES') throw new ValidationError('This shipping request is no longer open');
  const containerId = payload.compatible_container_id ?? payload.compatibleContainerId ?? previous.compatible_container_id ?? null;
  await assertProviderMayOfferContainer(client, containerId, request, context);
  const { data, error } = await client.from(QUOTES).update({
    compatible_container_id: containerId,
    ...normalizeQuotePayload(payload, previous),
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  }).eq('id', quoteId).select().single();
  if (error) throw new ValidationError(`Could not update logistics offer: ${error.message}`);
  await appendAudit(client, {
    actorId: context.id, tenantId: data.provider_tenant_id, action: 'LOGISTICS_QUOTE_UPDATED',
    resourceType: 'diaspora_logistics_quote', resourceId: data.id,
    previousState: previous, newState: data, metadata: { logisticsRequestId: data.logistics_request_id }, req: options.req,
  });
  return { ...data, reference: quoteReference(data.id) };
}

export async function submitLogisticsQuote(quoteId, userContext = {}, options = {}) {
  const { context } = await resolveLogisticsProviderContext(userContext, options);
  const client = await resolveClient(options);
  const previous = await loadOwnedQuote(client, quoteId, context);
  if (previous.status !== 'DRAFT') throw new ValidationError('Only a draft logistics offer can be submitted');
  const request = await loadRequest(client, previous.logistics_request_id);
  if (request.status !== 'OPEN_FOR_QUOTES') throw new ValidationError('This shipping request is no longer open');
  const { data, error } = await client.from(QUOTES).update({ status: 'SUBMITTED', updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', quoteId).select().single();
  if (error) throw new ValidationError(`Could not submit logistics offer: ${error.message}`);
  await appendCriticalAudit(client, {
    actorId: context.id, tenantId: data.provider_tenant_id, action: 'LOGISTICS_QUOTE_SUBMITTED',
    resourceType: 'diaspora_logistics_quote', resourceId: data.id,
    previousState: previous, newState: data, metadata: { logisticsRequestId: data.logistics_request_id }, req: options.req,
  });
  await notifyLogisticsQuoteSubmitted({ request, quote: data, tenantId: request.tenant_id });
  return data;
}

export async function withdrawLogisticsQuote(quoteId, userContext = {}, options = {}) {
  const { context } = await resolveLogisticsProviderContext(userContext, options);
  const client = await resolveClient(options);
  const previous = await loadOwnedQuote(client, quoteId, context);
  if (!['DRAFT', 'SUBMITTED'].includes(previous.status)) throw new ValidationError('This logistics offer can no longer be withdrawn');
  const { data, error } = await client.from(QUOTES).update({ status: 'WITHDRAWN', updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', quoteId).select().single();
  if (error) throw new ValidationError(`Could not withdraw logistics offer: ${error.message}`);
  await appendCriticalAudit(client, {
    actorId: context.id, tenantId: data.provider_tenant_id, action: 'LOGISTICS_QUOTE_WITHDRAWN',
    resourceType: 'diaspora_logistics_quote', resourceId: data.id,
    previousState: previous, newState: data, metadata: { logisticsRequestId: data.logistics_request_id }, req: options.req,
  });
  return data;
}

export async function listMyLogisticsQuotes(filters = {}, userContext = {}, options = {}) {
  const { context } = await resolveLogisticsProviderContext(userContext, options);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);
  const { data, error } = await client.from(QUOTES).select('*').eq('provider_id', context.id).is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw new ValidationError(`Could not list your logistics offers: ${error.message}`);
  const quotes = (data || []).slice(offset, offset + limit);
  const requestIds = [...new Set(quotes.map((quote) => quote.logistics_request_id).filter(Boolean))];
  const { data: requestsData } = requestIds.length
    ? await client.from(REQUESTS).select('*').in('id', requestIds).is('deleted_at', null)
    : { data: [] };
  const itemsByRequest = await loadItems(client, requestIds);
  const requestById = new Map((requestsData || []).map((request) => [request.id, request]));
  return quotes.map((quote) => ({
    quote: { ...quote, reference: quoteReference(quote.id) },
    request: requestById.get(quote.logistics_request_id)
      ? projectLogisticsRequestForMarketplace(requestById.get(quote.logistics_request_id), itemsByRequest.get(quote.logistics_request_id) || [])
      : null,
  }));
}

function translateAcceptError(error) {
  const raw = String(error?.message || 'Logistics offer could not be selected');
  const marker = raw.indexOf('DIASPORA_LOGISTICS/');
  const code = marker >= 0 ? raw.slice(marker + 'DIASPORA_LOGISTICS/'.length).split(/[:\s]/)[0] : '';
  switch (code) {
    case 'NOT_FOUND_REQUEST': return new NotFoundError('Shipping request not found');
    case 'NOT_FOUND_QUOTE': return new NotFoundError('Logistics offer not found');
    case 'FORBIDDEN': return new ForbiddenError('Only the requester can select a logistics offer');
    case 'SELF_AWARD': return new ForbiddenError('A logistics provider cannot select its own offer');
    case 'ALREADY_ACCEPTED_DIFFERENT': return new ValidationError('A different logistics offer has already been selected');
    case 'QUOTE_NOT_IN_REQUEST': return new ValidationError('That logistics offer does not belong to this shipping request');
    case 'NOT_SUBMITTED': return new ValidationError('Only a submitted logistics offer can be selected');
    default: return new ValidationError('Logistics offer selection could not be applied');
  }
}

export async function acceptLogisticsQuote(requestId, quoteId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data, error } = await client.rpc(ACCEPT_RPC, {
    p_request_id: requestId,
    p_quote_id: quoteId,
    p_actor_id: context.id,
    p_actor_is_privileged: isPrivileged(context),
  });
  if (error) throw translateAcceptError(error);
  if (!data) throw new ValidationError('Logistics offer selection returned no result');
  // Tell the winner AND the providers who were not selected — silence leaves them chasing a
  // request that is already awarded. Skipped on an idempotent replay so a retry never re-notifies.
  if (!data.idempotentReplay && data.acceptedQuote) {
    const request = data.request || {};
    await notifyLogisticsQuoteAccepted({ request, quote: data.acceptedQuote, tenantId: request.tenant_id });
    const { data: siblings } = await client.from(QUOTES).select('*').eq('logistics_request_id', requestId).is('deleted_at', null);
    await notifyLogisticsQuoteNotSelected({ request, quotes: siblings || [], acceptedQuoteId: data.acceptedQuote.id, acceptedProviderId: data.acceptedQuote.provider_id, tenantId: request.tenant_id });
  }
  return {
    request: data.request,
    acceptedQuote: data.acceptedQuote,
    idempotentReplay: Boolean(data.idempotentReplay),
  };
}

function totalKnownVolume(items) {
  if (!items.length || items.some((item) => !(Number(item.estimated_volume_cbm) > 0))) return null;
  return round3(items.reduce((sum, item) => sum + Number(item.estimated_volume_cbm), 0));
}

function totalKnownWeight(items) {
  if (!items.length || items.some((item) => !(Number(item.estimated_weight_kg) > 0))) return null;
  return round3(items.reduce((sum, item) => sum + Number(item.estimated_weight_kg), 0));
}

/**
 * Confirm missing measurements on a PUBLISHED shipping request.
 *
 * The wizard promises that "container-space booking will wait until every cargo group has an
 * estimated volume" — a deferral, not a dead end. But items are edit-locked at publish (correctly:
 * providers priced what they read), and requestSpaceForAward refuses unknown volume, so an awarded
 * shared-container journey that started from "I don't know yet" had NO way forward: the error told
 * the requester to confirm a volume no surface allowed them to record.
 *
 * This is deliberately NOT request editing. It is fill-only: only items whose volume is still
 * NULL accept one, nothing already stated can be changed, and descriptions/categories/quantities/
 * vehicle links stay frozen exactly as publish froze them. Providers quoted cargo whose size was
 * visibly UNKNOWN; recording the missing estimate before booking is the step the copy promised.
 */
export async function confirmLogisticsItemMeasurements(requestId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  if (!ownsRequest(request, context) && !isPrivileged(context)) {
    throw new ForbiddenError('Only the requester can confirm cargo measurements');
  }
  if (!['OPEN_FOR_QUOTES', 'AWARDED'].includes(request.status)) {
    throw new ValidationError('Measurements can be confirmed only on a published shipping request');
  }
  const entries = Array.isArray(payload.items) ? payload.items : [];
  if (!entries.length) throw new ValidationError('Provide at least one cargo measurement to confirm');

  const itemRows = (await loadItems(client, [requestId])).get(requestId) || [];
  const byId = new Map(itemRows.map((item) => [String(item.id), item]));
  const updates = [];
  for (const entry of entries) {
    const item = byId.get(String(entry.item_id ?? entry.itemId ?? ''));
    if (!item) throw new ValidationError('Unknown cargo item on this shipping request');
    if (item.estimated_volume_cbm != null) {
      throw new ValidationError('This cargo item already has an estimated volume; stated measurements are not editable after publish');
    }
    const volume = round3(positiveNumber(entry.estimated_volume_cbm ?? entry.estimatedVolumeCbm) || 0);
    if (!(volume > 0)) throw new ValidationError('Estimated volume must be a positive number of CBM');
    const weight = positiveNumber(entry.estimated_weight_kg ?? entry.estimatedWeightKg);
    updates.push({
      id: item.id,
      estimated_volume_cbm: volume,
      estimated_weight_kg: weight ?? item.estimated_weight_kg ?? null,
    });
  }

  for (const update of updates) {
    const { error } = await client.from(ITEMS).update({
      estimated_volume_cbm: update.estimated_volume_cbm,
      estimated_weight_kg: update.estimated_weight_kg,
      measurement_basis: 'PROVIDED',
      updated_by: context.id,
      updated_at: new Date().toISOString(),
    }).eq('id', update.id);
    if (error) throw new ValidationError(`Could not record the confirmed measurement: ${error.message}`);
  }

  await appendAudit(client, {
    actorId: context.id, tenantId: request.tenant_id, action: 'LOGISTICS_MEASUREMENTS_CONFIRMED',
    resourceType: 'diaspora_logistics_request', resourceId: requestId,
    newState: { confirmed: updates }, req: options.req,
  });
  return getMyLogisticsRequest(requestId, userContext, options);
}

export async function findCompatibleSailings(requestId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  assertCanReadRequest(request, context);
  const items = (await loadItems(client, [requestId])).get(requestId) || [];
  const requiredVolume = totalKnownVolume(items);
  const { data: containers, error } = await client.from(CONTAINERS).select('*').eq('status', 'BOOKING_OPEN').is('deleted_at', null).order('departure_date', { ascending: true });
  if (error) throw new ValidationError(`Could not find compatible sailings: ${error.message}`);

  // §10.4 names FOUR match conditions; this function owns route, deadline and capacity, and
  // reports that cargo eligibility stays with the organiser. A sailing whose booking cut-off has
  // passed is not bookable, so presenting it as a match would promise something the container
  // product itself refuses. A NULL deadline means "not recorded", which is not "closed".
  const nowMs = Date.now();
  const routeMatches = (containers || []).filter((container) =>
    String(container.origin_country || '').toLowerCase() === String(request.origin_country || '').toLowerCase()
    && String(container.destination_country || '').toLowerCase() === String(request.destination_country || '').toLowerCase()
    && (!container.booking_deadline || Date.parse(container.booking_deadline) >= nowMs));
  if (!routeMatches.length) return [];

  const tenantIds = [...new Set(routeMatches.map((container) => container.tenant_id).filter(Boolean))];
  const { data: tenants } = tenantIds.length
    ? await client.from('tenants').select('id, name').in('id', tenantIds)
    : { data: [] };
  const tenantName = new Map((tenants || []).map((tenant) => [normalizeId(tenant.id), tenant.name || null]));
  const results = [];
  for (const container of routeMatches) {
    const { data: reservations } = await client.from(RESERVATIONS).select('*').eq('container_id', container.id).is('deleted_at', null);
    const capacity = computeCapacity(container, reservations || []);
    const capacityMatch = requiredVolume === null ? null : capacity.availableVolume >= requiredVolume;
    if (capacityMatch === false) continue;
    results.push({
      id: container.id,
      organiser_name: tenantName.get(normalizeId(container.tenant_id)) || null,
      origin_country: container.origin_country,
      origin_city: container.origin_city,
      destination_country: container.destination_country,
      destination_city: container.destination_city,
      departure_date: container.departure_date,
      booking_deadline: container.booking_deadline,
      estimated_arrival_date: container.estimated_arrival_date || null,
      container_type: container.container_type,
      available_capacity_cbm: capacity.availableVolume,
      requested_volume_cbm: requiredVolume,
      capacity_match: capacityMatch,
      match_reasons: [
        'Origin and destination countries match',
        container.booking_deadline ? 'Booking is open until the recorded cut-off' : 'No booking cut-off is recorded',
        ...(capacityMatch === true ? ['Recorded available capacity covers the current cargo estimate'] : ['Cargo volume is not fully known yet, so capacity fit is not evaluated']),
      ],
      requires_operator_confirmation: true,
    });
  }
  return results;
}

function reservationCargoType(items) {
  const categories = new Set(items.map((item) => item.cargo_category));
  if ([...categories].every((category) => category === 'vehicle')) return 'vehicle';
  if ([...categories].every((category) => category === 'parts')) return 'parts';
  if ([...categories].every((category) => ['household', 'boxes', 'furniture_appliances'].includes(category))) return 'household';
  if (categories.size === 1 && [...categories].every((category) => ['general', 'machinery_equipment', 'pallet_crate', 'other'].includes(category))) return 'general';
  return 'mixed';
}

/**
 * After a shared-container offer is awarded, convert it into the existing governed REQUESTED cargo
 * reservation. This does not approve capacity: the organiser's existing atomic approval remains the
 * authority. The method is retry-safe by finding a reservation already tagged to this request.
 */
export async function requestSpaceForAward(requestId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  assertCanReadRequest(request, context);
  if (!ownsRequest(request, context) && !isPrivileged(context)) throw new ForbiddenError('Only the requester can book the selected logistics offer');
  if (request.status !== 'AWARDED' || !request.accepted_quote_id) throw new ValidationError('Select a logistics offer before requesting container space');

  const { data: quote, error: quoteError } = await client.from(QUOTES).select('*').eq('id', request.accepted_quote_id).is('deleted_at', null).single();
  if (quoteError || !quote) throw new NotFoundError('Selected logistics offer not found');
  if (!quote.compatible_container_id) throw new ValidationError('The selected offer does not include a CarUp container sailing');

  const { data: existingRows } = await client.from(RESERVATIONS).select('*')
    .eq('container_id', quote.compatible_container_id)
    .eq('buyer_id', context.id)
    .is('deleted_at', null);
  const existing = (existingRows || []).find((row) => row.metadata?.logistics_request_id === requestId);
  if (existing) return { reservation: existing, idempotentReplay: true };

  const items = (await loadItems(client, [requestId])).get(requestId) || [];
  const volume = totalKnownVolume(items);
  if (!volume) throw new ValidationError('Confirm an estimated volume for every cargo item before requesting container space');
  const weight = totalKnownWeight(items);
  const description = items.map((item) => `${item.quantity || 1} × ${item.description}`).join(' · ').slice(0, 1000);

  const reservation = await requestReservation(quote.compatible_container_id, {
    estimated_volume: volume,
    estimated_weight: weight,
    cargo_type: reservationCargoType(items),
    cargo_description: description,
    source: 'logistics_rfq_award',
    metadata: {
      logistics_request_id: requestId,
      logistics_quote_id: quote.id,
    },
  }, context, { ...options, supabaseClient: client });

  await client.from(REQUESTS).update({
    metadata: { ...(request.metadata || {}), reservation_id: reservation.id },
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  }).eq('id', requestId);

  return { reservation, idempotentReplay: false };
}
