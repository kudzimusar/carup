import { createDefaultAdapterRegistry } from './adapters/providerAdapters.js';
import { COMMUNICATION_EVENTS, calculateBackoffMs, classifyError, nowIso } from './communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';

export class CommunicationDeliveryWorker {
  constructor({ repository, adapterRegistry = null, notificationService = null, workerId = 'communication-worker' } = {}) {
    this.repository = repository;
    this.adapterRegistry = adapterRegistry || createDefaultAdapterRegistry();
    this.notificationService = notificationService;
    this.workerId = workerId;
  }

  auditNotification(notification, eventType, extra = {}) {
    return logCommunicationAuditEvent(this.repository, {
      tenant_id: notification.tenant_id ?? null,
      thread_id: notification.thread_id ?? null,
      message_id: notification.message_id ?? null,
      notification_id: notification.id,
      channel: notification.channel ?? null,
      actor_type: 'worker',
      actor_id: this.workerId,
      event_type: eventType,
      ...extra,
    });
  }

  async processDueNotifications({ limit = 10 } = {}) {
    const rows = typeof this.repository.claimDueNotifications === 'function'
      ? await this.repository.claimDueNotifications({
        workerId: this.workerId,
        limit,
        staleAfterSeconds: Number(process.env.COMMUNICATION_PROCESSING_STALE_SECONDS || 900),
      })
      : (await this.repository.list('notification_queue', {}, { order: { column: 'scheduled_at', ascending: true }, limit: 200 }))
        .filter((row) => ['queued', 'retry_scheduled'].includes(String(row.status || '').toLowerCase()))
        .filter((row) => !row.next_attempt_at || new Date(row.next_attempt_at) <= new Date())
        .slice(0, limit);
    const results = [];
    for (const notification of rows) {
      results.push(await this.deliverNotification(notification, { alreadyClaimed: true }));
    }
    return results;
  }

  async deliverNotification(notification, { alreadyClaimed = false } = {}) {
    const channel = notification.channel || 'in_app';
    const adapter = this.adapterRegistry.get(channel);
    if (!adapter) {
      return this.markDeadLetter(notification, { errorCode: 'adapter_missing', errorMessage: `No adapter registered for ${channel}` });
    }

    const attemptNumber = alreadyClaimed ? Number(notification.attempt_count || 1) : Number(notification.attempt_count || 0) + 1;
    if (!alreadyClaimed) {
      await this.repository.updateById('notification_queue', notification.id, {
        status: 'processing',
        locked_at: nowIso(),
        locked_by: this.workerId,
        attempt_count: attemptNumber,
      });
    }
    await this.auditNotification(notification, COMMUNICATION_AUDIT_EVENTS.QUEUE_CLAIMED, { summary: `Queue claimed (attempt ${attemptNumber})`, metadata: { attempt: attemptNumber, already_claimed: alreadyClaimed } });

    const startedAt = nowIso();
    let result;
    try {
      result = await adapter.send({
        notificationId: String(notification.id),
        messageId: String(notification.message_id),
        recipient: {
          userId: notification.recipient_user_id || notification.recipient_id,
          identityId: notification.recipient_identity_id,
          address: notification.payload?.address || notification.payload?.to,
          email: notification.payload?.email,
          phoneNumber: notification.payload?.phone_number || notification.payload?.phone,
          externalId: notification.payload?.external_id,
          telegramChatId: notification.payload?.telegram_chat_id || notification.payload?.chat_id,
          expoPushToken: notification.payload?.expo_push_token || notification.payload?.push_token,
        },
        content: {
          subject: notification.title,
          body: notification.message || '',
          data: notification.payload || {},
        },
        idempotencyKey: notification.dedupe_key,
        correlationId: notification.event_id || notification.id,
      });
    } catch (error) {
      result = this.resultFromThrownError(error);
    }

    await this.repository.insert('message_delivery_attempts', {
      notification_id: String(notification.id),
      message_id: notification.message_id || null,
      attempt_number: attemptNumber,
      provider: adapter.provider || notification.provider || channel,
      channel,
      provider_request_id: result.providerRequestId || null,
      provider_message_id: result.providerMessageId || null,
      request_metadata: { idempotency_key: notification.dedupe_key },
      response_metadata: {
        provider_status: result.providerStatus || null,
        ...(result.provider_http_status != null ? { provider_http_status: result.provider_http_status } : {}),
        ...(result.provider_error_code != null ? { provider_error_code: result.provider_error_code } : {}),
        ...(result.provider_error_subcode != null ? { provider_error_subcode: result.provider_error_subcode } : {}),
        ...(result.provider_error_type != null ? { provider_error_type: result.provider_error_type } : {}),
        ...(result.provider_error_message != null ? { provider_error_message: result.provider_error_message } : {}),
        ...(result.provider_trace_id != null ? { provider_trace_id: result.provider_trace_id } : {}),
      },
      status: result.accepted ? 'sent' : 'failed',
      error_code: result.errorCode || null,
      error_message: result.errorMessage || null,
      started_at: startedAt,
      completed_at: nowIso(),
    });
    await this.auditNotification(notification, COMMUNICATION_AUDIT_EVENTS.DELIVERY_ATTEMPT, {
      summary: `Delivery attempt ${attemptNumber} → ${result.accepted ? 'accepted' : 'failed'}`,
      correlation_id: result.providerMessageId || result.providerRequestId || null,
      metadata: { attempt: attemptNumber, provider: adapter.provider || channel, accepted: Boolean(result.accepted), error_code: result.errorCode || null, provider_message_id: result.providerMessageId || null },
    });

    if (result.accepted) {
      await this.repository.updateById('notification_queue', notification.id, {
        status: result.providerStatus === 'delivered' ? 'delivered' : 'sent',
        sent_at: nowIso(),
        delivered_at: result.providerStatus === 'delivered' ? nowIso() : null,
        last_error_code: null,
        last_error_message: null,
        locked_at: null,
        locked_by: null,
      });
      if (notification.message_id) {
        await this.repository.updateById('messages', notification.message_id, {
          status: result.providerStatus === 'delivered' ? 'delivered' : 'sent',
          sent_at: nowIso(),
          delivered_at: result.providerStatus === 'delivered' ? nowIso() : null,
          provider_message_id: result.providerMessageId || null,
          failed_at: null,
        });
      }
      const receiptState = result.providerStatus === 'delivered' ? 'delivered' : 'sent';
      await this.auditNotification(notification, COMMUNICATION_AUDIT_EVENTS.DELIVERY_RECEIPT, {
        summary: `Provider ${receiptState}`, correlation_id: result.providerMessageId || null,
        metadata: { state: receiptState, provider_message_id: result.providerMessageId || null },
      });
      return { notificationId: notification.id, status: 'sent', event: COMMUNICATION_EVENTS.MESSAGE_SENT };
    }

    const errorClass = classifyError(result);
    if (errorClass === 'retryable' && attemptNumber < Number(notification.max_attempts || 5)) {
      const nextRetryAt = new Date(Date.now() + calculateBackoffMs(attemptNumber)).toISOString();
      await this.repository.updateById('notification_queue', notification.id, {
        status: 'retry_scheduled',
        next_attempt_at: nextRetryAt,
        last_error_code: result.errorCode || 'retryable_failure',
        last_error_message: result.errorMessage || 'Retryable delivery failure',
        locked_at: null,
        locked_by: null,
      });
      await this.auditNotification(notification, COMMUNICATION_AUDIT_EVENTS.RETRY_SCHEDULED, {
        summary: `Retry scheduled for ${nextRetryAt}`, metadata: { attempt: attemptNumber, next_retry_at: nextRetryAt, error_code: result.errorCode || null },
      });
      return { notificationId: notification.id, status: 'retry_scheduled', nextRetryAt };
    }

    return this.markDeadLetter(notification, result);
  }

  resultFromThrownError(error = {}) {
    const code = error.code || error.name || 'provider_exception';
    const retryable = error.retryable !== false;
    return {
      accepted: false,
      retryable,
      errorCode: String(code).toLowerCase(),
      errorMessage: error.message || 'Provider adapter threw during delivery',
      thrown: true,
    };
  }

  async markDeadLetter(notification, result = {}) {
    await this.repository.updateById('notification_queue', notification.id, {
      status: 'dead_letter',
      dead_lettered_at: nowIso(),
      last_error_code: result.errorCode || 'delivery_failed',
      last_error_message: result.errorMessage || 'Delivery failed permanently',
      locked_at: null,
      locked_by: null,
    });
    await this.auditNotification(notification, COMMUNICATION_AUDIT_EVENTS.DEAD_LETTERED, {
      summary: `Dead-lettered (${result.errorCode || 'delivery_failed'})`,
      metadata: { error_code: result.errorCode || 'delivery_failed', error_message: result.errorMessage || null },
    });

    let fallback = null;
    if (this.notificationService?.queueNextFallback) {
      try {
        fallback = await this.notificationService.queueNextFallback(notification, {
          trigger: 'worker_terminal_failure',
          errorCode: result.errorCode || 'delivery_failed',
          errorMessage: result.errorMessage || null,
          actor_type: 'worker',
          actor_id: this.workerId,
        });
      } catch (error) {
        await this.auditNotification(notification, 'fallback_orchestration_failed', {
          summary: 'Automatic fallback orchestration failed',
          metadata: { error: error?.message || 'unknown fallback orchestration failure' },
        });
      }
    }

    if (fallback?.queued) {
      return {
        notificationId: notification.id,
        status: 'fallback_queued',
        fallbackNotificationId: fallback.notification?.id || null,
        fallbackChannel: fallback.channel || null,
        event: COMMUNICATION_EVENTS.NOTIFICATION_DEAD_LETTERED,
      };
    }

    if (notification.message_id) {
      await this.repository.updateById('messages', notification.message_id, {
        status: 'dead_letter',
        failed_at: nowIso(),
      });
    }
    return { notificationId: notification.id, status: 'dead_letter', event: COMMUNICATION_EVENTS.NOTIFICATION_DEAD_LETTERED };
  }

  async retryDeadLetter(notificationId, patch = {}) {
    return this.repository.updateById('notification_queue', notificationId, {
      ...patch,
      status: 'queued',
      next_attempt_at: null,
      locked_at: null,
      locked_by: null,
      dead_lettered_at: null,
      updated_at: nowIso(),
    });
  }

  async cancelDeadLetter(notificationId, reason = 'admin_cancelled') {
    return this.repository.updateById('notification_queue', notificationId, {
      status: 'cancelled',
      last_error_message: reason,
      updated_at: nowIso(),
    });
  }
}
