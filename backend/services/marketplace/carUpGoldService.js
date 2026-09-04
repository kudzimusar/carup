/**
 * Backend-governed CarUp Gold qualification.
 *
 * Gold is NOT a styling alias for a high score. It requires a current canonical evaluation,
 * high evidence confidence, strong source coverage, substantial governed-fact support, no
 * adverse governed facts and no unbacked legacy claims. The frontend may render this projection
 * but must never recreate or relax the rule.
 */
export const CARUP_GOLD_POLICY_VERSION = 'carup-gold-1.0.0';

export function projectCarUpGold(trust) {
  if (!trust || trust.evaluation_state !== 'evaluated') {
    return {
      state: 'not_evaluable',
      tier: null,
      label: null,
      policy_version: CARUP_GOLD_POLICY_VERSION,
      reason_codes: ['canonical_trust_not_evaluated'],
    };
  }

  const basis = trust.evidence_basis;
  if (!basis) {
    return {
      state: 'not_evaluable',
      tier: null,
      label: null,
      policy_version: CARUP_GOLD_POLICY_VERSION,
      reason_codes: ['evidence_basis_unavailable'],
    };
  }

  const score = Number.isFinite(trust.score) ? trust.score : null;
  const total = Number.isFinite(basis.governed_facts_total) ? basis.governed_facts_total : null;
  const substantiated = Number.isFinite(basis.governed_facts_substantiated) ? basis.governed_facts_substantiated : null;
  const requiredSubstantiated = total === null ? null : Math.max(5, Math.ceil(total * 0.8));

  const failures = [];
  if (score === null || score < 90) failures.push('trust_score_below_90');
  if (trust.confidence !== 'high') failures.push('trust_confidence_not_high');
  if (!Number.isFinite(basis.connected_sources) || basis.connected_sources < 2) failures.push('connected_sources_below_2');
  if (requiredSubstantiated === null || substantiated === null || substantiated < requiredSubstantiated) failures.push('governed_fact_coverage_below_80_percent');
  if (basis.governed_facts_adverse !== 0) failures.push('adverse_governed_facts_present_or_unknown');
  if (basis.unbacked_legacy_claims !== 0) failures.push('unbacked_legacy_claims_present_or_unknown');

  if (failures.length) {
    return {
      state: 'not_qualified',
      tier: null,
      label: null,
      policy_version: CARUP_GOLD_POLICY_VERSION,
      reason_codes: failures,
    };
  }

  return {
    state: 'qualified',
    tier: 'gold',
    label: 'CarUp Gold',
    policy_version: CARUP_GOLD_POLICY_VERSION,
    reason_codes: [
      'canonical_trust_at_least_90',
      'high_evidence_confidence',
      'multi_source_coverage',
      'governed_fact_coverage_met',
      'no_adverse_governed_facts',
      'no_unbacked_legacy_claims',
    ],
  };
}

export default { CARUP_GOLD_POLICY_VERSION, projectCarUpGold };
