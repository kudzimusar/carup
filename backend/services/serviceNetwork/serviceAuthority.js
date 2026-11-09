import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

/**
 * Service Network — canonical resource authority checks.
 *
 * Hardening pass. The first implementation authenticated callers but did not ask the
 * second question: does this authenticated person have any authority over THIS vehicle,
 * case or practitioner? Without that, any signed-in user could open a service engagement
 * against any VIN, or mint a permanent link for a stranger's vehicle.
 *
 * The rules here are deliberately narrow and are the ONLY place Service Network decides
 * resource authority, so there is exactly one answer to each question:
 *
 *   - vehicle authority = canonical owner, or a live redeemed capability the owner granted.
 *     Ownership is NEVER inferred from seller identity, tenant membership or Marketplace
 *     state (those answer different questions and would fabricate ownership).
 *   - service case authority = the requester, or the garage tenant the case is directed to.
 *   - practitioner authority = the person themselves, or an admin of a garage they belong to.
 *
 * A capability only counts while it is live: redeemed, unexpired, unrevoked, and — where the
 * grant names a grantee tenant — redeemed into that tenant. Expiry and revocation therefore
 * stop granting access immediately, with no cached decision anywhere.
 */

export const VEHICLE_AUTHORITY = Object.freeze({
  OWNER: 'owner',
  CAPABILITY: 'capability',
});

function actorOf(userContext = {}) {
  const id = userContext.id || userContext.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required');
  return id;
}

/**
 * Is there a LIVE capability over this resource for this actor?
 *
 * "Live" means redeemed, not revoked, not expired, and — when the grant names a grantee
 * tenant — held by an actor whose verified tenant context matches it. The check is made
 * against current rows every time; nothing is cached, so a revocation takes effect at once.
 */
export async function findLiveCapability(supabaseClient, userContext, resourceType, resourceId, purposes = null) {
  const actorId = userContext?.id || userContext?.userId || null;
  if (!actorId) return null;

  const { data, error } = await supabaseClient
    .from('service_capability_grants')
    .select('*')
    .eq('resource_type', resourceType)
    .eq('resource_id', String(resourceId));
  if (error) throw new DatabaseError(`Failed to read capabilities: ${error.message}`);

  const now = Date.now();
  const actorTenantId = userContext?.tenantId || null;

  for (const grant of data || []) {
    if (!grant.redeemed_at) continue;                       // a granted-but-unredeemed link is not access
    if (grant.revoked_at) continue;                         // revocation is immediate
    if (!grant.expires_at || Date.parse(grant.expires_at) <= now) continue;  // expiry is immediate
    if (purposes && !purposes.includes(grant.purpose)) continue;
    // Wrong-recipient defence: a grant bound to a tenant is usable only from that tenant,
    // and only by the actor it was actually redeemed by.
    if (grant.grantee_tenant_id && grant.grantee_tenant_id !== actorTenantId) continue;
    if (grant.redeemed_by_user_id && grant.redeemed_by_user_id !== actorId) continue;
    return grant;
  }
  return null;
}

/**
 * Assert authority over a VIN.
 *
 * Returns the basis on which authority was granted, so callers can record it rather than
 * assume it. Throws NotFoundError for an unknown VIN so this is not a VIN-existence oracle.
 */
export async function assertVehicleAuthority(supabaseClient, userContext, vin, { allowCapability = true } = {}) {
  const actorId = actorOf(userContext);
  const cleanVin = String(vin || '').trim();
  if (!cleanVin) throw new ValidationError('vin is required');

  const { data: vehicle, error } = await supabaseClient
    .from('vehicles')
    .select('vin, owner_id')
    .eq('vin', cleanVin)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load vehicle: ${error.message}`);
  // Unknown and unauthorised are deliberately indistinguishable: a stranger must not be
  // able to probe which VINs exist.
  if (!vehicle) throw new NotFoundError('Vehicle not found');

  if (vehicle.owner_id && vehicle.owner_id === actorId) {
    return { basis: VEHICLE_AUTHORITY.OWNER, vin: vehicle.vin };
  }

  if (allowCapability) {
    const capability = await findLiveCapability(supabaseClient, userContext, 'vehicle', cleanVin);
    if (capability) {
      return { basis: VEHICLE_AUTHORITY.CAPABILITY, vin: vehicle.vin, capability_id: capability.id };
    }
  }

  // Note what is deliberately NOT accepted as vehicle authority: current_seller_id,
  // tenant membership, an open marketplace inquiry, or having previously serviced it.
  throw new NotFoundError('Vehicle not found');
}

/** Authority over a Service Case: its requester, or the garage it is directed to. */
export async function assertServiceCaseAuthority(supabaseClient, userContext, caseId) {
  const actorId = actorOf(userContext);
  const id = String(caseId || '').trim();
  if (!id) throw new ValidationError('service case id is required');

  const { data: serviceCase, error } = await supabaseClient
    .from('service_cases')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load service case: ${error.message}`);
  if (!serviceCase) throw new NotFoundError('Service case not found');

  if (serviceCase.requester_user_id === actorId) return { basis: 'requester', serviceCase };
  const tenantId = userContext?.tenantId || null;
  if (tenantId && serviceCase.garage_tenant_id === tenantId) return { basis: 'garage', serviceCase };

  const capability = await findLiveCapability(supabaseClient, userContext, 'service_case', id);
  if (capability) return { basis: 'capability', serviceCase, capability_id: capability.id };

  throw new NotFoundError('Service case not found');
}

/**
 * Authority over a practitioner identity: the person themselves, or an admin of a garage
 * they actually belong to. A garage cannot mint a public identity for someone unaffiliated.
 */
export async function assertPractitionerAuthority(supabaseClient, userContext, practitionerUserId) {
  const actorId = actorOf(userContext);
  const target = String(practitionerUserId || '').trim();
  if (!target) throw new ValidationError('practitioner id is required');
  if (target === actorId) return { basis: 'self' };

  const tenantId = userContext?.tenantId || null;
  if (!tenantId) throw new NotFoundError('Practitioner not found');

  const { data: theirMembership, error } = await supabaseClient
    .from('tenant_users')
    .select('user_id, role')
    .eq('tenant_id', tenantId)
    .eq('user_id', target)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to verify affiliation: ${error.message}`);
  if (!theirMembership) throw new NotFoundError('Practitioner not found');

  return { basis: 'garage_affiliation' };
}

/**
 * A branch must belong to the tenant it is being attached to.
 *
 * The database enforces this too (composite FK), but the application check produces a
 * clear error instead of a raw constraint violation, and covers callers that would
 * otherwise only discover the problem at write time.
 */
export async function assertBranchBelongsToTenant(supabaseClient, branchId, tenantId) {
  const id = branchId ? String(branchId).trim() : null;
  if (!id) return null;
  if (!tenantId) throw new ForbiddenError('A membership-verified garage tenant context is required');

  const { data: branch, error } = await supabaseClient
    .from('garage_branches')
    .select('id, tenant_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load branch: ${error.message}`);
  if (!branch || branch.tenant_id !== tenantId) {
    // Another garage's branch is indistinguishable from a missing one.
    throw new ValidationError('That branch does not belong to this garage');
  }
  return branch;
}

/**
 * Authority to USE an evidence item on a service record.
 *
 * A matching VIN is not authorization — it only says the evidence concerns the same
 * vehicle. The garage must additionally have a governed relationship to that vehicle
 * through the case it is recording against, and the evidence must not be restricted to
 * another party. Evidence remains the Evidence authority's; this only decides usage.
 */
export async function assertEvidenceUsable(supabaseClient, userContext, evidenceId, { vin, tenantId, serviceCaseId }) {
  const id = String(evidenceId || '').trim();
  if (!id) throw new ValidationError('evidence_id is required');

  const { data: evidence, error } = await supabaseClient
    .from('vehicle_evidence')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load evidence: ${error.message}`);
  if (!evidence) throw new NotFoundError('Evidence not found');
  if (evidence.vin !== vin) throw new ValidationError('That evidence belongs to a different vehicle');

  // The garage must be recording against a real, governed engagement for this vehicle.
  if (!serviceCaseId) {
    throw new ForbiddenError('Evidence can only be attached through a governed service case for this vehicle');
  }
  const { data: serviceCase, error: caseError } = await supabaseClient
    .from('service_cases')
    .select('id, vin, garage_tenant_id')
    .eq('id', serviceCaseId)
    .maybeSingle();
  if (caseError) throw new DatabaseError(`Failed to verify service case: ${caseError.message}`);
  if (!serviceCase || serviceCase.vin !== vin || serviceCase.garage_tenant_id !== tenantId) {
    throw new ForbiddenError('Evidence can only be attached through a governed service case for this vehicle');
  }

  // Evidence uploaded by another tenant is not this garage's to reuse unless the owner
  // uploaded it. Where the evidence row carries no uploader tenant, fall back to the
  // uploader being the vehicle's owner or a member of this garage.
  const uploaderTenant = evidence.tenant_id || evidence.uploader_tenant_id || null;
  if (uploaderTenant && uploaderTenant !== tenantId) {
    const { data: vehicle } = await supabaseClient
      .from('vehicles').select('owner_id').eq('vin', vin).maybeSingle();
    const uploadedByOwner = evidence.uploaded_by && vehicle && evidence.uploaded_by === vehicle.owner_id;
    if (!uploadedByOwner) {
      throw new ForbiddenError('That evidence was provided by another party and cannot be reused here');
    }
  }

  return evidence;
}
