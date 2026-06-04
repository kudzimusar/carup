import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { logAuditEvent } from '../auditLogger.js';
import { canSetTrustFact } from './trustPermissionService.js';

export const PHASE_2A_TRUST_FACTS = [
  'vehicle_condition_category',
  'passport_verified',
  'inspection_ready',
];

export const CONDITION_CATEGORIES = [
  'brand_new',
  'recently_imported',
  'locally_used',
  'second_hand',
  'certified_dealer',
  'unknown',
];

const REVIEWABLE_BY_GOVERNMENT = ['passport_verified', 'inspection_ready'];
const CONDITION_EVIDENCE_TYPES = [
  'dealer_listing_photo',
  'import_photo',
  'customs_photo',
  'registration_document',
  'odometer_photo',
  'owner_handover_photo',
];

function actorContext(actor = {}) {
  return {
    id: actor.id || actor.userId || null,
    role: actor.effectiveRole || actor.role || null,
    tenantId: actor.tenantId || null,
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function requireReason(value, message = 'Reason is required') {
  const reason = String(value || '').trim();
  if (!reason) throw new ValidationError(message);
  return reason;
}

function assertPhase2AFact(fact) {
  if (!PHASE_2A_TRUST_FACTS.includes(fact)) {
    throw new ValidationError(`Unsupported Phase 2A trust fact: ${fact || 'missing'}`);
  }
}

function sanitizeRequest(row = {}) {
  return {
    id: row.id,
    vin: row.vin,
    trust_fact: row.trust_fact,
    requested_value: row.requested_value,
    current_value: row.current_value,
    status: row.status,
    requested_by: row.requested_by,
    requested_by_role: row.requested_by_role,
    requested_by_tenant_id: row.requested_by_tenant_id,
    reviewed_by: row.reviewed_by,
    reviewed_by_role: row.reviewed_by_role,
    reviewed_by_tenant_id: row.reviewed_by_tenant_id,
    evidence_ids: row.evidence_ids || [],
    partsentry_log_ids: row.partsentry_log_ids || [],
    reason: row.reason || null,
    decision_notes: row.decision_notes || null,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at || null,
    revoked_at: row.revoked_at || null,
    updated_at: row.updated_at || null,
  };
}

function currentValueForFact(vehicle, fact) {
  if (fact === 'vehicle_condition_category') {
    return { condition_category: vehicle.vehicle_condition_category || 'unknown' };
  }
  if (fact === 'passport_verified') {
    return {
      passport_verified: Boolean(vehicle.passport_verified),
      passport_verified_at: vehicle.passport_verified_at || null,
      passport_verification_source: vehicle.passport_verification_source || null,
    };
  }
  if (fact === 'inspection_ready') {
    return { inspection_ready: Boolean(vehicle.inspection_ready) };
  }
  return {};
}

function approvalVehiclePatch(fact, requestedValue, requestId) {
  if (fact === 'vehicle_condition_category') {
    return { vehicle_condition_category: requestedValue.condition_category };
  }
  if (fact === 'passport_verified') {
    return {
      passport_verified: true,
      passport_verified_at: new Date().toISOString(),
      passport_verification_source: `trust_fact_request:${requestId}`,
    };
  }
  if (fact === 'inspection_ready') {
    return { inspection_ready: true };
  }
  throw new ValidationError(`Unsupported Phase 2A trust fact: ${fact}`);
}

function revocationVehiclePatch(fact, requestId) {
  if (fact === 'vehicle_condition_category') {
    return { vehicle_condition_category: 'unknown' };
  }
  if (fact === 'passport_verified') {
    return {
      passport_verified: false,
      passport_verified_at: null,
      passport_verification_source: `revoked_trust_fact_request:${requestId}`,
    };
  }
  if (fact === 'inspection_ready') {
    return { inspection_ready: false };
  }
  throw new ValidationError(`Unsupported Phase 2A trust fact: ${fact}`);
}

function fieldEventForApproval(fact) {
  if (fact === 'vehicle_condition_category') return 'VEHICLE_CONDITION_CATEGORY_SET';
  if (fact === 'passport_verified') return 'PASSPORT_VERIFICATION_APPROVED';
  if (fact === 'inspection_ready') return 'INSPECTION_READY_SET';
  return 'TRUST_FACT_APPROVED';
}

function fieldEventForRevocation(fact) {
  if (fact === 'vehicle_condition_category') return 'VEHICLE_CONDITION_CATEGORY_REVOKED';
  if (fact === 'passport_verified') return 'PASSPORT_VERIFICATION_REVOKED';
  if (fact === 'inspection_ready') return 'INSPECTION_READY_REVOKED';
  return 'TRUST_FACT_REVOKED';
}

async function loadVehicle(supabaseClient, vin) {
  const { data, error } = await supabaseClient
    .from('vehicles')
    .select('vin, owner_id, tenant_id, vehicle_condition_category, passport_verified, passport_verified_at, passport_verification_source, inspection_ready')
    .eq('vin', vin)
    .single();

  if (error || !data) {
    throw new NotFoundError('Vehicle not found');
  }
  return data;
}

async function loadRequest(supabaseClient, requestId) {
  const { data, error } = await supabaseClient
    .from('trust_fact_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw new NotFoundError('Trust fact request not found');
  }
  return data;
}

function vehicleScopeContext(actor, vehicle) {
  return {
    ownsVehicle: Boolean(actor.id && vehicle.owner_id === actor.id),
    inTenantScope: Boolean(actor.tenantId && vehicle.tenant_id && String(vehicle.tenant_id) === String(actor.tenantId)),
  };
}

function assertRequestScope(actor, vehicle) {
  if (actor.role === 'admin' || actor.role === 'government') return;
  const scope = vehicleScopeContext(actor, vehicle);
  if (actor.role === 'owner' && scope.ownsVehicle) return;
  if (actor.role === 'dealer' && scope.inTenantScope) return;
  throw new ForbiddenError('Forbidden. You do not have vehicle scope for this trust fact request.');
}

function assertAuditSuccess(result, eventType) {
  if (!result?.success) {
    throw new DatabaseError(`Audit logging failed for ${eventType}: ${result?.error || 'unknown error'}`);
  }
}

async function logRequiredAudit(supabaseClient, event) {
  const result = await logAuditEvent(supabaseClient, event);
  assertAuditSuccess(result, event.event_type || event.eventType || 'UNKNOWN_AUDIT_EVENT');
  return result;
}

export function validatePhase2ATrustFactPayload(fact, requestedValue) {
  assertPhase2AFact(fact);
  if (!requestedValue || typeof requestedValue !== 'object' || Array.isArray(requestedValue)) {
    throw new ValidationError('requested_value must be an object');
  }

  if (fact === 'vehicle_condition_category') {
    const condition = String(requestedValue.condition_category || '').trim();
    if (!CONDITION_CATEGORIES.includes(condition)) {
      throw new ValidationError('Invalid vehicle_condition_category requested value');
    }
    return { condition_category: condition };
  }

  if (fact === 'passport_verified') {
    if (requestedValue.passport_verified !== true) {
      throw new ValidationError('passport_verified requests must set passport_verified to true');
    }
    return { passport_verified: true };
  }

  if (fact === 'inspection_ready') {
    if (requestedValue.inspection_ready !== true) {
      throw new ValidationError('inspection_ready requests must set inspection_ready to true');
    }
    return { inspection_ready: true };
  }

  throw new ValidationError(`Unsupported Phase 2A trust fact: ${fact}`);
}

export async function validateEvidenceForApproval(supabaseClient, vin, fact, evidenceIds, actorInput = {}) {
  const actor = actorContext(actorInput);
  const ids = asArray(evidenceIds);
  if (!ids.length) {
    throw new ValidationError('At least one evidence_id is required for trust fact approval');
  }

  const { data, error } = await supabaseClient
    .from('vehicle_evidence')
    .select('id, vin, evidence_type, verification_status, visibility_level')
    .in('id', ids);

  if (error) throw new DatabaseError(error.message);

  const rows = data || [];
  const foundIds = new Set(rows.map(row => String(row.id)));
  const missingIds = ids.filter(id => !foundIds.has(String(id)));
  if (missingIds.length) {
    throw new ValidationError(`Evidence not found: ${missingIds.join(', ')}`);
  }

  for (const row of rows) {
    if (row.vin !== vin) {
      throw new ValidationError('All evidence references must match the request VIN');
    }
    if (row.verification_status !== 'verified') {
      throw new ValidationError('Trust fact approval requires verified evidence');
    }
    if (
      actor.role === 'government' &&
      !['public_safe', 'restricted', 'government_only'].includes(row.visibility_level || 'public_safe')
    ) {
      throw new ForbiddenError('Government reviewer cannot approve with private evidence');
    }
  }

  if (fact === 'passport_verified') {
    const hasPassportDocument = rows.some(row => ['registration_document', 'ownership_transfer_document'].includes(row.evidence_type));
    if (!hasPassportDocument) {
      throw new ValidationError('passport_verified approval requires verified registration_document or ownership_transfer_document evidence');
    }
  }

  if (fact === 'inspection_ready') {
    const hasInspection = rows.some(row => row.evidence_type === 'inspection_photo');
    if (!hasInspection) {
      throw new ValidationError('inspection_ready approval requires verified inspection_photo evidence');
    }
  }

  if (fact === 'vehicle_condition_category') {
    const hasConditionEvidence = rows.some(row => CONDITION_EVIDENCE_TYPES.includes(row.evidence_type));
    if (!hasConditionEvidence) {
      throw new ValidationError('vehicle_condition_category approval requires verified supporting vehicle condition evidence');
    }
  }

  return rows;
}

export async function createTrustFactRequest(supabaseClient, actorInput, vin, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const trustFact = payload.trust_fact || payload.trustFact;
  const requestedValue = validatePhase2ATrustFactPayload(trustFact, payload.requested_value || payload.requestedValue);
  const reason = requireReason(payload.reason);
  const evidenceIds = asArray(payload.evidence_ids || payload.evidenceIds);

  if (!evidenceIds.length) {
    throw new ValidationError('At least one evidence_id is required');
  }

  const vehicle = await loadVehicle(supabaseClient, vin);
  assertRequestScope(actor, vehicle);

  const scope = vehicleScopeContext(actor, vehicle);
  const permission = canSetTrustFact(actor, trustFact, 'submit', {
    ...scope,
    vehicle,
    requestedValue,
  });
  if (!permission.allowed) {
    throw new ForbiddenError(permission.reason);
  }

  const { data: duplicate, error: duplicateError } = await supabaseClient
    .from('trust_fact_requests')
    .select('id')
    .eq('vin', vin)
    .eq('trust_fact', trustFact)
    .eq('status', 'pending')
    .maybeSingle();
  if (duplicateError) throw new DatabaseError(duplicateError.message);
  if (duplicate) throw new ValidationError('A pending request already exists for this VIN and trust fact');

  const currentValue = currentValueForFact(vehicle, trustFact);
  const insertPayload = {
    vin,
    trust_fact: trustFact,
    requested_value: requestedValue,
    current_value: currentValue,
    status: 'pending',
    requested_by: actor.id,
    requested_by_role: actor.role,
    requested_by_tenant_id: actor.tenantId,
    evidence_ids: evidenceIds,
    partsentry_log_ids: [],
    reason,
  };

  const { data: inserted, error } = await supabaseClient
    .from('trust_fact_requests')
    .insert(insertPayload)
    .select('*')
    .single();
  if (error) throw new DatabaseError(error.message);

  await logRequiredAudit(supabaseClient, {
    req: requestContext.req,
    event_type: 'TRUST_FACT_CHANGE_REQUESTED',
    vin,
    trust_fact: trustFact,
    previous_value: currentValue,
    new_value: requestedValue,
    actor_user_id: actor.id,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: requestContext.sourceRoute,
    evidence_ids: evidenceIds,
    reason,
  });

  return sanitizeRequest(inserted);
}

export async function listTrustFactReviewQueue(supabaseClient, actorInput, filters = {}) {
  const actor = actorContext(actorInput);
  if (!['admin', 'government'].includes(actor.role)) {
    throw new ForbiddenError('Only admin and government reviewers can access the trust fact review queue');
  }

  let query = supabaseClient
    .from('trust_fact_requests')
    .select('id, vin, trust_fact, requested_value, current_value, status, requested_by_role, requested_by_tenant_id, reviewed_by_role, reviewed_by_tenant_id, evidence_ids, reason, decision_notes, created_at, reviewed_at, revoked_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const status = filters.status || 'pending';
  if (status) query = query.eq('status', status);
  if (filters.vin) query = query.eq('vin', filters.vin);
  if (filters.trust_fact || filters.trustFact) query = query.eq('trust_fact', filters.trust_fact || filters.trustFact);
  if (actor.role === 'government') query = query.in('trust_fact', REVIEWABLE_BY_GOVERNMENT);

  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return (data || []).map(sanitizeRequest);
}

async function mutateRequestStatus(supabaseClient, requestId, patch) {
  const { data, error } = await supabaseClient
    .from('trust_fact_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .select('*')
    .single();
  if (error) throw new DatabaseError(error.message);
  return data;
}

async function updateVehicle(supabaseClient, vin, patch) {
  const { error } = await supabaseClient
    .from('vehicles')
    .update(patch)
    .eq('vin', vin);
  if (error) throw new DatabaseError(error.message);
}

function assertReviewPermission(actor, request, action, payload = {}) {
  const reason = payload.reason || payload.decision_notes || payload.decisionNotes;
  const permission = canSetTrustFact(actor, request.trust_fact, action, {
    reason,
    requestedBy: request.requested_by,
  });
  if (!permission.allowed) throw new ForbiddenError(permission.reason);
  if (request.requested_by && request.requested_by === actor.id && actor.role !== 'admin') {
    throw new ForbiddenError('Self-review is not allowed for trust fact requests');
  }
}

export async function approveTrustFactRequest(supabaseClient, actorInput, requestId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const request = await loadRequest(supabaseClient, requestId);
  if (request.status !== 'pending') throw new ValidationError('Only pending trust fact requests can be approved');

  assertReviewPermission(actor, request, 'approve', { ...payload, reason: decisionNotes });
  const vehicle = await loadVehicle(supabaseClient, request.vin);
  const evidenceRows = await validateEvidenceForApproval(supabaseClient, request.vin, request.trust_fact, request.evidence_ids, actor);
  const previousValue = currentValueForFact(vehicle, request.trust_fact);
  const newValue = {
    ...request.requested_value,
    vehicle_patch: approvalVehiclePatch(request.trust_fact, request.requested_value, request.id),
  };

  const baseAudit = {
    req: requestContext.req,
    vin: request.vin,
    trust_fact: request.trust_fact,
    previous_value: previousValue,
    new_value: newValue,
    actor_user_id: actor.id,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: requestContext.sourceRoute,
    evidence_ids: request.evidence_ids,
    reason: payload.reason || decisionNotes,
    decision_notes: decisionNotes,
  };

  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: 'TRUST_FACT_APPROVED' });
  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: fieldEventForApproval(request.trust_fact) });

  await updateVehicle(supabaseClient, request.vin, newValue.vehicle_patch);
  const updated = await mutateRequestStatus(supabaseClient, request.id, {
    status: 'approved',
    current_value: previousValue,
    reviewed_by: actor.id,
    reviewed_by_role: actor.role,
    reviewed_by_tenant_id: actor.tenantId,
    decision_notes: decisionNotes,
    reviewed_at: new Date().toISOString(),
  });

  await supabaseClient
    .from('trust_fact_requests')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('vin', request.vin)
    .eq('trust_fact', request.trust_fact)
    .eq('status', 'pending')
    .neq('id', request.id);

  return {
    request: sanitizeRequest(updated),
    evidence: evidenceRows.map(row => ({ id: row.id, evidence_type: row.evidence_type, visibility_level: row.visibility_level })),
  };
}

export async function rejectTrustFactRequest(supabaseClient, actorInput, requestId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const request = await loadRequest(supabaseClient, requestId);
  if (request.status !== 'pending') throw new ValidationError('Only pending trust fact requests can be rejected');
  assertReviewPermission(actor, request, 'reject', { ...payload, reason: decisionNotes });

  await logRequiredAudit(supabaseClient, {
    req: requestContext.req,
    event_type: 'TRUST_FACT_REJECTED',
    vin: request.vin,
    trust_fact: request.trust_fact,
    previous_value: request.current_value,
    new_value: request.requested_value,
    actor_user_id: actor.id,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: requestContext.sourceRoute,
    evidence_ids: request.evidence_ids,
    reason: payload.reason || decisionNotes,
    decision_notes: decisionNotes,
  });

  const updated = await mutateRequestStatus(supabaseClient, request.id, {
    status: 'rejected',
    reviewed_by: actor.id,
    reviewed_by_role: actor.role,
    reviewed_by_tenant_id: actor.tenantId,
    decision_notes: decisionNotes,
    reviewed_at: new Date().toISOString(),
  });

  return sanitizeRequest(updated);
}

export async function revokeTrustFactRequest(supabaseClient, actorInput, requestId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const request = await loadRequest(supabaseClient, requestId);
  if (request.status !== 'approved') throw new ValidationError('Only approved trust fact requests can be revoked');
  assertReviewPermission(actor, request, 'revoke', { ...payload, reason: decisionNotes });

  const vehicle = await loadVehicle(supabaseClient, request.vin);
  const previousValue = currentValueForFact(vehicle, request.trust_fact);
  const vehiclePatch = revocationVehiclePatch(request.trust_fact, request.id);
  const newValue = { ...vehiclePatch };

  const baseAudit = {
    req: requestContext.req,
    vin: request.vin,
    trust_fact: request.trust_fact,
    previous_value: previousValue,
    new_value: newValue,
    actor_user_id: actor.id,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: requestContext.sourceRoute,
    evidence_ids: request.evidence_ids,
    reason: payload.reason || decisionNotes,
    decision_notes: decisionNotes,
  };

  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: 'TRUST_FACT_REVOKED' });
  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: fieldEventForRevocation(request.trust_fact) });

  await updateVehicle(supabaseClient, request.vin, vehiclePatch);
  const updated = await mutateRequestStatus(supabaseClient, request.id, {
    status: 'revoked',
    reviewed_by: actor.id,
    reviewed_by_role: actor.role,
    reviewed_by_tenant_id: actor.tenantId,
    decision_notes: decisionNotes,
    revoked_at: new Date().toISOString(),
  });

  return sanitizeRequest(updated);
}

export async function getTrustFactAuditTrail(supabaseClient, actorInput, vin) {
  const actor = actorContext(actorInput);
  const vehicle = await loadVehicle(supabaseClient, vin);
  if (!['admin', 'government'].includes(actor.role)) {
    assertRequestScope(actor, vehicle);
  }

  const { data, error } = await supabaseClient
    .from('trust_audit_events')
    .select('id, event_type, vin, trust_fact, previous_value, new_value, actor_role, actor_type, source_route, evidence_ids, reason, decision_notes, request_id, created_at')
    .eq('vin', vin)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new DatabaseError(error.message);

  return (data || []).map(row => ({
    id: row.id,
    event_type: row.event_type,
    vin: row.vin,
    trust_fact: row.trust_fact,
    previous_value: row.previous_value,
    new_value: row.new_value,
    actor_role: row.actor_role,
    actor_type: row.actor_type,
    source_route: row.source_route,
    evidence_ids: row.evidence_ids || [],
    reason: ['admin', 'government'].includes(actor.role) ? row.reason : null,
    decision_notes: ['admin', 'government'].includes(actor.role) ? row.decision_notes : null,
    request_id: row.request_id,
    created_at: row.created_at,
  }));
}
