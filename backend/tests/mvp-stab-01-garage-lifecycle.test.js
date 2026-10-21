/**
 * CARUP-MVP-STAB-01 — the garage application lifecycle as the applicant and the reviewer see it
 * (F-019 support, ADM-006, SVC-004).
 *
 * Over real PostgreSQL (PGlite) built only from the repository's own migrations
 * (helpers/gmoGarageWorld.js, plus the registration-profile table 20260829123000 the applicant gate
 * reads), and through the SHIPPED app wherever a person reads the answer:
 *
 *   APPLICANT FEEDBACK  GET /api/garage-onboarding/application carries `latest_decision` ONLY while
 *                       the application waits on the applicant (information_required) or is closed
 *                       (rejected) — the applicant-facing reason, never who decided. Its
 *                       `approval_prerequisites` is the SAME identity check the reviewer's approval
 *                       blocker applies (identityPrerequisite), never a second copy of it.
 *   AUDIT               creating and submitting an application each write ONE trust_audit_events row
 *                       naming the actor and the application — and nothing the applicant typed.
 *   PROFILE SYNC        a reviewer decision moves user_registration_profiles.onboarding_status in step
 *                       (approve → approved, reject → rejected, otherwise in_review); a sync that fails
 *                       is logged and the decision — the authority — stands.
 *   REVIEWER DETAIL     who applied, the decision history without reviewer identity, who must act.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

// Silenced, but kept: the profile-sync failure must be REPORTED, so its test reads what was logged.
const logged = [];
for (const method of ['log', 'info', 'warn', 'debug']) console[method] = () => {};
console.error = (...args) => { logged.push(args.map(String).join(' ')); };

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createGmoDatabase, installOver, seedApprovedIdentity, seedSubmittedApplication } = await import('./helpers/gmoGarageWorld.js');
const { migrationUpSql } = await import('./helpers/pgliteLedgerHarness.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');
const {
  approvalBlockers, identityPrerequisite, recordDecision, whoMustAct, getApplicationForReview,
} = await import('../services/garageOnboarding/garageReviewService.js');
const { getMyApplication, startApplication, submitApplication } = await import('../services/garageOnboarding/garageApplicationService.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
// Distinctive ids, so "this id never appears in the response" cannot pass by accident.
const REVIEWER = 'stab01-reviewer-7f3a';
const REASON_INFO = 'Please add a clearer photo of the sign outside your workshop.';
const REASON_REJECT = 'The premises in the photos are a different business.';
const COMPLETE = {
  trading_name: 'Kambuzuma Brake Centre', address_line: '14 Kambuzuma Road', location_city: 'Harare',
  contact_phone: '+263771234999', contact_email: 'brakes@example.invalid', applicant_relationship: 'owner',
  service_categories: ['brakes'], attestation_accepted: true,
};

let db; let installed; let server; let baseUrl;

before(async () => {
  db = await createGmoDatabase();
  // The applicant gate reads the registration profile; the decision sync writes it. Its own migration.
  await db.exec(migrationUpSql('20260829123000_user_registration_profiles.sql'));
  installed = installOver(supabase, db);
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, 'Rudo Reviewer', 'reviewer@example.invalid', 'admin', '2026-01-01', true)`, [REVIEWER]);
  const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: REVIEWER, activeRole: 'admin', token: `tok-${REVIEWER}`, expiresAt: FUTURE }));
  assert.equal(error, null);
  // A fresh password re-proof on the reviewer's session (X3): what POST /api/auth/step-up records.
  await db.query(`UPDATE user_sessions SET auth_method = 'password', step_up_at = $1, step_up_method = 'password_reauth' WHERE token = $2`,
    [new Date().toISOString(), `tok-${REVIEWER}`]);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  installed?.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { who = null, method = 'GET', body } = {}) {
  const headers = { 'x-bypass-rate-limit': 'true', 'content-type': 'application/json' };
  if (who) headers['x-session-token'] = `tok-${who}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

let people = 0;
/** A person who registered as a garage business: a user, a session, a registration profile. */
async function garageApplicant({ identity = false, onboardingStatus = 'requested' } = {}) {
  people += 1;
  const id = `stab01-garage-${people}`;
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, $2, $3, 'owner', '2026-01-01', true)`,
    [id, `Tendai Garage ${people}`, `${id}@example.invalid`]);
  const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: id, activeRole: 'owner', token: `tok-${id}`, expiresAt: FUTURE }));
  assert.equal(error, null);
  await db.query(
    `INSERT INTO user_registration_profiles (user_id, account_kind, market_relationship, country_of_residence, city, intended_use,
       organization_name, business_type, onboarding_status, terms_acknowledged_at, privacy_acknowledged_at)
     VALUES ($1, 'business', 'zimbabwe_local', 'Zimbabwe', 'Harare', 'professional_services', 'Kambuzuma Brake Centre', 'garage', $2, now(), now())`,
    [id, onboardingStatus]);
  if (identity) await seedApprovedIdentity(db, id);
  return id;
}

async function addEvidence(applicationId, userId) {
  await db.query(
    `INSERT INTO garage_application_documents (application_id, evidence_type, file_ref, mime_type, size_bytes, uploaded_by_user_id)
     VALUES ($1, 'signage_photo', $2, 'image/jpeg', 2048, $3)`,
    [applicationId, `garage-evidence/${applicationId}/sign.jpg`, userId]);
}

/** Start, fill and evidence an application through the shipped applicant routes. */
async function readyApplication(who) {
  const started = await call('/api/garage-onboarding/application', { who, method: 'POST', body: {} });
  assert.equal(started.status, 201, started.text);
  const id = started.body.application.id;
  const saved = await call(`/api/garage-onboarding/application/${id}`, { who, method: 'PATCH', body: COMPLETE });
  assert.equal(saved.status, 200, saved.text);
  await addEvidence(id, who);
  return id;
}

/**
 * A query chain that answers `result` however it is built (`.update().eq()`, `.select().eq().maybeSingle()`
 * …), so a fault injected into one table does not depend on the exact shape of the query against it.
 */
function answering(result) {
  const chain = new Proxy({}, {
    get: (_target, prop) => (prop === 'then' ? (resolve, reject) => Promise.resolve(result).then(resolve, reject) : () => chain),
  });
  return chain;
}

/** The real database, except that one table answers with a fault. */
const faultyOver = (table, fault) => ({
  rpc: (name, args) => installed.client.rpc(name, args),
  from: (name) => (name === table ? fault() : installed.client.from(name)),
});

const decideAsReviewer = (id, body) => call(`/api/admin/garage-applications/${id}/decision`, { who: REVIEWER, method: 'POST', body });
const onboardingStatus = async (userId) => (await db.query('SELECT onboarding_status FROM user_registration_profiles WHERE user_id = $1', [userId])).rows[0]?.onboarding_status;
const auditsFor = async (eventType, applicationId) => (await db.query(
  `SELECT event_type, actor_user_id, actor_role, previous_value, new_value, source_route FROM trust_audit_events
    WHERE event_type = $1 AND new_value->>'application_id' = $2 ORDER BY created_at`, [eventType, applicationId])).rows;

// ── APPLICANT FEEDBACK ───────────────────────────────────────────────────────────────────────────

test('shipped: the applicant reads why CarUp paused or closed their application — only then, and never who decided', async () => {
  const who = await garageApplicant({ identity: true });
  const empty = await call('/api/garage-onboarding/application', { who });
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.body.application, null);
  assert.equal(empty.body.latest_decision, null, 'no application, no decision');
  assert.equal(empty.body.approval_prerequisites, null, 'nothing is waiting on an approval');

  const id = await readyApplication(who);
  assert.equal((await call(`/api/garage-onboarding/application/${id}/submit`, { who, method: 'POST', body: {} })).status, 200);
  let mine = await call('/api/garage-onboarding/application', { who });
  assert.equal(mine.body.application.status, 'submitted');
  assert.equal(mine.body.latest_decision, null, 'a pending application has no decision to show');

  const asked = await decideAsReviewer(id, { decision: 'request_more_info', reason: REASON_INFO, reason_code: 'signage_unreadable' });
  assert.equal(asked.status, 201, asked.text);
  mine = await call('/api/garage-onboarding/application', { who });
  assert.equal(mine.body.application.status, 'information_required');
  assert.deepEqual(Object.keys(mine.body.latest_decision).sort(), ['decided_at', 'decision', 'reason', 'reason_code'],
    'the applicant-facing projection: what was decided and why — no actor, no role');
  assert.equal(mine.body.latest_decision.decision, 'request_more_info');
  assert.equal(mine.body.latest_decision.reason, REASON_INFO);
  assert.equal(mine.body.latest_decision.reason_code, 'signage_unreadable');
  assert.ok(!Number.isNaN(Date.parse(mine.body.latest_decision.decided_at)), 'decided_at is a real time');
  assert.ok(!mine.text.includes(REVIEWER), 'the applicant never learns which reviewer decided');

  // The applicant answers: back to CarUp, and the old question is no longer "the" decision.
  assert.equal((await call(`/api/garage-onboarding/application/${id}/submit`, { who, method: 'POST', body: {} })).status, 200);
  mine = await call('/api/garage-onboarding/application', { who });
  assert.equal(mine.body.application.status, 'submitted');
  assert.equal(mine.body.latest_decision, null, 'once resubmitted, the earlier request is history, not the current state');

  assert.equal((await decideAsReviewer(id, { decision: 'start_review' })).status, 201);
  mine = await call('/api/garage-onboarding/application', { who });
  assert.equal(mine.body.application.status, 'under_review');
  assert.equal(mine.body.latest_decision, null, 'starting a review is not a decision the applicant must act on');

  assert.equal((await decideAsReviewer(id, { decision: 'reject', reason: REASON_REJECT })).status, 201);
  mine = await call('/api/garage-onboarding/application', { who });
  assert.equal(mine.body.application.status, 'rejected');
  assert.equal(mine.body.latest_decision.decision, 'reject');
  assert.equal(mine.body.latest_decision.reason, REASON_REJECT);
  assert.equal('decided_by_user_id' in mine.body.application, false, 'the reviewer\'s id is not part of the applicant\'s view (OC-5C)');
  assert.ok(!mine.text.includes(REVIEWER), 'not in the envelope anywhere');
  assert.equal(mine.body.approval_prerequisites, null, 'a closed application waits on no approval');

  // PO-5: a new application follows the rejected one — the shipped route, the link kept.
  const again = await call('/api/garage-onboarding/application', { who, method: 'POST', body: { supersedes: id } });
  assert.equal(again.status, 201, again.text);
  assert.equal(again.body.application.status, 'draft');
  assert.equal(again.body.application.supersedes_application_id, id);
  mine = await call('/api/garage-onboarding/application', { who });
  assert.equal(mine.body.application.id, again.body.application.id, 'the live draft is now the application');
  assert.equal(mine.body.latest_decision, null);
});

test('service: latest_decision is the decision that produced the CURRENT state, never an earlier one', async () => {
  const who = await garageApplicant({ identity: true });
  const row = await seedSubmittedApplication(db, who, { tradingName: 'Twice Asked Motors' });
  const actor = { id: REVIEWER, role: 'admin' };
  await recordDecision(supabase, actor, row.id, { decision: 'request_more_info', reason: 'First question.' });
  await db.query(`UPDATE garage_applications SET status = 'submitted' WHERE id = $1`, [row.id]);
  await recordDecision(supabase, actor, row.id, { decision: 'request_more_info', reason: 'Second question.' });
  const mine = await getMyApplication(supabase, { id: who, role: 'owner' });
  assert.equal(mine.latest_decision.reason, 'Second question.');
});

// ── THE ONE IDENTITY CHECK ───────────────────────────────────────────────────────────────────────

test('rules: the applicant\'s readiness and the reviewer\'s identity blocker are one function, so they cannot disagree', () => {
  const live = [{ id: 'd1', removed_at: null }];
  const cases = [
    [{ usable_for_identity_gated_actions: true, assurance_level: 'established' }, null, true, null],
    [{ usable_for_identity_gated_actions: false, assurance_level: 'not_established', pending_review: false }, null, false, 'verify_identity'],
    [{ usable_for_identity_gated_actions: false, assurance_level: 'reverification_required', pending_review: false }, null, false, 'verify_identity'],
    [{ usable_for_identity_gated_actions: false, assurance_level: 'pending', pending_review: true }, null, false, 'identity_review_pending'],
    [{ usable_for_identity_gated_actions: false, assurance_level: 'unusable', identity_state: 'compromised', pending_review: true }, null, false, 'identity_on_hold'],
    [null, null, false, 'verify_identity'],
    [null, 'connection reset', null, 'try_again_later'],
  ];
  for (const [identity, identityError, ready, nextStep] of cases) {
    const prerequisite = identityPrerequisite(identity, identityError);
    assert.equal(prerequisite.ready, ready, JSON.stringify(identity));
    assert.equal(prerequisite.next_step, nextStep, JSON.stringify(identity));
    const identityBlocked = approvalBlockers({}, live, identity, identityError).length > 0;
    assert.equal(identityBlocked, ready !== true, `reviewer and applicant disagree for ${JSON.stringify(identity)} / ${identityError}`);
  }
  // A held identity is described to the applicant without its internal state (OC-5C).
  assert.equal(JSON.stringify(identityPrerequisite({ usable_for_identity_gated_actions: false, assurance_level: 'unusable', identity_state: 'compromised' }).next_step).includes('compromised'), false);
});

test('source: the applicant service does not carry its own copy of the identity rule', () => {
  const src = readFileSync(new URL('../services/garageOnboarding/garageApplicationService.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /usable_for_identity_gated_actions/, 'the readiness test must be identityPrerequisite\'s, not a duplicate');
  assert.match(src, /applicantIdentityPrerequisite\(/);
});

test('shipped: approval_prerequisites follows the applicant\'s identity — not verified, in review, verified', async () => {
  const who = await garageApplicant({ identity: false });
  const id = await readyApplication(who);
  let mine = await call('/api/garage-onboarding/application', { who });
  assert.deepEqual(mine.body.approval_prerequisites, { identity_ready: false, identity_next_step: 'verify_identity' },
    'a draft is told early that identity stands between it and approval');

  assert.equal((await call(`/api/garage-onboarding/application/${id}/submit`, { who, method: 'POST', body: {} })).status, 200,
    'identity is not a submission blocker');
  await db.query(`INSERT INTO verification_sessions (user_id, status, document_type, ocr_result) VALUES ($1, 'pending_manual_review', 'national_id', '{}'::jsonb)`, [who]);
  mine = await call('/api/garage-onboarding/application', { who });
  assert.deepEqual(mine.body.approval_prerequisites, { identity_ready: false, identity_next_step: 'identity_review_pending' });
  // The reviewer, reading the same person through the same rule, is blocked from approving.
  const review = await call(`/api/admin/garage-applications/${id}`, { who: REVIEWER });
  assert.equal(review.status, 200, review.text);
  assert.ok(review.body.blocking.some((b) => /identity is not approved/.test(b)));

  await seedApprovedIdentity(db, who);
  mine = await call('/api/garage-onboarding/application', { who });
  assert.deepEqual(mine.body.approval_prerequisites, { identity_ready: true, identity_next_step: null });
  const reviewed = await call(`/api/admin/garage-applications/${id}`, { who: REVIEWER });
  assert.deepEqual(reviewed.body.blocking, [], 'and now neither side sees an identity blocker');
});

test('service: an identity read that FAILS is "could not check", never "not verified"', async () => {
  const who = await garageApplicant({ identity: true });
  await seedSubmittedApplication(db, who, { tradingName: 'Outage Motors' });
  const mine = await getMyApplication(supabase, { id: who, role: 'owner' }, {
    getIdentityAssurance: async () => { throw new Error('connection reset'); },
  });
  assert.deepEqual(mine.approval_prerequisites, { identity_ready: null, identity_next_step: 'try_again_later' });
});

// ── AUDIT ────────────────────────────────────────────────────────────────────────────────────────

test('shipped: creating and submitting are each audited once — the actor and the application, nothing the applicant typed', async () => {
  const who = await garageApplicant({ identity: true });
  const id = await readyApplication(who);
  // A second "start" (a double tap) returns the same draft and is not a second creation.
  const tapAgain = await call('/api/garage-onboarding/application', { who, method: 'POST', body: {} });
  assert.equal(tapAgain.status, 200);
  assert.equal(tapAgain.body.created, false);

  const created = await auditsFor('GARAGE_APPLICATION_CREATED', id);
  assert.equal(created.length, 1, 'one creation, one audit row');
  assert.equal(created[0].actor_user_id, who);
  assert.equal(created[0].actor_role, 'owner');
  assert.deepEqual(created[0].new_value, { application_id: id, status: 'draft', supersedes_application_id: null });

  assert.equal((await call(`/api/garage-onboarding/application/${id}/submit`, { who, method: 'POST', body: {} })).status, 200);
  const submitted = await auditsFor('GARAGE_APPLICATION_SUBMITTED', id);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].actor_user_id, who);
  assert.deepEqual(submitted[0].previous_value, { application_id: id, status: 'draft' });
  assert.deepEqual(submitted[0].new_value, { application_id: id, status: 'submitted', resubmission: false });

  // No PII: none of what the applicant typed travels into the audit trail.
  const { rows } = await db.query(`SELECT row_to_json(t)::text AS j FROM trust_audit_events t WHERE event_type IN ('GARAGE_APPLICATION_CREATED','GARAGE_APPLICATION_SUBMITTED') AND new_value->>'application_id' = $1`, [id]);
  for (const { j } of rows) {
    for (const typed of [COMPLETE.trading_name, COMPLETE.address_line, COMPLETE.contact_phone, COMPLETE.contact_email]) {
      assert.ok(!j.includes(typed), `the audit row carries "${typed}"`);
    }
  }

  // A resubmission after "information required" says so.
  assert.equal((await decideAsReviewer(id, { decision: 'request_more_info', reason: REASON_INFO })).status, 201);
  assert.equal((await call(`/api/garage-onboarding/application/${id}/submit`, { who, method: 'POST', body: {} })).status, 200);
  const both = await auditsFor('GARAGE_APPLICATION_SUBMITTED', id);
  assert.equal(both.length, 2);
  assert.deepEqual(both[1].previous_value, { application_id: id, status: 'information_required' });
  assert.equal(both[1].new_value.resubmission, true);
});

test('service: a refused submission or a foreign application writes no audit row', async () => {
  const who = await garageApplicant();
  const stranger = await garageApplicant();
  const { application } = await startApplication(supabase, { id: who, role: 'owner' });
  await assert.rejects(submitApplication(supabase, { id: who, role: 'owner' }, application.id), /Before you can submit/);
  await assert.rejects(submitApplication(supabase, { id: stranger, role: 'owner' }, application.id), /Application not found/);
  assert.equal((await auditsFor('GARAGE_APPLICATION_SUBMITTED', application.id)).length, 0);
});

test('service: a reapplication is audited with the application it follows', async () => {
  const who = await garageApplicant({ identity: true });
  const old = await seedSubmittedApplication(db, who, { tradingName: 'Second Try Motors' });
  await recordDecision(supabase, { id: REVIEWER, role: 'admin' }, old.id, { decision: 'reject', reason: REASON_REJECT });
  const { application, created } = await startApplication(supabase, { id: who, role: 'owner' }, { supersedes: old.id });
  assert.equal(created, true);
  const rows = await auditsFor('GARAGE_APPLICATION_CREATED', application.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].new_value.supersedes_application_id, old.id);
});

// ── PROFILE SYNC ─────────────────────────────────────────────────────────────────────────────────

test('service: each reviewer decision moves the person-level onboarding status in step', async () => {
  const actor = { id: REVIEWER, role: 'admin' };
  for (const [decisions, expected] of [
    [[['start_review']], 'in_review'],
    [[['request_more_info', 'Need a clearer sign photo.']], 'in_review'],
    [[['reject', REASON_REJECT]], 'rejected'],
    [[['start_review'], ['approve']], 'approved'],
  ]) {
    const who = await garageApplicant({ identity: true, onboardingStatus: 'requested' });
    const row = await seedSubmittedApplication(db, who, { tradingName: `Sync ${expected} Motors` });
    for (const [decision, reason] of decisions) {
      await recordDecision(supabase, actor, row.id, { decision, reason });
    }
    assert.equal(await onboardingStatus(who), expected, `${decisions.map((d) => d[0]).join(' → ')} leaves the profile ${expected}`);
  }
});

test('shipped: the decision route syncs the profile too (approve, through step-up)', async () => {
  const who = await garageApplicant({ identity: true, onboardingStatus: 'in_review' });
  const row = await seedSubmittedApplication(db, who, { tradingName: 'Route Sync Motors' });
  const approved = await decideAsReviewer(row.id, { decision: 'approve' });
  assert.equal(approved.status, 201, approved.text);
  assert.equal(await onboardingStatus(who), 'approved');
});

test('service: a profile sync that fails is logged, and the decision — the authority — stands', async () => {
  const actor = { id: REVIEWER, role: 'admin' };
  const failing = {
    'an error result': () => answering({ data: null, error: { message: 'profiles unavailable' } }),
    'a thrown error': () => { throw new Error('profiles exploded'); },
  };
  for (const [label, fault] of Object.entries(failing)) {
    const who = await garageApplicant({ identity: true, onboardingStatus: 'in_review' });
    const row = await seedSubmittedApplication(db, who, { tradingName: `Unsynced Motors ${label}` });
    const client = faultyOver('user_registration_profiles', fault);
    const before = logged.length;
    const result = await recordDecision(client, actor, row.id, { decision: 'reject', reason: REASON_REJECT });
    assert.equal(result.application.status, 'rejected', `${label}: the decision is returned as made`);
    const { rows: [stored] } = await db.query('SELECT status FROM garage_applications WHERE id = $1', [row.id]);
    assert.equal(stored.status, 'rejected', `${label}: the decision is committed`);
    const { rows: ledger } = await db.query('SELECT decision FROM garage_application_decisions WHERE application_id = $1', [row.id]);
    assert.deepEqual(ledger.map((r) => r.decision), ['reject'], `${label}: the ledger is intact`);
    assert.equal((await auditsFor('GARAGE_APPLICATION_DECISION', row.id)).length, 1, `${label}: the decision is audited`);
    assert.equal(await onboardingStatus(who), 'in_review', `${label}: the profile did not move`);
    assert.ok(logged.slice(before).some((line) => /onboarding_status/.test(line) && line.includes(row.id)),
      `${label}: the failed sync is reported, naming the application`);
  }
});

// ── REVIEWER DETAIL ──────────────────────────────────────────────────────────────────────────────

test('rules: who must act next, for every state a reviewer can see', () => {
  assert.equal(whoMustAct({ status: 'submitted' }), 'carup_review');
  assert.equal(whoMustAct({ status: 'under_review' }), 'carup_review');
  assert.equal(whoMustAct({ status: 'information_required' }), 'applicant');
  assert.equal(whoMustAct({ status: 'rejected' }), 'none');
  assert.equal(whoMustAct({ status: 'approved', activated_tenant_id: 't-1' }), 'none');
  // Approved but the workspace was not built: CarUp still owes the retry (GMO-4) — not "nobody".
  assert.equal(whoMustAct({ status: 'approved', activated_tenant_id: null }), 'carup_review');
});

test('shipped: the reviewer sees who applied, the history without reviewer identity, and who must act', async () => {
  const who = await garageApplicant({ identity: true });
  const row = await seedSubmittedApplication(db, who, { tradingName: 'Detail Motors' });
  let view = await call(`/api/admin/garage-applications/${row.id}`, { who: REVIEWER });
  assert.equal(view.status, 200, view.text);
  const { rows: [person] } = await db.query('SELECT name, email FROM users WHERE id = $1', [who]);
  assert.deepEqual(view.body.applicant, { user_id: who, name: person.name, email: person.email });
  assert.equal(view.body.who_must_act, 'carup_review');
  assert.deepEqual(view.body.decisions, []);

  assert.equal((await decideAsReviewer(row.id, { decision: 'request_more_info', reason: REASON_INFO, reason_code: 'signage_unreadable' })).status, 201);
  view = await call(`/api/admin/garage-applications/${row.id}`, { who: REVIEWER });
  assert.equal(view.body.who_must_act, 'applicant');
  assert.equal(view.body.decisions.length, 1);
  assert.deepEqual(Object.keys(view.body.decisions[0]).sort(), ['actor_role', 'created_at', 'decision', 'id', 'reason', 'reason_code']);
  assert.deepEqual(
    [view.body.decisions[0].decision, view.body.decisions[0].reason, view.body.decisions[0].reason_code, view.body.decisions[0].actor_role],
    ['request_more_info', REASON_INFO, 'signage_unreadable', 'admin'],
  );
  assert.ok(!JSON.stringify(view.body.decisions).includes(REVIEWER), 'the history names a role, never the reviewer');

  await db.query(`UPDATE garage_applications SET status = 'submitted' WHERE id = $1`, [row.id]);
  assert.equal((await decideAsReviewer(row.id, { decision: 'reject', reason: REASON_REJECT })).status, 201);
  view = await call(`/api/admin/garage-applications/${row.id}`, { who: REVIEWER });
  assert.equal(view.body.who_must_act, 'none');
  assert.deepEqual(view.body.decisions.map((d) => d.decision), ['reject', 'request_more_info'], 'newest first, every decision kept');
});

test('service: an applicant summary that cannot be read fails the read — it is never shown as "nobody"', async () => {
  const who = await garageApplicant({ identity: true });
  const row = await seedSubmittedApplication(db, who, { tradingName: 'Unreadable Applicant Motors' });
  const client = faultyOver('users', () => answering({ data: null, error: { message: 'users unavailable' } }));
  await assert.rejects(getApplicationForReview(client, row.id), /Could not load the applicant/);
});
