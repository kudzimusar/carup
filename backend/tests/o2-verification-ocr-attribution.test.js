/**
 * O2 OCR convergence — reviewer OCR attribution regression (P1).
 *
 * The preserved Trade OS reviewer surface `POST /api/verification/ocr`
 * (documentIntelligenceRouter) regressed during OCR convergence: it called
 * `extractDocumentData(docType, capturedFront)` with NO actor, while the converged
 * extraction service requires the authenticated user id outside test mode. The route
 * therefore failed at runtime with "OCR extraction requires the authenticated user id
 * it is being run for", even though the OCR unit suites were green.
 *
 * This suite proves, by executing the shipped route, that the extraction is attributed to
 * the PROVEN reviewer session (req.userContext.id) established by the mount's
 * authorizeSessionRole(['admin','government']) — never a body-authored id, header, or
 * fallback — and that an unattributed runtime extraction is refused.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8');

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { FraudService } = await import('../services/fraud-service/fraudService.js');

// Capture what the route hands the extraction service, then return a benign candidate result.
let captured;
const realExtract = DocumentIntelligenceService.extractDocumentData;
const realScan = FraudService.scanFraudRisk;

let server;
let baseUrl;
// The reviewer identity the "authenticated" mount would establish. Swapped per test.
let injectedUserContext;

before(async () => {
  DocumentIntelligenceService.extractDocumentData = async (docType, base64, userId, options) => {
    captured = { docType, base64, userId, options };
    return { success: true, extractedData: { first_name: 'A' }, ocrDocumentId: 'ocr_test', provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', executionStatus: 'provider_succeeded' };
  };
  FraudService.scanFraudRisk = async () => ({ riskRating: 'Low', isFraudulent: false });

  const express = (await import('express')).default;
  const router = (await import('../services/document-intelligence/documentIntelligenceRouter.js')).default;
  const app = express();
  app.use(express.json());
  // Simulate ONLY what the real authorizeSessionRole(['admin','government']) mount provides on
  // success: a proven req.userContext. When injectedUserContext is null, no context is set —
  // modelling an unattributed request that slipped past (defence-in-depth check at the handler).
  app.use('/api/verification', (req, _res, next) => { if (injectedUserContext) req.userContext = injectedUserContext; next(); }, router);

  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  DocumentIntelligenceService.extractDocumentData = realExtract;
  FraudService.scanFraudRisk = realScan;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function postOcr(body, headers = {}) {
  captured = undefined;
  const res = await fetch(`${baseUrl}/api/verification/ocr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

test('the proven reviewer session id is passed into extractDocumentData', async () => {
  injectedUserContext = { id: 'reviewer-admin-1', role: 'admin' };
  const { status } = await postOcr({ docType: 'national_id', capturedFront: 'data:image/png;base64,QUJD' });
  assert.equal(status, 200);
  assert.ok(captured, 'extractDocumentData was invoked');
  assert.equal(captured.userId, 'reviewer-admin-1', 'the authenticated reviewer id is the extraction attribution');
});

test('a body-authored actorId/userId is ignored — attribution comes only from the session', async () => {
  injectedUserContext = { id: 'reviewer-gov-9', role: 'government' };
  const { status } = await postOcr({
    docType: 'passport', capturedFront: 'data:image/png;base64,QUJD',
    actorId: 'attacker-999', userId: 'attacker-999', user_id: 'attacker-999',
  });
  assert.equal(status, 200);
  assert.equal(captured.userId, 'reviewer-gov-9', 'a body-authored id must never become the extraction attribution');
  assert.notEqual(captured.userId, 'attacker-999');
});

test('an x-user-id header does NOT become the extraction attribution for this surface', async () => {
  injectedUserContext = { id: 'reviewer-admin-2', role: 'admin' };
  const { status } = await postOcr(
    { docType: 'national_id', capturedFront: 'data:image/png;base64,QUJD' },
    { 'x-user-id': 'header-attacker' },
  );
  assert.equal(status, 200);
  assert.equal(captured.userId, 'reviewer-admin-2', 'the header id must not be used as attribution');
});

test('an unattributed runtime extraction is refused (401) — no fallback identity', async () => {
  injectedUserContext = null; // no proven session established
  const { status, body } = await postOcr({ docType: 'national_id', capturedFront: 'data:image/png;base64,QUJD' });
  assert.equal(status, 401, 'without a proven reviewer session the route must refuse');
  assert.equal(captured, undefined, 'extraction must not run without an attributed reviewer');
  assert.match(JSON.stringify(body), /reviewer session/i);
});

test('the runtime extraction service itself refuses an unattributed call outside test mode', async () => {
  // The route is the outer guard; the service is the inner one. Prove the service fails closed too.
  DocumentIntelligenceService.extractDocumentData = realExtract; // restore the real implementation
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
    process.env.ALLOW_OCR_MOCK = savedMock;
    DocumentIntelligenceService.extractDocumentData = async (docType, base64, userId, options) => {
      captured = { docType, base64, userId, options };
      return { success: true, extractedData: { first_name: 'A' }, ocrDocumentId: 'ocr_test', provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', executionStatus: 'provider_succeeded' };
    };
  }
});

test('SOURCE: the /api/verification mount stays gated by authorizeSessionRole (x-user-id fallback disabled), and the handler reads no fallback identity', () => {
  const server = read('../server.js');
  assert.match(
    server,
    /app\.use\('\/api\/verification',\s*authorizeSessionRole\(\['admin',\s*'government'\]\),\s*documentIntelligenceRouter\)/,
    'the mount must stay gated by a proven admin/government session (authorizeSessionRole disables the x-user-id fallback)',
  );
  const routerSrc = read('../services/document-intelligence/documentIntelligenceRouter.js');
  const ocrFn = routerSrc.slice(routerSrc.indexOf("router.post('/ocr'"), routerSrc.indexOf("router.post('/ocr/:id/approve'"));
  assert.match(ocrFn, /req\.userContext\?\.id/, 'the reviewer id must come from the session context');
  assert.match(ocrFn, /extractDocumentData\(\s*docType,\s*capturedFront,\s*reviewerId\s*\)/, 'the session id must be passed into extraction');
  assert.doesNotMatch(ocrFn, /req\.body\.(actorId|userId|user_id)/, 'the handler must not read a body-authored actor id');
  // Match an actual header READ, not the explanatory comment that names the disabled fallback.
  assert.doesNotMatch(ocrFn, /req\.headers\[['"]x-user-id['"]\]|req\.header\(['"]x-user-id['"]\)/i,
    'the handler must not read an x-user-id header as identity');
});
