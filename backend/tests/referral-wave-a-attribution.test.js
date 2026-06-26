/**
 * Wave A attribution unit tests using Node's built-in test runner.
 *
 * Uses the same MemoryReferralRepository pattern as referral-engine-phase1.test.js.
 * No live Supabase, no require(), no Jest globals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import {
  REFERRAL_CODE_STATUSES,
  REFERRAL_CODE_TYPES,
} from '../constants/referral/referralConstants.js';
import { readFileSync } from 'node:fs';

const migrationFile = readFileSync(
  new URL('../../database/migrations/20260625151548_referral_wave_a_identity_attribution.sql', import.meta.url),
  'utf8'
);

// ─── In-Memory Repository (same pattern as phase1 test) ──────────────────────
class MemoryReferralRepository {
  constructor() {
    this.counter = 0;
    this.tables = new Map(Object.values(REFERRAL_TABLES).map((t) => [t, []]));
  }
  nextId(table) { this.counter += 1; return `${table}-${this.counter}`; }
  match(row, filters = {}) {
    return Object.entries(filters).every(([k, v]) => v === undefined || v === null || row[k] === v);
  }
  async insert(table, payload) {
    const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || new Date().toISOString(), ...payload };
    this.tables.get(table).push(row);
    return row;
  }
  async findOne(table, filters = {}) {
    return this.tables.get(table).find((row) => this.match(row, filters)) || null;
  }
  async list(table, filters = {}) {
    return this.tables.get(table).filter((row) => this.match(row, filters));
  }
  async updateById(table, id, patch) {
    const rows = this.tables.get(table);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...patch };
    return rows[idx];
  }
  async count(table, filters = {}) { return (await this.list(table, filters)).length; }
}

function createService() {
  const repository = new MemoryReferralRepository();
  const service = new ReferralEngineService({
    repository,
    now: () => new Date('2026-06-26T00:00:00.000Z'),
    shareOptions: { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' },
  });
  return { repository, service };
}

// ─── Migration content gate ───────────────────────────────────────────────────
test('Wave A migration contains required tables and columns', () => {
  const required = [
    'referral_attribution_journeys',
    'referral_attribution_touches',
    'is_permanent',
    'anonymous_journey_id',
    'reward_owner_code_id',
    'claimed_at',
    'idempotency_key',
  ];
  for (const token of required) {
    assert.ok(migrationFile.includes(token), `Migration must contain: ${token}`);
  }
  // Must enable RLS on journey tables
  assert.ok(
    migrationFile.includes('ENABLE ROW LEVEL SECURITY'),
    'Migration must enable RLS on attribution tables'
  );
});

// ─── Permanent MEMBER code issuance ──────────────────────────────────────────
test('ensurePermanentMemberCode creates exactly one permanent MEMBER code', async () => {
  const { repository, service } = createService();

  await service.ensurePermanentMemberCode('user-1', 'platform');
  const codes = await repository.list(REFERRAL_TABLES.codes, { owner_user_id: 'user-1' });
  assert.equal(codes.length, 1);
  assert.equal(codes[0].is_permanent, true);
  assert.equal(codes[0].code_type, REFERRAL_CODE_TYPES.MEMBER);
  assert.equal(codes[0].status, REFERRAL_CODE_STATUSES.ACTIVE);
});

test('ensurePermanentMemberCode is idempotent — no duplicate on repeat call', async () => {
  const { repository, service } = createService();

  await service.ensurePermanentMemberCode('user-2', 'platform');
  await service.ensurePermanentMemberCode('user-2', 'platform');
  const codes = await repository.list(REFERRAL_TABLES.codes, { owner_user_id: 'user-2' });
  assert.equal(codes.length, 1, 'Must not create a second permanent code on repeat call');
});

// ─── Code validation ─────────────────────────────────────────────────────────
test('validateReferralCode returns valid for an active code', async () => {
  const { repository, service } = createService();
  await repository.insert(REFERRAL_TABLES.codes, {
    id: 'code-1', tenant_id: 'platform', code: 'ACTIVE001', code_type: 'MEMBER',
    status: REFERRAL_CODE_STATUSES.ACTIVE, owner_user_id: 'user-3',
  });
  const result = await service.validateReferralCode({ code: 'ACTIVE001' });
  assert.equal(result.valid, true);
  assert.equal(result.code.code, 'ACTIVE001');
});

test('validateReferralCode rejects missing code', async () => {
  const { service } = createService();
  const result = await service.validateReferralCode({ code: 'NOTEXIST' });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CODE_NOT_FOUND');
});

test('validateReferralCode rejects expired code', async () => {
  const { repository, service } = createService();
  await repository.insert(REFERRAL_TABLES.codes, {
    id: 'code-expired', tenant_id: 'platform', code: 'EXPIREDX', code_type: 'MEMBER',
    status: REFERRAL_CODE_STATUSES.ACTIVE, owner_user_id: 'user-4',
    expires_at: new Date('2020-01-01').toISOString(),
  });
  const result = await service.validateReferralCode({ code: 'EXPIREDX' });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CODE_EXPIRED');
});

// ─── Anonymous attribution journey ───────────────────────────────────────────
test('recordAnonymousTouch creates journey + first touch', async () => {
  const { repository, service } = createService();
  await repository.insert(REFERRAL_TABLES.codes, {
    id: 'code-2', tenant_id: 'platform', code: 'WAVE0001', code_type: 'MEMBER',
    status: REFERRAL_CODE_STATUSES.ACTIVE, owner_user_id: 'owner-1',
  });

  await service.recordAnonymousTouch({
    code: 'WAVE0001',
    journeyToken: 'anon-tok-1',
    channel: 'web',
    source: 'public_link',
    req: null,
  });

  const journeys = await repository.list(REFERRAL_TABLES.attributionJourneys, { anonymous_journey_id: 'anon-tok-1' });
  assert.equal(journeys.length, 1, 'Journey must be created');

  const touches = await repository.list(REFERRAL_TABLES.attributionTouches, { journey_id: journeys[0].id });
  assert.equal(touches.length, 1, 'Exactly one touch must be recorded');
  assert.equal(touches[0].touch_kind, 'first', 'First touch_kind must be "first"');
  assert.equal(journeys[0].reward_owner_user_id, 'owner-1', 'reward_owner_user_id must be set');
});

// ─── Self-referral rejection ──────────────────────────────────────────────────
test('bindAttributionJourney abandons journey on self-referral', async () => {
  const { repository, service } = createService();
  // Create a journey owned by user-5
  const journey = await repository.insert(REFERRAL_TABLES.attributionJourneys, {
    tenant_id: 'platform',
    anonymous_journey_id: 'anon-self-1',
    status: 'active',
    reward_owner_user_id: 'user-5',
  });

  // user-5 tries to claim their own referral journey
  const result = await service.bindAttributionJourney('anon-self-1', 'user-5', 'platform');
  assert.equal(result, null, 'Self-referral must return null (rejected)');

  const updated = await repository.findOne(REFERRAL_TABLES.attributionJourneys, { id: journey.id });
  assert.equal(updated.status, 'abandoned', 'Journey must be abandoned on self-referral');
});

// ─── Journey claim ────────────────────────────────────────────────────────────
test('bindAttributionJourney claims journey for a different user', async () => {
  const { repository, service } = createService();
  await repository.insert(REFERRAL_TABLES.attributionJourneys, {
    tenant_id: 'platform',
    anonymous_journey_id: 'anon-bind-1',
    status: 'active',
    reward_owner_user_id: 'owner-2',
  });

  const bound = await service.bindAttributionJourney('anon-bind-1', 'new-user-1', 'platform');
  assert.ok(bound, 'Journey must be bound');
  assert.equal(bound.user_id, 'new-user-1');
  assert.ok(bound.claimed_at, 'claimed_at must be set');
});

// ─── Tenant scoping ───────────────────────────────────────────────────────────
test('bindAttributionJourney does not bind a journey from a different tenant', async () => {
  const { repository, service } = createService();
  await repository.insert(REFERRAL_TABLES.attributionJourneys, {
    tenant_id: 'tenant-A',
    anonymous_journey_id: 'anon-tenant-1',
    status: 'active',
    reward_owner_user_id: 'owner-3',
  });

  // Attempt to bind from tenant-B — should find nothing and return null
  const result = await service.bindAttributionJourney('anon-tenant-1', 'new-user-2', 'tenant-B');
  assert.equal(result, null, 'Cross-tenant bind must return null');
});
