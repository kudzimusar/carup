/**
 * Marketplace analytics — simple aggregated counts for the admin command center. Admin/reviewer only.
 * Resilient: if marketplace_inquiries is not yet provisioned, inquiry metrics resolve to zero rather
 * than failing. No PII is returned — counts only.
 */

import { supabase } from '../../db/supabase.js';
import { getFixtureExclusion } from './marketplaceClassificationRules.js';
import { deriveListingPublicStatus, assertModerator } from './marketplaceModerationService.js';
import { MARKETPLACE_INQUIRY_TYPES, MARKETPLACE_INQUIRY_STATUSES } from './marketplaceEventTypes.js';

function tally(items, keyFn) {
  return items.reduce((acc, item) => {
    const k = keyFn(item);
    if (!k) return acc;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

export async function getMarketplaceAnalytics(client, actor) {
  assertModerator(actor);

  const { data: vehicles, error } = await client.from('vehicles').select('vin, status, trust_score, owner_id, tenant_id');
  if (error) throw error;
  const realVehicles = (vehicles || []).filter((v) => getFixtureExclusion(v) === null);
  const byPublicStatus = tally(realVehicles, (v) => deriveListingPublicStatus(v.status));

  const listings = {
    total: realVehicles.length,
    public: byPublicStatus.public || 0,
    pending_review: byPublicStatus.pending_review || 0,
    suppressed: byPublicStatus.suppressed || 0,
    rejected: byPublicStatus.rejected || 0,
    archived: byPublicStatus.archived || 0,
    high_risk: realVehicles.filter((v) => Number(v.trust_score) > 0 && Number(v.trust_score) < 50).length,
  };

  // Inquiries (best-effort).
  let inquiries = { total: 0, by_type: {}, by_status: {}, referral_attributed: 0, high_risk: 0 };
  try {
    const { data: rows, error: inqErr } = await client.from('marketplace_inquiries').select('*');
    if (inqErr) throw inqErr;
    const list = rows || [];
    inquiries = {
      total: list.length,
      by_type: MARKETPLACE_INQUIRY_TYPES.reduce((acc, t) => ({ ...acc, [t]: list.filter((r) => r.inquiry_type === t).length }), {}),
      by_status: MARKETPLACE_INQUIRY_STATUSES.reduce((acc, s) => ({ ...acc, [s]: list.filter((r) => r.status === s).length }), {}),
      referral_attributed: list.filter((r) => Boolean(r.referral_code)).length,
      high_risk: list.filter((r) => (r.risk_status || 'clear') !== 'clear').length,
      diaspora_demand:
        list.filter((r) => ['import_quote_request', 'container_space_interest', 'diaspora_vehicle_request', 'diaspora_parts_request', 'family_purchase_support'].includes(r.inquiry_type)).length,
    };
  } catch (e) {
    inquiries.note = 'inquiries unavailable (table not provisioned)';
  }

  return {
    listings,
    inquiries,
    generated_at: new Date().toISOString(),
  };
}
