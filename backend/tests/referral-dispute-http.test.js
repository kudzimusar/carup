// Referral V1 Stage-4 remediation — AUTHENTICATED HTTP tests for the dispute routes.
// Mounts the real referral router with in-memory referral services and a stubbed users table so the
// real authorizeRole()/createActor() path runs over HTTP: owner read, cross-user denial, owner filing,
// cross-user filing denial, unauth, resolved visibility, and the owner-safe projection.
import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { supabase } from '../db/supabase.js';
import { createReferralRouter } from '../routes/referralRoutes.js';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralTrustReviewBenchmarkService } from '../services/referral/referralTrustReviewBenchmarkService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';

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
const ADMIN = 'refv1-admin';
const USERS = {
  [OWNER]: { role: 'owner', is_verified: true },
  [OTHER]: { role: 'owner', is_verified: true },
  [ADMIN]: { role: 'admin', is_verified: true },
};
const adminActor = Object.freeze({ actor_user_id: ADMIN, actor_role: 'admin', actor_type: 'agent', surface: 'admin' });

let server;
let baseUrl;
let ownerTxId;
let referralService;
let trustReview;

before(async () => {
  // Stub the users lookup so authorizeRole()'s x-user-id fallback (test mode) resolves a role.
  mock.method(supabase, 'from', (table) => {
    if (table === 'users') {
      let capturedId = null;
      const builder = {
        select() { return builder; },
        eq(_col, value) { capturedId = value; return builder; },
        async single() { const u = USERS[capturedId]; return u ? { data: u, error: null } : { data: null, error: { message: 'not found' } }; },
        async maybeSingle() { return { data: USERS[capturedId] || null, error: null }; },
      };
      return builder;
    }
    const noop = { select() { return noop; }, eq() { return noop; }, async single() { return { data: null, error: { message: 'n/a' } }; }, async maybeSingle() { return { data: null, error: null }; } };
    return noop;
  });

  const now = () => new Date('2026-07-15T00:00:00.000Z');
  const repository = new MemoryReferralRepository();
  referralService = new ReferralEngineService({ repository, now });
  trustReview = new ReferralTrustReviewBenchmarkService({ referralService, now });
  const router = createReferralRouter({ service: referralService, trustReview });

  const app = express();
  app.use(express.json());
  app.use('/api/referrals', router);
  app.use((err, req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tx = await referralService.createWalletTransaction({
    user_id: OWNER, source_event_type: 'local_marketplace.purchase_confirmed',
    transaction_type: 'local_marketplace_referral_credit', status: WALLET_TRANSACTION_STATUSES.PENDING,
    amount: 15, currency: 'USD', reason: 'converted',
  }, adminActor);
  ownerTxId = tx.id;
});

after(() => { server?.close(); mock.restoreAll(); });

function call(method, path, { userId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
}

test('HTTP: unauthenticated owner dispute read → 401', async () => {
  const res = await call('GET', '/api/referrals/trust/disputes/mine');
  assert.equal(res.status, 401);
});

test('HTTP: unauthenticated dispute filing → 401', async () => {
  const res = await call('POST', '/api/referrals/trust/disputes', { body: { wallet_transaction_id: ownerTxId, reason: 'x' } });
  assert.equal(res.status, 401);
});

test('HTTP: owner files a dispute on their own benefit → 201', async () => {
  const res = await call('POST', '/api/referrals/trust/disputes', { userId: OWNER, body: { wallet_transaction_id: ownerTxId, reason: 'HTTP owner dispute' } });
  assert.equal(res.status, 201);
  assert.equal(res.json.dispute.opened_by, OWNER);
});

test('HTTP: a different user filing on the owner’s benefit → 403', async () => {
  const res = await call('POST', '/api/referrals/trust/disputes', { userId: OTHER, body: { wallet_transaction_id: ownerTxId, reason: 'steal' } });
  assert.equal(res.status, 403);
});

test('HTTP: owner reads their own dispute (owner-safe projection, no admin note)', async () => {
  // resolve it first as admin, with an internal note
  const owned = await referralService.repository.list(REFERRAL_TABLES.events, { event_type: 'trust.dispute_created', wallet_transaction_id: ownerTxId });
  const disputeId = owned.find((e) => (e.metadata || {}).opened_by === OWNER)?.id;
  await trustReview.resolveDispute(disputeId, { status: 'resolved_upheld', reason: 'internal-note-SECRET-9times' }, adminActor);

  const res = await call('GET', '/api/referrals/trust/disputes/mine', { userId: OWNER });
  assert.equal(res.status, 200);
  const mine = res.json.disputes.find((d) => d.wallet_transaction_id === ownerTxId);
  assert.ok(mine, 'owner sees their own dispute');
  assert.equal(mine.status, 'resolved_upheld');
  assert.ok(mine.owner_safe_resolution && /upheld/i.test(mine.owner_safe_resolution));
  const serialized = JSON.stringify(res.json);
  assert.ok(!serialized.includes('internal-note-SECRET'), 'raw admin resolution note is never exposed to the owner');
  assert.ok(!('resolution_reason' in mine), 'no raw admin resolution_reason field');
});

test('HTTP: a different user reading a specific owner transaction → 403', async () => {
  const res = await call('GET', `/api/referrals/trust/disputes/mine?wallet_transaction_id=${ownerTxId}`, { userId: OTHER });
  assert.equal(res.status, 403);
});

test('HTTP: a different user’s own (empty) dispute list → 200 with none of the owner’s disputes', async () => {
  const res = await call('GET', '/api/referrals/trust/disputes/mine', { userId: OTHER });
  assert.equal(res.status, 200);
  assert.equal(res.json.disputes.length, 0);
});
