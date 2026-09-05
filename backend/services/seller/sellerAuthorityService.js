/**
 * Canonical Seller Authority service — Operations Control Plane M2.
 *
 * Answers ONE question as a governed CarUp policy decision (Truth level 3):
 *
 *   Does this Seller have sufficient reviewed authority to offer this vehicle
 *   on CarUp?
 *
 * It deliberately does NOT answer "has Zimbabwe local registration been
 * completed?" — that lives in services/registration/zimbabweRegistrationLifecycle.
 * A permanent import may hold confirmed Seller Authority while local
 * registration is still pending (G16).
 *
 * This service EXTRACTS and hardens the pre-existing seller-claim flow
 * (vehiclesRoutes seller-claim + the inline server.js reuse check) rather than
 * creating a parallel system:
 *   - existing owner/current-seller/tenant recognition is preserved;
 *   - the evidence shortcut becomes canonical-aware (M1 semantics) instead of
 *     matching two legacy evidence_type strings;
 *   - claims and reviewer decisions now have a durable current state in
 *     vehicle_seller_authority, while trust_audit_events remains the decision
 *     history authority (audited FAIL-CLOSED before every state change);
 *   - no code path here ever mutates vehicles.owner_id / current_seller_id /
 *     tenant_id — one vehicle, one Passport.
 *
 * Public wording rule (M2.15): a confirmed state projects as
 * "Seller authority reviewed by CarUp" — never "legal title certified" and
 * never a CVR/ZIMRA claim.
 */
import {
  satisfiesOwnershipRegistrationRequirementRow,
  isSellerAuthorityCandidateRow,
  resolveSemanticClassification,
} from '../evidence/evidenceTaxonomy.js';

// LAZY on purpose: auditLogger top-level-imports backend/db/supabase.js, and
// this service sits on the completeness → trustDecision import chain that must
// stay importable WITHOUT Supabase env (client is always injected here; see
// issue164 Finding 3 fail-fast contract).
async function logAuditEvent(client, event) {
  const { logAuditEvent: realLogAuditEvent } = await import('../auditLogger.js');
  return realLogAuditEvent(client, event);
}

export const SELLER_AUTHORITY_POLICY_VERSION = 'seller_authority.v1';
export const SELLER_AUTHORITY_CLAIM_EVENT = 'SELLER_AUTHORITY_CLAIM_REQUESTED';
export const SELLER_AUTHORITY_REVIEW_EVENT = 'SELLER_AUTHORITY_REVIEWED';
export const SELLER_AUTHORITY_SUPERSEDED_EVENT = 'SELLER_AUTHORITY_SUPERSEDED';

export const SELLER_AUTHORITY_STATUSES = Object.freeze([
  'evidence_submitted',
  'under_review',
  'confirmed',
  'insufficient',
  'disputed',
  'revoked',
]);

/** Reviewer decisions that require an explicit reason. */
const DECISIONS_REQUIRING_REASON = new Set(['confirmed', 'insufficient', 'disputed', 'revoked']);

/** Import purchase-chain subtypes that can support a permanent-import authority basis. */
const IMPORT_AUTHORITY_SUBTYPES = new Set([
  'commercial_invoice',
  'payment_receipt',
  'bill_of_lading',
  'export_certificate',
]);

export class SellerAuthorityError extends Error {
  constructor(message, code = 'SELLER_AUTHORITY_INVALID', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalizeVin(vin) {
  return String(vin || '').trim().toUpperCase();
}

/** The vehicle's canonical relationship recognition — unchanged from the historical flow. */
export function hasExistingSellerRelationship(vehicle, userContext) {
  if (!vehicle || !userContext) return false;
  return Boolean(
    vehicle.owner_id === userContext.id
    || (vehicle.current_seller_id && vehicle.current_seller_id === userContext.id)
    || (vehicle.tenant_id && userContext.tenantId && vehicle.tenant_id === userContext.tenantId)
  );
}

/**
 * Canonical-aware replacement for the historical hasVerifiedSellerAuthorityEvidence:
 * a VERIFIED ownership/registration DOCUMENT uploaded by this user for this VIN.
 * (M1 semantics: a canonical import row never qualifies, regardless of its
 * legacy compatibility field; legacy-only historical rows keep qualifying.)
 */
export async function hasVerifiedOwnershipAuthorityEvidence(client, vin, userId) {
  if (!vin || !userId) return false;
  const { data, error } = await client
    .from('vehicle_evidence')
    .select('id, evidence_type, evidence_class, evidence_subtype')
    .eq('vin', normalizeVin(vin))
    .eq('uploaded_by', userId)
    .eq('verification_status', 'verified');
  if (error) {
    console.error('[SellerAuthority] evidence lookup failed:', error.message);
    return false; // fail closed — an unreadable ledger grants nothing
  }
  return (data || []).some((row) => satisfiesOwnershipRegistrationRequirementRow(row));
}

/**
 * Is this person a FORMER owner whose ownership has been superseded by a completed transfer?
 *
 * This is the registry-backed half of effective Seller authorization, and it is deliberately
 * INDEPENDENT of `vehicle_seller_authority`. The supersession write on transfer completion is
 * best-effort by design — legal ownership must stand even if that derived update fails — so if the
 * authority row were the only guard, a failed supersession would leave a stale `confirmed` row that
 * still authorized the previous owner. Asking the ownership ledger directly closes that window:
 * even with a stale row physically present, a completed transfer away denies.
 *
 * Fails CLOSED. An unreadable transfer ledger denies rather than grants, matching
 * `hasVerifiedOwnershipAuthorityEvidence`'s posture ("an unreadable ledger grants nothing").
 */
export async function hasSupersedingOwnershipTransfer(client, { vin, userId, vehicle = null } = {}) {
  const normalizedVin = normalizeVin(vin);
  if (!normalizedVin || !userId) return false;

  let vehicleRow = vehicle;
  if (!vehicleRow) {
    const { data, error } = await client
      .from('vehicles')
      .select('vin, owner_id')
      .eq('vin', normalizedVin)
      .maybeSingle();
    if (error) {
      console.error('[SellerAuthority] vehicle read failed during supersession check:', error.message);
      return true; // fail closed
    }
    vehicleRow = data;
  }
  // The canonical current owner has not been superseded by anything, whatever history holds.
  if (vehicleRow && vehicleRow.owner_id && vehicleRow.owner_id === userId) return false;

  const { data, error } = await client
    .from('vehicle_ownership_transfers')
    .select('id, state, previous_owner_id, completed_at')
    .eq('vin', normalizedVin)
    .eq('previous_owner_id', userId)
    .eq('state', 'complete');
  if (error) {
    console.error('[SellerAuthority] ownership transfer lookup failed:', error.message);
    return true; // fail closed — an unreadable ownership ledger must not authorize a former owner
  }
  return (data || []).length > 0;
}

/**
 * The EFFECTIVE authorization question: is this person denied Seller control of this vehicle,
 * whatever historical evidence or authority rows still exist?
 *
 * Encodes the precedence the lifecycle requires — canonical ownership and an explicit governed
 * refusal OUTRANK historical verified evidence:
 *
 *   1. a completed ownership transfer away from this person   -> DENY (registry-backed)
 *   2. an explicit `revoked` Seller Authority decision        -> DENY (governed refusal)
 *   3. otherwise                                              -> historical evidence may be considered
 *
 * A verified ownership document proves what was true when it was issued. It is not an immortal
 * permission token, and it must never outlive the ownership it described.
 */
export async function isSellerAuthorityEffectivelyDenied(client, { vin, userId, vehicle = null } = {}) {
  const normalizedVin = normalizeVin(vin);
  if (!normalizedVin || !userId) return { denied: false, reason: null };

  if (await hasSupersedingOwnershipTransfer(client, { vin: normalizedVin, userId, vehicle })) {
    return { denied: true, reason: 'ownership_transferred_away' };
  }

  const { data: row, error } = await client
    .from('vehicle_seller_authority')
    .select('status')
    .eq('vin', normalizedVin)
    .eq('seller_user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[SellerAuthority] authority read failed during denial check:', error.message);
    return { denied: true, reason: 'authority_unreadable' }; // fail closed
  }
  if (row?.status === 'revoked') {
    return { denied: true, reason: 'authority_revoked' };
  }
  return { denied: false, reason: null };
}

/**
 * Load this seller's verified authority-candidate evidence for the VIN,
 * partitioned by what it can support.
 */
async function loadVerifiedAuthorityEvidence(client, vin, userId) {
  const { data, error } = await client
    .from('vehicle_evidence')
    .select('id, evidence_type, evidence_class, evidence_subtype, uploaded_by, verification_status')
    .eq('vin', normalizeVin(vin))
    .eq('uploaded_by', userId)
    .eq('verification_status', 'verified');
  if (error) {
    throw new SellerAuthorityError(`Evidence read failed: ${error.message}`, 'SELLER_AUTHORITY_EVIDENCE_READ_FAILED', 500);
  }
  const rows = (data || []).filter((row) => isSellerAuthorityCandidateRow(row));
  const ownershipRegistration = rows.filter((row) => satisfiesOwnershipRegistrationRequirementRow(row));
  const importChain = rows.filter((row) => {
    const { evidence_class: cls, evidence_subtype: sub, semantic_source } = resolveSemanticClassification(row);
    return semantic_source === 'canonical' && cls === 'import' && IMPORT_AUTHORITY_SUBTYPES.has(sub);
  });
  return { all: rows, ownershipRegistration, importChain };
}

/**
 * Evaluate which policy basis the verified evidence can support, WITHOUT
 * deciding anything. Policy seller_authority.v1:
 *  - reviewed_ownership_registration_evidence: ≥1 verified ownership/registration document;
 *  - reviewed_permanent_import_evidence_set: ≥2 DISTINCT verified import
 *    purchase-chain documents (invoice / payment receipt / bill of lading /
 *    export certificate). A commercial invoice alone is insufficient.
 */
export function evaluateEvidenceBasis({ ownershipRegistration = [], importChain = [] }) {
  if (ownershipRegistration.length > 0) {
    return { basis: 'reviewed_ownership_registration_evidence', evidenceIds: ownershipRegistration.map((r) => r.id) };
  }
  const distinctSubtypes = new Set(importChain.map((r) => resolveSemanticClassification(r).evidence_subtype));
  if (distinctSubtypes.size >= 2) {
    return { basis: 'reviewed_permanent_import_evidence_set', evidenceIds: importChain.map((r) => r.id) };
  }
  return { basis: null, evidenceIds: [] };
}

/** Detect a conflicting canonical seller relationship held by SOMEONE ELSE. */
export function hasConflictingSellerRelationship(vehicle, sellerUserId, sellerTenantId = null) {
  if (!vehicle) return false;
  const ownedByOther = Boolean(vehicle.owner_id && vehicle.owner_id !== sellerUserId);
  const soldByOther = Boolean(vehicle.current_seller_id && vehicle.current_seller_id !== sellerUserId);
  const tenantOfOther = Boolean(vehicle.tenant_id && vehicle.tenant_id !== sellerTenantId);
  // A conflict exists only when EVERY recognized relationship belongs to another party.
  const anyOwnRelationship = hasExistingSellerRelationship(vehicle, { id: sellerUserId, tenantId: sellerTenantId });
  if (anyOwnRelationship) return false;
  return ownedByOther || soldByOther || tenantOfOther;
}

/**
 * Current Seller Authority state for (vin, seller).
 *
 * Precedence:
 *  1. An explicit governed decision row (confirmed / insufficient / disputed /
 *     revoked / under_review / evidence_submitted) — an explicit revocation or
 *     dispute OVERRIDES relationship recognition (fails closed).
 *  2. An existing canonical relationship → 'recognized' (existing_relationship).
 *  3. Otherwise 'not_assessed'.
 */
export async function getSellerAuthorityState(client, { vin, sellerUserId, sellerTenantId = null, vehicle = null }) {
  const normalizedVin = normalizeVin(vin);
  const { data: row, error } = await client
    .from('vehicle_seller_authority')
    .select('*')
    .eq('vin', normalizedVin)
    .eq('seller_user_id', sellerUserId)
    .maybeSingle();
  if (error) {
    throw new SellerAuthorityError(`Seller authority read failed: ${error.message}`, 'SELLER_AUTHORITY_READ_FAILED', 500);
  }

  let vehicleRow = vehicle;
  if (!vehicleRow) {
    const { data: v, error: vErr } = await client
      .from('vehicles')
      .select('vin, owner_id, current_seller_id, tenant_id')
      .eq('vin', normalizedVin)
      .maybeSingle();
    if (vErr) {
      throw new SellerAuthorityError(`Vehicle read failed: ${vErr.message}`, 'SELLER_AUTHORITY_VEHICLE_READ_FAILED', 500);
    }
    vehicleRow = v;
  }

  // EFFECTIVE authorization outranks the stored row. A completed ownership transfer away supersedes
  // whatever this table still says: the supersession write is best-effort (legal ownership must
  // stand even when it fails), so a stale `confirmed` row can physically survive a transfer. Reading
  // the ownership ledger here makes that stale row unusable rather than authoritative, and it also
  // strips the derived relationship — a former owner whose `current_seller_id` was never cleared
  // must not be "recognized" by leftover listing state.
  const denial = await isSellerAuthorityEffectivelyDenied(client, {
    vin: normalizedVin,
    userId: sellerUserId,
    vehicle: vehicleRow,
  });
  if (denial.denied && denial.reason !== 'authority_revoked') {
    return {
      status: 'revoked',
      basis: row?.basis ?? null,
      claim_type: row?.claim_type ?? null,
      evidence_ids: row?.evidence_ids || [],
      reason: row?.reason ?? null,
      policy_version: row?.policy_version ?? SELLER_AUTHORITY_POLICY_VERSION,
      decided_by: row?.decided_by ?? null,
      decided_at: row?.decided_at ?? null,
      existing_relationship: false,
      effective_denial_reason: denial.reason,
      stale_authority_row_status: row?.status ?? null,
      record: row || null,
    };
  }

  const relationship = hasExistingSellerRelationship(vehicleRow, { id: sellerUserId, tenantId: sellerTenantId });

  if (row) {
    return {
      status: row.status,
      basis: row.basis,
      claim_type: row.claim_type,
      evidence_ids: row.evidence_ids || [],
      reason: row.reason || null,
      policy_version: row.policy_version,
      decided_by: row.decided_by || null,
      decided_at: row.decided_at || null,
      existing_relationship: relationship,
      record: row,
    };
  }

  if (relationship) {
    return {
      status: 'recognized',
      basis: 'existing_relationship',
      claim_type: null,
      evidence_ids: [],
      reason: null,
      policy_version: SELLER_AUTHORITY_POLICY_VERSION,
      decided_by: null,
      decided_at: null,
      existing_relationship: true,
      record: null,
    };
  }

  return {
    status: 'not_assessed',
    basis: null,
    claim_type: null,
    evidence_ids: [],
    reason: null,
    policy_version: SELLER_AUTHORITY_POLICY_VERSION,
    decided_by: null,
    decided_at: null,
    existing_relationship: false,
    record: null,
  };
}

/**
 * Is this seller currently permitted to OFFER the vehicle on CarUp?
 * True for: existing relationship (not explicitly revoked/disputed) or a
 * confirmed governed decision. An explicit revoked/disputed/insufficient
 * decision fails closed even for a relationship holder.
 */
export function isSellerAuthoritySatisfied(state) {
  if (!state) return false;
  if (['revoked', 'disputed', 'insufficient'].includes(state.status)) return false;
  if (state.status === 'confirmed' || state.status === 'recognized') return true;
  // evidence_submitted / under_review / not_assessed: relationship still counts.
  return Boolean(state.existing_relationship);
}

/** Buyer-safe public wording (M2.15). Never claims legal title or CVR facts. */
export function toPublicSellerAuthorityStatement(state) {
  if (!state) return 'Seller authority not evaluated';
  switch (state.status) {
    case 'confirmed':
      return 'Seller authority reviewed by CarUp';
    case 'recognized':
      return 'Listed by the recorded CarUp seller';
    case 'under_review':
    case 'evidence_submitted':
      return 'Seller authority under CarUp review';
    case 'disputed':
      return 'Seller authority under dispute review';
    case 'revoked':
    case 'insufficient':
      return 'Seller authority not established';
    default:
      return 'Seller authority not evaluated';
  }
}

/**
 * Submit (or refresh) a seller-authority claim. Hardened extraction of the
 * historical POST /api/vehicles/:vin/seller-claim behavior:
 *  - recognized relationship or verified ownership/registration evidence →
 *    'recognized' response (no row needed — recognition is derived state);
 *  - otherwise an idempotent claim row (evidence_submitted) + the historical
 *    SELLER_AUTHORITY_CLAIM_REQUESTED audit event, written FAIL-CLOSED once
 *    per (vin, seller).
 */
export async function submitSellerClaim(client, { vin, claimType, userContext, requestContext = {} }) {
  const normalizedVin = normalizeVin(vin);
  if (!['owner', 'authorised_seller'].includes(claimType)) {
    throw new SellerAuthorityError("claim_type must be 'owner' or 'authorised_seller'", 'SELLER_AUTHORITY_CLAIM_INVALID', 400);
  }

  const { data: vehicle, error: vErr } = await client
    .from('vehicles')
    .select('vin, owner_id, current_seller_id, tenant_id')
    .eq('vin', normalizedVin)
    .maybeSingle();
  if (vErr) {
    throw new SellerAuthorityError(`Vehicle read failed: ${vErr.message}`, 'SELLER_AUTHORITY_VEHICLE_READ_FAILED', 500);
  }
  if (!vehicle) {
    throw new SellerAuthorityError('Vehicle Passport not found.', 'SELLER_AUTHORITY_VEHICLE_NOT_FOUND', 404);
  }

  // EFFECTIVE authorization precedes recognition. Without this, the canonical claim API answered a
  // former owner `recognized` for a vehicle they had already sold — on the strength of the same
  // historical registration document — and because recognition SHORT-CIRCUITS, no claim row and no
  // audit event were written, so the wrongful recognition was invisible to Operations too.
  const claimDenial = await isSellerAuthorityEffectivelyDenied(client, {
    vin: normalizedVin,
    userId: userContext.id,
    vehicle,
  });
  if (claimDenial.denied) {
    throw new SellerAuthorityError(
      'Seller authority over this vehicle has ended. A completed ownership transfer or a governed revocation supersedes earlier evidence; a new governed relationship is required.',
      'SELLER_AUTHORITY_SUPERSEDED',
      403
    );
  }

  if (hasExistingSellerRelationship(vehicle, userContext)) {
    return { status: 'recognized', recognition_basis: 'existing_relationship', vin: normalizedVin, claim_type: claimType };
  }
  if (await hasVerifiedOwnershipAuthorityEvidence(client, normalizedVin, userContext.id)) {
    return { status: 'recognized', recognition_basis: 'governed_verified_evidence', vin: normalizedVin, claim_type: claimType };
  }

  // Idempotent claim row: first write wins; a repeat claim returns the row.
  const { data: existingRow, error: rowErr } = await client
    .from('vehicle_seller_authority')
    .select('*')
    .eq('vin', normalizedVin)
    .eq('seller_user_id', userContext.id)
    .maybeSingle();
  if (rowErr) {
    throw new SellerAuthorityError(`Seller authority read failed: ${rowErr.message}`, 'SELLER_AUTHORITY_READ_FAILED', 500);
  }

  if (!existingRow) {
    // Audit FIRST, fail closed — the historical event contract is preserved.
    const audit = await logAuditEvent(client, {
      eventType: SELLER_AUTHORITY_CLAIM_EVENT,
      vin: normalizedVin,
      actorUserId: userContext.id,
      actorRole: userContext.role,
      actorTenantId: userContext.tenantId ?? null,
      actorType: 'user',
      newValue: { state: 'evidence_required', claim_type: claimType },
      sourceRoute: requestContext.sourceRoute ?? '/api/vehicles/:vin/seller-claim',
      requestId: requestContext.requestId ?? null,
      ipAddress: requestContext.ipAddress ?? null,
      userAgent: requestContext.userAgent ?? null,
      targetType: 'vehicle_seller_authority',
      targetId: `${normalizedVin}:${userContext.id}`,
    });
    if (!audit?.success) {
      throw new SellerAuthorityError(audit?.error || 'Seller authority claim could not be recorded.', 'SELLER_AUTHORITY_AUDIT_FAILED', 500);
    }

    const { error: insertErr } = await client
      .from('vehicle_seller_authority')
      .insert({
        vin: normalizedVin,
        seller_user_id: userContext.id,
        claim_type: claimType,
        status: 'evidence_submitted',
        policy_version: SELLER_AUTHORITY_POLICY_VERSION,
      });
    // A UNIQUE violation from a concurrent claim is benign — the claim exists.
    if (insertErr && !/duplicate|unique/i.test(insertErr.message || '')) {
      throw new SellerAuthorityError(`Seller authority claim write failed: ${insertErr.message}`, 'SELLER_AUTHORITY_WRITE_FAILED', 500);
    }
  }

  return {
    status: 'evidence_required',
    vin: normalizedVin,
    claim_type: claimType,
    next_action: 'upload_registration_or_ownership_transfer_evidence',
  };
}

/**
 * Governed reviewer decision on a seller-authority claim.
 *
 * Rules (G5/G6/M2.8–M2.13):
 *  - reviewer must be attributable and must NOT be the seller (no self-approval,
 *    admin included);
 *  - decisions carrying consequence require a reason;
 *  - 'confirmed' requires a valid policy basis: an existing relationship, OR a
 *    verified evidence basis under seller_authority.v1 — and is REFUSED while a
 *    conflicting canonical seller relationship held by someone else exists;
 *  - the decision is audited FAIL-CLOSED before the state changes; the previous
 *    state travels in the audit event (supersession history);
 *  - vehicles.* relationship columns are never touched.
 */
export async function reviewSellerAuthority(client, {
  vin,
  sellerUserId,
  sellerTenantId = null,
  decision,
  reason,
  actor,
  requestContext = {},
}) {
  const normalizedVin = normalizeVin(vin);
  if (!SELLER_AUTHORITY_STATUSES.includes(decision) || decision === 'evidence_submitted') {
    throw new SellerAuthorityError(`Invalid seller authority decision '${decision}'`, 'SELLER_AUTHORITY_DECISION_INVALID', 400);
  }
  if (!actor?.id || !actor?.role) {
    throw new SellerAuthorityError('An attributable reviewer is required', 'SELLER_AUTHORITY_UNATTRIBUTED', 403);
  }
  if (actor.id === sellerUserId) {
    throw new SellerAuthorityError('A seller cannot review their own authority claim', 'SELLER_AUTHORITY_SELF_REVIEW', 403);
  }
  if (DECISIONS_REQUIRING_REASON.has(decision) && !String(reason || '').trim()) {
    throw new SellerAuthorityError(`Decision '${decision}' requires a reason`, 'SELLER_AUTHORITY_REASON_REQUIRED', 400);
  }

  const { data: vehicle, error: vErr } = await client
    .from('vehicles')
    .select('vin, owner_id, current_seller_id, tenant_id')
    .eq('vin', normalizedVin)
    .maybeSingle();
  if (vErr) {
    throw new SellerAuthorityError(`Vehicle read failed: ${vErr.message}`, 'SELLER_AUTHORITY_VEHICLE_READ_FAILED', 500);
  }
  if (!vehicle) {
    throw new SellerAuthorityError('Vehicle Passport not found.', 'SELLER_AUTHORITY_VEHICLE_NOT_FOUND', 404);
  }

  const relationship = hasExistingSellerRelationship(vehicle, { id: sellerUserId, tenantId: sellerTenantId });

  // A reviewer may not CONFIRM authority for someone whose ownership has already been transferred
  // away. Confirming here would re-fabricate exactly the stale `confirmed` row this correction
  // exists to make unusable. Revoking or otherwise refusing them stays available.
  if (decision === 'confirmed') {
    const reviewDenial = await isSellerAuthorityEffectivelyDenied(client, {
      vin: normalizedVin,
      userId: sellerUserId,
      vehicle,
    });
    if (reviewDenial.denied && reviewDenial.reason === 'ownership_transferred_away') {
      throw new SellerAuthorityError(
        'This seller no longer holds the vehicle: a completed ownership transfer supersedes their authority. Confirming it would re-create a superseded claim.',
        'SELLER_AUTHORITY_SUPERSEDED',
        409
      );
    }
  }

  let basis = null;
  let evidenceIds = [];
  if (decision === 'confirmed') {
    if (hasConflictingSellerRelationship(vehicle, sellerUserId, sellerTenantId)) {
      throw new SellerAuthorityError(
        'Another party holds the canonical seller relationship for this vehicle. Resolve the conflict through the governed ownership/dispute workflow before confirming authority.',
        'SELLER_AUTHORITY_CONFLICT',
        409
      );
    }
    if (relationship) {
      basis = vehicle.tenant_id && vehicle.tenant_id === sellerTenantId && vehicle.owner_id !== sellerUserId
        ? 'dealer_tenant_inventory'
        : 'existing_relationship';
      // Evidence may still strengthen the record if present.
      const evidence = await loadVerifiedAuthorityEvidence(client, normalizedVin, sellerUserId);
      evidenceIds = evaluateEvidenceBasis(evidence).evidenceIds;
    } else {
      const evidence = await loadVerifiedAuthorityEvidence(client, normalizedVin, sellerUserId);
      const evaluated = evaluateEvidenceBasis(evidence);
      if (!evaluated.basis) {
        throw new SellerAuthorityError(
          'The verified evidence does not satisfy any Seller Authority basis under seller_authority.v1 (a commercial invoice alone is insufficient).',
          'SELLER_AUTHORITY_BASIS_INSUFFICIENT',
          422
        );
      }
      basis = evaluated.basis;
      evidenceIds = evaluated.evidenceIds;
    }
  }

  const { data: existingRow, error: rowErr } = await client
    .from('vehicle_seller_authority')
    .select('*')
    .eq('vin', normalizedVin)
    .eq('seller_user_id', sellerUserId)
    .maybeSingle();
  if (rowErr) {
    throw new SellerAuthorityError(`Seller authority read failed: ${rowErr.message}`, 'SELLER_AUTHORITY_READ_FAILED', 500);
  }

  const previousStatus = existingRow?.status ?? (relationship ? 'recognized' : 'not_assessed');
  const decidedAt = new Date().toISOString();

  // Audit FIRST, fail closed (G6). The audit ledger is the decision history.
  const audit = await logAuditEvent(client, {
    eventType: SELLER_AUTHORITY_REVIEW_EVENT,
    vin: normalizedVin,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorTenantId: actor.tenantId ?? null,
    actorType: 'user',
    previousValue: { status: previousStatus, basis: existingRow?.basis ?? null },
    newValue: { status: decision, basis, seller_user_id: sellerUserId, policy_version: SELLER_AUTHORITY_POLICY_VERSION },
    evidenceIds,
    reason: String(reason || '').trim() || null,
    sourceRoute: requestContext.sourceRoute ?? '/api/vehicles/:vin/seller-authority/review',
    requestId: requestContext.requestId ?? null,
    ipAddress: requestContext.ipAddress ?? null,
    userAgent: requestContext.userAgent ?? null,
    targetType: 'vehicle_seller_authority',
    targetId: `${normalizedVin}:${sellerUserId}`,
  });
  if (!audit?.success) {
    throw new SellerAuthorityError(audit?.error || 'Seller authority decision audit could not be recorded', 'SELLER_AUTHORITY_AUDIT_FAILED', 500);
  }

  const rowValues = {
    claim_type: existingRow?.claim_type ?? (vehicle.tenant_id && vehicle.tenant_id === sellerTenantId ? 'dealer' : 'owner'),
    status: decision,
    basis,
    evidence_ids: evidenceIds,
    reason: String(reason || '').trim() || null,
    policy_version: SELLER_AUTHORITY_POLICY_VERSION,
    decided_by: actor.id,
    decided_by_role: actor.role,
    decided_at: decidedAt,
    updated_at: decidedAt,
  };

  let updated;
  if (existingRow) {
    const { data, error } = await client
      .from('vehicle_seller_authority')
      .update(rowValues)
      .eq('id', existingRow.id)
      .select('*')
      .single();
    if (error) {
      throw new SellerAuthorityError(`Seller authority update failed: ${error.message}`, 'SELLER_AUTHORITY_WRITE_FAILED', 500);
    }
    updated = data;
  } else {
    const { data, error } = await client
      .from('vehicle_seller_authority')
      .insert({ vin: normalizedVin, seller_user_id: sellerUserId, ...rowValues })
      .select('*')
      .single();
    if (error) {
      throw new SellerAuthorityError(`Seller authority insert failed: ${error.message}`, 'SELLER_AUTHORITY_WRITE_FAILED', 500);
    }
    updated = data;
  }

  return {
    changed: true,
    previous_status: previousStatus,
    record: updated,
    public_statement: toPublicSellerAuthorityStatement({ status: decision }),
  };
}

/**
 * O2/P1 — a completed ownership transfer supersedes the PREVIOUS owner's authority.
 *
 * `passport_transition_ownership_transfer_atomic` changes `vehicles.owner_id`, but nothing touched
 * this table, so the former owner kept a standing `confirmed` authority over a vehicle they no
 * longer own (the gap M8 recorded against the reference implementation). Seller Authority
 * supersedes its OWN rows — the transfer service only invokes this; Operations is not involved.
 *
 * Deliberate properties:
 *   · Revocation, never deletion. The previous status/basis live on in the audit event exactly as
 *     for every other governed authority decision (audit FIRST, fail closed).
 *   · Idempotent: an already-revoked row, or no row, is a clean no-op — a governed re-run after a
 *     partial failure converges.
 *   · A `disputed` row is still superseded: a dispute about a vehicle you no longer own does not
 *     keep authority alive, and the dispute history remains in the ledger.
 *   · NOTHING is created for the incoming owner. Their owner relationship is now canonical via
 *     `vehicles.owner_id`; if they choose to list, the ordinary governed authority lifecycle
 *     applies. Fabricating a `confirmed` row for them would be fabricating a review.
 */
export async function supersedeSellerAuthorityOnOwnershipTransfer(client, {
  vin,
  previousOwnerId,
  transferId,
  actor,
  requestContext = {},
}) {
  const normalizedVin = normalizeVin(vin);
  if (!normalizedVin || !previousOwnerId || !transferId) {
    throw new SellerAuthorityError('vin, previousOwnerId and transferId are required', 'SELLER_AUTHORITY_SUPERSEDE_INVALID', 400);
  }
  if (!actor?.id || !actor?.role) {
    throw new SellerAuthorityError('An attributable actor is required', 'SELLER_AUTHORITY_UNATTRIBUTED', 403);
  }

  const { data: row, error: rowErr } = await client
    .from('vehicle_seller_authority')
    .select('*')
    .eq('vin', normalizedVin)
    .eq('seller_user_id', previousOwnerId)
    .maybeSingle();
  if (rowErr) {
    throw new SellerAuthorityError(`Seller authority read failed: ${rowErr.message}`, 'SELLER_AUTHORITY_READ_FAILED', 500);
  }
  if (!row || row.status === 'revoked') {
    return { changed: false, superseded: 0, previous_status: row?.status ?? null };
  }

  const decidedAt = new Date().toISOString();
  const reason = `superseded_by_ownership_transfer:${transferId}`;

  // Audit FIRST, fail closed (G6) — the supersession that cannot be attributed does not happen.
  const audit = await logAuditEvent(client, {
    eventType: SELLER_AUTHORITY_SUPERSEDED_EVENT,
    vin: normalizedVin,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorTenantId: actor.tenantId ?? null,
    actorType: 'user',
    previousValue: { status: row.status, basis: row.basis ?? null, seller_user_id: previousOwnerId },
    newValue: { status: 'revoked', basis: row.basis ?? null, seller_user_id: previousOwnerId, policy_version: SELLER_AUTHORITY_POLICY_VERSION },
    evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids : [],
    reason,
    sourceRoute: requestContext.sourceRoute ?? '/api/ownership-transfers/:transferId',
    requestId: requestContext.requestId ?? null,
    ipAddress: requestContext.ipAddress ?? null,
    userAgent: requestContext.userAgent ?? null,
    targetType: 'vehicle_seller_authority',
    targetId: `${normalizedVin}:${previousOwnerId}`,
  });
  if (!audit?.success) {
    throw new SellerAuthorityError(audit?.error || 'Seller authority supersession audit could not be recorded', 'SELLER_AUTHORITY_AUDIT_FAILED', 500);
  }

  const { data: updated, error: updateErr } = await client
    .from('vehicle_seller_authority')
    .update({
      status: 'revoked',
      reason,
      policy_version: SELLER_AUTHORITY_POLICY_VERSION,
      decided_by: actor.id,
      decided_by_role: actor.role,
      decided_at: decidedAt,
      updated_at: decidedAt,
    })
    .eq('id', row.id)
    .select('*')
    .single();
  if (updateErr) {
    throw new SellerAuthorityError(`Seller authority supersession failed: ${updateErr.message}`, 'SELLER_AUTHORITY_WRITE_FAILED', 500);
  }

  return { changed: true, superseded: 1, previous_status: row.status, record: updated };
}

export default {
  SELLER_AUTHORITY_POLICY_VERSION,
  SELLER_AUTHORITY_CLAIM_EVENT,
  SELLER_AUTHORITY_REVIEW_EVENT,
  SELLER_AUTHORITY_SUPERSEDED_EVENT,
  SELLER_AUTHORITY_STATUSES,
  SellerAuthorityError,
  hasExistingSellerRelationship,
  hasVerifiedOwnershipAuthorityEvidence,
  hasSupersedingOwnershipTransfer,
  isSellerAuthorityEffectivelyDenied,
  evaluateEvidenceBasis,
  hasConflictingSellerRelationship,
  getSellerAuthorityState,
  supersedeSellerAuthorityOnOwnershipTransfer,
  isSellerAuthoritySatisfied,
  toPublicSellerAuthorityStatement,
  submitSellerClaim,
  reviewSellerAuthority,
};
