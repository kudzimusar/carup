/**
 * The synthetic OCR accuracy corpus and the gate that measures against it.
 *
 * These run without a provider. They prove the corpus is real (every fixture exists, and every
 * expected value is genuinely the value rendered into that fixture's pixels), that the grading
 * arithmetic treats a wrong value as a failure and a missing value as a shortfall, and that the
 * gate cannot report a pass when it never ran.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const toolDir = new URL('./tools/', import.meta.url).pathname;
const repoRoot = path.resolve(toolDir, '../../..');
const corpusDir = path.join(repoRoot, 'docs/features/o2/uat-assets/ocr-corpus');
const manifest = JSON.parse(readFileSync(path.join(toolDir, 'ocr-corpus-manifest.json'), 'utf8'));

const { resolveSchema, normalizeDate, normalizeAmount, normalizeYear, normalizeSex } =
  await import('../services/document-intelligence/documentSchemas.js');
const { classifyField, gradeFixture, summarize, MATCH } = await import('./tools/ocrAccuracyGrading.mjs');

const loose = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

test('corpus: every fixture named in the manifest exists on disk', () => {
  for (const fixture of manifest.fixtures) {
    const file = path.join(corpusDir, fixture.file);
    assert.ok(existsSync(file), `${fixture.file} is missing — regenerate with backend/tests/tools/generate-ocr-corpus.mjs`);
    const bytes = readFileSync(file);
    assert.ok(bytes.length > 0);
    if (fixture.file.endsWith('.png')) {
      assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]), `${fixture.file} must be a real PNG`);
    }
  }
});

test('corpus: the corpus covers clean, degraded, non-document and unsupported inputs', () => {
  const ids = manifest.fixtures.map((f) => f.id);
  for (const required of [
    'national-id-clean', 'national-id-rotated', 'national-id-blurred', 'national-id-glare',
    'national-id-cropped', 'passport-clean', 'drivers-licence-clean', 'registration-book-clean',
    'customs-declaration-clean', 'non-document', 'unsupported-file',
  ]) {
    assert.ok(ids.includes(required), `the corpus must include the ${required} variant`);
  }
});

test('corpus: every expected field is a field the schema for that document can actually produce', () => {
  for (const fixture of manifest.fixtures) {
    const schema = resolveSchema(fixture.docType);
    for (const field of Object.keys(fixture.expected || {})) {
      assert.ok(schema.fields[field], `${fixture.id} expects ${field}, which is not in the ${schema.documentClass} schema`);
    }
    for (const field of fixture.mustBeAbsent || []) {
      assert.ok(schema.fields[field], `${fixture.id} pins ${field} as absent, but that field is not in the schema`);
    }
  }
});

test('corpus: every expected value is the value rendered into that fixture — the answer key comes from the pixels', () => {
  for (const fixture of manifest.fixtures) {
    if (!fixture.layout) continue;
    const printed = manifest.layouts[fixture.layout].fields.map((f) => String(f.value));

    for (const [field, spec] of Object.entries(fixture.expected)) {
      const matched = printed.some((value) => {
        if (spec.compare === 'date') return normalizeDate(value).value === spec.value;
        if (spec.compare === 'number') {
          return normalizeAmount(value).value === spec.value || normalizeYear(value).value === spec.value;
        }
        if (field === 'sex') return normalizeSex(value).value === spec.value;
        return loose(value) === loose(spec.value);
      });
      assert.ok(matched, `${fixture.id}.${field} expects ${JSON.stringify(spec.value)}, which is not printed on that fixture`);
    }
  }
});

test('grading: a wrong value is a failure and a missing value is not', () => {
  assert.equal(classifyField('SPECIMEN', 'SPECIMEN'), MATCH.EXACT);
  assert.equal(classifyField('SPECIMEN', ' specimen '), MATCH.NORMALIZED);
  assert.equal(classifyField('63-1234567-A-42', '6312345 67A42', 'code'), MATCH.NORMALIZED);
  assert.equal(classifyField('SPECIMEN', undefined), MATCH.MISSING);
  assert.equal(classifyField('SPECIMEN', ''), MATCH.MISSING);
  assert.equal(classifyField('SPECIMEN', null), MATCH.MISSING);
  assert.equal(classifyField('63-1234567-A-42', '63-1234567-A-43', 'code'), MATCH.INCORRECT,
    'one digit different is a wrong reading, not a near miss');
  assert.equal(classifyField('1990-01-01', '1990-10-01', 'date'), MATCH.INCORRECT);
  assert.equal(classifyField(2018, 2019, 'number'), MATCH.INCORRECT);
  assert.equal(classifyField(48250.5, 48250.5, 'number'), MATCH.EXACT);
});

const strictFixture = {
  id: 'unit-strict', mode: 'strict',
  expected: { first_name: { value: 'TESTCASE', compare: 'text' }, last_name: { value: 'SPECIMEN', compare: 'text' } },
};

test('grading: a fabricated value fails a fixture outright', () => {
  const graded = gradeFixture(strictFixture, {
    success: true, extractedData: { first_name: 'TESTCASE', last_name: 'MOYO' },
  });
  assert.equal(graded.verdict, 'FAIL');
  assert.equal(graded.fabricationCount, 1);
  assert.equal(graded.failures[0].kind, 'fabrication');
});

test('grading: missing is a shortfall on a clean fixture and acceptable on a degraded one', () => {
  const strict = gradeFixture(strictFixture, { success: true, extractedData: { first_name: 'TESTCASE' } });
  assert.equal(strict.verdict, 'FAIL');
  assert.equal(strict.fabricationCount, 0);
  assert.equal(strict.shortfallCount, 1, 'not reading a legible field is a shortfall, not a fabrication');

  const degraded = gradeFixture({ ...strictFixture, mode: 'no_fabrication' }, { success: true, extractedData: {} });
  assert.equal(degraded.verdict, 'PASS', 'a blurred document may legitimately yield nothing');

  const degradedButWrong = gradeFixture({ ...strictFixture, mode: 'no_fabrication' }, {
    success: true, extractedData: { first_name: 'TENDAI', last_name: 'SPECIMEN' },
  });
  assert.equal(degradedButWrong.verdict, 'FAIL', 'guessing at a blurred field is still a fabrication');
});

test('grading: a field cropped out of the image may not come back', () => {
  const fixture = { id: 'unit-crop', mode: 'no_fabrication', expected: {}, mustBeAbsent: ['place_of_birth'] };
  assert.equal(gradeFixture(fixture, { success: true, extractedData: { additional_fields: {} } }).verdict, 'PASS');
  const invented = gradeFixture(fixture, { success: true, extractedData: { additional_fields: { place_of_birth: 'GWERU' } } });
  assert.equal(invented.verdict, 'FAIL');
  assert.equal(invented.failures[0].kind, 'fabrication');
});

test('grading: any field read off a non-document is a failure', () => {
  const fixture = { id: 'unit-nondoc', mode: 'no_document', expected: {} };
  assert.equal(gradeFixture(fixture, { success: false, extractedData: undefined }).verdict, 'PASS');
  assert.equal(gradeFixture(fixture, { success: true, extractedData: { first_name: 'ANYONE' } }).verdict, 'FAIL');
});

test('grading: an unsupported file must be refused before the provider is called', () => {
  const fixture = { id: 'unit-unsupported', mode: 'unsupported', expected: {} };
  assert.equal(gradeFixture(fixture, { success: false, providerCalls: 0 }).verdict, 'PASS');
  const uploaded = gradeFixture(fixture, { success: false, providerCalls: 1 });
  assert.equal(uploaded.verdict, 'FAIL');
  assert.equal(uploaded.failures[0].kind, 'boundary');
});

test('grading: the corpus verdict is PASS only when every fixture passed', () => {
  const pass = summarize([{ verdict: 'PASS', fields: [], fabricationCount: 0, shortfallCount: 0 }]);
  assert.equal(pass.verdict, 'PASS');
  const mixed = summarize([
    { verdict: 'PASS', fields: [], fabricationCount: 0, shortfallCount: 0 },
    { verdict: 'FAIL', fields: [], fabricationCount: 1, shortfallCount: 0 },
  ]);
  assert.equal(mixed.verdict, 'FAIL');
  assert.equal(mixed.fabrications, 1);
});

test('gate: without provider authorization the gate reports NOT_RUN and cannot be read as a pass', () => {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [path.join(toolDir, 'ocr-accuracy-gate.mjs')], { env, encoding: 'utf8' });
  } catch (error) {
    status = error.status;
    stdout = error.stdout || '';
  }
  assert.equal(status, 3, 'NOT_RUN exits non-zero so it can never be mistaken for a pass');
  assert.match(stdout, /OCR_ACCURACY_GATE: NOT_RUN/);
  assert.doesNotMatch(stdout, /OCR_ACCURACY_GATE: PASS/);
});

test('gate: the measurement run cannot take the simulated path', () => {
  const gate = readFileSync(path.join(toolDir, 'ocr-accuracy-gate.mjs'), 'utf8');
  assert.match(gate, /process\.env\.ALLOW_OCR_MOCK = 'false'/,
    'a measurement of the simulation would measure nothing about OCR');
  assert.match(gate, /if \(!process\.env\.GEMINI_API_KEY\)/);
  assert.doesNotMatch(gate, /GEMINI_API_KEY\s*=\s*['"][^'"]+['"]/, 'no credential may be written into the gate');
});
