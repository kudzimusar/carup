/**
 * CARUP-DEALER-1.0-VISUAL-UAT-R1 — dealer performance cards (P1), from EXISTING canonical records only.
 *
 * Each figure is an exact count from its canonical table, scoped to the approved owner's tenant and
 * labelled with what it measures. Nothing is estimated, extrapolated or invented: a figure that cannot
 * be read is `null` ("not available"), never 0. Customer ratings/reviews, dealership saves and likes are
 * NOT existing CarUp capabilities (dealer buyer feedback is private by database constraint; shoppers can
 * save vehicles, not dealerships), so they are reported as DEFERRED — NEW PRODUCT CAPABILITY REQUIRED.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';

const DAY = 86400000;
const DEFERRED = 'DEFERRED_NEW_PRODUCT_CAPABILITY_REQUIRED';
const NOT_COUNTED = new Set(['spam', 'rejected']);
async function exactCount(query) {
  try {
    const {count, error} = await query;
    return error || !Number.isInteger(count) ? null : count;
  } catch { return null; }
}

export async function getMyDealerPerformanceSummary(actor, {
  db = supabase, resolveOwner = requireApprovedOwnerWorkspace, now = () => Date.now(),
} = {}) {
  const owner = await resolveOwner(actor);
  const tenant = owner.tenant_id;
  const nowMs = now();
  const since30 = new Date(nowMs - 30 * DAY).toISOString();
  const since60 = new Date(nowMs - 60 * DAY).toISOString();
  const head = (table) => db.from(table).select('*', {count: 'exact', head: true});
  const enquiries = () => head('marketplace_inquiries').eq('seller_tenant_id', tenant)
    .not('status', 'in', `(${[...NOT_COUNTED].join(',')})`);
  const [recorded, published, allEnquiries, qualified, last30, previous30] = await Promise.all([
    exactCount(head('vehicles').eq('tenant_id', tenant)),
    exactCount(head('vehicles').eq('tenant_id', tenant).eq('publication_status', 'published')),
    exactCount(enquiries()),
    exactCount(head('marketplace_inquiries').eq('seller_tenant_id', tenant).eq('status', 'qualified')),
    exactCount(enquiries().gte('created_at', since30)),
    exactCount(enquiries().gte('created_at', since60).lt('created_at', since30)),
  ]);
  // Vehicle saves: shoppers' saved-vehicle rows for this dealership's VINs. Counts only — who saved a
  // vehicle is never read or shown.
  let vehicleSaves = null;
  let vinScope = null;
  try {
    const {data: vins, error} = await db.from('vehicles').select('vin').eq('tenant_id', tenant).limit(500);
    if (!error && Array.isArray(vins)) {
      vinScope = vins.length >= 500 ? 'FIRST_500_VEHICLES' : 'ALL_VEHICLES';
      vehicleSaves = vins.length === 0 ? 0
        : await exactCount(head('saved_vehicles').in('vin', vins.map((v) => v.vin)));
    }
  } catch { vehicleSaves = null; }
  const metric = (value, scope, extra = {}) => Object.freeze({value, scope, ...extra});
  return Object.freeze({
    tenant_id: tenant,
    generated_at: new Date(nowMs).toISOString(),
    metrics: Object.freeze({
      published_vehicles: metric(published, 'Vehicles of this dealership currently published on CarUp Marketplace'),
      recorded_vehicles: metric(recorded, 'All vehicles recorded for this dealership, in any status'),
      buyer_enquiries: metric(allEnquiries, 'Marketplace enquiries to this dealership, excluding spam and rejected',
        {last_30_days: last30, previous_30_days: previous30}),
      qualified_enquiries: metric(qualified, 'Enquiries this dealership currently marks as qualified (seller-reported)'),
      vehicle_saves: metric(vehicleSaves, 'Times shoppers saved this dealership’s vehicles; who saved them is never shown',
        {vin_scope: vinScope}),
      customer_rating: metric(null, 'CarUp has no public dealership reviews yet; private buyer feedback is never published', {status: DEFERRED}),
      customer_reviews: metric(null, 'No eligible public customer reviews exist yet', {status: DEFERRED}),
      dealership_saves: metric(null, 'Shoppers can save vehicles, not dealerships, today', {status: DEFERRED}),
      likes: metric(null, 'CarUp has no “like” for dealerships', {status: DEFERRED}),
    }),
    no_unverified_metrics_generated: true,
  });
}
