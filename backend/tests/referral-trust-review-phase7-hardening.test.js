import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import {
  TRUST_EVENT_TYPES,
  ReferralTrustReviewBenchmarkService,
} from '../services/referral/referralTrustReviewBenchmarkService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
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
    source_event_type: 'import_campaign.vehicle_purchased',
    transaction_type: 'referral_credit',
    status: WALLET_TRANSACTION_STATUSES.PENDING,
    amount: overrides.amount ?? 50,
    currency: 'USD',
    reason: 'Referral benefit pending trust review',
  }, trustActor);
}

const trustActor = Object.freeze({ actor_user_id: 'trust-manager-1', actor_role: 'trust_manager', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'trust-session' });
const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'operator-session' });
const memberActor = Object.freeze({ actor_user_id: 'beneficiary-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'member-session' });

test('Phase 7 routes use benchmark trust review service and hardening hooks exist', () => {
  assert.equal(routeFile.includes('ReferralTrustReviewBenchmarkService'), true);
  assert.equal(routeFile.includes('referralTrustReviewBenchmarkService.js'), true);
  for (const marker of ['createReviewCase', 'latestRisk', 'dispute resolution reason', 'wallet hold reason', 'audit export limit']) assert.equal(benchmarkFile.includes(marker), true, marker);
});

test('duplicate review cases for one risk check are blocked before side effects', async () => {
  const { repository, referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  const risk = await trustReview.runRiskCheck({ wallet_transaction_id: tx.id, duplicate_account: true }, trustActor);
  await trustReview.createReviewCase({ risk_check_event_id: risk.risk_check.id, wallet_transaction_id: tx.id }, operatorActor);
  await assert.rejects(() => trustReview.createReviewCase({ risk_check_event_id: risk.risk_check.id, wallet_transaction_id: tx.id }, operatorActor), ValidationError);
  const cases = (await repository.list(REFERRAL_TABLES.events)).filter((event) => event.event_type === TRUST_EVENT_TYPES.REVIEW_CASE_CREATED);
  assert.equal(cases.length, 1);
});

test('hold actions require a reason before wallet transition side effects', async () => {
  const { repository, referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  await assert.rejects(() => trustReview.applyWalletHold(tx.id, {}, trustActor), ValidationError);
  const fresh = await referralService.repository.findOne(REFERRAL_TABLES.walletTransactions, { id: tx.id });
  assert.equal(fresh.status, WALLET_TRANSACTION_STATUSES.PENDING);
  assert.equal((await repository.list(REFERRAL_TABLES.events)).some((event) => event.event_type === TRUST_EVENT_TYPES.WALLET_HOLD_APPLIED), false);
});

test('allow/approve decisions require an audit reason', async () => {
  const { referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  const risk = await trustReview.runRiskCheck({ wallet_transaction_id: tx.id, duplicate_account: true }, trustActor);
  const review = await trustReview.createReviewCase({ risk_check_event_id: risk.risk_check.id, wallet_transaction_id: tx.id }, operatorActor);
  await assert.rejects(() => trustReview.decideReviewCase(review.review_case.id, { decision: 'allow' }, trustActor), ValidationError);
  const decided = await trustReview.decideReviewCase(review.review_case.id, { decision: 'allow', reason: 'Evidence verified by trust manager.' }, trustActor);
  assert.equal(decided.review_case.metadata.status, 'approved');
});

test('benefit explanation cites the latest risk check deterministically when timestamps tie', async () => {
  const { referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  await trustReview.runRiskCheck({ wallet_transaction_id: tx.id, duplicate_account: true }, trustActor);
  await trustReview.runRiskCheck({ wallet_transaction_id: tx.id, repeated_phone: true }, trustActor);
  await trustReview.applyWalletHold(tx.id, { reason: 'Manual risk hold.' }, trustActor);
  const explanation = await trustReview.explainBenefitStatus(tx.id, memberActor);
  assert.equal(explanation.event.metadata.risk_check_event_id.endsWith('-4'), true);
  assert.equal(explanation.explanation.includes('Repeated phone pattern'), true);
});

test('disputes require reason and cannot be closed without resolved outcome', async () => {
  const { repository, referralService, trustReview } = createHarness();
  const tx = await seedPendingBenefit(referralService);
  await assert.rejects(() => trustReview.createDispute({ wallet_transaction_id: tx.id }, memberActor), ValidationError);
  const dispute = await trustReview.createDispute({ wallet_transaction_id: tx.id, reason: 'I need a human review.' }, memberActor);
  await assert.rejects(() => trustReview.resolveDispute(dispute.dispute.id, { status: 'closed', reason: 'closing' }, trustActor), ValidationError);
  const resolved = await trustReview.resolveDispute(dispute.dispute.id, { status: 'resolved_reversed', reason: 'Evidence reverses the dispute.' }, trustActor);
  assert.equal(resolved.dispute.metadata.status, 'resolved_reversed');
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === TRUST_EVENT_TYPES.DISPUTE_RESOLVED), true);
});

test('review case and audit export limits reject invalid values', async () => {
  const { trustReview } = createHarness();
  await assert.rejects(() => trustReview.listReviewCases({ limit: 0 }), ValidationError);
  await assert.rejects(() => trustReview.listReviewCases({ limit: 1001 }), ValidationError);
  await assert.rejects(() => trustReview.exportAuditTrail({ limit: 0 }, trustActor), ValidationError);
  await assert.rejects(() => trustReview.exportAuditTrail({ limit: 1001 }, trustActor), ValidationError);
});
