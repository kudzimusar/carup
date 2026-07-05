import { COMMUNICATION_EVENTS, THREAD_STATUSES, buildDedupeKey, computeSlaDue, nowIso, publicThreadProjection } from './communicationUtils.js';
import { pausePatch, resumePatch } from './communicationSla.js';
import { selectSlaPolicy, computeSlaDeadlines } from './communicationSlaSchedule.js';

export class CommunicationThreadService {
  constructor({ repository }) {
    this.repository = repository;
  }

  buildThreadKey(input = {}) {
    if (input.thread_key) return input.thread_key;
    const tenant = input.tenant_id || 'platform';
    const subject = input.subject_id ? `${input.subject_type || 'subject'}:${input.subject_id}` : null;
    const participant = input.primary_user_id || input.external_identity_id || input.external_conversation_id || input.session_id || 'unknown';
    return buildDedupeKey([tenant, input.thread_type || 'general', subject || participant]);
  }

  async resolveOrCreateThread(input = {}) {
    const tenantId = input.tenant_id || null;
    const threadKey = this.buildThreadKey(input);
    const existing = await this.repository.findOne('message_threads', { tenant_id: tenantId, thread_key: threadKey });
    if (existing) return { thread: existing, created: false };

    const priority = input.priority || 'normal';
    const thread = await this.repository.insert('message_threads', {
      tenant_id: tenantId,
      thread_key: threadKey,
      thread_type: input.thread_type || 'general',
      subject_type: input.subject_type || null,
      subject_id: input.subject_id || null,
      primary_user_id: input.primary_user_id || null,
      primary_channel: input.primary_channel || null,
      status: input.status || THREAD_STATUSES.OPEN,
      priority,
      ai_mode: input.ai_mode || process.env.COMMUNICATION_AI_MODE_DEFAULT || 'enabled',
      assignment_type: input.assignment_type || 'ai_queue',
      assigned_team: input.assigned_team || this.teamForThread(input.thread_type),
      assigned_admin_id: input.assigned_admin_id || null,
      referral_code_id: input.referral_code_id || null,
      referral_campaign_id: input.referral_campaign_id || null,
      marketplace_listing_id: input.marketplace_listing_id || null,
      escrow_id: input.escrow_id || null,
      financing_application_id: input.financing_application_id || null,
      sla_due_at: computeSlaDue(priority),
      metadata: {
        intent: input.intent || input.thread_type || 'general',
        public_reference: input.public_reference || null,
        ...(input.metadata || {}),
        events: [COMMUNICATION_EVENTS.THREAD_CREATED],
      },
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    if (input.primary_user_id || input.external_identity_id) {
      await this.addParticipant(thread.id, {
        participant_type: input.primary_user_id ? 'user' : 'external_contact',
        user_id: input.primary_user_id || null,
        external_identity_id: input.external_identity_id || null,
        role: 'requester',
        display_name: input.display_name || null,
      });
    }
    // Apply the SLA policy at creation (#4 — not only on priority change). Best-effort: a thread with
    // no matching policy keeps the legacy computeSlaDue(priority) response target set above. Refresh
    // the in-memory thread so callers see the computed deadlines.
    const withSla = await this.applySlaPolicy(thread.id, { startIso: thread.created_at, preserveFirstResponse: false }).catch(() => null);
    return { thread: withSla || thread, created: true };
  }

  teamForThread(type) {
    if (type === 'finance') return 'finance';
    if (type === 'escrow') return 'safepay';
    if (type === 'trust_safety' || type === 'complaint') return 'trust_safety';
    if (type === 'marketplace_inquiry') return 'marketplace';
    return 'support';
  }

  async addParticipant(threadId, participant = {}) {
    const existing = await this.repository.findOne('message_participants', {
      thread_id: threadId,
      user_id: participant.user_id || null,
      external_identity_id: participant.external_identity_id || null,
      role: participant.role || 'participant',
    });
    if (existing) return existing;
    return this.repository.insert('message_participants', {
      thread_id: threadId,
      participant_type: participant.participant_type || 'user',
      user_id: participant.user_id || null,
      admin_id: participant.admin_id || null,
      external_identity_id: participant.external_identity_id || null,
      role: participant.role || 'participant',
      display_name: participant.display_name || null,
      joined_at: nowIso(),
      metadata: participant.metadata || {},
    });
  }

  async recordMessage(thread, input = {}) {
    const message = await this.repository.insert('messages', {
      thread_id: thread.id,
      tenant_id: thread.tenant_id || input.tenant_id || null,
      direction: input.direction || 'inbound',
      message_type: input.message_type || 'text',
      sender_participant_id: input.sender_participant_id || null,
      sender_user_id: input.sender_user_id || null,
      channel: input.channel || thread.primary_channel || 'in_app',
      provider: input.provider || null,
      provider_message_id: input.provider_message_id || null,
      client_message_id: input.client_message_id || null,
      in_reply_to_message_id: input.in_reply_to_message_id || null,
      content_text: input.content_text || null,
      content_json: input.content_json || {},
      attachment_metadata: input.attachment_metadata || [],
      language: input.language || null,
      ai_generated: Boolean(input.ai_generated),
      ai_run_id: input.ai_run_id || null,
      human_approved: Boolean(input.human_approved),
      status: input.status || (input.direction === 'outbound' ? 'queued' : 'received'),
      sent_at: input.sent_at || null,
      delivered_at: input.delivered_at || null,
      read_at: input.read_at || null,
      failed_at: input.failed_at || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await this.repository.updateById('message_threads', thread.id, {
      last_message_at: message.created_at,
      updated_at: message.created_at,
      status: input.thread_status || thread.status,
    });
    // SLA lifecycle hooks (#4) — every message funnels through here. Fail-soft: an SLA math error must
    // never break message recording. Inbound (customer) drives the response clock; a HUMAN outbound
    // (agent reply or human-approved AI draft, never a pure AI auto-reply) stamps the first response.
    const dir = input.direction || 'inbound';
    try {
      if (dir === 'inbound') {
        await this.applySlaOnInbound(thread.id, { channel: input.channel || thread.primary_channel || null, inboundIso: message.created_at });
      } else if (dir === 'outbound' && (input.human_approved === true || input.ai_generated !== true)) {
        await this.stampFirstResponse(thread.id, { outboundIso: message.created_at });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({ event: 'communication_sla_lifecycle_failed', thread_id: thread.id, direction: dir, error: error?.message }));
    }
    return message;
  }

  async assignThread(threadId, { adminId = null, team = null, actor = {} } = {}) {
    const thread = await this.repository.updateById('message_threads', threadId, {
      assigned_admin_id: adminId,
      assigned_team: team,
      assignment_type: adminId ? 'named_admin' : 'team',
      status: THREAD_STATUSES.ASSIGNED,
      metadata: { assigned_by: actor.id || actor.userId || null },
    });
    return thread;
  }

  async escalateThread(threadId, reasonCode, { severity = 'high', source = 'system', team = null, adminId = null } = {}) {
    const thread = await this.repository.updateById('message_threads', threadId, {
      status: THREAD_STATUSES.ESCALATED,
      priority: severity,
      assigned_team: team || undefined,
      sla_due_at: computeSlaDue(severity),
      updated_at: nowIso(),
    });
    await this.repository.insert('communication_escalations', {
      thread_id: threadId,
      reason_code: reasonCode,
      severity,
      source,
      assigned_team: team,
      assigned_admin_id: adminId,
      status: 'open',
      due_at: thread.sla_due_at,
      metadata: {},
    });
    return thread;
  }

  async resolveThread(threadId, summary, actor = {}) {
    return this.repository.updateById('message_threads', threadId, {
      status: THREAD_STATUSES.RESOLVED,
      resolved_at: nowIso(),
      // Stop the SLA clock on resolve (#4): clear the active targets. first_response_at is kept as
      // history (it records that/when the team first responded); the badge goes not_applicable.
      first_response_due_at: null,
      next_response_due_at: null,
      resolution_due_at: null,
      sla_due_at: null,
      metadata: { resolution_summary: summary, resolved_by: actor.id || actor.userId || null },
    });
  }

  async reopenThread(threadId, reason = 'feedback') {
    // Reapply the SLA policy from scratch on reopen (#4): a reopened thread is a fresh customer wait,
    // so the first-response cycle restarts (first_response_at cleared) and all deadlines recompute from
    // now within business hours. Falls back to the legacy sla_due_at when no policy matches.
    const thread = await this.repository.findOne('message_threads', { id: threadId });
    const reopenIso = nowIso();
    const policy = thread ? await this.selectPolicyForThread(thread, {}) : null;
    const deadlines = policy ? computeSlaDeadlines(policy, reopenIso) : {};
    return this.repository.updateById('message_threads', threadId, {
      status: THREAD_STATUSES.OPEN,
      resolved_at: null,
      closed_at: null,
      metadata: { reopened_reason: reason },
      first_response_at: null,
      first_response_due_at: deadlines.first_response_due_at ?? null,
      next_response_due_at: deadlines.next_response_due_at ?? null,
      resolution_due_at: deadlines.resolution_due_at ?? null,
      sla_policy_id: deadlines.sla_policy_id ?? (thread ? thread.sla_policy_id ?? null : null),
      sla_business_timezone: deadlines.sla_business_timezone ?? (thread ? thread.sla_business_timezone ?? null : null),
      sla_due_at: deadlines.first_response_due_at || deadlines.resolution_due_at || computeSlaDue('normal'),
    });
  }

  // Advance the AGENT-side read marker for `actor` on this thread (clears the team inbox unread
  // badge — see communicationInboxProjection.js). Stamps the actor's existing agent/assignee
  // participant, or adds one if the actor has never been a participant, so opening a thread as an
  // admin always marks it read. Never writes the requester participant (that is the customer receipt).
  async markRead(threadId, actor = {}) {
    const actorId = actor.id || actor.userId || null;
    if (!actorId) return null;
    const participants = await this.repository.list('message_participants', { thread_id: threadId });
    const existing = participants.find((row) =>
      row.role !== 'requester' && (row.admin_id === actorId || row.user_id === actorId));
    const now = nowIso();
    if (existing) {
      return this.repository.updateById('message_participants', existing.id, { last_read_at: now });
    }
    return this.repository.insert('message_participants', {
      thread_id: threadId,
      participant_type: 'agent',
      admin_id: actorId,
      role: 'agent',
      joined_at: now,
      last_read_at: now,
    });
  }

  // Pause the SLA clock (records when + why). Idempotent: pausing an already-paused thread is a no-op.
  async pauseSla(threadId, reason = 'paused') {
    const thread = await this.repository.findOne('message_threads', { id: threadId });
    if (!thread) return null;
    const patch = pausePatch(thread, reason);
    if (!Object.keys(patch).length) return thread;
    return this.repository.updateById('message_threads', threadId, patch);
  }

  // Resume the SLA clock, pushing all due-at targets forward by the paused duration so time spent
  // paused does not count against the SLA. Idempotent when not paused.
  async resumeSla(threadId, now = Date.now()) {
    const thread = await this.repository.findOne('message_threads', { id: threadId });
    if (!thread) return null;
    const patch = resumePatch(thread, now);
    if (!Object.keys(patch).length) return thread;
    return this.repository.updateById('message_threads', threadId, patch);
  }

  // Resolve the best-matching SLA policy for a thread (tenant/channel/priority). Returns null when
  // there are no policies (or none match) — every caller treats that as "leave SLA untouched".
  async selectPolicyForThread(thread, { channel = null, priority = null } = {}) {
    const policies = await this.repository.list('communication_sla_policies', {}).catch(() => []);
    return selectSlaPolicy(policies, {
      tenantId: thread.tenant_id ?? null,
      channel: channel || thread.primary_channel || null,
      priority: priority || thread.priority || null,
    });
  }

  // Recompute the SLA deadlines from the matching policy (P1.9 / #4). Used on thread creation and on a
  // channel/priority/policy change — NOT only on priority change. `preserveFirstResponse` keeps an
  // already-stamped first response (a recompute must not resurrect a met first-response deadline).
  async applySlaPolicy(threadId, { channel = null, priority = null, startIso = null, preserveFirstResponse = true } = {}) {
    const thread = await this.repository.findOne('message_threads', { id: threadId });
    if (!thread) return null;
    const policy = await this.selectPolicyForThread(thread, { channel, priority });
    if (!policy) return thread;
    const deadlines = computeSlaDeadlines(policy, startIso || thread.created_at || nowIso());
    const patch = {
      next_response_due_at: deadlines.next_response_due_at,
      resolution_due_at: deadlines.resolution_due_at,
      sla_policy_id: deadlines.sla_policy_id,
      sla_business_timezone: deadlines.sla_business_timezone,
    };
    if (preserveFirstResponse && thread.first_response_at) {
      // Already responded: keep the historical first_response_due_at; drive the badge off next/resolution.
      patch.sla_due_at = deadlines.next_response_due_at || deadlines.resolution_due_at || thread.sla_due_at || null;
    } else {
      patch.first_response_due_at = deadlines.first_response_due_at;
      patch.sla_due_at = deadlines.first_response_due_at || deadlines.resolution_due_at || thread.sla_due_at || null;
    }
    return this.repository.updateById('message_threads', threadId, patch);
  }

  // A customer inbound arrived (#4). Cold thread → set the full deadline set; already-responded thread
  // → restart the next-response clock (the customer is waiting again); still-awaiting-first-response
  // thread → keep the first-response clock ticking, refresh next-response. Never touches first_response_at.
  async applySlaOnInbound(threadId, { channel = null, priority = null, inboundIso = null } = {}) {
    const thread = await this.repository.findOne('message_threads', { id: threadId });
    if (!thread) return null;
    if (thread.sla_paused_at) return thread; // clock frozen — don't move deadlines while paused
    const policy = await this.selectPolicyForThread(thread, { channel, priority });
    if (!policy) return thread;
    const deadlines = computeSlaDeadlines(policy, inboundIso || nowIso());
    const patch = { sla_policy_id: deadlines.sla_policy_id, sla_business_timezone: deadlines.sla_business_timezone };
    if (thread.first_response_at) {
      patch.next_response_due_at = deadlines.next_response_due_at;
      patch.sla_due_at = deadlines.next_response_due_at || thread.sla_due_at || null;
    } else if (!thread.first_response_due_at) {
      patch.first_response_due_at = deadlines.first_response_due_at;
      patch.next_response_due_at = deadlines.next_response_due_at;
      patch.resolution_due_at = deadlines.resolution_due_at;
      patch.sla_due_at = deadlines.first_response_due_at || deadlines.resolution_due_at || thread.sla_due_at || null;
    } else {
      patch.next_response_due_at = deadlines.next_response_due_at;
    }
    return this.repository.updateById('message_threads', threadId, patch);
  }

  // First HUMAN outbound stamps first_response_at (once) and clears the next-response clock — the
  // customer is no longer waiting until they reply again (#4). AI auto-replies do NOT count.
  async stampFirstResponse(threadId, { outboundIso = null } = {}) {
    const thread = await this.repository.findOne('message_threads', { id: threadId });
    if (!thread) return null;
    const patch = { next_response_due_at: null };
    if (!thread.first_response_at) patch.first_response_at = outboundIso || nowIso();
    return this.repository.updateById('message_threads', threadId, patch);
  }

  async listThreadsForUser(userId) {
    return (await this.repository.list('message_threads', { primary_user_id: userId }, { order: { column: 'updated_at' }, limit: 100 }))
      .map(publicThreadProjection);
  }
}

