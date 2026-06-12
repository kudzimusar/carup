import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStructurallyValidVin,
  normalizeListingInput,
  getListingEligibility,
  getListingIneligibilityReasons,
  assertMarketplaceEligible,
  isRealSellerIdentity,
  isAllowedMarketplaceStatus,
  isAllowedImportSource,
} from '../services/marketplace/marketplaceListingEligibility.js';

// Base real listings (valid VINs: 17 chars, no I/O/Q, no underscore)
const realPrivate = {
  vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2021, price: 25000,
  status: 'Available', owner_id: 'd4e5f6a7-1111-2222-3333-444455556666', tenant_id: null,
  import_source: 'Local', registration_country: 'ZW', current_seller_type: 'Private Owner',
};
const realDealer = {
  vin: '1FMCU0GD9JUA12345', make: 'Ford', model: 'Ranger', year: 2022, price: 30000,
  status: 'Reserved', owner_id: null, tenant_id: 'a1b2c3d4-1111-2222-3333-444455556666',
  import_source: 'Japan', registration_country: 'ZW', current_seller_type: 'Dealer',
};
const P = (over = {}) => ({ ...realPrivate, ...over });
const D = (over = {}) => ({ ...realDealer, ...over });
const reasons = (v) => getListingIneligibilityReasons(v);

// 1
test('valid real private listing passes', () => {
  const r = getListingEligibility(realPrivate);
  assert.equal(r.eligible, true, JSON.stringify(r.reasons));
  assert.deepEqual(r.reasons, []);
});

// 2
test('valid real dealer listing passes', () => {
  const r = getListingEligibility(realDealer);
  assert.equal(r.eligible, true, JSON.stringify(r.reasons));
});

// 3
test('VIN_REF_* fails', () => {
  const r = getListingEligibility(P({ vin: 'VIN_REF_776997' }));
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes('invalid_vin_format'));
});

// 4
test('VIN_INT_* fails', () => {
  assert.ok(reasons(P({ vin: 'VIN_INT_081059' })).includes('invalid_vin_format'));
});

// 5
test('VIN with underscore fails', () => {
  assert.equal(isStructurallyValidVin('1HGBH41JX_N109186'), false);
  assert.ok(reasons(P({ vin: '1HGBH41JX_N109186' })).includes('invalid_vin_format'));
});

// 6
test('VIN with I/O/Q fails', () => {
  assert.equal(isStructurallyValidVin('1HGBH41JIMN109186'), false); // contains I
  assert.equal(isStructurallyValidVin('1HGBH41JOMN109186'), false); // contains O
  assert.equal(isStructurallyValidVin('1HGBH41JQMN109186'), false); // contains Q
  assert.ok(reasons(P({ vin: '1HGBH41JIMN109186' })).includes('invalid_vin_format'));
});

// 7
test('16-character VIN fails', () => {
  assert.equal(isStructurallyValidVin('1HGBH41JXMN10918'), false);
  assert.ok(reasons(P({ vin: '1HGBH41JXMN10918' })).includes('invalid_vin_format'));
});

// 8
test('18-character VIN fails', () => {
  assert.equal(isStructurallyValidVin('1HGBH41JXMN1091866'), false);
  assert.ok(reasons(P({ vin: '1HGBH41JXMN1091866' })).includes('invalid_vin_format'));
});

// 9
test('seed owner_id u3 fails', () => {
  const r = reasons(P({ owner_id: 'u3' }));
  assert.ok(r.includes('seed_owner_id'));
  assert.equal(getListingEligibility(P({ owner_id: 'u3' })).eligible, false);
});

// 10
test('nil/default tenant_id fails', () => {
  const r = reasons(D({ tenant_id: '00000000-0000-0000-0000-000000000001' }));
  assert.ok(r.includes('seed_tenant_id'));
});

// 11
test("make='Test' fails", () => {
  assert.ok(reasons(P({ make: 'Test' })).includes('placeholder_make'));
});

// 12
test("model='Test' fails", () => {
  assert.ok(reasons(P({ model: 'Test' })).includes('placeholder_model'));
});

// 13
test('price <= 0 fails', () => {
  assert.ok(reasons(P({ price: 0 })).includes('invalid_price'));
  assert.ok(reasons(P({ price: -5 })).includes('invalid_price'));
});

// 14
test('year too old fails', () => {
  assert.ok(reasons(P({ year: 1900 })).includes('invalid_year'));
});

// 15
test('year too far future fails', () => {
  assert.ok(reasons(P({ year: 3000 })).includes('invalid_year'));
});

// 16
test("import_source='Test' fails", () => {
  assert.equal(isAllowedImportSource('Test'), false);
  assert.ok(reasons(P({ import_source: 'Test' })).includes('invalid_import_source'));
});

// 17
test('missing registration_country fails', () => {
  assert.ok(reasons(P({ registration_country: '' })).includes('missing_registration_country'));
  assert.ok(reasons(P({ registration_country: undefined })).includes('missing_registration_country'));
});

// 18
test('Sold/Archived listing fails public marketplace eligibility', () => {
  assert.equal(isAllowedMarketplaceStatus('Sold'), false);
  assert.equal(isAllowedMarketplaceStatus('Archived'), false);
  assert.ok(reasons(P({ status: 'Sold' })).includes('non_public_status'));
  assert.ok(reasons(P({ status: 'Archived' })).includes('non_public_status'));
});

// 19
test('Available listing passes status check', () => {
  assert.equal(isAllowedMarketplaceStatus('Available'), true);
  assert.equal(reasons(P({ status: 'Available' })).includes('non_public_status'), false);
});

// 20
test('Reserved listing passes status check', () => {
  assert.equal(isAllowedMarketplaceStatus('Reserved'), true);
  assert.equal(reasons(P({ status: 'Reserved' })).includes('non_public_status'), false);
});

// 21
test('dealer listing with real tenant passes', () => {
  assert.equal(isRealSellerIdentity(realDealer), true);
  assert.equal(getListingEligibility(realDealer).eligible, true);
});

// 22
test('private listing with real owner passes', () => {
  assert.equal(isRealSellerIdentity(realPrivate), true);
  assert.equal(getListingEligibility(realPrivate).eligible, true);
});

// extra coverage: structured result, normalization, assert helper, missing identities
test('result is structured (eligible, reasons, warnings, normalized) and normalizes input', () => {
  const r = getListingEligibility({ ...realPrivate, vin: '  1hgbh41jxmn109186 ', import_source: '' });
  assert.equal(typeof r.eligible, 'boolean');
  assert.ok(Array.isArray(r.reasons) && Array.isArray(r.warnings));
  assert.equal(r.normalized.vin, '1HGBH41JXMN109186'); // trimmed + upper
  assert.ok(r.warnings.includes('import_source_absent_assumed_local'));
});

test('missing owner on a private listing is ineligible; assertMarketplaceEligible throws with reasons', () => {
  assert.ok(reasons(P({ owner_id: null })).includes('missing_owner_for_private_listing'));
  assert.ok(reasons(D({ tenant_id: null })).includes('missing_tenant_for_dealer_listing'));
  assert.throws(() => assertMarketplaceEligible(P({ vin: 'VIN_REF_1' })), (e) => e.code === 'MARKETPLACE_INELIGIBLE' && Array.isArray(e.reasons));
  assert.doesNotThrow(() => assertMarketplaceEligible(realPrivate));
});

test('unknown seller type is flagged', () => {
  assert.ok(reasons(P({ current_seller_type: 'robot' })).includes('unknown_seller_type'));
  assert.equal(reasons(P({ current_seller_type: 'Private Owner' })).includes('unknown_seller_type'), false);
});

test('normalizeListingInput coerces year/price and defaults currency', () => {
  const n = normalizeListingInput({ year: '2020', price: '15000', currency: null });
  assert.equal(n.year, 2020);
  assert.equal(n.price, 15000);
  assert.equal(n.currency, 'USD');
});
