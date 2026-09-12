/**
 * O2-X4 — provider-neutral biometric verification contract.
 *
 * CarUp owns the vocabulary; vendors are adapters behind `createAssessment(...)` returning a
 * NORMALIZED result. Two laws, both pinned by tests:
 *
 *   Biometrics provide evidence. Biometrics do not decide identity.
 *   Provider success ≠ biometric match ≠ identity verified.
 *
 * There is deliberately NO vendor adapter and NO simulated success in this file or anywhere in
 * runtime code: until a real provider is selected (Product Owner decision — see
 * CARUP_OPERATIONS_O2_X4_BIOMETRIC_PROVIDER_DECISION.md) and configured, the registry resolves
 * the honest null provider, whose every assessment reports `not_configured`. Test doubles are
 * injected by the test suite through the service's options seam and are refused outside
 * NODE_ENV=test — the X1 OCR truth rule, applied to faces.
 */
import { ValidationError } from '../../../utils/errors.js';

export const BIOMETRIC_THRESHOLD_POLICY_VERSION = 'biometric_threshold.v1';
export const BIOMETRIC_CONSENT_POLICY_VERSION = 'biometric_consent.v1';
export const BIOMETRIC_CONSENT_TEXT_VERSION = 'biometric_consent_text.v1';

export const BIOMETRIC_PURPOSES = Object.freeze(['face_document_match', 'liveness']);

export const FACE_MATCH_STATUS = Object.freeze({
  MATCH: 'match',
  MISMATCH: 'mismatch',
  INDETERMINATE: 'indeterminate',
  PROVIDER_FAILED: 'provider_failed',
  NOT_RUN: 'not_run',
});

export const LIVENESS_STATUS = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  INDETERMINATE: 'indeterminate',
  PROVIDER_FAILED: 'provider_failed',
  NOT_RUN: 'not_run',
});

export const BIOMETRIC_PROVIDER_STATE = Object.freeze({
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNAVAILABLE: 'unavailable',
  NOT_CONFIGURED: 'not_configured',
});

/**
 * Server-owned, versioned threshold policy. A provider score is EVIDENCE; clearing a threshold
 * yields "high-confidence biometric evidence", never "verified". Raw provider verdicts are
 * re-derived through these thresholds so a vendor's own optimism cannot leak straight into
 * CarUp vocabulary.
 */
export const BIOMETRIC_THRESHOLDS = Object.freeze({
  face_match_min_score: 0.85,
  face_mismatch_max_score: 0.40,
  liveness_min_score: 0.80,
});

const clampScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
};

/**
 * Normalize a raw provider payload into the CarUp assessment shape. Only server-side inputs
 * ever reach this function — routes accept no scores, statuses or verdicts from clients.
 */
export function normalizeProviderResult(raw = {}) {
  const state = Object.values(BIOMETRIC_PROVIDER_STATE).includes(raw.state)
    ? raw.state
    : (raw.state ? BIOMETRIC_PROVIDER_STATE.FAILED : BIOMETRIC_PROVIDER_STATE.UNAVAILABLE);

  const faceScore = clampScore(raw.faceMatchScore);
  const livenessScore = clampScore(raw.livenessScore);

  let faceStatus = FACE_MATCH_STATUS.NOT_RUN;
  let livenessStatus = LIVENESS_STATUS.NOT_RUN;

  if (state === BIOMETRIC_PROVIDER_STATE.COMPLETED) {
    if (faceScore === null) {
      faceStatus = FACE_MATCH_STATUS.INDETERMINATE;
    } else if (faceScore >= BIOMETRIC_THRESHOLDS.face_match_min_score) {
      faceStatus = FACE_MATCH_STATUS.MATCH;
    } else if (faceScore <= BIOMETRIC_THRESHOLDS.face_mismatch_max_score) {
      faceStatus = FACE_MATCH_STATUS.MISMATCH;
    } else {
      faceStatus = FACE_MATCH_STATUS.INDETERMINATE;
    }

    if (raw.livenessVerdict === 'failed') {
      livenessStatus = LIVENESS_STATUS.FAILED;
    } else if (livenessScore === null) {
      livenessStatus = LIVENESS_STATUS.INDETERMINATE;
    } else if (livenessScore >= BIOMETRIC_THRESHOLDS.liveness_min_score) {
      livenessStatus = LIVENESS_STATUS.PASSED;
    } else {
      livenessStatus = LIVENESS_STATUS.FAILED;
    }
  } else if (state === BIOMETRIC_PROVIDER_STATE.FAILED || state === BIOMETRIC_PROVIDER_STATE.UNAVAILABLE) {
    faceStatus = FACE_MATCH_STATUS.PROVIDER_FAILED;
    livenessStatus = LIVENESS_STATUS.PROVIDER_FAILED;
  }
  // not_configured keeps both at NOT_RUN: nothing ran, and nothing pretends to have run.

  return {
    provider: raw.provider || 'none',
    provider_model: raw.providerModel || null,
    provider_reference: raw.providerReference || null,
    provider_state: state,
    face_match_status: faceStatus,
    face_match_score: faceScore,
    liveness_status: livenessStatus,
    liveness_score: livenessScore,
    risk_flags: Array.isArray(raw.riskFlags) ? raw.riskFlags.slice(0, 20).map(String) : [],
    evidence_hashes: raw.evidenceHashes && typeof raw.evidenceHashes === 'object' ? raw.evidenceHashes : null,
    threshold_policy_version: BIOMETRIC_THRESHOLD_POLICY_VERSION,
  };
}

/**
 * The honest default: no provider is configured, and no success is synthesized. Providers
 * return the RAW shape; the assessment service normalizes exactly once.
 */
export const nullBiometricProvider = Object.freeze({
  name: 'none',
  async createAssessment() {
    return { provider: 'none', state: BIOMETRIC_PROVIDER_STATE.NOT_CONFIGURED };
  },
});

/**
 * Resolve the runtime provider. Until a vendor is approved and implemented, every environment
 * resolves the null provider; configuring an unknown vendor name fails LOUDLY rather than
 * silently degrading, and no test/mock provider is resolvable here at all.
 */
export function resolveBiometricProvider(env = process.env) {
  const configured = String(env.BIOMETRIC_PROVIDER || '').trim().toLowerCase();
  if (!configured || configured === 'none') return nullBiometricProvider;
  throw new ValidationError(
    `Biometric provider '${configured}' is not implemented. Provider selection is a governed decision — see CARUP_OPERATIONS_O2_X4_BIOMETRIC_PROVIDER_DECISION.md.`,
  );
}

export default {
  BIOMETRIC_THRESHOLD_POLICY_VERSION,
  BIOMETRIC_CONSENT_POLICY_VERSION,
  BIOMETRIC_CONSENT_TEXT_VERSION,
  BIOMETRIC_PURPOSES,
  FACE_MATCH_STATUS,
  LIVENESS_STATUS,
  BIOMETRIC_PROVIDER_STATE,
  BIOMETRIC_THRESHOLDS,
  normalizeProviderResult,
  nullBiometricProvider,
  resolveBiometricProvider,
};
