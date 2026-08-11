import { CommunicationNotificationService } from './communicationNotificationService.js';
import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';

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

    // Preserve the legacy array return contract while enforcing one initial route.
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
          fallback_channels: input.fallbackChannels || [],
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
      payload: input.payload || {},
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
      metadata: {
        transactional: input.transactional !== false,
        governed_template: Boolean(rendered.governed),
        template_id: rendered.templateId || null,
        template_version_id: rendered.templateVersionId || null,
        template_version: rendered.version || null,
        fallback_channels: input.fallbackChannels || [],
        quiet_hours_bypass: Boolean(input.quietHoursBypass),
        routing_mode: (input.fallbackChannels || []).length
          ? 'single_primary_with_ordered_fallback'
          : 'single_route',
      },
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
}
