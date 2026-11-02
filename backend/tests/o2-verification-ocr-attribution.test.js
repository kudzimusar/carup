/**
 * O2 OCR convergence — OCR extraction attribution regression (P1), CONVERGED by OC-2A.
 *
 * HISTORY. This suite was written for the reviewer surface `POST /api/verification/ocr`
 * (documentIntelligenceRouter), which regressed during OCR convergence by calling
 * `extractDocumentData(docType, capturedFront)` with NO actor while the converged extraction
 * service requires the authenticated user id outside test mode. OC-2A (converging on O2-X1)
 * RETIRED that router entirely — the route now answers the app's 404 for every role, proven over
 * the real mount order by oc2a-verification-route-convergence.test.js.
 *
 * WHAT WAS DROPPED, AND WHY. Six cases drove the deleted router through a stub mount:
 *   · "the proven reviewer session id is passed into extractDocumentData"
 *   · "a body-authored actorId/userId is ignored — attribution comes only from the session"
 *   · "an x-user-id header does NOT become the extraction attribution for this surface"
 *   · "an unattributed runtime extraction is refused (401) — no fallback identity"
 *   · "the reviewer OCR route reports fraud as not_evaluated — no phantom subject" (FraudService,
 *     which only that route called, is deleted with it)
 *   · "SOURCE: the /api/verification mount stays gated by authorizeSessionRole …"
 * Each tested a property OF THE DELETED HANDLER; with the handler gone there is nothing for them
 * to execute, and the mount-gate assertion is now the opposite of the invariant (no prefix gate may
 * exist — it shadowed the Trust Fact and PartSentry routes).
 *
 * WHAT IS KEPT, BECAUSE IT STILL MEANS SOMETHING. The attribution law itself — an OCR evidence row
 * belongs to the AUTHENTICATED user it was run for, never a body/header/default identity — governs
 * every SURVIVING extraction path (identity verification sessions, diaspora trade document OCR,
 * vehicle evidence OCR, garage evidence OCR). So this suite now proves, against the shipped
 * service and the shipped consumers:
 *   1. the service refuses an unattributed extraction outside test mode (inner guard);
 *   2. the service attributes the evidence row to exactly the id it is handed (no substitution);
 *   3. every surviving consumer hands it a server-derived identity (req.userContext / the session
 *      row), never a request-body or header field.
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
const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8');

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { supabase } = await import('../db/supabase.js');
const { providerFromClient } = await import('../services/ai/ocrVisionProvider.js');

test('the runtime extraction service itself refuses an unattributed call outside test mode', async () => {
  const savedEnv = process.env.NODE_ENV;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_OCR_MOCK = 'false';
  try {
    await assert.rejects(
      () => DocumentIntelligenceService.extractDocumentData('national_id', 'data:image/png;base64,QUJD'),
      /requires the authenticated user id/,
    );
  } finally {
    process.env.NODE_ENV = savedEnv;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

test('the evidence row is attributed to exactly the authenticated id the caller hands in — no substitution', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', (table) => ({
    insert: (row) => { writes.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
    update: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  }));
  // An in-test provider double: no network, no credentials, no mock-mode shortcut.
  const visionProvider = providerFromClient(async () => ({
    document_class_observed: 'zimbabwe_national_id', confidence: 0.97, fields: { first_name: 'Tinashe' },
  }), { id: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' });

  const result = await DocumentIntelligenceService.extractDocumentData(
    'national_id', 'data:image/png;base64,QUJD', 'session-user-42', { visionProvider },
  );
  assert.ok(result.ocrDocumentId, 'the extraction ran and returned its evidence row id');
  const master = writes.find((w) => w.table === 'ocr_documents');
  assert.ok(master, 'the ocr evidence master row was written');
  assert.equal(master.row.user_id, 'session-user-42', 'the evidence row belongs to the authenticated caller');
  assert.ok(!writes.some((w) => w.row?.user_id && w.row.user_id !== 'session-user-42'),
    'no evidence row is attributed to any other identity (no u1/system_user default)');
});

test('every surviving extraction consumer passes a server-derived identity, never a body or header field', () => {
  // Identity verification: the session row's owner (the session was opened by the proven user).
  const identity = read('../services/identity/verificationSessionService.js');
  assert.match(identity, /ocr\.extractDocumentData\(session\.document_type, frontDataUri, session\.user_id\)/);

  // Diaspora trade document OCR: the proven reviewer context the route established.
  const diaspora = read('../routes/diasporaRoutes.js');
  assert.match(diaspora, /DocumentIntelligenceService\.extractDocumentData\(ocrDocType, base64Data, userContext\.id\)/);

  // Vehicle evidence OCR: the actor resolved from req.userContext by ocrConvergenceRoutes.
  const vehicle = read('../services/evidence/vehicleDocumentOcrService.js');
  assert.match(vehicle, /ocr\.extractDocumentData\(contract\.documentType, dataUri, actorId\(actor\)\)/);
  assert.match(read('../routes/ocrConvergenceRoutes.js'), /req\.userContext/);

  // Garage evidence OCR: the userId asserted from the actor's own onboarding context.
  const garage = read('../services/garageOnboarding/garageEvidenceService.js');
  assert.match(garage, /ocr\.extractDocumentData\('business_document', dataUri, userId,/);
  const runFn = garage.slice(garage.indexOf('export async function runEvidenceExtraction'));
  assert.match(runFn, /const \{ userId \} = await assertGarageOnboardingContext\(client, actor\);/);

  // None of them reads an identity off the request body or an x-user-id header for attribution.
  for (const [name, src] of [['identity', identity], ['diaspora', diaspora], ['vehicle', vehicle], ['garage', garage]]) {
    assert.doesNotMatch(src, /extractDocumentData\([^)]*req\.(body|headers)/, `${name}: attribution must not come from the request`);
  }
});

test('the retired reviewer OCR router is gone — attribution is no longer a property of a public route', () => {
  assert.equal(
    fs.existsSync(path.join(here, '../services/document-intelligence/documentIntelligenceRouter.js')), false,
    'the retired router file must not exist',
  );
  assert.doesNotMatch(read('../server.js'), /documentIntelligenceRouter/);
});
