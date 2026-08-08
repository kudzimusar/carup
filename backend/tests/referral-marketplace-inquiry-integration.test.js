// Referral V1 Stage-4 remediation — BEHAVIOURAL integration tests for the inquiry→lead bridge.
// These drive the real createInquiry() with an injected marketplace client + a real referral bridge on
// an in-memory referral repository (no source-text assertions), and verify the durable-contract wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInquiry } from '../services/marketplace/marketplaceInquiryService.js';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { MarketplaceReferralBridgeService } from '../services/marketplace/marketplaceReferralBridgeService.js';
import { LOCAL_MARKETPLACE_EVENT_TYPES } from '../services/referral/referralLocalMarketplaceService.js';
import { registerDomainListeners } from '../services/eventBus/listeners.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CODE_TYPES } from '../constants/referral/referralConstants.js';

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

const OWNER = 'refv1-code-owner';
const INVITEE = 'refv1-invitee';
const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin' });

// A minimal marketplace client: captures the inserted inquiry row and satisfies the calls createInquiry makes.
function fakeMarketplaceClient(captured) {
  return {
    from(table) {
      if (table === 'marketplace_inquiries') {
        return { insert: (row) => ({ select: () => ({ single: async () => { captured.inquiry = row; return { data: row, error: null }; } }) }) };
      }
      // users / anything else: return no rows (we provide full guest contact so lookupUserContact is skipped)
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }) }) }) };
    },
  };
}

async function seedOwnerCode() {
  const repository = new MemoryReferralRepository();
  const now = () => new Date('2026-07-15T00:00:00.000Z');
  const referralService = new ReferralEngineService({ repository, now });
  const bridge = new MarketplaceReferralBridgeService({ referralService });
  const campaign = await referralService.createCampaign({ name: 'S4 Integration', campaign_type: 'LOCAL_MARKETPLACE', priority_scope: 'LOCAL', status: 'ACTIVE' }, operatorActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: OWNER, code: 'S4INTEG001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'web' }, operatorActor);
  return { repository, referralService, bridge, code };
}

function basePayload(code, extra = {}) {
  return {
    inquiry_type: 'import_quote_request', // not a vehicle-bound type → no listing/seller resolution
    message: 'Interested via my referral link',
    guest_name: 'Invitee Tester',
    guest_email: 'invitee@example.invalid',
    guest_phone: '+263770000000',
    referral_code: code.code,
    campaign_code: 'spring',
    source_channel: 'web',
    // Adversarial: caller-supplied owner fields that must be ignored by the bridge.
    owner_user_id: INVITEE,
    reward_owner_user_id: INVITEE,
    ...extra,
  };
}

test('createInquiry: persists the inquiry with referral attribution and bridges it into the qualifiable lead for the code owner', async () => {
  const { repository, bridge, code } = await seedOwnerCode();
  const captured = {};
  const actor = { id: INVITEE, userId: INVITEE };
  const result = await createInquiry(fakeMarketplaceClient(captured), basePayload(code), actor, { referralBridge: bridge });

  // Marketplace inquiry row created with attribution.
  assert.ok(captured.inquiry, 'inquiry row was inserted');
  assert.equal(captured.inquiry.referral_code, code.code, 'referral attribution reached the persisted inquiry');

  // Response carries the bridged lead event id.
  assert.ok(result.referral_lead_event_id, 'response carries the bridged lead event id');

  // Exactly one qualifiable lead, sourced from THIS inquiry, owned by the CODE OWNER (not the caller).
  const leads = await repository.list(REFERRAL_TABLES.events, { event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].id, result.referral_lead_event_id);
  assert.equal(leads[0].subject_id, result.id, 'the same inquiry id is the lead source');
  assert.equal(leads[0].metadata.source_inquiry_id, result.id);
  assert.equal(leads[0].metadata.attribution.owner_user_id, OWNER, 'caller-supplied owner fields are ignored; owner = code owner');
});

test('createInquiry: no referral code → normal inquiry, no referral lead', async () => {
  const { repository, bridge, code } = await seedOwnerCode();
  const captured = {};
  const payload = basePayload(code, { referral_code: null, campaign_code: null });
  const result = await createInquiry(fakeMarketplaceClient(captured), payload, { id: INVITEE }, { referralBridge: bridge });
  assert.ok(captured.inquiry, 'inquiry still created');
  assert.equal(result.referral_lead_event_id, null);
  assert.equal((await repository.list(REFERRAL_TABLES.events, { event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED })).length, 0);
});

test('createInquiry: an invalid referral code creates the inquiry but no attributed lead', async () => {
  const { repository, bridge, code } = await seedOwnerCode();
  const captured = {};
  const result = await createInquiry(fakeMarketplaceClient(captured), basePayload(code, { referral_code: 'NOT-A-REAL-CODE' }), { id: INVITEE }, { referralBridge: bridge });
  assert.ok(captured.inquiry);
  assert.equal(result.referral_lead_event_id, null);
  assert.equal((await repository.list(REFERRAL_TABLES.events, { event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED })).length, 0);
});

test('createInquiry: durable contract — a bridge failure does not break the inquiry (retry handled by the outbox listener)', async () => {
  const { code } = await seedOwnerCode();
  const captured = {};
  // A bridge whose durable lead creation throws a transient error (event emission still works).
  const failingBridge = {
    emitMarketplaceReferralEvent: async () => ({ recorded: true }),
    bridgeInquiryToReferralLead: async () => { throw new Error('transient DB error'); },
  };
  const result = await createInquiry(fakeMarketplaceClient(captured), basePayload(code), { id: INVITEE }, { referralBridge: failingBridge });
  assert.ok(captured.inquiry, 'the marketplace inquiry still succeeds even when the synchronous bridge fails');
  assert.equal(result.referral_lead_event_id, null, 'no lead id synchronously; the durable marketplace.inquiry.created listener retries');
});

test('durable wiring: a marketplace.inquiry.created outbox listener is registered', () => {
  const subs = new Map();
  const fakeWorker = { subscribe: (evt, handler) => subs.set(evt, handler) };
  registerDomainListeners(fakeWorker);
  assert.ok(subs.has('marketplace.inquiry.created'), 'durable inquiry→lead listener is subscribed');
});

test('durable listener: a non-referral inquiry payload is a safe no-op', async () => {
  const subs = new Map();
  registerDomainListeners({ subscribe: (evt, handler) => subs.set(evt, handler) });
  const handler = subs.get('marketplace.inquiry.created');
  // No referral_code → returns without invoking the bridge (no throw, nothing to bridge).
  await assert.doesNotReject(() => handler({ inquiryId: 'inq-x' }));
});
