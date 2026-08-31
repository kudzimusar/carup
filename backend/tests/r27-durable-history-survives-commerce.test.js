/**
 * R27 — "Insurance claim -> accident event -> repair evidence can remain visible after listing
 * unpublish/sold; commerce lifecycle never deletes the durable history."
 *
 * R27 was the last unqualified open marker in the Seller master plan. The finance slice explicitly
 * refused to record it ("NOT this lane"), because R27 is about the accident/insurance/repair half
 * and about visibility surviving the COMMERCE lifecycle — not about row deletion from the finance
 * authority. This file closes it on source, hermetically. It needs no lender, insurer or external
 * provider: the publicly visible chain comes from `vehicle_evidence` class mapping, from
 * `vehicles.seller_*_disclosure` and from `partsentry_logs`, none of which is an external feed.
 *
 * The distinction R27 turns on is that the publication gate governs the LISTING, not the VEHICLE:
 * a vehicle's verified registration document does not become unverified because nobody is
 * advertising the car.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  isPublicVehicleStatus,
  isPubliclyVisiblePublication,
  normalizeVehicleStatus,
} from '../utils/vehicleStatus.js';
import { toVehicleHistoryDisclosures } from '../utils/publicVehicleProjection.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ROUTES = read('../routes/vehiclesRoutes.js');
const SERVER = read('../server.js');

/** Source of one `router.<verb>('<path>'` handler, up to the next top-level registration. */
function routerHandler(path, verb = 'post') {
  const marker = `router.${verb}('${path}'`;
  const start = ROUTES.indexOf(marker);
  assert.ok(start > -1, `${verb.toUpperCase()} ${path} must exist`);
  const rest = ROUTES.slice(start + marker.length);
  const next = /\nrouter\.(get|post|put|patch|delete)\(/.exec(rest);
  return ROUTES.slice(start, next ? start + marker.length + next.index : ROUTES.length);
}

/** The column names a `.update({...})` payload writes, parsed statically. */
function updatedColumns(source) {
  const found = [];
  for (const m of source.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)) {
    found.push(
      m[1].split(',').map((e) => e.split(':')[0].trim()).filter(Boolean),
    );
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// A. WRITE SCOPE — the lifecycle moves publication/availability and nothing else
// ═══════════════════════════════════════════════════════════════════════════════════

test('R27-A: publish and unpublish write publication_status ALONE', () => {
  for (const [path, expected] of [
    ['/api/vehicles/:vin/publish', ['publication_status']],
    ['/api/vehicles/:vin/unpublish', ['publication_status']],
  ]) {
    const writes = updatedColumns(routerHandler(path));
    assert.equal(writes.length, 1, `${path} must issue exactly one vehicles update`);
    assert.deepEqual(writes[0], expected,
      `${path} must not touch anything but publication_status; found: ${writes[0].join(', ')}`);
  }
});

test('R27-A: mark-sold writes the availability status ALONE', () => {
  // The status PATCH is the mark-sold path. It must not carry history, evidence or disclosure
  // columns along with the status change.
  const handler = routerHandler('/api/vehicles/:vin/status', 'patch');
  const writes = updatedColumns(handler);
  assert.ok(writes.length >= 1, 'the status route must issue a vehicles update');
  for (const columns of writes) {
    assert.deepEqual(columns, ['status'],
      `mark-sold must write status alone; found: ${columns.join(', ')}`);
  }
});

test('R27-A: the commerce lifecycle issues NO deletes at all', () => {
  // The many `REFERENCES vehicles(vin) ON DELETE CASCADE` foreign keys are only dangerous if some
  // commerce action can remove the parent row. None can: this file contains no delete whatsoever.
  assert.doesNotMatch(ROUTES, /\.delete\(\s*\)/,
    'a delete in the vehicle lifecycle routes could cascade the durable history away');
  assert.doesNotMatch(ROUTES, /\.remove\(/);

  // ANTI-VACUITY: the scanner really does fire on a delete chain, so the assertion above is
  // measuring absence rather than a broken regex.
  const planted = "await supabase.from('vehicle_evidence').delete().eq('vin', vin);";
  assert.match(planted, /\.delete\(\s*\)/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// D. CONTRAST — commerce DOES hide the listing. Without this the rest is vacuous.
// ═══════════════════════════════════════════════════════════════════════════════════

test('R27-D: sold and unpublished genuinely leave the public marketplace', () => {
  // If nothing were gated, "history survives the gate" would be an empty claim.
  assert.equal(isPublicVehicleStatus('Sold'), false, 'a sold vehicle must exit public commerce');
  assert.equal(normalizeVehicleStatus('sold'), 'Sold');
  assert.equal(isPubliclyVisiblePublication('publishable'), false,
    'unpublish must actually remove the listing, or it is a no-op');

  // The positive twin: the same predicates admit a live listing.
  assert.equal(isPublicVehicleStatus('Available'), true);
  assert.equal(isPubliclyVisiblePublication('published'), true);

  // And the public detail route is the surface those predicates gate.
  assert.match(
    SERVER,
    /if \(!isPublicVehicleStatus\(vehicle\.status\) \|\| !isPubliclyVisiblePublication\(vehicle\.publication_status\)\) \{[\s\S]{0,120}?res\.status\(404\)/,
    'GET /api/vehicles/:vin/details must 404 a sold or unpublished VIN',
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════
// C. VISIBILITY — the passport is NOT gated by commerce state
// ═══════════════════════════════════════════════════════════════════════════════════

/** The body of `buildVehiclePassport`, which is where a gate would have to live. */
function buildVehiclePassportSource() {
  const start = SERVER.indexOf('async function buildVehiclePassport');
  assert.ok(start > -1);
  const rest = SERVER.slice(start);
  const end = rest.indexOf('\n}\n');
  assert.ok(end > -1);
  return rest.slice(0, end + 2);
}

test('R27-C: the passport applies no availability or publication gate', () => {
  const body = buildVehiclePassportSource();
  assert.ok(body.length > 2000, 'anti-vacuity: the extracted passport body must be substantial');

  // The two predicates that hide a listing are never consulted when building the passport. The
  // ONLY publication-derived value it uses is `listingPublicationStatus`, which gates the seller's
  // MARKETING gallery and nothing else.
  assert.doesNotMatch(body, /isPublicVehicleStatus\(/,
    'the passport must not refuse a sold vehicle');
  assert.doesNotMatch(body, /isPubliclyVisiblePublication\(/,
    'the passport must not refuse an unpublished vehicle');
  assert.match(body, /listingPublicationStatus: vehicle\.publication_status/,
    'the gallery gate stays, and stays scoped to the gallery');
});

test('R27-C: the passport route itself adds no status filter', () => {
  const start = SERVER.indexOf("app.get('/api/vehicles/:vin/passport'");
  assert.ok(start > -1);
  const route = SERVER.slice(start, start + 900);
  assert.doesNotMatch(route, /isPublicVehicleStatus|isPubliclyVisiblePublication/,
    'the durable record must remain reachable after the listing is withdrawn');
  assert.match(route, /buildVehiclePassport\(vin, req/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// E / F. THE DURABLE HISTORY ITSELF — identical across the commerce lifecycle
// ═══════════════════════════════════════════════════════════════════════════════════

/** One vehicle row carrying the full R27 chain: insurance claim -> accident -> repair. */
const historyRow = (commerce) => ({
  vin: 'R27VIN0000000001',
  ...commerce,
  seller_accident_disclosure: {
    state: 'yes',
    events: [{ damage_area: 'front', repaired: 'yes' }],
  },
  seller_insurance_disclosure: { state: 'insured', insurer_name: 'Old Mutual' },
  seller_finance_disclosure: { state: 'none_known' },
});

test('R27-E: the durable history projects byte-identically across publish, unpublish and sold', () => {
  const published = toVehicleHistoryDisclosures(
    historyRow({ status: 'Available', publication_status: 'published' }),
  );
  const unpublished = toVehicleHistoryDisclosures(
    historyRow({ status: 'Available', publication_status: 'publishable' }),
  );
  const sold = toVehicleHistoryDisclosures(
    historyRow({ status: 'Sold', publication_status: 'publishable' }),
  );

  // The projection reads the durable columns and nothing about commerce, so all three are equal.
  assert.deepEqual(unpublished, published, 'unpublishing must not change the recorded history');
  assert.deepEqual(sold, published, 'selling must not change the recorded history');
  assert.equal(JSON.stringify(sold), JSON.stringify(published), 'byte-identical, not merely equal');

  // And it is genuinely carrying the chain, not an empty object that would compare equal trivially.
  assert.equal(published.accident.state, 'yes');
  assert.deepEqual(published.accident.events, [{ damage_area: 'front' }]);
  assert.equal(published.insurance.state, 'insured');
  assert.equal(published.insurance.insurer_name, 'Old Mutual');
});

test('R27-F: a sold listing never promotes a seller claim to governed evidence', () => {
  const sold = toVehicleHistoryDisclosures(
    historyRow({ status: 'Sold', publication_status: 'publishable' }),
  );
  assert.equal(sold.authority, 'seller_stated',
    'the attribution must survive the lifecycle unchanged — selling a car does not verify its history');
});

test('R27-G: an UNANSWERED topic stays unanswered after sold — never a clean history claim', () => {
  // The complement of E: the lifecycle must not turn silence into a negative finding either.
  const silent = toVehicleHistoryDisclosures({
    vin: 'R27VIN0000000002', status: 'Sold', publication_status: 'publishable',
  });
  assert.deepEqual(silent, {
    authority: 'seller_stated', accident: null, insurance: null, finance: null,
  }, 'a sold vehicle with no disclosures must read "not recorded", never "no accidents"');
});
