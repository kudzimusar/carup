export const PASSPORT_AI_CAPABILITIES = Object.freeze([
  'explain',
  'summarize',
  'guide',
  'recommend',
]);

export const PASSPORT_AI_CLAIM_KINDS = Object.freeze([
  'fact',
  'unavailability',
  'recommendation',
]);

const CAPABILITIES = new Set(PASSPORT_AI_CAPABILITIES);
const CLAIM_KINDS = new Set(PASSPORT_AI_CLAIM_KINDS);

const FORBIDDEN_MUTATIONS = Object.freeze([
  'set_trust',
  'refresh_trust',
  'verify_ownership',
  'complete_ownership_transfer',
  'certify_evidence',
  'approve_discrepancy',
  'rewrite_history',
  'publish_listing',
  'reserve_vehicle',
  'send_notification',
]);

function factsByKey(context = {}) {
  return new Map((context.facts || []).map((fact) => [fact.key, fact]));
}

export function normalizePassportAiContext(context = {}) {
  const availability = context.availability ?? 'unavailable';
  const facts = Array.isArray(context.facts) ? context.facts.map((fact) => ({
    key: fact.key,
    label: fact.label ?? fact.key,
    value: fact.available === false ? null : (fact.value ?? null),
    available: fact.available !== false,
    reason: fact.available === false ? (fact.reason ?? 'not_recorded') : null,
    source: fact.source ?? null,
    authority: fact.authority ?? null,
  })) : [];

  for (const fact of facts) {
    if (!fact.key || !fact.source) {
      throw new Error('Passport AI fact requires key and source');
    }
  }

  return {
    availability,
    reason: availability === 'value' ? null : (context.reason ?? 'input_unavailable'),
    calculation_version: context.calculation_version ?? null,
    scope: context.scope ?? null,
    facts,
    boundaries: Array.isArray(context.boundaries) ? [...context.boundaries] : [],
  };
}

function validateClaim(claim, factMap) {
  if (!CLAIM_KINDS.has(claim?.kind)) {
    throw new Error(`Unsupported Passport AI claim kind: ${claim?.kind}`);
  }
  if (!claim.text || !Array.isArray(claim.fact_keys) || claim.fact_keys.length === 0) {
    throw new Error('Passport AI claim requires text and fact_keys');
  }

  const cited = claim.fact_keys.map((key) => {
    const fact = factMap.get(key);
    if (!fact) throw new Error(`Passport AI claim cites unknown fact: ${key}`);
    return fact;
  });

  if (claim.kind === 'fact' && cited.some((fact) => fact.available !== true)) {
    throw new Error('Passport AI factual claim may cite only available facts');
  }
  if (claim.kind === 'unavailability' && cited.some((fact) => fact.available !== false)) {
    throw new Error('Passport AI unavailability claim must cite unavailable facts');
  }
  if (claim.kind === 'recommendation' && claim.governed_recommendation !== true) {
    throw new Error('Passport AI recommendation must originate from governed recommendation logic');
  }

  return {
    kind: claim.kind,
    text: claim.text,
    fact_keys: [...claim.fact_keys],
    governed_recommendation: claim.kind === 'recommendation',
  };
}

export function validatePassportAiAdvisory(advisory = {}, contextInput = {}) {
  const context = normalizePassportAiContext(contextInput);

  const capabilities = Array.isArray(advisory.capabilities)
    ? [...new Set(advisory.capabilities)]
    : [];
  for (const capability of capabilities) {
    if (!CAPABILITIES.has(capability)) {
      throw new Error(`Unsupported Passport AI capability: ${capability}`);
    }
  }

  const mutations = Array.isArray(advisory.mutations) ? advisory.mutations : [];
  if (mutations.length > 0) {
    const forbidden = mutations.filter((mutation) => FORBIDDEN_MUTATIONS.includes(mutation));
    throw new Error(
      `Passport AI is advisory-only and cannot mutate vehicle state: ${forbidden.length ? forbidden.join(', ') : mutations.join(', ')}`,
    );
  }

  if (context.availability !== 'value') {
    if ((advisory.claims || []).length > 0 || (advisory.recommendations || []).length > 0) {
      throw new Error('Unavailable Passport AI context requires abstention, not claims or recommendations');
    }
    return {
      valid: true,
      abstained: true,
      reason: context.reason,
      capabilities,
      claims: [],
      mutations: [],
      context_version: context.calculation_version,
    };
  }

  const factMap = factsByKey(context);
  const claims = (advisory.claims || []).map((claim) => validateClaim(claim, factMap));

  if (advisory.trust_override !== undefined && advisory.trust_override !== null) {
    throw new Error('Passport AI cannot override canonical Trust');
  }
  if (advisory.ownership_override !== undefined && advisory.ownership_override !== null) {
    throw new Error('Passport AI cannot override governed ownership state');
  }
  if (advisory.evidence_certification !== undefined && advisory.evidence_certification !== null) {
    throw new Error('Passport AI cannot certify evidence');
  }

  return {
    valid: true,
    abstained: false,
    capabilities,
    claims,
    mutations: [],
    context_version: context.calculation_version,
  };
}

export default {
  PASSPORT_AI_CAPABILITIES,
  PASSPORT_AI_CLAIM_KINDS,
  normalizePassportAiContext,
  validatePassportAiAdvisory,
};
