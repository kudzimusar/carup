import express from 'express';

import { supabase } from '../db/supabase.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { createMarketingUnsubscribeService } from '../services/communication/marketingUnsubscribeService.js';

/**
 * E5/E7 — the public unsubscribe surface for governed marketing Email.
 *
 * Unauthenticated by necessity: the recipient is reading an Email, not holding a CarUp session, and
 * requiring a login to stop marketing is exactly the friction that makes an unsubscribe control
 * non-functional. Authority comes instead from the opaque, hash-stored handle in the URL.
 *
 * GET never mutates. Mail clients, link scanners and corporate security gateways routinely prefetch
 * every URL in a message body; an unsubscribe-on-GET would therefore silently opt people out of
 * marketing they never chose to leave. GET renders a confirmation page and the POST performs the
 * action — which is also the RFC 8058 contract for the List-Unsubscribe-Post one-click header.
 */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function page({ title, heading, body, token = null, showButton = false }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background:#f8fafc; color:#0f172a; padding:24px; }
  .card { background:#fff; max-width:520px; width:100%; border:1px solid #e2e8f0; border-radius:14px;
          padding:32px; box-shadow:0 1px 3px rgba(15,23,42,.08); }
  h1 { font-size:20px; margin:0 0 12px; }
  p { line-height:1.6; margin:0 0 16px; color:#334155; }
  button { background:#C2410C; color:#fff; border:0; border-radius:8px; padding:12px 20px;
           font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#9A3412; }
  .brand { font-weight:700; letter-spacing:.02em; color:#C2410C; margin-bottom:20px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f172a; color:#e2e8f0; }
    .card { background:#1e293b; border-color:#334155; }
    p { color:#cbd5e1; }
  }
</style></head>
<body><div class="card">
  <div class="brand">CarUp</div>
  <h1>${escapeHtml(heading)}</h1>
  ${body}
  ${showButton && token ? `<form method="POST" action="/api/communications/unsubscribe">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <button type="submit">Confirm unsubscribe</button>
  </form>` : ''}
</div></body></html>`;
}

export function marketingUnsubscribeRouter({ supabaseClient = supabase, env = process.env } = {}) {
  const router = express.Router();
  const service = createMarketingUnsubscribeService({ supabase: supabaseClient, env });

  // Bounded but not hostile: a recipient may legitimately reload the page or have their mail client
  // prefetch it. This exists to stop token enumeration, not to obstruct a real unsubscribe.
  const limiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 60 });

  router.get('/api/communications/unsubscribe', limiter, async (req, res) => {
    const token = String(req.query.token || '');
    const resolved = await service.resolve(token).catch(() => ({ ok: false, reason: 'lookup_failed' }));

    if (!resolved.ok) {
      return res.status(400).type('html').send(page({
        title: 'CarUp — unsubscribe link not valid',
        heading: 'This unsubscribe link is not valid',
        body: '<p>The link may have expired or already been replaced by a newer message. You can still update your communication preferences from your CarUp account settings.</p>',
      }));
    }

    // Observability only — never a consent change. See recordView().
    await service.recordView(resolved.token.id);

    return res.status(200).type('html').send(page({
      title: 'CarUp — confirm unsubscribe',
      heading: 'Stop receiving CarUp marketing email?',
      body: `<p>This will stop CarUp marketing email to <strong>${escapeHtml(resolved.token.address)}</strong>.</p>
             <p>You will still receive essential account, security and transaction email — those are not marketing and are not affected.</p>
             <p style="font-size:14px;color:#64748b;">One more step: press the button below to confirm. Nothing changes until you do.</p>`,
      token,
      showButton: true,
    }));
  });

  router.post('/api/communications/unsubscribe', limiter, async (req, res) => {
    const token = String(req.body?.token || req.query?.token || '');
    // RFC 8058 one-click: the mail client POSTs `List-Unsubscribe=One-Click` with the handle carried
    // in the URI's query string, so accept the token from either place.
    const oneClick = String(req.body?.['List-Unsubscribe'] || '') === 'One-Click';

    let result;
    try {
      result = await service.unsubscribe(token, {
        source: oneClick ? 'rfc8058_one_click' : 'carup_one_click',
        evidence: { user_agent: req.get('user-agent') || null, one_click: oneClick },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Unsubscribe could not be recorded.', detail: error.message });
    }

    if (!result.ok) {
      if (oneClick) return res.status(400).json({ success: false, reason: result.reason });
      return res.status(400).type('html').send(page({
        title: 'CarUp — unsubscribe link not valid',
        heading: 'This unsubscribe link is not valid',
        body: '<p>The link may have expired. You can still update your communication preferences from your CarUp account settings.</p>',
      }));
    }

    // A one-click POST comes from software, not a person: answer it as data.
    if (oneClick || req.accepts(['html', 'json']) === 'json') {
      return res.status(200).json({ success: true, unsubscribed: true, scope: result.scope });
    }

    return res.status(200).type('html').send(page({
      title: 'CarUp — unsubscribed',
      heading: 'You have been unsubscribed',
      body: `<p><strong>${escapeHtml(result.address)}</strong> will no longer receive CarUp marketing email.</p>
             <p>Essential account, security and transaction email will still be delivered.</p>`,
    }));
  });

  return router;
}

export default marketingUnsubscribeRouter;
