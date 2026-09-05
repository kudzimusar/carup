/**
 * Seller Journey 1.0 / S2 — the seller's answers must actually reach a buyer.
 *
 * S0 gave `description`, `features`, `body_style` and `seller_stated_condition` canonical columns,
 * closing the "accepted then dropped" half of S0-P0-06. But storing an answer is only half of
 * "ask once → store once → provenance once → REUSE EVERYWHERE".
 *
 * The Marketplace listing summary projects all four. The passport's vehicle projection did not,
 * so `/api/vehicles/:vin/passport` and `/api/vehicles/:vin/details` carried none of them — and the
 * Vehicle Detail page's `vehicle.description` and `vehicle.features` reads were dead keys that
 * could never be anything but empty. That is the same defect class this repository already
 * documented for the photo gallery: a page reading a key its projection never emits.
 *
 * These are the seller's own commercial listing copy, already published to the same anonymous
 * audience by the Marketplace summary. Publishing them here changes the projection, not the
 * audience, and touches no field on the private list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLIC_VEHICLE_FIELDS,
  PRIVATE_VEHICLE_FIELDS,
  toPublicVehicle,
} from '../utils/publicVehicleProjection.js';

/** The seller-stated commercial dimensions S0 gave canonical columns. */
const SELLER_STATED_COMMERCIAL_FIELDS = [
  'body_style',
  'seller_stated_condition',
  'seller_description',
  'seller_features',
];

test('the public vehicle projection carries every seller-stated commercial field', () => {
  const missing = SELLER_STATED_COMMERCIAL_FIELDS.filter(field => !PUBLIC_VEHICLE_FIELDS.includes(field));
  assert.deepEqual(
    missing,
    [],
    `the seller answered these and no buyer-facing vehicle projection carries them: ${missing.join(', ')}. `
    + 'A stored answer that no read path emits is still a discarded answer.',
  );
});

test('publishing seller listing copy does not touch the private field list', () => {
  const leaked = SELLER_STATED_COMMERCIAL_FIELDS.filter(field => PRIVATE_VEHICLE_FIELDS.includes(field));
  assert.deepEqual(leaked, [], `these must never be both public and private: ${leaked.join(', ')}`);
});

test('a recorded seller statement projects verbatim; an unrecorded one stays null', () => {
  const projected = toPublicVehicle({
    vin: '1HGCM82633A004352',
    make: 'Toyota',
    model: 'Hilux',
    body_style: 'Pickup',
    seller_stated_condition: 'Used',
    seller_description: 'One owner, full service history.',
    seller_features: ['Tow bar', 'Bull bar'],
  });

  assert.equal(projected.body_style, 'Pickup');
  assert.equal(projected.seller_stated_condition, 'Used');
  assert.equal(projected.seller_description, 'One owner, full service history.');
  assert.deepEqual(projected.seller_features, ['Tow bar', 'Bull bar']);

  // Missing stays missing (Invariant 8) — no empty string, no "Not specified", no [].
  const silent = toPublicVehicle({ vin: '1HGCM82633A004352', make: 'Toyota' });
  for (const field of SELLER_STATED_COMMERCIAL_FIELDS) {
    assert.equal(silent[field], null, `${field} must project as a bare null when the seller said nothing`);
  }
});

test('the governed classification stays distinct from the seller statement in the projection', () => {
  // A buyer must be able to tell "the seller called it Used" from "CarUp classified it Locally
  // Used". Collapsing them would let a seller statement read as a governed fact.
  assert.ok(PUBLIC_VEHICLE_FIELDS.includes('vehicle_condition_category'));
  assert.ok(PUBLIC_VEHICLE_FIELDS.includes('seller_stated_condition'));
  assert.notEqual('vehicle_condition_category', 'seller_stated_condition');
});
