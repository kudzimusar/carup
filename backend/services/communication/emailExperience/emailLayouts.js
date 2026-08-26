/**
 * The one CarUp Email shell, and the per-family variation over it.
 *
 * ONE shell — not six templates. G2 is the rendering foundation; R1–R6 are product templates that
 * come later and compose this. What varies by family today is genuinely small: the footer, and
 * whether an action button is present. Inventing six divergent shells now would guarantee six places
 * to fix the next accessibility or client-compatibility problem.
 *
 * Table-based, 600px, inline styles, `color-scheme: light` — the constraints Email actually has, and
 * the ones `authEmailTemplates.js` already proved in real inboxes.
 */
import { EMAIL_BRAND_TOKENS as T, EMAIL_FONT_STACK } from './emailBrandTokens.js';
import { button, heading, masthead, panel, paragraphs, preheader } from './emailComponents.js';
import { renderFooterHtml } from './emailFooters.js';
import { html, joinHtml, renderHtml, safeHtml } from './emailMarkup.js';

/**
 * Render one Email document to HTML.
 *
 * `document` is the SAME description `emailTextRenderer.js` consumes, so the two representations
 * cannot drift into saying different things — a plain-text part that contradicts the HTML part is a
 * message that means one thing to a screen reader and another to everyone else.
 */
export function renderEmailHtml(document = {}, { env = process.env } = {}) {
  const {
    classification, preheaderText, heading: headingText, bodyText,
    action = null, note = null, reasonReceived = null, unsubscribeUrl = null,
  } = document;

  const content = joinHtml([
    heading(headingText),
    paragraphs(bodyText),
    action ? html`<div style="margin:8px 0 4px 0;">${button({ label: action.label, href: action.url })}</div>` : safeHtml(''),
    note ? html`<div style="margin:20px 0 0 0;">${panel(note)}</div>` : safeHtml(''),
  ]);

  const body = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${headingText || 'CarUp'}</title>
</head>
<body style="margin:0;padding:0;background:${T.CANVAS};">
${preheader(preheaderText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="${T.MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${T.MAX_WIDTH}px;background:${T.SURFACE};border:1px solid ${T.BORDER};border-radius:12px;">
<tr><td style="padding:32px 32px 8px 32px;font-family:${safeHtml(EMAIL_FONT_STACK)};">${masthead()}</td></tr>
<tr><td style="padding:16px 32px 0 32px;font-family:${safeHtml(EMAIL_FONT_STACK)};">${content}</td></tr>
<tr><td style="padding:24px 32px 32px 32px;font-family:${safeHtml(EMAIL_FONT_STACK)};">${renderFooterHtml({ classification, reasonReceived, unsubscribeUrl, env })}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return renderHtml(body);
}

export default renderEmailHtml;
