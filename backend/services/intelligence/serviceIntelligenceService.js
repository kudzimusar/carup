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
 * Everything the schema cannot support — bookings, capacity, staffing, branch
 * performance, turnaround, cancellations, service-category demand — is returned
 * as an explicit not-measurable entry with its reason. None of it is estimated.
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

export const SERVICE_INTELLIGENCE_VERSION = 'service@1';

/** Inquiry types that are a request for service work. */
const SERVICE_INQUIRY_TYPES = new Set(['garage_service_request', 'mechanic_service_request']);

/**
 * Capabilities the canonical plan names for garages that CarUp genuinely cannot
 * measure. Returned to the surface so the absence is stated with its reason,
 * rather than omitted (which invites someone to fill it back in) or estimated.
 */
export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'bookings',
    label: 'Bookings',
    reason: 'no_booking_model',
    detail: 'CarUp has no booking, appointment or scheduling record. A work order is created after the work is taken on, so there is no booking preceding it to count.',
  },
  {
    key: 'booking_conversion',
    label: 'Enquiry → booking conversion',
    reason: 'no_booking_model',
    detail: 'Without a booking record there is no numerator for this rate.',
  },
  {
    key: 'capacity_utilisation',
    label: 'Capacity utilisation',
    reason: 'no_capacity_model',
    detail: 'CarUp records no service bays, slots, shifts or opening hours, so there is no capacity to measure against.',
  },
  {
    key: 'team_performance',
    label: 'Team performance',
    reason: 'no_staffing_data',
    detail: 'Branch records carry a name, location and phone only — no staff, headcount or assignment.',
  },
  {
    key: 'branch_performance',
    label: 'Branch performance',
    reason: 'work_not_attributed_to_branch',
    detail: 'Work orders carry no branch reference, so work cannot be attributed to a branch.',
  },
  {
    key: 'turnaround_time',
    label: 'Turnaround time',
    reason: 'no_completion_timestamp',
    detail: 'A work order records when it was created but not when it was completed, so elapsed time cannot be computed.',
  },
  {
    key: 'cancellation_rate',
    label: 'Cancellations',
    reason: 'no_cancellation_state',
    detail: 'No cancellation state or reason is recorded on a work order.',
  },
  {
    key: 'service_category_demand',
    label: 'Demand by service type',
    reason: 'no_service_type_field',
    detail: 'Work orders describe the issue in free text with no service category, and classifying free text into categories would be inference presented as measurement.',
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
    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
  };
}
