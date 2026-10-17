/**
 * O2-X5 — Dealer onboarding: access, isolation, evidence privacy (ported by OC-5C from PR #208).
 *
 * The SHIPPED app (routes, session auth, step-up, error middleware) over an in-memory world; the
 * storage boundary is the service's injectable seam. Held here:
 *
 *   · a BUSINESS+DEALER registrant enters their own onboarding; an individual, or a business that is not
 *     a dealer, is refused by name; a registration read failure is a failure, never "not a dealer";
 *   · business context grants neither a Dealer Compliance outcome nor the Dealer workspace;
 *   · forged tenant_id / lifecycle input is ignored end-to-end (service field allowlist);
 *   · strict self-scope: another applicant's documents and previews are unreachable;
 *   · evidence is PRIVATE: no response carries the storage path; the declared type must be the bytes'
 *     type; previews are short-lived signed links for THIS dealer's own evidence path only;
 *   · the reviewer's raw-evidence preview needs the Dealer Compliance capability and a fresh X3
 *     step-up, and is audited before the link is handed over;
 *   · only recordDecision moves requirements, still behind step-up;
 *   · OC-5C: the responsible person's identity is the subject-safe view; company-document OCR is not
 *     offered; the dealer-role metadata route takes neither a review status nor a file location.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const svc = await import('../services/dealer/dealerOnboardingService.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const USERS = [
  { id: 'dealer-app-1', role: 'owner' },
  { id: 'dealer-app-2', role: 'owner' },
  { id: 'individual-1', role: 'owner' },
  { id: 'garage-1', role: 'owner' },
  { id: 'platform-dealer', role: 'dealer' },
  { id: 'admin-1', role: 'admin' },
];

let world; let restoreWorld; let server; let baseUrl; let stored;
function seedWorld(extra = {}) {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: USERS.map((u) => ({ ...u, name: u.id, email: `${u.id}@example.invalid`, is_verified: true })),
    user_sessions: [
      ...USERS.filter((u) => u.id !== 'admin-1').map((u) => ({ token: `t-${u.id}`, user_id: u.id, is_valid: true, expires_at: FUTURE })),
      { id: 's-admin', token: 't-admin-1', user_id: 'admin-1', is_valid: true, expires_at: FUTURE, auth_method: 'password', step_up_at: null, step_up_method: null },
    ],
    user_registration_profiles: [
      { user_id: 'dealer-app-1', account_kind: 'business', business_type: 'dealer', organization_name: 'Moyo Motors', onboarding_status: 'requested' },
      { user_id: 'dealer-app-2', account_kind: 'business', business_type: 'dealer', organization_name: 'Ncube Autos', onboarding_status: 'requested' },
      { user_id: 'individual-1', account_kind: 'individual', business_type: null, organization_name: null, onboarding_status: 'not_required' },
      { user_id: 'garage-1', account_kind: 'business', business_type: 'garage', organization_name: 'Avondale Garage', onboarding_status: 'requested' },
    ],
    dealer_profiles: [], dealer_branches: [], dealer_compliance_documents: [], dealer_compliance_requirements: [], dealer_compliance_decisions: [],
    verification_sessions: [], identity_lifecycle_events: [], trust_audit_events: [], domain_events: [],
    ...extra,
  });
  restoreWorld = installSupabaseWorld(supabase, world);
}

before(async () => {
  seedWorld();
  stored = {};
  svc.dealerEvidenceStorage.uploadToStorage = async (bucket, path, buffer, mimeType) => { stored[path] = { bucket, buffer, mimeType }; return { path }; };
  svc.dealerEvidenceStorage.generateSecureReadUrl = async (bucket, path, ttl) => `https://signed.example.invalid/${encodeURIComponent(path)}?ttl=${ttl}`;
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => { seedWorld(); stored = {}; });

async function call(method, path, { as, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(as ? { 'x-session-token': `t-${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

const PROFILE = { legal_name: 'Moyo Motors (Pvt) Ltd', trading_name: 'Moyo Motors', registration_number: 'CR-12345', operating_country: 'Zimbabwe' };
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
const PNG = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const stepUpAdmin = () => Object.assign(world.rows('user_sessions').find((s) => s.id === 's-admin'), { step_up_at: new Date().toISOString(), step_up_method: 'password_reauth' });

async function createApplication(as = 'dealer-app-1') {
  const res = await call('PUT', '/api/dealer-onboarding/profile', { as, body: { profile: PROFILE } });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  return res.body.profile;
}
async function upload(as = 'dealer-app-1', docType = 'company_registration', file = PNG) {
  return call('POST', '/api/dealer-onboarding/documents', { as, body: { doc_type: docType, file } });
}

test('X5: access — a business+dealer registrant enters their OWN onboarding; an individual and a non-dealer business are refused by name', async () => {
  for (const who of ['individual-1', 'garage-1']) {
    const refused = await call('GET', '/api/dealer-onboarding/overview', { as: who });
    assert.equal(refused.status, 403, who);
    assert.match(refused.text, /DEALER_ONBOARDING_CONTEXT_REQUIRED/);
  }
  const applicant = await call('GET', '/api/dealer-onboarding/overview', { as: 'dealer-app-1' });
  assert.equal(applicant.status, 200, applicant.text.slice(0, 300));
  assert.equal(applicant.body.profile, null, 'no application yet — honestly reported');
  assert.equal(applicant.body.who_must_act, 'subject_action');
  assert.equal(applicant.body.workspace_access.available, false, 'business context NEVER unlocks the Dealer workspace');
  assert.match(applicant.body.workspace_access.dependency, /governed_dealer_role_or_tenant_relationship/);
  assert.equal(applicant.body.document_extraction.available, false, 'company-document OCR is not offered on this lineage');
  const unauthenticated = await call('GET', '/api/dealer-onboarding/overview');
  assert.equal(unauthenticated.status, 401);
});

test('X5: a registration read failure is reported as a failure — never as "you are not a dealer"', async () => {
  const realFrom = supabase.from;
  supabase.from = (table) => (table === 'user_registration_profiles'
    ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }) }) }) }
    : realFrom(table));
  try {
    const res = await call('GET', '/api/dealer-onboarding/overview', { as: 'dealer-app-1' });
    assert.equal(res.status, 500);
    assert.doesNotMatch(res.text, /DEALER_ONBOARDING_CONTEXT_REQUIRED/);
  } finally {
    supabase.from = realFrom;
  }
});

test('X5: creating the application grants NO Dealer Compliance outcome — no governed dimension is written, nothing can publish', async () => {
  const profile = await createApplication();
  assert.equal(profile.user_id, 'dealer-app-1');
  for (const governed of ['identity_status', 'compliance_review_state', 'active_state', 'suspension_state', 'restriction_state']) {
    assert.equal(profile[governed], undefined, `${governed} is never set by onboarding`);
  }
  const overview = await call('GET', '/api/dealer-onboarding/overview', { as: 'dealer-app-1' });
  assert.equal(overview.body.compliance.can_publish, false, 'an applicant can never publish');
  assert.ok(world.rows('trust_audit_events').some((e) => e.event_type === 'DEALER_ONBOARDING_PROFILE_SUBMITTED'));
  assert.equal(world.rows('domain_events').filter((e) => e.event_type === 'dealer.onboarding.started').length, 0, 'observability-only onboarding does not create worker work');

  // A second save is an UPDATE: audited as one, and no onboarding outbox work is created.
  const again = await call('PUT', '/api/dealer-onboarding/profile', { as: 'dealer-app-1', body: { profile: { ...PROFILE, trading_name: 'Moyo Motors Harare' } } });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.changed_fields, ['trading_name']);
  assert.ok(world.rows('trust_audit_events').some((e) => e.event_type === 'DEALER_ONBOARDING_PROFILE_UPDATED'));
  assert.equal(world.rows('domain_events').filter((e) => e.event_type === 'dealer.onboarding.started').length, 0);
});

test('OC-5C: a profile lookup that fails is a failure — never guessed "new" (no second SUBMITTED audit, no orphan outbox work)', async () => {
  const profile = await createApplication();
  const auditsBefore = world.rows('trust_audit_events').length;
  const realFrom = supabase.from;
  let failNext = true;
  supabase.from = (table) => {
    if (table === 'dealer_profiles' && failNext) {
      failNext = false;
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }) }) }) };
    }
    return realFrom(table);
  };
  try {
    const res = await call('PUT', '/api/dealer-onboarding/profile', { as: 'dealer-app-1', body: { profile: { ...PROFILE, trading_name: 'Renamed' } } });
    assert.equal(res.status, 500, res.text.slice(0, 200));
  } finally {
    supabase.from = realFrom;
  }
  assert.equal(world.rows('dealer_profiles').find((p) => p.id === profile.id).trading_name, PROFILE.trading_name, 'nothing was written');
  assert.equal(world.rows('trust_audit_events').length, auditsBefore, 'no audit claims a submission');
  assert.equal(world.rows('domain_events').filter((e) => e.event_type === 'dealer.onboarding.started').length, 0, 'failed retry never creates onboarding worker work');
});

test('OC-5C: a lost audit is REPORTED with the durable write — never a 500 for a profile or an upload that happened', async () => {
  const realFrom = supabase.from;
  supabase.from = (table) => (table === 'trust_audit_events'
    ? { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'audit store down' } }) }), then: (r) => Promise.resolve({ data: null, error: { message: 'audit store down' } }).then(r) }) }
    : realFrom(table));
  try {
    const saved = await call('PUT', '/api/dealer-onboarding/profile', { as: 'dealer-app-1', body: { profile: PROFILE } });
    assert.equal(saved.status, 200, saved.text.slice(0, 200));
    assert.equal(saved.body.audit_recorded, false);
    const up = await upload();
    assert.equal(up.status, 201, up.text.slice(0, 200));
    assert.equal(up.body.audit_recorded, false);
  } finally {
    supabase.from = realFrom;
  }
  assert.equal(world.rows('dealer_profiles').length, 1);
  assert.equal(world.rows('dealer_compliance_documents').length, 1);
});

test('X5: forged tenant_id and lifecycle input are ignored end-to-end — tenant binding is never client-assigned', async () => {
  const res = await call('PUT', '/api/dealer-onboarding/profile', {
    as: 'dealer-app-1',
    body: { profile: { ...PROFILE, tenant_id: 'tenant-evil', suspension_state: 'none', compliance_review_state: 'passed' } },
  });
  assert.equal(res.status, 200);
  const row = world.rows('dealer_profiles')[0];
  assert.equal(row.tenant_id, undefined, 'tenant_id cannot be client-assigned');
  assert.equal(row.compliance_review_state, undefined, 'no lifecycle field is client-writable');

  // The dealer-role route that took the whole body (RC1) is held to the same allowlist.
  const dealerRoute = await call('POST', '/api/dealer/profile', { as: 'platform-dealer', body: { ...PROFILE, tenant_id: 'tenant-evil' } });
  assert.equal(dealerRoute.status, 201);
  assert.equal(world.rows('dealer_profiles').find((p) => p.user_id === 'platform-dealer').tenant_id, undefined);

  const source = readFileSync(new URL('../services/dealer/dealerComplianceService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source.match(/const PROFILE_FIELDS = \[[^\]]+\]/)[0], /tenant_id/, 'tenant_id stays OUT of the editable allowlist');
});

test('X5: placeholder values are refused as dealer-profile truth; there are no document candidates to "confirm"', async () => {
  const marker = await call('PUT', '/api/dealer-onboarding/profile', { as: 'dealer-app-1', body: { profile: { ...PROFILE, tax_id: 'N/A' } } });
  assert.equal(marker.status, 400);
  assert.match(marker.text, /placeholder/i);
  const claimed = await call('PUT', '/api/dealer-onboarding/profile', {
    as: 'dealer-app-1', body: { profile: PROFILE, candidates_seen: { registration_number: 'CR-12345' } },
  });
  assert.equal(claimed.status, 400, 'nothing was read from a document, so nothing can be claimed as confirmed');
  assert.equal(world.rows('dealer_profiles').length, 0, 'nothing was written');
});

test('X5: evidence is private — stored server-side, no path in any response, previews signed and self-scoped', async () => {
  await createApplication();
  const up = await upload();
  assert.equal(up.status, 201, up.text.slice(0, 300));
  assert.equal(up.body.document.file_ref, undefined, 'the storage path never leaves the server');
  assert.equal(up.body.document.has_file, true);
  assert.equal(up.body.document.status, 'present');
  const dealerId = world.rows('dealer_profiles')[0].id;
  assert.deepEqual(Object.keys(stored).map((p) => p.startsWith(`dealer-compliance/${dealerId}/`)), [true]);

  const docId = up.body.document.id;
  const preview = await call('GET', `/api/dealer-onboarding/documents/${docId}/preview`, { as: 'dealer-app-1' });
  assert.equal(preview.status, 200);
  assert.match(preview.body.preview.url, /^https:\/\/signed\.example\.invalid\//);

  await createApplication('dealer-app-2');
  const foreign = await call('GET', `/api/dealer-onboarding/documents/${docId}/preview`, { as: 'dealer-app-2' });
  assert.equal(foreign.status, 404, "another applicant's evidence is unreachable");
  const notDealer = await upload('individual-1', 'other');
  assert.equal(notDealer.status, 403);
  const overview2 = await call('GET', '/api/dealer-onboarding/overview', { as: 'dealer-app-2' });
  assert.equal(overview2.body.documents.length, 0, "applicant 2 sees none of applicant 1's documents");
  assert.doesNotMatch(overview2.text, /dealer-compliance\//, 'no storage path leaks anywhere');
});

test('OC-5C: an upload whose bytes are not the type it declares is refused, and nothing is stored', async () => {
  await createApplication();
  const spoof = await upload('dealer-app-1', 'company_registration', `data:image/png;base64,${Buffer.from('<html>not a png</html>').toString('base64')}`);
  assert.equal(spoof.status, 400);
  assert.match(spoof.text, /not the type it claims/);
  const pdfAsPng = await upload('dealer-app-1', 'company_registration', `data:image/png;base64,${Buffer.from('%PDF-1.7 body').toString('base64')}`);
  assert.equal(pdfAsPng.status, 400);
  assert.deepEqual(Object.keys(stored), []);
  assert.equal(world.rows('dealer_compliance_documents').length, 0);
  const realPdf = await upload('dealer-app-1', 'tax_document', `data:application/pdf;base64,${Buffer.from('%PDF-1.7 body').toString('base64')}`);
  assert.equal(realPdf.status, 201, 'a real PDF is accepted');
});

test('OC-5C: a document pointing OUTSIDE this dealer\'s evidence prefix is never signed — for the dealer or the reviewer', async () => {
  const profile = await createApplication();
  // A planted row: someone else's private identity document path in the same bucket.
  world.rows('dealer_compliance_documents').push({ id: 'doc-planted', dealer_id: profile.id, doc_type: 'other', status: 'present', file_ref: 'owner-2/vs-pending/front-secret.jpg' });
  const own = await call('GET', '/api/dealer-onboarding/documents/doc-planted/preview', { as: 'dealer-app-1' });
  assert.equal(own.status, 404);
  stepUpAdmin();
  const reviewer = await call('GET', `/api/admin/dealers/${profile.id}/documents/doc-planted/preview`, { as: 'admin-1' });
  assert.equal(reviewer.status, 404);
  assert.doesNotMatch(own.text + reviewer.text, /front-secret|signed\.example/);
});

test('OC-5C: the dealer-role metadata route records WHAT a document is — never its review status or where its file lives', async () => {
  const create = await call('POST', '/api/dealer/profile', { as: 'platform-dealer', body: PROFILE });
  assert.equal(create.status, 201);
  const res = await call('POST', '/api/dealer/documents', {
    as: 'platform-dealer', body: { doc_type: 'tax_clearance', status: 'verified', file_ref: 'owner-2/vs-pending/front-secret.jpg' },
  });
  assert.equal(res.status, 201);
  const row = world.rows('dealer_compliance_documents').at(-1);
  assert.deepEqual([row.doc_type, row.status, row.file_ref], ['tax_clearance', 'present', null]);
});

test('X5: requirements move ONLY through recordDecision, which still demands the X3 step-up', async () => {
  const profile = await createApplication();
  const noStepUp = await call('PATCH', `/api/admin/dealers/${profile.id}/decision`, {
    as: 'admin-1', body: { decision: 'approve_requirement', requirement_key: 'company_registration' },
  });
  assert.equal(noStepUp.status, 403);
  assert.equal(noStepUp.body.code, 'STEP_UP_REQUIRED');

  stepUpAdmin();
  const decided = await call('PATCH', `/api/admin/dealers/${profile.id}/decision`, {
    as: 'admin-1', body: { decision: 'approve_requirement', requirement_key: 'company_registration' },
  });
  assert.equal(decided.status, 201, decided.text.slice(0, 300));
  assert.equal(world.rows('dealer_compliance_requirements').find((r) => r.requirement_key === 'company_registration').status, 'verified');
  assert.equal(world.rows('dealer_compliance_decisions').length, 1, 'the governed ledger row exists');
});

test('X5: the reviewer raw-evidence preview — capability + fresh step-up, audited before the link is handed over', async () => {
  const profile = await createApplication();
  const docId = (await upload('dealer-app-1', 'tax_document')).body.document.id;

  const list = await call('GET', `/api/admin/dealers/${profile.id}/documents`, { as: 'admin-1' });
  assert.equal(list.status, 200);
  assert.equal(list.body.documents[0].file_ref, undefined, 'even reviewers list sanitized metadata');
  assert.equal(list.body.documents[0].has_file, true);

  const notAdmin = await call('GET', `/api/admin/dealers/${profile.id}/documents/${docId}/preview`, { as: 'dealer-app-1' });
  assert.equal(notAdmin.status, 403);
  const bare = await call('GET', `/api/admin/dealers/${profile.id}/documents/${docId}/preview`, { as: 'admin-1' });
  assert.equal(bare.status, 403);
  assert.equal(bare.body.code, 'STEP_UP_REQUIRED');

  stepUpAdmin();
  const ok = await call('GET', `/api/admin/dealers/${profile.id}/documents/${docId}/preview`, { as: 'admin-1' });
  assert.equal(ok.status, 200, ok.text.slice(0, 300));
  assert.match(ok.body.preview.url, /signed\.example\.invalid/);
  assert.ok(world.rows('trust_audit_events').some((a) => a.event_type === 'DEALER_EVIDENCE_PREVIEWED'));

  // An unauditable preview is not opened.
  const realFrom = supabase.from;
  supabase.from = (table) => (table === 'trust_audit_events'
    ? { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'audit store down' } }) }), then: (r) => Promise.resolve({ data: null, error: { message: 'audit store down' } }).then(r) }) }
    : realFrom(table));
  try {
    const unaudited = await call('GET', `/api/admin/dealers/${profile.id}/documents/${docId}/preview`, { as: 'admin-1' });
    assert.equal(unaudited.status, 503, unaudited.text.slice(0, 300));
    assert.doesNotMatch(unaudited.text, /signed\.example/);
  } finally {
    supabase.from = realFrom;
  }
});

test('OC-5C: the responsible person\'s identity is the SUBJECT view — never "compromised" or a takeover hypothesis', async () => {
  seedWorld({
    verification_sessions: [{ id: 'vs-d', user_id: 'dealer-app-1', status: 'verified', workflow_phase: 'resolved_approved', reviewed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }],
    identity_lifecycle_events: [{ id: 'le-1', seq: 1, user_id: 'dealer-app-1', previous_state: 'verified', next_state: 'compromised', reason_code: 'SUSPECTED_ACCOUNT_TAKEOVER', actor_user_id: 'admin-9', note: 'INTERNAL', policy_version: 'identity_lifecycle.v1', created_at: '2026-09-02T00:00:00Z' }],
  });
  const res = await call('GET', '/api/dealer-onboarding/overview', { as: 'dealer-app-1' });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.body.responsible_person_identity.status, 'security_review');
  assert.equal(res.body.responsible_person_identity.capability_bearing, false);
  for (const forbidden of [/compromised/i, /TAKEOVER/, /admin-9/, /INTERNAL/]) assert.doesNotMatch(res.text, forbidden);
});

test('OC-5C: an unreadable identity standing fails the overview CLOSED (503) — never a stand-in "verified"', async () => {
  const realFrom = supabase.from;
  supabase.from = (table) => (table === 'identity_lifecycle_events'
    ? { select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'relation "identity_lifecycle_events" does not exist' } }) }) }
    : realFrom(table));
  try {
    const res = await call('GET', '/api/dealer-onboarding/overview', { as: 'dealer-app-1' });
    assert.equal(res.status, 503, res.text.slice(0, 300));
    assert.equal(res.body.error.code, 'IDENTITY_STATUS_UNAVAILABLE');
    assert.doesNotMatch(res.text, /verified/);
  } finally {
    supabase.from = realFrom;
  }
});

test('OC-5C: the registration ladder offers dealer onboarding only to a registered DEALER business', async () => {
  const { deriveOnboardingJourney } = await import('../services/registration/registrationJourneyService.js');
  const unlocks = (profile) => deriveOnboardingJourney({ profile }).capability_ladder.find((s) => s.stage === 'contact_context_established').unlocks;
  assert.ok(unlocks({ account_kind: 'business', business_type: 'dealer' }).includes('prepare_dealer_onboarding'));
  assert.ok(!unlocks({ account_kind: 'business', business_type: 'garage' }).includes('prepare_dealer_onboarding'));
  assert.ok(!unlocks({ account_kind: 'individual' }).includes('prepare_dealer_onboarding'));
});

test('P7 REGRESSION: a uuid-cast refusal on the id probe falls through to the user lookup (real Postgres 22P02)', async () => {
  const { getProfile } = await import('../services/dealer/dealerComplianceService.js');
  const original = supabase.from;
  const seen = [];
  supabase.from = (table) => {
    const state = { column: null, value: null };
    const api = {
      select() { return api; },
      eq(column, value) { state.column = column; state.value = value; return api; },
      maybeSingle() {
        seen.push(state.column);
        if (table === 'dealer_profiles' && state.column === 'id' && !/^[0-9a-f-]{36}$/i.test(String(state.value))) {
          return Promise.resolve({ data: null, error: { message: 'invalid input syntax for type uuid: "u_text_id"' } });
        }
        if (table === 'dealer_profiles' && state.column === 'user_id') {
          return Promise.resolve({ data: { id: 'dp-uuid', user_id: state.value }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return api;
  };
  try {
    const profile = await getProfile('u_text_id');
    assert.equal(profile.user_id, 'u_text_id', 'the user lookup answers instead of the request 500ing');
    assert.deepEqual(seen, ['id', 'user_id'], 'id probed first, then the user fallback');
  } finally {
    supabase.from = original;
  }
});

test('P7 REGRESSION: a NON-uuid database error is never swallowed by that fallback', async () => {
  const { getProfile } = await import('../services/dealer/dealerComplianceService.js');
  const original = supabase.from;
  supabase.from = () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: { message: 'connection terminated unexpectedly' } }); },
  });
  try {
    await assert.rejects(getProfile('dp-1'), /connection terminated/);
  } finally {
    supabase.from = original;
  }
});
