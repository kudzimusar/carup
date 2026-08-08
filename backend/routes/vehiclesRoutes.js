import express from 'express';
import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { DatabaseError, ValidationError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { logAuditEvent } from '../services/auditLogger.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { uploadToStorage, generateSecureReadUrl } from '../services/storage/storageService.js';
import { calculateVehicleTrustScore } from '../services/trustGraph/trustGraphService.js';
import {
  buildAiReadyMetadata,
  canUploadEvidence,
  checksumForBuffer,
  documentEvidenceTypes,
  evidenceStatusTrustImpact,
  evidenceToTimelineItem,
  isDocumentEvidence,
  isSupportedMimeType,
  normalizeEvidenceRecord,
  parseBase64Payload,
  reviewRoles,
  verificationStatuses,
  validateEvidenceUploadPayload,
  buildEvidenceProvenanceColumns,
  recordEvidenceUploadProvenance,
  runAiAnalysis,
} from '../services/evidence/evidenceService.js';
import { withUploadIdempotency } from '../services/evidence/uploadIdempotency.js';
import { getSourceByCode } from '../services/evidence/sourceRegistryService.js';
import { evaluateCompleteness } from '../services/evidence/completenessEvaluator.js';
import {
  isVehicleQuarantinedStatus,
  isVehicleRestoredToMarketplaceStatus,
  normalizeVehicleStatus
} from '../utils/vehicleStatus.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- VEHICLE STATUS UPDATE ---
router.patch('/api/vehicles/:vin/status', authorizeRole(['admin', 'dealer', 'owner']), asyncHandler(async (req, res) => {
  const { vin } = req.params;
  const { status } = req.body;
  if (!status) throw new ValidationError('Status is required');
  
  const afterStatus = normalizeVehicleStatus(status);
  if (!afterStatus) throw new ValidationError('Invalid status');

  // Fetch current status and ownership details
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('status, owner_id, tenant_id')
    .eq('vin', vin)
    .single();

  if (vehicleErr || !vehicle) throw new NotFoundError('Vehicle not found');

  // Add ownership/scope check:
  // If not admin, the user must own the vehicle (owner_id matches req.userContext.id) OR
  // belong to the tenant dealership (tenant_id matches req.userContext.tenantId)
  if (req.userContext.role !== 'admin') {
    const isOwner = vehicle.owner_id === req.userContext.id;
    const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === req.userContext.tenantId;
    if (!isOwner && !isDealerTenant) {
      throw new ForbiddenError('Forbidden. You do not have ownership or organizational scope over this vehicle.');
    }
  }

  const beforeStatus = normalizeVehicleStatus(vehicle.status) || vehicle.status || 'unknown';

  const { error } = await supabase.from('vehicles').update({ status: afterStatus }).eq('vin', vin);
  if (error) throw new DatabaseError(error.message);

  // Centralized audit logging (Non-blocking, gracefully catch-all)
  try {
    const actorId = req.userContext?.id || req.userContext?.userId || 'u5';
    const actorRole = req.userContext?.role || 'admin';
    
    let action = 'VEHICLE_STATUS_CHANGED';
    let severity = 'info';

    if (isVehicleQuarantinedStatus(afterStatus)) {
      action = 'VEHICLE_QUARANTINED';
      severity = 'critical';
    } else if (isVehicleRestoredToMarketplaceStatus(afterStatus) && isVehicleQuarantinedStatus(beforeStatus)) {
      action = 'VEHICLE_RESTORED_TO_MARKETPLACE';
      severity = 'warning';
    }

    logAuditEvent({
      req,
      actorId,
      actorRole,
      action,
      targetType: 'vehicle',
      targetId: vin,
      status: 'success',
      metadata: { beforeStatus, afterStatus },
      severity
    });
  } catch (auditErr) {
    console.warn('[Audit Log Error] Failed to log vehicle status change:', auditErr.message);
  }
  
  res.json({ success: true, vin, status: afterStatus });
}));

// --- PUBLICATION LIFECYCLE ---
// The marketplace read path only shows publication_status in ('publishable','published').
// Publishing is a deliberate seller action gated on the deterministic completeness
// evaluator; unpublishing returns the listing to 'publishable' without touching
// availability status. Scope rules mirror the status PATCH above.

async function loadScopedVehicle(req, vin) {
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('vin, status, publication_status, owner_id, tenant_id')
    .eq('vin', vin)
    .single();
  if (vehicleErr || !vehicle) throw new NotFoundError('Vehicle not found');
  if (req.userContext.role !== 'admin') {
    const isOwner = vehicle.owner_id === req.userContext.id;
    const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === req.userContext.tenantId;
    if (!isOwner && !isDealerTenant) {
      throw new ForbiddenError('Forbidden. You do not have ownership or organizational scope over this vehicle.');
    }
  }
  return vehicle;
}

function auditPublicationChange(req, vin, action, before, after) {
  try {
    logAuditEvent({
      req,
      actorId: req.userContext?.id || 'unknown',
      actorRole: req.userContext?.role || 'unknown',
      action,
      targetType: 'vehicle',
      targetId: vin,
      status: 'success',
      metadata: { beforePublicationStatus: before, afterPublicationStatus: after },
      severity: 'info',
    });
  } catch (auditErr) {
    console.warn('[Audit Log Error] Failed to log publication change:', auditErr.message);
  }
}

router.post('/api/vehicles/:vin/publish', authorizeRole(['owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
  const { vin } = req.params;
  const vehicle = await loadScopedVehicle(req, vin);

  if (vehicle.publication_status === 'published') {
    return res.json({ success: true, vin, publication_status: 'published', already_published: true });
  }

  const completeness = await evaluateCompleteness(vin);
  if (!completeness.is_publishable) {
    return res.status(400).json({
      error: 'Listing is not publishable yet. Resolve the blocking requirements first.',
      is_publishable: false,
      blocking_gaps: completeness.blocking_gaps ?? [],
      completeness_percent: completeness.completeness_percent ?? null,
    });
  }

  const { error } = await supabase
    .from('vehicles')
    .update({ publication_status: 'published' })
    .eq('vin', vin);
  if (error) throw new DatabaseError(error.message);

  auditPublicationChange(req, vin, 'VEHICLE_LISTING_PUBLISHED', vehicle.publication_status, 'published');
  res.json({ success: true, vin, publication_status: 'published' });
}));

router.post('/api/vehicles/:vin/unpublish', authorizeRole(['owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
  const { vin } = req.params;
  const vehicle = await loadScopedVehicle(req, vin);

  if (vehicle.publication_status !== 'published') {
    return res.json({ success: true, vin, publication_status: vehicle.publication_status, already_unpublished: true });
  }

  const { error } = await supabase
    .from('vehicles')
    .update({ publication_status: 'publishable' })
    .eq('vin', vin);
  if (error) throw new DatabaseError(error.message);

  auditPublicationChange(req, vin, 'VEHICLE_LISTING_UNPUBLISHED', 'published', 'publishable');
  res.json({ success: true, vin, publication_status: 'publishable' });
}));

// --- PASSPORT EVIDENCE ARCHITECTURE ROUTING ---

const allowedVisibilities = ['public_safe', 'restricted', 'private', 'government_only'];

function evidenceDefaultVisibility(evidenceType) {
  return documentEvidenceTypes.includes(evidenceType) ? 'restricted' : 'public_safe';
}

function sanitizeFileExtension(mimeType) {
  const ext = String(mimeType || '').split('/')[1] || 'bin';
  return ext === 'jpeg' ? 'jpg' : ext.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

async function loadVehicleForEvidence(vin) {
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('*')
    .eq('vin', vin)
    .single();

  if (vehicleErr || !vehicle) {
    throw new NotFoundError('Vehicle not found');
  }

  return vehicle;
}

function assertEvidenceOwnershipScope(vehicle, userContext) {
  const activeRole = userContext.role;
  if (activeRole === 'admin' || activeRole === 'government') return;

  const isOwner = vehicle.owner_id === userContext.id;
  const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === userContext.tenantId;
  if (!isOwner && !isDealerTenant) {
    throw new ForbiddenError('Forbidden. You do not have ownership or organizational scope over this vehicle.');
  }
}

async function insertEvidenceFromRequest(req, vin, { requireVehicleId = false } = {}) {
  let normalized;
  try {
    normalized = validateEvidenceUploadPayload(req.body, { requireVehicleId });
  } catch (err) {
    throw new ValidationError(err.message);
  }
  const vehicleId = normalized.vehicleId || vin;

  if (!vehicleId) {
    throw new ValidationError('vehicle_id is required');
  }

  if (vehicleId !== vin) {
    throw new ValidationError('vehicle_id must match the vehicle route parameter');
  }

  const vehicle = await loadVehicleForEvidence(vin);
  const activeRole = req.userContext.role;
  const activeUserId = req.userContext.id;
  const activeTenantId = req.userContext.tenantId;

  if (!canUploadEvidence(normalized.evidenceType, activeRole)) {
    throw new ForbiddenError(`Forbidden. Role '${activeRole}' is not authorized to upload '${normalized.evidenceType}'`);
  }

  assertEvidenceOwnershipScope(vehicle, req.userContext);

  const visibilityLevel = req.body.visibility_level || req.body.visibilityLevel || evidenceDefaultVisibility(normalized.evidenceType);
  if (!allowedVisibilities.includes(visibilityLevel)) {
    throw new ValidationError(`Invalid visibility level: ${visibilityLevel}`);
  }

  let mimeType = req.body.mime_type || req.body.mimeType || null;
  let fileBuffer = null;
  let fileUrl = req.body.file_url || req.body.fileUrl || null;
  let filePath = req.body.file_path || req.body.filePath || null;
  let fileSize = Number(req.body.file_size || req.body.fileSize || 0);
  let checksum = req.body.checksum || req.body.image_hash || req.body.imageHash || null;
  let bucketName = req.body.storage_bucket || req.body.storageBucket || null;

  if (req.body.file) {
    let parsed;
    try {
      parsed = parseBase64Payload(req.body.file);
    } catch (err) {
      throw new ValidationError(err.message);
    }
    mimeType = parsed.mimeType;
    fileBuffer = parsed.fileBuffer;
    fileSize = fileBuffer.length;
    checksum = checksumForBuffer(fileBuffer);

    const fileExt = sanitizeFileExtension(mimeType);
    const randomString = crypto.randomBytes(6).toString('hex');
    filePath = `${vin.toUpperCase()}/${normalized.evidenceType}_${randomString}.${fileExt}`;

    const isPrivate = ['private', 'restricted', 'government_only'].includes(visibilityLevel);
    bucketName = (isDocumentEvidence(normalized.evidenceType) || isPrivate) ? 'ocr-documents' : 'vehicle-images';
    const uploadResult = await uploadToStorage(bucketName, filePath, fileBuffer, mimeType);
    fileUrl = uploadResult;
  } else if (!isSupportedMimeType(mimeType)) {
    throw new ValidationError(`Unsupported file type: ${mimeType || 'unknown'}`);
  }

  if (!fileUrl) {
    throw new ValidationError('file_url is required');
  }

  const metadata = buildAiReadyMetadata({
    metadata: normalized.metadata,
    evidenceType: normalized.evidenceType,
    eventType: normalized.eventType,
    mimeType,
    fileSize,
    checksum,
    vehicle
  });

  // WS-G: stamp the client idempotency key so a retried offline upload (same key) is
  // deduped after an app restart via the Supabase-metadata fallback. Accept it from the
  // standard header conventions OR the body, so any client convention dedupes correctly.
  const clientIdempotencyKey =
    req.headers['idempotency-key'] || req.headers['x-idempotency-key'] ||
    req.body.idempotency_key || req.body.idempotencyKey || null;
  if (clientIdempotencyKey) metadata.idempotency_key = clientIdempotencyKey;

  // Milestone 1: resolve the source registry entry (best-effort) and compute the
  // taxonomy + provenance columns (perceptual hash, event date, odometer, etc.).
  let resolvedSourceId = normalized.sourceId || null;
  if (!resolvedSourceId && normalized.sourceCode) {
    try {
      const source = await getSourceByCode(supabase, normalized.sourceCode);
      if (source) resolvedSourceId = source.id;
    } catch (err) {
      console.warn('[Source Registry] lookup failed:', err.message);
    }
  }
  const provenanceColumns = buildEvidenceProvenanceColumns(normalized, {
    fileBuffer,
    mimeType,
    checksum,
    resolvedSourceId,
  });

  const insertData = {
    vehicle_id: vin,
    vin,
    plate_number: vehicle.plate_number,
    normalized_plate_number: vehicle.normalized_plate_number,
    chassis_number: vehicle.chassis_number,
    engine_number: vehicle.engine_number,
    linked_registry_event_id: normalized.linkedRegistryEventId,
    timeline_event_id: normalized.linkedRegistryEventId,
    event_source: req.body.event_source || req.body.eventSource || normalized.eventType || null,
    event_type: normalized.eventType || req.body.event_source || req.body.eventSource || normalized.evidenceType,
    evidence_type: normalized.evidenceType,
    file_url: fileUrl,
    storage_bucket: bucketName || (isDocumentEvidence(normalized.evidenceType) ? 'ocr-documents' : 'vehicle-images'),
    file_path: filePath || fileUrl,
    mime_type: mimeType,
    file_size: fileSize,
    checksum,
    image_hash: checksum,
    uploaded_by: activeUserId,
    uploader_role: activeRole,
    tenant_id: activeTenantId || null,
    captured_at: req.body.captured_at || req.body.capturedAt || new Date().toISOString(),
    uploaded_at: new Date().toISOString(),
    visibility_level: visibilityLevel,
    verification_status: 'pending',
    verification_notes: req.body.verification_notes || req.body.verificationNotes || null,
    trust_score_impact: 0,
    trust_impact: 0,
    ...provenanceColumns,
    metadata
  };

  // WS-G: server-side upload idempotency. The same idempotency key never creates a
  // duplicate evidence row or provenance event; a retry returns the original.
  const { evidenceId, deduped } = await withUploadIdempotency(
    clientIdempotencyKey,
    vin,
    async () => {
      const { data: inserted, error: insertError } = await supabase
        .from('vehicle_evidence')
        .insert(insertData)
        .select('*')
        .single();
      if (insertError) throw new DatabaseError(insertError.message);

      // Milestone 1: record the immutable chain-of-custody "uploaded" event (best-effort).
      await recordEvidenceUploadProvenance(supabase, { evidence: inserted, req, eventType: 'uploaded' });

      // Trigger AI analysis asynchronously (non-blocking)
      runAiAnalysis(inserted.id, fileBuffer, mimeType, normalized.evidenceType, normalized.metadata).catch(err => {
        console.error('[AI Analysis Hook Error] Failed to launch background worker:', err.message);
      });
      return inserted;
    },
    { supabase },
  );

  const { data: record } = await supabase.from('vehicle_evidence').select('*').eq('id', evidenceId).single();
  return normalizeEvidenceRecord(record || { id: evidenceId, vin, _deduped: deduped });
}

// POST: Upload Evidence
router.post('/api/vehicles/:vin/evidence/upload', authorizeRole(), asyncHandler(async (req, res) => {
  const { vin } = req.params;
  const inserted = await insertEvidenceFromRequest(req, vin);

  // Audit Log
  try {
    logAuditEvent({
      req,
      actorId: req.userContext.id,
      actorRole: req.userContext.role,
      action: 'EVIDENCE_UPLOADED',
      targetType: 'evidence',
      targetId: inserted.id,
      status: 'success',
      metadata: { vin, evidenceType: inserted.evidence_type, visibilityLevel: inserted.visibility_level },
      severity: 'info'
    });
  } catch (auditErr) {
    console.warn('[Audit Log Error] Failed to log evidence upload:', auditErr.message);
  }

  res.status(201).json(inserted);
}));

router.post('/api/evidence/upload', authorizeRole(), asyncHandler(async (req, res) => {
  const vehicleId = req.body.vehicle_id || req.body.vehicleId || req.body.vin;
  if (!vehicleId) throw new ValidationError('vehicle_id is required');

  const inserted = await insertEvidenceFromRequest(req, vehicleId, { requireVehicleId: true });
  res.status(201).json(inserted);
}));

// GET: Fetch Evidence
router.get('/api/vehicles/:vin/evidence', asyncHandler(async (req, res) => {
  const { vin } = req.params;

  // Fetch session / identity if available (allow optional authentication)
  const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
  const fallbackUserId = req.headers['x-user-id'];
  let activeUserId = fallbackUserId || null;
  let activeUserRole = null;
  let activeTenantId = req.headers['x-tenant-id'] || null;

  if (sessionToken) {
    const { data: session } = await supabase
      .from('user_sessions')
      .select('user_id')
      .eq('token', sessionToken)
      .eq('is_valid', true)
      .single();
    if (session) {
      activeUserId = session.user_id;
    }
  }

  if (activeUserId) {
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('id', activeUserId)
      .single();
    if (user) {
      activeUserRole = user.role;
    }
  }

  // Fetch vehicle details to verify ownership
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('owner_id, tenant_id')
    .eq('vin', vin)
    .single();

  if (vehicleErr || !vehicle) {
    throw new NotFoundError('Vehicle not found');
  }

  const isAuthorized = 
    activeUserRole === 'admin' || 
    activeUserRole === 'government' || 
    (activeUserId && activeUserId === vehicle.owner_id) ||
    (activeTenantId && activeTenantId === vehicle.tenant_id);

  let query = supabase
    .from('vehicle_evidence')
    .select('*')
    .eq('vin', vin);

  if (!isAuthorized) {
    // Public guest user
    query = query.eq('visibility_level', 'public_safe').eq('verification_status', 'verified');
  } else if (activeUserRole === 'government') {
    query = query.in('visibility_level', ['public_safe', 'restricted', 'government_only']);
  } else if (activeUserRole === 'admin') {
    // Admin sees all, no filter on visibility level
  } else {
    // Owner or dealer tenant
    query = query.in('visibility_level', ['public_safe', 'restricted', 'private']);
  }

  const { data: evidence, error: fetchErr } = await query;
  if (fetchErr) {
    throw new DatabaseError(fetchErr.message);
  }

  // Generate timed read URLs for private bucket items
  const enrichedEvidence = [];
  const hasAdminAccess = ['admin', 'government', 'reviewer'].includes(activeUserRole);
  for (const item of (evidence || [])) {
    const enriched = normalizeEvidenceRecord(item);
    if (item.storage_bucket === 'ocr-documents' && item.file_path) {
      try {
        enriched.file_url = await generateSecureReadUrl('ocr-documents', item.file_path, 3600);
      } catch (err) {
        console.warn(`[Storage Warning] Failed to generate signed URL for evidence ${item.id}:`, err.message);
      }
    }
    // Sanitize AI analysis for non-admin roles
    if (!hasAdminAccess) {
      if (enriched.metadata && enriched.metadata.ai_analysis) {
        if (enriched.verification_status === 'verified' && enriched.metadata.ai_analysis.public_safe_summary) {
          enriched.metadata.ai_public_summary = enriched.metadata.ai_analysis.public_safe_summary;
        }
        delete enriched.metadata.ai_analysis;
      }
    }
    enrichedEvidence.push(enriched);
  }

  res.json(enrichedEvidence);
}));

router.get('/api/vehicles/:vin/evidence/timeline', asyncHandler(async (req, res) => {
  const { vin } = req.params;

  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('vin')
    .eq('vin', vin)
    .single();

  if (vehicleErr || !vehicle) {
    throw new NotFoundError('Vehicle not found');
  }

  const { data: evidence, error: fetchErr } = await supabase
    .from('vehicle_evidence')
    .select('*')
    .eq('vin', vin)
    .eq('visibility_level', 'public_safe')
    .eq('verification_status', 'verified')
    .order('captured_at', { ascending: true });

  if (fetchErr) {
    throw new DatabaseError(fetchErr.message);
  }

  const timeline = (evidence || []).map((item) => {
    const enriched = normalizeEvidenceRecord(item);
    if (enriched.metadata && enriched.metadata.ai_analysis) {
      if (enriched.verification_status === 'verified' && enriched.metadata.ai_analysis.public_safe_summary) {
        enriched.metadata.ai_public_summary = enriched.metadata.ai_analysis.public_safe_summary;
      }
      delete enriched.metadata.ai_analysis;
    }
    return evidenceToTimelineItem(enriched);
  });

  const sanitizedEvidence = (evidence || []).map((item) => {
    const enriched = normalizeEvidenceRecord(item);
    if (enriched.metadata && enriched.metadata.ai_analysis) {
      if (enriched.verification_status === 'verified' && enriched.metadata.ai_analysis.public_safe_summary) {
        enriched.metadata.ai_public_summary = enriched.metadata.ai_analysis.public_safe_summary;
      }
      delete enriched.metadata.ai_analysis;
    }
    return enriched;
  });

  res.json({ vin, timeline, evidence: sanitizedEvidence });
}));

router.get('/api/evidence/review', authorizeRole(reviewRoles), asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  if (!verificationStatuses.includes(status)) {
    throw new ValidationError(`Invalid verification status: ${status}`);
  }

  let query = supabase
    .from('vehicle_evidence')
    .select('*, vehicles!vehicle_evidence_vin_fkey(make, model, year, trust_score)')
    .eq('verification_status', status)
    .order('uploaded_at', { ascending: false })
    .limit(100);

  if (req.userContext.role === 'dealer' && req.userContext.tenantId) {
    query = query.eq('tenant_id', req.userContext.tenantId);
  }

  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);

  res.json((data || []).map(normalizeEvidenceRecord));
}));

// PATCH: Verify Evidence
router.patch('/api/vehicles/:vin/evidence/:evidenceId/verify', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const { vin, evidenceId } = req.params;
  const { notes, confidenceImpact } = req.body;
  const requestedTrustImpact = req.body.trust_score_impact ?? req.body.trustScoreImpact ?? req.body.trustImpact ?? 3;
  const trustScoreImpact = evidenceStatusTrustImpact('verified', requestedTrustImpact);

  const { data: evidence, error: evError } = await supabase
    .from('vehicle_evidence')
    .select('*')
    .eq('id', evidenceId)
    .eq('vin', vin)
    .single();

  if (evError || !evidence) {
    throw new NotFoundError('Evidence record not found matching this VIN');
  }

  const activeUserId = req.userContext.id;
  const activeRole = req.userContext.role;

  const { data: updated, error: updateErr } = await supabase
    .from('vehicle_evidence')
    .update({
      verification_status: 'verified',
      verification_notes: notes || null,
      verified_by: activeUserId,
      verified_at: new Date().toISOString(),
      trust_score_impact: trustScoreImpact,
      trust_impact: trustScoreImpact,
      confidence_impact: confidenceImpact || 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', evidenceId)
    .select('*')
    .single();

  if (updateErr) {
    throw new DatabaseError(updateErr.message);
  }

  // Recalculate trust score
  await calculateVehicleTrustScore(vin);

  // Audit Log
  try {
    await logAuditEvent(supabase, {
      req,
      event_type: 'EVIDENCE_VERIFIED',
      targetType: 'evidence',
      targetId: evidenceId,
      vin,
      evidence_ids: [evidenceId],
      previous_value: {
        verification_status: evidence.verification_status,
        verification_notes: evidence.verification_notes || null,
        trust_score_impact: evidence.trust_score_impact ?? null
      },
      new_value: {
        verification_status: 'verified',
        verification_notes: notes || null,
        trust_score_impact: trustScoreImpact,
        confidence_impact: confidenceImpact || 0
      },
      actor_user_id: activeUserId,
      actor_role: activeRole,
      actor_tenant_id: req.userContext.tenantId,
      source_route: '/api/vehicles/:vin/evidence/:evidenceId/verify',
      decision_notes: notes || null,
      metadata: { vin, evidenceType: evidence.evidence_type, trustScoreImpact, confidenceImpact }
    });
  } catch (auditErr) {
    console.warn('[Audit Log Error] Failed to log evidence verification:', auditErr.message);
  }

  res.json({ success: true, evidence: normalizeEvidenceRecord(updated) });
}));

// PATCH: Reject Evidence
router.patch('/api/vehicles/:vin/evidence/:evidenceId/reject', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const { vin, evidenceId } = req.params;
  const { notes } = req.body;
  const requestedTrustImpact = req.body.trust_score_impact ?? req.body.trustScoreImpact ?? req.body.trustImpact ?? -5;
  const trustScoreImpact = evidenceStatusTrustImpact('rejected', requestedTrustImpact);

  const { data: evidence, error: evError } = await supabase
    .from('vehicle_evidence')
    .select('*')
    .eq('id', evidenceId)
    .eq('vin', vin)
    .single();

  if (evError || !evidence) {
    throw new NotFoundError('Evidence record not found matching this VIN');
  }

  const activeUserId = req.userContext.id;
  const activeRole = req.userContext.role;

  const { data: updated, error: updateErr } = await supabase
    .from('vehicle_evidence')
    .update({
      verification_status: 'rejected',
      verification_notes: notes || null,
      verified_by: activeUserId,
      verified_at: new Date().toISOString(),
      trust_score_impact: trustScoreImpact,
      trust_impact: trustScoreImpact,
      updated_at: new Date().toISOString()
    })
    .eq('id', evidenceId)
    .select('*')
    .single();

  if (updateErr) {
    throw new DatabaseError(updateErr.message);
  }

  // Recalculate trust score
  await calculateVehicleTrustScore(vin);

  // Audit Log
  try {
    await logAuditEvent(supabase, {
      req,
      event_type: 'EVIDENCE_REJECTED',
      targetType: 'evidence',
      targetId: evidenceId,
      vin,
      evidence_ids: [evidenceId],
      previous_value: {
        verification_status: evidence.verification_status,
        verification_notes: evidence.verification_notes || null,
        trust_score_impact: evidence.trust_score_impact ?? null
      },
      new_value: {
        verification_status: 'rejected',
        verification_notes: notes || null,
        trust_score_impact: trustScoreImpact
      },
      actor_user_id: activeUserId,
      actor_role: activeRole,
      actor_tenant_id: req.userContext.tenantId,
      source_route: '/api/vehicles/:vin/evidence/:evidenceId/reject',
      reason: notes || null,
      decision_notes: notes || null,
      metadata: { vin, evidenceType: evidence.evidence_type, notes }
    });
  } catch (auditErr) {
    console.warn('[Audit Log Error] Failed to log evidence rejection:', auditErr.message);
  }

  res.json({ success: true, evidence: normalizeEvidenceRecord(updated) });
}));

// PATCH: Link Evidence to Event
router.patch('/api/vehicles/:vin/evidence/:evidenceId/link-event', authorizeRole(), asyncHandler(async (req, res) => {
  const { vin, evidenceId } = req.params;
  const timelineEventId = req.body.linked_registry_event_id || req.body.linkedRegistryEventId || req.body.timelineEventId;
  const eventSource = req.body.event_type || req.body.eventType || req.body.eventSource;

  if (!timelineEventId || !eventSource) {
    throw new ValidationError('Missing required parameters: linked_registry_event_id, event_type');
  }

  const { data: evidence, error: evError } = await supabase
    .from('vehicle_evidence')
    .select('*')
    .eq('id', evidenceId)
    .eq('vin', vin)
    .single();

  if (evError || !evidence) {
    throw new NotFoundError('Evidence record not found matching this VIN');
  }

  // Fetch vehicle details to verify ownership
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('owner_id, tenant_id')
    .eq('vin', vin)
    .single();

  if (vehicleErr || !vehicle) {
    throw new NotFoundError('Vehicle not found');
  }

  const activeUserId = req.userContext.id;
  const activeRole = req.userContext.role;
  const activeTenantId = req.userContext.tenantId;

  if (activeRole !== 'admin' && activeRole !== 'government') {
    const isOwner = vehicle.owner_id === activeUserId;
    const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === activeTenantId;
    if (!isOwner && !isDealerTenant) {
      throw new ForbiddenError('Forbidden. You do not have ownership scope to link evidence.');
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from('vehicle_evidence')
    .update({
      linked_registry_event_id: timelineEventId,
      timeline_event_id: timelineEventId,
      event_type: eventSource,
      event_source: eventSource,
      updated_at: new Date().toISOString()
    })
    .eq('id', evidenceId)
    .select('*')
    .single();

  if (updateErr) {
    throw new DatabaseError(updateErr.message);
  }

  // Audit Log
  try {
    logAuditEvent({
      req,
      actorId: activeUserId,
      actorRole: activeRole,
      action: 'EVIDENCE_LINKED_TO_EVENT',
      targetType: 'evidence',
      targetId: evidenceId,
      status: 'success',
      metadata: { vin, timelineEventId, eventSource },
      severity: 'info'
    });
  } catch (auditErr) {
    console.warn('[Audit Log Error] Failed to log evidence linkage:', auditErr.message);
  }

  res.json(normalizeEvidenceRecord(updated));
}));

export default router;
