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
import { resolveVehicleObjectAuthority } from '../../middleware/vehicleObjectAuthority.js';
import { requestReservation, computeCapacity } from './diasporaContainerMarketplaceService.js';

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

  return {
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
  const { data, error } = await client.from(REQUESTS).select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw new ValidationError(`Could not list shipping requests: ${error.message}`);
  let rows = (data || []).filter((row) => ownsRequest(row, context) || isPrivileged(context));
  if (filters.status && REQUEST_STATUSES.has(String(filters.status).toUpperCase())) {
    rows = rows.filter((row) => row.status === String(filters.status).toUpperCase());
  }
  rows = rows.slice(offset, offset + limit);
  const itemsByRequest = await loadItems(client, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, reference: requestReference(row.id), items: itemsByRequest.get(row.id) || [] }));
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
  return {
    service_mode: mode,
    freight_amount: nonNegativeNumber(payload.freight_amount ?? payload.freightAmount ?? previous.freight_amount),
    handling_amount: nonNegativeNumber(payload.handling_amount ?? payload.handlingAmount ?? previous.handling_amount),
    origin_charges: nonNegativeNumber(payload.origin_charges ?? payload.originCharges ?? previous.origin_charges),
    destination_charges: nonNegativeNumber(payload.destination_charges ?? payload.destinationCharges ?? previous.destination_charges),
    documentation_fees: nonNegativeNumber(payload.documentation_fees ?? payload.documentationFees ?? previous.documentation_fees),
    optional_services: normalizeOptionalServices(payload.optional_services ?? payload.optionalServices ?? previous.optional_services),
    total_amount: total,
    currency: cleanText(payload.currency ?? previous.currency ?? 'USD', 10) || 'USD',
    transit_days: positiveNumber(payload.transit_days ?? payload.transitDays ?? previous.transit_days)
      ? Math.round(positiveNumber(payload.transit_days ?? payload.transitDays ?? previous.transit_days)) : null,
    valid_until: payload.valid_until ?? payload.validUntil ?? previous.valid_until ?? null,
    pickup_included: typeof (payload.pickup_included ?? payload.pickupIncluded) === 'boolean'
      ? (payload.pickup_included ?? payload.pickupIncluded) : (previous.pickup_included ?? null),
    delivery_included: typeof (payload.delivery_included ?? payload.deliveryIncluded) === 'boolean'
      ? (payload.delivery_included ?? payload.deliveryIncluded) : (previous.delivery_included ?? null),
    inclusions: normalizeStringArray(payload.inclusions ?? previous.inclusions),
    exclusions: normalizeStringArray(payload.exclusions ?? previous.exclusions),
    conditions: cleanText(payload.conditions ?? previous.conditions, 2000),
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

export async function findCompatibleSailings(requestId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  assertCanReadRequest(request, context);
  const items = (await loadItems(client, [requestId])).get(requestId) || [];
  const requiredVolume = totalKnownVolume(items);
  const { data: containers, error } = await client.from(CONTAINERS).select('*').eq('status', 'BOOKING_OPEN').is('deleted_at', null).order('departure_date', { ascending: true });
  if (error) throw new ValidationError(`Could not find compatible sailings: ${error.message}`);

  const routeMatches = (containers || []).filter((container) =>
    String(container.origin_country || '').toLowerCase() === String(request.origin_country || '').toLowerCase()
    && String(container.destination_country || '').toLowerCase() === String(request.destination_country || '').toLowerCase());
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
        ...(capacityMatch === true ? ['Recorded available capacity covers the current cargo estimate'] : ['Cargo volume is not fully known yet']),
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
