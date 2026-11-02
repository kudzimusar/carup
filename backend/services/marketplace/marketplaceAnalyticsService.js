/**
 * Marketplace analytics — simple aggregated counts for the admin command center. Admin/reviewer only.
 * No PII is returned — counts only.
 *
 * PC01-K2B: the listing population is the SAME base the moderation queue reads
 * (readListingProvenanceBase), classified once by the provenance authority, so the stat cards and the
 * queue can no longer disagree about which vehicles are operational. Analytics used to select only
 * `vin, status, trust_score, owner_id, tenant_id` — without `seller_description` its automation rule
 * could never fire, and 207 automation listings were counted that the queue hid. Inquiries are
 * classified by asker and listing. Set-aside records are reported per class; nothing is deleted.
 */

import { deriveListingVisibility, assertModerator, readListingProvenanceBase } from './marketplaceModerationService.js';
import { MARKETPLACE_INQUIRY_TYPES, MARKETPLACE_INQUIRY_STATUSES } from './marketplaceEventTypes.js';
import { summarizeProvenance } from '../provenance/recordProvenance.js';
import { createProvenanceIndex } from '../provenance/provenanceContext.js';

function tally(items, keyFn) {
  return items.reduce((acc, item) => {
    const k = keyFn(item);
    if (!k) return acc;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

const DIASPORA_INQUIRY_TYPES = ['import_quote_request', 'container_space_interest', 'diaspora_vehicle_request', 'diaspora_parts_request', 'family_purchase_support'];

export async function getMarketplaceAnalytics(client, actor) {
  assertModerator(actor);

  const base = await readListingProvenanceBase(client);
  const realVehicles = base.operational.map((c) => c.vehicle);

  // The legacy trust_score column is not part of the listing projection; read it for the SAME vins.
  const trustByVin = new Map();
  const vins = realVehicles.map((v) => v.vin).filter(Boolean);
  if (vins.length) {
    const { data: trustRows, error: trustError } = await client.from('vehicles').select('vin, trust_score').in('vin', vins);
    if (trustError) throw trustError;
    for (const row of trustRows || []) trustByVin.set(row.vin, row.trust_score);
  }

  // The SAME publication projection the moderation queue uses (PC01-K2B-R1): "public" here means the
  // public Marketplace can show it — status AND publication_status — never status alone.
  const byPublicStatus = tally(realVehicles, (v) => deriveListingVisibility(v).public_status);
  const listings = {
    total: realVehicles.length,
    public: byPublicStatus.public || 0,
    not_public: byPublicStatus.not_public || 0,
    pending_review: byPublicStatus.pending_review || 0,
    suppressed: byPublicStatus.suppressed || 0,
    rejected: byPublicStatus.rejected || 0,
    archived: byPublicStatus.archived || 0,
    high_risk: realVehicles.filter((v) => {
      const score = Number(trustByVin.get(v.vin));
      return score > 0 && score < 50;
    }).length,
  };

  // Inquiries. A read failure is reported as unavailable — never as zero inquiries.
  let inquiries;
  try {
    const { data: rows, error: inqErr } = await client.from('marketplace_inquiries').select('*');
    if (inqErr) throw inqErr;
    const list = rows || [];
    const buyerIds = [...new Set(list.map((r) => r.buyer_id).filter(Boolean))];
    let buyers = [];
    if (buyerIds.length) {
      const { data: buyerRows, error: buyerErr } = await client.from('users').select('id, email, name').in('id', buyerIds);
      if (buyerErr) throw buyerErr;
      buyers = buyerRows || [];
    }
    const index = createProvenanceIndex({ users: buyers });
    // The listing an inquiry is about is classified exactly as the queue classified it.
    const listingProvenance = new Map(base.classified.map((c) => [String(c.vehicle.vin), c.provenance]));
    const classified = list.map((row) => ({ row, provenance: index.inquiry(row, listingProvenance) }));
    const operational = classified.filter((c) => c.provenance.operational).map((c) => c.row);
    inquiries = {
      available: true,
      total: operational.length,
      by_type: MARKETPLACE_INQUIRY_TYPES.reduce((acc, t) => ({ ...acc, [t]: operational.filter((r) => r.inquiry_type === t).length }), {}),
      by_status: MARKETPLACE_INQUIRY_STATUSES.reduce((acc, s) => ({ ...acc, [s]: operational.filter((r) => r.status === s).length }), {}),
      referral_attributed: operational.filter((r) => Boolean(r.referral_code)).length,
      high_risk: operational.filter((r) => (r.risk_status || 'clear') !== 'clear').length,
      diaspora_demand: operational.filter((r) => DIASPORA_INQUIRY_TYPES.includes(r.inquiry_type)).length,
      provenance: summarizeProvenance(classified.map((c) => c.provenance)),
    };
  } catch {
    inquiries = {
      available: false,
      total: null,
      by_type: {},
      by_status: {},
      referral_attributed: null,
      high_risk: null,
      diaspora_demand: null,
      note: 'Inquiries could not be read. These figures are NOT zero.',
    };
  }

  return {
    listings,
    inquiries,
    provenance: { listings: base.summary },
    generated_at: new Date().toISOString(),
  };
}
