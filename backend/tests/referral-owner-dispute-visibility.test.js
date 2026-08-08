// Referral V1 Stage-4 remediation B: the Refer & Earn owner surface must show the owner their own
// disputes and reflect administrator resolution. These tests cover the owner-scoped read
// (ReferralTrustReviewService.listOwnerDisputes) — ownership isolation and an owner-safe projection —
// plus the route's authentication requirement (401) via the mounted router.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralTrustReviewService } from '../services/referral/referralTrustReviewService.js';
import { ReferralTrustReviewBenchmarkService } from '../services/referral/referralTrustReviewBenchmarkService.js';
import { createReferralRouter } from '../routes/referralRoutes.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const serviceFile = readFileSync(new URL('../services/referral/referralTrustReviewService.js', import.meta.url), 'utf8');

class MemoryReferralRepository {
  constructor() { this.counter = 0; this.tables = new Map(Object.values(REFERRAL_TABLES).map((table) => [table, []])); }
  nextId(table) { this.counter += 1; return `${table}-${this.counter}`; }
  match(row, filters = {}) { return Object.entries(filters).every(([key, value]) => value === undefined || value === null || row[key] === value); }
  async insert(table, payload) { const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || '2026-07-15T00:00:00.000Z', ...payload }; this.tables.get(table).push(row); return row; }
  async findOne(table, filters = {}) { return this.tables.get(table).find((row) => this.match(row, filters)) || null; }
  async list(table, filters = {}) { return this.tables.get(table).filter((row) => this.match(row, filters)); }
  async updateById(table, id, patch) { const rows = this.tables.get(table); const index = rows.findIndex((row) => row.id === id); if (index === -1) return null; rows[index] = { ...rows[index], ...patch }; return rows[index]; }
  async count(table, filters = {}) { return (await this.list(table, filters)).length; }
}

const OWNER = 'refv1-owner';
const OTHER = 'refv1-other';
const ownerActor = Object.freeze({ actor_user_id: OWNER, actor_role: 'owner', actor_type: 'user', surface: 'web', session_id: 'owner-session' });
const adminActor = Object.freeze({ actor_user_id: 'admin-1', actor_role: 'admin', actor_type: 'agent', surface: 'admin', session_id: 'admin-session' });

async function seedDisputeOnBenefit(referralService, trust, { ownerUserId }) {
  const tx = await referralService.createWalletTransaction({
    user_id: ownerUserId,
    source_event_type: 'local_marketplace.purchase_confirmed',
    transaction_type: 'local_marketplace_referral_credit',
    status: WALLET_TRANSACTION_STATUSES.PENDING,
    amount: 15,
    currency: 'USD',
    reason: 'Local marketplace referral converted',
  }, adminActor);
  const dispute = await trust.createDispute({ wallet_transaction_id: tx.id, reason: 'REFV1-S4 owner disputes pending benefit' }, ownerActor);
  return { tx, dispute };
}

function harness() {
  const repository = new MemoryReferralRepository();
  const now = () => new Date('2026-07-15T00:00:00.000Z');
  const referralService = new ReferralEngineService({ repository, now });
  const trust = new ReferralTrustReviewService({ referralService, now });
  return { repository, referralService, trust };
}

test('remediation B wiring: owner dispute route + owner-safe service method exist', () => {
  assert.match(routeFile, /\/trust\/disputes\/mine/, 'owner-scoped dispute route must be registered');
  assert.match(serviceFile, /listOwnerDisputes/, 'owner-safe dispute read method must exist');
  assert.match(serviceFile, /ownerSafeResolution/, 'status-derived owner-safe resolution helper must exist');
});

test('13: owner can read their own dispute with an owner-safe projection', async () => {
  const { referralService, trust } = harness();
  const { tx, dispute } = await seedDisputeOnBenefit(referralService, trust, { ownerUserId: OWNER });
  const { disputes } = await trust.listOwnerDisputes(OWNER);
  assert.equal(disputes.length, 1);
  const d = disputes[0];
  assert.equal(d.dispute_id, dispute.event.id);
  assert.equal(d.wallet_transaction_id, tx.id);
  assert.equal(d.status, 'open');
  assert.equal(d.benefit_status, WALLET_TRANSACTION_STATUSES.PENDING);
  assert.ok(d.owner_reason && d.owner_reason.includes('REFV1-S4'), 'owner sees their own reason');
  assert.ok(d.owner_safe_resolution, 'an owner-safe resolution message is present');
  assert.ok(d.submitted_at, 'submitted_at present');
});

test('14: another user cannot read the owner’s dispute', async () => {
  const { referralService, trust } = harness();
  await seedDisputeOnBenefit(referralService, trust, { ownerUserId: OWNER });
  const { disputes } = await trust.listOwnerDisputes(OTHER);
  assert.equal(disputes.length, 0, 'a different user sees none of the owner’s disputes');
});

test('16: resolved dispute returns the correct owner-safe status after admin resolution', async () => {
  const { referralService, trust } = harness();
  const { dispute } = await seedDisputeOnBenefit(referralService, trust, { ownerUserId: OWNER });
  await trust.resolveDispute(dispute.event.id, { status: 'resolved_upheld', reason: 'internal: milestone verified, uphold' }, adminActor);
  const { disputes } = await trust.listOwnerDisputes(OWNER);
  assert.equal(disputes[0].status, 'resolved_upheld');
  assert.ok(disputes[0].resolved_at, 'resolved_at is surfaced');
  assert.match(disputes[0].owner_safe_resolution, /upheld/i);
});

test('17: confidential admin resolution notes are NOT exposed to the owner', async () => {
  const { referralService, trust } = harness();
  const { dispute } = await seedDisputeOnBenefit(referralService, trust, { ownerUserId: OWNER });
  const secret = 'internal-only: flagged device fingerprint 0xDEADBEEF';
  await trust.resolveDispute(dispute.event.id, { status: 'resolved_upheld', reason: secret }, adminActor);
  const { disputes } = await trust.listOwnerDisputes(OWNER);
  const serialized = JSON.stringify(disputes[0]);
  assert.ok(!serialized.includes('0xDEADBEEF'), 'raw admin resolution note must not reach the owner');
  assert.ok(!('resolution_reason' in disputes[0]), 'no raw admin resolution_reason field in owner projection');
});

test('owner read requires an owner id (service guard)', async () => {
  const { trust } = harness();
  await assert.rejects(() => trust.listOwnerDisputes(''), ForbiddenError);
  await assert.rejects(() => trust.listOwnerDisputes(null), ForbiddenError);
});

// ── Finding 2: cross-user dispute CREATION is blocked server-side ──
async function seedOwnedTx(referralService, ownerUserId, extra = {}) {
  return referralService.createWalletTransaction({
    user_id: ownerUserId,
    source_event_type: 'local_marketplace.purchase_confirmed',
    transaction_type: 'local_marketplace_referral_credit',
    status: WALLET_TRANSACTION_STATUSES.PENDING,
    amount: 15, currency: 'USD', reason: 'converted', ...extra,
  }, adminActor);
}

test('finding 2: owner can dispute their own transaction', async () => {
  const { referralService, trust } = harness();
  const tx = await seedOwnedTx(referralService, OWNER);
  const res = await trust.createDispute({ wallet_transaction_id: tx.id, reason: 'looks wrong' }, ownerActor);
  assert.equal(res.success, true);
  assert.equal(res.dispute.opened_by, OWNER);
  assert.equal(res.dispute.opened_by_role, 'owner');
});

test('finding 2: another authenticated user gets 403 disputing someone else’s transaction', async () => {
  const { referralService, trust } = harness();
  const tx = await seedOwnedTx(referralService, OWNER);
  const otherActor = { actor_user_id: OTHER, actor_role: 'owner', actor_type: 'user' };
  await assert.rejects(() => trust.createDispute({ wallet_transaction_id: tx.id, reason: 'mine now' }, otherActor), ForbiddenError);
});

test('finding 2: nonexistent transaction returns 404', async () => {
  const { trust } = harness();
  await assert.rejects(() => trust.createDispute({ wallet_transaction_id: 'no-such-tx', reason: 'x' }, ownerActor), NotFoundError);
});

test('finding 2: a caller-supplied opened_by is ignored (derived from the actor)', async () => {
  const { referralService, trust } = harness();
  const tx = await seedOwnedTx(referralService, OWNER);
  const res = await trust.createDispute({ wallet_transaction_id: tx.id, reason: 'x', opened_by: 'attacker' }, ownerActor);
  assert.equal(res.dispute.opened_by, OWNER, 'opened_by comes from the authenticated actor, never the request body');
});

test('finding 2: cross-tenant dispute creation is blocked', async () => {
  const { referralService, trust } = harness();
  const tx = await seedOwnedTx(referralService, OWNER, { tenant_id: 'tenant-A' });
  const crossTenantOwner = { actor_user_id: OWNER, actor_role: 'owner', actor_type: 'user', actor_tenant_id: 'tenant-B' };
  await assert.rejects(() => trust.createDispute({ wallet_transaction_id: tx.id, reason: 'x' }, crossTenantOwner), ForbiddenError);
});

// ── Finding 3: owner read is ownership-scoped, uncapped, and opened_by-defended ──
test('finding 3: the owner’s dispute stays visible behind >1000 unrelated newer disputes (no global cap)', async () => {
  const { referralService, trust, repository } = harness();
  const { dispute } = await seedDisputeOnBenefit(referralService, trust, { ownerUserId: OWNER });
  // Flood the events table with 1001 unrelated, newer DISPUTE_CREATED events on other users' transactions.
  for (let i = 0; i < 1001; i += 1) {
    await repository.insert(REFERRAL_TABLES.events, {
      event_type: 'trust.dispute_created', wallet_transaction_id: `other-tx-${i}`,
      created_at: `2026-08-0${(i % 9) + 1}T00:00:00.000Z`,
      metadata: { status: 'open', wallet_transaction_id: `other-tx-${i}`, opened_by: `other-user-${i}` },
    });
  }
  const { disputes } = await trust.listOwnerDisputes(OWNER);
  assert.equal(disputes.length, 1, 'owner still sees exactly their own dispute');
  assert.equal(disputes[0].dispute_id, dispute.event.id);
});

test('finding 3: a specific older transaction still returns its dispute', async () => {
  const { referralService, trust } = harness();
  const { tx, dispute } = await seedDisputeOnBenefit(referralService, trust, { ownerUserId: OWNER });
  const { disputes } = await trust.listOwnerDisputes(OWNER, { wallet_transaction_id: tx.id });
  assert.equal(disputes.length, 1);
  assert.equal(disputes[0].dispute_id, dispute.event.id);
});

test('finding 3: an attacker-crafted dispute (opened_by != owner) on the owner’s tx is NOT rendered', async () => {
  const { referralService, trust, repository } = harness();
  const tx = await seedOwnedTx(referralService, OWNER);
  // Directly craft a dispute event on the owner's tx but opened by someone else (simulating any path
  // that could produce one, e.g. an operator-filed internal case).
  await repository.insert(REFERRAL_TABLES.events, {
    event_type: 'trust.dispute_created', wallet_transaction_id: tx.id,
    metadata: { status: 'open', wallet_transaction_id: tx.id, opened_by: 'attacker', reason: 'not the owner' },
  });
  const { disputes } = await trust.listOwnerDisputes(OWNER);
  assert.equal(disputes.length, 0, 'defense in depth: only opened_by === owner disputes are surfaced');
});

test('finding 3: pagination is stable and bounded', async () => {
  const { referralService, trust } = harness();
  // three owned transactions, each with the owner's own dispute
  for (let i = 0; i < 3; i += 1) {
    const tx = await seedOwnedTx(referralService, OWNER);
    await trust.createDispute({ wallet_transaction_id: tx.id, reason: `dispute ${i}` }, ownerActor);
  }
  const page1 = await trust.listOwnerDisputes(OWNER, { limit: 2, offset: 0 });
  const page2 = await trust.listOwnerDisputes(OWNER, { limit: 2, offset: 2 });
  assert.equal(page1.pagination.total, 3);
  assert.equal(page1.disputes.length, 2);
  assert.equal(page1.pagination.has_more, true);
  assert.equal(page2.disputes.length, 1);
  assert.equal(page2.pagination.has_more, false);
  const ids = new Set([...page1.disputes, ...page2.disputes].map((d) => d.dispute_id));
  assert.equal(ids.size, 3, 'no overlap or gaps across pages');
});

// ── Route-level: 15 (unauthenticated read returns 401) ──
let server;
let baseUrl;
before(async () => {
  const now = () => new Date('2026-07-15T00:00:00.000Z');
  const repository = new MemoryReferralRepository();
  const referralService = new ReferralEngineService({ repository, now });
  const trustReview = new ReferralTrustReviewBenchmarkService({ referralService, now });
  const router = createReferralRouter({ service: referralService, trustReview });
  const app = express();
  app.use(express.json());
  app.use('/api/referrals', router);
  app.use((err, req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('15: unauthenticated owner dispute read returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/referrals/trust/disputes/mine`);
  assert.equal(res.status, 401);
});
