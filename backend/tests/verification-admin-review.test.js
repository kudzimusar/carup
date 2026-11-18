import { mockIdentityDecision } from './support/mockIdentityClaim.js';
/**
 * Phase 7C — backend admin / manual-review routes for identity verification.
 *
 * Drives the real Express router + real authorizeRole middleware + real
 * verificationSessionService, with only supabase.from mocked. This proves the
 * true auth (401), role (403), action transitions, audit writes, and the
 * no-private-storage-path-leak guarantee end to end.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const adminRouter = (await import('../routes/identityVerificationAdminRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const { hashPassword } = await import('../utils/passwordAuth.js');
const { reviewerDecisionOperation } = await import('../services/identity/reviewerStepUp.js');
const PASSWORD = 'synthetic-reviewer-password';
const PASSWORD_HASH = await hashPassword(PASSWORD);

const FUTURE = '2999-01-01T00:00:00.000Z';

let db;
function resetDb() {
  db = {
    _seq: 0,
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true, password_hash: PASSWORD_HASH },
      { id: 'admin-2', role: 'admin', is_verified: true, password_hash: PASSWORD_HASH },
      { id: 'owner-2', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      { id: 'auth-admin-1', token: 'admin-token', user_id: 'admin-1', is_valid: true, expires_at: FUTURE },
      { id: 'auth-admin-2', token: 'admin-2-token', user_id: 'admin-2', is_valid: true, expires_at: FUTURE },
      { id: 'auth-other', token: 'admin-alt-token', user_id: 'admin-1', is_valid: true, expires_at: FUTURE },
      { token: 'owner-token', user_id: 'owner-2', is_valid: true, expires_at: FUTURE },
    ],
    verification_sessions: [
      {
        id: 'vs-pending',
        version: 1,
        user_id: 'owner-2',
        document_type: 'national_id',
        double_sided: true,
        status: 'pending_manual_review',
        front_storage_path: 'owner-2/vs-pending/front-secret.jpg',
        back_storage_path: 'owner-2/vs-pending/back-secret.jpg',
        selfie_storage_path: 'owner-2/vs-pending/selfie-secret.jpg',
        front_mime_type: 'image/jpeg',
        ocr_document_id: 'ocr-9',
        ocr_result: { first_name: 'Tata', last_name: 'Moyo' },
        confidence_score: 0.42,
        failure_reason: 'OCR confidence 0.42 is below the 0.75 verification threshold.',
        review_notes: 'OCR completed but requires manual review.',
        reviewed_by: null,
        reviewed_at: null,
        review_decision: null,
        retry_reason: null,
        liveness_status: null,
        created_at: '2026-06-13T00:00:00.000Z',
        updated_at: '2026-06-13T00:00:00.000Z',
        submitted_at: '2026-06-13T00:00:00.000Z',
        ocr_started_at: '2026-06-13T00:00:00.000Z',
        ocr_completed_at: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'vs-verified',
        version: 1,
        user_id: 'owner-2',
        document_type: 'passport',
        double_sided: false,
        status: 'verified',
        front_storage_path: 'owner-2/vs-verified/front-secret.jpg',
        selfie_storage_path: 'owner-2/vs-verified/selfie-secret.jpg',
        ocr_result: { first_name: 'Ada', last_name: 'Banda', national_id_number: 'ZN1' },
        confidence_score: 0.95,
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      },
    ],
    trust_audit_events: [],
    organization_audit_logs: [],
    organization_users: [],
  };
}

class MockQuery {
  constructor(table) {
    this.table = table;
    this.operation = 'select';
    this.payload = null;
    this.filters = [];
    this.orderKey = null;
    this.orderAsc = true;
  }
  select() { return this; }
  upsert(payload) { this.operation = 'upsert'; this.payload = payload; return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  order(key, opts = {}) { this.orderKey = key; this.orderAsc = opts.ascending !== false; return this; }
  single() { return this.execute('single'); }
  maybeSingle() { return this.execute('maybeSingle'); }
  then(resolve, reject) { return this.execute('list').then(resolve, reject); }

  matches(row) { return this.filters.every((f) => row[f.key] === f.value); }
  rows() { return (db[this.table] ||= []); }

  async execute(mode) {
    if (this.operation === 'upsert') {
      const rows = this.rows();
      const index = rows.findIndex(row => row.reviewer_id === this.payload.reviewer_id);
      if (index !== -1) rows[index] = clone(this.payload);
      else rows.push(clone(this.payload));
      return { error: null };
    }
    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map((r) => ({ id: r.id || `row-${++db._seq}`, ...clone(r) }));
      this.rows().push(...inserted);
      return mode === 'single'
        ? { data: clone(inserted[0]), error: null }
        : { data: clone(inserted), error: null };
    }

    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) {
          Object.assign(row, clone(this.payload));
          updated.push(clone(row));
        }
      }
      if (mode === 'single') {
        return { data: updated[0] || null, error: updated.length ? null : { message: 'No rows updated' } };
      }
      if (mode === 'maybeSingle') return { data: updated[0] || null, error: null };
      return { data: updated, error: null };
    }

    let rows = this.rows().filter((r) => this.matches(r)).map(clone);
    if (this.orderKey) {
      rows.sort((a, b) => {
        const av = a[this.orderKey];
        const bv = b[this.orderKey];
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (this.orderAsc ? 1 : -1);
      });
    }
    if (mode === 'single') {
      return { data: rows[0] || null, error: rows.length ? null : { message: 'No rows found' } };
    }
    if (mode === 'maybeSingle') return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
}

let server;
let baseUrl;

before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', {
    configurable: true,
    writable: true,
    value: (table) => new MockQuery(table),
  });

  supabase.rpc = (name, payload) => {
    if (name === 'record_verification_decision_with_event_atomic') return mockIdentityDecision(db, payload);
    if (name !== 'consume_identity_review_step_up') throw new Error('Unexpected RPC');
    const proof = (db.identity_review_step_up || []).find(row => row.reviewer_id === payload.p_reviewer_id
      && row.auth_session_id === payload.p_auth_session_id
      && row.case_id === payload.p_case_id && row.operation === payload.p_operation
      && row.proof_digest === payload.p_proof_digest
      && row.consumed_at === null && Date.parse(row.expires_at) > Date.now());
    if (!proof) return { data: false };
    proof.consumed_at = new Date().toISOString();
    return { data: true };
  };

  // Mock Supabase Storage so evidence-preview signed URLs can be generated
  // without touching real storage. The mock returns a fresh signed URL string.
  supabase.storage = {
    from() {
      return {
        async createSignedUrl(storagePath, expiresInSeconds) {
          return { data: { signedUrl: `https://signed.test/${storagePath}?exp=${expiresInSeconds}` }, error: null };
        },
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  app.use((await import('../routes/identityVerificationRoutes.js')).default);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

function req(method, path, { token, body, userId, proof } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (userId) headers['x-user-id'] = userId;
  if (proof) headers['x-review-step-up'] = proof;
  headers['x-bypass-rate-limit'] = 'true';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const LIST_PATH = '/api/admin/identity/verification-sessions';

const issue = (caseId, operation, password = PASSWORD) => req('POST', `${LIST_PATH}/${caseId}/step-up`, {
  token: 'admin-token', body: { operation, password },
});

async function reviewedReq(method, path, { token, body } = {}) {
  const [, caseId, resource, side] = path.slice(LIST_PATH.length).split('/');
  const operation = resource === 'evidence' ? `preview:${side}`
    : resource === 'review' ? reviewerDecisionOperation(body) : 'case:detail';
  const issued = await issue(caseId, operation);
  if (!issued.ok) return issued;
  return req(method, path, { token, proof: (await issued.json()).proof,
    body: body ? { expectedRevision: 1, ...body } : undefined });
}

test('step-up refuses missing, expired, unrelated, replayed and revoked proof without a decision write', async () => {
  const path = `${LIST_PATH}/vs-pending/review`;
  const body = { action: 'add_internal_note', internalNote: 'Synthetic note', expectedRevision: 1 };
  const send = (token, proof, target = path, payload = body) => req('POST', target, { token, proof, body: payload });
  assert.equal((await send('admin-token')).status, 403);
  assert.equal((await issue('vs-pending', 'decision:add_internal_note', 'incorrect')).status, 403);
  const { proof } = await (await issue('vs-pending', 'decision:add_internal_note')).json();
  assert.equal(db.identity_review_step_up[0].proof_digest, createHash('sha256').update(proof).digest('hex'));
  assert.equal((await send('admin-alt-token', proof)).status, 403);
  assert.equal((await send('admin-2-token', proof)).status, 403);
  assert.equal((await send('admin-token', proof, `${LIST_PATH}/vs-verified/review`)).status, 403);
  assert.equal((await send('admin-token', proof, path, { ...body, action: 'reject' })).status, 403);
  db.identity_review_step_up[0].expires_at = '2000-01-01';
  assert.equal((await send('admin-token', proof)).status, 403);
  const renewed = (await (await issue('vs-pending', 'decision:add_internal_note')).json()).proof;
  db.user_sessions[0].is_valid = false;
  assert.equal((await send('admin-token', renewed)).status, 401);
  assert.equal((db.verification_decisions || []).length, 0);
  assert.equal(db.trust_audit_events.length, 0);
  db.user_sessions[0].is_valid = true;
  assert.equal((await send('admin-token', renewed, path, { ...body, expectedRevision: 2 })).status, 409);
  assert.equal((db.verification_decisions || []).length, 0);
  assert.equal(db.trust_audit_events.length, 0);
  const current = (await (await issue('vs-pending', 'decision:add_internal_note')).json()).proof;
  assert.equal((await send('admin-token', current)).status, 200);
  assert.equal((await send('admin-token', current)).status, 403);
  assert.equal(db.verification_decisions.length, 1);
});

// --- Authentication --------------------------------------------------------

test('unauthenticated list/read/review are rejected with 401', async () => {
  const list = await req('GET', `${LIST_PATH}?status=pending_manual_review`);
  assert.equal(list.status, 401);

  const read = await req('GET', `${LIST_PATH}/vs-pending`);
  assert.equal(read.status, 401);

  const review = await req('POST', `${LIST_PATH}/vs-pending/review`, { body: { action: 'approve' } });
  assert.equal(review.status, 401);
});

// --- Authorization ---------------------------------------------------------

test('non-admin list/read/review are rejected with 403', async () => {
  const list = await req('GET', LIST_PATH, { token: 'owner-token' });
  assert.equal(list.status, 403);

  const read = await req('GET', `${LIST_PATH}/vs-pending`, { token: 'owner-token' });
  assert.equal(read.status, 403);

  const review = await req('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'owner-token',
    body: { action: 'approve' },
  });
  assert.equal(review.status, 403);
});

test('reviewer endpoints reject a header-only claimed admin', async () => {
  for (const [method, path, body] of [
    ['GET', LIST_PATH, undefined],
    ['GET', `${LIST_PATH}/vs-pending`, undefined],
    ['POST', `${LIST_PATH}/vs-pending/review`, { action: 'approve' }],
    ['GET', `${LIST_PATH}/vs-pending/evidence/front/preview`, undefined],
  ]) {
    const response = await req(method, path, { userId: 'admin-1', body });
    assert.equal(response.status, 401);
  }
});

test('applicant status requires a session and only returns the authenticated applicant case', async () => {
  const base = '/api/identity/verification-sessions';
  const asserted = await req('GET', base + '/latest', { userId: 'owner-2' });
  assert.equal(asserted.status, 401);
  const anotherUser = await req('GET', base + '/vs-pending', { token: 'admin-token' });
  assert.equal(anotherUser.status, 404);
  const applicant = await req('GET', base + '/vs-pending', { token: 'owner-token' });
  assert.equal(applicant.status, 200);
  assert.equal(applicant.headers.get('cache-control'), 'no-store');
  const { session } = await applicant.json();
  assert.equal(session.status, 'pending_manual_review');
  for (const key of ['review_notes', 'reviewed_by', 'user_email', 'front_storage_path']) {
    assert.equal(Object.hasOwn(session, key), false);
  }
});

test('admin cannot review their own verification case', async () => {
  db.verification_sessions[0].user_id = 'admin-1';
  const response = await req('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token', body: { action: 'reject', reasonCode: 'NON_DOCUMENT', expectedRevision: 1 },
  });
  assert.equal(response.status, 403);
  assert.equal((db.verification_decisions || []).length, 0);
});

// --- Admin list ------------------------------------------------------------

test('admin can list sessions filtered by pending_manual_review', async () => {
  const res = await req('GET', `${LIST_PATH}?status=pending_manual_review`, { token: 'admin-token' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].id, 'vs-pending');
  assert.equal(body.sessions[0].status, 'pending_manual_review');
});

test('admin list rejects an unsupported status filter', async () => {
  const res = await req('GET', `${LIST_PATH}?status=draft`, { token: 'admin-token' });
  assert.equal(res.status, 400);
});

// --- Admin detail ----------------------------------------------------------

test('admin can read one verification session detail', async () => {
  const res = await reviewedReq('GET', `${LIST_PATH}/vs-pending`, { token: 'admin-token' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.session.id, 'vs-pending');
  assert.equal(body.session.document_type, 'national_id');
  assert.equal(body.session.confidence_score, 0.42);
  assert.deepEqual(body.session.uploaded_sides, { front: true, back: true, selfie: true });
});

test('proof issuance reveals neither a missing private case nor another account', async () => {
  const res = await reviewedReq('GET', `${LIST_PATH}/does-not-exist`, { token: 'admin-token' });
  assert.equal(res.status, 403);
});

test('F: admin detail surfaces account-vs-document identity binding (mismatch)', async () => {
  // owner-2 account name differs from the document holder ("Tata Moyo").
  db.users.find((u) => u.id === 'owner-2').name = 'Brian Ncube';
  const res = await reviewedReq('GET', `${LIST_PATH}/vs-pending`, { token: 'admin-token' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.session.identity_binding, 'identity_binding present on detail');
  assert.equal(body.session.identity_binding.account_holder_name, 'Brian Ncube');
  assert.equal(body.session.identity_binding.document_holder_name, 'Tata Moyo');
  assert.equal(body.session.identity_binding.status, 'mismatch');
});

// --- No private storage path / URL leak ------------------------------------

test('private storage paths are never exposed in list or detail responses', async () => {
  const detail = await reviewedReq('GET', `${LIST_PATH}/vs-pending`, { token: 'admin-token' });
  const detailText = JSON.stringify(await detail.json());
  assert.equal(detailText.includes('front-secret.jpg'), false);
  assert.equal(detailText.includes('storage_path'), false);

  const list = await req('GET', LIST_PATH, { token: 'admin-token' });
  const listText = JSON.stringify(await list.json());
  assert.equal(listText.includes('-secret.jpg'), false);
  assert.equal(listText.includes('storage_path'), false);
});

// --- Review: approve -------------------------------------------------------

test('admin approve sets status verified and audit fields, writes audit event', async () => {
  const res = await reviewedReq('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'approve', reviewNotes: 'ID matches selfie.' },
  });
  assert.equal(res.status, 200);
  const { session } = await res.json();
  assert.equal(session.status, 'verified');
  assert.equal(session.review_decision, 'approve');
  assert.equal(session.reviewed_by, 'admin-1');
  assert.ok(session.reviewed_at);
  assert.equal(session.failure_reason, null);

  const row = db.verification_sessions.find((s) => s.id === 'vs-pending');
  assert.equal(row.status, 'verified');
  assert.equal(row.reviewed_by, 'admin-1');
  assert.ok(db.trust_audit_events.some((e) => e.event_type === 'VERIFICATION_REVIEW_APPROVED'));
});

// --- Review: reject --------------------------------------------------------

test('admin reject sets status rejected with notes and audit fields', async () => {
  const res = await reviewedReq('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: {
      action: 'reject',
      reasonCode: 'NON_DOCUMENT',
      reviewNotes: 'Document is illegible.',
      applicantMessage: 'Document does not meet requirements.',
    },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const { session } = body;
  assert.equal(session.status, 'rejected');
  assert.equal(session.review_decision, 'reject');
  assert.equal(session.review_notes, 'Document is illegible.');
  assert.equal(session.reviewed_by, 'admin-1');

  const row = db.verification_sessions.find((s) => s.id === 'vs-pending');
  assert.equal(row.failure_reason, 'Document does not meet requirements.');
  assert.ok(db.trust_audit_events.some((e) => e.event_type === 'VERIFICATION_REVIEW_REJECTED'));
  assert.equal(body.decision.reason_code, 'NON_DOCUMENT');
  assert.ok(body.allowed_actions.length > 0);
});

// --- Review: request_retry -------------------------------------------------

test('admin request_retry sets status retry_requested and retry_reason', async () => {
  const res = await reviewedReq('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'request_retry', reasonCode: 'DOCUMENT_NOT_VISIBLE', retryReason: 'Reupload a sharper back photo.' },
  });
  assert.equal(res.status, 200);
  const { session } = await res.json();
  assert.equal(session.status, 'retry_requested');
  assert.equal(session.review_decision, 'request_retry');
  assert.equal(session.retry_reason, 'Reupload a sharper back photo.');
  assert.equal(session.reviewed_by, 'admin-1');
  assert.ok(db.trust_audit_events.some((e) => e.event_type === 'VERIFICATION_REVIEW_RETRY_REQUESTED'));
});

test('admin request_retry without a reason is a 400', async () => {
  const res = await reviewedReq('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'request_retry' },
  });
  assert.equal(res.status, 400);
});

// --- Review: add_review_notes (status unchanged) ---------------------------

test('admin add_review_notes updates notes without changing status', async () => {
  const res = await reviewedReq('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'add_review_notes', reviewNotes: 'Escalated to senior reviewer.' },
  });
  assert.equal(res.status, 200);
  const { session } = await res.json();
  assert.equal(session.status, 'pending_manual_review');
  assert.equal(session.review_notes, 'Escalated to senior reviewer.');
  assert.equal(session.reviewed_by, 'admin-1');
  assert.ok(db.trust_audit_events.some((e) => e.event_type === 'VERIFICATION_REVIEW_NOTE_ADDED'));
});

// --- Review: invalid action ------------------------------------------------

test('unsupported review action is a 400', async () => {
  const res = await reviewedReq('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'delete_everything' },
  });
  assert.equal(res.status, 400);
});

// --- Workstream G: secure evidence previews --------------------------------

test('unauthenticated evidence preview is rejected with 401', async () => {
  const res = await req('GET', `${LIST_PATH}/vs-pending/evidence/front/preview`);
  assert.equal(res.status, 401);
});

test('non-admin evidence preview is rejected with 403', async () => {
  const res = await req('GET', `${LIST_PATH}/vs-pending/evidence/front/preview`, { token: 'owner-token' });
  assert.equal(res.status, 403);
});

test('admin gets a short-lived signed preview URL with no-store and no raw path leak', async () => {
  const res = await reviewedReq('GET', `${LIST_PATH}/vs-pending/evidence/front/preview`, { token: 'admin-token' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.preview.side, 'front');
  assert.equal(body.preview.expiresInSeconds, 180);
  assert.match(body.preview.url, /^https:\/\/signed\.test\//);
  // Only a signed URL is returned — never a raw *_storage_path field.
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('storage_path'), false);
  assert.equal(body.preview.front_storage_path, undefined);
  // An audit event is written for the preview.
  assert.ok(db.trust_audit_events.some((e) => e.event_type === 'VERIFICATION_EVIDENCE_PREVIEWED'));
});

test('invalid evidence side is a 400', async () => {
  const res = await req('GET', `${LIST_PATH}/vs-pending/evidence/passport/preview`, { token: 'admin-token' });
  assert.equal(res.status, 400);
});

test('preview for a side with no uploaded image is a 404', async () => {
  // vs-verified has no back_storage_path in the seed.
  const res = await reviewedReq('GET', `${LIST_PATH}/vs-verified/evidence/back/preview`, { token: 'admin-token' });
  assert.equal(res.status, 404);
});
