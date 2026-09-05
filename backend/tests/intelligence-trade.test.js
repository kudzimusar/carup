/**
 * CarUp Intelligence 1.0 — I13 diaspora / trade intelligence.
 *
 * Trade is where a fabricated figure looks most like a business result. The two
 * things a reader most wants from this domain are settled trade value and
 * shipment demand, and they are exactly the two CarUp cannot state: not one
 * payment milestone has ever been confirmed, every escrow session that reached a
 * payment state used the sandbox provider, and every shipment table is empty.
 *
 * These tests hold that line, and one more: money is never summed across
 * currencies, because CarUp applies no exchange rate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getTradeIntelligence,
  resolveTradeScope,
  amountsByCurrency,
  corridorDemand,
  orderFunnel,
  milestoneProgress,
  escrowActivity,
  NOT_MEASURABLE,
  TRADE_INTELLIGENCE_VERSION,
} from '../services/intelligence/tradeIntelligenceService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
/** Comments stripped: a later route's doc comment would otherwise be read as
 *  part of an earlier route's gate. */
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BUYER = { id: 'u1', role: 'owner' };
const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const today = new Date().toISOString();

const order = (o = {}) => ({
  id: o.id || 'o1', tenant_id: o.tenant_id ?? null,
  buyer_id: o.buyer_id === undefined ? 'u1' : o.buyer_id,
  created_by: o.created_by === undefined ? 'u1' : o.created_by,
  order_type: o.order_type || 'vehicle',
  origin_country: o.origin_country === undefined ? 'Japan' : o.origin_country,
  destination_country: o.destination_country === undefined ? 'Zimbabwe' : o.destination_country,
  budget_amount: o.budget_amount === undefined ? 5000 : o.budget_amount,
  budget_currency: o.budget_currency === undefined ? 'USD' : o.budget_currency,
  status: o.status || 'IMPORT_REQUESTED',
  vin: o.vin ?? null, linked_vehicle_vin: o.linked_vehicle_vin ?? null,
  created_at: o.created_at || today,
});

const quote = (o = {}) => ({
  id: o.id || 'q1', import_order_id: o.import_order_id || 'o1', seller_id: o.seller_id || 's1',
  quote_amount: o.quote_amount === undefined ? 6000 : o.quote_amount,
  quote_currency: o.quote_currency === undefined ? 'USD' : o.quote_currency,
  status: o.status || 'ACCEPTED', created_at: o.created_at || today,
});

const milestone = (o = {}) => ({
  id: o.id || 'm1', import_order_id: o.import_order_id || 'o1',
  milestone_type: o.milestone_type || 'DEPOSIT',
  amount: o.amount === undefined ? 1000 : o.amount,
  currency: o.currency === undefined ? 'USD' : o.currency,
  status: o.status || 'PENDING', confirmed_at: o.confirmed_at ?? null,
  created_at: o.created_at || today,
});

const session = (o = {}) => ({
  id: o.id || 'e1', tenant_id: o.tenant_id ?? null,
  buyer_id: o.buyer_id === undefined ? 'u1' : o.buyer_id, seller_id: o.seller_id ?? null,
  status: o.status || 'eligible',
  payment_provider: o.payment_provider ?? null,
  payment_provider_mode: o.payment_provider_mode ?? null,
  payment_state: o.payment_state || 'not_started',
  created_at: o.created_at || today,
});

function createClient({ orders = [], quotes = [], milestones = [], sessions = [], failTable = null } = {}) {
  const build = (table, rows) => {
    const eqs = {};
    const ins = {};
    let orExpr = null;
    const api = {
      select() { return api },
      is() { return api },
      eq(col, val) { eqs[col] = val; return api },
      in(col, vals) { ins[col] = vals; return api },
      or(expr) { orExpr = expr; return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        let out = rows.filter((row) => Object.entries(eqs).every(([k, v]) => row[k] === v)
          && Object.entries(ins).every(([k, v]) => v.includes(row[k])));
        if (orExpr) {
          // "buyer_id.eq.X,created_by.eq.Y" — match any clause, as PostgREST does.
          const clauses = orExpr.split(',').map((c) => {
            const [col, , val] = c.split('.');
            return [col, val];
          });
          out = out.filter((row) => clauses.some(([col, val]) => String(row[col]) === val));
        }
        return Promise.resolve({ data: from === 0 ? out : [], error: null });
      },
    };
    return api;
  };
  return {
    from: (t) => build(t, {
      diaspora_import_orders: orders,
      diaspora_import_quotes: quotes,
      diaspora_payment_milestones: milestones,
      escrow_trust_sessions: sessions,
    }[t] ?? []),
  };
}

// ── Nothing here is money that moved ───────────────────────────────────────

test('a scheduled milestone is never reported as money received', () => {
  const progress = milestoneProgress([
    milestone({ id: '1', amount: 1000 }),
    milestone({ id: '2', amount: 2000 }),
  ]);
  assert.equal(progress.milestones_scheduled.value, 2);
  assert.equal(progress.milestones_confirmed.value, 0);
  assert.equal(progress.awaiting_confirmation.value, 2);
  assert.ok(/not money received/i.test(progress.note));
  // The amounts are present but explicitly SCHEDULED, never a received total.
  assert.equal(progress.scheduled_amounts.by_currency.USD.total, 3000);
  assert.equal(progress.received_amounts, undefined);
});

test('a milestone counts as confirmed only where somebody confirmed it', () => {
  const progress = milestoneProgress([
    milestone({ id: '1', status: 'CONFIRMED', confirmed_at: null }),
    milestone({ id: '2', confirmed_at: today }),
  ]);
  assert.equal(progress.milestones_confirmed.value, 1,
    'a status string is not a confirmation; only a confirmation timestamp is');
});

test('a sandbox escrow settlement is never combined with live activity', () => {
  const activity = escrowActivity([
    session({ id: '1', status: 'settled', payment_provider: 'sandbox', payment_provider_mode: 'sandbox' }),
    session({ id: '2', status: 'settled', payment_provider: 'sandbox', payment_provider_mode: 'sandbox' }),
    session({ id: '3', status: 'eligible' }),
  ]);
  assert.equal(activity.sandbox.settled.value, 2);
  assert.equal(activity.live.settled.value, 0);
  assert.equal(activity.live_market, false);
  assert.ok(/no escrow session has used a live payment provider/i.test(activity.note));
  // There is deliberately no combined settled figure to misread.
  assert.equal(activity.settled, undefined);
  assert.equal(activity.settled_value, undefined);
});

test('settled trade value, SafeTrade outcomes and shipment demand are refused with reasons', () => {
  const byKey = Object.fromEntries(NOT_MEASURABLE.map((e) => [e.key, e]));
  for (const key of ['settled_trade_value', 'safetrade_outcomes', 'shipment_demand', 'route_demand', 'landed_cost', 'trade_vehicle_linkage']) {
    assert.ok(byKey[key], `${key} must be declared unmeasurable rather than estimated`);
    assert.ok(byKey[key].reason && byKey[key].detail);
  }
  assert.equal(byKey.safetrade_outcomes.reason, 'live_payment_forbidden_by_constraint');
  assert.equal(byKey.shipment_demand.reason, 'no_shipment_records');
});

test('no projection emits a settled-value, GMV or revenue FIELD', async () => {
  const client = createClient({
    orders: [order()], quotes: [quote()], milestones: [milestone()],
    sessions: [session({ status: 'settled', payment_provider_mode: 'sandbox' })],
  });
  const result = await getTradeIntelligence(client, ADMIN);
  const keys = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['"gmv"', '"revenue"', '"settled_value"', '"trade_value"', '"total_value"']) {
    assert.ok(!keys.includes(forbidden), `no trade field may be named ${forbidden}`);
  }
  assert.equal(result.calculation_version, TRADE_INTELLIGENCE_VERSION);
  assert.ok(/no figure here represents money that moved/i.test(result.domain_boundary));
});

// ── Currencies are never summed ────────────────────────────────────────────

test('amounts in different currencies are reported separately, never added', () => {
  const grouped = amountsByCurrency([
    { amount: 100, currency: 'USD' },
    { amount: 200, currency: 'USD' },
    { amount: 5000, currency: 'ZAR' },
  ], 'amount', 'currency');
  assert.equal(grouped.by_currency.USD.total, 300);
  assert.equal(grouped.by_currency.ZAR.total, 5000);
  assert.equal(grouped.currencies, 2);
  // 5300 would be the cross-currency sum. It must exist nowhere.
  assert.ok(!JSON.stringify(grouped).includes('5300'));
  assert.ok(/no exchange rate/i.test(grouped.note));
});

test('an amount with no currency is counted as unpriced, not folded into a total', () => {
  const grouped = amountsByCurrency([
    { amount: 100, currency: 'USD' },
    { amount: 999, currency: null },
    { amount: null, currency: 'USD' },
  ], 'amount', 'currency');
  assert.equal(grouped.by_currency.USD.total, 100);
  assert.equal(grouped.unpriced_records, 2);
});

test('a zero amount is distinguishable from a missing one', () => {
  const grouped = amountsByCurrency([{ amount: 0, currency: 'USD' }], 'amount', 'currency');
  assert.equal(grouped.by_currency.USD.count, 1, 'a recorded zero is a record, not a gap');
  assert.equal(grouped.unpriced_records, 0);
});

// ── A one-corridor market reads as one corridor ────────────────────────────

test('a single corridor is described as the whole market, not as a ranking leader', () => {
  const demand = corridorDemand([order({ id: '1' }), order({ id: '2' })]);
  assert.equal(demand.distinct_corridors, 1);
  assert.equal(demand.corridors[0].corridor, 'Japan → Zimbabwe');
  assert.ok(/whole of the observed market/i.test(demand.note));
});

test('an order with no corridor is counted as unspecified, not assigned to one', () => {
  const demand = corridorDemand([order({ id: '1' }), order({ id: '2', origin_country: null })]);
  assert.equal(demand.distinct_corridors, 1);
  assert.equal(demand.unspecified_corridor, 1);
});

test('several corridors carry no whole-market claim', () => {
  const demand = corridorDemand([order({ id: '1' }), order({ id: '2', origin_country: 'UK' })]);
  assert.equal(demand.distinct_corridors, 2);
  assert.equal(demand.note, null);
});

// ── Scope is derived server-side and mirrors the authoritative list ────────

test('a participant sees their own orders even though every order has a null tenant', async () => {
  const client = createClient({
    orders: [
      order({ id: 'mine', buyer_id: 'u1', created_by: 'u1', tenant_id: null }),
      order({ id: 'theirs', buyer_id: 'u2', created_by: 'u2', tenant_id: null }),
    ],
  });
  const result = await getTradeIntelligence(client, BUYER);
  assert.equal(result.order_funnel.orders_created.value, 1,
    'a tenant-only filter would have reported zero orders to a buyer whose own orders exist');
  assert.equal(result.scope, 'participant');
});

test('a participant never sees another participant orders', async () => {
  const client = createClient({
    orders: [order({ id: 'theirs', buyer_id: 'u2', created_by: 'u2' })],
  });
  const result = await getTradeIntelligence(client, BUYER);
  assert.equal(result.order_funnel.orders_created.value, 0);
});

test('quotes and milestones follow the order scope, never widening it', async () => {
  const client = createClient({
    orders: [order({ id: 'mine', buyer_id: 'u1' })],
    quotes: [quote({ id: 'q-mine', import_order_id: 'mine' }), quote({ id: 'q-theirs', import_order_id: 'theirs' })],
    milestones: [milestone({ id: 'm-mine', import_order_id: 'mine' }), milestone({ id: 'm-theirs', import_order_id: 'theirs' })],
  });
  const result = await getTradeIntelligence(client, BUYER);
  assert.equal(result.quote_activity.quotes_issued.value, 1);
  assert.equal(result.payment_milestones.milestones_scheduled.value, 1);
});

test('a participant with no orders reads no quotes at all', async () => {
  const client = createClient({
    orders: [order({ id: 'theirs', buyer_id: 'u2', created_by: 'u2' })],
    quotes: [quote({ id: 'q1', import_order_id: 'theirs' })],
  });
  const result = await getTradeIntelligence(client, BUYER);
  assert.equal(result.quote_activity.quotes_issued.value, 0,
    'an empty scope must not degrade into matching everything');
});

test('an unauthenticated caller is refused', () => {
  assert.throws(() => resolveTradeScope({ role: 'owner' }), AuthorizationError);
  assert.throws(() => resolveTradeScope(null), AuthorizationError);
});

test('a platform administrator sees the platform, and government is not one', async () => {
  const client = createClient({ orders: [order({ id: '1', buyer_id: 'u1' }), order({ id: '2', buyer_id: 'u2' })] });
  const platform = await getTradeIntelligence(client, ADMIN);
  assert.equal(platform.order_funnel.orders_created.value, 2);

  // A government session is not a platform scope; it falls through to its own
  // participant scope and sees only what it created.
  const gov = await getTradeIntelligence(client, { id: 'g1', role: 'government' });
  assert.equal(gov.scope, 'participant');
  assert.equal(gov.order_funnel.orders_created.value, 0);
});

test('the trade route does not admit government, and takes no caller scope', () => {
  const routes = codeOnly(read('backend/routes/intelligenceProjectionRoutes.js'));
  const block = routes.split("'/api/trade/intelligence'")[1].split('router.get')[0];
  assert.match(block, /authorizeRole\(\['owner', 'dealer', 'admin'\]\)/);
  assert.ok(!block.includes("'government'"), 'gap G5 must not be repeated on a trade surface');
  assert.ok(block.includes('req.userContext'));
  assert.ok(!/req\.(query|params|body)\.(tenant_id|buyer_id|seller_id)/.test(routes));
});

// ── A failed read is never a zero ──────────────────────────────────────────

test('a failed order read reports unavailable and publishes no counts', async () => {
  const result = await getTradeIntelligence(createClient({ failTable: 'diaspora_import_orders' }), ADMIN);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.order_funnel, undefined);
  assert.equal(result.corridor_demand, undefined);
  assert.ok(/NOT zero/i.test(result.message));
});

// ── The existing trade graph service is not restated ───────────────────────

test('this projection defers to the trade graph service rather than restating it', async () => {
  const client = createClient({ orders: [order()] });
  const result = await getTradeIntelligence(client, ADMIN);
  assert.ok(/trade graph/i.test(result.related_authority));
  // Container matching and graph demand signals belong to that service.
  const keys = JSON.stringify(result).toLowerCase();
  assert.ok(!keys.includes('container_opportunit'));
  assert.ok(!keys.includes('demand_signals'));
});

test('the funnel reports the statuses present rather than a fixed stage list', () => {
  const funnel = orderFunnel([
    order({ id: '1', status: 'IMPORT_REQUESTED' }),
    order({ id: '2', status: 'SELLER_ASSIGNED' }),
    order({ id: '3', status: 'CANCELLED' }),
  ]);
  assert.equal(funnel.orders_created.value, 3);
  assert.equal(funnel.cancelled.value, 1);
  assert.equal(funnel.by_status.IMPORT_REQUESTED, 1);
  assert.equal(funnel.by_status.SELLER_ASSIGNED, 1);
  // No stage is invented with a zero just to complete a funnel picture.
  assert.equal(funnel.by_status.SHIPPED, undefined);
  assert.equal(funnel.by_status.DELIVERED, undefined);
});
