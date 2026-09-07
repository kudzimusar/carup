/**
 * Runs the CONVERGED GMO identity classifier against the real Cloudflare/Qwen model.
 *
 * This is the code path a Golden Journey uses — `DocumentClassifier.classifyDocument`, through
 * `resolveVisionProvider()` — not a re-implementation of it. It answers the questions a deployed
 * run cannot answer while the staging preview lacks a Workers AI token:
 *
 *   does the converged path reach the SELECTED provider and model?
 *   do the specimen's actual pixels arrive (prompt tokens rise, transport form is contentPart)?
 *   does the model classify a clearly-marked SPECIMEN identity card as a document?
 *   and does a NON-document get refused, so a pass means something?
 *
 * It classifies at most three images. It is manual-dispatch only for that reason.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = process.env.PROBE_IMAGES;
if (!DIR) throw new Error('PROBE_IMAGES=<dir with evidence-front.png / evidence-back.png / evidence-signage.png> is required');

const { DocumentClassifier } = await import('../../backend/services/identity/documentClassifier.js');
const { resolveVisionProvider } = await import('../../backend/services/ai/ocrVisionProvider.js');

const provider = resolveVisionProvider();
console.log(`configured provider : ${provider.id}`);
console.log(`selected model      : ${provider.model}`);
console.log(`configured          : ${provider.isConfigured()}`);
if (!provider.isConfigured()) {
  throw new Error(`provider not configured — requires ${provider.requiredEnv.join(', ')}`);
}
if (process.env.ALLOW_OCR_MOCK === 'true' && process.env.NODE_ENV === 'test') {
  throw new Error('refusing to run: this environment permits mock OCR');
}

const img = (name) => readFileSync(path.join(DIR, name));
const results = [];

async function classify(label, front, back) {
  const started = Date.now();
  const r = await DocumentClassifier.classifyDocument(front, back, null, 'national_id');
  const ms = Date.now() - started;
  results.push({ label, ...r, ms });
  console.log(`\n── ${label} ──`);
  console.log(`  classification : ${r.classification} (confidence ${r.classificationConfidence})`);
  console.log(`  provider/model : ${r.provider} / ${r.model}`);
  console.log(`  reason         : ${String(r.reason).slice(0, 160)}`);
  for (const side of r.execution?.sides || []) {
    const u = side.usage || {};
    console.log(`  ${side.side.padEnd(6)} → ${side.classification ?? '-'} · transport=${u.transportForm} promptTokens=${u.promptTokens} imageBytesSent=${u.imageBytesSent} finish=${u.finishReason}`);
  }
  console.log(`  elapsed        : ${ms}ms`);
  return r;
}

// 1. The specimen identity card — front and back.
const specimen = await classify('SPECIMEN identity card (front + back)', img('evidence-front.png'), img('evidence-back.png'));

// 2. A NON-document, so a pass on (1) means something. The workshop sign is a real photograph of
//    a sign: it is emphatically not an identity document, and the model must say so.
const nonDoc = await classify('workshop signage (must NOT be an identity document)', img('evidence-signage.png'), null);

const POSITIVE = ['valid_identity_document', 'likely_identity_document'];
const checks = [
  ['provider is the selected one', specimen.provider === 'cloudflare'],
  ['model is the qualified Qwen model', specimen.model === '@cf/qwen/qwen3.8-27b'],
  ['the specimen classifies as an identity document', POSITIVE.includes(specimen.classification)],
  ['both sides were classified, neither dropped', (specimen.execution?.sides || []).length === 2],
  ['the image reached the model (contentPart transport)',
    (specimen.execution?.sides || []).every((s) => s.usage?.transportForm === 'contentPart')],
  ['real image bytes were sent',
    (specimen.execution?.sides || []).every((s) => (s.usage?.imageBytesSent || 0) > 10_000)],
  ['a non-document is NOT an identity document', !POSITIVE.includes(nonDoc.classification)],
];

console.log(`\n${'─'.repeat(70)}`);
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) failed += 1; }
console.log(`\nQWEN CLASSIFICATION PROBE: ${checks.length - failed} PASS · ${failed} FAIL`);
console.log(JSON.stringify({ results }, null, 2));
process.exit(failed ? 1 : 0);
