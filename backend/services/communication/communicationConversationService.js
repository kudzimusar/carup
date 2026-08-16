import { buildDedupeKey, nowIso, normalizeChannel } from './communicationUtils.js';

const MAX_MESSAGE_LENGTH = 10_000;
const SEND_PERMISSION = 'send';
const READ_PERMISSION = 'read';

function actorUserId(actor = {}) {
  return actor.id || actor.userId || actor.actor_user_id || null;
}

function can(participant, permission) {
  const permissions = participant?.permissions || {};
  return permissions[permission] !== false;
}

function safeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata;
}

function bindingTime(binding = {}) {
  return Date.parse(binding.last_used_at || binding.updated_at || binding.created_at || 0) || 0;
}

function safeParticipantProjection(participant, selfId) {
  return {
    id: participant.id,
    participant_type: participant.participant_type,
    stakeholder_role: participant.stakeholder_role || participant.role || 'participant',
    display_name: participant.display_name || null,
    is_self: Boolean(selfId && participant.user_id === selfId),
    joined_at: participant.joined_at || null,
    left_at: participant.left_at || null,
    last_read_at: participant.last_read_at || null,
  };
}

export class CommunicationConversationService {
  constructor({ repository, threadService, identityService, notificationService } = {}) {
    this.repository = repository;
    this.threadService = threadService;
    this.identityService = identityService;
    this.notificationService = notificationService;
  }

  async activeParticipants(threadId) {
    const participants = await this.repository.list('message_participants', { thread_id: threadId });
    return participants.filter((participant) => !participant.left_at);
  }

  async participantForUser(threadId, userId) {
    if (!userId) return null;
    const participants = await this.activeParticipants(threadId);
    return participants.find((participant) => participant.user_id === userId) || null;
  }

  async assertParticipantAccess(threadId, actor = {}, permission = READ_PERMISSION) {
    const userId = actorUserId(actor);
    if (!userId) {
      const error = new Error('Authentication required.');
      error.statusCode = 401;
      throw error;
    }
    const thread = await this.repository.findOne('message_threads', { id: threadId });
    if (!thread) {
      const error = new Error('Conversation not found.');
      error.statusCode = 404;
      throw error;
    }
    const participant = await this.participantForUser(threadId, userId);
    if (!participant || !can(participant, permission)) {
      // Fail closed without disclosing whether a guessed conversation id exists.
      const error = new Error('Conversation not found.');
      error.statusCode = 404;
      throw error;
    }
    return { thread, participant };
  }

  async ensureParticipant(threadId, input = {}) {
    const participants = await this.activeParticipants(threadId);
    let existing = null;
    if (input.user_id) existing = participants.find((row) => row.user_id === input.user_id) || null;
    if (!existing && input.external_identity_id) {
      existing = participants.find((row) => row.external_identity_id === input.external_identity_id) || null;
    }
    const role = input.stakeholder_role || input.role || existing?.stakeholder_role || existing?.role || 'participant';
    const permissions = { read: true, send: true, ...(existing?.permissions || {}), ...(input.permissions || {}) };
    if (existing) {
      return this.repository.updateById('message_participants', existing.id, {
        participant_type: input.participant_type || existing.participant_type,
        user_id: input.user_id || existing.user_id || null,
        external_identity_id: input.external_identity_id || existing.external_identity_id || null,
        role,
        stakeholder_role: role,
        display_name: input.display_name || existing.display_name || null,
        permissions,
        notification_policy: input.notification_policy || existing.notification_policy || {},
        channel_preference_override: input.channel_preference_override || existing.channel_preference_override || null,
        metadata: { ...(existing.metadata || {}), ...(input.metadata || {}) },
      });
    }
    return this.repository.insert('message_participants', {
      thread_id: threadId,
      participant_type: input.participant_type || (input.user_id ? 'user' : 'external_contact'),
      user_id: input.user_id || null,
      admin_id: input.admin_id || null,
      external_identity_id: input.external_identity_id || null,
      role,
      stakeholder_role: role,
      display_name: input.display_name || null,
      joined_at: nowIso(),
      last_read_at: input.last_read_at || null,
      notification_muted: Boolean(input.notification_muted),
      permissions,
      notification_policy: input.notification_policy || {},
      channel_preference_override: input.channel_preference_override || null,
      metadata: input.metadata || {},
    });
  }

  async listConversationsForUser(userId) {
    if (!userId) return [];
    const participants = (await this.repository.list('message_participants', { user_id: userId }))
      .filter((row) => !row.left_at && can(row, READ_PERMISSION));
    const unique = new Map();
    for (const participant of participants) {
      if (!unique.has(participant.thread_id)) unique.set(participant.thread_id, participant);
    }
    const conversations = [];
    for (const [threadId, participant] of unique.entries()) {
      const thread = await this.repository.findOne('message_threads', { id: threadId });
      if (!thread) continue;
      const messages = (await this.repository.list('messages', { thread_id: threadId }, { order: { column: 'created_at', ascending: true } }))
        .filter((message) => message.direction !== 'internal');
      const latest = messages.at(-1) || null;
      const readAt = participant.last_read_at ? Date.parse(participant.last_read_at) : 0;
      const unread = messages.filter((message) => {
        if (message.sender_participant_id === participant.id) return false;
        return (Date.parse(message.created_at || 0) || 0) > readAt;
      }).length;
      conversations.push({
        id: thread.id,
        thread_type: thread.thread_type,
        conversation_type: thread.thread_type,
        business_workflow: thread.business_workflow || thread.thread_type,
        subject_type: thread.subject_type || null,
        subject_id: thread.subject_id || null,
        marketplace_listing_id: thread.marketplace_listing_id || null,
        status: thread.status,
        priority: thread.priority,
        primary_channel: thread.primary_channel || null,
        funnel_stage: thread.funnel_stage || null,
        conversion_status: thread.conversion_status || null,
        last_message_at: thread.last_message_at || latest?.created_at || null,
        updated_at: thread.updated_at,
        created_at: thread.created_at,
        participant_role: participant.stakeholder_role || participant.role || 'participant',
        unread_count: unread,
        latest_message: latest ? {
          id: latest.id,
          text: latest.content_text || '',
          created_at: latest.created_at,
          channel: latest.channel,
          ai_generated: Boolean(latest.ai_generated),
        } : null,
      });
    }
    conversations.sort((a, b) => Date.parse(b.last_message_at || b.updated_at || 0) - Date.parse(a.last_message_at || a.updated_at || 0));
    return conversations;
  }

  async getConversation(threadId, actor = {}) {
    const { thread, participant } = await this.assertParticipantAccess(threadId, actor, READ_PERMISSION);
    const participants = await this.activeParticipants(thread.id);
    const messages = (await this.repository.list('messages', { thread_id: thread.id }, { order: { column: 'created_at', ascending: true } }))
      .filter((message) => message.direction !== 'internal');
    const participantById = new Map(participants.map((row) => [row.id, row]));
    return {
      thread: {
        id: thread.id,
        thread_type: thread.thread_type,
        conversation_type: thread.thread_type,
        business_workflow: thread.business_workflow || thread.thread_type,
        subject_type: thread.subject_type || null,
        subject_id: thread.subject_id || null,
        marketplace_listing_id: thread.marketplace_listing_id || null,
        status: thread.status,
        priority: thread.priority,
        funnel_stage: thread.funnel_stage || null,
        conversion_status: thread.conversion_status || null,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        last_message_at: thread.last_message_at || null,
      },
      participants: participants.map((row) => safeParticipantProjection(row, actorUserId(actor))),
      messages: messages.map((message) => {
        const author = participantById.get(message.sender_participant_id) || null;
        return {
          id: message.id,
          text: message.content_text || '',
          message_type: message.message_type,
          channel: message.channel,
          source_channel: message.channel,
          created_at: message.created_at,
          status: message.status,
          reply_to_message_id: message.in_reply_to_message_id || null,
          ai_generated: Boolean(message.ai_generated),
          human_approved: Boolean(message.human_approved),
          author: author ? safeParticipantProjection(author, actorUserId(actor)) : null,
          content: message.content_json || {},
        };
      }),
      self_participant_id: participant.id,
    };
  }

  async markRead(threadId, actor = {}) {
    const { participant } = await this.assertParticipantAccess(threadId, actor, READ_PERMISSION);
    return this.repository.updateById('message_participants', participant.id, { last_read_at: nowIso() });
  }

  async bindParticipantChannel({ thread, participant, identity, channel, provider = null, externalConversationId = null, transactionalConsent = false, marketingConsent = false, primary = false, metadata = {} } = {}) {
    if (!thread?.id || !participant?.id || !identity?.id) throw new Error('Conversation, participant and identity are required for a channel binding.');
    const normalizedChannel = normalizeChannel(channel || identity.channel);
    const bindings = await this.repository.list('conversation_channel_bindings', {
      thread_id: thread.id,
      participant_id: participant.id,
      channel_identity_id: identity.id,
    });
    const existing = bindings.find((row) => row.channel === normalizedChannel && (row.provider || null) === (provider || identity.provider || null));
    const patch = {
      channel: normalizedChannel,
      provider: provider || identity.provider || null,
      external_conversation_id: externalConversationId || existing?.external_conversation_id || null,
      routing_purpose: 'transactional',
      can_send: true,
      can_receive: true,
      transactional_consent: Boolean(transactionalConsent || existing?.transactional_consent),
      marketing_consent: Boolean(marketingConsent || existing?.marketing_consent),
      is_primary: Boolean(primary || existing?.is_primary),
      metadata: { ...(existing?.metadata || {}), ...metadata },
      updated_at: nowIso(),
    };
    if (existing) return this.repository.updateById('conversation_channel_bindings', existing.id, patch);
    return this.repository.insert('conversation_channel_bindings', {
      thread_id: thread.id,
      participant_id: participant.id,
      channel_identity_id: identity.id,
      ...patch,
      last_outbound_message_id: null,
      last_inbound_message_id: null,
      last_used_at: null,
      expires_at: null,
      created_at: nowIso(),
    });
  }

  async resolveInboundConversation({ identity, channel, provider } = {}) {
    if (!identity?.id) return null;
    const normalizedChannel = normalizeChannel(channel || identity.channel);
    const candidates = (await this.repository.list('conversation_channel_bindings', { channel_identity_id: identity.id }))
      .filter((row) => row.can_receive !== false)
      .filter((row) => row.channel === normalizedChannel)
      .filter((row) => !provider || !row.provider || row.provider === provider)
      .filter((row) => !row.expires_at || Date.parse(row.expires_at) > Date.now())
      .sort((a, b) => bindingTime(b) - bindingTime(a));

    if (!candidates.length) {
      // No binding for THIS identity row. That is the normal state for a provider callback:
      // channel identities are tenant-scoped, a public webhook arrives in platform context, so
      // resolveOrCreateIdentity mints a second identity for an address a tenant conversation
      // already owns. Routing on that identity alone would open a shadow conversation for a
      // customer who is already in one.
      return this.resolveProviderIngressConversation({ identity, channel: normalizedChannel, provider });
    }

    if (candidates.length > 1 && bindingTime(candidates[0]) === bindingTime(candidates[1])) {
      // Ambiguous identity with no recency signal: never guess across business conversations.
      return null;
    }
    const binding = candidates[0];
    const thread = await this.repository.findOne('message_threads', { id: binding.thread_id });
    const participant = await this.repository.findOne('message_participants', { id: binding.participant_id });
    if (!thread || !participant || participant.left_at) return null;
    return { thread, participant, binding };
  }

  /**
   * Route a provider callback to an existing canonical conversation held under a DIFFERENT tenant's
   * channel identity for the same real-world address.
   *
   * This is deliberately narrow, and exists only for provider ingress:
   *
   *  · the address must match exactly, on the stored normalized_address — never a raw string
   *    compare and never a prefix/fuzzy match. The match is expressed as a DATABASE filter, not as
   *    a JavaScript pass over a bounded page: scanning "the first N identities on this channel"
   *    would silently stop finding the right customer once N is exceeded, which is the original
   *    shadow-conversation defect returning under load;
   *  · channel and provider must match exactly. A null or different provider is NOT compatible —
   *    this is provider ingress, so the provider is known, and treating "unset" as "matches" would
   *    let an unrelated identity answer a Meta callback;
   *  · it only ROUTES. Nothing here reassigns tenant ownership, merges identities, or copies one
   *    tenant's identity into another. The inbound message lands on the conversation that already
   *    owns the customer, which is the conversation the customer is actually in;
   *  · exactly one conversation AND one participant must remain, or it fails closed. Two
   *    participants inside one thread is still two different people, and resolving that by recency
   *    would attribute one customer's message to another.
   */
  async resolveProviderIngressConversation({ identity, channel, provider } = {}) {
    const address = String(identity?.normalized_address || '').trim();
    if (!address) return null;
    const normalizedChannel = normalizeChannel(channel || identity.channel);
    if (!normalizedChannel || !provider) return null;

    // The routing key is applied at the database boundary. No arbitrary LIMIT is used as a
    // correctness boundary.
    const siblings = (await this.repository.list('channel_identities', {
      channel: normalizedChannel,
      provider,
      normalized_address: address,
    }).catch(() => []))
      .filter((row) => String(row.id) !== String(identity.id))
      .filter((row) => row.consent_status !== 'opted_out' && row.consent_status !== 'revoked');
    if (!siblings.length) return null;

    const routes = [];
    for (const sibling of siblings) {
      const bindings = (await this.repository.list('conversation_channel_bindings', { channel_identity_id: sibling.id })
        .catch(() => []))
        .filter((row) => row.can_receive !== false)
        .filter((row) => row.channel === normalizedChannel)
        .filter((row) => row.provider === provider)
        .filter((row) => !row.expires_at || Date.parse(row.expires_at) > Date.now());
      for (const binding of bindings) routes.push({ binding, identity: sibling });
    }
    if (!routes.length) return null;

    // Several bindings are fine only when they converge on the same conversation AND the same
    // person. Either kind of divergence is genuine ambiguity and fails closed.
    const threadIds = new Set(routes.map((r) => String(r.binding.thread_id)));
    const participantIds = new Set(routes.map((r) => String(r.binding.participant_id)));
    if (threadIds.size !== 1 || participantIds.size !== 1) return null;

    const chosen = routes.sort((a, b) => bindingTime(b.binding) - bindingTime(a.binding))[0];
    const thread = await this.repository.findOne('message_threads', { id: chosen.binding.thread_id });
    const participant = await this.repository.findOne('message_participants', { id: chosen.binding.participant_id });
    if (!thread || !participant || participant.left_at) return null;
    return {
      thread,
      participant,
      binding: chosen.binding,
      resolution: 'provider_ingress_address_binding',
      matched_identity_id: chosen.identity.id,
    };
  }

  async recordInboundBinding(binding, message) {
    if (!binding?.id || !message?.id) return null;
    return this.repository.updateById('conversation_channel_bindings', binding.id, {
      last_inbound_message_id: message.id,
      last_used_at: message.created_at || nowIso(),
      updated_at: nowIso(),
    });
  }

  async recordAnalytics({ threadId, messageId = null, participantId = null, eventType, workflow = null, funnelStage = null, attribution = {}, metadata = {} } = {}) {
    if (!threadId || !eventType) return null;
    try {
      return await this.repository.insert('conversation_events', {
        thread_id: threadId,
        message_id: messageId,
        participant_id: participantId,
        event_type: eventType,
        business_workflow: workflow,
        funnel_stage: funnelStage,
        acquisition_source: attribution.utm_source || attribution.source || null,
        referral_code: attribution.referral_code || null,
        campaign_code: attribution.campaign_code || null,
        attribution,
        metadata,
        occurred_at: nowIso(),
        created_at: nowIso(),
      });
    } catch (_error) {
      // Analytics may never block the authoritative conversation path during
      // compatibility rollout or before the additive migration is applied.
      return null;
    }
  }

  async canonicalizeMarketplaceInquiry(event = {}) {
    const payload = event.payload || event;
    const inquiryId = payload.inquiryId || payload.inquiry_id;
    if (!inquiryId) return [];
    const inquiry = await this.repository.findOne('marketplace_inquiries', { id: inquiryId });
    if (!inquiry) throw new Error(`Marketplace inquiry ${inquiryId} was not found for conversation canonicalization.`);

    const sellerId = inquiry.seller_id || payload.sellerId || payload.seller_id || null;
    const buyerId = inquiry.buyer_id || payload.buyerId || payload.buyer_id || null;
    if (!sellerId) throw new Error(`Marketplace inquiry ${inquiryId} has no seller participant.`);

    const tenantId = inquiry.seller_tenant_id || event.tenant_id || payload.tenant_id || null;
    const threadKey = buildDedupeKey(['communications-2', 'marketplace_inquiry', inquiryId]);
    let { thread } = await this.threadService.resolveOrCreateThread({
      tenant_id: tenantId,
      thread_key: threadKey,
      thread_type: 'marketplace_inquiry',
      subject_type: 'marketplace_inquiry',
      subject_id: inquiryId,
      primary_user_id: sellerId, // compatibility projection only; auth is participant-based.
      primary_channel: 'in_app',
      marketplace_listing_id: inquiry.listing_id || payload.listingId || payload.listing_id || null,
      priority: inquiry.risk_status === 'watch' ? 'high' : 'normal',
      metadata: { event_type: 'marketplace.inquiry.created' },
    });
    thread = await this.repository.updateById('message_threads', thread.id, {
      business_workflow: 'marketplace',
      funnel_stage: 'conversation',
      conversion_status: 'open',
      metadata: {
        ...(thread.metadata || {}),
        marketplace_inquiry_id: inquiryId,
        listing_id: inquiry.listing_id || null,
        exact_message_authoritative: true,
        acquisition: {
          source_channel: inquiry.source_channel || null,
          referral_code: inquiry.referral_code || null,
          campaign_code: inquiry.campaign_code || null,
          ...(safeMetadata(inquiry.metadata)),
        },
      },
    });

    const seller = await this.ensureParticipant(thread.id, {
      participant_type: 'user',
      user_id: sellerId,
      stakeholder_role: 'seller',
      permissions: { read: true, send: true },
    });

    let buyer = null;
    if (buyerId) {
      buyer = await this.ensureParticipant(thread.id, {
        participant_type: 'user',
        user_id: buyerId,
        stakeholder_role: 'buyer',
        display_name: inquiry.guest_name || null,
        permissions: { read: true, send: true },
      });
    }

    const preferred = String(inquiry.metadata?.preferred_contact || '').toLowerCase();
    const canUseWhatsapp = Boolean(inquiry.guest_phone && (preferred === 'whatsapp' || inquiry.source_channel === 'whatsapp'));
    if (canUseWhatsapp) {
      const identity = await this.identityService.resolveOrCreateIdentity({
        tenant_id: tenantId,
        user_id: buyerId,
        channel: 'whatsapp',
        provider: 'meta_whatsapp_cloud_api',
        external_id: inquiry.guest_phone,
        address: inquiry.guest_phone,
        display_name: inquiry.guest_name || null,
        authenticated: Boolean(buyerId),
        consent_status: 'implied_transactional',
        metadata: { source: 'marketplace_inquiry', inquiry_id: inquiryId, raw_address_preserved: true },
      });
      buyer = await this.ensureParticipant(thread.id, {
        participant_type: buyerId ? 'user' : 'external_contact',
        user_id: buyerId,
        external_identity_id: identity.id,
        stakeholder_role: 'buyer',
        display_name: inquiry.guest_name || null,
        permissions: { read: true, send: true },
      });
      await this.bindParticipantChannel({
        thread,
        participant: buyer,
        identity,
        channel: 'whatsapp',
        provider: 'meta_whatsapp_cloud_api',
        transactionalConsent: true,
        marketingConsent: false,
        primary: true,
        metadata: { marketplace_inquiry_id: inquiryId },
      });
    } else if (!buyer && inquiry.guest_email) {
      const identity = await this.identityService.resolveOrCreateIdentity({
        tenant_id: tenantId,
        channel: 'email',
        provider: 'cloudflare_email',
        external_id: inquiry.guest_email,
        address: inquiry.guest_email,
        display_name: inquiry.guest_name || null,
        consent_status: 'implied_transactional',
        metadata: { source: 'marketplace_inquiry', inquiry_id: inquiryId },
      });
      buyer = await this.ensureParticipant(thread.id, {
        participant_type: 'external_contact',
        external_identity_id: identity.id,
        stakeholder_role: 'buyer',
        display_name: inquiry.guest_name || null,
        permissions: { read: true, send: true },
      });
      await this.bindParticipantChannel({
        thread,
        participant: buyer,
        identity,
        channel: 'email',
        provider: 'cloudflare_email',
        transactionalConsent: true,
        marketingConsent: false,
        primary: true,
        metadata: { marketplace_inquiry_id: inquiryId },
      });
    }

    if (!buyer) {
      // Authenticated buyer without a bound external identity is still a real
      // participant and can continue in CarUp. Do not expose contact as a workaround.
      buyer = await this.ensureParticipant(thread.id, {
        participant_type: 'system',
        stakeholder_role: 'buyer_unresolved',
        display_name: inquiry.guest_name || 'Buyer',
        permissions: { read: false, send: false },
        metadata: { inquiry_id: inquiryId, routing_pending: true },
      });
    }

    const clientMessageId = `marketplace-inquiry:${inquiryId}`;
    let message = (await this.repository.list('messages', { thread_id: thread.id }))
      .find((row) => row.client_message_id === clientMessageId) || null;
    // The canonical message is deduped by client_message_id, so a replayed domain event reuses it.
    // Anything that must happen ONCE has to key off this flag rather than off the call itself.
    const messageCreated = !message;
    if (!message) {
      message = await this.threadService.recordMessage(thread, {
        direction: 'inbound',
        message_type: 'text',
        sender_participant_id: buyer.id,
        sender_user_id: buyerId,
        channel: inquiry.source_channel || 'web',
        provider: null,
        client_message_id: clientMessageId,
        content_text: inquiry.message || '',
        content_json: {
          original_authoritative: true,
          business_workflow: 'marketplace',
          marketplace_inquiry_id: inquiryId,
          listing_id: inquiry.listing_id || null,
          source_channel: inquiry.source_channel || null,
          ai_derived: false,
        },
        status: 'received',
        thread_status: 'open',
      });
      await this.repository.updateById('message_threads', thread.id, { last_inbound_at: message.created_at });
    }

    // Route the canonical message to the other participants. The orchestrator returns straight from
    // here and never reaches queueFromDomainEvent, so without this the seller was never told an
    // inquiry had arrived — the conversation existed and nobody was notified.
    //
    // routeMessage is the canonical primitive and is already correct for this: it excludes the
    // SENDER (the buyer, so no self-echo), skips system/agent placeholders, requires read
    // permission, and dedupes on the MESSAGE id — so a replayed event reuses the deduped message
    // and cannot produce a second seller notification.
    const deliveries = await this.routeMessage(thread, buyer, message);

    // Analytics is only idempotent if it is tied to message creation. conversation_started and
    // inquiry_created have no dedupe of their own, so emitting them per invocation double-counted
    // the funnel on every replay of the same inquiry.
    if (messageCreated) {
      const attribution = {
        source: inquiry.source_channel || null,
        referral_code: inquiry.referral_code || null,
        campaign_code: inquiry.campaign_code || null,
        ...safeMetadata(inquiry.metadata),
      };
      await this.recordAnalytics({
        threadId: thread.id,
        messageId: message.id,
        participantId: buyer.id,
        eventType: 'conversation_started',
        workflow: 'marketplace',
        funnelStage: 'conversation',
        attribution,
        metadata: { inquiry_id: inquiryId, listing_id: inquiry.listing_id || null },
      });
      await this.recordAnalytics({
        threadId: thread.id,
        messageId: message.id,
        participantId: buyer.id,
        eventType: 'inquiry_created',
        workflow: 'marketplace',
        funnelStage: 'conversation',
        attribution,
        metadata: { inquiry_id: inquiryId },
      });
    }

    return [{ thread, message, seller, buyer, deliveries, canonical: true }];
  }

  async sendParticipantMessage(threadId, actor = {}, input = {}) {
    const { thread, participant } = await this.assertParticipantAccess(threadId, actor, SEND_PERMISSION);
    const text = String(input.message ?? input.text ?? '').trim();
    if (!text) {
      const error = new Error('Message text is required.');
      error.statusCode = 400;
      throw error;
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      const error = new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
      error.statusCode = 400;
      throw error;
    }

    const role = participant.stakeholder_role || participant.role || 'participant';
    const direction = ['buyer', 'requester', 'customer'].includes(role) ? 'inbound' : 'outbound';
    const message = await this.threadService.recordMessage(thread, {
      direction,
      message_type: input.message_type || 'text',
      sender_participant_id: participant.id,
      sender_user_id: actorUserId(actor),
      channel: normalizeChannel(input.channel) || 'in_app',
      provider: null,
      client_message_id: input.client_message_id || null,
      in_reply_to_message_id: input.reply_to_message_id || null,
      content_text: text,
      content_json: {
        original_authoritative: true,
        ai_derived: false,
        author_role: role,
        business_workflow: thread.business_workflow || thread.thread_type,
        ...(safeMetadata(input.content)),
      },
      status: 'queued',
      human_approved: input.human_approved !== false,
      thread_status: 'open',
    });
    await this.repository.updateById('message_threads', thread.id, {
      last_outbound_at: direction === 'outbound' ? message.created_at : thread.last_outbound_at || null,
      last_inbound_at: direction === 'inbound' ? message.created_at : thread.last_inbound_at || null,
      funnel_stage: thread.funnel_stage || 'conversation',
    });

    const deliveries = await this.routeMessage(thread, participant, message);
    await this.recordAnalytics({
      threadId: thread.id,
      messageId: message.id,
      participantId: participant.id,
      eventType: direction === 'outbound' ? 'stakeholder_first_response' : 'message_received',
      workflow: thread.business_workflow || thread.thread_type,
      funnelStage: thread.funnel_stage || 'conversation',
      metadata: { author_role: role, delivery_count: deliveries.length },
    });
    return { thread, message, deliveries };
  }

  async routeMessage(thread, senderParticipant, message) {
    const recipients = (await this.activeParticipants(thread.id))
      .filter((participant) => participant.id !== senderParticipant.id)
      .filter((participant) => can(participant, READ_PERMISSION))
      .filter((participant) => !['system', 'agent'].includes(participant.participant_type));
    const deliveries = [];

    for (const recipient of recipients) {
      const bindings = (await this.repository.list('conversation_channel_bindings', {
        thread_id: thread.id,
        participant_id: recipient.id,
      }))
        .filter((binding) => binding.can_send !== false && binding.transactional_consent === true)
        .filter((binding) => !binding.expires_at || Date.parse(binding.expires_at) > Date.now())
        .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || bindingTime(b) - bindingTime(a));

      if (recipient.user_id) {
        const queued = await this.notificationService.queueExistingMessage({
          message,
          thread,
          recipientUserId: recipient.user_id,
          channel: 'in_app',
          notificationType: 'conversation_message',
          title: 'New CarUp message',
          transactional: true,
          dedupeParts: ['conversation-message', message.id, recipient.id, 'in_app'],
          payload: { thread_id: thread.id, business_workflow: thread.business_workflow || thread.thread_type },
        });
        deliveries.push({ channel: 'in_app', recipient_participant_id: recipient.id, notification_id: queued.notification.id });
      }

      const binding = bindings[0] || null;
      if (!binding || binding.channel === 'in_app') continue;
      const identity = await this.repository.findOne('channel_identities', { id: binding.channel_identity_id });
      if (!identity || identity.consent_status === 'opted_out' || identity.consent_status === 'revoked') continue;
      const address = identity.normalized_address || identity.external_id;
      const payload = {
        thread_id: thread.id,
        business_workflow: thread.business_workflow || thread.thread_type,
        external_conversation_id: binding.external_conversation_id || null,
        address,
        external_id: identity.external_id,
      };
      if (binding.channel === 'whatsapp' || binding.channel === 'sms') payload.phone_number = address;
      if (binding.channel === 'email') payload.email = address;
      if (binding.channel === 'telegram') payload.telegram_chat_id = identity.external_id;

      const queued = await this.notificationService.queueExistingMessage({
        message,
        thread,
        recipientUserId: recipient.user_id || null,
        recipientIdentityId: identity.id,
        channel: binding.channel,
        provider: binding.provider || identity.provider || null,
        notificationType: 'conversation_message',
        title: 'CarUp conversation',
        transactional: true,
        dedupeParts: ['conversation-message', message.id, recipient.id, binding.channel, identity.id],
        payload,
      });
      deliveries.push({ channel: binding.channel, recipient_participant_id: recipient.id, notification_id: queued.notification.id });
      await this.repository.updateById('conversation_channel_bindings', binding.id, {
        last_outbound_message_id: message.id,
        last_used_at: nowIso(),
        updated_at: nowIso(),
      });
    }
    return deliveries;
  }
}
