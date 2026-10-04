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
 * server is built from the contract's allow-list, never from the row. Service Network enrichment
 * (service records, provider, mileage observation) extends this projection under the contract's
 * optional keys.
 */
import { CarUpError } from '../../utils/errors.js';

export const OWNER_SERVICE_HISTORY_CONTRACT = 'carup.owner_service_history.v1';
const OWNER_AUTHORIZATION = new Set(['pending', 'authorized', 'declined', 'revoked']);

export class ServiceHistoryUnavailableError extends CarUpError {
  constructor() {
    super('Your service history could not be read right now. Please try again shortly.', 503, 'SERVICE_HISTORY_UNAVAILABLE');
  }
}

const text = (value) => (value === undefined || value === null ? null : String(value));
const number = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Money with its currency, or not at all. Absent never becomes zero, and an amount with no currency is
 * not displayable as money — this table has no currency column, so here it is always "not recorded".
 */
export function projectMoney(row) {
  const amount = number(row?.total_cost);
  const currency = text(row?.currency);
  if (amount === null || !currency) return { recorded: false, amount: null, currency: null };
  return { recorded: true, amount, currency };
}

/** One work order as the owner may see it. Every key is named here; nothing else leaves the server. */
export function toOwnerServiceHistoryEntry(row) {
  const authorization = text(row?.owner_authorization);
  return {
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
    money: projectMoney(row),
  };
}

export async function listOwnerServiceHistory(client, ownerId) {
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
  return (rows || [])
    .filter((row) => row && row.id != null && row.vin != null)
    .map(toOwnerServiceHistoryEntry)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export default { OWNER_SERVICE_HISTORY_CONTRACT, listOwnerServiceHistory, toOwnerServiceHistoryEntry, projectMoney, ServiceHistoryUnavailableError };
