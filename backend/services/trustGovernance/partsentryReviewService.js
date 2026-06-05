import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { logAuditEvent } from '../auditLogger.js';
import { canSetTrustFact } from './trustPermissionService.js';

export const PARTSENTRY_REVIEW_TYPES = [
  'public_card_eligible',
  'verification_status',
  'part_verification_status',
  'suspicion_status',
];

const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'revoked', 'superseded'];
const REVIEWABLE_STATUSES = ['verified', 'rejected', 'disputed'];
const SUSPICION_STATUSES = ['watch', 'flagged', 'cleared', 'none'];
const ACTIVE_SUSPICION_STATUSES = ['watch', 'flagged'];
const PART_PROVENANCE_EVIDENCE_TYPES = [
  'part_invoice',
  'parts_invoice',
  'receipt',
  'parts_receipt',
  'part_serial_photo',
  'serial_number_photo',
  'work_order',
  'service_record',
  'repair_invoice',
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

function boolValue(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeLogId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError('partsentry log id must be a positive integer');
  }
  return parsed;
}

function assertRequestType(requestType) {
  if (!PARTSENTRY_REVIEW_TYPES.includes(requestType)) {
    throw new ValidationError(`Unsupported PartSentry review request_type: ${requestType || 'missing'}`);
  }
}

function isActiveSuspicion(value) {
  return ACTIVE_SUSPICION_STATUSES.includes(String(value || 'none'));
}

function currentValueForLog(log = {}) {
  return {
    public_card_eligible: boolValue(log.public_card_eligible),
    verification_status: log.verification_status || 'unverified',
    part_verification_status: log.part_verification_status || 'unverified',
    suspicion_status: log.suspicion_status || 'none',
  };
}

function sanitizeRequest(row = {}) {
  return {
    id: row.id,
    partsentry_log_id: row.partsentry_log_id,
    vin: row.vin,
    request_type: row.request_type,
    requested_value: row.requested_value,
    current_value: row.current_value,
    status: row.status,
    requested_by_role: row.requested_by_role,
    requested_by_tenant_id: row.requested_by_tenant_id,
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

function sanitizeLog(row = {}) {
  return {
    id: row.id,
    vin: row.vin,
    part_name: row.part_name || null,
    part_oem: row.part_oem || null,
    action_type: row.action_type || null,
    mileage: row.mileage ?? null,
    timestamp: row.timestamp || null,
    created_at: row.created_at || null,
    verification_status: row.verification_status || 'unverified',
    part_verification_status: row.part_verification_status || 'unverified',
    suspicion_status: row.suspicion_status || 'none',
    public_card_eligible: boolValue(row.public_card_eligible),
  };
}

function vehicleScopeContext(actor, vehicle) {
  return {
    ownsVehicle: Boolean(actor.id && vehicle?.owner_id === actor.id),
    inTenantScope: Boolean(actor.tenantId && vehicle?.tenant_id && String(vehicle.tenant_id) === String(actor.tenantId)),
  };
}

async function loadPartSentryLog(supabaseClient, logId) {
  const id = normalizeLogId(logId);
  const { data, error } = await supabaseClient
    .from('partsentry_logs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw new NotFoundError('PartSentry log not found');
  }
  return data;
}

async function loadVehicle(supabaseClient, vin) {
  const { data, error } = await supabaseClient
    .from('vehicles')
    .select('vin, owner_id, tenant_id')
    .eq('vin', vin)
    .single();

  if (error || !data) {
    throw new NotFoundError('Vehicle not found');
  }
  return data;
}

async function loadRequest(supabaseClient, requestId) {
  const { data, error } = await supabaseClient
    .from('partsentry_review_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw new NotFoundError('PartSentry review request not found');
  }
  return data;
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

function assertSubmitScope(actor, log, vehicle, requestType, requestedValue) {
  const scope = vehicleScopeContext(actor, vehicle);
  const ownRecord = Boolean(actor.id && log.mechanic_id === actor.id);
  const permission = canSetTrustFact(actor, requestType, 'submit', {
    ...scope,
    ownRecord,
    submittedBy: log.mechanic_id,
    requestedValue,
  });
  if (!permission.allowed) {
    throw new ForbiddenError(permission.reason);
  }

  if (actor.role === 'admin') return;
  if (actor.role === 'mechanic' && ownRecord) return;
  if (actor.role === 'owner' && scope.ownsVehicle) return;
  if (actor.role === 'dealer' && scope.inTenantScope) return;
  throw new ForbiddenError('Forbidden. You do not have scope for this PartSentry review request.');
}

function assertReviewPermission(actor, log, requestType, action, payload = {}) {
  const reason = payload.reason || payload.decision_notes || payload.decisionNotes;
  const permission = canSetTrustFact(actor, requestType, action, {
    reason,
    ownRecord: Boolean(actor.id && log.mechanic_id === actor.id),
    submittedBy: log.mechanic_id,
  });
  if (!permission.allowed) {
    throw new ForbiddenError(permission.reason);
  }

  if (actor.id && log.mechanic_id === actor.id) {
    throw new ForbiddenError('Reviewer cannot approve, reject, or revoke their own PartSentry log');
  }
}

export function validatePartSentryReviewPayload(requestType, requestedValue) {
  assertRequestType(requestType);
  if (!requestedValue || typeof requestedValue !== 'object' || Array.isArray(requestedValue)) {
    throw new ValidationError('requested_value must be an object');
  }

  if (requestType === 'public_card_eligible') {
    if (requestedValue.public_card_eligible !== true) {
      throw new ValidationError('public_card_eligible requests must set public_card_eligible to true');
    }
    return { public_card_eligible: true };
  }

  if (requestType === 'verification_status') {
    const status = String(requestedValue.verification_status || '').trim();
    if (!REVIEWABLE_STATUSES.includes(status)) {
      throw new ValidationError('Invalid verification_status requested value');
    }
    return { verification_status: status };
  }

  if (requestType === 'part_verification_status') {
    const status = String(requestedValue.part_verification_status || '').trim();
    if (!REVIEWABLE_STATUSES.includes(status)) {
      throw new ValidationError('Invalid part_verification_status requested value');
    }
    return { part_verification_status: status };
  }

  if (requestType === 'suspicion_status') {
    const status = String(requestedValue.suspicion_status || '').trim();
    if (!SUSPICION_STATUSES.includes(status)) {
      throw new ValidationError('Invalid suspicion_status requested value');
    }
    return { suspicion_status: status };
  }

  throw new ValidationError(`Unsupported PartSentry review request_type: ${requestType}`);
}

async function loadEvidenceRows(supabaseClient, vin, evidenceIds) {
  const ids = asArray(evidenceIds);
  if (!ids.length) return [];

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
      throw new ValidationError('All evidence references must match the PartSentry log VIN');
    }
  }

  return rows;
}

export async function validatePartSentryEvidenceForApproval(supabaseClient, log, requestType, evidenceIds, actorInput = {}) {
  const actor = actorContext(actorInput);
  const rows = await loadEvidenceRows(supabaseClient, log.vin, evidenceIds);

  if (actor.id && log.mechanic_id === actor.id) {
    throw new ForbiddenError('Reviewer cannot approve their own PartSentry log');
  }

  const requestedVerifiedEvidence = rows.filter(row => row.verification_status === 'verified');

  if (requestType === 'public_card_eligible') {
    if (!String(log.part_name || '').trim()) {
      throw new ValidationError('public_card_eligible approval requires a non-empty part_name');
    }
    if (!String(log.action_type || '').trim()) {
      throw new ValidationError('public_card_eligible approval requires a valid action_type');
    }
    if (log.mileage !== null && log.mileage !== undefined && (!Number.isFinite(Number(log.mileage)) || Number(log.mileage) < 0)) {
      throw new ValidationError('public_card_eligible approval requires a valid mileage when present');
    }
    if (isActiveSuspicion(log.suspicion_status)) {
      throw new ValidationError('public_card_eligible approval is blocked while suspicion_status is watch or flagged');
    }
  }

  if (requestType === 'verification_status') {
    if (isActiveSuspicion(log.suspicion_status)) {
      throw new ValidationError('verification_status approval is blocked while suspicion_status is watch or flagged');
    }
    if (rows.length && requestedVerifiedEvidence.length !== rows.length) {
      throw new ValidationError('verification_status approval requires verified supporting evidence when evidence is provided');
    }
  }

  if (requestType === 'part_verification_status') {
    if (isActiveSuspicion(log.suspicion_status)) {
      throw new ValidationError('part_verification_status approval is blocked while suspicion_status is watch or flagged');
    }
    if (!String(log.part_oem || '').trim()) {
      throw new ValidationError('part_verification_status = verified requires a durable part identifier or part_oem');
    }
    if (!rows.length) {
      throw new ValidationError('part_verification_status = verified requires part provenance evidence');
    }
    if (requestedVerifiedEvidence.length !== rows.length) {
      throw new ValidationError('part_verification_status = verified requires verified part provenance evidence');
    }
    const hasProvenance = rows.some(row => PART_PROVENANCE_EVIDENCE_TYPES.includes(row.evidence_type));
    if (!hasProvenance) {
      throw new ValidationError('part_verification_status = verified requires invoice, receipt, serial, or work-order evidence');
    }
  }

  return rows;
}

function patchForApproval(requestType, requestedValue) {
  if (requestType === 'public_card_eligible') {
    return { public_card_eligible: true };
  }
  if (requestType === 'verification_status') {
    return { verification_status: requestedValue.verification_status };
  }
  if (requestType === 'part_verification_status') {
    return { part_verification_status: requestedValue.part_verification_status };
  }
  if (requestType === 'suspicion_status') {
    const patch = { suspicion_status: requestedValue.suspicion_status };
    if (isActiveSuspicion(requestedValue.suspicion_status)) {
      patch.public_card_eligible = false;
    }
    return patch;
  }
  throw new ValidationError(`Unsupported PartSentry review request_type: ${requestType}`);
}

function patchForRevocation(requestType) {
  if (requestType === 'public_card_eligible') {
    return { public_card_eligible: false };
  }
  if (requestType === 'verification_status') {
    return { verification_status: 'unverified' };
  }
  if (requestType === 'part_verification_status') {
    return { part_verification_status: 'unverified' };
  }
  if (requestType === 'suspicion_status') {
    return {};
  }
  throw new ValidationError(`Unsupported PartSentry review request_type: ${requestType}`);
}

function fieldEventForApproval(requestType, requestedValue = {}) {
  if (requestType === 'public_card_eligible') return 'PARTSENTRY_PUBLIC_CARD_ELIGIBILITY_APPROVED';
  if (requestType === 'verification_status') {
    if (requestedValue.verification_status === 'verified') return 'PARTSENTRY_LOG_VERIFIED';
    if (requestedValue.verification_status === 'rejected') return 'PARTSENTRY_LOG_REJECTED';
    return 'PARTSENTRY_LOG_DISPUTED';
  }
  if (requestType === 'part_verification_status') {
    if (requestedValue.part_verification_status === 'verified') return 'PART_VERIFICATION_APPROVED';
    if (requestedValue.part_verification_status === 'rejected') return 'PART_VERIFICATION_REJECTED';
    return 'PART_VERIFICATION_REVOKED';
  }
  if (requestType === 'suspicion_status') {
    return isActiveSuspicion(requestedValue.suspicion_status) ? 'PARTSENTRY_SUSPICION_FLAGGED' : 'PARTSENTRY_SUSPICION_CLEARED';
  }
  return 'PARTSENTRY_REVIEW_APPROVED';
}

function fieldEventForRejection(requestType) {
  if (requestType === 'public_card_eligible') return 'PARTSENTRY_PUBLIC_CARD_ELIGIBILITY_REJECTED';
  return 'PARTSENTRY_REVIEW_REJECTED';
}

function fieldEventForRevocation(requestType) {
  if (requestType === 'public_card_eligible') return 'PARTSENTRY_PUBLIC_CARD_ELIGIBILITY_REVOKED';
  if (requestType === 'verification_status') return 'PARTSENTRY_LOG_DISPUTED';
  if (requestType === 'part_verification_status') return 'PART_VERIFICATION_REVOKED';
  return 'PARTSENTRY_REVIEW_REVOKED';
}

async function updatePartSentryLog(supabaseClient, logId, patch) {
  if (!Object.keys(patch).length) return null;
  const { data, error } = await supabaseClient
    .from('partsentry_logs')
    .update(patch)
    .eq('id', logId)
    .select('*')
    .single();
  if (error) throw new DatabaseError(error.message);
  return data;
}

async function mutateRequestStatus(supabaseClient, requestId, patch) {
  const { data, error } = await supabaseClient
    .from('partsentry_review_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .select('*')
    .single();
  if (error) throw new DatabaseError(error.message);
  return data;
}

function auditBase({ requestContext, actor, log, requestType, previousValue, newValue, sourceRoute, evidenceIds, reason, decisionNotes, requestId }) {
  return {
    req: requestContext.req,
    vin: log.vin,
    trust_fact: requestType,
    previous_value: previousValue,
    new_value: newValue,
    actor_user_id: actor.id,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: sourceRoute || requestContext.sourceRoute,
    evidence_ids: evidenceIds,
    partsentry_log_ids: [String(log.id)],
    reason,
    decision_notes: decisionNotes,
    request_id: requestId,
  };
}

export async function createPartSentryReviewRequest(supabaseClient, actorInput, logId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const requestType = payload.request_type || payload.requestType;
  const requestedValue = validatePartSentryReviewPayload(requestType, payload.requested_value || payload.requestedValue);
  const reason = requireReason(payload.reason);
  const evidenceIds = asArray(payload.evidence_ids || payload.evidenceIds);
  const log = await loadPartSentryLog(supabaseClient, logId);
  const vehicle = await loadVehicle(supabaseClient, log.vin);

  assertSubmitScope(actor, log, vehicle, requestType, requestedValue);

  const { data: duplicate, error: duplicateError } = await supabaseClient
    .from('partsentry_review_requests')
    .select('id')
    .eq('partsentry_log_id', log.id)
    .eq('request_type', requestType)
    .eq('status', 'pending')
    .maybeSingle();
  if (duplicateError) throw new DatabaseError(duplicateError.message);
  if (duplicate) throw new ValidationError('A pending PartSentry review request already exists for this log and request_type');

  const currentValue = currentValueForLog(log);
  const insertPayload = {
    partsentry_log_id: log.id,
    vin: log.vin,
    request_type: requestType,
    requested_value: requestedValue,
    current_value: currentValue,
    status: 'pending',
    requested_by: actor.id,
    requested_by_role: actor.role,
    requested_by_tenant_id: actor.tenantId,
    evidence_ids: evidenceIds,
    partsentry_log_ids: [String(log.id)],
    reason,
  };

  await logRequiredAudit(supabaseClient, {
    ...auditBase({
      requestContext,
      actor,
      log,
      requestType,
      previousValue: currentValue,
      newValue: requestedValue,
      evidenceIds,
      reason,
    }),
    event_type: 'PARTSENTRY_REVIEW_REQUESTED',
  });

  const { data: inserted, error } = await supabaseClient
    .from('partsentry_review_requests')
    .insert(insertPayload)
    .select('*')
    .single();
  if (error) throw new DatabaseError(error.message);

  return sanitizeRequest(inserted);
}

export async function listPartSentryReviewQueue(supabaseClient, actorInput, filters = {}) {
  const actor = actorContext(actorInput);
  if (actor.role !== 'admin') {
    throw new ForbiddenError('Only admin reviewers can access the PartSentry review queue in Phase 2B.1');
  }

  let query = supabaseClient
    .from('partsentry_review_requests')
    .select('id, partsentry_log_id, vin, request_type, requested_value, current_value, status, requested_by_role, requested_by_tenant_id, reviewed_by_role, reviewed_by_tenant_id, evidence_ids, partsentry_log_ids, reason, decision_notes, created_at, reviewed_at, revoked_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const status = filters.status || 'pending';
  if (status && REVIEW_STATUSES.includes(status)) query = query.eq('status', status);
  if (filters.vin) query = query.eq('vin', filters.vin);
  if (filters.request_type || filters.requestType) query = query.eq('request_type', filters.request_type || filters.requestType);
  if (filters.partsentry_log_id || filters.logId) query = query.eq('partsentry_log_id', normalizeLogId(filters.partsentry_log_id || filters.logId));

  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return (data || []).map(sanitizeRequest);
}

export async function approvePartSentryReviewRequest(supabaseClient, actorInput, requestId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const request = await loadRequest(supabaseClient, requestId);
  if (request.status !== 'pending') throw new ValidationError('Only pending PartSentry review requests can be approved');

  const log = await loadPartSentryLog(supabaseClient, request.partsentry_log_id);
  if (log.vin !== request.vin) throw new ValidationError('PartSentry log VIN does not match review request VIN');
  assertReviewPermission(actor, log, request.request_type, 'approve', { ...payload, reason: decisionNotes });

  if (request.request_type === 'public_card_eligible' && isActiveSuspicion(log.suspicion_status)) {
    throw new ValidationError('public_card_eligible approval is blocked while suspicion_status is watch or flagged');
  }

  if (
    request.request_type === 'part_verification_status' &&
    request.requested_value?.part_verification_status !== 'verified'
  ) {
    const evidenceRows = await loadEvidenceRows(supabaseClient, log.vin, request.evidence_ids);
    if (evidenceRows.length && evidenceRows.some(row => row.verification_status !== 'verified')) {
      throw new ValidationError('PartSentry approval evidence must be verified when provided');
    }
  } else {
    await validatePartSentryEvidenceForApproval(supabaseClient, log, request.request_type, request.evidence_ids, actor);
  }

  const previousValue = currentValueForLog(log);
  const logPatch = patchForApproval(request.request_type, request.requested_value);
  const newValue = { ...request.requested_value, partsentry_log_patch: logPatch };
  const baseAudit = auditBase({
    requestContext,
    actor,
    log,
    requestType: request.request_type,
    previousValue,
    newValue,
    evidenceIds: request.evidence_ids,
    reason: payload.reason || decisionNotes,
    decisionNotes,
    requestId: request.id,
  });

  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: 'PARTSENTRY_REVIEW_APPROVED' });
  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: fieldEventForApproval(request.request_type, request.requested_value) });

  await updatePartSentryLog(supabaseClient, log.id, logPatch);
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
    .from('partsentry_review_requests')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('partsentry_log_id', log.id)
    .eq('request_type', request.request_type)
    .eq('status', 'pending')
    .neq('id', request.id);

  return { request: sanitizeRequest(updated) };
}

export async function rejectPartSentryReviewRequest(supabaseClient, actorInput, requestId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const request = await loadRequest(supabaseClient, requestId);
  if (request.status !== 'pending') throw new ValidationError('Only pending PartSentry review requests can be rejected');
  const log = await loadPartSentryLog(supabaseClient, request.partsentry_log_id);

  assertReviewPermission(actor, log, request.request_type, 'reject', { ...payload, reason: decisionNotes });

  const baseAudit = auditBase({
    requestContext,
    actor,
    log,
    requestType: request.request_type,
    previousValue: request.current_value,
    newValue: request.requested_value,
    evidenceIds: request.evidence_ids,
    reason: payload.reason || decisionNotes,
    decisionNotes,
    requestId: request.id,
  });

  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: 'PARTSENTRY_REVIEW_REJECTED' });
  const fieldEvent = fieldEventForRejection(request.request_type);
  if (fieldEvent !== 'PARTSENTRY_REVIEW_REJECTED') {
    await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: fieldEvent });
  }

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

export async function revokePartSentryReviewRequest(supabaseClient, actorInput, requestId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const request = await loadRequest(supabaseClient, requestId);
  if (request.status !== 'approved') throw new ValidationError('Only approved PartSentry review requests can be revoked');
  const log = await loadPartSentryLog(supabaseClient, request.partsentry_log_id);

  assertReviewPermission(actor, log, request.request_type, 'revoke', { ...payload, reason: decisionNotes });

  const previousValue = currentValueForLog(log);
  const logPatch = patchForRevocation(request.request_type);
  const newValue = Object.keys(logPatch).length ? { partsentry_log_patch: logPatch } : { revoked_request_type: request.request_type };
  const baseAudit = auditBase({
    requestContext,
    actor,
    log,
    requestType: request.request_type,
    previousValue,
    newValue,
    evidenceIds: request.evidence_ids,
    reason: payload.reason || decisionNotes,
    decisionNotes,
    requestId: request.id,
  });

  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: 'PARTSENTRY_REVIEW_REVOKED' });
  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: fieldEventForRevocation(request.request_type) });

  await updatePartSentryLog(supabaseClient, log.id, logPatch);
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

export async function flagPartSentrySuspicion(supabaseClient, actorInput, logId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const suspicionStatus = String(payload.suspicion_status || payload.suspicionStatus || 'flagged');
  if (!['watch', 'flagged'].includes(suspicionStatus)) {
    throw new ValidationError('flag-suspicion requires suspicion_status watch or flagged');
  }

  const log = await loadPartSentryLog(supabaseClient, logId);
  assertReviewPermission(actor, log, 'suspicion_status', 'approve', { ...payload, reason: decisionNotes });
  const previousValue = currentValueForLog(log);
  const logPatch = { suspicion_status: suspicionStatus, public_card_eligible: false };
  const newValue = { suspicion_status: suspicionStatus, partsentry_log_patch: logPatch };
  const baseAudit = auditBase({
    requestContext,
    actor,
    log,
    requestType: 'suspicion_status',
    previousValue,
    newValue,
    evidenceIds: asArray(payload.evidence_ids || payload.evidenceIds),
    reason: payload.reason || decisionNotes,
    decisionNotes,
  });

  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: 'PARTSENTRY_SUSPICION_FLAGGED' });
  await updatePartSentryLog(supabaseClient, log.id, logPatch);

  return { log: sanitizeLog({ ...log, ...logPatch }) };
}

export async function clearPartSentrySuspicion(supabaseClient, actorInput, logId, payload = {}, requestContext = {}) {
  const actor = actorContext(actorInput);
  const decisionNotes = requireReason(payload.decision_notes || payload.decisionNotes || payload.reason, 'decision_notes or reason is required');
  const log = await loadPartSentryLog(supabaseClient, logId);
  assertReviewPermission(actor, log, 'suspicion_status', 'approve', { ...payload, reason: decisionNotes });
  const previousValue = currentValueForLog(log);
  const logPatch = { suspicion_status: 'none' };
  const newValue = { suspicion_status: 'none', partsentry_log_patch: logPatch };
  const baseAudit = auditBase({
    requestContext,
    actor,
    log,
    requestType: 'suspicion_status',
    previousValue,
    newValue,
    evidenceIds: asArray(payload.evidence_ids || payload.evidenceIds),
    reason: payload.reason || decisionNotes,
    decisionNotes,
  });

  await logRequiredAudit(supabaseClient, { ...baseAudit, event_type: 'PARTSENTRY_SUSPICION_CLEARED' });
  await updatePartSentryLog(supabaseClient, log.id, logPatch);

  return { log: sanitizeLog({ ...log, ...logPatch }) };
}

export async function getPartSentryReviewAuditTrail(supabaseClient, actorInput, vin) {
  const actor = actorContext(actorInput);
  if (actor.role !== 'admin') {
    throw new ForbiddenError('Only admin reviewers can access the PartSentry audit trail in Phase 2B.1');
  }

  const { data, error } = await supabaseClient
    .from('trust_audit_events')
    .select('id, event_type, vin, trust_fact, previous_value, new_value, actor_role, actor_type, source_route, evidence_ids, partsentry_log_ids, reason, decision_notes, request_id, created_at')
    .eq('vin', vin)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new DatabaseError(error.message);

  return (data || [])
    .filter(row => (row.partsentry_log_ids || []).length || String(row.event_type || '').startsWith('PARTSENTRY') || String(row.event_type || '').startsWith('PART_'))
    .map(row => ({
      id: row.id,
      event_type: row.event_type,
      vin: row.vin,
      request_type: row.trust_fact,
      previous_value: row.previous_value,
      new_value: row.new_value,
      actor_role: row.actor_role,
      actor_type: row.actor_type,
      source_route: row.source_route,
      evidence_ids: row.evidence_ids || [],
      partsentry_log_ids: row.partsentry_log_ids || [],
      reason: row.reason,
      decision_notes: row.decision_notes,
      request_id: row.request_id,
      created_at: row.created_at,
    }));
}

export async function getPartSentryLogForReview(supabaseClient, actorInput, logId) {
  const actor = actorContext(actorInput);
  if (actor.role !== 'admin') {
    throw new ForbiddenError('Only admin reviewers can access PartSentry review logs in Phase 2B.1');
  }
  const log = await loadPartSentryLog(supabaseClient, logId);
  return sanitizeLog(log);
}
