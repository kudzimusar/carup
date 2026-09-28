import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { createInquiry } from '../services/marketplace/marketplaceInquiryService.js';
import { DatabaseError } from '../utils/errors.js';

class MinimalMarketplaceClient {
  constructor() {
    this.tables = {
      marketplace_inquiries: [],
      vehicles: [{ vin: 'VIN-C2-OUTBOX', owner_id: 'seller-outbox', current_seller_id: 'seller-outbox', tenant_id: 'tenant-outbox', status: 'active' }],
      users: [],
    };
  }

  from(table) {
    const client = this;
    const state = { table, filters: [], insertRows: null };
    const api = {
      select() { return api; },
      eq(key, value) { state.filters.push([key, value]); return api; },
      insert(row) { state.insertRows = Array.isArray(row) ? row : [row]; return api; },
      single() { return api._execute(true); },
      maybeSingle() { return api._execute(true); },
      then(resolve, reject) { return api._execute(false).then(resolve, reject); },
      async _execute(single = false) {
        if (!client.tables[state.table]) return { data: null, error: { message: `unknown table ${state.table}` } };
        if (state.insertRows) {
          client.tables[state.table].push(...state.insertRows);
          return { data: single ? state.insertRows[0] : state.insertRows, error: null };
        }
        const rows = client.tables[state.table].filter((row) => state.filters.every(([key, value]) => row[key] === value));
        return { data: single ? (rows[0] || null) : rows, error: null };
      },
    };
    return api;
  }
}

test('Marketplace inquiry cannot report success when canonical communication outbox persistence fails', async () => {
  const client = new MinimalMarketplaceClient();
  const communicationFailure = new Error('simulated communications outbox outage');
  const referralBridge = {
    async emitMarketplaceReferralEvent() { return { emitted: false }; },
  };

  await assert.rejects(
    () => createInquiry(client, {
      listing_id: 'VIN-C2-OUTBOX',
      inquiry_type: 'vehicle_purchase_interest',
      message: 'Exact buyer text that must not be silently lost',
      guest_name: 'Outbox Buyer',
      guest_phone: '+263771234567',
      source_channel: 'web',
      metadata: { preferred_contact: 'whatsapp' },
    }, null, {
      referralBridge,
      emitCommunicationEvent: async () => { throw communicationFailure; },
      emitDomainEvent: async () => ({ id: 'unused' }),
    }),
    (error) => error instanceof DatabaseError && /canonical communication/i.test(error.message),
  );

  assert.equal(client.tables.marketplace_inquiries.length, 1, 'the already-written inquiry remains explicitly recoverable');
  assert.equal(client.tables.marketplace_inquiries[0].message, 'Exact buyer text that must not be silently lost');
});

test('Marketplace inquiry materializes the same durable communication event inline when a canonicalizer is supplied', async () => {
  const client = new MinimalMarketplaceClient();
  const events = [];
  const canonicalized = [];
  const referralBridge = {
    async emitMarketplaceReferralEvent() { return { emitted: false }; },
  };

  const result = await createInquiry(client, {
    listing_id: 'VIN-C2-OUTBOX',
    inquiry_type: 'vehicle_purchase_interest',
    message: 'Please contact me inside CarUp.',
    guest_name: 'In-app Buyer',
    guest_email: 'buyer@example.test',
    source_channel: 'web',
  }, null, {
    referralBridge,
    emitCommunicationEvent: async (_pg, eventType, payload, tenantId) => {
      const event = { id: 'evt-inline-1', event_type: eventType, payload, tenant_id: tenantId, status: 'pending' };
      events.push(event);
      return event;
    },
    canonicalizeCommunicationInquiry: async (event) => {
      canonicalized.push(event);
      return [{ thread: { id: 'thread-inline-1' } }];
    },
    emitDomainEvent: async () => ({ id: 'unused' }),
  });

  assert.equal(result.id, client.tables.marketplace_inquiries[0].id);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'marketplace.inquiry.created');
  assert.equal(events[0].payload.inquiryId, result.id);
  assert.equal(events[0].status, 'pending', 'inline materialization must not erase the durable recovery event');
  assert.equal(canonicalized.length, 1);
  assert.equal(canonicalized[0], events[0], 'inline path must consume the exact durable event record');
});

test('Marketplace inquiry fails closed when inline canonical conversation materialization fails', async () => {
  const client = new MinimalMarketplaceClient();
  const referralBridge = {
    async emitMarketplaceReferralEvent() { return { emitted: false }; },
  };
  let durableEvent = null;

  await assert.rejects(
    () => createInquiry(client, {
      listing_id: 'VIN-C2-OUTBOX',
      inquiry_type: 'vehicle_purchase_interest',
      message: 'This inquiry must remain recoverable.',
      guest_name: 'Recovery Buyer',
      guest_email: 'recovery@example.test',
      source_channel: 'web',
    }, null, {
      referralBridge,
      emitCommunicationEvent: async (_pg, eventType, payload, tenantId) => {
        durableEvent = { id: 'evt-recovery-1', event_type: eventType, payload, tenant_id: tenantId, status: 'pending' };
        return durableEvent;
      },
      canonicalizeCommunicationInquiry: async () => { throw new Error('simulated inline canonicalizer outage'); },
      emitDomainEvent: async () => ({ id: 'unused' }),
    }),
    (error) => error instanceof DatabaseError
      && /canonical in-app conversation/i.test(error.message)
      && error.details?.recovery_required === true,
  );

  assert.equal(client.tables.marketplace_inquiries.length, 1, 'durable inquiry remains for recovery');
  assert.equal(durableEvent?.status, 'pending', 'durable event remains replayable by the outbox worker');
  assert.equal(durableEvent?.payload?.inquiryId, client.tables.marketplace_inquiries[0].id);
});

test('Marketplace HTTP route injects the canonical Communications orchestrator into inquiry capture', () => {
  const source = readFileSync(new URL('../routes/marketplaceRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /createCommunicationServices/);
  assert.match(source, /canonicalizeMarketplaceInquiryInline/);
  assert.match(source, /canonicalizeCommunicationInquiry:\s*canonicalizeMarketplaceInquiryInline/);
  assert.match(source, /\.orchestrator\.handleDomainEvent\(event\)/);
});
