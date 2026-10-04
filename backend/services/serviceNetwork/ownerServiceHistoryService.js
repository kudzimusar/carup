/**
 * OC-5D (P6) — the vehicle owner's service history, held to
 * shared/contracts/owner-service-history.v1.contract.json.
 *
 * RC1 answered GET /api/service-history/me with `select('*')` rows of mechanic_work_orders. Three things
 * followed from that:
 *   - the native Garage read `item.cost`, a key no schema ever had, and threw on the first non-empty
 *     history (F1); #197's enrichment would have rendered `$[object Object]` there instead;
 *   - the owner received other people's identifiers — after a sale, `customer_name` / `customer_id`
 *     are the PREVIOUS owner, `mechanic_id` is a garage employee's account id, `owner_authorized_by`
 *     the account that decided — and every column a later migration adds would have followed;
 *   - an unreadable ownership read became `[]`: "you have no service history", said about a query
 *     that failed.
 *
 * The row is still read with `*`: the deployed schemas differ (006 has organization_id and
 * issue_description; 009 has tenant_id and the costs; OC-5A's owner_authorization is a migration that
 * is not live everywhere), and naming a column a schema lacks would fail the whole read. What leaves the
 * server is built from the contract's allow-list, never from the row.
 *
 * Service Network enrichment (ported from #197's S6 projection, OC-5D) extends each entry under the
 * contract's OPTIONAL keys: the service record (what was done, its provenance, when), the provider's
 * PUBLISHED identity, and the latest mileage observation — never the canonical odometer. #197 named
 * its money object `cost`, the very key the native screen crashed on; it is `money` here. An
 * enrichment table that does not exist yet (Service Network migrations not applied) contributes
 * nothing; any other failed read fails the history (503) rather than presenting it as complete.
 */
import { CarUpError, ForbiddenError } from '../../utils/errors.js';

export const OWNER_SERVICE_HISTORY_CONTRACT = 'carup.owner_service_history.v1';
const OWNER_AUTHORIZATION = new Set(['pending', 'authorized', 'declined', 'revoked']);

export class ServiceHistoryUnavailableError extends CarUpError {
  constructor() {
    super('Your service history could not be read right now. Please try again shortly.', 503, 'SERVICE_HISTORY_UNAVAILABLE');
  }
}

const text = (value) => (value === undefined || value === null ? null : String(value));
// Postgres "undefined_table": the enrichment's source is not deployed in this environment.
const isAbsentTable = (error) => error?.code === '42P01';
const number = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Money with its currency, or not at all. Absent never becomes zero, and an amount with no currency is
 * not displayable as money. The service record's amount wins over the work order's (S5 requires a
 * currency with every recorded cost; S4 added the work order's currency column).
 */
export function projectMoney(row, record = null) {
  const amount = number(record?.total_cost ?? row?.total_cost);
  const currency = text(record?.currency ?? row?.currency);
  if (amount === null || !currency) return { recorded: false, amount: null, currency: null };
  return { recorded: true, amount, currency };
}

/** The provider by its PUBLISHED identity only — never a tenant id, never the word "Garage" for unknown. */
function projectProvider(row, providers) {
  const profile = row?.tenant_id ? providers.get(String(row.tenant_id)) : null;
  if (!profile) return { known: false, display_name: null, slug: null };
  return { known: true, display_name: profile.display_name, slug: profile.slug };
}

/**
 * One work order as the owner may see it. Every key is named here; nothing else leaves the server.
 * `enrichment` (Service Network) is { record, providers, latestObservation } when available.
 */
export function toOwnerServiceHistoryEntry(row, enrichment = null) {
  const authorization = text(row?.owner_authorization);
  const base = {
    id: String(row.id),
    vin: String(row.vin),
    status: text(row.status),
    description: text(row.description),
    issue_description: text(row.issue_description),
    total_cost: number(row.total_cost),
    labor_cost: number(row.labor_cost),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
    owner_authorization: authorization && OWNER_AUTHORIZATION.has(authorization) ? authorization : null,
    money: projectMoney(row, enrichment?.record),
  };
  if (!enrichment) return base;
  const record = enrichment.record || null;
  const latest = enrichment.latestObservation || null;
  return {
    ...base,
    service_case_id: text(row.service_case_id),
    service_category: text(record?.service_category ?? row.service_category),
    work_performed: text(record?.work_performed),
    // Provenance is stated, never assumed: with no service record the honest answer is 'unknown'.
    provenance: text(record?.service_authority) || 'unknown',
    provider: projectProvider(row, enrichment.providers || new Map()),
    // Completion time is the authoritative stamped column, never derived from updated_at.
    completed_at: text(row.completed_at),
    cancelled_at: text(row.cancelled_at),
    performed_at: text(record?.performed_at),
    // An OBSERVATION from service, never the canonical odometer.
    mileage_observation: latest
      ? { observed_mileage: number(latest.observed_mileage), observed_at: text(latest.observed_at), source: text(latest.observation_source) }
      : null,
  };
}

/** Service Network enrichment for a set of work orders, or null when its tables are not deployed. */
async function loadEnrichment(client, rows) {
  const orderIds = rows.map((r) => r.id);
  const { data: records, error: recordError } = await client
    .from('service_records').select('*').in('work_order_id', orderIds);
  if (recordError) {
    if (isAbsentTable(recordError)) return null;
    throw new ServiceHistoryUnavailableError();
  }
  // One record per work order in the owner's view: the most recently performed.
  const recordByOrder = new Map();
  for (const r of records || []) {
    const key = String(r.work_order_id);
    const held = recordByOrder.get(key);
    if (!held || String(r.performed_at || '') > String(held.performed_at || '')) recordByOrder.set(key, r);
  }

  const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean).map(String))];
  const providers = new Map();
  if (tenantIds.length) {
    const { data: profiles, error: profileError } = await client
      .from('garage_public_profiles')
      .select('tenant_id, display_name, slug, publication_status')
      .in('tenant_id', tenantIds);
    if (profileError && !isAbsentTable(profileError)) throw new ServiceHistoryUnavailableError();
    for (const p of profiles || []) {
      // Only a PUBLISHED garage gets a public link; an unpublished one is still named, without one.
      providers.set(String(p.tenant_id), { display_name: p.display_name, slug: p.publication_status === 'published' ? p.slug : null });
    }
  }

  const recordIds = [...recordByOrder.values()].map((r) => r.id);
  const latestByRecord = new Map();
  if (recordIds.length) {
    const { data: observations, error: observationError } = await client
      .from('service_mileage_observations').select('*').in('service_record_id', recordIds);
    if (observationError && !isAbsentTable(observationError)) throw new ServiceHistoryUnavailableError();
    for (const o of observations || []) {
      const held = latestByRecord.get(o.service_record_id);
      if (!held || String(o.observed_at || '') > String(held.observed_at || '')) latestByRecord.set(o.service_record_id, o);
    }
  }
  return { recordByOrder, providers, latestByRecord };
}

export async function listOwnerServiceHistory(client, ownerId) {
  // No owner, no history — and never a query with an undefined owner id (which some drivers read as "any").
  if (!ownerId) throw new ForbiddenError('An authenticated owner is required');
  const { data: vehicles, error: vehicleError } = await client
    .from('vehicles')
    .select('vin')
    .eq('owner_id', ownerId);
  if (vehicleError) throw new ServiceHistoryUnavailableError();
  const vins = (vehicles || []).map((v) => v.vin).filter(Boolean);
  if (vins.length === 0) return [];

  const { data: rows, error: orderError } = await client
    .from('mechanic_work_orders')
    .select('*')
    .in('vin', vins);
  if (orderError) throw new ServiceHistoryUnavailableError();
  const orders = (rows || []).filter((row) => row && row.id != null && row.vin != null);
  if (orders.length === 0) return [];
  const enrichment = await loadEnrichment(client, orders);
  return orders
    .map((row) => {
      if (!enrichment) return toOwnerServiceHistoryEntry(row);
      const record = enrichment.recordByOrder.get(String(row.id)) || null;
      return toOwnerServiceHistoryEntry(row, {
        record,
        providers: enrichment.providers,
        latestObservation: record ? enrichment.latestByRecord.get(record.id) || null : null,
      });
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export default { OWNER_SERVICE_HISTORY_CONTRACT, listOwnerServiceHistory, toOwnerServiceHistoryEntry, projectMoney, ServiceHistoryUnavailableError };
