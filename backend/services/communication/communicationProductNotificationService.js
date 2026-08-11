import { CommunicationCanonicalNotificationService } from './communicationCanonicalNotificationService.js';
import { normalizeChannel, nowIso } from './communicationUtils.js';

const DEFAULT_SESSION_HOURS = 24;

function asDateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Product-level notification policy layered over the canonical routing engine.
 * It keeps all existing retry/fallback/consent behavior and adds the Meta
 * customer-service-window rule for participant-authored WhatsApp messages.
 */
export class CommunicationProductNotificationService extends CommunicationCanonicalNotificationService {
  constructor(options = {}) {
    super(options);
    this.whatsappSessionHours = Number(
      options.whatsappSessionHours
      || process.env.COMMUNICATION_WHATSAPP_SESSION_HOURS
      || DEFAULT_SESSION_HOURS,
    );
  }

  async resolveWhatsappDeliveryPolicy(input = {}) {
    const thread = input.thread;
    const message = input.message;
    if (!thread?.id || !message?.id) {
      return { mode: 'template', reason: 'missing_thread_or_message', providerTemplateReference: null };
    }

    let participant = null;
    if (input.metadata?.recipient_participant_id) {
      participant = await this.repository.findOne('message_participants', {
        id: input.metadata.recipient_participant_id,
        thread_id: thread.id,
      }).catch(() => null);
    }
    if (!participant && input.recipientIdentityId) {
      participant = await this.repository.findOne('message_participants', {
        thread_id: thread.id,
        external_identity_id: input.recipientIdentityId,
      }).catch(() => null);
    }
    if (!participant && input.recipientUserId) {
      participant = await this.repository.findOne('message_participants', {
        thread_id: thread.id,
        user_id: input.recipientUserId,
      }).catch(() => null);
    }

    let binding = null;
    if (participant) {
      const bindings = await this.repository.list('conversation_channel_bindings', {
        thread_id: thread.id,
        participant_id: participant.id,
      }).catch(() => []);
      binding = bindings
        .filter((row) => normalizeChannel(row.channel) === 'whatsapp')
        .filter((row) => row.can_send !== false && row.transactional_consent === true)
        .sort((a, b) => asDateMs(b.last_used_at || b.updated_at) - asDateMs(a.last_used_at || a.updated_at))[0] || null;
    }

    if (binding?.last_inbound_message_id) {
      const inbound = await this.repository.findOne('messages', { id: binding.last_inbound_message_id }).catch(() => null);
      const inboundAt = asDateMs(inbound?.created_at);
      const windowMs = this.whatsappSessionHours * 60 * 60 * 1000;
      if (inboundAt > 0 && Date.now() - inboundAt <= windowMs) {
        return {
          mode: 'session',
          reason: 'customer_service_window_open',
          lastInboundAt: inbound.created_at,
          sessionExpiresAt: new Date(inboundAt + windowMs).toISOString(),
          providerTemplateReference: null,
        };
      }
    }

    const rendered = await this.templateService.render(
      'conversation_reply_whatsapp_v1',
      { message: message.content_text || '' },
      { channel: 'whatsapp', language: 'en' },
    );
    return {
      mode: 'template',
      reason: 'customer_service_window_closed_or_unproven',
      providerTemplateReference: rendered.providerTemplateReference || null,
      providerTemplateParameters: [message.content_text || ''],
      templateId: rendered.templateId || null,
      templateVersionId: rendered.templateVersionId || null,
    };
  }

  async existingMessageSuppressionReason(input, channel) {
    const baseReason = await super.existingMessageSuppressionReason(input, channel);
    if (baseReason) return baseReason;
    if (normalizeChannel(channel) !== 'whatsapp') return null;

    const policy = input.__whatsappPolicy || await this.resolveWhatsappDeliveryPolicy(input);
    input.__whatsappPolicy = policy;
    if (policy.mode === 'template' && !policy.providerTemplateReference) {
      return 'whatsapp_template_not_configured';
    }
    return null;
  }

  async queueExistingMessage(input = {}) {
    let enriched = input;
    let policy = null;
    if (normalizeChannel(input.channel || input.message?.channel || input.thread?.primary_channel) === 'whatsapp') {
      policy = await this.resolveWhatsappDeliveryPolicy(input);
      enriched = {
        ...input,
        __whatsappPolicy: policy,
        payload: {
          ...(input.payload || {}),
          whatsapp_delivery_mode: policy.mode,
          whatsapp_session_expires_at: policy.sessionExpiresAt || null,
          provider_template_reference: policy.providerTemplateReference || null,
          provider_template_parameters: policy.providerTemplateParameters || [],
        },
      };
    }

    const result = await super.queueExistingMessage(enriched);
    if (policy && result.notification?.id) {
      const updated = await this.repository.updateById('notification_queue', result.notification.id, {
        metadata: {
          ...(result.notification.metadata || {}),
          whatsapp_delivery_mode: policy.mode,
          whatsapp_policy_reason: policy.reason,
          whatsapp_template_id: policy.templateId || null,
          whatsapp_template_version_id: policy.templateVersionId || null,
          provider_template_configured: Boolean(policy.providerTemplateReference),
        },
        updated_at: nowIso(),
      }).catch(() => null);
      if (updated) result.notification = updated;
    }
    return result;
  }

  async queueNotification(input = {}) {
    const result = await super.queueNotification(input);
    if (normalizeChannel(input.channel) !== 'whatsapp' || !result.notification?.id) return result;

    const providerTemplateReference = result.message?.content_json?.provider_template_reference || null;
    // Domain/event-driven WhatsApp is business initiated unless we have explicit
    // participant/session evidence. Never infer a free-form customer-service window
    // merely because the governed template has not yet received a Meta reference.
    // The governed Meta adapter will fail closed locally when this reference is absent,
    // allowing the canonical fallback engine to advance without sending policy-unsafe text.
    const updated = await this.repository.updateById('notification_queue', result.notification.id, {
      payload: {
        ...(result.notification.payload || {}),
        provider_template_reference: providerTemplateReference,
        whatsapp_delivery_mode: 'template',
      },
      metadata: {
        ...(result.notification.metadata || {}),
        whatsapp_delivery_mode: 'template',
        whatsapp_policy_reason: providerTemplateReference
          ? 'governed_business_template'
          : 'business_template_required_but_not_configured',
        provider_template_configured: Boolean(providerTemplateReference),
      },
      updated_at: nowIso(),
    }).catch(() => null);
    if (updated) result.notification = updated;
    return result;
  }
}
