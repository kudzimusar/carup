/**
 * O2-X5 — Dealer onboarding: access, isolation, evidence privacy, candidate truth (runtime).
 *
 * Real routers + real middleware + real services over a mocked Supabase client and injected
 * storage/OCR boundaries. Held here:
 *
 *   · an `owner`-role BUSINESS+DEALER applicant enters their own onboarding; an individual
 *     owner (or a business non-dealer) is refused by name — and business context grants
 *     neither Dealer Compliance outcomes nor Dealer workspace access;
 *   · forged tenant_id input is ignored end-to-end (service field allowlist);
 *   · strict self-scope: another applicant's profile, documents and previews are unreachable;
 *   · evidence is PRIVATE: no response ever carries the storage path; previews are
 *     short-lived signed URLs; the reviewer's raw-evidence preview sits behind X3 step-up;
 *   · company OCR runs as the REAL caller, yields CANDIDATES only (markers → missing),
 *     touches neither document status nor any compliance dimension, and profile truth
 *     changes only through the user's explicit confirm/correct submit;
 *   · only recordDecision moves requirements/lifecycle (source + behavioral pins).
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.ALLOW_OCR_MOCK = 'true';

const express = (await import('express')).default;
const { supabase } = await import('../db/supabase.js');
const onboardingRouter = (await import('../routes/dealerOnboardingRoutes.js')).default;
const dealerRouter = (await import('../routes/dealerRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const svc = await import('../services/dealer/dealerOnboardingService.js');

const FUTURE = '2027-01-01T00:00:00.000Z';

let db;
function resetDb() {
  db = {
    users: [
      { id: 'dealer-app-1', role: 'owner', is_verified: true },
      { id: 'dealer-app-2', role: 'owner', is_verified: true },
      { id: 'individual-1', role: 'owner', is_verified: true },
      { id: 'admin-1', role: 'admin', is_verified: true },
    ],
    user_registration_profiles: [
      { user_id: 'dealer-app-1', account_kind: 'business', business_type: 'dealer', organization_name: 'Moyo Motors', onboarding_status: 'requested' },
      { user_id: 'dealer-app-2', account_kind: 'business', business_type: 'dealer', organization_name: 'Ncube Autos', onboarding_status: 'requested' },
      { user_id: 'individual-1', account_kind: 'individual', business_type: null, organization_name: null, onboarding_status: 'not_required' },
    ],
    user_sessions: [
      { id: 's-admin', token: 'admin-token', user_id: 'admin-1', is_valid: true, expires_at: FUTURE, created_at: FUTURE, auth_method: 'password', step_up_at: null, step_up_method: null },
    ],
    dealer_profiles: [],
    dealer_branches: [],
    dealer_compliance_documents: [],
    dealer_compliance_requirements: [],
    dealer_compliance_decisions: [],
    verification_sessions: [],
    identity_lifecycle_events: [],
    trust_audit_events: [],
    storage: {}, // path -> {buffer, mimeType}
  };
}

const APPEND_ONLY = new Set(['dealer_compliance_decisions']);
let seq = 0;
function builder(table) {
  const st = { op: 'select', filters: {}, payload: null, single: false, maybe: false };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    order() { return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  function run() {
    const rows = (db[table] = db[table] || []);
    const match = (r) => Object.entries(st.filters).every(([k, v]) => r[k] === v);
    if (st.op === 'insert') {
      const row = { id: st.payload.id || `${table}-${++seq}`, seq: ++seq, created_at: st.payload.created_at || new Date().toISOString(), ...st.payload };
      rows.push(row);
      return { data: st.single ? row : [row], error: null };
    }
    if (st.op === 'update') {
      if (APPEND_ONLY.has(table)) return { data: null, error: { message: `Append-only table ${table}` } };
      const hits = rows.filter(match);
      hits.forEach((r) => Object.assign(r, st.payload));
      if (st.single) return hits[0] ? { data: hits[0], error: null } : { data: null, error: { message: 'not found' } };
      return { data: hits, error: null };
    }
    const out = rows.filter(match);
    if (st.maybe) return { data: out[0] || null, error: null };
    if (st.single) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } };
    return { data: out, error: null };
  }
  return chain;
}

let server; let port;
before(async () => {
  resetDb();
  supabase.from = (t) => builder(t);
  // Storage boundary: capture writes, replay reads, mint fake signed URLs (the service's
  // injectable-collaborator seam — real defaults in production).
  svc.dealerEvidenceStorage.uploadToStorage = async (bucket, path, buffer, mimeType) => { db.storage[path] = { buffer, mimeType }; return { path }; };
  svc.dealerEvidenceStorage.downloadFromStorage = async (bucket, path) => {
    const item = db.storage[path];
    if (!item) throw new Error('object not found');
    return { buffer: item.buffer, mimeType: item.mimeType };
  };
  svc.dealerEvidenceStorage.generateSecureReadUrl = async (bucket, path, ttl) => `https://signed.example.test/${encodeURIComponent(path)}?ttl=${ttl}`;

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(onboardingRouter);
  app.use(dealerRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
});
after(() => { server?.close(); });
beforeEach(() => { resetDb(); });

function call(method, path, { userId, token, body } = {}) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-session-token': token } : {}),
        ...(userId ? { 'x-user-id': userId } : {}),
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const PROFILE = { legal_name: 'Moyo Motors (Pvt) Ltd', trading_name: 'Moyo Motors', registration_number: 'CR-12345', operating_country: 'Zimbabwe' };
const PNG = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

async function createApplication(userId = 'dealer-app-1') {
  const res = await call('PUT', '/api/dealer-onboarding/profile', { userId, body: { profile: PROFILE } });
  assert.equal(res.status, 200);
  return res.body.profile;
}

test('X5: access — a business+dealer owner enters their OWN onboarding; individual and non-context callers are refused by name', async () => {
  const individual = await call('GET', '/api/dealer-onboarding/overview', { userId: 'individual-1' });
  assert.equal(individual.status, 403);
  assert.match(JSON.stringify(individual.body), /DEALER_ONBOARDING_CONTEXT_REQUIRED/);

  const applicant = await call('GET', '/api/dealer-onboarding/overview', { userId: 'dealer-app-1' });
  assert.equal(applicant.status, 200);
  assert.equal(applicant.body.profile, null, 'no application yet — honestly reported');
  assert.equal(applicant.body.who_must_act, 'subject_action');
  assert.equal(applicant.body.workspace_access.available, false,
    'business context NEVER unlocks the Dealer workspace');
  assert.match(applicant.body.workspace_access.dependency, /governed_dealer_role_or_tenant_relationship/);
});

test('X5: creating the application grants NO Dealer Compliance outcome — every lifecycle dimension stays at its default', async () => {
  const profile = await createApplication();
  assert.equal(profile.user_id, 'dealer-app-1');
  // The mocked insert has no DB defaults, so the honest assertion is that the service SET none
  // of the governed dimensions — no status key was written at all.
  for (const governed of ['identity_status', 'compliance_review_state', 'active_state', 'suspension_state', 'restriction_state']) {
    assert.equal(profile[governed], undefined, `${governed} is never set by onboarding`);
  }
  const overview = await call('GET', '/api/dealer-onboarding/overview', { userId: 'dealer-app-1' });
  assert.equal(overview.body.compliance.can_publish, false, 'an applicant can never publish');
});

test('X5: forged tenant_id is ignored end-to-end', async () => {
  const res = await call('PUT', '/api/dealer-onboarding/profile', {
    userId: 'dealer-app-1',
    body: { profile: { ...PROFILE, tenant_id: 'tenant-evil', suspension_state: 'none', compliance_review_state: 'passed' } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.tenant_id, undefined, 'tenant_id cannot be client-assigned');
  assert.equal(res.body.profile.compliance_review_state, undefined, 'no lifecycle field is client-writable');

  const source = readFileSync(new URL('../services/dealer/dealerComplianceService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source.match(/const PROFILE_FIELDS = \[[^\]]+\]/)[0], /tenant_id/,
    'tenant_id must stay OUT of the self-editable field allowlist');
});

test('X5: placeholder values are refused as dealer-profile truth; confirm/correct provenance derives server-side', async () => {
  const marker = await call('PUT', '/api/dealer-onboarding/profile', {
    userId: 'dealer-app-1', body: { profile: { ...PROFILE, tax_id: 'N/A' } },
  });
  assert.equal(marker.status, 400);
  assert.match(JSON.stringify(marker.body), /placeholder/i);

  const confirmed = await call('PUT', '/api/dealer-onboarding/profile', {
    userId: 'dealer-app-1',
    body: { profile: PROFILE, candidates_seen: { registration_number: 'CR-12345', legal_name: 'Moyo Motors Ltd' } },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.field_provenance.registration_number, 'user_confirmed');
  assert.equal(confirmed.body.field_provenance.legal_name, 'user_corrected');
  assert.equal(confirmed.body.field_provenance.trading_name, 'user_provided');
});

test('X5: evidence is private — uploads store server-side, responses carry no path, previews are signed and self-scoped', async () => {
  await createApplication();
  const upload = await call('POST', '/api/dealer-onboarding/documents', {
    userId: 'dealer-app-1', body: { doc_type: 'company_registration', file: PNG },
  });
  assert.equal(upload.status, 201);
  assert.equal(upload.body.document.file_ref, undefined, 'the storage path never leaves the server');
  assert.equal(upload.body.document.has_file, true);
  assert.equal(Object.keys(db.storage).length, 1);
  assert.match(Object.keys(db.storage)[0], /^dealer-compliance\//);

  const docId = upload.body.document.id;
  const preview = await call('GET', `/api/dealer-onboarding/documents/${docId}/preview`, { userId: 'dealer-app-1' });
  assert.equal(preview.status, 200);
  assert.match(preview.body.preview.url, /^https:\/\/signed\.example\.test\//);

  // Cross-applicant isolation: applicant 2 (valid dealer context, own empty application).
  await createApplication('dealer-app-2');
  const foreignPreview = await call('GET', `/api/dealer-onboarding/documents/${docId}/preview`, { userId: 'dealer-app-2' });
  assert.equal(foreignPreview.status, 404, "another applicant's evidence is unreachable");
  const foreignUpload = await call('POST', '/api/dealer-onboarding/documents/', { userId: 'individual-1', body: { doc_type: 'other', file: PNG } });
  assert.ok([403, 404].includes(foreignUpload.status));

  const overview2 = await call('GET', '/api/dealer-onboarding/overview', { userId: 'dealer-app-2' });
  assert.equal(overview2.body.documents.length, 0, "applicant 2 sees none of applicant 1's documents");
  assert.doesNotMatch(JSON.stringify(overview2.body), /dealer-compliance\//, 'no storage path leaks anywhere');
});

test('X5: company OCR — real caller attribution, candidates only, markers become missing, nothing else moves', async () => {
  await createApplication();
  const upload = await call('POST', '/api/dealer-onboarding/documents', {
    userId: 'dealer-app-1', body: { doc_type: 'company_registration', file: PNG },
  });
  const docId = upload.body.document.id;

  // Injected OCR double at the service seam (test-only), echoing attribution for the pin.
  const ocrCalls = [];
  const result = await svc.runOwnDealerDocumentOcr(undefined, { id: 'dealer-app-1' }, docId, {
    ocr: {
      async extractDocumentData(docType, dataUri, userId) {
        ocrCalls.push({ docType, userId });
        return {
          success: true,
          provider: 'test-ocr',
          extractedData: {
            confidenceScore: 0.9,
            additional_fields: { company_name: 'Moyo Motors (Pvt) Ltd', registration_number: 'CR-12345', tax_number: 'N/A', address: '12 Samora Machel Ave' },
          },
        };
      },
    },
  });

  assert.deepEqual(ocrCalls, [{ docType: 'dealer_company_registration', userId: 'dealer-app-1' }],
    'extraction is attributed to the real authenticated user');
  assert.equal(result.candidates.legal_name.state, 'machine_candidate');
  assert.equal(result.candidates.legal_name.value, 'Moyo Motors (Pvt) Ltd');
  assert.deepEqual(result.candidates.tax_id, { state: 'missing' }, 'the N/A marker is not data');
  assert.deepEqual(result.candidates.trading_name, { state: 'missing' });

  const docRow = db.dealer_compliance_documents.find((d) => d.id === docId);
  assert.equal(docRow.status, 'present', 'OCR never changes the document compliance status (still the upload-time value)');
  assert.equal(db.dealer_profiles[0].legal_name, PROFILE.legal_name,
    'OCR never writes dealer profile truth — only the user confirm/correct submit does');
  assert.equal(db.dealer_compliance_decisions.length, 0, 'no decision materialised from a machine');
});

test('X5: requirements move ONLY through recordDecision, which still demands the X3 step-up', async () => {
  const profile = await createApplication();
  // Reviewer without a fresh step-up: refused by the assurance layer.
  const noStepUp = await call('PATCH', `/api/admin/dealers/${profile.id}/decision`, {
    token: 'admin-token', body: { decision: 'approve_requirement', requirement_key: 'company_registration' },
  });
  assert.equal(noStepUp.status, 403);
  assert.equal(noStepUp.body.code, 'STEP_UP_REQUIRED');

  db.user_sessions.find((s) => s.id === 's-admin').step_up_at = new Date().toISOString();
  db.user_sessions.find((s) => s.id === 's-admin').step_up_method = 'password_reauth';
  const decided = await call('PATCH', `/api/admin/dealers/${profile.id}/decision`, {
    token: 'admin-token', body: { decision: 'approve_requirement', requirement_key: 'company_registration' },
  });
  assert.equal(decided.status, 201);
  assert.equal(db.dealer_compliance_requirements.find((r) => r.requirement_key === 'company_registration').status, 'verified');
  assert.equal(db.dealer_compliance_decisions.length, 1, 'the governed ledger row exists');
});

test('X5: the reviewer raw-evidence preview sits behind X3 step-up and is audited', async () => {
  const profile = await createApplication();
  const upload = await call('POST', '/api/dealer-onboarding/documents', {
    userId: 'dealer-app-1', body: { doc_type: 'tax_document', file: PNG },
  });
  const docId = upload.body.document.id;

  const listNoPath = await call('GET', `/api/admin/dealers/${profile.id}/documents`, { userId: 'admin-1' });
  assert.equal(listNoPath.status, 200);
  assert.equal(listNoPath.body.documents[0].file_ref, undefined, 'even reviewers list sanitized metadata');

  const bare = await call('GET', `/api/admin/dealers/${profile.id}/documents/${docId}/preview`, { token: 'admin-token' });
  assert.equal(bare.status, 403);
  assert.equal(bare.body.code, 'STEP_UP_REQUIRED');

  db.user_sessions.find((s) => s.id === 's-admin').step_up_at = new Date().toISOString();
  db.user_sessions.find((s) => s.id === 's-admin').step_up_method = 'password_reauth';
  const ok = await call('GET', `/api/admin/dealers/${profile.id}/documents/${docId}/preview`, { token: 'admin-token' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.preview.url, /signed\.example\.test/);
  assert.ok(db.trust_audit_events.some((a) => a.event_type === 'DEALER_EVIDENCE_PREVIEWED'));
});
