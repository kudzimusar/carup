import {
  VERIFICATION_MODES,
  VERIFICATION_RESULTS,
} from '../sourceVerification/verificationContract.js';
import {
  publicSafeDisputeState,
} from '../governance/governanceService.js';
import {
  PASSPORT_AUDIENCES,
  assertPassportAudience,
} from './passportContract.js';

function assertSourceState(row) {
  if (!row?.provider) throw new Error('Passport source verification requires provider');
  if (!VERIFICATION_MODES.includes(row.mode)) {
    throw new Error(`Unsupported source verification mode: ${row.mode}`);
  }
  if (!VERIFICATION_RESULTS.includes(row.result)) {
    throw new Error(`Unsupported source verification result: ${row.result}`);
  }
}

function sourceState(row) {
  if (row.mode === 'unavailable' || row.result === 'unavailable') return 'unavailable';
  if (row.result === 'no_record') return 'no_record';
  if (row.result === 'mismatch' || row.result === 'high_risk') return 'adverse';
  if (row.result === 'manual_review') return 'pending_review';
  return 'match';
}

export function projectPassportSourceVerification(row, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
} = {}) {
  assertPassportAudience(audience);
  assertSourceState(row);

  const projected = {
    provider: row.provider,
    mode: row.mode,
    result: row.result,
    state: sourceState(row),
    retrieved_at: row.retrieved_at ?? null,
    source_record_id: row.source_record_id ?? null,
    source_confidence: row.confidence ?? null,
    source_confidence_is_not_trust: true,
  };

  if (
    audience === PASSPORT_AUDIENCES.OWNER
    || audience === PASSPORT_AUDIENCES.SELLER
    || audience === PASSPORT_AUDIENCES.GOVERNANCE
  ) {
    projected.mismatch_flags = Array.isArray(row.mismatch_flags) ? [...row.mismatch_flags] : [];
    projected.error_class = row.error_class ?? null;
  }

  return projected;
}

function reviewerState(row) {
  return String(
    row?.reviewer_state ?? row?.verification_status ?? row?.status ?? 'pending_review'
  ).toLowerCase();
}

function isPrivilegedDiscrepancyAudience(audience) {
  return audience === PASSPORT_AUDIENCES.OWNER
    || audience === PASSPORT_AUDIENCES.SELLER
    || audience === PASSPORT_AUDIENCES.GOVERNANCE;
}

export function projectPassportDiscrepancy(row, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
} = {}) {
  assertPassportAudience(audience);
  if (!row?.id) throw new Error('Passport discrepancy projection requires id');

  const safe = publicSafeDisputeState(row);
  const state = reviewerState(row);
  const privileged = isPrivilegedDiscrepancyAudience(audience);

  if (!privileged && safe?.public_state !== 'confirmed_public') return null;

  const projection = {
    discrepancy_id: row.id,
    type: row.conflict_type ?? row.finding_type ?? row.type ?? 'discrepancy',
    state,
    severity: row.severity ?? null,
    public_state: safe?.public_state ?? 'not_public',
    disputed: Boolean(safe?.disputed),
    summary: privileged
      ? (row.public_summary ?? row.summary ?? null)
      : (safe?.public_summary ?? null),
    action_required: ['pending_review', 'pending', 'disputed', 'inconclusive'].includes(state),
  };

  if (privileged) {
    projection.classification = row.classification ?? null;
    projection.evidence_ids = Array.isArray(row.evidence_ids) ? [...row.evidence_ids] : [];
  }

  if (audience === PASSPORT_AUDIENCES.GOVERNANCE) {
    projection.internal_explanation = row.internal_explanation ?? null;
  }

  return projection;
}

export function buildPassportVerificationSection({
  sourceResults = [],
  discrepancies = [],
  audience = PASSPORT_AUDIENCES.PUBLIC,
  collectionState = null,
} = {}) {
  assertPassportAudience(audience);

  const sources = (sourceResults || []).map((row) =>
    projectPassportSourceVerification(row, { audience })
  );
  const projectedDiscrepancies = (discrepancies || [])
    .map((row) => projectPassportDiscrepancy(row, { audience }))
    .filter(Boolean);

  return {
    state: collectionState || (sources.length || projectedDiscrepancies.length ? 'known' : 'unknown'),
    sources,
    discrepancies: projectedDiscrepancies,
  };
}

export default {
  projectPassportSourceVerification,
  projectPassportDiscrepancy,
  buildPassportVerificationSection,
};
