/**
 * CarUp Intelligence 1.0 — I13 diaspora / trade intelligence.
 *
 * RELATIONSHIP TO THE EXISTING TRADE GRAPH SERVICE. `DiasporaTradeIntelligenceService`
 * (Phase 10, services/diaspora/tradegraph/) already computes demand signals,
 * container opportunities and risk exposure — from the DERIVED graph
 * (`trade_graph_nodes` / `trade_graph_edges`), behind the `DIASPORA_TRADE_GRAPH`
 * flag, which is off by default. On staging that graph holds zero nodes and zero
 * edges, so it currently answers nothing.
 *
 * This module deliberately does NOT reimplement it. It reads the AUTHORITATIVE
 * tables — import orders, quotes, payment milestones, escrow sessions — which the
 * graph service does not read. Where the graph is enabled and populated it remains
 * the authority for graph-derived matching; nothing here writes to it or restates
 * its aggregates.
 *
 * WHAT THE LIVE DATA SUPPORTS. Read from staging before any of this was written:
 *
 *   - 91 import orders, every one of them Japan → Zimbabwe. Corridor demand is
 *     real, but it is ONE corridor. A "top corridors" ranking would imply a market
 *     of many, so the shape of the market is reported instead;
 *   - 26 quotes, all ACCEPTED, all with a seller;
 *   - 107 payment milestones — all of type DEPOSIT, all PENDING, and NOT ONE
 *     confirmed. No payment has ever been confirmed through CarUp;
 *   - every escrow session that reached a payment state has `payment_provider =
 *     'sandbox'`. There are zero live settlements;
 *   - `diaspora_safetrade_transactions` carries a database CHECK constraint
 *     `live_payment = false`, so a live SafeTrade payment cannot be recorded at
 *     all, and every SafeTrade table is empty;
 *   - every shipment, container, stage-event and cargo-reservation table is empty,
 *     and there is no carrier integration.
 *
 * So the two things a reader most wants — settled trade value and shipment/route
 * demand — are exactly the two CarUp cannot state. Neither is estimated.
 *
 * MONEY IS NEVER SUMMED ACROSS CURRENCIES. CarUp holds no FX rate authority, so
 * amounts are reported per currency. Today every row is USD, which is precisely
 * when such a guard is easiest to omit and most likely to break silently later.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import {
  AVAILABILITY,
  metric,
  rate,
  AuthorizationError,
  windowDates,
} from './intelligenceProjectionService.js';

export const TRADE_INTELLIGENCE_VERSION = 'trade_demand@1';

const PLATFORM_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

/** Order statuses that mean the request was withdrawn rather than worked. */
const CANCELLED_STATUSES = new Set(['CANCELLED', 'REJECTED', 'EXPIRED']);

/** A quote state that represents a buyer decision rather than an offer. */
const ACCEPTED_QUOTE_STATUSES = new Set(['ACCEPTED']);

export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'settled_trade_value',
    label: 'Settled trade value',
    reason: 'no_confirmed_payment',
    detail: 'No payment milestone has ever been confirmed, and every escrow session that reached a payment state used the sandbox provider. Summing scheduled milestones or sandbox settlements would report simulated money as trade.',
  },
  {
    key: 'safetrade_outcomes',
    label: 'SafeTrade outcomes',
    reason: 'live_payment_forbidden_by_constraint',
    detail: 'The SafeTrade transactions table carries a database constraint forcing live_payment to false, so a live payment cannot be recorded at all, and every SafeTrade table is empty. There is no completion, dispute or release to report.',
  },
  {
    key: 'shipment_demand',
    label: 'Shipment and container demand',
    reason: 'no_shipment_records',
    detail: 'Every shipment, container, stage-event and cargo-reservation table is empty. Shipment records are fed by workbook import only and no carrier integration exists, so no shipment has been observed.',
  },
  {
    key: 'route_demand',
    label: 'Route demand',
    reason: 'no_shipment_records',
    detail: 'A route is a property of a shipment, and no shipment exists. The corridor an order names is a request, not a route anything travelled.',
  },
  {
    key: 'landed_cost',
    label: 'Landed cost',
    reason: 'no_structured_cost_breakdown',
    detail: 'A quote records a single amount with free-form inclusions and exclusions. There is no structured duty, freight, handling or tax breakdown to build a landed cost from, and no landed-cost calculation is stored against any order.',
  },
  {
    key: 'trade_vehicle_linkage',
    label: 'Link to a CarUp vehicle',
    reason: 'no_order_carries_a_vin',
    detail: 'No import order records a VIN or a linked vehicle, so an order cannot be joined to a vehicle, its Trust position or its listing.',
  },
  {
    key: 'counterparty_reputation',
    label: 'Counterparty reputation',
    reason: 'no_reputation_records',
    detail: 'The reputation table is empty. A seller with no record is unrated, not poorly rated.',
  },
  {
    key: 'compliance_outcomes',
    label: 'Compliance outcomes',
    reason: 'no_compliance_reviews',
    detail: 'No compliance review has been recorded, so no order can be reported as cleared or blocked on compliance grounds.',
  },
]);

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

function withinWindow(row, start, end) {
  return Boolean(row?.created_at) && row.created_at >= start && row.created_at < end;
}

/**
 * A recorded number, or null. `Number(null)` is 0, so the naive finite check
 * reports a missing amount as a real zero.
 */
function recorded(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Amounts grouped by their own currency, never added together.
 *
 * CarUp holds no FX authority. A single total across currencies would be a
 * conversion nobody performed, so each currency is reported separately and the
 * count of currencies is stated.
 */
export function amountsByCurrency(rows, amountField, currencyField) {
  const buckets = {};
  let unpriced = 0;
  for (const row of rows) {
    const amount = recorded(row[amountField]);
    const currency = row[currencyField];
    if (amount === null || !currency) { unpriced += 1; continue }
    const key = String(currency).toUpperCase();
    buckets[key] = buckets[key] || { total: 0, count: 0 };
    buckets[key].total += amount;
    buckets[key].count += 1;
  }
  return {
    by_currency: buckets,
    currencies: Object.keys(buckets).length,
    unpriced_records: unpriced,
    note: 'Amounts are grouped by their own currency and never combined. CarUp applies no exchange rate.',
  };
}

/**
 * The corridors actually recorded.
 *
 * Returned as a list with the total, so a single-corridor market reads as one
 * corridor rather than as the leader of a ranking.
 */
export function corridorDemand(orders) {
  const counts = {};
  let unspecified = 0;
  for (const order of orders) {
    const origin = order.origin_country;
    const destination = order.destination_country;
    if (!origin || !destination) { unspecified += 1; continue }
    const key = `${origin} → ${destination}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const corridors = Object.entries(counts)
    .map(([corridor, orderCount]) => ({ corridor, orders: orderCount }))
    .sort((a, b) => b.orders - a.orders);
  return {
    corridors,
    distinct_corridors: corridors.length,
    unspecified_corridor: unspecified,
    note: corridors.length === 1
      ? 'Every recorded order uses a single corridor. This is the whole of the observed market, not the top of a ranking.'
      : null,
  };
}

/** The order funnel, by the statuses actually present. */
export function orderFunnel(orders) {
  const byStatus = {};
  for (const order of orders) {
    const status = String(order.status || 'UNKNOWN');
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const cancelled = orders.filter((o) => CANCELLED_STATUSES.has(String(o.status)));
  const byType = {};
  for (const order of orders) {
    const type = String(order.order_type || 'unspecified');
    byType[type] = (byType[type] || 0) + 1;
  }
  return {
    orders_created: metric(orders.length),
    cancelled: metric(cancelled.length),
    by_status: byStatus,
    by_order_type: byType,
  };
}

/**
 * Payment milestone progress.
 *
 * A milestone is confirmed only where somebody actually confirmed it. A scheduled
 * deposit is an intention to pay, and treating it as money received is the trade
 * equivalent of counting a loan application as a disbursement.
 */
export function milestoneProgress(milestones) {
  const confirmed = milestones.filter((row) => row.confirmed_at);
  return {
    milestones_scheduled: metric(milestones.length),
    milestones_confirmed: metric(confirmed.length),
    awaiting_confirmation: metric(milestones.length - confirmed.length),
    confirmation_rate: rate(confirmed.length, milestones.length, { min: 10 }),
    scheduled_amounts: amountsByCurrency(milestones, 'amount', 'currency'),
    note: confirmed.length === 0 && milestones.length > 0
      ? 'No milestone has been confirmed. The scheduled amounts below are what was agreed, not money received.'
      : null,
  };
}

/**
 * Escrow activity, split by provider mode and never combined.
 *
 * A sandbox settlement is a real record of a simulation. On staging every session
 * that reached a payment state is sandbox, so a combined "settled" figure would
 * describe an empty live market as an active one.
 */
export function escrowActivity(sessions) {
  const live = sessions.filter((row) => String(row.payment_provider_mode) === 'live');
  const sandbox = sessions.filter((row) => String(row.payment_provider_mode) === 'sandbox');
  const noPayment = sessions.filter((row) => !row.payment_provider_mode);

  const settled = (rows) => rows.filter((row) => String(row.status) === 'settled').length;

  return {
    sessions_opened: metric(sessions.length),
    live: {
      sessions: metric(live.length),
      settled: metric(settled(live)),
    },
    sandbox: {
      sessions: metric(sandbox.length),
      settled: metric(settled(sandbox)),
      note: 'Simulated escrow against a sandbox provider. These are never combined with live activity and are not trade value.',
    },
    no_payment_started: metric(noPayment.length),
    live_market: live.length > 0,
    note: live.length === 0
      ? 'No escrow session has used a live payment provider, so no settlement here represents money that moved.'
      : null,
  };
}

/**
 * Scope, derived server-side and mirroring the authoritative order list.
 *
 * `listImportOrders` narrows by `tenant_id` when the session carries one, and
 * otherwise by `buyer_id` OR `created_by`. Every order on staging has a NULL
 * `tenant_id`, so a tenant-only filter would report zero orders to a participant
 * whose own orders the list page shows — the same trap I11 hit on finance.
 *
 * The existing list also admits `government` to the whole table. That is NOT
 * carried over: an institutional role does not receive platform-wide commercial
 * trade intelligence (gap G5).
 */
export function resolveTradeScope(actor) {
  const actorId = actor?.id ? String(actor.id) : null;
  if (!actorId) throw new AuthorizationError('Authentication required.');
  const role = String(actor?.platformRole || actor?.role || '');
  if (PLATFORM_ROLES.has(role)) return { platformScope: true, actorId, tenantId: null };
  return {
    platformScope: false,
    actorId,
    tenantId: actor?.tenantId ? String(actor.tenantId) : null,
  };
}

async function readOrders(client, scope) {
  return readAllPages(() => {
    let query = client
      .from('diaspora_import_orders')
      .select('id, tenant_id, buyer_id, created_by, order_type, origin_country, destination_country, budget_amount, budget_currency, status, vin, linked_vehicle_vin, created_at')
      .is('deleted_at', null);
    if (scope.platformScope) return query;
    if (scope.tenantId) return query.eq('tenant_id', scope.tenantId);
    return query.or(`buyer_id.eq.${scope.actorId},created_by.eq.${scope.actorId}`);
  });
}

export async function getTradeIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  const scope = resolveTradeScope(actor);
  const { start, end } = windowBounds(windowDays);

  let orders;
  let quotes;
  let milestones;
  let sessions;
  try {
    orders = await readOrders(client, scope);
    const orderIds = orders.map((row) => row.id).filter(Boolean);

    // Quotes and milestones hang off orders, so the order scope carries through.
    // With no orders in scope there is nothing to look up, and asking for an
    // empty `in` list would match everything on some clients.
    quotes = orderIds.length === 0 ? [] : await readAllPages(() => client
      .from('diaspora_import_quotes')
      .select('id, import_order_id, seller_id, quote_amount, quote_currency, status, created_at')
      .is('deleted_at', null)
      .in('import_order_id', orderIds));
    milestones = orderIds.length === 0 ? [] : await readAllPages(() => client
      .from('diaspora_payment_milestones')
      .select('id, import_order_id, milestone_type, amount, currency, status, confirmed_at, created_at')
      .is('deleted_at', null)
      .in('import_order_id', orderIds));

    sessions = await readAllPages(() => {
      const query = client
        .from('escrow_trust_sessions')
        .select('id, tenant_id, buyer_id, seller_id, status, payment_provider, payment_provider_mode, payment_state, created_at');
      if (scope.platformScope) return query;
      if (scope.tenantId) return query.eq('tenant_id', scope.tenantId);
      return query.or(`buyer_id.eq.${scope.actorId},seller_id.eq.${scope.actorId}`);
    });
  } catch (error) {
    return {
      scope: scope.platformScope ? 'platform' : 'participant',
      window_days: windowDays,
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'trade_read_failed'),
      calculation_version: TRADE_INTELLIGENCE_VERSION,
      message: 'Trade intelligence could not be read. These figures are NOT zero.',
      not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
    };
  }

  const windowOrders = orders.filter((row) => withinWindow(row, start, end));
  const windowQuotes = quotes.filter((row) => withinWindow(row, start, end));
  const windowMilestones = milestones.filter((row) => withinWindow(row, start, end));
  const windowSessions = sessions.filter((row) => withinWindow(row, start, end));

  const quotedOrderIds = new Set(windowQuotes.map((row) => row.import_order_id));
  const acceptedQuotes = windowQuotes.filter((row) => ACCEPTED_QUOTE_STATUSES.has(String(row.status)));

  return {
    scope: scope.platformScope ? 'platform' : 'participant',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: TRADE_INTELLIGENCE_VERSION,

    corridor_demand: corridorDemand(windowOrders),
    order_funnel: orderFunnel(windowOrders),

    quote_activity: {
      quotes_issued: metric(windowQuotes.length),
      quotes_accepted: metric(acceptedQuotes.length),
      orders_with_a_quote: metric(quotedOrderIds.size),
      orders_awaiting_a_quote: metric(windowOrders.length - quotedOrderIds.size),
      acceptance_rate: rate(acceptedQuotes.length, windowQuotes.length, { min: 10 }),
      quoted_amounts: amountsByCurrency(windowQuotes, 'quote_amount', 'quote_currency'),
    },

    /** What buyers asked to spend. Explicitly a request, not a transaction. */
    requested_budgets: amountsByCurrency(windowOrders, 'budget_amount', 'budget_currency'),

    payment_milestones: milestoneProgress(windowMilestones),
    escrow: escrowActivity(windowSessions),

    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),

    domain_boundary: 'Trade demand and its funnel only. No figure here represents money that moved: no payment milestone has been confirmed and no escrow session has used a live provider.',

    related_authority: 'Graph-derived demand matching and container opportunities are served by the Trade Graph intelligence service, which reads the derived graph rather than these tables.',
  };
}
