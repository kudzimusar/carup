/**
 * Grading for the synthetic OCR accuracy corpus.
 *
 * The rule this encodes: a plausible but WRONG value is a failure; a missing value is not
 * fabrication. Everything here is pure so the arithmetic of the gate is itself testable, and so a
 * "PASS" can never come from a comparison that quietly treated a wrong reading as acceptable.
 */

export const MATCH = {
  EXACT: 'exact',
  NORMALIZED: 'normalized',
  MISSING: 'missing',
  INCORRECT: 'incorrect',
};

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
  const counts = { exact: 0, normalized: 0, missing: 0, incorrect: 0 };
  for (const fixture of gradedFixtures) {
    for (const row of fixture.fields) counts[row.match] += 1;
  }
  const fabrications = gradedFixtures.reduce((total, f) => total + f.fabricationCount, 0);
  const shortfalls = gradedFixtures.reduce((total, f) => total + f.shortfallCount, 0);
  return {
    counts,
    fabrications,
    shortfalls,
    fixturesPassed: gradedFixtures.filter((f) => f.verdict === 'PASS').length,
    fixturesTotal: gradedFixtures.length,
    // A single fabricated value fails the gate outright, whatever the recall.
    verdict: gradedFixtures.every((f) => f.verdict === 'PASS') ? 'PASS' : 'FAIL',
  };
}
