/**
 * O2-X2 — Registration onboarding routes (runtime, over HTTP).
 *
 * Mounts the REAL router behind the REAL authorizeRole middleware and the real error
 * middleware; only the Supabase client is mocked. Proven behaviours:
 *
 *   · unauthenticated requests are refused;
 *   · the journey is SELF-scoped — one user can never read another's onboarding state,
 *     candidates, or evidence-derived fields;
 *   · candidates render markers/absences as `missing` (a fallback value cannot even be
 *     shown, let alone confirmed);
 *   · the profile write persists confirmed values, derives confirmed-vs-corrected
 *     provenance server-side, audits it, and refuses fallback markers;
 *   · a completed step is still there on the next request (refresh/relogin resume);
 *   · reading the journey performs ZERO writes even when identity is approved —
 *     approval is displayed, never propagated into any other authority;
 *   · an OCR-failed session leaves manual continuation open (profile writes still work).
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/registrationOnboardingRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function resetDb() {
  db = {
    users: {
      'user-a': { id: 'user-a', name: 'Tinashe Moyo', email: 'a@example.test', phone: '+263771111111', role: 'owner', is_verified: true, join_date: '2026-09-01T08:00:00.000Z' },
      'user-b': { id: 'user-b', name: 'Rudo Ncube', email: 'b@example.test', phone: '', role: 'owner', is_verified: false, join_date: '2026-09-02T08:00:00.000Z' },
    },
    profiles: {}, // user_id -> row
    sessions: [], // verification_sessions rows
    auditInserts: [],
    calls: [],
  };
}

function rowsFor(table, filters) {
  if (table === 'users') {
    const all = Object.values(db.users);
    return filters.id ? all.filter((u) => u.id === filters.id) : all;
  }
  if (table === 'user_registration_profiles') {
    const all = Object.values(db.profiles);
    return filters.user_id ? all.filter((p) => p.user_id === filters.user_id) : all;
  }
  if (table === 'verification_sessions') {
    let rows = db.sessions;
    if (filters.user_id) rows = rows.filter((s) => s.user_id === filters.user_id);
    if (filters.id) rows = rows.filter((s) => s.id === filters.id);
    return rows;
  }
  return [];
}

function builder(table) {
  const q = { op: 'select', payload: undefined, filters: {}, single: false };
  const api = {
    select() { return api; },
    insert(payload) { q.op = 'insert'; q.payload = payload; return api; },
    update(payload) { q.op = 'update'; q.payload = payload; return api; },
    eq(k, v) { q.filters[k] = v; return api; },
    order() { return api; },
    limit() { return api; },
    single() { q.single = true; return api; },
    maybeSingle() { q.single = true; return api; },
    then(resolve, reject) {
      try {
        db.calls.push({ table, op: q.op, filters: { ...q.filters } });
        if (q.op === 'insert') {
          if (table === 'trust_audit_events') { db.auditInserts.push(q.payload); return resolve({ data: null, error: null }); }
          if (table === 'user_registration_profiles') {
            const row = { ...q.payload, created_at: q.payload.created_at || '2026-09-03T09:00:00.000Z' };
            db.profiles[row.user_id] = row;
            return resolve({ data: row, error: null });
          }
          return resolve({ data: null, error: null });
        }
        if (q.op === 'update') {
          if (table === 'user_registration_profiles') {
            const existing = db.profiles[q.filters.user_id];
            if (!existing) return resolve({ data: null, error: { message: 'not found' } });
            const row = { ...existing, ...q.payload };
            db.profiles[row.user_id] = row;
            return resolve({ data: row, error: null });
          }
          return resolve({ data: null, error: null });
        }
        const rows = rowsFor(table, q.filters);
        if (q.single) return resolve({ data: rows[0] || null, error: null });
        return resolve({ data: rows, error: null });
      } catch (err) {
        return reject ? reject(err) : Promise.reject(err);
      }
    },
  };
  return api;
}

let server; let port;
before(async () => {
  resetDb();
  supabase.from = (t) => builder(t);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(router);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
});
after(() => { server?.close(); });
beforeEach(() => { resetDb(); });

function call(method, path, { userId, body } = {}) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'content-type': 'application/json',
        ...(userId ? { 'x-user-id': userId } : {}),
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
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

const VALID_PROFILE = {
  account_kind: 'individual',
  market_relationship: 'diaspora',
  country_of_residence: 'Zimbabwe',
  city: 'Leeds',
  intended_use: 'buy_sell',
  terms_acknowledged: true,
  privacy_acknowledged: true,
};

test('routes: unauthenticated requests are refused on all three endpoints', async () => {
  for (const [method, path, body] of [
    ['GET', '/api/registration/journey'],
    ['GET', '/api/registration/profile/candidates'],
    ['PUT', '/api/registration/profile', { profile: VALID_PROFILE }],
  ]) {
    const res = await call(method, path, { body });
    assert.ok(res.status === 401 || res.status === 403, `${method} ${path} → ${res.status}`);
  }
});

test('routes: a fresh account sees safe capabilities now, honest gaps, and the applicant as next actor', async () => {
  const res = await call('GET', '/api/registration/journey', { userId: 'user-a' });
  assert.equal(res.status, 200);
  assert.equal(res.body.journey.steps.account_created, true);
  assert.equal(res.body.journey.steps.context_established, false);
  assert.equal(res.body.journey.steps.identity.state, 'not_started');
  assert.equal(res.body.journey.who_must_act, 'subject_action');
  assert.equal(res.body.journey.capability_ladder[0].reached, true);
  assert.equal(res.body.user.email_verified, true, 'the email-lane flag is displayed as itself');
  assert.equal(res.body.profile, null);
});

test('routes: confirming and correcting candidates persists the profile, derives provenance server-side, and audits it', async () => {
  db.sessions = [{
    id: 'vs-a1', user_id: 'user-a', document_type: 'national_id', status: 'pending_manual_review',
    workflow_phase: 'reviewer_action_required', confidence_score: 0.9,
    ocr_result: { first_name: 'Tinashe', last_name: 'Moyo', country: 'Zimbabwe', national_id_number: 'N/A' },
    created_at: '2026-09-03T08:30:00.000Z', updated_at: '2026-09-03T08:40:00.000Z',
  }];

  const candidates = await call('GET', '/api/registration/profile/candidates', { userId: 'user-a' });
  assert.equal(candidates.status, 200);
  const fields = candidates.body.candidates;
  assert.equal(fields.available, true);
  assert.equal(fields.profile_candidates.country_of_residence.value, 'Zimbabwe');
  assert.deepEqual(fields.document_fields.national_id_number, { state: 'missing' }, 'the marker is not shown as data');
  assert.deepEqual(fields.document_fields.date_of_birth, { state: 'missing' });

  const confirmed = await call('PUT', '/api/registration/profile', {
    userId: 'user-a',
    body: { profile: VALID_PROFILE, candidates_seen: { country_of_residence: 'Zimbabwe' } },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.field_provenance.country_of_residence, 'user_confirmed');
  assert.equal(confirmed.body.field_provenance.city, 'user_provided');
  assert.equal(db.profiles['user-a'].country_of_residence, 'Zimbabwe');

  const corrected = await call('PUT', '/api/registration/profile', {
    userId: 'user-a',
    body: { profile: { ...VALID_PROFILE, country_of_residence: 'United Kingdom' }, candidates_seen: { country_of_residence: 'Zimbabwe' } },
  });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.field_provenance.country_of_residence, 'user_corrected');
  assert.equal(db.profiles['user-a'].country_of_residence, 'United Kingdom');

  const audit = db.auditInserts.at(-1);
  assert.equal(audit.event_type, 'REGISTRATION_PROFILE_UPDATED');
  assert.equal(audit.new_value.field_provenance.country_of_residence, 'user_corrected');
});

test('routes: a fallback marker is refused as profile content', async () => {
  const res = await call('PUT', '/api/registration/profile', {
    userId: 'user-a',
    body: { profile: { ...VALID_PROFILE, city: 'Unknown' } },
  });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /placeholder/i);
  assert.equal(db.profiles['user-a'], undefined, 'nothing was written');
});

test('routes: refresh/relogin resumes — completed steps are still there on the next request', async () => {
  const put = await call('PUT', '/api/registration/profile', { userId: 'user-a', body: { profile: VALID_PROFILE } });
  assert.equal(put.status, 200);

  // A brand-new request (fresh headers — the harness equivalent of relogin/refresh).
  const journey = await call('GET', '/api/registration/journey', { userId: 'user-a' });
  assert.equal(journey.status, 200);
  assert.equal(journey.body.journey.steps.context_established, true);
  assert.equal(journey.body.profile.city, 'Leeds');
  assert.equal(journey.body.journey.who_must_act, 'subject_action', 'identity is still the outstanding subject step');
});

test('routes: the journey is self-scoped — another user sees none of it', async () => {
  db.sessions = [{
    id: 'vs-a1', user_id: 'user-a', document_type: 'national_id', status: 'pending_manual_review',
    ocr_result: { first_name: 'Tinashe', country: 'Zimbabwe' },
  }];
  db.profiles['user-a'] = { user_id: 'user-a', account_kind: 'individual', city: 'Leeds', created_at: 'T' };

  const journeyB = await call('GET', '/api/registration/journey', { userId: 'user-b' });
  assert.equal(journeyB.status, 200);
  assert.equal(journeyB.body.profile, null);
  assert.equal(journeyB.body.identity_session, null);
  assert.equal(journeyB.body.journey.steps.identity.state, 'not_started');

  const candidatesB = await call('GET', '/api/registration/profile/candidates', { userId: 'user-b' });
  assert.equal(candidatesB.body.candidates.available, false, "user B cannot see user A's extracted fields");
});

test('routes: an approved identity is displayed, and reading it writes NOTHING anywhere', async () => {
  db.profiles['user-a'] = {
    user_id: 'user-a', account_kind: 'individual', market_relationship: 'diaspora',
    country_of_residence: 'Zimbabwe', city: 'Leeds', intended_use: 'buy_sell',
    onboarding_status: 'not_required', created_at: '2026-09-03T09:00:00.000Z',
  };
  db.sessions = [{
    id: 'vs-a2', user_id: 'user-a', document_type: 'national_id', status: 'verified',
    workflow_phase: 'resolved_approved', submitted_at: 'T1', updated_at: 'T2',
  }];

  const res = await call('GET', '/api/registration/journey', { userId: 'user-a' });
  assert.equal(res.status, 200);
  assert.equal(res.body.journey.steps.identity.state, 'approved');
  assert.equal(res.body.journey.who_must_act, 'none');

  const lockedBy = Object.fromEntries(res.body.journey.locked_capabilities.map((l) => [l.capability, l.locked_by]));
  assert.equal(lockedBy.sell_vehicle_publicly, 'seller_authority', 'identity approval never grants Seller Authority');
  assert.equal(lockedBy.dealer_tools, 'dealer_compliance', 'identity approval never grants Dealer Compliance');
  assert.equal(lockedBy.vehicle_trust, 'canonical_trust_service', 'identity approval never changes Vehicle Trust');

  const writes = db.calls.filter((c) => c.op !== 'select');
  assert.deepEqual(writes, [], 'the journey read performed zero writes');
});

test('routes: an OCR-failed session leaves manual continuation open', async () => {
  db.sessions = [{
    id: 'vs-a3', user_id: 'user-a', document_type: 'national_id', status: 'ocr_failed',
    workflow_phase: 'reviewer_action_required', failure_reason: 'provider unavailable',
  }];

  const journey = await call('GET', '/api/registration/journey', { userId: 'user-a' });
  assert.equal(journey.body.journey.steps.identity.state, 'in_review', 'a technical failure routes to humans');

  const put = await call('PUT', '/api/registration/profile', { userId: 'user-a', body: { profile: VALID_PROFILE } });
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
