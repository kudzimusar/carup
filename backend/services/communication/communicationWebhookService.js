import crypto from 'crypto';
import { parseChannelPayload } from '../referral/referralChannelPayloadParsers.js';
import { buildDedupeKey, normalizeChannel, redactPayload, stableHash, nowIso } from './communicationUtils.js';

export class CommunicationWebhookService {
  constructor({ repository, inboundService, env = process.env } = {}) {
    this.repository = repository;
    this.inboundService = inboundService;
    this.env = env;
  }

  verify(provider, channel, { headers = {}, query = {}, rawBody = '', body = {} } = {}) {
    const normalized = normalizeChannel(channel) || channel;
    if (provider === 'telegram' || normalized === 'telegram') {
      const expected = this.env.CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN || this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
      return Boolean(expected && headers['x-telegram-bot-api-secret-token'] === expected);
    }
    if (provider === 'meta' || ['whatsapp', 'facebook', 'instagram'].includes(normalized)) {
      if (query['hub.mode'] === 'subscribe') {
        const expected = this.env.CARUP_META_WEBHOOK_VERIFY_TOKEN || this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
        return Boolean(expected && query['hub.verify_token'] === expected);
      }
      const appSecret = this.env.CARUP_META_APP_SECRET;
      const signature = headers['x-hub-signature-256'];
      if (appSecret && signature && rawBody) {
        const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      }
      const shared = this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
      return Boolean(shared && (headers['x-channel-webhook-secret'] === shared || headers['x-carup-channel-secret'] === shared));
    }
    const shared = this.env.CARUP_CHANNEL_WEBHOOK_SECRET;
    return Boolean(shared && headers['x-channel-webhook-secret'] === shared) || Boolean(body?.test === true && this.env.NODE_ENV === 'test');
  }

  dedupeKey(provider, channel, body = {}) {
    const normalized = normalizeChannel(channel) || channel;
    if (normalized === 'telegram' && body.update_id) return buildDedupeKey([provider, normalized, body.update_id]);
    const metaMessageId = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
      || body.entry?.[0]?.messaging?.[0]?.message?.mid
      || body.entry?.[0]?.messaging?.[0]?.postback?.mid;
    if (metaMessageId) return buildDedupeKey([provider, normalized, metaMessageId]);
    if (body.provider_event_id || body.event_id) return buildDedupeKey([provider, normalized, body.provider_event_id || body.event_id]);
    return buildDedupeKey([provider, normalized, stableHash(body).slice(0, 32)]);
  }

  async handleWebhook(provider, channel, body = {}, { headers = {}, query = {}, actor = {}, rawBody = '' } = {}) {
    const normalized = normalizeChannel(channel);
    if (!normalized) throw new Error('Unsupported webhook channel.');
    const signatureValid = this.verify(provider, normalized, { headers, query, rawBody, body });
    const dedupeKey = this.dedupeKey(provider, normalized, body);
    const payloadHash = stableHash(body);

    const existing = await this.repository.findOne('webhook_logs', { dedupe_key: dedupeKey });
    if (existing) {
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
      const err = new Error('Webhook verification failed.');
      err.statusCode = 403;
      throw err;
    }

    try {
      const parsed = parseChannelPayload(normalized, body);
      const results = [];
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
      await this.repository.updateById('webhook_logs', log.id, {
        processing_status: 'processed',
        message_count: results.length,
        processed_at: nowIso(),
      });
      return { success: true, duplicate: false, webhook_log_id: log.id, count: results.length, results };
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

