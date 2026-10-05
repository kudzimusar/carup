/**
 * PartSentry write authority — ONE answer to "may this caller add to THIS vehicle's repair record, and
 * what does the record then say about who stands behind it?" (OC-5A, RC1 residual finding A).
 *
 * The route used to answer a different question. A mechanic needed only "the vehicle's tenant equals
 * my tenant, or I have a work order for this vin" — and any mechanic can open a work order on any vin,
 * naming themselves — so "a mechanic somewhere" could write any vehicle's repair ledger and its
 * canonical odometer. Every other role passed on owner, current seller OR raw tenant equality, so a
 * dealership member with no Dealer authority could do the same to the dealership's stock. And every
 * record, whoever wrote it, was ledgered as a "Mechanic Inspection".
 *
 * The answer is now the strongest TRUTHFUL attestation this caller holds over this vehicle:
 *
 *   mechanic_service   effective role mechanic, AND an open work order for THIS vin assigned to THIS
 *                      mechanic, AND the vehicle's custodian authorized it (owner_authorization), AND
 *                      the mechanic's membership of the work order's organisation is verified here — as
 *                      'mechanic' or 'admin', of an ACTIVE service organisation (garage or dealership).
 *                      The only class that moves the canonical odometer.
 *   dealer_recorded    effective role dealer AND governed Dealer authority over this vehicle
 *                      (dealerListingAuthority) — membership alone is never enough.
 *   platform_recorded  a CarUp platform administrator, by PLATFORM role.
 *   owner_stated       the vehicle's registered owner: their own statement, never a mechanic's.
 *   seller_stated      the vehicle's current seller (not its owner): likewise their own statement.
 *
 * Nothing here reads a request header. The tenant a mechanic's authority comes from is the WORK
 * ORDER's organisation, re-verified against tenant_users and tenants, never the caller's x-tenant-id.
 * Fail closed: a lookup that cannot be answered refuses (503), never admits.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { hasGovernedDealerVehicleAuthority } from '../dealer/dealerListingAuthority.js';

export const ATTESTATIONS = Object.freeze({
  MECHANIC_SERVICE: 'mechanic_service',
  DEALER_RECORDED: 'dealer_recorded',
  PLATFORM_RECORDED: 'platform_recorded',
  OWNER_STATED: 'owner_stated',
  SELLER_STATED: 'seller_stated',
});

/**
 * The ledger event each attestation is recorded as. Only a governed mechanic service is a
 * "Mechanic Inspection" — an owner's own entry is never ledgered as one.
 */
export const LEDGER_EVENT_TYPES = Object.freeze({
  mechanic_service: 'Mechanic Inspection',
  dealer_recorded: 'Dealer Maintenance Record',
  platform_recorded: 'Platform Maintenance Record',
  owner_stated: 'Owner Maintenance Declaration',
  seller_stated: 'Seller Maintenance Declaration',
});

/** Organisations that perform service work. A government, finance or import tenant does not. */
export const SERVICE_ORGANISATION_TYPES = Object.freeze(['garage', 'dealership', 'dealer']);

/** Membership roles that may perform service work for the organisation (tenantRoleCatalogue values). */
export const SERVICE_MEMBERSHIP_ROLES = Object.freeze(['mechanic', 'admin']);

/** The work order states under which work is being done. */
export const OPEN_WORK_ORDER_STATUSES = Object.freeze(['In Progress']);

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);
const norm = (value) => (value == null ? '' : String(value).trim().toLowerCase());

const refuse = (status, reason, message) => ({ allowed: false, status, reason, message });
const grant = (attestation, extra = {}) => ({
  allowed: true,
  attestation,
  ledgerEventType: LEDGER_EVENT_TYPES[attestation],
  odometerAuthority: attestation === ATTESTATIONS.MECHANIC_SERVICE,
  workOrderId: null,
  tenantId: null,
  ...extra,
});

/**
 * Whether `mechanicId` verifiably belongs, as a mechanic or admin, to the ACTIVE service organisation
 * `tenantId` — re-read here, never taken from a header. Shared by writing and by full-record reading,
 * so the two can never disagree about who belongs.
 * @returns {Promise<{ ok: true } | { ok: false, status: number, reason: string, message: string }>}
 */
export async function verifyServiceOrganisationMembership(client, { tenantId, mechanicId }) {
  if (!tenantId) {
    return { ok: false, status: 403, reason: 'work_order_without_organisation', message: 'This work order is not held by a service organisation.' };
  }
  const [{ data: membership, error: membershipError }, { data: tenant, error: tenantError }] = await Promise.all([
    client.from('tenant_users').select('role').eq('tenant_id', tenantId).eq('user_id', mechanicId).maybeSingle(),
    client.from('tenants').select('id, type, status').eq('id', tenantId).maybeSingle(),
  ]);
  if (membershipError || tenantError) {
    return { ok: false, status: 503, reason: 'relationship_lookup_failed', message: 'The service relationship could not be verified.' };
  }
  if (!membership || !SERVICE_MEMBERSHIP_ROLES.includes(norm(membership.role))) {
    return { ok: false, status: 403, reason: 'not_a_mechanic_of_the_work_order_organisation', message: 'You are not a mechanic of the organisation this work order belongs to.' };
  }
  if (!tenant || !SERVICE_ORGANISATION_TYPES.includes(norm(tenant.type))) {
    return { ok: false, status: 403, reason: 'organisation_not_a_service_provider', message: 'This work order is not held by a service organisation.' };
  }
  if (norm(tenant.status) !== 'active') {
    return { ok: false, status: 403, reason: 'organisation_not_active', message: 'The service organisation on this work order is not active.' };
  }
  return { ok: true };
}

/**
 * A mechanic's governed service relationship to `vin`, or the reason there is none.
 * @returns {Promise<{ ok: true, workOrder: object } | { ok: false, status: number, reason: string, message: string }>}
 */
export async function resolveMechanicServiceRelationship(client, { vin, mechanicId, workOrderId = null }) {
  let query = client
    .from('mechanic_work_orders')
    .select('id, vin, tenant_id, mechanic_id, status, owner_authorization')
    .eq('vin', vin)
    .eq('mechanic_id', mechanicId);
  if (workOrderId) query = query.eq('id', workOrderId);
  const { data: orders, error } = await query;
  if (error) return { ok: false, status: 503, reason: 'relationship_lookup_failed', message: 'The service relationship could not be verified.' };

  const usable = (orders || []).filter((order) => OPEN_WORK_ORDER_STATUSES.includes(order.status)
    && order.owner_authorization === 'authorized');
  if (usable.length === 0) {
    const awaiting = (orders || []).some((order) => order.owner_authorization === 'pending');
    return {
      ok: false,
      status: 403,
      reason: awaiting ? 'work_order_awaiting_owner_authorization' : 'no_authorized_work_order',
      message: awaiting
        ? 'Your work order for this vehicle is waiting for the owner to authorize it.'
        : 'You may only record service on a vehicle under an open work order its owner has authorized.',
    };
  }
  if (usable.length > 1) {
    return { ok: false, status: 409, reason: 'work_order_ambiguous', message: 'More than one authorized work order is open for this vehicle; name the one this service belongs to.' };
  }
  const order = usable[0];
  // The organisation is the WORK ORDER's, and the membership is re-read — never taken from a header.
  const belongs = await verifyServiceOrganisationMembership(client, { tenantId: order.tenant_id, mechanicId });
  if (!belongs.ok) return belongs;
  return { ok: true, workOrder: order };
}

/**
 * @param {object} args
 * @param {string} args.vin
 * @param {object} args.userContext   req.userContext from authorizeRole
 * @param {string|null} [args.workOrderId]  the work order a mechanic names (optional when exactly one is open)
 * @param {object} [args.client]
 * @returns {Promise<{allowed: true, attestation: string, ledgerEventType: string, odometerAuthority: boolean,
 *   workOrderId: string|null, tenantId: string|null, vehicle: object}
 *   | {allowed: false, status: number, reason: string, message: string}>}
 */
export async function resolvePartSentryWriteAuthority({ vin, userContext, workOrderId = null, client = defaultClient } = {}) {
  const actorId = userContext?.id ?? userContext?.userId ?? null;
  if (!actorId) return refuse(401, 'no_identity', 'Unauthorized.');
  if (!vin || typeof vin !== 'string') return refuse(400, 'no_vin', 'A vehicle is required.');

  const { data: vehicle, error: vehicleError } = await client
    .from('vehicles')
    .select('vin, owner_id, current_seller_id, tenant_id, mileage')
    .eq('vin', vin)
    .maybeSingle();
  if (vehicleError) return refuse(503, 'vehicle_lookup_failed', 'The vehicle could not be read.');
  if (!vehicle) return refuse(404, 'not_found', 'Vehicle not found.');

  const effectiveRole = norm(userContext.role ?? userContext.effectiveRole);
  let mechanicRefusal = null;

  if (effectiveRole === 'mechanic') {
    const relationship = await resolveMechanicServiceRelationship(client, { vin, mechanicId: actorId, workOrderId });
    if (relationship.ok) {
      return grant(ATTESTATIONS.MECHANIC_SERVICE, {
        workOrderId: relationship.workOrder.id,
        tenantId: relationship.workOrder.tenant_id,
        vehicle,
      });
    }
    // A lookup failure is never downgraded into a weaker attestation: the question is unanswered.
    if (relationship.status >= 500 || relationship.status === 409) return refuse(relationship.status, relationship.reason, relationship.message);
    mechanicRefusal = relationship;
  }

  if (effectiveRole === 'dealer') {
    let governed = false;
    try {
      governed = await hasGovernedDealerVehicleAuthority(client, userContext, vehicle);
    } catch {
      return refuse(503, 'dealer_authority_lookup_failed', 'Dealer authority could not be verified.');
    }
    if (governed) return grant(ATTESTATIONS.DEALER_RECORDED, { tenantId: userContext.tenantId ?? null, vehicle });
  }

  if (PLATFORM_ADMIN_ROLES.has(norm(userContext.platformRole))) {
    return grant(ATTESTATIONS.PLATFORM_RECORDED, { vehicle });
  }
  if (vehicle.owner_id && vehicle.owner_id === actorId) {
    return grant(ATTESTATIONS.OWNER_STATED, { vehicle });
  }
  if (vehicle.current_seller_id && vehicle.current_seller_id === actorId) {
    return grant(ATTESTATIONS.SELLER_STATED, { vehicle });
  }

  if (mechanicRefusal) return refuse(mechanicRefusal.status, mechanicRefusal.reason, mechanicRefusal.message);
  return refuse(403, 'no_relationship', effectiveRole === 'dealer'
    ? 'Dealer authority over this vehicle is required to add to its service record.'
    : 'You may only add to the service record of your own vehicle.');
}

/**
 * Who may read a vehicle's FULL repair record (unreviewed entries, suspicion state, actor ids) rather
 * than its governed public projection. The same relationships as writing, never a role on its own: a
 * platform administrator, the registered owner, or a mechanic assigned to an owner-authorized work
 * order for this vin. "A mechanic somewhere" sees the public record. Any doubt → public.
 *
 * @returns {Promise<'full'|'public'>}
 */
export async function resolvePartSentryReadScope({ vin, userContext, client = defaultClient } = {}) {
  const actorId = userContext?.id ?? userContext?.userId ?? null;
  if (!actorId || !vin) return 'public';
  if (PLATFORM_ADMIN_ROLES.has(norm(userContext.platformRole))) return 'full';
  try {
    const { data: vehicle, error } = await client.from('vehicles').select('owner_id').eq('vin', vin).maybeSingle();
    if (error) return 'public';
    if (vehicle?.owner_id && vehicle.owner_id === actorId) return 'full';
    const { data: orders, error: ordersError } = await client
      .from('mechanic_work_orders')
      .select('id, tenant_id, owner_authorization')
      .eq('vin', vin)
      .eq('mechanic_id', actorId);
    if (ordersError) return 'public';
    // An authorized work order (open or finished) of an organisation the mechanic STILL belongs to.
    for (const order of (orders || []).filter((o) => o.owner_authorization === 'authorized')) {
      const belongs = await verifyServiceOrganisationMembership(client, { tenantId: order.tenant_id, mechanicId: actorId });
      if (belongs.ok) return 'full';
    }
    return 'public';
  } catch {
    return 'public';
  }
}

/**
 * Who may decide on a vehicle's work orders — the vehicle's CUSTODIAN, which is what makes a work
 * order a governed relationship rather than one a mechanic issued to themselves:
 *   'owner'    the registered owner (re-proven under the database lock when the decision is written);
 *   'dealer'   for a dealership-held vehicle with NO registered owner, a dealer with governed Dealer
 *              authority over it — never a mere member of the dealership;
 *   'platform' a CarUp platform administrator.
 * An unknown vin and a stranger are refused identically (403), so the answer reveals nothing.
 *
 * @returns {Promise<{allowed: true, basis: 'owner'|'dealer'|'platform', vehicle: object}
 *   | {allowed: false, status: number, reason: string, message: string}>}
 */
export async function resolveWorkOrderCustodian({ vin, userContext, client = defaultClient } = {}) {
  const actorId = userContext?.id ?? userContext?.userId ?? null;
  if (!actorId) return refuse(401, 'no_identity', 'Unauthorized.');
  const notCustodian = refuse(403, 'not_custodian', 'Only the vehicle\'s owner — or, for dealership stock, its governed dealer — decides on its work orders.');
  if (!vin || typeof vin !== 'string') return notCustodian;

  const { data: vehicle, error } = await client
    .from('vehicles')
    .select('vin, owner_id, current_seller_id, tenant_id')
    .eq('vin', vin)
    .maybeSingle();
  if (error) return refuse(503, 'vehicle_lookup_failed', 'The vehicle could not be read.');
  if (!vehicle) return notCustodian;

  if (PLATFORM_ADMIN_ROLES.has(norm(userContext.platformRole))) return { allowed: true, basis: 'platform', vehicle };
  if (vehicle.owner_id && vehicle.owner_id === actorId) return { allowed: true, basis: 'owner', vehicle };
  if (!vehicle.owner_id && norm(userContext.role ?? userContext.effectiveRole) === 'dealer') {
    let governed = false;
    try {
      governed = await hasGovernedDealerVehicleAuthority(client, userContext, vehicle);
    } catch {
      return refuse(503, 'dealer_authority_lookup_failed', 'Dealer authority could not be verified.');
    }
    if (governed) return { allowed: true, basis: 'dealer', vehicle };
  }
  return notCustodian;
}

export default {
  ATTESTATIONS,
  resolvePartSentryReadScope,
  resolveWorkOrderCustodian,
  LEDGER_EVENT_TYPES,
  SERVICE_ORGANISATION_TYPES,
  SERVICE_MEMBERSHIP_ROLES,
  OPEN_WORK_ORDER_STATUSES,
  verifyServiceOrganisationMembership,
  resolveMechanicServiceRelationship,
  resolvePartSentryWriteAuthority,
};
