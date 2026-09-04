import { supabase } from '../../../db/supabase.js';
import { logAuditEvent } from '../../auditLogger.js';
import { emitDomainEvent } from '../../eventBus/eventBusService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../utils/errors.js';
import { requireActiveBiometricConsent } from './biometricConsentService.js';
import {
  BIOMETRIC_PROVIDER_STATE,
  FACE_MATCH_STATUS,
  LIVENESS_STATUS,
  normalizeProviderResult,
  resolveBiometricProvider,
} from './biometricProvider.js';

/**
 * O2-X4 — run a biometric assessment and persist it as EVIDENCE on the 7C case.
 *
 * The result lands as one more append-only verification_assessments row
 * (assessment_source 'biometric_provider'), never as a session status change and never as a
 * decision: approval stays with the governed 7C review, whose policy merely CONSUMES this
 * evidence. Every write carries provider provenance, the versioned threshold policy and the
 * consent row it ran under. No score, status or verdict is ever accepted from the client —
 * the route takes a session id and nothing else.
 *
 * Test doubles: a provider may be injected ONLY under NODE_ENV=test (the X1 OCR rule). In any
 * other environment the registry's resolution stands — today, the honest null provider.
 */

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Biometric assessment audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

function requireUserId(actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  return userId;
}

async function fetchOwnSession(client, sessionId, userId) {
  const { data, error } = await client
    .from('verification_sessions')
    .select('id, user_id, status, document_type, front_storage_path, selfie_storage_path')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new NotFoundError('Verification session not found.');
  return data;
}

/** Latest biometric assessment row for a session (evidence for policy + reviewer). */
export async function fetchLatestBiometricAssessment(client = supabase, sessionId) {
  const { data, error } = await client
    .from('verification_assessments')
    .select('*')
    .eq('session_id', sessionId)
    .eq('assessment_source', 'biometric_provider');
  if (error) throw new Error(error.message);
  const rows = (data || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows[0] || null;
}

/** Applicant-safe projection: statuses and provider state — no risk flags, no references. */
export function toApplicantBiometricView(assessmentRow) {
  if (!assessmentRow) return null;
  return {
    face_match_status: assessmentRow.face_match_status || FACE_MATCH_STATUS.NOT_RUN,
    liveness_status: assessmentRow.liveness_status || LIVENESS_STATUS.NOT_RUN,
    provider_state: assessmentRow.provider_state || BIOMETRIC_PROVIDER_STATE.NOT_CONFIGURED,
    assessed_at: assessmentRow.created_at || null,
  };
}

/**
 * Run the assessment for the caller's OWN session. Consent is checked FIRST — the provider is
 * never invoked without an active grant covering both purposes.
 */
export async function runBiometricAssessment(client = supabase, actor = {}, sessionId, options = {}) {
  const userId = requireUserId(actor);
  const session = await fetchOwnSession(client, sessionId, userId);

  if (!session.selfie_storage_path || !session.front_storage_path) {
    throw new ValidationError('Biometric assessment requires the document front and a selfie to be uploaded first.');
  }

  // 1. Consent gate — before ANY provider interaction.
  const consent = await requireActiveBiometricConsent(client, userId);

  // 2. Provider: injected doubles are test-only; everything else resolves via the registry.
  let provider = options.provider || null;
  if (provider && process.env.NODE_ENV !== 'test') {
    throw new ForbiddenError('Injected biometric providers are permitted only in the test suite.');
  }
  if (!provider) provider = resolveBiometricProvider();

  let raw;
  try {
    raw = await provider.createAssessment({
      sessionId: session.id,
      userId,
      documentType: session.document_type,
      // References only — the provider contract never receives raw media through this seam;
      // a hosted-capture vendor supplies its own session, and CarUp stores no biometric media.
      evidenceReferences: {
        document_front: Boolean(session.front_storage_path),
        selfie: Boolean(session.selfie_storage_path),
      },
    });
  } catch (err) {
    raw = { provider: provider.name || 'unknown', state: BIOMETRIC_PROVIDER_STATE.UNAVAILABLE, riskFlags: ['provider_error'] };
    console.warn('Biometric provider call failed:', err.message);
  }

  const normalized = normalizeProviderResult(raw);

  const riskFlags = [...normalized.risk_flags];
  if (normalized.provider_state === BIOMETRIC_PROVIDER_STATE.NOT_CONFIGURED) riskFlags.push('biometric_not_configured');
  if (normalized.provider_state === BIOMETRIC_PROVIDER_STATE.UNAVAILABLE) riskFlags.push('biometric_provider_unavailable');

  const row = {
    session_id: session.id,
    assessment_source: 'biometric_provider',
    provider: normalized.provider,
    provider_model: normalized.provider_model,
    provider_reference: normalized.provider_reference,
    provider_state: normalized.provider_state,
    face_match_status: normalized.face_match_status,
    face_match_score: normalized.face_match_score,
    liveness_status: normalized.liveness_status,
    liveness_score: normalized.liveness_score,
    threshold_policy_version: normalized.threshold_policy_version,
    consent_id: consent.id,
    risk_flags: riskFlags,
    evidence_hashes: normalized.evidence_hashes,
    created_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await client
    .from('verification_assessments')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'BIOMETRIC_ASSESSMENT_RECORDED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: `/api/identity/verification-sessions/${session.id}/biometrics`,
    targetType: 'verification_assessment',
    targetId: inserted.id,
    new_value: {
      provider: row.provider,
      provider_state: row.provider_state,
      face_match_status: row.face_match_status,
      liveness_status: row.liveness_status,
      threshold_policy_version: row.threshold_policy_version,
      consent_id: consent.id,
    },
  });

  await emitDomainEvent(null, 'identity.biometric.assessed', {
    userId,
    recipientUserId: userId,
    sessionId: session.id,
    providerState: row.provider_state,
    faceMatchStatus: row.face_match_status,
    livenessStatus: row.liveness_status,
  }, null).catch((err) => console.warn('biometric assessed event emit failed:', err.message));

  return { assessment: inserted, applicant_view: toApplicantBiometricView(inserted) };
}

export default {
  fetchLatestBiometricAssessment,
  toApplicantBiometricView,
  runBiometricAssessment,
};
