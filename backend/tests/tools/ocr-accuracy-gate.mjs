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
import { gradeFixture, summarize } from './ocrAccuracyGrading.mjs';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDir, '../../..');
const corpusDir = path.join(root, 'docs/features/o2/uat-assets/ocr-corpus');
const manifest = JSON.parse(readFileSync(path.join(toolDir, 'ocr-corpus-manifest.json'), 'utf8'));

const outIndex = process.argv.indexOf('--out');
const outDir = outIndex > -1 ? path.resolve(process.argv[outIndex + 1]) : path.join(root, 'docs/features/o2/uat-assets');

if (!process.env.GEMINI_API_KEY) {
  console.log('OCR_ACCURACY_GATE: NOT_RUN');
  console.log('  No vision provider is configured for this environment.');
  console.log('  The gate measures a live provider against the synthetic corpus; it cannot be');
  console.log('  simulated, and a simulated run would measure the simulation, not the OCR.');
  process.exit(3);
}

// The service must never take the test-mode simulation path during a measurement run.
process.env.ALLOW_OCR_MOCK = 'false';
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

const graded = [];
const runs = [];

for (const fixture of manifest.fixtures) {
  const filePath = path.join(corpusDir, fixture.file);
  const bytes = readFileSync(filePath);
  const dataUri = `data:${mimeFor(fixture.file)};base64,${bytes.toString('base64')}`;

  let providerCalls = 0;
  const countingClient = async (...args) => {
    providerCalls += 1;
    const { askGeminiVision } = await import('../../services/ai/GeminiClient.js');
    return askGeminiVision(...args);
  };

  const startedAt = Date.now();
  const result = await DocumentIntelligenceService.extractDocumentData(
    fixture.docType, dataUri, 'ocr-accuracy-gate', { visionClient: countingClient },
  );
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
    verdict: grade.verdict,
  });

  const label = `${grade.verdict === 'PASS' ? '✓' : '✗'} ${fixture.id}`;
  console.log(`${label} — ${result.provider}/${result.model || 'n/a'} · ${result.extractionStatus} · ${wallMs}ms · confidence ${result.confidenceReported ? result.confidence : 'not reported'}`);
  for (const failure of grade.failures) {
    console.log(`    ${failure.kind.toUpperCase()}: ${failure.field} — expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.extracted)}`);
  }
}

const summary = summarize(graded);

const rows = graded.flatMap((fixture) => fixture.fields.map((row) => {
  const run = runs.find((r) => r.id === fixture.id);
  return `| ${fixture.id} | ${row.field} | ${JSON.stringify(row.expected)} | ${JSON.stringify(row.extracted)} | ${row.match} | ${run.provider}/${run.model || 'n/a'} | ${run.latencyMs}ms | ${run.confidenceReported ? run.confidence : '—'} |`;
}));

const report = [
  '# OCR accuracy gate — measured results',
  '',
  `- Run: ${new Date().toISOString()}`,
  `- Corpus: ${manifest.version} (${manifest.fixtures.length} fixtures)`,
  `- Verdict: **${summary.verdict}**`,
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
