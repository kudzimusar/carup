import express from 'express';
import { randomUUID, timingSafeEqual } from 'crypto';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { normalizeChannel } from '../services/communication/communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, auditActorFromContext, logCommunicationAuditEvent } from '../services/communication/communicationAuditLog.js';
import { categorizeRecovery } from '../services/communication/communicationRecovery.js';

const ADMIN_ROLES = ['admin', 'platform_admin', 'super_admin', 'support', 'finance', 'trust_manager', 'compliance_manager', 'marketplace_manager'];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Channels a provider smoke test may target. Restricted to real external providers.
const SMOKE_TEST_CHANNELS = new Set(['whatsapp', 'telegram', 'sms', 'email', 'facebook', 'instagram', 'push']);

// The smoke test sends to an arbitrary external recipient, so it is restricted to genuine
// platform admins — not the broader ADMIN_ROLES (which includes tenant-elevatable roles like
// 'support'/'finance'). Only 'admin'/'platform_admin'/'super_admin' can be an effective role
// without a matching platform base role, so tenant elevation cannot reach this endpoint.
const SMOKE_TEST_ADMIN_ROLES = ['admin', 'platform_admin', 'super_admin'];
const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

// Tenant/platform scoping for inbox queries (item 14). Platform admins (by their platform BASE role,
// not a tenant-elevated effective role) see every tenant; everyone else is confined to their own
// tenant. A worker-secret caller acts as platform for diagnostics. A caller with neither platform
// role nor a resolvable tenant sees nothing (the repository fails closed).
export function resolveThreadQueryContext(req) {
  const uc = req.userContext || {};
  const platformRole = uc.platformRole || uc.baseRole || uc.role || null;
  const isPlatform = uc.actor === 'worker_secret' || PLATFORM_ADMIN_ROLES.has(platformRole);
  return { userId: uc.id, tenantId: uc.tenantId || null, isPlatform, now: Date.now() };
}

// Load a thread by id and enforce tenant scoping (item 14). Platform admins reach any tenant; a
// tenant-scoped caller only reaches its own tenant's threads. Cross-tenant (and orphan, tenant-less
// callers) get an indistinguishable 404 so thread existence cannot be enumerated across tenants.
// Returns the thread, or null after already sending the 404 response. Exported for unit testing.
export async function loadThreadForRequest(services, req, res) {
  const thread = await services.repository.findOne('message_threads', { id: req.params.id });
  if (!thread) { res.status(404).json({ error: 'Thread not found.' }); return null; }
  const ctx = resolveThreadQueryContext(req);
  const sameTenant = Boolean(ctx.tenantId) && String(thread.tenant_id || '') === String(ctx.tenantId);
  if (!ctx.isPlatform && !sameTenant) {
    res.status(404).json({ error: 'Thread not found.' });
    return null;
  }
  return thread;
}

// A repository filter fragment that scopes list() results to the caller's tenant (item 14). Platform
// admins get no filter (all tenants); everyone else is confined to their own tenant_id (a tenant-less
// caller sees only tenant-less/platform rows). Prevents cross-tenant PII/aggregate leakage on the
// dead-letter list, metrics, and worker-health endpoints.
function tenantListFilter(req) {
  const ctx = resolveThreadQueryContext(req);
  return ctx.isPlatform ? {} : { tenant_id: ctx.tenantId ?? null };
}

// Load a queued/dead-letter notification by id and enforce the same tenant scoping as threads
// (item 14). Platform admins reach any tenant; tenant callers only their own; cross-tenant → 404.
export async function loadNotificationForRequest(services, req, res) {
  const notification = await services.repository.findOne('notification_queue', { id: req.params.id });
  if (!notification) { res.status(404).json({ error: 'Notification not found.' }); return null; }
  const ctx = resolveThreadQueryContext(req);
  const sameTenant = Boolean(ctx.tenantId) && String(notification.tenant_id || '') === String(ctx.tenantId);
  if (!ctx.isPlatform && !sameTenant) {
    res.status(404).json({ error: 'Notification not found.' });
    return null;
  }
  return notification;
}

// Append a thread-scoped audit event for the acting user (fail-soft; never throws — see
// communicationAuditLog.js). Awaiting is safe because the writer swallows its own errors.
function auditThread(services, req, thread, eventType, extra = {}) {
  const actor = auditActorFromContext(req.userContext || {});
  return logCommunicationAuditEvent(services.repository, {
    tenant_id: thread?.tenant_id ?? null,
    thread_id: thread?.id ?? null,
    event_type: eventType,
    actor_type: actor.actor_type,
    actor_id: actor.actor_id,
    channel: thread?.primary_channel ?? null,
    ...extra,
  });
}

function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

// Machine-to-machine auth: the communication worker secret (same secret the internal
// worker endpoint and Supabase pg_cron use). Never logged, compared in constant time.
function workerSecretValid(req) {
  const expected = process.env.COMMUNICATION_WORKER_SECRET || process.env.CRON_SECRET;
  const supplied = req.headers['x-communication-worker-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

// The smoke-test endpoint is privileged and MUST NOT be public. It accepts either a
// valid admin session (authorizeRole) OR the worker secret. With neither, authorizeRole
// returns 401/403 — there is no anonymous path.
function requireAdminOrWorkerSecret(req, res, next) {
  if (workerSecretValid(req)) {
    req.userContext = req.userContext || { id: 'communication-worker', role: 'worker', actor: 'worker_secret' };
    return next();
  }
  // Admin path: authorizeRole resolves the session, then we additionally require the platform
  // BASE role (not the tenant-elevated effectiveRole) to be a platform admin. authorizeRole only
  // excludes the literal 'admin' from tenant-role elevation, so a tenant_users row with role
  // 'super_admin'/'platform_admin' could otherwise elevate into this arbitrary-external-send
  // endpoint. Gating on platformRole closes that tenant→platform namespace crossing.
  return authorizeRole(SMOKE_TEST_ADMIN_ROLES)(req, res, () => {
    const platformRole = req.userContext?.platformRole || req.userContext?.baseRole || null;
    if (!SMOKE_TEST_ADMIN_ROLES.includes(platformRole)) {
      return res.status(403).json({ error: 'Forbidden. Provider smoke test requires a platform admin role.' });
    }
    return next();
  });
}

/**
 * Send a single real-provider "smoke test" through the Communication Engine's own queue +
 * delivery-worker path (identity → thread → message → notification_queue → deliveryWorker →
 * provider adapter). It refuses to run against a fake adapter, so a green result always means
 * a real provider request was made. Returns evidence (ids + provider_message_id) for the
 * Supabase rows it created. Exported for tests.
 */
export async function sendProviderSmokeTest({ services, channel = 'whatsapp', to, message, actor = {}, clientMessageId = null } = {}) {
  const normalizedChannel = normalizeChannel(channel);
  if (!normalizedChannel || !SMOKE_TEST_CHANNELS.has(normalizedChannel)) {
    const err = new Error(`Unsupported smoke-test channel: ${channel}`);
    err.statusCode = 400;
    err.code = 'unsupported_channel';
    throw err;
  }
  const recipient = String(to || '').trim();
  if (!recipient) {
    const err = new Error('A recipient (to) is required for a provider smoke test.');
    err.statusCode = 400;
    err.code = 'recipient_required';
    throw err;
  }

  const registry = services.deliveryWorker?.adapterRegistry || services.adapterRegistry;
  const adapter = registry?.get?.(normalizedChannel);
  if (!adapter) {
    const err = new Error(`No adapter registered for channel ${normalizedChannel}.`);
    err.statusCode = 400;
    err.code = 'adapter_missing';
    throw err;
  }

  const config = adapter.validateConfiguration?.() || {};
  // Refuse fake-adapter "success". The FakeCommunicationAdapter is the ONLY adapter that reports
  // mode: 'fake'; real provider adapters report 'real' (Meta/Telegram/Twilio/SendGrid) or a
  // provider-specific real mode like 'worker'/'rest' (Cloudflare email). Keying the refusal off
  // the fake sentinel — not `!== 'real'` — avoids wrongly rejecting a configured real adapter.
  // This is the single most important guard in this endpoint.
  if (config.mode === 'fake') {
    const err = new Error(`Refusing smoke test: channel '${normalizedChannel}' is served by a fake adapter (provider=${config.provider || 'unknown'}). A real provider adapter is required — fake-adapter success is not accepted.`);
    err.statusCode = 409;
    err.code = 'fake_adapter_refused';
    err.details = { adapter: { channel: normalizedChannel, provider: config.provider || null, mode: config.mode || null, available: Boolean(config.available) } };
    throw err;
  }
  if (!config.available) {
    const err = new Error(`Provider for channel '${normalizedChannel}' is not configured: missing ${(config.missing || []).join(', ') || 'credentials'}.`);
    err.statusCode = 424;
    err.code = 'provider_not_configured';
    err.details = { channel: normalizedChannel, provider: config.provider || null, missing: config.missing || [] };
    throw err;
  }

  const provider = adapter.provider || config.provider || normalizedChannel;
  const token = clientMessageId || randomUUID();

  const identity = await services.identityService.resolveOrCreateIdentity({
    channel: normalizedChannel,
    provider,
    external_id: recipient,
    address: recipient,
    display_name: 'Provider Smoke Test',
    metadata: { smoke_test: true },
  });

  // thread_type must be one of the values allowed by the message_threads_thread_type_check
  // constraint (support/marketplace_inquiry/referral/escrow/finance/import/container/
  // trust_safety/feedback/complaint/account/general) — 'support' is the operational fit. The
  // smoke-test identity lives in metadata/content_json, NOT in thread_type. A dedicated
  // thread_key keeps smoke tests isolated from any real 'support' thread for this recipient.
  const { thread } = await services.threadService.resolveOrCreateThread({
    thread_type: 'support',
    thread_key: `smoke_test:${normalizedChannel}:${recipient}`,
    primary_channel: normalizedChannel,
    external_identity_id: identity.id,
    display_name: 'Provider Smoke Test',
    status: 'open',
    priority: 'high',
    metadata: { smoke_test: true, intent: 'provider_smoke_test', initiated_by: actor.id || actor.userId || 'worker' },
  });

  const body = String(message || '').trim() || `CarUp provider smoke test (${normalizedChannel}) — ${token}`;
  const messageRow = await services.threadService.recordMessage(thread, {
    direction: 'outbound',
    channel: normalizedChannel,
    provider,
    content_text: body,
    content_json: { smoke_test: true, correlation_token: token },
    human_approved: true,
    status: 'queued',
    client_message_id: token,
    thread_status: 'awaiting_user',
  });

  // Defer the queue row's due-time into the future and cap attempts at 1 so the Supabase
  // pg_cron worker never independently claims this row (it only claims rows that are due) —
  // this endpoint's synchronous delivery below is the sole send, avoiding a duplicate real
  // message to the recipient and any background retry loop.
  const deferUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { notification } = await services.notificationService.queueExistingMessage({
    recipientIdentityId: identity.id,
    thread,
    message: messageRow,
    channel: normalizedChannel,
    provider,
    notificationType: 'provider_smoke_test',
    templateKey: 'provider_smoke_test_v1',
    priority: 'high',
    humanApproved: true,
    scheduledAt: deferUntil,
    nextAttemptAt: deferUntil,
    maxAttempts: 1,
    dedupeParts: ['provider_smoke_test', normalizedChannel, recipient, token],
    payload: {
      thread_id: thread.id,
      smoke_test: true,
      external_identity_id: identity.id,
      external_id: recipient,
      phone_number: recipient,
      to: recipient,
      address: recipient,
    },
  });

  // Deliver synchronously through the SAME delivery worker the cron path uses, so this
  // exercises the real adapter and records message_delivery_attempts + updates the queue.
  // deliverNotification ignores scheduling and sends immediately regardless of deferUntil.
  const deliveryResult = await services.deliveryWorker.deliverNotification(notification, { alreadyClaimed: false });

  // message_delivery_attempts has no created_at column — order by started_at (the real schema
  // timestamp) so the newest attempt is first. Ordering by created_at errors on live Postgres.
  const attempts = await services.repository.list(
    'message_delivery_attempts',
    { notification_id: String(notification.id) },
    { order: { column: 'started_at', ascending: false }, limit: 5 },
  );
  const latestAttempt = attempts[0] || null;
  const finalNotification = (await services.repository.findOne('notification_queue', { id: notification.id })) || notification;

  const accepted = deliveryResult?.status === 'sent' && latestAttempt?.status === 'sent' && Boolean(latestAttempt?.provider_message_id);

  return {
    ok: accepted,
    channel: normalizedChannel,
    provider,
    recipient,
    adapter: { channel: normalizedChannel, provider: config.provider || provider, mode: config.mode, available: Boolean(config.available) },
    thread_id: thread.id,
    message_id: messageRow.id,
    notification_id: notification.id,
    correlation_token: token,
    delivery: {
      status: finalNotification?.status || null,
      worker_result: deliveryResult?.status || null,
      provider: latestAttempt?.provider || provider,
      provider_message_id: latestAttempt?.provider_message_id || finalNotification?.provider_message_id || null,
      provider_request_id: latestAttempt?.provider_request_id || null,
      attempt_number: latestAttempt?.attempt_number || null,
      error_code: latestAttempt?.error_code || finalNotification?.last_error_code || null,
      error_message: latestAttempt?.error_message || finalNotification?.last_error_message || null,
    },
    inspect: {
      messages: `SELECT * FROM messages WHERE id = '${messageRow.id}';`,
      notification_queue: `SELECT * FROM notification_queue WHERE id = '${notification.id}';`,
      message_delivery_attempts: `SELECT * FROM message_delivery_attempts WHERE notification_id = '${notification.id}';`,
      webhook_logs: 'Meta delivery/read receipts arrive asynchronously (inbound webhook, provider=meta) after the recipient device acknowledges.',
    },
  };
}

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
    // Identity-first, DB-side inbox query. The repository executes the search fully server-side via the
    // communication_inbox_threads projection + search_communication_threads() RPC (keyset pagination,
    // tenant scoping, server search/filter/count) for the default ordering, and degrades to a bounded
    // window only where the projection migration is not yet applied. `threads` stays an array; `page`
    // (cursor) and `counts` are additive.
    const ctx = resolveThreadQueryContext(req);
    const params = {
      search: req.query.search,
      status: req.query.status,
      channel: req.query.channel,
      priority: req.query.priority,
      assigned: req.query.assigned || (req.query.assigned_admin_id ? String(req.query.assigned_admin_id) : undefined),
      team: req.query.team,
      sla: req.query.sla,
      failed_only: req.query.failed_only === 'true',
      include_terminal: req.query.include_terminal === undefined ? true : req.query.include_terminal === 'true',
      sort: req.query.sort,
      cursor: req.query.cursor,
      limit: req.query.limit,
    };
    const result = await services.repository.searchThreads(params, ctx);
    res.json({ threads: result.threads, page: result.page, counts: result.counts });
  }));

  router.get('/api/admin/communications/threads/:id', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const [messages, participants, escalations] = await Promise.all([
      services.repository.list('messages', { thread_id: thread.id }, { order: { column: 'created_at', ascending: true } }),
      services.repository.list('message_participants', { thread_id: thread.id }),
      services.repository.list('communication_escalations', { thread_id: thread.id }),
    ]);
    // Enrich the conversation for the context/ops rail + timeline technical drawer (items 6/7):
    // the requester + linked channel identities, recent delivery attempts, and the user's comm prefs.
    const identityIds = [...new Set(participants.map((p) => p.external_identity_id).filter(Boolean))];
    const messageIds = messages.map((m) => m.id).filter(Boolean);
    const [identities, deliveryAttempts, preferences, linkedIdentities] = await Promise.all([
      identityIds.length ? services.repository.list('channel_identities', { id: identityIds }) : Promise.resolve([]),
      messageIds.length ? services.repository.list('message_delivery_attempts', { message_id: messageIds }, { order: { column: 'started_at', ascending: true } }) : Promise.resolve([]),
      thread.primary_user_id ? services.repository.list('communication_preferences', { user_id: thread.primary_user_id }, { limit: 1 }) : Promise.resolve([]),
      thread.primary_user_id ? services.repository.list('channel_identities', { user_id: thread.primary_user_id }) : Promise.resolve([]),
    ]);
    return res.json({
      thread,
      messages,
      participants,
      escalations,
      identities,
      linked_identities: linkedIdentities,
      delivery_attempts: deliveryAttempts,
      preferences: preferences[0] || null,
    });
  }));

  // Thread audit trail (plan §8). Tenant-scoped; newest first.
  router.get('/api/admin/communications/threads/:id/audit', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const events = await services.repository.list('communication_audit_events', { thread_id: thread.id }, { order: { column: 'created_at', ascending: false }, limit: Math.min(Number(req.query.limit || 200), 500) });
    return res.json({ events });
  }));

  router.post('/api/admin/communications/threads/:id/reply', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const { message, notification, duplicate } = await recordAdminThreadReply({ services, thread, actor: req.userContext, body: req.body });
    if (!duplicate) {
      const internal = Boolean(req.body?.internal);
      await auditThread(services, req, thread, internal ? COMMUNICATION_AUDIT_EVENTS.INTERNAL_NOTE : COMMUNICATION_AUDIT_EVENTS.REPLY_SENT, {
        message_id: message?.id ?? null,
        notification_id: notification?.id ?? null,
        channel: req.body?.channel || thread.primary_channel || null,
        correlation_id: req.body?.client_message_id || null,
        summary: internal ? 'Internal note added' : 'Reply sent to customer',
      });
    }
    return res.status(duplicate ? 200 : 201).json({ message, notification, duplicate: Boolean(duplicate) });
  }));

  // Mark the thread read for the acting agent — advances the team read marker and clears the unread
  // badge (item 9). Tenant-scoped like every other thread mutation.
  router.post('/api/admin/communications/threads/:id/read', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const participant = await services.threadService.markRead(thread.id, req.userContext);
    await auditThread(services, req, thread, COMMUNICATION_AUDIT_EVENTS.MARKED_READ, { summary: 'Thread marked read' });
    return res.json({ ok: true, thread_id: thread.id, last_read_at: participant?.last_read_at ?? null });
  }));

  router.patch('/api/admin/communications/threads/:id/assignment', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const wasAssigned = Boolean(thread.assigned_admin_id || thread.assigned_team);
    const updated = await services.threadService.assignThread(thread.id, { adminId: req.body?.assigned_admin_id || null, team: req.body?.assigned_team || null, actor: req.userContext });
    await auditThread(services, req, thread, wasAssigned ? COMMUNICATION_AUDIT_EVENTS.REASSIGNED : COMMUNICATION_AUDIT_EVENTS.ASSIGNED, {
      summary: `Assigned to ${req.body?.assigned_admin_id ? `admin ${String(req.body.assigned_admin_id).slice(0, 8)}` : (req.body?.assigned_team || 'unassigned')}`,
      metadata: { assigned_admin_id: req.body?.assigned_admin_id || null, assigned_team: req.body?.assigned_team || null },
    });
    return res.json({ thread: updated });
  }));

  router.patch('/api/admin/communications/threads/:id/priority', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const priority = req.body?.priority || 'normal';
    const updated = await services.repository.updateById('message_threads', thread.id, { priority });
    await auditThread(services, req, thread, COMMUNICATION_AUDIT_EVENTS.PRIORITY_CHANGED, { summary: `Priority set to ${priority}`, metadata: { from: thread.priority || null, to: priority } });
    return res.json({ thread: updated });
  }));

  router.post('/api/admin/communications/threads/:id/escalate', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const reason = req.body?.reason_code || 'admin_escalation';
    const updated = await services.threadService.escalateThread(thread.id, reason, { severity: req.body?.severity || 'high', source: 'admin', team: req.body?.assigned_team || null, adminId: req.userContext.id });
    await auditThread(services, req, thread, COMMUNICATION_AUDIT_EVENTS.ESCALATED, { summary: `Escalated (${reason})`, metadata: { reason_code: reason, severity: req.body?.severity || 'high' } });
    return res.json({ thread: updated });
  }));

  router.post('/api/admin/communications/threads/:id/resolve', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const summary = req.body?.summary || 'Resolved by admin.';
    const updated = await services.threadService.resolveThread(thread.id, summary, req.userContext);
    await auditThread(services, req, thread, COMMUNICATION_AUDIT_EVENTS.RESOLVED, { summary });
    return res.json({ thread: updated });
  }));

  router.post('/api/admin/communications/threads/:id/reopen', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const reason = req.body?.reason || 'admin_reopen';
    const updated = await services.threadService.reopenThread(thread.id, reason);
    await auditThread(services, req, thread, COMMUNICATION_AUDIT_EVENTS.REOPENED, { summary: `Reopened (${reason})` });
    return res.json({ thread: updated });
  }));

  // SLA pause/resume (item 10). Pausing freezes the SLA clock with a reason; resuming pushes every
  // due-at forward by the paused duration so paused time is not counted against the SLA.
  router.post('/api/admin/communications/threads/:id/sla/pause', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const reason = req.body?.reason || 'paused';
    const updated = await services.threadService.pauseSla(thread.id, reason);
    await auditThread(services, req, thread, COMMUNICATION_AUDIT_EVENTS.SLA_PAUSED, { summary: `SLA paused (${reason})`, metadata: { reason } });
    return res.json({ thread: updated });
  }));

  router.post('/api/admin/communications/threads/:id/sla/resume', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const thread = await loadThreadForRequest(services, req, res);
    if (!thread) return undefined;
    const updated = await services.threadService.resumeSla(thread.id);
    await auditThread(services, req, thread, COMMUNICATION_AUDIT_EVENTS.SLA_RESUMED, { summary: 'SLA resumed' });
    return res.json({ thread: updated });
  }));

  router.get('/api/admin/communications/dead-letter', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    // Tenant-scoped: notification_queue rows carry recipient PII (phone/email/handle) + message text.
    res.json({ notifications: await services.repository.list('notification_queue', { status: 'dead_letter', ...tenantListFilter(req) }, { order: { column: 'updated_at' } }) });
  }));

  router.post('/api/admin/communications/dead-letter/:id/retry', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const notification = await loadNotificationForRequest(services, req, res);
    if (!notification) return undefined;
    const result = await services.deliveryWorker.retryDeadLetter(notification.id, { channel: req.body?.channel || undefined });
    const actor = auditActorFromContext(req.userContext || {});
    await logCommunicationAuditEvent(services.repository, {
      tenant_id: notification.tenant_id ?? null, thread_id: notification.thread_id ?? null, notification_id: notification.id,
      event_type: COMMUNICATION_AUDIT_EVENTS.RETRY_SCHEDULED, actor_type: actor.actor_type, actor_id: actor.actor_id,
      channel: notification.channel ?? null, summary: 'Dead-letter retry requested',
    });
    return res.json({ notification: result });
  }));

  router.post('/api/admin/communications/dead-letter/:id/cancel', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const notification = await loadNotificationForRequest(services, req, res);
    if (!notification) return undefined;
    const reason = req.body?.reason || 'admin_cancelled';
    const result = await services.deliveryWorker.cancelDeadLetter(notification.id, reason);
    const actor = auditActorFromContext(req.userContext || {});
    await logCommunicationAuditEvent(services.repository, {
      tenant_id: notification.tenant_id ?? null, thread_id: notification.thread_id ?? null, notification_id: notification.id,
      event_type: COMMUNICATION_AUDIT_EVENTS.CANCELLED, actor_type: actor.actor_type, actor_id: actor.actor_id,
      channel: notification.channel ?? null, summary: `Dead-letter cancelled (${reason})`,
    });
    return res.json({ notification: result });
  }));

  // Full recovery view (item 11): categorised queue health (queued too long, stale processing locks,
  // retry scheduled, failed, dead letter, cancelled), tenant-scoped.
  router.get('/api/admin/communications/recovery', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const scope = tenantListFilter(req);
    const statuses = ['queued', 'processing', 'retry_scheduled', 'failed', 'dead_letter', 'cancelled'];
    const rows = (await Promise.all(statuses.map((status) =>
      services.repository.list('notification_queue', { status, ...scope }, { order: { column: 'updated_at' }, limit: 500 })))).flat();
    const { categories, counts } = categorizeRecovery(rows, {
      now: Date.now(),
      staleAfterSeconds: Number(process.env.COMMUNICATION_STALE_LOCK_SECONDS || 900),
      queuedThresholdSeconds: Number(process.env.COMMUNICATION_QUEUED_ALERT_SECONDS || 300),
    });
    return res.json({ categories, counts });
  }));

  // Guarded bulk retry (item 11): retries many notifications by id, tenant-scoped per id, capped, with
  // partial-failure reporting. Never a blanket "retry everything" — the caller supplies explicit ids.
  router.post('/api/admin/communications/recovery/bulk-retry', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'Provide a non-empty ids array.' });
    if (ids.length > 100) return res.status(400).json({ error: 'Bulk retry is capped at 100 notifications per request.' });
    const ctx = resolveThreadQueryContext(req);
    const actor = auditActorFromContext(req.userContext || {});
    const results = [];
    for (const id of ids) {
      const notification = await services.repository.findOne('notification_queue', { id });
      const sameTenant = Boolean(ctx.tenantId) && String(notification?.tenant_id || '') === String(ctx.tenantId);
      if (!notification || (!ctx.isPlatform && !sameTenant)) { results.push({ id, ok: false, error: 'not_found_or_forbidden' }); continue; }
      try {
        await services.deliveryWorker.retryDeadLetter(notification.id, {});
        await logCommunicationAuditEvent(services.repository, {
          tenant_id: notification.tenant_id ?? null, thread_id: notification.thread_id ?? null, notification_id: notification.id,
          event_type: COMMUNICATION_AUDIT_EVENTS.RETRY_SCHEDULED, actor_type: actor.actor_type, actor_id: actor.actor_id,
          channel: notification.channel ?? null, summary: 'Bulk retry requested',
        });
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error.message });
      }
    }
    const retried = results.filter((r) => r.ok).length;
    return res.json({ retried, failed: results.length - retried, total: results.length, results });
  }));

  // Safe requeue with a corrected destination/template/channel (item 11). Merges the correction into
  // the notification payload rather than replacing it, then requeues. Tenant-scoped + audited.
  router.post('/api/admin/communications/dead-letter/:id/requeue', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const notification = await loadNotificationForRequest(services, req, res);
    if (!notification) return undefined;
    const patch = {};
    if (req.body?.channel) patch.channel = String(req.body.channel);
    if (req.body?.template_key) patch.template_key = String(req.body.template_key);
    if (req.body?.to || req.body?.recipient || req.body?.corrected_destination) {
      const corrected = req.body.to || req.body.recipient || req.body.corrected_destination;
      patch.payload = { ...(notification.payload || {}), corrected_destination: corrected, to: corrected };
    }
    const result = await services.deliveryWorker.retryDeadLetter(notification.id, patch);
    const actor = auditActorFromContext(req.userContext || {});
    await logCommunicationAuditEvent(services.repository, {
      tenant_id: notification.tenant_id ?? null, thread_id: notification.thread_id ?? null, notification_id: notification.id,
      event_type: COMMUNICATION_AUDIT_EVENTS.RETRY_SCHEDULED, actor_type: actor.actor_type, actor_id: actor.actor_id,
      channel: patch.channel || notification.channel || null, summary: 'Requeued with corrected destination/template',
      metadata: { channel: patch.channel || null, template_key: patch.template_key || null },
    });
    return res.json({ notification: result });
  }));

  router.get('/api/admin/communications/worker/health', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const slaThresholdSeconds = Number(process.env.COMMUNICATION_SLA_SECONDS || 60);
    const now = Date.now();
    // Queue-depth stats are tenant-scoped so a tenant operator sees only their own backlog; global
    // scheduler/adapter facts below are platform infrastructure and remain as-is.
    const scope = tenantListFilter(req);
    const [queued, processing, retryScheduled, deadLetter] = await Promise.all([
      services.repository.list('notification_queue', { status: 'queued', ...scope }, { limit: 500 }),
      services.repository.list('notification_queue', { status: 'processing', ...scope }, { limit: 100 }),
      services.repository.list('notification_queue', { status: 'retry_scheduled', ...scope }, { limit: 100 }),
      services.repository.list('notification_queue', { status: 'dead_letter', ...scope }, { limit: 100 }),
    ]);
    const oldestQueuedMs = queued.length > 0
      ? Math.max(...queued.map((r) => now - new Date(r.created_at || r.scheduled_at || now).getTime()))
      : null;
    const slaBreachingCount = queued.filter((r) => (now - new Date(r.created_at || r.scheduled_at || now).getTime()) > slaThresholdSeconds * 1000).length;
    const telegramHealth = services.adapterRegistry.health().find((h) => h.channel === 'telegram') || null;

    // Query pg_cron/pg_net health via Supabase RPC (fails gracefully when extension unavailable)
    let schedulerHealth = { scheduler_type: 'supabase_cron', pg_cron_available: false, job_configured: false, stale_lock_count: 0 };
    try {
      const { data, error } = await services.repository.client.rpc('get_communication_scheduler_health');
      if (!error && data) schedulerHealth = data;
    } catch (_err) {
      // Memory repository in tests or pg_cron not installed — use fallback
    }

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
      scheduler: schedulerHealth,
      inspect: {
        cron_job_table: 'cron.job',
        cron_run_history: 'cron.job_run_details',
        http_responses: 'net._http_response',
        worker_logs: 'Vercel function logs (structured JSON lines with event=communication_worker_invoked/completed)',
        queue_table: 'public.notification_queue',
        attempts_table: 'public.message_delivery_attempts',
      },
    });
  }));

  // Provider smoke test: send one real message through the Communication Engine's queue +
  // delivery-worker path to confirm live provider delivery. Admin-authed OR worker-secret;
  // never public. Refuses fake adapters, so ok:true always means a real provider request.
  router.post('/api/admin/communications/test/provider-smoke', requireAdminOrWorkerSecret, asyncHandler(async (req, res) => {
    try {
      const result = await sendProviderSmokeTest({
        services,
        channel: req.body?.channel || 'whatsapp',
        to: req.body?.to || req.body?.recipient || req.body?.phone_number,
        message: req.body?.message || req.body?.text,
        actor: req.userContext || {},
        clientMessageId: req.body?.client_message_id || req.body?.idempotency_key || null,
      });
      // ok:false means the row was created but the provider rejected/failed — surface as 502,
      // never as success. Fake-adapter/config errors throw above with their own status codes.
      const actor = auditActorFromContext(req.userContext || {});
      await logCommunicationAuditEvent(services.repository, {
        tenant_id: req.userContext?.tenantId ?? null,
        thread_id: result?.thread?.id ?? null,
        event_type: COMMUNICATION_AUDIT_EVENTS.SMOKE_TEST,
        actor_type: actor.actor_type, actor_id: actor.actor_id,
        channel: req.body?.channel || 'whatsapp',
        summary: `Provider smoke test → ${result.ok ? 'delivered' : 'failed'}`,
        correlation_id: result?.delivery?.provider_message_id || null,
        metadata: { ok: Boolean(result.ok), provider: result?.delivery?.provider || null },
      });
      return res.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        ok: false,
        error: error.code || 'smoke_test_failed',
        message: error.message,
        details: error.details || null,
      });
    }
  }));

  router.get('/api/admin/communications/metrics', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    // Tenant-scoped so a tenant operator's header stats reflect only their own volume. NOTE: these are
    // still computed in JS over a bounded list; at very large scale prefer the counts RPC/DB aggregates.
    const scope = tenantListFilter(req);
    const [threads, deadLetters, webhooks] = await Promise.all([
      services.repository.list('message_threads', { ...scope }),
      services.repository.list('notification_queue', { status: 'dead_letter', ...scope }),
      services.repository.list('webhook_logs', { ...scope }),
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
