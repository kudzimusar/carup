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
    const conversations = (await super.listConversationsForUser(userId))
      // Account/security notification threads are canonical activity records, not reply-capable
      // conversations. Keep them auditable but out of the ordinary user inbox.
      .filter((conversation) => conversation.thread_type !== 'account');
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
    const messageIds = (detail.messages || []).map((message) => message.id).filter(Boolean);
    const parts = messageIds.length
      ? await this.repository.list('message_parts', { message_id: messageIds }).catch(() => [])
      : [];
    const byMessage = new Map();
    for (const part of parts) {
      if (!byMessage.has(part.message_id)) byMessage.set(part.message_id, []);
      byMessage.get(part.message_id).push(part);
    }
    const messages = (detail.messages || []).map((message) => ({
      ...message,
      parts: (byMessage.get(message.id) || []).sort((a, b) => Number(a.part_index || 0) - Number(b.part_index || 0)),
    }));

    const readParticipant = await this.markRead(threadId, actor).catch(() => null);
    return {
      ...detail,
      thread: {
        ...detail.thread,
        conversation_type: thread?.conversation_type || detail.thread.conversation_type || detail.thread.thread_type,
      },
      messages,
      read_at: readParticipant?.last_read_at || null,
    };
  }

  async routeMessage(thread, senderParticipant, message, options = {}) {
    // The audience-safe listing summary, when a caller has one. Deliberately INJECTED rather than
    // fetched here: assembling it inside the conversation service would put a raw vehicle row one
    // property access away from an Email body, and the public projection exists precisely so that
    // cannot happen by accident.
    const marketplaceListingSummary = options.listingSummary && typeof options.listingSummary === 'object'
      ? options.listingSummary
      : null;
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
        // R3 — the canonical reference this conversation Email is rendered as.
        reference_template: 'marketplace_conversation',
        // Bounded, escaped at the HTML boundary, and never the full history. `content_text` is the
        // canonical message body; the renderer truncates it.
        message_excerpt: message.content_text || null,
        // `marketplace_listing_id` on a thread holds the VIN. The renderer uses it only to build a
        // public listing link; the audience-safe listing SUMMARY is attached by the caller when it
        // has one, and is never assembled from a raw vehicle row here.
        vin: thread.marketplace_listing_id || null,
        ...(marketplaceListingSummary ? { listing_summary: marketplaceListingSummary } : {}),
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
        // A message a human wrote, delivered to a human, inside a thread they can reply to. This is
        // the conversational family — the acknowledgement that a thread exists is not.
        classification: 'conversational',
        dedupeParts: ['conversation-message', message.id, recipient.id, binding.channel, identity.id],
        payload,
        fallbackChannels,
        // G5 — the exact canonical context the delivery worker needs to bind an authenticated
        // Reply-To. Both are known HERE and nowhere later; making the worker re-derive them would
        // mean guessing which participant an Email belongs to, which is the one thing an
        // authenticated reply address exists to prevent.
        metadata: {
          recipient_participant_id: recipient.id,
          recipient_binding_id: binding.id || null,
          // The binding's OWN channel travels with it. A notification that falls back from WhatsApp
          // to Email inherits this metadata wholesale, and binding an Email reply credential to a
          // WhatsApp binding would make the inbound resolver revalidate the wrong object.
          recipient_binding_channel: normalizeChannel(binding.channel) || null,
        },
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
