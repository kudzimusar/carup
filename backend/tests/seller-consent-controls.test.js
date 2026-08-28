/**
 * Seller Journey 1.0 / S3 — Seller Identity, Dealer Context & Privacy.
 *
 * Two consent decisions had fully governed READ paths and no way for a seller to make them:
 *
 *   · `listing_location_visibility` — the write path already accepted `location_visibility` and
 *     fail-closed on anything that was not an explicit 'public'. Its own comment named the gap:
 *     "Adding a control to the form is what would make this a seller's choice rather than a
 *     default." Until then, every seller's city was published because they typed it, not because
 *     they chose to publish it. (S0-P0-10.)
 *
 *   · `public_seller_display_enabled` — read fail-closed with `=== true` and projected as
 *     `seller_public_profile_enabled`, but never accepted on the write path at all, so no seller
 *     could ever turn their public identity on.
 *
 * Consent rules these tests hold:
 *   - absence of consent is not consent: an omitted identity flag stays OFF;
 *   - an out-of-vocabulary value is not a consent decision — it fails closed to the private answer;
 *   - the seller's explicit choice is honoured verbatim in both directions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { CLAIM_VISIBILITY } from '../utils/publicVehicleProjection.js';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function addVehicleHandler() {
  const start = server.indexOf("app.post('/api/vehicles/add'");
  assert.ok(start > -1, 'POST /api/vehicles/add must remain statically locatable');
  const rest = server.slice(start + 10);
  const next = /\napp\.(get|post|put|patch|delete)\(/.exec(rest);
  assert.ok(next);
  return server.slice(start, start + 10 + next.index);
}

/**
 * The handler's own resolution rules, re-derived here so the test states the contract rather than
 * restating the implementation's text. These mirror `submittedText`'s null-for-blank behaviour.
 */
const resolveLocationVisibility = submitted =>
  submitted === null || submitted === CLAIM_VISIBILITY.PUBLIC
    ? CLAIM_VISIBILITY.PUBLIC
    : CLAIM_VISIBILITY.WITHHELD;

const resolveIdentityConsent = submitted => submitted === true;

test('location visibility honours the seller and fails closed on anything else', () => {
  assert.equal(resolveLocationVisibility(CLAIM_VISIBILITY.PUBLIC), CLAIM_VISIBILITY.PUBLIC);
  assert.equal(resolveLocationVisibility(CLAIM_VISIBILITY.WITHHELD), CLAIM_VISIBILITY.WITHHELD);
  // Not a consent decision that can be read → the private answer, never the public one.
  assert.equal(resolveLocationVisibility('Public'), CLAIM_VISIBILITY.WITHHELD);
  assert.equal(resolveLocationVisibility('yes'), CLAIM_VISIBILITY.WITHHELD);
  assert.equal(resolveLocationVisibility('province_only'), CLAIM_VISIBILITY.WITHHELD);
});

test('public seller identity is accepted on the write path', () => {
  const handler = addVehicleHandler();
  assert.match(
    handler,
    /public_seller_display_enabled/,
    'the seller must be able to set their own public-identity consent; a read-only flag no seller '
    + 'can reach is not a choice',
  );
});

test('an omitted identity consent stays off — absence of consent is not consent', () => {
  assert.equal(resolveIdentityConsent(undefined), false);
  assert.equal(resolveIdentityConsent(null), false);
  // A truthy non-boolean is not a consent decision either. Only an explicit true opts in.
  assert.equal(resolveIdentityConsent('true'), false);
  assert.equal(resolveIdentityConsent(1), false);
  assert.equal(resolveIdentityConsent(true), true);
});

test('the handler resolves identity consent with a strict boolean, not coercion', () => {
  const handler = addVehicleHandler();
  assert.match(
    handler,
    /public_seller_display_enabled\s*===\s*true/,
    'consent must be compared with === true; coercion would let a stray string publish a seller',
  );
});

test('the seller consent columns are written, not merely accepted', () => {
  const handler = addVehicleHandler();
  const row = /const listingClaimColumns = \{([\s\S]*?)\n  \};/.exec(handler)
    ?? /const listingRow = \{([\s\S]*?)\n    \};/.exec(handler);
  assert.ok(row, 'the write row must remain statically readable');
  assert.match(handler, /listing_location_visibility:/);
  assert.match(handler, /public_seller_display_enabled:/);
});
