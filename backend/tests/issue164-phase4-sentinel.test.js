/**
 * Issue #164 — Canonical Vehicle Truth Closure, PHASE 4 ENFORCEABILITY SENTINEL.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 * Phase 4 removed eight fabricated values from CarUp's public surfaces. An independent
 * re-certification then put each one BACK, one at a time, and ran the whole backend suite. All
 * eight survived green. A removal that nothing can hold shut is a description of one commit, not a
 * guarantee about the next one, so this file is the guard that closes them.
 *
 * The eight, exactly as the re-certifier reintroduced them:
 *
 *   M2   listingSummaryService        `location: 'Zimbabwe'` on every marketplace card
 *   M3   listingSummaryService        `locally_used` re-derived from the BARE registration column
 *   M4   marketplaceListingEligibility `registration_country: 'ZW'` substituted on write
 *   M5   marketplaceListingEligibility `import_source: 'Local'` substituted on write
 *   M7   marketplacePartsService      `supplier_label || 'Verified supplier'`
 *   M8   marketplacePartsService      `location || 'Zimbabwe'` on the service card
 *   M9   marketplacePricingService    `currency || 'USD'`
 *   M11  server.js buildVehiclePassport  the passport re-publishing the DB-defaulted registration
 *                                        columns as bare values
 *
 * ── HOW IT ASSERTS ───────────────────────────────────────────────────────────────────────────
 * BEHAVIOURALLY, not by reading source text. Every assertion below is about a body a REAL shipped
 * function or a REAL shipped HTTP handler actually produced:
 *
 *   · the marketplace list, the listing detail, the vehicle passport and the listing-create
 *     endpoint are driven over HTTP against the real Express app (NODE_ENV=test → no app.listen,
 *     the x-user-id fallback stands in for a session) with an in-memory Supabase, exactly as
 *     backend/tests/issue164-phase4-seller-location.test.js already does;
 *   · the parts and service card builders are called directly, because
 *     GET /api/marketplace/parts and /services return a governed EMPTY inventory by design — there
 *     is no row for an HTTP drive to carry, so the shipped builder itself is the reachable
 *     behaviour. Nothing about that assertion is source-text: it is the object the builder returns.
 *
 * Two complementary kills are applied to every fabrication, because either one alone can be
 * side-stepped by a differently-shaped restoration:
 *
 *   1. A NAMED FIELD ASSERTION — `location` is null, `currency` is null, `condition_category` is
 *      'unknown', the bare column is absent from the passport. This survives a fabrication
 *      reintroduced in a composed form (`… || 'Zimbabwe'`, `${city}, Zimbabwe`).
 *   2. A WHOLE-BODY SENTINEL SCAN — the fabricated literal must not appear as the value of ANY
 *      leaf, at any depth, anywhere in the response. This survives a fabrication reintroduced at a
 *      different key, or laundered into a second field (which is exactly what M3 did: an invented
 *      country became an invented condition, which became an invented sentence).
 *
 * ── ANTI-VACUITY ─────────────────────────────────────────────────────────────────────────────
 * A scan that finds nothing and a scan that scans nothing are the same green tick. So:
 *   · the leaf walker is asserted to extract a non-trivial corpus from a real payload, and is run
 *     against a payload with a planted sentinel that it must flag;
 *   · every fabrication has a POSITIVE twin — a row where the fact IS recorded (with provenance
 *     where the contract demands it) and the same field must therefore carry the real value. That
 *     twin is what proves each guard is measuring a read rather than a constant null. Delete the
 *     read and the positive twin fails; restore the fabrication and the negative fails. There is
 *     no state of the code that passes both while lying.
 */
import test, { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  CLAIM_VISIBILITY,
  FIELD_STATES,
} from '../utils/publicVehicleProjection.js';
import {
  buildMarketplaceListingSummary,
  deriveConditionCategory,
} from '../services/marketplace/listingSummaryService.js';
import { buildVehicleListingCandidate } from '../services/marketplace/marketplaceListingEligibility.js';
import { buildPartSummary, buildServiceSummary } from '../services/marketplace/marketplacePartsService.js';
import {
  ESTIMATE_DENOMINATION,
  buildPricingSummary,
} from '../services/marketplace/marketplacePricingService.js';

// ===========================================================================================
// 0. THE LEAF WALKER — how a whole-body sentinel scan is performed
// ===========================================================================================

/**
 * Every leaf of a payload as `[dottedPath, value]`.
 *
 * A leaf is anything that is not a plain object or array, so `null`, numbers, booleans and strings
 * are all reported with the path they sit at. Cycles are tolerated (a payload that references
 * itself is a bug elsewhere, not a reason for this guard to hang).
 */
function leafEntries(payload) {
  const out = [];
  const seen = new WeakSet();
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') {
      out.push([path || '<root>', node]);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(payload, '');
  return out;
}

/**
 * Paths where a forbidden literal is published as a WHOLE leaf value.
 *
 * Exact equality, not substring: `'CVR'` must not match the operator-authored timeline label
 * "CVR Registration", and a precise scan is what lets this run over an entire response body
 * without an allow-list of prose. Composed restorations are caught by the named-field assertions
 * that accompany every call to this, and by `fabricatedSubstrings` where the literal is one that
 * cannot legitimately appear inside any sentence these endpoints emit.
 *
 * @param {*} payload any JSON-shaped body
 * @param {string[]} forbidden literal values that must not be published
 * @param {{allow?: string[]}} [options] exact paths where the literal is legitimate, each of which
 *   must be justified at the call site — an allow-list entry is how a guard quietly dies.
 */
function fabricatedLeaves(payload, forbidden, options) {
  const allow = new Set(options?.allow ?? []);
  const banned = new Set(forbidden);
  return leafEntries(payload)
    .filter(([, value]) => typeof value === 'string' && banned.has(value))
    .filter(([path]) => !allow.has(path))
    .map(([path, value]) => `${path} = ${JSON.stringify(value)}`);
}

/**
 * Paths where a forbidden literal appears ANYWHERE INSIDE a string leaf.
 *
 * Used only for literals that no legitimate sentence on these surfaces contains — 'Zimbabwe',
 * 'locally used' and 'Verified supplier'. It is the scan that catches a fabrication laundered into
 * free text, which is how M3's invented country became the invented clause
 * "2019 Toyota Hilux — locally used" on the detail page.
 */
function fabricatedSubstrings(payload, forbidden, options) {
  const allow = new Set(options?.allow ?? []);
  return leafEntries(payload)
    .filter(([path, value]) => typeof value === 'string' && !allow.has(path)
      && forbidden.some((needle) => value.toLowerCase().includes(needle.toLowerCase())))
    .map(([path, value]) => `${path} = ${JSON.stringify(value)}`);
}

test('ANTI-VACUITY: the leaf walker reaches every depth of a REAL card and reports what it finds', () => {
  // Walked over a card the shipped builder actually produced, not a hand-made stub: a scan that
  // finds nothing and a scan that scans nothing are the same green tick, and the only way to tell
  // them apart is to show the walker reaching the real payload's deepest leaves.
  const entries = leafEntries(buildMarketplaceListingSummary({
    vehicle: { ...RECORDED_ROW },
    imageRows: [{ image_url: 'https://example.test/a.jpg', is_primary: true, display_order: 0 }],
  }));
  const paths = entries.map(([path]) => path);

  assert.ok(paths.includes('location'), 'the top-level card fields must be reached');
  assert.ok(
    paths.includes('claims.location.city.value'),
    'the walker must descend to the leaves of a nested claim block, which is where a laundered value hides',
  );
  assert.ok(
    paths.includes('marketplace_tags[0]'),
    'and through arrays, which is where a fabricated tag would sit',
  );
  assert.ok(entries.length >= 40, `the walker must extract a non-trivial corpus, got ${entries.length} leaves`);
});

test('ANTI-VACUITY: the sentinel scans flag a planted fabrication and nothing else', () => {
  const clean = { location: null, note: 'Meet in a public place.', nested: [{ label: 'Harare' }] };
  assert.deepEqual(fabricatedLeaves(clean, ['Zimbabwe']), []);
  assert.deepEqual(fabricatedSubstrings(clean, ['Zimbabwe']), []);

  const planted = { location: null, nested: [{ label: 'Zimbabwe' }] };
  assert.deepEqual(fabricatedLeaves(planted, ['Zimbabwe']), ['nested[0].label = "Zimbabwe"']);

  // Exact-equality must NOT fire on a legitimate longer string; substring scanning must.
  const composed = { seller: { location: 'Harare, Zimbabwe' } };
  assert.deepEqual(fabricatedLeaves(composed, ['Zimbabwe']), [],
    'the exact scan is deliberately precise — the substring scan is what catches a composed value');
  assert.deepEqual(fabricatedSubstrings(composed, ['Zimbabwe']), ['seller.location = "Harare, Zimbabwe"']);

  // A whole-word literal that legitimately occurs inside prose is only ever scanned exactly.
  const prose = { price_warnings: ['Fixed cost components are denominated in USD.'], currency: null };
  assert.deepEqual(fabricatedLeaves(prose, ['USD']), [],
    'USD inside a sentence is a disclosure about our own constants, not a currency claim about the listing');
});

// ===========================================================================================
// 1. THE ROWS
//
// FABRICATED_STAGING_ROW is a public.vehicles row exactly as staging holds one today: the four
// registration columns filled by their DB DEFAULTs with nobody behind them, no `*_source` column
// on the table at all, no location columns, and no classified condition category. This is the
// input every negative assertion below is made against — the shape the whole phase exists to
// answer honestly.
//
// `vehicle_condition_category` is deliberately ABSENT rather than set to 'unknown': the schema's
// own absence marker short-circuits deriveConditionCategory on its first line, which would make
// every M3 assertion vacuously green while the derivation it guards was never reached.
// ===========================================================================================

const VIN = '1HGCM82633A004352';
const OWNER_ID = 'usr-1001';

const FABRICATED_STAGING_ROW = Object.freeze({
  vin: VIN,
  owner_id: OWNER_ID,
  tenant_id: null,
  make: 'Toyota',
  model: 'Hilux',
  year: 2019,
  price: 25000,
  currency: null,
  mileage: 84000,
  fuel_type: 'Diesel',
  transmission: 'Manual',
  status: 'Available',
  publication_status: 'published',
  created_at: '2026-01-04T09:00:00.000Z',
  current_seller_type: 'Private Owner',
  public_seller_display_enabled: false,
  // ── The four DB DEFAULTs. 16 of 16 staging rows carry these; zero application writers put
  // them there, and not one of them has a `*_source` companion on the table today.
  registration_country: 'ZW',
  registration_authority: 'CVR',
  registration_status: 'Current',
  plate_status: 'Active',
  // The write path's fifth substitution, in the column where it landed.
  import_source: 'local',
});

/** The same car, with every fact ACTUALLY STATED by somebody. The positive twin of the row above. */
const RECORDED_ROW = Object.freeze({
  ...FABRICATED_STAGING_ROW,
  currency: 'ZWG',
  // `public.vehicles.currency` carries its own DB DEFAULT of 'USD' (16 of 16 staging rows, zero
  // NULLs), so the read path gates it on provenance exactly as it gates the registration columns.
  // The source is supplied here so the POSITIVE twins measure a published claim rather than an
  // ungated column read.
  currency_source: 'seller_declared',
  listing_city: 'Bulawayo',
  listing_province: 'Bulawayo Province',
  listing_country: 'ZW',
  listing_location_source: 'seller_declared',
  listing_location_visibility: CLAIM_VISIBILITY.PUBLIC,
  registration_country_source: 'seller_declared',
  registration_authority_source: 'registry_verified',
  registration_status_source: 'registry_verified',
  plate_status_source: 'registry_verified',
  current_seller_type_source: 'seller_declared',
});

// ===========================================================================================
// 2. THE PURE BUILDERS, CALLED DIRECTLY
//
// These are the shipped functions themselves, exercised against the two rows above. The HTTP
// sections that follow drive the same code through the real handlers; both are kept because a
// route can be rewired while the builder rots, and a builder can be replaced while the route
// starts fabricating on its own.
// ===========================================================================================

describe('the marketplace card — what a listing may say about where a vehicle is', () => {
  it('a marketplace card never invents a location for a vehicle with none', () => {
    const summary = buildMarketplaceListingSummary({ vehicle: { ...FABRICATED_STAGING_ROW } });

    assert.equal(summary.location, null,
      "M2: `location: 'Zimbabwe'` was printed on every card for a row that carries no location at all");
    assert.equal(summary.location_state, FIELD_STATES.NOT_RECORDED,
      'and the card must say WHY there is no location, so a consumer can tell absence from withholding');
    assert.deepEqual(fabricatedSubstrings(summary, ['Zimbabwe']), [],
      'no field of the card may name a country nobody recorded — at any key, composed or whole');
  });

  it('POSITIVE TWIN: a card publishes the location that WAS recorded, so the guard measures a read and not a constant null', () => {
    const summary = buildMarketplaceListingSummary({ vehicle: { ...RECORDED_ROW } });

    assert.equal(summary.location, 'Bulawayo, Bulawayo Province, ZW',
      'a recorded, seller-declared, published location is composed from its recorded parts');
    assert.equal(summary.location_state, FIELD_STATES.RECORDED);
  });

  it('a location recorded WITHOUT the seller consenting to publish it is withheld, not replaced by a country', () => {
    const summary = buildMarketplaceListingSummary({
      vehicle: { ...RECORDED_ROW, listing_location_visibility: CLAIM_VISIBILITY.WITHHELD },
    });
    assert.equal(summary.location, null);
    assert.equal(summary.location_state, FIELD_STATES.WITHHELD,
      'withheld and not_recorded stay distinguishable — collapsing them makes absence read as proof');
    assert.deepEqual(fabricatedSubstrings(summary, ['Zimbabwe', 'Bulawayo']), [],
      'a withheld location must disclose neither a substitute nor the value it is hiding');
  });
});

describe('the condition category — what a listing may infer from a column nobody wrote', () => {
  it("a vehicle is never called 'locally used' on the strength of a registration country nobody stated", () => {
    // M3. The branch used to read `vehicle.registration_country` as a bare column. That column
    // carries a DB DEFAULT of 'ZW', so the inference fired on 13 of 16 staging rows and turned one
    // invented value into a second one that no longer looks like a column at all.
    const derived = deriveConditionCategory({ ...FABRICATED_STAGING_ROW });
    assert.equal(derived, 'unknown',
      "'ZW' with no `registration_country_source` is a value with no author, and an inference drawn from it is fabricated too");

    const summary = buildMarketplaceListingSummary({ vehicle: { ...FABRICATED_STAGING_ROW } });
    assert.equal(summary.condition_category, 'unknown');
    assert.deepEqual(fabricatedSubstrings(summary, ['locally_used', 'locally used']), [],
      'and the invented category must not reappear at any other key, including a marketplace tag');
  });

  it('POSITIVE TWIN: a registration country somebody actually declared DOES yield locally_used, so the branch is alive', () => {
    // Without this, `condition_category === 'unknown'` would pass just as well against a
    // deriveConditionCategory that had lost the branch entirely — a guard that cannot tell a
    // closed fabrication from a deleted feature is not guarding anything.
    assert.equal(deriveConditionCategory({ ...RECORDED_ROW }), 'locally_used');
    assert.equal(
      buildMarketplaceListingSummary({ vehicle: { ...RECORDED_ROW } }).condition_category,
      'locally_used',
    );
  });

  it('an unrecognised provenance fails closed rather than promoting the default into an inference', () => {
    const derived = deriveConditionCategory({
      ...FABRICATED_STAGING_ROW,
      registration_country_source: 'looks_about_right',
    });
    assert.equal(derived, 'unknown',
      'a source outside CLAIM_SOURCES is not a smaller claim; it is not a claim, so nothing may be inferred from the value it accompanies');
  });
});

describe('the pricing estimator — what a price may be denominated in', () => {
  it('a pricing summary never names a currency the seller did not state', () => {
    // M9. `listingSummary.currency || 'USD'` re-invented a currency one level below a read path
    // that publishes null, so a single detail body answered "what currency is this?" twice and
    // differently.
    const pricing = buildPricingSummary({
      listingSummary: { price: 25000, currency: null, currency_source: null, condition_category: 'unknown' },
    });

    assert.equal(pricing.currency, null, "M9: an unrecorded currency must publish as nothing, never as 'USD'");
    assert.equal(pricing.currency_state, FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(
      fabricatedLeaves(pricing, ['USD'], { allow: ['estimate_denomination'] }),
      [],
      "the only permitted 'USD' is `estimate_denomination`, which answers what CARUP'S OWN flat "
      + "constants are quoted in — a fact about this module, not a claim about the listing",
    );
    assert.equal(pricing.estimate_denomination, ESTIMATE_DENOMINATION,
      'and it must be present here, because denominated components ARE published for a priced listing');
    assert.ok(
      pricing.price_warnings.some((warning) => /currency is not recorded/i.test(warning)),
      'the mismatch between our USD constants and an unrecorded listing currency must be stated, not hidden',
    );
  });

  it("the column's own 'USD' default is not a currency claim either — a value with no author is not published", () => {
    // The shape 16 of 16 staging rows are in: `vehicles.currency` DEFAULTs to 'USD', so deleting
    // the application-side `|| 'USD'` alone moved the fabrication into the schema rather than
    // removing it. This is the assertion that stays true whichever half is restored.
    const pricing = buildPricingSummary({
      listingSummary: { price: 25000, currency: 'USD', currency_source: null, condition_category: 'unknown' },
    });
    assert.equal(pricing.currency, null);
    assert.equal(pricing.currency_state, FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(fabricatedLeaves(pricing, ['USD'], { allow: ['estimate_denomination'] }), []);
  });

  it('POSITIVE TWIN: a stated non-USD currency is published verbatim', () => {
    const pricing = buildPricingSummary({
      listingSummary: {
        price: 25000, currency: 'ZWG', currency_source: 'seller_declared', condition_category: 'unknown',
      },
    });
    assert.equal(pricing.currency, 'ZWG');
    assert.equal(pricing.currency_state, FIELD_STATES.RECORDED);
    assert.deepEqual(fabricatedLeaves(pricing, ['USD'], { allow: ['estimate_denomination'] }), []);
  });

  it('an unpriced listing is not handed a costed estimate, and nothing is denominated for it', () => {
    const pricing = buildPricingSummary({
      listingSummary: { price: null, currency: null, currency_source: null, condition_category: 'unknown' },
    });
    assert.equal(pricing.asking_price, null);
    assert.equal(pricing.asking_price_state, FIELD_STATES.NOT_RECORDED);
    assert.equal(pricing.currency, null);
    assert.equal(pricing.estimate_denomination, undefined,
      "naming a currency where no cost figure exists would put 'USD' into the body of a listing whose "
      + 'currency is not recorded — the same defect wearing a different key');
    assert.deepEqual(fabricatedLeaves(pricing, ['USD']), []);
  });
});

describe('the parts and service cards — the sibling public surfaces', () => {
  // GET /api/marketplace/parts and /services return a governed EMPTY inventory by design, so there
  // is no row for an HTTP drive to carry. These call the real shipped builders and assert on the
  // card objects they actually returned; the shapes are forward-looking, which is exactly why the
  // fabrications had to be closed before a single row exists to be described by them.

  it("a part card never claims its supplier is 'verified' to fill in a name we do not hold", () => {
    const card = buildPartSummary({ id: 'p-1', part_name: 'Alternator', price: 120 });

    assert.equal(card.supplier_label, null,
      "M7: `supplier_label || 'Verified supplier'` asserted a VERIFICATION this platform has "
      + 'performed on nobody, on the card of any supplier whose name we simply did not have');
    assert.equal(card.supplier_label_state, FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(fabricatedSubstrings(card, ['Verified supplier', 'verified supplier']), []);
  });

  it('a part card never invents a location or a currency for a part with neither', () => {
    const card = buildPartSummary({ id: 'p-1', part_name: 'Alternator', price: 120 });

    assert.equal(card.location, null, 'M8: the country literal, one table over');
    assert.equal(card.location_state, FIELD_STATES.NOT_RECORDED);
    assert.equal(card.currency, null, 'a number with no currency is not a price');
    assert.equal(card.currency_state, FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(fabricatedSubstrings(card, ['Zimbabwe']), []);
    assert.deepEqual(fabricatedLeaves(card, ['USD']), []);
  });

  it('a service card never invents a location, and never shows a category label where a business name belongs', () => {
    const card = buildServiceSummary({ id: 's-1', service_categories: ['bodywork'] });

    assert.equal(card.location, null, 'M8: the same country literal on the service builder');
    assert.equal(card.location_state, FIELD_STATES.NOT_RECORDED);
    assert.equal(card.display_name, null,
      "'Service provider' described the category this endpoint returns, not the business on the card");
    assert.equal(card.display_name_state, FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(fabricatedSubstrings(card, ['Zimbabwe', 'Service provider']), []);
  });

  it('POSITIVE TWIN: recorded supplier, location, currency and provider name are published verbatim', () => {
    const part = buildPartSummary({
      id: 'p-2', part_name: 'Turbo', price: 900, currency: 'ZWG',
      supplier_label: 'Msasa Spares', location: 'Harare',
    });
    assert.equal(part.supplier_label, 'Msasa Spares');
    assert.equal(part.supplier_label_state, FIELD_STATES.RECORDED);
    assert.equal(part.location, 'Harare');
    assert.equal(part.currency, 'ZWG');

    const service = buildServiceSummary({ id: 's-2', display_name: 'Borrowdale Motors', location: 'Harare' });
    assert.equal(service.display_name, 'Borrowdale Motors');
    assert.equal(service.display_name_state, FIELD_STATES.RECORDED);
    assert.equal(service.location, 'Harare');
  });

  it('a blank supplier, name or location is an absence, not a recorded blank and not a substitute', () => {
    const part = buildPartSummary({ id: 'p-3', supplier_label: '   ', location: '', currency: '  ' });
    assert.equal(part.supplier_label, null);
    assert.equal(part.location, null);
    assert.equal(part.currency, null);
    assert.deepEqual(fabricatedSubstrings(part, ['Zimbabwe', 'Verified supplier']), []);

    const service = buildServiceSummary({ id: 's-3', display_name: '  ', location: '   ' });
    assert.equal(service.display_name, null);
    assert.equal(service.location, null);
    assert.deepEqual(fabricatedSubstrings(service, ['Zimbabwe', 'Service provider']), []);
  });
});

describe('the write path candidate — what an omitted field is allowed to become in a column', () => {
  const BODY = Object.freeze({
    vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2021, price: 25000,
  });
  const CONTEXT = Object.freeze({ role: 'owner', id: OWNER_ID });

  it('a submission that states no registration country stores an explicit unknown, never a substituted country', () => {
    const candidate = buildVehicleListingCandidate({ body: { ...BODY }, userContext: { ...CONTEXT } });

    assert.equal(candidate.registration_country, null,
      "M4: `: 'ZW'` put a country nobody stated into 13 of 16 staging rows, where every read path "
      + 'then published it as a fact');
    assert.equal('registration_country' in candidate, true,
      'and the key must be PRESENT: the column DEFAULTs to ZW, so omitting it moves the same '
      + 'fabrication from the application into the schema, where it is harder to see');
    assert.deepEqual(fabricatedLeaves(candidate, ['ZW', 'Zimbabwe']), []);
  });

  it('a submission that states no import source stores an explicit unknown, never an assumed local sale', () => {
    const candidate = buildVehicleListingCandidate({ body: { ...BODY }, userContext: { ...CONTEXT } });

    assert.equal(candidate.import_source, null,
      "M5: `: 'Local'` was written for every seller who said nothing about import, and the "
      + 'marketplace then read it back as a stated fact');
    assert.equal('import_source' in candidate, true);
    assert.deepEqual(fabricatedLeaves(candidate, ['Local', 'local']), []);
  });

  it('POSITIVE TWIN: a registration country and import source the seller DID state are stored verbatim', () => {
    const candidate = buildVehicleListingCandidate({
      body: { ...BODY, registration_country: 'ZA', import_source: 'import' },
      userContext: { ...CONTEXT },
    });
    assert.equal(candidate.registration_country, 'ZA',
      'the defect was the substitution, not the column — a stated country is still recorded');
    assert.equal(candidate.import_source, 'import');
  });

  it('a blank or whitespace-only submission is an absence, not a recorded blank', () => {
    const candidate = buildVehicleListingCandidate({
      body: { ...BODY, registration_country: '   ', import_source: '' },
      userContext: { ...CONTEXT },
    });
    assert.equal(candidate.registration_country, null);
    assert.equal(candidate.import_source, null);
  });
});

// ===========================================================================================
// 3. THE REAL HTTP SURFACES
//
// Everything above is the builder. This is the body a client actually receives. The two are kept
// separate on purpose: M2 and M11 are defects of what a RESPONSE carried, and a response is
// assembled by a route, a projection and a builder acting together.
// ===========================================================================================

describe('the public HTTP surfaces — the bodies a client actually receives', () => {
  let app;
  let supabase;
  let server;
  let baseUrl;

  /** The rows the in-memory database holds for this test. */
  let vehicles;
  /** Every `vehicles` insert the handler attempted. */
  let vehicleInsertAttempts;
  /** The platform role the mocked `users` row reports for the calling id. */
  let callerRole;

  function reset() {
    vehicles = [];
    vehicleInsertAttempts = [];
    callerRole = 'owner';
  }

  /**
   * The in-memory Supabase. Deliberately generous: anything this suite does not model returns an
   * empty result rather than throwing, so a passport read still exercises the whole assembly
   * (timeline, evidence, ledger, canonical trust) without a database. The tables that MATTER —
   * `vehicles` and `users` — are modelled precisely, because the fabrications live in what those
   * two rows become.
   */
  function handle(op) {
    if (op.table === 'users') {
      // The seller's own name. Resolved so `claims.seller.display_label` can tell a withholding
      // from an absence; whether it is PUBLISHED is the consent flag's business, not this row's.
      return { data: { id: OWNER_ID, name: 'Jane Owner', role: callerRole, is_verified: true }, error: null };
    }
    if (op.table === 'tenant_users') return { data: { role: callerRole }, error: null };

    if (op.table === 'vehicles') {
      if (op.action === 'insert') {
        const row = Array.isArray(op.payload) ? op.payload[0] : op.payload;
        vehicleInsertAttempts.push(row);
        vehicles.push({ ...row });
        return { data: null, error: null };
      }
      if (op.action === 'update') return { data: null, error: null };
      const matched = vehicles.filter((row) => Object.entries(op.filters)
        .every(([key, value]) => row[key] === value));
      if (op.single) {
        if (matched.length) return { data: matched[0], error: null };
        // `.single()` reports "no rows" as an error; `.maybeSingle()` resolves it to a null row with
        // no error (postgrest-js enforces cardinality client-side and raises PGRST116 only for MORE
        // than one row). Conflating them turned a correct maybeSingle caller into a 500.
        return op.maybeSingle
          ? { data: null, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: matched, error: null, count: matched.length };
    }

    if (op.single) {
      return op.maybeSingle
        ? { data: null, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    return { data: [], error: null, count: 0 };
  }

  function installSupabaseMock() {
    supabase.from = (table) => {
      const op = { table, action: 'select', filters: {}, payload: null, single: false };
      const declared = {
        select() { return proxy; },
        insert(payload) { op.action = 'insert'; op.payload = payload; return proxy; },
        upsert(payload) { op.action = 'insert'; op.payload = payload; return proxy; },
        update(payload) { op.action = 'update'; op.payload = payload; return proxy; },
        delete() { op.action = 'delete'; return proxy; },
        eq(key, value) { op.filters[key] = value; return proxy; },
        maybeSingle() { op.single = true; op.maybeSingle = true; return proxy; },
        single() { op.single = true; return proxy; },
        then(onFulfilled, onRejected) { return Promise.resolve(handle(op)).then(onFulfilled, onRejected); },
      };
      // Every OTHER PostgREST builder method (`in`, `gt`, `order`, `limit`, `not`, …) is a
      // no-op that returns the chain. A Proxy rather than a hand-written list on purpose: a
      // hand-written list turns "a shipped read grew a filter" into a 500 inside this harness,
      // which reads as a fabrication guard failing when it is only the mock that is behind.
      const proxy = new Proxy(declared, {
        get(target, property) {
          if (property in target) return target[property];
          if (typeof property === 'symbol') return undefined;
          return () => proxy;
        },
      });
      return proxy;
    };
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-key';
    reset();
    ({ app } = await import('../server.js'));
    ({ supabase } = await import('../db/supabase.js'));
    installSupabaseMock();
    await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });
  beforeEach(reset);

  async function get(path, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { 'x-bypass-rate-limit': 'true', ...headers },
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  async function post(path, body, { userId = OWNER_ID, tenantId = null } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'x-bypass-rate-limit': 'true',
      'x-user-id': userId,
    };
    if (tenantId) headers['x-tenant-id'] = tenantId;
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  // -- M2 / M3 over the real marketplace routes -------------------------------------------------

  it('GET /api/marketplace/listings: no card in the response names a country for a vehicle with no recorded location', async () => {
    vehicles = [{ ...FABRICATED_STAGING_ROW }];
    const { status, body } = await get('/api/marketplace/listings');

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.listings.length, 1, 'the fixture row must actually reach the response — an empty page proves nothing');
    assert.equal(body.listings[0].location, null,
      "M2: this is the defect that named the phase — `location: 'Zimbabwe'` on every card");
    assert.equal(body.listings[0].location_state, FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(fabricatedSubstrings(body, ['Zimbabwe']), [],
      'and not at any other key of the whole page body either');
  });

  it('GET /api/marketplace/listings: no card is classified from a registration country nobody stated', async () => {
    vehicles = [{ ...FABRICATED_STAGING_ROW }];
    const { body } = await get('/api/marketplace/listings');

    assert.equal(body.listings[0].condition_category, 'unknown',
      'M3: the bare `registration_country` column carries a DB DEFAULT, and an inference from it is fabricated too');
    assert.deepEqual(fabricatedSubstrings(body, ['locally_used', 'locally used']), []);
  });

  it('POSITIVE TWIN over HTTP: a card with recorded location and provenance publishes both', async () => {
    vehicles = [{ ...RECORDED_ROW }];
    const { body } = await get('/api/marketplace/listings');

    assert.equal(body.listings[0].location, 'Bulawayo, Bulawayo Province, ZW');
    assert.equal(body.listings[0].location_state, FIELD_STATES.RECORDED);
    assert.equal(body.listings[0].condition_category, 'locally_used',
      'the derivation is reachable over HTTP too, so the negative above measures provenance and not a dead branch');
  });

  it('GET /api/marketplace/listings/:vin: the detail page invents neither a location, a country, a condition nor a currency', async () => {
    vehicles = [{ ...FABRICATED_STAGING_ROW }];
    const { status, body } = await get(`/api/marketplace/listings/${VIN}`);

    assert.equal(status, 200, JSON.stringify(body));

    // M2, on the surface a shopper reads most closely. `location || 'Zimbabwe'` and a bare
    // `country: 'ZW'` literal both lived in the seller block.
    assert.equal(body.location, null);
    assert.equal(body.seller_summary.location, null);
    assert.equal(body.seller_summary.location_state, FIELD_STATES.NOT_RECORDED);
    assert.equal('country' in body.seller_summary, false,
      "the seller block's `country: 'ZW'` was a literal no column ever fed");
    assert.deepEqual(fabricatedSubstrings(body, ['Zimbabwe']), []);

    // M3, including the laundered sentence form: "2019 Toyota Hilux — locally used".
    assert.equal(body.condition_category, 'unknown');
    assert.equal(body.short_description, '2019 Toyota Hilux',
      'the sentence loses the clause rather than gaining a lie');
    assert.deepEqual(fabricatedSubstrings(body, ['locally_used', 'locally used']), []);

    // M9, at both levels of the same body — the defect was that they could disagree.
    assert.equal(body.currency, null);
    assert.equal(body.pricing_summary.currency, null);
    assert.equal(body.pricing_summary.currency_state, FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(
      fabricatedLeaves(body, ['USD'], { allow: ['pricing_summary.estimate_denomination'] }),
      [],
      "the only 'USD' a body may carry is the declared denomination of CarUp's own flat constants",
    );

    // M4 / M5 read back: the substituted country and import source must not surface here either.
    assert.deepEqual(fabricatedLeaves(body, ['ZW', 'Local'], { allow: [] }), [],
      'the registration DEFAULT and the assumed-local import source are not listing facts');
  });

  it('POSITIVE TWIN over HTTP: the detail page publishes the currency, location and condition that were recorded', async () => {
    vehicles = [{ ...RECORDED_ROW }];
    const { body } = await get(`/api/marketplace/listings/${VIN}`);

    assert.equal(body.currency, 'ZWG');
    assert.equal(body.pricing_summary.currency, 'ZWG');
    assert.equal(body.seller_summary.location, 'Bulawayo, Bulawayo Province, ZW');
    assert.equal(body.condition_category, 'locally_used');
    assert.equal(body.short_description, '2019 Toyota Hilux — locally used',
      'the clause is REAL when a seller declared the country it rests on');
  });

  // -- M11 over the real passport route ---------------------------------------------------------

  it('GET /api/vehicles/:vin/passport: the passport publishes no registration column that only a DB default filled', async () => {
    vehicles = [{ ...FABRICATED_STAGING_ROW }];
    const { status, body } = await get(`/api/vehicles/${VIN}/passport`);

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.vehicle.vin, VIN, 'the passport must actually have rendered this vehicle');

    // M11. These four columns are 'ZW' / 'CVR' / 'Current' / 'Active' on 16 of 16 staging rows
    // with ZERO application writers behind the last three. `import_source` is the same species.
    for (const column of [
      'registration_country', 'registration_authority', 'registration_status', 'plate_status',
      'import_source',
    ]) {
      assert.equal(column in body.vehicle, false,
        `M11: \`vehicle.${column}\` is governed by the claim contract, and a second unstated copy `
        + 'of a governed fact is the same fabrication sitting in a neighbouring object');
    }
    assert.equal('registrationCountry' in body.identity, false,
      'and it must not reappear in `identity`, which is where the second copy lived');

    // The whole body, not just the two objects the columns used to sit in.
    assert.deepEqual(
      fabricatedLeaves(body, ['ZW', 'CVR', 'Current', 'Active', 'local']),
      [],
      'the passport is the surface a shopper trusts most, which makes it the worst place for a value with no author',
    );

    // The claim contract is present and honest about all four, which is what makes the withdrawal
    // above a RELOCATION of the facts rather than a deletion of them.
    for (const field of ['country', 'authority', 'status', 'plate_status']) {
      assert.equal(body.claims.registration[field].state, FIELD_STATES.NOT_RECORDED,
        `claims.registration.${field} must report the absence rather than the default`);
      assert.equal(body.claims.registration[field].value, null);
      assert.equal(body.claims.registration[field].source, null);
    }
  });

  it('POSITIVE TWIN: a registration fact somebody attested IS published by the passport — through the claim, still not as a bare column', async () => {
    vehicles = [{ ...RECORDED_ROW }];
    const { status, body } = await get(`/api/vehicles/${VIN}/passport`);

    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.claims.registration.country, {
      value: 'ZW', state: FIELD_STATES.RECORDED, source: 'seller_declared',
    }, 'provenance is what promotes a value to a publishable claim');
    assert.equal(body.claims.registration.authority.value, 'CVR');

    // AND STILL NOT AS A COLUMN. This is the assertion that proves the guard above is measuring
    // the withdrawal of the bare copy rather than an empty row: the value is present in the body,
    // and it is present exactly once, in the one place that says who asserted it.
    assert.equal('registration_country' in body.vehicle, false);
    assert.equal('registration_authority' in body.vehicle, false);
    const zwLeaves = fabricatedLeaves(body, ['ZW']).map((entry) => entry.split(' = ')[0]);
    assert.deepEqual(zwLeaves.sort(), ['claims.location.country.value', 'claims.registration.country.value'],
      'a governed fact appears once per claim it belongs to, and never as a bare column');
  });

  // -- M4 / M5 over the real listing-create handler ----------------------------------------------

  it('POST /api/vehicles/add: a listing created without a stated registration country stores no country', async () => {
    const { status, body } = await post('/api/vehicles/add', {
      vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2021,
      price: 25000, currency: 'USD', mileage: 42000,
    });

    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(vehicles.length, 1, 'exactly one row must have been written');
    const row = vehicles[0];

    assert.equal(row.registration_country, null,
      'M4: the substituted country reached the column, was selected back, and was published as a fact '
      + 'on the card, in the card sentence, and on the passport');
    assert.equal(row.registration_country_source, null,
      'and there is no author to stamp on a value nobody stated');
    assert.equal(row.import_source, null,
      "M5: `import_source: 'Local'` was the write-side twin of the same defect");
    assert.deepEqual(fabricatedLeaves(row, ['ZW', 'Zimbabwe', 'Local', 'local']), [],
      'no substituted value may reach public.vehicles from this handler');
  });

  it('POSITIVE TWIN over HTTP: a stated registration country and an imported vehicle are stored, with provenance', async () => {
    const { status, body } = await post('/api/vehicles/add', {
      vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2021,
      price: 25000, currency: 'USD', mileage: 42000,
      registration_country: 'ZA', import_status: 'imported',
    });

    assert.equal(status, 201, JSON.stringify(body));
    const row = vehicles[0];
    assert.equal(row.registration_country, 'ZA', 'a country the seller stated is stored verbatim');
    assert.equal(row.registration_country_source, 'seller_declared',
      'and it earns provenance, which is what lets the read contract publish it');
    assert.equal(row.import_source, 'import');
  });

  it('a listing created with no registration country is still ELIGIBLE — the honest resolution is a warning, not a refused sale', async () => {
    // The eligibility gate that used to demand `registration_country` could never fire, because
    // the write path substituted 'ZW' before it ran. Removing the substitution without removing
    // the gate would have converted a fabrication into a refused listing over a fact the column is
    // perfectly able to leave open — so this asserts the outcome, not just the absent value.
    const { status } = await post('/api/vehicles/add', {
      vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2021,
      price: 25000, currency: 'USD', mileage: 42000,
    });
    assert.equal(status, 201);
  });
});
