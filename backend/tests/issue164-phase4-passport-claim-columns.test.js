/**
 * Issue #164 Phase 4 — THE PASSPORT'S REMAINING DEFAULT-AUTHORED BUSINESS FACTS.
 *
 * WHY THIS FILE EXISTS. Phase 4 closed `registration_country` / `registration_authority` /
 * `registration_status` / `plate_status` on the vehicle passport, and a mutation that reopened them
 * (CLAIM_GOVERNED_COLUMNS -> []) died. Two facts of the SAME species were still being published bare
 * from the same body, and no mutation covered either:
 *
 *   · `current_seller_type` — DB DEFAULT 'Private Owner', measured 'Private Owner' on 13 of 16
 *     staging rows. Published TWICE: as a column on `vehicle`, and as
 *     `ownershipSummary.currentSellerType`. Withdrawing only the column would have moved the same
 *     string four keys down the same response, camelCased, so both are pinned here.
 *   · `currency` — DB DEFAULT 'USD', measured 'USD' on 16 of 16 staging rows, one distinct value,
 *     zero NULLs. The marketplace summary and the pricing estimator already gate it on
 *     `currency_source`; the passport did not, so the identical fabrication survived on the surface
 *     a shopper trusts most.
 *
 * EVERY TEST BELOW EXECUTES THE SHIPPED buildVehiclePassport SOURCE — not a copy, not a
 * reimplementation — against the LIVE STAGING SHAPE (column defaults present, migration unapplied,
 * so no `*_source` column exists on the row at all) and against a POSITIVE TWIN carrying provenance.
 * The twin is not optional: `currency === null` alone is satisfied by deleting the field, which would
 * cost every genuinely-declared currency its publication and would look like a pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FIELD_STATES, attestedValue, projectVehicle, toListingClaims,
  toPublicEvidence, toPublicPlateHistory, toPublicTimelineEvent,
} from '../utils/publicVehicleProjection.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function sliceBalanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced braces');
}

/** Source text of `async function buildVehiclePassport(...) { ... }`. */
function buildVehiclePassportSource() {
  const declIdx = serverSrc.indexOf('async function buildVehiclePassport');
  assert.ok(declIdx > -1, 'buildVehiclePassport must still exist in server.js');
  const braceIdx = serverSrc.indexOf('{', serverSrc.indexOf(')', declIdx));
  return serverSrc.slice(declIdx, braceIdx) + sliceBalanced(serverSrc, braceIdx);
}

/**
 * The SAME fixed 11-name dependency list backend/tests/issue164-phase0-public-projection.test.js
 * uses. Kept identical on purpose: if a change to buildVehiclePassport ever needs a twelfth free
 * module-scope name, BOTH harnesses must be told, and having two of them makes that impossible to
 * miss. Collaborators the passport composes over (`canonicalTrust`, `listingClaimContract`,
 * `attestClaim`) are PARAMETERS rather than free names precisely so this list does not grow.
 */
const PASSPORT_DEPENDENCIES = [
  'supabase', 'getVehicleTimeline', 'normalizeEvidenceRecord', 'mergeEventsWithEvidence',
  'computeVehicleTrustScore', 'verifyChain', 'projectVehicle', 'toPublicEvidence',
  'toPublicPlateHistory', 'toPublicTimelineEvent', 'PASSPORT_PRIVILEGED_ROLES',
];

function instantiatePassportBuilder(vehicle) {
  const queryStub = (data) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder,
      single: async () => ({ data, error: null }),
      then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
    };
    return builder;
  };
  const supabase = {
    from(table) {
      if (table === 'vehicles') return queryStub(vehicle);
      if (table === 'users') return queryStub({ name: 'Tendai Moyo' });
      return queryStub([]);
    },
  };
  const factory = new Function(...PASSPORT_DEPENDENCIES, `return (${buildVehiclePassportSource()});`);
  return factory(
    supabase,
    async () => [],
    (record) => record,
    (events) => events,
    async () => ({ metrics: null }),
    async () => ({ verified: false, count: 0, chain: [] }),
    projectVehicle, toPublicEvidence, toPublicPlateHistory, toPublicTimelineEvent,
    new Set(['admin', 'government']),
  );
}

const VIN = 'JTNBU4EE0J9UAT101';

/**
 * THE LIVE STAGING SHAPE. Every value flagged below is the column DEFAULT — nobody's assertion —
 * and NO `*_source` column is present, because 20260818110000 is authored but unapplied and
 * PostgREST's `select('*')` therefore cannot return one.
 */
function liveStagingRow(overrides = {}) {
  return {
    vin: VIN, make: 'Toyota', model: 'Corolla', generation: null, trim: null, year: 2019,
    color: 'White', mileage: 92000, fuel_type: 'Petrol', transmission: 'Automatic', drivetrain: 'RWD',
    price: 12500,
    currency: 'USD',                                       // <- DB DEFAULT 'USD'
    status: 'Available', publication_status: 'published', created_at: '2026-06-09T04:30:41Z',
    import_source: 'local',
    registration_country: 'ZW', registration_authority: 'CVR',   // <- DB DEFAULTs
    registration_status: 'Current', plate_status: 'Active',      // <- DB DEFAULTs
    vehicle_condition_category: 'unknown',
    duty_paid: false, police_verified: false, zimra_verified: false, passport_verified: false,
    inspection_ready: false, safe_pay_ready: false,
    current_seller_type: 'Private Owner',                  // <- DB DEFAULT 'Private Owner'
    public_seller_display_enabled: false,
    owner_id: 'owner-1', tenant_id: null, current_seller_id: null,
    plate_number: 'ABC1234', normalized_plate_number: 'ABC1234',
    chassis_number: 'CH-9', engine_number: 'EN-9',
    temp_plate_id: null, temporary_identification_number: null,
    trust_score: 84,
    ...overrides,
  };
}

/** Anonymous caller: optionalAuth() resolved no identity, so req.userContext is absent. */
const anonymous = () => ({});

const buildPassport = (row, { attestor = attestedValue, contract = toListingClaims } = {}) =>
  instantiatePassportBuilder(row)(row.vin, anonymous(), null, contract, attestor);

// ---------------------------------------------------------------------------
// current_seller_type — withdrawn from BOTH places it was published
// ---------------------------------------------------------------------------

test('the passport publishes no seller type that only a column DEFAULT filled', async () => {
  const passport = await buildPassport(liveStagingRow());

  assert.ok(
    !('current_seller_type' in passport.vehicle),
    'current_seller_type must be ABSENT from the row projection, not merely nulled: it is governed by claims.seller.seller_type',
  );
  assert.equal(
    passport.ownershipSummary.currentSellerType, null,
    'and the camelCased copy in ownershipSummary must not republish it — withdrawing only the column would move the same string four keys down the same body',
  );
  assert.deepEqual(
    passport.claims.seller.seller_type,
    { value: null, state: FIELD_STATES.NOT_RECORDED, source: null },
    'the governed leaf reports not_recorded, which is what the two withdrawals above must agree with',
  );
  assert.ok(
    !JSON.stringify(passport).includes('Private Owner'),
    'the DEFAULT string must not survive anywhere in the passport body, under any key',
  );
});

test('POSITIVE TWIN: a seller type somebody declared IS still published', async () => {
  const passport = await buildPassport(liveStagingRow({
    current_seller_type: 'Dealership',
    current_seller_type_source: 'dealer_declared',
  }));

  assert.equal(
    passport.ownershipSummary.currentSellerType, 'Dealership',
    'the gate is provenance, never the value — a dealer who declared a dealer sale must still read as one',
  );
  assert.equal(passport.claims.seller.seller_type.value, 'Dealership');
  assert.equal(passport.claims.seller.seller_type.source, 'dealer_declared');
  assert.equal(
    passport.ownershipSummary.currentSellerType,
    passport.claims.seller.seller_type.value,
    'the summary and the claim are the SAME leaf, so the body can never answer this question twice, differently',
  );
  assert.ok(
    !('current_seller_type' in passport.vehicle),
    'even attested, the fact is published ONCE and through the claim — a bare second copy is the hazard isStatedValue refuses inside a pair',
  );
});

test('an out-of-vocabulary seller-type source is not provenance: it fails closed', async () => {
  const passport = await buildPassport(liveStagingRow({
    current_seller_type_source: 'looks_official',
  }));

  assert.equal(
    passport.ownershipSummary.currentSellerType, null,
    'an invented source string must not manufacture a recorded claim — otherwise the gate is a spelling test',
  );
  assert.equal(passport.claims.seller.seller_type.state, FIELD_STATES.NOT_RECORDED);
});

// ---------------------------------------------------------------------------
// currency — gated exactly as the marketplace summary gates it
// ---------------------------------------------------------------------------

test('the passport publishes no currency that only a column DEFAULT filled', async () => {
  const passport = await buildPassport(liveStagingRow());

  assert.equal(
    passport.vehicle.currency, null,
    "'USD' sat in the column because of the DDL, not because anyone quoted this car in dollars",
  );
  assert.equal(
    passport.vehicle.currency_state, FIELD_STATES.NOT_RECORDED,
    'and the body must say WHY it is null, so a client can tell "not recorded" from "withheld" — which the bare column never told anyone',
  );
  assert.equal(passport.vehicle.currency_source, null, 'a non-recorded claim discloses no origin either');
  assert.equal(
    passport.vehicle.price, 12500,
    'price is deliberately NOT gated with it: it has no DB default and /api/vehicles/add 400s without one, so a price in the column IS an application-recorded fact',
  );
});

test('POSITIVE TWIN: a currency the seller declared IS still published, with its author', async () => {
  const passport = await buildPassport(liveStagingRow({
    currency: 'ZWG', currency_source: 'seller_declared',
  }));

  assert.equal(passport.vehicle.currency, 'ZWG');
  assert.equal(passport.vehicle.currency_state, FIELD_STATES.RECORDED);
  assert.equal(passport.vehicle.currency_source, 'seller_declared');
});

test("the gate is provenance, not the value: an attested 'USD' publishes unchanged", async () => {
  const passport = await buildPassport(liveStagingRow({ currency_source: 'seller_declared' }));

  assert.equal(
    passport.vehicle.currency, 'USD',
    "'USD' must not be rejected for being the DEFAULT's string — a seller who genuinely trades in USD must be able to say so, and rejecting the value would be the mirror-image fabrication",
  );
  assert.equal(passport.vehicle.currency_state, FIELD_STATES.RECORDED);
});

test('an out-of-vocabulary currency source is not provenance: it fails closed', async () => {
  const passport = await buildPassport(liveStagingRow({ currency_source: 'the_website' }));

  assert.equal(passport.vehicle.currency, null);
  assert.equal(passport.vehicle.currency_state, FIELD_STATES.NOT_RECORDED);
});

test('a caller that hands in no attestor gets the currency withdrawn, never published bare', async () => {
  const passport = await buildPassport(liveStagingRow(), { attestor: null });

  assert.ok(
    !('currency' in passport.vehicle),
    '"we could not state it" is never a licence to publish it bare — the same rule import_source is withdrawn under',
  );
  assert.ok(
    !('currency_state' in passport.vehicle),
    'and no state is invented for it either: this branch is a statement about the request, and a fabricated not_recorded is the same defect wearing the opposite mask',
  );
});

test('a caller that hands in no claim contract still gets both facts withheld', async () => {
  const passport = await buildPassport(liveStagingRow(), { contract: null });

  assert.equal(passport.claims, null, 'no contract accompanied this render');
  assert.ok(!('current_seller_type' in passport.vehicle), 'the governed columns are withdrawn all the same');
  assert.equal(passport.ownershipSummary.currentSellerType, null);
});

// ---------------------------------------------------------------------------
// Structural guards — the shape these gates depend on
// ---------------------------------------------------------------------------

test('current_seller_type is a member of CLAIM_GOVERNED_COLUMNS (source-text assertion)', () => {
  const source = buildVehiclePassportSource();
  const idx = source.indexOf('const CLAIM_GOVERNED_COLUMNS = [');
  assert.ok(idx > -1, 'the passport must still declare its governed-column set');
  const block = source.slice(idx, source.indexOf('];', idx));
  for (const column of ['registration_country', 'registration_authority', 'registration_status',
    'plate_status', 'current_seller_type']) {
    assert.ok(
      block.includes(`'${column}'`),
      `${column} must stay in CLAIM_GOVERNED_COLUMNS: every one of them is authored by a DB DEFAULT and has a governed twin in claims.*`,
    );
  }
});

test('/api/vehicles/add stamps currency_source beside the currency it requires (source-text assertion)', () => {
  const idx = serverSrc.indexOf('const listingClaimColumns = {');
  assert.ok(idx > -1, 'the listing write path must still assemble its claim columns in one place');
  const block = serverSrc.slice(idx, serverSrc.indexOf('\n  };', idx));
  assert.match(
    block,
    /currency_source:\s*claimSource/,
    'without this stamp the migration that drops currency\'s DEFAULT would leave every genuinely-declared currency permanently unpublishable — the under-reporting failure mode, but still a failure mode',
  );
});

test('buildVehiclePassport still needs no new injected collaborator (harness contract)', async () => {
  // The proof is that the 11-name list above instantiates AND EXECUTES the shipped source. A free
  // module-scope name added to the function body would be a ReferenceError here and in
  // issue164-phase0-public-projection.test.js, rather than a failure that says what changed.
  const passport = await buildPassport(liveStagingRow());
  assert.equal(PASSPORT_DEPENDENCIES.length, 11);
  assert.equal(passport.identity.vin, VIN, 'the body was produced, so every free name resolved');
});
