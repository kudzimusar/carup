import { CommunicationTemplateService } from './communicationTemplateService.js';
import { CommunicationPreferenceService } from './communicationPreferenceService.js';
import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';
import { CLASSIFICATION_SOURCES } from './emailExperience/emailClassification.js';

/**
 * G2 — every policy declares its canonical Email classification EXPLICITLY.
 *
 * All nine are transactional: each is a status change or an acknowledgement about something the
 * recipient already did or owns. None is a conversation (no human is on the other end of them) and
 * none is marketing. `service` is deliberately not used — the owner's rule is that a family is
 * SELECTED by a producer, never arrived at because something else was missing.
 *
 * The default policy below carries NO classification on purpose. An unrecognised domain event that
 * reaches Email is refused rather than defaulted, because `missing => transactional` is exactly the
 * absence-as-semantics defect this gate removes.
 */
export const NOTIFICATION_POLICIES = Object.freeze({
  'marketplace.inquiry.created': {
    notificationType: 'marketplace_inquiry',
    threadType: 'marketplace_inquiry',
    priority: 'normal',
    channels: ['in_app', 'push', 'email'],
    fallbackChannels: ['whatsapp', 'sms'],
    templateKey: 'marketplace_inquiry_received_v1',
    classification: 'transactional',
    transactional: true,
  },
  ESCROW_CREATED: {
    notificationType: 'escrow_status',
    threadType: 'escrow',
    priority: 'high',
    channels: ['in_app', 'push', 'email', 'whatsapp'],
    fallbackChannels: ['sms'],
    templateKey: 'escrow_status_v1',
    classification: 'transactional',
    transactional: true,
    quietHoursBypass: true,
  },
  ESCROW_UPDATED: {
    notificationType: 'escrow_status',
    threadType: 'escrow',
    priority: 'high',
    channels: ['in_app', 'push', 'email', 'whatsapp'],
    fallbackChannels: ['sms'],
    templateKey: 'escrow_status_v1',
    classification: 'transactional',
    transactional: true,
    quietHoursBypass: true,
  },
  'finance.application.status_changed': {
    notificationType: 'finance_status',
    threadType: 'finance',
    priority: 'high',
    channels: ['in_app', 'push', 'email'],
    fallbackChannels: ['sms'],
    templateKey: 'finance_status_v1',
    classification: 'transactional',
    transactional: true,
  },
  // Decision-specific finance events share the finance_status_v1 rendering but
  // must have explicit policies: without one, getPolicy falls back to the
  // generic acknowledgement template and every application would queue a second,
  // nonsensical notification alongside the real one.
  'finance.application.approved': {
    notificationType: 'finance_status',
    threadType: 'finance',
    priority: 'high',
    channels: ['in_app', 'push', 'email'],
    fallbackChannels: ['sms'],
    templateKey: 'finance_status_v1',
    classification: 'transactional',
    transactional: true,
  },
  'finance.application.declined': {
    notificationType: 'finance_status',
    threadType: 'finance',
    priority: 'high',
    channels: ['in_app', 'push', 'email'],
    fallbackChannels: ['sms'],
    templateKey: 'finance_status_v1',
    classification: 'transactional',
    transactional: true,
  },
  // threadType note for the three policies below: message_threads.thread_type carries the DB
  // CHECK constraint message_threads_thread_type_check (see
  // database/migrations/20260623143000_omnichannel_communication_engine.sql), which allows ONLY
  // support | marketplace_inquiry | referral | escrow | finance | import | container |
  // trust_safety | feedback | complaint | account | general. Any other value fails the thread
  // INSERT, so the notification is never queued — thread types here MUST come from that list.
  //
  // channels note: the delivery worker resolves email addresses / phone numbers / push tokens
  // ONLY from notification.payload, which policy-driven notifications never carry, so email/push
  // deliveries dead-letter. Until recipient address enrichment exists these policies stay
  // in_app-only with no fallback; policyChannelsOnly stops user-preference fallback channels
  // (default in_app/email/push) from re-adding the dead channels behind the policy's back.
  'identity.verification.decided': {
    notificationType: 'verification_decision',
    threadType: 'account', // NOT 'verification' — violates message_threads_thread_type_check
    priority: 'high',
    channels: ['in_app'],
    fallbackChannels: [],
    policyChannelsOnly: true,
    templateKey: 'verification_decision_v1',
    classification: 'transactional',
    transactional: true,
  },
  'marketplace.listing.moderated': {
    notificationType: 'listing_moderation',
    threadType: 'trust_safety', // NOT 'marketplace_listing' — violates message_threads_thread_type_check
    priority: 'normal',
    channels: ['in_app'],
    fallbackChannels: [],
    policyChannelsOnly: true,
    templateKey: 'listing_moderation_v1',
    classification: 'transactional',
    transactional: true,
  },
  'evidence.review.decided': {
    notificationType: 'evidence_review',
    threadType: 'trust_safety', // NOT 'evidence' — violates message_threads_thread_type_check
    priority: 'normal',
    channels: ['in_app'],
    fallbackChannels: [],
    policyChannelsOnly: true,
    templateKey: 'evidence_review_v1',
    classification: 'transactional',
    transactional: true,
  },

  // R4 — SafeTrade / marketplace transaction stages.
  //
  // These are REAL canonical events, emitted by `issue164_transition_session_atomic` into
  // `domain_events` when the transaction authority moves a session. They were emitted and never
  // subscribed, so the customer was never told. Subscribing them is wiring, not invention.
  //
  // Every one is `transactional`: a stage change on a journey the recipient is party to. None is a
  // payment claim — `referenceSafeTradeTransaction.js` decides what may be SAID about each state,
  // and refuses any state nobody mapped.
  MARKETPLACE_PAYMENT_INITIATED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  MARKETPLACE_INSPECTION_PENDING: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  MARKETPLACE_RELEASE_APPROVED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  MARKETPLACE_TRANSACTION_DISPUTED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
    quietHoursBypass: true,
  },
  MARKETPLACE_TRANSACTION_CANCELLED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'normal',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  // The provider-confirmed outcomes, emitted by `issue164_record_payment_state_atomic`. These are
  // the stages a customer most needs to hear about, and leaving them unsubscribed would have meant
  // telling someone their journey started and never telling them it settled.
  MARKETPLACE_FUNDS_HELD: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  MARKETPLACE_TRANSACTION_SETTLED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  MARKETPLACE_TRANSACTION_REFUNDED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  MARKETPLACE_TRANSACTION_FAILED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  MARKETPLACE_PAYMENT_FAILED: {
    notificationType: 'safetrade_transaction', threadType: 'escrow', priority: 'high',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'safetrade_transaction_v1', classification: 'transactional', transactional: true,
  },
  // R5 — a customer-visible Vehicle Trust position changed. Emitted by
  // `trustPresentationChangeProducer.js` immediately after the canonical Trust write, and only when
  // the audience-safe projection materially moved AND a current owner resolves.
  //
  // `service`: platform-initiated, about something the recipient owns. Not the outcome of an action
  // they just took, which is what separates it from `transactional`.
  'vehicle.trust.presentation_changed': {
    notificationType: 'vehicle_trust_update', threadType: 'account', priority: 'normal',
    channels: ['in_app', 'email'], fallbackChannels: [],
    templateKey: 'vehicle_trust_update_v1', classification: 'service', transactional: true,
  },
  'vehicle.ownership.transfer_started': {
    notificationType: 'ownership_transfer', threadType: 'account', priority: 'high',
    channels: ['in_app'], fallbackChannels: [], policyChannelsOnly: true,
    templateKey: 'ownership_transfer_v1', classification: 'transactional', transactional: true,
  },
  'vehicle.ownership.transfer_action_required': {
    notificationType: 'ownership_transfer', threadType: 'account', priority: 'high',
    channels: ['in_app'], fallbackChannels: [], policyChannelsOnly: true,
    templateKey: 'ownership_transfer_v1', classification: 'transactional', transactional: true,
  },
  'vehicle.ownership.transfer_state_changed': {
    notificationType: 'ownership_transfer', threadType: 'account', priority: 'normal',
    channels: ['in_app'], fallbackChannels: [], policyChannelsOnly: true,
    templateKey: 'ownership_transfer_v1', classification: 'transactional', transactional: true,
  },
  'vehicle.ownership.transfer_completed': {
    notificationType: 'ownership_transfer', threadType: 'account', priority: 'high',
    channels: ['in_app'], fallbackChannels: [], policyChannelsOnly: true,
    templateKey: 'ownership_transfer_v1', classification: 'transactional', transactional: true,
  },
  // MARKETPLACE_PAYMENT_RECONCILED is deliberately NOT subscribed. Reconciliation is an internal
  // bookkeeping step with no customer-facing stage change, and `referenceSafeTradeTransaction.js`
  // has no presentation for it — which is the correct answer, not a gap to fill.
});

/**
 * Carry the canonical classification onto the payload the worker and adapters actually read.
 *
 * A producer that already put one on its payload keeps it — the campaign path and the auth recovery
 * route both do, and silently overwriting a producer's explicit choice with a parameter would make
 * the two disagree in exactly the way `resolveEmailClassification` is built to refuse.
 */
export function withClassification(payload, classification) {
  const base = payload || {};
  if (!classification) return base;
  if (String(base.classification ?? '').trim() !== '') return base;
  return { ...base, classification };
}

/**
 * Record WHERE the classification came from.
 *
 * `metadata.classification` is provenance, not a second authority: it is written from the same value
 * as the payload, so the two can only disagree if a row was written outside this service or
 * mutated afterwards — and that disagreement is refused at the Email boundary rather than resolved
 * by preferring one of them.
 */
export function classificationMetadata(base, payload, classification, source) {
  const effective = String(payload?.classification ?? '').trim() || classification || null;
  if (!effective) return base;
  return { ...base, classification: effective, classification_source: source || CLASSIFICATION_SOURCES.PRODUCER };
}

/**
 * Extra payload a reference template needs, derived from the domain event.
 *
 * Kept narrow and explicit. A domain event's `safe_payload` is a producer's own shape; a reference
 * template reads named fields, so the mapping between the two lives here rather than being guessed
 * at inside a renderer.
 */
const SAFETRADE_EVENT_TYPES = new Set([
  'MARKETPLACE_PAYMENT_INITIATED', 'MARKETPLACE_INSPECTION_PENDING', 'MARKETPLACE_RELEASE_APPROVED',
  'MARKETPLACE_TRANSACTION_DISPUTED', 'MARKETPLACE_TRANSACTION_CANCELLED',
  'MARKETPLACE_FUNDS_HELD', 'MARKETPLACE_TRANSACTION_SETTLED', 'MARKETPLACE_TRANSACTION_REFUNDED',
  'MARKETPLACE_TRANSACTION_FAILED', 'MARKETPLACE_PAYMENT_FAILED',
]);

export function referencePayloadFor(eventType, payload = {}) {
  if (eventType === 'vehicle.trust.presentation_changed') {
    // The audience-safe Trust projection the producer already computed, plus public vehicle
    // identity. `recipientUserId` addresses a person and is NOT copied into the payload — it must
    // never become content, and the queue row already carries the recipient separately.
    return {
      reference_template: 'vehicle_trust_update',
      vin: payload.vin || payload.trust?.vin || null,
      trust: payload.trust || null,
      ...(payload.vehicle ? { vehicle: payload.vehicle } : {}),
    };
  }
  if (!SAFETRADE_EVENT_TYPES.has(eventType)) return {};
  // The audience-safe transaction projection only. No amount, no currency, no provider identifier —
  // all exist upstream and none belongs in a forwardable Email.
  const session = payload.session || payload.transaction_session || payload;
  return {
    reference_template: 'safetrade_transaction',
    transaction_session: {
      transaction_intent_id: session.transaction_intent_id || session.id || null,
      vin: session.vin || payload.vin || null,
      status: session.status || payload.status || null,
    },
  };
}

export class CommunicationNotificationService {
  constructor({ repository, threadService, templateService = null, preferenceService = null } = {}) {
    this.repository = repository;
    this.threadService = threadService;
    this.templateService = templateService || new CommunicationTemplateService();
    this.preferenceService = preferenceService || new CommunicationPreferenceService({ repository });
  }

  getPolicy(eventType, override = {}) {
    return { ...(NOTIFICATION_POLICIES[eventType] || {
      notificationType: 'general',
      threadType: 'general',
      priority: 'normal',
      channels: ['in_app'],
      fallbackChannels: ['email'],
      templateKey: 'message_acknowledgement_v1',
      transactional: true,
      // NO classification. An unrecognised event that reaches Email is refused at the boundary,
      // not silently assigned a family and a provider.
      classification: null,
    }), ...override };
  }

  recipientFromPayload(payload = {}) {
    return payload.recipientUserId || payload.recipient_user_id || payload.userId || payload.user_id || payload.buyerId || payload.buyer_id || payload.sellerId || payload.seller_id || null;
  }

  variablesForEvent(eventType, payload = {}) {
    return {
      topic: payload.topic || payload.intent || eventType,
      listing_id: payload.listingId || payload.listing_id || payload.vin || 'listing',
      escrow_id: payload.escrowId || payload.escrow_id || 'escrow',
      status: payload.transfer_state || payload.currentStatus || payload.status || payload.current_status || 'updated',
      application_id: payload.applicationId || payload.application_id || payload.id || 'application',
      reference: payload.publicReference || payload.reference || payload.transferId || payload.transfer_id || payload.escrowId || payload.applicationId || payload.inquiryId || payload.sessionId || payload.evidenceId || 'CarUp',
      decision: payload.decision || payload.action || '',
      reason: payload.reason || '',
      summary: payload.summary || '',
      team: payload.team || 'support',
      share_text: payload.shareText || payload.share_text || 'View this CarUp listing:',
      share_url: payload.shareUrl || payload.share_url || '',
      failed_channel: payload.failedChannel || '',
    };
  }

  async queueFromDomainEvent(event = {}) {
    const eventType = event.event_type || event.eventType;
    const payload = event.payload || event;
    const policy = this.getPolicy(eventType);
    const recipientUserId = this.recipientFromPayload(payload);
    if (!recipientUserId) return [];

    const { thread } = await this.threadService.resolveOrCreateThread({
      tenant_id: event.tenant_id || payload.tenant_id || null,
      thread_type: policy.threadType,
      subject_type: payload.subject_type || policy.threadType,
      subject_id: payload.inquiryId || payload.inquiry_id || payload.escrowId || payload.applicationId || payload.vin || payload.sessionId || payload.evidenceId || null,
      primary_user_id: recipientUserId,
      primary_channel: 'in_app',
      priority: policy.priority,
      marketplace_listing_id: payload.listingId || payload.listing_id || payload.vin || null,
      escrow_id: payload.escrowId || payload.escrow_id || null,
      financing_application_id: payload.applicationId || payload.application_id || null,
      metadata: { event_type: eventType },
    });

    const prefs = await this.preferenceService.getPreferences(recipientUserId, thread.tenant_id);
    let channels = this.preferenceService.selectChannels(prefs, policy);
    if (policy.policyChannelsOnly) {
      // Hard-cap to the policy's channel list: selectChannels merges the user's
      // preference fallback channels (default in_app/email/push), which would
      // re-add channels the delivery worker cannot address for policy-driven
      // notifications (no email/phone/push token in notification.payload).
      const allowed = new Set((policy.channels || []).map((channel) => normalizeChannel(channel)).filter(Boolean));
      channels = channels.filter((channel) => allowed.has(channel));
    }
    const queued = [];
    for (const channel of channels) {
      queued.push(await this.queueNotification({
        recipientUserId,
        thread,
        eventId: event.id || event.event_id || null,
        notificationType: policy.notificationType,
        channel,
        templateKey: policy.templateKey,
        variables: this.variablesForEvent(eventType, payload),
        priority: policy.priority,
        transactional: policy.transactional,
        classification: policy.classification || null,
        classificationSource: CLASSIFICATION_SOURCES.POLICY,
        // Prefer the outbox record id (per-event) as the dedupe discriminator; the payload
        // fallbacks cover every emitter's subject id (incl. sessionId/evidenceId/vin for
        // verification, evidence-review, and listing-moderation events) so distinct events
        // for the same user never collapse into one dedupe key.
        dedupeParts: [eventType, event.id || event.dedupe_key || event.event_id || payload.id || payload.inquiryId || payload.escrowId || payload.applicationId || payload.sessionId || payload.evidenceId || payload.vin, recipientUserId, policy.templateKey, channel],
        payload: {
          event_type: eventType,
          safe_payload: payload,
          ...referencePayloadFor(eventType, payload),
        },
      }));
    }
    return queued;
  }

  async queueNotification(input = {}) {
    const channel = normalizeChannel(input.channel) || 'in_app';
    const rendered = this.templateService.render(input.templateKey || 'message_acknowledgement_v1', input.variables || {});
    const thread = input.thread || (await this.threadService.resolveOrCreateThread({
      thread_type: input.threadType || 'general',
      primary_user_id: input.recipientUserId,
      primary_channel: channel,
    })).thread;
    const dedupeKey = buildDedupeKey(input.dedupeParts || [thread.id, input.notificationType, input.recipientUserId, channel, input.templateKey]);
    const existingNotification = await this.repository.findOne('notification_queue', { dedupe_key: dedupeKey });
    if (existingNotification) {
      const existingMessage = existingNotification.message_id
        ? await this.repository.findOne('messages', { id: existingNotification.message_id })
        : null;
      return { notification: existingNotification, message: existingMessage, thread };
    }

    const originalThread = {
      status: thread.status || null,
      last_message_at: thread.last_message_at || null,
      updated_at: thread.updated_at || null,
    };
    const message = await this.threadService.recordMessage(thread, {
      direction: 'outbound',
      channel,
      provider: input.provider || null,
      content_text: rendered.body,
      content_json: { subject: rendered.subject, template_key: rendered.templateKey, data: rendered.data },
      status: 'queued',
      ai_generated: Boolean(input.aiGenerated),
      human_approved: Boolean(input.humanApproved),
      thread_status: thread.status,
    });
    const notificationRow = {
      tenant_id: thread.tenant_id || null,
      recipient_id: input.recipientUserId,
      recipient_user_id: input.recipientUserId,
      recipient_identity_id: input.recipientIdentityId || null,
      thread_id: thread.id,
      message_id: message.id,
      event_id: input.eventId || null,
      type: input.notificationType || 'general',
      notification_type: input.notificationType || 'general',
      title: rendered.subject,
      message: rendered.body,
      channel,
      provider: input.provider || null,
      template_key: input.templateKey || rendered.templateKey,
      payload: withClassification(input.payload, input.classification),
      priority: input.priority || 'normal',
      status: 'queued',
      dedupe_key: dedupeKey,
      scheduled_at: input.scheduledAt || nowIso(),
      next_attempt_at: input.nextAttemptAt || null,
      attempt_count: 0,
      max_attempts: input.maxAttempts || Number(process.env.COMMUNICATION_MAX_ATTEMPTS || 5),
      read: false,
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: classificationMetadata(
        { transactional: input.transactional !== false },
        input.payload,
        input.classification,
        input.classificationSource,
      ),
    };
    if (input.id) notificationRow.id = input.id;
    try {
      const notification = await this.insertNotificationIdempotently(notificationRow);
      if (notification.message_id && notification.message_id !== message.id) {
        await this.repository.deleteById?.('messages', message.id).catch(() => null);
        await this.repository.updateById('message_threads', thread.id, originalThread).catch(() => null);
        const existingMessage = await this.repository.findOne('messages', { id: notification.message_id });
        return { notification, message: existingMessage, thread };
      }
      return { notification, message, thread };
    } catch (error) {
      await this.repository.deleteById?.('messages', message.id).catch(() => null);
      await this.repository.updateById('message_threads', thread.id, originalThread).catch(() => null);
      throw error;
    }
  }

  /**
   * Canonical suppression state, consulted before anything else.
   *
   * `communication_suppressions` was created to hold CarUp's authoritative unsubscribe/complaint
   * state but had no reader, so an unsubscribe reconciled nowhere and could not actually stop a
   * send. This is that reader. Scoped to marketing (and 'all'): an unsubscribe from marketing must
   * never suppress security, auth or transaction Email.
   */
  async suppressedByCanonicalState(input, channel) {
    if (channel === 'in_app') return null;
    const address = String(input.recipientAddress || input.address || input.email || '').trim().toLowerCase();
    if (!address) return null;
    const marketing = input.transactional === false;
    const scopes = marketing ? ['marketing', 'all'] : ['all'];
    let rows;
    try {
      rows = await this.repository.list('communication_suppressions', { channel, address });
    } catch (error) {
      // G3. This used to be `.catch(() => [])`, which turned every failure to ESTABLISH consent
      // state into "not suppressed" — the same fail-open the send-time gate had.
      //
      // Fail closed for MARKETING only, and deliberately not for anything else: holding a password
      // reset because a suppression lookup timed out would lock someone out of their account over a
      // consent question that does not apply to security mail. Marketing is refused here and again
      // at send time by `marketingConsentState.js`, which is the authoritative gate.
      if (marketing) return 'suppressed_consent_state_unavailable';
      return null;
    }
    const active = (rows || []).find((row) => !row.released_at && scopes.includes(row.scope));
    return active ? `suppressed_${active.reason}` : null;
  }

  async existingMessageSuppressionReason(input, channel) {
    const thread = input.thread;
    const transactional = input.transactional !== false;

    const canonicalSuppression = await this.suppressedByCanonicalState(input, channel);
    if (canonicalSuppression) return canonicalSuppression;

    let participant = null;
    if (input.recipientUserId) {
      participant = await this.repository.findOne('message_participants', {
        thread_id: thread.id,
        user_id: input.recipientUserId,
      }).catch(() => null);
    } else if (input.recipientIdentityId) {
      participant = await this.repository.findOne('message_participants', {
        thread_id: thread.id,
        external_identity_id: input.recipientIdentityId,
      }).catch(() => null);
    }
    if (participant?.notification_muted && !input.quietHoursBypass) return 'participant_muted';

    if (input.recipientUserId) {
      const prefs = await this.preferenceService.getPreferences(input.recipientUserId, thread.tenant_id || null);
      if (transactional && prefs.transactional_enabled === false && !input.quietHoursBypass) {
        return 'transactional_disabled';
      }
      if (channel === 'in_app' && prefs.in_app_enabled === false) return 'in_app_disabled';
      if (
        channel !== 'in_app'
        && this.preferenceService.isInQuietHours(prefs)
        && !input.quietHoursBypass
        && (input.priority || thread.priority || 'normal') !== 'urgent'
      ) {
        return 'quiet_hours';
      }
    }
    return null;
  }

  async queueExistingMessage(input = {}) {
    const message = input.message;
    const thread = input.thread;
    if (!message?.id || !thread?.id) throw new Error('Existing message and thread are required to queue delivery.');
    if (!input.recipientUserId && !input.recipientIdentityId) throw new Error('A recipient user or channel identity is required to queue delivery.');
    const channel = normalizeChannel(input.channel || message.channel || thread.primary_channel) || 'in_app';
    const transactional = input.transactional !== false;
    const recipientKey = input.recipientUserId || input.recipientIdentityId;
    const dedupeKey = buildDedupeKey(input.dedupeParts || ['message', message.id, recipientKey, channel]);
    const existingNotification = await this.repository.findOne('notification_queue', { dedupe_key: dedupeKey });
    if (existingNotification) return { notification: existingNotification, message, thread };

    const suppressionReason = await this.existingMessageSuppressionReason(input, channel);
    const notificationRow = {
      tenant_id: thread.tenant_id || null,
      recipient_id: input.recipientUserId || null,
      recipient_user_id: input.recipientUserId || null,
      recipient_identity_id: input.recipientIdentityId || null,
      thread_id: thread.id,
      message_id: message.id,
      event_id: input.eventId || null,
      type: input.notificationType || 'admin_reply',
      notification_type: input.notificationType || 'admin_reply',
      title: input.title || 'CarUp message',
      message: message.content_text || input.message || '',
      channel,
      provider: input.provider || message.provider || null,
      template_key: input.templateKey || 'admin_reply_v1',
      payload: withClassification(input.payload, input.classification),
      priority: input.priority || thread.priority || 'normal',
      status: suppressionReason ? 'suppressed' : 'queued',
      dedupe_key: dedupeKey,
      scheduled_at: input.scheduledAt || nowIso(),
      next_attempt_at: input.nextAttemptAt || null,
      attempt_count: 0,
      max_attempts: input.maxAttempts || Number(process.env.COMMUNICATION_MAX_ATTEMPTS || 5),
      read: false,
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: classificationMetadata(
        {
          transactional,
          source: 'existing_message',
          suppression_reason: suppressionReason,
          // C2-RACE — the caller's routing context travels WITH the insert.
          //
          // It used to be patched in afterwards by the canonical subclass, which meant the row was
          // claimable by the delivery worker for one full HTTP round trip while missing the
          // participant id a conversational Email needs. A claim inside that window dead-lettered
          // the message permanently as `conversation_reply_context_missing`. Merging here means the
          // row is complete the moment it exists, so the incomplete state cannot be observed.
          ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
        },
        input.payload,
        input.classification,
        input.classificationSource,
      ),
    };
    if (input.id) notificationRow.id = input.id;
    const notification = await this.insertNotificationIdempotently(notificationRow);
    return { notification, message, thread, suppressed: Boolean(suppressionReason), suppression_reason: suppressionReason };
  }

  async insertNotificationIdempotently(notificationRow) {
    try {
      return await this.repository.insert('notification_queue', notificationRow);
    } catch (error) {
      const duplicate = error?.code === '23505' || /duplicate key|idx_notification_queue_dedupe|dedupe/i.test(error?.message || '');
      if (!duplicate || !notificationRow.dedupe_key) throw error;
      const existing = await this.repository.findOne('notification_queue', { dedupe_key: notificationRow.dedupe_key });
      if (existing) return existing;
      throw error;
    }
  }

  async listNotificationsForUser(userId) {
    return this.repository.list('notification_queue', { recipient_user_id: userId }, { order: { column: 'created_at' }, limit: 100 });
  }
}
