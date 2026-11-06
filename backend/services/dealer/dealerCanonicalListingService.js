/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-2 (C17/C15/C19): dealer stock → canonical Marketplace listing.
 *
 * This service never publishes, never verifies evidence and never writes a seller decision.
 *  - prepareMyDealerListing: the ACTIVE approved legal owner turns one of its own private tenant
 *    VIN drafts into a canonical seller listing candidate (owner as governed current seller, an
 *    owned branch, every stated fact `dealer_declared`) through ONE guarded SQL function.
 *  - getMyDealerListingReadiness: reads the CANONICAL publication gate (evaluateCompleteness) for
 *    that VIN, labels and statuses only — no reviewer identity, storage locator or OCR reading.
 *  - getPublicDealerStorefrontInventory: anonymous; asks SQL only for the VINs a currently approved
 *    full storefront may show, then renders each through the canonical public Marketplace detail
 *    service, so the storefront can never show a field (or a vehicle) Marketplace would not.
 * Publication itself remains POST /api/vehicles/:vin/publish (canonical gate), and the data layer
 * (20261103141000) refuses publication/seller/inquiry writes once dealer authority lapses.
 */
import { supabase } from '../../db/supabase.js';
import { requireApprovedOwnerWorkspace } from './dealerVerifiedWorkspaceService.js';
import { ZIMBABWE_REGISTRATION_STATUSES } from '../registration/zimbabweRegistrationLifecycle.js';

const refuse = (code, status = 503) => Object.assign(new Error(code), { statusCode: status, code });
const VIN17 = /^[A-HJ-NPR-Z0-9]{17}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEED_RE = /^ZW-DEAL-\d{4}$/;
const IDENTITY_RE = /^[A-Z0-9-]{4,40}$/;
const PLATE_RE = /^[A-Z0-9 -]{2,16}$/;
export const DEALER_LISTING_LOCATION_VISIBILITIES = Object.freeze(['public', 'province_only', 'withheld']);

const SQL_REFUSALS = Object.freeze({
  NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP: 403,
  DEALER_LISTING_AUTHORITY_NOT_CURRENT: 403,
  BRANCH_NOT_OWNED_BY_APPROVED_DEALER: 403,
  DEALER_SELLER_RELATIONSHIP_REQUIRES_APPROVED_OWNER: 403,
  TENANT_VEHICLE_NOT_FOUND: 404,
  LISTING_ALREADY_PUBLIC_UNPUBLISH_FIRST: 409,
  CURRENCY_ALREADY_STATED: 409,
  PRIVATE_OWNER_VEHICLE_NOT_DEALER_STOCK: 409,
  DEALER_DECLARED_PRICE_REQUIRED: 400,
  DEALER_DECLARED_CURRENCY_REQUIRED: 400,
  DEALER_DECLARED_IDENTITY_NUMBERS_REQUIRED: 400,
  DEALER_DECLARED_REGISTRATION_STAGE_REQUIRED: 400,
  INVALID_DECLARED_PLATE: 400,
  DEALER_DECLARED_LISTING_CITY_REQUIRED: 400,
  DEALER_LISTING_LOCATION_VISIBILITY_REQUIRED: 400,
});

/** Map a RAISE EXCEPTION code from the guarded SQL to an HTTP refusal; anything else is 503. */
export function mapListingSqlError(error) {
  const text = String(error?.message || '');
  for (const [code, status] of Object.entries(SQL_REFUSALS)) {
    if (text.includes(code)) return refuse(code, status);
  }
  return refuse('DEALER_LISTING_PREPARATION_UNAVAILABLE', 503);
}

const text = (value, max, min = 1) => (typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
  ? value.trim() : null);

/**
 * Explicit allow-list parse. Untrusted keys (publication_status, owner_id, verified flags, trust)
 * are never read, so they can never be forwarded.
 */
export function parseDealerListingPreparation(payload = {}) {
  const branchId = typeof payload.branch_id === 'string' ? payload.branch_id.trim() : '';
  if (!UUID_RE.test(branchId)) throw refuse('LISTING_BRANCH_REQUIRED', 400);
  const price = payload.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 10_000_000) {
    throw refuse('DEALER_DECLARED_PRICE_REQUIRED', 400);
  }
  const currency = typeof payload.currency === 'string' ? payload.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) throw refuse('DEALER_DECLARED_CURRENCY_REQUIRED', 400);
  const chassis = typeof payload.chassis_number === 'string' ? payload.chassis_number.trim().toUpperCase() : '';
  const engine = typeof payload.engine_number === 'string' ? payload.engine_number.trim().toUpperCase() : '';
  if (!IDENTITY_RE.test(chassis) || !IDENTITY_RE.test(engine)) {
    throw refuse('DEALER_DECLARED_IDENTITY_NUMBERS_REQUIRED', 400);
  }
  const registrationStatus = typeof payload.registration_status === 'string'
    ? payload.registration_status.trim().toLowerCase() : '';
  if (!ZIMBABWE_REGISTRATION_STATUSES.includes(registrationStatus)) {
    throw refuse('DEALER_DECLARED_REGISTRATION_STAGE_REQUIRED', 400);
  }
  const plate = typeof payload.plate_number === 'string' && payload.plate_number.trim()
    ? payload.plate_number.trim().toUpperCase() : null;
  if (plate !== null && !PLATE_RE.test(plate)) throw refuse('INVALID_DECLARED_PLATE', 400);
  const city = text(payload.listing_city, 80, 2);
  if (!city) throw refuse('DEALER_DECLARED_LISTING_CITY_REQUIRED', 400);
  const province = text(payload.listing_province, 80, 2);
  const visibility = payload.location_visibility;
  if (!DEALER_LISTING_LOCATION_VISIBILITIES.includes(visibility)) {
    throw refuse('DEALER_LISTING_LOCATION_VISIBILITY_REQUIRED', 400);
  }
  return Object.freeze({
    branch_id: branchId, price, currency, chassis_number: chassis, engine_number: engine,
    registration_status: registrationStatus, plate_number: plate, listing_city: city,
    listing_province: province, location_visibility: visibility,
    public_seller_display: payload.public_seller_display === true,
  });
}

export async function prepareMyDealerListing(actor, vin, payload = {}, {
  db = supabase, resolveOwner = requireApprovedOwnerWorkspace,
} = {}) {
  if (typeof vin !== 'string' || !VIN17.test(vin)) throw refuse('INVALID_PRIVATE_DRAFT_VIN', 400);
  const clean = parseDealerListingPreparation(payload);
  const owner = await resolveOwner(actor);
  if (!owner?.tenant_id || owner.actor_id !== actor?.userId) {
    throw refuse('CANONICAL_OWNER_TENANT_LISTING_AUTHORITY_REQUIRED', 403);
  }
  const { data, error } = await db.rpc('dealer_prepare_canonical_listing', {
    p_actor_id: owner.actor_id, p_vin: vin, p_branch_id: clean.branch_id, p_price: clean.price,
    p_currency: clean.currency, p_chassis_number: clean.chassis_number,
    p_engine_number: clean.engine_number, p_registration_status: clean.registration_status,
    p_plate_number: clean.plate_number, p_listing_city: clean.listing_city,
    p_listing_province: clean.listing_province, p_location_visibility: clean.location_visibility,
    p_public_seller_display: clean.public_seller_display,
  });
  if (error) throw mapListingSqlError(error);
  if (!data || data.vin !== vin || data.published !== false || data.governed_seller_is_approved_owner !== true) {
    throw refuse('DEALER_LISTING_PREPARATION_READBACK_FAILED', 503);
  }
  return Object.freeze({
    ...data,
    next_steps: Object.freeze([
      'UPLOAD_OWNERSHIP_OR_REGISTRATION_DOCUMENT_THROUGH_CANONICAL_EVIDENCE',
      'INDEPENDENT_CARUP_VEHICLE_REVIEW',
      'PUBLISH_THROUGH_CANONICAL_MARKETPLACE_GATE',
    ]),
  });
}

/** Labels and statuses only: never a reviewer id, storage locator, OCR reading or private field. */
export function projectCanonicalReadiness(completeness) {
  const requirements = (completeness?.requirements || []).map((r) => Object.freeze({
    key: r.key, label: r.label, status: r.status, blocking: r.blocking === true,
    who_must_act: r.who_must_act || null,
  }));
  return Object.freeze({
    source: 'CANONICAL_COMPLETENESS_EVALUATOR',
    is_publishable: completeness?.is_publishable === true,
    completeness_percent: Number.isFinite(completeness?.completeness_percent) ? completeness.completeness_percent : null,
    requirements: Object.freeze(requirements),
  });
}

export async function getMyDealerListingReadiness(actor, vin, {
  db = supabase, resolveOwner = requireApprovedOwnerWorkspace, evaluate = null,
} = {}) {
  if (typeof vin !== 'string' || !VIN17.test(vin)) throw refuse('INVALID_PRIVATE_DRAFT_VIN', 400);
  const owner = await resolveOwner(actor);
  if (!owner?.tenant_id || owner.actor_id !== actor?.userId) {
    throw refuse('CANONICAL_OWNER_TENANT_LISTING_AUTHORITY_REQUIRED', 403);
  }
  const { data: vehicle, error } = await db.from('vehicles')
    .select('vin,tenant_id,status,publication_status,current_seller_id,price,currency')
    .eq('vin', vin).eq('tenant_id', owner.tenant_id).maybeSingle();
  if (error) throw refuse('CANONICAL_TENANT_INVENTORY_UNAVAILABLE', 503);
  if (!vehicle || vehicle.tenant_id !== owner.tenant_id) throw refuse('TENANT_VEHICLE_NOT_FOUND', 404);
  const [{ data: current, error: authorityError }, { data: branch, error: branchError }] = await Promise.all([
    db.rpc('dealer_tenant_listing_authority_current', { p_tenant_id: owner.tenant_id }),
    db.from('dealer_vehicle_branch_assignments').select('branch_id').eq('vin', vin)
      .eq('tenant_id', owner.tenant_id).maybeSingle(),
  ]);
  if (authorityError || branchError) throw refuse('DEALER_LISTING_AUTHORITY_UNAVAILABLE', 503);
  const evaluator = evaluate || (await import('../evidence/completenessEvaluator.js')).evaluateCompleteness;
  let gate;
  try {
    gate = projectCanonicalReadiness(await evaluator(vin, { client: db }));
  } catch {
    // A gate that cannot read its own inputs is NOT a readiness answer; never report "publishable".
    throw refuse('CANONICAL_PUBLICATION_GATE_UNAVAILABLE', 503);
  }
  const prepared = vehicle.current_seller_id === owner.actor_id;
  return Object.freeze({
    vin,
    dealer_operating_authority_current: current === true,
    governed_seller_is_approved_owner: prepared,
    listing_candidate_prepared: prepared && vehicle.status === 'Available',
    branch_id: branch?.branch_id || null,
    recorded_marketplace_publication_state: vehicle.publication_status,
    canonical_gate: gate,
    publish_route: prepared ? `/api/vehicles/${vin}/publish` : null,
    publish_requires_tenant_context: true,
    dealer_domain_can_publish: false,
    independent_vehicle_review_required: true,
  });
}

export async function getPublicDealerStorefrontInventory(seedId, {
  db = supabase, detail = null, limit = 12,
} = {}) {
  if (typeof seedId !== 'string' || !SEED_RE.test(seedId)) throw refuse('INVALID_DEALER_PROFILE', 400);
  const { data, error } = await db.rpc('dealer_storefront_public_listing_vins', {
    p_seed_dealer_id: seedId, p_limit: limit,
  });
  if (error || !Array.isArray(data)) throw refuse('DEALER_STOREFRONT_INVENTORY_UNAVAILABLE', 503);
  const readDetail = detail || (await import('../marketplace/marketplaceListingDetailService.js')).getMarketplaceListingDetail;
  const entries = [];
  for (const row of data) {
    const vin = typeof row === 'string' ? row : row?.vin;
    if (typeof vin !== 'string') continue;
    try {
      const listing = await readDetail(db, vin, { audience: 'public' });
      if (listing?.vin === vin) entries.push(listing);
    } catch (readError) {
      // Not publicly visible right now (canonical gate) → simply not shown. Anything else is an
      // outage and must not be reported as "this dealer has no stock".
      if (readError?.statusCode !== 404 && readError?.status !== 404 && readError?.name !== 'NotFoundError') {
        throw refuse('DEALER_STOREFRONT_INVENTORY_UNAVAILABLE', 503);
      }
    }
  }
  return Object.freeze({
    seed_dealer_id: seedId,
    entries: Object.freeze(entries),
    count: entries.length,
    projection: 'CANONICAL_MARKETPLACE_PUBLIC_DETAIL',
    requires_current_full_storefront_and_dealer_authority: true,
  });
}
