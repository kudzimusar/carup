/**
 * Vehicle Completeness Evaluator — Operations Control Plane M3.
 *
 * Deterministically evaluates whether a vehicle satisfies CarUp publication
 * requirements and returns a requirement matrix plus a publishability verdict.
 *
 * THE QUESTIONS THIS GATE ASKS (manual §19):
 *   1. Is the vehicle identity sufficiently recorded?          (vin/chassis/engine)
 *   2. Is the Seller authorized to list under CarUp policy?    (seller_authority)
 *   3. Is the Zimbabwe registration stage truthfully recorded, (registration_readiness)
 *      and is that stage ordinarily listable?
 *   4. Does the lifecycle stage itself demand registration     (registration_evidence —
 *      evidence? Only locally_registered does; a permanent      only when required)
 *      import awaiting registration is NOT asked for a book it cannot have.
 *   5. Are there unresolved material document contradictions?  (fact_reconciliation)
 *   6. Is there a blocking risk condition?                     (risk_governance)
 *   7. Advisory evidence + governed finance disclosure remain non-blocking.
 *
 * THE QUESTION IT NO LONGER ASKS: "is there a verified legacy
 * registration_document / ownership_transfer_document row?" — that predicate let
 * an import invoice stored under a legacy compatibility value satisfy the
 * ownership/registration gate. Semantics are canonical (M1): a canonical import
 * artifact NEVER satisfies ownership/registration, whatever its legacy field.
 *
 * Seller Authority (M2) is its own governed dimension, distinct from Zimbabwe
 * registration: publication is satisfied by a CONFIRMED governed decision, or —
 * historical-parity path — an existing relationship together with a VERIFIED
 * ownership/registration document under canonical semantics. An explicit
 * revoked/disputed/insufficient decision fails closed even for a relationship
 * holder.
 *
 * AI confidence is NEVER consulted here: this evaluator is purely deterministic
 * and based on human-verified state (extraction reconciliation reads
 * match_status + review_status, never confidence).
 */
import { reconcileSellerFacts } from './sellerFactReconciliation.js';
import { getGovernedEncumbrance } from '../finance/vehicleFinanceObligationService.js';
import { evaluateZimbabweRegistrationReadiness } from '../registration/zimbabweRegistrationLifecycle.js';
import {
  satisfiesOwnershipRegistrationRequirementRow,
  isSellerAuthorityCandidateRow,
  isRegistrationEvidenceRow,
  isDocumentArtifactRow,
  resolveSemanticClassification,
} from './evidenceTaxonomy.js';
import { getSellerAuthorityState } from '../seller/sellerAuthorityService.js';

async function getDefaultClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

const VERIFIED_STATUSES = new Set(['verified', 'confirmed', 'approved']);
const PENDING_STATUSES  = new Set(['pending', 'submitted', 'under_review']);

const isVerifiedRow = (row) => VERIFIED_STATUSES.has(row.verification_status);
const isPendingRow = (row) => PENDING_STATUSES.has(row.verification_status) || !row.verification_status;

/**
 * Advisory evidence requirements. Keys keep their historical names (UI
 * contract), but matching is CANONICAL-FIRST: a canonically-classified row
 * counts for the requirement its life-stage meaning belongs to, and the legacy
 * types keep matching for historical rows.
 */
const ADVISORY_REQUIREMENTS = [
  {
    key: 'customs_photo',
    label: 'Customs Photo',
    matches: (row) => {
      const { evidence_class: cls, evidence_subtype: sub, semantic_source } = resolveSemanticClassification(row);
      if (semantic_source === 'canonical') {
        return cls === 'import' && ['customs_entry', 'duty_clearance_document'].includes(sub);
      }
      return row.evidence_type === 'customs_photo';
    },
  },
  {
    key: 'inspection_photo',
    label: 'Inspection Photo',
    matches: (row) => {
      const { evidence_class: cls, semantic_source } = resolveSemanticClassification(row);
      if (semantic_source === 'canonical') return cls === 'inspection';
      return row.evidence_type === 'inspection_photo';
    },
  },
  {
    key: 'insurance_document',
    label: 'Insurance Document',
    matches: (row) => {
      const { evidence_class: cls, evidence_subtype: sub, semantic_source } = resolveSemanticClassification(row);
      if (semantic_source === 'canonical') return cls === 'accident' && sub === 'insurer_assessment';
      return row.evidence_type === 'insurance_document';
    },
  },
  {
    key: 'police_clearance_document',
    label: 'Police Clearance Document',
    matches: (row) => {
      const { evidence_class: cls, evidence_subtype: sub, semantic_source } = resolveSemanticClassification(row);
      if (semantic_source === 'canonical') {
        return cls === 'registration' && sub === 'police_clearance_first_registration';
      }
      return row.evidence_type === 'police_clearance_document';
    },
  },
];

function advisoryStatus(rows, matches) {
  const matching = rows.filter(matches);
  if (matching.some(isVerifiedRow)) return 'verified';
  if (matching.some(isPendingRow)) return 'pending_review';
  return 'missing';
}

/**
 * Refusal taxonomy (manual §19 seller-facing refusal): every requirement carries
 * who must act next so a refusal can distinguish missing-from-seller, awaiting
 * CarUp review, awaiting an external authority, conflict, and policy blocks.
 */
const ACT = Object.freeze({
  SELLER: 'seller',
  CARUP_REVIEW: 'carup_review',
  EXTERNAL: 'external_authority',
  NONE: 'none',
});

/**
 * Evaluate publication completeness for a VIN.
 *
 * @param {string} vin
 * @returns {Promise<{
 *   vin: string,
 *   requirements: Array<{key, label, category, blocking, status, who_must_act?, refusal_category?}>,
 *   completeness_percent: number,
 *   is_publishable: boolean,
 *   blocking_gaps: Array<{key, label}>,
 *   pending_gaps: Array<{key, label}>,
 *   publication_status: string,
 *   reconciliation: object,  // S5 seller-facing read model; OWNER-SCOPED — see the privacy note below
 * }>}
 *
 * PRIVACY. `reconciliation` names document types and OCR readings, so it is seller-private. It is
 * safe on this return because the only caller that reaches a person —
 * `GET /api/vehicles/:vin/completeness` — is role-gated AND ownership/tenant-scoped. The other
 * caller, `trustDecisionService`, reads only `is_publishable`, `completeness_percent`,
 * `blocking_gaps` and `pending_gaps`, and `toPublicDecision` publishes just
 * `{status, value, reason_codes}` — it drops the `rest` bag where `pending_gaps` travels. Any change
 * that starts publishing `rest` would leak the disagreeing field name to buyers.
 */
export async function evaluateCompleteness(vin, opts = {}) {
  const client = opts.client ?? (await getDefaultClient());
  const { data: vehicle, error: vErr } = await client
    .from('vehicles')
    // Widened for M2/M3: the gate must know WHO the seller is (owner/current
    // seller/tenant) to evaluate Seller Authority, plus the seller-stated
    // identity values reconciliation compares against document readings.
    .select('vin, chassis_number, engine_number, plate_number, temp_plate_id, registration_status, registration_status_source, trust_score, publication_status, make, model, year, normalized_plate_number, owner_id, current_seller_id, tenant_id')
    .eq('vin', vin)
    .single();

  if (vErr || !vehicle) throw new Error(`Vehicle not found: ${vin}`);

  // ALL evidence rows for the VIN, with canonical classification. The old
  // legacy-type IN-list filter is gone deliberately: canonical-first rows
  // carry generic compatibility types the legacy list could never match.
  const { data: evidenceData, error: eErr } = await client
    .from('vehicle_evidence')
    .select('id, evidence_type, evidence_class, evidence_subtype, verification_status, uploaded_by')
    .eq('vin', vin);
  if (eErr) throw new Error(`Evidence query error: ${eErr.message}`);
  const evidenceRows = evidenceData || [];

  const requirements = [];

  // ── Identity requirements (blocking) ──────────────────────────────────────

  requirements.push({
    key: 'vin',
    label: 'Vehicle Identification Number (VIN)',
    category: 'identity',
    blocking: true,
    status: 'present',
    who_must_act: ACT.NONE,
  });

  requirements.push({
    key: 'chassis_number',
    label: 'Chassis Number',
    category: 'identity',
    blocking: true,
    status: vehicle.chassis_number ? 'present' : 'missing',
    who_must_act: vehicle.chassis_number ? ACT.NONE : ACT.SELLER,
  });

  requirements.push({
    key: 'engine_number',
    label: 'Engine Number',
    category: 'identity',
    blocking: true,
    status: vehicle.engine_number ? 'present' : 'missing',
    who_must_act: vehicle.engine_number ? ACT.NONE : ACT.SELLER,
  });

  // ── Seller Authority (blocking, governed — Operations M2/M3) ──────────────
  //
  // Distinct from Zimbabwe registration (G16): a permanent import may hold
  // confirmed Seller Authority while local registration is pending.
  const sellerUserId = vehicle.current_seller_id || vehicle.owner_id || null;
  const ownershipDocs = evidenceRows.filter((row) => satisfiesOwnershipRegistrationRequirementRow(row));
  const ownershipVerified = ownershipDocs.some(isVerifiedRow);
  const ownershipPending = ownershipDocs.some(isPendingRow);
  const authorityCandidates = evidenceRows.filter((row) => isSellerAuthorityCandidateRow(row));
  const anyAuthorityCandidate = authorityCandidates.length > 0;

  let authorityState = null;
  if (sellerUserId) {
    authorityState = await getSellerAuthorityState(client, { vin, sellerUserId, vehicle });
  }

  let sellerAuthorityStatus;
  let sellerAuthorityAct;
  let sellerAuthorityRefusal = null;
  if (authorityState && ['revoked', 'disputed', 'insufficient'].includes(authorityState.status)) {
    // An explicit governed refusal fails closed, relationship or not.
    sellerAuthorityStatus = 'missing';
    sellerAuthorityAct = ACT.CARUP_REVIEW;
    sellerAuthorityRefusal = 'policy_blocked';
  } else if (authorityState?.status === 'confirmed') {
    sellerAuthorityStatus = 'verified';
    sellerAuthorityAct = ACT.NONE;
  } else if (authorityState?.status === 'under_review' || authorityState?.status === 'evidence_submitted') {
    sellerAuthorityStatus = 'pending_review';
    sellerAuthorityAct = ACT.CARUP_REVIEW;
  } else if (authorityState?.status === 'recognized' || (!sellerUserId && vehicle.tenant_id)) {
    // Relationship holder (or tenant inventory with no individual seller):
    // historical-parity path — a VERIFIED ownership/registration document under
    // CANONICAL semantics completes the requirement without an explicit
    // confirmation decision.
    if (ownershipVerified) {
      sellerAuthorityStatus = 'verified';
      sellerAuthorityAct = ACT.NONE;
    } else if (ownershipPending || anyAuthorityCandidate) {
      sellerAuthorityStatus = 'pending_review';
      sellerAuthorityAct = ACT.CARUP_REVIEW;
    } else {
      sellerAuthorityStatus = 'missing';
      sellerAuthorityAct = ACT.SELLER;
    }
  } else {
    sellerAuthorityStatus = 'missing';
    sellerAuthorityAct = ACT.SELLER;
  }

  requirements.push({
    key: 'seller_authority',
    label: sellerAuthorityRefusal === 'policy_blocked'
      ? 'Seller authority requires CarUp resolution before this vehicle can be listed'
      : 'Seller authority to list this vehicle',
    category: 'seller_authority',
    blocking: true,
    status: sellerAuthorityStatus,
    who_must_act: sellerAuthorityAct,
    ...(sellerAuthorityRefusal ? { refusal_category: sellerAuthorityRefusal } : {}),
    authority_status: authorityState?.status ?? (vehicle.tenant_id && !sellerUserId ? 'recognized' : 'not_assessed'),
  });

  // ── Zimbabwe registration readiness (blocking flag from the lifecycle) ────
  // Pending permanent-import states remain visible but do not block publication
  // by themselves. Unknown stage and TIP require review and therefore block.
  const registrationReadiness = evaluateZimbabweRegistrationReadiness({
    status: vehicle.registration_status,
    statusSource: vehicle.registration_status_source,
    plateNumber: vehicle.plate_number,
    tempPlateId: vehicle.temp_plate_id,
  });
  requirements.push({
    key: 'registration_readiness',
    label: registrationReadiness.label,
    category: 'registration',
    blocking: registrationReadiness.publication_blocking,
    status: registrationReadiness.publication_blocking
      ? (registrationReadiness.status === 'incomplete' ? 'missing' : 'pending_review')
      : (registrationReadiness.status === 'registered' ? 'present' : 'pending_review'),
    who_must_act: registrationReadiness.publication_blocking ? ACT.SELLER : ACT.NONE,
    lifecycle_status: registrationReadiness.lifecycle_status,
    reason_codes: registrationReadiness.reason_codes,
  });

  // ── Registration evidence — ONLY when the lifecycle stage requires it ─────
  //
  // A vehicle claiming `locally_registered` must evidence that claim with a
  // registration-class DOCUMENT (canonical semantics; a legacy-only historical
  // registration_document still counts through its fallback mapping). A
  // permanent import on a pending stage is NOT asked for a registration book it
  // cannot yet have (manual §19).
  const normalizedStage = registrationReadiness.lifecycle_status || null;
  if (normalizedStage === 'locally_registered') {
    const registrationDocs = evidenceRows.filter(
      (row) => isRegistrationEvidenceRow(row) && isDocumentArtifactRow(row)
    );
    const regVerified = registrationDocs.some(isVerifiedRow);
    const regPending = registrationDocs.some(isPendingRow);
    requirements.push({
      key: 'registration_evidence',
      label: 'Zimbabwe registration document (required for a locally registered vehicle)',
      category: 'registration',
      blocking: true,
      status: regVerified ? 'verified' : regPending ? 'pending_review' : 'missing',
      who_must_act: regVerified ? ACT.NONE : regPending ? ACT.CARUP_REVIEW : ACT.SELLER,
    });
  }

  // ── Evidence reconciliation (blocking) — Seller Journey S5 ───────────────
  //
  // A known material contradiction must not silently reach publication.
  const { data: extractionRows, error: xErr } = await client
    .from('vehicle_document_extractions')
    .select('id, evidence_id, document_type, field_name, raw_value, normalized_value, expected_value, compared_vehicle_field, match_status, review_status, created_at')
    .eq('vin', vin)
    .order('created_at', { ascending: false });
  // Fails closed. A gate that cannot read its own input must refuse rather than assume the listing
  // is clean — assuming would publish the exact contradiction this requirement exists to catch.
  if (xErr) throw new Error(`Extraction reconciliation query error: ${xErr.message}`);

  const reconciliation = reconcileSellerFacts({ vehicle, extractions: extractionRows || [] });
  const unresolvedFields = reconciliation.unresolved_material_fields;

  requirements.push({
    key: 'fact_reconciliation',
    // The label NAMES the facts in disagreement. A refusal that names nothing is the defect the
    // publish route already had to fix once for pending ownership documents.
    label: unresolvedFields.length > 0
      ? `Resolve document disagreement: ${unresolvedFields.join(', ')}`
      : 'Document readings agree with your details',
    category: 'documents',
    blocking: true,
    // 'pending_review' rather than 'missing': the seller HAS supplied the document, and a human
    // decision is what clears it. Saying "missing" would tell them to upload something again.
    status: reconciliation.has_unresolved_material_contradiction ? 'pending_review' : 'present',
    who_must_act: reconciliation.has_unresolved_material_contradiction ? ACT.CARUP_REVIEW : ACT.NONE,
    ...(reconciliation.has_unresolved_material_contradiction ? { refusal_category: 'conflict' } : {}),
    fields: unresolvedFields,
  });

  // ── Risk / governance block (blocking — Operations M3) ────────────────────
  //
  // A fraud case that BLOCKS PUBLICATION must block here too: previously the
  // flag lived only in the trust decision's publication dimension while the
  // publish route never consulted it, so CarUp had two answers to "may this
  // publish?". Fails closed on a read error, same posture as reconciliation.
  const { data: fraudRows, error: fErr } = await client
    .from('fraud_cases')
    .select('id, status, blocks_publication')
    .eq('vin', vin);
  if (fErr) throw new Error(`Risk case query error: ${fErr.message}`);
  const blockingFraud = (fraudRows || []).filter(
    (row) => row.blocks_publication === true && ['open', 'investigating'].includes(row.status)
  );
  requirements.push({
    key: 'risk_governance',
    label: blockingFraud.length > 0
      ? 'A risk case blocks publication pending CarUp resolution'
      : 'No blocking risk case',
    category: 'risk',
    blocking: true,
    status: blockingFraud.length > 0 ? 'pending_review' : 'present',
    who_must_act: blockingFraud.length > 0 ? ACT.CARUP_REVIEW : ACT.NONE,
    ...(blockingFraud.length > 0 ? { refusal_category: 'policy_blocked' } : {}),
  });

  // ── Advisory documents (non-blocking, canonical-aware) ────────────────────

  for (const advisory of ADVISORY_REQUIREMENTS) {
    requirements.push({
      key: advisory.key,
      label: advisory.label,
      category: 'documents',
      blocking: false,
      status: advisoryStatus(evidenceRows, advisory.matches),
    });
  }

  // ── Governed finance obligation / encumbrance (Track 1: R22, R23) ────────────────────────────
  //
  // ADVISORY ONLY (blocking: false). R23 is explicit: "an active vehicle finance/lease/lender
  // interest can coexist with a public listing" — a prior or active encumbrance must never hide an
  // otherwise legitimate listing. Pushing this with `blocking: false` keeps it out of
  // `blockingReqs` below, so it is arithmetically incapable of moving `is_publishable` or
  // `completeness_percent`, and cannot fire the 400 on the publish route.
  //
  // Fails closed toward "not recorded", never toward "clear": a read failure here must not read as
  // an all-clear the evaluator never actually confirmed.
  let encumbranceStatus = 'not_available';
  try {
    const encumbrance = await getGovernedEncumbrance(client, vin);
    encumbranceStatus = encumbrance.blocking ? 'pending_review' : 'present';
  } catch {
    encumbranceStatus = 'not_available';
  }
  requirements.push({
    key: 'finance_obligation_disclosure',
    // Never "clear" / "no finance" — a not_available or present status here says only that the
    // GOVERNED encumbrance check ran (or could not run), never that no obligation exists anywhere.
    label: encumbranceStatus === 'pending_review'
      ? 'A governed finance obligation is recorded on this vehicle — visible to buyers, does not block publishing'
      : 'Governed finance/encumbrance record (not recorded is not a claim of "clear")',
    category: 'finance',
    blocking: false,
    status: encumbranceStatus,
  });

  // ── Compute publication readiness ─────────────────────────────────────────

  const blockingReqs = requirements.filter((r) => r.blocking);
  const missingBlocking = blockingReqs.filter((r) => r.status === 'missing');
  const pendingBlocking  = blockingReqs.filter((r) => r.status === 'pending_review');
  const metBlocking      = blockingReqs.filter((r) => r.status === 'present' || r.status === 'verified');

  const completeness_percent = Math.round((metBlocking.length / blockingReqs.length) * 100);
  const is_publishable = missingBlocking.length === 0 && pendingBlocking.length === 0;

  return {
    vin,
    requirements,
    completeness_percent,
    is_publishable,
    blocking_gaps: missingBlocking.map((r) => ({ key: r.key, label: r.label })),
    pending_gaps:  pendingBlocking.map((r) => ({ key: r.key, label: r.label })),
    publication_status: vehicle.publication_status ?? 'draft',
    // The seller-facing reconciliation read model travels with the verdict, so a caller does not
    // have to make a second round trip to learn WHY the gate refused.
    reconciliation,
  };
}
