import test from 'node:test';
import assert from 'node:assert/strict';
import { createInquiry } from '../services/marketplace/marketplaceInquiryService.js';
import { MarketplaceReferralBridgeService } from '../services/marketplace/marketplaceReferralBridgeService.js';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralLocalMarketplaceHardenedService } from '../services/referral/referralLocalMarketplaceHardenedService.js';
import { LOCAL_MARKETPLACE_EVENT_TYPES } from '../services/referral/referralLocalMarketplaceService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CODE_TYPES, REFERRAL_EVENT_TYPES, WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ConflictError, DatabaseError } from '../utils/errors.js';

class MemoryReferralRepository {
  constructor({ uniqueInquiryLead = false } = {}) {
    this.counter = 0;
    this.uniqueInquiryLead = uniqueInquiryLead;
    this.tables = new Map(Object.values(REFERRAL_TABLES).map((table) => [table, []]));
  }
  nextId(table) { this.counter += 1; return `${table}-${this.counter}`; }
  match(row, filters = {}) { return Object.entries(filters).every(([key, value]) => value === undefined || value === null || row[key] === value); }
  async insert(table, payload) {
    const sourceInquiryId = payload.metadata?.source_inquiry_id || null;
    if (
      this.uniqueInquiryLead &&
      table === REFERRAL_TABLES.events &&
      payload.event_type === LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED &&
      payload.subject_type === 'local_marketplace_lead' &&
      sourceInquiryId &&
      this.tables.get(table).some((row) =>
        row.event_type === payload.event_type &&
        row.subject_type === payload.subject_type &&
        row.tenant_id === payload.tenant_id &&
        row.metadata?.source_inquiry_id === sourceInquiryId
      )
    ) {
      throw new ConflictError('duplicate local marketplace inquiry lead');
    }
    const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || new Date().toISOString(), ...payload };
    this.tables.get(table).push(row);
    return row;
  }
  async findOne(table, filters = {}) { return this.tables.get(table).find((row) => this.match(row, filters)) || null; }
  async list(table, filters = {}, options = {}) {
    let rows = this.tables.get(table).filter((row) => this.match(row, filters));
    if (options.jsonContains?.metadata) {
      rows = rows.filter((row) => Object.entries(options.jsonContains.metadata).every(([key, value]) => row.metadata?.[key] === value));
    }
    if (options.orderBy) rows = rows.sort((a, b) => String(b[options.orderBy] || '').localeCompare(String(a[options.orderBy] || '')));
    if (options.limit) rows = rows.slice(Number(options.offset || 0), Number(options.offset || 0) + Number(options.limit));
    return rows;
  }
  async listIn(table, column, values = [], filters = {}, options = {}) {
    const allowed = new Set(values);
    let rows = this.tables.get(table).filter((row) => allowed.has(row[column]) && this.match(row, filters));
    if (options.jsonContains?.metadata?.opened_by) {
      rows = rows.filter((row) => row.metadata?.opened_by === options.jsonContains.metadata.opened_by);
    }
    if (options.orderBy) rows = rows.sort((a, b) => String(b[options.orderBy] || '').localeCompare(String(a[options.orderBy] || '')));
    if (options.limit) rows = rows.slice(Number(options.offset || 0), Number(options.offset || 0) + Number(options.limit));
    return rows;
  }
  async countIn(table, column, values = [], filters = {}, options = {}) {
    return (await this.listIn(table, column, values, filters, options)).length;
  }
  async updateById(table, id, patch) {
    const rows = this.tables.get(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return null;
    rows[index] = { ...rows[index], ...patch };
    return rows[index];
  }
  async count(table, filters = {}) { return (await this.list(table, filters)).length; }
}

class MemoryMarketplaceClient {
  constructor() {
    this.tables = {
      marketplace_inquiries: [],
      vehicles: [{ vin: 'listing-42', owner_id: 'seller-1', current_seller_id: 'seller-1', tenant_id: 'tenant-1', status: 'active' }],
      users: [{ id: INVITEE, name: 'Invitee Buyer', email: 'invitee@example.test', phone: '+263771000001' }],
    };
  }
  from(table) {
    const client = this;
    const state = { table, filters: [], insertRows: null, select: '*' };
    const api = {
      select(value = '*') { state.select = value; return api; },
      eq(key, value) { state.filters.push([key, value]); return api; },
      insert(row) { state.insertRows = Array.isArray(row) ? row : [row]; return api; },
      single() { return api._execute(true); },
      maybeSingle() { return api._execute(true, true); },
      then(resolve, reject) { return api._execute(false).then(resolve, reject); },
      async _execute(single = false, maybe = false) {
        if (!client.tables[state.table]) return { data: null, error: { message: `unknown table ${state.table}` } };
        if (state.insertRows) {
          client.tables[state.table].push(...state.insertRows);
          const data = single ? state.insertRows[0] : state.insertRows;
          return { data, error: null };
        }
        let rows = client.tables[state.table].filter((row) => state.filters.every(([key, value]) => row[key] === value));
        if (single || maybe) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      },
    };
    return api;
  }
}

const OWNER = 'refv1-code-owner';
const INVITEE = 'refv1-invitee';
const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'op-session' });
const inviteeActor = Object.freeze({ id: INVITEE, userId: INVITEE, tenantId: 'tenant-1', role: 'member' });

async function createHarness(options = {}) {
  const repository = new MemoryReferralRepository(options);
  const now = () => new Date('2026-07-15T00:00:00.000Z');
  const referralService = new ReferralEngineService({ repository, now });
  const localMarketplace = new ReferralLocalMarketplaceHardenedService({ referralService, now });
  const bridge = new MarketplaceReferralBridgeService({ referralService, localMarketplaceService: localMarketplace });
  const client = new MemoryMarketplaceClient();
  const outbox = [];
  const emitDomainEvent = async (_pg, eventType, payload, tenantId) => {
    outbox.push({ eventType, payload, tenantId });
    return { id: `outbox-${outbox.length}`, event_type: eventType, payload, tenant_id: tenantId };
  };
  const campaign = await referralService.createCampaign({ name: 'S4 Bridge Campaign', campaign_type: 'LOCAL_MARKETPLACE', priority_scope: 'LOCAL', status: 'ACTIVE', tenant_id: 'tenant-1' }, operatorActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: OWNER, code: 'S4BRIDGE001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'web', tenant_id: 'tenant-1' }, operatorActor);
  return { repository, referralService, localMarketplace, bridge, client, emitDomainEvent, outbox, campaign, code };
}

function inquiryPayload(referralCode, overrides = {}) {
  return {
    listing_id: 'listing-42',
    inquiry_type: 'vehicle_purchase_interest',
    message: 'I want to buy a Toyota Aqua',
    source_channel: 'web',
    referral_code: referralCode,
    owner_user_id: INVITEE,
    opened_by: INVITEE,
    beneficiary_user_id: INVITEE,
    ...overrides,
  };
}

async function createAttributedInquiry(harness, overrides = {}) {
  return createInquiry(
    harness.client,
    inquiryPayload(harness.code.code, overrides),
    inviteeActor,
    { referralBridge: harness.bridge, emitDomainEvent: harness.emitDomainEvent, emitCommunicationEvent: harness.emitDomainEvent }
  );
}

async function events(repository, eventType) {
  return repository.list(REFERRAL_TABLES.events, { event_type: eventType });
}

test('real createInquiry persists the inquiry, attribution, and bridged lead source identifier', async () => {
  const harness = await createHarness();
  const response = await createAttributedInquiry(harness);

  assert.ok(response.id, 'marketplace inquiry id is returned');
  assert.equal(response.referral_attributed, true);
  assert.ok(response.referral_lead_event_id, 'response contains bridged lead event id');
  assert.equal(harness.client.tables.marketplace_inquiries.length, 1, 'marketplace inquiry is persisted');
  assert.equal(harness.client.tables.marketplace_inquiries[0].referral_code, harness.code.code, 'attribution is persisted');

  const leadEvents = await events(harness.repository, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED);
  assert.equal(leadEvents.length, 1);
  assert.equal(leadEvents[0].id, response.referral_lead_event_id);
  assert.equal(leadEvents[0].subject_id, response.id);
  assert.equal(leadEvents[0].metadata.source_inquiry_id, response.id);
  assert.equal(leadEvents[0].metadata.attribution.owner_user_id, OWNER);
  assert.notEqual(leadEvents[0].metadata.attribution.owner_user_id, INVITEE, 'caller-supplied owner fields are ignored');
});

test('one valid attributed inquiry produces one validation event, one marketplace event, and one lead event', async () => {
  const harness = await createHarness();
  await createAttributedInquiry(harness);

  assert.equal((await events(harness.repository, REFERRAL_EVENT_TYPES.CODE_VALIDATED)).length, 1);
  assert.equal((await events(harness.repository, 'marketplace_inquiry_created')).length, 1);
  assert.equal((await events(harness.repository, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED)).length, 1);
});

test('inquiry submission creates no wallet transaction before admin qualification', async () => {
  const harness = await createHarness();
  await createAttributedInquiry(harness);
  assert.equal((await harness.repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
});

test('invalid referral code persists a normal inquiry but creates no attributed lead', async () => {
  const harness = await createHarness();
  const response = await createInquiry(
    harness.client,
    inquiryPayload('NO-SUCH-CODE'),
    inviteeActor,
    { referralBridge: harness.bridge, emitDomainEvent: harness.emitDomainEvent, emitCommunicationEvent: harness.emitDomainEvent }
  );
  assert.ok(response.id);
  assert.equal(response.referral_lead_event_id, null);
  assert.equal((await events(harness.repository, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED)).length, 0);
  assert.equal((await events(harness.repository, REFERRAL_EVENT_TYPES.CODE_VALIDATED)).length, 0);
});

test('non-referral inquiry works normally and does not require a referral lead', async () => {
  const harness = await createHarness();
  const response = await createInquiry(
    harness.client,
    inquiryPayload(null, { guest_email: 'guest@example.test' }),
    null,
    { referralBridge: harness.bridge, emitDomainEvent: harness.emitDomainEvent, emitCommunicationEvent: harness.emitDomainEvent }
  );
  assert.ok(response.id);
  assert.equal(response.referral_lead_event_id, null);
  assert.equal((await events(harness.repository, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED)).length, 0);
});

test('durable bridge failure is not reported as a successful attributed inquiry', async () => {
  const harness = await createHarness();
  const failingBridge = {
    emitMarketplaceReferralEvent: harness.bridge.emitMarketplaceReferralEvent.bind(harness.bridge),
    async bridgeInquiryToReferralLead() { throw new Error('simulated bridge outage'); },
  };
  await assert.rejects(
    () => createInquiry(
      harness.client,
      inquiryPayload(harness.code.code),
      inviteeActor,
      { referralBridge: failingBridge, emitDomainEvent: harness.emitDomainEvent, emitCommunicationEvent: harness.emitDomainEvent }
    ),
    DatabaseError
  );
  assert.equal(harness.outbox.some((event) => event.eventType === 'marketplace.inquiry.referral_bridge_requested'), true);
  assert.equal((await events(harness.repository, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED)).length, 0);
});

test('simultaneous bridge executions for the same inquiry produce one qualifiable lead', async () => {
  const harness = await createHarness({ uniqueInquiryLead: true });
  const inquiry = {
    id: 'same-inquiry-1',
    listing_id: 'listing-42',
    message: 'I want to buy a Toyota Aqua',
    source_channel: 'web',
    referral_code: harness.code.code,
    buyer_id: INVITEE,
  };

  const [first, second] = await Promise.all([
    harness.bridge.bridgeInquiryToReferralLead({ inquiry, actor: { actor_user_id: INVITEE, id: INVITEE, actor_type: 'user', actor_tenant_id: 'tenant-1' } }),
    harness.bridge.bridgeInquiryToReferralLead({ inquiry, actor: { actor_user_id: INVITEE, id: INVITEE, actor_type: 'user', actor_tenant_id: 'tenant-1' } }),
  ]);

  assert.equal(first.bridged, true);
  assert.equal(second.bridged, true);
  assert.equal(first.lead_event_id, second.lead_event_id);
  assert.equal((await events(harness.repository, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED)).length, 1);
});

test('bridge conflict recovery returns only the matching tenant inquiry lead', async () => {
  const harness = await createHarness({ uniqueInquiryLead: true });
  const inquiry = {
    id: 'shared-inquiry-id',
    listing_id: 'listing-42',
    seller_tenant_id: 'tenant-1',
    message: 'I want to buy a Toyota Aqua',
    source_channel: 'web',
    referral_code: harness.code.code,
    buyer_id: INVITEE,
  };

  await harness.repository.insert(REFERRAL_TABLES.events, {
    tenant_id: 'tenant-2',
    event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED,
    subject_type: 'local_marketplace_lead',
    subject_id: 'manual-subject-can-overlap',
    metadata: { source_inquiry_id: inquiry.id },
  });

  const first = await harness.bridge.bridgeInquiryToReferralLead({
    inquiry,
    actor: { actor_user_id: INVITEE, id: INVITEE, actor_type: 'user', actor_tenant_id: 'tenant-1' },
  });
  const second = await harness.bridge.bridgeInquiryToReferralLead({
    inquiry,
    actor: { actor_user_id: INVITEE, id: INVITEE, actor_type: 'user', actor_tenant_id: 'tenant-1' },
  });

  assert.equal(first.bridged, true);
  assert.equal(second.bridged, true);
  assert.equal(first.lead_event_id, second.lead_event_id);
  const leadEvents = await events(harness.repository, LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED);
  assert.equal(leadEvents.find((event) => event.id === first.lead_event_id)?.tenant_id, 'tenant-1');
  assert.equal(leadEvents.filter((event) => event.tenant_id === 'tenant-1' && event.metadata?.source_inquiry_id === inquiry.id).length, 1);
  assert.equal(leadEvents.filter((event) => event.tenant_id === 'tenant-2' && event.metadata?.source_inquiry_id === inquiry.id).length, 1);
});

test('admin qualification of the bridged lead creates exactly one pending benefit for the original code owner', async () => {
  const harness = await createHarness();
  const inquiry = await createAttributedInquiry(harness);
  const qualified = await harness.localMarketplace.qualifyLead(
    { lead_event_id: inquiry.referral_lead_event_id, milestone: 'order_paid', order_amount: 1200, referred_user_id: INVITEE },
    operatorActor
  );

  assert.equal(qualified.reward_created, true);
  const txns = await harness.repository.list(REFERRAL_TABLES.walletTransactions);
  assert.equal(txns.length, 1);
  assert.equal(txns[0].status, WALLET_TRANSACTION_STATUSES.PENDING);
  assert.equal(txns[0].user_id, OWNER);
  assert.notEqual(txns[0].user_id, INVITEE);
  await assert.rejects(
    () => harness.localMarketplace.qualifyLead({ lead_event_id: inquiry.referral_lead_event_id, milestone: 'order_paid', order_amount: 1200, referred_user_id: INVITEE }, operatorActor),
    /already exists/i
  );
  assert.equal((await harness.repository.list(REFERRAL_TABLES.walletTransactions)).length, 1);
});