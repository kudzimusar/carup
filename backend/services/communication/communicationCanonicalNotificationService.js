import { CLASSIFICATION_SOURCES } from './emailExperience/emailClassification.js';
import { CommunicationNotificationService, classificationMetadata, withClassification } from './communicationNotificationService.js';
import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';
import { logCommunicationAuditEvent } from './communicationAuditLog.js';

const TERMINAL_SUCCESS = new Set(['delivered', 'read']);

function uniqueChannels(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeChannel).filter(Boolean))];
}

function routeAddressPayload(channel, address, identity = {}) {
  const payload = {
    address,
    external_id: identity.external_id || null,
  };
  if (channel === 'whatsapp' || channel === 'sms') payload.phone_number = address;
  if (channel === 'email') payload.email = address;
  if (channel === 'telegram') payload.telegram_chat_id = identity.external_id || address;
  return payload;
}

/**
 * Canonical notification implementation that renders event-driven notifications from
 * the governed DB template registry when available and treats fallback channels as an
 * ordered recovery sequence rather than a broadcast list.
 *
 * The inherited queue/retry/provider infrastructure remains unchanged.
 */
export class CommunicationCanonicalNotificationService extends CommunicationNotificationService {
  async queueFromDomainEvent(event = {}) {
    const eventType = event.event_type || event.eventType;
    const payload = event.payload || event;
    const policy = this.getPolicy(eventType);
    const recipientUserId = this.recipientFromPayload(payload);
    if (!recipientUserId) return [];

    const { thread } = await this.threadService.resolveOrCreateThread({
      tenant_id: event.tenant_id || payload.tenant_id || null,
      thread_type: policy.threadType,
      subject_type: payload.subject_type || policy.threadType,
      subject_id: payload.inquiryId || payload.inquiry_id || payload.escrowId || payload.applicationId || payload.vin || null,
      primary_user_id: recipientUserId,
      primary_channel: 'in_app',
      priority: policy.priority,
      marketplace_listing_id: payload.listingId || payload.listing_id || payload.vin || null,
      escrow_id: payload.escrowId || payload.escrow_id || null,
      financing_application_id: payload.applicationId || payload.application_id || null,
      metadata: { event_type: eventType },
    });

    const prefs = await this.preferenceService.getPreferences(recipientUserId, thread.tenant_id);
    const routeSequence = this.preferenceService.selectChannels(prefs, policy);
    if (!routeSequence.length) return [];

    const [primaryChannel, ...fallbackChannels] = routeSequence;
    const queued = await this.queueNotification({
      recipientUserId,
      thread,
      eventId: event.id || event.event_id || null,
      notificationType: policy.notificationType,
      channel: primaryChannel,
      templateKey: policy.templateKey,
      variables: this.variablesForEvent(eventType, payload),
      priority: policy.priority,
      transactional: policy.transactional,
      // G2 — the canonical classification travels with the notification. This subclass
      // reimplements queueNotification rather than delegating, so it has to carry it itself; a base
      // class that looks correct is not the code that runs.
      classification: policy.classification || null,
      classificationSource: CLASSIFICATION_SOURCES.POLICY,
      fallbackChannels,
      quietHoursBypass: policy.quietHoursBypass,
      dedupeParts: [
        eventType,
        event.id || event.dedupe_key || event.event_id || payload.id || payload.inquiryId || payload.escrowId || payload.applicationId,
        recipientUserId,
        policy.templateKey,
        primaryChannel,
      ],
      payload: {
        event_type: eventType,
        safe_payload: payload,
        communication_routing: {
          primary_channel: primaryChannel,
          fallback_channels: fallbackChannels,
          routing_mode: 'single_primary_with_ordered_fallback',
        },
      },
    });

    return [queued];
  }

  async queueNotification(input = {}) {
    const channel = normalizeChannel(input.channel) || 'in_app';
    const rendered = await this.templateService.render(
      input.templateKey || 'message_acknowledgement_v1',
      input.variables || {},
      { channel, language: input.language || 'en' },
    );
    const thread = input.thread || (await this.threadService.resolveOrCreateThread({
      thread_type: input.threadType || 'general',
      primary_user_id: input.recipientUserId,
      primary_channel: channel,
    })).thread;
    // A governed template declares its own classification in `communication_templates`. When a
    // producer supplied none, that declaration IS the canonical answer — it is a registered,
    // approval-gated value, not an inference.
    if (!input.classification && rendered.classification) {
      input = { ...input, classification: rendered.classification, classificationSource: CLASSIFICATION_SOURCES.GOVERNED_TEMPLATE };
    }
    const dedupeKey = buildDedupeKey(input.dedupeParts || [thread.id, input.notificationType, input.recipientUserId, channel, input.templateKey]);
    const existingNotification = await this.repository.findOne('notification_queue', { dedupe_key: dedupeKey });
    if (existingNotification) {
      const existingMessage = existingNotification.message_id
        ? await this.repository.findOne('messages', { id: existingNotification.message_id })
        : null;
      return { notification: existingNotification, message: existingMessage, thread };
    }

    const originalThread = {
      status: thread.status || null,
      last_message_at: thread.last_message_at || null,
      updated_at: thread.updated_at || null,
    };
    const fallbackChannels = uniqueChannels(input.fallbackChannels);
    const message = await this.threadService.recordMessage(thread, {
      direction: 'outbound',
      channel,
      provider: input.provider || null,
      content_text: rendered.body,
      content_json: {
        subject: rendered.subject,
        template_key: rendered.templateKey,
        template_id: rendered.templateId || null,
        template_version_id: rendered.templateVersionId || null,
        template_version: rendered.version || null,
        governed_template: Boolean(rendered.governed),
        provider_template_reference: rendered.providerTemplateReference || null,
        data: rendered.data,
        routing: {
          primary_channel: channel,
          fallback_channels: fallbackChannels,
        },
      },
      status: 'queued',
      ai_generated: Boolean(input.aiGenerated),
      human_approved: Boolean(input.humanApproved),
      thread_status: thread.status,
    });
    const notificationRow = {
      tenant_id: thread.tenant_id || null,
      recipient_id: input.recipientUserId,
      recipient_user_id: input.recipientUserId,
      recipient_identity_id: input.recipientIdentityId || null,
      thread_id: thread.id,
      message_id: message.id,
      event_id: input.eventId || null,
      type: input.notificationType || 'general',
      notification_type: input.notificationType || 'general',
      title: rendered.subject,
      message: rendered.body,
      channel,
      provider: input.provider || null,
      template_key: input.templateKey || rendered.templateKey,
      payload: withClassification(input.payload, input.classification),
      priority: input.priority || 'normal',
      status: 'queued',
      dedupe_key: dedupeKey,
      scheduled_at: input.scheduledAt || nowIso(),
      next_attempt_at: input.nextAttemptAt || null,
      attempt_count: 0,
      max_attempts: input.maxAttempts || Number(process.env.COMMUNICATION_MAX_ATTEMPTS || 5),
      read: false,
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: classificationMetadata({
        transactional: input.transactional !== false,
        governed_template: Boolean(rendered.governed),
        template_id: rendered.templateId || null,
        template_version_id: rendered.templateVersionId || null,
        template_version: rendered.version || null,
        fallback_channels: fallbackChannels,
        attempted_channels: [channel],
        quiet_hours_bypass: Boolean(input.quietHoursBypass),
        routing_mode: fallbackChannels.length
          ? 'single_primary_with_ordered_fallback'
          : 'single_route',
      }, input.payload, input.classification, input.classificationSource),
    };
    if (input.id) notificationRow.id = input.id;
    try {
      const notification = await this.insertNotificationIdempotently(notificationRow);
      if (notification.message_id && notification.message_id !== message.id) {
        await this.repository.deleteById?.('messages', message.id).catch(() => null);
        await this.repository.updateById('message_threads', thread.id, originalThread).catch(() => null);
        const existingMessage = await this.repository.findOne('messages', { id: notification.message_id });
        return { notification, message: existingMessage, thread };
      }
      return { notification, message, thread, governed_template: Boolean(rendered.governed) };
    } catch (error) {
      await this.repository.deleteById?.('messages', message.id).catch(() => null);
      await this.repository.updateById('message_threads', thread.id, originalThread).catch(() => null);
      throw error;
    }
  }

  async queueExistingMessage(input = {}) {
    const result = await super.queueExistingMessage(input);
    const fallbackChannels = uniqueChannels(input.fallbackChannels);
    const extraMetadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
    if (!fallbackChannels.length && !Object.keys(extraMetadata).length) return result;

    const existingMetadata = result.notification?.metadata || {};
    const channel = normalizeChannel(result.notification?.channel || input.channel);
    const updated = await this.repository.updateById('notification_queue', result.notification.id, {
      metadata: {
        ...existingMetadata,
        ...extraMetadata,
        fallback_channels: fallbackChannels,
        attempted_channels: uniqueChannels([...(existingMetadata.attempted_channels || []), channel]),
        routing_mode: fallbackChannels.length
          ? 'single_primary_with_ordered_fallback'
          : existingMetadata.routing_mode || 'single_route',
      },
      updated_at: nowIso(),
    });
    return { ...result, notification: updated || result.notification };
  }

  async resolveFallbackRoute(notification, channel, thread) {
    const recipientUserId = notification.recipient_user_id || notification.recipient_id || null;
    if (channel === 'in_app') {
      if (!recipientUserId) return null;
      return { recipientUserId, recipientIdentityId: null, provider: null, payload: {} };
    }

    const metadata = notification.metadata || {};
    let participant = null;
    if (metadata.recipient_participant_id) {
      participant = await this.repository.findOne('message_participants', {
        id: metadata.recipient_participant_id,
        thread_id: thread.id,
      }).catch(() => null);
    }
    if (!participant && recipientUserId) {
      participant = await this.repository.findOne('message_participants', {
        thread_id: thread.id,
        user_id: recipientUserId,
      }).catch(() => null);
    }

    if (participant) {
      const bindings = (await this.repository.list('conversation_channel_bindings', {
        thread_id: thread.id,
        participant_id: participant.id,
      }).catch(() => []))
        .filter((binding) => normalizeChannel(binding.channel) === channel)
        .filter((binding) => binding.can_send !== false && binding.transactional_consent === true)
        .filter((binding) => !binding.expires_at || Date.parse(binding.expires_at) > Date.now())
        .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
          || (Date.parse(b.last_used_at || b.updated_at || b.created_at || 0) || 0)
          - (Date.parse(a.last_used_at || a.updated_at || a.created_at || 0) || 0));
      const binding = bindings[0] || null;
      if (binding?.channel_identity_id) {
        const identity = await this.repository.findOne('channel_identities', { id: binding.channel_identity_id }).catch(() => null);
        if (identity && !['opted_out', 'revoked'].includes(identity.consent_status)) {
          const address = identity.normalized_address || identity.external_id;
          if (address) {
            return {
              recipientUserId: recipientUserId || participant.user_id || null,
              recipientIdentityId: identity.id,
              provider: binding.provider || identity.provider || null,
              payload: {
                ...routeAddressPayload(channel, address, identity),
                external_conversation_id: binding.external_conversation_id || null,
              },
            };
          }
        }
      }
    }

    // For a CarUp account's own governed notification, an enabled email/phone
    // preference may fall back to the account profile when no conversation binding
    // exists. External-contact conversations still require an explicit channel identity.
    if (recipientUserId) {
      const user = await this.repository.findOne('users', { id: recipientUserId }).catch(() => null);
      const address = channel === 'email'
        ? user?.email
        : (channel === 'sms' || channel === 'whatsapp' ? user?.phone : null);
      if (address) {
        return {
          recipientUserId,
          recipientIdentityId: null,
          provider: null,
          payload: routeAddressPayload(channel, address, { external_id: address }),
        };
      }
    }

    const payload = notification.payload || {};
    const address = channel === 'email'
      ? payload.email
      : (channel === 'sms' || channel === 'whatsapp'
        ? (payload.phone_number || payload.phone || payload.address)
        : (channel === 'telegram' ? (payload.telegram_chat_id || payload.external_id) : null));
    if (!address && channel !== 'push') return null;
    if (channel === 'push' && !(payload.expo_push_token || payload.push_token)) return null;

    return {
      recipientUserId,
      recipientIdentityId: notification.recipient_identity_id || null,
      provider: null,
      payload: {},
    };
  }

  async queueNextFallback(notification = {}, context = {}) {
    if (!notification?.id || !notification?.message_id || !notification?.thread_id) {
      return { queued: false, exhausted: true, reason: 'missing_notification_context' };
    }

    const metadata = notification.metadata || {};
    if (metadata.fallback_child_notification_id) {
      const child = await this.repository.findOne('notification_queue', {
        id: metadata.fallback_child_notification_id,
      }).catch(() => null);
      if (child) {
        const childStatus = String(child.status || '').toLowerCase();
        if (TERMINAL_SUCCESS.has(childStatus)) {
          return { queued: false, exhausted: false, delivered: true, notification: child, channel: child.channel, idempotent: true };
        }
        if (['queued', 'processing', 'retry_scheduled', 'sent', 'accepted'].includes(childStatus)) {
          return { queued: true, exhausted: false, notification: child, channel: child.channel, idempotent: true };
        }
        if (['failed', 'dead_letter', 'cancelled'].includes(childStatus)) {
          return this.queueNextFallback(child, { ...context, replayed_from_notification_id: notification.id });
        }
      }
    }

    const message = await this.repository.findOne('messages', { id: notification.message_id }).catch(() => null);
    const thread = await this.repository.findOne('message_threads', { id: notification.thread_id }).catch(() => null);
    if (!message || !thread) {
      return { queued: false, exhausted: true, reason: 'missing_canonical_message_or_thread' };
    }
    if (TERMINAL_SUCCESS.has(String(message.status || '').toLowerCase())) {
      return { queued: false, exhausted: false, skipped: true, reason: 'message_already_delivered' };
    }

    const rootNotificationId = metadata.fallback_root_notification_id || notification.id;
    const attempted = new Set(uniqueChannels([...(metadata.attempted_channels || []), notification.channel]));
    const remaining = uniqueChannels(metadata.fallback_channels).filter((channel) => !attempted.has(channel));
    const recipientKey = notification.recipient_user_id || notification.recipient_id || notification.recipient_identity_id || 'recipient';

    for (let index = 0; index < remaining.length; index += 1) {
      const channel = remaining[index];
      attempted.add(channel);
      const rest = remaining.slice(index + 1).filter((candidate) => !attempted.has(candidate));
      const route = await this.resolveFallbackRoute(notification, channel, thread);
      if (!route) {
        await logCommunicationAuditEvent(this.repository, {
          tenant_id: notification.tenant_id ?? null,
          thread_id: thread.id,
          message_id: message.id,
          notification_id: notification.id,
          event_type: 'fallback_skipped',
          actor_type: context.actor_type || 'worker',
          actor_id: context.actor_id || null,
          channel,
          summary: `Fallback ${channel} skipped: no governed recipient route`,
          metadata: { trigger: context.trigger || 'terminal_failure', reason: 'route_unavailable' },
        });
        continue;
      }

      const suppressionReason = await this.existingMessageSuppressionReason({
        thread,
        recipientUserId: route.recipientUserId,
        recipientIdentityId: route.recipientIdentityId,
        transactional: metadata.transactional !== false,
        quietHoursBypass: Boolean(metadata.quiet_hours_bypass),
        priority: notification.priority || thread.priority || 'normal',
      }, channel);
      if (suppressionReason) {
        await logCommunicationAuditEvent(this.repository, {
          tenant_id: notification.tenant_id ?? null,
          thread_id: thread.id,
          message_id: message.id,
          notification_id: notification.id,
          event_type: 'fallback_skipped',
          actor_type: context.actor_type || 'worker',
          actor_id: context.actor_id || null,
          channel,
          summary: `Fallback ${channel} skipped by communication policy`,
          metadata: { trigger: context.trigger || 'terminal_failure', reason: suppressionReason },
        });
        continue;
      }

      const dedupeKey = buildDedupeKey(['fallback', rootNotificationId, message.id, recipientKey, channel]);
      let next = await this.repository.findOne('notification_queue', { dedupe_key: dedupeKey }).catch(() => null);
      if (next) {
        const nextStatus = String(next.status || '').toLowerCase();
        if (TERMINAL_SUCCESS.has(nextStatus)) {
          return { queued: false, exhausted: false, delivered: true, notification: next, channel, idempotent: true };
        }
        if (['failed', 'dead_letter', 'cancelled'].includes(nextStatus)) {
          return this.queueNextFallback(next, { ...context, replayed_from_notification_id: notification.id });
        }
        if (['queued', 'processing', 'retry_scheduled', 'sent', 'accepted'].includes(nextStatus)) {
          return { queued: true, exhausted: false, notification: next, channel, idempotent: true };
        }
      }
      if (!next) {
        next = await this.insertNotificationIdempotently({
          tenant_id: notification.tenant_id || thread.tenant_id || null,
          recipient_id: route.recipientUserId || notification.recipient_id || null,
          recipient_user_id: route.recipientUserId || notification.recipient_user_id || null,
          recipient_identity_id: route.recipientIdentityId || null,
          thread_id: thread.id,
          message_id: message.id,
          event_id: notification.event_id || null,
          type: notification.type || notification.notification_type || 'general',
          notification_type: notification.notification_type || notification.type || 'general',
          title: notification.title || 'CarUp message',
          message: notification.message || message.content_text || '',
          channel,
          provider: route.provider || null,
          template_key: notification.template_key || null,
          payload: {
            ...(notification.payload || {}),
            ...(route.payload || {}),
            communication_routing: {
              primary_channel: channel,
              fallback_channels: rest,
              routing_mode: rest.length ? 'single_primary_with_ordered_fallback' : 'single_route',
              fallback_root_notification_id: String(rootNotificationId),
            },
          },
          priority: notification.priority || 'normal',
          status: 'queued',
          dedupe_key: dedupeKey,
          scheduled_at: nowIso(),
          next_attempt_at: null,
          attempt_count: 0,
          max_attempts: Number(notification.max_attempts || process.env.COMMUNICATION_MAX_ATTEMPTS || 5),
          read: false,
          created_at: nowIso(),
          updated_at: nowIso(),
          metadata: {
            ...metadata,
            source: 'automatic_fallback',
            fallback_root_notification_id: String(rootNotificationId),
            fallback_parent_notification_id: String(notification.id),
            fallback_depth: Number(metadata.fallback_depth || 0) + 1,
            fallback_channels: rest,
            attempted_channels: [...attempted],
            fallback_trigger: context.trigger || 'terminal_failure',
            fallback_error_code: context.errorCode || null,
            quiet_hours_bypass: Boolean(metadata.quiet_hours_bypass),
            routing_mode: rest.length ? 'single_primary_with_ordered_fallback' : 'single_route',
          },
        });
      }

      await this.repository.updateById('notification_queue', notification.id, {
        metadata: {
          ...metadata,
          fallback_child_notification_id: String(next.id),
          fallback_executed_at: nowIso(),
          fallback_trigger: context.trigger || 'terminal_failure',
        },
        updated_at: nowIso(),
      }).catch(() => null);

      await this.repository.updateById('messages', message.id, {
        status: 'queued',
        failed_at: null,
        content_json: {
          ...(message.content_json || {}),
          delivery_fallback: {
            root_notification_id: String(rootNotificationId),
            latest_notification_id: String(next.id),
            latest_channel: channel,
            trigger: context.trigger || 'terminal_failure',
          },
        },
      });

      await logCommunicationAuditEvent(this.repository, {
        tenant_id: notification.tenant_id ?? null,
        thread_id: thread.id,
        message_id: message.id,
        notification_id: next.id,
        event_type: 'fallback_queued',
        actor_type: context.actor_type || 'worker',
        actor_id: context.actor_id || null,
        channel,
        summary: `Automatic fallback queued on ${channel}`,
        metadata: {
          from_notification_id: String(notification.id),
          root_notification_id: String(rootNotificationId),
          trigger: context.trigger || 'terminal_failure',
          error_code: context.errorCode || null,
          remaining_fallback_channels: rest,
        },
      });

      return { queued: true, notification: next, channel, remaining: rest };
    }

    await logCommunicationAuditEvent(this.repository, {
      tenant_id: notification.tenant_id ?? null,
      thread_id: thread.id,
      message_id: message.id,
      notification_id: notification.id,
      event_type: 'fallback_exhausted',
      actor_type: context.actor_type || 'worker',
      actor_id: context.actor_id || null,
      channel: notification.channel || null,
      summary: 'Automatic delivery fallback exhausted',
      metadata: {
        trigger: context.trigger || 'terminal_failure',
        attempted_channels: [...attempted],
        error_code: context.errorCode || null,
      },
    });
    return { queued: false, exhausted: true, attempted_channels: [...attempted] };
  }
}
