/**
 * T13 plan §9 item 6 — the legacy import-order quote write.
 *
 * `POST /api/diaspora/import-orders/:id/quotes` was guarded only by authentication, and `addQuote`
 * inserted the quote BEFORE any authorization check, taking `seller_id`, `quote_amount` and
 * `quote_currency` straight from the body. The only check was the order transition that ran
 * afterwards — skipped entirely when the order was already QUOTE_ISSUED, and, when it did run and
 * refuse, too late: the quote row was already committed. Any signed-in user could therefore put a
 * complete ISSUED quote on someone else's order in any seller's name at any price, and SafeTrade
 * treats an accepted quote as the authoritative seller/amount/currency.
 *
 * The route is retired, not guarded. Sellers and operators quote through the RFQ path
 * (`POST /api/diaspora/buyer-orders/:id/quotes` → diasporaRfqService.createQuote), which derives
 * `seller_id` from the caller and validates money before it writes.
 *
 * Drives the REAL diaspora router (real authorizeRole middleware) over HTTP against the stateful
 * in-memory Supabase mock, so "nothing was written" is asserted against actual table contents.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const diasporaRouter = (await import('../routes/diasporaRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');

const USERS = [
  { id: 'buyer-1', role: 'owner', is_verified: true },
  { id: 'seller-1', role: 'dealer', is_verified: true }, // the seller assigned to the victim order
  { id: 'intruder-1', role: 'dealer', is_verified: true }, // signed in, no relationship to the order
  { id: 'admin-1', role: 'platform_admin', is_verified: true },
];

function importOrder(overrides = {}) {
  return {
    id: 'order-1',
    tenant_id: null,
    buyer_id: 'buyer-1',
    created_by: 'buyer-1',
    order_type: 'vehicle',
    origin_country: 'Japan',
    status: 'QUOTE_ISSUED',
    metadata: {},
    deleted_at: null,
    ...overrides,
  };
}

// The quote a real, assigned seller already issued. The forged one would sit beside it.
const GENUINE_QUOTE = {
  id: 'quote-genuine',
  import_order_id: 'order-1',
  tenant_id: null,
  seller_id: 'seller-1',
  quote_amount: 9000,
  quote_currency: 'USD',
  status: 'ISSUED',
  created_by: 'seller-1',
  deleted_at: null,
};

let client;
function useDb({ orders = [importOrder()], quotes = [{ ...GENUINE_QUOTE }] } = {}) {
  client = createMockSupabase({
    users: USERS.map((u) => ({ ...u })),
    diaspora_import_orders: orders,
    diaspora_import_order_participants: [
      { id: 'p-1', import_order_id: 'order-1', user_id: 'seller-1', participant_role: 'seller', deleted_at: null },
    ],
    diaspora_import_quotes: quotes,
    diaspora_import_audit_log: [],
    notification_queue: [],
  });
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: client.from });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: client.rpc });
  return client;
}

let server; let baseUrl;
before(async () => {
  useDb();
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

async function post(path, { userId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

const quotes = () => client._rows('diaspora_import_quotes');
const quoteAudit = () => client._rows('diaspora_import_audit_log').filter((row) => row.resource_type === 'diaspora_import_quote');
const orderStatus = (id = 'order-1') => client._rows('diaspora_import_orders').find((o) => o.id === id)?.status;

function assertNothingWritten(before) {
  assert.deepEqual(quotes(), before.quotes, 'no quote row may be written by a refused call');
  assert.equal(quoteAudit().length, 0, 'no quote audit row may be written by a refused call');
  assert.equal(orderStatus(), before.status, 'the order status must not move');
}

const snapshot = () => ({ quotes: quotes().map((q) => ({ ...q })), status: orderStatus() });

// The forgery: a complete quote in the assigned seller's name, at a price the attacker chose.
const FORGED = { seller_id: 'seller-1', quote_amount: 1, quote_currency: 'USD' };

// ---------------------------------------------------------------------------------------------
// The defect: a non-participant, non-privileged user must be refused, and nothing written.
// ---------------------------------------------------------------------------------------------

test('a non-participant cannot quote on someone else\'s QUOTE_ISSUED order in another seller\'s name — refused, nothing written', async () => {
  useDb();
  const before = snapshot();
  const res = await post('/api/diaspora/import-orders/order-1/quotes', { userId: 'intruder-1', body: FORGED });
  assert.ok(res.status >= 400 && res.status < 500, `expected a refusal, got ${res.status}`);
  assertNothingWritten(before);
});

test('a non-participant is refused BEFORE the write when the order is IMPORT_REQUESTED (the transition check used to fire after the insert)', async () => {
  useDb({ orders: [importOrder({ status: 'IMPORT_REQUESTED' })], quotes: [] });
  const before = snapshot();
  const res = await post('/api/diaspora/import-orders/order-1/quotes', { userId: 'intruder-1', body: FORGED });
  assert.ok(res.status >= 400 && res.status < 500, `expected a refusal, got ${res.status}`);
  assertNothingWritten(before);
});

test('the legacy quote write is retired for every caller — buyer, assigned seller and platform admin included — and points at the RFQ path', async () => {
  for (const userId of ['intruder-1', 'buyer-1', 'seller-1', 'admin-1']) {
    useDb();
    const before = snapshot();
    const res = await post('/api/diaspora/import-orders/order-1/quotes', { userId, body: { quote_amount: 5000, quote_currency: 'USD' } });
    assert.equal(res.status, 410, `${userId}: expected 410 Gone, got ${res.status}`);
    assert.equal(res.body?.code, 'LEGACY_IMPORT_ORDER_QUOTE_WRITE_RETIRED', `${userId}: machine code`);
    assert.match(res.body?.error || '', /buyer-orders\/:id\/quotes/, `${userId}: names the replacement route`);
    assertNothingWritten(before);
  }
});

test('the retired route still requires authentication (401, nothing written)', async () => {
  useDb();
  const before = snapshot();
  const res = await post('/api/diaspora/import-orders/order-1/quotes', { body: FORGED });
  assert.equal(res.status, 401);
  assertNothingWritten(before);
});

test('the legacy addQuote writer is gone from the import-order service, so nothing can re-wire it', async () => {
  const svc = await import('../services/diaspora/diasporaImportOrderService.js');
  assert.equal(svc.addQuote, undefined);
});

// ---------------------------------------------------------------------------------------------
// Legitimate quoting still works — through the RFQ path.
// ---------------------------------------------------------------------------------------------

function publishedRequest(overrides = {}) {
  return importOrder({ id: 'rfq-1', status: 'RFQ_PENDING', metadata: { rfq: { published: true } }, ...overrides });
}

test('a seller quotes through the RFQ path: 201, ISSUED, and seller_id is the caller even when the body names another seller', async () => {
  useDb({ orders: [publishedRequest()], quotes: [] });
  const res = await post('/api/diaspora/buyer-orders/rfq-1/quotes', {
    userId: 'seller-1',
    body: { seller_id: 'intruder-1', quote_amount: 8500, quote_currency: 'usd', submit: true },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const [row] = quotes();
  assert.equal(quotes().length, 1);
  assert.equal(row.seller_id, 'seller-1');
  assert.equal(row.created_by, 'seller-1');
  assert.equal(row.status, 'ISSUED');
  assert.equal(Number(row.quote_amount), 8500);
  assert.equal(row.quote_currency, 'USD');
});

test('a platform operator can quote through the RFQ path, in their own name', async () => {
  useDb({ orders: [publishedRequest()], quotes: [] });
  const res = await post('/api/diaspora/buyer-orders/rfq-1/quotes', {
    userId: 'admin-1',
    body: { seller_id: 'seller-1', quote_amount: 7000, quote_currency: 'JPY', submit: true },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const [row] = quotes();
  assert.equal(row.seller_id, 'admin-1');
  assert.equal(row.quote_currency, 'JPY');
});

test('the RFQ path refuses a non-positive or non-numeric amount and writes nothing', async () => {
  for (const quote_amount of [0, -5, 'abc', undefined]) {
    useDb({ orders: [publishedRequest()], quotes: [] });
    const res = await post('/api/diaspora/buyer-orders/rfq-1/quotes', { userId: 'seller-1', body: { quote_amount, quote_currency: 'USD', submit: true } });
    assert.equal(res.status, 400, `amount ${quote_amount}: expected 400, got ${res.status}`);
    assert.equal(quotes().length, 0, `amount ${quote_amount}: nothing written`);
  }
});

test('the RFQ path refuses a currency that is not a three-letter code and writes nothing', async () => {
  for (const quote_currency of ['US', 'DOLLARS', 'U$D', '12A']) {
    useDb({ orders: [publishedRequest()], quotes: [] });
    const res = await post('/api/diaspora/buyer-orders/rfq-1/quotes', { userId: 'seller-1', body: { quote_amount: 100, quote_currency, submit: true } });
    assert.equal(res.status, 400, `currency ${quote_currency}: expected 400, got ${res.status}`);
    assert.equal(quotes().length, 0, `currency ${quote_currency}: nothing written`);
  }
});

test('a buyer cannot quote through the RFQ path (seller-side route gate, nothing written)', async () => {
  useDb({ orders: [publishedRequest()], quotes: [] });
  const res = await post('/api/diaspora/buyer-orders/rfq-1/quotes', { userId: 'buyer-1', body: { quote_amount: 100, submit: true } });
  assert.equal(res.status, 403);
  assert.equal(quotes().length, 0);
});
