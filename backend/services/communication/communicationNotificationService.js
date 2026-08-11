import { CommunicationTemplateService } from './communicationTemplateService.js';
import { CommunicationPreferenceService } from './communicationPreferenceService.js';
import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';

export const NOTIFICATION_POLICIES = Object.freeze({
  'marketplace.inquiry.created': {
    notificationType: 'marketplace_inquiry',
    threadType: 'marketplace_inquiry',
    priority: 'normal',
    channels: ['in_app', 'push', 'email'],
    fallbackChannels: ['whatsapp', 'sms'],
    templateKey: 'marketplace_inquiry_received_v1',
    transactional: true,
  },
  ESCROW_CREATED: {
    notificationType: 'escrow_status',
    threadType: 'escrow',
    priority: 'high',
    channels: ['in_app', 'push', 'email', 'whatsapp'],
    fallbackChannels: ['sms'],
    templateKey: 'escrow_status_v1',
    transactional: true,
    quietHoursBypass: true,
  },
  ESCROW_UPDATED: {
    notificationType: 'escrow_status',
    threadType: 'escrow',
    priority: 'high',
    channels: ['in_app', 'push', 'email', 'whatsapp'],
    fallbackChannels: ['sms'],
    templateKey: 'escrow_status_v1',
    transactional: true,
    quietHoursBypass: true,
  },
  'finance.application.status_changed': {
    notificationType: 'finance_status',
    threadType: 'finance',
    priority: 'high',
    channels: ['in_app', 'push', 'email'],
    fallbackChannels: ['sms'],
    templateKey: 'finance_status_v1',
    transactional: true,
  },
});

export class CommunicationNotificationService {
  constructor({ repository, threadService, templateService = null, preferenceService = null } = {}) {
    this.repository = repository;
    this.threadService = threadService;
    this.templateService = templateService || new CommunicationTemplateService();
    this.preferenceService = preferenceService || new CommunicationPreferenceService({ repository });
  }

  getPolicy(eventType, override = {}) {
    return { ...(NOTIFICATION_POLICIES[eventType] || {
      notificationType: 'general',
      threadType: 'general',
      priority: 'normal',
      channels: ['in_app'],
      fallbackChannels: ['email'],
      templateKey: 'message_acknowledgement_v1',
      transactional: true,
    }), ...override };
  }

  recipientFromPayload(payload = {}) {
    return payload.recipientUserId || payload.recipient_user_id || payload.userId || payload.user_id || payload.buyerId || payload.buyer_id || payload.sellerId || payload.seller_id || null;
  }

  variablesForEvent(eventType, payload = {}) {
    return {
      topic: payload.topic || payload.intent || eventType,
      listing_id: payload.listingId || payload.listing_id || payload.vin || 'listing',
      escrow_id: payload.escrowId || payload.escrow_id || 'escrow',
      status: payload.currentStatus || payload.status || payload.current_status || 'updated',
      application_id: payload.applicationId || payload.application_id || payload.id || 'application',
      reference: payload.publicReference || payload.reference || payload.escrowId || payload.applicationId || payload.inquiryId || 'CarUp',
      summary: payload.summary || '',
      team: payload.team || 'support',
      share_text: payload.shareText || payload.share_text || 'View this CarUp listing:',
      share_url: payload.shareUrl || payload.share_url || '',
      failed_channel: payload.failedChannel || '',
    };
  }

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
    const channels = this.preferenceService.selectChannels(prefs, policy);
    const queued = [];
    for (const channel of channels) {
      queued.push(await this.queueNotification({
        recipientUserId,
        thread,
        eventId: event.id || event.event_id || null,
        notificationType: policy.notificationType,
        channel,
        templateKey: policy.templateKey,
        variables: this.variablesForEvent(eventType, payload),
        priority: policy.priority,
        transactional: policy.transactional,
        dedupeParts: [eventType, event.id || event.dedupe_key || event.event_id || payload.id || payload.inquiryId || payload.escrowId || payload.applicationId, recipientUserId, policy.templateKey, channel],
        payload: { event_type: eventType, safe_payload: payload },
      }));
    }
    return queued;
  }

  async queueNotification(input = {}) {
    const channel = normalizeChannel(input.channel) || 'in_app';
    const rendered = this.templateService.render(input.templateKey || 'message_acknowledgement_v1', input.variables || {});
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
      content_json: { subject: rendered.subject, template_key: rendered.templateKey, data: rendered.data },
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
      metadata: { transactional: input.transactional !== false },
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
      return { notification, message, thread };
    } catch (error) {
      await this.repository.deleteById?.('messages', message.id).catch(() => null);
      await this.repository.updateById('message_threads', thread.id, originalThread).catch(() => null);
      throw error;
    }
  }

  async existingMessageSuppressionReason(input, channel) {
    const thread = input.thread;
    const transactional = input.transactional !== false;

    let participant = null;
    if (input.recipientUserId) {
      participant = await this.repository.findOne('message_participants', {
        thread_id: thread.id,
        user_id: input.recipientUserId,
      }).catch(() => null);
    } else if (input.recipientIdentityId) {
      participant = await this.repository.findOne('message_participants', {
        thread_id: thread.id,
        external_identity_id: input.recipientIdentityId,
      }).catch(() => null);
    }
    if (participant?.notification_muted && !input.quietHoursBypass) return 'participant_muted';

    if (input.recipientUserId) {
      const prefs = await this.preferenceService.getPreferences(input.recipientUserId, thread.tenant_id || null);
      if (transactional && prefs.transactional_enabled === false && !input.quietHoursBypass) {
        return 'transactional_disabled';
      }
      if (channel === 'in_app' && prefs.in_app_enabled === false) return 'in_app_disabled';
    }
    return null;
  }

  async queueExistingMessage(input = {}) {
    const message = input.message;
    const thread = input.thread;
    if (!message?.id || !thread?.id) throw new Error('Existing message and thread are required to queue delivery.');
    if (!input.recipientUserId && !input.recipientIdentityId) throw new Error('A recipient user or channel identity is required to queue delivery.');
    const channel = normalizeChannel(input.channel || message.channel || thread.primary_channel) || 'in_app';
    const recipientKey = input.recipientUserId || input.recipientIdentityId;
    const dedupeKey = buildDedupeKey(input.dedupeParts || ['message', message.id, recipientKey, channel]);
    const existingNotification = await this.repository.findOne('notification_queue', { dedupe_key: dedupeKey });
    if (existingNotification) return { notification: existingNotification, message, thread };

    const suppressionReason = await this.existingMessageSuppressionReason(input, channel);
    const notificationRow = {
      tenant_id: thread.tenant_id || null,
      recipient_id: input.recipientUserId || null,
      recipient_user_id: input.recipientUserId || null,
      recipient_identity_id: input.recipientIdentityId || null,
      thread_id: thread.id,
      message_id: message.id,
      event_id: input.eventId || null,
      type: input.notificationType || 'admin_reply',
      notification_type: input.notificationType || 'admin_reply',
      title: input.title || 'CarUp message',
      message: message.content_text || input.message || '',
      channel,
      provider: input.provider || message.provider || null,
      template_key: input.templateKey || 'admin_reply_v1',
      payload: input.payload || {},
      priority: input.priority || thread.priority || 'normal',
      status: suppressionReason ? 'suppressed' : 'queued',
      dedupe_key: dedupeKey,
      scheduled_at: input.scheduledAt || nowIso(),
      next_attempt_at: input.nextAttemptAt || null,
      attempt_count: 0,
      max_attempts: input.maxAttempts || Number(process.env.COMMUNICATION_MAX_ATTEMPTS || 5),
      read: false,
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: {
        transactional,
        source: 'existing_message',
        suppression_reason: suppressionReason,
      },
    };
    if (input.id) notificationRow.id = input.id;
    const notification = await this.insertNotificationIdempotently(notificationRow);
    return { notification, message, thread, suppressed: Boolean(suppressionReason), suppression_reason: suppressionReason };
  }

  async insertNotificationIdempotently(notificationRow) {
    try {
      return await this.repository.insert('notification_queue', notificationRow);
    } catch (error) {
      const duplicate = error?.code === '23505' || /duplicate key|idx_notification_queue_dedupe|dedupe/i.test(error?.message || '');
      if (!duplicate || !notificationRow.dedupe_key) throw error;
      const existing = await this.repository.findOne('notification_queue', { dedupe_key: notificationRow.dedupe_key });
      if (existing) return existing;
      throw error;
    }
  }

  async listNotificationsForUser(userId) {
    return this.repository.list('notification_queue', { recipient_user_id: userId }, { order: { column: 'created_at' }, limit: 100 });
  }
}
