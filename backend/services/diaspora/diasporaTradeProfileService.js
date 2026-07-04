import { supabase } from '../../db/supabase.js';
import { DatabaseError, NotFoundError, ForbiddenError } from '../../utils/errors.js';
import { validateTradeProfilePayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord, normalizeId } from './diasporaAuthorization.js';

const SELF_SERVICE_EDITABLE_FIELDS = ['country', 'city', 'organization_id', 'metadata'];

function isPrivileged(context) {
  return isPlatformAdmin(context) || isPlatformReviewer(context);
}

function ownsProfile(profile, context) {
  return normalizeId(profile.user_id) === context.id;
}

function canReadProfile(profile, context) {
  return isPrivileged(context) || isTenantAdminForRecord(profile, context) || ownsProfile(profile, context);
}

/**
 * Buyer/seller/supplier self-service create. A non-privileged caller may only create a profile for
 * themselves (payload.user_id, if supplied, must match the caller) and can never set
 * verification_status directly — every self-service profile starts PENDING_REVIEW regardless of
 * payload, closing a prior gap where any authenticated caller could POST verification_status:
 * 'VERIFIED' and self-approve. A platform admin/reviewer may create/seed a profile for another user
 * and may set an initial verification_status (e.g. importing already-verified partners).
 */
export async function createTradeProfile(payload, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  validateTradeProfilePayload(payload);
  const privileged = isPrivileged(context);

  const targetUserId = payload.user_id ? normalizeId(payload.user_id) : context.id;
  if (!privileged && targetUserId !== context.id) {
    throw new ForbiddenError('You may only create a trade profile for your own account');
  }

  // tenant_id is derived from the caller's verified membership context, NOT the request body — a
  // non-privileged caller with no tenant context previously could inject an arbitrary payload.tenant_id
  // into their own profile (cross-tenant audit-trail pollution + that tenant's admins gaining read
  // access). Only a platform admin/reviewer may seed a profile under a body-supplied tenant_id.
  const resolvedTenantId = context.tenantId || (privileged ? (payload.tenant_id || null) : null);

  const { data, error } = await supabase
    .from('diaspora_trade_profiles')
    .insert({
      tenant_id: resolvedTenantId,
      user_id: targetUserId,
      organization_id: payload.organization_id || null,
      country: payload.country,
      city: payload.city,
      role_type: payload.role_type,
      verification_status: privileged ? (payload.verification_status || 'PENDING_REVIEW') : 'PENDING_REVIEW',
      trust_score: privileged ? (payload.trust_score || 50) : 50,
      completed_shipments_count: privileged ? (payload.completed_shipments_count || 0) : 0,
      dispute_count: privileged ? (payload.dispute_count || 0) : 0,
      rating_average: privileged ? (payload.rating_average || 0) : 0,
      metadata: payload.metadata || {},
      created_by: context.id,
      updated_by: context.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: context.id, action: 'TRADE_PROFILE_CREATED', resourceType: 'diaspora_trade_profile', resourceId: data.id, newState: data, req });
  return data;
}

/**
 * Self-service edit of the caller's own profile (or, for a platform admin/reviewer, any profile).
 * Restricted to non-authoritative fields — verification_status/trust_score/dispute_count/
 * completed_shipments_count can only change via verifyTradeProfile/suspendTradeProfile or system
 * processes, never through this path, so a self-service edit can never move the record closer to
 * VERIFIED.
 */
export async function updateTradeProfile(id, payload = {}, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  // getTradeProfile already gates read access to privileged/tenant-admin/owner — the same three
  // conditions an editor must satisfy, so no separate authorization check is needed here.
  const previous = await getTradeProfile(id, context);

  const patch = {};
  for (const field of SELF_SERVICE_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) patch[field] = payload[field];
  }

  const { data, error } = await supabase
    .from('diaspora_trade_profiles')
    .update({ ...patch, updated_by: context.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: context.id, action: 'TRADE_PROFILE_UPDATED', resourceType: 'diaspora_trade_profile', resourceId: id, previousState: previous, newState: data, req });
  return data;
}

/**
 * Non-privileged callers only ever see their own profile(s) — this table holds cross-tenant PII
 * (country, city, dispute history, trust score) with no prior scoping, so a plain buyer could
 * previously list every trade profile on the platform. Reviewers/admins may list broadly.
 */
export async function listTradeProfiles({ roleType, verificationStatus, country, limit = 50, offset = 0 }, userContext = {}) {
  const context = requireUserContext(userContext);
  let query = supabase.from('diaspora_trade_profiles').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (!isPrivileged(context)) {
    query = query.eq('user_id', context.id);
  } else {
    if (roleType) query = query.eq('role_type', roleType);
    if (verificationStatus) query = query.eq('verification_status', verificationStatus);
    if (country) query = query.eq('country', country);
  }
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

/** Read a single profile — owner, tenant admin of the same tenant, or platform admin/reviewer only. */
export async function getTradeProfile(id, userContext = {}) {
  const { data, error } = await supabase.from('diaspora_trade_profiles').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora trade profile not found');
  const context = requireUserContext(userContext);
  if (!canReadProfile(data, context)) {
    throw new ForbiddenError('You do not have access to this Diaspora trade profile');
  }
  return data;
}

export async function verifyTradeProfile(id, payload = {}, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  if (!isPrivileged(context)) {
    throw new ForbiddenError('Only a platform admin or reviewer may verify a trade profile');
  }
  const { data: previous, error: fetchError } = await supabase.from('diaspora_trade_profiles').select('*').eq('id', id).is('deleted_at', null).single();
  if (fetchError || !previous) throw new NotFoundError('Diaspora trade profile not found');
  const trustScore = Math.min(100, Math.max(previous.trust_score || 50, payload.trust_score || 80));
  const { data, error } = await supabase
    .from('diaspora_trade_profiles')
    .update({ verification_status: 'VERIFIED', trust_score: trustScore, updated_by: context.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), verification: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: context.id, action: 'TRADE_PROFILE_VERIFIED', resourceType: 'diaspora_trade_profile', resourceId: id, previousState: previous, newState: data, req });
  return data;
}

export async function suspendTradeProfile(id, payload = {}, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  if (!isPrivileged(context)) {
    throw new ForbiddenError('Only a platform admin or reviewer may suspend a trade profile');
  }
  const { data: previous, error: fetchError } = await supabase.from('diaspora_trade_profiles').select('*').eq('id', id).is('deleted_at', null).single();
  if (fetchError || !previous) throw new NotFoundError('Diaspora trade profile not found');
  const { data, error } = await supabase
    .from('diaspora_trade_profiles')
    .update({ verification_status: 'SUSPENDED', updated_by: context.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), suspension: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: context.id, action: 'TRADE_PROFILE_SUSPENDED', resourceType: 'diaspora_trade_profile', resourceId: id, previousState: previous, newState: data, req });
  return data;
}
