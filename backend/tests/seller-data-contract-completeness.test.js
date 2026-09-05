/**
 * Seller Journey 1.0 / S2 — Canonical Commercial Listing Data.
 *
 * S2's gate is absolute: "Zero accepted UI fields may be silently discarded." The pre-S2 guard was
 * a fixed allow-list of seven field names, so it could confirm the fields someone remembered to
 * list — and stayed silent about a NEW field added to the request destructure and then forgotten
 * in the write. That is the precise shape of the defect S0-P0-06 recorded (`condition`, `category`
 * and `description` were accepted and dropped).
 *
 * This guard is self-updating: it reads what the handler ACTUALLY accepts and asserts each field
 * reaches a canonical destination. Adding a field to the destructure without persisting it fails
 * here, by name, without anyone editing this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

/** The `/api/vehicles/add` handler body, bounded by the next top-level route registration. */
function addVehicleHandler() {
  const start = server.indexOf("app.post('/api/vehicles/add'");
  assert.ok(start > -1, 'POST /api/vehicles/add must remain statically locatable');
  const rest = server.slice(start + 10);
  const next = /\napp\.(get|post|put|patch|delete)\(/.exec(rest);
  assert.ok(next, 'the handler must be followed by another route registration');
  return server.slice(start, start + 10 + next.index);
}

/**
 * Every field name the handler accepts — BOTH the destructured block and every direct `req.body.x`
 * read. Checking only the destructure left a hole: a field reached as `req.body.something` is just
 * as accepted, and just as capable of being silently dropped.
 */
function acceptedFields(handler) {
  const destructured = /const \{([\s\S]*?)\} = req\.body/.exec(handler);
  assert.ok(destructured, 'the handler must keep destructuring req.body statically');
  const fromDestructure = destructured[1]
    .split(/[,\n]/)
    .map(entry => entry.replace(/\/\/.*$/, '').replace(/=.*$/, '').trim())
    .filter(entry => /^[a-z_][a-z_0-9]*$/i.test(entry));
  const fromDirectReads = [...handler.matchAll(/req\.body\.([a-z_][a-z_0-9]*)/g)].map(match => match[1]);
  return [...new Set([...fromDestructure, ...fromDirectReads])];
}

/**
 * Where each accepted field is allowed to land. A field whose destination is not one of these has
 * no canonical home, which is exactly what Invariant 1 forbids:
 *   "If CarUp asks the seller a question, CarUp must have a canonical destination for the answer."
 *
 * Indirect destinations are named explicitly rather than pattern-matched, so renaming a column
 * cannot silently satisfy this guard.
 */
const CANONICAL_DESTINATION = {
  vin: 'vin',
  make: 'make',
  model: 'model',
  generation: 'generation',
  trim: 'trim',
  color: 'color',
  mileage: 'mileage',
  fuel_type: 'fuel_type',
  transmission: 'transmission',
  drivetrain: 'drivetrain',
  currency: 'currency',
  engine_number: 'engine_number',
  chassis_number: 'chassis_number',
  plate_number: 'plate_number',
  temp_plate_id: 'temp_plate_id',
  // Seller-stated commercial data — the S0-P0-06 fields, each with its own column so the seller's
  // statement is never written into a governed classification column.
  description: 'seller_description',
  features: 'seller_features',
  body_style: 'body_style',
  seller_stated_condition: 'seller_stated_condition',
  condition: 'seller_condition',
  // `category` carries the seller's body-style choice from the current form. It must resolve
  // through body_style and must NEVER write the governed commercial classification.
  category: 'body_style',
  // Location is a claim, not a bare column: it lands with provenance.
  location: 'listing_city',
  province: 'listing_province',
  // Import state and price/year travel through the vetted candidate builder.
  import_status: 'import_source',
  price: 'price',
  year: 'year',
  // Media is projected through the listing-media contract, not written as a raw column.
  images: 'submittedMedia',
  // Consent and provenance fields read directly off req.body. Each is a decision the seller made,
  // so each must reach a column — a consent nobody stores is a consent nobody honoured.
  location_visibility: 'listing_location_visibility',
  public_seller_display_enabled: 'public_seller_display_enabled',
  registration_country: 'registration_country',
  listing_country: 'listing_country',
  country: 'listing_country',
  // The Zimbabwe registration lifecycle stage (ZR lane). It was accepted by the handler without
  // being recorded here, leaving this guard red on exactly the field the Operations slice depends
  // on. It IS persisted — normalized against the canonical lifecycle vocabulary and written to
  // `registration_status` together with `registration_status_source`, because a lifecycle claim
  // without provenance evaluates as not-recorded and would silently block the seller's own
  // truthful statement.
  registration_status: 'registration_status',
  // Governed control field: confirmation is consumed by the existing-Passport authority gate and
  // resolves to the explicit reusedExistingPassport outcome; it must not rewrite canonical identity.
  reuse_existing_passport: 'reusedExistingPassport',
  // F17 durable idempotency key: private mutation metadata with a real column destination. It was
  // added to the handler without being recorded here, which made this guard red — the fix is to
  // name its destination, not to stop accepting it.
  client_submission_id: 'seller_listing_submission_id',
  // Vehicle History & Obligations (F18–F20): structured Seller disclosures, each with its own
  // seller_* column so a Seller statement never masquerades as governed accident/insurer/lender
  // truth. NULL column = unanswered = "not recorded", never a clean-history default.
  accident_disclosure: 'seller_accident_disclosure',
  insurance_disclosure: 'seller_insurance_disclosure',
  finance_disclosure: 'seller_finance_disclosure',
};

test('every field POST /api/vehicles/add accepts has a canonical destination', () => {
  const handler = addVehicleHandler();
  const accepted = acceptedFields(handler);

  assert.ok(accepted.length >= 20, `expected the full seller contract, found ${accepted.length} fields`);

  const homeless = accepted.filter(field => !CANONICAL_DESTINATION[field]);
  assert.deepEqual(
    homeless,
    [],
    `these fields are accepted from the seller but this guard knows no canonical destination for them: ${homeless.join(', ')}. ` +
      'Either persist the field and record its destination here, or stop accepting it. Silently dropping it is forbidden.',
  );

  const unwritten = accepted.filter(field => !handler.includes(CANONICAL_DESTINATION[field]));
  assert.deepEqual(
    unwritten,
    [],
    `accepted but never written to their declared destination: ${unwritten.map(f => `${f} -> ${CANONICAL_DESTINATION[f]}`).join(', ')}`,
  );
});

test('seller-stated body style and condition never write the governed classification column', () => {
  const handler = addVehicleHandler();
  // vehicle_condition_category is CarUp's governed commercial classification (Brand New, Recently
  // Imported, Locally Used...). A seller-stated body style or condition landing there would make a
  // seller statement look like a governed fact — S0-P0-04.
  assert.doesNotMatch(handler, /vehicle_condition_category:\s*(body_style|category|condition|seller)/);
});

test('the seller contract still separates statement from governed classification', () => {
  const handler = addVehicleHandler();
  // Both must exist as distinct destinations; collapsing them loses the authority distinction.
  assert.match(handler, /seller_description:/);
  assert.match(handler, /seller_features:/);
  assert.match(handler, /body_style:/);
  assert.match(handler, /seller_stated_condition:/);
});
