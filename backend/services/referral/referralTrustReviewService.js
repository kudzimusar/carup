import crypto from 'node:crypto';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  ACTOR_TYPES,
  REFERRAL_CHANNELS,
  WALLET_TRANSACTION_STATUSES,
} from '../../constants/referral/referralConstants.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { ReferralEngineService, paginateReferralRows } from './referralEngineService.js';

export const TRUST_EVENT_TYPES = Object.freeze({
  RISK_CHECK_RUN: 'trust.risk_check_run',
  AI_RECOMMENDATION_STORED: 'trust.ai_recommendation_stored',
  REVIEW_CASE_CREATED: 'trust.review_case_created',
  REVIEW_CASE_DECIDED: 'trust.review_case_decided',
  WALLET_HOLD_APPLIED: 'trust.wallet_hold_applied',
  DISPUTE_CREATED: 'trust.dispute_created',
  DISPUTE_RESOLVED: 'trust.dispute_resolved',
  BENEFIT_EXPLANATION_CREATED: 'trust.benefit_explanation_created',
  AUDIT_EXPORT_CREATED: 'trust.audit_export_created',
});

export const TRUST_RECOMMENDATIONS = Object.freeze({
  ALLOW: 'allow',
  HOLD: 'hold',
  REVIEW: 'review',
  REJECT: 'reject',
});

export const REVIEW_CASE_STATUSES = Object.freeze({
  OPEN: 'open',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  HELD: 'held',
  REJECTED: 'rejected',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

export const DISPUTE_STATUSES = Object.freeze({
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  RESOLVED_UPHELD: 'resolved_upheld',
  RESOLVED_REVERSED: 'resolved_reversed',
  CLOSED: 'closed',
});

const OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'manager', 'operator', 'trust_manager', 'compliance_manager']);
const DECISION_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'trust_manager', 'compliance_manager']);
const RISK_WEIGHTS = Object.freeze({
  duplicate_account: 30,
  self_referral: 100,
  code_expired_or_limited: 35,
  minimum_value_not_met: 30,
  missing_channel_consent: 25,
  missing_disclosure: 20,
  repeated_device_pattern: 30,
  repeated_phone_pattern: 35,
  unusual_code_velocity: 40,
  abnormal_conversion_pattern: 35,
  repeated_failed_payments: 45,
  repeated_disputes: 45,
  large_settlement: 35,
});

function enumValues(value) { return Object.values(value); }
function cleanObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)); }
function actorRole(actor = {}) { return String(actor.actor_role || actor.role || '').trim().toLowerCase(); }
function actorIsOperator(actor = {}) { return OPERATOR_ROLES.has(actorRole(actor)); }
function actorCanDecide(actor = {}) { return DECISION_ROLES.has(actorRole(actor)); }
function normalizeEnum(value, allowed, fallback, label) { const normalized = String(value || fallback || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (!allowed.includes(normalized)) throw new ValidationError(`${label} is invalid.`, { value, allowed }); return normalized; }
function numeric(value, label, fallback = 0) { const n = Number(value ?? fallback); if (!Number.isFinite(n)) throw new ValidationError(`${label} must be numeric.`, { value }); return n; }
function nonNegative(value, label, fallback = 0) { const n = numeric(value, label, fallback); if (n < 0) throw new ValidationError(`${label} must be non-negative.`, { value }); return n; }
function redact(value) { if (!value) return null; return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

// Audit export page-size bounds — never an unbounded full-table scan.
const AUDIT_EXPORT_DEFAULT_LIMIT = 500;
const AUDIT_EXPORT_MAX_LIMIT = 1000;
function timestamp(now) { return now().toISOString(); }
function normalizeReason(reason) { return String(reason || '').replace(/\s+/g, ' ').trim(); }

function recommendationFromScore(score, critical = false) {
  if (critical || score >= 100) return TRUST_RECOMMENDATIONS.REJECT;
  if (score >= 60) return TRUST_RECOMMENDATIONS.HOLD;
  if (score >= 25) return TRUST_RECOMMENDATIONS.REVIEW;
  return TRUST_RECOMMENDATIONS.ALLOW;
}

function explanationForStatus(status, risk = {}) {
  const reasons = Array.isArray(risk.signals) ? risk.signals.map((signal) => signal.reason).filter(Boolean) : [];
  if (status === WALLET_TRANSACTION_STATUSES.HELD) return `This benefit is held for trust review. ${reasons.length ? `Reason: ${reasons[0]}` : 'A CarUp operator must review the case before it can continue.'}`;
  if (status === WALLET_TRANSACTION_STATUSES.PENDING) return 'This benefit is pending because CarUp must verify the commercial milestone and attribution before it matures.';
  if (status === WALLET_TRANSACTION_STATUSES.ELIGIBLE) return 'This benefit is eligible but still requires approval before it becomes payable.';
  if (status === WALLET_TRANSACTION_STATUSES.APPROVED) return 'This benefit has been approved and is waiting for payable processing.';
  if (status === WALLET_TRANSACTION_STATUSES.PAYABLE) return 'This benefit is payable and ready for application or payout.';
  if (status === WALLET_TRANSACTION_STATUSES.REJECTED) return 'This benefit was rejected after review. Check the review decision trail for details.';
  if (status === WALLET_TRANSACTION_STATUSES.PAID_OR_APPLIED) return 'This benefit has already been paid or applied.';
  return 'This benefit has been created but has not yet completed trust review.';
}

/**
 * Owner-safe, status-derived resolution message for a dispute. Never echoes the raw administrator
 * resolution note (which may contain internal commentary); maps the dispute status to a safe summary.
 */
function ownerSafeResolution(status) {
  switch (status) {
    case DISPUTE_STATUSES.OPEN:
      return 'Your dispute is open and awaiting review by a CarUp trust reviewer.';
    case DISPUTE_STATUSES.UNDER_REVIEW:
      return 'Your dispute is being reviewed by a CarUp trust reviewer.';
    case DISPUTE_STATUSES.RESOLVED_UPHELD:
      return 'Reviewed: after checking the milestone and attribution, the benefit’s current status was upheld.';
    case DISPUTE_STATUSES.RESOLVED_REVERSED:
      return 'Reviewed: the decision on this benefit was reversed in your favour.';
    case DISPUTE_STATUSES.CLOSED:
      return 'This dispute has been closed.';
    default:
      return 'This dispute has been recorded.';
  }
}

export class ReferralTrustReviewService {
  constructor({ referralService, client, now = () => new Date() } = {}) {
    this.referralService = referralService || new ReferralEngineService({ client, now });
    this.now = now;
  }

  getRuleCatalog() {
    return {
      risk_signals: Object.keys(RISK_WEIGHTS),
      recommendations: enumValues(TRUST_RECOMMENDATIONS),
      review_statuses: enumValues(REVIEW_CASE_STATUSES),
      dispute_statuses: enumValues(DISPUTE_STATUSES),
      wallet_hold_status: WALLET_TRANSACTION_STATUSES.HELD,
      guardrails: [
        'risk_checks_before_benefit_maturity',
        'human_review_for_disputed_cases_blocked_accounts_large_settlements_and_compliance_exceptions',
        'ai_recommendations_stored_but_reviewable',
        'admin_event_trail_and_audit_export_required',
      ],
    };
  }

  assertOperator(actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Trust review actions require trust operator context.');
  }

  assertDecisionActor(actor = {}) {
    if (!actorCanDecide(actor)) throw new ForbiddenError('Trust review decisions require trust manager or admin context.');
  }

  buildRiskSignals(input = {}) {
    const signals = [];
    const metrics = cleanObject(input.metrics);
    const orderAmount = nonNegative(input.order_amount ?? input.booking_value ?? metrics.order_amount, 'order_amount', 0);
    const minimumValue = nonNegative(input.minimum_order_amount ?? input.minimum_booking_value ?? metrics.minimum_order_amount, 'minimum_order_amount', 0);
    const largeSettlementThreshold = nonNegative(input.large_settlement_threshold, 'large_settlement_threshold', 500);
    const add = (type, triggered, reason, evidence = {}) => {
      if (!triggered) return;
      signals.push({ type, weight: RISK_WEIGHTS[type] || 10, reason, evidence });
    };

    add('duplicate_account', Boolean(input.duplicate_account || metrics.duplicate_account_count > 0), 'Possible duplicate account pattern detected.', { count: metrics.duplicate_account_count || null, user_hash: redact(input.user_id || input.user_email) });
    add('self_referral', Boolean(input.self_referral || (input.referrer_user_id && input.referred_user_id && input.referrer_user_id === input.referred_user_id)), 'Self-referral is not allowed for benefit maturity.', { referrer_hash: redact(input.referrer_user_id), referred_hash: redact(input.referred_user_id) });
    add('code_expired_or_limited', Boolean(input.code_expired || input.code_exhausted || input.usage_limit_exceeded), 'Referral code expiry or usage limit issue detected.', { code_id: input.code_id || null });
    add('minimum_value_not_met', minimumValue > 0 && orderAmount < minimumValue, 'Minimum order or booking value has not been met.', { order_amount: orderAmount, minimum_order_amount: minimumValue });
    add('missing_channel_consent', input.channel_consent === false || input.consent_recorded === false, 'Channel consent record is missing or false.', { channel: input.channel || null });
    add('missing_disclosure', input.disclosure_present === false, 'Public disclosure text is missing from promoted referral material.', { asset_id: input.asset_id || null });
    add('repeated_device_pattern', Boolean(input.repeated_device || metrics.device_count > 3), 'Repeated device pattern detected.', { device_hash: redact(input.device_fingerprint), count: metrics.device_count || null });
    add('repeated_phone_pattern', Boolean(input.repeated_phone || metrics.phone_count > 2), 'Repeated phone pattern detected.', { phone_hash: redact(input.phone || input.phone_hash), count: metrics.phone_count || null });
    add('unusual_code_velocity', Boolean(input.unusual_code_velocity || metrics.code_uses_24h > 20), 'Unusual referral-code velocity detected.', { code_uses_24h: metrics.code_uses_24h || null });
    add('abnormal_conversion_pattern', Boolean(input.abnormal_conversion || metrics.conversion_rate > 0.9), 'Abnormal campaign conversion pattern detected.', { conversion_rate: metrics.conversion_rate || null });
    add('repeated_failed_payments', Boolean(input.repeated_failed_payments || metrics.failed_payments > 1), 'Repeated failed payment pattern detected.', { failed_payments: metrics.failed_payments || null });
    add('repeated_disputes', Boolean(input.repeated_disputes || metrics.dispute_count > 0), 'Repeated dispute history detected.', { dispute_count: metrics.dispute_count || null });
    add('large_settlement', orderAmount >= largeSettlementThreshold || Number(input.wallet_amount || 0) >= largeSettlementThreshold, 'Large settlement requires human review.', { order_amount: orderAmount, wallet_amount: input.wallet_amount || null, threshold: largeSettlementThreshold });

    const score = signals.reduce((sum, signal) => sum + signal.weight, 0);
    const critical = signals.some((signal) => ['self_referral'].includes(signal.type));
    return { score, signals, recommendation: recommendationFromScore(score, critical), critical };
  }

  async runRiskCheck(input = {}, actor = {}) {
    this.assertOperator(actor);
    const risk = this.buildRiskSignals(input);
    const metadata = {
      target_type: input.target_type || 'benefit',
      target_id: input.target_id || input.wallet_transaction_id || input.subject_id || null,
      wallet_transaction_id: input.wallet_transaction_id || null,
      campaign_id: input.campaign_id || null,
      code_id: input.code_id || null,
      recommendation: risk.recommendation,
      score: risk.score,
      critical: risk.critical,
      signals: risk.signals,
      cited_events: Array.isArray(input.cited_events) ? input.cited_events : [],
      ai_summary: input.ai_summary || this.summarizeRisk(risk),
      created_by_ai_role: 'Trust',
      review_required: risk.recommendation !== TRUST_RECOMMENDATIONS.ALLOW,
      created_at: timestamp(this.now),
    };
    const event = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.RISK_CHECK_RUN,
      campaign_id: input.campaign_id || null,
      code_id: input.code_id || null,
      wallet_transaction_id: input.wallet_transaction_id || null,
      subject_type: metadata.target_type,
      subject_id: metadata.target_id,
      channel: input.channel || REFERRAL_CHANNELS.ADMIN,
      session_id: input.session_id || actor.session_id || null,
      metadata,
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.AI_RECOMMENDATION_STORED,
      campaign_id: input.campaign_id || null,
      code_id: input.code_id || null,
      wallet_transaction_id: input.wallet_transaction_id || null,
      subject_type: metadata.target_type,
      subject_id: metadata.target_id,
      channel: input.channel || REFERRAL_CHANNELS.ADMIN,
      session_id: input.session_id || actor.session_id || null,
      metadata: { risk_check_event_id: event.id, recommendation: risk.recommendation, score: risk.score, explanation: metadata.ai_summary, cited_events: metadata.cited_events, reviewable: true },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { success: true, risk_check: { id: event.id, ...metadata }, event };
  }

  summarizeRisk(risk = {}) {
    if (!risk.signals?.length) return 'No major trust signals were detected. Recommendation: allow.';
    return `Detected ${risk.signals.length} trust signal(s), score ${risk.score}. Recommendation: ${risk.recommendation}. Primary signal: ${risk.signals[0].reason}`;
  }

  async createReviewCase(input = {}, actor = {}) {
    this.assertOperator(actor);
    const riskCheckId = input.risk_check_event_id || null;
    let riskCheck = null;
    if (riskCheckId) riskCheck = await this.referralService.repository.findOne(REFERRAL_TABLES.events, { id: riskCheckId });
    if (riskCheckId && !riskCheck) throw new NotFoundError('Risk check event not found.', { risk_check_event_id: riskCheckId });
    const metadata = {
      status: REVIEW_CASE_STATUSES.OPEN,
      target_type: input.target_type || riskCheck?.subject_type || 'benefit',
      target_id: input.target_id || riskCheck?.subject_id || input.wallet_transaction_id || null,
      wallet_transaction_id: input.wallet_transaction_id || riskCheck?.wallet_transaction_id || riskCheck?.metadata?.wallet_transaction_id || null,
      risk_check_event_id: riskCheckId,
      recommendation: input.recommendation || riskCheck?.metadata?.recommendation || TRUST_RECOMMENDATIONS.REVIEW,
      reason: normalizeReason(input.reason || riskCheck?.metadata?.ai_summary || 'Manual trust review required.'),
      priority: input.priority || (riskCheck?.metadata?.recommendation === TRUST_RECOMMENDATIONS.REJECT ? 'high' : 'normal'),
      assigned_to: input.assigned_to || null,
      cited_events: Array.isArray(input.cited_events) ? input.cited_events : riskCheck?.metadata?.cited_events || [],
      created_by: actor.actor_user_id || null,
      created_at: timestamp(this.now),
    };
    const event = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.REVIEW_CASE_CREATED,
      campaign_id: input.campaign_id || riskCheck?.campaign_id || null,
      code_id: input.code_id || riskCheck?.code_id || null,
      wallet_transaction_id: metadata.wallet_transaction_id,
      subject_type: 'trust_review_case',
      subject_id: metadata.target_id,
      channel: REFERRAL_CHANNELS.ADMIN,
      session_id: input.session_id || actor.session_id || null,
      metadata,
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { success: true, review_case: { id: event.id, ...metadata }, event };
  }

  async listReviewCases(filters = {}) {
    const events = await this.referralService.repository.list(REFERRAL_TABLES.events, { event_type: TRUST_EVENT_TYPES.REVIEW_CASE_CREATED }, { orderBy: 'created_at', ascending: false, limit: Number(filters.limit || 200) });
    return events.filter((event) => !filters.status || cleanObject(event.metadata).status === filters.status)
      .filter((event) => !filters.target_type || cleanObject(event.metadata).target_type === filters.target_type)
      .filter((event) => !filters.wallet_transaction_id || cleanObject(event.metadata).wallet_transaction_id === filters.wallet_transaction_id);
  }

  async getEvent(id, expectedType, label) {
    const event = await this.referralService.repository.findOne(REFERRAL_TABLES.events, { id });
    if (!event || (expectedType && event.event_type !== expectedType)) throw new NotFoundError(`${label} not found.`, { id });
    return event;
  }

  async decideReviewCase(caseEventId, input = {}, actor = {}) {
    this.assertDecisionActor(actor);
    const decision = normalizeEnum(input.decision || input.status, [TRUST_RECOMMENDATIONS.ALLOW, TRUST_RECOMMENDATIONS.HOLD, TRUST_RECOMMENDATIONS.REJECT, 'approve'], TRUST_RECOMMENDATIONS.REVIEW, 'decision');
    const caseEvent = await this.getEvent(caseEventId, TRUST_EVENT_TYPES.REVIEW_CASE_CREATED, 'Review case');
    const metadata = cleanObject(caseEvent.metadata);
    const nextStatus = decision === TRUST_RECOMMENDATIONS.ALLOW || decision === 'approve' ? REVIEW_CASE_STATUSES.APPROVED : decision === TRUST_RECOMMENDATIONS.HOLD ? REVIEW_CASE_STATUSES.HELD : REVIEW_CASE_STATUSES.REJECTED;
    const updatedCase = await this.referralService.repository.updateById(REFERRAL_TABLES.events, caseEventId, { metadata: { ...metadata, status: nextStatus, decision, decision_reason: normalizeReason(input.reason), decided_by: actor.actor_user_id || null, decided_at: timestamp(this.now) } });
    let wallet_transaction = null;
    const walletTransactionId = input.wallet_transaction_id || metadata.wallet_transaction_id;
    if (walletTransactionId && decision === TRUST_RECOMMENDATIONS.HOLD) wallet_transaction = await this.applyWalletHold(walletTransactionId, { reason: input.reason || 'Trust review hold.', review_case_event_id: caseEventId }, actor);
    if (walletTransactionId && decision === TRUST_RECOMMENDATIONS.REJECT) {
      wallet_transaction = await this.referralService.transitionWalletTransaction(walletTransactionId, WALLET_TRANSACTION_STATUSES.REJECTED, { ...actor, actor_type: ACTOR_TYPES.ADMIN });
    }
    const decisionEvent = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.REVIEW_CASE_DECIDED,
      campaign_id: caseEvent.campaign_id || null,
      code_id: caseEvent.code_id || null,
      wallet_transaction_id: walletTransactionId || null,
      subject_type: 'trust_review_case',
      subject_id: caseEventId,
      channel: REFERRAL_CHANNELS.ADMIN,
      session_id: input.session_id || actor.session_id || null,
      metadata: { decision, status: nextStatus, reason: normalizeReason(input.reason), decided_by: actor.actor_user_id || null, wallet_transaction_id: walletTransactionId || null },
    }, { ...actor, actor_type: ACTOR_TYPES.ADMIN });
    return { success: true, review_case: updatedCase, decision_event: decisionEvent, wallet_transaction };
  }

  async applyWalletHold(transactionId, input = {}, actor = {}) {
    this.assertOperator(actor);
    const transaction = await this.referralService.repository.findOne(REFERRAL_TABLES.walletTransactions, { id: transactionId });
    if (!transaction) throw new NotFoundError('Wallet transaction not found.', { transaction_id: transactionId });
    let updated = transaction;
    if (transaction.status !== WALLET_TRANSACTION_STATUSES.HELD) {
      updated = await this.referralService.transitionWalletTransaction(transactionId, WALLET_TRANSACTION_STATUSES.HELD, { ...actor, actor_type: ACTOR_TYPES.ADMIN });
    }
    const holdEvent = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.WALLET_HOLD_APPLIED,
      campaign_id: transaction.campaign_id || null,
      code_id: transaction.code_id || null,
      wallet_transaction_id: transactionId,
      subject_type: 'wallet_transaction',
      subject_id: transactionId,
      channel: REFERRAL_CHANNELS.ADMIN,
      session_id: input.session_id || actor.session_id || null,
      metadata: { reason: normalizeReason(input.reason || 'Trust hold applied.'), review_case_event_id: input.review_case_event_id || null, held_by: actor.actor_user_id || null, held_at: timestamp(this.now), previous_status: transaction.status, status: WALLET_TRANSACTION_STATUSES.HELD },
    }, { ...actor, actor_type: ACTOR_TYPES.ADMIN });
    return { success: true, transaction: updated, hold_event: holdEvent };
  }

  async explainBenefitStatus(transactionId, actor = {}) {
    const transaction = await this.referralService.repository.findOne(REFERRAL_TABLES.walletTransactions, { id: transactionId });
    if (!transaction) throw new NotFoundError('Wallet transaction not found.', { transaction_id: transactionId });
    const riskEvents = await this.referralService.repository.list(REFERRAL_TABLES.events, { wallet_transaction_id: transactionId });
    const latestRisk = [...riskEvents].reverse().find((event) => event.event_type === TRUST_EVENT_TYPES.RISK_CHECK_RUN) || null;
    const explanation = explanationForStatus(transaction.status, cleanObject(latestRisk?.metadata));
    const event = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.BENEFIT_EXPLANATION_CREATED,
      campaign_id: transaction.campaign_id || null,
      code_id: transaction.code_id || null,
      wallet_transaction_id: transactionId,
      subject_type: 'wallet_transaction',
      subject_id: transactionId,
      channel: REFERRAL_CHANNELS.ADMIN,
      session_id: actor.session_id || null,
      metadata: { status: transaction.status, explanation, risk_check_event_id: latestRisk?.id || null, user_id: transaction.user_id || null, created_at: timestamp(this.now) },
    }, { ...actor, actor_type: actor.actor_type || ACTOR_TYPES.AGENT });
    return { success: true, explanation, status: transaction.status, event };
  }

  // Phase E: list referral disputes from real DISPUTE_CREATED events (status reflects
  // resolution, which updates the same event in place). Tenant-safe + paginated.
  async listDisputes(filters = {}) {
    const events = await this.referralService.repository.list(REFERRAL_TABLES.events, { event_type: TRUST_EVENT_TYPES.DISPUTE_CREATED }, { orderBy: 'created_at', ascending: false, limit: 1000 });
    const md = (event) => event.metadata || {};
    let rows = (events || []).filter(Boolean);
    if (filters.tenant_id) rows = rows.filter((event) => event.tenant_id === filters.tenant_id);
    if (filters.status) rows = rows.filter((event) => md(event).status === filters.status);
    if (filters.wallet_transaction_id) rows = rows.filter((event) => md(event).wallet_transaction_id === filters.wallet_transaction_id || event.wallet_transaction_id === filters.wallet_transaction_id);
    if (filters.user_id) rows = rows.filter((event) => md(event).opened_by === filters.user_id);
    if (filters.dispute_event_id) rows = rows.filter((event) => event.id === filters.dispute_event_id);
    const { page, pagination } = paginateReferralRows(rows, filters);
    const disputes = page.map((event) => {
      const meta = md(event);
      return {
        dispute_event_id: event.id,
        status: meta.status ?? null,
        target_type: meta.target_type ?? null,
        target_id: meta.target_id ?? null,
        wallet_transaction_id: meta.wallet_transaction_id ?? event.wallet_transaction_id ?? null,
        opened_by: meta.opened_by ?? null,
        reason: meta.reason ?? null,
        resolution_reason: meta.resolution_reason ?? null,
        resolved_at: meta.resolved_at ?? null,
        created_at: event.created_at ?? null,
      };
    });
    return { disputes, pagination };
  }

  /**
   * Referral V1 Stage-4 remediation B: owner-scoped dispute read for the Refer & Earn surface.
   *
   * Returns ONLY disputes linked to wallet transactions the authenticated owner actually owns
   * (transaction.user_id === ownerUserId), so no user can read another user's dispute. The projection
   * is owner-safe: the owner's own reason, a status-derived owner-safe resolution message (NOT the raw
   * administrator resolution note), timestamps, and the current benefit status. Confidential
   * administrator commentary and risk/fraud signals are never exposed.
   *
   * @param {string} ownerUserId authenticated owner id (derived server-side; never caller-supplied)
   * @param {object} [filters] { wallet_transaction_id, tenant_id, limit, offset }
   */
  async listOwnerDisputes(ownerUserId, filters = {}) {
    if (!ownerUserId) throw new ForbiddenError('An authenticated owner is required to read disputes.');
    const md = (event) => event.metadata || {};

    // Scope by OWNERSHIP FIRST — never scan a globally-capped dispute stream. Either one explicitly
    // requested (and ownership-proven) transaction, or the owner's own wallet transactions.
    let ownerTransactions;
    if (filters.wallet_transaction_id) {
      const tx = await this.referralService.repository.findOne(REFERRAL_TABLES.walletTransactions, { id: filters.wallet_transaction_id });
      if (!tx) throw new NotFoundError('Wallet transaction not found.', { wallet_transaction_id: filters.wallet_transaction_id });
      if (tx.user_id !== ownerUserId) throw new ForbiddenError('You can only read disputes on your own benefits.');
      ownerTransactions = [tx];
    } else {
      // Bounded by the owner's OWN transaction count (not platform scale).
      ownerTransactions = (await this.referralService.repository.list(REFERRAL_TABLES.walletTransactions, { user_id: ownerUserId })) || [];
    }

    // Query disputes only for those owner-scoped transactions (direct per-transaction lookup — no
    // global event cap that could hide an owner's dispute behind newer unrelated disputes).
    const rows = [];
    for (const tx of ownerTransactions) {
      if (filters.tenant_id && tx.tenant_id && tx.tenant_id !== filters.tenant_id) continue;
      const events = await this.referralService.repository.list(
        REFERRAL_TABLES.events,
        { event_type: TRUST_EVENT_TYPES.DISPUTE_CREATED, wallet_transaction_id: tx.id }
      );
      for (const event of (events || []).filter(Boolean)) {
        const meta = md(event);
        // Defense in depth: only surface disputes the OWNER themself opened. An operator-filed internal
        // case (or any dispute not opened by this owner) is never rendered as the owner's own dispute.
        if (meta.opened_by !== ownerUserId) continue;
        if (filters.tenant_id && event.tenant_id && event.tenant_id !== filters.tenant_id) continue;
        rows.push({
          dispute_id: event.id,
          wallet_transaction_id: tx.id,
          status: meta.status ?? null,
          submitted_at: meta.created_at ?? event.created_at ?? null,
          resolved_at: meta.resolved_at ?? null,
          owner_reason: meta.reason ?? null,
          owner_safe_resolution: ownerSafeResolution(meta.status),
          benefit_status: tx.status ?? null,
          _sort: event.created_at || meta.created_at || '',
        });
      }
    }

    // Ordering + bounded pagination applied AFTER ownership scoping.
    rows.sort((a, b) => String(b._sort).localeCompare(String(a._sort)));
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const total = rows.length;
    const page = rows.slice(offset, offset + limit).map(({ _sort, ...d }) => d);
    return { disputes: page, pagination: { limit, offset, total, has_more: offset + limit < total } };
  }

  async createDispute(input = {}, actor = {}) {
    const actorUserId = actor.actor_user_id || null;
    if (!actorUserId) throw new ForbiddenError('An authenticated actor is required to open a dispute.');
    const isOperator = actorIsOperator(actor);
    const walletTransactionId = input.wallet_transaction_id || null;

    // Ordinary owner/user path: the caller may only dispute a benefit they actually own. The wallet
    // owner is loaded server-side and compared to the authenticated actor — a caller-supplied owner,
    // beneficiary, or opened_by is never trusted as authority.
    let walletTransaction = null;
    if (!isOperator) {
      if (!walletTransactionId) throw new ValidationError('wallet_transaction_id is required to open a dispute.');
      walletTransaction = await this.referralService.repository.findOne(REFERRAL_TABLES.walletTransactions, { id: walletTransactionId });
      if (!walletTransaction) throw new NotFoundError('Wallet transaction not found.', { wallet_transaction_id: walletTransactionId });
      if (walletTransaction.user_id !== actorUserId) {
        throw new ForbiddenError('You can only dispute a benefit in your own wallet.');
      }
      if (actor.actor_tenant_id && walletTransaction.tenant_id && walletTransaction.tenant_id !== actor.actor_tenant_id) {
        throw new ForbiddenError('Cross-tenant dispute is not permitted.');
      }
    } else if (!input.target_id && !walletTransactionId) {
      // Operator/admin workflow (e.g. trust console) may open an internal case, but still needs a subject.
      throw new ValidationError('target_id or wallet_transaction_id is required for disputes.');
    }

    const metadata = {
      status: DISPUTE_STATUSES.OPEN,
      target_type: input.target_type || 'wallet_transaction',
      target_id: input.target_id || walletTransactionId,
      wallet_transaction_id: walletTransactionId,
      reason: normalizeReason(input.reason || 'Referral dispute opened.'),
      // opened_by is ALWAYS the authenticated actor — never a caller-supplied input.opened_by.
      opened_by: actorUserId,
      // Records how the dispute was filed so an operator-created internal case is never mistaken for an
      // owner-filed dispute in the owner-scoped read (which requires opened_by === owner).
      opened_by_role: isOperator ? 'operator' : 'owner',
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      created_at: timestamp(this.now),
    };
    const event = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.DISPUTE_CREATED,
      campaign_id: input.campaign_id || walletTransaction?.campaign_id || null,
      code_id: input.code_id || walletTransaction?.code_id || null,
      wallet_transaction_id: walletTransactionId,
      subject_type: 'trust_dispute',
      subject_id: metadata.target_id,
      channel: input.channel || REFERRAL_CHANNELS.ADMIN,
      session_id: input.session_id || actor.session_id || null,
      metadata,
    }, { ...actor, actor_type: actor.actor_type || (isOperator ? ACTOR_TYPES.AGENT : ACTOR_TYPES.USER) });
    return { success: true, dispute: { id: event.id, ...metadata }, event };
  }

  async resolveDispute(disputeEventId, input = {}, actor = {}) {
    this.assertDecisionActor(actor);
    const disputeEvent = await this.getEvent(disputeEventId, TRUST_EVENT_TYPES.DISPUTE_CREATED, 'Dispute');
    const status = normalizeEnum(input.status || input.decision, [DISPUTE_STATUSES.RESOLVED_UPHELD, DISPUTE_STATUSES.RESOLVED_REVERSED, DISPUTE_STATUSES.CLOSED], DISPUTE_STATUSES.RESOLVED_UPHELD, 'status');
    const metadata = cleanObject(disputeEvent.metadata);
    const updated = await this.referralService.repository.updateById(REFERRAL_TABLES.events, disputeEventId, { metadata: { ...metadata, status, resolution_reason: normalizeReason(input.reason), resolved_by: actor.actor_user_id || null, resolved_at: timestamp(this.now) } });
    const event = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.DISPUTE_RESOLVED,
      campaign_id: disputeEvent.campaign_id || null,
      code_id: disputeEvent.code_id || null,
      wallet_transaction_id: metadata.wallet_transaction_id || null,
      subject_type: 'trust_dispute',
      subject_id: disputeEventId,
      channel: REFERRAL_CHANNELS.ADMIN,
      session_id: input.session_id || actor.session_id || null,
      metadata: { dispute_event_id: disputeEventId, status, reason: normalizeReason(input.reason), resolved_by: actor.actor_user_id || null },
    }, { ...actor, actor_type: ACTOR_TYPES.ADMIN });
    return { success: true, dispute: updated, resolution_event: event };
  }

  async exportAuditTrail(filters = {}, actor = {}) {
    this.assertOperator(actor);
    // Validate + cap the page size — never an unbounded full-table scan.
    const requestedLimit = Number(filters.limit ?? AUDIT_EXPORT_DEFAULT_LIMIT);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), AUDIT_EXPORT_MAX_LIMIT)
      : AUDIT_EXPORT_DEFAULT_LIMIT;
    const events = await this.referralService.getAdminTimeline({
      tenant_id: filters.tenant_id || undefined,
      campaign_id: filters.campaign_id || undefined,
      code_id: filters.code_id || undefined,
      event_type: filters.event_type || undefined,
      limit,
    });
    // Compact, bounded per-event records. We store a checksum of each event's
    // metadata rather than the raw metadata, so the export payload + checksum stay
    // bounded regardless of individual event metadata size (tamper-evident, stable).
    const eventRecords = events.map((event) => ({
      id: event.id,
      event_type: event.event_type,
      subject_type: event.subject_type,
      subject_id: event.subject_id,
      wallet_transaction_id: event.wallet_transaction_id || null,
      campaign_id: event.campaign_id || null,
      code_id: event.code_id || null,
      created_at: event.created_at || event.occurred_at || null,
      metadata_checksum: checksum(cleanObject(event.metadata)),
    }));
    const exportPayload = {
      generated_at: timestamp(this.now),
      generated_by: actor.actor_user_id || null,
      filters: cleanObject(filters),
      limit,
      count: eventRecords.length,
      events: eventRecords,
    };
    const exportChecksum = checksum(exportPayload);
    // The recorded audit-export event stores ONLY a summary — never the event list
    // — to prevent recursive export-event growth (each export previously embedded
    // every prior event, including prior exports, causing exponential bloat).
    const event = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.AUDIT_EXPORT_CREATED,
      subject_type: 'audit_export',
      subject_id: exportChecksum,
      channel: REFERRAL_CHANNELS.ADMIN,
      session_id: filters.session_id || actor.session_id || null,
      metadata: {
        generated_at: exportPayload.generated_at,
        generated_by: exportPayload.generated_by,
        filters: exportPayload.filters,
        limit,
        count: exportPayload.count,
        checksum: exportChecksum,
      },
    }, { ...actor, actor_type: ACTOR_TYPES.ADMIN });
    return { success: true, export: { ...exportPayload, checksum: exportChecksum, event_id: event.id } };
  }
}

export default ReferralTrustReviewService;
