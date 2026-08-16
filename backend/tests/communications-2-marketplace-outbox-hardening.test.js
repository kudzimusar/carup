import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { createInquiry } from '../services/marketplace/marketplaceInquiryService.js';
import { DatabaseError } from '../utils/errors.js';

class MinimalMarketplaceClient {
  constructor() {
    this.tables = {
      marketplace_inquiries: [],
      vehicles: [{ vin: 'VIN-C2-OUTBOX', owner_id: 'seller-outbox', tenant_id: 'tenant-outbox', status: 'active' }],
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
