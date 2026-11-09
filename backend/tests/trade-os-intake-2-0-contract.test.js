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
const buyerOrders = await import('../services/diaspora/diasporaBuyerOrderService.js');
const readiness = await import('../services/diaspora/tradeDocumentReadinessService.js');
const normalizer = await import('../services/diaspora/tradeIntakeNormalizer.js');
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

test('line preferences are actually WRITTEN, not merely normalizable', async () => {
  // This exists because the normalizer was written and then not called: the module was correct,
  // the columns were correct, and every vehicle preference still persisted as null. A test that
  // only exercised the normalizer would have stayed green through it. This one goes through the
  // real write path.
  const client = createMockSupabase({
    diaspora_import_order_request_lines: [],
    diaspora_import_audit_log: [],
  });
  const order = { id: 'order-1', tenant_id: null, metadata: {} };
  const written = await buyerOrders.replaceRequestLines(client, order, [{
    item_kind: 'vehicle', item_description: 'Toyota Alphard', quantity: 1,
    vehicle_steering: 'rhd', vehicle_transmission: 'automatic', vehicle_drivetrain: '4wd_awd',
    vehicle_mileage_max_km: 80000, accident_repair_tolerance: 'none',
    intended_use: 'personal_family', alternative_models: ['Toyota Vellfire'],
    vehicle_fuel_type: 'hybrid',
  }], customer);

  const line = (written || [])[0] || client._rows('diaspora_import_order_request_lines')[0];
  assert.ok(line, 'a line was written');
  assert.equal(line.vehicle_steering, 'rhd');
  assert.equal(line.vehicle_transmission, 'automatic');
  assert.equal(line.vehicle_drivetrain, '4wd_awd');
  assert.equal(line.vehicle_mileage_max_km, 80000);
  assert.equal(line.accident_repair_tolerance, 'none');
  assert.equal(line.intended_use, 'personal_family');
  assert.deepEqual(line.alternative_models, ['Toyota Vellfire']);
  assert.equal(line.vehicle_fuel_type, 'hybrid');
  // …and a preference nobody stated is still null, not a default.
  assert.equal(line.vehicle_trim_preference ?? null, null);
  assert.equal(line.rust_tolerance ?? null, null);
});

// ── 3. the richer intake must not widen supplier visibility ────────────

/**
 * DISCOVERED, not enumerated. Listing the allow-lists by hand is how a NEW allow-list gets added
 * without any guard noticing it — which is exactly what happened when the logistics request-level
 * list was introduced. Every MARKETPLACE_SAFE_* export is now covered the moment it exists.
 */
const allowListNames = Object.keys(contract).filter((k) => /^MARKETPLACE_SAFE_/.test(k));
const everyAllowedField = () => new Set(allowListNames.flatMap((name) => contract[name]));

test('every marketplace allow-list is discovered by the privacy guards', () => {
  // A guard that silently covers nothing is worse than no guard.
  assert.ok(allowListNames.length >= 4, `expected the allow-lists to be found, saw ${allowListNames}`);
  for (const required of ['MARKETPLACE_SAFE_ORDER_FIELDS', 'MARKETPLACE_SAFE_LINE_FIELDS',
                          'MARKETPLACE_SAFE_CARGO_FIELDS', 'MARKETPLACE_SAFE_LOGISTICS_FIELDS']) {
    assert.ok(allowListNames.includes(required), `${required} is not being guarded`);
  }
});

test('the marketplace allow-lists never name a private field', () => {
  const allowed = everyAllowedField();
  for (const forbidden of contract.NEVER_MARKETPLACE_VISIBLE) {
    assert.ok(!allowed.has(forbidden), `"${forbidden}" must never be marketplace-visible`);
  }
});

test('commercially sensitive and locating intake fields are not marketplace-safe', () => {
  const allowed = everyAllowedField();
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

// ── conditional PRIVATE facts: collected, never projected ──────────────

test('pickup and delivery contact details are COLLECTED, not refused', () => {
  // The earlier reading was too cautious: a shipper who asks for pickup must be able to say where
  // and who to call, or the request cannot be served.
  const out = normalizer.normalizeLogisticsIntake({
    pickup_required: 'yes', pickup_address: '12 Auction Row, Yokohama',
    pickup_contact_name: 'Site Manager', pickup_contact_phone: '+81 90 0000 0000',
    pickup_available_from: '2026-10-04', pickup_loading_equipment: 'available',
    delivery_address: '5 Borrowdale Lane, Harare', delivery_contact_name: 'Recipient',
    delivery_contact_phone: '+263 77 000 0000', unloading_required: 'yes',
    clearing_agent_name: 'Acme Clearing', clearing_agent_contact: 'acme@example.test',
    preferred_language: 'English', preferred_contact_channel: 'whatsapp',
  });
  assert.equal(out.pickup_address, '12 Auction Row, Yokohama');
  assert.equal(out.pickup_contact_phone, '+81 90 0000 0000');
  assert.equal(out.delivery_contact_name, 'Recipient');
  assert.equal(out.clearing_agent_name, 'Acme Clearing');
  assert.equal(out.preferred_contact_channel, 'whatsapp');
});

test('every conditional private fact is named NEVER_MARKETPLACE_VISIBLE', () => {
  for (const field of ['pickup_address', 'pickup_contact_name', 'pickup_contact_phone',
                       'pickup_access_notes', 'delivery_address', 'delivery_contact_name',
                       'delivery_contact_phone', 'consignee_name', 'consignee_phone',
                       'clearing_agent_name', 'clearing_agent_contact', 'current_location',
                       'preferred_contact_channel', 'preferred_language']) {
    assert.ok(contract.NEVER_MARKETPLACE_VISIBLE.includes(field),
      `"${field}" is collected by intake and must be explicitly named as never marketplace-visible`);
  }
});

test('the logistics projection publishes the job shape a provider must price', () => {
  // These decide the price: whether an inland collection leg exists, what kind of site it is
  // collected from, and what the quote must cover at the far end. Withholding them does not
  // protect the customer — it produces a wrong quote.
  const projected = logistics.projectLogisticsRequestForMarketplace({
    id: 'r1', origin_country: 'Japan', destination_country: 'Zimbabwe',
    pickup_required: 'yes', origin_site_type: 'auction', destination_outcome: 'door_delivery',
    shipping_objective: 'non_running', timing_flexibility: 'somewhat_flexible',
    available_from: '2026-10-04',
    // …while the address that collection happens AT stays private.
    pickup_address: 'LEAK_ADDR', pickup_contact_phone: 'LEAK_PHONE',
  }, []);
  assert.equal(projected.pickup_required, 'yes');
  assert.equal(projected.origin_site_type, 'auction');
  assert.equal(projected.destination_outcome, 'door_delivery');
  assert.equal(projected.shipping_objective, 'non_running');
  assert.equal(projected.timing_flexibility, 'somewhat_flexible');
  assert.equal(projected.available_from, '2026-10-04');
  assert.ok(!Object.hasOwn(projected, 'pickup_address'), 'the pickup ADDRESS must stay private');
  assert.ok(!Object.hasOwn(projected, 'pickup_contact_phone'), 'the pickup CONTACT must stay private');
  assert.ok(!JSON.stringify(projected).includes('LEAK_'));
});

test('an unanswered logistics question is absent, never defaulted', () => {
  const projected = logistics.projectLogisticsRequestForMarketplace(
    { id: 'r1', origin_country: 'Japan', destination_country: 'Zimbabwe' }, []);
  for (const field of contract.MARKETPLACE_SAFE_LOGISTICS_FIELDS) {
    assert.ok(!Object.hasOwn(projected, field),
      `"${field}" was never answered, so it must be absent rather than published as a default`);
  }
});

test('a fully populated PRIVATE logistics request leaks none of it to providers', () => {
  const request = {
    id: 'r1', origin_country: 'Japan', destination_country: 'Zimbabwe', destination_city: 'Harare',
    pickup_address: 'LEAK_PICKUP_ADDR', pickup_contact_name: 'LEAK_PICKUP_NAME',
    pickup_contact_phone: 'LEAK_PICKUP_PHONE', pickup_access_notes: 'LEAK_ACCESS',
    delivery_address: 'LEAK_DELIVERY_ADDR', delivery_contact_name: 'LEAK_DELIVERY_NAME',
    delivery_contact_phone: 'LEAK_DELIVERY_PHONE',
    clearing_agent_name: 'LEAK_AGENT', clearing_agent_contact: 'LEAK_AGENT_CONTACT',
    preferred_language: 'LEAK_LANG', preferred_contact_channel: 'whatsapp',
    requester_id: 'LEAK_REQUESTER', tenant_id: 'LEAK_TENANT', metadata: { secret: 'LEAK_META' },
  };
  const item = {
    id: 'i1', line_number: 1, cargo_category: 'vehicle', description: 'Alphard', quantity: 1,
    measurement_basis: 'UNKNOWN', handling_flags: ['fragile'], content_declarations: ['batteries'],
    current_location: 'LEAK_CARGO_LOCATION', inspection_state: 'booked',
    accompanying_parts: 'LEAK_PARTS', linked_vehicle_vin: 'LEAK_VIN',
    declared_value: 987654,
  };
  const projected = JSON.stringify(logistics.projectLogisticsRequestForMarketplace(request, [item]));
  for (const sentinel of ['LEAK_PICKUP_ADDR', 'LEAK_PICKUP_NAME', 'LEAK_PICKUP_PHONE', 'LEAK_ACCESS',
                          'LEAK_DELIVERY_ADDR', 'LEAK_DELIVERY_NAME', 'LEAK_DELIVERY_PHONE',
                          'LEAK_AGENT', 'LEAK_AGENT_CONTACT', 'LEAK_LANG', 'LEAK_REQUESTER',
                          'LEAK_TENANT', 'LEAK_META', 'LEAK_CARGO_LOCATION', 'LEAK_PARTS',
                          'LEAK_VIN', '987654']) {
    assert.ok(!projected.includes(sentinel), `the provider projection leaked ${sentinel}`);
  }
  // …while the facts a provider needs to decide DID cross.
  for (const shared of ['fragile', 'batteries', 'Alphard']) {
    assert.ok(projected.includes(shared), `a provider needs "${shared}"`);
  }
});

test("a supplier's DRAFT offer is not visible to the buyer", async () => {
  // The intent was already documented in createQuote ("A DRAFT is private to the supplier — only a
  // real submission is news for the buyer"), but the buyer's read returned every row, so a buyer
  // could see an unsubmitted offer and its amount. Walking the governed supplier journey exposed it.
  const ORDER = '66666666-6666-4666-8666-666666666666';
  const client = createMockSupabase({
    diaspora_import_orders: [{ id: ORDER, buyer_id: 'buyer-a', tenant_id: null, status: 'QUOTED', deleted_at: null, metadata: {} }],
    diaspora_import_quotes: [
      { id: 'q-draft', import_order_id: ORDER, seller_id: 'supplier-s', status: 'DRAFT', quote_amount: 11111, deleted_at: null },
      { id: 'q-issued', import_order_id: ORDER, seller_id: 'supplier-s', status: 'ISSUED', quote_amount: 23800, deleted_at: null },
    ],
    diaspora_import_order_request_lines: [],
    diaspora_import_order_participants: [{ id: 'p1', import_order_id: ORDER, user_id: 'buyer-a', participant_role: 'buyer' }],
  });

  const asBuyer = await buyerOrders.getBuyerOrder(ORDER, customer, { supabaseClient: client });
  const buyerSees = asBuyer.quotes.map((q) => q.status);
  assert.ok(!buyerSees.includes('DRAFT'), `the buyer saw a DRAFT offer: ${buyerSees.join(',')}`);
  assert.ok(!JSON.stringify(asBuyer.quotes).includes('11111'), "the draft's amount must not reach the buyer");
  assert.equal(asBuyer.quotes.length, 1);

  // …and the supplier still sees their own draft.
  const supplier = { id: 'supplier-s', userId: 'supplier-s', role: 'dealer', platformRole: 'dealer', tenantId: null };
  const asSupplier = await buyerOrders.getBuyerOrder(ORDER, supplier, { supabaseClient: client }).catch(() => null);
  if (asSupplier) {
    assert.ok(asSupplier.quotes.some((q) => q.status === 'DRAFT'),
      'a supplier must still see their own unsubmitted offer');
  }
});

// ── document readiness: a statement, never a verification ──────────────

test('document readiness records a statement and refuses to imply verification', async () => {
  const client = createMockSupabase({ diaspora_trade_document_readiness: [] });
  const subject = '44444444-4444-4444-8444-444444444444';
  await readiness.setReadiness('import_order', subject, [
    { document_type: 'purchase_invoice', readiness: 'have_it' },
    { document_type: 'export_certificate', readiness: 'will_get_later' },
    { document_type: 'inspection_certificate', readiness: 'need_help' },
  ], customer, { supabaseClient: client });

  const rows = await readiness.listReadiness('import_order', subject, { supabaseClient: client });
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.verified, false, 'a customer answer is never verified');
    assert.equal(row.source, 'CUSTOMER_STATED');
  }
  const summary = readiness.summarizeReadiness(rows);
  assert.equal(summary.customer_says_they_have, 1);
  assert.equal(summary.completeness_known, false, 'no completeness may be claimed');
  assert.ok(!('percent' in summary) && !('complete' in summary),
    'no percentage or completion flag may exist — the required set is unknown');
  assert.match(summary.note, /has not seen or checked/i);
});

test('re-answering readiness corrects it rather than stacking duplicates', async () => {
  const client = createMockSupabase({ diaspora_trade_document_readiness: [] });
  const subject = '55555555-5555-4555-8555-555555555555';
  const opts = { supabaseClient: client };
  await readiness.setReadiness('import_order', subject, [{ document_type: 'purchase_invoice', readiness: 'will_get_later' }], customer, opts);
  await readiness.setReadiness('import_order', subject, [{ document_type: 'purchase_invoice', readiness: 'have_it' }], customer, opts);
  const rows = await readiness.listReadiness('import_order', subject, opts);
  assert.equal(rows.length, 1, 'a corrected intention replaces the previous answer');
  assert.equal(rows[0].readiness, 'have_it');
});

test('an unknown document type or readiness state is refused', async () => {
  const client = createMockSupabase({ diaspora_trade_document_readiness: [] });
  await assert.rejects(() => readiness.setReadiness('import_order', 'x', [{ document_type: 'magic_permit', readiness: 'have_it' }], customer, { supabaseClient: client }), /Unknown document type/i);
  await assert.rejects(() => readiness.setReadiness('import_order', 'x', [{ document_type: 'purchase_invoice', readiness: 'verified' }], customer, { supabaseClient: client }), /Unknown readiness state/i);
});

test('the readiness vocabulary contains no verified-like state', () => {
  for (const forbidden of ['verified', 'approved', 'complete', 'customs_ready', 'export_ready']) {
    assert.ok(!contract.DOCUMENT_READINESS.has(forbidden),
      `"${forbidden}" must not be a readiness state — intake records intention, not confirmation`);
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
