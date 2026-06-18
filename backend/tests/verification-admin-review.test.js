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

const FUTURE = '2999-01-01T00:00:00.000Z';

let db;
function resetDb() {
  db = {
    _seq: 0,
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'owner-2', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      { token: 'admin-token', user_id: 'admin-1', is_valid: true, expires_at: FUTURE },
      { token: 'owner-token', user_id: 'owner-2', is_valid: true, expires_at: FUTURE },
    ],
    verification_sessions: [
      {
        id: 'vs-pending',
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
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const LIST_PATH = '/api/admin/identity/verification-sessions';

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
  const res = await req('GET', `${LIST_PATH}/vs-pending`, { token: 'admin-token' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.session.id, 'vs-pending');
  assert.equal(body.session.document_type, 'national_id');
  assert.equal(body.session.confidence_score, 0.42);
  assert.deepEqual(body.session.uploaded_sides, { front: true, back: true, selfie: true });
});

test('admin detail of a missing session returns 404', async () => {
  const res = await req('GET', `${LIST_PATH}/does-not-exist`, { token: 'admin-token' });
  assert.equal(res.status, 404);
});

test('F: admin detail surfaces account-vs-document identity binding (mismatch)', async () => {
  // owner-2 account name differs from the document holder ("Tata Moyo").
  db.users.find((u) => u.id === 'owner-2').name = 'Brian Ncube';
  const res = await req('GET', `${LIST_PATH}/vs-pending`, { token: 'admin-token' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.session.identity_binding, 'identity_binding present on detail');
  assert.equal(body.session.identity_binding.account_holder_name, 'Brian Ncube');
  assert.equal(body.session.identity_binding.document_holder_name, 'Tata Moyo');
  assert.equal(body.session.identity_binding.status, 'mismatch');
});

// --- No private storage path / URL leak ------------------------------------

test('private storage paths are never exposed in list or detail responses', async () => {
  const detail = await req('GET', `${LIST_PATH}/vs-pending`, { token: 'admin-token' });
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
  const res = await req('POST', `${LIST_PATH}/vs-pending/review`, {
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
  const res = await req('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'reject', reviewNotes: 'Document is illegible.' },
  });
  assert.equal(res.status, 200);
  const { session } = await res.json();
  assert.equal(session.status, 'rejected');
  assert.equal(session.review_decision, 'reject');
  assert.equal(session.review_notes, 'Document is illegible.');
  assert.equal(session.reviewed_by, 'admin-1');

  const row = db.verification_sessions.find((s) => s.id === 'vs-pending');
  assert.equal(row.failure_reason, 'Document is illegible.');
  assert.ok(db.trust_audit_events.some((e) => e.event_type === 'VERIFICATION_REVIEW_REJECTED'));
});

// --- Review: request_retry -------------------------------------------------

test('admin request_retry sets status retry_requested and retry_reason', async () => {
  const res = await req('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'request_retry', retryReason: 'Reupload a sharper back photo.' },
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
  const res = await req('POST', `${LIST_PATH}/vs-pending/review`, {
    token: 'admin-token',
    body: { action: 'request_retry' },
  });
  assert.equal(res.status, 400);
});

// --- Review: add_review_notes (status unchanged) ---------------------------

test('admin add_review_notes updates notes without changing status', async () => {
  const res = await req('POST', `${LIST_PATH}/vs-pending/review`, {
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
  const res = await req('POST', `${LIST_PATH}/vs-pending/review`, {
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
  const res = await req('GET', `${LIST_PATH}/vs-pending/evidence/front/preview`, { token: 'admin-token' });
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
  const res = await req('GET', `${LIST_PATH}/vs-verified/evidence/back/preview`, { token: 'admin-token' });
  assert.equal(res.status, 404);
});
