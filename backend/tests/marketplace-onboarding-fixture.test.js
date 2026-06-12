import test from 'node:test';
import assert from 'node:assert/strict';

// Ensure production/default mode (fixtures hidden) regardless of the runner env.
delete process.env.MARKETPLACE_SHOW_FIXTURES;

import {
  getListingEligibility,
  buildVehicleListingCandidate,
} from '../services/marketplace/marketplaceListingEligibility.js';
import {
  getFixtureExclusion,
  classifyVehicleConditionCandidate,
} from '../services/marketplace/marketplaceClassificationRules.js';
import {
  listMarketplaceListings,
  buildMarketplaceListingSummary,
  filterVisibleVehicles,
} from '../services/marketplace/listingSummaryService.js';
import {
  realPrivateListing,
  realDealerListing,
  fixtureListing,
  buildMockSupabase,
} from './fixtures/marketplaceListings.js';

// ---------- Positive: the real-listing path works end to end ----------

test('real private listing passes eligibility and is not a fixture', () => {
  const r = getListingEligibility(realPrivateListing);
  assert.equal(r.eligible, true, JSON.stringify(r.reasons));
  assert.equal(getFixtureExclusion(realPrivateListing), null);
});

test('real dealer listing passes eligibility and is not a fixture', () => {
  assert.equal(getListingEligibility(realDealerListing).eligible, true);
  assert.equal(getFixtureExclusion(realDealerListing), null);
});

test('real private (Local + ZW) classifies as locally_used; dealer (Japan) as recently_imported', () => {
  assert.equal(classifyVehicleConditionCandidate(realPrivateListing).proposed, 'locally_used');
  assert.equal(classifyVehicleConditionCandidate(realDealerListing).proposed, 'recently_imported');
});

test('real listing appears in listMarketplaceListings in production/default mode (fixtures hidden)', async () => {
  const supabase = buildMockSupabase({ vehicles: [realPrivateListing] });
  const { listings, total } = await listMarketplaceListings(supabase, {});
  assert.equal(total, 1);
  assert.equal(listings[0].vin, realPrivateListing.vin);
});

test('public summary never exposes owner_id or tenant_id', async () => {
  const supabase = buildMockSupabase({ vehicles: [realPrivateListing] });
  const { listings } = await listMarketplaceListings(supabase, {});
  assert.equal('owner_id' in listings[0], false);
  assert.equal('tenant_id' in listings[0], false);
  // direct builder check too
  const summary = buildMarketplaceListingSummary({ vehicle: realDealerListing });
  assert.equal('owner_id' in summary, false);
  assert.equal('tenant_id' in summary, false);
});

test('existing filters still work alongside real listings', async () => {
  const supabase = buildMockSupabase({ vehicles: [realPrivateListing, realDealerListing] });
  const toyota = await listMarketplaceListings(supabase, { make: 'Toyota' });
  assert.equal(toyota.total, 1);
  assert.equal(toyota.listings[0].make, 'Toyota');
  const all = await listMarketplaceListings(supabase, {});
  assert.equal(all.total, 2);
});

// ---------- Negative: fixtures/demo/incomplete stay out ----------

test('fixture listing is ineligible and hidden from the public marketplace (default mode)', async () => {
  const r = getListingEligibility(fixtureListing);
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes('fixture_excluded'));
  assert.notEqual(getFixtureExclusion(fixtureListing), null);
  const supabase = buildMockSupabase({ vehicles: [fixtureListing] });
  const { total } = await listMarketplaceListings(supabase, {});
  assert.equal(total, 0); // hidden because all rows are fixtures
});

test('fixture VIN / seed owner / default tenant / import_source=Test / invalid VIN all rejected', () => {
  assert.ok(getListingEligibility({ ...realPrivateListing, vin: 'VIN_REF_1' }).reasons.includes('invalid_vin_format'));
  assert.ok(getListingEligibility({ ...realPrivateListing, owner_id: 'u3' }).reasons.includes('seed_owner_id'));
  assert.ok(getListingEligibility({ ...realDealerListing, tenant_id: '00000000-0000-0000-0000-000000000001' }).reasons.includes('seed_tenant_id'));
  assert.ok(getListingEligibility({ ...realPrivateListing, import_source: 'Test' }).reasons.includes('invalid_import_source'));
  assert.ok(getListingEligibility({ ...realPrivateListing, vin: '1HGBH41JXMN10918' }).reasons.includes('invalid_vin_format')); // 16 chars
});

test('a real row survives the production fixture filter; a fixture row does not', () => {
  assert.equal(filterVisibleVehicles([realPrivateListing], { showFixtures: false }).length, 1);
  assert.equal(filterVisibleVehicles([fixtureListing], { showFixtures: false }).length, 0);
});

// ---------- Creation path (service-level) ----------

test('POST /api/vehicles/add candidate: valid private listing is eligible and sets owner_id', () => {
  const candidate = buildVehicleListingCandidate({
    body: { vin: realPrivateListing.vin, make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, import_source: 'Local', registration_country: 'ZW' },
    userContext: { role: 'owner', id: 'usr-1001-real', tenantId: null },
  });
  assert.equal(candidate.owner_id, 'usr-1001-real');
  assert.equal(candidate.current_seller_type, 'Private Owner');
  assert.equal(getListingEligibility(candidate).eligible, true);
});

test('POST /api/vehicles/add candidate: a fixture VIN is ineligible with reason codes', () => {
  const candidate = buildVehicleListingCandidate({
    body: { vin: 'VIN_REF_776997', make: 'Toyota', model: 'Corolla', year: 2018, price: 9500 },
    userContext: { role: 'owner', id: 'usr-1001-real', tenantId: null },
  });
  const r = getListingEligibility(candidate);
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes('invalid_vin_format'));
});
