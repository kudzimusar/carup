/**
 * Listing snapshot service — Milestone 2 (master plan §6.5).
 *
 * Immutable, versioned captures of an external listing. Each capture is a NEW row; the
 * table is append-only (DB trigger). "Current" = highest version for a (source, record).
 * These snapshots feed the M3C seller-disclosure-conflict engine, so the exact captured
 * text/price/mileage must be preserved verbatim.
 */
import crypto from 'crypto';

const TABLE = 'listing_snapshots';

export function computeListingHash(listing = {}) {
  const canonical = JSON.stringify({
    title: listing.title || null,
    description: listing.description || null,
    price: listing.price ?? null,
    currency: listing.currency || null,
    advertised_mileage: listing.advertised_mileage ?? null,
    mileage_unit: listing.mileage_unit || null,
    claimed_condition: listing.claimed_condition || null,
    claimed_accident_status: listing.claimed_accident_status || null,
    image_refs: listing.image_refs || [],
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function currentVersionRow(supabase, sourceId, sourceRecordId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('source_id', sourceId)
    .eq('source_record_id', sourceRecordId)
    .order('version', { ascending: false })
    .limit(1);
  if (error) throw new Error(`listing snapshot read failed: ${error.message}`);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows[0] || null;
}

/**
 * Create the next immutable version of a listing snapshot. If the content hash is
 * unchanged from the current version, returns the existing row (idempotent — no churn).
 */
export async function createListingSnapshot(supabase, { sourceId, sourceRecordId, vin, listing }) {
  const content_hash = computeListingHash(listing);
  const current = await currentVersionRow(supabase, sourceId, sourceRecordId);
  if (current && current.content_hash === content_hash) {
    return { snapshot: current, created: false };
  }
  const version = current ? Number(current.version) + 1 : 1;
  const row = {
    source_id: sourceId,
    source_record_id: sourceRecordId,
    vin: vin || null,
    listing_url: listing.url || null,
    version,
    title: listing.title || null,
    description: listing.description || null,
    price: listing.price ?? null,
    currency: listing.currency || null,
    advertised_mileage: listing.advertised_mileage ?? null,
    mileage_unit: listing.mileage_unit || null,
    claimed_condition: listing.claimed_condition || null,
    claimed_accident_status: listing.claimed_accident_status || null,
    image_refs: listing.image_refs || [],
    content_hash,
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select();
  if (error) throw new Error(`listing snapshot write failed: ${error.message}`);
  return { snapshot: Array.isArray(data) ? data[0] : data, created: true };
}

export async function listSnapshotsForVin(supabase, vin) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('vin', vin)
    .order('captured_at', { ascending: false });
  if (error) throw new Error(`listing snapshot list failed: ${error.message}`);
  return Array.isArray(data) ? data : data ? [data] : [];
}

export default { computeListingHash, createListingSnapshot, listSnapshotsForVin };
