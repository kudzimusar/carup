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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

/**
 * A result envelope carrying the execution evidence grader v2 requires before it will grade
 * accuracy at all: a real provider and model, the image provably sent, a verified transport and a
 * normal completion. The tests below exist to exercise the ACCURACY comparison, so they supply the
 * precondition rather than bypass it. Nothing about their assertions is relaxed.
 */
function ran(extractedData, over = {}) {
  return {
    success: true,
    provider: 'cloudflare',
    model: '@cf/qwen/qwen3.8-27b',
    executionStatus: 'provider_succeeded',
    transportVerified: true,
    providerUsage: { finishReason: 'stop', transportForm: 'contentPart' },
    extractedData: {
      ...extractedData,
      provenance: { imageBytesSent: 25876, mimeTypeSent: 'image/png', providerUsage: { finishReason: 'stop' } },
    },
    providerCalls: 1,
    ...over,
  };
}

const strictFixture = {
  id: 'unit-strict', mode: 'strict',
  expected: { first_name: { value: 'TESTCASE', compare: 'text' }, last_name: { value: 'SPECIMEN', compare: 'text' } },
};

test('grading: a fabricated value fails a fixture outright', () => {
  const graded = gradeFixture(strictFixture, ran({ first_name: 'TESTCASE', last_name: 'MOYO' }));
  assert.equal(graded.verdict, 'FAIL');
  assert.equal(graded.fabricationCount, 1);
  assert.equal(graded.failures[0].kind, 'fabrication');
});

test('grading: missing is a shortfall on a clean fixture and acceptable on a degraded one', () => {
  const strict = gradeFixture(strictFixture, ran({ first_name: 'TESTCASE' }));
  assert.equal(strict.verdict, 'FAIL');
  assert.equal(strict.fabricationCount, 0);
  assert.equal(strict.shortfallCount, 1, 'not reading a legible field is a shortfall, not a fabrication');

  const degraded = gradeFixture({ ...strictFixture, mode: 'no_fabrication' }, ran({}));
  assert.equal(degraded.verdict, 'PASS', 'a blurred document may legitimately yield nothing');

  const degradedButWrong = gradeFixture({ ...strictFixture, mode: 'no_fabrication' }, ran({ first_name: 'TENDAI', last_name: 'SPECIMEN' }));
  assert.equal(degradedButWrong.verdict, 'FAIL', 'guessing at a blurred field is still a fabrication');
});

test('grading: a field cropped out of the image may not come back', () => {
  const fixture = { id: 'unit-crop', mode: 'no_fabrication', expected: {}, mustBeAbsent: ['place_of_birth'] };
  assert.equal(gradeFixture(fixture, ran({ additional_fields: {} })).verdict, 'PASS');
  const invented = gradeFixture(fixture, ran({ additional_fields: { place_of_birth: 'GWERU' } }));
  assert.equal(invented.verdict, 'FAIL');
  assert.equal(invented.failures[0].kind, 'fabrication');
});

test('grading: any field read off a non-document is a failure', () => {
  const fixture = { id: 'unit-nondoc', mode: 'no_document', expected: {} };
  // A non-document that the model genuinely read and reported nothing from: still a PASS.
  assert.equal(gradeFixture(fixture, ran({})).verdict, 'PASS');
  assert.equal(gradeFixture(fixture, ran({ first_name: 'ANYONE' })).verdict, 'FAIL');
  // And the v1 hole: a non-executed run is no longer a pass on this sentinel.
  assert.equal(gradeFixture(fixture, { success: false, extractedData: undefined, executionStatus: 'provider_failed', error: 'refused' }).verdict, 'INCONCLUSIVE');
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
  delete env.CLOUDFLARE_ACCOUNT_ID;
  delete env.CLOUDFLARE_API_TOKEN;
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
  assert.match(gate, /if \(!activeProvider\.isConfigured\(\)\)/,
    'an unconfigured provider must stop the gate rather than be measured');
  for (const secret of [/GEMINI_API_KEY\s*=\s*['"][^'"]+['"]/, /CLOUDFLARE_API_TOKEN\s*=\s*['"][^'"]+['"]/]) {
    assert.doesNotMatch(gate, secret, 'no credential may be written into the gate');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// GRADER v2 — NO SUCCESSFUL PROVIDER/MODEL EXECUTION = NO ACCURACY PASS
//
// Version 1 inferred abstention from an empty result without asking whether the model had ever
// run, so a quota refusal on the non-document fabrication sentinel graded as PASS. These guards
// pin the correction. They ADD to the existing grading guarantees; none is relaxed.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const { classifyExecution, VERDICT, GRADER_VERSION } = await import('./tools/ocrAccuracyGrading.mjs');

const QWEN = '@cf/qwen/qwen3.8-27b';
/** A result that genuinely executed: real provider, real model, image provably sent, normal stop. */
const executed = (over = {}) => ({
  success: true,
  provider: 'cloudflare',
  model: QWEN,
  executionStatus: 'provider_succeeded',
  transportVerified: true,
  providerUsage: { neurons: 180, promptTokens: 1286, completionTokens: 300, finishReason: 'stop', transportForm: 'contentPart', imageBytesSent: 34504 },
  extractedData: { provenance: { imageBytesSent: 25876, mimeTypeSent: 'image/png', providerUsage: { finishReason: 'stop' } } },
  providerCalls: 1,
  ...over,
});

const SENTINEL = { id: 'non-document', mode: 'no_document', expected: {} };
const STRICT = { id: 'unit-strict-v2', mode: 'strict', expected: { first_name: { value: 'TESTCASE', compare: 'text' } } };

test('grader v2: provider failure + zero extracted fields is NOT a pass', () => {
  const graded = gradeFixture(SENTINEL, {
    success: false, provider: 'cloudflare', model: null, executionStatus: 'provider_failed',
    error: 'Cloudflare Workers AI refused the request — 4006', transportVerified: true, providerCalls: 3,
  });
  assert.equal(graded.verdict, VERDICT.INCONCLUSIVE);
  assert.notEqual(graded.verdict, 'PASS');
  assert.equal(graded.fabricationCount, 0);
  assert.match(graded.inconclusiveReason, /provider error/);
});

test('grader v2: quota exhaustion / RESOURCE_EXHAUSTED + zero fields is NOT a pass', () => {
  for (const error of [
    'Cloudflare Workers AI refused the request — 4006: you have used up your daily free allocation of 10,000 neurons',
    'Gemini vision returned no text: RESOURCE_EXHAUSTED [quota: GenerateRequestsPerDayPerProjectPerModel-FreeTier]',
  ]) {
    const graded = gradeFixture(SENTINEL, {
      success: false, provider: 'cloudflare', model: QWEN, executionStatus: 'provider_failed', error, transportVerified: true,
    });
    assert.equal(graded.verdict, VERDICT.INCONCLUSIVE, `quota refusal must not pass: ${error.slice(0, 40)}`);
  }
});

test('grader v2: a timeout + zero fields is NOT a pass', () => {
  const graded = gradeFixture(SENTINEL, {
    success: false, provider: 'cloudflare', model: QWEN, executionStatus: 'provider_failed',
    error: 'Cloudflare Workers AI request timed out after 90000ms', transportVerified: true,
  });
  assert.equal(graded.verdict, VERDICT.INCONCLUSIVE);
  assert.match(graded.inconclusiveReason, /timed out/);
});

test('grader v2: genuine abstention on the sentinel — real execution, zero fields — MAY pass', () => {
  const graded = gradeFixture(SENTINEL, executed({ extractedData: {
    additional_fields: {},
    provenance: { imageBytesSent: 25876, mimeTypeSent: 'image/png', providerUsage: { finishReason: 'stop' } },
  } }));
  assert.equal(graded.verdict, VERDICT.PASS, 'the model ran, saw the image and said nothing — that is abstention');
  assert.equal(graded.fabricationCount, 0);
  assert.equal(classifyExecution(executed()).executed, true);
});

test('grader v2: ordinary accuracy grading is unchanged for a real extraction', () => {
  const pass = gradeFixture(STRICT, executed({ extractedData: {
    first_name: 'TESTCASE',
    provenance: { imageBytesSent: 1, mimeTypeSent: 'image/png', providerUsage: { finishReason: 'stop' } },
  } }));
  assert.equal(pass.verdict, VERDICT.PASS);
  assert.equal(pass.fields[0].match, MATCH.EXACT);

  const wrong = gradeFixture(STRICT, executed({ extractedData: {
    first_name: 'TENDAI',
    provenance: { imageBytesSent: 1, mimeTypeSent: 'image/png', providerUsage: { finishReason: 'stop' } },
  } }));
  assert.equal(wrong.verdict, 'FAIL', 'a wrong value is still a fabrication failure');
  assert.equal(wrong.fabricationCount, 1);

  const short = gradeFixture(STRICT, executed({ extractedData: {
    provenance: { imageBytesSent: 1, mimeTypeSent: 'image/png', providerUsage: { finishReason: 'stop' } },
  } }));
  assert.equal(short.verdict, 'FAIL', 'a legible field not read is still a shortfall');
  assert.equal(short.shortfallCount, 1);
});

test('grader v2: an unproven image transport cannot certify abstention', () => {
  // Qwen was measured accepting Llama's top-level image field with HTTP 200 while ignoring the
  // image. A 200 with no proof of delivery is not evidence the model saw anything.
  const graded = gradeFixture(SENTINEL, executed({ transportVerified: false }));
  assert.equal(graded.verdict, VERDICT.INCONCLUSIVE);
  assert.match(graded.inconclusiveReason, /transport .* not verified|cannot be proven/);

  for (const [over, why] of [
    [{ extractedData: { provenance: { imageBytesSent: 0, mimeTypeSent: 'image/png' } } }, /no image bytes/],
    [{ extractedData: { provenance: { imageBytesSent: 10, mimeTypeSent: null } } }, /no media type/],
    [{ extractedData: {} }, /no provenance/],
    [{ provider: 'mock', mock: true }, /simulated|not an execution/],
    [{ model: null }, /no model/],
  ]) {
    const g = gradeFixture(SENTINEL, executed(over));
    assert.equal(g.verdict, VERDICT.INCONCLUSIVE, `must be inconclusive: ${why}`);
    assert.match(g.inconclusiveReason, why);
  }
});

test('grader v2: an abnormal completion is not abstention', () => {
  // An empty answer that stopped on "length" is a truncation, not the model declining to speak.
  for (const finishReason of ['length', 'content_filter', 'refusal']) {
    const g = gradeFixture(SENTINEL, executed({
      providerUsage: { finishReason, transportForm: 'contentPart' },
    }));
    assert.equal(g.verdict, VERDICT.INCONCLUSIVE, `finish_reason ${finishReason} must not read as abstention`);
    assert.match(g.inconclusiveReason, /abnormally/);
  }
});

test('grader v2: one INCONCLUSIVE fixture makes the whole corpus NON-PASS', () => {
  const allPass = [
    gradeFixture(STRICT, executed({ extractedData: { first_name: 'TESTCASE', provenance: { imageBytesSent: 1, mimeTypeSent: 'image/png' } } })),
    gradeFixture(SENTINEL, executed({ extractedData: { provenance: { imageBytesSent: 1, mimeTypeSent: 'image/png' } } })),
  ];
  assert.equal(summarize(allPass).verdict, 'PASS');

  const withInconclusive = [...allPass, gradeFixture(SENTINEL, {
    success: false, provider: 'cloudflare', model: QWEN, executionStatus: 'provider_failed',
    error: 'quota exhausted', transportVerified: true,
  })];
  const s = summarize(withInconclusive);
  assert.equal(s.verdict, 'FAIL', 'a corpus containing an unjudgeable fixture cannot pass');
  assert.equal(s.inconclusive, 1);
  assert.equal(s.inconclusiveFixtures[0].id, 'non-document');
  // The laundering path this fix closes: 0 fabrications on an inconclusive run is NOT restraint.
  assert.equal(s.fabrications, 0);
  assert.equal(s.fixturesPassed, 2);
  assert.notEqual(s.fixturesPassed, s.fixturesTotal);
  assert.equal(s.graderVersion, GRADER_VERSION);
});

test('grader v2: the unsupported-file fixture still passes on refusal — its expected outcome IS non-execution', () => {
  const fixture = { id: 'unsupported-file', mode: 'unsupported', expected: {} };
  assert.equal(gradeFixture(fixture, { success: false, providerCalls: 0, executionStatus: 'not_attempted' }).verdict, 'PASS');
  assert.equal(gradeFixture(fixture, { success: false, providerCalls: 1, executionStatus: 'not_attempted' }).verdict, 'FAIL');
});

test('grader v2: the gate supplies transport evidence and reports inconclusive fixtures', () => {
  const gate = readFileSync(path.join(toolDir, 'ocr-accuracy-gate.mjs'), 'utf8');
  assert.match(gate, /transportVerified/, 'the gate must tell the grader whether the transport is proven');
  assert.match(gate, /gradeFixture\(fixture, \{ \.\.\.result, providerCalls, transportVerified \}\)/);
  assert.match(gate, /INCONCLUSIVE/, 'inconclusive fixtures must be visible in the report');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// COST GOVERNANCE — live external-AI certification is MANUAL DISPATCH ONLY
//
// Both OCR workflows once carried a `push:` trigger on the OCR branch. That made them unintended
// automatic consumers of the Cloudflare Workers AI daily allocation: run 33935601087 fired from an
// ordinary push, ran the full 11-fixture corpus and spent ~2,503.6 neurons — about 42% of a day's
// free budget — with no owner dispatch and no approval. These guards are static: they read the
// workflow files and need no secrets, no network and no provider.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const LIVE_PROVIDER_WORKFLOWS = [
  '../../.github/workflows/o2-live-ocr-accuracy.yml',
  '../../.github/workflows/o2-ocr-schema-probe.yml',
];

/** The `on:` block only — so a `push:` inside a job step or a comment cannot fool the guard. */
function triggerBlock(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^on:/.test(l));
  assert.ok(start > -1, 'the workflow must declare an on: block');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^[A-Za-z_]/.test(l));
  return rest.slice(0, end === -1 ? rest.length : end).join('\n');
}

for (const rel of LIVE_PROVIDER_WORKFLOWS) {
  const name = rel.split('/').pop();

  test(`cost governance: ${name} is workflow_dispatch ONLY — no automatic live-provider execution`, () => {
    const yaml = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const on = triggerBlock(yaml);

    assert.match(on, /^\s{2}workflow_dispatch:/m, 'the workflow must remain manually dispatchable');

    // Any of these would spend the Cloudflare daily allocation without an owner deciding to.
    for (const [pattern, event] of [
      [/^\s{2}push:/m, 'push'],
      [/^\s{2}pull_request(_target)?:/m, 'pull_request'],
      [/^\s{2}schedule:/m, 'schedule'],
      [/^\s{2}repository_dispatch:/m, 'repository_dispatch'],
      [/^\s{2}workflow_run:/m, 'workflow_run'],
      [/^\s{2}issue_comment:/m, 'issue_comment'],
    ]) {
      assert.doesNotMatch(on, pattern,
        `${name} must not run automatically on ${event}: live external-AI certification costs real money and must be an explicit owner decision`);
    }
  });

  test(`cost governance: ${name} still reaches a real provider, so the dispatch-only rule matters`, () => {
    const yaml = readFileSync(new URL(rel, import.meta.url), 'utf8');
    // If this ever stops being true the guard above is pointless and should be re-examined,
    // rather than silently guarding a workflow that no longer spends anything.
    assert.match(yaml, /CLOUDFLARE_API_TOKEN/, `${name} is expected to use real provider credentials`);
  });
}

test('cost governance: no OTHER workflow gains automatic access to the Cloudflare AI credentials', () => {
  const dir = path.resolve(toolDir, '../../../.github/workflows');
  const offenders = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    const yaml = readFileSync(path.join(dir, entry), 'utf8');
    if (!/CLOUDFLARE_API_TOKEN/.test(yaml)) continue;
    const on = triggerBlock(yaml);
    if (/^\s{2}(push|pull_request|pull_request_target|schedule|repository_dispatch|workflow_run):/m.test(on)) {
      offenders.push(entry);
    }
  }
  assert.deepEqual(offenders, [],
    'a workflow holding the Cloudflare AI token must not run on an automatic event');
});
