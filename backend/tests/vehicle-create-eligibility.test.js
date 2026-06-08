import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVehicleListingCandidate,
  getListingEligibility,
} from '../services/marketplace/marketplaceListingEligibility.js';

// Exercises the core logic of POST /api/vehicles/add: building the candidate row from auth context +
// body, then evaluating eligibility. (DB insert, 409 duplicate, and authorizeRole are unchanged in the
// route and not covered here — no supertest harness exists.)

const VIN = '1HGBH41JXMN109186'; // valid 17-char VIN (no I/O/Q)
const ownerCtx = { role: 'owner', id: 'usr-1001', userId: 'usr-1001', tenantId: null };
const dealerCtx = { role: 'dealer', id: 'usr-2002', tenantId: 'a1b2c3d4-1111-2222-3333-444455556666' };
const adminCtx = { role: 'admin', id: 'usr-admin', tenantId: null };
const baseBody = { vin: VIN, make: 'Toyota', model: 'Hilux', year: 2021, price: 25000, registration_country: 'ZW' };

const candidate = (userContext, body = {}) => buildVehicleListingCandidate({ body: { ...baseBody, ...body }, userContext });
const reasonsFor = (userContext, body = {}) => getListingEligibility(candidate(userContext, body)).reasons;

// 1
test('valid real private listing is eligible; owner_id set, private seller type', () => {
  const c = candidate(ownerCtx, { import_source: 'Local' });
  assert.equal(c.owner_id, 'usr-1001');
  assert.equal(c.tenant_id, null);
  assert.equal(c.current_seller_type, 'Private Owner');
  const r = getListingEligibility(c);
  assert.equal(r.eligible, true, JSON.stringify(r.reasons));
});

// 2
test('valid real dealer listing is eligible; tenant from context, dealer seller type', () => {
  const c = candidate(dealerCtx, { import_source: 'Japan' });
  assert.equal(c.tenant_id, dealerCtx.tenantId);
  assert.equal(c.owner_id, null);
  assert.equal(c.current_seller_type, 'Dealer');
  assert.equal(getListingEligibility(c).eligible, true);
});

// 4 / 5 / 6 / 7 — VIN rejections
test('VIN_REF_* is rejected', () => assert.ok(reasonsFor(ownerCtx, { vin: 'VIN_REF_776997' }).includes('invalid_vin_format')));
test('VIN_INT_* is rejected', () => assert.ok(reasonsFor(ownerCtx, { vin: 'VIN_INT_081059' }).includes('invalid_vin_format')));
test('16-char VIN is rejected', () => assert.ok(reasonsFor(ownerCtx, { vin: '1HGBH41JXMN10918' }).includes('invalid_vin_format')));
test('VIN with I/O/Q is rejected', () => assert.ok(reasonsFor(ownerCtx, { vin: '1HGBH41JIMN109186' }).includes('invalid_vin_format')));

// 8 / 9 — placeholder make/model
test("make='Test' is rejected", () => assert.ok(reasonsFor(ownerCtx, { make: 'Test' }).includes('placeholder_make')));
test("model='Test' is rejected", () => assert.ok(reasonsFor(ownerCtx, { model: 'Test' }).includes('placeholder_model')));

// 10 — price
test('price <= 0 is rejected (negative reaches eligibility; 0 is caught by the route required-field check)', () => {
  assert.ok(reasonsFor(ownerCtx, { price: -5 }).includes('invalid_price'));
});

// 11 — year
test('future/old year is rejected', () => {
  assert.ok(reasonsFor(ownerCtx, { year: 3000 }).includes('invalid_year'));
  assert.ok(reasonsFor(ownerCtx, { year: 1900 }).includes('invalid_year'));
});

// 12 — import_source
test("import_source='Test' is rejected", () => assert.ok(reasonsFor(ownerCtx, { import_source: 'Test' }).includes('invalid_import_source')));

// 13 — registration_country default preserved
test('omitted registration_country defaults to ZW (preserved) and is NOT rejected', () => {
  const c = candidate(ownerCtx, { registration_country: undefined });
  assert.equal(c.registration_country, 'ZW');
  assert.equal(getListingEligibility(c).reasons.includes('missing_registration_country'), false);
});

// 14 / 15 — ownership mapping
test('owner listing sets vehicles.owner_id from auth context', () => assert.equal(candidate(ownerCtx).owner_id, 'usr-1001'));
test('dealer listing sets tenant_id from auth context', () => assert.equal(candidate(dealerCtx).tenant_id, dealerCtx.tenantId));

// 16 — stable reason codes in error result
test('eligibility result exposes stable reason codes', () => {
  const r = getListingEligibility(candidate(ownerCtx, { vin: 'VIN_REF_1', make: 'Test' }));
  assert.equal(r.eligible, false);
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
  assert.ok(r.reasons.includes('invalid_vin_format'));
  assert.ok(r.reasons.includes('placeholder_make'));
});

// import_source default
test('import_source defaults to Local when omitted (and stays eligible)', () => {
  const c = candidate(ownerCtx, { import_source: undefined });
  assert.equal(c.import_source, 'Local');
  assert.equal(getListingEligibility(c).eligible, true);
});

// admin — orphan rejected / explicit context accepted (known-limitation coverage)
test('admin listing with no owner/tenant context is rejected (no orphan public listing)', () => {
  const r = reasonsFor(adminCtx, {});
  assert.ok(r.includes('missing_owner_for_private_listing') || r.includes('missing_tenant_for_dealer_listing'));
  assert.equal(getListingEligibility(candidate(adminCtx, {})).eligible, false);
});

test('admin listing with an explicit real owner_id is eligible', () => {
  const c = candidate(adminCtx, { owner_id: 'usr-9001', current_seller_type: 'Private Owner' });
  assert.equal(c.owner_id, 'usr-9001');
  assert.equal(getListingEligibility(c).eligible, true);
});

// dealer against the only-seeded (default) tenant is correctly blocked until a real tenant exists
test('dealer with the default/seed tenant is rejected (real tenant required)', () => {
  const c = buildVehicleListingCandidate({ body: baseBody, userContext: { role: 'dealer', id: 'u9', tenantId: '00000000-0000-0000-0000-000000000001' } });
  assert.ok(getListingEligibility(c).reasons.includes('seed_tenant_id'));
});
