import { COMMUNICATION_EVENTS, THREAD_STATUSES, buildDedupeKey, computeSlaDue, nowIso, publicThreadProjection } from './communicationUtils.js';

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
    return { thread, created: true };
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
      metadata: { resolution_summary: summary, resolved_by: actor.id || actor.userId || null },
    });
  }

  async reopenThread(threadId, reason = 'feedback') {
    return this.repository.updateById('message_threads', threadId, {
      status: THREAD_STATUSES.OPEN,
      resolved_at: null,
      closed_at: null,
      metadata: { reopened_reason: reason },
      sla_due_at: computeSlaDue('normal'),
    });
  }

  async markRead(threadId, actor = {}) {
    const participant = (await this.repository.list('message_participants', { thread_id: threadId }))
      .find((row) => row.user_id === actor.id || row.admin_id === actor.id);
    if (!participant) return null;
    return this.repository.updateById('message_participants', participant.id, { last_read_at: nowIso() });
  }

  async listThreadsForUser(userId) {
    return (await this.repository.list('message_threads', { primary_user_id: userId }, { order: { column: 'updated_at' }, limit: 100 }))
      .map(publicThreadProjection);
  }
}

