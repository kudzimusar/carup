import express from 'express';
import crypto from 'crypto';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { validateCommunicationConfiguration, resolveWorkerSecret } from '../services/communication/communicationConfigurationValidator.js';
import { buildDedupeKey, normalizeChannel } from '../services/communication/communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from '../services/communication/communicationAuditLog.js';
import {
  finalizeMetaWhatsAppWebhookReceipt,
  persistencePatchFromWebhookResult,
  recordMetaWhatsAppWebhookReceipt,
} from '../services/communication/communicationWebhookDiagnostics.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function actorFromReq(req) {
  return {
    id: req.userContext?.id || req.headers['x-user-id'] || null,
    userId: req.userContext?.id || req.headers['x-user-id'] || null,
    role: req.userContext?.effectiveRole || req.userContext?.role || null,
    tenantId: req.userContext?.tenantId || req.headers['x-tenant-id'] || null,
    actor_user_id: req.userContext?.id || req.headers['x-user-id'] || null,
    actor_tenant_id: req.userContext?.tenantId || req.headers['x-tenant-id'] || 'platform',
    gateway_trusted: Boolean(req.headers['x-channel-webhook-secret'] || req.headers['x-carup-channel-secret']),
    correlation_id: req.correlationId || req.headers['x-correlation-id'] || null,
  };
}

function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireWorkerSecret(req, res) {
  const expected = resolveWorkerSecret();
  const supplied = req.headers['x-communication-worker-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied || !safeEqual(supplied, expected)) {
    res.status(401).json({ error: 'Unauthorized communication worker request.' });
    return false;
  }
  return true;
}

async function processWorkerBatch(req, res, services) {
  if (!requireWorkerSecret(req, res)) return;
  const correlationId = req.headers['x-correlation-id'] || req.correlationId || crypto.randomUUID();
  const limit = Math.min(Number(req.body?.limit || req.query.limit || process.env.COMMUNICATION_WORKER_BATCH_SIZE || 10), 100);
  const invokedAt = new Date().toISOString();
  console.log(JSON.stringify({ level: 'info', event: 'communication_worker_invoked', correlation_id: correlationId, batch_limit: limit, ts: invokedAt }));
  const results = await services.deliveryWorker.processDueNotifications({ limit });
  const completedAt = new Date().toISOString();
  console.log(JSON.stringify({ level: 'info', event: 'communication_worker_completed', correlation_id: correlationId, processed: results.length, ts: completedAt }));
  res.json({
    success: true,
    processed: results.length,
    correlation_id: correlationId,
    invoked_at: invokedAt,
    completed_at: completedAt,
    results: results.map((result) => ({
      notificationId: result.notificationId,
      status: result.status,
      nextRetryAt: result.nextRetryAt || null,
      event: result.event || null,
    })),
  });
}

export function createCommunicationRouter({ services = createCommunicationServices() } = {}) {
  const router = express.Router();

  router.get('/api/communications/health', asyncHandler(async (_req, res) => {
    const configuration = services.configurationValidator?.validate?.()
      || validateCommunicationConfiguration({ adapterRegistry: services.adapterRegistry });
    res.status(configuration.status === 'BLOCKED' ? 503 : 200).json({
      success: configuration.status !== 'BLOCKED',
      status: configuration.status,
      configuration,
      adapters: services.adapterRegistry.health?.() || [],
    });
  }));

  router.get('/api/internal/communications/process', asyncHandler(async (req, res) => processWorkerBatch(req, res, services)));
  router.post('/api/internal/communications/process', asyncHandler(async (req, res) => processWorkerBatch(req, res, services)));

  // Communications 2.0 ordinary-user inbox. Authorization is based on active
  // message_participants rows, never a client-supplied owner id.
  router.get('/api/communications/threads', authorizeRole([]), asyncHandler(async (req, res) => {
    res.json({ threads: await services.conversationService.listConversationsForUser(req.userContext.id) });
  }));

  router.get('/api/communications/threads/:id', authorizeRole([]), asyncHandler(async (req, res) => {
    res.json(await services.conversationService.getConversation(req.params.id, actorFromReq(req)));
  }));

  router.post('/api/communications/threads', authorizeRole([]), asyncHandler(async (req, res) => {
    const { thread } = await services.threadService.resolveOrCreateThread({
      ...req.body,
      primary_user_id: req.userContext.id, // compatibility projection
      tenant_id: req.userContext.tenantId || req.body?.tenant_id || null,
      primary_channel: normalizeChannel(req.body?.channel) || 'web_chat',
    });
    await services.conversationService.ensureParticipant(thread.id, {
      participant_type: 'user',
      user_id: req.userContext.id,
      stakeholder_role: req.body?.stakeholder_role || 'requester',
      permissions: { read: true, send: true },
      metadata: { source: req.body?.metadata?.source || 'carup_user_created' },
    });
    res.status(201).json({ thread });
  }));

  router.post('/api/communications/threads/:id/messages', authorizeRole([]), asyncHandler(async (req, res) => {
    const result = await services.conversationService.sendParticipantMessage(
      req.params.id,
      actorFromReq(req),
      {
        message: req.body?.message || req.body?.text || '',
        channel: req.body?.channel || 'in_app',
        message_type: req.body?.message_type || 'text',
        client_message_id: req.body?.client_message_id || null,
        reply_to_message_id: req.body?.reply_to_message_id || null,
        content: req.body?.content || {},
      },
    );
    res.status(201).json(result);
  }));

  router.post('/api/communications/threads/:id/read', authorizeRole([]), asyncHandler(async (req, res) => {
    await services.conversationService.markRead(req.params.id, actorFromReq(req));
    res.json({ success: true });
  }));

  router.post('/api/communications/threads/:id/feedback', authorizeRole([]), asyncHandler(async (req, res) => {
    const { thread, participant } = await services.conversationService.assertParticipantAccess(req.params.id, actorFromReq(req), 'send');
    const message = await services.threadService.recordMessage(thread, {
      direction: 'inbound',
      sender_participant_id: participant.id,
      sender_user_id: req.userContext.id,
      channel: 'in_app',
      content_text: req.body?.feedback || req.body?.message || '',
      content_json: { rating: req.body?.rating || null, feedback_type: 'user_feedback', original_authoritative: true },
    });
    const reopened = thread.status === 'resolved' && req.body?.reopen !== false;
    if (reopened) await services.threadService.reopenThread(thread.id, 'user_feedback');
    await logCommunicationAuditEvent(services.repository, {
      tenant_id: thread.tenant_id ?? null, thread_id: thread.id, message_id: message?.id ?? null,
      event_type: COMMUNICATION_AUDIT_EVENTS.FEEDBACK_RECEIVED,
      actor_type: 'customer', actor_id: req.userContext.id, channel: 'in_app',
      summary: `Customer feedback${req.body?.rating ? ` (rating ${req.body.rating})` : ''}`, metadata: { rating: req.body?.rating ?? null },
    });
    if (reopened) {
      await logCommunicationAuditEvent(services.repository, {
        tenant_id: thread.tenant_id ?? null, thread_id: thread.id,
        event_type: COMMUNICATION_AUDIT_EVENTS.REOPENED, actor_type: 'customer', actor_id: req.userContext.id,
        summary: 'Reopened by customer feedback',
      });
    }
    return res.status(201).json({ success: true });
  }));

  router.get('/api/communications/notifications', authorizeRole([]), asyncHandler(async (req, res) => {
    res.json({ notifications: await services.notificationService.listNotificationsForUser(req.userContext.id) });
  }));

  router.post('/api/communications/notifications/:id/read', authorizeRole([]), asyncHandler(async (req, res) => {
    const notification = await services.repository.findOne('notification_queue', { id: req.params.id });
    if (!notification || (notification.recipient_user_id || notification.recipient_id) !== req.userContext.id) return res.status(404).json({ error: 'Notification not found.' });
    await services.repository.updateById('notification_queue', req.params.id, { read: true });
    res.json({ success: true });
  }));

  router.get('/api/communications/preferences', authorizeRole([]), asyncHandler(async (req, res) => {
    res.json({ preferences: await services.preferenceService.getPreferences(req.userContext.id, req.userContext.tenantId || null) });
  }));

  router.patch('/api/communications/preferences', authorizeRole([]), asyncHandler(async (req, res) => {
    res.json({ preferences: await services.preferenceService.updatePreferences(req.userContext.id, req.body || {}, req.userContext.tenantId || null) });
  }));

  router.post('/api/communications/share', authorizeRole([]), asyncHandler(async (req, res) => {
    const channel = normalizeChannel(req.body?.channel) || 'whatsapp';
    const listingId = req.body?.listing_id || req.body?.listingId;
    const referralCode = req.body?.referral_code || req.body?.code;
    const campaignId = req.body?.campaign_id || req.body?.campaignId;
    const origin = req.body?.origin || process.env.CARUP_PUBLIC_WEB_URL || 'https://carup.co.zw';
    const params = new URLSearchParams({ channel, utm_source: channel, utm_medium: 'share' });
    if (referralCode) params.set('ref', referralCode);
    if (campaignId) params.set('campaign_id', campaignId);
    const listingUrl = `${origin.replace(/\/+$/, '')}/marketplace/listing/${encodeURIComponent(listingId)}?${params.toString()}`;
    const shareText = req.body?.text || `View this CarUp listing: ${listingUrl}`;
    const shareUrl = channel === 'whatsapp'
      ? `https://wa.me/?text=${encodeURIComponent(shareText)}`
      : channel === 'telegram'
        ? `https://t.me/share/url?url=${encodeURIComponent(listingUrl)}&text=${encodeURIComponent('View this CarUp listing')}`
        : listingUrl;
    const queued = await services.notificationService.queueNotification({
      recipientUserId: req.userContext.id,
      notificationType: 'listing_shared',
      channel: 'in_app',
      templateKey: 'listing_shared_v1',
      variables: { share_text: shareText, share_url: listingUrl },
      priority: 'low',
      dedupeParts: ['share', req.userContext.id, listingId, referralCode, channel],
      payload: { listing_id: listingId, referral_code: referralCode, campaign_id: campaignId, channel, share_url: listingUrl },
    });
    res.status(201).json({
      success: true,
      channel,
      listing_url: listingUrl,
      share_url: shareUrl,
      share_id: queued.notification.id,
      dedupe_key: buildDedupeKey(['share', req.userContext.id, listingId, referralCode, channel]),
    });
  }));

  router.get('/api/communications/webhooks/:provider/:channel', asyncHandler(async (req, res) => {
    if (req.params.provider !== 'meta') return res.status(404).json({ error: 'Webhook verification endpoint not found.' });
    const challenge = services.webhookService.verifyMetaCallback(req.params.channel, req.query || {});
    res.status(200).type('text/plain').send(challenge);
  }));

  // Proven provider route intentionally preserved. The inbound service now resolves
  // channel bindings before it considers creating a new provider-owned thread.
  router.post('/api/communications/webhooks/:provider/:channel', asyncHandler(async (req, res) => {
    const isMetaWhatsApp = req.params.provider === 'meta' && normalizeChannel(req.params.channel) === 'whatsapp';
    const receipt = isMetaWhatsApp
      ? recordMetaWhatsAppWebhookReceipt({ req, body: req.body || {} })
      : null;
    try {
      const result = await services.webhookService.handleWebhook(req.params.provider, req.params.channel, req.body || {}, {
        headers: req.headers,
        query: req.query,
        actor: actorFromReq(req),
        rawBody: req.rawBody || '',
      });
      if (receipt) {
        finalizeMetaWhatsAppWebhookReceipt(receipt.requestId, persistencePatchFromWebhookResult(result, receipt.detected_event_type));
      }
      return res.status(200).json(result);
    } catch (error) {
      if (receipt) {
        finalizeMetaWhatsAppWebhookReceipt(receipt.requestId, {
          processing_status: 'failed',
          error_code: error.code || (error.statusCode === 403 ? 'webhook_forbidden' : 'webhook_processing_failed'),
          error_message: error.message,
        });
      }
      const statusCode = error.statusCode || (/requires|unsupported|malformed|invalid/i.test(error.message || '') ? 400 : 500);
      return res.status(statusCode).json({
        success: false,
        error: error.code || (statusCode === 403 ? 'webhook_forbidden' : 'webhook_processing_failed'),
        message: error.message,
      });
    }
  }));

  return router;
}

export default createCommunicationRouter;
