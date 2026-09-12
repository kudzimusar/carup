/**
 * O2-X1 — Document Intelligence observes; domain authorities decide.
 *
 * The legacy document-intelligence subsystem was a second authority: its mounted
 * /api/verification router could approve an OCR document into REGISTRY truth (a
 * cvr_ownership_records / zimra_declarations row built partly from synthesized fallback
 * identifiers), flip the vehicle to 'Available', bump vehicles.trust_score, and promote a
 * person through a six-tier "trust level" that conflated identity, biometrics, vehicles and
 * dealer standing into one number — all outside the governed deciders (Phase 7C identity
 * review, Dealer Compliance, Seller Authority, the passport/evidence lanes, canonical Trust).
 *
 * X1 retires the authority surface and keeps the extraction engine. This suite is the
 * permanent guard on that boundary:
 *
 *   1. The /api/verification mount, its router file and its import are GONE — not gated,
 *      gone. A gate proves who may call; X1's claim is that there is nothing to call.
 *   2. The person-trust tier (TrustService) and the legacy device-heuristic fraud scanner
 *      (FraudService) are deleted, and no runtime module references their entry points, so
 *      the retired concepts cannot quietly return under the old names.
 *   3. The service itself has no authority writer left: no registry-table writes, no
 *      vehicle writes, no override/audit writes, no trust mutation of any kind. Extraction
 *      is still present — the module is narrowed, not gutted.
 *   4. Extraction still works for its legitimate internal consumers and still yields
 *      CANDIDATE data: writes confined to the ocr evidence tables, caller attribution kept,
 *      and the sample-document fallback reachable only under the explicit test-mode flag.
 *   5. An extraction failure outside test mode stays an HONEST failure — no identity
 *      fields, no fabricated success.
 *   6. No replacement shortcut writer appeared: nothing in runtime code inserts registry
 *      rows (cvr/zimra) any more; those tables are written only by their owning
 *      external-registry ingestion (none in-product today) and read by the fact resolver.
 *
 * Approach: mount-level and module-shape guarantees are pinned on SOURCE (the same
 * technique non-seller-authority-hardening.test.js and issue-158 use), behavioral
 * guarantees run the SHIPPED extractDocumentData against a captured fake client.
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
// 1. The mounted authority surface is gone — router file, server import, mount.
// ---------------------------------------------------------------------------------------

test('X1: the legacy /api/verification router is retired — file, import and mount all gone', () => {
  assert.equal(
    fs.existsSync(at('../services/document-intelligence/documentIntelligenceRouter.js')), false,
    'documentIntelligenceRouter.js must be deleted, not merely unmounted',
  );

  const server = read('../server.js');
  assert.doesNotMatch(server, /documentIntelligenceRouter/, 'server.js must not import the retired router');
  assert.doesNotMatch(
    server, /app\.use\(\s*['"]\/api\/verification['"]/,
    'no /api/verification mount of any kind may exist — gated or bare',
  );
});

// ---------------------------------------------------------------------------------------
// 2. The retired concepts cannot return under their old names.
// ---------------------------------------------------------------------------------------

test('X1: the person-trust tier and legacy fraud heuristics are deleted with zero runtime references', () => {
  assert.equal(fs.existsSync(at('../services/trust-service/trustService.js')), false,
    'trustService.js (six-tier person trust) must be deleted');
  assert.equal(fs.existsSync(at('../services/fraud-service/fraudService.js')), false,
    'fraudService.js (legacy device-heuristic scanner) must be deleted');

  // The retirement must not have taken the legitimate neighbour with it.
  assert.equal(fs.existsSync(at('../services/trust-service/trustEnforcementEngine.js')), true,
    'trustEnforcementEngine.js has other consumers and stays');

  for (const token of [/assignTrustLevel/, /calculateUserTrustScore/, /promote-trust/, /scanFraudRisk/]) {
    assert.deepEqual(runtimeHits(token), [], `no runtime module may reference ${token}`);
  }
});

// ---------------------------------------------------------------------------------------
// 3. Document Intelligence keeps extraction and loses every authority writer.
// ---------------------------------------------------------------------------------------

test('X1: the service has no authority writer left — and extraction was not gutted', () => {
  assert.equal(typeof DocumentIntelligenceService.approveDocumentVerification, 'undefined',
    'approveDocumentVerification must no longer exist');

  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  for (const forbidden of [
    /cvr_ownership_records/, // registry truth — owned by external-registry ingestion, read by the fact resolver
    /zimra_declarations/, //    customs truth — same ownership
    /administrative_overrides/, // override audit sink for REAL administrative actions only
    /trust_score/, //           canonical Trust — one writer (refreshCanonicalTrust)
    /from\(['"]vehicles['"]\)/, // no vehicle reads or writes of any kind remain
    /trust_score_history/,
    /kyc_profiles/,
  ]) {
    assert.doesNotMatch(service, forbidden, `service must not touch ${forbidden}`);
  }

  // Narrowed, not gutted: the candidate-extraction engine and its evidence tables remain.
  assert.match(service, /extractDocumentData/);
  assert.match(service, /ocr_documents/);
  assert.match(service, /analyzeImageQuality/);
  // The sample-document fallback stays strictly test-gated.
  assert.match(service, /NODE_ENV === 'test' && process\.env\.ALLOW_OCR_MOCK === 'true'/);

  // The legitimate internal consumer is intact (behaviour covered by diaspora-ocr-route.test.js).
  assert.match(read('../routes/diasporaRoutes.js'), /DocumentIntelligenceService\.extractDocumentData/);
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

  const savedKey = process.env.GEMINI_API_KEY;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  // No key + the explicit test flag: the PROVIDER CLIENT itself simulates (GeminiClient's own
  // NODE_ENV=test + ALLOW_OCR_MOCK gate), so this exercises the service's ordinary success path.
  delete process.env.GEMINI_API_KEY;
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
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

test('X1: outside the explicit test-mode flag an extraction failure stays HONEST — no identity fields, no fabricated success', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', captureWrites(writes));

  const savedKey = process.env.GEMINI_API_KEY;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  delete process.env.GEMINI_API_KEY;
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
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

// ---------------------------------------------------------------------------------------
// 6. No replacement shortcut writer.
// ---------------------------------------------------------------------------------------

test('X1: no runtime module writes the registry tables the retired approval used to forge', () => {
  const registryWrite = /from\(['"](?:cvr_ownership_records|zimra_declarations)['"]\)\s*\.\s*(?:insert|update|upsert|delete)/;
  assert.deepEqual(runtimeHits(registryWrite), [],
    'cvr_ownership_records / zimra_declarations must have no in-product writer; reads (fact resolver) remain');
});
