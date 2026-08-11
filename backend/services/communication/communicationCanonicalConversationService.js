import { CommunicationConversationService } from './communicationConversationService.js';
import { normalizeChannel, nowIso } from './communicationUtils.js';

const READ_PERMISSION = 'read';

function canRead(participant = {}) {
  return participant.permissions?.[READ_PERMISSION] !== false;
}

function bindingTime(binding = {}) {
  return Date.parse(binding.last_used_at || binding.updated_at || binding.created_at || 0) || 0;
}

/**
 * Communications 2.0 invariant hardening over the canonical conversation service.
 *
 * This is deliberately a drop-in implementation of the SAME conversation domain:
 * same tables, same routes, same messages, same notification worker and provider
 * adapters. It tightens projection/read-state and routing accounting without creating
 * a second chat service or feature-specific silo.
 */
export class CommunicationCanonicalConversationService extends CommunicationConversationService {
  async listConversationsForUser(userId) {
    const conversations = await super.listConversationsForUser(userId);
    return Promise.all(conversations.map(async (conversation) => {
      const thread = await this.repository.findOne('message_threads', { id: conversation.id });
      return {
        ...conversation,
        conversation_type: thread?.conversation_type || conversation.conversation_type || conversation.thread_type,
      };
    }));
  }

  async getConversation(threadId, actor = {}) {
    const detail = await super.getConversation(threadId, actor);
    const thread = await this.repository.findOne('message_threads', { id: threadId });

    const readParticipant = await this.markRead(threadId, actor).catch(() => null);
    return {
      ...detail,
      thread: {
        ...detail.thread,
        conversation_type: thread?.conversation_type || detail.thread.conversation_type || detail.thread.thread_type,
      },
      read_at: readParticipant?.last_read_at || null,
    };
  }

  async routeMessage(thread, senderParticipant, message) {
    const recipients = (await this.activeParticipants(thread.id))
      .filter((participant) => participant.id !== senderParticipant.id)
      .filter(canRead)
      .filter((participant) => !['system', 'agent'].includes(participant.participant_type));

    const deliveries = [];
    const suppressions = [];

    for (const recipient of recipients) {
      const bindings = (await this.repository.list('conversation_channel_bindings', {
        thread_id: thread.id,
        participant_id: recipient.id,
      }))
        .filter((binding) => binding.can_send !== false && binding.transactional_consent === true)
        .filter((binding) => !binding.expires_at || Date.parse(binding.expires_at) > Date.now())
        .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || bindingTime(b) - bindingTime(a));

      if (recipient.user_id) {
        const queued = await this.notificationService.queueExistingMessage({
          message,
          thread,
          recipientUserId: recipient.user_id,
          channel: 'in_app',
          notificationType: 'conversation_message',
          title: 'New CarUp message',
          transactional: true,
          dedupeParts: ['conversation-message', message.id, recipient.id, 'in_app'],
          payload: { thread_id: thread.id, business_workflow: thread.business_workflow || thread.thread_type },
          metadata: { recipient_participant_id: recipient.id },
        });
        const result = {
          channel: 'in_app',
          recipient_participant_id: recipient.id,
          notification_id: queued.notification.id,
          suppressed: Boolean(queued.suppressed),
          suppression_reason: queued.suppression_reason || null,
        };
        (queued.suppressed ? suppressions : deliveries).push(result);
      }

      const binding = bindings[0] || null;
      if (!binding || binding.channel === 'in_app') continue;
      const identity = await this.repository.findOne('channel_identities', { id: binding.channel_identity_id });
      if (!identity || identity.consent_status === 'opted_out' || identity.consent_status === 'revoked') continue;
      const address = identity.normalized_address || identity.external_id;
      const payload = {
        thread_id: thread.id,
        business_workflow: thread.business_workflow || thread.thread_type,
        external_conversation_id: binding.external_conversation_id || null,
        address,
        external_id: identity.external_id,
      };
      if (binding.channel === 'whatsapp' || binding.channel === 'sms') payload.phone_number = address;
      if (binding.channel === 'email') payload.email = address;
      if (binding.channel === 'telegram') payload.telegram_chat_id = identity.external_id;

      const fallbackChannels = [...new Set(bindings
        .slice(1)
        .map((candidate) => normalizeChannel(candidate.channel))
        .filter((channel) => channel && channel !== 'in_app' && channel !== normalizeChannel(binding.channel)))];

      const queued = await this.notificationService.queueExistingMessage({
        message,
        thread,
        recipientUserId: recipient.user_id || null,
        recipientIdentityId: identity.id,
        channel: normalizeChannel(binding.channel),
        provider: binding.provider || identity.provider || null,
        notificationType: 'conversation_message',
        title: 'CarUp conversation',
        transactional: true,
        dedupeParts: ['conversation-message', message.id, recipient.id, binding.channel, identity.id],
        payload,
        fallbackChannels,
        metadata: { recipient_participant_id: recipient.id },
      });
      const result = {
        channel: binding.channel,
        recipient_participant_id: recipient.id,
        notification_id: queued.notification.id,
        suppressed: Boolean(queued.suppressed),
        suppression_reason: queued.suppression_reason || null,
      };

      if (queued.suppressed) {
        suppressions.push(result);
        continue;
      }

      deliveries.push(result);
      await this.repository.updateById('conversation_channel_bindings', binding.id, {
        last_outbound_message_id: message.id,
        last_used_at: nowIso(),
        updated_at: nowIso(),
      });
    }

    if (deliveries.length === 0 && suppressions.length > 0) {
      await this.repository.updateById('messages', message.id, {
        status: 'suppressed',
        content_json: {
          ...(message.content_json || {}),
          delivery_suppressed: true,
          suppression_reasons: [...new Set(suppressions.map((entry) => entry.suppression_reason).filter(Boolean))],
        },
      });
    }

    Object.defineProperty(deliveries, 'suppressions', {
      value: suppressions,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return deliveries;
  }
}
