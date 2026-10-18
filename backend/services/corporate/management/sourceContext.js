/**
 * CA-OWNER-02 — the per-request source context: the K2B-classified populations several Corporate facts rest on, each read
 * ONCE per request (and failing together), so the Overview, which composes every area, never reads a source twice or
 * judges the same record two ways.
 *
 *   listingBase()     the K2B listing base (readListingProvenanceBase) + an exact-count completeness check
 *   users()           every account (id, email, name) and a K2B index over them
 *   inquiries()       every Marketplace inquiry, judged by K2B (asker + listing class from listingBase)
 *   vehicleIndex(vins) K2B vehicle classification for the given VINs (owner identity included)
 */
import { readListingProvenanceBase } from '../../marketplace/marketplaceModerationService.js';
import { createProvenanceIndex, loadProvenanceIndex } from '../../provenance/provenanceContext.js';
import { exactCount, readAllRows, shared } from './sourceReads.js';

export function createSourceContext(client, { now = new Date() } = {}) {
  const listingBase = shared(async () => {
    const expected = await exactCount(client, 'vehicles', { column: 'vin' });
    const base = await readListingProvenanceBase(client);
    const provenanceByVin = new Map(base.classified.map((c) => [String(c.vehicle.vin), c.provenance]));
    return { ...base, provenanceByVin, complete: base.classified.length === expected };
  });
  const users = shared(async () => {
    const rows = await readAllRows(client, 'users', 'id, email, name');
    return { rows, index: createProvenanceIndex({ users: rows }) };
  });
  const inquiries = shared(async () => {
    const [base, people, rows] = await Promise.all([
      listingBase(),
      users(),
      readAllRows(client, 'marketplace_inquiries', 'id, buyer_id, guest_email, guest_name, listing_id, listing_type, status, created_at'),
    ]);
    const classified = rows.map((row) => ({ row, provenance: people.index.inquiry(row, base.provenanceByVin) }));
    return { classified, byId: new Map(classified.map((c) => [String(c.row.id), c])), complete: base.complete };
  });
  const vehicleIndex = async (vins) => loadProvenanceIndex(client, { vins: [...new Set((vins || []).filter(Boolean).map(String))] });
  return { client, now, listingBase, users, inquiries, vehicleIndex };
}
