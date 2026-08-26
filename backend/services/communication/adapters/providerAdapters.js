import crypto from 'crypto';
import { FakeCommunicationAdapter } from './fakeCommunicationAdapter.js';
import { renderAuthEmail } from '../authEmailTemplates.js';
import {
  EMAIL_CLASSIFICATION_ERRORS,
  normalizeEmailClassification,
} from '../emailExperience/emailClassification.js';
import { senderPersonaFor } from '../emailExperience/emailSenderPersona.js';
import {
  assertNoMarketingUnsubscribePresentation,
  unsubscribeHrefFor,
  validateMarketingUnsubscribePresentation,
} from '../emailExperience/marketingUnsubscribePresentation.js';

const DEFAULT_TIMEOUT_MS = 10_000;

function envValue(env, key) {
  const value = env?.[key];
  return value === undefined || value === null || value === '' ? null : String(value);
}

// Read an env credential and TRIM surrounding whitespace/newlines. A stray trailing newline copied
// into a Vercel env value silently corrupts a Bearer token or an id, so credentials must be trimmed
// before use (returns null when empty after trimming).
export function trimmedEnvValue(env, key) {
  const value = envValue(env, key);
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || null;
}

function missingEnv(requiredEnv, env) {
  return requiredEnv.filter((key) => !envValue(env, key));
}

function jsonHeaders(extra = {}) {
  return { 'content-type': 'application/json', ...extra };
}

function stableRequestId(prefix, input) {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(String(input.idempotencyKey || input.messageId || input.notificationId || Date.now()))
    .digest('hex')
    .slice(0, 24)}`;
}

function recipientField(input, ...keys) {
  const data = input?.content?.data || {};
  const recipient = input?.recipient || {};
  for (const key of keys) {
    const value = firstPresent(recipient[key], data[key], data.recipient?.[key]);
    if (value) return String(value);
  }
  return null;
}

function textBody(input) {
  return String(input?.content?.body || input?.content?.text || '').trim();
}

function subjectText(input, fallback = 'CarUp notification') {
  return String(input?.content?.subject || fallback).trim();
}

function emailHtml(input) {
  return input?.content?.html || input?.content?.data?.html || null;
}

/*
 * G3 — the visual unsubscribe footer used to be authored HERE, by three functions that mutated
 * outgoing marketing content on its way to the provider. That is gone. Customer-facing copy is not
 * a transport concern, and a component that adds an unsubscribe block cannot also be trusted to
 * detect a duplicate one. The Brevo adapter now VALIDATES finished content and passes it through
 * unchanged; `emailExperience/marketingUnsubscribePresentation.js` owns what the reader sees.
 */

/**
 * Render branded auth/security HTML for a notification that names an auth template.
 *
 * Kept lazy and failure-tolerant: a template problem must never block a P0 security Email, which
 * still carries its full meaning in the plain-text body.
 */
function resolveAuthHtml(input) {
  const key = input?.content?.data?.auth_template_key;
  if (!key) return null;
  try {
    return renderAuthEmail(key, process.env, input?.content?.data || {}).html;
  } catch (_error) {
    // A template problem must never block a P0 security Email — the plain-text body still
    // carries the full meaning, so fall back to text-only rather than failing the send.
    return null;
  }
}

function replyToAddress(input, env) {
  return firstPresent(input?.content?.data?.reply_to, input?.content?.data?.replyTo, envValue(env, 'CLOUDFLARE_EMAIL_REPLY_TO'));
}

function normalizedAttachments(input = {}) {
  const attachments = input?.content?.data?.attachments || input?.content?.data?.attachment_metadata || [];
  return Array.isArray(attachments) ? attachments : [];
}

function cloudflareEmailBody(input = {}, env = {}) {
  const to = recipientField(input, 'email', 'address', 'to');
  const text = textBody(input);
  const body = {
    to,
    from: {
      address: envValue(env, 'CLOUDFLARE_EMAIL_FROM'),
      name: envValue(env, 'CLOUDFLARE_EMAIL_FROM_NAME') || 'CarUp',
    },
    subject: subjectText(input),
    text,
    html: emailHtml(input),
    reply_to: replyToAddress(input, env) || undefined,
    headers: {
      'X-CarUp-Notification-Id': String(input.notificationId || ''),
      'X-CarUp-Message-Id': String(input.messageId || ''),
      'X-CarUp-Correlation-Id': String(input.correlationId || input.notificationId || ''),
      ...(input?.content?.data?.headers || {}),
    },
    attachments: normalizedAttachments(input),
    metadata: {
      notification_id: String(input.notificationId || ''),
      message_id: String(input.messageId || ''),
      idempotency_key: String(input.idempotencyKey || ''),
      correlation_id: String(input.correlationId || ''),
    },
  };
  if (!body.html) delete body.html;
  if (!body.reply_to) delete body.reply_to;
  if (!body.attachments.length) delete body.attachments;
  return body;
}

function cloudflareWorkerSendUrl(env = {}) {
  const configured = envValue(env, 'CLOUDFLARE_EMAIL_WORKER_URL');
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!/\/email\/send\/?$/.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/email/send`;
    }
    return url.toString();
  } catch (_error) {
    return configured.replace(/\/+$/, '') + '/email/send';
  }
}

function hasCloudflareWorkerConfig(env = {}) {
  return Boolean(envValue(env, 'CLOUDFLARE_EMAIL_WORKER_URL') && envValue(env, 'CLOUDFLARE_EMAIL_WORKER_SECRET'));
}

// Extract ONLY the non-sensitive provider failure fields from an upstream error body (Meta Graph
// shape: { error: { message, type, code, error_subcode, fbtrace_id } }). Never returns tokens, auth
// headers, or the full request payload — just the sanitized diagnostic fields. Values are length-capped.
export function sanitizeProviderError(status, body) {
  const err = body && typeof body === 'object' ? body.error || null : null;
  const cap = (v) => (v == null ? null : String(v).slice(0, 500));
  return {
    provider_http_status: Number.isFinite(status) ? status : null,
    provider_error_code: err && err.code != null ? err.code : null,
    provider_error_subcode: err && err.error_subcode != null ? err.error_subcode : null,
    provider_error_type: err && err.type != null ? cap(err.type) : null,
    provider_error_message: err && err.message != null ? cap(err.message)
      : (typeof body === 'string' && body ? cap(body) : null),
    provider_trace_id: err && err.fbtrace_id != null ? cap(err.fbtrace_id) : null,
  };
}

function parseProviderError(status, body) {
  const sanitized = sanitizeProviderError(status, body);
  // Prefer the provider's OWN message so the real rejection (e.g. Meta code 190/10/100) is never
  // collapsed into a generic label. errorCode still drives retry classification.
  const text = sanitized.provider_error_message
    || (typeof body === 'string' ? body : body?.message || body?.errors?.[0]?.message || JSON.stringify(body || {}));
  const of = (retryable, errorCode, fallback) => ({ retryable, errorCode, errorMessage: text || fallback, ...sanitized });
  if (status === 429) return of(true, 'rate_limited', 'Provider rate limit');
  if (status >= 500) return of(true, 'provider_5xx', 'Provider temporary failure');
  if ([401, 403].includes(status)) return of(false, 'invalid_credentials', 'Provider authentication failed');
  if ([400, 404, 422].includes(status)) return of(false, 'provider_rejected', 'Provider rejected request');
  return of(false, 'provider_error', `Provider returned HTTP ${status}`);
}

export class HttpCommunicationAdapter {
  constructor({ channel, provider, requiredEnv = [], env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.channel = channel;
    this.provider = provider;
    this.requiredEnv = requiredEnv;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  validateConfiguration(env = this.env) {
    const missing = missingEnv(this.requiredEnv, env);
    return { available: missing.length === 0, channel: this.channel, provider: this.provider, mode: 'real', missing };
  }

  missingConfigurationResult() {
    const config = this.validateConfiguration();
    return {
      accepted: false,
      retryable: false,
      errorCode: 'provider_not_configured',
      errorMessage: `${this.provider} adapter is not configured: ${config.missing.join(', ')}`,
    };
  }

  async requestJson(url, { method = 'POST', headers = {}, body = undefined, basicAuth = null } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const finalHeaders = { ...headers };
    if (basicAuth) finalHeaders.authorization = `Basic ${Buffer.from(basicAuth).toString('base64')}`;
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (_error) {
          parsed = text;
        }
      }
      return { ok: response.ok, status: response.status, body: parsed, headers: response.headers };
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { ok: false, status: 0, networkError: true, errorCode: 'timeout', errorMessage: 'Provider request timed out', retryable: true };
      }
      return { ok: false, status: 0, networkError: true, errorCode: 'network', errorMessage: error?.message || 'Provider network failure', retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  providerFailure(response) {
    if (response.networkError) {
      return {
        accepted: false,
        retryable: response.retryable !== false,
        errorCode: response.errorCode || 'network',
        errorMessage: response.errorMessage || 'Provider network failure',
      };
    }
    return { accepted: false, ...parseProviderError(response.status, response.body) };
  }
}

export class SendGridEmailAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'email', provider: 'sendgrid', requiredEnv: ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'email', 'address', 'to');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Email recipient address is required.' };
    const response = await this.requestJson('https://api.sendgrid.com/v3/mail/send', {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'SENDGRID_API_KEY')}` }),
      body: {
        personalizations: [{ to: [{ email: to }], custom_args: { notification_id: String(input.notificationId || ''), message_id: String(input.messageId || '') } }],
        from: { email: envValue(this.env, 'SENDGRID_FROM_EMAIL'), name: envValue(this.env, 'SENDGRID_FROM_NAME') || 'CarUp' },
        subject: subjectText(input),
        content: [{ type: 'text/plain', value: textBody(input) }],
        tracking_settings: { click_tracking: { enable: false, enable_text: false } },
      },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.headers?.get?.('x-message-id') || stableRequestId('sendgrid', input),
      providerMessageId: response.headers?.get?.('x-message-id') || null,
      providerStatus: 'accepted',
    };
  }
}

/**
 * Resend — canonical transactional/conversational Email transport (directive §0A.2).
 *
 * Two behaviours matter beyond a plain send:
 *
 *  1. Idempotency. The canonical dedupe identity is mapped to Resend's Idempotency-Key header so
 *     one canonical send intent causes at most one provider send, even if the worker replays or a
 *     network response is lost.
 *  2. Durable reply correlation. Resend returns its own id, and the RFC Message-ID is what an
 *     inbound reply will carry in In-Reply-To/References. Both are persisted — the RFC id as the
 *     provider message id — so a reply can be resolved back to the exact canonical message.
 *
 * Branded auth/security Email: when the notification carries `data.auth_template_key`, the HTML
 * body is rendered from authEmailTemplates.js (single source of truth for the design system)
 * while the canonical plain-text body is still sent as text/plain.
 */
export class ResendEmailAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'email', provider: 'resend', requiredEnv: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'], ...options });
  }

  fromAddress(input) {
    // Auth/security Email is sent from the security sender; everything else from the default.
    //
    // G4 added `classification === 'security'` alongside the auth template key. They agree on every
    // message that exists today — the only producer of `security` also sets an auth template key —
    // but they were keyed on different things, so a future security Email without an auth template
    // would have gone out from the notifications sender while the renderer's persona said Security.
    // Aligning them makes the consistency check below structural rather than hopeful.
    const data = input?.content?.data || {};
    if (data.auth_template_key || normalizeEmailClassification(data.classification) === 'security') {
      return envValue(this.env, 'RESEND_AUTH_FROM_EMAIL') || 'CarUp Security <auth@mail.carup.dev>';
    }
    const from = envValue(this.env, 'RESEND_FROM_EMAIL');
    const name = envValue(this.env, 'RESEND_FROM_NAME') || 'CarUp';
    return from && !from.includes('<') ? `${name} <${from}>` : from;
  }

  /**
   * Send-side provenance, derived from the object actually handed to Resend.
   *
   * Every `*_sent` field reads `body`, never the renderer's intent and never what this code was
   * supposed to have produced. That distinction is the whole point: Brevo's provenance exists
   * because a delivered marketing message once carried no unsubscribe control while every check
   * said it did, and the checks were reading the code rather than the payload.
   *
   * Nothing secret is recorded. Not the recipient, not the Reply-To value, not the subject text, not
   * a token-bearing URL, not the body. Booleans and non-secret identifiers only — this object is
   * persisted onto `message_delivery_attempts` and outlives every credential in it.
   */
  sendProvenance(body, { input, htmlSource, personaConsistent, idempotencyKeySent, outcome }) {
    const renderer = rendererProvenance(input);
    const attempted = outcome !== 'provider_accepted';
    const present = (value) => typeof value === 'string' && value.length > 0;
    return {
      // What the RENDERER produced. Carried through untouched.
      renderer_version: renderer.renderer_version ?? null,
      classification: renderer.classification ?? normalizeEmailClassification(input?.content?.data?.classification),
      classification_source: renderer.classification_source ?? null,
      template_key: renderer.template_key ?? null,
      template_version: renderer.template_version ?? null,
      footer_family: renderer.footer_family ?? null,
      sender_persona: renderer.sender_persona ?? null,
      leadership_identity_rendered: renderer.leadership_identity_rendered ?? false,
      render_fallback_used: renderer.render_fallback_used ?? null,
      html_part_rendered: renderer.html_part_rendered ?? null,
      cta_href_canonical: renderer.cta_href_canonical ?? null,
      cta_route: renderer.cta_route ?? null,

      // What went ON THE WIRE. Read from `body`, after every mutation of it.
      send_outcome: outcome,
      ...(attempted
        // A rejected request was attempted, not sent. Named so it can never be read as acceptance.
        ? {
          html_part_in_request: present(body.html),
          text_part_in_request: present(body.text),
          reply_to_in_request: Boolean(body.reply_to),
        }
        : {
          html_part_sent: present(body.html),
          text_part_sent: present(body.text),
          reply_to_set: Boolean(body.reply_to),
        }),
      subject_present: present(body.subject),
      html_source: htmlSource,
      // TRUE only when the renderer deliberately produced no HTML and the certified auth path
      // supplied what was sent. Not merely because an auth template key exists — if that render
      // failed, no HTML was sent and claiming otherwise would hide the degradation.
      auth_compatibility_html_used: htmlSource === 'auth_compatibility',
      sender_persona_consistent: personaConsistent,
      idempotency_key_sent: idempotencyKeySent,
    };
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'email', 'address', 'to');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Email recipient address is required.' };

    const headers = jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'RESEND_API_KEY')}` });
    // One canonical send intent -> at most one provider send.
    const idempotencyKey = input.idempotencyKey || input.messageId || input.notificationId;
    if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);

    const body = {
      from: this.fromAddress(input),
      to: [to],
      subject: subjectText(input),
      text: textBody(input),
      headers: {
        'X-CarUp-Notification-Id': String(input.notificationId || ''),
        'X-CarUp-Message-Id': String(input.messageId || ''),
      },
    };

    // Which layer produced the HTML matters, so both are resolved and the winner is recorded.
    // `auth_compatibility_html_used` is the only evidence that the certified auth renderer ran, and
    // it cannot be inferred from an auth template key alone: if that render failed, no HTML was
    // sent and the message degraded to text, which is a different fact worth seeing.
    const authHtml = resolveAuthHtml(input);
    const renderedHtml = emailHtml(input);
    const html = authHtml || renderedHtml;
    const htmlSource = authHtml ? 'auth_compatibility' : (renderedHtml ? 'renderer' : null);
    if (html) body.html = html;

    // The exactly-one contract, read in the other direction. Resend carries every NON-marketing
    // family, and none of them may present a marketing unsubscribe control: it would offer a reader
    // an opt-out from security mail that does not exist, and a client honouring one-click could act
    // on it. Refused rather than stripped — silently rewriting content is the behaviour G3 removed.
    const notPermitted = assertNoMarketingUnsubscribePresentation({ html: body.html, text: body.text });
    if (!notPermitted.ok) {
      // A pre-send refusal carries NO send provenance. Nothing was attempted, so there is nothing
      // truthful to say about a request body.
      return {
        accepted: false,
        retryable: false,
        errorCode: notPermitted.errorCode,
        errorMessage: notPermitted.errorMessage,
      };
    }

    const replyTo = input?.content?.data?.reply_to || envValue(this.env, 'RESEND_REPLY_TO');
    if (replyTo) body.reply_to = replyTo;

    // The renderer names a sender persona; this adapter independently computes a `From`. If those
    // disagree the message would go out under an identity nobody chose — a security notice from the
    // marketing sender, or the reverse. Refuse rather than send under the wrong name.
    //
    // Only checked when a canonical classification exists to check against; the router refuses a
    // missing one before this point, so this is not a hole.
    const classification = normalizeEmailClassification(input?.content?.data?.classification);
    const persona = classification ? senderPersonaFor(classification, this.env) : null;
    const declaredPersona = rendererProvenance(input).sender_persona || null;
    let personaConsistent = null;
    if (persona) {
      personaConsistent = bareEmailAddress(body.from) === bareEmailAddress(persona.address)
        && (!declaredPersona || declaredPersona === persona.key);
      if (!personaConsistent) {
        return {
          accepted: false,
          retryable: false,
          errorCode: 'sender_persona_mismatch',
          errorMessage: `The transport sender does not match the canonical persona for '${classification}'; refusing to send under an identity nobody selected.`,
        };
      }
    }

    const idempotencyKeySent = Boolean(headers['Idempotency-Key']);

    const response = await this.requestJson('https://api.resend.com/emails', { headers, body });
    if (!response.ok) {
      return {
        ...this.providerFailure(response),
        providerMetadata: this.sendProvenance(body, {
          input, htmlSource, personaConsistent, idempotencyKeySent,
          outcome: 'request_attempted_provider_rejected',
        }),
      };
    }

    const providerRequestId = response.body?.id || stableRequestId('resend', input);
    // Resend exposes the RFC Message-ID on the send response; fall back to its own id so reply
    // correlation always has something durable to match against.
    const rfcMessageId = response.body?.message_id || response.headers?.get?.('message-id') || null;

    return {
      accepted: true,
      providerRequestId,
      providerMessageId: rfcMessageId || providerRequestId,
      providerStatus: 'accepted',
      // Derived from `body` AFTER every field on it was settled, so the evidence describes the same
      // object that was transmitted rather than an earlier version of it.
      providerMetadata: this.sendProvenance(body, {
        input, htmlSource, personaConsistent, idempotencyKeySent,
        outcome: 'provider_accepted',
      }),
    };
  }
}

/**
 * Brevo — canonical MARKETING Email transport (directive §0A.3).
 *
 * Brevo is a projection of an already-authorized CarUp campaign, never an authority. This adapter
 * therefore refuses to send anything that is not classified marketing, and it refuses to send
 * without the canonical campaign/delivery identifiers that make a provider-side send traceable
 * back to CarUp. Brevo list membership must never become the reason a recipient receives mail.
 *
 * Uses BREVO_API_KEY (the normal REST credential). BREVO_API_MCP_KEY is deliberately never read —
 * it is tooling access, not application configuration.
 */
export class BrevoMarketingAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'email', provider: 'brevo', requiredEnv: ['BREVO_API_KEY', 'BREVO_FROM_EMAIL'], ...options });
  }

  senderFrom() {
    const raw = envValue(this.env, 'BREVO_FROM_EMAIL') || '';
    const name = envValue(this.env, 'BREVO_FROM_NAME') || 'CarUp';
    const match = raw.match(/<([^>]+)>/);
    return { name, email: (match ? match[1] : raw).trim() };
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();

    const data = input?.content?.data || {};
    const classification = String(data.classification || '').toLowerCase();
    if (classification !== 'marketing') {
      // Fail closed rather than quietly becoming a second transactional provider.
      return {
        accepted: false,
        retryable: false,
        errorCode: 'classification_not_permitted',
        errorMessage: `Brevo is marketing-only; refused classification '${classification || 'unknown'}'.`,
      };
    }

    const campaignId = data.campaign_id || null;
    const campaignDeliveryId = data.campaign_delivery_id || null;
    if (!campaignId || !campaignDeliveryId) {
      // Without canonical ids the provider-side send would be untraceable back to CarUp.
      return {
        accepted: false,
        retryable: false,
        errorCode: 'campaign_context_missing',
        errorMessage: 'Brevo send requires canonical campaign_id and campaign_delivery_id.',
      };
    }

    const to = recipientField(input, 'email', 'address', 'to');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Email recipient address is required.' };

    // Marketing Email MUST carry a working unsubscribe control, and this is the one choke point every
    // marketing send passes through. Found during E7 certification: a real marketing message reached
    // a human inbox whose body asserted "use the unsubscribe link" while containing no link, no HTML
    // part and no List-Unsubscribe header — because this endpoint is Brevo's TRANSACTIONAL API, which
    // injects no footer of its own. Refusing here makes that state unreachable rather than relying on
    // every future template author to remember.
    const unsubscribeUrl = data.unsubscribe_url || null;
    if (!unsubscribeUrl) {
      return {
        accepted: false,
        retryable: false,
        errorCode: 'unsubscribe_action_missing',
        errorMessage: 'Marketing Email requires a governed CarUp unsubscribe URL; refusing to send without one.',
      };
    }
    const unsubscribeMailto = data.unsubscribe_mailto || null;

    // TRANSPORT COMPLIANCE. RFC 8058: the https URI is the one-click target; the mailto is the
    // fallback for clients that only understand the original RFC 2369 form. These headers are a
    // MIME/provider concern and stay adapter-owned — unlike the visible control, which does not.
    const listUnsubscribeHeader = unsubscribeMailto
      ? `<${unsubscribeUrl}>, <mailto:${unsubscribeMailto}>`
      : `<${unsubscribeUrl}>`;
    // Read the https target back OUT of the header that was actually built, rather than reusing the
    // variable that went in. The visible href, the plain-text URL and the transport target are one
    // identity; checking the header against itself would prove nothing about that.
    const headerHttpsTarget = (listUnsubscribeHeader.match(/<(https?:\/\/[^>]+)>/) || [])[1] || null;

    // Content arrives FINISHED. The adapter validates the exactly-one contract and refuses, but adds
    // nothing visible. Deliberately independent of the composer: it counts what is in this payload,
    // so a hand-built send, a future renderer, or a caller that skipped composition entirely is
    // refused on the same terms. This is the defence-in-depth choke point E7 established.
    const textContent = textBody(input);
    const htmlContent = emailHtml(input);
    const presentation = validateMarketingUnsubscribePresentation({
      html: htmlContent,
      text: textContent,
      unsubscribeUrl,
      headerUrl: headerHttpsTarget,
      provenance: data.unsubscribe_presentation || null,
    });
    if (!presentation.ok) {
      return {
        accepted: false,
        retryable: false,
        errorCode: presentation.errorCode,
        errorMessage: presentation.errorMessage,
      };
    }

    const headers = jsonHeaders({ 'api-key': envValue(this.env, 'BREVO_API_KEY'), accept: 'application/json' });
    const body = {
      sender: this.senderFrom(),
      to: [{ email: to }],
      subject: subjectText(input, 'CarUp'),
      // Pass-through. No footer, no wrapper, no rewriting.
      textContent,
      htmlContent,
      // Every provider object maps back to canonical CarUp identifiers.
      tags: [`campaign:${campaignId}`, `delivery:${campaignDeliveryId}`],
      headers: {
        'X-CarUp-Campaign-Id': String(campaignId),
        'X-CarUp-Campaign-Delivery-Id': String(campaignDeliveryId),
        'X-CarUp-Notification-Id': String(input.notificationId || ''),
        'List-Unsubscribe': listUnsubscribeHeader,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
    // The receipt below must look for the href AS THE HTML CARRIES IT. The URL is escaped once on
    // the way into the anchor, so searching for the raw URL only happens to match while the token
    // is the sole query parameter. Add a second one and `&` becomes `&amp;`, and the receipt would
    // report a missing unsubscribe control that is in fact present — a compliance receipt lying in
    // the direction that looks like a violation.
    const unsubscribeHref = unsubscribeHrefFor(unsubscribeUrl);

    const response = await this.requestJson('https://api.brevo.com/v3/smtp/email', { headers, body });
    if (!response.ok) return this.providerFailure(response);

    const providerMessageId = response.body?.messageId || response.body?.messageIds?.[0] || null;
    return {
      accepted: true,
      providerRequestId: providerMessageId || stableRequestId('brevo', input),
      providerMessageId,
      providerStatus: 'accepted',
      // Provenance for the compliance-critical unsubscribe control, recorded on the delivery attempt.
      // Without this, "did the delivered message actually carry a visible unsubscribe action?" can
      // only be inferred from the code that was *believed* to be running — and that inference was
      // physically wrong once, when an older deployment executed the send.
      //
      // Every field below is computed from `body` — the object handed to the provider — never from
      // what this code was supposed to have done.
      providerMetadata: {
        marketing_unsubscribe_url_present: true,
        marketing_html_part_sent: typeof body.htmlContent === 'string' && body.htmlContent.length > 0,
        marketing_html_anchor_present: typeof body.htmlContent === 'string'
          && body.htmlContent.includes(`href="${unsubscribeHref}"`),
        marketing_text_link_present: typeof body.textContent === 'string'
          && body.textContent.includes(unsubscribeUrl),
        list_unsubscribe_header_sent: Boolean(body.headers?.['List-Unsubscribe']),
        list_unsubscribe_post_header_sent: body.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
        // G3: the exactly-one contract, and the fact that transport added nothing visible.
        marketing_unsubscribe_blocks: presentation.counts?.markers ?? null,
        marketing_unsubscribe_presentation_validated: true,
        marketing_content_unmodified_by_transport:
          body.textContent === textBody(input) && body.htmlContent === emailHtml(input),
        list_unsubscribe_target_matches_visible_url: body.headers?.['List-Unsubscribe']?.includes(`<${unsubscribeUrl}>`) === true,
      },
    };
  }
}


/**
 * G4 — send-side provenance helpers.
 *
 * `bareEmailAddress` exists because `From` is a display string (`CarUp Security <auth@…>`) while a
 * persona is an address. Comparing the two forms directly reports a mismatch that is not one.
 */
function bareEmailAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase() || null;
}

/**
 * Renderer provenance as the worker attached it, or an empty record.
 *
 * Carried through UNCHANGED. It describes what the canonical renderer PRODUCED, which during the
 * auth compatibility period is a different fact from what was SENT — `html_part_rendered: false`
 * and `html_part_sent: true` are both true of the same message, and collapsing them would erase the
 * only evidence that the certified auth path executed.
 */
function rendererProvenance(input) {
  const provenance = input?.content?.data?.email_render_provenance;
  return provenance && typeof provenance === 'object' ? provenance : {};
}

/**
 * Governed Email transport router (directive §0A / E2).
 *
 * Provider choice derives from CarUp's own governed classification, never from arbitrary caller
 * choice:
 *
 *   security | auth | transactional | conversational | service  ->  Resend
 *   marketing                                                   ->  Brevo
 *
 * This replaces the previous single `EMAIL_PROVIDER` ternary, which allowed exactly one email
 * provider per deployment and had no notion of what kind of message was being sent. Legacy
 * SendGrid/Cloudflare adapters remain constructible for compatibility but are quarantined from
 * canonical routing: they are only selected when explicitly named by EMAIL_PROVIDER_LEGACY.
 */
export const MARKETING_EMAIL_CLASSIFICATIONS = new Set(['marketing']);

export class EmailTransportRouter {
  constructor(options = {}) {
    this.channel = 'email';
    this.provider = 'carup_email_router';
    this.env = options.env || process.env;
    this.resend = new ResendEmailAdapter(options);
    this.brevo = new BrevoMarketingAdapter(options);
    this.legacy = this.buildLegacyAdapter(options);
  }

  buildLegacyAdapter(options) {
    const legacy = String(this.env.EMAIL_PROVIDER_LEGACY || '').toLowerCase();
    if (legacy === 'sendgrid') return new SendGridEmailAdapter(options);
    if (legacy === 'cloudflare') return new CloudflareEmailAdapter(options);
    return null;
  }

  /**
   * Governed classification -> adapter. Marketing never rides the transactional transport.
   *
   * G2: this used to default a missing classification to `'transactional'`, which meant absence
   * silently CHOSE A PROVIDER. That is how a real marketing campaign rode the transactional
   * transport with no unsubscribe control: nobody decided it should: nothing was set, and the
   * default decided for them. A provider is now never chosen by a default.
   */
  selectAdapter(input = {}) {
    const raw = input?.content?.data?.classification ?? input?.classification;
    const present = String(raw ?? '').trim() !== '';
    const classification = normalizeEmailClassification(raw);

    if (!classification) {
      return {
        adapter: null,
        classification: present ? String(raw) : null,
        reason: present ? 'classification_invalid' : 'classification_missing',
        errorCode: present ? EMAIL_CLASSIFICATION_ERRORS.INVALID : EMAIL_CLASSIFICATION_ERRORS.MISSING,
        errorMessage: present
          ? `'${raw}' is not a canonical CarUp Email classification; refusing to choose a transport.`
          : 'This Email carries no canonical classification; refusing to choose a transport by default.',
      };
    }
    if (MARKETING_EMAIL_CLASSIFICATIONS.has(classification)) {
      return { adapter: this.brevo, classification, reason: 'marketing_to_brevo' };
    }
    if (this.legacy) return { adapter: this.legacy, classification, reason: 'legacy_override' };
    return { adapter: this.resend, classification, reason: 'canonical_to_resend' };
  }

  validateConfiguration(env = this.env) {
    const selected = this.legacy || this.resend;
    const config = selected.validateConfiguration(env);
    return { ...config, provider: selected.provider, router: 'carup_email_router' };
  }

  async send(input = {}) {
    const { adapter, classification, reason, errorCode, errorMessage } = this.selectAdapter(input);
    if (!adapter) {
      return {
        accepted: false,
        retryable: false,
        errorCode: errorCode || 'provider_not_configured',
        errorMessage: errorMessage || `No Email transport is configured for classification '${classification}'.`,
      };
    }
    const result = await adapter.send(input);
    return { ...result, routedProvider: adapter.provider, routingReason: reason };
  }
}

export function createEmailTransportRouter(options = {}) {
  return new EmailTransportRouter(options);
}

export class CloudflareEmailAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'email', provider: 'cloudflare_email', requiredEnv: [], ...options });
  }

  validateConfiguration(env = this.env) {
    const missing = [];
    if (!envValue(env, 'CLOUDFLARE_EMAIL_FROM')) missing.push('CLOUDFLARE_EMAIL_FROM');
    const workerConfigured = hasCloudflareWorkerConfig(env);
    const restConfigured = Boolean(envValue(env, 'CLOUDFLARE_ACCOUNT_ID') && envValue(env, 'CLOUDFLARE_EMAIL_API_TOKEN'));
    if (!workerConfigured && !restConfigured) missing.push('CLOUDFLARE_EMAIL_WORKER_URL_OR_REST_API');
    return {
      available: missing.length === 0,
      channel: this.channel,
      provider: this.provider,
      mode: workerConfigured ? 'worker' : restConfigured ? 'rest' : 'real',
      fallback_provider: envValue(env, 'EMAIL_PROVIDER_FALLBACK') || null,
      missing,
    };
  }

  missingConfigurationResult() {
    const config = this.validateConfiguration();
    return {
      accepted: false,
      retryable: false,
      errorCode: 'provider_not_configured',
      errorMessage: `cloudflare_email adapter is not configured: ${config.missing.join(', ')}`,
    };
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'email', 'address', 'to');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Email recipient address is required.' };
    const attachments = normalizedAttachments(input);
    const totalAttachmentBytes = attachments.reduce((sum, attachment) => sum + Number(attachment.size || attachment.size_bytes || 0), 0);
    if (totalAttachmentBytes > 5 * 1024 * 1024) {
      return { accepted: false, retryable: false, errorCode: 'email_too_large', errorMessage: 'Cloudflare Email attachments exceed the 5 MiB provider limit.' };
    }
    if (hasCloudflareWorkerConfig(this.env)) return this.sendViaWorker(input);
    return this.sendViaRest(input);
  }

  async sendViaWorker(input = {}) {
    const url = cloudflareWorkerSendUrl(this.env);
    const response = await this.requestJson(url, {
      headers: jsonHeaders({
        authorization: `Bearer ${envValue(this.env, 'CLOUDFLARE_EMAIL_WORKER_SECRET')}`,
        'x-carup-idempotency-key': String(input.idempotencyKey || input.notificationId || ''),
      }),
      body: cloudflareEmailBody(input, this.env),
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: response.body?.accepted !== false,
      providerRequestId: response.body?.providerRequestId || response.body?.id || response.headers?.get?.('cf-ray') || stableRequestId('cloudflare_email', input),
      providerMessageId: response.body?.providerMessageId || response.body?.message_id || null,
      providerStatus: response.body?.providerStatus || response.body?.status || 'accepted',
    };
  }

  async sendViaRest(input = {}) {
    const accountId = envValue(this.env, 'CLOUDFLARE_ACCOUNT_ID');
    const response = await this.requestJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`, {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'CLOUDFLARE_EMAIL_API_TOKEN')}` }),
      body: cloudflareEmailBody(input, this.env),
    });
    if (!response.ok || response.body?.success === false) return this.providerFailure(response);
    const result = response.body?.result || {};
    const to = recipientField(input, 'email', 'address', 'to');
    const delivered = Array.isArray(result.delivered) && result.delivered.includes(to);
    return {
      accepted: true,
      providerRequestId: response.headers?.get?.('cf-ray') || stableRequestId('cloudflare_email', input),
      providerMessageId: response.body?.result?.id || null,
      providerStatus: delivered ? 'delivered' : 'accepted',
      deliveredRecipients: result.delivered || [],
      queuedRecipients: result.queued || [],
    };
  }
}

export class TwilioSmsAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'sms', provider: 'twilio', requiredEnv: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], ...options });
  }

  validateConfiguration(env = this.env) {
    const missing = missingEnv(this.requiredEnv, env);
    if (!envValue(env, 'TWILIO_MESSAGING_SERVICE_SID') && !envValue(env, 'TWILIO_FROM_NUMBER')) missing.push('TWILIO_MESSAGING_SERVICE_SID_OR_TWILIO_FROM_NUMBER');
    return { available: missing.length === 0, channel: this.channel, provider: this.provider, mode: 'real', missing };
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'phoneNumber', 'phone_number', 'phone', 'to', 'address');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'SMS recipient phone number is required.' };
    const params = new URLSearchParams({ To: to, Body: textBody(input), StatusCallback: envValue(this.env, 'TWILIO_STATUS_CALLBACK_URL') || '' });
    const messagingServiceSid = envValue(this.env, 'TWILIO_MESSAGING_SERVICE_SID');
    if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid);
    else params.set('From', envValue(this.env, 'TWILIO_FROM_NUMBER'));
    return this.sendUrlEncoded(input, params);
  }

  async sendUrlEncoded(input, params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const accountSid = envValue(this.env, 'TWILIO_ACCOUNT_SID');
    try {
      const response = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${accountSid}:${envValue(this.env, 'TWILIO_AUTH_TOKEN')}`).toString('base64')}`,
        },
        body: params.toString(),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) return this.providerFailure({ status: response.status, body });
      return {
        accepted: true,
        providerRequestId: body?.sid || stableRequestId('twilio', input),
        providerMessageId: body?.sid || null,
        providerStatus: body?.status || 'accepted',
      };
    } catch (error) {
      return {
        accepted: false,
        retryable: error?.name === 'AbortError' || error?.retryable !== false,
        errorCode: error?.name === 'AbortError' ? 'timeout' : 'network',
        errorMessage: error?.message || 'Twilio request failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MetaWhatsAppAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', requiredEnv: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PHONE_NUMBER_ID'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'phoneNumber', 'phone_number', 'phone', 'to', 'address');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'WhatsApp recipient phone number is required.' };
    // Trim the token + phone-number ID so accidental leading/trailing whitespace cannot invalidate auth.
    const phoneNumberId = trimmedEnvValue(this.env, 'CARUP_META_PHONE_NUMBER_ID');
    const accessToken = trimmedEnvValue(this.env, 'CARUP_META_ACCESS_TOKEN');
    const response = await this.requestJson(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      headers: jsonHeaders({ authorization: `Bearer ${accessToken}` }),
      body: { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: textBody(input) } },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.body?.messages?.[0]?.id || stableRequestId('meta_wa', input),
      providerMessageId: response.body?.messages?.[0]?.id || null,
      providerStatus: 'accepted',
    };
  }
}

export class FacebookMessengerAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'facebook', provider: 'meta_messenger', requiredEnv: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PAGE_ID'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const recipientId = recipientField(input, 'externalId', 'external_id', 'facebook_psid', 'page_scoped_id', 'to', 'address');
    if (!recipientId) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Facebook Messenger recipient PSID is required.' };
    const response = await this.requestJson('https://graph.facebook.com/v20.0/me/messages', {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'CARUP_META_ACCESS_TOKEN')}` }),
      body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: textBody(input) } },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.body?.message_id || stableRequestId('meta_fb', input),
      providerMessageId: response.body?.message_id || null,
      providerStatus: 'accepted',
    };
  }
}

export class InstagramMessagingAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'instagram', provider: 'meta_instagram_messaging', requiredEnv: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PAGE_ID'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const recipientId = recipientField(input, 'externalId', 'external_id', 'instagram_scoped_id', 'to', 'address');
    if (!recipientId) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Instagram recipient scoped ID is required.' };
    const pageId = envValue(this.env, 'CARUP_META_PAGE_ID');
    const response = await this.requestJson(`https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/messages`, {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'CARUP_META_ACCESS_TOKEN')}` }),
      body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: textBody(input) } },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.body?.message_id || stableRequestId('meta_ig', input),
      providerMessageId: response.body?.message_id || null,
      providerStatus: 'accepted',
    };
  }
}

export class TelegramBotAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'telegram', provider: 'telegram_bot_api', requiredEnv: ['CARUP_TELEGRAM_BOT_TOKEN'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const chatId = recipientField(input, 'telegramChatId', 'telegram_chat_id', 'chat_id', 'externalId', 'external_id', 'to', 'address');
    if (!chatId) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Telegram chat ID is required.' };
    const token = envValue(this.env, 'CARUP_TELEGRAM_BOT_TOKEN');
    const response = await this.requestJson(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      headers: jsonHeaders(),
      body: { chat_id: chatId, text: textBody(input), disable_web_page_preview: true },
    });
    if (!response.ok || response.body?.ok === false) return this.providerFailure({ status: response.status || 400, body: response.body });
    return {
      accepted: true,
      providerRequestId: response.body?.result?.message_id ? String(response.body.result.message_id) : stableRequestId('telegram', input),
      providerMessageId: response.body?.result?.message_id ? String(response.body.result.message_id) : null,
      providerStatus: 'sent',
    };
  }
}

export class ExpoPushAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'push', provider: 'expo_push', requiredEnv: ['EXPO_ACCESS_TOKEN'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'expoPushToken', 'expo_push_token', 'pushToken', 'push_token', 'to', 'address');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Expo push token is required.' };
    const response = await this.requestJson('https://exp.host/--/api/v2/push/send', {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'EXPO_ACCESS_TOKEN')}` }),
      body: [{ to, title: subjectText(input), body: textBody(input), data: input.content?.data || {} }],
    });
    if (!response.ok) return this.providerFailure(response);
    const ticket = Array.isArray(response.body?.data) ? response.body.data[0] : response.body?.data;
    if (ticket?.status === 'error') {
      const code = String(ticket.details?.error || ticket.message || 'expo_rejected').toLowerCase();
      return { accepted: false, retryable: ['messageratelimited', 'unknown'].includes(code), errorCode: code, errorMessage: ticket.message || 'Expo rejected push notification' };
    }
    return {
      accepted: true,
      providerRequestId: ticket?.id || stableRequestId('expo', input),
      providerMessageId: ticket?.id || null,
      providerStatus: ticket?.status || 'accepted',
    };
  }
}

export function assertRealTelegramAdapter(registry, env = process.env) {
  const isRealEnvironment = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging' || env.COMMUNICATION_REAL_ADAPTERS === 'true';
  if (!isRealEnvironment) return;
  if (env.COMMUNICATION_FAKE_ADAPTERS_ENABLED === 'true') return;
  if (!envValue(env, 'CARUP_TELEGRAM_BOT_TOKEN')) return;

  const adapter = registry.get('telegram');
  if (!adapter) {
    throw new Error('FATAL: CARUP_TELEGRAM_BOT_TOKEN is set but no telegram adapter is registered.');
  }
  const health = adapter.validateConfiguration?.() || {};
  if (health.mode === 'fake') {
    throw new Error(
      `FATAL: CARUP_TELEGRAM_BOT_TOKEN is set but the telegram adapter is a fake adapter (mode=fake). ` +
      `In ${env.NODE_ENV || 'unknown'} environment real provider adapters are required. ` +
      `Ensure NODE_ENV=production or staging, or set COMMUNICATION_REAL_ADAPTERS=true.`
    );
  }
  if (health.provider && health.provider !== 'telegram_bot_api') {
    throw new Error(`FATAL: Telegram adapter has unexpected provider "${health.provider}" (expected telegram_bot_api).`);
  }
  if (health.available === false) {
    throw new Error(`FATAL: Telegram adapter is not available in ${env.NODE_ENV} environment. Missing: ${health.missing?.join(', ') || 'unknown'}`);
  }
}

export function createDefaultAdapterRegistry({ fakeAdapters = {}, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const isRealEnvironment = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging' || env.COMMUNICATION_REAL_ADAPTERS === 'true';
  const allowFake = !isRealEnvironment || env.COMMUNICATION_FAKE_ADAPTERS_ENABLED === 'true';
  const realOptions = { env, fetchImpl };
  const registry = new Map();
  const put = (channel, adapter) => registry.set(channel, adapter);
  const configured = (channel, realAdapter) => fakeAdapters[channel] || (allowFake
    ? new FakeCommunicationAdapter({ channel })
    : realAdapter);

  put('whatsapp', configured('whatsapp', new MetaWhatsAppAdapter(realOptions)));
  put('telegram', configured('telegram', new TelegramBotAdapter(realOptions)));
  put('email', configured('email', createEmailTransportRouter(realOptions)));
  put('sms', configured('sms', new TwilioSmsAdapter(realOptions)));
  put('instagram', configured('instagram', new InstagramMessagingAdapter(realOptions)));
  put('facebook', configured('facebook', new FacebookMessengerAdapter(realOptions)));
  put('push', configured('push', new ExpoPushAdapter(realOptions)));
  put('in_app', fakeAdapters.in_app || new FakeCommunicationAdapter({ channel: 'in_app', provider: 'in_app' }));
  put('web_chat', fakeAdapters.web_chat || new FakeCommunicationAdapter({ channel: 'web_chat' }));
  put('mobile_chat', fakeAdapters.mobile_chat || new FakeCommunicationAdapter({ channel: 'mobile_chat' }));

  return {
    get(channel) { return registry.get(channel); },
    set(channel, adapter) { registry.set(channel, adapter); },
    entries() { return Array.from(registry.entries()); },
    health() {
      return Array.from(registry.entries()).map(([channel, adapter]) => ({ channel, ...adapter.validateConfiguration?.(env) }));
    },
  };
}
