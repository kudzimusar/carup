import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { ReferralTrustReviewService, TRUST_RECOMMENDATIONS } from './referralTrustReviewService.js';

const OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'manager', 'operator', 'trust_manager', 'compliance_manager']);
const DECISION_OUTCOMES_REQUIRING_REASON = new Set([TRUST_RECOMMENDATIONS.HOLD, TRUST_RECOMMENDATIONS.REJECT, 'approve']);

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

function requireReason(value, label) {
  const reason = String(value || '').replace(/\s+/g, ' ').trim();
  if (!reason) throw new ValidationError(`${label} is required.`);
  return reason;
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

  async decideReviewCase(caseEventId, input = {}, actor = {}) {
    const decision = String(input.decision || input.status || '').trim().toLowerCase();
    if (DECISION_OUTCOMES_REQUIRING_REASON.has(decision)) requireReason(input.reason, 'decision reason');
    return super.decideReviewCase(caseEventId, input, actor);
  }

  async explainBenefitStatus(transactionId, actor = {}) {
    const transaction = await this.getWalletTransaction(transactionId);
    this.assertCanViewTransaction(transaction, actor);
    return super.explainBenefitStatus(transactionId, actor);
  }

  async createDispute(input = {}, actor = {}) {
    if (input.wallet_transaction_id) {
      const transaction = await this.getWalletTransaction(input.wallet_transaction_id);
      this.assertCanViewTransaction(transaction, actor);
    }
    return super.createDispute(input, actor);
  }

  async exportAuditTrail(filters = {}, actor = {}) {
    const limit = Number(filters.limit || 500);
    if (!Number.isFinite(limit) || limit <= 0) throw new ValidationError('limit must be a positive number.', { limit: filters.limit });
    if (limit > 1000) throw new ValidationError('audit export limit cannot exceed 1000 records.', { limit });
    return super.exportAuditTrail({ ...filters, limit }, actor);
  }
}

export default ReferralTrustReviewBenchmarkService;
