/**
 * Security remediation — the legacy import-order quote and seller-assignment writes.
 *
 * The defect: POST /import-orders/:id/quotes (and /assign-seller) were guarded by authentication
 * only and INSERTED before any authority check — with seller_id taken from the body. Any signed-in
 * user could put a complete quote on another user's order in any seller's name, and an accepted
 * quote is SafeTrade's commercial authority (T13).
 *
 * Every refusal below also proves ZERO MUTATION: no quote, participant, audit or status change.
 * Positive controls prove the legitimate paths still work, so the refusals are not blanket-deny.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { addQuote, assignSeller } = await import('../services/diaspora/diasporaImportOrderService.js');

const ORDER = 'ord-legacy-1';
const buyer = { id: 'buyer-1', platformRole: 'owner', tenantId: 'tenant-A' };
const seller = { id: 'seller-1', platformRole: 'dealer', tenantId: 'tenant-A' };
const otherSeller = { id: 'seller-2', platformRole: 'dealer', tenantId: 'tenant-A' };
const outsider = { id: 'outsider-1', platformRole: 'owner', tenantId: 'tenant-B' };
const foreignTenantAdmin = { id: 'tadmin-b', platformRole: 'owner', tenantRole: 'admin', tenantId: 'tenant-B' };
const tenantAdmin = { id: 'tadmin-a', platformRole: 'owner', tenantRole: 'admin', tenantId: 'tenant-A' };
const reviewer = { id: 'rev-1', platformRole: 'reviewer' };

let mock;
function seed({ status = 'QUOTE_ISSUED', participants } = {}) {
  mock = createMockSupabase({
    diaspora_import_orders: [{ id: ORDER, tenant_id: 'tenant-A', buyer_id: 'buyer-1', created_by: 'buyer-1', status, metadata: {} }],
    diaspora_import_order_participants: participants ?? [
      { id: 'p-s1', import_order_id: ORDER, tenant_id: 'tenant-A', user_id: 'seller-1', participant_role: 'seller', verification_status: 'active' },
    ],
    diaspora_import_quotes: [],
    diaspora_import_audit_log: [],
    diaspora_import_status_history: [],
    diaspora_audit_logs: [],
  });
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => mock.from(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: (n, p) => mock.rpc(n, p) });
}

/** Snapshot every table so a refusal can be proven to have changed nothing. */
function snapshot() {
  const tables = ['diaspora_import_orders', 'diaspora_import_order_participants', 'diaspora_import_quotes', 'diaspora_import_audit_log', 'diaspora_import_status_history', 'diaspora_audit_logs'];
  return JSON.stringify(tables.map((t) => mock._rows(t)));
}

async function refusedWithoutMutation(fn, { code, status }) {
  const before = snapshot();
  await assert.rejects(fn, (err) => {
    if (status) assert.equal(err.statusCode, status, `expected HTTP ${status}, got ${err.statusCode}: ${err.message}`);
    if (code) assert.equal(err.details?.code, code);
    return true;
  });
  assert.equal(snapshot(), before, 'a refused request must mutate nothing');
}

const goodQuote = { quote_amount: 2400000, quote_currency: 'JPY' };

beforeEach(() => seed());

// ── Positive controls ────────────────────────────────────────────────────────

test('the assigned seller quotes as themselves; the seller id is server-derived', async () => {
  const { quote } = await addQuote(ORDER, { ...goodQuote }, seller);
  assert.equal(quote.seller_id, 'seller-1');
  assert.equal(quote.quote_currency, 'JPY', 'the original currency survives — never defaulted to USD');
  assert.equal(Number(quote.quote_amount), 2400000);
  assert.equal(quote.created_by, 'seller-1');
  assert.equal(mock._rows('diaspora_import_quotes').length, 1);
});

test('a seller may repeat their own id in the body; it is checked, not trusted', async () => {
  const { quote } = await addQuote(ORDER, { ...goodQuote, seller_id: 'seller-1' }, seller);
  assert.equal(quote.seller_id, 'seller-1');
});

test('an operator records a quote only for a seller assigned to THIS order', async () => {
  const byReviewer = await addQuote(ORDER, { ...goodQuote, seller_id: 'seller-1' }, reviewer);
  assert.equal(byReviewer.quote.seller_id, 'seller-1');
  const byTenantAdmin = await addQuote(ORDER, { ...goodQuote, seller_id: 'seller-1' }, tenantAdmin);
  assert.equal(byTenantAdmin.quote.seller_id, 'seller-1');
});

test('a second quote by the same seller is not mistaken for self-dealing after they updated the order', async () => {
  mock._rows('diaspora_import_orders')[0].updated_by = 'seller-1';
  const { quote } = await addQuote(ORDER, { ...goodQuote }, seller);
  assert.equal(quote.seller_id, 'seller-1');
});

// ── Forged seller authority ──────────────────────────────────────────────────

test('FORGED: an unrelated signed-in user naming the real seller is refused, nothing written', async () => {
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote, seller_id: 'seller-1' }, otherSeller), { code: 'QUOTE_FORBIDDEN', status: 403 });
});

test('FORGED: the assigned seller cannot quote in another seller\'s name', async () => {
  seed({ participants: [
    { id: 'p-s1', import_order_id: ORDER, user_id: 'seller-1', participant_role: 'seller', verification_status: 'active' },
    { id: 'p-s2', import_order_id: ORDER, user_id: 'seller-2', participant_role: 'seller', verification_status: 'active' },
  ] });
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote, seller_id: 'seller-2' }, seller), { code: 'QUOTE_SELLER_FORGED', status: 403 });
});

test('FORGED: an operator cannot record a quote for someone not assigned to the order', async () => {
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote, seller_id: 'seller-2' }, reviewer), { code: 'QUOTE_SELLER_NOT_ASSIGNED', status: 400 });
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote }, reviewer), { code: 'QUOTE_SELLER_NOT_ASSIGNED', status: 400 });
});

test('FORGED: a removed or non-seller participant carries no quote authority', async () => {
  seed({ participants: [
    { id: 'p-s1', import_order_id: ORDER, user_id: 'seller-1', participant_role: 'seller', verification_status: 'removed' },
    { id: 'p-a', import_order_id: ORDER, user_id: 'seller-2', participant_role: 'agent', verification_status: 'active' },
  ] });
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote }, seller), { code: 'QUOTE_FORBIDDEN', status: 403 });
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote }, otherSeller), { code: 'QUOTE_FORBIDDEN', status: 403 });
});

test('the buyer cannot quote their own order', async () => {
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote, seller_id: 'seller-1' }, buyer), { code: 'QUOTE_FORBIDDEN', status: 403 });
});

// ── Cross-tenant ─────────────────────────────────────────────────────────────

test('CROSS-TENANT: an outsider and a foreign tenant admin are refused, nothing written', async () => {
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote, seller_id: 'seller-1' }, outsider), { code: 'QUOTE_FORBIDDEN', status: 403 });
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote, seller_id: 'seller-1' }, foreignTenantAdmin), { code: 'QUOTE_FORBIDDEN', status: 403 });
});

test('an unauthenticated context is refused before anything is read or written', async () => {
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote }, {}), { status: 401 });
});

// ── Money and status, still before any write ─────────────────────────────────

test('invalid money is refused, and the currency is never defaulted', async () => {
  for (const bad of [
    { quote_amount: 0, quote_currency: 'USD' },
    { quote_amount: -5, quote_currency: 'USD' },
    { quote_amount: 'abc', quote_currency: 'USD' },
    { quote_amount: 100 },
    { quote_amount: 100, quote_currency: 'US' },
    { quote_amount: 100, quote_currency: 'DOLLARS' },
  ]) {
    await refusedWithoutMutation(() => addQuote(ORDER, bad, seller), { status: 400 });
  }
  const lower = await addQuote(ORDER, { quote_amount: 100, quote_currency: 'jpy' }, seller);
  assert.equal(lower.quote.quote_currency, 'JPY');
});

test('a status that cannot move to QUOTE_ISSUED refuses BEFORE the insert', async () => {
  seed({ status: 'SHIPPED' });
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote }, seller), {});
});

test('a missing order is 404 and writes nothing', async () => {
  await refusedWithoutMutation(() => addQuote('no-such-order', { ...goodQuote }, seller), { status: 404 });
});

// ── Seller assignment: the authority quoting depends on ──────────────────────

test('assignment: only an operator of this order may assign; everyone else is refused with no write', async () => {
  seed({ status: 'SELLER_ASSIGNED', participants: [] });
  for (const actor of [buyer, seller, otherSeller, outsider, foreignTenantAdmin]) {
    await refusedWithoutMutation(() => assignSeller(ORDER, { sellerId: actor.id }, actor), { code: 'SELLER_ASSIGNMENT_FORBIDDEN', status: 403 });
  }
  const { participant } = await assignSeller(ORDER, { sellerId: 'seller-2' }, reviewer);
  assert.equal(participant.user_id, 'seller-2');
  const byTenantAdmin = await assignSeller(ORDER, { sellerId: 'seller-3' }, tenantAdmin);
  assert.equal(byTenantAdmin.participant.user_id, 'seller-3');
});

test('assignment: self-assignment is not a back door into quoting', async () => {
  seed({ status: 'SELLER_ASSIGNED', participants: [] });
  await refusedWithoutMutation(() => assignSeller(ORDER, { sellerId: 'outsider-1' }, outsider), { code: 'SELLER_ASSIGNMENT_FORBIDDEN', status: 403 });
  await refusedWithoutMutation(() => addQuote(ORDER, { ...goodQuote }, outsider), { code: 'QUOTE_FORBIDDEN', status: 403 });
});

test('assignment: the buyer cannot be made the seller, and the role must be seller-side', async () => {
  seed({ status: 'SELLER_ASSIGNED', participants: [] });
  await refusedWithoutMutation(() => assignSeller(ORDER, { sellerId: 'buyer-1' }, reviewer), { code: 'SELF_DEALING_REFUSED', status: 400 });
  await refusedWithoutMutation(() => assignSeller(ORDER, { sellerId: 'seller-2', roleType: 'customs_reviewer' }, reviewer), { code: 'INVALID_SELLER_ROLE', status: 400 });
});

// ── Route wiring ─────────────────────────────────────────────────────────────

test('the routes pass the server-derived user context, never a body-supplied actor', () => {
  const routes = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /addQuote\(req\.params\.id, req\.body, req\.userContext, req\)/);
  assert.match(routes, /assignSeller\(req\.params\.id, req\.body, req\.userContext, req\)/);
});
