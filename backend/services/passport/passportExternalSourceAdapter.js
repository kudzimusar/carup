import {
  VERIFICATION_MODES,
  VERIFICATION_RESULTS,
  normalizeVerificationResult,
} from '../sourceVerification/verificationContract.js';

export const PASSPORT_INSTITUTIONAL_CAPABILITIES = Object.freeze([
  'government_source',
  'insurance',
  'finance',
  'inspection',
  'service',
  'parts',
]);

const CAPABILITY_SET = new Set(PASSPORT_INSTITUTIONAL_CAPABILITIES);
const MODE_SET = new Set(VERIFICATION_MODES);
const RESULT_SET = new Set(VERIFICATION_RESULTS);

function looksLikeSecret(value) {
  if (value == null) return false;
  return /(sbp_|eyJ[A-Za-z0-9_-]{20,}|postgres:\/\/|password\s*=|BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*[:=])/i
    .test(String(value));
}

function assertLiveProof(mode, proof) {
  if (mode !== 'live') return null;
  if (!proof || proof.connected !== true) {
    throw new Error('Passport external source cannot claim live mode without connected runtime proof');
  }
  for (const field of ['environment', 'observed_at', 'request_id', 'provider_response_id']) {
    if (!proof[field]) throw new Error(`Passport live runtime proof requires ${field}`);
  }
  if (!['staging', 'production'].includes(proof.environment)) {
    throw new Error('Passport live runtime proof environment must be staging or production');
  }
  return {
    connected: true,
    environment: proof.environment,
    observed_at: proof.observed_at,
    request_id: proof.request_id,
    provider_response_id: proof.provider_response_id,
    evidence_ref: proof.evidence_ref ?? null,
  };
}

export function normalizeInstitutionalAdapterDescriptor(raw = {}) {
  if (!raw.provider_key) throw new Error('Passport adapter descriptor requires provider_key');
  if (!raw.authority_name) throw new Error('Passport adapter descriptor requires authority_name');
  if (!CAPABILITY_SET.has(raw.capability_type)) {
    throw new Error(`Unsupported Passport institutional capability: ${raw.capability_type}`);
  }
  if (!MODE_SET.has(raw.mode)) throw new Error(`Unsupported Passport adapter mode: ${raw.mode}`);
  if (!raw.legal_basis) throw new Error('Passport adapter descriptor requires legal_basis');
  if (!raw.request_identity || typeof raw.request_identity !== 'object') {
    throw new Error('Passport adapter descriptor requires request_identity');
  }
  if (!raw.response_schema || typeof raw.response_schema !== 'object') {
    throw new Error('Passport adapter descriptor requires response_schema');
  }
  if (!raw.evidence_retention) throw new Error('Passport adapter descriptor requires evidence_retention');
  if (!raw.retry_policy) throw new Error('Passport adapter descriptor requires retry_policy');
  if (!raw.audit_policy) throw new Error('Passport adapter descriptor requires audit_policy');
  if (!raw.privacy_policy) throw new Error('Passport adapter descriptor requires privacy_policy');
  if (!raw.user_visible_wording) throw new Error('Passport adapter descriptor requires user_visible_wording');

  if (looksLikeSecret(raw.credential_ref)) {
    throw new Error('Passport adapter descriptor may store only a credential reference, never a secret');
  }

  return {
    provider_key: String(raw.provider_key),
    authority_name: String(raw.authority_name),
    capability_type: raw.capability_type,
    mode: raw.mode,
    legal_basis: raw.legal_basis,
    request_identity: structuredClone(raw.request_identity),
    response_schema: structuredClone(raw.response_schema),
    source_timestamp_field: raw.source_timestamp_field ?? 'retrieved_at',
    evidence_retention: raw.evidence_retention,
    retry_policy: raw.retry_policy,
    credential_ref: raw.credential_ref ?? null,
    audit_policy: raw.audit_policy,
    privacy_policy: raw.privacy_policy,
    user_visible_wording: raw.user_visible_wording,
    runtime_proof: assertLiveProof(raw.mode, raw.runtime_proof),
  };
}

function publicOutcomeWording(result) {
  switch (result) {
    case 'match': return 'A connected source returned a matching record.';
    case 'mismatch': return 'A connected source returned information that does not fully match CarUp records.';
    case 'no_record': return 'The source returned no matching record. This is not a clearance or positive verification.';
    case 'high_risk': return 'The source returned an adverse result that requires governed review.';
    case 'manual_review': return 'The source result requires human review.';
    default: return 'The source is unavailable. No conclusion can be drawn from this source.';
  }
}

export function projectExternalVerificationForPassport(rawResult, descriptorInput, {
  includeSourceReference = false,
} = {}) {
  const descriptor = normalizeInstitutionalAdapterDescriptor(descriptorInput);

  // Government verification already owns the canonical normalization vocabulary.
  // Reuse it rather than defining a second result engine inside Passport.
  const normalized = normalizeVerificationResult(descriptor.provider_key, rawResult);

  if (!RESULT_SET.has(normalized.result)) {
    throw new Error(`Unsupported Passport source result: ${normalized.result}`);
  }
  if (normalized.mode !== descriptor.mode) {
    throw new Error(
      `Passport source mode mismatch: descriptor=${descriptor.mode} result=${normalized.mode}`,
    );
  }

  const projection = {
    provider_key: descriptor.provider_key,
    authority_name: descriptor.authority_name,
    capability_type: descriptor.capability_type,
    mode: descriptor.mode,
    result: normalized.result,
    retrieved_at: normalized.retrieved_at,
    confidence: normalized.confidence,
    legal_basis: normalized.legal_basis ?? descriptor.legal_basis,
    user_visible_wording: publicOutcomeWording(normalized.result),
    live_connectivity_proven: descriptor.mode === 'live',
    source_reference: null,
  };

  if (includeSourceReference) {
    projection.source_reference = normalized.source_record_id ?? null;
  }

  return projection;
}

export function assertNoFalsePositiveSourceLanguage(projection = {}) {
  const text = String(projection.user_visible_wording || '').toLowerCase();

  // Detect affirmative reassurance, not cautionary negation such as
  // "not a clearance" or "not verified". The safety rule is semantic:
  // no_record/unavailable may explain what they DO NOT establish.
  const positiveClaim =
    /\bcleared\b|\bis clear\b|\bverified by\b|\bofficially verified\b|\bgovernment verified\b|\bsafe\b|\bclean record\b|\bno issues?\b/;

  if (projection.result === 'no_record' && positiveClaim.test(text)) {
    throw new Error('Passport no-record source wording cannot imply clearance or verification');
  }
  if (projection.result === 'unavailable' && positiveClaim.test(text)) {
    throw new Error('Passport unavailable source wording cannot imply a positive conclusion');
  }
  if (projection.mode !== 'live' && /live verified|officially verified|government verified/.test(text)) {
    throw new Error('Passport non-live source wording cannot imply live authority');
  }
  return projection;
}

export default {
  PASSPORT_INSTITUTIONAL_CAPABILITIES,
  normalizeInstitutionalAdapterDescriptor,
  projectExternalVerificationForPassport,
  assertNoFalsePositiveSourceLanguage,
};
