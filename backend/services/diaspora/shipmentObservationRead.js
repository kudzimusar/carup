/**
 * T11-CAP-05 — the READ side of shipment observations and the history of estimate revisions.
 *
 * Kept apart from the write service on purpose, like the legs read module: the read-only Journey
 * projection should not import the T11 shipment service to show an estimate. No authority logic lives
 * here — the CALLER is responsible for having authorized the read — and there is no write path.
 *
 * The estimate is shown as TWO values, never merged: the shipment record's own estimate (`original`,
 * T11's) and the latest accepted revision (`current`). An observation is an input; it is shown beside
 * the record, not written over it. And an estimate — revised or not — is never an arrival.
 */
const OBSERVATIONS = 'diaspora_shipment_observations';

const stamp = (row) => [String(row.observed_at || ''), String(row.received_at || row.created_at || '')];
function byObservedThenReceived(a, b) {
  const [ao, ar] = stamp(a);
  const [bo, br] = stamp(b);
  return ao.localeCompare(bo) || ar.localeCompare(br);
}

/** Accepted and superseded estimate revisions of a shipment, oldest observation first. */
export async function listEtaRevisionsForShipment(shipmentId, client) {
  const { data } = await client.from(OBSERVATIONS).select('*')
    .eq('shipment_id', shipmentId).eq('kind', 'ETA_REVISION').in('status', ['ACCEPTED', 'SUPERSEDED']);
  return (data || []).slice().sort(byObservedThenReceived);
}

/** One revision as a participant may see it: the estimate, when it was observed, why, and who said so by kind. */
export function projectRevision(row) {
  return {
    estimated_arrival: row.payload?.estimated_arrival ?? null,
    observed_at: row.observed_at ?? null,
    reason: row.payload?.reason ?? null,
    source: row.provider_id ?? null,
    superseded: row.status === 'SUPERSEDED',
  };
}

const DAY_MS = 86400000;

/**
 * The estimate, current beside original, with its history. Never who decided, never who recorded it,
 * never an event id or a reference — and never a claim that anything arrived.
 */
export function projectEta(shipment, revisions = []) {
  const original = shipment?.estimated_arrival_date ?? null;
  const ordered = (revisions || []).slice().sort(byObservedThenReceived);
  const accepted = ordered.filter((r) => r.status === 'ACCEPTED');
  const latest = accepted.length ? accepted[accepted.length - 1] : null;
  const current = latest ? (latest.payload?.estimated_arrival ?? original) : original;
  const basis = latest ? 'revision' : (original ? 'shipment_record' : 'none');
  const changeDays = latest && original && current
    ? Math.round((Date.parse(current) - Date.parse(original)) / DAY_MS)
    : null;
  return {
    availability: 'composed',
    basis,
    original,
    current,
    change_days: Number.isFinite(changeDays) ? changeDays : null,
    revision_count: ordered.length,
    last_revised_at: latest?.observed_at ?? null,
    revisions: ordered.map(projectRevision),
    note: 'An estimate can move. A revised estimate is still an estimate, never a record that anything arrived.',
  };
}
