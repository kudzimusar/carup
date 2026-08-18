import crypto from 'crypto';

import { extractReplyTokens, parseReplyToAddress } from './emailReplyTokenService.js';

/**
 * E3/E4 — Resend lifecycle + inbound webhook handling.
 *
 * Resend signs webhooks with Svix. Verification is the FIRST thing that happens, over the exact
 * raw bytes, before any parsing or business mutation. An unsigned or badly-signed request must
 * produce zero canonical change.
 */

/** Resend lifecycle events mapped onto canonical CarUp delivery state. */
export const RESEND_EVENT_STATUS = Object.freeze({
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'failed',
  'email.complained': 'failed',
  'email.failed': 'failed',
  'email.suppressed': 'failed',
});

/** Events that additionally imply canonical suppression. */
export const RESEND_SUPPRESSION_REASON = Object.freeze({
  'email.bounced': 'hard_bounce',
  'email.complained': 'complaint',
  'email.suppressed': 'provider_suppression',
});

export const RESEND_INBOUND_EVENT = 'email.received';

const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify a Svix-signed Resend webhook.
 *
 * Svix signs `${id}.${timestamp}.${rawBody}` with an HMAC-SHA256 keyed by the base64 secret that
 * follows the `whsec_` prefix. The header may carry several space-separated `v1,<sig>` values
 * during secret rotation, so every candidate is checked with a timing-safe comparison.
 */
export function verifyResendSignature({ rawBody, headers = {}, secret, toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS, now = () => new Date() }) {
  if (!secret) return { valid: false, reason: 'missing_secret' };

  const id = headers['svix-id'] || headers['webhook-id'];
  const timestamp = headers['svix-timestamp'] || headers['webhook-timestamp'];
  const signatureHeader = headers['svix-signature'] || headers['webhook-signature'];
  if (!id || !timestamp || !signatureHeader) return { valid: false, reason: 'missing_signature_headers' };

  // Replay window: an attacker must not be able to resend a captured request indefinitely.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'malformed_timestamp' };
  const ageSeconds = Math.abs(Math.floor(now().getTime() / 1000) - ts);
  if (ageSeconds > toleranceSeconds) return { valid: false, reason: 'timestamp_outside_tolerance' };

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const signedPayload = `${id}.${timestamp}.${body}`;

  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(signedPayload, 'utf8').digest();

  const candidates = String(signatureHeader)
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.includes(',') ? part.split(',')[1] : part));

  for (const candidate of candidates) {
    let provided;
    try {
      provided = Buffer.from(candidate, 'base64');
    } catch {
      continue;
    }
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      return { valid: true, eventId: String(id) };
    }
  }
  return { valid: false, reason: 'signature_mismatch' };
}

/** Normalise a header set that may arrive as a string, an array, or an object. */
function headerValue(headers, ...names) {
  for (const name of names) {
    const found = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
    if (found) return Array.isArray(found) ? found[0] : found;
  }
  return null;
}

/** RFC message ids out of In-Reply-To / References, most recent first. */
export function extractRfcReferences(payload = {}) {
  const headers = payload.headers || {};
  const inReplyTo = payload.in_reply_to || headerValue(headers, 'In-Reply-To');
  const references = payload.references || headerValue(headers, 'References');

  const ids = [];
  const push = (value) => {
    for (const m of String(value || '').matchAll(/<([^>]+)>/g)) ids.push(`<${m[1]}>`);
  };
  push(inReplyTo);
  push(references);
  // In-Reply-To is the strongest signal, so preserve its precedence while de-duplicating.
  return [...new Set(ids)];
}

/**
 * Resolve an inbound Resend email to its canonical conversation.
 *
 * Two independent signals:
 *   A. the opaque authenticated CarUp reply token in the recipient address;
 *   B. RFC In-Reply-To / References mapped through the persisted outbound provider message id.
 *
 * When BOTH exist they must agree. Disagreement, ambiguity, or an unprovable sender fails closed —
 * there is deliberately no "sender -> most recent conversation" fallback anywhere in this path.
 */
export class ResendInboundResolver {
  constructor({ supabase, replyTokenService }) {
    this.supabase = supabase;
    this.replyTokenService = replyTokenService;
  }

  /** Signal B: RFC reference -> canonical outbound message -> thread + bound participant. */
  async resolveByRfcReferences(payload) {
    const references = extractRfcReferences(payload);
    if (!references.length) return { ok: false, reason: 'no_rfc_reference' };

    const { data: attempts } = await this.supabase
      .from('message_delivery_attempts')
      .select('message_id, provider, provider_message_id')
      .in('provider_message_id', references)
      .in('provider', ['resend']);

    const withMessage = (attempts || []).filter((a) => a.message_id);
    if (!withMessage.length) return { ok: false, reason: 'unknown_rfc_reference' };

    const messageIds = [...new Set(withMessage.map((a) => a.message_id))];
    if (messageIds.length > 1) return { ok: false, reason: 'ambiguous_rfc_reference' };

    const { data: message } = await this.supabase
      .from('messages')
      .select('id, thread_id, tenant_id, sender_participant_id')
      .eq('id', messageIds[0])
      .maybeSingle();
    if (!message) return { ok: false, reason: 'rfc_message_missing' };

    return { ok: true, threadId: message.thread_id, tenantId: message.tenant_id, messageId: message.id };
  }

  /** Signal A: opaque reply token in any recipient header. */
  async resolveByReplyToken(payload) {
    const recipients = [
      payload.to, payload.To, payload.recipient, payload.delivered_to,
      headerValue(payload.headers || {}, 'To', 'Delivered-To', 'X-Original-To'),
    ].flat().filter(Boolean);

    const tokens = extractReplyTokens(recipients);
    // A single inbound email addressed to two different conversations is ambiguous by definition.
    if (tokens.length > 1) return { ok: false, reason: 'multiple_reply_tokens' };
    if (!tokens.length) {
      const single = parseReplyToAddress(recipients[0]);
      if (!single) return { ok: false, reason: 'no_reply_token' };
      tokens.push(single);
    }
    return this.replyTokenService.resolve(tokens[0]);
  }

  /**
   * Combine both signals under the agreement rule.
   * @returns {{ok:true, threadId, participantId?, tokenId?, resolution:string} | {ok:false, reason:string}}
   */
  async resolve(payload) {
    const token = await this.resolveByReplyToken(payload);
    const rfc = await this.resolveByRfcReferences(payload);

    const tokenOk = token.ok === true;
    const rfcOk = rfc.ok === true;

    if (tokenOk && rfcOk) {
      if (token.threadId !== rfc.threadId) {
        return { ok: false, reason: 'token_rfc_disagreement' };
      }
      return { ...token, resolution: 'token_and_rfc_agree' };
    }
    if (tokenOk) return { ...token, resolution: 'authenticated_reply_token' };

    if (rfcOk) {
      // RFC alone identifies the thread but not which participant replied. Use the thread's bound
      // email participant only when it is UNambiguous; never mint or guess one.
      const bound = await this.resolveBoundParticipant(rfc.threadId, payload);
      if (!bound.ok) return bound;
      return { ok: true, threadId: rfc.threadId, participantId: bound.participantId, tenantId: rfc.tenantId, resolution: 'rfc_reference' };
    }

    // Fail closed. Explicitly NOT falling back to sender-based matching.
    return { ok: false, reason: token.reason === 'no_reply_token' ? rfc.reason : token.reason };
  }

  /**
   * Find the existing bound participant for an inbound sender on a known thread.
   *
   * Preserves the Communications 2.0 Gate-E invariant: when an exact conversation and an
   * authoritative bound participant exist, that participant is REUSED. This never creates one.
   */
  async resolveBoundParticipant(threadId, payload) {
    const from = String(payload.from || payload.From || '').toLowerCase();
    const address = (from.match(/<([^>]+)>/)?.[1] || from).trim();
    if (!address) return { ok: false, reason: 'unprovable_sender' };

    const { data: identities } = await this.supabase
      .from('channel_identities')
      .select('id, normalized_address, user_id')
      .eq('channel', 'email')
      .eq('normalized_address', address);

    if (!identities?.length) return { ok: false, reason: 'no_channel_identity_for_sender' };

    const { data: bindings } = await this.supabase
      .from('conversation_channel_bindings')
      .select('id, participant_id, can_receive, channel_identity_id')
      .eq('thread_id', threadId)
      .eq('channel', 'email')
      .in('channel_identity_id', identities.map((i) => i.id));

    const usable = (bindings || []).filter((b) => b.can_receive !== false && b.participant_id);
    if (!usable.length) return { ok: false, reason: 'no_active_binding_for_sender' };
    if (usable.length > 1) return { ok: false, reason: 'ambiguous_binding_for_sender' };

    const participantId = usable[0].participant_id;
    const { data: participant } = await this.supabase
      .from('message_participants')
      .select('id, thread_id, left_at')
      .eq('id', participantId)
      .maybeSingle();

    if (!participant) return { ok: false, reason: 'bound_participant_missing' };
    if (participant.thread_id !== threadId) return { ok: false, reason: 'bound_participant_thread_mismatch' };
    if (participant.left_at) return { ok: false, reason: 'bound_participant_inactive' };

    return { ok: true, participantId, bindingId: usable[0].id };
  }
}

export function createResendInboundResolver(deps) {
  return new ResendInboundResolver(deps);
}
