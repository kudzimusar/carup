import { CommunicationNotificationService } from './communicationNotificationService.js';
import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';

/**
 * Canonical notification implementation that renders event-driven notifications from
 * the governed DB template registry when available. The inherited preference/routing,
 * retry queue and provider worker remain unchanged.
 */
export class CommunicationCanonicalNotificationService extends CommunicationNotificationService {
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
