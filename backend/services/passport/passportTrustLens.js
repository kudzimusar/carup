import {
  EVIDENCE_BASIS_FIELDS,
  PUBLIC_TRUST_FIELDS,
  TRUST_BANDS,
  TRUST_CONFIDENCE,
  TRUST_EVALUATION_STATE_VALUES,
  TRUST_EVALUATION_STATES,
  TRUST_SOURCES,
} from '../trustDecision/canonicalTrustService.js';

function assertFiniteScore(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('Canonical Trust evaluated score must be a number between 0 and 100');
  }
}

function validateEvidenceBasis(value) {
  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Canonical Trust evidence_basis must be an object or null');
  }
  for (const key of EVIDENCE_BASIS_FIELDS) {
    if (!(key in value)) throw new Error(`Canonical Trust evidence_basis missing ${key}`);
  }
}

export function assertCanonicalTrustProjection(trust) {
  if (!trust || typeof trust !== 'object') {
    throw new Error('Vehicle Passport requires a canonical Trust projection');
  }
  if (!TRUST_EVALUATION_STATE_VALUES.includes(trust.evaluation_state)) {
    throw new Error(`Unsupported canonical Trust evaluation_state: ${trust.evaluation_state}`);
  }
  if (!TRUST_CONFIDENCE.includes(trust.confidence)) {
    throw new Error(`Unsupported canonical Trust confidence: ${trust.confidence}`);
  }
  if (!TRUST_SOURCES.includes(trust.source)) {
    throw new Error(`Unsupported canonical Trust source: ${trust.source}`);
  }
  if (!Array.isArray(trust.known_limitations)) {
    throw new Error('Canonical Trust known_limitations must be an array');
  }
  validateEvidenceBasis(trust.evidence_basis);

  const evaluated = trust.evaluation_state === TRUST_EVALUATION_STATES.EVALUATED;
  if (evaluated) {
    assertFiniteScore(trust.score);
    if (!TRUST_BANDS.includes(trust.band)) {
      throw new Error(`Unsupported canonical Trust band: ${trust.band}`);
    }
  } else if (trust.score !== null || trust.band !== null) {
    throw new Error('Non-evaluated canonical Trust must withhold score and band');
  }

  return trust;
}

function labelFor(trust) {
  if (trust.evaluation_state === TRUST_EVALUATION_STATES.EVALUATED) {
    return trust.band === 'insufficient_evidence'
      ? 'Insufficient evidence'
      : trust.band.charAt(0).toUpperCase() + trust.band.slice(1);
  }
  if (trust.evaluation_state === TRUST_EVALUATION_STATES.STALE) return 'Trust needs refresh';
  if (trust.evaluation_state === TRUST_EVALUATION_STATES.UNAVAILABLE) return 'Trust unavailable';
  return 'Not evaluated';
}

function canonicalFields(trust) {
  return Object.fromEntries(PUBLIC_TRUST_FIELDS.map((field) => [field, trust[field] ?? null]));
}

/**
 * Passport Trust Lens.
 *
 * This is presentation only: it validates and relays the canonical public Trust
 * contract. It never derives a band from a score, never computes confidence,
 * never creates a fallback score, and never interprets missing evidence as Trust.
 */
export function buildPassportTrustLens(canonicalTrust) {
  const trust = assertCanonicalTrustProjection(canonicalTrust);
  const evaluated = trust.evaluation_state === TRUST_EVALUATION_STATES.EVALUATED;

  return {
    state: trust.evaluation_state,
    label: labelFor(trust),
    score_visible: evaluated,
    canonical: canonicalFields(trust),
    evidence_context: {
      confidence: trust.confidence,
      evidence_basis: trust.evidence_basis,
      known_limitations: [...trust.known_limitations],
    },
    semantic_guards: {
      trust_is_not_evidence_completeness: true,
      confidence_is_not_score: true,
      unknown_is_not_negative: true,
    },
  };
}

export default {
  assertCanonicalTrustProjection,
  buildPassportTrustLens,
};
