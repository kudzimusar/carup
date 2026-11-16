/**
 * Service Network S7 — measurable metric catalogue and I9 reconciliation.
 *
 * Intelligence OBSERVES; it never becomes business truth (Invariant 7). This module
 * therefore computes no metrics and serves no analytics. It is the governed answer to a
 * narrower and more important question:
 *
 *     which service metrics are ANSWERABLE, and from which authoritative sources?
 *
 * Plan §19.3 sets the bar exactly: a metric may move from "not measurable" to
 * "measurable" only when its NUMERATOR, DENOMINATOR, TIMESTAMP and SCOPE all have
 * governed sources. Each entry below states those sources, so the claim is checkable
 * rather than asserted — and `evaluateMeasurability()` re-checks it against the live
 * schema instead of trusting this file.
 *
 * Scope discipline (Invariant 3): a garage is a tenant and a mechanic is a person.
 * A mechanic-scoped metric must never widen to its tenant, and a garage-scoped metric
 * must never narrow to the caller. Scope is declared per metric and enforced by tests.
 */

/** Where a metric's facts live. Every source here was established by S1–S6. */
export const METRIC_SCOPES = Object.freeze(['garage_tenant', 'mechanic_person', 'branch', 'vehicle']);

/**
 * Reasons a metric is not measurable. Each is a missing FACT, never a missing opinion —
 * so the registry says what would have to exist, not merely "no".
 */
export const NOT_MEASURABLE_REASONS = Object.freeze({
  NO_CAPACITY_MODEL: 'no bay/capacity model exists; nothing records how much work a garage can hold',
  NO_APPOINTMENT_MODEL: 'no appointment or scheduled-time model exists, so attendance cannot be judged',
  NO_STAFFING_MODEL: 'no shift, roster or availability model exists',
  NO_TASK_MODEL: 'work orders are not decomposed into timed tasks',
  NO_ESTIMATE_MODEL: 'no estimate or quotation record exists to compare against an invoice',
  NO_WARRANTY_MODEL: 'no warranty or comeback linkage between service records exists',
  NO_RATING_MODEL: 'Foundation deliberately publishes no ratings, so none can be measured',
  NO_FIX_OUTCOME_MODEL: 'no record states whether a repair resolved the reported fault',
  NO_COMMUNICATIONS_JOIN: 'Communications owns response time; no governed join to service cases exists yet',
});

/**
 * The catalogue. `sources` names the real column or table each part comes from, so a
 * reviewer can verify the §19.3 bar was met rather than take it on trust.
 */
export const SERVICE_METRIC_CATALOGUE = Object.freeze([
  // ── measurable after Foundation (plan §19.1) ──
  {
    key: 'service_requests', label: 'Service requests', measurable: true, scopes: ['garage_tenant', 'branch'],
    sources: { numerator: 'service_cases (rows)', denominator: null, timestamp: 'service_cases.requested_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'accepted_requests', label: 'Accepted requests', measurable: true, scopes: ['garage_tenant', 'branch'],
    sources: { numerator: "service_cases WHERE status='accepted' or accepted_at IS NOT NULL", denominator: 'service_cases (rows)', timestamp: 'service_cases.accepted_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'declined_requests', label: 'Declined requests', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: "service_cases WHERE status='declined'", denominator: 'service_cases (rows)', timestamp: 'service_cases.declined_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'cancelled_cases', label: 'Cancelled cases', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: "service_cases WHERE status='cancelled'", denominator: 'service_cases (rows)', timestamp: 'service_cases.cancelled_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'request_to_accept_elapsed', label: 'Request-to-accept elapsed time', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: 'service_cases.accepted_at - service_cases.requested_at', denominator: 'accepted service_cases', timestamp: 'service_cases.accepted_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'accept_to_completion_elapsed', label: 'Accept-to-completion elapsed time', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: 'service_cases.completed_at - service_cases.accepted_at', denominator: 'completed service_cases', timestamp: 'service_cases.completed_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'work_orders_opened', label: 'Work orders opened', measurable: true, scopes: ['garage_tenant', 'branch'],
    sources: { numerator: 'mechanic_work_orders (rows)', denominator: null, timestamp: 'mechanic_work_orders.created_at', scope: 'mechanic_work_orders.tenant_id' },
  },
  {
    key: 'work_orders_completed', label: 'Work orders completed', measurable: true, scopes: ['garage_tenant', 'branch'],
    sources: { numerator: 'mechanic_work_orders.completed_at IS NOT NULL', denominator: 'mechanic_work_orders (rows)', timestamp: 'mechanic_work_orders.completed_at', scope: 'mechanic_work_orders.tenant_id' },
  },
  {
    key: 'work_orders_cancelled', label: 'Work orders cancelled', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: 'mechanic_work_orders.cancelled_at IS NOT NULL', denominator: 'mechanic_work_orders (rows)', timestamp: 'mechanic_work_orders.cancelled_at', scope: 'mechanic_work_orders.tenant_id' },
  },
  {
    key: 'contributing_mechanics', label: 'Contributing mechanics', measurable: true, scopes: ['garage_tenant', 'mechanic_person'],
    sources: { numerator: 'distinct work_order_assignments.mechanic_user_id', denominator: null, timestamp: 'work_order_assignments.assigned_at', scope: 'work_order_assignments.tenant_id / .mechanic_user_id' },
  },
  {
    key: 'service_category_demand', label: 'Service-category demand', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: 'service_cases.service_category (structured)', denominator: 'service_cases with a category', timestamp: 'service_cases.requested_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'demand_by_make_model', label: 'Demand by make/model', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: 'vehicles.make/model via canonical VIN join', denominator: 'service_cases (rows)', timestamp: 'service_cases.requested_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'branch_activity', label: 'Branch activity', measurable: true, scopes: ['branch'],
    sources: { numerator: 'service_cases.branch_id / mechanic_work_orders.branch_id', denominator: 'rows with a branch recorded', timestamp: 'service_cases.requested_at', scope: 'garage_branches.id' },
  },
  {
    key: 'repeat_customers', label: 'Repeat customers', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: 'service_cases.requester_user_id appearing more than once', denominator: 'distinct requesters', timestamp: 'service_cases.requested_at', scope: 'service_cases.garage_tenant_id' },
  },
  {
    key: 'service_records_logged', label: 'Service records logged', measurable: true, scopes: ['garage_tenant', 'mechanic_person'],
    sources: { numerator: 'service_records (rows)', denominator: null, timestamp: 'service_records.performed_at', scope: 'service_records.tenant_id' },
  },
  {
    key: 'part_records_logged', label: 'PartSentry records logged', measurable: true, scopes: ['garage_tenant'],
    sources: { numerator: 'service_record_parts (rows)', denominator: null, timestamp: 'service_records.performed_at', scope: 'service_records.tenant_id' },
  },

  // ── NOT measurable (plan §19.2) — each names the missing fact ──
  { key: 'bay_capacity_utilisation', label: 'Bay capacity utilisation', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_CAPACITY_MODEL },
  { key: 'appointment_no_show_rate', label: 'Appointment no-show rate', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_APPOINTMENT_MODEL },
  { key: 'staffing_utilisation', label: 'Staffing utilisation', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_STAFFING_MODEL },
  { key: 'technician_productivity', label: 'Task-level technician productivity', measurable: false, scopes: ['mechanic_person'], reason: NOT_MEASURABLE_REASONS.NO_TASK_MODEL },
  { key: 'estimate_approval_rate', label: 'Estimate approval rate', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_ESTIMATE_MODEL },
  { key: 'estimate_to_invoice_variance', label: 'Estimate-to-invoice variance', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_ESTIMATE_MODEL },
  { key: 'comeback_warranty_rate', label: 'Comeback / warranty rate', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_WARRANTY_MODEL },
  { key: 'customer_rating', label: 'Customer rating', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_RATING_MODEL },
  { key: 'first_time_fix_rate', label: 'First-time-fix rate', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_FIX_OUTCOME_MODEL },
  { key: 'response_time', label: 'Response time from Communications', measurable: false, scopes: ['garage_tenant'], reason: NOT_MEASURABLE_REASONS.NO_COMMUNICATIONS_JOIN },
]);

const BY_KEY = new Map(SERVICE_METRIC_CATALOGUE.map((m) => [m.key, m]));

export function getMetric(key) {
  return BY_KEY.get(String(key || '').trim()) || null;
}

export function listMeasurableMetrics() {
  return SERVICE_METRIC_CATALOGUE.filter((m) => m.measurable);
}

export function listNotMeasurableMetrics() {
  return SERVICE_METRIC_CATALOGUE.filter((m) => !m.measurable);
}

/**
 * The §19.3 bar, applied rather than asserted: a measurable metric must name a
 * numerator, a timestamp and a scope. (A denominator is only required for a rate —
 * a count legitimately has none.)
 */
export function violatesMeasurabilityBar(metric) {
  if (!metric.measurable) return metric.reason ? null : 'a not-measurable metric must state the missing fact';
  const s = metric.sources || {};
  if (!s.numerator) return 'no governed numerator source';
  if (!s.timestamp) return 'no governed timestamp source';
  if (!s.scope) return 'no governed scope source';
  return null;
}

/**
 * Re-check the catalogue against the LIVE schema instead of trusting this file.
 *
 * A metric whose declared source table is absent is reported as unavailable — never as
 * zero (Invariant 10). This is what keeps the catalogue honest after a rebase that moves
 * or renames an authority.
 */
export async function evaluateMeasurability(supabaseClient, metricKey) {
  const metric = getMetric(metricKey);
  if (!metric) return { key: metricKey, known: false, measurable: false, reason: 'unknown metric' };
  if (!metric.measurable) {
    return { key: metric.key, known: true, measurable: false, reason: metric.reason };
  }

  const tables = [...new Set(
    Object.values(metric.sources || {})
      .filter(Boolean)
      .map((expr) => String(expr).match(/^[a-z_]+/)?.[0])
      .filter(Boolean),
  )];

  for (const table of tables) {
    const { error } = await supabaseClient.from(table).select('*').limit(1);
    if (error) {
      return {
        key: metric.key, known: true, measurable: false,
        // Unavailable is not the same as "the answer is zero".
        availability: 'unavailable',
        reason: `source ${table} is unavailable: ${error.message}`,
      };
    }
  }
  return { key: metric.key, known: true, measurable: true, availability: 'available', sources: metric.sources };
}

/**
 * Scope guard (Invariant 3). A mechanic-scoped question must not be answered at tenant
 * width, and a garage-scoped question must not be narrowed to the caller.
 */
export function assertScopeAllowed(metricKey, scope) {
  const metric = getMetric(metricKey);
  if (!metric) throw new Error(`Unknown service metric: ${metricKey}`);
  if (!METRIC_SCOPES.includes(scope)) throw new Error(`Unknown metric scope: ${scope}`);
  if (!metric.scopes.includes(scope)) {
    throw new Error(`Metric ${metricKey} is not defined at ${scope} scope`);
  }
  return true;
}
