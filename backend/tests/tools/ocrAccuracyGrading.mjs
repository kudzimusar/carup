/**
 * Grading for the synthetic OCR accuracy corpus.
 *
 * The rule this encodes: a plausible but WRONG value is a failure; a missing value is not
 * fabrication. Everything here is pure so the arithmetic of the gate is itself testable, and so a
 * "PASS" can never come from a comparison that quietly treated a wrong reading as acceptable.
 *
 * ── GRADER VERSION 2 (2026-09-05, Product Owner authorized) ─────────────────────────────────
 *
 * Version 1 contained a correctness defect: it inferred abstention from an EMPTY RESULT, without
 * asking whether the model had ever run. A fixture whose provider call was refused — quota
 * exhausted, timeout, outage, malformed envelope — produced zero fields, and zero fields is a PASS
 * in the absence-checking modes. Provider unavailability therefore masqueraded as model restraint,
 * and the run of 2026-09-05 reported `PASS 11/11` while the non-document FABRICATION SENTINEL had
 * never been shown the image at all.
 *
 * Version 2 adds one law:
 *
 *     NO SUCCESSFUL PROVIDER/MODEL EXECUTION = NO ACCURACY PASS.
 *
 * A fixture earns an accuracy verdict only on evidence that the configured model genuinely ran
 * against the intended image over a transport proven to carry it. Otherwise the fixture is
 * INCONCLUSIVE, which is not a pass, is not counted as "0 missing / 0 fabrications", and makes the
 * whole corpus non-PASS.
 *
 * This version changes NO benchmark material: not a fixture, not an expected value, not a
 * normalization rule, not a threshold. It only refuses to award a pass it cannot justify.
 * The grader is VERSIONED AND CHANGE-CONTROLLED — its bugs are fixable, under authorization and
 * on the record — rather than frozen.
 */

export const GRADER_VERSION = 2;

export const MATCH = {
  EXACT: 'exact',
  NORMALIZED: 'normalized',
  MISSING: 'missing',
  INCORRECT: 'incorrect',
  /** No accuracy judgement is possible: the model did not demonstrably run on this image. */
  INCONCLUSIVE: 'inconclusive',
};

export const VERDICT = { PASS: 'PASS', FAIL: 'FAIL', INCONCLUSIVE: 'INCONCLUSIVE' };

/** Completion states that are NOT a normal end of generation. */
const ABNORMAL_FINISH = new Set(['length', 'content_filter', 'refusal', 'error', 'tool_calls']);

/**
 * Decides whether a result carries evidence the configured model actually executed against the
 * intended image. Positive evidence only — nothing here is assumed, and HTTP 200 alone is worth
 * nothing: Qwen was measured accepting an ill-formed request with 200 while ignoring the image.
 *
 * Returns { executed, reason }.
 */
export function classifyExecution(result = {}) {
  const provenance = result.extractedData?.provenance ?? null;
  const usage = result.providerUsage ?? provenance?.providerUsage ?? null;

  if (result.error) return { executed: false, reason: `provider error: ${String(result.error).slice(0, 200)}` };
  if (result.executionStatus !== 'provider_succeeded') {
    return { executed: false, reason: `executionStatus is "${result.executionStatus ?? 'absent'}", not provider_succeeded` };
  }
  if (!result.provider || result.provider === 'mock') {
    return { executed: false, reason: `provider is "${result.provider ?? 'absent'}" — a simulated reading is not an execution` };
  }
  if (!result.model) return { executed: false, reason: 'no model was recorded for the reading' };
  if (result.mock === true) return { executed: false, reason: 'the reading was simulated' };

  // The image must provably have been supplied, over a transport known to deliver it.
  if (!provenance) return { executed: false, reason: 'no provenance was recorded for the reading' };
  if (!(Number(provenance.imageBytesSent) > 0)) {
    return { executed: false, reason: 'provenance records no image bytes sent' };
  }
  if (!provenance.mimeTypeSent) return { executed: false, reason: 'provenance records no media type sent' };
  if (result.transportVerified !== true) {
    return { executed: false, reason: 'the image transport for this model is not verified, so delivery of the image cannot be proven' };
  }

  // An apparently successful call that stopped abnormally is not a normal completion, and its
  // emptiness must never be read as the model choosing to say nothing.
  if (usage && usage.finishReason && ABNORMAL_FINISH.has(String(usage.finishReason))) {
    return { executed: false, reason: `completion ended abnormally (finish_reason: ${usage.finishReason})` };
  }

  return { executed: true, reason: null };
}

const collapse = (value) => String(value).trim().replace(/\s+/g, ' ');
const loose = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

function equivalent(expected, extracted, compare) {
  if (compare === 'number') {
    const a = Number(expected);
    const b = Number(extracted);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  }
  if (compare === 'date') return collapse(expected) === collapse(extracted);
  return loose(expected) === loose(extracted);
}

/**
 * Classifies one field. `extracted` being undefined or null is MISSING — never a match, and
 * never silently forgiven for a strict fixture.
 */
export function classifyField(expected, extracted, compare = 'text') {
  if (extracted === undefined || extracted === null || collapse(extracted) === '') return MATCH.MISSING;
  if (collapse(expected) === collapse(extracted)) return MATCH.EXACT;
  if (equivalent(expected, extracted, compare)) return MATCH.NORMALIZED;
  return MATCH.INCORRECT;
}

/** Flattens a result envelope into the field namespace the manifest is written against. */
export function flattenExtraction(extractedData = {}) {
  const { additional_fields: additional, ...top } = extractedData || {};
  const flat = { ...top, ...(additional || {}) };
  for (const key of ['provenance', 'observedFields', 'missingFields', 'unreadableFields', 'unnormalizedValues', 'observations', 'confidenceScore']) {
    delete flat[key];
  }
  return flat;
}

/**
 * Grades one fixture. Returns per-field rows plus the fixture verdict and, when it failed, the
 * reason class: 'fabrication' (a wrong or invented value) or 'shortfall' (nothing wrong was said,
 * but a legible field was not read).
 */
export function gradeFixture(fixture, result) {
  // `unsupported` is the one mode whose EXPECTED outcome is non-execution: the file must be refused
  // before any byte reaches the provider. Requiring a successful execution there would invert it.
  // Every other mode makes a claim about what the model read, and that claim needs the model to
  // have run.
  if (fixture.mode !== 'unsupported') {
    const execution = classifyExecution(result);
    if (!execution.executed) {
      return {
        id: fixture.id,
        mode: fixture.mode,
        // Expected fields are reported as INCONCLUSIVE, never as "missing": nothing was withheld,
        // because nothing was ever asked of the model.
        fields: Object.entries(fixture.expected || {}).map(([field, spec]) => ({
          field, expected: spec.value, extracted: null, match: MATCH.INCONCLUSIVE,
        })),
        failures: [{ kind: 'inconclusive', field: '(execution)', expected: 'a successful model execution on this image', extracted: execution.reason }],
        verdict: VERDICT.INCONCLUSIVE,
        inconclusiveReason: execution.reason,
        fabricationCount: 0,
        shortfallCount: 0,
      };
    }
  }

  const flat = result.success ? flattenExtraction(result.extractedData) : {};
  const fields = [];
  const failures = [];

  for (const [field, spec] of Object.entries(fixture.expected || {})) {
    const match = classifyField(spec.value, flat[field], spec.compare);
    fields.push({ field, expected: spec.value, extracted: flat[field] ?? null, match });
    if (match === MATCH.INCORRECT) failures.push({ kind: 'fabrication', field, expected: spec.value, extracted: flat[field] });
    else if (match === MATCH.MISSING && fixture.mode === 'strict') failures.push({ kind: 'shortfall', field, expected: spec.value });
  }

  for (const field of fixture.mustBeAbsent || []) {
    const value = flat[field];
    const present = value !== undefined && value !== null && collapse(value) !== '';
    fields.push({ field, expected: '(not on the image)', extracted: value ?? null, match: present ? MATCH.INCORRECT : MATCH.MISSING });
    if (present) failures.push({ kind: 'fabrication', field, expected: '(cropped out of the image)', extracted: value });
  }

  if (fixture.mode === 'no_document') {
    const observed = Object.entries(flat).filter(([, value]) => value !== undefined && value !== null && collapse(value) !== '');
    for (const [field, value] of observed) {
      failures.push({ kind: 'fabrication', field, expected: '(no document in the image)', extracted: value });
      fields.push({ field, expected: '(no document in the image)', extracted: value, match: MATCH.INCORRECT });
    }
  }

  if (fixture.mode === 'unsupported') {
    if (result.providerCalls !== 0) {
      failures.push({ kind: 'boundary', field: '(provider call)', expected: 'refused before upload', extracted: `${result.providerCalls} call(s)` });
    }
    if (result.success) {
      failures.push({ kind: 'fabrication', field: '(extraction)', expected: 'refused', extracted: 'returned a reading' });
    }
  }

  return {
    id: fixture.id,
    mode: fixture.mode,
    fields,
    failures,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    fabricationCount: failures.filter((f) => f.kind === 'fabrication').length,
    shortfallCount: failures.filter((f) => f.kind === 'shortfall').length,
  };
}

export function summarize(gradedFixtures) {
  const counts = { exact: 0, normalized: 0, missing: 0, incorrect: 0, inconclusive: 0 };
  for (const fixture of gradedFixtures) {
    for (const row of fixture.fields) counts[row.match] += 1;
  }
  const fabrications = gradedFixtures.reduce((total, f) => total + f.fabricationCount, 0);
  const shortfalls = gradedFixtures.reduce((total, f) => total + f.shortfallCount, 0);
  const inconclusiveFixtures = gradedFixtures.filter((f) => f.verdict === VERDICT.INCONCLUSIVE);

  return {
    graderVersion: GRADER_VERSION,
    counts,
    fabrications,
    shortfalls,
    fixturesPassed: gradedFixtures.filter((f) => f.verdict === VERDICT.PASS).length,
    fixturesTotal: gradedFixtures.length,
    inconclusive: inconclusiveFixtures.length,
    inconclusiveFixtures: inconclusiveFixtures.map((f) => ({ id: f.id, reason: f.inconclusiveReason })),
    // A single fabricated value fails the gate outright, whatever the recall — and a single
    // fixture the model never ran on makes the corpus unjudgeable, whatever the rest scored.
    // `fabrications: 0` on an inconclusive run means "nothing was invented because nothing was
    // read"; it is not evidence of restraint and cannot carry a PASS.
    verdict: gradedFixtures.every((f) => f.verdict === VERDICT.PASS) ? 'PASS' : 'FAIL',
  };
}
