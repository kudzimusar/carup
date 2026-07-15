import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { supabase } from '../db/supabase.js';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralTrustReviewService } from '../services/referral/referralTrustReviewService.js';
import { ReferralTrustReviewBenchmarkService } from '../services/referral/referralTrustReviewBenchmarkService.js';
import { createReferralRouter } from '../routes/referralRoutes.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { DISPUTE_STATUSES, TRUST_EVENT_TYPES } from '../services/referral/referralTrustReviewService.js';
import { WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

class MemoryReferralRepository {
  constructor() { this.counter = 0; this.tables = new Map(Object.values(REFERRAL_TABLES).map((table) => [table, []])); }
  nextId(table) { this.counter += 1; return `${table}-${this.counter}`; }
  match(row, filters = {}) { return Object.entries(filters).every(([key, value]) => value === undefined || value === null || row[key] === value); }
  async insert(table, payload) { const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || new Date().toISOString(), ...payload }; this.tables.get(table).push(row); return row; }
  async findOne(table, filters = {}) { return this.tables.get(table).find((row) => this.match(row, filters)) || null; }
  async list(table, filters = {}, options = {}) {
    let rows = this.tables.get(table).filter((row) => this.match(row, filters));
    if (options.orderBy) rows = rows.sort((a, b) => String(b[options.orderBy] || '').localeCompare(String(a[options.orderBy] || '')));
    if (options.limit) rows = rows.slice(Number(options.offset || 0), Number(options.offset || 0) + Number(options.limit));
    return rows;
  }
  async listIn(table, column, values = [], filters = {}, options = {}) {
    const allowed = new Set(values);
    let rows = this.tables.get(table).filter((row) => allowed.has(row[column]) && this.match(row, filters));
    if (options.jsonContains?.metadata?.opened_by) rows = rows.filter((row) => row.metadata?.opened_by === options.jsonContains.metadata.opened_by);
    if (options.orderBy) rows = rows.sort((a, b) => String(b[options.orderBy] || '').localeCompare(String(a[options.orderBy] || '')));
    if (options.limit) rows = rows.slice(Number(options.offset || 0), Number(options.offset || 0) + Number(options.limit));
    return rows;
  }
  async countIn(table, column, values = [], filters = {}, options = {}) {
    return (await this.listIn(table, column, values, filters, options)).length;
  }
  async updateById(table, id, patch) { const rows = this.tables.get(table); const index = rows.findIndex((row) => row.id === id); if (index === -1) return null; rows[index] = { ...rows[index], ...patch }; return rows[index]; }
  async count(table, filters = {}) { return (await this.list(table, filters)).length; }
}

const OWNER = 'refv1-owner';
const OTHER = 'refv1-other';
const ADMIN = 'admin-1';
const ownerActor = Object.freeze({ actor_user_id: OWNER, actor_role: 'member', actor_type: 'user', actor_tenant_id: 'tenant-1', surface: 'web', session_id: 'owner-session' });
const otherActor = Object.freeze({ actor_user_id: OTHER, actor_role: 'member', actor_type: 'user', actor_tenant_id: 'tenant-1', surface: 'web', session_id: 'other-session' });
const crossTenantOwnerActor = Object.freeze({ actor_user_id: OWNER, actor_role: 'member', actor_type: 'user', actor_tenant_id: 'tenant-2', surface: 'web' });
const adminActor = Object.freeze({ actor_user_id: ADMIN, actor_role: 'admin', actor_type: 'agent', actor_tenant_id: 'tenant-1', surface: 'admin', session_id: 'admin-session' });

function harness() {
  const repository = new MemoryReferralRepository();
  const now = () => new Date('2026-07-15T00:00:00.000Z');
  const referralService = new ReferralEngineService({ repository, now });
  const trust = new ReferralTrustReviewService({ referralService, now });
  return { repository, referralService, trust };
}

async function createBenefit(referralService, ownerUserId = OWNER, tenantId = 'tenant-1') {
  return referralService.createWalletTransaction({
    tenant_id: tenantId,
    user_id: ownerUserId,
    source_event_type: 'local_marketplace.purchase_confirmed',
    transaction_type: 'local_marketplace_referral_credit',
    status: WALLET_TRANSACTION_STATUSES.PENDING,
    amount: 15,
    currency: 'USD',
    reason: 'Local marketplace referral converted',
  }, { ...adminActor, actor_tenant_id: tenantId });
}

async function seedOwnerDispute(referralService, trust, overrides = {}) {
  const tx = await createBenefit(referralService, overrides.ownerUserId || OWNER, overrides.tenantId || 'tenant-1');
  const dispute = await trust.createDispute({
    wallet_transaction_id: tx.id,
    reason: overrides.reason || 'REFV1-S4 owner disputes pending benefit',
    opened_by: OTHER,
    owner_user_id: OTHER,
    wallet_user_id: OTHER,
    beneficiary_user_id: OTHER,
  }, overrides.actor || ownerActor);
  return { tx, dispute };
}

test('owner can dispute their own wallet transaction and opened_by is derived from the actor', async () => {
  const { referralService, trust } = harness();
  const { tx, dispute } = await seedOwnerDispute(referralService, trust);
  assert.equal(dispute.dispute.wallet_transaction_id, tx.id);
  assert.equal(dispute.dispute.opened_by, OWNER);
  assert.notEqual(dispute.dispute.opened_by, OTHER);
});

test('another authenticated user receives 403 and cannot inject a malicious reason into the owner interface', async () => {
  const { referralService, trust } = harness();
  const tx = await createBenefit(referralService);
  await assert.rejects(
    () => trust.createDispute({ wallet_transaction_id: tx.id, reason: 'malicious reason in owner history' }, otherActor),
    ForbiddenError
  );
  const { disputes } = await trust.listOwnerDisputes(OWNER, {}, ownerActor);
  assert.equal(JSON.stringify(disputes).includes('malicious reason'), false);
});

test('missing transaction returns 404 and missing wallet_transaction_id is rejected', async () => {
  const { trust } = harness();
  await assert.rejects(() => trust.createDispute({ reason: 'missing tx' }, ownerActor), ValidationError);
  await assert.rejects(() => trust.createDispute({ wallet_transaction_id: 'missing-tx', reason: 'missing tx' }, ownerActor), NotFoundError);
});

test('cross-tenant dispute creation and reads are blocked', async () => {
  const { referralService, trust } = harness();
  const tx = await createBenefit(referralService, OWNER, 'tenant-1');
  await assert.rejects(
    () => trust.createDispute({ wallet_transaction_id: tx.id, reason: 'wrong tenant' }, crossTenantOwnerActor),
    ForbiddenError
  );
  await assert.rejects(
    () => trust.listOwnerDisputes(OWNER, { wallet_transaction_id: tx.id }, crossTenantOwnerActor),
    ForbiddenError
  );
});

test('owner dispute remains visible with more than 1,000 newer unrelated disputes', async () => {
  const { repository, referralService, trust } = harness();
  const { tx, dispute } = await seedOwnerDispute(referralService, trust, { reason: 'old owner dispute' });
  await repository.updateById(REFERRAL_TABLES.events, dispute.event.id, { created_at: '2026-01-01T00:00:00.000Z' });
  for (let i = 0; i < 1005; i += 1) {
    await repository.insert(REFERRAL_TABLES.events, {
      tenant_id: 'tenant-1',
      event_type: TRUST_EVENT_TYPES.DISPUTE_CREATED,
      wallet_transaction_id: `unrelated-${i}`,
      subject_type: 'trust_dispute',
      subject_id: `unrelated-${i}`,
      metadata: { status: DISPUTE_STATUSES.OPEN, wallet_transaction_id: `unrelated-${i}`, opened_by: OTHER, reason: `noise ${i}` },
      created_at: `2026-07-15T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
    });
  }
  const direct = await trust.listOwnerDisputes(OWNER, { wallet_transaction_id: tx.id }, ownerActor);
  assert.equal(direct.disputes.length, 1);
  assert.equal(direct.disputes[0].dispute_id, dispute.event.id);
  const list = await trust.listOwnerDisputes(OWNER, {}, ownerActor);
  assert.equal(list.disputes.some((row) => row.dispute_id === dispute.event.id), true);
});

test('owner dispute pagination is stable and scoped before pagination', async () => {
  const { referralService, trust } = harness();
  const rows = [];
  for (let i = 0; i < 4; i += 1) {
    const { dispute } = await seedOwnerDispute(referralService, trust, { reason: `owner page ${i}` });
    await trust.referralService.repository.updateById(REFERRAL_TABLES.events, dispute.event.id, {
      created_at: `2026-07-15T00:0${i}:00.000Z`,
    });
    rows.push(dispute.event.id);
  }
  const first = await trust.listOwnerDisputes(OWNER, { limit: 2, offset: 0 }, ownerActor);
  const second = await trust.listOwnerDisputes(OWNER, { limit: 2, offset: 2 }, ownerActor);
  assert.deepEqual(first.disputes.map((row) => row.dispute_id), [rows[3], rows[2]]);
  assert.deepEqual(second.disputes.map((row) => row.dispute_id), [rows[1], rows[0]]);
  assert.equal(first.pagination.total, 4);
  assert.equal(first.pagination.has_more, true);
});

test('another user sees none of the owner disputes and attacker-created events are excluded', async () => {
  const { repository, referralService, trust } = harness();
  const { tx } = await seedOwnerDispute(referralService, trust);
  await repository.insert(REFERRAL_TABLES.events, {
    tenant_id: 'tenant-1',
    event_type: TRUST_EVENT_TYPES.DISPUTE_CREATED,
    wallet_transaction_id: tx.id,
    subject_type: 'trust_dispute',
    subject_id: tx.id,
    metadata: { status: DISPUTE_STATUSES.OPEN, wallet_transaction_id: tx.id, opened_by: OTHER, reason: 'attacker-created event' },
    created_at: '2026-07-15T00:05:00.000Z',
  });
  assert.equal((await trust.listOwnerDisputes(OTHER, {}, otherActor)).disputes.length, 0);
  const ownerRows = await trust.listOwnerDisputes(OWNER, {}, ownerActor);
  assert.equal(JSON.stringify(ownerRows.disputes).includes('attacker-created event'), false);
});

test('resolved dispute visibility is owner-safe and raw admin notes/risk data are never returned', async () => {
  const { referralService, trust } = harness();
  const { dispute } = await seedOwnerDispute(referralService, trust);
  await trust.resolveDispute(dispute.event.id, { status: 'resolved_upheld', reason: 'internal-only risk fingerprint 0xDEADBEEF' }, adminActor);
  const { disputes } = await trust.listOwnerDisputes(OWNER, {}, ownerActor);
  assert.equal(disputes[0].status, 'resolved_upheld');
  assert.ok(disputes[0].resolved_at);
  assert.match(disputes[0].owner_safe_resolution, /upheld/i);
  const serialized = JSON.stringify(disputes[0]);
  assert.equal(serialized.includes('0xDEADBEEF'), false);
  assert.equal(serialized.includes('risk'), false);
  assert.equal('resolution_reason' in disputes[0], false);
});

let server;
let baseUrl;
let routeRepository;
let routeReferralService;
let routeTrustReview;
let routeTx;
let originalSupabaseFrom;

class AuthClient {
  constructor() {
    this.users = [
      { id: OWNER, role: 'member', is_verified: true },
      { id: OTHER, role: 'member', is_verified: true },
      { id: ADMIN, role: 'admin', is_verified: true },
    ];
    this.tenant_users = [
      { tenant_id: 'tenant-1', user_id: OWNER, role: 'member' },
      { tenant_id: 'tenant-1', user_id: OTHER, role: 'member' },
      { tenant_id: 'tenant-1', user_id: ADMIN, role: 'admin' },
      { tenant_id: 'tenant-2', user_id: OWNER, role: 'member' },
    ];
  }
  from(table) {
    const rows = this[table] || [];
    const state = { filters: [] };
    const api = {
      select() { return api; },
      eq(key, value) { state.filters.push([key, value]); return api; },
      single() {
        const row = rows.find((entry) => state.filters.every(([key, value]) => entry[key] === value));
        return Promise.resolve({ data: row || null, error: row ? null : { message: 'not found' } });
      },
    };
    return api;
  }
}

before(async () => {
  originalSupabaseFrom = supabase.from.bind(supabase);
  const authClient = new AuthClient();
  supabase.from = authClient.from.bind(authClient);
  routeRepository = new MemoryReferralRepository();
  const now = () => new Date('2026-07-15T00:00:00.000Z');
  routeReferralService = new ReferralEngineService({ repository: routeRepository, now });
  routeTrustReview = new ReferralTrustReviewBenchmarkService({ referralService: routeReferralService, now });
  routeTx = await createBenefit(routeReferralService);

  const app = express();
  app.use(express.json());
  app.use('/api/referrals', createReferralRouter({ service: routeReferralService, trustReview: routeTrustReview }));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message, code: err.code }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (originalSupabaseFrom) supabase.from = originalSupabaseFrom;
});

async function call(method, path, { userId, tenantId = 'tenant-1', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

test('authenticated route: owner filing succeeds and caller-supplied opened_by is ignored', async () => {
  const res = await call('POST', '/api/referrals/trust/disputes', {
    userId: OWNER,
    body: { wallet_transaction_id: routeTx.id, reason: 'route owner filing', opened_by: OTHER, owner_user_id: OTHER },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.dispute.opened_by, OWNER);
});

test('authenticated route: cross-user filing is denied, unauthenticated is 401, missing transaction is 404', async () => {
  assert.equal((await call('POST', '/api/referrals/trust/disputes', { body: { wallet_transaction_id: routeTx.id, reason: 'no auth' } })).status, 401);
  assert.equal((await call('POST', '/api/referrals/trust/disputes', { userId: OTHER, body: { wallet_transaction_id: routeTx.id, reason: 'cross user' } })).status, 403);
  assert.equal((await call('POST', '/api/referrals/trust/disputes', { userId: OWNER, body: { wallet_transaction_id: 'missing', reason: 'missing' } })).status, 404);
});

test('authenticated route: owner listing is scoped; cross-user and cross-tenant reads are denied/empty', async () => {
  const ownerList = await call('GET', `/api/referrals/trust/disputes/mine?wallet_transaction_id=${encodeURIComponent(routeTx.id)}`, { userId: OWNER });
  assert.equal(ownerList.status, 200);
  assert.equal(ownerList.json.disputes.length >= 1, true);
  const otherList = await call('GET', '/api/referrals/trust/disputes/mine', { userId: OTHER });
  assert.equal(otherList.status, 200);
  assert.equal(otherList.json.disputes.length, 0);
  const crossTenant = await call('GET', `/api/referrals/trust/disputes/mine?wallet_transaction_id=${encodeURIComponent(routeTx.id)}`, { userId: OWNER, tenantId: 'tenant-2' });
  assert.equal(crossTenant.status, 403);
});
