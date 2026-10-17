/**
 * O2-X1 / OC-2A — Document Intelligence observes; domain authorities decide.
 *
 * CONVERGED onto the O2-X1 retirement by OC-2A. This line previously PRESERVED the legacy
 * /api/verification document-intelligence router behind authorizeSessionRole(['admin',
 * 'government']) and kept approveDocumentVerification as a reviewer decision. That was a second
 * authority over vehicle trust/registry/person verification level, and — because the gate was a
 * PREFIX mount — it also shadowed the Trust Fact and PartSentry review routes that share the
 * /api/verification prefix (see oc2a-verification-route-convergence.test.js, which proves the
 * mount order over real HTTP). OC-2A retires the authority surface and keeps the extraction engine.
 *
 * This suite is the permanent guard on that boundary:
 *
 *   1. The legacy router file, its import and its mount are GONE — not gated, gone — and nothing
 *      of any kind (gate, limiter, router) is mounted at the /api/verification PREFIX, because the
 *      Trust Fact and PartSentry routers own their route-level authorization there.
 *   2. The person-trust tier (TrustService) and the legacy device-heuristic fraud scanner
 *      (FraudService) are deleted, and no runtime module references their entry points.
 *   3. The service itself has no authority writer left: no registry-table writes, no vehicle
 *      reads/writes, no override/audit writes, no trust or KYC mutation of any kind. Extraction is
 *      still present — the module is narrowed, not gutted.
 *   4. Extraction still works for its legitimate internal consumers and still yields CANDIDATE
 *      data: writes confined to the ocr evidence tables, caller attributed, and the sample-document
 *      fallback reachable only under the explicit test-mode flag.
 *   5. An extraction failure outside test mode stays an HONEST failure.
 *   6. No replacement shortcut writer forges the government registry tables (T12.1).
 *
 * Intentional difference from the O2 branch: this line keeps its stronger OCR platform (the
 * real-bytes Cloudflare vision provider boundary, /api/ai/ocr answering 410 via
 * ocrConvergenceRoutes, OCR 1.0-C1 canonical-Trust convergence and C2 identity classifier), so the
 * behavioural extraction tests below drive the Cloudflare provider env rather than O2's Gemini one.
 *
 * Approach: mount-level and module-shape guarantees are pinned on SOURCE; behavioural guarantees
 * run the SHIPPED extractDocumentData against a captured fake client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (rel) => path.join(here, rel);
const read = (rel) => fs.readFileSync(at(rel), 'utf8');

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { supabase } = await import('../db/supabase.js');

/** Every runtime .js file under backend/services and backend/routes, plus server.js. */
function runtimeFiles() {
  const roots = [at('../services'), at('../routes')];
  const files = [at('../server.js')];
  while (roots.length) {
    const dir = roots.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // issue-158-terminal-operation-identity writes transient `__mutant__N.blockchainService.js`
      // copies next to the real module. They are test artefacts, not runtime code, and they can vanish
      // between this listing and the read below (OC-5G saw exactly that ENOENT in a full-suite run).
      if (entry.name.startsWith('__mutant__')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) roots.push(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  }
  return files;
}

function runtimeHits(pattern) {
  return runtimeFiles()
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(at('..'), file));
}

// ---------------------------------------------------------------------------------------
// 1. The mounted authority surface is gone — router file, server import, mount, prefix middleware.
// ---------------------------------------------------------------------------------------

test('X1/OC-2A: the legacy /api/verification router is retired — file, import and mount all gone', () => {
  assert.equal(
    fs.existsSync(at('../services/document-intelligence/documentIntelligenceRouter.js')), false,
    'documentIntelligenceRouter.js must be deleted, not merely unmounted',
  );

  const server = read('../server.js');
  assert.doesNotMatch(server, /documentIntelligenceRouter/, 'server.js must not import the retired router');
  // No PREFIX middleware of any kind — gate, limiter or router. A prefix mount runs before the
  // Trust Fact / PartSentry routers and shadows their route-level authorization (OC-2A defect).
  assert.doesNotMatch(
    server, /app\.use\(\s*\[?\s*['"`]\/api\/verification\b/,
    'no /api/verification prefix mount of any kind may exist — gated, bare, limiter or router',
  );
  // The routers that legitimately own the prefix are still mounted, path-less.
  assert.match(server, /app\.use\(trustFactRouter\);/);
  assert.match(server, /app\.use\(partsentryReviewRouter\);/);
});

// ---------------------------------------------------------------------------------------
// 2. The retired concepts cannot return under their old names.
// ---------------------------------------------------------------------------------------

test('X1/OC-2A: the person-trust tier and legacy fraud heuristics are deleted with zero runtime references', () => {
  assert.equal(fs.existsSync(at('../services/trust-service/trustService.js')), false,
    'trustService.js (six-tier person trust, a second kyc_profiles writer) must be deleted');
  assert.equal(fs.existsSync(at('../services/fraud-service/fraudService.js')), false,
    'fraudService.js (legacy device-heuristic scanner) must be deleted');

  // The retirement must not have taken the legitimate neighbour with it.
  assert.equal(fs.existsSync(at('../services/trust-service/trustEnforcementEngine.js')), true,
    'trustEnforcementEngine.js has other consumers and stays');

  for (const token of [/assignTrustLevel/, /calculateUserTrustScore/, /promote-trust/, /scanFraudRisk/, /approveDocumentVerification/]) {
    assert.deepEqual(runtimeHits(token), [], `no runtime module may reference ${token}`);
  }
});

// ---------------------------------------------------------------------------------------
// 3. Document Intelligence keeps extraction and loses every authority writer.
// ---------------------------------------------------------------------------------------

test('X1/OC-2A: the service has no authority writer left — and extraction was not gutted', () => {
  assert.equal(typeof DocumentIntelligenceService.approveDocumentVerification, 'undefined',
    'approveDocumentVerification must no longer exist');

  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  for (const forbidden of [
    /cvr_ownership_records/, // registry truth — owned by external-registry ingestion, read by the fact resolver
    /zimra_declarations/, //    customs truth — same ownership
    /administrative_overrides/, // override audit sink for REAL administrative actions only
    /trust_score/, //           canonical Trust — one writer (refreshCanonicalTrust)
    /trust_score_history/,
    /from\(['"]vehicles['"]\)/, // no vehicle reads or writes of any kind remain
    /kyc_profiles/,
    /refreshCanonicalTrust/, // no Trust handoff either — DI decides nothing that needs one
    /status:\s*'Verified'/, /status:\s*'Available'/,
  ]) {
    assert.doesNotMatch(service, forbidden, `service must not touch ${forbidden}`);
  }

  // Narrowed, not gutted: the candidate-extraction engine and its evidence tables remain.
  assert.equal(typeof DocumentIntelligenceService.extractDocumentData, 'function');
  assert.match(service, /ocr_documents/);
  assert.match(service, /analyzeImageQuality/);
  // The sample-document fallback stays strictly test-gated. OC-3B-R moved the rule into the one
  // test-fixture guard (which also refuses a declared deployment); the pin follows it there and pins
  // the delegation that keeps the fallback behind it.
  assert.match(service, /static isOcrMockAllowed\(\) \{\s*return isTestFixtureAllowed\(process\.env\);\s*\}/);
  assert.match(read('../config/testFixtureGuard.js'),
    /env\.NODE_ENV === 'test' && env\.ALLOW_OCR_MOCK === 'true' && !isDeployedRuntime\(env\)/);

  // The legitimate internal consumers are intact (behaviour covered by their own suites).
  assert.match(read('../routes/diasporaRoutes.js'), /DocumentIntelligenceService\.extractDocumentData/);
  assert.match(read('../services/identity/verificationSessionService.js'), /ocr\.extractDocumentData\(/);
  assert.match(read('../services/evidence/vehicleDocumentOcrService.js'), /ocr\.extractDocumentData\(/);
  assert.match(read('../services/garageOnboarding/garageEvidenceService.js'), /ocr\.extractDocumentData\(/);
});

// ---------------------------------------------------------------------------------------
// 4 + 5. Extraction behaviour: candidates only, honest failure, confined writes.
// ---------------------------------------------------------------------------------------

/** Fake supabase.from that records every write and answers like the thenable builder. */
function captureWrites(writes) {
  return (table) => ({
    insert: (row) => { writes.push({ table, op: 'insert', row }); return Promise.resolve({ data: null, error: null }); },
    update: (row) => { writes.push({ table, op: 'update', row }); return Promise.resolve({ data: null, error: null }); },
    upsert: (row) => { writes.push({ table, op: 'upsert', row }); return Promise.resolve({ data: null, error: null }); },
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  });
}

const OCR_EVIDENCE_TABLES = new Set([
  'ocr_documents', 'ocr_national_ids', 'ocr_registration_books', 'ocr_customs_declarations',
]);

test('X1: extraction produces CANDIDATE data — writes confined to ocr evidence tables, caller attributed', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', captureWrites(writes));

  const savedCfAcct = process.env.CLOUDFLARE_ACCOUNT_ID;
  const savedCfToken = process.env.CLOUDFLARE_API_TOKEN;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  // No provider credentials + the explicit test flag: the service simulates (its own NODE_ENV=test
  // + ALLOW_OCR_MOCK gate), so this exercises the ordinary success path with no network.
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  process.env.ALLOW_OCR_MOCK = 'true';
  try {
    const result = await DocumentIntelligenceService.extractDocumentData(
      'national_id', 'data:image/png;base64,QUJD', 'user-x1',
    );

    assert.equal(result.success, true);
    assert.ok(result.ocrDocumentId, 'the ocr evidence row id is returned to the caller');
    assert.ok(result.extractedData, 'candidate fields are returned for the consumer to treat as candidates');
    assert.ok(result.qualityMetrics, 'quality diagnostics travel with the candidates');

    assert.ok(writes.length > 0, 'the evidence write really happened');
    for (const write of writes) {
      assert.ok(OCR_EVIDENCE_TABLES.has(write.table),
        `extraction wrote to ${write.table} — only ocr evidence tables are permitted`);
    }
    const master = writes.find((w) => w.table === 'ocr_documents');
    assert.equal(master.row.user_id, 'user-x1', 'the extraction is attributed to the calling user');
  } finally {
    if (savedCfAcct === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = savedCfAcct;
    if (savedCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = savedCfToken;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

test('X1: outside the explicit test-mode flag an extraction failure stays HONEST — no identity fields, no fabricated success', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', captureWrites(writes));

  const savedCfAcct = process.env.CLOUDFLARE_ACCOUNT_ID;
  const savedCfToken = process.env.CLOUDFLARE_API_TOKEN;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  process.env.ALLOW_OCR_MOCK = 'false';
  try {
    const result = await DocumentIntelligenceService.extractDocumentData(
      'national_id', 'data:image/png;base64,QUJD', 'user-x1',
    );

    assert.equal(result.success, false);
    assert.equal(result.extractedData, undefined, 'a failed extraction must surface NO identity fields');
    assert.equal(result.ocrFailureReason, 'AI_OCR_EXTRACTION_FAILED');

    const master = writes.find((w) => w.table === 'ocr_documents');
    assert.equal(master.row.status, 'OCR_Provider_Unavailable', 'the failure is recorded by its real cause');
    for (const write of writes) {
      assert.ok(OCR_EVIDENCE_TABLES.has(write.table),
        `failed extraction wrote to ${write.table} — only ocr evidence tables are permitted`);
    }
  } finally {
    if (savedCfAcct === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = savedCfAcct;
    if (savedCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = savedCfToken;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

// ---------------------------------------------------------------------------------------
// 6. No shortcut writer forges the government registry tables (T12.1).
// ---------------------------------------------------------------------------------------

test('X1: no runtime module writes the government registry tables an OCR approval used to forge (T12.1)', () => {
  const registryWrite = /from\(['"](?:cvr_ownership_records|zimra_declarations)['"]\)\s*\.\s*(?:insert|update|upsert|delete)/;
  assert.deepEqual(runtimeHits(registryWrite), [],
    'cvr_ownership_records / zimra_declarations must have no in-product writer; reads (fact resolver) remain');
});
