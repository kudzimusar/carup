import { createHash, randomUUID } from 'crypto';
import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';

const MAX_RECIPIENTS = Math.max(1, Math.min(Number(process.env.COMMUNICATION_CAMPAIGN_MAX_RECIPIENTS || 500), 5000));
const SENDABLE_STATUSES = new Set(['approved', 'running']);
const DELIVERED_STATUSES = new Set(['queued', 'sent', 'delivered', 'read', 'converted']);

function campaignError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizedCode(value) {
  const code = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!code || code.length > 80) throw campaignError(400, 'campaign_code must be 1-80 URL-safe characters.', 'communication_campaign_code_invalid');
  return code;
}

function safeSegment(value) {
  const segment = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const userIds = Array.isArray(segment.user_ids) ? [...new Set(segment.user_ids.map(String).filter(Boolean))] : [];
  const stakeholderRoles = Array.isArray(segment.stakeholder_roles)
    ? [...new Set(segment.stakeholder_roles.map((v) => String(v).trim()).filter(Boolean))]
    : [];
  if (!userIds.length && !stakeholderRoles.length) {
    throw campaignError(400, 'Campaign segment must explicitly identify user_ids or stakeholder_roles.', 'communication_campaign_segment_required');
  }
  if (userIds.length > MAX_RECIPIENTS) {
    throw campaignError(400, `Campaign segment exceeds ${MAX_RECIPIENTS} recipients.`, 'communication_campaign_segment_too_large');
  }
  return { ...segment, user_ids: userIds, stakeholder_roles: stakeholderRoles };
}

function deterministicVariant(campaignId, userId, variants = []) {
  const active = Array.isArray(variants) && variants.length ? variants : [{ key: 'control', weight: 1 }];
  const expanded = [];
  for (const variant of active) {
    const weight = Math.max(1, Math.min(Number(variant?.weight || 1), 100));
    for (let index = 0; index < weight; index += 1) expanded.push(variant);
  }
  const digest = createHash('sha256').update(`${campaignId}:${userId}`).digest();
  return expanded[digest.readUInt32BE(0) % expanded.length] || active[0];
}

function addCount(target, key, amount = 1) {
  const label = String(key || 'unknown');
  target[label] = Number(target[label] || 0) + amount;
}

function percent(n, d) {
  return d ? Math.round((Number(n) / Number(d)) * 1000) / 10 : 0;
}

function variablesFor(campaign, user, variant) {
  return {
    first_name: String(user?.name || '').trim().split(/\s+/)[0] || '',
    campaign_name: campaign.name,
    campaign_code: campaign.campaign_code,
    ...(campaign.template_variables || {}),
    ...(variant?.template_variables || {}),
  };
}

export class CommunicationCampaignService {
  constructor({ repository, threadService, conversationService, preferenceService, notificationService, templateService, unsubscribeService = null } = {}) {
    this.repository = repository;
    this.unsubscribeService = unsubscribeService;
    this.threadService = threadService;
    this.conversationService = conversationService;
    this.preferenceService = preferenceService;
    this.notificationService = notificationService;
    this.templateService = templateService;
  }

  async assertMarketingTemplate(templateKey, channel, language = 'en') {
    const template = await this.repository.findOne('communication_templates', { template_key: templateKey });
    if (!template || template.status !== 'active' || template.classification !== 'marketing') {
      throw campaignError(400, 'Campaigns require an active governed template classified as marketing.', 'communication_campaign_template_not_marketing');
    }
    await this.templateService.resolveGovernedVersion(templateKey, { channel, language });
    return template;
  }

  async createCampaign(input = {}, actor = {}) {
    const campaignCode = normalizedCode(input.campaign_code || input.code);
    const name = String(input.name || '').trim();
    if (!name) throw campaignError(400, 'Campaign name is required.', 'communication_campaign_name_required');
    const templateKey = String(input.template_key || '').trim();
    if (!templateKey) throw campaignError(400, 'A governed marketing template is required.', 'communication_campaign_template_required');
    const channel = normalizeChannel(input.channel) || 'in_app';
    const language = String(input.language || 'en').trim() || 'en';
    const segment = safeSegment(input.segment_definition || input.segment || {});
    await this.assertMarketingTemplate(templateKey, channel, language);

    const tenantId = input.tenant_id || actor.tenantId || null;
    const existing = await this.repository.findOne('communication_campaigns', { tenant_id: tenantId, campaign_code: campaignCode }).catch(() => null);
    if (existing) throw campaignError(409, 'campaign_code already exists for this tenant.', 'communication_campaign_code_exists');

    return this.repository.insert('communication_campaigns', {
      id: randomUUID(),
      tenant_id: tenantId,
      campaign_code: campaignCode,
      name,
      business_workflow: input.business_workflow || 'growth',
      classification: 'marketing',
      template_key: templateKey,
      channel,
      language,
      segment_definition: segment,
      template_variables: input.template_variables || {},
      send_window_start: input.send_window_start || null,
      send_window_end: input.send_window_end || null,
      frequency_cap_count: Math.max(1, Math.min(Number(input.frequency_cap_count || 1), 20)),
      frequency_cap_window_hours: Math.max(1, Math.min(Number(input.frequency_cap_window_hours || 168), 24 * 365)),
      experiment_variants: Array.isArray(input.experiment_variants) ? input.experiment_variants : [],
      attribution: input.attribution || {},
      promotion_id: input.promotion_id || null,
      status: 'draft',
      approved_by: null,
      approved_at: null,
      created_by: actor.id || actor.userId || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  async approveCampaign(campaignId, actor = {}) {
    const campaign = await this.repository.findOne('communication_campaigns', { id: campaignId });
    if (!campaign) throw campaignError(404, 'Campaign not found.', 'communication_campaign_not_found');
    if (!['draft', 'paused'].includes(campaign.status)) {
      throw campaignError(409, `Campaign cannot be approved from ${campaign.status}.`, 'communication_campaign_status_invalid');
    }
    const rendered = await this.templateService.resolveGovernedVersion(campaign.template_key, {
      channel: campaign.channel,
      language: campaign.language || 'en',
    });
    if (!rendered.template || rendered.template.classification !== 'marketing') {
      throw campaignError(409, 'Campaign template is no longer an active marketing template.', 'communication_campaign_template_not_marketing');
    }
    if (campaign.channel === 'whatsapp' && !rendered.version?.provider_template_reference) {
      throw campaignError(409, 'WhatsApp marketing campaigns require a real approved provider template reference.', 'communication_campaign_provider_template_not_configured');
    }
    return this.repository.updateById('communication_campaigns', campaign.id, {
      status: 'approved',
      approved_by: actor.id || actor.userId || 'admin',
      approved_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  async listCampaigns({ tenantId = null, limit = 100 } = {}) {
    return this.repository.list('communication_campaigns', tenantId ? { tenant_id: tenantId } : {}, {
      order: { column: 'created_at', ascending: false },
      limit: Math.min(Number(limit || 100), 500),
    });
  }

  async resolveSegment(campaign) {
    const segment = safeSegment(campaign.segment_definition || {});
    let users = [];
    if (segment.user_ids.length) {
      users = await this.repository.list('users', { id: segment.user_ids }, { limit: MAX_RECIPIENTS });
    } else if (segment.stakeholder_roles.length) {
      users = await this.repository.list('users', { role: segment.stakeholder_roles }, { limit: MAX_RECIPIENTS });
    }
    if (campaign.tenant_id) {
      users = users.filter((user) => !user.active_tenant_id || String(user.active_tenant_id) === String(campaign.tenant_id));
    }
    if (segment.stakeholder_roles.length) {
      const allowed = new Set(segment.stakeholder_roles);
      users = users.filter((user) => allowed.has(String(user.role || user.stakeholder_role || '')));
    }
    return users.slice(0, MAX_RECIPIENTS);
  }

  async frequencyCapped(userId, campaign) {
    const recent = await this.repository.list('communication_campaign_deliveries', { user_id: userId }, { limit: 500 }).catch(() => []);
    const cutoff = Date.now() - Number(campaign.frequency_cap_window_hours || 168) * 60 * 60 * 1000;
    const touches = recent.filter((row) => {
      const timestamp = Date.parse(row.created_at || 0);
      return timestamp >= cutoff && row.status !== 'suppressed' && row.status !== 'cancelled';
    });
    return touches.length >= Number(campaign.frequency_cap_count || 1);
  }

  async resolveRecipient(user, campaign) {
    const prefs = await this.preferenceService.getPreferences(user.id, campaign.tenant_id || null);
    if (!this.preferenceService.isChannelAllowed(prefs, campaign.channel, { transactional: false })) {
      return { allowed: false, reason: 'marketing_or_channel_consent_disabled', prefs };
    }
    if (await this.frequencyCapped(user.id, campaign)) {
      return { allowed: false, reason: 'frequency_cap', prefs };
    }
    if (campaign.channel === 'in_app') {
      return { allowed: true, recipientUserId: user.id, recipientIdentityId: null, provider: null, payload: {} };
    }

    // G3. This used to be `.catch(() => [])`, which is a fail-open with an ACTIVE FALLBACK — worse
    // than a bare one. A `channel_identities` fault did not merely skip the opted_out/revoked and
    // verified filters below; it then substituted `user.email` and mailed marketing to an address
    // whose channel identity may say opted_out. Failing to read consent is not consent.
    let identities;
    try {
      identities = await this.repository.list('channel_identities', { user_id: user.id, channel: campaign.channel }, { limit: 20 });
    } catch (_error) {
      return { allowed: false, reason: 'channel_consent_state_unavailable', prefs };
    }
    const identity = (identities || [])
      .filter((row) => !['opted_out', 'revoked'].includes(row.consent_status))
      .filter((row) => row.verified !== false)
      .sort((a, b) => (Date.parse(b.last_seen_at || b.updated_at || 0) || 0) - (Date.parse(a.last_seen_at || a.updated_at || 0) || 0))[0] || null;
    let address = identity?.normalized_address || identity?.external_id || null;
    if (!address && campaign.channel === 'email') address = user.email || null;
    if (!address) return { allowed: false, reason: 'no_governed_channel_identity', prefs };

    const payload = { address, external_id: identity?.external_id || address };
    if (campaign.channel === 'email') payload.email = address;
    if (campaign.channel === 'whatsapp' || campaign.channel === 'sms') payload.phone_number = address;
    if (campaign.channel === 'telegram') payload.telegram_chat_id = identity?.external_id || address;
    if (campaign.channel === 'push') payload.push_token = identity?.external_id || address;
    return {
      allowed: true,
      recipientUserId: user.id,
      recipientIdentityId: identity?.id || null,
      provider: identity?.provider || null,
      payload,
    };
  }

  async ensureCampaignConversation(campaign, user) {
    const threadKey = buildDedupeKey(['communications-2', 'campaign', campaign.id, user.id]);
    let { thread } = await this.threadService.resolveOrCreateThread({
      tenant_id: campaign.tenant_id || null,
      thread_key: threadKey,
      thread_type: 'general',
      subject_type: 'campaign',
      subject_id: campaign.id,
      primary_user_id: user.id,
      primary_channel: campaign.channel,
      priority: 'low',
      metadata: { campaign_id: campaign.id, campaign_code: campaign.campaign_code },
    });
    thread = await this.repository.updateById('message_threads', thread.id, {
      business_workflow: campaign.business_workflow || 'growth',
      conversation_type: 'campaign',
      funnel_stage: 'reengagement',
      metadata: { ...(thread.metadata || {}), campaign_id: campaign.id, campaign_code: campaign.campaign_code, marketing: true },
      updated_at: nowIso(),
    });
    await this.conversationService.ensureParticipant(thread.id, {
      participant_type: 'user', user_id: user.id, stakeholder_role: 'customer', permissions: { read: true, send: true },
    });
    await this.conversationService.ensureParticipant(thread.id, {
      participant_type: 'system', stakeholder_role: 'campaign_system', display_name: 'CarUp', permissions: { read: false, send: false },
      metadata: { campaign_id: campaign.id },
    });
    return thread;
  }

  async recordSuppression(campaign, user, reason, variant) {
    const key = `campaign:${campaign.id}:${user.id}:${variant?.key || 'control'}`;
    const existing = await this.repository.findOne('communication_campaign_deliveries', { idempotency_key: key }).catch(() => null);
    if (existing) return existing;
    return this.repository.insert('communication_campaign_deliveries', {
      id: randomUUID(), campaign_id: campaign.id, tenant_id: campaign.tenant_id || null, user_id: user.id,
      participant_id: null, thread_id: null, message_id: null, notification_id: null,
      channel: campaign.channel, variant_key: variant?.key || 'control', idempotency_key: key,
      status: 'suppressed', suppression_reason: reason, provider_message_id: null,
      cost_amount: null, cost_currency: null, conversion_value: null, conversion_currency: null,
      metadata: { consent_checked: true, frequency_checked: true }, created_at: nowIso(), updated_at: nowIso(),
    });
  }

  async executeCampaign(campaignId, actor = {}) {
    let campaign = await this.repository.findOne('communication_campaigns', { id: campaignId });
    if (!campaign) throw campaignError(404, 'Campaign not found.', 'communication_campaign_not_found');
    if (!SENDABLE_STATUSES.has(campaign.status)) {
      throw campaignError(409, 'Campaign must be approved before execution.', 'communication_campaign_not_approved');
    }
    const now = Date.now();
    if (campaign.send_window_start && Date.parse(campaign.send_window_start) > now) throw campaignError(409, 'Campaign send window has not opened.', 'communication_campaign_window_closed');
    if (campaign.send_window_end && Date.parse(campaign.send_window_end) < now) throw campaignError(409, 'Campaign send window has ended.', 'communication_campaign_window_closed');
    if (campaign.status === 'approved') {
      campaign = await this.repository.updateById('communication_campaigns', campaign.id, { status: 'running', updated_at: nowIso() });
    }

    const users = await this.resolveSegment(campaign);
    const result = { campaign_id: campaign.id, campaign_code: campaign.campaign_code, targeted: users.length, queued: 0, suppressed: 0, existing: 0, errors: [] };
    for (const user of users) {
      const variant = deterministicVariant(campaign.id, user.id, campaign.experiment_variants);
      const idempotencyKey = `campaign:${campaign.id}:${user.id}:${variant?.key || 'control'}`;
      const existing = await this.repository.findOne('communication_campaign_deliveries', { idempotency_key: idempotencyKey }).catch(() => null);
      if (existing) {
        result.existing += 1;
        continue;
      }
      try {
        const route = await this.resolveRecipient(user, campaign);
        if (!route.allowed) {
          await this.recordSuppression(campaign, user, route.reason, variant);
          result.suppressed += 1;
          continue;
        }
        const thread = await this.ensureCampaignConversation(campaign, user);
        const participant = await this.conversationService.participantForUser(thread.id, user.id);
        // Mint the governed unsubscribe handle BEFORE queueing, so the recipient's own copy of the
        // message carries a working control. The marketing adapter refuses any send that arrives
        // without one, so a failure here suppresses the send rather than shipping an unstoppable
        // marketing Email.
        let unsubscribe = null;
        if (campaign.channel === 'email' && this.unsubscribeService && route.payload?.email) {
          unsubscribe = await this.unsubscribeService.issue({
            address: route.payload.email,
            tenantId: campaign.tenant_id || thread.tenant_id || 'platform',
            userId: route.recipientUserId || user.id || null,
            identityId: route.recipientIdentityId || null,
            campaignId: campaign.id,
          });
        }
        // Mint the delivery id BEFORE queueing, not when the row is written below.
        // The marketing adapter refuses `campaign_context_missing` without it, and provider-side
        // reconciliation looks deliveries up by it — so the id on the wire and the id in the
        // deliveries table have to be the same value, which means it has to exist first.
        const deliveryId = randomUUID();
        const queued = await this.notificationService.queueNotification({
          recipientUserId: route.recipientUserId,
          recipientIdentityId: route.recipientIdentityId,
          thread,
          channel: campaign.channel,
          provider: route.provider,
          notificationType: 'campaign_message',
          templateKey: campaign.template_key,
          variables: variablesFor(campaign, user, variant),
          language: campaign.language || 'en',
          transactional: false,
          classification: campaign.classification || 'marketing',
          fallbackChannels: [],
          priority: 'low',
          dedupeParts: ['campaign', campaign.id, user.id, variant?.key || 'control', campaign.channel],
          payload: {
            ...route.payload,
            // The governed classification, carried onto the payload the transport layer actually
            // reads. It lived only on the campaign row, so every marketing safeguard keyed on
            // `payload.classification` — provider routing, send-time consent, the unsubscribe
            // requirement, the fail-closed marketing adapter — was unreachable from a real
            // campaign. Implemented is not the same as wired.
            classification: campaign.classification || 'marketing',
            campaign_id: campaign.id,
            campaign_delivery_id: deliveryId,
            campaign_code: campaign.campaign_code,
            variant: variant?.key || 'control',
            attribution: campaign.attribution || {},
            promotion_id: campaign.promotion_id || null,
            ...(unsubscribe ? { unsubscribe_url: unsubscribe.url, unsubscribe_mailto: unsubscribe.mailto } : {}),
          },
        });
        await this.repository.insert('communication_campaign_deliveries', {
          id: deliveryId, campaign_id: campaign.id, tenant_id: campaign.tenant_id || null, user_id: user.id,
          participant_id: participant?.id || null, thread_id: thread.id, message_id: queued.message?.id || null,
          notification_id: queued.notification?.id == null ? null : String(queued.notification.id),
          channel: campaign.channel, variant_key: variant?.key || 'control', idempotency_key: idempotencyKey,
          status: queued.notification?.status === 'suppressed' ? 'suppressed' : 'queued',
          suppression_reason: queued.notification?.metadata?.suppression_reason || null,
          provider_message_id: null, cost_amount: variant?.cost_amount == null ? null : Number(variant.cost_amount),
          cost_currency: variant?.cost_currency || null, conversion_value: null, conversion_currency: null,
          metadata: { template_key: campaign.template_key, consent_checked: true, frequency_checked: true, attribution: campaign.attribution || {} },
          created_at: nowIso(), updated_at: nowIso(),
        });
        await this.conversationService.recordAnalytics({
          threadId: thread.id,
          messageId: queued.message?.id || null,
          participantId: participant?.id || null,
          eventType: queued.notification?.status === 'suppressed' ? 'campaign_suppressed' : 'campaign_queued',
          workflow: campaign.business_workflow || 'growth',
          funnelStage: 'campaign',
          attribution: { ...(campaign.attribution || {}), campaign_code: campaign.campaign_code },
          metadata: { campaign_id: campaign.id, variant: variant?.key || 'control' },
        });
        if (queued.notification?.status === 'suppressed') result.suppressed += 1;
        else result.queued += 1;
      } catch (error) {
        result.errors.push({ user_id: user.id, code: error.code || 'campaign_recipient_error', message: error.message });
      }
    }
    return result;
  }

  async recordConversion(campaignId, input = {}) {
    const campaign = await this.repository.findOne('communication_campaigns', { id: campaignId });
    if (!campaign) throw campaignError(404, 'Campaign not found.', 'communication_campaign_not_found');
    const userId = String(input.user_id || '').trim();
    if (!userId) throw campaignError(400, 'user_id is required for campaign conversion.', 'communication_campaign_user_required');
    const deliveries = await this.repository.list('communication_campaign_deliveries', { campaign_id: campaignId, user_id: userId }, {
      order: { column: 'created_at', ascending: false }, limit: 20,
    });
    const delivery = deliveries.find((row) => DELIVERED_STATUSES.has(row.status)) || deliveries[0];
    if (!delivery) throw campaignError(404, 'No campaign delivery exists for this user.', 'communication_campaign_delivery_not_found');
    const updated = await this.repository.updateById('communication_campaign_deliveries', delivery.id, {
      status: 'converted', converted_at: nowIso(),
      conversion_value: input.value == null ? delivery.conversion_value : Number(input.value),
      conversion_currency: input.currency || delivery.conversion_currency || null,
      metadata: { ...(delivery.metadata || {}), conversion_reference: input.reference || null }, updated_at: nowIso(),
    });
    if (delivery.thread_id) {
      await this.conversationService.recordAnalytics({
        threadId: delivery.thread_id,
        messageId: delivery.message_id || null,
        participantId: delivery.participant_id || null,
        eventType: 'campaign_conversion',
        workflow: campaign.business_workflow || 'growth',
        funnelStage: 'converted',
        attribution: { ...(campaign.attribution || {}), campaign_code: campaign.campaign_code },
        metadata: { campaign_id: campaign.id, delivery_id: delivery.id, value: input.value ?? null, currency: input.currency || null },
      });
    }
    return updated;
  }

  async report(campaignId) {
    const campaign = await this.repository.findOne('communication_campaigns', { id: campaignId });
    if (!campaign) throw campaignError(404, 'Campaign not found.', 'communication_campaign_not_found');
    const deliveries = await this.repository.list('communication_campaign_deliveries', { campaign_id: campaignId }, { limit: 5000 });
    const report = {
      campaign_id: campaign.id, campaign_code: campaign.campaign_code, total: deliveries.length,
      queued: 0, suppressed: 0, delivered: 0, read: 0, converted: 0,
      conversion_rate_pct: 0, conversion_value: 0, cost: 0, roi_pct: null,
      by_variant: {}, by_suppression_reason: {},
    };
    for (const row of deliveries) {
      if (row.status === 'queued') report.queued += 1;
      if (row.status === 'suppressed') report.suppressed += 1;
      if (['delivered', 'read', 'converted'].includes(row.status)) report.delivered += 1;
      if (['read', 'converted'].includes(row.status)) report.read += 1;
      if (row.status === 'converted') report.converted += 1;
      report.conversion_value += Number(row.conversion_value || 0);
      report.cost += Number(row.cost_amount || 0);
      addCount(report.by_variant, row.variant_key || 'control');
      if (row.suppression_reason) addCount(report.by_suppression_reason, row.suppression_reason);
    }
    report.conversion_rate_pct = percent(report.converted, report.total - report.suppressed);
    report.conversion_value = Math.round(report.conversion_value * 100) / 100;
    report.cost = Math.round(report.cost * 100) / 100;
    if (report.cost > 0) report.roi_pct = Math.round(((report.conversion_value - report.cost) / report.cost) * 1000) / 10;
    return report;
  }
}
