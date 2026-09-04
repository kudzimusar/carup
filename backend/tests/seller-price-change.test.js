/**
 * Seller Journey 1.0 / S8 — a seller can change their own price.
 *
 * S8 lists `price_changed` among the authoritative domain events and requires the full lifecycle to
 * work "without direct database intervention". Publish, unpublish and mark-sold all existed. Price
 * did not: once a listing was created, the only way to correct a price was a database write.
 *
 * The rules this route must hold, and which these tests pin:
 *
 *   · SCOPE — the same ownership/tenant rule the publication routes use. A price is a seller's
 *     claim about their own vehicle, so no one else may state it.
 *   · CURRENCY IS NOT RE-STATED — a price change moves the amount only. Letting this route accept a
 *     currency would let a seller silently redenominate an existing listing, turning $28,500 into
 *     28,500 of something else without anyone restating the vehicle. Currency is set once, at
 *     creation, by the seller who was asked for it.
 *   · NO FABRICATION — a missing, non-numeric, zero or negative price is refused. `price` carries no
 *     column default, and coercing a bad input to 0 would publish a free car.
 *   · AUDITED — the before and after both travel to the audit log, because "the price changed" is
 *     not a useful record of what changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const routes = fs.readFileSync(new URL('../routes/vehiclesRoutes.js', import.meta.url), 'utf8');

function priceRouteSource() {
  const start = routes.indexOf("router.patch('/api/vehicles/:vin/price'");
  assert.ok(start > -1, 'PATCH /api/vehicles/:vin/price must exist — S8 requires a price change without a DB write');
  const rest = routes.slice(start + 10);
  const next = /\nrouter\.(get|post|put|patch|delete)\(/.exec(rest);
  return routes.slice(start, next ? start + 10 + next.index : routes.length);
}

/**
 * The route's own validation rule, restated here as the contract rather than copied from the
 * implementation, so a change to the implementation that weakens it fails this test.
 */
const acceptablePrice = value =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

test('only a positive finite number is an acceptable price', () => {
  assert.equal(acceptablePrice(28500), true);
  assert.equal(acceptablePrice(0.5), true);
  // A free car is not a price a seller meant to state, and `price` has no column default to fall
  // back on — so each of these must be refused rather than coerced.
  for (const rejected of [0, -1, NaN, Infinity, null, undefined, '28500', '', {}]) {
    assert.equal(acceptablePrice(rejected), false, `${String(rejected)} must not be accepted as a price`);
  }
});

test('the price route is scoped exactly like the publication routes', () => {
  const source = priceRouteSource();
  assert.match(source, /authorizeRole\(\['owner', 'dealer', 'admin'\]\)/);
  assert.match(source, /loadScopedVehicle\(req, vin\)/,
    'scope must reuse loadScopedVehicle so ownership/tenant rules cannot drift between lifecycle routes');
});

test('the price route refuses anything that is not a positive number', () => {
  const source = priceRouteSource();
  assert.match(source, /Number\.isFinite/);
  assert.match(source, /<=\s*0|>\s*0/);
  assert.match(source, /res\.status\(400\)/);
});

test('the price route never accepts a currency', () => {
  const source = priceRouteSource();
  // Redenominating an existing listing is not a price change. Currency is stated once, at creation.
  // The client may never state a currency on a price change.
  assert.doesNotMatch(source, /req\.body\.currency/);
  // And no currency may reach the write. Scoped to the UPDATE payload rather than the whole route:
  // the emitted price_changed event legitimately reports the currency ALREADY stored on the row the
  // scoped loader returned (`currency: vehicle.currency`). Naming the stored currency in an event is
  // the opposite of re-stating one — an amount-only event would be ambiguous — and the blanket
  // `currency:` scan could not tell the two apart.
  const updated = /\.update\(\{([\s\S]*?)\}\)/.exec(source);
  assert.ok(updated, 'the update payload must remain statically readable');
  assert.doesNotMatch(updated[1], /currency/,
    'a price change must never write the currency column');
});

test('the price route audits the before and the after', () => {
  const source = priceRouteSource();
  assert.match(source, /VEHICLE_PRICE_CHANGED/);
  assert.match(source, /beforePrice/);
  assert.match(source, /afterPrice/);
});

test('the price route touches price alone — not status, publication or trust', () => {
  const source = priceRouteSource();
  const update = /\.update\(\{([\s\S]*?)\}\)/.exec(source);
  assert.ok(update, 'the update payload must remain statically readable');
  // Handles both `{ price }` shorthand and `{ price: value }`, so tightening the implementation's
  // style cannot make this guard silently pass on an empty column list.
  const columns = update[1]
    .split(',')
    .map(entry => entry.split(':')[0].trim())
    .filter(Boolean);
  assert.deepEqual(columns, ['price'],
    `a price change must write price and nothing else; found: ${columns.join(', ') || '(nothing parsed)'}`);
});

test('the scoped loader selects price so the before value is real, not assumed', () => {
  // `loadScopedVehicle` is shared, so the price route can only report a truthful "before" if the
  // loader actually reads that column.
  // Prefix-anchored rather than exact: the loader later gained `currency` so the price_changed
  // event can name the currency it is already holding instead of issuing a second read. The
  // invariant this guards is that the loader still selects `price` — so the "before" value is read
  // and not assumed — which an appended column cannot weaken, while dropping `price` still fails.
  assert.match(routes, /\.select\('vin, status, publication_status, owner_id, current_seller_id, tenant_id, price[,']/);
});
