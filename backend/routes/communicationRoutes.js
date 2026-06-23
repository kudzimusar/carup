import express from 'express';
import crypto from 'crypto';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { buildDedupeKey, normalizeChannel } from '../services/communication/communicationUtils.js';

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
  const expected = process.env.COMMUNICATION_WORKER_SECRET || process.env.CRON_SECRET;
  const supplied = req.headers['x-communication-worker-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied || !safeEqual(supplied, expected)) {
    res.status(401).json({ error: 'Unauthorized communication worker request.' });
    return false;
  }
  return true;
}

export function createCommunicationRouter({ services = createCommunicationServices() } = {}) {
  const router = express.Router();

  router.get('/api/communications/health', asyncHandler(async (_req, res) => {
    res.json({ success: true, adapters: services.adapterRegistry.health() });
  }));

  router.post('/api/internal/communications/process', asyncHandler(async (req, res) => {
    if (!requireWorkerSecret(req, res)) return;
    const limit = Math.min(Number(req.body?.limit || req.query.limit || process.env.COMMUNICATION_WORKER_BATCH_SIZE || 10), 100);
    const results = await services.deliveryWorker.processDueNotifications({ limit });
    res.json({
      success: true,
      processed: results.length,
      results: results.map((result) => ({
        notificationId: result.notificationId,
        status: result.status,
        nextRetryAt: result.nextRetryAt || null,
        event: result.event || null,
      })),
    });
  }));

  router.get('/api/communications/threads', authorizeRole([]), asyncHandler(async (req, res) => {
    res.json({ threads: await services.threadService.listThreadsForUser(req.userContext.id) });
  }));

  router.get('/api/communications/threads/:id', authorizeRole([]), asyncHandler(async (req, res) => {
    const thread = await services.repository.findOne('message_threads', { id: req.params.id });
    if (!thread || thread.primary_user_id !== req.userContext.id) return res.status(404).json({ error: 'Thread not found.' });
    const messages = await services.repository.list('messages', { thread_id: thread.id }, { order: { column: 'created_at', ascending: true } });
    res.json({ thread, messages: messages.filter((message) => message.direction !== 'internal') });
  }));

  router.post('/api/communications/threads', authorizeRole([]), asyncHandler(async (req, res) => {
    const { thread } = await services.threadService.resolveOrCreateThread({
      ...req.body,
      primary_user_id: req.userContext.id,
      tenant_id: req.userContext.tenantId || req.body?.tenant_id || null,
      primary_channel: normalizeChannel(req.body?.channel) || 'web_chat',
    });
    res.status(201).json({ thread });
  }));

  router.post('/api/communications/threads/:id/messages', authorizeRole([]), asyncHandler(async (req, res) => {
    const thread = await services.repository.findOne('message_threads', { id: req.params.id });
    if (!thread || thread.primary_user_id !== req.userContext.id) return res.status(404).json({ error: 'Thread not found.' });
    const result = await services.inboundService.ingest({
      channel: req.body?.channel || 'web_chat',
      provider: 'web_chat',
      text: req.body?.message || req.body?.text || '',
      externalSenderId: req.userContext.id,
      externalConversationId: thread.thread_key,
      user_id: req.userContext.id,
      tenant_id: req.userContext.tenantId || thread.tenant_id || null,
      subject_type: thread.subject_type,
      subject_id: thread.subject_id,
    }, actorFromReq(req));
    res.status(201).json(result);
  }));

  router.post('/api/communications/threads/:id/read', authorizeRole([]), asyncHandler(async (req, res) => {
    await services.threadService.markRead(req.params.id, req.userContext);
    res.json({ success: true });
  }));

  router.post('/api/communications/threads/:id/feedback', authorizeRole([]), asyncHandler(async (req, res) => {
    const thread = await services.repository.findOne('message_threads', { id: req.params.id });
    if (!thread || thread.primary_user_id !== req.userContext.id) return res.status(404).json({ error: 'Thread not found.' });
    await services.threadService.recordMessage(thread, {
      direction: 'inbound',
      sender_user_id: req.userContext.id,
      channel: 'in_app',
      content_text: req.body?.feedback || req.body?.message || '',
      content_json: { rating: req.body?.rating || null, feedback_type: 'user_feedback' },
    });
    if (thread.status === 'resolved' && req.body?.reopen !== false) await services.threadService.reopenThread(thread.id, 'user_feedback');
    res.status(201).json({ success: true });
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
    const params = new URLSearchParams({
      channel,
      utm_source: channel,
      utm_medium: 'share',
    });
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

  router.post('/api/communications/webhooks/:provider/:channel', asyncHandler(async (req, res) => {
    const result = await services.webhookService.handleWebhook(req.params.provider, req.params.channel, req.body || {}, {
      headers: req.headers,
      query: req.query,
      actor: actorFromReq(req),
      rawBody: req.rawBody || '',
    });
    res.status(200).json(result);
  }));

  return router;
}

export default createCommunicationRouter;
