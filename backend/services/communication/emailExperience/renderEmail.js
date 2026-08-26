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
});

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

function refusal(errorCode, errorMessage, provenance = {}) {
  return { ok: false, errorCode, errorMessage, provenance };
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

  // AUTH COMPATIBILITY (§I). The certified auth renderer keeps producing the HTML until G6 proves
  // equivalence; this path deliberately produces none, so nothing races it.
  if (payload.auth_template_key) {
    return {
      ok: true,
      subject,
      text: bodyText,
      html: null,
      classification,
      ...baseProvenance,
      html_part_rendered: false,
      text_part_rendered: Boolean(bodyText),
      cta_href_canonical: null,
      render_fallback_used: RENDER_FALLBACKS.AUTH_COMPATIBILITY,
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
  const document = {
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

  return {
    ok: true,
    subject,
    text,
    html,
    classification,
    ...baseProvenance,
    html_part_rendered: Boolean(html),
    text_part_rendered: Boolean(text),
    cta_href_canonical: action?.url || null,
    render_fallback_used: fallback,
    ...(isMarketing ? { unsubscribe_presentation: { version: 'v1', url: unsubscribeUrl, blocks: 1 } } : {}),
  };
}

export { EMAIL_CLASSIFICATION_ERRORS };
export default renderEmailForNotification;
