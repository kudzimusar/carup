import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import {
  REVIEW_CASE_STATUSES,
  TRUST_EVENT_TYPES,
  TRUST_RECOMMENDATIONS,
} from '../services/referral/referralTrustReviewService.js';
import { ReferralTrustReviewBenchmarkService } from '../services/referral/referralTrustReviewBenchmarkService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

const roadmapFile = readFileSync(new URL('../../docs/referral-ai-engine/12_IMPLEMENTATION_ROADMAP_AND_TEST_PLAN.md', import.meta.url), 'utf8');
const trdFile = readFileSync(new URL('../../docs/referral-ai-engine/10_TRUST_FRAUD_COMPLIANCE_GUARDRAILS_TRD.md', import.meta.url), 'utf8');
const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const serviceFile = readFileSync(new URL('../services/referral/referralTrustReviewService.js', import.meta.url), 'utf8');
const benchmarkFile = readFileSync(new URL('../services/referral/referralTrustReviewBenchmarkService.js', import.meta.url), 'utf8');

class MemoryReferralRepository {
  constructor() { this.counter = 0; this.tables = new Map(Object.values(REFERRAL_TABLES).map((table) => [table, []])); }
  nextId(table) { this.counter += 1; return `${table}-${this.counter}`; }
  match(row, filters = {}) { return Object.entries(filters).every(([key, value]) => value === undefined || value === null || row[key] === value); }
  async insert(table, payload) { const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || '2026-06-12T00:00:00.000Z', ...payload }; this.tables.get(table).push(row); return row; }
  async findOne(table, filters = {}) { return this.tables.get(table).find((row) => this.match(row, filters)) || null; }
  async list(table, filters = {}) { return this.tables.get(table).filter((row) => this.match(row, filters)); }
  async updateById(table, id, patch) { const rows = this.tables.get(table); const index = rows.findIndex((row) => row.id === id); if (index === -1) return null; rows[index] = { ...rows[index], ...patch }; return rows[index]; }
  async count(table, filters = {}) { return (await this.list(table, filters)).length; }
}

function createHarness() {
  const repository = new MemoryReferralRepository();
  const referralService = new ReferralEngineService({ repository, now: () => new Date('2026-06-12T00:00:00.000Z'), shareOptions: { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' } });
  const trustReview = new ReferralTrustReviewBenchmarkService({ referralService, now: () => new Date('2026-06-12T00:00:00.000Z') });
  return { repository, referralService, trustReview };
}

async function seedPendingBenefit(referralService, overrides = {}) {
  return referralService.createWalletTransaction({
    user_id: overrides.user_id || 'beneficiary-1',
    source_event_type: overrides.source_event_type || 'import_campaign.vehicle_purchased',
    transaction_type: 'referral_credit',
    status: WALLET_TRANSACTION_STATUSES.PENDING,
    amount: overrides.amount ?? 50,
    currency: 'USD',
    reason: 'Referral benefit pending trust review',
    metadata: { lead_event_id: 'lead-1' },
  }, trustActor);
}

const trustActor = Object.freeze({ actor_user_id: 'trust-operator-1', actor_role: 'trust_manager', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'trust-session' });
const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'operator-session' });
const memberActor = Object.freeze({ actor_user_id: 'beneficiary-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'member-session' });
const otherMemberActor = Object.freeze({ actor_user_id: 'other-user', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'other-session' });

test('Phase 7 roadmap, TRD, service, and routes expose trust/review requirements', () => {
  assert.equal(roadmapFile.includes('Add risk checks, human review queues, wallet holds, dispute handling, and audit exports.'), true);
  for (const marker of ['Duplicate account checks', 'Self-referral checks', 'Manual review queue', 'Audit trail for agent and admin decisions', 'Risk checks run before benefit maturity']) assert.equal(trdFile.includes(marker), true, marker);
  for (const marker of [
    "router.get('/trust/rules'",
    "router.post('/trust/risk-checks'",
    "router.post('/trust/review-cases'",
    "router.get('/trust/review-cases'",
    "router.patch('/trust/review-cases/:caseEventId/decision'",
    "router.post('/trust/wallet-transactions/:transactionId/hold'",
    "router.get('/trust/benefits/:transactionId/explain'",
    "router.post('/trust/disputes'",
    "router.patch('/trust/disputes/:disputeEventId/resolve'",
    "router.get('/trust/audit-export'",
    'ReferralTrustReviewBenchmarkService',
  ]) assert.equal(routeFile.includes(marker), true, `${marker} should exist`);
  assert.equal(serviceFile.includes('TRUST_EVENT_TYPES'), true);
  assert.equal(benchmarkFile.includes('assertCanViewTransaction'), true);
});

test('rule catalog exposes risk signals, recommendations, review statuses, dispute statuses, and guardrails', () => {
  const { trustReview } = createHarness();
  const rules = trustReview.getRuleCatalog();
  for (const signal of ['duplicate_account', 'self_referral', 'minimum_value_not_met', 'missing_channel_consent', 'repeated_failed_payments', 'repeated_disputes']) assert.equal(rules.risk_signals.includes(signal), true);
  for (const recommendation of ['allow', 'hold', 'review', 'reject']) assert.equal(rules.recommendations.includes(recommendation), true);
  assert.equal(rules.wallet_hold_status, WALLET_TRANSACTION_STATUSES.HELD);
  assert.equal(rules.guardrails.includes('risk_checks_before_benefit_maturity'), true);
});

test('risk check stores AI recommendation with cited signals and reviewable trail', async () => {
  const { repository, referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  const risk = await trustReview.runRiskCheck({ wallet_transaction_id: tx.id, referrer_user_id: 'beneficiary-1', referred_user_id: 'beneficiary-1', order_amount: 20, minimum_order_amount: 100, channel_consent: false, disclosure_present: false, metrics: { failed_payments: 2, dispute_count: 1 }, cited_events: ['lead-1'] }, trustActor);
  assert.equal(risk.success, true);
  assert.equal(risk.risk_check.recommendation, TRUST_RECOMMENDATIONS.REJECT);
  assert.equal(risk.risk_check.review_required, true);
  assert.equal(risk.risk_check.signals.some((signal) => signal.type === 'self_referral'), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.RISK_CHECK_RUN), true);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.AI_RECOMMENDATION_STORED && event.metadata.reviewable === true), true);
});

test('review case decision can hold a pending wallet benefit and creates decision audit trail', async () => {
  const { repository, referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  const risk = await trustReview.runRiskCheck({ wallet_transaction_id: tx.id, metrics: { failed_payments: 2 }, order_amount: 700, large_settlement_threshold: 500 }, trustActor);
  const review = await trustReview.createReviewCase({ risk_check_event_id: risk.risk_check.id, wallet_transaction_id: tx.id }, operatorActor);
  assert.equal(review.review_case.status, REVIEW_CASE_STATUSES.OPEN);
  await assert.rejects(() => trustReview.decideReviewCase(review.review_case.id, { decision: 'hold' }, trustActor), ValidationError);
  const decided = await trustReview.decideReviewCase(review.review_case.id, { decision: 'hold', reason: 'Failed payment pattern requires verification.' }, trustActor);
  assert.equal(decided.review_case.metadata.status, REVIEW_CASE_STATUSES.HELD);
  assert.equal(decided.wallet_transaction.transaction.status, WALLET_TRANSACTION_STATUSES.HELD);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.REVIEW_CASE_DECIDED), true);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.WALLET_HOLD_APPLIED), true);
});

test('benefit explanations are clear and access-controlled to owner or trust operator', async () => {
  const { referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService, { user_id: 'beneficiary-1' });
  await trustReview.applyWalletHold(tx.id, { reason: 'Manual trust hold.' }, trustActor);
  const ownerView = await trustReview.explainBenefitStatus(tx.id, memberActor);
  assert.equal(ownerView.explanation.includes('held for trust review'), true);
  await assert.rejects(() => trustReview.explainBenefitStatus(tx.id, otherMemberActor), ForbiddenError);
  const operatorView = await trustReview.explainBenefitStatus(tx.id, trustActor);
  assert.equal(operatorView.status, WALLET_TRANSACTION_STATUSES.HELD);
});

test('dispute creation and resolution preserve owner access and human decision trail', async () => {
  const { repository, referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService, { user_id: 'beneficiary-1' });
  await assert.rejects(() => trustReview.createDispute({ wallet_transaction_id: tx.id, reason: 'I disagree.' }, otherMemberActor), ForbiddenError);
  const dispute = await trustReview.createDispute({ wallet_transaction_id: tx.id, reason: 'Please review this referral benefit.', evidence: ['receipt-1'] }, memberActor);
  assert.equal(dispute.dispute.status, 'open');
  await assert.rejects(() => trustReview.resolveDispute(dispute.dispute.id, { status: 'resolved_upheld', reason: 'Operator checked evidence.' }, operatorActor), ForbiddenError);
  const resolved = await trustReview.resolveDispute(dispute.dispute.id, { status: 'resolved_upheld', reason: 'Evidence confirms attribution.' }, trustActor);
  assert.equal(resolved.dispute.metadata.status, 'resolved_upheld');
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.DISPUTE_CREATED), true);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.DISPUTE_RESOLVED), true);
});

test('audit export returns checksum, stores export event, and enforces benchmark limits', async () => {
  const { repository, referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  await trustReview.runRiskCheck({ wallet_transaction_id: tx.id, duplicate_account: true }, trustActor);
  const audit = await trustReview.exportAuditTrail({ limit: 50 }, trustActor);
  assert.equal(audit.success, true);
  assert.equal(typeof audit.export.checksum, 'string');
  assert.equal(audit.export.count >= 2, true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.AUDIT_EXPORT_CREATED), true);
  await assert.rejects(() => trustReview.exportAuditTrail({ limit: 1001 }, trustActor), ValidationError);
});

test('negative risk metrics are rejected before risk-check side effects', async () => {
  const { repository, trustReview } = createHarness();
  await assert.rejects(() => trustReview.runRiskCheck({ metrics: { failed_payments: -1 } }, trustActor), ValidationError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.RISK_CHECK_RUN), false);
});
