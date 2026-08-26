/**
 * The three CarUp Email footer families (plan §10.4).
 *
 * A footer is where an Email makes claims about who sent it, why it arrived, and what the reader can
 * do about it. Every one of those claims must be true, so this module renders CONDITIONALLY and
 * never fills a gap:
 *
 *   - no registered legal address, because none is verified — a partial statutory address is a false
 *     legal claim, not a smaller one;
 *   - no social links, because none are approved;
 *   - no CEO, because CarUp has no CEO identity and the About page's is demo seed data;
 *   - no link to a route that does not exist — `/support` and `/security` are approved and unrouted,
 *     and the SPA rewrite would serve them as a soft 404 no monitoring could see.
 *
 * The MARKETING family does not author its own unsubscribe control. It composes G3's
 * `marketingUnsubscribePresentation.js`, which owns that control and its `data-carup-unsubscribe`
 * marker — so the block the customer clicks is the same block the Brevo adapter validates, exactly
 * once, and G2 cannot drift from G3 by re-implementing it.
 */
import { EMAIL_BRAND_TOKENS as T, EMAIL_FONT_STACK } from './emailBrandTokens.js';
import { EMAIL_BRAND_IDENTITY, identityAvailable } from './emailBrandIdentity.js';
import { availableEmailLinks } from './canonicalEmailLinks.js';
import { finePrint, linkRow } from './emailComponents.js';
import { html, joinHtml, safeHtml } from './emailMarkup.js';
import { unsubscribeHtmlBlock, unsubscribeTextBlock } from './marketingUnsubscribePresentation.js';

/** Classification -> footer family. Three families, five classifications. */
export const FOOTER_FAMILY = Object.freeze({
  security: 'security',
  transactional: 'transactional',
  service: 'transactional',
  conversational: 'transactional',
  marketing: 'marketing',
});

export function footerFamilyFor(classification) {
  return FOOTER_FAMILY[classification] || null;
}

/** The certified contact alias for customer support. One of the seven E7-certified `@carup.dev`. */
export const SUPPORT_CONTACT = 'support@carup.dev';

function shell(inner) {
  return html`<div style="padding-top:16px;border-top:1px solid ${T.BORDER};font-family:${safeHtml(EMAIL_FONT_STACK)};">${inner}</div>`;
}

/**
 * SECURITY — restrained by design.
 *
 * No contact invitation, no marketing, nothing to click except the legal pages. A security Email
 * that invites a reply teaches the reader that replying is how you resolve an account alert, which
 * is precisely the habit a phishing message relies on.
 */
function securityFooter({ reasonReceived, env }) {
  return shell(joinHtml([
    finePrint(reasonReceived),
    linkRow(availableEmailLinks(['privacy', 'terms'], env)),
    finePrint(`${EMAIL_BRAND_IDENTITY.legalEntity} · This is an automated security message. Please do not reply.`),
  ]));
}

/** TRANSACTIONAL / SERVICE / CONVERSATIONAL — a real contact route and the legal pages. */
function transactionalFooter({ reasonReceived, env }) {
  return shell(joinHtml([
    finePrint(reasonReceived),
    finePrint(`Need help? ${SUPPORT_CONTACT}`),
    linkRow(availableEmailLinks(['privacy', 'terms', 'support'], env)),
    finePrint(`${EMAIL_BRAND_IDENTITY.legalEntity} · ${EMAIL_BRAND_IDENTITY.corporateDescriptor}`),
  ]));
}

/**
 * MARKETING — the only family carrying an unsubscribe control, and it does not build one.
 *
 * `registeredLegalAddress` is DEFERRED_UNTIL_VERIFIED, so no postal line is rendered. Where a postal
 * address is legally or provider-required, marketing production eligibility stays gated on that
 * verification rather than on inventing an address to satisfy the check.
 */
function marketingFooter({ reasonReceived, unsubscribeUrl, env }) {
  const address = identityAvailable('registeredLegalAddress')
    ? finePrint(EMAIL_BRAND_IDENTITY.registeredLegalAddress)
    : safeHtml('');
  return shell(joinHtml([
    finePrint(reasonReceived),
    linkRow(availableEmailLinks(['privacy', 'terms', 'support'], env)),
    finePrint(`${EMAIL_BRAND_IDENTITY.legalEntity} · ${EMAIL_BRAND_IDENTITY.corporateDescriptor}`),
    finePrint(`${EMAIL_BRAND_IDENTITY.headquarters} · ${EMAIL_BRAND_IDENTITY.regionalOffice}`),
    address,
    safeHtml(unsubscribeHtmlBlock(unsubscribeUrl)),
  ]));
}

/** The HTML footer for a classification. Returns trusted markup. */
export function renderFooterHtml({ classification, reasonReceived = null, unsubscribeUrl = null, env = process.env } = {}) {
  const family = footerFamilyFor(classification);
  if (family === 'security') return securityFooter({ reasonReceived, env });
  if (family === 'marketing') return marketingFooter({ reasonReceived, unsubscribeUrl, env });
  return transactionalFooter({ reasonReceived, env });
}

/**
 * The plain-text footer for a classification — the same claims, the same links, the same URL.
 *
 * Literal characters throughout. A text part is not an HTML document, so escaping it would put
 * `&amp;` in front of a reader and break a URL they may have to copy by hand.
 */
export function renderFooterText({ classification, reasonReceived = null, unsubscribeUrl = null, env = process.env } = {}) {
  const family = footerFamilyFor(classification);
  const lines = ['—'];
  if (reasonReceived) lines.push(reasonReceived);

  if (family === 'security') {
    lines.push(`${EMAIL_BRAND_IDENTITY.legalEntity} · This is an automated security message. Please do not reply.`);
    const links = availableEmailLinks(['privacy', 'terms'], env);
    if (links.length) lines.push(links.map((l) => `${l.label}: ${l.url}`).join('\n'));
    return lines.join('\n\n');
  }

  if (family === 'marketing') {
    const links = availableEmailLinks(['privacy', 'terms', 'support'], env);
    if (links.length) lines.push(links.map((l) => `${l.label}: ${l.url}`).join('\n'));
    lines.push(`${EMAIL_BRAND_IDENTITY.legalEntity} · ${EMAIL_BRAND_IDENTITY.corporateDescriptor}`);
    lines.push(`${EMAIL_BRAND_IDENTITY.headquarters} · ${EMAIL_BRAND_IDENTITY.regionalOffice}`);
    if (identityAvailable('registeredLegalAddress')) lines.push(EMAIL_BRAND_IDENTITY.registeredLegalAddress);
    // G3 owns this section, marker-for-marker with the HTML block above.
    lines.push(unsubscribeTextBlock(unsubscribeUrl));
    return lines.join('\n\n');
  }

  lines.push(`Need help? ${SUPPORT_CONTACT}`);
  const links = availableEmailLinks(['privacy', 'terms', 'support'], env);
  if (links.length) lines.push(links.map((l) => `${l.label}: ${l.url}`).join('\n'));
  lines.push(`${EMAIL_BRAND_IDENTITY.legalEntity} · ${EMAIL_BRAND_IDENTITY.corporateDescriptor}`);
  return lines.join('\n\n');
}
