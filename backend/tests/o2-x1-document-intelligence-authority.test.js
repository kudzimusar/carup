/**
 * O2-X1 — Document Intelligence observes; domain authorities decide (TRADE OS LINE).
 *
 * ADAPTED for the Trade OS programme line by the O2 OCR convergence.
 *
 * The O2 branch's X1 change RETIRED the whole /api/verification authority surface — it deleted the
 * documentIntelligenceRouter, TrustService (six-tier person trust), FraudService, and
 * DocumentIntelligenceService.approveDocumentVerification. That wholesale authority retirement is a
 * separate programme-authority decision that has NOT been made on the Trade OS line, and taking it
 * here would roll Trade OS trust/document authority backwards and break the frozen
 * issue164-phase3-trust-authority.test.js (which calls approveDocumentVerification and pins that its
 * write clears the canonical trust stamp — INV-TRUST-2).
 *
 * On the Trade OS line the owning authority is:
 *   · /api/verification is GATED (V16 convergence), not gone: authorizeSessionRole(['admin',
 *     'government']) with the x-user-id fallback disabled — a PROVEN session, never an asserted
 *     header, and closed-by-default at the mount.
 *   · approveDocumentVerification is PRESERVED as a governed admin/government REVIEWER decision, and
 *     is T12.1-hardened: it writes NO government registry rows (cvr_ownership_records /
 *     zimra_declarations were REMOVED, not disabled).
 *
 * What OCR convergence owns and this suite therefore pins is the invariant that DOES hold here and
 * is this task's mandate: Document Intelligence EXTRACTION observes and decides nothing. The
 * extraction method writes only the OCR evidence tables, yields CANDIDATE data, fails honestly, and
 * no runtime module forges a government registry row. The reviewer DECISION is a separate, gated
 * method — extraction is never it.
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

/** The extraction method body, isolated from the reviewer-decision method in the same class. */
function extractionBody() {
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  const fn = service.slice(service.indexOf('static async extractDocumentData'));
  return fn.slice(0, fn.indexOf('\n  static '));
}

// ---------------------------------------------------------------------------------------
// 1. The /api/verification surface is GATED (Trade OS line), and closed-by-default.
// ---------------------------------------------------------------------------------------

test('X1 (Trade OS): /api/verification is gated at the mount with the header fallback disabled', () => {
  const server = read('../server.js');
  // Trade OS preserves the surface behind authorizeSessionRole, which disables the x-user-id
  // fallback: a registry/trust decision always requires a PROVEN session, never an asserted header.
  assert.match(
    server,
    /app\.use\('\/api\/verification',\s*authorizeSessionRole\(\['admin',\s*'government'\]\),\s*documentIntelligenceRouter\)/,
    'the /api/verification mount must stay gated by a proven admin/government session',
  );
  // A bare (ungated) mount must never exist.
  assert.doesNotMatch(server, /app\.use\('\/api\/verification',\s*documentIntelligenceRouter\)/,
    'no bare /api/verification mount may exist');
});

// ---------------------------------------------------------------------------------------
// 2. Extraction is not an authority writer; the reviewer decision path is a SEPARATE method.
// ---------------------------------------------------------------------------------------

test('X1: the EXTRACTION method writes no authority, and the reviewer decision is a distinct path', () => {
  const body = extractionBody();
  for (const forbidden of [
    /cvr_ownership_records/, //  registry truth
    /zimra_declarations/, //     customs truth
    /administrative_overrides/, // reviewer override audit sink
    /trust_score/, //            canonical Trust
    /from\(['"]vehicles['"]\)/, // no vehicle writes from extraction
    /trust_score_history/,
    /kyc_profiles/,
    /status:\s*'Verified'/, /status:\s*'Available'/,
  ]) {
    assert.doesNotMatch(body, forbidden, `the extraction method must not touch ${forbidden}`);
  }

  // Narrowed, not gutted: the candidate-extraction engine and its evidence tables remain.
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  assert.match(service, /extractDocumentData/);
  assert.match(service, /ocr_documents/);
  assert.match(service, /analyzeImageQuality/);
  // The sample-document fallback stays strictly test-gated.
  assert.match(service, /NODE_ENV === 'test' && process\.env\.ALLOW_OCR_MOCK === 'true'/);

  // Extraction and the reviewer decision are DISTINCT methods. Extraction decides nothing; the
  // gated reviewer decision (approveDocumentVerification) is preserved on the Trade OS line.
  assert.equal(typeof DocumentIntelligenceService.extractDocumentData, 'function');
  assert.equal(typeof DocumentIntelligenceService.approveDocumentVerification, 'function',
    'the governed reviewer decision path is preserved and is separate from extraction');

  // The legitimate internal consumer is intact (behaviour covered by diaspora-ocr-route.test.js).
  assert.match(read('../routes/diasporaRoutes.js'), /DocumentIntelligenceService\.extractDocumentData/);
});

// ---------------------------------------------------------------------------------------
// 3 + 4. Extraction behaviour: candidates only, honest failure, confined writes.
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
// 5. No shortcut writer forges the government registry tables (T12.1).
// ---------------------------------------------------------------------------------------

test('X1: no runtime module writes the government registry tables an OCR approval used to forge (T12.1)', () => {
  const registryWrite = /from\(['"](?:cvr_ownership_records|zimra_declarations)['"]\)\s*\.\s*(?:insert|update|upsert|delete)/;
  assert.deepEqual(runtimeHits(registryWrite), [],
    'cvr_ownership_records / zimra_declarations must have no in-product writer; reads (fact resolver) remain');
});
