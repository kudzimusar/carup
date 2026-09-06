/**
 * Trade OS Intake 2.0 — the contract's guarantees.
 *
 * Four things a large intake expansion can quietly break, and which these tests exist to hold:
 *   1. the code's vocabularies and the database's CHECK constraints must not drift apart;
 *   2. a customer statement must not become a verified fact;
 *   3. the richer intake must not widen what a supplier can see;
 *   4. unknown must stay unknown rather than becoming a default.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'false';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const contract = await import('../services/diaspora/tradeIntakeContract.js');
const rfq = await import('../services/diaspora/diasporaRfqService.js');
const logistics = await import('../services/diaspora/diasporaLogisticsRfqService.js');
const observations = await import('../services/diaspora/tradeFactObservationService.js');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  join(repoRoot, 'database/migrations/20260906120000_trade_os_intake_2_0_contract.sql'), 'utf8');

const customer = { id: 'buyer-a', userId: 'buyer-a', role: 'owner', platformRole: 'owner', tenantId: null };
const admin = { id: 'admin-1', userId: 'admin-1', role: 'admin', platformRole: 'platform_admin', tenantId: null };
const ITEM = '33333333-3333-4333-8333-333333333333';
const db = () => ({ supabaseClient: createMockSupabase({ diaspora_trade_fact_observations: [] }) });

// ── 1. code and database cannot drift ──────────────────────────────────

/** Pull the members of a CHECK (col IN ('a','b')) straight out of the migration. */
function checkVocabulary(column) {
  const re = new RegExp(`${column}[^,;]*?CHECK\\s*\\(${column}\\s+IN\\s*\\(([^)]*)\\)`, 's');
  const m = migration.match(re) || migration.match(new RegExp(`CHECK\\s*\\(${column}\\s+IN\\s*\\(([^)]*)\\)`, 's'));
  if (!m) return null;
  return new Set(m[1].split(',').map((v) => v.trim().replace(/'/g, '')).filter(Boolean));
}

test('every intake vocabulary in code matches its database CHECK exactly', () => {
  const pairs = [
    ['intake_intent', contract.INTAKE_INTENTS], ['budget_basis', contract.BUDGET_BASES],
    ['budget_flexibility', contract.BUDGET_FLEXIBILITY], ['consignee_kind', contract.CONSIGNEE_KINDS],
    ['shipping_objective', contract.SHIPPING_OBJECTIVES], ['shipping_mode_preference', contract.SHIPPING_MODE_PREFERENCES],
    ['inspection_intent', contract.INSPECTION_INTENTS], ['insurance_intent', contract.INSURANCE_INTENTS],
    ['clearing_intent', contract.CLEARING_INTENTS], ['payment_intent', contract.PAYMENT_INTENTS],
    ['timing_flexibility', contract.TIMING_FLEXIBILITY], ['alternatives_policy', contract.ALTERNATIVES_POLICIES],
    ['vehicle_transmission', contract.TRANSMISSIONS], ['vehicle_drivetrain', contract.DRIVETRAINS],
    ['vehicle_steering', contract.STEERING], ['intended_use', contract.INTENDED_USES],
    ['part_origin_preference', contract.PART_ORIGINS], ['pickup_required', contract.PICKUP_REQUIRED],
    ['origin_site_type', contract.ORIGIN_SITE_TYPES], ['goods_nature', contract.GOODS_NATURES],
    ['vehicle_running_state', contract.VEHICLE_RUNNING_STATES], ['vehicle_keys_state', contract.VEHICLE_KEYS_STATES],
    ['export_clearance_state', contract.EXPORT_CLEARANCE_STATES],
  ];
  for (const [column, vocabulary] of pairs) {
    const db = checkVocabulary(column);
    assert.ok(db, `no CHECK found for ${column} — the column must be constrained, not free text`);
    assert.deepEqual([...vocabulary].sort(), [...db].sort(),
      `${column}: the service and the database disagree about what is a legal value`);
  }
});

test('destination_outcome is constrained on BOTH authorities and agrees with the code', () => {
  const occurrences = migration.match(/CHECK \(destination_outcome IN \([^)]*\)/gs) || [];
  assert.equal(occurrences.length, 2, 'procurement and logistics each constrain destination outcome');
  for (const occurrence of occurrences) {
    const members = new Set(occurrence.split('(').pop().split(',').map((v) => v.trim().replace(/[')]/g, '')).filter(Boolean));
    assert.deepEqual([...contract.DESTINATION_OUTCOMES].sort(), [...members].sort());
  }
});

// ── 2. a customer statement is not a verified fact ─────────────────────

test('a customer may state and estimate their own facts', async () => {
  const opts = db();
  const stated = await observations.recordObservation({
    subjectType: 'logistics_request_item', subjectId: ITEM, factKey: 'weight_kg',
    valueNumeric: 400, unit: 'kg', provenance: contract.PROVENANCE.CUSTOMER_ESTIMATED,
  }, customer, opts);
  assert.equal(stated.provenance, 'CUSTOMER_ESTIMATED');
  assert.equal(Number(stated.value_numeric), 400);
});

test('a customer CANNOT mark anything verified', async () => {
  await assert.rejects(() => observations.recordObservation({
    subjectType: 'logistics_request_item', subjectId: ITEM, factKey: 'weight_kg',
    valueNumeric: 400, provenance: contract.PROVENANCE.VERIFIED,
  }, customer, db()), /may only state or estimate|verified/i);
});

test('a customer cannot speak as a warehouse, a carrier, a provider or a document', async () => {
  for (const provenance of ['WAREHOUSE_MEASURED', 'CARRIER_STATED', 'PROVIDER_STATED', 'DOCUMENT_DERIVED', 'CARUP_CALCULATED']) {
    await assert.rejects(() => observations.recordObservation({
      subjectType: 'logistics_request_item', subjectId: ITEM, factKey: 'weight_kg',
      valueNumeric: 400, provenance,
    }, customer, db()), new RegExp('state or estimate', 'i'), `a customer must not be able to assert ${provenance}`);
  }
});

test('a measurement never overwrites the estimate — both survive, newest first', async () => {
  const opts = db();
  await observations.recordObservation({
    subjectType: 'logistics_request_item', subjectId: ITEM, factKey: 'weight_kg',
    valueNumeric: 400, unit: 'kg', provenance: contract.PROVENANCE.CUSTOMER_ESTIMATED,
  }, customer, opts);
  await observations.recordObservation({
    subjectType: 'logistics_request_item', subjectId: ITEM, factKey: 'weight_kg',
    valueNumeric: 437, unit: 'kg', provenance: contract.PROVENANCE.WAREHOUSE_MEASURED,
  }, admin, { ...opts, asAuthority: true });

  const fact = await observations.currentFact('logistics_request_item', ITEM, 'weight_kg', opts);
  assert.equal(fact.value, 437, 'the measurement is the current answer');
  assert.equal(fact.provenance, 'WAREHOUSE_MEASURED');
  assert.equal(fact.superseded_count, 1, 'the estimate is still there');
  assert.equal(fact.superseded[0].value, 400);
  assert.equal(fact.superseded[0].provenance, 'CUSTOMER_ESTIMATED');
});

test('a fact always carries its provenance — there is no bare-number accessor', () => {
  assert.equal(typeof observations.currentFact, 'function');
  assert.ok(!Object.keys(observations).some((k) => /^(getWeight|getValue|valueOf)/.test(k)),
    'no accessor may return a number without where it came from');
  assert.equal(observations.isVerified({ provenance: 'CUSTOMER_STATED' }), false);
  assert.equal(observations.isVerified({ provenance: 'VERIFIED' }), true);
});

test('an observation with no value is refused', async () => {
  await assert.rejects(() => observations.recordObservation({
    subjectType: 'logistics_request_item', subjectId: ITEM, factKey: 'weight_kg',
    provenance: contract.PROVENANCE.CUSTOMER_STATED,
  }, customer, db()), /needs a value/i);
});

// ── 3. the richer intake must not widen supplier visibility ────────────

test('the marketplace allow-lists never name a private field', () => {
  const allowed = new Set([
    ...contract.MARKETPLACE_SAFE_ORDER_FIELDS,
    ...contract.MARKETPLACE_SAFE_LINE_FIELDS,
    ...contract.MARKETPLACE_SAFE_CARGO_FIELDS,
  ]);
  for (const forbidden of contract.NEVER_MARKETPLACE_VISIBLE) {
    assert.ok(!allowed.has(forbidden), `"${forbidden}" must never be marketplace-visible`);
  }
});

test('commercially sensitive and locating intake fields are not marketplace-safe', () => {
  const allowed = new Set([
    ...contract.MARKETPLACE_SAFE_ORDER_FIELDS,
    ...contract.MARKETPLACE_SAFE_LINE_FIELDS,
    ...contract.MARKETPLACE_SAFE_CARGO_FIELDS,
  ]);
  for (const field of ['budget_max_amount', 'budget_basis', 'payment_intent', 'consignee_kind',
                       'destination_area', 'origin_location', 'declared_value', 'export_clearance_state']) {
    assert.ok(!allowed.has(field), `"${field}" leaked into the marketplace allow-list`);
  }
});

test('a FULLY populated intake still leaks nothing to the marketplace', () => {
  // Every private field carries a distinctive sentinel, so a leak shows up as the sentinel
  // appearing in the projected payload rather than as a field name we remembered to check.
  const order = {
    id: 'order-1', order_type: 'vehicle',
    requested_make: 'Toyota', requested_model: 'Alphard',
    origin_country: 'Japan', destination_country: 'Zimbabwe', destination_city: 'Harare',
    // marketplace-safe intake
    intake_intent: 'managed_import', destination_outcome: 'door_delivery',
    shipping_objective: 'lowest_cost', shipping_mode_preference: 'roro',
    requested_quote_components: ['ocean_freight', 'inspection'], alternatives_policy: 'supplier_may_propose',
    available_from: '2026-10-04', timing_flexibility: 'flexible',
    // PRIVATE — none of these may cross
    buyer_id: 'LEAK_buyer', tenant_id: 'LEAK_tenant', created_by: 'LEAK_creator',
    vin: 'LEAK_VIN', chassis_number: 'LEAK_CHASSIS', auction_lot_number: 'LEAK_LOT',
    budget_amount: 24000, budget_currency: 'USD', budget_max_amount: 26000,
    budget_basis: 'delivered', budget_flexibility: 'firm',
    destination_area: 'LEAK_AREA_borrowdale', preferred_port: 'Beira',
    consignee_kind: 'another_person', payment_intent: 'financing_needed',
    clearing_intent: 'want_provider', insurance_intent: 'interested', inspection_intent: 'please_arrange',
    verification_status: 'LEAK_VERIF',
    metadata: { rfq: { discloseBudget: false }, secret: 'LEAK_META' },
  };
  const line = {
    id: 'line-1', line_number: 1, item_description: 'Alphard', item_kind: 'vehicle', quantity: 1,
    vehicle_steering: 'rhd', vehicle_drivetrain: '4wd_awd', vehicle_mileage_max_km: 80000,
    accident_repair_tolerance: 'none', intended_use: 'personal_family',
    alternative_models: ['Toyota Vellfire'],
    linked_vehicle_vin: 'LEAK_LINKED_VIN', notes: 'fine to share',
  };

  const projected = JSON.stringify(rfq.projectRfqForMarketplace(order, [line]));

  for (const sentinel of ['LEAK_buyer', 'LEAK_tenant', 'LEAK_creator', 'LEAK_VIN', 'LEAK_CHASSIS',
                          'LEAK_LOT', 'LEAK_AREA_borrowdale', 'LEAK_VERIF', 'LEAK_META', 'LEAK_LINKED_VIN']) {
    assert.ok(!projected.includes(sentinel), `the marketplace projection leaked ${sentinel}`);
  }
  // Undisclosed budget stays undisclosed, and the BASIS behind it never crosses at all.
  assert.ok(!projected.includes('26000'), 'the maximum budget must never cross');
  assert.ok(!/"budget_basis"|"budget_flexibility"/.test(projected), 'budget meaning is private');
  assert.ok(!/"payment_intent"|"clearing_intent"|"insurance_intent"|"inspection_intent"|"consignee_kind"/.test(projected),
    'commercial and operational intentions are private');

  // …while the facts a supplier legitimately needs DID cross.
  for (const shared of ['door_delivery', 'lowest_cost', 'rhd', '4wd_awd', 'personal_family', 'Toyota Vellfire']) {
    assert.ok(projected.includes(shared), `the supplier should be able to see "${shared}"`);
  }
});

test('cargo value and export state stay private while handling facts cross', () => {
  const item = {
    id: 'item-1', line_number: 1, cargo_category: 'vehicle', description: 'Alphard', quantity: 1,
    measurement_basis: 'UNKNOWN',
    handling_flags: ['fragile'], content_declarations: ['batteries'],
    vehicle_running_state: 'non_running', goods_nature: 'used',
    declared_value: 999111, declared_value_currency: 'USD',
    export_clearance_state: 'in_progress',
    linked_vehicle_vin: 'LEAK_CARGO_VIN',
  };
  const projected = JSON.stringify(
    logistics.projectLogisticsRequestForMarketplace({ id: 'r1', origin_country: 'Japan' }, [item]));

  assert.ok(!projected.includes('999111'), 'declared cargo value must not cross');
  assert.ok(!projected.includes('LEAK_CARGO_VIN'), 'a cargo VIN must not cross');
  assert.ok(!projected.includes('in_progress'), 'export clearance state is operational, not for browsing');
  for (const shared of ['fragile', 'batteries', 'non_running', 'used']) {
    assert.ok(projected.includes(shared), `a provider needs to see "${shared}" to decide`);
  }
});

// ── 4. unknown stays unknown ───────────────────────────────────────────

test('a blank preference is null, never a default', () => {
  for (const blank of [undefined, null, '']) {
    assert.equal(contract.optionalChoice(blank, contract.STEERING, 'Steering'), null);
    assert.equal(contract.optionalPositiveNumber(blank, 'Mileage'), null);
    assert.equal(contract.optionalDate(blank, 'Available from'), null);
    assert.equal(contract.optionalChoiceList(blank, contract.HANDLING_FLAGS, 'Handling'), null);
  }
});

test('zero is refused where zero would be a lie about an unknown', () => {
  assert.throws(() => contract.optionalPositiveNumber(0, 'Weight'), /positive number/i);
  assert.throws(() => contract.optionalPositiveNumber(-5, 'Weight'), /positive number/i);
});

test('an unsupported choice is refused rather than silently dropped', () => {
  assert.throws(() => contract.optionalChoice('sideways', contract.STEERING, 'Steering'), /not a supported choice/i);
  assert.throws(() => contract.optionalChoiceList(['fragile', 'explodes'], contract.HANDLING_FLAGS, 'Handling'), /unsupported choice/i);
});

test('a declaration is a disclosure, not an eligibility grant', () => {
  const declared = contract.optionalChoiceList(['batteries', 'hazardous_regulated'], contract.CONTENT_DECLARATIONS, 'Contents');
  assert.deepEqual(declared, ['batteries', 'hazardous_regulated']);
  // The vocabulary carries no approval state at all — there is nothing here for a caller to read
  // as "CarUp accepted hazardous goods".
  assert.ok(!/approved|eligible|accepted/i.test([...contract.CONTENT_DECLARATIONS].join(' ')));
});
