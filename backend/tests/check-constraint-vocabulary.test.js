/**
 * Seller Journey 1.0 / S3 — the gate's own verifier must be able to read the constraint it checks.
 *
 * THE DEFECT THIS EXISTS FOR. The first S3 staging run failed with:
 *
 *   {"constraint_present":true,"vocabulary_in_force":[],"missing_values":["province_only","public","withheld"]}
 *
 * The constraint was installed correctly. The PARSER could not read it: `pg_get_constraintdef`
 * rendered the array as `'{public,withheld}'::text[]` and the regex only understood
 * `ARRAY['public'::text, ...]`. The gate refused, which was the right outcome — but for the wrong
 * reason, and a verifier that cannot read a healthy constraint is one that cannot certify anything.
 *
 * The important property is not "it parses". It is that an unreadable definition yields NO values,
 * so a caller treating emptiness as failure keeps failing closed rather than certifying a
 * constraint nobody actually read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCheckVocabulary } from '../utils/checkConstraintVocabulary.js';

const COLUMN = 'listing_location_visibility';
const EXPECTED = ['public', 'withheld', 'province_only'];

/** The shape the first parser understood. */
const ARRAY_FORM =
  `CHECK ((${COLUMN} IS NULL OR (${COLUMN} = ANY (ARRAY['public'::text, 'withheld'::text, 'province_only'::text]))))`;

/** The shape staging actually produced, against which the first parser returned nothing. */
const BRACED_FORM =
  `CHECK ((${COLUMN} IS NULL OR (${COLUMN} = ANY ('{public,withheld,province_only}'::text[]))))`;

test('both renderings of the same constraint yield the same vocabulary', () => {
  assert.deepEqual(parseCheckVocabulary(ARRAY_FORM).sort(), [...EXPECTED].sort());
  assert.deepEqual(parseCheckVocabulary(BRACED_FORM).sort(), [...EXPECTED].sort());
  assert.deepEqual(
    parseCheckVocabulary(ARRAY_FORM).sort(),
    parseCheckVocabulary(BRACED_FORM).sort(),
    'the same constraint must not read differently depending on how Postgres folded the literal',
  );
});

test('the pre-widening two-value constraint still reads correctly in both shapes', () => {
  const before = ['public', 'withheld'];
  assert.deepEqual(
    parseCheckVocabulary(`CHECK ((${COLUMN} = ANY (ARRAY['public'::text, 'withheld'::text])))`).sort(),
    [...before].sort(),
  );
  assert.deepEqual(
    parseCheckVocabulary(`CHECK ((${COLUMN} = ANY ('{public,withheld}'::text[])))`).sort(),
    [...before].sort(),
  );
});

test('a quoted array element keeps its value and loses only its quoting', () => {
  assert.deepEqual(parseCheckVocabulary(`ANY ('{"province_only","public"}'::text[])`).sort(), ['province_only', 'public']);
});

test('an unreadable definition yields nothing, so the caller fails closed', () => {
  // Emptiness is the signal that lets a gate say "I could not verify this" instead of certifying a
  // constraint it never actually read.
  assert.deepEqual(parseCheckVocabulary(''), []);
  assert.deepEqual(parseCheckVocabulary(null), []);
  assert.deepEqual(parseCheckVocabulary(undefined), []);
  assert.deepEqual(parseCheckVocabulary('CHECK (mileage >= 0)'), []);
});

test('the S3 runner treats an empty read as failure rather than success', async () => {
  const runner = (await import('node:fs')).readFileSync(
    new URL('../scripts/seller-s3-location-visibility-staging.mjs', import.meta.url), 'utf8',
  );
  // `missing_values` is derived from the expected list against what was read, so an empty read
  // reports every value missing and `ok` is false. This is the line that made the first failure a
  // refusal rather than a false PASS.
  assert.match(runner, /missing_values:\s*missing/);
  assert.match(runner, /ok:\s*vocabulary\.present/);
  assert.match(runner, /parseCheckVocabulary/);
});
