/**
 * O2-X2 — Registration onboarding routes, through the SHIPPED app (ported by OC-5C from PR #208).
 *
 * The real server (routes, session auth, error middleware) over an in-memory world. #208 mounted the
 * router alone behind the x-user-id fallback; here every caller presents a real session token, and the
 * fallback is proven unable to write a profile. Proven behaviours:
 *
 *   · unauthenticated requests are refused;
 *   · the journey is SELF-scoped — one user can never read another's onboarding state,
 *     candidates, or evidence-derived fields;
 *   · candidates render markers/absences as `missing` (a fallback value cannot even be
 *     shown, let alone confirmed);
 *   · the profile write persists confirmed values, derives confirmed-vs-corrected
 *     provenance server-side, audits it, and refuses fallback markers;
 *   · a completed step is still there on the next request (refresh/relogin resume);
 *   · reading the journey performs ZERO domain writes even when identity is approved —
 *     approval is displayed, never propagated into any other authority;
 *   · an OCR-failed session leaves manual continuation open (profile writes still work);
 *   · OC-5C: the person's current standing is subject-safe; an unreadable standing fails closed (503);
 *     business identity is fixed once registered.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'debug']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

let world; let restoreWorld; let server; let baseUrl;
function seedWorld(extra = {}) {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: [
      { id: 'user-a', name: 'Tinashe Moyo', email: 'a@example.invalid', phone: '+263771111111', role: 'owner', is_verified: true, join_date: '2026-09-01T08:00:00.000Z' },
      { id: 'user-b', name: 'Rudo Ncube', email: 'b@example.invalid', phone: '', role: 'owner', is_verified: false, join_date: '2026-09-02T08:00:00.000Z' },
    ],
    user_sessions: [
      { token: 'x2-a', user_id: 'user-a', is_valid: true, expires_at: FUTURE },
      { token: 'x2-b', user_id: 'user-b', is_valid: true, expires_at: FUTURE },
    ],
    user_registration_profiles: [],
    verification_sessions: [],
    identity_lifecycle_events: [],
    trust_audit_events: [],
    ...extra,
  });
  restoreWorld = installSupabaseWorld(supabase, world);
}

before(async () => {
  seedWorld();
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => seedWorld());

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(token ? { 'x-session-token': token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

const VALID_PROFILE = {
  account_kind: 'individual',
  market_relationship: 'diaspora',
  country_of_residence: 'Zimbabwe',
  city: 'Leeds',
  intended_use: 'buy_sell',
  terms_acknowledged: true,
  privacy_acknowledged: true,
};
const READ_SESSION = {
  id: 'vs-a1', user_id: 'user-a', document_type: 'national_id', status: 'pending_manual_review',
  workflow_phase: 'reviewer_action_required', confidence_score: 0.9,
  ocr_execution_status: 'provider_succeeded', extraction_trust_status: 'partially_trusted',
  ocr_result: { first_name: 'Tinashe', last_name: 'Moyo', country: 'Zimbabwe', national_id_number: 'N/A' },
  created_at: '2026-09-03T08:30:00.000Z', updated_at: '2026-09-03T08:40:00.000Z',
};
const domainWrites = () => world.writes.filter((w) => w.table !== 'user_sessions');

test('routes: unauthenticated requests are refused on all three endpoints', async () => {
  for (const [method, path, body] of [
    ['GET', '/api/registration/journey'],
    ['GET', '/api/registration/profile/candidates'],
    ['PUT', '/api/registration/profile', { profile: VALID_PROFILE }],
  ]) {
    const res = await call(method, path, { body });
    assert.equal(res.status, 401, `${method} ${path} → ${res.status}`);
  }
});

test('OC-5C: the x-user-id development fallback can never write a profile — the write needs a real session', async () => {
  process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
  try {
    // The fallback is live (a read accepts it) — so the refusal below is the write's session requirement.
    const read = await call('GET', '/api/registration/journey', { headers: { 'x-user-id': 'user-a' } });
    assert.equal(read.status, 200, read.text.slice(0, 200));
    const res = await call('PUT', '/api/registration/profile', { headers: { 'x-user-id': 'user-a' }, body: { profile: VALID_PROFILE } });
    assert.equal(res.status, 401, res.text.slice(0, 200));
    assert.equal(world.rows('user_registration_profiles').length, 0);
  } finally {
    delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  }
});

test('routes: a fresh account sees safe capabilities now, honest gaps, and the applicant as next actor', async () => {
  const res = await call('GET', '/api/registration/journey', { token: 'x2-a' });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.body.journey.steps.account_created, true);
  assert.equal(res.body.journey.steps.context_established, false);
  assert.equal(res.body.journey.steps.identity.state, 'not_started');
  assert.equal(res.body.journey.who_must_act, 'subject_action');
  assert.equal(res.body.journey.capability_ladder[0].reached, true);
  assert.equal(res.body.user.email_verified, true, 'the email-lane flag is displayed as itself');
  assert.equal(res.body.profile, null);
  assert.equal(res.body.identity_assurance.assurance_level, 'not_established');
});

test('routes: confirming and correcting candidates persists the profile, derives provenance server-side, and audits it', async () => {
  seedWorld({ verification_sessions: [READ_SESSION] });
  const candidates = await call('GET', '/api/registration/profile/candidates', { token: 'x2-a' });
  assert.equal(candidates.status, 200);
  const fields = candidates.body.candidates;
  assert.equal(fields.available, true);
  assert.equal(fields.profile_candidates.country_of_residence.value, 'Zimbabwe');
  assert.deepEqual(fields.document_fields.national_id_number, { state: 'missing' }, 'the marker is not shown as data');
  assert.deepEqual(fields.document_fields.date_of_birth, { state: 'missing' });

  const confirmed = await call('PUT', '/api/registration/profile', {
    token: 'x2-a', body: { profile: VALID_PROFILE, candidates_seen: { country_of_residence: 'Zimbabwe' } },
  });
  assert.equal(confirmed.status, 200, confirmed.text.slice(0, 300));
  assert.equal(confirmed.body.field_provenance.country_of_residence, 'user_confirmed');
  assert.equal(confirmed.body.field_provenance.city, 'user_provided');
  assert.equal(confirmed.body.audit_recorded, true);
  assert.equal(world.rows('user_registration_profiles')[0].country_of_residence, 'Zimbabwe');

  const corrected = await call('PUT', '/api/registration/profile', {
    token: 'x2-a', body: { profile: { ...VALID_PROFILE, country_of_residence: 'United Kingdom' }, candidates_seen: { country_of_residence: 'Zimbabwe' } },
  });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.field_provenance.country_of_residence, 'user_corrected');
  assert.equal(world.rows('user_registration_profiles')[0].country_of_residence, 'United Kingdom');

  const audit = world.rows('trust_audit_events').filter((e) => String(e.event_type).startsWith('REGISTRATION_PROFILE_')).at(-1);
  assert.equal(audit.event_type, 'REGISTRATION_PROFILE_UPDATED');
  assert.equal(audit.new_value.field_provenance.country_of_residence, 'user_corrected');
  assert.deepEqual(audit.new_value.changed_fields, ['country_of_residence']);
});

test('routes: a fallback marker is refused as profile content', async () => {
  const res = await call('PUT', '/api/registration/profile', { token: 'x2-a', body: { profile: { ...VALID_PROFILE, city: 'Unknown' } } });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /placeholder/i);
  assert.equal(world.rows('user_registration_profiles').length, 0, 'nothing was written');
});

test('routes: refresh/relogin resumes — completed steps are still there on the next request', async () => {
  const put = await call('PUT', '/api/registration/profile', { token: 'x2-a', body: { profile: VALID_PROFILE } });
  assert.equal(put.status, 200);
  const journey = await call('GET', '/api/registration/journey', { token: 'x2-a' });
  assert.equal(journey.status, 200);
  assert.equal(journey.body.journey.steps.context_established, true);
  assert.equal(journey.body.profile.city, 'Leeds');
  assert.equal(journey.body.journey.who_must_act, 'subject_action', 'identity is still the outstanding subject step');
});

test('routes: the journey is self-scoped — another user sees none of it', async () => {
  seedWorld({
    verification_sessions: [READ_SESSION],
    user_registration_profiles: [{ user_id: 'user-a', account_kind: 'individual', city: 'Leeds', created_at: 'T' }],
  });
  const journeyB = await call('GET', '/api/registration/journey', { token: 'x2-b' });
  assert.equal(journeyB.status, 200);
  assert.equal(journeyB.body.profile, null);
  assert.equal(journeyB.body.identity_session, null);
  assert.equal(journeyB.body.journey.steps.identity.state, 'not_started');
  assert.ok(!journeyB.text.includes('Tinashe'), 'nothing of user A');

  const candidatesB = await call('GET', '/api/registration/profile/candidates', { token: 'x2-b' });
  assert.equal(candidatesB.body.candidates.available, false, "user B cannot see user A's extracted fields");
});

test('routes: an approved identity is displayed, and reading it writes NOTHING to any domain table', async () => {
  seedWorld({
    user_registration_profiles: [{
      user_id: 'user-a', account_kind: 'individual', market_relationship: 'diaspora',
      country_of_residence: 'Zimbabwe', city: 'Leeds', intended_use: 'buy_sell',
      onboarding_status: 'not_required', created_at: '2026-09-03T09:00:00.000Z',
    }],
    verification_sessions: [{
      id: 'vs-a2', user_id: 'user-a', document_type: 'national_id', status: 'verified',
      workflow_phase: 'resolved_approved', submitted_at: 'T1', updated_at: '2026-09-03T10:00:00.000Z', reviewed_at: '2026-09-03T10:00:00.000Z', created_at: '2026-09-03T09:00:00.000Z',
    }],
  });
  const before = domainWrites().length;
  const res = await call('GET', '/api/registration/journey', { token: 'x2-a' });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.body.journey.steps.identity.state, 'approved');
  assert.equal(res.body.journey.who_must_act, 'none');
  assert.equal(res.body.identity_assurance.assurance_level, 'established');

  const lockedBy = Object.fromEntries(res.body.journey.locked_capabilities.map((l) => [l.capability, l.locked_by]));
  assert.equal(lockedBy.sell_vehicle_publicly, 'seller_authority', 'identity approval never grants Seller Authority');
  assert.equal(lockedBy.dealer_tools, 'dealer_compliance', 'identity approval never grants Dealer Compliance');
  assert.equal(lockedBy.vehicle_trust, 'canonical_trust_service', 'identity approval never changes Vehicle Trust');
  assert.deepEqual(domainWrites().slice(before), [], 'the journey read performed zero domain writes');
});

test('OC-5C: a COMPROMISED person reads "under security review" — no internal state, no reason code, no provenance anywhere in the response', async () => {
  seedWorld({
    user_registration_profiles: [{ user_id: 'user-a', account_kind: 'individual', city: 'Leeds', created_at: 'T' }],
    verification_sessions: [{ id: 'vs-a2', user_id: 'user-a', document_type: 'national_id', status: 'verified', workflow_phase: 'resolved_approved', reviewed_at: '2026-09-03T10:00:00.000Z', updated_at: '2026-09-03T10:00:00.000Z', created_at: '2026-09-03T09:00:00.000Z' }],
    identity_lifecycle_events: [{ id: 'le-1', seq: 1, user_id: 'user-a', previous_state: 'verified', next_state: 'compromised', reason_code: 'SUSPECTED_ACCOUNT_TAKEOVER',
      trigger_source: 'reviewer_action', actor_kind: 'user', actor_user_id: 'admin-7', note: 'INTERNAL: SIM swap reported by the network', policy_version: 'identity_lifecycle.v1', created_at: '2026-09-04T00:00:00.000Z' }],
  });
  const res = await call('GET', '/api/registration/journey', { token: 'x2-a' });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.body.journey.steps.identity.state, 'security_review');
  assert.equal(res.body.identity_assurance.status, 'security_review');
  assert.equal(res.body.identity_assurance.status_label, 'under security review');
  assert.equal(res.body.identity_assurance.usable_for_identity_gated_actions, false);
  assert.match(res.body.journey.required_action, /For your security, CarUp is reviewing this account/);
  for (const forbidden of [/compromised/i, /TAKEOVER/, /admin-7/, /SIM swap/, /identity_lifecycle_events/, /decision_provenance/]) {
    assert.doesNotMatch(res.text, forbidden, `the person's own journey never carries ${forbidden}`);
  }
});

test('OC-5C: an unreadable identity standing fails the journey CLOSED (503) — never a stale session shown as verified', async () => {
  seedWorld({
    verification_sessions: [{ id: 'vs-a2', user_id: 'user-a', document_type: 'national_id', status: 'verified', workflow_phase: 'resolved_approved', created_at: '2026-09-03T09:00:00.000Z' }],
  });
  const realFrom = supabase.from;
  supabase.from = (table) => (table === 'identity_lifecycle_events'
    ? { select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'relation "identity_lifecycle_events" does not exist' } }) }) }
    : realFrom(table));
  try {
    const res = await call('GET', '/api/registration/journey', { token: 'x2-a' });
    assert.equal(res.status, 503, res.text.slice(0, 300));
    assert.equal(res.body.error.code, 'IDENTITY_STATUS_UNAVAILABLE');
    assert.doesNotMatch(res.text, /"approved"/);
  } finally {
    supabase.from = realFrom;
  }
});

test('OC-5C: a registered business type cannot be switched through this form — the provider marketplace stays closed', async () => {
  seedWorld({
    user_registration_profiles: [{
      user_id: 'user-a', account_kind: 'business', market_relationship: 'zimbabwe_local', country_of_residence: 'Zimbabwe', city: 'Harare',
      intended_use: 'professional_services', organization_name: 'Moyo Garage', business_type: 'garage', onboarding_status: 'in_review',
      marketing_consent: false, terms_acknowledged_at: '2026-08-29T12:00:00.000Z', privacy_acknowledged_at: '2026-08-29T12:00:00.000Z', created_at: '2026-08-29T12:00:00.000Z',
    }],
  });
  const res = await call('PUT', '/api/registration/profile', {
    token: 'x2-a',
    body: { profile: { account_kind: 'business', market_relationship: 'zimbabwe_local', country_of_residence: 'Zimbabwe', city: 'Harare',
      intended_use: 'professional_services', organization_name: 'Moyo Logistics', business_type: 'logistics_provider', terms_acknowledged: true, privacy_acknowledged: true } },
  });
  assert.equal(res.status, 409, res.text.slice(0, 300));
  assert.match(res.body.error.message, /REGISTRATION_FIELD_FIXED/);
  const stored = world.rows('user_registration_profiles')[0];
  assert.deepEqual([stored.business_type, stored.onboarding_status, stored.organization_name], ['garage', 'in_review', 'Moyo Garage'], 'nothing changed');

  const { resolveLogisticsProviderContext } = await import('../services/diaspora/diasporaLogisticsRfqService.js');
  await assert.rejects(() => resolveLogisticsProviderContext({ id: 'user-a', role: 'owner' }, { client: supabase }),
    /logistics-provider business profile is required/);
});

test('routes: an OCR-failed session leaves manual continuation open', async () => {
  seedWorld({
    verification_sessions: [{
      id: 'vs-a3', user_id: 'user-a', document_type: 'national_id', status: 'ocr_failed',
      workflow_phase: 'reviewer_action_required', failure_reason: 'provider unavailable', ocr_execution_status: 'provider_failed',
      created_at: '2026-09-03T08:30:00.000Z',
    }],
  });
  const journey = await call('GET', '/api/registration/journey', { token: 'x2-a' });
  assert.equal(journey.body.journey.steps.identity.state, 'in_review', 'a technical failure routes to humans');
  const put = await call('PUT', '/api/registration/profile', { token: 'x2-a', body: { profile: VALID_PROFILE } });
  assert.equal(put.status, 200, 'profile completion is never blocked by an OCR failure');
});

test('routes: registration surfaces import no domain authority writers (source pin)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const rel of ['../routes/registrationOnboardingRoutes.js', '../services/registration/registrationJourneyService.js']) {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /import[^;]*(sellerAuthorityService|dealerComplianceService|canonicalTrustService|passportOwnershipTransfer)/,
      `${rel} must not import domain authorities`,
    );
    assert.doesNotMatch(source, /from\(['"]vehicles['"]\)|vehicle_seller_authority|trust_score/,
      `${rel} must not reach authority tables`);
  }
});
