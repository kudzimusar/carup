function increment(target, key, amount = 1) {
  const name = String(key || 'unknown');
  target[name] = Number(target[name] || 0) + amount;
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator) / Number(denominator)) * 1000) / 10;
}

export class CommunicationAnalyticsService {
  constructor({ repository } = {}) {
    this.repository = repository;
  }

  async getUserAnalytics(userId, { tenantId = null, rowCap = 1000 } = {}) {
    if (!userId) {
      const error = new Error('A user is required for communication analytics.');
      error.statusCode = 401;
      throw error;
    }

    const participants = (await this.repository.list(
      'message_participants',
      { user_id: userId },
      { limit: rowCap },
    )).filter((row) => !row.left_at);
    const threadIds = [...new Set(participants.map((row) => row.thread_id).filter(Boolean))].slice(0, rowCap);
    if (!threadIds.length) {
      return {
        bounded: true,
        row_cap: rowCap,
        conversations: { total: 0, active: 0, converted: 0, conversion_rate_pct: 0, by_workflow: {}, by_funnel_stage: {} },
        events: { total: 0, by_type: {} },
        delivery: { total: 0, successful: 0, failed: 0, suppressed: 0, success_rate_pct: 0, by_channel: {}, by_status: {} },
        attribution: { by_source: {}, by_referral_code: {}, by_campaign_code: {} },
        ai: { derivations: 0, human_reviewed: 0, by_type: {} },
      };
    }

    let threads = await this.repository.list('message_threads', { id: threadIds }, { limit: rowCap });
    if (tenantId) threads = threads.filter((row) => !row.tenant_id || String(row.tenant_id) === String(tenantId));
    const scopedThreadIds = threads.map((row) => row.id);
    const [events, notifications, derivations] = await Promise.all([
      scopedThreadIds.length ? this.repository.list('conversation_events', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      scopedThreadIds.length ? this.repository.list('notification_queue', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      scopedThreadIds.length ? this.repository.list('message_derivations', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
    ]);

    const conversations = {
      total: threads.length,
      active: 0,
      converted: 0,
      conversion_rate_pct: 0,
      by_workflow: {},
      by_funnel_stage: {},
    };
    for (const thread of threads) {
      if (!['resolved', 'closed', 'spam'].includes(String(thread.status || '').toLowerCase())) conversations.active += 1;
      if (['converted', 'won', 'completed'].includes(String(thread.conversion_status || '').toLowerCase())) conversations.converted += 1;
      increment(conversations.by_workflow, thread.business_workflow || thread.conversation_type || thread.thread_type);
      increment(conversations.by_funnel_stage, thread.funnel_stage || 'unclassified');
    }
    conversations.conversion_rate_pct = percent(conversations.converted, conversations.total);

    const eventSummary = { total: events.length, by_type: {} };
    const attribution = { by_source: {}, by_referral_code: {}, by_campaign_code: {} };
    for (const event of events) {
      increment(eventSummary.by_type, event.event_type);
      if (event.acquisition_source) increment(attribution.by_source, event.acquisition_source);
      if (event.referral_code) increment(attribution.by_referral_code, event.referral_code);
      if (event.campaign_code) increment(attribution.by_campaign_code, event.campaign_code);
    }

    const delivery = {
      total: notifications.length,
      successful: 0,
      failed: 0,
      suppressed: 0,
      success_rate_pct: 0,
      by_channel: {},
      by_status: {},
    };
    for (const notification of notifications) {
      const status = String(notification.status || 'unknown').toLowerCase();
      increment(delivery.by_channel, notification.channel || 'unknown');
      increment(delivery.by_status, status);
      if (['sent', 'delivered', 'read'].includes(status)) delivery.successful += 1;
      if (['failed', 'dead_letter'].includes(status)) delivery.failed += 1;
      if (status === 'suppressed') delivery.suppressed += 1;
    }
    delivery.success_rate_pct = percent(delivery.successful, delivery.total);

    const ai = { derivations: derivations.length, human_reviewed: 0, by_type: {} };
    for (const derivation of derivations) {
      increment(ai.by_type, derivation.derivation_type);
      if (derivation.human_reviewed) ai.human_reviewed += 1;
    }

    return {
      bounded: true,
      row_cap: rowCap,
      conversations,
      events: eventSummary,
      delivery,
      attribution,
      ai,
    };
  }
}
