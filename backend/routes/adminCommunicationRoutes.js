import express from 'express';
import { randomUUID } from 'crypto';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';

const ADMIN_ROLES = ['admin', 'platform_admin', 'super_admin', 'support', 'finance', 'trust_manager', 'compliance_manager', 'marketplace_manager'];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function deliveryPayloadForIdentity(identity = {}) {
  const address = identity.normalized_address || identity.external_id || '';
  const payload = {
    external_identity_id: identity.id,
    external_id: identity.external_id || address,
    address,
  };
  switch (identity.channel) {
    case 'email':
      payload.email = address;
      break;
    case 'sms':
    case 'whatsapp':
      payload.phone_number = address;
      break;
    case 'telegram':
      payload.telegram_chat_id = identity.external_id || address;
      break;
    case 'push':
      payload.expo_push_token = identity.external_id || address;
      break;
    default:
      break;
  }
  return payload;
}

async function resolveExternalReplyIdentity({ repository, thread }) {
  if (!repository || !thread?.id) return null;
  const participants = await repository.list('message_participants', { thread_id: thread.id });
  const participant = participants.find((entry) => entry.role === 'requester' && entry.external_identity_id)
    || participants.find((entry) => entry.participant_type === 'external_contact' && entry.external_identity_id)
    || participants.find((entry) => entry.external_identity_id);
  if (!participant?.external_identity_id) return null;
  return repository.findOne('channel_identities', { id: participant.external_identity_id });
}

async function findExistingClientMessage({ repository, thread, clientMessageId }) {
  if (!clientMessageId) return null;
  const matches = await repository.list('messages', { client_message_id: clientMessageId });
  const message = matches.find((entry) => entry.thread_id === thread.id) || null;
  if (matches.length && !message) {
    const err = new Error('client_message_id is already associated with another communication thread.');
    err.statusCode = 409;
    throw err;
  }
  return message;
}

async function notificationForMessage(repository, messageId) {
  const rows = await repository.list('notification_queue', { message_id: messageId }, { order: { column: 'created_at', ascending: true }, limit: 1 });
  return rows[0] || null;
}

export async function recordAdminThreadReply({ services, thread, actor, body = {} }) {
  const repository = services.repository || services.notificationService?.repository || services.threadService?.repository;
  if (!repository) throw new Error('Communication repository is required for admin replies.');
  const internal = Boolean(body?.internal);
  const clientMessageId = body?.client_message_id || body?.clientMessageId || body?.idempotency_key || body?.idempotencyKey || randomUUID();
  const existingMessage = await findExistingClientMessage({
    repository,
    thread,
    clientMessageId,
  });
  if (existingMessage) {
    return {
      message: existingMessage,
      notification: internal ? null : await notificationForMessage(repository, existingMessage.id),
      duplicate: true,
    };
  }
  const originalThread = {
    status: thread.status || null,
    last_message_at: thread.last_message_at || null,
    updated_at: thread.updated_at || null,
  };
  const message = await services.threadService.recordMessage(thread, {
    direction: internal ? 'internal' : 'outbound',
    sender_user_id: actor.id,
    channel: body?.channel || thread.primary_channel || 'in_app',
    content_text: body?.message || body?.text || '',
    content_json: { admin_reply: true, internal },
    client_message_id: clientMessageId,
    human_approved: true,
    status: internal ? 'delivered' : 'queued',
    thread_status: 'awaiting_user',
  });
  let notification = null;
  try {
    if (!internal && thread.primary_user_id) {
      notification = (await services.notificationService.queueExistingMessage({
        recipientUserId: thread.primary_user_id,
        thread,
        message,
        channel: body?.channel || thread.primary_channel || 'in_app',
        notificationType: 'admin_reply',
        templateKey: 'admin_reply_v1',
        priority: thread.priority || 'normal',
        humanApproved: true,
        dedupeParts: ['admin_reply', thread.id, clientMessageId, thread.primary_user_id],
        payload: { thread_id: thread.id, admin_reply: true },
      })).notification;
    } else if (!internal) {
      const identity = await resolveExternalReplyIdentity({ repository, thread });
      if (identity) {
        notification = (await services.notificationService.queueExistingMessage({
          recipientIdentityId: identity.id,
          thread,
          message,
          channel: body?.channel || identity.channel || thread.primary_channel || 'in_app',
          provider: identity.provider || message.provider || null,
          notificationType: 'admin_reply',
          templateKey: 'admin_reply_v1',
          priority: thread.priority || 'normal',
          humanApproved: true,
          dedupeParts: ['admin_reply', thread.id, clientMessageId, identity.id],
          payload: {
            thread_id: thread.id,
            admin_reply: true,
            ...deliveryPayloadForIdentity(identity),
          },
        })).notification;
      }
    }
    if (!internal && !notification) {
      const err = new Error('No deliverable communication recipient found for admin reply.');
      err.statusCode = 422;
      throw err;
    }
  } catch (error) {
    await repository.deleteById?.('messages', message.id).catch(() => null);
    await repository.updateById('message_threads', thread.id, originalThread).catch(() => null);
    throw error;
  }
  return { message, notification };
}

export function createAdminCommunicationRouter({ services = createCommunicationServices() } = {}) {
  const router = express.Router();

  router.get('/api/admin/communications/threads', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.priority) filters.priority = req.query.priority;
    if (req.query.assigned_admin_id) filters.assigned_admin_id = req.query.assigned_admin_id;
    const threads = await services.repository.list('message_threads', filters, { order: { column: 'updated_at' }, limit: Number(req.query.limit || 100) });
    res.json({ threads });
  }));

  router.get('/api/admin/communications/threads/:id', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await services.repository.findOne('message_threads', { id: req.params.id });
    if (!thread) return res.status(404).json({ error: 'Thread not found.' });
    const [messages, participants, escalations] = await Promise.all([
      services.repository.list('messages', { thread_id: thread.id }, { order: { column: 'created_at', ascending: true } }),
      services.repository.list('message_participants', { thread_id: thread.id }),
      services.repository.list('communication_escalations', { thread_id: thread.id }),
    ]);
    res.json({ thread, messages, participants, escalations });
  }));

  router.post('/api/admin/communications/threads/:id/reply', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await services.repository.findOne('message_threads', { id: req.params.id });
    if (!thread) return res.status(404).json({ error: 'Thread not found.' });
    const { message, notification, duplicate } = await recordAdminThreadReply({ services, thread, actor: req.userContext, body: req.body });
    res.status(duplicate ? 200 : 201).json({ message, notification, duplicate: Boolean(duplicate) });
  }));

  router.patch('/api/admin/communications/threads/:id/assignment', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    res.json({ thread: await services.threadService.assignThread(req.params.id, { adminId: req.body?.assigned_admin_id || null, team: req.body?.assigned_team || null, actor: req.userContext }) });
  }));

  router.patch('/api/admin/communications/threads/:id/priority', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    res.json({ thread: await services.repository.updateById('message_threads', req.params.id, { priority: req.body?.priority || 'normal' }) });
  }));

  router.post('/api/admin/communications/threads/:id/escalate', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    res.json({ thread: await services.threadService.escalateThread(req.params.id, req.body?.reason_code || 'admin_escalation', { severity: req.body?.severity || 'high', source: 'admin', team: req.body?.assigned_team || null, adminId: req.userContext.id }) });
  }));

  router.post('/api/admin/communications/threads/:id/resolve', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    res.json({ thread: await services.threadService.resolveThread(req.params.id, req.body?.summary || 'Resolved by admin.', req.userContext) });
  }));

  router.post('/api/admin/communications/threads/:id/reopen', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    res.json({ thread: await services.threadService.reopenThread(req.params.id, req.body?.reason || 'admin_reopen') });
  }));

  router.get('/api/admin/communications/dead-letter', authorizeRole(ADMIN_ROLES), asyncHandler(async (_req, res) => {
    res.json({ notifications: await services.repository.list('notification_queue', { status: 'dead_letter' }, { order: { column: 'updated_at' } }) });
  }));

  router.post('/api/admin/communications/dead-letter/:id/retry', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    res.json({ notification: await services.deliveryWorker.retryDeadLetter(req.params.id, { channel: req.body?.channel || undefined }) });
  }));

  router.post('/api/admin/communications/dead-letter/:id/cancel', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    res.json({ notification: await services.deliveryWorker.cancelDeadLetter(req.params.id, req.body?.reason || 'admin_cancelled') });
  }));

  router.get('/api/admin/communications/worker/health', authorizeRole(ADMIN_ROLES), asyncHandler(async (_req, res) => {
    const slaThresholdSeconds = Number(process.env.COMMUNICATION_SLA_SECONDS || 60);
    const now = Date.now();
    const [queued, processing, retryScheduled, deadLetter] = await Promise.all([
      services.repository.list('notification_queue', { status: 'queued' }, { limit: 500 }),
      services.repository.list('notification_queue', { status: 'processing' }, { limit: 100 }),
      services.repository.list('notification_queue', { status: 'retry_scheduled' }, { limit: 100 }),
      services.repository.list('notification_queue', { status: 'dead_letter' }, { limit: 100 }),
    ]);
    const oldestQueuedMs = queued.length > 0
      ? Math.max(...queued.map((r) => now - new Date(r.created_at || r.scheduled_at || now).getTime()))
      : null;
    const slaBreachingCount = queued.filter((r) => (now - new Date(r.created_at || r.scheduled_at || now).getTime()) > slaThresholdSeconds * 1000).length;
    const telegramHealth = services.adapterRegistry.health().find((h) => h.channel === 'telegram') || null;
    res.json({
      timestamp: new Date().toISOString(),
      queue: {
        queued: queued.length,
        processing: processing.length,
        retry_scheduled: retryScheduled.length,
        dead_letter: deadLetter.length,
        depth: queued.length + processing.length + retryScheduled.length,
        oldest_queued_seconds: oldestQueuedMs != null ? Math.round(oldestQueuedMs / 1000) : null,
        sla_threshold_seconds: slaThresholdSeconds,
        sla_breaching: slaBreachingCount,
      },
      telegram: telegramHealth,
      adapters: services.adapterRegistry.health(),
      scheduler: {
        schedule: '* * * * *',
        cadence: 'every_minute',
        endpoint: '/api/internal/communications/process',
        note: 'Requires Vercel Pro plan. Hobby plan minimum is once per day.',
      },
    });
  }));

  router.get('/api/admin/communications/metrics', authorizeRole(ADMIN_ROLES), asyncHandler(async (_req, res) => {
    const [threads, deadLetters, webhooks] = await Promise.all([
      services.repository.list('message_threads'),
      services.repository.list('notification_queue', { status: 'dead_letter' }),
      services.repository.list('webhook_logs'),
    ]);
    res.json({
      open_threads: threads.filter((t) => !['resolved', 'closed', 'spam'].includes(t.status)).length,
      unassigned_threads: threads.filter((t) => !t.assigned_admin_id && ['open', 'awaiting_human', 'escalated'].includes(t.status)).length,
      overdue_threads: threads.filter((t) => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status)).length,
      dead_letter_count: deadLetters.length,
      duplicate_webhook_count: webhooks.filter((w) => w.processing_status === 'duplicate').length,
    });
  }));

  return router;
}

export default createAdminCommunicationRouter;
