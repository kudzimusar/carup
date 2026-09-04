/**
 * G2 — the ONE rendering boundary every CarUp Email passes through before transport.
 *
 * `renderEmailForNotification(notification, deps)` is the only function the delivery worker calls,
 * and the only place an Email's presentation is decided. Before it, presentation was scattered:
 * `authEmailTemplates.js` for auth, the Brevo adapter for marketing (until G3 took that away), and
 * bare `text/plain` for everything else.
 *
 * Two hard rules govern what happens when rendering cannot succeed, and they point in OPPOSITE
 * directions on purpose:
 *
 *   NON-MARKETING   degrade to the canonical plain-text message and record it. A password reset must
 *                   not be lost because decorative HTML failed — the text part carries the full
 *                   meaning, which is why CarUp writes it that way.
 *
 *   MARKETING       refuse. Zero provider calls. Marketing may not fall back to an unmarked
 *                   text-only send, because that send would carry no unsubscribe control — which is
 *                   the exact artefact that reached a real human inbox and started this programme.
 *
 * It renders no auth Email. `authEmailTemplates.js` remains the physically certified P0 path until
 * R2 equivalence is proven at G6, so an auth notification returns its canonical text and NO html,
 * leaving the Resend adapter's existing `resolveAuthHtml()` compatibility path untouched.
 */
import { isCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';
import { AUTH_EMAIL_COPY, renderAuthEmail } from '../authEmailTemplates.js';
import { checkAuthEquivalence } from './authEquivalence.js';
import { buildReferenceDocument, referenceEntry } from './emailTemplateRegistry.js';
import {
  EMAIL_CLASSIFICATION_ERRORS,
  resolveEmailClassification,
} from './emailClassification.js';
import { footerFamilyFor } from './emailFooters.js';
import { renderEmailHtml } from './emailLayouts.js';
import { renderEmailText } from './emailTextRenderer.js';
import { senderPersonaFor } from './emailSenderPersona.js';
import {
  UNSUBSCRIBE_PRESENTATION_ERRORS,
  validateMarketingUnsubscribePresentation,
} from './marketingUnsubscribePresentation.js';

export const EMAIL_RENDERER_VERSION = 'carup-email-renderer/1.0.0';

export const RENDER_FALLBACKS = Object.freeze({
  NONE: null,
  PLAIN_TEXT_DEGRADED: 'plain_text_degraded',
  AUTH_COMPATIBILITY: 'auth_compatibility',
  /** G6: the canonical auth render did not hold equivalence, so the certified artefact was used. */
  AUTH_EQUIVALENCE_FAILED: 'auth_equivalence_failed',
});

/**
 * Auth templates migrated to the canonical renderer, one at a time.
 *
 * R2 (password reset) is migrated in G6. `confirm_signup` and `password_changed` stay on the
 * certified path until each has its own equivalence proof — migrating three P0 flows because one of
 * them was proven is the kind of shortcut that turns a careful migration into an outage.
 */
export const CANONICALLY_RENDERED_AUTH_TEMPLATES = Object.freeze(['reset_password']);

/**
 * Why this Email arrived, per family. Every line has to be true of every message in that family, so
 * they are deliberately general — a specific claim belongs in the body, where the producer knows it.
 *
 * Marketing is absent: G3's block states its own reason-received, and two of them in one footer is
 * one claim too many.
 */
const REASON_RECEIVED = Object.freeze({
  security: 'You are receiving this because of security activity on your CarUp account.',
  transactional: 'You are receiving this because of activity on your CarUp account.',
  service: 'You are receiving this because of activity on your CarUp account.',
  conversational: 'You are receiving this because you are part of this CarUp conversation.',
  marketing: null,
});

function firstPresent(...values) {
  return values.find((v) => v !== undefined && v !== null && String(v).trim() !== '') || null;
}

/** The action a message points at, when its producer supplied one. */
function actionFrom(payload = {}) {
  const url = firstPresent(payload.action_url, payload.cta_url, payload.actionUrl);
  if (!url) return null;
  return { label: firstPresent(payload.action_label, payload.cta_label) || 'Open CarUp', url: String(url) };
}

/**
 * Non-secret provenance for the call to action.
 *
 * G2 shipped `cta_href_canonical` as the FULL action URL, which was an evidence-safety defect: an
 * auth action URL carries an opaque single-use reset token, and this object is persisted onto
 * `message_delivery_attempts` where it is read by operators and retained. A durable audit record is
 * one of the worst places for a live credential — it outlives the token's own expiry and is read by
 * more people than the inbox ever was.
 *
 * The field is now a BOOLEAN — "did the action point at a CarUp canonical origin?" — with the route
 * beside it. Together they prove canonical-origin use and say which flow it was, and neither can
 * carry a secret: the query string, where every token lives, is discarded.
 *
 * The Email itself is unchanged. The customer still receives the complete, working link.
 */
function ctaProvenance(action) {
  if (!action?.url) return { cta_href_canonical: false, cta_route: null };
  let parsed = null;
  try {
    parsed = new URL(action.url);
  } catch {
    return { cta_href_canonical: false, cta_route: null };
  }
  return {
    cta_href_canonical: isCanonicalWebOrigin(parsed.origin),
    // Path only. Never the query, and never a fragment.
    cta_route: parsed.pathname || '/',
  };
}

function refusal(errorCode, errorMessage, provenance = {}) {
  return { ok: false, errorCode, errorMessage, provenance };
}

/**
 * G6 — render a migrated auth Email canonically, and only return it if it is EQUIVALENT.
 *
 * Both renderers run. That is deliberate: the certified artefact is the specification, so the only
 * honest way to say "the canonical one is equivalent" is to produce both and compare them on every
 * send. A guarantee asserted once in a test file protects the build; a guarantee evaluated on every
 * send protects the customer.
 *
 * Returns the canonical result, or a reason to use the certified path. It never throws: a fault here
 * degrades to the artefact a human already accepted, and a password reset is not something to lose
 * to a refactor.
 *
 * The two decline reasons are kept apart on purpose. NOT ELIGIBLE means the canonical artefact was
 * never attempted — a producer supplied no action URL, so there is nothing to compare. EQUIVALENCE
 * FAILED means it WAS produced and did not hold a property the certified one holds. Collapsing them
 * would send whoever reads the audit trail looking for a rendering bug that is really a missing
 * field, or worse, the reverse.
 */
function renderMigratedAuthEmail({ authKey, payload, classification, baseProvenance, env }) {
  const copy = AUTH_EMAIL_COPY[authKey];
  const actionUrl = firstPresent(payload.action_url, payload.cta_url, payload.actionUrl);
  if (!copy || !actionUrl) return { eligible: false };

  try {
    const certified = renderAuthEmail(authKey, env, payload);
    const document = {
      classification,
      preheaderText: copy.preheader,
      heading: copy.heading,
      bodyText: copy.intro,
      action: { label: copy.actionLabel, url: String(actionUrl) },
      note: copy.securityNote,
      reasonReceived: copy.reasonReceived,
      unsubscribeUrl: null,
    };
    const html = renderEmailHtml(document, { env });
    const text = renderEmailText(document, { env });

    const equivalence = checkAuthEquivalence({
      certified,
      certifiedSubject: certified.subject,
      canonicalHtml: html,
      canonicalText: text,
      canonicalSubject: copy.subject,
      actionUrl: String(actionUrl),
      copy,
    });
    if (!equivalence.ok) return { eligible: true, ok: false, failures: equivalence.failures };

    return {
      ok: true,
      subject: copy.subject,
      text,
      html,
      classification,
      ...baseProvenance,
      template_key: certified.templateKey || baseProvenance.template_key,
      html_part_rendered: true,
      text_part_rendered: true,
      ...ctaProvenance({ url: String(actionUrl) }),
      render_fallback_used: RENDER_FALLBACKS.NONE,
      auth_equivalence_verified: true,
    };
  } catch {
    // A thrown canonical render is an equivalence failure in every sense that matters: it was
    // attempted and did not produce a usable artefact.
    return { eligible: true, ok: false, failures: ['render_threw'] };
  }
}

/**
 * Render one notification into its canonical Email representation.
 *
 * Returns `{ ok: true, subject, text, html, classification, ...provenance }` or
 * `{ ok: false, errorCode, errorMessage }`. It never returns provider secrets and never returns a
 * raw database row — the document is built from named fields only, so an unrelated column added to
 * `users` or `notification_queue` can never find its way into an Email body.
 */
export function renderEmailForNotification(notification = {}, { env = process.env } = {}) {
  const payload = notification.payload || {};

  const resolved = resolveEmailClassification(notification);
  if (!resolved.ok) return refusal(resolved.errorCode, resolved.errorMessage);
  const { classification, source: classificationSource } = resolved;

  const subject = firstPresent(notification.title, payload.subject) || 'CarUp';
  const bodyText = String(notification.message || payload.body || '').trim();
  const templateKey = firstPresent(notification.template_key, payload.template_key);
  const templateVersion = firstPresent(payload.template_version, notification.template_version);
  const persona = senderPersonaFor(classification, env);
  const footerFamily = footerFamilyFor(classification);

  const baseProvenance = {
    renderer_version: EMAIL_RENDERER_VERSION,
    classification,
    classification_source: classificationSource,
    template_key: templateKey,
    template_version: templateVersion,
    footer_family: footerFamily,
    sender_persona: persona?.key || null,
    // No leadership identity is rendered by any G2 family. R1 introduces it, under the B2 freeze —
    // and never as CEO.
    leadership_identity_rendered: false,
  };

  // AUTH. Two paths, and which one runs is decided by whether equivalence actually holds.
  if (payload.auth_template_key) {
    const authKey = String(payload.auth_template_key);
    let equivalenceFailed = false;
    if (CANONICALLY_RENDERED_AUTH_TEMPLATES.includes(authKey)) {
      const migrated = renderMigratedAuthEmail({ authKey, payload, classification, baseProvenance, env });
      if (migrated?.ok) return migrated;
      // Fall through to the certified artefact rather than ship a password reset nobody checked.
      equivalenceFailed = migrated?.eligible === true;
    }
    // Not yet migrated (or the canonical render was refused). The certified renderer supplies the
    // HTML at the transport boundary, exactly as before, and this path deliberately produces none so
    // nothing races it.
    return {
      ok: true,
      subject,
      text: bodyText,
      html: null,
      classification,
      ...baseProvenance,
      html_part_rendered: false,
      text_part_rendered: Boolean(bodyText),
      // The auth action URL carries a live single-use token and is deliberately NOT recorded here.
      // The route alone proves which flow ran.
      ...ctaProvenance(actionFrom(payload)),
      render_fallback_used: equivalenceFailed
        ? RENDER_FALLBACKS.AUTH_EQUIVALENCE_FAILED
        : RENDER_FALLBACKS.AUTH_COMPATIBILITY,
    };
  }

  const isMarketing = classification === 'marketing';
  const unsubscribeUrl = payload.unsubscribe_url || null;
  if (isMarketing && !unsubscribeUrl) {
    return refusal(
      UNSUBSCRIBE_PRESENTATION_ERRORS.MISSING_URL,
      'Marketing Email requires a governed CarUp unsubscribe URL before it can be rendered.',
      baseProvenance,
    );
  }

  const action = actionFrom(payload);

  // A REGISTERED REFERENCE builds its own document; everything else gets the generic one. The
  // registry is the authority on which family, persona and footer a reference belongs to, so a
  // template cannot quietly be rendered as a different family from the one it was declared as.
  const reference = payload.reference_template ? referenceEntry(payload.reference_template) : null;
  if (reference && reference.classification !== classification) {
    return refusal(
      EMAIL_CLASSIFICATION_ERRORS.CONFLICT,
      `Reference '${payload.reference_template}' is registered as '${reference.classification}' but this notification is classified '${classification}'.`,
      baseProvenance,
    );
  }
  const referenceDocument = reference
    ? buildReferenceDocument(payload.reference_template, { payload, classification, env })
    : null;
  if (reference?.build && !referenceDocument) {
    // A reference that cannot describe its own input refuses. R4 does this for a transaction state
    // nobody mapped: an unrecognised stage is one nobody decided what to say about, and inventing
    // reassuring prose for it is how a false financial claim gets written by accident.
    return refusal(
      'reference_state_not_describable',
      `Reference '${payload.reference_template}' cannot truthfully describe the supplied state; refusing rather than guessing.`,
      baseProvenance,
    );
  }

  const document = referenceDocument || {
    classification,
    preheaderText: firstPresent(payload.preheader, bodyText.slice(0, 140)),
    heading: subject,
    bodyText,
    action,
    note: firstPresent(payload.note, payload.security_note),
    reasonReceived: REASON_RECEIVED[classification],
    unsubscribeUrl,
  };

  let html = null;
  let text = null;
  let fallback = RENDER_FALLBACKS.NONE;
  try {
    html = renderEmailHtml(document, { env });
    text = renderEmailText(document, { env });
  } catch (error) {
    if (isMarketing) {
      // No unmarked text-only marketing send. Ever.
      return refusal(
        'marketing_render_failed',
        `Marketing Email could not be rendered compliantly (${error.message}); refusing rather than sending without a control.`,
        baseProvenance,
      );
    }
    // The canonical message still carries its full meaning in plain text.
    html = null;
    text = bodyText;
    fallback = RENDER_FALLBACKS.PLAIN_TEXT_DEGRADED;
  }

  if (isMarketing) {
    // Prove compliance HERE, not only at transport. The adapter validates independently as defence
    // in depth, but a renderer that can emit a non-compliant marketing artefact is a renderer that
    // will, and finding out at the provider boundary makes the failure someone else's to diagnose.
    const verdict = validateMarketingUnsubscribePresentation({ html, text, unsubscribeUrl, headerUrl: unsubscribeUrl });
    if (!verdict.ok) return refusal(verdict.errorCode, verdict.errorMessage, baseProvenance);
  }

  const referenceAction = referenceDocument
    ? (referenceDocument.action || (referenceDocument.blocks || []).find((b) => b?.type === 'action') || null)
    : action;

  return {
    ok: true,
    subject,
    text,
    html,
    classification,
    ...baseProvenance,
    ...(reference ? { template_key: reference.templateKey, template_version: reference.version } : {}),
    ...(referenceDocument?.replyTo ? { reply_to: referenceDocument.replyTo } : {}),
    leadership_identity_rendered: Boolean(referenceDocument?.leadershipIdentityRendered),
    // R5 provenance: which canonical Trust state was presented, and whether a NUMBER was published.
    // Recorded because "did that Email show a score?" must be answerable from the record, not
    // inferred from the state — they are different questions and only one of them is safe to guess.
    ...(referenceDocument?.trustEvaluationState
      ? {
        trust_evaluation_state: referenceDocument.trustEvaluationState,
        trust_score_published: Boolean(referenceDocument.trustScorePublished),
      }
      : {}),
    html_part_rendered: Boolean(html),
    text_part_rendered: Boolean(text),
    ...ctaProvenance(referenceAction ? { url: referenceAction.url } : null),
    render_fallback_used: fallback,
    ...(isMarketing ? { unsubscribe_presentation: { version: 'v1', url: unsubscribeUrl, blocks: 1 } } : {}),
  };
}

export { EMAIL_CLASSIFICATION_ERRORS };
export default renderEmailForNotification;
