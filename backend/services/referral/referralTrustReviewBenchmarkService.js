import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import {
  DISPUTE_STATUSES,
  TRUST_EVENT_TYPES,
  TRUST_RECOMMENDATIONS,
  ReferralTrustReviewService,
} from './referralTrustReviewService.js';

const OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'manager', 'operator', 'trust_manager', 'compliance_manager']);
const DECISION_OUTCOMES_REQUIRING_REASON = new Set([TRUST_RECOMMENDATIONS.ALLOW, TRUST_RECOMMENDATIONS.HOLD, TRUST_RECOMMENDATIONS.REJECT, 'approve']);

function roleOf(actor = {}) {
  return String(actor.actor_role || actor.role || '').trim().toLowerCase();
}

function isOperator(actor = {}) {
  return OPERATOR_ROLES.has(roleOf(actor));
}

function nonNegative(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ValidationError(`${label} must be a non-negative number.`, { value });
  return number;
}

function positiveLimit(value, label, fallback = 200, max = 1000) {
  const limit = Number(value ?? fallback);
  if (!Number.isFinite(limit) || limit <= 0) throw new ValidationError(`${label} must be a positive number.`, { value });
  if (limit > max) throw new ValidationError(`${label} cannot exceed ${max} records.`, { value: limit });
  return limit;
}

function requireReason(value, label) {
  const reason = String(value || '').replace(/\s+/g, ' ').trim();
  if (!reason) throw new ValidationError(`${label} is required.`);
  return reason;
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function sequenceFromId(id) {
  const match = String(id || '').match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function newestFirst(a, b) {
  const aTime = new Date(a.created_at || 0).getTime() || 0;
  const bTime = new Date(b.created_at || 0).getTime() || 0;
  if (aTime !== bTime) return bTime - aTime;
  return sequenceFromId(b.id) - sequenceFromId(a.id);
}

function explanationForStatus(status, risk = {}) {
  const reasons = Array.isArray(risk.signals) ? risk.signals.map((signal) => signal.reason).filter(Boolean) : [];
  if (status === 'held') return `This benefit is held for trust review. ${reasons.length ? `Reason: ${reasons[0]}` : 'A CarUp operator must review the case before it can continue.'}`;
  if (status === 'pending') return 'This benefit is pending because CarUp must verify the commercial milestone and attribution before it matures.';
  if (status === 'eligible') return 'This benefit is eligible but still requires approval before it becomes payable.';
  if (status === 'approved') return 'This benefit has been approved and is waiting for payable processing.';
  if (status === 'payable') return 'This benefit is payable and ready for application or payout.';
  if (status === 'rejected') return 'This benefit was rejected after review. Check the review decision trail for details.';
  if (status === 'paid_or_applied') return 'This benefit has already been paid or applied.';
  return 'This benefit has been created but has not yet completed trust review.';
}

export class ReferralTrustReviewBenchmarkService extends ReferralTrustReviewService {
  assertCanViewTransaction(transaction, actor = {}) {
    if (isOperator(actor)) return;
    if (transaction?.user_id && transaction.user_id === actor.actor_user_id) return;
    throw new ForbiddenError('You cannot access another user benefit record.');
  }

  async getWalletTransaction(transactionId) {
    const transaction = await this.referralService.repository.findOne(REFERRAL_TABLES.walletTransactions, { id: transactionId });
    if (!transaction) throw new NotFoundError('Wallet transaction not found.', { transaction_id: transactionId });
    return transaction;
  }

  buildRiskSignals(input = {}) {
    nonNegative(input.wallet_amount, 'wallet_amount');
    if (input.metrics && typeof input.metrics === 'object') {
      for (const key of ['duplicate_account_count', 'device_count', 'phone_count', 'code_uses_24h', 'failed_payments', 'dispute_count']) {
        nonNegative(input.metrics[key], key);
      }
      if (input.metrics.conversion_rate !== undefined) {
        const rate = nonNegative(input.metrics.conversion_rate, 'conversion_rate');
        if (rate > 1) throw new ValidationError('conversion_rate must be between 0 and 1.', { value: input.metrics.conversion_rate });
      }
    }
    return super.buildRiskSignals(input);
  }

  async createReviewCase(input = {}, actor = {}) {
    if (input.risk_check_event_id) {
      const existing = await this.referralService.repository.list(REFERRAL_TABLES.events, { event_type: TRUST_EVENT_TYPES.REVIEW_CASE_CREATED });
      const duplicate = existing.find((event) => cleanObject(event.metadata).risk_check_event_id === input.risk_check_event_id);
      if (duplicate) throw new ValidationError('A review case already exists for this risk check.', { risk_check_event_id: input.risk_check_event_id, existing_case_event_id: duplicate.id });
    }
    return super.createReviewCase(input, actor);
  }

  async listReviewCases(filters = {}) {
    positiveLimit(filters.limit, 'review case limit', 200, 1000);
    return super.listReviewCases(filters);
  }

  async decideReviewCase(caseEventId, input = {}, actor = {}) {
    const decision = String(input.decision || input.status || '').trim().toLowerCase();
    if (DECISION_OUTCOMES_REQUIRING_REASON.has(decision)) requireReason(input.reason, 'decision reason');
    return super.decideReviewCase(caseEventId, input, actor);
  }

  async applyWalletHold(transactionId, input = {}, actor = {}) {
    requireReason(input.reason, 'wallet hold reason');
    return super.applyWalletHold(transactionId, input, actor);
  }

  async explainBenefitStatus(transactionId, actor = {}) {
    const transaction = await this.getWalletTransaction(transactionId);
    this.assertCanViewTransaction(transaction, actor);
    const riskEvents = await this.referralService.repository.list(REFERRAL_TABLES.events, { wallet_transaction_id: transactionId });
    const latestRisk = [...riskEvents].sort(newestFirst).find((event) => event.event_type === TRUST_EVENT_TYPES.RISK_CHECK_RUN) || null;
    const explanation = explanationForStatus(transaction.status, cleanObject(latestRisk?.metadata));
    const event = await this.referralService.recordReferralEvent({
      event_type: TRUST_EVENT_TYPES.BENEFIT_EXPLANATION_CREATED,
      campaign_id: transaction.campaign_id || null,
      code_id: transaction.code_id || null,
      wallet_transaction_id: transactionId,
      subject_type: 'wallet_transaction',
      subject_id: transactionId,
      channel: 'admin',
      session_id: actor.session_id || null,
      metadata: { status: transaction.status, explanation, risk_check_event_id: latestRisk?.id || null, user_id: transaction.user_id || null, created_at: this.now().toISOString() },
    }, { ...actor, actor_type: actor.actor_type || 'agent' });
    return { success: true, explanation, status: transaction.status, event };
  }

  async createDispute(input = {}, actor = {}) {
    requireReason(input.reason, 'dispute reason');
    if (input.wallet_transaction_id) {
      const transaction = await this.getWalletTransaction(input.wallet_transaction_id);
      this.assertCanViewTransaction(transaction, actor);
    }
    return super.createDispute(input, actor);
  }

  async resolveDispute(disputeEventId, input = {}, actor = {}) {
    requireReason(input.reason, 'dispute resolution reason');
    const status = String(input.status || input.decision || '').trim().toLowerCase();
    if (status === DISPUTE_STATUSES.CLOSED) throw new ValidationError('Disputes must be resolved as upheld or reversed before closure.');
    return super.resolveDispute(disputeEventId, input, actor);
  }

  async exportAuditTrail(filters = {}, actor = {}) {
    const limit = positiveLimit(filters.limit, 'audit export limit', 500, 1000);
    return super.exportAuditTrail({ ...filters, limit }, actor);
  }
}

export default ReferralTrustReviewBenchmarkService;
