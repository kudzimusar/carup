/**
 * The shared visual primitives every CarUp Email family is built from.
 *
 * Deliberately small. G2 is the rendering FOUNDATION and the insertion point, not six finished
 * templates — these are the components R1–R6 will actually need, and nothing is here speculatively.
 *
 * Every component returns trusted markup from `emailMarkup.js`, so nesting them composes without
 * re-escaping. Values reach them raw and are escaped once, at insertion.
 */
import { EMAIL_BRAND_TOKENS as T, EMAIL_FONT_STACK } from './emailBrandTokens.js';
import { EMAIL_BRAND_IDENTITY } from './emailBrandIdentity.js';
import { html, joinHtml, safeHtml } from './emailMarkup.js';

/**
 * Hidden preview text.
 *
 * The line a customer reads in their inbox list before opening anything. Omitting it lets the client
 * scrape the first words of the body instead, which for a security Email is often the boilerplate.
 */
export function preheader(text) {
  if (!text) return safeHtml('');
  return html`<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${text}</span>`;
}

/**
 * The CarUp wordmark, rendered as TEXT.
 *
 * No logo artwork exists anywhere in the repository or its history — only a 24x24 favicon — so this
 * is the real identity, not a placeholder waiting for an image. `logoArtworkUrl` stays null until
 * artwork is approved, and this branch is what ships until then.
 */
export function masthead() {
  return html`<div style="font-size:20px;font-weight:700;color:${T.INK};letter-spacing:-0.01em;font-family:${safeHtml(EMAIL_FONT_STACK)};">Car<span style="color:${T.ACTION};">Up</span></div>`;
}

/**
 * A single primary action.
 *
 * The visible URL is repeated below the button because a mail client that strips the button, or a
 * reader forwarding to a device that cannot click it, still needs the link. `href` is escaped once
 * as an attribute; the URL was already URL-encoded by whoever built it.
 */
export function button({ label, href }) {
  if (!label || !href) return safeHtml('');
  return html`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${T.ACTION};border-radius:8px;">
<a href="${href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:${T.ACTION_TEXT};text-decoration:none;font-family:${safeHtml(EMAIL_FONT_STACK)};">${label}</a>
</td></tr></table>
<p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:${T.MUTED};font-family:${safeHtml(EMAIL_FONT_STACK)};">If the button does not work, copy and paste this link into your browser:<br>
<span style="color:${T.BODY};word-break:break-all;">${href}</span></p>`;
}

/** A quiet panel for a caveat, an expiry note, or a security warning. */
export function panel(text) {
  if (!text) return safeHtml('');
  return html`<p style="margin:0;padding:14px 16px;background:${T.CANVAS};border-radius:8px;font-size:13px;line-height:1.6;color:${T.BODY};font-family:${safeHtml(EMAIL_FONT_STACK)};">${text}</p>`;
}

export function divider() {
  return html`<div style="height:1px;background:${T.BORDER};margin:24px 0;"></div>`;
}

/** Body copy. Blank lines become paragraphs; single newlines stay as line breaks. */
export function paragraphs(text) {
  const blocks = String(text || '').trim().split(/\n{2,}/).filter(Boolean);
  return joinHtml(blocks.map((block) => {
    const lines = block.split('\n');
    const body = joinHtml(lines.map((line) => html`${line}`), '<br>');
    return html`<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:${T.BODY};font-family:${safeHtml(EMAIL_FONT_STACK)};">${body}</p>`;
  }));
}

export function heading(text) {
  if (!text) return safeHtml('');
  return html`<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:${T.INK};font-family:${safeHtml(EMAIL_FONT_STACK)};">${text}</h1>`;
}

/** `Privacy · Terms` — only the routes that actually exist. See `canonicalEmailLinks.js`. */
export function linkRow(links) {
  if (!links?.length) return safeHtml('');
  const rendered = links.map((link) => html`<a href="${link.url}" style="color:${T.BODY};text-decoration:underline;">${link.label}</a>`);
  return html`<p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:${T.MUTED};font-family:${safeHtml(EMAIL_FONT_STACK)};">${joinHtml(rendered, `<span style="color:${T.BORDER};">&nbsp;&middot;&nbsp;</span>`)}</p>`;
}

/** Small print. */
export function finePrint(text) {
  if (!text) return safeHtml('');
  return html`<p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:${T.MUTED};font-family:${safeHtml(EMAIL_FONT_STACK)};">${text}</p>`;
}

export { EMAIL_BRAND_IDENTITY };
