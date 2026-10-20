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

/**
 * OC-NATIVE-FINAL-02-R1 D4 — a first response is measured from the message record, never from
 * `message_threads.first_response_at`.
 *
 * That stamp is written by ANY outbound message that is not a pure AI auto-reply — including every
 * templated notification, which CarUp records as an outbound message on its own notification thread
 * seconds after creating it. Measured on staging, an account with 32 unanswered enquiries was shown a
 * 0-minute median built entirely from three notification stamps, while the unanswered conversations
 * were dropped from the population altogether.
 *
 * A conversation is ELIGIBLE when a customer message is waiting in it: its first inbound message
 * starts the clock. It is REPLIED when a person — a message with a sender — answers after that
 * message; an unapproved AI auto-reply is not a reply (the rule recordMessage already applies).
 * Unreplied conversations are counted. With no replied conversation there is no median: null, never 0.
 */
const RESPONSE_TIME_BASIS = 'first_person_reply_after_first_customer_message';
const RESPONSE_MESSAGE_COLUMNS = 'thread_id,direction,created_at,sender_user_id,sender_participant_id,ai_generated,human_approved';
// PostgREST answers at most 1000 rows by default; a read that reaches the cap may be missing messages.
const RESPONSE_MESSAGE_CAP = 1000;

function isPersonReply(message) {
  if (message.direction !== 'outbound') return false;
  if (!message.sender_user_id && !message.sender_participant_id) return false;
  return message.human_approved === true || message.ai_generated !== true;
}

function measureResponseTimes(threads, messages) {
  const byThread = new Map(threads.map((thread) => [String(thread.id), { firstInbound: null, replies: [] }]));
  for (const message of messages) {
    const entry = byThread.get(String(message.thread_id));
    const time = Date.parse(message.created_at || '');
    if (!entry || !Number.isFinite(time)) continue;
    if (message.direction === 'inbound') {
      if (entry.firstInbound === null || time < entry.firstInbound) entry.firstInbound = time;
    } else if (isPersonReply(message)) {
      entry.replies.push(time);
    }
  }
  const samples = [];
  let eligible = 0;
  for (const { firstInbound, replies } of byThread.values()) {
    if (firstInbound === null) continue;
    eligible += 1;
    const answers = replies.filter((time) => time >= firstInbound);
    if (answers.length) samples.push((Math.min(...answers) - firstInbound) / 60000);
  }
  const replied = samples.length;
  return {
    state: eligible === 0 ? 'no_conversations' : replied === 0 ? 'no_replies' : 'measured',
    basis: RESPONSE_TIME_BASIS,
    eligible,
    replied,
    unreplied: eligible - replied,
    measured: replied,
    average_minutes: replied ? Math.round((samples.reduce((sum, value) => sum + value, 0) / replied) * 10) / 10 : null,
    median_minutes: replied ? percentile(samples, 50) : null,
    p95_minutes: replied ? percentile(samples, 95) : null,
  };
}

function unavailableResponseTime() {
  return {
    state: 'unavailable',
    basis: RESPONSE_TIME_BASIS,
    eligible: null,
    replied: null,
    unreplied: null,
    measured: null,
    average_minutes: null,
    median_minutes: null,
    p95_minutes: null,
  };
}

function emptyAnalytics(rowCap) {
  return {
    bounded: true,
    row_cap: rowCap,
    conversations: { total: 0, active: 0, converted: 0, conversion_rate_pct: 0, unique_participants: 0, by_workflow: {}, by_funnel_stage: {} },
    marketplace: { conversations: 0, converted: 0, inquiry_to_next_step_pct: 0 },
    response_time: measureResponseTimes([], []),
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
    const messageCap = Math.min(rowCap, RESPONSE_MESSAGE_CAP);
    const [events, notifications, derivations, campaignDeliveries, responseMessages] = await Promise.all([
      scopedThreadIds.length ? this.repository.list('conversation_events', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      scopedThreadIds.length ? this.repository.list('notification_queue', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      scopedThreadIds.length ? this.repository.list('message_derivations', { thread_id: scopedThreadIds }, { limit: rowCap }) : [],
      this.repository.list('communication_campaign_deliveries', tenantId ? { user_id: userId, tenant_id: tenantId } : { user_id: userId }, { limit: rowCap }).catch(() => []),
      // A failed message read makes the response time unavailable; it never fails the other metrics
      // and never becomes a zero.
      scopedThreadIds.length
        ? this.repository.list(
          'messages',
          { thread_id: scopedThreadIds, direction: ['inbound', 'outbound'] },
          { select: RESPONSE_MESSAGE_COLUMNS, order: { column: 'created_at', ascending: true }, limit: messageCap },
        ).catch(() => null)
        : [],
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
    }
    conversations.conversion_rate_pct = percent(conversations.converted, conversations.total);
    marketplace.inquiry_to_next_step_pct = percent(marketplace.converted, marketplace.conversations);
    const responseTime = !Array.isArray(responseMessages) || responseMessages.length >= messageCap
      ? unavailableResponseTime()
      : measureResponseTimes(threads, responseMessages);

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
