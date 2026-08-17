import crypto from 'crypto';
import { parseChannelPayload } from '../referral/referralChannelPayloadParsers.js';
import { buildDedupeKey, normalizeChannel, redactPayload, stableHash, nowIso } from './communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';
import { ForbiddenError, ValidationError } from '../../utils/errors.js';
import { RESEND_EVENT_STATUS, RESEND_SUPPRESSION_REASON, verifyResendSignature } from './resendWebhookService.js';

const DEFAULT_CLOUDFLARE_SIGNATURE_TOLERANCE_SECONDS = 300;
const DEFAULT_CLOUDFLARE_MAX_EMAIL_BYTES = 25 * 1024 * 1024;
const BLOCKED_ATTACHMENT_EXTENSIONS = new Set(['exe', 'js', 'mjs', 'cjs', 'bat', 'cmd', 'scr', 'ps1', 'vbs', 'jar']);

function headerValue(headers = {}, name) {
  const exact = headers[name];
  if (exact !== undefined) return exact;
  const wanted = String(name).toLowerCase();
  const found = Object.entries(headers).find(([key]) => String(key).toLowerCase() === wanted);
  return found?.[1];
}

function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sha256Hex(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseAllowedRecipients(env = {}) {
  return String(env.CLOUDFLARE_EMAIL_ALLOWED_RECIPIENTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function emailLocalPart(address = '') {
  return String(address).split('@')[0]?.toLowerCase() || '';
}

function validateCloudflareAttachments(attachments = [], maxBytes = 5 * 1024 * 1024) {
  if (!Array.isArray(attachments)) throw new ValidationError('Cloudflare email attachments must be an array.');
  let total = 0;
  for (const attachment of attachments) {
    const filename = String(attachment.filename || attachment.name || '').toLowerCase();
    const extension = filename.includes('.') ? filename.split('.').pop() : '';
    if (extension && BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) {
      throw new ValidationError('Cloudflare email attachment type is not allowed.');
    }
    total += Number(attachment.size || attachment.size_bytes || 0);
  }
  if (total > maxBytes) throw new ValidationError('Cloudflare email attachments exceed the configured size limit.');
  return attachments.map((attachment) => ({
    filename: attachment.filename || attachment.name || null,
    content_type: attachment.content_type || attachment.type || null,
    size: Number(attachment.size || attachment.size_bytes || 0),
    sha256: attachment.sha256 || attachment.content_sha256 || null,
    r2_key: attachment.r2_key || attachment.storage_key || null,
    disposition: attachment.disposition || 'attachment',
  }));
}

export class CommunicationWebhookService {
  constructor({ repository, inboundService, inboundResolver = null, replyTokenService = null, env = process.env } = {}) {
    this.repository = repository;
    this.inboundService = inboundService;
    // E4 inbound reply routing. These were previously read by handleResendInboundWebhook but never
    // assigned by any constructor or factory, so every legitimate signed `email.received` threw
    // "Resend inbound routing is not configured." before reaching the resolver. Tests passed only
    // because they injected a resolver directly, so the production path was dead by construction.
    this.inboundResolver = inboundResolver;
    this.replyTokenService = replyTokenService;
    this.env = env;
  }

  verifyMetaCallback(channel, query = {}) {
    const normalized = normalizeChannel(channel);
    if (!['whatsapp', 'facebook', 'instagram'].includes(normalized)) {
      throw new ValidationError('Unsupported Meta webhook channel.');
    }
    const expected = this.env.CARUP_META_WEBHOOK_VERIFY_TOKEN || this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode === 'subscribe' && expected && token === expected && challenge !== undefined) {
      return String(challenge);
    }
    throw new ForbiddenError('Meta webhook verification failed.');
  }

  verify(provider, channel, { headers = {}, query = {}, rawBody = '', body = {} } = {}) {
    const normalized = normalizeChannel(channel) || channel;
    const normalizedProvider = String(provider || '').toLowerCase();
    if (provider === 'telegram' || normalized === 'telegram') {
      const expected = this.env.CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN || this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
      return Boolean(expected && headers['x-telegram-bot-api-secret-token'] === expected);
    }
    if (normalizedProvider === 'sendgrid') {
      if (this.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY) {
        return this.verifySendGridSignature(headers, rawBody);
      }
      const shared = this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
      return Boolean(shared && headers['x-channel-webhook-secret'] === shared) || Boolean(body?.test === true && this.env.NODE_ENV === 'test');
    }
    // Resend signs with Svix over the exact raw bytes. No shared-secret or test-mode fallback:
    // a P0 auth/security transport must never accept an unverified event.
    if (normalizedProvider === 'resend') {
      return verifyResendSignature({
        rawBody,
        headers,
        secret: this.env.RESEND_WEBHOOK_SECRET,
      }).valid;
    }
    // Brevo publishes no request-signing scheme, so authentication is a shared secret CarUp
    // generates and registers with the webhook URL. Compared timing-safely.
    if (normalizedProvider === 'brevo') {
      const expected = this.env.BREVO_WEBHOOK_SECRET;
      if (!expected) return false;
      const supplied = headers['x-carup-brevo-secret']
        || headers['x-brevo-webhook-secret']
        || String(query?.token || '');
      if (!supplied) return false;
      const a = Buffer.from(String(supplied), 'utf8');
      const b = Buffer.from(String(expected), 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (normalizedProvider === 'twilio') {
      if (this.env.TWILIO_AUTH_TOKEN) {
        return this.verifyTwilioSignature(headers, body);
      }
      const shared = this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
      return Boolean(shared && headers['x-channel-webhook-secret'] === shared) || Boolean(body?.test === true && this.env.NODE_ENV === 'test');
    }
    if (normalizedProvider === 'expo') {
      const expected = this.env.EXPO_ACCESS_TOKEN || this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
      const supplied = headers.authorization?.replace(/^Bearer\s+/i, '') || headers['x-channel-webhook-secret'];
      return Boolean(expected && supplied === expected) || Boolean(body?.test === true && this.env.NODE_ENV === 'test');
    }
    if (normalizedProvider === 'cloudflare' && normalized === 'email') {
      return this.verifyCloudflareEmailSignature(headers, rawBody);
    }
    if (normalizedProvider === 'meta' || ['whatsapp', 'facebook', 'instagram'].includes(normalized)) {
      if (query['hub.mode'] === 'subscribe') {
        const expected = this.env.CARUP_META_WEBHOOK_VERIFY_TOKEN || this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
        return Boolean(expected && query['hub.verify_token'] === expected);
      }
      const appSecret = this.env.CARUP_META_APP_SECRET;
      const signature = headers['x-hub-signature-256'];
      if (appSecret) {
        if (!signature || !rawBody) return false;
        const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
        const signatureBuffer = Buffer.from(String(signature));
        const expectedBuffer = Buffer.from(expected);
        return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
      }
      const shared = this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
      return Boolean(shared && (headers['x-channel-webhook-secret'] === shared || headers['x-carup-channel-secret'] === shared));
    }
    const shared = this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
    return Boolean(shared && headers['x-channel-webhook-secret'] === shared) || Boolean(body?.test === true && this.env.NODE_ENV === 'test');
  }

  verifySendGridSignature(headers = {}, rawBody = '') {
    const signature = headers['x-twilio-email-event-webhook-signature'];
    const timestamp = headers['x-twilio-email-event-webhook-timestamp'];
    if (!signature || !timestamp || !rawBody) return false;
    try {
      let key = String(this.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY || '').trim();
      if (!key.includes('BEGIN PUBLIC KEY')) {
        key = `-----BEGIN PUBLIC KEY-----\n${key.match(/.{1,64}/g)?.join('\n') || key}\n-----END PUBLIC KEY-----`;
      }
      return crypto.verify('sha256', Buffer.from(`${timestamp}${rawBody}`), crypto.createPublicKey(key), Buffer.from(String(signature), 'base64'));
    } catch (_error) {
      return false;
    }
  }

  verifyTwilioSignature(headers = {}, body = {}) {
    const signature = headers['x-twilio-signature'];
    const url = this.env.TWILIO_STATUS_CALLBACK_URL || this.env.CARUP_PUBLIC_API_URL;
    if (!signature || !url) return false;
    const params = Object.keys(body || {})
      .sort()
      .map((key) => `${key}${body[key]}`)
      .join('');
    const expected = crypto.createHmac('sha1', this.env.TWILIO_AUTH_TOKEN).update(`${url}${params}`).digest('base64');
    const left = Buffer.from(String(signature));
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  verifyCloudflareEmailSignature(headers = {}, rawBody = '') {
    const accessClientId = this.env.CLOUDFLARE_ACCESS_CLIENT_ID;
    const accessClientSecret = this.env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
    if (accessClientId || accessClientSecret) {
      if (!accessClientId || !accessClientSecret) return false;
      if (!safeEqual(headerValue(headers, 'cf-access-client-id') || '', accessClientId)) return false;
      if (!safeEqual(headerValue(headers, 'cf-access-client-secret') || '', accessClientSecret)) return false;
    }

    const secret = this.env.CLOUDFLARE_EMAIL_INBOUND_SECRET || this.env.CLOUDFLARE_EMAIL_WORKER_SECRET;
    const timestamp = headerValue(headers, 'x-carup-cloudflare-timestamp');
    const nonce = headerValue(headers, 'x-carup-cloudflare-nonce');
    const signature = headerValue(headers, 'x-carup-cloudflare-signature');
    const suppliedBodyHash = headerValue(headers, 'x-carup-body-sha256');
    if (!secret || !timestamp || !nonce || !signature || !rawBody) return false;

    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) return false;
    const tolerance = Number(this.env.CLOUDFLARE_EMAIL_SIGNATURE_TOLERANCE_SECONDS || DEFAULT_CLOUDFLARE_SIGNATURE_TOLERANCE_SECONDS);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampSeconds) > tolerance) return false;

    const bodyHash = sha256Hex(rawBody);
    if (suppliedBodyHash && !safeEqual(suppliedBodyHash, bodyHash)) return false;
    const expectedHex = crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}.${bodyHash}.${rawBody}`).digest('hex');
    return safeEqual(signature, `v1=${expectedHex}`) || safeEqual(signature, expectedHex);
  }

  dedupeKey(provider, channel, body = {}) {
    const normalized = normalizeChannel(channel) || channel;
    if (normalized === 'telegram' && body.update_id) return buildDedupeKey([provider, normalized, body.update_id]);
    const metaMessageId = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
      || body.entry?.[0]?.messaging?.[0]?.message?.mid
      || body.entry?.[0]?.messaging?.[0]?.postback?.mid;
    if (metaMessageId) return buildDedupeKey([provider, normalized, metaMessageId]);
    if (String(provider || '').toLowerCase() === 'cloudflare' && normalized === 'email') {
      return buildDedupeKey([provider, normalized, body.message_id || body.provider_message_id || body.idempotency_key || stableHash(body).slice(0, 32)]);
    }
    // Resend/Svix supplies a stable per-delivery event id in the svix-id header, which the route
    // folds into the body as provider_event_id. Falling back to the email id + type still dedupes
    // a genuine provider replay of the same transition.
    if (String(provider || '').toLowerCase() === 'resend') {
      const resendId = body.provider_event_id
        || (body.type && (body.data?.email_id || body.data?.id) ? `${body.type}:${body.data.email_id || body.data.id}` : null);
      return buildDedupeKey([provider, normalized, resendId || stableHash(body).slice(0, 32)]);
    }
    if (String(provider || '').toLowerCase() === 'brevo') {
      const brevoId = body.provider_event_id
        || (body.event && (body['message-id'] || body.message_id) ? `${body.event}:${body['message-id'] || body.message_id}` : null);
      return buildDedupeKey([provider, normalized, brevoId || stableHash(body).slice(0, 32)]);
    }
    if (body.provider_event_id || body.event_id) return buildDedupeKey([provider, normalized, body.provider_event_id || body.event_id]);
    return buildDedupeKey([provider, normalized, stableHash(body).slice(0, 32)]);
  }

  extractDeliveryReceipts(provider, channel, body = {}) {
    const normalizedProvider = String(provider || '').toLowerCase();
    const normalized = normalizeChannel(channel) || channel;
    if (normalizedProvider === 'resend') {
      // Inbound mail is not a delivery receipt — it is handled by the inbound path.
      if (body.type === 'email.received') return [];
      const status = RESEND_EVENT_STATUS[body.type];
      if (!status) return [];
      const data = body.data || {};
      const headers = data.headers || {};
      const rfcMessageId = data.message_id
        || (Array.isArray(headers) ? headers.find((h) => String(h.name).toLowerCase() === 'message-id')?.value : headers['message-id'])
        || null;
      return [{
        provider: 'resend',
        channel: 'email',
        // The RFC Message-ID is what the adapter persisted as provider_message_id, so receipts
        // correlate on the same identifier an inbound reply would reference.
        providerMessageId: rfcMessageId || data.email_id || data.id || null,
        providerRequestId: data.email_id || data.id || null,
        notificationId: data.tags?.notification_id || headers['x-carup-notification-id'] || null,
        messageId: data.tags?.message_id || headers['x-carup-message-id'] || null,
        status,
        rawStatus: body.type,
        suppressionReason: RESEND_SUPPRESSION_REASON[body.type] || null,
        recipient: Array.isArray(data.to) ? data.to[0] : data.to || null,
      }].filter((r) => r.providerMessageId || r.providerRequestId || r.notificationId || r.messageId);
    }
    if (normalizedProvider === 'brevo') {
      const event = String(body.event || '').toLowerCase();
      const map = {
        delivered: 'delivered',
        hard_bounce: 'failed',
        soft_bounce: 'failed',
        deferred: 'sent',
        spam: 'failed',
        complaint: 'failed',
        unsubscribed: 'failed',
        blocked: 'failed',
        error: 'failed',
      };
      const status = map[event];
      if (!status) return [];
      const suppression = {
        hard_bounce: 'hard_bounce',
        spam: 'complaint',
        complaint: 'complaint',
        unsubscribed: 'unsubscribe',
        blocked: 'provider_suppression',
      }[event] || null;
      return [{
        provider: 'brevo',
        channel: 'email',
        providerMessageId: body['message-id'] || body.message_id || null,
        notificationId: body.tags?.notification_id || body.notification_id || null,
        messageId: body.tags?.message_id || body.message_id_carup || null,
        status,
        rawStatus: event,
        suppressionReason: suppression,
        recipient: body.email || null,
      }].filter((r) => r.providerMessageId || r.notificationId || r.messageId);
    }
    if (normalizedProvider === 'sendgrid') {
      const events = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [];
      return events.map((event) => ({
        provider: 'sendgrid',
        channel: 'email',
        providerMessageId: event.sg_message_id || event.smtp_id || event.message_id || null,
        notificationId: event.notification_id || event.custom_args?.notification_id || null,
        messageId: event.message_id || event.custom_args?.message_id || null,
        status: ['delivered', 'open', 'click'].includes(event.event) ? 'delivered' : ['bounce', 'dropped', 'deferred'].includes(event.event) ? 'failed' : 'sent',
        rawStatus: event.event,
      })).filter((receipt) => receipt.providerMessageId || receipt.notificationId || receipt.messageId);
    }
    if (normalizedProvider === 'cloudflare') {
      const events = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : body.event ? [body] : [];
      return events.map((event) => {
        const rawStatus = String(event.status || event.event || '').toLowerCase();
        if (!['delivered', 'sent', 'queued', 'bounced', 'failed', 'dropped'].includes(rawStatus)) return null;
        return {
          provider: 'cloudflare_email',
          channel: 'email',
          providerMessageId: event.provider_message_id || event.message_id || event.id || null,
          notificationId: event.notification_id || event.metadata?.notification_id || null,
          messageId: event.carup_message_id || event.metadata?.message_id || null,
          status: rawStatus === 'delivered' ? 'delivered' : ['bounced', 'failed', 'dropped'].includes(rawStatus) ? 'failed' : 'sent',
          rawStatus,
          errorCode: event.error_code || null,
          errorMessage: event.error_message || null,
        };
      }).filter(Boolean).filter((receipt) => receipt.providerMessageId || receipt.notificationId || receipt.messageId);
    }
    if (normalizedProvider === 'twilio') {
      const providerMessageId = body.MessageSid || body.SmsSid || body.SmsMessageSid;
      if (!providerMessageId || !body.MessageStatus) return [];
      const delivered = ['delivered', 'read'].includes(String(body.MessageStatus).toLowerCase());
      const failed = ['failed', 'undelivered', 'canceled'].includes(String(body.MessageStatus).toLowerCase());
      return [{
        provider: 'twilio',
        channel: normalized,
        providerMessageId,
        status: delivered ? 'delivered' : failed ? 'failed' : 'sent',
        rawStatus: body.MessageStatus,
      }];
    }
    if (normalizedProvider === 'meta' || ['whatsapp', 'facebook', 'instagram'].includes(normalized)) {
      const receipts = [];
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          for (const status of change.value?.statuses || []) {
            receipts.push({
              provider: normalized === 'whatsapp' ? 'meta_whatsapp_cloud_api' : 'meta',
              channel: normalized,
              providerMessageId: status.id,
              status: ['delivered', 'read'].includes(status.status) ? 'delivered' : status.status === 'failed' ? 'failed' : 'sent',
              rawStatus: status.status,
            });
          }
        }
      }
      return receipts;
    }
    if (normalizedProvider === 'expo') {
      const data = body.data || body.receipts || {};
      return Object.entries(data).map(([ticketId, receipt]) => ({
        provider: 'expo_push',
        channel: 'push',
        providerMessageId: ticketId,
        status: receipt?.status === 'ok' ? 'delivered' : 'failed',
        rawStatus: receipt?.status,
        errorCode: receipt?.details?.error || null,
        errorMessage: receipt?.message || null,
      }));
    }
    return [];
  }

  async applyDeliveryReceipt(receipt = {}) {
    const attempts = receipt.providerMessageId
      ? await this.repository.list('message_delivery_attempts', { provider_message_id: receipt.providerMessageId })
      : [];
    const attempt = attempts.find((row) => !receipt.provider || row.provider === receipt.provider) || attempts[0] || null;
    const notificationId = receipt.notificationId || attempt?.notification_id || null;
    const messageId = receipt.messageId || attempt?.message_id || null;
    if (attempt?.id) {
      await this.repository.updateById('message_delivery_attempts', attempt.id, {
        status: receipt.status === 'failed' ? 'failed' : receipt.status,
        response_metadata: { ...(attempt.response_metadata || {}), provider_receipt_status: receipt.rawStatus || receipt.status },
        error_code: receipt.errorCode || null,
        error_message: receipt.errorMessage || null,
        completed_at: nowIso(),
      });
    }
    if (notificationId) {
      await this.repository.updateById('notification_queue', notificationId, {
        status: receipt.status,
        delivered_at: receipt.status === 'delivered' ? nowIso() : null,
        last_error_code: receipt.status === 'failed' ? receipt.errorCode || 'provider_receipt_failed' : null,
        last_error_message: receipt.status === 'failed' ? receipt.errorMessage || `Provider receipt status: ${receipt.rawStatus || 'failed'}` : null,
        locked_at: null,
        locked_by: null,
      });
    }
    if (messageId) {
      await this.repository.updateById('messages', messageId, {
        status: receipt.status === 'failed' ? 'failed' : receipt.status,
        delivered_at: receipt.status === 'delivered' ? nowIso() : null,
        failed_at: receipt.status === 'failed' ? nowIso() : null,
      });
    }
    // Audit the provider receipt (item 2). Resolve thread/tenant context from the notification.
    const notification = notificationId ? await this.repository.findOne('notification_queue', { id: notificationId }).catch(() => null) : null;
    await logCommunicationAuditEvent(this.repository, {
      tenant_id: notification?.tenant_id ?? null, thread_id: notification?.thread_id ?? null,
      message_id: messageId ?? null, notification_id: notificationId ?? null,
      event_type: COMMUNICATION_AUDIT_EVENTS.DELIVERY_RECEIPT, actor_type: 'system',
      channel: notification?.channel ?? receipt.channel ?? null,
      summary: `Provider receipt: ${receipt.status}`, correlation_id: receipt.providerMessageId || null,
      metadata: { status: receipt.status, raw_status: receipt.rawStatus ?? null, error_code: receipt.errorCode ?? null },
    });
    return { notificationId, messageId, providerMessageId: receipt.providerMessageId, status: receipt.status };
  }

  /**
   * E4 — inbound Resend reply routed into the EXACT existing conversation.
   *
   * Signature verification and webhook dedupe have already happened in handleWebhook, so this only
   * runs for an authenticated, non-duplicate event. Resolution requires an authenticated CarUp
   * reply token and/or an RFC reference, and when both are present they must agree. Anything
   * ambiguous fails closed — there is no sender-based fallback.
   *
   * The resolved participant is authoritative and is REUSED (Communications 2.0 Gate-E invariant);
   * this path never mints a participant, so the delta for one inbound reply is
   * threads +0, participants +0, messages +1.
   */
  async handleResendInboundWebhook(body = {}, actor = {}) {
    if (!this.inboundResolver || !this.inboundService) {
      throw new ValidationError('Resend inbound routing is not configured.');
    }
    const data = body.data || body;

    const resolution = await this.inboundResolver.resolve(data);
    if (!resolution.ok) {
      // Fail closed: record why, mutate nothing.
      throw new ValidationError(`Inbound Email could not be routed: ${resolution.reason}`, {
        reason: resolution.reason,
        provider: 'resend',
      });
    }

    const headers = data.headers || {};
    const rfcMessageId = data.message_id
      || (Array.isArray(headers) ? headers.find((h) => String(h.name).toLowerCase() === 'message-id')?.value : headers['message-id'])
      || null;

    // Hand the resolver's proven thread + participant to ingest as an authoritative binding.
    // Passing only threadId/participantId is NOT enough: ingest never reads `participantId`, and a
    // bare threadId disables its binding branch and falls through to ensureParticipant. With no
    // tenant on a webhook actor, identity lookup would filter on tenant_id IS NULL, miss the real
    // identity, and mint a duplicate identity AND participant — violating the +0 participants
    // invariant this path exists to uphold.
    const [thread, participant] = await Promise.all([
      this.repository.findOne('message_threads', { id: resolution.threadId }),
      resolution.participantId
        ? this.repository.findOne('message_participants', { id: resolution.participantId })
        : Promise.resolve(null),
    ]);
    if (!thread) throw new ValidationError('Inbound Email resolved to a missing thread.');
    if (!participant) throw new ValidationError('Inbound Email resolved to a missing participant.');

    const result = await this.inboundService.ingest({
      channel: 'email',
      provider: 'resend',
      tenant_id: resolution.tenantId ?? thread.tenant_id ?? null,
      boundConversation: { thread, participant, resolution: resolution.resolution },
      threadId: resolution.threadId,
      participantId: resolution.participantId,
      providerMessageId: rfcMessageId,
      externalConversationId: rfcMessageId,
      from: data.from || data.From || null,
      text: data.text || data.plain || data.body || '',
      attachments: data.attachments || [],
      metadata: {
        resolution: resolution.resolution,
        reply_token_id: resolution.tokenId || null,
        subject: data.subject || null,
      },
    }, { gateway_trusted: true, surface: 'email', actor });

    if (resolution.tokenId && this.replyTokenService?.recordUse) {
      await this.replyTokenService.recordUse(resolution.tokenId);
    }
    return { ...result, resolution: resolution.resolution };
  }

  async handleCloudflareEmailWebhook(body = {}, actor = {}) {
    const recipient = String(body.recipient || body.to || body.envelope?.to || '').trim().toLowerCase();
    const sender = String(body.sender || body.from || body.envelope?.from || '').trim().toLowerCase();
    if (!recipient || !sender) throw new ValidationError('Cloudflare email webhook requires sender and recipient.');

    const allowedRecipients = parseAllowedRecipients(this.env);
    if (allowedRecipients.length > 0 && !allowedRecipients.includes(recipient)) {
      throw new ValidationError('Cloudflare email recipient is not supported.');
    }

    const rawSize = Number(body.raw_size || body.rawSize || 0);
    const maxBytes = Number(this.env.CLOUDFLARE_EMAIL_MAX_BYTES || DEFAULT_CLOUDFLARE_MAX_EMAIL_BYTES);
    if (rawSize > maxBytes) throw new ValidationError('Cloudflare email exceeds the configured inbound size limit.');

    const attachmentMetadata = validateCloudflareAttachments(body.attachments || body.attachment_metadata || []);
    const localPart = emailLocalPart(recipient);
    const forceHuman = ['finance', 'escrow', 'safepay', 'security', 'trust', 'abuse'].some((prefix) => localPart.startsWith(prefix));
    const references = Array.isArray(body.references) ? body.references : String(body.references || body.headers?.references || '').split(/\s+/).filter(Boolean);
    const inReplyTo = body.in_reply_to || body.headers?.['in-reply-to'] || body.headers?.in_reply_to || null;
    const messageId = body.message_id || body.headers?.['message-id'] || body.headers?.message_id || body.idempotency_key || null;
    const result = await this.inboundService.ingest({
      channel: 'email',
      provider: 'cloudflare_email',
      text: body.text || body.plain_text || body.subject || '',
      externalSenderId: sender,
      externalConversationId: inReplyTo || references.at(-1) || sender,
      providerMessageId: messageId,
      source: 'cloudflare_email_worker',
      display_name: body.from_name || body.sender_name || null,
      force_human: forceHuman,
      tenant_id: actor.actor_tenant_id || null,
      subject_type: forceHuman ? (localPart.startsWith('finance') ? 'finance' : localPart.startsWith('escrow') || localPart.startsWith('safepay') ? 'escrow' : null) : null,
      metadata: {
        provider: 'cloudflare_email',
        recipient,
        sender,
        subject: body.subject || null,
        message_id: messageId,
        in_reply_to: inReplyTo,
        references,
        raw_size: rawSize,
        headers: redactPayload(body.headers || {}),
        attachment_count: attachmentMetadata.length,
      },
    }, { ...actor, gateway_trusted: true, surface: 'email' });

    if (attachmentMetadata.length > 0 && result?.message?.id) {
      await this.repository.updateById('messages', result.message.id, {
        attachment_metadata: attachmentMetadata,
        content_json: {
          ...(result.message.content_json || {}),
          cloudflare_email: {
            recipient,
            sender,
            subject: body.subject || null,
            message_id: messageId,
            in_reply_to: inReplyTo,
            references,
          },
        },
      });
    }
    return result;
  }

  async handleWebhook(provider, channel, body = {}, { headers = {}, query = {}, actor = {}, rawBody = '' } = {}) {
    const normalized = normalizeChannel(channel);
    if (!normalized) throw new Error('Unsupported webhook channel.');
    const signatureValid = this.verify(provider, normalized, { headers, query, rawBody, body });
    const dedupeKey = this.dedupeKey(provider, normalized, body);
    const payloadHash = stableHash(body);

    const existing = await this.repository.findOne('webhook_logs', { dedupe_key: dedupeKey });
    if (existing) {
      if (!signatureValid) {
        await this.repository.updateById('webhook_logs', existing.id, {
          processing_status: 'duplicate',
          attempt_count: Number(existing.attempt_count || 0) + 1,
          error_code: 'invalid_signature_duplicate',
          error_message: 'Duplicate webhook delivery failed signature validation.',
          processed_at: nowIso(),
        });
        throw new ForbiddenError('Webhook verification failed.');
      }
      // Only a delivery that previously SUCCEEDED is an inert duplicate. Treating a retry of a
      // FAILED delivery as a duplicate returns 200 and rewrites 'failed' to 'duplicate' — which is
      // exactly how a hard CarUp-side failure on a real inbound reply was made to look like provider
      // silence: the first attempt 400'd, the provider retried, the retry was deduped into a 200,
      // and the provider then reported the delivery as successful. A failed row must stay failed and
      // must keep returning a non-2xx so the failure remains visible and the provider keeps retrying.
      if (existing.processing_status === 'failed') {
        await this.repository.updateById('webhook_logs', existing.id, {
          attempt_count: Number(existing.attempt_count || 0) + 1,
          processed_at: nowIso(),
        });
        throw new ValidationError(
          `Webhook delivery previously failed and has not been remediated: ${existing.error_message || existing.error_code || 'unknown error'}`,
          { reason: 'duplicate_of_failed_delivery', provider, webhook_log_id: existing.id },
        );
      }
      await this.repository.updateById('webhook_logs', existing.id, {
        processing_status: 'duplicate',
        attempt_count: Number(existing.attempt_count || 0) + 1,
        processed_at: nowIso(),
      });
      await logCommunicationAuditEvent(this.repository, {
        tenant_id: existing.tenant_id ?? null, event_type: COMMUNICATION_AUDIT_EVENTS.WEBHOOK_PROCESSED,
        actor_type: 'system', channel: normalized, summary: 'Inbound webhook duplicate (deduped)',
        correlation_id: actor.correlation_id || null, metadata: { result: 'duplicate', provider },
      });
      return { success: true, duplicate: true, webhook_log_id: existing.id, count: 0, results: [] };
    }

    const log = await this.repository.insert('webhook_logs', {
      provider,
      channel: normalized,
      provider_event_id: body.update_id || body.provider_event_id || null,
      dedupe_key: dedupeKey,
      signature_valid: signatureValid,
      payload_hash: payloadHash,
      payload_redacted: redactPayload(body),
      headers_redacted: redactPayload(headers),
      processing_status: signatureValid ? 'received' : 'rejected',
      message_count: 0,
      attempt_count: 1,
      received_at: nowIso(),
      correlation_id: actor.correlation_id || null,
    });

    if (!signatureValid) {
      await this.repository.updateById('webhook_logs', log.id, {
        processing_status: 'rejected',
        error_code: 'invalid_signature',
        error_message: 'Webhook signature or shared secret validation failed.',
        processed_at: nowIso(),
      });
      await logCommunicationAuditEvent(this.repository, {
        event_type: COMMUNICATION_AUDIT_EVENTS.WEBHOOK_PROCESSED, actor_type: 'system', channel: normalized,
        summary: 'Inbound webhook rejected (invalid signature)', correlation_id: actor.correlation_id || null,
        metadata: { result: 'rejected', provider, error_code: 'invalid_signature' },
      });
      throw new ForbiddenError('Webhook verification failed.');
    }

    try {
      const receipts = this.extractDeliveryReceipts(provider, normalized, body);
      const receiptResults = [];
      for (const receipt of receipts) {
        receiptResults.push(await this.applyDeliveryReceipt(receipt));
      }
      // Receipt-only providers: a lifecycle event carries no inbound message, so processing ends
      // once the canonical delivery transition is applied. Without 'resend'/'brevo' here their
      // lifecycle events fall through to parseChannelPayload(), which has no 'email' parser and
      // throws "Unsupported referral channel." — observed live on genuine Resend email.sent /
      // email.delivered events, which then recorded no canonical transition at all.
      // (Resend's email.received is inbound, and extractDeliveryReceipts returns [] for it, so it
      // still falls through to the inbound handler below.)
      if (receiptResults.length > 0 && ['sendgrid', 'twilio', 'expo', 'cloudflare', 'resend', 'brevo'].includes(String(provider || '').toLowerCase())) {
        await this.repository.updateById('webhook_logs', log.id, {
          processing_status: 'processed',
          message_count: 0,
          processed_at: nowIso(),
        });
        return { success: true, duplicate: false, webhook_log_id: log.id, count: 0, receipt_count: receiptResults.length, results: [], receipts: receiptResults };
      }
      // An AUTHENTICATED Email lifecycle event that carries no canonical delivery transition —
      // Brevo's `request` and `unique_opened` are the live examples — must be acknowledged and
      // ignored, not failed. Previously these fell through to parseChannelPayload(), which has no
      // 'email' parser and throws "Unsupported referral channel.", so genuine provider traffic was
      // recorded as a failure. That is now actively harmful: a failed row is deliberately retried
      // with a non-2xx (see the dedupe branch above), so the provider would retry an open-tracking
      // ping indefinitely and could disable the webhook for persistent errors.
      //
      // Recorded as 'processed' because the delivery WAS handled; the marker distinguishes "nothing
      // to transition" from a real receipt. ('ignored' is not an allowed processing_status, and this
      // does not warrant widening a CHECK constraint on a shared table.)
      const emailLifecycleProviders = ['resend', 'brevo'];
      const isUnmappedEmailLifecycle = normalized === 'email'
        && emailLifecycleProviders.includes(String(provider || '').toLowerCase())
        && receiptResults.length === 0
        && !(String(provider || '').toLowerCase() === 'resend' && body.type === 'email.received');
      if (isUnmappedEmailLifecycle) {
        await this.repository.updateById('webhook_logs', log.id, {
          processing_status: 'processed',
          message_count: 0,
          processed_at: nowIso(),
          error_code: 'ignored_no_canonical_transition',
          error_message: `Authenticated ${provider} event '${body.event || body.type || 'unknown'}' carries no canonical CarUp delivery transition.`,
        });
        return { success: true, duplicate: false, ignored: true, webhook_log_id: log.id, count: 0, receipt_count: 0, results: [] };
      }

      const results = [];
      if (String(provider || '').toLowerCase() === 'resend' && normalized === 'email' && body.type === 'email.received') {
        results.push(await this.handleResendInboundWebhook(body, actor));
      } else if (String(provider || '').toLowerCase() === 'cloudflare' && normalized === 'email' && (body.event || body.message_id || body.envelope)) {
        results.push(await this.handleCloudflareEmailWebhook(body, actor));
      } else {
        const parsed = parseChannelPayload(normalized, body);
        const inboundProvider = String(provider || '').toLowerCase() === 'meta' && normalized === 'whatsapp'
          ? 'meta_whatsapp_cloud_api'
          : provider;
        for (const message of parsed) {
          results.push(await this.inboundService.ingest({
            channel: normalized,
            provider: inboundProvider,
            text: message.text,
            externalSenderId: message.sender_id,
            externalConversationId: message.conversation_id,
            providerMessageId: message.message_id,
            providerTimestamp: message.provider_timestamp || null,
            referralCode: message.referral_code,
            source: message.source,
            metadata: message.payload,
            tenant_id: actor.actor_tenant_id || null,
          }, { ...actor, gateway_trusted: true, surface: normalized }));
        }
      }
      await this.repository.updateById('webhook_logs', log.id, {
        processing_status: 'processed',
        message_count: results.length,
        processed_at: nowIso(),
      });
      await logCommunicationAuditEvent(this.repository, {
        event_type: COMMUNICATION_AUDIT_EVENTS.WEBHOOK_PROCESSED, actor_type: 'system', channel: normalized,
        summary: `Inbound webhook processed (${results.length} message${results.length === 1 ? '' : 's'})`,
        correlation_id: actor.correlation_id || null, metadata: { result: 'processed', provider, message_count: results.length },
      });
      return { success: true, duplicate: false, webhook_log_id: log.id, count: results.length, receipt_count: receiptResults.length, results, receipts: receiptResults };
    } catch (error) {
      await this.repository.updateById('webhook_logs', log.id, {
        processing_status: 'failed',
        error_code: error.code || 'processing_failed',
        error_message: error.message,
        processed_at: nowIso(),
      });
      await logCommunicationAuditEvent(this.repository, {
        event_type: COMMUNICATION_AUDIT_EVENTS.WEBHOOK_PROCESSED, actor_type: 'system', channel: normalized,
        summary: `Inbound webhook failed (${error.code || 'processing_failed'})`,
        correlation_id: actor.correlation_id || null, metadata: { result: 'failed', provider, error_code: error.code || 'processing_failed' },
      });
      throw error;
    }
  }
}
