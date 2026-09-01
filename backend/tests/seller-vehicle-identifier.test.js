import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ISO_3779_VIN_PATTERN,
  SELLER_VEHICLE_IDENTIFIER_PATTERN,
  sellerVehicleIdentifierProblem,
  validSellerVehicleIdentifier,
} from '../utils/sellerVehicleIdentifier.js';

// The Seller identifier gate was widened from a strict 17-character ISO VIN to 12–17
// letters/numbers/hyphens so a real Zimbabwe-bound Japanese import could be listed at all. These
// tests hold the widening to exactly what the owner UAT required, and no further: the reason the
// old rule existed — one vehicle, one Passport — must survive it.

test('a documented Japanese frame identifier is accepted', () => {
  // The identifier from the Cotecna document that forced the widening, labelled "Chassis/VIN Number".
  assert.equal(validSellerVehicleIdentifier('GFC27-027051'), true);
  assert.equal(validSellerVehicleIdentifier('NZE1213045678'), true);
});

test('a well-formed 17-character ISO VIN is accepted', () => {
  assert.equal(validSellerVehicleIdentifier('JTELU9FJ9K5987234'), true);
  // Lower case is a keyboard artefact, not a different vehicle.
  assert.equal(validSellerVehicleIdentifier('jtelu9fj9k5987234'), true);
  assert.equal(validSellerVehicleIdentifier('  JTELU9FJ9K5987234  '), true);
});

test('a 17-character identifier carrying I, O or Q is REFUSED as a mistyped VIN', () => {
  // This is the duplicate-Passport case. ISO 3779 excludes these three characters so they can
  // never be read as 1, 0 and 0. Accepting `...5987O34` alongside `...5987034` gives one vehicle
  // two Passports, which is the outcome the whole identification flow exists to prevent.
  assert.equal(validSellerVehicleIdentifier('JTELU9FJ9K5987O34'), false);
  assert.equal(validSellerVehicleIdentifier('JTELU9FJ9K5987I34'), false);
  assert.equal(validSellerVehicleIdentifier('JTELU9FJ9K5987Q34'), false);
});

test('I, O and Q stay legal in identifiers that are not VINs', () => {
  // A 12–16 character frame number is not an ISO VIN and is not held to its alphabet. Applying the
  // VIN rule to it would re-break the very import the widening was for.
  assert.equal(validSellerVehicleIdentifier('GFO27-027051'), true);
  assert.equal(validSellerVehicleIdentifier('NZE12130456'.padEnd(16, 'O')), true);
  // 17 characters WITH a hyphen is a documented frame identifier, not a VIN.
  assert.equal(validSellerVehicleIdentifier('GFO27-0270511234O'), true);
});

test('length and emptiness are refused without throwing', () => {
  assert.equal(validSellerVehicleIdentifier('SHORT12345'), false, '10 characters is below the floor');
  assert.equal(validSellerVehicleIdentifier('A'.repeat(18)), false, '18 characters is above the ceiling');
  assert.equal(validSellerVehicleIdentifier(''), false);
  assert.equal(validSellerVehicleIdentifier('   '), false);
  assert.equal(validSellerVehicleIdentifier(null), false);
  assert.equal(validSellerVehicleIdentifier(undefined), false);
  assert.equal(validSellerVehicleIdentifier('JTELU9FJ9K598723!'), false, 'punctuation is not an identifier');
});

test('the Seller media lifecycle gate keeps generating an acceptable identifier', () => {
  // tests/agents/42-seller-media-lifecycle-staging.spec.ts builds `JTMLC` + a 3-character project
  // token + 9 digits. Tightening the VIN alphabet must not silently invalidate the staging gate's
  // own vehicles — that would red the Seller UAT for a reason unrelated to the product.
  assert.equal(validSellerVehicleIdentifier('JTMLCMXB053051151'), true, 'mobile-chromium run vin');
  assert.equal(validSellerVehicleIdentifier('JTMLCCHR057107881'), true, 'desktop chromium run vin');
});

test('the browser and the server agree on what counts as one vehicle', () => {
  // Duplicate detection must not depend on which end was asked. The rule is duplicated across two
  // packages because they cannot share a module, so the agreement is asserted rather than trusted.
  const web = readFileSync(
    new URL('../../web/src/lib/sellerVehicleIdentification.ts', import.meta.url),
    'utf8',
  );
  const patternFrom = (name) => {
    const match = web.match(new RegExp(`const ${name} = /(.+)/\\n`));
    assert.ok(match, `${name} must exist in the web identification lib`);
    return match[1];
  };

  assert.equal(patternFrom('SELLER_VEHICLE_IDENTIFIER_PATTERN'), SELLER_VEHICLE_IDENTIFIER_PATTERN.source);
  assert.equal(patternFrom('ISO_3779_VIN_PATTERN'), ISO_3779_VIN_PATTERN.source);
  // The 17-and-unhyphenated branch is the load-bearing half; a pattern match alone would not catch
  // its removal from one side.
  assert.match(web, /identifier\.length === 17 && !identifier\.includes\('-'\)/);
});

test('a refusal says WHY, so a seller can find their own typo', () => {
  // Shape and alphabet are different refusals and must not share one message. Telling a seller that
  // `JTELU9FJ9K5987O34` "must be 12 to 17 letters, numbers, or hyphens" describes a rule it already
  // satisfies, and leaves them re-reading a correct-looking identifier with no idea what is wrong.
  assert.equal(sellerVehicleIdentifierProblem('JTELU9FJ9K5987O34'), 'vin_alphabet');
  assert.equal(sellerVehicleIdentifierProblem('SHORT12345'), 'shape');
  assert.equal(sellerVehicleIdentifierProblem('GFC27-027051'), null);
  assert.equal(sellerVehicleIdentifierProblem(null), 'shape');

  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /SELLER_VEHICLE_IDENTIFIER_NOT_ISO_VIN/);
  assert.match(server, /never contains the letters I, O or Q/);
});

test('server.js owns no second copy of the identifier rule that could drift', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /from '\.\/utils\/sellerVehicleIdentifier\.js'/);
  assert.doesNotMatch(server, /function validSellerVehicleIdentifier/);
  assert.doesNotMatch(server, /function sellerVehicleIdentifierProblem/);
});
