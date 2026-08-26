import { createDefaultAdapterRegistry } from './adapters/providerAdapters.js';
import { COMMUNICATION_EVENTS, calculateBackoffMs, classifyError, normalizeChannel, nowIso } from './communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';
import { RECIPIENT_RESOLUTION_REASONS, resolveNotificationRecipient } from './emailExperience/recipientResolution.js';
import { applyMarketingUnsubscribePresentation } from './emailExperience/marketingUnsubscribePresentation.js';
import {
  MARKETING_CONSENT_DISPOSITIONS,
  MARKETING_CONSENT_STATES,
  MARKETING_CONSENT_UNAVAILABLE_CODE,
  evaluateMarketingConsent,
} from './marketingConsentState.js';

/** Channels whose delivery requires an external address the platform must resolve. */
const ADDRESS_REQUIRED_CHANNELS = new Set(['email', 'sms', 'whatsapp']);

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

  /**
   * Canonical marketing consent, evaluated at SEND time against the G0-resolved address.
   *
   * Delegates to `marketingConsentState.js` — the single consent authority — and never decides
   * anything itself. Scoped to marketing (and 'all'): an unsubscribe from marketing must never block
   * security, auth or transactional Email.
   */
  async marketingConsentFor(notification, address) {
    return evaluateMarketingConsent({
      notification,
      repository: this.repository,
      channel: normalizeChannel(notification.channel) || notification.channel,
      address,
    });
  }

  async deliverNotification(notification, { alreadyClaimed = false } = {}) {
    const channel = notification.channel || 'in_app';
    const adapter = this.adapterRegistry.get(channel);
    if (!adapter) {
      return this.markDeadLetter(notification, { errorCode: 'adapter_missing', errorMessage: `No adapter registered for ${channel}` });
    }

    // G0 — resolve the recipient BEFORE dispatch.
    //
    // Policy-driven notifications carry only `{ event_type, safe_payload }`, so the adapter used to
    // hard-fail `recipient_missing` on the primary attempt and the message survived only via the
    // fallback route's enrichment. Producers keep passing identifiers; the address is resolved once,
    // here, immediately before the provider call.
    //
    // Fails CLOSED: an unresolved recipient never reaches a provider, and is recorded with its own
    // error code so it stays distinguishable from a provider failure.
    //
    // Scoped to channels that genuinely need an EXTERNAL address. `in_app` and `push` are delivered
    // without one — guarding them would dead-letter working deliveries, which an over-broad first
    // version of this check did.
    const resolved = ADDRESS_REQUIRED_CHANNELS.has(channel)
      ? await resolveNotificationRecipient({ notification, repository: this.repository, channel })
      : { ok: true, address: null, identityId: null, userId: null, verified: false };
    if (!resolved.ok) {
      const failure = {
        errorCode: `recipient_unresolved:${resolved.reason}`,
        errorMessage: `No deliverable ${channel} recipient could be resolved for this notification (${resolved.reason}).`,
      };
      // A lookup fault is transient — retry it. Everything else is a durable absence of an address,
      // which retrying cannot conjure, so it dead-letters instead of burning attempts.
      return resolved.reason === RECIPIENT_RESOLUTION_REASONS.LOOKUP_FAILED
        ? this.markRetry(notification, failure)
        : this.markDeadLetter(notification, failure);
    }
    // Carry the resolved address on the payload the adapter reads, without mutating the stored row.
    if (resolved.address) {
    const resolvedPayload = { ...(notification.payload || {}) };
    if (channel === 'email') resolvedPayload.email = resolved.address;
    else if (channel === 'sms' || channel === 'whatsapp') resolvedPayload.phone_number = resolved.address;
    else if (channel === 'telegram') resolvedPayload.telegram_chat_id = resolved.address;
    resolvedPayload.address = resolvedPayload.address || resolved.address;
    notification = { ...notification, payload: resolvedPayload };
    }

    // Last line of defence before a marketing message reaches a provider.
    //
    // Consent suppression is otherwise enforced only at QUEUE time, so anything that inserts into
    // notification_queue directly — a backfill, a script, a future code path — would sail past it and
    // mail somebody who has unsubscribed. That is the one failure mode a consent system must not
    // have, so the check is repeated here, immediately before dispatch, against canonical state.
    //
    // G3 — and it FAILS CLOSED. This call used to end in `.catch(() => null)`, which made a database
    // timeout, a dropped connection, a missing table and a revoked grant all indistinguishable from
    // "not suppressed". Every way of failing to KNOW whether someone had unsubscribed was converted
    // into permission to mail them. UNKNOWN CONSENT STATE IS NOT PERMISSION.
    const consent = await this.marketingConsentFor(notification, resolved.address);
    if (consent.state === MARKETING_CONSENT_STATES.SUPPRESSED) {
      return this.markDeadLetter(notification, {
        errorCode: 'recipient_suppressed',
        errorMessage: `Recipient is suppressed in canonical CarUp consent state (${consent.reason}); refusing to send marketing.`,
      });
    }
    if (consent.state === MARKETING_CONSENT_STATES.UNAVAILABLE) {
      // Reported as ITSELF, never folded into recipient_suppressed. Recording a fault of ours as a
      // customer's unsubscribe would put a decision in the audit trail that nobody made.
      const failure = {
        errorCode: `${MARKETING_CONSENT_UNAVAILABLE_CODE}:${consent.disposition}`,
        errorMessage: `Canonical marketing consent state could not be established (${consent.detail}); refusing to send marketing.`,
      };
      return consent.disposition === MARKETING_CONSENT_DISPOSITIONS.TRANSIENT
        ? this.markRetry(notification, failure)
        : this.markDeadLetter(notification, failure);
    }

    // Prepare compliant content BEFORE dispatch.
    //
    // G3 moved the visible unsubscribe control out of the Brevo adapter, which used to author it
    // inside the same function that called the provider. Composition belongs here, ahead of
    // transport, so the adapter can validate content it did not write. G2's canonical renderer
    // replaces this call site; the ordering it sits in does not change.
    //
    // Marketing only. A security, conversational, transactional or service Email must never acquire
    // a marketing unsubscribe footer merely because it shares a provider or a component.
    let preparedBody = notification.message || '';
    let preparedHtml = notification.payload?.html || null;
    let unsubscribePresentation = null;
    const classification = String(notification.payload?.classification || '').toLowerCase();
    if (classification === 'marketing' && notification.payload?.unsubscribe_url) {
      const presentation = applyMarketingUnsubscribePresentation({
        html: preparedHtml,
        text: preparedBody,
        unsubscribeUrl: notification.payload.unsubscribe_url,
      });
      if (presentation.ok) {
        preparedBody = presentation.text;
        preparedHtml = presentation.html;
        unsubscribePresentation = presentation.provenance;
      }
      // A composition that cannot produce a control is NOT silently sent: the adapter refuses
      // unfinished marketing content independently, so this needs no second refusal here.
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
          body: preparedBody,
          ...(preparedHtml ? { html: preparedHtml } : {}),
          data: unsubscribePresentation
            ? { ...(notification.payload || {}), unsubscribe_presentation: unsubscribePresentation }
            : (notification.payload || {}),
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
      // A routing adapter (e.g. the governed Email transport router) reports the transport it
      // actually used as `routedProvider`. Record THAT, not the router's own name: provider
      // lifecycle webhooks arrive stamped with the real provider, and reconciliation looks
      // attempts up by (provider, provider_message_id).
      provider: result.routedProvider || adapter.provider || notification.provider || channel,
      channel,
      provider_request_id: result.providerRequestId || null,
      provider_message_id: result.providerMessageId || null,
      request_metadata: { idempotency_key: notification.dedupe_key },
      response_metadata: {
        provider_status: result.providerStatus || null,
        ...(result.providerMetadata ? { provider_metadata: result.providerMetadata } : {}),
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
      metadata: { attempt: attemptNumber, provider: result.routedProvider || adapter.provider || channel, accepted: Boolean(result.accepted), error_code: result.errorCode || null, provider_message_id: result.providerMessageId || null },
    });

    if (result.accepted) {
      await this.repository.updateById('notification_queue', notification.id, {
        status: result.providerStatus === 'delivered' ? 'delivered' : 'sent',
        sent_at: nowIso(),
        // Never null a delivery timestamp that a provider receipt may already have set.
        ...(result.providerStatus === 'delivered' ? { delivered_at: nowIso() } : {}),
        last_error_code: null,
        last_error_message: null,
        locked_at: null,
        locked_by: null,
      });
      if (notification.message_id) {
        await this.repository.updateById('messages', notification.message_id, {
          status: result.providerStatus === 'delivered' ? 'delivered' : 'sent',
          sent_at: nowIso(),
          // Never null a delivery timestamp that a provider receipt may already have set.
          ...(result.providerStatus === 'delivered' ? { delivered_at: nowIso() } : {}),
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

  /**
   * Schedule a retry for a TRANSIENT pre-dispatch failure.
   *
   * Extracted so a fault that happened before the provider was ever called can use the same backoff
   * and audit trail as a retryable provider failure, instead of being dead-lettered as if the
   * condition were permanent.
   */
  async markRetry(notification, result = {}) {
    const attempt = Number(notification.attempt_count || 1);
    if (attempt >= Number(notification.max_attempts || 5)) return this.markDeadLetter(notification, result);
    const nextRetryAt = new Date(Date.now() + calculateBackoffMs(attempt)).toISOString();
    await this.repository.updateById('notification_queue', notification.id, {
      status: 'retry_scheduled',
      next_attempt_at: nextRetryAt,
      last_error_code: result.errorCode || 'retryable_failure',
      last_error_message: result.errorMessage || 'Retryable failure',
      locked_at: null,
      locked_by: null,
    });
    await this.auditNotification(notification, COMMUNICATION_AUDIT_EVENTS.RETRY_SCHEDULED, {
      summary: `Retry scheduled for ${nextRetryAt}`,
      metadata: { attempt, next_retry_at: nextRetryAt, error_code: result.errorCode || null },
    });
    return { notificationId: notification.id, status: 'retry_scheduled', nextRetryAt };
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
