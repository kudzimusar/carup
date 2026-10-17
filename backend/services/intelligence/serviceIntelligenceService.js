/**
 * CarUp Intelligence 1.0 — I9 mechanic and garage intelligence.
 *
 * Implements the model frozen in
 * docs/intelligence/receipts/I9_MECHANIC_GARAGE_PROJECTION_MODEL.md:
 *
 *   mechanic = person / practitioner scope   (mechanic_id)
 *   garage   = tenant / organization scope   (tenant_id / organization_id)
 *
 * One work-order row legitimately belongs to both — it is genuinely one
 * practitioner's work AND one organization's work — but the two projections must
 * never impersonate each other. So:
 *
 *   - the mechanic projection NEVER widens to the tenant. A work order with no
 *     `mechanic_id` is excluded, not credited to whoever happens to be looking.
 *   - the garage projection NEVER narrows to the caller. It is the whole tenant's
 *     work or it is refused, and it is refused when no verified tenant exists
 *     rather than quietly falling back to the individual.
 *
 * Everything the schema cannot support is returned as an explicit not-measurable
 * entry with its reason. None of it is estimated. Service Network (S2/S4/S5) made
 * bookings, booking conversion, branch performance, turnaround, cancellations and
 * service-category demand genuinely measurable; capacity and team performance
 * remain unsupported. See NOT_MEASURABLE and buildServiceNetworkMetrics.
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

// service@2: Service Network reconciliation (O3). Six capabilities moved from not-measurable to
// measured from governed case columns. The version is bumped because the calculation changed —
// a stored 'service@1' figure is not comparable with one produced here.
export const SERVICE_INTELLIGENCE_VERSION = 'service@2';

/** Inquiry types that are a request for service work. */
const SERVICE_INQUIRY_TYPES = new Set(['garage_service_request', 'mechanic_service_request']);

/**
 * Capabilities the canonical plan names for garages that CarUp genuinely cannot
 * measure. Returned to the surface so the absence is stated with its reason,
 * rather than omitted (which invites someone to fill it back in) or estimated.
 *
 * SERVICE NETWORK RECONCILIATION (O3). Six entries were removed from this list
 * because the absences they asserted stopped being true. Service Network S2/S4/S5
 * introduced a governed case lifecycle (`service_cases`) with `requested_at`,
 * `accepted_at`, `started_at`, `completed_at`, `cancelled_at`, a
 * tenant-constrained `branch_id`, and a CONTROLLED `service_category` column on
 * cases, work orders and service records.
 *
 * Continuing to publish "no booking model" or "no completion timestamp" would be
 * a false statement about CarUp's own schema, and understating what is known is
 * the same class of error as overstating it. The six are now computed from those
 * governed columns — see `buildServiceNetworkMetrics` — and nothing is inferred
 * from free text.
 *
 * The two that remain are still genuinely unsupported.
 */
export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'capacity_utilisation',
    label: 'Capacity utilisation',
    reason: 'no_capacity_model',
    detail: 'CarUp records no service bays, slots, shifts or opening hours, so there is no capacity to measure against. Service Network added a case lifecycle, not a scheduling model.',
  },
  {
    key: 'team_performance',
    label: 'Team performance',
    reason: 'no_staffing_data',
    detail: 'Service Network records WHO a work order was assigned to (work_order_assignments), but a garage still has no roster, headcount, role or working-hours record, so assignment counts are not performance. Publishing per-person output as a performance measure is a staffing judgement CarUp has no mandate or source for.',
  },
]);

const COMPLETED_STATUSES = new Set(['completed', 'complete', 'closed', 'done']);

function isCompleted(order) {
  return COMPLETED_STATUSES.has(String(order?.status || '').toLowerCase());
}

function withinWindow(row, startIso, endIso) {
  const at = row?.created_at;
  if (!at) return false;
  return at >= startIso && at < endIso;
}

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end, dates };
}

function unavailableEnvelope(reason) {
  return {
    availability: AVAILABILITY.UNAVAILABLE,
    reason,
    calculation_version: SERVICE_INTELLIGENCE_VERSION,
    message: 'Service intelligence could not be read. These figures are NOT zero.',
    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
  };
}

// ── Shared computation over a set of work orders ────────────────────────────

/**
 * Demand by make and model, from the VIN on each work order.
 *
 * Vehicle identity comes from the canonical `vehicles` row, never from anything
 * the work order asserts about the car. A VIN CarUp does not know is counted as
 * unidentified rather than guessed at.
 */
export function demandByVehicle(orders, vehicleByVin) {
  const counts = new Map();
  let unidentified = 0;
  for (const order of orders) {
    const vehicle = order?.vin ? vehicleByVin.get(order.vin) : null;
    if (!vehicle || !vehicle.make) { unidentified += 1; continue; }
    const key = `${vehicle.make}${vehicle.model ? ` ${vehicle.model}` : ''}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));
  return { top, unidentified };
}

/** Customers with more than one work order in the window. */
export function repeatCustomers(orders) {
  const perCustomer = new Map();
  for (const order of orders) {
    const id = order?.customer_id;
    if (!id) continue;
    perCustomer.set(id, (perCustomer.get(id) || 0) + 1);
  }
  const identified = perCustomer.size;
  const repeat = [...perCustomer.values()].filter((n) => n > 1).length;
  return { identified, repeat };
}

function buildWorkMetrics(orders) {
  const completed = orders.filter(isCompleted);
  return {
    work_orders: metric(orders.length),
    completed_work_orders: metric(completed.length),
    open_work_orders: metric(orders.length - completed.length),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

async function readWorkOrders(client, { mechanicId = null, tenantId = null }) {
  return readAllPages(() => {
    let query = client
      .from('mechanic_work_orders')
      .select('id, vin, status, created_at, customer_id, mechanic_id, tenant_id, organization_id');
    if (mechanicId) query = query.eq('mechanic_id', mechanicId);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    return query;
  });
}

/**
 * Governed Service Network cases for ONE garage tenant.
 *
 * Garage scope is tenant-wide by definition, so this is filtered by
 * `garage_tenant_id` and never by the calling user. It is deliberately not read
 * for the mechanic projection: a case belongs to the organization, and widening
 * a practitioner's view to the tenant is exactly the impersonation this module
 * exists to prevent.
 */
async function readServiceCases(client, { tenantId }) {
  return readAllPages(() => client
    .from('service_cases')
    .select('id, status, service_category, branch_id, requested_at, accepted_at, declined_at, started_at, completed_at, cancelled_at, created_at, garage_tenant_id')
    .eq('garage_tenant_id', tenantId));
}

const CASE_CLOSED_NEGATIVE = new Set(['cancelled', 'declined']);

/** Elapsed hours between two stamps, or null when either is missing. */
function elapsedHours(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return (to - from) / (1000 * 60 * 60);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The six metrics Service Network made measurable, computed ONLY from governed
 * columns. Every one of them reports absence honestly:
 *
 *   - a case with no `service_category` is counted as `unspecified`, never
 *     classified from its free-text summary;
 *   - a case with no `branch_id` is `unattributed`, never assigned to the
 *     tenant's only branch as a convenience;
 *   - turnaround uses cases that carry BOTH `started_at` and `completed_at`, and
 *     says how many cases it could not measure.
 */
export function buildServiceNetworkMetrics(cases) {
  const requested = cases.length;
  const accepted = cases.filter((c) => c.accepted_at || String(c.status) === 'accepted'
    || ['active', 'completed'].includes(String(c.status))).length;
  const negative = cases.filter((c) => CASE_CLOSED_NEGATIVE.has(String(c.status))).length;

  const turnarounds = cases
    .map((c) => elapsedHours(c.started_at, c.completed_at))
    .filter((hours) => hours !== null);

  const categories = new Map();
  let unspecifiedCategory = 0;
  for (const serviceCase of cases) {
    const category = serviceCase.service_category;
    if (!category) { unspecifiedCategory += 1; continue; }
    categories.set(category, (categories.get(category) || 0) + 1);
  }

  const branches = new Map();
  let unattributedBranch = 0;
  for (const serviceCase of cases) {
    const branch = serviceCase.branch_id;
    if (!branch) { unattributedBranch += 1; continue; }
    branches.set(branch, (branches.get(branch) || 0) + 1);
  }

  return {
    metrics: {
      service_requests: metric(requested),
      accepted_requests: metric(accepted),
      declined_or_cancelled: metric(negative),
    },
    // A booking in CarUp is an ACCEPTED service case: the garage has taken the
    // work on. The denominator is every request the garage received.
    booking_conversion: rate(accepted, requested, { min: 5 }),
    cancellation_rate: rate(negative, requested, { min: 5 }),
    turnaround_hours: turnarounds.length
      ? {
        availability: AVAILABILITY.VALUE,
        unit: 'hours',
        median: median(turnarounds),
        measured_cases: turnarounds.length,
        unmeasured_cases: requested - turnarounds.length,
      }
      : {
        availability: AVAILABILITY.INSUFFICIENT_DATA,
        reason: 'no_case_carries_both_started_and_completed',
        unit: 'hours',
        median: null,
        measured_cases: 0,
        unmeasured_cases: requested,
      },
    service_category_demand: {
      top: [...categories.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([label, count]) => ({ label, count })),
      // Stated, never classified from `request_summary`.
      unspecified: unspecifiedCategory,
    },
    branch_performance: {
      by_branch: [...branches.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .map(([branch_id, cases_count]) => ({ branch_id, cases: cases_count })),
      unattributed: unattributedBranch,
    },
  };
}

async function readServiceInquiries(client, { sellerId = null, tenantId = null }) {
  return readAllPages(() => {
    let query = client
      .from('marketplace_inquiries')
      .select('id, inquiry_type, status, seller_id, seller_tenant_id, created_at');
    if (sellerId) query = query.eq('seller_id', sellerId);
    if (tenantId) query = query.eq('seller_tenant_id', tenantId);
    return query;
  });
}

async function readVehiclesFor(client, vins) {
  const map = new Map();
  const unique = [...new Set(vins.filter(Boolean))];
  if (!unique.length) return map;
  try {
    const { data, error } = await client
      .from('vehicles')
      .select('vin, make, model')
      .in('vin', unique);
    if (error) return map;
    for (const row of Array.isArray(data) ? data : []) map.set(row.vin, row);
  } catch { /* an identity lookup failure degrades demand, never the counts */ }
  return map;
}

/**
 * Service records logged by a practitioner.
 *
 * PartSentry is an append-only ledger keyed on `mechanic_id`, so it is a person
 * signal by construction — it is deliberately NOT re-scoped to a tenant, because
 * the ledger records who did the work.
 */
async function readServiceRecords(client, mechanicId) {
  if (!mechanicId) return [];
  return readAllPages(() => client
    .from('partsentry_logs')
    .select('id, mechanic_id, created_at')
    .eq('mechanic_id', mechanicId));
}

// ── Mechanic projection (person scope) ──────────────────────────────────────

export async function getMechanicIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  const mechanicId = actor?.id ? String(actor.id) : null;
  if (!mechanicId) throw new AuthorizationError('Authentication required.');
  const { start, end } = windowBounds(windowDays);

  let orders;
  let inquiries;
  let records;
  try {
    [orders, inquiries, records] = await Promise.all([
      readWorkOrders(client, { mechanicId }),
      readServiceInquiries(client, { sellerId: mechanicId }),
      readServiceRecords(client, mechanicId),
    ]);
  } catch (error) {
    return { window_days: windowDays, ...unavailableEnvelope(String(error?.message || 'service_read_failed')) };
  }

  // The person scope never widens: an order with no mechanic_id is not this
  // practitioner's work, and the query above already refuses to match it.
  const windowOrders = orders.filter((order) => withinWindow(order, start, end));
  const windowInquiries = inquiries.filter((row) => (
    withinWindow(row, start, end)
    && SERVICE_INQUIRY_TYPES.has(String(row.inquiry_type))
    && !['spam', 'rejected'].includes(String(row.status || ''))
  ));
  const windowRecords = records.filter((row) => withinWindow(row, start, end));

  const vehicleByVin = await readVehiclesFor(client, windowOrders.map((o) => o.vin));
  const repeat = repeatCustomers(windowOrders);

  return {
    scope: 'mechanic',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: SERVICE_INTELLIGENCE_VERSION,
    metrics: {
      ...buildWorkMetrics(windowOrders),
      service_records_logged: metric(windowRecords.length),
      enquiries: metric(windowInquiries.length),
      repeat_customers: metric(repeat.repeat),
      identified_customers: metric(repeat.identified),
    },
    conversion: {
      // Completion is a state we hold, so this rate is honest. Turnaround is not.
      completion_rate: rate(
        windowOrders.filter(isCompleted).length,
        windowOrders.length,
        { min: 5 },
      ),
    },
    demand_by_vehicle: demandByVehicle(windowOrders, vehicleByVin),
    not_measurable: NOT_MEASURABLE
      // A practitioner is not asked about branch or team performance.
      .filter((entry) => !['branch_performance', 'team_performance'].includes(entry.key))
      .map((entry) => ({ ...entry })),
  };
}

// ── Garage projection (tenant / organization scope) ─────────────────────────

export async function getGarageIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  // The garage scope never narrows to the caller. No verified tenant means the
  // question cannot be answered for an organization at all — it is refused rather
  // than silently answered with the individual's own work.
  const tenantId = actor?.tenantId ? String(actor.tenantId) : null;
  if (!tenantId) {
    throw new AuthorizationError('A verified organization context is required for garage intelligence.');
  }
  const { start, end } = windowBounds(windowDays);

  let orders;
  let inquiries;
  try {
    [orders, inquiries] = await Promise.all([
      readWorkOrders(client, { tenantId }),
      readServiceInquiries(client, { tenantId }),
    ]);
  } catch (error) {
    return { window_days: windowDays, ...unavailableEnvelope(String(error?.message || 'service_read_failed')) };
  }

  const windowOrders = orders.filter((order) => withinWindow(order, start, end));
  const windowInquiries = inquiries.filter((row) => (
    withinWindow(row, start, end)
    && SERVICE_INQUIRY_TYPES.has(String(row.inquiry_type))
    && !['spam', 'rejected'].includes(String(row.status || ''))
  ));
  const vehicleByVin = await readVehiclesFor(client, windowOrders.map((o) => o.vin));
  const repeat = repeatCustomers(windowOrders);
  const practitioners = new Set(windowOrders.map((o) => o.mechanic_id).filter(Boolean));

  // Governed Service Network facts (O3). Read separately and degraded separately: if the case
  // ledger cannot be read, the work-order metrics above are still true and are still reported,
  // while the case-derived block says UNAVAILABLE. It must never report zero requests for a garage
  // whose cases simply could not be loaded.
  let serviceNetwork;
  try {
    const cases = await readServiceCases(client, { tenantId });
    const windowCases = cases.filter((row) => {
      const at = row.requested_at || row.created_at;
      return at && at >= start && at < end;
    });
    serviceNetwork = { availability: AVAILABILITY.VALUE, ...buildServiceNetworkMetrics(windowCases) };
  } catch (error) {
    serviceNetwork = {
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'service_case_read_failed'),
      message: 'Service Network case figures could not be read. These are NOT zero.',
    };
  }

  return {
    scope: 'garage',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: SERVICE_INTELLIGENCE_VERSION,
    metrics: {
      ...buildWorkMetrics(windowOrders),
      enquiries: metric(windowInquiries.length),
      repeat_customers: metric(repeat.repeat),
      identified_customers: metric(repeat.identified),
      // Counted, not named: which practitioners worked is the organization's own
      // data, but publishing per-person performance is a staffing judgement CarUp
      // has no mandate or source for (see team_performance below).
      practitioners_contributing: metric(practitioners.size),
    },
    conversion: {
      completion_rate: rate(
        windowOrders.filter(isCompleted).length,
        windowOrders.length,
        { min: 5 },
      ),
    },
    demand_by_vehicle: demandByVehicle(windowOrders, vehicleByVin),
    // Service Network's governed case ledger. Tenant-wide, like everything else in this scope.
    service_network: serviceNetwork,
    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
  };
}
