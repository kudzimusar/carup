import { supabase } from '../../../db/supabase.js';
import { logAuditEvent } from '../../auditLogger.js';
import { emitDomainEvent } from '../../eventBus/eventBusService.js';
import { ForbiddenError, ValidationError } from '../../../utils/errors.js';
import {
  BIOMETRIC_CONSENT_POLICY_VERSION,
  BIOMETRIC_CONSENT_TEXT_VERSION,
  BIOMETRIC_PURPOSES,
} from './biometricProvider.js';

/**
 * O2-X4 — explicit biometric consent as a governed event history.
 *
 * Consent is AFFIRMATIVE and SELF-ONLY: the subject is always the authenticated caller (a
 * consent can never be granted for someone else from a request body), the grant requires the
 * explicit `consent: true` acknowledgement of the versioned consent text, and general
 * Terms/Privacy acceptance is never inferred to cover biometric processing. Withdrawal is a
 * new ledger row — it stops NEW processing and erases nothing: the historical fact that
 * processing occurred stays auditable forever.
 */

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Biometric consent audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

function requireUserId(actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  return userId;
}

async function latestConsentRow(client, userId) {
  const { data, error } = await client
    .from('identity_biometric_consents')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  const rows = (data || []).slice().sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
  return rows[0] || null;
}

/** Current consent state for a user id — used self-side and by the governed reviewer read. */
export async function getBiometricConsentStateForUser(client = supabase, userId) {
  if (!userId) throw new ValidationError('userId is required.');
  const latest = await latestConsentRow(client, userId);
  const active = Boolean(latest && latest.status === 'granted');
  return {
    active,
    status: latest?.status || 'none',
    purposes: latest?.purposes || null,
    consent_text_version: latest?.consent_text_version || null,
    policy_version: BIOMETRIC_CONSENT_POLICY_VERSION,
    granted_at: active ? latest.created_at : null,
    withdrawn_at: latest?.status === 'withdrawn' ? latest.created_at : null,
    consent_id: active ? latest.id : null,
  };
}

/** Applicant-safe view of the caller's OWN current biometric consent. */
export async function getBiometricConsentState(client = supabase, actor = {}) {
  return getBiometricConsentStateForUser(client, requireUserId(actor));
}

export async function grantBiometricConsent(client = supabase, actor = {}, payload = {}, options = {}) {
  const userId = requireUserId(actor);

  // Affirmative, specific, versioned. Nothing is inferred from Terms, uploads or submission.
  if (payload.consent !== true) {
    throw new ValidationError('Biometric consent must be given explicitly (consent: true).');
  }
  const textVersion = String(payload.consent_text_version || '').trim();
  if (textVersion !== BIOMETRIC_CONSENT_TEXT_VERSION) {
    throw new ValidationError(
      `Biometric consent must acknowledge the current consent text (${BIOMETRIC_CONSENT_TEXT_VERSION}).`,
    );
  }
  const purposes = Array.isArray(payload.purposes) ? payload.purposes.map(String) : [];
  if (!purposes.length || purposes.some((p) => !BIOMETRIC_PURPOSES.includes(p))) {
    throw new ValidationError(`Consent purposes must be a non-empty subset of: ${BIOMETRIC_PURPOSES.join(', ')}.`);
  }

  const previous = await latestConsentRow(client, userId);
  const row = {
    user_id: userId,
    session_id: payload.session_id || null,
    status: 'granted',
    purposes,
    policy_version: BIOMETRIC_CONSENT_POLICY_VERSION,
    consent_text_version: textVersion,
    source: options.source || 'applicant_web',
    actor_kind: 'user',
    actor_user_id: userId,
    supersedes_id: previous?.id || null,
    created_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await client
    .from('identity_biometric_consents')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'BIOMETRIC_CONSENT_GRANTED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/identity/biometric-consent',
    targetType: 'identity_biometric_consent',
    targetId: inserted.id,
    new_value: { purposes, consent_text_version: textVersion, policy_version: BIOMETRIC_CONSENT_POLICY_VERSION },
  });

  await emitDomainEvent(null, 'identity.biometric.consent.granted', {
    userId,
    recipientUserId: userId,
    consentId: inserted.id,
    purposes,
  }, null).catch((err) => console.warn('biometric consent event emit failed:', err.message));

  return inserted;
}

export async function withdrawBiometricConsent(client = supabase, actor = {}, payload = {}, options = {}) {
  const userId = requireUserId(actor);
  const previous = await latestConsentRow(client, userId);
  if (!previous || previous.status !== 'granted') {
    throw new ForbiddenError('There is no active biometric consent to withdraw.');
  }

  const row = {
    user_id: userId,
    session_id: previous.session_id,
    status: 'withdrawn',
    purposes: previous.purposes,
    policy_version: BIOMETRIC_CONSENT_POLICY_VERSION,
    consent_text_version: previous.consent_text_version,
    source: options.source || 'applicant_web',
    actor_kind: 'user',
    actor_user_id: userId,
    supersedes_id: previous.id,
    note: String(payload.reason || '').slice(0, 300) || null,
    created_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await client
    .from('identity_biometric_consents')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'BIOMETRIC_CONSENT_WITHDRAWN',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/identity/biometric-consent/withdraw',
    targetType: 'identity_biometric_consent',
    targetId: inserted.id,
    previous_value: { consent_id: previous.id },
    new_value: { policy_version: BIOMETRIC_CONSENT_POLICY_VERSION },
  });

  return inserted;
}

/**
 * The gate every provider call sits behind: the caller's CURRENT consent must be an active
 * grant covering every requested purpose. Fails closed by name.
 */
export async function requireActiveBiometricConsent(client = supabase, userId, purposes = BIOMETRIC_PURPOSES) {
  const latest = await latestConsentRow(client, userId);
  if (!latest || latest.status !== 'granted') {
    throw new ForbiddenError('BIOMETRIC_CONSENT_REQUIRED: no active biometric consent exists for this user.');
  }
  const granted = Array.isArray(latest.purposes) ? latest.purposes : [];
  for (const purpose of purposes) {
    if (!granted.includes(purpose)) {
      throw new ForbiddenError(`BIOMETRIC_CONSENT_REQUIRED: consent does not cover '${purpose}'.`);
    }
  }
  return latest;
}

export default {
  getBiometricConsentState,
  grantBiometricConsent,
  withdrawBiometricConsent,
  requireActiveBiometricConsent,
};
