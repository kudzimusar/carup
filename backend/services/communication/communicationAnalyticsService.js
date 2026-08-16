function increment(target, key, amount = 1) {
  const name = String(key || 'unknown');
  target[name] = Number(target[name] || 0) + amount;
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator) / Number(denominator)) * 1000) / 10;
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 10) / 10;
}

function emptyAnalytics(rowCap) {
  return {
    bounded: true,
    row_cap: rowCap,
    conversations: { total: 0, active: 0, converted: 0, conversion_rate_pct: 0, unique_participants: 0, by_workflow: {}, by_funnel_stage: {} },
    marketplace: { conversations: 0, converted: 0, inquiry_to_next_step_pct: 0 },
    response_time: { measured: 0, average_minutes: 0, median_minutes: 0, p95_minutes: 0 },
    events: { total: 0, by_type: {} },
    delivery: { total: 0, successful: 0, failed: 0, suppressed: 0, success_rate_pct: 0, by_channel: {}, by_status: {} },
    attribution: { by_source: {}, by_referral_code: {}, by_campaign_code: {} },
    ai: { derivations: 0, human_reviewed: 0, by_type: {} },
    campaigns: { touches: 0, suppressed: 0, converted: 0, conversion_rate_pct: 0, by_status: {} },
  };
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
    if (!threadIds.length) return emptyAnalytics(rowCap);

    let threads = await this.repository.list('message_threads', { id: threadIds }, { limit: rowCap });
    if (tenantId) threads = threads.filter((row) => !row.tenant_id || String(row.tenant_id) === String(tenantId));
    const scopedThreadIds = threads.map((row) => row.id);
    const [events, notifications, derivations, campaignDeliveries] = await Promise.all([
      scopedThreadIds.length ? this.repository.list('conversation_events', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      scopedThreadIds.length ? this.repository.list('notification_queue', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      scopedThreadIds.length ? this.repository.list('message_derivations', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      this.repository.list('communication_campaign_deliveries', tenantId ? { user_id: userId, tenant_id: tenantId } : { user_id: userId }, { limit: rowCap }).catch(() => []),
    ]);

    const conversations = {
      total: threads.length,
      active: 0,
      converted: 0,
      conversion_rate_pct: 0,
      unique_participants: participants.length,
      by_workflow: {},
      by_funnel_stage: {},
    };
    const marketplace = { conversations: 0, converted: 0, inquiry_to_next_step_pct: 0 };
    const responseSamples = [];
    for (const thread of threads) {
      const workflow = thread.business_workflow || thread.conversation_type || thread.thread_type;
      const status = String(thread.status || '').toLowerCase();
      const conversionStatus = String(thread.conversion_status || '').toLowerCase();
      if (!['resolved', 'closed', 'spam'].includes(status)) conversations.active += 1;
      if (['converted', 'won', 'completed'].includes(conversionStatus)) conversations.converted += 1;
      increment(conversations.by_workflow, workflow);
      increment(conversations.by_funnel_stage, thread.funnel_stage || 'unclassified');
      if (workflow === 'marketplace' || thread.thread_type === 'marketplace_inquiry') {
        marketplace.conversations += 1;
        if (['converted', 'won', 'completed'].includes(conversionStatus) || !['', 'open', 'inquiry', 'conversation'].includes(String(thread.funnel_stage || '').toLowerCase())) marketplace.converted += 1;
      }
      const createdAt = Date.parse(thread.created_at || '');
      const firstResponseAt = Date.parse(thread.first_response_at || '');
      if (Number.isFinite(createdAt) && Number.isFinite(firstResponseAt) && firstResponseAt >= createdAt) {
        responseSamples.push((firstResponseAt - createdAt) / 60000);
      }
    }
    conversations.conversion_rate_pct = percent(conversations.converted, conversations.total);
    marketplace.inquiry_to_next_step_pct = percent(marketplace.converted, marketplace.conversations);
    const responseTime = {
      measured: responseSamples.length,
      average_minutes: responseSamples.length ? Math.round((responseSamples.reduce((sum, value) => sum + value, 0) / responseSamples.length) * 10) / 10 : 0,
      median_minutes: percentile(responseSamples, 50),
      p95_minutes: percentile(responseSamples, 95),
    };

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

    const campaigns = { touches: campaignDeliveries.length, suppressed: 0, converted: 0, conversion_rate_pct: 0, by_status: {} };
    for (const deliveryRow of campaignDeliveries) {
      increment(campaigns.by_status, deliveryRow.status);
      if (deliveryRow.status === 'suppressed') campaigns.suppressed += 1;
      if (deliveryRow.status === 'converted') campaigns.converted += 1;
    }
    campaigns.conversion_rate_pct = percent(campaigns.converted, campaigns.touches - campaigns.suppressed);

    return {
      bounded: true,
      row_cap: rowCap,
      conversations,
      marketplace,
      response_time: responseTime,
      events: eventSummary,
      delivery,
      attribution,
      ai,
      campaigns,
    };
  }
}
