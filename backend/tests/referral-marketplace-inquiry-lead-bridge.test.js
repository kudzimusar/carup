// Referral V1 Stage-4 remediation A: the invitee's real attributed marketplace inquiry must create
// (or atomically bridge to) the qualifiable local-marketplace referral lead the admin later qualifies.
//
// These tests exercise MarketplaceReferralBridgeService.bridgeInquiryToReferralLead against an
// in-memory referral repository (no live DB), and verify the end-to-end ownership + idempotency
// invariants, then that an admin qualification of the bridged lead mints exactly one pending benefit
// for the ORIGINAL CODE OWNER.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralLocalMarketplaceHardenedService } from '../services/referral/referralLocalMarketplaceHardenedService.js';
import { LOCAL_MARKETPLACE_EVENT_TYPES } from '../services/referral/referralLocalMarketplaceService.js';
import { MarketplaceReferralBridgeService } from '../services/marketplace/marketplaceReferralBridgeService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CODE_TYPES, WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';

const inquiryServiceFile = readFileSync(new URL('../services/marketplace/marketplaceInquiryService.js', import.meta.url), 'utf8');
const bridgeFile = readFileSync(new URL('../services/marketplace/marketplaceReferralBridgeService.js', import.meta.url), 'utf8');

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

const OWNER = 'refv1-code-owner';
const INVITEE = 'refv1-invitee';
const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'op-session' });
const inviteeActor = Object.freeze({ actor_user_id: INVITEE, id: INVITEE, actor_type: 'user', surface: 'web' });

async function createHarness() {
  const repository = new MemoryReferralRepository();
  const now = () => new Date('2026-07-15T00:00:00.000Z');
  const referralService = new ReferralEngineService({ repository, now });
  const localMarketplace = new ReferralLocalMarketplaceHardenedService({ referralService, now });
  const bridge = new MarketplaceReferralBridgeService({ referralService });
  const campaign = await referralService.createCampaign({ name: 'S4 Bridge Campaign', campaign_type: 'LOCAL_MARKETPLACE', priority_scope: 'LOCAL', status: 'ACTIVE' }, operatorActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: OWNER, code: 'S4BRIDGE001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'web' }, operatorActor);
  return { repository, referralService, localMarketplace, bridge, campaign, code };
}

function makeInquiry(overrides = {}) {
  return {
    id: 'inq-1',
    listing_id: 'listing-42',
    message: 'I want to buy a Toyota Aqua',
    source_channel: 'web',
    buyer_id: INVITEE,
    // Adversarial: caller-supplied owner fields that MUST be ignored.
    owner_user_id: INVITEE,
    reward_owner_user_id: INVITEE,
    user_id: INVITEE,
    ...overrides,
  };
}

async function leadEventsFor(repository, inquiryId) {
  return repository.list(REFERRAL_TABLES.events, { event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED, subject_id: inquiryId });
}

test('remediation A wiring: createInquiry bridges a referral-coded inquiry into a qualifiable lead', () => {
  assert.match(inquiryServiceFile, /bridgeInquiryToReferralLead/, 'createInquiry must invoke the inquiry→lead bridge');
  assert.match(bridgeFile, /LEAD_CREATED/, 'bridge must create the canonical LEAD_CREATED event');
});

test('1+2+3: attributed inquiry creates exactly one qualifiable lead that references the inquiry with correct attribution', async () => {
  const { repository, bridge, campaign, code } = await createHarness();
  const inquiry = makeInquiry({ referral_code: code.code });
  const result = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });

  assert.equal(result.bridged, true);
  assert.ok(result.lead_event_id);

  const leads = await leadEventsFor(repository, inquiry.id);
  assert.equal(leads.length, 1, 'exactly one qualifiable lead');
  const lead = leads[0];
  assert.equal(lead.event_type, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED);
  assert.equal(lead.subject_id, inquiry.id, 'lead references the source inquiry (subject_id)');
  assert.equal(lead.metadata.source_inquiry_id, inquiry.id, 'lead records the source inquiry id in metadata');
  assert.equal(lead.code_id, code.id, 'lead carries the code attribution');
  assert.equal(lead.campaign_id, campaign.id, 'lead carries the campaign attribution');
});

test('4+5: owner is derived from the referral code; caller-supplied owner fields are ignored', async () => {
  const { repository, bridge, code } = await createHarness();
  const inquiry = makeInquiry({ referral_code: code.code });
  const result = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });
  assert.equal(result.owner_user_id, OWNER, 'reward owner resolves to the code owner, not the caller');

  const [lead] = await leadEventsFor(repository, inquiry.id);
  // The injected owner/reward_owner/user_id from the inquiry must not appear as the lead attribution owner.
  assert.equal(lead.metadata.attribution.owner_user_id, OWNER);
  assert.notEqual(lead.metadata.attribution.owner_user_id, INVITEE);
});

test('6: duplicate/retry of the same inquiry creates no duplicate lead (idempotent)', async () => {
  const { repository, bridge, code } = await createHarness();
  const inquiry = makeInquiry({ referral_code: code.code });
  const first = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });
  const second = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });

  assert.equal(second.bridged, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.lead_event_id, first.lead_event_id, 'retry returns the same lead');
  const leads = await leadEventsFor(repository, inquiry.id);
  assert.equal(leads.length, 1, 'one inquiry -> at most one lead');
});

test('7: an invalid/unknown referral code creates no attributed referral lead', async () => {
  const { repository, bridge } = await createHarness();
  const inquiry = makeInquiry({ id: 'inq-invalid', referral_code: 'NO-SUCH-CODE-XYZ' });
  const result = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });
  assert.equal(result.bridged, false);
  assert.equal(result.reason, 'invalid_code');
  const leads = await leadEventsFor(repository, inquiry.id);
  assert.equal(leads.length, 0);
});

test('inquiry without a referral code follows normal behaviour and creates no referral lead', async () => {
  const { repository, bridge } = await createHarness();
  const inquiry = makeInquiry({ id: 'inq-none', referral_code: null });
  const result = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });
  assert.equal(result.bridged, false);
  assert.equal(result.reason, 'no_referral_code');
  assert.equal((await leadEventsFor(repository, inquiry.id)).length, 0);
});

test('8: inquiry bridging creates a lead but NO wallet benefit', async () => {
  const { repository, bridge, code } = await createHarness();
  const inquiry = makeInquiry({ referral_code: code.code });
  await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });
  const txns = await repository.list(REFERRAL_TABLES.walletTransactions, {});
  assert.equal(txns.length, 0, 'no reward is created at inquiry time');
});

test('9+11+12: admin qualification of the bridged lead mints exactly one pending benefit for the CODE OWNER', async () => {
  const { repository, bridge, localMarketplace, code } = await createHarness();
  const inquiry = makeInquiry({ referral_code: code.code });
  const bridged = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });

  const qualified = await localMarketplace.qualifyLead(
    { lead_event_id: bridged.lead_event_id, milestone: 'order_paid', order_amount: 1200, referred_user_id: INVITEE },
    operatorActor
  );
  assert.equal(qualified.reward_created, true);

  const txns = await repository.list(REFERRAL_TABLES.walletTransactions, {});
  assert.equal(txns.length, 1, 'exactly one pending benefit');
  assert.equal(txns[0].status, WALLET_TRANSACTION_STATUSES.PENDING);
  assert.equal(txns[0].user_id, OWNER, 'benefit belongs to the original code owner');
  assert.notEqual(txns[0].user_id, INVITEE, 'invitee does not receive the benefit');
  assert.notEqual(txns[0].user_id, operatorActor.actor_user_id, 'admin does not receive the benefit');
});

test('10: duplicate qualification of the bridged lead creates no second benefit', async () => {
  const { repository, bridge, localMarketplace, code } = await createHarness();
  const inquiry = makeInquiry({ referral_code: code.code });
  const bridged = await bridge.bridgeInquiryToReferralLead({ inquiry, actor: inviteeActor });
  await localMarketplace.qualifyLead({ lead_event_id: bridged.lead_event_id, milestone: 'order_paid', order_amount: 1200, referred_user_id: INVITEE }, operatorActor);
  await assert.rejects(
    () => localMarketplace.qualifyLead({ lead_event_id: bridged.lead_event_id, milestone: 'order_paid', order_amount: 1200, referred_user_id: INVITEE }, operatorActor),
    /already exists/i
  );
  const txns = await repository.list(REFERRAL_TABLES.walletTransactions, {});
  assert.equal(txns.length, 1, 'still exactly one benefit');
});
