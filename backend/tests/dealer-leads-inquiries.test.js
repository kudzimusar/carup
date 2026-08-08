/**
 * Dealer leads de-mock (S9): GET /api/leads must read REAL buyer intent from
 * marketplace_inquiries scoped to the signed-in seller (seller_id / seller_tenant_id via the
 * shared listInquiriesForSeller service) instead of the orphaned `dealer_leads` table that
 * nothing writes and no migration creates.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/leadsRoutes.js')).default;
const { inquiryToLead, inquiriesToLeads } = await import('../routes/leadsRoutes.js');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
let missingInquiryTable = false;
function resetDb() {
  missingInquiryTable = false;
  db = {
    users: [
      { id: 'dealer-1', role: 'dealer', is_verified: true },
      { id: 'dealer-2', role: 'dealer', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
    ],
    tenant_users: [
      { tenant_id: 'tenant-1', user_id: 'dealer-1', role: 'dealer' },
      { tenant_id: 'tenant-2', user_id: 'dealer-2', role: 'dealer' },
    ],
    marketplace_inquiries: [],
  };
}

function builder(table) {
  const st = { table, filters: {}, single: false, maybe: false };
  const chain = {
    select() { return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  if (st.table === 'marketplace_inquiries' && missingInquiryTable) {
    return { data: null, error: { code: '42P01', message: 'relation "public.marketplace_inquiries" does not exist' } };
  }
  const rows = (db[st.table] = db[st.table] || []);
  const out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.maybe) return { data: out[0] || null, error: null };
  if (st.single) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } };
  return { data: out, error: null };
}

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use(router);
  a.use(errorHandler);
  return a;
})();

function request(method, path, userId, tenantId) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address();
      const req = http.request({
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'content-type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {}),
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
        },
      }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          srv.close();
          let body = null;
          if (buf) { try { body = JSON.parse(buf); } catch { body = { _raw: buf }; } }
          resolve({ status: res.statusCode, body });
        });
      });
      req.on('error', (e) => { srv.close(); reject(e); });
      req.end();
    });
  });
}

function inquiryRow(overrides = {}) {
  return {
    id: 'inq-1',
    listing_id: 'JTDKARFP0H3000731',
    inquiry_type: 'vehicle_purchase_interest',
    status: 'new',
    source_channel: 'web',
    message: 'Is this still available?',
    guest_name: 'Real Buyer',
    guest_email: 'buyer@example.test',
    guest_phone: '+263772000001',
    seller_id: 'dealer-1',
    seller_tenant_id: 'tenant-1',
    created_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

before(() => { resetDb(); supabase.from = (t) => builder(t); });

test('inquiryToLead maps a seller inquiry into the lead shape the page renders', () => {
  const lead = inquiryToLead({
    id: 'inq-9',
    listing_id: 'VIN000000000000009',
    inquiry_type: 'vehicle_purchase_interest',
    status: 'qualified',
    source_channel: 'web',
    message: 'Can we negotiate?',
    contact_name: 'Buyer Nine',
    contact_email: 'nine@example.test',
    contact_phone: '+263772000009',
    created_at: '2026-08-02T00:00:00.000Z',
  });
  assert.deepEqual(lead, {
    id: 'inq-9',
    buyer_name: 'Buyer Nine',
    email: 'nine@example.test',
    buyer_phone: '+263772000009',
    vin: 'VIN000000000000009',
    status: 'negotiating',
    source: 'web',
    message: 'Can we negotiate?',
    created_at: '2026-08-02T00:00:00.000Z',
  });
});

test('lead status vocabulary: assigned reads as new, rejected as closed, unknown as new', () => {
  assert.equal(inquiryToLead({ id: 'a', status: 'assigned' }).status, 'new');
  assert.equal(inquiryToLead({ id: 'b', status: 'contacted' }).status, 'contacted');
  assert.equal(inquiryToLead({ id: 'c', status: 'closed' }).status, 'closed');
  assert.equal(inquiryToLead({ id: 'd', status: 'rejected' }).status, 'closed');
  assert.equal(inquiryToLead({ id: 'e', status: 'future_status' }).status, 'new');
});

test('inquiriesToLeads drops spam and keeps everything else', () => {
  const leads = inquiriesToLeads([
    { id: 'ok-1', status: 'new' },
    { id: 'spam-1', status: 'spam' },
    { id: 'ok-2', status: 'closed' },
  ]);
  assert.deepEqual(leads.map((l) => l.id), ['ok-1', 'ok-2']);
});

test('GET /api/leads returns only this seller\'s marketplace inquiries as leads', async () => {
  resetDb();
  db.marketplace_inquiries = [
    inquiryRow(),
    inquiryRow({ id: 'inq-2', seller_id: 'dealer-2', seller_tenant_id: 'tenant-2', guest_name: 'Other Tenant Buyer' }),
  ];
  const res = await request('GET', '/api/leads', 'dealer-1', 'tenant-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, 'inq-1');
  assert.equal(res.body[0].buyer_name, 'Real Buyer');
  assert.equal(res.body[0].vin, 'JTDKARFP0H3000731');
  assert.equal(res.body[0].status, 'new');
});

test('GET /api/leads scopes by seller_id even without a tenant header', async () => {
  resetDb();
  db.marketplace_inquiries = [
    inquiryRow({ seller_tenant_id: null }),
    inquiryRow({ id: 'inq-2', seller_id: 'dealer-2', seller_tenant_id: null }),
  ];
  const res = await request('GET', '/api/leads', 'dealer-1');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((l) => l.id), ['inq-1']);
});

test('GET /api/leads never surfaces spam-flagged inquiries', async () => {
  resetDb();
  db.marketplace_inquiries = [
    inquiryRow(),
    inquiryRow({ id: 'inq-spam', status: 'spam', guest_name: 'Spammer' }),
  ];
  const res = await request('GET', '/api/leads', 'dealer-1', 'tenant-1');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((l) => l.id), ['inq-1']);
});

test('GET /api/leads degrades to an empty list when the inquiries table is not provisioned', async () => {
  resetDb();
  missingInquiryTable = true;
  const res = await request('GET', '/api/leads', 'dealer-1', 'tenant-1');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('GET /api/leads is denied to a buyer (403)', async () => {
  resetDb();
  const res = await request('GET', '/api/leads', 'buyer-1');
  assert.equal(res.status, 403);
});
