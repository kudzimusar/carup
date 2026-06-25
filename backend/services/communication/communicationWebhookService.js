import crypto from 'crypto';
import { parseChannelPayload } from '../referral/referralChannelPayloadParsers.js';
import { buildDedupeKey, normalizeChannel, redactPayload, stableHash, nowIso } from './communicationUtils.js';
import { ForbiddenError, ValidationError } from '../../utils/errors.js';

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
  constructor({ repository, inboundService, env = process.env } = {}) {
    this.repository = repository;
    this.inboundService = inboundService;
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
    if (body.provider_event_id || body.event_id) return buildDedupeKey([provider, normalized, body.provider_event_id || body.event_id]);
    return buildDedupeKey([provider, normalized, stableHash(body).slice(0, 32)]);
  }

  extractDeliveryReceipts(provider, channel, body = {}) {
    const normalizedProvider = String(provider || '').toLowerCase();
    const normalized = normalizeChannel(channel) || channel;
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
    return { notificationId, messageId, providerMessageId: receipt.providerMessageId, status: receipt.status };
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
      await this.repository.updateById('webhook_logs', existing.id, {
        processing_status: 'duplicate',
        attempt_count: Number(existing.attempt_count || 0) + 1,
        processed_at: nowIso(),
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
      throw new ForbiddenError('Webhook verification failed.');
    }

    try {
      const receipts = this.extractDeliveryReceipts(provider, normalized, body);
      const receiptResults = [];
      for (const receipt of receipts) {
        receiptResults.push(await this.applyDeliveryReceipt(receipt));
      }
      if (receiptResults.length > 0 && ['sendgrid', 'twilio', 'expo', 'cloudflare'].includes(String(provider || '').toLowerCase())) {
        await this.repository.updateById('webhook_logs', log.id, {
          processing_status: 'processed',
          message_count: 0,
          processed_at: nowIso(),
        });
        return { success: true, duplicate: false, webhook_log_id: log.id, count: 0, receipt_count: receiptResults.length, results: [], receipts: receiptResults };
      }
      const results = [];
      if (String(provider || '').toLowerCase() === 'cloudflare' && normalized === 'email' && (body.event || body.message_id || body.envelope)) {
        results.push(await this.handleCloudflareEmailWebhook(body, actor));
      } else {
        const parsed = parseChannelPayload(normalized, body);
        for (const message of parsed) {
          results.push(await this.inboundService.ingest({
            channel: normalized,
            provider,
            text: message.text,
            externalSenderId: message.sender_id,
            externalConversationId: message.conversation_id,
            providerMessageId: message.message_id,
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
      return { success: true, duplicate: false, webhook_log_id: log.id, count: results.length, receipt_count: receiptResults.length, results, receipts: receiptResults };
    } catch (error) {
      await this.repository.updateById('webhook_logs', log.id, {
        processing_status: 'failed',
        error_code: error.code || 'processing_failed',
        error_message: error.message,
        processed_at: nowIso(),
      });
      throw error;
    }
  }
}
