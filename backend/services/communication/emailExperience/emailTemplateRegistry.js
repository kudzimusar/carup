/**
 * The canonical registry of CarUp's reference Email templates.
 *
 * This is NOT a competing template database. `communication_templates` /
 * `communication_template_versions` remain the approval authority for governed sends — a marketing
 * campaign still cannot execute without an active template and an approved version there. This
 * registry declares the RUNTIME contract each reference is built to: which family it belongs to,
 * what consent it requires, what regulated data it may carry, which identity signs it.
 *
 * It exists because those facts were previously spread across a plan document, a prototype, a
 * producer and a renderer, and could disagree without anything noticing. Here they are one object
 * that tests can assert against.
 */
import { buildLeadershipWelcomeDocument } from './referenceLeadershipWelcome.js';

export const CONSENT_REQUIREMENTS = Object.freeze({
  /** Sent because the recipient did something. No opt-in applies and no unsubscribe may appear. */
  NONE_LIFECYCLE: 'none_lifecycle',
  /** Sent because the recipient is part of a conversation. */
  NONE_CONVERSATION: 'none_conversation',
  /** Account protection. Not opt-out — it is P0. */
  NONE_SECURITY: 'none_security',
  /** Requires marketing consent AND passes the canonical suppression gate. */
  MARKETING_OPT_IN: 'marketing_opt_in',
});

export const REGULATED_DATA_POLICY = Object.freeze({
  /** No regulated detail may appear; point at the authenticated surface instead. */
  MINIMISE_POINT_AT_SURFACE: 'minimise_point_at_surface',
  /** Nothing regulated is involved. */
  NOT_APPLICABLE: 'not_applicable',
});

/**
 * The six references.
 *
 * `build` is present once a reference has a runtime document builder. A registry entry without one
 * is a declaration of intent, not a claim that the template exists — and `registeredReferences()`
 * distinguishes them, so nothing can report a reference as shipped before it is.
 */
export const EMAIL_TEMPLATE_REGISTRY = Object.freeze({
  leadership_welcome: Object.freeze({
    reference: 'R1',
    templateKey: 'leadership_welcome_v1',
    version: 1,
    family: 'leadership',
    classification: 'transactional',
    // WHY transactional: it is the outcome of an action the recipient just took — verifying their
    // address — addressed to that recipient, about their own account. It is not `security` (no
    // account-protection decision), not `conversational` (no thread, no participant, no
    // authenticated reply routing), and emphatically not `marketing` (no consent gate applies and no
    // unsubscribe may appear). `service` is reserved for platform-INITIATED administrative notices,
    // and this is user-initiated.
    senderPersona: 'carup_notifications',
    transport: 'resend',
    workflow: 'account_lifecycle',
    recipientRole: 'account_holder',
    consentRequirement: CONSENT_REQUIREMENTS.NONE_LIFECYCLE,
    regulatedDataPolicy: REGULATED_DATA_POLICY.NOT_APPLICABLE,
    primaryAction: 'open_marketplace',
    footerFamily: 'transactional',
    mediaPolicy: 'text_wordmark_only',
    leadershipRequired: true,
    build: buildLeadershipWelcomeDocument,
  }),

  password_reset: Object.freeze({
    reference: 'R2',
    templateKey: 'auth_password_reset_v1',
    version: 1,
    family: 'security',
    classification: 'security',
    senderPersona: 'carup_security',
    transport: 'resend',
    workflow: 'authentication',
    recipientRole: 'account_holder',
    consentRequirement: CONSENT_REQUIREMENTS.NONE_SECURITY,
    regulatedDataPolicy: REGULATED_DATA_POLICY.MINIMISE_POINT_AT_SURFACE,
    primaryAction: 'reset_password',
    footerFamily: 'security',
    mediaPolicy: 'text_wordmark_only',
    leadershipRequired: false,
    // R2 is rendered through the auth equivalence path in `renderEmail.js`, against the physically
    // certified artefact, rather than through a document builder here.
    build: null,
    renderedVia: 'auth_equivalence',
  }),
});

/** Registry keys that have a runtime builder (or an equivalent rendering path). */
export function implementedReferences() {
  return Object.entries(EMAIL_TEMPLATE_REGISTRY)
    .filter(([, entry]) => Boolean(entry.build) || entry.renderedVia === 'auth_equivalence')
    .map(([key]) => key);
}

export function referenceEntry(key) {
  return EMAIL_TEMPLATE_REGISTRY[key] || null;
}

/** Build a registered reference's document, or null when it has no runtime builder. */
export function buildReferenceDocument(key, context) {
  const entry = referenceEntry(key);
  if (!entry?.build) return null;
  return entry.build(context);
}

export default EMAIL_TEMPLATE_REGISTRY;
