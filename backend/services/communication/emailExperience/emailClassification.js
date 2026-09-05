/**
 * The canonical Email classification contract.
 *
 * G3 exposed that four of the five non-marketing families were "not marketing" by ABSENCE rather
 * than by assertion: `String(undefined) !== 'marketing'` happened to reach the right answer. Worse,
 * two components defaulted the same missing field differently — the transport router to
 * `'transactional'`, the delivery worker to `''`. A renderer cannot pick a family from a value that
 * two callers disagree about, and a provider must never be chosen by a default.
 *
 * The vocabulary is NOT new. It is `CLASSIFICATION_TRANSPORT` in `emailStakeholderMatrix.js`, which
 * already declares the five values and their transports; this module is the validator over it, so
 * there is one vocabulary and one normalizer rather than two of each.
 *
 * There is deliberately no `auth` value. Account-protection Email is `security`.
 */
import { CLASSIFICATION_TRANSPORT } from '../emailStakeholderMatrix.js';

export const EMAIL_CLASSIFICATIONS = Object.freeze(Object.keys(CLASSIFICATION_TRANSPORT));

export const EMAIL_CLASSIFICATION_ERRORS = Object.freeze({
  MISSING: 'email_classification_missing',
  INVALID: 'email_classification_invalid',
  CONFLICT: 'email_classification_conflict',
});

/** Where a classification came from. Provenance, so a wrong family is traceable to its producer. */
export const CLASSIFICATION_SOURCES = Object.freeze({
  PRODUCER: 'producer',
  POLICY: 'policy',
  GOVERNED_TEMPLATE: 'governed_template',
  LEGACY_DETERMINISTIC: 'legacy_deterministic',
});

/**
 * Legacy rows queued before the classification contract existed.
 *
 * ONE-TO-ONE canonical signals only. `missing => transactional` is explicitly NOT an inference:
 * it is the absence-as-semantics defect this module exists to remove, and it would silently pick a
 * provider. A row that matches nothing here is quarantined, never guessed at.
 *
 * Auth template keys are one-to-one because `AUTH_EMAIL_TEMPLATES` declares
 * `classification: 'security'` on every entry. Campaign identity is one-to-one because
 * `assertMarketingTemplate` refuses to create a campaign whose template is not classified marketing.
 */
const LEGACY_AUTH_TEMPLATE_KEYS = new Set([
  'auth_password_reset_v1', 'auth_email_verification_v1', 'auth_password_changed_v1',
]);

function legacyDeterministic(notification = {}) {
  const payload = notification.payload || {};
  if (payload.auth_template_key) return 'security';
  const templateKey = String(notification.template_key || payload.template_key || '');
  if (LEGACY_AUTH_TEMPLATE_KEYS.has(templateKey)) return 'security';
  if (payload.campaign_id || payload.campaign_delivery_id) return 'marketing';
  if (String(notification.notification_type || notification.type || '') === 'campaign_message') return 'marketing';
  return null;
}

/** Canonicalize a supplied value, or null when it is not one of the five. */
export function normalizeEmailClassification(value) {
  const candidate = String(value ?? '').trim().toLowerCase();
  if (!candidate) return null;
  return EMAIL_CLASSIFICATIONS.includes(candidate) ? candidate : null;
}

export function isEmailClassification(value) {
  return normalizeEmailClassification(value) !== null;
}

/** The transport a classification is governed onto. */
export function transportForClassification(classification) {
  return CLASSIFICATION_TRANSPORT[normalizeEmailClassification(classification)] || null;
}

function failure(errorCode, errorMessage, extra = {}) {
  return { ok: false, errorCode, errorMessage, ...extra };
}

/**
 * Resolve the one canonical classification for an Email notification.
 *
 * `payload.classification` is canonical; `metadata.classification` is provenance. They are read
 * together rather than in precedence order, because a silent disagreement between two stored values
 * is exactly the state where a message is rendered as one family and transported as another.
 *
 * Fails CLOSED in all three directions: missing, invalid, and conflicting.
 */
export function resolveEmailClassification(notification = {}) {
  const payload = notification.payload || {};
  const metadata = notification.metadata || {};

  const rawPayload = payload.classification;
  const rawMetadata = metadata.classification;

  const fromPayload = normalizeEmailClassification(rawPayload);
  const fromMetadata = normalizeEmailClassification(rawMetadata);

  const payloadPresent = String(rawPayload ?? '').trim() !== '';
  const metadataPresent = String(rawMetadata ?? '').trim() !== '';

  if (payloadPresent && !fromPayload) {
    return failure(EMAIL_CLASSIFICATION_ERRORS.INVALID, `'${rawPayload}' is not a canonical CarUp Email classification.`);
  }
  if (metadataPresent && !fromMetadata) {
    return failure(EMAIL_CLASSIFICATION_ERRORS.INVALID, `'${rawMetadata}' is not a canonical CarUp Email classification.`);
  }
  if (fromPayload && fromMetadata && fromPayload !== fromMetadata) {
    return failure(
      EMAIL_CLASSIFICATION_ERRORS.CONFLICT,
      `Stored classifications disagree: payload='${fromPayload}' metadata='${fromMetadata}'. Refusing rather than choosing one.`,
    );
  }

  const explicit = fromPayload || fromMetadata;
  if (explicit) {
    return {
      ok: true,
      classification: explicit,
      source: normalizeEmailClassification(metadata.classification_source) === null
        ? (metadata.classification_source || CLASSIFICATION_SOURCES.PRODUCER)
        : CLASSIFICATION_SOURCES.PRODUCER,
    };
  }

  const derived = legacyDeterministic(notification);
  if (derived) return { ok: true, classification: derived, source: CLASSIFICATION_SOURCES.LEGACY_DETERMINISTIC };

  return failure(
    EMAIL_CLASSIFICATION_ERRORS.MISSING,
    'This Email carries no canonical classification and none can be derived deterministically; refusing rather than defaulting to a provider.',
  );
}

export default resolveEmailClassification;
