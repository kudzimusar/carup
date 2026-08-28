export const GOLDEN_LIFECYCLE_STEPS = Object.freeze([
  ['seller_start', 'Seller starts with or detects existing Passport'],
  ['identity_confirmed', 'Vehicle identity is confirmed'],
  ['commercial_data', 'Seller adds commercial data'],
  ['listing_media', 'Seller adds listing media'],
  ['evidence_submitted', 'Seller submits evidence'],
  ['discrepancy_detected', 'A discrepancy is detected'],
  ['discrepancy_resolved', 'Discrepancy is resolved through governed workflow'],
  ['trust_evaluated', 'Trust evaluates from canonical evidence'],
  ['seller_preview', 'Seller previews buyer representation'],
  ['vehicle_published', 'Vehicle publishes'],
  ['marketplace_found', 'Buyer finds it in Marketplace'],
  ['vehicle_detail_opened', 'Buyer opens Vehicle Detail'],
  ['public_passport_opened', 'Buyer opens public Passport'],
  ['buyer_semantics_converged', 'Buyer sees the same Trust/evidence semantics'],
  ['inquiry_sent', 'Buyer sends inquiry'],
  ['communications_persisted_delivered', 'Communications persists/delivers'],
  ['transaction_progressed', 'Transaction/reservation proceeds where enabled'],
  ['vehicle_sold', 'Vehicle is sold'],
  ['ownership_transfer_started', 'Ownership transfer starts'],
  ['ownership_transfer_completed', 'Ownership transfer completes through governed workflow'],
  ['new_owner_passport', 'New owner opens the same Passport'],
  ['historical_listing_preserved', 'Historical listing remains historical, not current'],
  ['service_record_added', 'Garage/service record is added'],
  ['mileage_observation_added', 'Mileage observation is added'],
  ['partsentry_record_added', 'PartSentry/part record is added where applicable'],
  ['passport_timeline_updated', 'Passport timeline updates'],
  ['trust_recalculation_governed', 'Trust re-evaluates only for canonical Trust input'],
  ['lifecycle_notification', 'Communications sends lifecycle notification where appropriate'],
  ['truthful_next_best_action', 'Intelligence provides truthful next-best-action'],
  ['new_owner_relists', 'New owner later relists the same vehicle'],
  ['canonical_vehicle_reused', 'Marketplace uses the same canonical vehicle and Passport'],
  ['previous_owner_privacy', 'Previous-owner private data remains protected'],
].map(([id, label], index) => Object.freeze({ number: index + 1, id, label })));

export const GOLDEN_CERTIFICATION_MATRIX = Object.freeze([
  'api_contracts',
  'database_constraints_migrations',
  'security_rls',
  'evidence_privacy',
  'trust_invariants',
  'communications',
  'intelligence',
  'marketplace',
  'seller',
  'verify',
  'home',
  'service_partsentry',
  'ownership',
  'desktop',
  'mobile',
  'accessibility',
  'playwright_functional',
  'visual_regression',
  'exact_head_ci',
  'exact_head_staging',
  'independent_review',
  'owner_uat',
  'short_soak',
]);

const VALID = new Set(['pass', 'blocked', 'fail']);

function evidenceArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeGate(raw, id) {
  const state = raw?.state ?? 'blocked';
  if (!VALID.has(state)) throw new Error(`Unsupported Golden certification state for ${id}: ${state}`);
  const evidence = evidenceArray(raw?.evidence);
  if (state === 'pass' && evidence.length === 0) {
    throw new Error(`Golden certification PASS for ${id} requires evidence`);
  }
  return {
    state,
    evidence,
    reason: state === 'pass' ? null : (raw?.reason ?? 'evidence_missing'),
    proof: raw?.proof && typeof raw.proof === 'object' ? structuredClone(raw.proof) : {},
  };
}

function requireProof(gate, id, fields) {
  if (gate.state !== 'pass') return;
  for (const field of fields) {
    if (gate.proof?.[field] === null || gate.proof?.[field] === undefined || gate.proof?.[field] === '') {
      throw new Error(`Golden lifecycle PASS for ${id} requires proof.${field}`);
    }
  }
}

function validateCriticalProof(steps, vin) {
  const byId = new Map(steps.map((step) => [step.id, step]));

  requireProof(byId.get('communications_persisted_delivered'), 'communications_persisted_delivered', [
    'domain_event_id', 'canonical_notification_or_thread_id', 'delivery_state',
  ]);
  requireProof(byId.get('ownership_transfer_completed'), 'ownership_transfer_completed', [
    'transfer_id', 'governed_authority', 'completed_at', 'new_owner_id', 'same_vin',
  ]);
  requireProof(byId.get('lifecycle_notification'), 'lifecycle_notification', [
    'domain_event_id', 'canonical_notification_or_thread_id',
  ]);
  requireProof(byId.get('truthful_next_best_action'), 'truthful_next_best_action', [
    'rule', 'evidence_fingerprint', 'calculation_version',
  ]);
  requireProof(byId.get('previous_owner_privacy'), 'previous_owner_privacy', [
    'previous_owner_identifier_absent', 'access_policy_checked',
  ]);

  const transfer = byId.get('ownership_transfer_completed');
  if (transfer?.state === 'pass' && String(transfer.proof.same_vin) !== String(vin)) {
    throw new Error('Golden ownership transfer must preserve the same VIN/Passport identity');
  }
  if (transfer?.state === 'pass' && transfer.proof.governed_authority === 'fixture_seed') {
    throw new Error('Golden ownership transfer cannot be certified by a seeded history row');
  }

  const privacy = byId.get('previous_owner_privacy');
  if (privacy?.state === 'pass' && privacy.proof.previous_owner_identifier_absent !== true) {
    throw new Error('Golden privacy PASS requires previous-owner identifier absence');
  }
}

function summarize(gates) {
  const counts = { pass: 0, blocked: 0, fail: 0 };
  for (const gate of gates) counts[gate.state] += 1;
  return counts;
}

export function certifyGoldenVehicleLifecycle({
  vin,
  golden_vehicle_key,
  steps = {},
  matrix = {},
  unresolved_findings = [],
  candidate_head = null,
  staging_head = null,
} = {}) {
  if (!vin) throw new Error('Golden lifecycle certification requires VIN');
  if (!golden_vehicle_key) throw new Error('Golden lifecycle certification requires golden_vehicle_key');

  const normalizedSteps = GOLDEN_LIFECYCLE_STEPS.map((definition) => ({
    ...definition,
    ...normalizeGate(steps[definition.id], definition.id),
  }));

  validateCriticalProof(normalizedSteps, vin);

  const normalizedMatrix = GOLDEN_CERTIFICATION_MATRIX.map((id) => ({
    id,
    ...normalizeGate(matrix[id], id),
  }));

  const findings = Array.isArray(unresolved_findings)
    ? unresolved_findings.map((finding) => ({
        severity: String(finding?.severity ?? '').toUpperCase(),
        id: finding?.id ?? null,
        summary: finding?.summary ?? null,
      }))
    : [];

  const blockingFindings = findings.filter((finding) => ['P0', 'P1'].includes(finding.severity));
  const stepSummary = summarize(normalizedSteps);
  const matrixSummary = summarize(normalizedMatrix);

  const allPass =
    stepSummary.blocked === 0
    && stepSummary.fail === 0
    && matrixSummary.blocked === 0
    && matrixSummary.fail === 0
    && blockingFindings.length === 0;

  const exactHeadAligned =
    candidate_head
    && staging_head
    && String(candidate_head) === String(staging_head);

  const pass = Boolean(allPass && exactHeadAligned);

  const blockers = [
    ...normalizedSteps
      .filter((item) => item.state !== 'pass')
      .map((item) => ({ kind: 'lifecycle_step', id: item.id, state: item.state, reason: item.reason })),
    ...normalizedMatrix
      .filter((item) => item.state !== 'pass')
      .map((item) => ({ kind: 'matrix_gate', id: item.id, state: item.state, reason: item.reason })),
    ...blockingFindings.map((item) => ({ kind: 'finding', id: item.id, state: item.severity, reason: item.summary })),
  ];

  if (!exactHeadAligned) {
    blockers.push({
      kind: 'exact_head',
      id: 'staging_provenance',
      state: 'blocked',
      reason: 'candidate_head_and_staging_head_must_match',
    });
  }

  return {
    schema: 'passport_golden_lifecycle_certification.v1',
    vin: String(vin),
    golden_vehicle_key,
    candidate_head,
    staging_head,
    exact_head_aligned: Boolean(exactHeadAligned),
    status: pass ? 'PASS' : 'BLOCKED',
    steps: normalizedSteps,
    certification_matrix: normalizedMatrix,
    unresolved_findings: findings,
    summary: {
      lifecycle: stepSummary,
      matrix: matrixSummary,
      p0_p1: blockingFindings.length,
    },
    blockers,
  };
}

export default {
  GOLDEN_LIFECYCLE_STEPS,
  GOLDEN_CERTIFICATION_MATRIX,
  certifyGoldenVehicleLifecycle,
};
