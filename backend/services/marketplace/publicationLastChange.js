/**
 * Who last moved each of an owner's listings on or off the public Marketplace — PC01-J-R1.
 *
 * `publishable` means "ready, but not live": the marketplace read path shows `published` and
 * nothing else (utils/vehicleStatus.js). The owner of the real UAT vehicle GFC27-027051 last left it
 * PUBLISHED on 2026-09-26. On 2026-10-06 a moderator-authorised staging reconciliation (OC-5R-DB2B-1)
 * returned it to `publishable` — a CarUp action, written to trust_audit_events as one. Without this
 * read the owner saw "Ready to publish" on a listing they had published, and nothing said why.
 *
 * The audit trail is the only authority for that answer, and only the answer travels: the
 * direction, the time, and WHO in the owner's own terms. No actor id, role, reason text, request
 * id or source route leaves the server.
 *
 * Three states, never two:
 *   recorded  — the trail holds a publication change for this vehicle
 *   none      — the trail was read and holds none (a listing that was never published)
 *   not_read  — the trail could not be read; this is NOT "nobody changed it"
 */

export const PUBLICATION_CHANGE_EVENTS = Object.freeze(['VEHICLE_LISTING_PUBLISHED', 'VEHICLE_LISTING_UNPUBLISHED']);

/** Upper bound on audit rows read for one owner list. Newest first, so truncation drops only old rows. */
export const PUBLICATION_CHANGE_READ_LIMIT = 1000;

const CHANGE_BY_EVENT = Object.freeze({
  VEHICLE_LISTING_PUBLISHED: 'published',
  VEHICLE_LISTING_UNPUBLISHED: 'unpublished',
});

// A null actor is a system write (the reconciliation above inserted `actor_user_id NULL`,
// `actor_role 'system'`); an admin acting through the product is CarUp too.
const CARUP_ROLES = new Set(['system', 'admin', 'operator', 'reviewer', 'super_admin']);

function attribute(row, userId) {
  if (row.actor_user_id && userId && row.actor_user_id === userId) return 'you';
  if (!row.actor_user_id || CARUP_ROLES.has(String(row.actor_role || '').toLowerCase())) return 'carup';
  return 'another_account';
}

/**
 * Pure: audit rows → Map(vin → state). `rows === null` means the read failed.
 *
 * When the read hit its row limit, a vehicle with no row in the result may simply have been cut off,
 * so it is `not_read` rather than `none` — a truncated read must not become a claim of absence.
 */
export function describePublicationLastChange(rows, { vins = [], userId = null, truncated = false } = {}) {
  const wanted = [...new Set((vins || []).filter(Boolean))];
  const result = new Map();
  if (rows === null || rows === undefined) {
    for (const vin of wanted) result.set(vin, { state: 'not_read' });
    return result;
  }

  const latest = new Map();
  for (const row of rows) {
    // Publication events carry the identifier in both columns (measured on staging: 614 of 614
    // equal); `vin` is the indexed one, so it is the one the read filters and keys on.
    const vin = row?.vin ?? row?.vehicle_id;
    if (!vin || !CHANGE_BY_EVENT[row.event_type]) continue;
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at)) continue;
    const current = latest.get(vin);
    if (!current || at > current.at) latest.set(vin, { at, row });
  }

  for (const vin of wanted) {
    const found = latest.get(vin);
    if (!found) {
      result.set(vin, { state: truncated ? 'not_read' : 'none' });
      continue;
    }
    result.set(vin, {
      state: 'recorded',
      change: CHANGE_BY_EVENT[found.row.event_type],
      at: new Date(found.at).toISOString(),
      by: attribute(found.row, userId),
    });
  }
  return result;
}

/** Read the trail for the owner's vehicles and describe it. Never throws: a failure is `not_read`. */
export async function readPublicationLastChange(client, vins, userId) {
  const wanted = [...new Set((vins || []).filter(Boolean))];
  if (wanted.length === 0) return new Map();
  try {
    const { data, error } = await client
      .from('trust_audit_events')
      .select('vin, event_type, actor_user_id, actor_role, created_at')
      .in('vin', wanted)
      .in('event_type', PUBLICATION_CHANGE_EVENTS)
      .order('created_at', { ascending: false })
      .limit(PUBLICATION_CHANGE_READ_LIMIT);
    if (error) return describePublicationLastChange(null, { vins: wanted, userId });
    const rows = data || [];
    return describePublicationLastChange(rows, {
      vins: wanted,
      userId,
      truncated: rows.length >= PUBLICATION_CHANGE_READ_LIMIT,
    });
  } catch {
    return describePublicationLastChange(null, { vins: wanted, userId });
  }
}
