/**
 * Marketplace trust & verification summary builder.
 *
 * PURE, READ-ONLY. Assembles the backend-governed MarketplaceTrustSummary and
 * MarketplaceVerificationSummary (see shared/types/marketplace.ts) from existing trust signals.
 *
 * INVARIANTS (enforced here, asserted in tests):
 *  - The frontend never invents badges — every badge here is backed by a governed signal.
 *  - PartSentry claims obey summarizePartSentry suppression (public_card_eligible + non-suspicious
 *    + not self-approved); watch/flagged suppresses ALL PartSentry signals.
 *  - No raw trust-score components, mechanic_id, signatures, OCR, AI fraud metadata, or private
 *    evidence ever appear. admin_explanation is returned ONLY for admin/reviewer audiences.
 */

import { summarizePartSentry, summarizeEvidence } from './listingSummaryService.js';
import { isVehicleQuarantinedStatus } from '../../utils/vehicleStatus.js';

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

function boolValue(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** Controlled badge vocabulary -> public copy. A badge is emitted ONLY when its tag is present. */
const BADGE_COPY = {
  passport_verified: 'Vehicle passport verified',
  plate_verified: 'Number plate verified',
  evidence_available: 'Supporting evidence on file',
  duty_cleared: 'Import duty cleared',
  zimra_verified: 'ZIMRA duty verified',
  cid_clear: 'Police (CID) clearance on record',
  dealer_verified: 'Registered dealer listing',
  safe_pay_ready: 'SafePay-ready transaction',
  inspection_ready: 'Independent inspection available',
  partsentry_checked: 'PartSentry repair history checked',
  verified_parts: 'Verified parts provenance',
  recent_service: 'Recent service recorded',
};

/** Order badges so the strongest trust signals lead. */
const BADGE_ORDER = [
  'passport_verified',
  'zimra_verified',
  'cid_clear',
  'plate_verified',
  'partsentry_checked',
  'verified_parts',
  'evidence_available',
  'dealer_verified',
  'inspection_ready',
  'duty_cleared',
  'safe_pay_ready',
  'recent_service',
];

/** Evidence status enum (none|partial|verified|review_required) from public-safe evidence rows. */
export function deriveEvidenceStatus(evidenceRows = []) {
  const publicRows = (evidenceRows || []).filter(
    (row) => (row?.visibility_level || 'public_safe') === 'public_safe'
  );
  const verified = publicRows.filter((row) => norm(row?.verification_status) === 'verified').length;
  const pending = publicRows.filter((row) =>
    ['pending', 'pending_review', 'review_required', 'disputed'].includes(norm(row?.verification_status))
  ).length;
  if (verified > 0 && pending > 0) return 'partial';
  if (verified > 0) return 'verified';
  if (pending > 0) return 'review_required';
  return 'none';
}

/** Raw PartSentry suspicion level mapped to the trust enum (clear|watch|flagged). */
export function deriveSuspicionLevel(partSentryRows = []) {
  const levels = (partSentryRows || []).map((row) => norm(row?.suspicion_status));
  if (levels.includes('flagged')) return 'flagged';
  if (levels.includes('watch')) return 'watch';
  return 'clear';
}

/**
 * Build the backend-governed trust summary.
 * @param {object} args
 * @param {object} args.vehicle raw vehicle row
 * @param {object} args.listingSummary output of buildMarketplaceListingSummary
 * @param {object[]} args.evidenceRows
 * @param {object[]} args.partSentryRows
 * @param {'public'|'admin'} [args.audience='public']
 */
export function buildTrustSummary({ vehicle = {}, listingSummary = {}, evidenceRows = [], partSentryRows = [], audience = 'public' }) {
  const tags = Array.isArray(listingSummary.marketplace_tags) ? listingSummary.marketplace_tags : [];
  const partSentry = summarizePartSentry(partSentryRows);
  const evidenceStatus = deriveEvidenceStatus(evidenceRows);
  const suspicion = deriveSuspicionLevel(partSentryRows);

  const trust_badges = BADGE_ORDER.filter((tag) => tags.includes(tag));
  const public_badge_copy = trust_badges.map((tag) => BADGE_COPY[tag]).filter(Boolean);

  const quarantined = isVehicleQuarantinedStatus(vehicle.status);
  let risk_status = 'clear';
  if (quarantined) risk_status = 'blocked';
  else if (suspicion === 'flagged') risk_status = 'flagged';
  else if (suspicion === 'watch') risk_status = 'watch';

  const risk_reasons = [];
  if (quarantined) risk_reasons.push('listing_restricted_pending_review');
  if (suspicion !== 'clear') risk_reasons.push('parts_provenance_under_review');
  if (evidenceStatus === 'review_required') risk_reasons.push('evidence_pending_review');

  const dealer_verified = tags.includes('dealer_verified');
  const vehicle_passport_available = Boolean(listingSummary.passport_verified);
  // Identity is org-level for dealers on main; per-seller identity verification bridge is deferred (Workstream G).
  const identity_verified = dealer_verified;

  const safe_public_copy = buildSafePublicCopy({
    badgeCount: trust_badges.length,
    risk_status,
    evidenceStatus,
    partsentry_status: partSentry.public_status,
  });

  // Plan §6 verification_status (single enum) derived from public evidence state.
  const verification_status =
    evidenceStatus === 'verified' || evidenceStatus === 'partial' ? 'verified'
      : evidenceStatus === 'review_required' ? 'manual_review'
      : 'unverified';

  const summary = {
    trust_badges,
    public_badge_copy,
    evidence_status: evidenceStatus,
    vehicle_passport_available,
    identity_verified,
    dealer_verified,
    partsentry_public_status: partSentry.public_status,
    suspicion_status: suspicion,
    risk_status,
    risk_reasons,
    safe_public_copy,
    // Plan §6 MarketplaceTrustSummary aliases (additive superset; identical governed values).
    public_copy: safe_public_copy,
    safe_public_claims: public_badge_copy,
    risk_flags_public: risk_reasons,
    verification_status,
    trust_score: typeof listingSummary.trust_score === 'number' ? listingSummary.trust_score : null,
  };

  if (audience === 'admin') {
    summary.admin_explanation = buildAdminExplanation({
      evidenceStatus,
      suspicion,
      partsentry_status: partSentry.public_status,
      partsentry_suppressed: partSentry.suppressed,
      quarantined,
      badge_count: trust_badges.length,
    });
  }

  return summary;
}

function buildSafePublicCopy({ badgeCount, risk_status, evidenceStatus, partsentry_status }) {
  if (risk_status === 'blocked') {
    return 'This listing is under review. Please use the verified inquiry flow and request an independent inspection.';
  }
  if (risk_status === 'flagged' || risk_status === 'watch') {
    return 'Some trust signals on this listing are under review. Verify details through the inquiry flow before transacting.';
  }
  const parts = [];
  if (badgeCount > 0) parts.push(`${badgeCount} verified trust signal${badgeCount === 1 ? '' : 's'} on record`);
  if (evidenceStatus === 'verified' || evidenceStatus === 'partial') parts.push('supporting evidence on file');
  if (partsentry_status === 'eligible') parts.push('PartSentry repair history checked');
  if (!parts.length) {
    return 'Trust signals are limited for this listing. Request an inspection and use the verified inquiry flow.';
  }
  return `${parts.join(', ')}. Always confirm via the verified inquiry flow and consider an inspection.`;
}

function buildAdminExplanation({ evidenceStatus, suspicion, partsentry_status, partsentry_suppressed, quarantined, badge_count }) {
  const notes = [];
  notes.push(`badges=${badge_count}`);
  notes.push(`evidence=${evidenceStatus}`);
  notes.push(`partsentry=${partsentry_status}${partsentry_suppressed ? ' (suppressed)' : ''}`);
  notes.push(`suspicion=${suspicion}`);
  if (quarantined) notes.push('vehicle_status=quarantined');
  return `Governed trust state: ${notes.join(', ')}. Public claims reflect only governed, non-suspicious signals.`;
}

/**
 * Build the verification summary. Conservative by design: never asserts an unbacked "verified" state.
 */
export function buildVerificationSummary({ vehicle = {}, listingSummary = {}, evidenceRows = [], partSentryRows = [] }) {
  const tags = Array.isArray(listingSummary.marketplace_tags) ? listingSummary.marketplace_tags : [];
  const partSentry = summarizePartSentry(partSentryRows);
  const evidenceStatus = deriveEvidenceStatus(evidenceRows);

  const seller_verified = tags.includes('dealer_verified');
  const vehicle_evidence_verified = evidenceStatus === 'verified' || evidenceStatus === 'partial';
  const part_provenance_verified = partSentry.verified_parts_count > 0;
  const inspection_available = tags.includes('inspection_ready');

  const verification_notes_public = [];
  if (vehicle_evidence_verified) verification_notes_public.push('Verified evidence is on file for this listing.');
  if (part_provenance_verified) verification_notes_public.push('Parts provenance has passed PartSentry governance.');
  if (boolValue(listingSummary.passport_verified)) verification_notes_public.push('Vehicle passport has been verified.');
  if (inspection_available) verification_notes_public.push('An independent inspection can be requested.');
  if (!verification_notes_public.length) {
    verification_notes_public.push('Verification is limited. Request evidence and an inspection through the inquiry flow.');
  }

  return {
    seller_verified,
    // Per-seller identity verification is not surfaced on main; consumed from PR #72 contract once the
    // identity -> passport_verified bridge (Workstream G) lands. Default conservative.
    identity_status: 'unverified',
    vehicle_evidence_verified,
    part_provenance_verified,
    inspection_available,
    inspection_verified: false,
    verification_notes_public,
  };
}

export { summarizeEvidence };
