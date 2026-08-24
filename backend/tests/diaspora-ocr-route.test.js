/**
 * Backend route/security tests for POST /api/diaspora/documents/:id/run-ocr
 *
 * These are RUNTIME tests: they mount the real diaspora router (with the real authorizeRole
 * middleware and the real route handler) behind the real error middleware, and drive it over
 * HTTP. Only the external boundaries are mocked — the Supabase client, Supabase Storage, the
 * OCR provider (DocumentIntelligenceService), and the document-download fetch(). No real
 * Supabase storage or network is required.
 *
 * Proven behaviours:
 *  - a normal buyer cannot call run-ocr, even on their own document        (403)
 *  - an unrelated authenticated user cannot call run-ocr                   (403)
 *  - a spoofed x-stakeholder-role cannot escalate to reviewer access       (403)
 *  - a trusted government_reviewer / admin can call run-ocr                (201)
 *  - a document with no storage_path returns a safe error                 (400)
 *  - an oversized file returns the 10MB safe error                        (400)
 *  - an OCR provider failure returns a safe error with no signed-URL /
 *    storage_path leakage                                                 (400)
 *  - a successful run records an extraction and sets OCR_EXTRACTED, never
 *    marking the document VERIFIED                                        (201)
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Supabase client construction requires these; set BEFORE any import that loads db/supabase.js.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// This harness authenticates via the `x-user-id` fallback (see the mocked session read below), and
// run-ocr now signs a private `ocr-documents` object behind `requireProvenIdentity()`. That gate
// deliberately does NOT infer permission from NODE_ENV — a staging deployment running NODE_ENV=test
// once turned the spoofable header into a working identity — so a harness that wants the fallback
// must OPT IN EXPLICITLY. Declaring it here is that opt-in, and it is exactly what the flag is for.
process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.ALLOW_OCR_MOCK = 'true';

import { DOCUMENT_STATUSES } from '../constants/diaspora/diasporaStatuses.js';

const SIGNED_URL_PREFIX = 'https://signed.example.test/';

// ---------------------------------------------------------------------------
// Mutable per-test mock state
// ---------------------------------------------------------------------------
let mockState;

function resetMockState() {
  mockState = {
    // userId -> { role, is_verified }
    users: {
      'buyer-1': { role: 'owner', is_verified: true },
      'unrelated-1': { role: 'member', is_verified: true },
      'gov-1': { role: 'government_reviewer', is_verified: true },
      'admin-1': { role: 'admin', is_verified: true },
    },
    // `${tenantId}|${userId}` -> { role }
    tenantUsers: {
      'tenant-1|admin-1': { role: 'admin' },
    },
    // documentId -> document record (UNREDACTED; includes storage_path)
    documents: {
      'doc-1': {
        id: 'doc-1',
        tenant_id: 'tenant-1',
        import_order_id: 'order-1',
        document_type: 'passport',
        storage_path: 'order-1/passport_abc123.pdf',
        verification_status: DOCUMENT_STATUSES.UPLOADED,
        uploaded_by: 'buyer-1',
        metadata: {},
      },
      'doc-2': {
        id: 'doc-2',
        tenant_id: 'tenant-1',
        import_order_id: 'order-1',
        document_type: 'passport',
        storage_path: null, // never uploaded
        verification_status: DOCUMENT_STATUSES.UPLOADED,
        uploaded_by: 'buyer-1',
        metadata: {},
      },
    },
    orders: {
      'order-1': { id: 'order-1', tenant_id: 'tenant-1', buyer_id: 'buyer-1', created_by: 'buyer-1', status: 'IMPORT_REQUESTED' },
    },
    // storage.createSignedUrl behaviour
    createSignedUrl: async () => ({ data: { signedUrl: `${SIGNED_URL_PREFIX}doc.pdf` }, error: null }),
    // fetch() of the signed URL
    signedFetch: async () => duckResponse({ contentType: 'application/pdf', contentLength: '12', body: 'PDFCONTENT!!' }),
    // DocumentIntelligenceService.extractDocumentData behaviour
    ocr: async () => ({
      success: true,
      ocrDocumentId: 'ocr-doc-1',
      qualityMetrics: { blurScore: 0.9 },
      extractedData: { confidenceScore: 0.92, first_name: 'Tendai', last_name: 'Moyo' },
    }),
    // every terminal supabase query is recorded here for assertions
    calls: [],
  };
}

/** A duck-typed fetch Response exposing only what the route consumes. */
function duckResponse({ ok = true, status = 200, contentType = 'application/pdf', contentLength = null, body = '' } = {}) {
  const headers = new Map();
  if (contentType !== null) headers.set('content-type', contentType);
  if (contentLength !== null) headers.set('content-length', String(contentLength));
  const buf = Buffer.from(body);
  return {
    ok: ok && status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers.has(String(k).toLowerCase()) ? headers.get(String(k).toLowerCase()) : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

// ---------------------------------------------------------------------------
// Supabase mock — a chainable, thenable query builder driven by mockState
// ---------------------------------------------------------------------------
function makeQueryBuilder(table) {
  const state = { table, op: 'select', payload: undefined, filters: {}, single: false };
  const chain = {
    select(_sel, _opts) { return chain; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
    update(payload) { state.op = 'update'; state.payload = payload; return chain; },
    delete() { state.op = 'delete'; return chain; },
    eq(k, v) { state.filters[k] = v; return chain; },
    neq() { return chain; },
    is() { return chain; },
    order() { return chain; },
    range() { return chain; },
    limit() { return chain; },
    single() { state.single = true; return chain; },
    maybeSingle() { state.single = true; return chain; },
    then(resolve, reject) {
      let result;
      try {
        result = resolveQuery(state);
      } catch (err) {
        return reject ? reject(err) : Promise.reject(err);
      }
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return chain;
}

function resolveQuery(state) {
  mockState.calls.push({ table: state.table, op: state.op, payload: state.payload, filters: { ...state.filters }, single: state.single });
  const { table, op, filters } = state;

  switch (table) {
    case 'user_sessions':
      return { data: null, error: { message: 'no session (test uses x-user-id fallback)' } };

    case 'users': {
      const row = mockState.users[filters.id];
      return row ? { data: row, error: null } : { data: null, error: { message: 'user not found' } };
    }

    case 'tenant_users': {
      const row = mockState.tenantUsers[`${filters.tenant_id}|${filters.user_id}`];
      return row ? { data: row, error: null } : { data: null, error: { message: 'tenant membership not found' } };
    }

    case 'diaspora_trade_documents': {
      if (op === 'update' || op === 'insert') return { data: { id: filters.id || 'doc-x', ...(state.payload || {}) }, error: null };
      const doc = mockState.documents[filters.id];
      return doc ? { data: doc, error: null } : { data: null, error: { message: 'document not found' } };
    }

    case 'diaspora_import_orders': {
      const order = mockState.orders[filters.id];
      return order ? { data: order, error: null } : { data: null, error: { message: 'order not found' } };
    }

    case 'diaspora_import_order_participants':
      return { data: [], error: null };

    case 'diaspora_trade_document_extractions':
      return { data: { id: 'ext-1', ...(state.payload || {}) }, error: null };

    case 'diaspora_import_audit_log':
      return state.single ? { data: { id: 'audit-1' }, error: null } : { data: [], error: null };

    default:
      if (state.single) return { data: {}, error: null };
      if (op === 'insert') return { data: { id: 'mock-id', ...(state.payload || {}) }, error: null };
      return { data: [], error: null };
  }
}

// ---------------------------------------------------------------------------
// Harness wiring
// ---------------------------------------------------------------------------
let server;
let baseUrl;
let realFetch;

before(async () => {
  resetMockState();

  // Install Supabase mock on the shared client object (live ESM binding shared by all consumers).
  const { supabase } = await import('../db/supabase.js');
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (table) => makeQueryBuilder(table) });
  Object.defineProperty(supabase, 'storage', {
    configurable: true,
    writable: true,
    value: { from: () => ({ createSignedUrl: (...args) => mockState.createSignedUrl(...args) }) },
  });

  // Mock the OCR provider (static method on the exported class object).
  const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
  DocumentIntelligenceService.extractDocumentData = (...args) => mockState.ocr(...args);

  // Intercept ONLY the signed-URL download; everything else (the test client) uses real fetch.
  realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (url.startsWith(SIGNED_URL_PREFIX)) return mockState.signedFetch(url, init);
    return realFetch(input, init);
  };

  // Build a minimal app that mounts the real router + real error handler.
  const express = (await import('express')).default;
  const diasporaRoutes = (await import('../routes/diasporaRoutes.js')).default;
  const errorHandler = (await import('../middleware/errorMiddleware.js')).default;

  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRoutes);
  app.use(errorHandler);

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (globalThis.fetch && realFetch) globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  resetMockState();
});

async function runOcr(docId, { userId, stakeholderRole, tenantId } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (stakeholderRole) headers['x-stakeholder-role'] = stakeholderRole;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  // Use the saved real fetch so this client call is never intercepted by the signed-URL mock.
  const res = await realFetch(`${baseUrl}/api/diaspora/documents/${docId}/run-ocr`, { method: 'POST', headers, body: '{}' });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, raw: text };
}

/** No error response should leak the signed URL or storage path. */
function assertNoStorageLeak(raw) {
  assert.ok(!raw.includes(SIGNED_URL_PREFIX), 'response must not contain the signed URL');
  assert.ok(!/signedUrl/i.test(raw), 'response must not contain "signedUrl"');
  assert.ok(!raw.includes('storage_path'), 'response must not contain "storage_path"');
  assert.ok(!raw.includes('order-1/passport_abc123.pdf'), 'response must not contain the raw storage path value');
}

// ===========================================================================
// Authorization / security
// ===========================================================================

test('rejects unauthenticated requests (no user context) with 401', async () => {
  const { status, raw } = await runOcr('doc-1', {});
  assert.equal(status, 401);
  assertNoStorageLeak(raw);
});

test('a normal buyer cannot call run-ocr, even on their own document (403)', async () => {
  // buyer-1 is the uploader of doc-1, yet run-ocr is reviewer-only.
  const { status, raw } = await runOcr('doc-1', { userId: 'buyer-1' });
  assert.equal(status, 403);
  // Handler must not have run: no extraction recorded.
  assert.equal(mockState.calls.some((c) => c.table === 'diaspora_trade_document_extractions'), false);
  assertNoStorageLeak(raw);
});

test('an unrelated authenticated user cannot call run-ocr (403)', async () => {
  const { status, raw } = await runOcr('doc-1', { userId: 'unrelated-1' });
  assert.equal(status, 403);
  assert.equal(mockState.calls.some((c) => c.table === 'diaspora_trade_document_extractions'), false);
  assertNoStorageLeak(raw);
});

test('a spoofed x-stakeholder-role cannot gain reviewer access (403)', async () => {
  // A buyer asserting government_reviewer via the header must be rejected by resolveEffectiveRole.
  const { status, raw } = await runOcr('doc-1', { userId: 'buyer-1', stakeholderRole: 'government_reviewer' });
  assert.equal(status, 403);
  assert.equal(mockState.calls.some((c) => c.table === 'diaspora_trade_document_extractions'), false);
  assertNoStorageLeak(raw);
});

test('a spoofed admin role via header cannot gain access (403)', async () => {
  const { status } = await runOcr('doc-1', { userId: 'buyer-1', stakeholderRole: 'admin' });
  assert.equal(status, 403);
});

// ===========================================================================
// Trusted reviewers (happy paths)
// ===========================================================================

test('a trusted government_reviewer can call run-ocr (201)', async () => {
  const { status, body } = await runOcr('doc-1', { userId: 'gov-1' });
  assert.equal(status, 201);
  assert.ok(body.extraction, 'response should include the extraction');
  assert.ok(body.ocr, 'response should include the ocr summary');
  assert.equal(body.ocr.success, true);
});

test('a trusted tenant admin can call run-ocr (201)', async () => {
  // admin-1 is an admin of tenant-1, which owns the document.
  const { status, body } = await runOcr('doc-1', { userId: 'admin-1', tenantId: 'tenant-1' });
  assert.equal(status, 201);
  assert.ok(body.extraction);
});

// ===========================================================================
// Successful OCR records extraction and never marks the document VERIFIED
// ===========================================================================

test('successful OCR records an extraction and sets OCR_EXTRACTED, never VERIFIED', async () => {
  const { status, body } = await runOcr('doc-1', { userId: 'gov-1' });
  assert.equal(status, 201);

  // An extraction row was inserted.
  const extractionInsert = mockState.calls.find(
    (c) => c.table === 'diaspora_trade_document_extractions' && c.op === 'insert'
  );
  assert.ok(extractionInsert, 'an extraction row must be inserted');
  assert.equal(extractionInsert.payload.verification_status, DOCUMENT_STATUSES.OCR_EXTRACTED);

  // The document was moved to OCR_EXTRACTED.
  const docUpdate = mockState.calls.find(
    (c) => c.table === 'diaspora_trade_documents' && c.op === 'update'
  );
  assert.ok(docUpdate, 'the document status must be updated');
  assert.equal(docUpdate.payload.verification_status, DOCUMENT_STATUSES.OCR_EXTRACTED);

  // It must NEVER be marked VERIFIED, and the verifications table must not be touched.
  const markedVerified = mockState.calls.some(
    (c) => c.payload && c.payload.verification_status === DOCUMENT_STATUSES.VERIFIED
  );
  assert.equal(markedVerified, false, 'run-ocr must not mark the document VERIFIED');
  assert.equal(
    mockState.calls.some((c) => c.table === 'diaspora_trade_document_verifications'),
    false,
    'run-ocr must not write to the verifications table'
  );

  // The response itself must not leak the document status as VERIFIED.
  assert.notEqual(body.extraction.verification_status, DOCUMENT_STATUSES.VERIFIED);
});

// ===========================================================================
// Safe error handling (no storage_path / signed-url leakage)
// ===========================================================================

test('a document with no storage_path returns a safe 400 error', async () => {
  const { status, body, raw } = await runOcr('doc-2', { userId: 'gov-1' });
  assert.equal(status, 400);
  assert.match(body.error.message, /no storage path/i);
  assert.equal(mockState.calls.some((c) => c.table === 'diaspora_trade_document_extractions'), false);
  assertNoStorageLeak(raw);
});

test('an oversized file (10MB limit) returns a safe 400 error', async () => {
  mockState.signedFetch = async () =>
    duckResponse({ contentType: 'application/pdf', contentLength: String(11 * 1024 * 1024), body: 'x' });
  const { status, body, raw } = await runOcr('doc-1', { userId: 'gov-1' });
  assert.equal(status, 400);
  assert.match(body.error.message, /maximum size limit of 10MB/i);
  assert.equal(mockState.calls.some((c) => c.table === 'diaspora_trade_document_extractions'), false);
  assertNoStorageLeak(raw);
});

test('OCR provider failure returns a safe 400 error with no signed-URL/storage_path leakage', async () => {
  mockState.ocr = async () => {
    throw new Error(`provider exploded; tried ${SIGNED_URL_PREFIX}doc.pdf with order-1/passport_abc123.pdf`);
  };
  const { status, body, raw } = await runOcr('doc-1', { userId: 'gov-1' });
  assert.equal(status, 400);
  assert.match(body.error.message, /OCR extraction failed/i);
  // No extraction should be recorded on failure.
  assert.equal(mockState.calls.some((c) => c.table === 'diaspora_trade_document_extractions'), false);
  // Critically: the underlying signed URL / storage path must not be echoed back.
  assertNoStorageLeak(raw);
});

test('signed-URL generation failure returns a safe 400 error with no leakage', async () => {
  mockState.createSignedUrl = async () => ({ data: null, error: { message: 'denied' } });
  const { status, body, raw } = await runOcr('doc-1', { userId: 'gov-1' });
  assert.equal(status, 400);
  assert.match(body.error.message, /Failed to generate document access URL/i);
  assertNoStorageLeak(raw);
});

test('storage fetch failure returns a safe 400 error with no leakage', async () => {
  mockState.signedFetch = async () => { throw new Error('connection reset'); };
  const { status, body, raw } = await runOcr('doc-1', { userId: 'gov-1' });
  assert.equal(status, 400);
  assert.match(body.error.message, /Failed to fetch document from storage/i);
  assertNoStorageLeak(raw);
});
