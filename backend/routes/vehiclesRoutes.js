import express from 'express';
import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { DatabaseError, ValidationError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { logAuditEvent } from '../services/auditLogger.js';
// ONE public-evidence authority. #175 shipped a deliberately self-contained
// `publicEvidenceProjection.js` so a security hotfix would not depend on this unmerged programme;
// with both landed, keeping two allow-lists for the same rows is how they drift. Its invariants —
// the withheld-private state, `source_id`, `isPrivateEvidenceArtifact` and `publicAiSummary` — now
// live in the canonical module, and that module is retired.
//
// `isPrivateEvidenceFallbackAllowed` (not the looser `isUserIdFallbackAllowed`) is retained: an
// environment inference must not authorise a private-document capability.
import { authorizeRole, isPrivateEvidenceFallbackAllowed } from '../middleware/authMiddleware.js';
import { requireAuthenticationAssurance } from '../middleware/stepUpMiddleware.js';
import { ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
import {
  toPublicEvidence,
  toPublicTimelineEvent,
  isPrivateEvidenceArtifact,
  publicAiSummary,
} from '../utils/publicVehicleProjection.js';
import { uploadToStorage, generateSecureReadUrl } from '../services/storage/storageService.js';
import { refreshCanonicalTrust } from '../services/trustDecision/canonicalTrustService.js';
import {
  buildAiReadyMetadata,
  canUploadEvidenceRecord,
  checksumForBuffer,
  evidenceStatusTrustImpact,
  evidenceToTimelineItem,
  evidenceTypeLabel,
  isDocumentUpload,
  resolveEvidenceVisibility,
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
import {
  semanticClassificationLabel,
  isSellerAuthorityCandidateRow,
} from '../services/evidence/evidenceTaxonomy.js';
import {
  submitSellerClaim,
  reviewSellerAuthority,
  getSellerAuthorityState,
  isSellerAuthorityEffectivelyDenied,
  toPublicSellerAuthorityStatement,
  SellerAuthorityError,
  SELLER_AUTHORITY_CLAIM_EVENT as SELLER_AUTHORITY_CLAIM_EVENT_NAME,
} from '../services/seller/sellerAuthorityService.js';
import {
  correctEvidenceClassification,
  ClassificationCorrectionError,
} from '../services/evidence/evidenceClassificationCorrectionService.js';
import { withUploadIdempotency } from '../services/evidence/uploadIdempotency.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';
import {
  OPERATIONS_CAPABILITIES,
  hasOperationsCapability,
  requireOperationsCapability,
} from '../services/operations/operationsAuthorizationService.js';
import { getSourceByCode } from '../services/evidence/sourceRegistryService.js';
import { evaluateCompleteness } from '../services/evidence/completenessEvaluator.js';
import { notifyEvidenceReviewDecided } from '../services/evidence/evidenceReviewNotifier.js';
import {
  isVehicleQuarantinedStatus,
  isVehicleRestoredToMarketplaceStatus,
  normalizeVehicleStatus
} from '../utils/vehicleStatus.js';
import {
  emitListingPublished,
  emitListingSold,
  emitPriceChanged,
} from '../services/intelligence/marketplaceActivityEmitters.js';

const router = express.Router();

// Seller Authority is governed by the canonical service (Operations M2):
// backend/services/seller/sellerAuthorityService.js. The claim event name and
// the claimant upload bypass below preserve the historical contract; evidence
// semantics are canonical-aware (M1) — a verified ownership/registration
// DOCUMENT or the permanent-import purchase-chain set, never an arbitrary row
// whose legacy field happens to say 'registration_document'.
const SELLER_AUTHORITY_CLAIM_EVENT = SELLER_AUTHORITY_CLAIM_EVENT_NAME;

async function latestSellerAuthorityClaim(vin, userId) {
  if (!vin || !userId) return null;
  const { data, error } = await supabase
    .from('trust_audit_events')
    .select('id, created_at, new_value')
    .eq('event_type', SELLER_AUTHORITY_CLAIM_EVENT)
    .eq('vin', vin)
    .eq('actor_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to read Seller authority claim: ${error.message}`);
  return data || null;
}

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
    .select('status, owner_id, current_seller_id, tenant_id')
    .eq('vin', vin)
    .single();

  if (vehicleErr || !vehicle) throw new NotFoundError('Vehicle not found');

  // Add ownership/scope check:
  // If not admin, the user must own the vehicle (owner_id matches req.userContext.id) OR
  // belong to the tenant dealership (tenant_id matches req.userContext.tenantId)
  if (req.userContext.role !== 'admin') {
    const isOwner = vehicle.owner_id === req.userContext.id;
    const isCurrentSeller = vehicle.current_seller_id && vehicle.current_seller_id === req.userContext.id;
    const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === req.userContext.tenantId;
    if (!isOwner && !isCurrentSeller && !isDealerTenant) {
      throw new ForbiddenError('Forbidden. You do not have owner, current-seller, or organizational scope over this vehicle.');
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
  
  if (String(afterStatus).toLowerCase() === 'sold' && String(beforeStatus).toLowerCase() !== 'sold') {
    emitListingSold({ req, vin, fromStatus: beforeStatus, toStatus: afterStatus }).catch(() => {});
  }

  res.json({ success: true, vin, status: afterStatus });
}));

// --- PUBLICATION LIFECYCLE ---
// The marketplace read path shows publication_status = 'published' and NOTHING else
// (PUBLICLY_VISIBLE_PUBLICATION_STATUSES in utils/vehicleStatus.js). This comment used to name
// 'publishable' as visible too, which would have made unpublish a no-op for public discovery;
// it never was, and the constant is the authority. Publishing is a deliberate seller action gated
// on the deterministic completeness evaluator; unpublishing returns the listing to 'publishable'
// — off the public surface, still the seller's — without touching availability status.
// Scope rules mirror the status PATCH above.

async function loadScopedVehicle(req, vin) {
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('vin, status, publication_status, owner_id, current_seller_id, tenant_id, price, currency')
    .eq('vin', vin)
    .single();
  if (vehicleErr || !vehicle) throw new NotFoundError('Vehicle not found');
  if (req.userContext.role !== 'admin') {
    const isOwner = vehicle.owner_id === req.userContext.id;
    const isCurrentSeller = vehicle.current_seller_id && vehicle.current_seller_id === req.userContext.id;
    const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === req.userContext.tenantId;
    if (!isOwner && !isCurrentSeller && !isDealerTenant) {
      throw new ForbiddenError('Forbidden. You do not have owner, current-seller, or organizational scope over this vehicle.');
    }
    // A completed ownership transfer away ENDS seller control, whichever clause above would have
    // granted it. This matters most for the tenant clause: the transfer RPC clears
    // current_seller_id/type/source but deliberately leaves `vehicles.tenant_id` alone, so a
    // previous dealer-organisation relationship physically outlives the sale. Without this, a
    // former owner could still publish, unpublish, or reprice a vehicle they no longer own.
    // The canonical owner short-circuits inside the predicate, so the ordinary path adds no query.
    const denial = await isSellerAuthorityEffectivelyDenied(supabase, {
      vin,
      userId: req.userContext.id,
      vehicle,
    });
    if (denial.denied) {
      throw new ForbiddenError(
        'Forbidden. Your seller authority over this vehicle has ended (ownership transferred or authority revoked).',
      );
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
    // The gate itself is unchanged — this stays a 400 and the vehicle stays draft.
    //
    // What changed is DISCLOSURE. `evaluateCompleteness` splits unmet blocking requirements into two
    // disjoint buckets: `blocking_gaps` (status 'missing') and `pending_gaps` (status
    // 'pending_review'). Golden B's only unmet requirement is an ownership document that HAS been
    // uploaded and is awaiting review, so it lands in `pending_gaps` and `blocking_gaps` is `[]`.
    // Publishing only the empty array left the owner with a refusal that named nothing — the
    // physical UAT saw exactly the generic sentence below and no requirement at all.
    //
    // Both buckets are published, plus the blocking requirements with their statuses, so a client can
    // distinguish "you have not supplied this" from "we have not finished reviewing it". Only labels
    // and statuses travel; no reviewer identity, file path or storage locator.
    return res.status(400).json({
      error: 'Listing is not publishable yet. Resolve the blocking requirements first.',
      is_publishable: false,
      blocking_gaps: completeness.blocking_gaps ?? [],
      pending_gaps: completeness.pending_gaps ?? [],
      requirements: (completeness.requirements ?? [])
        .filter((r) => r.blocking)
        // Operations M3: `who_must_act` / `refusal_category` let the refusal
        // distinguish missing-from-seller, awaiting CarUp review, awaiting an
        // external authority, conflict and policy blocks. Still labels and
        // statuses only — no reviewer identity, file path or storage locator.
        .map((r) => ({
          key: r.key,
          label: r.label,
          status: r.status,
          blocking: true,
          ...(r.who_must_act ? { who_must_act: r.who_must_act } : {}),
          ...(r.refusal_category ? { refusal_category: r.refusal_category } : {}),
        })),
      completeness_percent: completeness.completeness_percent ?? null,
    });
  }

  const { error } = await supabase
    .from('vehicles')
    .update({ publication_status: 'published' })
    .eq('vin', vin);
  if (error) throw new DatabaseError(error.message);

  // Publication is the moment CarUp asserts a public position, so it is where the derived position
  // must be made current. Without this, a listing goes public carrying a Trust conclusion computed
  // BEFORE its present facts: the real UAT vehicle GFC27-027051 published
  // "Zimbabwe registration stage has not been established from a recorded claim" while its own
  // claim block simultaneously reported the stage as recorded from a seller declaration. One
  // payload, two contradictory sentences, because the stamp predated the stage being recorded.
  //
  // This invents nothing and reviews nothing. refreshCanonicalTrust is the single canonical writer
  // (INV-TRUST-2) and recomputes ONLY the derived stamp from facts already recorded by governed
  // paths. It is deliberately best-effort and placed AFTER the state change, exactly as at evidence
  // review: the publication decision is the durable fact, the stamp is derived and can always be
  // re-materialized, so a refresh failure must never refuse a legitimate publication.
  try {
    await refreshCanonicalTrust(vin);
  } catch (trustError) {
    console.warn('[Trust] publication refresh failed:', trustError?.message || trustError);
  }

  auditPublicationChange(req, vin, 'VEHICLE_LISTING_PUBLISHED', vehicle.publication_status, 'published');
  emitListingPublished({
    req,
    vin,
    fromStatus: vehicle.publication_status,
    toStatus: 'published',
  }).catch(() => {});
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

// --- PRICE ---
// S8 completes the seller lifecycle: publish, unpublish and mark-sold already worked without a
// database write, but PRICE did not, so correcting one meant a direct DB intervention — exactly
// what the phase gate forbids.
//
// Deliberately narrow. This route moves the AMOUNT and nothing else:
//
//   · It does not accept a currency. Redenominating an existing listing is not a price change:
//     it would turn 28,500 of one currency into 28,500 of another with nobody restating the
//     vehicle. Currency is stated once, at creation, by the seller who was asked for it, and it
//     carries its own provenance stamp that this route has no basis to re-issue.
//   · It does not touch status, publication_status or trust. A cheaper car is not a more available
//     one, and it is certainly not a more verified one.
//   · It refuses a missing, non-numeric, zero or negative amount rather than coercing it. `price`
//     carries no column default, so a coerced 0 would publish a free car — the same fabrication the
//     read paths already refuse on the way out.
router.patch('/api/vehicles/:vin/price', authorizeRole(['owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
  const { vin } = req.params;
  const vehicle = await loadScopedVehicle(req, vin);

  const submitted = req.body?.price;
  const price = typeof submitted === 'number' ? submitted : Number.NaN;
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({
      error: 'price must be a positive number. A missing or zero price is not a price a seller stated.',
    });
  }

  const before = vehicle.price;
  if (before === price) {
    return res.json({ success: true, vin, price, unchanged: true });
  }

  const { error } = await supabase
    .from('vehicles')
    .update({ price })
    .eq('vin', vin);
  if (error) throw new DatabaseError(error.message);

  // "The price changed" is not a record of what changed. Both ends travel.
  try {
    logAuditEvent({
      req,
      actorId: req.userContext?.id || 'unknown',
      actorRole: req.userContext?.role || 'unknown',
      action: 'VEHICLE_PRICE_CHANGED',
      targetType: 'vehicle',
      targetId: vin,
      status: 'success',
      metadata: { beforePrice: before ?? null, afterPrice: price },
      severity: 'info',
    });
  } catch (auditErr) {
    console.warn('[Audit Log Error] Failed to log price change:', auditErr.message);
  }

  emitPriceChanged({
    req,
    vin,
    oldPrice: before,
    newPrice: price,
    currency: vehicle.currency || null,
  }).catch(() => {});

  res.json({ success: true, vin, price, previous_price: before ?? null });
}));

// --- SELLER → EXISTING PASSPORT AUTHORITY HANDOFF ---
// One VIN has one Passport. Encountering an existing VIN never permits a second vehicle row.
// Governed by the canonical sellerAuthorityService (Operations M2): recognition
// never rewrites ownership, claims are idempotent and audited fail-closed, and
// the evidence shortcut is canonical-aware.
router.post('/api/vehicles/:vin/seller-claim', authorizeRole(['owner', 'dealer']), asyncHandler(async (req, res) => {
  const vin = String(req.params.vin || '').trim().toUpperCase();
  const claimType = String(req.body?.claim_type || '').trim().toLowerCase();

  let result;
  try {
    result = await submitSellerClaim(supabase, {
      vin,
      claimType,
      userContext: req.userContext,
      requestContext: {
        requestId: req.requestId || req.headers['x-request-id'] || null,
        sourceRoute: '/api/vehicles/:vin/seller-claim',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });
  } catch (err) {
    if (err instanceof SellerAuthorityError) {
      if (err.code === 'SELLER_AUTHORITY_CLAIM_INVALID') throw new ValidationError(err.message);
      if (err.code === 'SELLER_AUTHORITY_VEHICLE_NOT_FOUND') throw new NotFoundError(err.message);
      throw new DatabaseError(err.message);
    }
    throw err;
  }

  if (result.status === 'recognized') {
    return res.json({ success: true, ...result });
  }
  return res.status(202).json({ success: true, ...result });
}));

// --- SELLER AUTHORITY STATE (Operations M2) ---
// A reviewer (admin/government — capability-bounded from M5) may inspect any
// seller's authority state; everyone else sees only their own.
router.get('/api/vehicles/:vin/seller-authority', authorizeRole(), asyncHandler(async (req, res) => {
  const vin = String(req.params.vin || '').trim().toUpperCase();
  const isReviewer = ['admin', 'government'].includes(req.userContext.role);
  const requestedSellerId = String(req.query.seller_user_id || '').trim() || null;
  const sellerUserId = isReviewer && requestedSellerId ? requestedSellerId : req.userContext.id;
  if (!isReviewer && requestedSellerId && requestedSellerId !== req.userContext.id) {
    throw new ForbiddenError('You may only view your own seller authority state.');
  }

  try {
    const state = await getSellerAuthorityState(supabase, {
      vin,
      sellerUserId,
      sellerTenantId: sellerUserId === req.userContext.id ? (req.userContext.tenantId || null) : null,
    });
    return res.json({
      success: true,
      vin,
      seller_user_id: sellerUserId,
      status: state.status,
      basis: state.basis,
      claim_type: state.claim_type,
      evidence_ids: state.evidence_ids,
      policy_version: state.policy_version,
      decided_at: state.decided_at,
      // Reviewer-only attribution; a seller does not need the reviewer's identity.
      ...(isReviewer ? { decided_by: state.decided_by, reason: state.reason } : {}),
      public_statement: toPublicSellerAuthorityStatement(state),
    });
  } catch (err) {
    if (err instanceof SellerAuthorityError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    throw err;
  }
}));

// --- GOVERNED SELLER AUTHORITY REVIEW DECISION (Operations M2) ---
// Reviewer roles mirror evidence verify/reject; the M5 Operations capability
// policy enforces the bounded capability and a proven session on top.
// No self-approval; audited fail-closed in the service.
router.post(
  '/api/vehicles/:vin/seller-authority/review',
  authorizeRole(['admin', 'government'], { allowUserIdFallback: false }),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.SELLER_AUTHORITY_REVIEW),
  // O2-X3: an authority-changing reviewer decision — recent step-up required on top of the
  // capability; neither substitutes for the other.
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
  const vin = String(req.params.vin || '').trim().toUpperCase();
  const sellerUserId = String(req.body?.seller_user_id || '').trim();
  if (!sellerUserId) throw new ValidationError('seller_user_id is required');

  try {
    const result = await reviewSellerAuthority(supabase, {
      vin,
      sellerUserId,
      sellerTenantId: req.body?.seller_tenant_id || null,
      decision: String(req.body?.decision || '').trim(),
      reason: req.body?.reason,
      actor: {
        id: req.userContext.id,
        role: req.userContext.role,
        tenantId: req.userContext.tenantId || null,
      },
      requestContext: {
        requestId: req.requestId || req.headers['x-request-id'] || null,
        sourceRoute: '/api/vehicles/:vin/seller-authority/review',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });

    // Tell the seller through the canonical notification fabric (best-effort:
    // the decision is already durable + audited). Safe payload only — the
    // public decision wording, never reviewer identity or restricted evidence.
    emitDomainEvent(null, 'seller.authority.decided', {
      vin,
      recipientUserId: sellerUserId,
      decision: result.public_statement,
      listingId: vin,
    }, req.userContext.tenantId || null).catch((err) => {
      console.warn('[seller-authority] outbox emit failed:', err.message);
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof SellerAuthorityError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    throw err;
  }
}));

// --- PASSPORT EVIDENCE ARCHITECTURE ROUTING ---

const allowedVisibilities = ['public_safe', 'restricted', 'private', 'government_only'];

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
  const isCurrentSeller = vehicle.current_seller_id && vehicle.current_seller_id === userContext.id;
  const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === userContext.tenantId;
  if (!isOwner && !isCurrentSeller && !isDealerTenant) {
    throw new ForbiddenError('Forbidden. You do not have owner, current-seller, or organizational scope over this vehicle.');
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

  if (!canUploadEvidenceRecord(normalized, activeRole)) {
    const label = normalized.explicitCanonical
      ? `${normalized.evidenceClass}/${normalized.evidenceSubtype}`
      : normalized.evidenceType;
    throw new ForbiddenError(`Forbidden. Role '${activeRole}' is not authorized to upload '${label}'`);
  }

  try {
    assertEvidenceOwnershipScope(vehicle, req.userContext);
  } catch (scopeError) {
    // A claimant may contribute ONLY documents that can prove seller authority:
    // ownership/registration documents or the permanent-import purchase chain
    // (canonical semantics, Operations M2). This does not change
    // vehicles.owner_id or grant general owner evidence access.
    const isAuthorityCandidate = isSellerAuthorityCandidateRow({
      evidence_type: normalized.evidenceType,
      evidence_class: normalized.evidenceClass,
      evidence_subtype: normalized.evidenceSubtype,
    });
    const claim = isAuthorityCandidate
      ? await latestSellerAuthorityClaim(vin, activeUserId)
      : null;
    if (!claim) throw scopeError;
    // A historical claim event is not a permanent upload grant. `latestSellerAuthorityClaim` reads
    // the newest SELLER_AUTHORITY_CLAIM_REQUESTED event with no state, no expiry and no ownership
    // re-check, so any claim a former owner ever filed would otherwise let them keep pushing
    // authority-candidate documents onto a Passport they no longer hold — documents that then feed
    // the very evidence checks this correction is closing.
    const claimantDenial = await isSellerAuthorityEffectivelyDenied(supabase, {
      vin,
      userId: activeUserId,
      vehicle,
    });
    if (claimantDenial.denied) throw scopeError;
  }

  const requestedVisibility = req.body.visibility_level || req.body.visibilityLevel || null;
  if (requestedVisibility && !allowedVisibilities.includes(requestedVisibility)) {
    throw new ValidationError(`Invalid visibility level: ${requestedVisibility}`);
  }

  // Canonical-aware default: any document artifact (canonical subtype flag or legacy document type)
  // defaults to restricted; photos default public_safe.
  //
  // Publishing a source document is a GOVERNED decision, not an uploader preference. That default
  // was never a control: the request body won outright, so an uploader could hand back
  // 'public_safe' for a document the taxonomy had just defaulted to restricted — and the web
  // uploader did exactly that, initialising the field to 'public_safe' for every artifact. The real
  // Serena's Tanzania T1 reached staging published that way, from a provenance chain whose only
  // event is the owner's own upload. No reviewer ever made that publication decision, which is
  // precisely the seller self-certification §3.11/G7 forbid. A client-side default is not a control;
  // the server has to be the one that decides.
  //
  // The rule is one-directional. Requesting a MORE restrictive level than the server default is
  // always honoured — withholding more is never a privacy risk. Requesting a MORE public one is
  // honoured only for an actor holding the evidence-review capability, which no seller has. Anyone
  // else is clamped back to the default rather than refused, because the artifact itself is
  // legitimate and losing the upload would punish the seller for a client's choice; the refusal is
  // recorded on the row instead, so it is visible to review rather than silent.
  const { visibility: visibilityLevel, refused: visibilityRefused } = resolveEvidenceVisibility({
    requested: requestedVisibility,
    isDocument: isDocumentUpload(normalized),
    mayPublish: hasOperationsCapability(req.userContext, OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_REVIEW),
  });

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
    bucketName = (isDocumentUpload(normalized) || isPrivate) ? 'ocr-documents' : 'vehicle-images';
    const uploadResult = await uploadToStorage(bucketName, filePath, fileBuffer, mimeType);
    fileUrl = uploadResult;
  } else if (!isSupportedMimeType(mimeType)) {
    throw new ValidationError(`Unsupported file type: ${mimeType || 'unknown'}`);
  }

  if (!fileUrl) {
    throw new ValidationError('file_url is required');
  }

  // A STORAGE LOCATOR MUST BELONG TO THE VEHICLE IT IS FILED UNDER.
  //
  // The branch above derives `file_path` from the VIN and pins the bucket — but ONLY when the caller
  // uploads bytes (`req.body.file`). A remote-file create supplies `file_url` with no `file` key,
  // skips that block entirely, and previously kept the caller's own `file_path` and
  // `storage_bucket` verbatim. Ownership was checked on the ROW's vehicle, never on the OBJECT the
  // row pointed at.
  //
  // So an authenticated owner could file evidence against a vehicle they legitimately own while
  // pointing `file_path` at another vehicle's private document in `ocr-documents`, then read their
  // own row back and receive a valid one-hour signed URL for it. Ownership of the row is not
  // ownership of the artifact.
  //
  // Traversal and absolute paths are refused outright rather than normalised: a path that needs
  // normalising to look safe is a path this route should not be accepting.
  // Validate the EFFECTIVE locator, which is what the insert actually stores.
  //
  // The row is written with `file_path: filePath || fileUrl`, so guarding only an explicitly
  // supplied `file_path` left the fallback wide open: omit `file_path` entirely, put the victim's
  // object path in `file_url`, pick a document type so the bucket resolves to `ocr-documents`, and
  // the stored row points at someone else's private document with nothing having been checked.
  // The guard therefore runs on the same expression the insert uses.
  //
  // A remote https URL is not a bucket locator and is not what this check governs — only a
  // storage-relative path can address an object in our bucket, so absolute URLs are left alone here
  // and constrained by the bucket check below.
  const effectiveLocator = filePath || fileUrl;
  const looksLikeStoragePath = typeof effectiveLocator === 'string'
    && !/^[a-z][a-z0-9+.-]*:\/\//i.test(effectiveLocator);
  if (looksLikeStoragePath) {
    const requiredPrefix = `${vin.toUpperCase()}/`;
    const candidate = String(effectiveLocator);
    if (
      candidate.includes('..')
      || candidate.startsWith('/')
      || !candidate.toUpperCase().startsWith(requiredPrefix)
    ) {
      throw new ValidationError(
        `the evidence locator must be scoped to this vehicle: expected it to begin with "${requiredPrefix}"`,
      );
    }
  }

  // The bucket is a server decision, not a caller assertion: letting a caller name `ocr-documents`
  // is what turns a public-image create into a private-document reference the read path will sign.
  if (bucketName) {
    const expectedBucket = (isDocumentUpload(normalized)
      || ['private', 'restricted', 'government_only'].includes(visibilityLevel))
      ? 'ocr-documents'
      : 'vehicle-images';
    if (bucketName !== expectedBucket) {
      throw new ValidationError(
        `storage_bucket "${bucketName}" does not match this evidence type and visibility (expected "${expectedBucket}")`,
      );
    }
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

  // A clamped publication request is recorded, never silently dropped: review needs to see that an
  // uploader asked for a wider audience than their authority allows, and a stale client that keeps
  // asking should be visible rather than invisible.
  if (visibilityRefused) {
    metadata.visibility_request_refused = {
      requested: requestedVisibility,
      applied: visibilityLevel,
      reason: 'publishing a source document is a governed decision; uploader lacks evidence review capability',
    };
  }

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
    storage_bucket: bucketName || (isDocumentUpload(normalized) ? 'ocr-documents' : 'vehicle-images'),
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

  // IDENTITY — a header is a CLAIM, not a credential.
  //
  // Three independent holes are closed here, and each was sufficient on its own:
  //   1. the session lookup accepted a row on `is_valid` alone, so an EXPIRED token still
  //      authenticated. Measured on staging: 874 sessions carry is_valid = true and exactly ONE is
  //      genuinely unexpired. `authMiddleware` has always also checked `expires_at`; this route was
  //      the outlier.
  //   2. `x-user-id` was taken as identity outright, bypassing `isUserIdFallbackAllowed()` — the
  //      policy every other entry point honours (false in production/staging, true only for
  //      local/test harnesses). One header was therefore a complete authentication bypass:
  //      `x-user-id: <some owner id>` on a vehicle whose only document was still PENDING returned
  //      that row plus a one-hour signed URL into the private bucket.
  //   3. tenancy came from `x-tenant-id` — attacker-controlled — and was then compared against the
  //      vehicle's own `tenant_id` to grant access. `users` has no `tenant_id` column, so the
  //      authentic source is the `tenant_users` membership table, read for the AUTHENTICATED user.
  const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
  let activeUserId = null;
  let activeUserRole = null;
  let activeTenantIds = [];

  if (sessionToken) {
    const { data: session } = await supabase
      .from('user_sessions')
      .select('user_id, is_valid, expires_at')
      .eq('token', sessionToken)
      .single();
    if (session && session.is_valid && new Date(session.expires_at) >= new Date()) {
      activeUserId = session.user_id;
    }
  }

  if (!activeUserId && req.headers['x-user-id'] && isPrivateEvidenceFallbackAllowed()) {
    activeUserId = req.headers['x-user-id'];
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

    const { data: memberships } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', activeUserId);
    activeTenantIds = (memberships || []).map((m) => m.tenant_id).filter(Boolean);
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
    // `Boolean(vehicle.tenant_id && ...)` so a NULL-tenant vehicle cannot be unlocked by a caller
    // who also has no tenant: `null === null` would otherwise authorize everyone.
    Boolean(vehicle.tenant_id && activeTenantIds.includes(vehicle.tenant_id));

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

  // RESPONSE — the raw row never leaves this route, and a signed URL is a capability, not a field.
  //
  // `select('*')` above returns all 54 columns. Returning that verbatim published
  // `plate_number`, `normalized_plate_number`, `chassis_number` and `engine_number` — the exact
  // identifiers the passport withholds as "Not shown publicly" — alongside `uploaded_by`,
  // `verified_by`, `tenant_id`, `verification_notes`, `file_path` and `storage_bucket`. An
  // unauthorised caller now receives the governed `PUBLIC_EVIDENCE_FIELDS` projection instead,
  // the same allow-list the passport already uses, so the two surfaces cannot drift apart.
  //
  // The signed URL is minted ONLY for a reader this route actually authorised. It was previously
  // generated for every `ocr-documents` row regardless of the caller, which handed anyone holding
  // a VIN a one-hour bearer token to a registration document, police clearance or insurance
  // certificate. `visibility_level` is a reviewer's metadata label and is NOT an access decision:
  // a row mislabelled `public_safe` must still not export a private file.
  const enrichedEvidence = [];
  const hasAdminAccess = ['admin', 'government', 'reviewer'].includes(activeUserRole);
  for (const item of (evidence || [])) {
    const enriched = normalizeEvidenceRecord(item);
    const isPrivateArtifact = isPrivateEvidenceArtifact(item);

    // Captured BEFORE the sanitation below, which deletes `metadata.ai_analysis` IN PLACE:
    // `normalizeEvidenceRecord` is a shallow copy, so `enriched.metadata` IS `item.metadata`.
    const aiSummary = publicAiSummary(item);

    if (isAuthorized && isPrivateArtifact && item.file_path) {
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

    if (isAuthorized) {
      enrichedEvidence.push(enriched);
      continue;
    }

    const projected = toPublicEvidence(enriched);
    if (aiSummary) projected.metadata = { ai_public_summary: aiSummary };
    enrichedEvidence.push(projected);
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

  // THIS ROUTE HAS NO AUTHENTICATION AT ALL, SO EVERY BYTE HERE IS PUBLIC.
  //
  // It was the SECOND DOOR to the same leak: both arrays were built from `select('*')` and returned
  // essentially verbatim, so appending `/timeline` to the URL yielded the full 54-column row even
  // after the sibling route was closed. Deleting `metadata.ai_analysis` was the only sanitation and
  // it addressed none of the identifier columns.
  //
  // The `timeline[]` array leaked INDEPENDENTLY of `evidence[]`: `evidenceToTimelineItem` sets
  // `desc` to the REVIEWER'S FREE TEXT (`verification_notes`), `details.uploadedBy` to an internal
  // identity, and carries `metadata` — which holds `ai_ready.vehicle_identity`: vin, plate, chassis
  // and engine — straight up onto the event.
  const publicEvidence = (evidence || []).map((item) => {
    const enriched = normalizeEvidenceRecord(item);
    const aiSummary = publicAiSummary(item);
    const projected = toPublicEvidence(enriched);
    if (aiSummary) projected.metadata = { ai_public_summary: aiSummary };
    return projected;
  });

  const timeline = (evidence || []).map((item) => {
    const aiSummary = publicAiSummary(item);
    const event = evidenceToTimelineItem(normalizeEvidenceRecord(item));

    // `evidenceToTimelineItem` is shared with authorised callers, so it is sanitised HERE rather
    // than narrowed for everyone.
    event.desc = `${(item.evidence_class && semanticClassificationLabel(item)) || evidenceTypeLabel(item.evidence_type)} reviewed and verified by CarUp`;
    event.details = {
      capturedAt: item.captured_at,
      uploadedAt: item.uploaded_at,
      checksum: item.checksum || item.image_hash,
      linkedRegistryEventId: item.linked_registry_event_id,
    };
    event.metadata = aiSummary ? { ai_public_summary: aiSummary } : {};
    if (isPrivateEvidenceArtifact(item)) event.file_url = null;

    return toPublicTimelineEvent(event);
  });

  res.json({ vin, timeline, evidence: publicEvidence });
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

  // Tenant scoping applies to every tenant-bound review role, FAIL CLOSED:
  // only admin and government review globally; a dealer/mechanic session with
  // no tenant context gets nothing (previously, omitting the tenant header
  // skipped the filter entirely and exposed every tenant's pending evidence).
  if (['dealer', 'mechanic'].includes(req.userContext.role)) {
    if (!req.userContext.tenantId) {
      return res.json([]);
    }
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

  // Evidence review is what CHANGES the governed facts, so it is where the canonical position is
  // re-materialized. This was calculateVehicleTrustScore — the deprecated 70-baseline engine and an
  // unversioned writer of the cache column. refreshCanonicalTrust is the single canonical writer;
  // it stamps the score with the rules that produced it, so the surfaces can publish it at all.
  // A refresh failure must not fail the review itself: the evidence decision is the durable fact,
  // the cache is derived and can be re-materialized.
  try {
    await refreshCanonicalTrust(vin);
  } catch (trustError) {
    console.error(`[issue-164] canonical trust refresh failed for ${vin}:`, trustError.message);
  }

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

  // Tell the submitter the outcome through the notification fabric (best-effort).
  await notifyEvidenceReviewDecided({
    vin,
    evidenceId,
    decision: 'verified',
    recipientUserId: updated?.uploaded_by || evidence.uploaded_by || null,
    tenantId: updated?.tenant_id || evidence.tenant_id || null,
  });

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

  // Evidence review is what CHANGES the governed facts, so it is where the canonical position is
  // re-materialized. This was calculateVehicleTrustScore — the deprecated 70-baseline engine and an
  // unversioned writer of the cache column. refreshCanonicalTrust is the single canonical writer;
  // it stamps the score with the rules that produced it, so the surfaces can publish it at all.
  // A refresh failure must not fail the review itself: the evidence decision is the durable fact,
  // the cache is derived and can be re-materialized.
  try {
    await refreshCanonicalTrust(vin);
  } catch (trustError) {
    console.error(`[issue-164] canonical trust refresh failed for ${vin}:`, trustError.message);
  }

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

  // Tell the submitter the outcome through the notification fabric (best-effort).
  await notifyEvidenceReviewDecided({
    vin,
    evidenceId,
    decision: 'rejected',
    recipientUserId: updated?.uploaded_by || evidence.uploaded_by || null,
    tenantId: updated?.tenant_id || evidence.tenant_id || null,
  });

  res.json({ success: true, evidence: normalizeEvidenceRecord(updated) });
}));

// PATCH: Governed classification correction (Operations Control Plane M1).
// Corrects ONLY the canonical evidence_class/evidence_subtype through the
// bounded, audited service — never an arbitrary field PATCH. Reviewer roles
// mirror verify/reject; the M5 Operations capability policy enforces the
// bounded capability and a proven session on top.
router.patch(
  '/api/vehicles/:vin/evidence/:evidenceId/classification',
  authorizeRole(['admin', 'government'], { allowUserIdFallback: false }),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_CLASSIFY),
  asyncHandler(async (req, res) => {
  const vin = String(req.params.vin || '').trim().toUpperCase();
  const { evidenceId } = req.params;
  try {
    const result = await correctEvidenceClassification(supabase, {
      vin,
      evidenceId,
      evidenceClass: req.body.evidence_class || req.body.evidenceClass,
      evidenceSubtype: req.body.evidence_subtype || req.body.evidenceSubtype,
      // Optional. Correcting what a record IS and correcting how widely it is published are the
      // same governed act over the same row, so they share one reason, one audit event and one
      // history entry rather than needing a second endpoint.
      visibilityLevel: req.body.visibility_level || req.body.visibilityLevel || null,
      reason: req.body.reason,
      actor: {
        id: req.userContext.id,
        role: req.userContext.role,
        tenantId: req.userContext.tenantId || null,
      },
      requestContext: {
        requestId: req.requestId || req.headers['x-request-id'] || null,
        sourceRoute: '/api/vehicles/:vin/evidence/:evidenceId/classification',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ClassificationCorrectionError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    throw err;
  }
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
    .select('owner_id, current_seller_id, tenant_id')
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
    const isCurrentSeller = vehicle.current_seller_id && vehicle.current_seller_id === activeUserId;
    const isDealerTenant = vehicle.tenant_id && vehicle.tenant_id === activeTenantId;
    if (!isOwner && !isCurrentSeller && !isDealerTenant) {
      throw new ForbiddenError('Forbidden. You do not have owner, current-seller, or organizational scope to link evidence.');
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
