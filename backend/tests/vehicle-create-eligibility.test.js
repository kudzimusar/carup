import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVehicleListingCandidate,
  getListingEligibility,
} from '../services/marketplace/marketplaceListingEligibility.js';
import { vehicleYearBounds } from '../services/taxonomy/vehicleTaxonomyService.js';

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

// 11 — year: use the platform-wide taxonomy boundary, never a second hard-coded cutoff.
test('year eligibility follows the canonical global taxonomy bounds', () => {
  const { min, max } = vehicleYearBounds();
  assert.ok(reasonsFor(ownerCtx, { year: max + 1 }).includes('invalid_year'));
  assert.ok(reasonsFor(ownerCtx, { year: min - 1 }).includes('invalid_year'));
  assert.equal(reasonsFor(ownerCtx, { year: min }).includes('invalid_year'), false);
});

// 12 — import_source
test("import_source='Test' is rejected", () => assert.ok(reasonsFor(ownerCtx, { import_source: 'Test' }).includes('invalid_import_source')));

// 13 — an omitted registration country is recorded as unknown, not as a plausible country
// ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 ────────────────────────────────────────────────
// WAS: titled 'omitted registration_country defaults to ZW (preserved) and is NOT rejected', with
//   `assert.equal(c.registration_country, 'ZW')`.
//
// WHY THE OLD ASSERTION ENCODED A FABRICATION. The word "preserved" in the old title described a
// value that had never existed to preserve. A seller who said nothing about where the car is
// registered had 'ZW' written into their listing by the server, and 13 of 16 staging rows carry
// the country that produced — published on the marketplace card, in the card's one-line sentence,
// and on the vehicle passport as though a seller had stated it. A plausible value is the one kind
// of wrong answer a reader cannot detect, which is what makes it worse than an empty field. This
// assertion was the substitution's specification: it required the fabrication by name.
//
// THE CORRECTED GUARANTEE. Absence is eligible AND absence is not invented. Both halves matter:
// asserting only "still eligible" would pass with the substitute back in place, and asserting only
// "null" would pass if absence had been made a refusal instead.
test('an omitted registration_country is stored as unknown, is not invented, and is still eligible', () => {
  const c = candidate(ownerCtx, { registration_country: undefined });
  assert.equal(c.registration_country, null, 'no country was stated, so no country is recorded — not even a likely one');
  // THE KEY MUST BE PRESENT. `vehicles.registration_country` carries a DB DEFAULT of 'ZW', so a
  // candidate that merely omits the key hands the same fabrication to PostgreSQL, where it is
  // harder to see and no code review would catch it. The explicit null is the closure.
  assert.equal('registration_country' in c, true,
    'the candidate must carry an explicit null; omitting the key lets the column DEFAULT ZW reinstate the substitute');

  const r = getListingEligibility(c);
  assert.equal(r.eligible, true, `absence must not refuse the listing: ${r.reasons.join(', ')}`);
  assert.equal(r.reasons.includes('missing_registration_country'), false);
  assert.ok(r.warnings.includes('registration_country_absent'),
    'absence is still REPORTED — silently dropping the field would be a quieter version of the same defect');
});

// 13b — ANTI-VACUITY for 13: the write path still records a country that was actually stated, so
// the assertion above measures the removed substitution rather than a field that stopped working.
test('a stated registration_country reaches the candidate verbatim', () => {
  assert.equal(candidate(ownerCtx, { registration_country: 'ZA' }).registration_country, 'ZA');
  assert.equal(candidate(ownerCtx, { registration_country: '  ZW  ' }).registration_country, 'ZW', 'trimmed, not altered');
  assert.equal(candidate(ownerCtx, { registration_country: '   ' }).registration_country, null,
    'whitespace is not a statement; a blank string stored as a value is a recorded blank no later read can undo');
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

// an omitted import origin is recorded as unknown, not as 'Local'
// ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 ────────────────────────────────────────────────
// WAS: titled 'import_source defaults to Local when omitted (and stays eligible)', with
//   `assert.equal(c.import_source, 'Local')`.
//
// WHY THE OLD ASSERTION ENCODED A FABRICATION. "Defaults to Local" is a claim about the car's
// origin, made by the server, on behalf of a seller who said nothing. The marketplace read it back
// and published it as a stated import origin, and the eligibility warning of the day was literally
// spelled `import_source_absent_assumed_local` — the substitution documenting itself. This
// assertion required it: the only way to satisfy `=== 'Local'` is to keep writing 'Local'.
//
// THE CORRECTED GUARANTEE. `import_source` is NULLABLE with no column default, so an unstated
// origin is simply NULL, and it is still eligible — absence is eligible and absence is not
// invented, the same pairing as the registration country above.
test('an omitted import_source is stored as unknown, is not invented, and is still eligible', () => {
  const c = candidate(ownerCtx, { import_source: undefined });
  assert.equal(c.import_source, null, "no origin was stated, so none is recorded — not 'Local', not anything");
  assert.equal('import_source' in c, true,
    'written explicitly rather than omitted: there is no DB default here today, and saying so on purpose keeps it that way');

  const r = getListingEligibility(c);
  assert.equal(r.eligible, true, `an unstated import origin must not refuse the listing: ${r.reasons.join(', ')}`);
  assert.ok(r.warnings.includes('import_source_absent'), 'absence is reported as absence');
  assert.equal(r.warnings.includes('import_source_absent_assumed_local'), false,
    'and never as an assumption — the retired code name asserted a substitution that no longer happens');
  // FOUR SEPARATE FACTS: this body states a registration country ('ZW' via baseBody) and no import
  // origin. Neither may be derived from the other in either direction.
  assert.equal(c.registration_country, 'ZW', 'the stated registration country is untouched by the absent import origin');
  assert.equal(r.warnings.includes('registration_country_absent'), false);
});

// ANTI-VACUITY: a stated import origin still reaches the candidate, so the assertion above measures
// the removed substitution and not a field that has stopped being collected.
test('a stated import_source reaches the candidate verbatim, including a genuine "Local"', () => {
  assert.equal(candidate(ownerCtx, { import_source: 'Japan' }).import_source, 'Japan');
  // The value was never the problem; writing it for a seller who had not said it was.
  assert.equal(candidate(ownerCtx, { import_source: 'Local' }).import_source, 'Local');
  assert.equal(getListingEligibility(candidate(ownerCtx, { import_source: 'Local' })).eligible, true);
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
