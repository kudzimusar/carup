/**
 * Trade OS — the Intake Contract in code (master plan §36).
 *
 * This module is the single place the intake vocabularies live. Every set here mirrors a CHECK
 * constraint in `20260906120000_trade_os_intake_2_0_contract.sql`, and a test walks the migration
 * to prove the two cannot drift: a value the service accepts but the database refuses is a 500
 * waiting to happen, and a value the database allows but the service never emits is dead schema.
 *
 * Three rules govern everything below.
 *
 *   1. UNKNOWN IS AN ANSWER. Every preference is optional and `null` means "not stated" — never
 *      zero, never a default. A customer who does not know a drivetrain must still be able to
 *      publish a request.
 *   2. A DECLARATION IS NOT A FACT. Ticking "batteries" discloses a belief that a provider must
 *      confirm; it is not CarUp certifying hazardous carriage. Ticking "inspection completed" does
 *      not produce a certificate.
 *   3. PRIVATE BY DEFAULT. A field is invisible to the marketplace until it is deliberately named
 *      in an allow-list and covered by an adversarial test.
 */

const set = (...values) => Object.freeze(new Set(values));

// ── Enumerated intake vocabularies (mirror the migration CHECKs) ────────
export const INTAKE_INTENTS = set('buy_vehicle', 'buy_parts', 'managed_import');
export const BUDGET_BASES = set('item_only', 'fob', 'export_side', 'cif_port', 'port_cleared', 'delivered', 'unsure');
export const BUDGET_FLEXIBILITY = set('firm', 'somewhat_flexible', 'flexible', 'unsure');
export const DESTINATION_OUTCOMES = set('port_only', 'port_plus_clearing', 'cross_border_transit', 'port_to_city', 'door_delivery', 'unsure');
export const CONSIGNEE_KINDS = set('self', 'my_company', 'another_person', 'another_company', 'undecided');
export const SHIPPING_OBJECTIVES = set('lowest_cost', 'faster_arrival', 'better_protection', 'extra_goods', 'non_running', 'multiple_vehicles', 'private_container', 'flexible');
export const SHIPPING_MODE_PREFERENCES = set('no_preference', 'roro', 'shared_container', 'private_container', 'provider_recommendation');
export const INSPECTION_INTENTS = set('please_arrange', 'already_arranged', 'already_completed', 'unsure', 'not_applicable');
export const INSURANCE_INTENTS = set('interested', 'not_interested', 'already_insured', 'unsure');
export const CLEARING_INTENTS = set('own_agent', 'want_provider', 'arrange_later', 'unsure');
export const PAYMENT_INTENTS = set('bank_transfer', 'already_paid', 'outstanding', 'financing_needed', 'installments_interest', 'safetrade_interest', 'decide_after_quote', 'other');
export const TIMING_FLEXIBILITY = set('fixed', 'somewhat_flexible', 'flexible');
export const ALTERNATIVES_POLICIES = set('exact_only', 'flexible_trim', 'similar_models', 'supplier_may_propose', 'ask_before_proposing');
export const TRANSMISSIONS = set('automatic', 'manual', 'either');
export const DRIVETRAINS = set('2wd', '4wd_awd', 'either');
export const STEERING = set('rhd', 'lhd', 'either');
export const TOLERANCES = set('none', 'minor_acceptable', 'flexible', 'unsure');
export const INTENDED_USES = set('personal_family', 'company', 'taxi_ride_hailing', 'dealer_resale', 'commercial_transport', 'farm', 'mining_industrial', 'restoration_project', 'donor_parts', 'other');
export const PART_ORIGINS = set('oem', 'aftermarket', 'either');
export const PICKUP_REQUIRED = set('yes', 'no', 'unsure');
export const ORIGIN_SITE_TYPES = set('auction', 'dealer', 'exporter', 'private_seller', 'warehouse_yard', 'carup_partner_yard', 'customer_location', 'other');
export const GOODS_NATURES = set('new', 'used', 'personal_effects', 'commercial_goods', 'unsure');
export const VEHICLE_RUNNING_STATES = set('runs_and_drives', 'starts_only', 'non_running', 'unknown');
export const VEHICLE_KEYS_STATES = set('available', 'missing', 'unknown');
export const EXPORT_CLEARANCE_STATES = set('completed', 'in_progress', 'not_started', 'unknown');

/** What a customer can ask supplier offers to ADDRESS. Requesting is not the same as receiving. */
export const QUOTE_COMPONENTS = set(
  'item_price', 'origin_inland_transport', 'auction_export_charges', 'export_processing',
  'inspection', 'ocean_freight', 'insurance', 'destination_clearing', 'cross_border_transit', 'inland_delivery',
);

/** Cargo handling characteristics. Free of eligibility meaning. */
export const HANDLING_FLAGS = set('fragile', 'stackable', 'oversized', 'keep_upright', 'special_handling');

/**
 * Regulated-content DISCLOSURES. These are the customer telling CarUp what is in the box so a
 * provider can decide — they never establish carrier eligibility, and nothing in the product may
 * read them as approval.
 */
export const CONTENT_DECLARATIONS = set('batteries', 'liquids', 'engines', 'fuel_oil_residue', 'tyres', 'chemicals', 'hazardous_regulated', 'none', 'unknown');

// ── Provenance ─────────────────────────────────────────────────────────
export const PROVENANCE = Object.freeze({
  CUSTOMER_STATED: 'CUSTOMER_STATED',
  CUSTOMER_ESTIMATED: 'CUSTOMER_ESTIMATED',
  CARUP_CALCULATED: 'CARUP_CALCULATED',
  PROVIDER_STATED: 'PROVIDER_STATED',
  WAREHOUSE_MEASURED: 'WAREHOUSE_MEASURED',
  CARRIER_STATED: 'CARRIER_STATED',
  DOCUMENT_DERIVED: 'DOCUMENT_DERIVED',
  VERIFIED: 'VERIFIED',
});

/**
 * What a CUSTOMER-facing caller may assert about their own request.
 *
 * A customer can say what they believe and what they estimate. They cannot mark anything VERIFIED,
 * nor speak as a warehouse, a carrier, a provider or a document — those provenances belong to the
 * authorities that own them, and a request that could self-certify would make the whole ledger
 * worthless.
 */
export const CUSTOMER_ASSERTABLE_PROVENANCE = set(
  PROVENANCE.CUSTOMER_STATED,
  PROVENANCE.CUSTOMER_ESTIMATED,
);

// ── Privacy classification (§36.6) ─────────────────────────────────────
export const VISIBILITY = Object.freeze({
  PRIVATE: 'PRIVATE',
  MARKETPLACE_SAFE: 'MARKETPLACE_SAFE',
  COUNTERPARTY_AFTER_ENGAGEMENT: 'COUNTERPARTY_AFTER_ENGAGEMENT',
  INTERNAL: 'INTERNAL',
  LATER_OPERATIONAL: 'LATER_OPERATIONAL',
});

/**
 * The intake fields a qualified supplier/provider may see, and nothing else.
 *
 * This is an ALLOW-LIST, and it is the reason a richer intake does not become a wider leak. A new
 * field is invisible until it is named here on purpose. Everything absent — pickup address and
 * site contacts, consignee details, payment intent, an undisclosed budget, any VIN, internal ids —
 * stays private by omission rather than by remembering to strip it.
 */
export const MARKETPLACE_SAFE_ORDER_FIELDS = Object.freeze([
  'intake_intent', 'destination_outcome', 'preferred_port', 'shipping_objective',
  'shipping_mode_preference', 'requested_quote_components', 'alternatives_policy',
  'available_from', 'arrival_window_start', 'arrival_window_end', 'timing_flexibility',
  'deadline_is_hard',
  // Budget crosses ONLY through the existing disclosure gate, which this list does not bypass.
]);

export const MARKETPLACE_SAFE_LINE_FIELDS = Object.freeze([
  'vehicle_body_type', 'vehicle_fuel_type', 'vehicle_transmission', 'vehicle_drivetrain',
  'vehicle_steering', 'vehicle_seats_min', 'vehicle_mileage_max_km', 'vehicle_colour_preference',
  'vehicle_trim_preference', 'vehicle_generation_code', 'vehicle_engine_cc_min', 'vehicle_engine_cc_max',
  'vehicle_auction_grade', 'accident_repair_tolerance', 'rust_tolerance', 'intended_use',
  'alternative_models', 'part_side', 'part_origin_preference', 'brand_preference',
]);

export const MARKETPLACE_SAFE_CARGO_FIELDS = Object.freeze([
  'packaging_type', 'goods_nature', 'handling_flags', 'content_declarations',
  'vehicle_running_state', 'vehicle_keys_state',
  // declared_value is DELIBERATELY absent: cargo value is commercial and useful to a thief.
  // export_clearance_state is absent: it is operational readiness, released later, not at browse.
]);

/**
 * Fields that must NEVER reach a marketplace projection, asserted directly by an adversarial test
 * so the guarantee does not rest on the allow-lists merely happening to omit them.
 */
export const NEVER_MARKETPLACE_VISIBLE = Object.freeze([
  'origin_location', 'destination_location', 'destination_area', 'consignee_kind',
  'payment_intent', 'clearing_intent', 'insurance_intent', 'inspection_intent',
  'budget_max_amount', 'budget_basis', 'budget_flexibility',
  'linked_vehicle_vin', 'vin', 'chassis_number', 'auction_lot_number',
  'buyer_id', 'requester_id', 'tenant_id', 'created_by', 'updated_by', 'metadata',
]);

// ── Validation helpers ─────────────────────────────────────────────────

/** An enumerated choice, or null. A blank is "not stated" and must never become a default. */
export function optionalChoice(value, vocabulary, fieldLabel) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!vocabulary.has(normalized)) throw new Error(`${fieldLabel} is not a supported choice`);
  return normalized;
}

/** A set of enumerated choices, or null. Duplicates collapse; an unknown member is refused. */
export function optionalChoiceList(values, vocabulary, fieldLabel) {
  if (values === undefined || values === null) return null;
  const list = Array.isArray(values) ? values : [values];
  if (!list.length) return null;
  const out = [...new Set(list.map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
  for (const member of out) {
    if (!vocabulary.has(member)) throw new Error(`${fieldLabel} contains an unsupported choice`);
  }
  return out.length ? out : null;
}

/** A positive number, or null. Zero is refused where zero would be a lie about an unknown. */
export function optionalPositiveNumber(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${fieldLabel} must be a positive number when stated`);
  return n;
}

/** An ISO date, or null. */
export function optionalDate(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${fieldLabel} is not a valid date`);
  return d.toISOString().slice(0, 10);
}
