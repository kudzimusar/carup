import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * O2-X3 — authentication assurance: is this SESSION currently authenticated strongly enough
 * for this class of action?
 *
 * This is AUTHENTICATION, deliberately distinct from identity PROOFING (7C/lifecycle): step-up
 * proves the account holder is present strongly enough; it never grants the underlying
 * Seller/Dealer/Ownership/Operations authority — those checks always run as well.
 *
 * Everything here derives from the user_sessions ROW the presented token resolves to. Nothing
 * is ever read from client-supplied headers or bodies, so authentication strength cannot be
 * forged: a caller can only change it by actually re-proving themselves through the step-up
 * endpoint, which verifies the credential server-side and stamps the row.
 *
 * Strong authenticators (passkey/WebAuthn): no implementation exists in this repository today
 * and none is pretended. STRONG_AUTHENTICATOR_AVAILABLE is a build-time fact, not a flag; while
 * false, no code path can record a 'webauthn' step-up (the method allowlist refuses it), and
 * the critical class falls back — explicitly, in the policy table below — to a fresh password
 * re-proof. When a real authenticator lands (X-scope of its own), it raises availability and
 * the critical class tightens without any route changing.
 */

export const ASSURANCE_POLICY_VERSION = 'authentication_assurance.v1';

/** Build-time truth: no passkey/WebAuthn/MFA implementation exists yet. Never a runtime flag. */
export const STRONG_AUTHENTICATOR_AVAILABLE = false;

export const AUTHENTICATION_STRENGTHS = Object.freeze({
  SESSION: 'session',
  RECENT_REAUTH: 'recent_reauth',
  STRONG_AUTHENTICATOR: 'strong_authenticator',
});

const STRENGTH_ORDER = Object.freeze({
  [AUTHENTICATION_STRENGTHS.SESSION]: 1,
  [AUTHENTICATION_STRENGTHS.RECENT_REAUTH]: 2,
  [AUTHENTICATION_STRENGTHS.STRONG_AUTHENTICATOR]: 3,
});

export const ACTION_CLASSES = Object.freeze({
  ORDINARY: 'ordinary_action',
  SENSITIVE: 'sensitive_action',
  CRITICAL: 'critical_authority_action',
});

/** How long a step-up satisfies its class. Server clock only. */
export const STEP_UP_TTL_MS = Object.freeze({
  [ACTION_CLASSES.SENSITIVE]: 15 * 60 * 1000,
  [ACTION_CLASSES.CRITICAL]: 5 * 60 * 1000,
});

/**
 * The action-class policy table — the documented contract routes map onto.
 * critical falls back to recent_reauth BECAUSE no strong authenticator exists yet; the
 * deferral is recorded here, in the receipt, and in a pinned test — never silently.
 */
export const ACTION_CLASS_POLICY = Object.freeze({
  [ACTION_CLASSES.ORDINARY]: { requiredStrength: AUTHENTICATION_STRENGTHS.SESSION },
  [ACTION_CLASSES.SENSITIVE]: { requiredStrength: AUTHENTICATION_STRENGTHS.RECENT_REAUTH },
  [ACTION_CLASSES.CRITICAL]: {
    requiredStrength: STRONG_AUTHENTICATOR_AVAILABLE
      ? AUTHENTICATION_STRENGTHS.STRONG_AUTHENTICATOR
      : AUTHENTICATION_STRENGTHS.RECENT_REAUTH,
    deferredStrongAuthenticator: !STRONG_AUTHENTICATOR_AVAILABLE,
  },
});

/** Step-up methods that may be RECORDED, and the strength each confers. */
const STEP_UP_METHODS = Object.freeze({
  password_reauth: AUTHENTICATION_STRENGTHS.RECENT_REAUTH,
  // 'webauthn' is deliberately ABSENT until a real authenticator implementation exists.
});

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Derive a session row's assurance. Pure over (row, nowMs) — trivially testable, and the ONLY
 * inputs are server-held columns.
 */
export function deriveSessionAssurance(sessionRow = {}, nowMs = Date.now()) {
  const stepUpAt = parseTimestamp(sessionRow.step_up_at);
  const stepUpStrength = STEP_UP_METHODS[sessionRow.step_up_method] || null;

  return {
    authentication_method: sessionRow.auth_method || 'password',
    authenticated_at: sessionRow.created_at || null,
    step_up_at: sessionRow.step_up_at || null,
    step_up_method: stepUpStrength ? sessionRow.step_up_method : null,
    stepUpAgeMs: stepUpAt === null ? null : nowMs - stepUpAt,
    stepUpStrength,
    policy_version: ASSURANCE_POLICY_VERSION,
  };
}

/**
 * Does this derived assurance satisfy the class? Returns a refusal the route can surface
 * without leaking anything sensitive.
 */
export function satisfiesActionClass(assurance, actionClass, nowMs = Date.now()) {
  const policy = ACTION_CLASS_POLICY[actionClass];
  if (!policy) throw new ValidationError(`Unknown action class: ${actionClass}.`);

  const required = policy.requiredStrength;
  if (required === AUTHENTICATION_STRENGTHS.SESSION) {
    return { ok: true, required_strength: required, current_strength: AUTHENTICATION_STRENGTHS.SESSION };
  }

  const ttl = STEP_UP_TTL_MS[actionClass];
  const fresh = Boolean(
    assurance.stepUpStrength
    && assurance.stepUpAgeMs !== null
    && assurance.stepUpAgeMs >= 0
    && assurance.stepUpAgeMs <= ttl,
  );

  const currentStrength = fresh ? assurance.stepUpStrength : AUTHENTICATION_STRENGTHS.SESSION;
  const ok = Boolean(fresh && STRENGTH_ORDER[currentStrength] >= STRENGTH_ORDER[required]);

  return {
    ok,
    required_strength: required,
    current_strength: currentStrength,
    step_up_ttl_seconds: Math.floor(ttl / 1000),
    reason: ok ? null : 'STEP_UP_REQUIRED',
  };
}

/**
 * Record a completed step-up on the PRESENTING session row. The caller (route) has already
 * verified the credential server-side; this only stamps how and when. The method must be one
 * the platform actually possesses — there is no way to record a strength that does not exist.
 */
export async function recordStepUp(client = supabase, { token, userId, method = 'password_reauth' } = {}, options = {}) {
  if (!token || !userId) throw new ValidationError('token and userId are required.');
  if (!STEP_UP_METHODS[method]) {
    throw new ValidationError(`Unsupported step-up method: ${method}.`);
  }

  const stampedAt = new Date().toISOString();
  const { data, error } = await client
    .from('user_sessions')
    .update({ step_up_at: stampedAt, step_up_method: method })
    .eq('token', token)
    .eq('user_id', userId)
    .eq('is_valid', true)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Could not record step-up on the presenting session${error ? `: ${error.message}` : '.'}`);
  }

  const auditResult = await logAuditEvent(client, {
    req: options.req,
    event_type: 'AUTH_STEP_UP_COMPLETED',
    actor_user_id: userId,
    actor_role: options.actorRole || null,
    source_route: '/api/auth/step-up',
    targetType: 'user_session',
    targetId: data.id,
    new_value: { method, step_up_at: stampedAt, policy_version: ASSURANCE_POLICY_VERSION },
  });
  if (!auditResult.success) {
    console.warn('Step-up audit write failed:', auditResult.error);
  }

  return { session_id: data.id, step_up_at: stampedAt, method };
}

export default {
  ASSURANCE_POLICY_VERSION,
  STRONG_AUTHENTICATOR_AVAILABLE,
  AUTHENTICATION_STRENGTHS,
  ACTION_CLASSES,
  ACTION_CLASS_POLICY,
  STEP_UP_TTL_MS,
  deriveSessionAssurance,
  satisfiesActionClass,
  recordStepUp,
};
