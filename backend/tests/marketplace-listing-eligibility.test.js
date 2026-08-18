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
// ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 ────────────────────────────────────────────────
// WAS: `assert.ok(reasons(P({ registration_country: '' })).includes('missing_registration_country'))`
// for both `''` and `undefined`.
//
// WHY THE OLD ASSERTION ENCODED A FABRICATION. `missing_registration_country` was a reason code
// that could never fire in production: the sole caller of this contract builds its candidate with
// `buildVehicleListingCandidate`, which substituted 'ZW' for every submission that omitted the
// field — so the gate was always satisfied, and it was satisfied BY THE FABRICATION. The test kept
// the code alive by feeding the validator a shape the write path could never produce, which made a
// dead gate look like a live one and made the substitution look necessary to pass it.
//
// THE CORRECTED GUARANTEE. `vehicles.registration_country` is NULLABLE, so the column CAN record
// "not known". Absence is therefore recorded as absence and reported as the WARNING
// `registration_country_absent` — not as ineligibility, which would trade an invented country for
// a refused sale over a fact the schema is perfectly able to leave open. Contrast `year`: NOT NULL
// with no default, cannot hold unknown, so `invalid_year` refuses the write. Same rule, opposite
// outcome, decided by the column rather than by taste.
test('an absent registration_country is a warning, not ineligibility, and no country is invented for it', () => {
  for (const absent of ['', '   ', null, undefined]) {
    const r = getListingEligibility(P({ registration_country: absent }));
    assert.equal(r.eligible, true,
      `an unstated registration country must not refuse the listing (${JSON.stringify(absent)}): ${r.reasons.join(', ')}`);
    assert.ok(r.warnings.includes('registration_country_absent'),
      `absence must still be REPORTED, or it becomes indistinguishable from a stated value (${JSON.stringify(absent)})`);
    // The retired code must not come back under any spelling: a validator that still refuses an
    // absent country would push the write path straight back to substituting one to get past it.
    assert.equal(r.reasons.includes('missing_registration_country'), false,
      'the reason code that only the ZW substitute could satisfy must stay retired');
    // Absence is not turned into a value on the way through normalization either. NOT asserted as
    // `=== null`: `normalizeListingInput` trims, it does not reclassify, so it echoes a blank input
    // back as `''`. A blank is not a manufactured country, and this echo is not the write path —
    // the null-vs-blank decision belongs to `buildVehicleListingCandidate`, which is what actually
    // reaches `public.vehicles` and is pinned in vehicle-create-eligibility.test.js. What must hold
    // HERE is the whole of what this function can promise: no country appears where none was stated.
    assert.equal(String(r.normalized.registration_country ?? '').trim(), '',
      'normalization must not manufacture the country the validator stopped demanding');
  }
});

// 17b — ANTI-VACUITY for 17: the warning tracks the field, it is not simply always on.
test('a stated registration_country produces no absence warning and is preserved verbatim', () => {
  const r = getListingEligibility(P({ registration_country: 'ZA' }));
  assert.equal(r.eligible, true);
  assert.equal(r.warnings.includes('registration_country_absent'), false);
  assert.equal(r.normalized.registration_country, 'ZA',
    'a country the seller DID state survives untouched — the defect was the substitution, not the column');
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
// ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 ────────────────────────────────────────────────
// WAS: `assert.ok(r.warnings.includes('import_source_absent_assumed_local'))`.
//
// WHY THE OLD ASSERTION ENCODED A FABRICATION. THE RENAME IS THE POINT: "assumed_local" WAS the
// fabrication, named out loud in the warning code. The write path stored `import_source: 'Local'`
// for every submission that omitted the field, and this warning was the note recording that it had
// done so — the marketplace then read 'Local' back and published it as a stated import origin.
// Pinning the old spelling made the suite a specification of the substitution: the only way to
// satisfy an assertion that says "assumed local" is to keep assuming local.
//
// THE CORRECTED GUARANTEE. Nothing is assumed. `import_source` is NULLABLE with no column default,
// so an unstated origin is stored NULL, and the honest warning is that the field is ABSENT — full
// stop, with no claim about what it would have been.
test('result is structured (eligible, reasons, warnings, normalized) and normalizes input', () => {
  const r = getListingEligibility({ ...realPrivate, vin: '  1hgbh41jxmn109186 ', import_source: '' });
  assert.equal(typeof r.eligible, 'boolean');
  assert.ok(Array.isArray(r.reasons) && Array.isArray(r.warnings));
  assert.equal(r.normalized.vin, '1HGBH41JXMN109186'); // trimmed + upper
  assert.ok(r.warnings.includes('import_source_absent'),
    'an unstated import origin is reported as absent, and as nothing more than absent');
  assert.equal(r.warnings.includes('import_source_absent_assumed_local'), false,
    'the retired spelling asserted a substitution that no longer happens; reviving it would revive the assumption');
  // As with the registration country above: this echo trims rather than reclassifies, so a blank
  // stays a blank. The guarantee it can make is that no ORIGIN is invented to fill the gap.
  assert.equal(String(r.normalized.import_source ?? '').trim(), '', 'no origin is invented to fill the gap');
  // FOUR SEPARATE FACTS. This fixture states a registration country and no import origin, so
  // exactly one warning may fire. A rewrite that derived either from the other — "registered in ZW
  // therefore imported locally", or the reverse — would trip this.
  assert.equal(r.warnings.includes('registration_country_absent'), false,
    'import origin and registration geography are independent facts; the absence of one says nothing about the other');
});

// ANTI-VACUITY for the above: the absence warning tracks the field rather than firing always, and
// a stated origin is carried through untouched.
test('a stated import_source produces no absence warning and is preserved verbatim', () => {
  const japan = getListingEligibility(P({ import_source: 'Japan' }));
  assert.equal(japan.warnings.includes('import_source_absent'), false);
  assert.equal(japan.normalized.import_source, 'Japan');
  // 'Local' is still a perfectly good ANSWER — the defect was never the value, it was writing the
  // value on behalf of a seller who had not given one.
  const local = getListingEligibility(P({ import_source: 'Local' }));
  assert.equal(local.eligible, true, JSON.stringify(local.reasons));
  assert.equal(local.warnings.includes('import_source_absent'), false);
  assert.equal(local.normalized.import_source, 'Local');
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
