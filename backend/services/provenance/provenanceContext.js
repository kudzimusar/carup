/**
 * PC01-K2B — read-only context for the provenance authority.
 *
 * The classifier (recordProvenance.js) is pure; this module reads only the creator facts it needs —
 * a user's id, email and name, and a vehicle's identifying columns — so an Admin read path can ask
 * "is this operational?" with creator evidence rather than from VIN shape alone. SELECT only.
 * Email addresses are used to classify and are never returned by any summary built from them.
 */
import { classifyIdentity, classifyVehicle, classifyInquiry } from './recordProvenance.js';

const CHUNK = 200;
export const PROVENANCE_IDENTITY_COLUMNS = 'id, email, name';
export const PROVENANCE_VEHICLE_COLUMNS = 'vin, owner_id, tenant_id, make, seller_description';

const unique = (values) => [...new Set((values || []).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map(String))];

async function readIn(client, table, columns, key, values) {
  const rows = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const { data, error } = await client.from(table).select(columns).in(key, values.slice(i, i + CHUNK));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

/**
 * An index over already-read rows. Classification results are memoised per id / vin so a surface that
 * classifies thousands of rows (activity events) does the work once per creator.
 */
export function createProvenanceIndex({ users = [], vehicles = [] } = {}) {
  const userById = new Map(users.map((u) => [String(u.id), u]));
  const vehicleByVin = new Map(vehicles.map((v) => [String(v.vin), v]));
  const identityMemo = new Map();
  const vehicleMemo = new Map();

  const identity = (id) => {
    if (id === null || id === undefined || id === '') return null;
    const key = String(id);
    if (!identityMemo.has(key)) identityMemo.set(key, classifyIdentity(userById.get(key) || { id: key }));
    return identityMemo.get(key);
  };
  const vehicle = (vin) => {
    if (!vin) return null;
    const key = String(vin);
    if (!vehicleMemo.has(key)) {
      const row = vehicleByVin.get(key);
      vehicleMemo.set(key, row ? classifyVehicle(row, { owner: row.owner_id ? userById.get(String(row.owner_id)) || null : null }) : null);
    }
    return vehicleMemo.get(key);
  };
  /**
   * `listingProvenanceByVin`, when given, is the classification the caller already made for the
   * listings (e.g. the moderation base), so an inquiry is judged against the very same listing class.
   */
  const inquiry = (row, listingProvenanceByVin = null) => classifyInquiry(row, {
    buyer: row?.buyer_id ? userById.get(String(row.buyer_id)) || null : null,
    listing: row?.listing_id
      ? (listingProvenanceByVin ? listingProvenanceByVin.get(String(row.listing_id)) || null : vehicle(row.listing_id))
      : null,
  });
  return { identity, vehicle, inquiry, user: (id) => (id ? userById.get(String(id)) || null : null) };
}

/** Load exactly the users and vehicles a surface needs, then index them. */
export async function loadProvenanceIndex(client, { userIds = [], vins = [] } = {}) {
  const vehicles = vins.length ? await readIn(client, 'vehicles', PROVENANCE_VEHICLE_COLUMNS, 'vin', unique(vins)) : [];
  const ids = unique([...userIds, ...vehicles.map((v) => v.owner_id)]);
  const users = ids.length ? await readIn(client, 'users', PROVENANCE_IDENTITY_COLUMNS, 'id', ids) : [];
  return createProvenanceIndex({ users, vehicles });
}
