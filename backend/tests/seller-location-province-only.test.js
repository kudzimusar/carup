/**
 * Seller Journey 1.0 / S3 — the middle answer about location.
 *
 * The two-value vocabulary forced an all-or-nothing decision: publish your city, or publish nothing
 * about where the vehicle is. A seller willing to say "somewhere in Manicaland" but not "this
 * street in Mutare" had no way to say so, and answered by withholding everything — which costs them
 * every province-level buyer too.
 *
 * `province_only` discloses strictly LESS than 'public'. The properties that make it safe:
 *   - the city leaf is withheld exactly as it would be under 'withheld';
 *   - a withheld leaf stays byte-identical to any other withheld leaf, so which field was withheld
 *     cannot be inferred from the shape of the answer;
 *   - the owner audience is unchanged — this narrows the PUBLIC answer only;
 *   - an unrecorded location is still `not_recorded` for everyone: withholding never implies that a
 *     location exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import {
  CLAIM_VISIBILITY,
  FIELD_STATES,
  toLocationClaim,
} from '../utils/publicVehicleProjection.js';

const SOURCE = 'seller_declared';

const recordedRow = visibility => ({
  listing_city: 'Mutare',
  listing_province: 'Manicaland',
  listing_country: 'ZW',
  listing_location_source: SOURCE,
  listing_location_visibility: visibility,
});

const leaf = (claim, name) => claim[name];

test('the vocabulary carries the third seller choice', () => {
  assert.equal(CLAIM_VISIBILITY.PROVINCE_ONLY, 'province_only');
  assert.deepEqual(
    Object.values(CLAIM_VISIBILITY).sort(),
    ['province_only', 'public', 'withheld'],
  );
});

test('province_only publishes the province and country and withholds the city', () => {
  const claim = toLocationClaim(recordedRow(CLAIM_VISIBILITY.PROVINCE_ONLY), { audience: 'public' });

  assert.equal(leaf(claim, 'province').value, 'Manicaland');
  assert.equal(leaf(claim, 'province').state, FIELD_STATES.RECORDED);
  assert.equal(leaf(claim, 'country').value, 'ZW');

  assert.equal(leaf(claim, 'city').value, null);
  assert.equal(leaf(claim, 'city').state, FIELD_STATES.WITHHELD);
  assert.equal(leaf(claim, 'city').source, null);
});

test('a city withheld by province_only is byte-identical to one withheld outright', () => {
  const partial = toLocationClaim(recordedRow(CLAIM_VISIBILITY.PROVINCE_ONLY), { audience: 'public' });
  const withheld = toLocationClaim(recordedRow(CLAIM_VISIBILITY.WITHHELD), { audience: 'public' });
  // If these differed, the shape of the answer would disclose which choice the seller made.
  assert.deepEqual(leaf(partial, 'city'), leaf(withheld, 'city'));
});

test('province_only discloses strictly less than public and strictly more than withheld', () => {
  const isPublished = entry => entry.state === FIELD_STATES.RECORDED;
  const shown = visibility => ['city', 'province', 'country']
    .filter(name => isPublished(leaf(toLocationClaim(recordedRow(visibility), { audience: 'public' }), name)));

  assert.deepEqual(shown(CLAIM_VISIBILITY.PUBLIC), ['city', 'province', 'country']);
  assert.deepEqual(shown(CLAIM_VISIBILITY.PROVINCE_ONLY), ['province', 'country']);
  assert.deepEqual(shown(CLAIM_VISIBILITY.WITHHELD), []);
});

test('the owner audience is unaffected — this narrows the public answer only', () => {
  const claim = toLocationClaim(recordedRow(CLAIM_VISIBILITY.PROVINCE_ONLY), { audience: 'owner' });
  assert.equal(leaf(claim, 'city').value, 'Mutare');
  assert.equal(leaf(claim, 'province').value, 'Manicaland');
});

test('an unprovenanced location is not_recorded under every visibility, including the new one', () => {
  for (const visibility of Object.values(CLAIM_VISIBILITY)) {
    const claim = toLocationClaim(
      { listing_city: 'Mutare', listing_province: 'Manicaland', listing_location_source: null, listing_location_visibility: visibility },
      { audience: 'public' },
    );
    // Withholding must never become a way of implying a location exists.
    assert.equal(leaf(claim, 'city').state, FIELD_STATES.NOT_RECORDED, `city under ${visibility}`);
    assert.equal(leaf(claim, 'province').state, FIELD_STATES.NOT_RECORDED, `province under ${visibility}`);
  }
});

test('the migration widens the vocabulary without touching seller data', () => {
  const sql = fs.readFileSync(
    new URL('../../database/migrations/20260828160000_seller_s3_location_visibility_province_only.sql', import.meta.url),
    'utf8',
  );
  const declared = /c_visibility text\[\] := ARRAY\[([^\]]*)\]/.exec(sql);
  assert.ok(declared, 'the migration must declare the visibility vocabulary');
  const fromSql = [...declared[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  // One vocabulary, declared once in SQL and once in the module — never two copies that drift.
  assert.deepEqual(fromSql.sort(), Object.values(CLAIM_VISIBILITY).sort());

  // It must prove it rewrote nothing, and it must not relax the provenance requirement.
  assert.match(sql, /must not backfill/i);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.doesNotMatch(sql, /DROP CONSTRAINT\s+vehicles_listing_location_requires_source/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.vehicles\s+SET/i);
});
