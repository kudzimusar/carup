import { CommunicationWebhookService } from './communicationWebhookService.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';
import { normalizeChannel, nowIso } from './communicationUtils.js';

/**
 * Communications 2.0 receipt-attribution and fallback hardening.
 *
 * Provider verification/parsing remains inherited unchanged from the proven
 * CommunicationWebhookService. Provider receipts must map to exactly one CarUp
 * delivery attempt; terminal provider failures may then advance the same message
 * through its ordered fallback sequence.
 */
export class CommunicationCanonicalWebhookService extends CommunicationWebhookService {
  constructor({
    repository, inboundService, inboundResolver = null, replyTokenService = null,
    notificationService = null, env = process.env,
  } = {}) {
    super({ repository, inboundService, inboundResolver, replyTokenService, env });
    this.notificationService = notificationService;
  }

  async resolveDeliveryAttempt(receipt = {}) {
    if (!receipt.providerMessageId && !receipt.providerRequestId) return { attempt: null, ambiguous: false };
    const normalizedChannel = normalizeChannel(receipt.channel);
    let attempts = receipt.providerMessageId
      ? await this.repository.list('message_delivery_attempts', { provider_message_id: receipt.providerMessageId })
      : [];

    // Fall back to the provider REQUEST id.
    //
    // Resend's send response returns only its own email id, while the lifecycle webhook reports
    // the RFC Message-ID. Correlating solely on provider_message_id therefore misses every real
    // Resend receipt: the attempt holds the Resend uuid and the receipt carries the RFC id.
    // The request id is the one identifier present on both sides.
    if (!attempts.length && receipt.providerRequestId) {
      attempts = await this.repository.list('message_delivery_attempts', {
        provider_request_id: receipt.providerRequestId,
      });
    }
    if (receipt.provider) attempts = attempts.filter((row) => !row.provider || row.provider === receipt.provider);
    if (normalizedChannel) attempts = attempts.filter((row) => !row.channel || normalizeChannel(row.channel) === normalizedChannel);
    if (receipt.notificationId) attempts = attempts.filter((row) => String(row.notification_id) === String(receipt.notificationId));
    if (receipt.messageId) attempts = attempts.filter((row) => String(row.message_id) === String(receipt.messageId));

    const unique = [...new Map(attempts.filter((row) => row?.id).map((row) => [row.id, row])).values()];
    if (unique.length > 1) return { attempt: null, ambiguous: true, candidates: unique.length };
    return { attempt: unique[0] || null, ambiguous: false, candidates: unique.length };
  }

  async applyDeliveryReceipt(receipt = {}) {
    const resolved = await this.resolveDeliveryAttempt(receipt);
    if (resolved.ambiguous) {
      await logCommunicationAuditEvent(this.repository, {
        event_type: COMMUNICATION_AUDIT_EVENTS.DELIVERY_RECEIPT,
        actor_type: 'system',
        channel: receipt.channel || null,
        summary: 'Provider receipt attribution refused: ambiguous provider message id',
        correlation_id: receipt.providerMessageId || null,
        metadata: {
          status: receipt.status || null,
          raw_status: receipt.rawStatus || null,
          provider: receipt.provider || null,
          attribution: 'ambiguous_refused',
          candidate_count: resolved.candidates,
        },
      });
      return {
        notificationId: null,
        messageId: null,
        providerMessageId: receipt.providerMessageId || null,
        status: 'unattributed',
        ambiguous: true,
      };
    }

    const attempt = resolved.attempt;
    const notificationId = receipt.notificationId || attempt?.notification_id || null;
    const messageId = receipt.messageId || attempt?.message_id || null;

    if (!attempt && !receipt.notificationId && !receipt.messageId) {
      await logCommunicationAuditEvent(this.repository, {
        event_type: COMMUNICATION_AUDIT_EVENTS.DELIVERY_RECEIPT,
        actor_type: 'system',
        channel: receipt.channel || null,
        summary: 'Provider receipt received without a canonical CarUp delivery attribution',
        correlation_id: receipt.providerMessageId || null,
        metadata: {
          status: receipt.status || null,
          raw_status: receipt.rawStatus || null,
          provider: receipt.provider || null,
          attribution: 'unmatched',
        },
      });
      return {
        notificationId: null,
        messageId: null,
        providerMessageId: receipt.providerMessageId || null,
        status: 'unattributed',
        unmatched: true,
      };
    }

    if (attempt?.id) {
      const patch = {
        status: receipt.status === 'failed' ? 'failed' : receipt.status,
        response_metadata: { ...(attempt.response_metadata || {}), provider_receipt_status: receipt.rawStatus || receipt.status },
        error_code: receipt.errorCode || null,
        error_message: receipt.errorMessage || null,
        completed_at: nowIso(),
      };
      // Backfill the RFC Message-ID the first time a lifecycle event reveals it.
      //
      // This is load-bearing for inbound reply routing (E4): a reply's In-Reply-To/References
      // carry the RFC id, but the send response never exposes it, so without this backfill there
      // is nothing to map a real reply back to. Only ever fills an empty/less-specific value —
      // it never overwrites an existing RFC id.
      const looksRfc = typeof receipt.providerMessageId === 'string' && receipt.providerMessageId.includes('@');
      if (looksRfc && attempt.provider_message_id !== receipt.providerMessageId) {
        patch.provider_message_id = receipt.providerMessageId;
      }
      await this.repository.updateById('message_delivery_attempts', attempt.id, patch);
    }
    if (notificationId) {
      await this.repository.updateById('notification_queue', notificationId, {
        status: receipt.status,
        // Only ever SET this. Writing null on a weaker/later event erased a real delivery
        // timestamp when a provider's delivered webhook raced the worker's own 'sent' write —
        // the same regression the monotonic status trigger prevents for `status`.
        ...(receipt.status === 'delivered' ? { delivered_at: nowIso() } : {}),
        last_error_code: receipt.status === 'failed' ? receipt.errorCode || 'provider_receipt_failed' : null,
        last_error_message: receipt.status === 'failed' ? receipt.errorMessage || `Provider receipt status: ${receipt.rawStatus || 'failed'}` : null,
        locked_at: null,
        locked_by: null,
      });
    }
    if (messageId) {
      await this.repository.updateById('messages', messageId, {
        status: receipt.status === 'failed' ? 'failed' : receipt.status,
        // Only ever SET this. Writing null on a weaker/later event erased a real delivery
        // timestamp when a provider's delivered webhook raced the worker's own 'sent' write —
        // the same regression the monotonic status trigger prevents for `status`.
        ...(receipt.status === 'delivered' ? { delivered_at: nowIso() } : {}),
        failed_at: receipt.status === 'failed' ? nowIso() : null,
      });
    }

    const notification = notificationId
      ? await this.repository.findOne('notification_queue', { id: notificationId }).catch(() => null)
      : null;
    await logCommunicationAuditEvent(this.repository, {
      tenant_id: notification?.tenant_id ?? null,
      thread_id: notification?.thread_id ?? null,
      message_id: messageId ?? null,
      notification_id: notificationId ?? null,
      event_type: COMMUNICATION_AUDIT_EVENTS.DELIVERY_RECEIPT,
      actor_type: 'system',
      channel: notification?.channel ?? receipt.channel ?? null,
      summary: `Provider receipt: ${receipt.status}`,
      correlation_id: receipt.providerMessageId || null,
      metadata: {
        status: receipt.status,
        raw_status: receipt.rawStatus ?? null,
        error_code: receipt.errorCode ?? null,
        attribution: attempt?.id ? 'delivery_attempt' : 'explicit_carup_ids',
        delivery_attempt_id: attempt?.id || null,
      },
    });

    let fallback = null;
    if (receipt.status === 'failed' && notification && this.notificationService?.queueNextFallback) {
      try {
        fallback = await this.notificationService.queueNextFallback(notification, {
          trigger: 'provider_terminal_receipt',
          errorCode: receipt.errorCode || 'provider_receipt_failed',
          errorMessage: receipt.errorMessage || null,
          actor_type: 'system',
          actor_id: receipt.provider || 'provider-webhook',
        });
      } catch (error) {
        await logCommunicationAuditEvent(this.repository, {
          tenant_id: notification.tenant_id ?? null,
          thread_id: notification.thread_id ?? null,
          message_id: messageId ?? null,
          notification_id: notificationId ?? null,
          event_type: 'fallback_orchestration_failed',
          actor_type: 'system',
          channel: notification.channel || receipt.channel || null,
          summary: 'Provider failure fallback orchestration failed',
          correlation_id: receipt.providerMessageId || null,
          metadata: { error: error?.message || 'unknown fallback orchestration failure' },
        });
      }
      if (!fallback?.queued && fallback?.exhausted && messageId) {
        await this.repository.updateById('messages', messageId, {
          status: 'dead_letter',
          failed_at: nowIso(),
        });
      }
    }

    return {
      notificationId,
      messageId,
      providerMessageId: receipt.providerMessageId,
      status: receipt.status,
      fallbackQueued: Boolean(fallback?.queued),
      fallbackNotificationId: fallback?.notification?.id || null,
      fallbackChannel: fallback?.channel || null,
    };
  }
}
