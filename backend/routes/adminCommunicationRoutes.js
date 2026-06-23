import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';

const ADMIN_ROLES = ['admin', 'platform_admin', 'super_admin', 'support', 'finance', 'trust_manager', 'compliance_manager', 'marketplace_manager'];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function recordAdminThreadReply({ services, thread, actor, body = {} }) {
  const internal = Boolean(body?.internal);
  const message = await services.threadService.recordMessage(thread, {
    direction: internal ? 'internal' : 'outbound',
    sender_user_id: actor.id,
    channel: body?.channel || thread.primary_channel || 'in_app',
    content_text: body?.message || body?.text || '',
    content_json: { admin_reply: true, internal },
    human_approved: true,
    status: internal ? 'delivered' : 'queued',
    thread_status: 'awaiting_user',
  });
  let notification = null;
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
      dedupeParts: ['admin_reply', thread.id, message.id, thread.primary_user_id],
      payload: { thread_id: thread.id, admin_reply: true },
    })).notification;
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
    const { message, notification } = await recordAdminThreadReply({ services, thread, actor: req.userContext, body: req.body });
    res.status(201).json({ message, notification });
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
