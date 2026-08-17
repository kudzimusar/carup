/**
 * E4 — retrieve the ACTUAL body of an inbound Email from Resend's Receiving API.
 *
 * Resend's `email.received` webhook deliberately carries metadata only — `to`, `from`, `subject`,
 * `message_id`, `attachments` — and no body. Treating that as a provider limitation would leave every
 * inbound reply persisted with an empty message, so the body is fetched with the webhook's
 * `data.email_id` through the Receiving API using the existing server-side Resend credential.
 *
 * Trust boundary: this runs ONLY after Svix signature verification and canonical routing resolution.
 * Body content is never taken from the request itself — an unsigned or unverified caller can supply a
 * payload, but it can never supply content, because content is fetched from the provider by id.
 *
 * Nothing here logs the API key, the request URL, or any message content.
 */

const RECEIVING_ENDPOINTS = Object.freeze([
  (id) => `https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`,
  // Fallback for accounts/versions where the received email is addressed through the general
  // email resource. Tried only on 404 so a genuine auth or rate-limit error is never masked.
  (id) => `https://api.resend.com/emails/${encodeURIComponent(id)}`,
]);

const DEFAULT_TIMEOUT_MS = 10_000;

/** Conservative HTML -> text derivation, used only when the provider supplies no plain-text part. */
export function deriveTextFromHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Deterministic content policy: prefer the provider's plain text, otherwise derive it from HTML.
 *
 * CarUp has no reply-cleaning semantics anywhere today, so quoted history and signatures are
 * deliberately preserved verbatim rather than stripped. Inventing a quote-parsing architecture here
 * would silently discard message content on a path whose whole purpose is to stop discarding it.
 */
export function selectInboundContent(received = {}) {
  const text = typeof received.text === 'string' ? received.text.trim() : '';
  const html = typeof received.html === 'string' ? received.html : '';
  if (text) return { text, html: html || null, derivedFromHtml: false };
  const derived = deriveTextFromHtml(html);
  return { text: derived, html: html || null, derivedFromHtml: Boolean(derived) };
}

export class ResendInboundContentService {
  constructor({ env = process.env, fetchImpl = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(String(this.env.RESEND_API_KEY || '').trim());
  }

  /**
   * @returns {{ok:true, text:string, html:string|null, headers:object, derivedFromHtml:boolean, endpoint:string}
   *          | {ok:false, reason:string, retryable:boolean, status?:number}}
   */
  async fetchReceivedEmail(emailId) {
    if (!emailId) return { ok: false, reason: 'missing_email_id', retryable: false };
    const apiKey = String(this.env.RESEND_API_KEY || '').trim();
    // Fail CLOSED and retryable: a missing credential is an operational fault, not a message with no
    // body. Persisting an empty message here is exactly the outcome this service exists to prevent.
    if (!apiKey) return { ok: false, reason: 'resend_api_key_not_configured', retryable: true };

    let lastStatus = null;
    for (const [index, buildUrl] of RECEIVING_ENDPOINTS.entries()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(buildUrl(emailId), {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        // Network fault or timeout — transient by nature, so the webhook must retry rather than
        // commit an empty body.
        return { ok: false, reason: `fetch_failed:${error.name || 'error'}`, retryable: true };
      }
      clearTimeout(timer);

      lastStatus = response.status;
      if (response.status === 404 && index < RECEIVING_ENDPOINTS.length - 1) continue;
      if (!response.ok) {
        return {
          ok: false,
          reason: `provider_status_${response.status}`,
          status: response.status,
          // 4xx other than 429 is a durable refusal; 429/5xx are worth retrying.
          retryable: response.status === 429 || response.status >= 500,
        };
      }

      let body;
      try {
        body = await response.json();
      } catch {
        return { ok: false, reason: 'provider_body_unparseable', retryable: true };
      }
      const received = body?.data && typeof body.data === 'object' ? body.data : body;
      const selected = selectInboundContent(received);
      if (!selected.text && !selected.html) {
        // The provider answered successfully with no content at all. Not retryable — retrying cannot
        // conjure a body — but reported explicitly so it is never mistaken for a successful capture.
        return { ok: false, reason: 'provider_returned_no_content', retryable: false, status: response.status };
      }
      return {
        ok: true,
        text: selected.text,
        html: selected.html,
        derivedFromHtml: selected.derivedFromHtml,
        headers: received?.headers && typeof received.headers === 'object' ? received.headers : {},
        endpoint: index === 0 ? 'emails.receiving.get' : 'emails.get',
      };
    }
    return { ok: false, reason: `provider_status_${lastStatus ?? 'unknown'}`, retryable: false, status: lastStatus };
  }
}

export function createResendInboundContentService(deps) {
  return new ResendInboundContentService(deps);
}
