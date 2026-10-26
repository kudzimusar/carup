import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ISO_3779_VIN_PATTERN,
  JAPANESE_FRAME_NUMBER_PATTERN,
  SELLER_VEHICLE_IDENTIFIER_PATTERN,
  hasAcceptableIdentifierShape,
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
  // T11-CAP-LR01-R2: the frame-number shape must be the SAME on both ends too, or a vehicle could be accepted by the form
  // and refused by the API (or the reverse) and duplicate detection would depend on which was asked.
  assert.equal(patternFrom('JAPANESE_FRAME_NUMBER_PATTERN'), JAPANESE_FRAME_NUMBER_PATTERN.source);
  assert.match(web, /!JAPANESE_FRAME_NUMBER_PATTERN\.test\(identifier\)/);
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

// ── T11-CAP-LR01-R2 §16 — the real Honda Vezel's frame number is ELEVEN characters ─────────────────────────

test('R2-§16: a documented Japanese frame number SHORTER than 12 characters is accepted — the real Vezel, RU3-1316558', () => {
  assert.equal(validSellerVehicleIdentifier('RU3-1316558'), true, 'the real 2018 Honda Vezel (11 characters)');
  assert.equal(sellerVehicleIdentifierProblem('RU3-1316558'), null);
  assert.equal(hasAcceptableIdentifierShape('RU3-1316558'), true);
  assert.equal(validSellerVehicleIdentifier('ru3-1316558'), true, 'lower case is a keyboard artefact');
  assert.equal(validSellerVehicleIdentifier('  RU3-1316558  '), true);
});

test('R2-§16: real frame numbers of different makes and lengths are accepted', () => {
  for (const frame of [
    'GFC27-027051',        // the Nissan Serena — 12 characters, six-digit serial: unchanged behaviour
    'RU3-1316558',         // Honda Vezel — 11
    'GK3-1234567',         // Honda Fit — 11
    'E12-123456',          // Nissan Note — 10
    'ZRR80-0123456',       // Toyota Voxy — 13 (already inside 12–17)
    'NZE141-3012345',      // Toyota Fielder — 14
    'JZX100-0123456',      // Toyota Chaser — 14
    'CP9A-0001234',        // Mitsubishi Lancer Evolution — 12
    'AE86-5012345',        // Toyota Corolla Levin — 12
  ]) assert.equal(validSellerVehicleIdentifier(frame), true, frame);
});

test('R2-§16: below 12 characters ONLY the structured frame shape is accepted — nothing else is lowered — and unsafe characters are refused at any length', () => {
  for (const refused of [
    'SHORT12345',          // the pre-existing example: 10 characters, no hyphen, not a frame number
    'RU31316558',          // a frame number with the hyphen missing
    'RU3-1316',            // a four-digit serial
    'GFC27-02705',         // the Serena's id with a digit missing: a five-digit tail is a truncation, not a frame number
    'R-1316558',           // a one-character type code
    'RU3--131655',         // a doubled hyphen
    '-RU3-131655',         // a leading hyphen
    '263-7732364',         // a phone number: the type code has no letter
    '123-4567890',         // purely numeric type code
    'RU3-13165A8',         // a letter inside the serial
    'RU3_1316558',         // underscore
    'RU3 1316558',         // space
    'RU3.1316558',         // punctuation
    'RU3-1316558;--',      // injection-shaped
    '<RU3>-1316558',       // markup-shaped
    'RU3-1316558\n',       // a trailing newline is trimmed, but an embedded one is not
  ].filter((v) => !v.endsWith('\n'))) {
    assert.equal(validSellerVehicleIdentifier(refused), false, `${JSON.stringify(refused)} must be refused`);
    assert.equal(sellerVehicleIdentifierProblem(refused), 'shape', refused);
  }
  assert.equal(validSellerVehicleIdentifier('RU3\n-1316558'), false, 'an embedded newline is not an identifier');
});

test('R2-§16: the VIN rule is untouched — a 17-character identifier is still held to ISO 3779, hyphenated frames are not', () => {
  assert.equal(validSellerVehicleIdentifier('JTELU9FJ9K5987234'), true);
  assert.equal(sellerVehicleIdentifierProblem('JTELU9FJ9K5987O34'), 'vin_alphabet');
  assert.equal(sellerVehicleIdentifierProblem('JTELU9FJ9K5987I34'), 'vin_alphabet');
  assert.equal(validSellerVehicleIdentifier('GFC27-0270511234'.padEnd(17, 'O')), true, '17 characters WITH a hyphen is a frame identifier, not a VIN');
  // the new shape never reaches a 17-character string, so it cannot weaken the VIN branch
  assert.equal(JAPANESE_FRAME_NUMBER_PATTERN.test('ABCDEFG-12345678'), true, '16 is the longest a frame number can be');
  assert.equal(JAPANESE_FRAME_NUMBER_PATTERN.test('ABCDEFGH-12345678'), false);
});

test('R2-§16: the public passport lookup is NOT widened — a frame number is still a restricted identifier, never a public VIN', async () => {
  const { classifyLookupIdentifier, LOOKUP_KINDS } = await import('../utils/passportLookupPolicy.js');
  assert.equal(classifyLookupIdentifier('RU3-1316558').kind, LOOKUP_KINDS.RESTRICTED);
  assert.equal(classifyLookupIdentifier('GFC27-027051').kind, LOOKUP_KINDS.RESTRICTED);
  assert.equal(classifyLookupIdentifier('JTELU9FJ9K5987234').kind, LOOKUP_KINDS.VIN);
});

test('R2-§16: the rule lives in ONE place — no backend file restates the shape pattern, and every file that rules a format invalid asks the shared helper', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!/^(node_modules|tests?|__tests__)$/.test(entry.name)) walk(full); } else if (/\.m?js$/.test(entry.name)) files.push(full);
    }
  };
  for (const dir of ['services', 'utils', 'routes', 'middleware', 'validators']) walk(path.join(root, dir));
  files.push(path.join(root, 'server.js'));
  assert.ok(files.length > 200, `the scan found only ${files.length} files`);

  const restating = [];
  const rulers = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    if (rel === path.join('utils', 'sellerVehicleIdentifier.js')) continue;
    const source = code(readFileSync(file, 'utf8'));
    if (/\[A-Z0-9-\]\{12,17\}/.test(source) || /VALID_VEHICLE_IDENTIFIER_RE/.test(source)) restating.push(rel);
    // A file that DECIDES a format is invalid (it names the exclusion reason in code) must ask the shared helper rather than judge for itself.
    if (/invalid_vin_format\(/.test(source)) rulers.push([rel, /hasAcceptableIdentifierShape/.test(source)]);
  }
  assert.deepEqual(restating, [], `these files restate the identifier shape instead of importing it: ${restating.join(', ')}`);
  assert.ok(rulers.length >= 1, 'no file rules an identifier invalid — the scan is not looking where it thinks it is');
  assert.deepEqual(rulers.filter(([, usesHelper]) => !usesHelper).map(([rel]) => rel), [], 'a file rules an identifier invalid without asking the shared helper');
  assert.match(readFileSync(new URL('../services/marketplace/marketplaceListingEligibility.js', import.meta.url), 'utf8'), /hasAcceptableIdentifierShape/);
  assert.match(readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /hyphenated Japanese frame number/);
});
