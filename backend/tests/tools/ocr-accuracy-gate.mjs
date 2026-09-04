/**
 * OCR accuracy gate — measures the SHIPPED extraction against the synthetic corpus.
 *
 *   GEMINI_API_KEY=… node backend/tests/tools/ocr-accuracy-gate.mjs [--out <dir>]
 *
 * Exit codes: 0 PASS · 1 FAIL · 3 NOT_RUN (no provider authorization). NOT_RUN is deliberately
 * non-zero: an unrun gate must never be mistaken for a passed one.
 *
 * The gate reads real fixture pixels through the real service. HTTP 200 is not success — every
 * expected field is compared value by value, and a plausible but wrong value fails the gate
 * outright. Missing is preferable to fabrication and is graded as a shortfall, not a fabrication.
 *
 * No credential is read from, or written to, the repository: the key comes from the environment
 * of whoever is authorized to run it, and never appears in the output.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeFixture, summarize, flattenExtraction } from './ocrAccuracyGrading.mjs';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDir, '../../..');
const corpusDir = path.join(root, 'docs/features/o2/uat-assets/ocr-corpus');
const manifest = JSON.parse(readFileSync(path.join(toolDir, 'ocr-corpus-manifest.json'), 'utf8'));

const outIndex = process.argv.indexOf('--out');
const outDir = outIndex > -1 ? path.resolve(process.argv[outIndex + 1]) : path.join(root, 'docs/features/o2/uat-assets');

// The service must never take the test-mode simulation path during a measurement run.
process.env.ALLOW_OCR_MOCK = 'false';

const { resolveVisionProvider } = await import('../../services/ai/ocrVisionProvider.js');
const activeProvider = resolveVisionProvider();
if (!activeProvider.isConfigured()) {
  console.log('OCR_ACCURACY_GATE: NOT_RUN');
  console.log(`  Provider "${activeProvider.id}" is selected but ${activeProvider.requiredEnv.join(' and ')} are not configured.`);
  console.log('  The gate measures a live provider against the synthetic corpus; it cannot be');
  console.log('  simulated, and a simulated run would measure the simulation, not the OCR.');
  process.exit(3);
}
console.log(`Provider under measurement: ${activeProvider.id} / ${activeProvider.model}\n`);
process.env.NODE_ENV ||= 'production';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'gate-local-service-role';
process.env.SUPABASE_ANON_KEY ||= 'gate-local-anon';
process.env.JWT_SECRET ||= 'gate-local-jwt';

const { DocumentIntelligenceService } = await import('../../services/document-intelligence/documentIntelligenceService.js');
const { supabase } = await import('../../db/supabase.js');

// Evidence rows belong to a real run against a real database. This gate measures extraction, so
// its writes are captured rather than persisted; nothing about the reading is affected.
const capturedWrites = [];
supabase.from = (table) => ({
  insert: (row) => { capturedWrites.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
  update: () => Promise.resolve({ data: null, error: null }),
  upsert: () => Promise.resolve({ data: null, error: null }),
  select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
});

const mimeFor = (file) => (file.endsWith('.png') ? 'image/png' : file.endsWith('.txt') ? 'text/plain' : 'application/octet-stream');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// The corpus is paced so a per-minute provider quota is not itself measured as an OCR failure.
// Raise PACE_MS on a tighter quota; it changes how fast the gate asks, never what it accepts.
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_BACKOFF_MS = [35_000, 65_000];
const PACE_MS = Number(process.env.OCR_GATE_PACE_MS ?? 13_000);

// A subset run is a DIAGNOSTIC, for re-measuring one fixture without spending the whole corpus
// against a constrained provider quota. It can never report a gate PASS: the verdict becomes
// PARTIAL and the exit code stays non-zero, because a gate that skipped fixtures did not pass.
const only = (process.env.OCR_GATE_ONLY || '').split(',').map((id) => id.trim()).filter(Boolean);
const selected = only.length ? manifest.fixtures.filter((f) => only.includes(f.id)) : manifest.fixtures;
if (only.length) {
  const unknown = only.filter((id) => !manifest.fixtures.some((f) => f.id === id));
  if (unknown.length) {
    console.log(`OCR_ACCURACY_GATE: NOT_RUN — unknown fixture id(s): ${unknown.join(', ')}`);
    process.exit(3);
  }
  console.log(`PARTIAL DIAGNOSTIC RUN — ${selected.length} of ${manifest.fixtures.length} fixtures. This can never report PASS.\n`);
}

const graded = [];
const runs = [];
let fixtureIndex = 0;

for (const fixture of selected) {
  if (fixtureIndex > 0 && PACE_MS > 0) await sleep(PACE_MS);
  fixtureIndex += 1;
  const filePath = path.join(corpusDir, fixture.file);
  const bytes = readFileSync(filePath);
  const dataUri = `data:${mimeFor(fixture.file)};base64,${bytes.toString('base64')}`;

  let providerCalls = 0;
  const countingProvider = {
    id: activeProvider.id,
    model: activeProvider.model,
    isConfigured: () => activeProvider.isConfigured(),
    requiredEnv: activeProvider.requiredEnv,
    extract: (args) => { providerCalls += 1; return activeProvider.extract(args); },
  };

  const startedAt = Date.now();
  const attempts = [];
  let result;
  // A transport failure is not a reading. Bounded retries separate a flaky or rate-limited call
  // from a provider that genuinely cannot read the document; EVERY attempt is recorded, so a retry
  // can never hide a systematic failure — and a retry is never taken on a reading the provider
  // actually gave. RESOURCE_EXHAUSTED is the provider asking to be slowed down, so it backs off.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    result = await DocumentIntelligenceService.extractDocumentData(
      fixture.docType, dataUri, 'ocr-accuracy-gate', { visionProvider: countingProvider },
    );
    attempts.push({
      attempt,
      executionStatus: result.executionStatus,
      extractionStatus: result.extractionStatus,
      error: result.error || null,
      latencyMs: result.latencyMs,
    });
    if (result.executionStatus !== 'provider_failed' || attempt === MAX_ATTEMPTS) break;
    const rateLimited = /RESOURCE_EXHAUSTED|HTTP 429/.test(result.error || '');
    const backoffMs = rateLimited ? RATE_LIMIT_BACKOFF_MS[attempt - 1] : 2_000;
    console.log(`    transport retry ${attempt + 1}/${MAX_ATTEMPTS} for ${fixture.id} in ${backoffMs}ms: ${result.error}`);
    await sleep(backoffMs);
  }
  const wallMs = Date.now() - startedAt;

  const grade = gradeFixture(fixture, { ...result, providerCalls });
  graded.push(grade);
  runs.push({
    id: fixture.id,
    file: fixture.file,
    docType: fixture.docType,
    mode: fixture.mode,
    provider: result.provider,
    model: result.model,
    executionStatus: result.executionStatus,
    extractionStatus: result.extractionStatus,
    confidence: result.confidence,
    confidenceReported: result.confidenceReported,
    latencyMs: result.latencyMs,
    wallMs,
    providerCalls,
    structuredCandidate: result.structuredCandidate || null,
    providerUsage: result.providerUsage || null,
    verdict: grade.verdict,
    attempts,
    error: result.error || null,
    // Root-cause detail: what the provider actually returned, so a shortfall can be traced to the
    // prompt, the schema or the normalizer rather than guessed at. Field VALUES only — no payload.
    diagnostics: {
      documentClassObserved: result.extractedData?.provenance?.documentClassObserved ?? null,
      observedFields: result.extractedData?.observedFields ?? [],
      missingFields: result.extractedData?.missingFields ?? [],
      unnormalizedValues: result.extractedData?.unnormalizedValues ?? {},
      carriedIdentifiers: result.extractedData?.carriedIdentifiers ?? [],
      unreadableFields: result.extractedData?.unreadableFields ?? [],
      observations: result.extractedData?.observations ?? [],
      allExtracted: result.success ? flattenExtraction(result.extractedData) : {},
    },
  });

  const label = `${grade.verdict === 'PASS' ? '✓' : '✗'} ${fixture.id}`;
  const neurons = result.providerUsage?.neurons;
  console.log(`${label} — ${result.provider}/${result.model || 'n/a'} · ${result.extractionStatus} · ${wallMs}ms · confidence ${result.confidenceReported ? result.confidence : 'not reported'}${neurons ? ` · ${neurons.toFixed(2)} neurons` : ''}`);
  for (const failure of grade.failures) {
    console.log(`    ${failure.kind.toUpperCase()}: ${failure.field} — expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.extracted)}`);
  }
}

const measured = summarize(graded);
// A partial run is never a pass, however well the fixtures it did run performed.
const summary = only.length ? { ...measured, verdict: 'PARTIAL', partial: true, fixturesSkipped: manifest.fixtures.length - selected.length } : measured;

const rows = graded.flatMap((fixture) => fixture.fields.map((row) => {
  const run = runs.find((r) => r.id === fixture.id);
  return `| ${fixture.id} | ${row.field} | ${JSON.stringify(row.expected)} | ${JSON.stringify(row.extracted)} | ${row.match} | ${run.provider}/${run.model || 'n/a'} | ${run.latencyMs}ms | ${run.confidenceReported ? run.confidence : '—'} |`;
}));

const report = [
  '# OCR accuracy gate — measured results',
  '',
  `- Run: ${new Date().toISOString()}`,
  `- Corpus: ${manifest.version} (${manifest.fixtures.length} fixtures)`,
  `- Provider: ${activeProvider.id} / ${activeProvider.model}`,
  `- Provider-reported usage: ${runs.reduce((t, r) => t + (r.providerUsage?.neurons ?? 0), 0).toFixed(2)} neurons across ${runs.reduce((t, r) => t + r.providerCalls, 0)} call(s)`,
  `- Verdict: **${summary.verdict}**`,
  ...(summary.partial ? [`- **PARTIAL DIAGNOSTIC RUN — ${summary.fixturesSkipped} fixture(s) were not measured. A partial run is never a gate pass.**`] : []),
  `- Fixtures passed: ${summary.fixturesPassed}/${summary.fixturesTotal}`,
  `- Fabricated values: ${summary.fabrications} · shortfalls (legible field not read): ${summary.shortfalls}`,
  `- Field results: ${summary.counts.exact} exact · ${summary.counts.normalized} normalized · ${summary.counts.missing} missing · ${summary.counts.incorrect} incorrect`,
  '',
  '| Fixture | Field | Expected | Extracted | Result | Provider/model | Latency | Confidence |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
].join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'OCR_ACCURACY_RESULTS.md'), `${report}\n`, 'utf8');
writeFileSync(path.join(outDir, 'ocr-accuracy-results.json'), `${JSON.stringify({ manifest: manifest.version, summary, runs, graded }, null, 2)}\n`, 'utf8');

console.log(`\nOCR_ACCURACY_GATE: ${summary.verdict}`);
console.log(`  fixtures ${summary.fixturesPassed}/${summary.fixturesTotal} · fabrications ${summary.fabrications} · shortfalls ${summary.shortfalls}`);
console.log(`  field results: ${summary.counts.exact} exact, ${summary.counts.normalized} normalized, ${summary.counts.missing} missing, ${summary.counts.incorrect} incorrect`);
console.log(`  written to ${path.relative(root, outDir)}/OCR_ACCURACY_RESULTS.md`);

process.exit(summary.verdict === 'PASS' ? 0 : 1);

