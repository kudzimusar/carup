import { createDefaultAdapterRegistry } from './adapters/providerAdapters.js';
import { COMMUNICATION_EVENTS, calculateBackoffMs, classifyError, normalizeChannel, nowIso } from './communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';
import { RECIPIENT_RESOLUTION_REASONS, resolveNotificationRecipient } from './emailExperience/recipientResolution.js';
import { renderEmailForNotification } from './emailExperience/renderEmail.js';
import {
  MARKETING_CONSENT_DISPOSITIONS,
  MARKETING_CONSENT_STATES,
  MARKETING_CONSENT_UNAVAILABLE_CODE,
  evaluateMarketingConsent,
} from './marketingConsentState.js';

/** Channels whose delivery requires an external address the platform must resolve. */
const ADDRESS_REQUIRED_CHANNELS = new Set(['email', 'sms', 'whatsapp']);

export class CommunicationDeliveryWorker {
  constructor({
    repository, adapterRegistry = null, notificationService = null,
    emailRenderer = null, replyTokenService = null, workerId = 'communication-worker',
  } = {}) {
    this.repository = repository;
    this.adapterRegistry = adapterRegistry || createDefaultAdapterRegistry();
    this.notificationService = notificationService;
    // G2 — the one canonical Email rendering boundary, injected so a test can substitute a failing
    // renderer and prove the degradation and refusal paths are real rather than asserted.
    this.emailRenderer = emailRenderer || renderEmailForNotification;
    // G5 — authenticated conversation Reply-To. Minted HERE, at the dispatch boundary, because this
    // is the only place where classification is proven, the recipient is resolved, the canonical
    // thread/participant context is present, and transport is about to happen.
    this.replyTokenService = replyTokenService;
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

    // G2 — prepare canonical content BEFORE dispatch, through the ONE rendering boundary.
    //
    // This replaced the G3 interim composer, which only ever produced marketing content. Every Email
    // family now passes through the same renderer, and non-email channels do not reach it at all —
    // an in_app or push notification has no presentation to render and must stay byte-identical to
    // what it was before G2.
    //
    // The renderer decides both directions of failure itself: non-marketing degrades to the
    // canonical plain text, marketing refuses. The worker's job is to honour a refusal without
    // calling a provider.
    let preparedSubject = notification.title;
    let preparedBody = notification.message || '';
    let preparedHtml = notification.payload?.html || null;
    let renderProvenance = null;
    if (channel === 'email') {
      const rendered = this.emailRenderer(notification, { env: process.env });
      if (!rendered.ok) {
        // A refusal here never reaches a provider. It is durable — an unclassified or
        // non-compliant Email does not become classified or compliant by being retried.
        return this.markDeadLetter(notification, {
          errorCode: rendered.errorCode,
          errorMessage: rendered.errorMessage,
        });
      }
      preparedSubject = rendered.subject || preparedSubject;
      preparedBody = rendered.text;
      preparedHtml = rendered.html || null;
      renderProvenance = {
        renderer_version: rendered.renderer_version,
        classification: rendered.classification,
        classification_source: rendered.classification_source,
        template_key: rendered.template_key,
        template_version: rendered.template_version,
        footer_family: rendered.footer_family,
        sender_persona: rendered.sender_persona,
        html_part_rendered: rendered.html_part_rendered,
        text_part_rendered: rendered.text_part_rendered,
        cta_href_canonical: rendered.cta_href_canonical,
        cta_route: rendered.cta_route,
        leadership_identity_rendered: rendered.leadership_identity_rendered,
        render_fallback_used: rendered.render_fallback_used,
      };
    }

    // G5 — an authenticated Reply-To for genuine conversational Email, and nothing else.
    //
    // A conversational Email without one is not a smaller failure than not sending it: it LOOKS
    // replyable and is not. That exact state was observed — a human replied to
    // notifications@mail.carup.dev, the message carried no token and no RFC reference, and their
    // reply was permanently unroutable. So this fails closed in every direction rather than
    // degrading to an address that swallows the answer.
    let replyToAddress = null;
    let replyTokenId = null;
    if (channel === 'email' && renderProvenance?.classification === 'conversational') {
      const context = {
        threadId: notification.thread_id || null,
        participantId: notification.metadata?.recipient_participant_id || null,
        tenantId: notification.tenant_id || null,
        // Only a binding that is itself an EMAIL binding. A fallback notification carries the
        // originating channel's binding in the same metadata, and an Email credential validated
        // against a WhatsApp binding is a credential validated against the wrong thing.
        bindingId: notification.metadata?.recipient_binding_channel === 'email'
          ? (notification.metadata?.recipient_binding_id || null)
          : null,
      };
      if (!this.replyTokenService) {
        return this.markDeadLetter(notification, {
          errorCode: 'reply_token_service_unavailable',
          errorMessage: 'Conversational Email requires an authenticated Reply-To and no reply-token service is wired.',
        });
      }
      // A NULL tenant is the platform tenant and is canonicalised by the token service; a missing
      // thread or participant is genuinely missing context.
      if (!context.threadId || !context.participantId) {
        // Durable: a missing canonical binding is not a fault that retrying can resolve, and
        // guessing the participant would defeat the credential entirely.
        return this.markDeadLetter(notification, {
          errorCode: 'conversation_reply_context_missing',
          errorMessage: 'Conversational Email has no canonical thread/participant/tenant context to bind an authenticated Reply-To to.',
        });
      }
      try {
        const issued = await this.replyTokenService.issue(context);
        replyToAddress = issued.address;
        replyTokenId = issued.record?.id || null;
      } catch (error) {
        const failure = {
          errorCode: error?.code === 'reply_token_secret_missing'
            ? 'reply_token_secret_missing'
            : 'reply_token_unavailable',
          errorMessage: error?.code === 'reply_token_secret_missing'
            ? 'Conversational Email cannot be given an authenticated Reply-To: the reply-token secret is not configured.'
            : `Conversational Email could not be given an authenticated Reply-To (${error?.message || 'token store failure'}).`,
        };
        // A missing secret is configuration, not weather. Everything else is a store fault worth
        // re-asking about. Neither reaches a provider.
        return error?.code === 'reply_token_secret_missing'
          ? this.markDeadLetter(notification, failure)
          : this.markRetry(notification, failure);
      }
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
          subject: preparedSubject,
          // `body` AND `text` both carry the renderer's final plain text. `textBody()` reads
          // `content.body || content.text`, so leaving `body` as the pre-render message would let an
          // adapter transmit the stale copy while the renderer's text went nowhere.
          body: preparedBody,
          text: preparedBody,
          ...(preparedHtml ? { html: preparedHtml } : {}),
          // EPHEMERAL. This object exists for the provider call and is never written back: the raw
          // Reply-To is a live routing credential, and the queue row, the canonical message and the
          // delivery attempt all keep only the hash or the record id.
          data: {
            ...(notification.payload || {}),
            ...(renderProvenance ? { email_render_provenance: renderProvenance } : {}),
            ...(replyToAddress ? { reply_to: replyToAddress } : {}),
          },
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
      // The token RECORD id, never the credential. It is enough to prove
      // attempt -> token -> thread/participant without the audit trail becoming replayable.
      request_metadata: {
        idempotency_key: notification.dedupe_key,
        ...(replyTokenId ? { email_reply_token_id: replyTokenId } : {}),
      },
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
