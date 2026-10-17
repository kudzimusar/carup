/**
 * OC-5E GMO-3 — a CarUp reviewer decides a garage application (ported from PR #209 6425e905).
 *
 * The reviewer decides; the reviewer does not build. Approving records a judgment and creates
 * nothing — no tenant, no membership, no authority (GMO-4 builds). Proven on three levels:
 *
 *   RULES     the capability catalogue (platform administration only — OC-5E owner decision), the
 *             decisions each state accepts, and what blocks an approval;
 *   DATABASE  `record_garage_application_decision` on real PostgreSQL (PGlite, built from the
 *             repository's own migrations): one transaction — a refused or losing decision leaves NO
 *             ledger row (#209 wrote the row first and left one for a decision that never applied);
 *             only service_role may execute it; Up re-runs and Down/Up round-trip;
 *   SHIPPED   the real app over that database: a real session, the capability, X3 step-up on every
 *             consequential route, and a reviewer never sees an application the applicant has not
 *             submitted (#209 listed and opened drafts).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

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
  allowedDecisions, approvalBlockers, REVIEW_DECISIONS, REVIEW_VISIBLE, recordDecision,
} = await import('../services/garageOnboarding/garageReviewService.js');
const {
  OPERATIONS_CAPABILITIES, hasOperationsCapability, capabilitiesForContext,
} = await import('../services/operations/operationsAuthorizationService.js');

const MIGRATION = '20261004190000_gmo3_garage_application_decision.sql';
const FN = 'public.record_garage_application_decision(uuid,text,text,text,text,text)';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const REVIEW = OPERATIONS_CAPABILITIES.GARAGE_ONBOARDING_REVIEW;

const USERS = {
  applicant: ['gmo3-applicant', 'owner'],
  applicant2: ['gmo3-applicant-2', 'owner'],
  noIdentity: ['gmo3-unverified', 'owner'],
  admin: ['gmo3-admin', 'admin'],
  adminNoStepUp: ['gmo3-admin-2', 'admin'],
  government: ['gmo3-gov', 'government'],
  owner: ['gmo3-owner', 'owner'],
  selfReviewer: ['gmo3-self', 'admin'],
  selfReviewer2: ['gmo3-self-2', 'admin'],
};

let db; let installed; let server; let baseUrl;

before(async () => {
  db = await createGmoDatabase();
  installed = installOver(supabase, db);
  for (const [who, [id, role]] of Object.entries(USERS)) {
    await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, $2, $3, $4, '2026-01-01', true)`,
      [id, who, `${id}@example.invalid`, role]);
    const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: id, activeRole: role, token: `gmo3-${who}`, expiresAt: FUTURE }));
    assert.equal(error, null, `session for ${who}`);
  }
  // A fresh password re-proof on these sessions (X3): what POST /api/auth/step-up records.
  for (const who of ['admin', 'government', 'owner', 'selfReviewer', 'selfReviewer2']) {
    await db.query(`UPDATE user_sessions SET auth_method = 'password', step_up_at = $1, step_up_method = 'password_reauth' WHERE token = $2`,
      [new Date().toISOString(), `gmo3-${who}`]);
  }
  for (const who of ['applicant', 'applicant2', 'selfReviewer', 'selfReviewer2']) await seedApprovedIdentity(db, USERS[who][0]);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  installed?.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { who = null, method = 'GET', body, headers = {} } = {}) {
  const h = { 'x-bypass-rate-limit': 'true', 'content-type': 'application/json', ...headers };
  if (who) h['x-session-token'] = `gmo3-${who}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

let applicants = 0;
/** A fresh applicant (the schema allows one live application per person), optionally identity-approved. */
async function newApplicant({ identity = true } = {}) {
  applicants += 1;
  const id = `gmo3-fresh-${applicants}`;
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, $1, $2, 'owner', '2026-01-01', true)`, [id, `${id}@example.invalid`]);
  if (identity) await seedApprovedIdentity(db, id);
  return id;
}
const application = async (opts = {}, { identity = true } = {}) => seedSubmittedApplication(db, await newApplicant({ identity }), opts);

const ledgerRows = async (applicationId) => (await db.query('SELECT decision, actor_user_id FROM garage_application_decisions WHERE application_id = $1 ORDER BY created_at', [applicationId])).rows;
const decide = (applicationId, decision, actor, reason = null) => db.query(
  'SELECT public.record_garage_application_decision($1, $2, $3, $4, NULL, $5) AS out',
  [applicationId, decision, actor, 'admin', reason],
);
const refusal = async (promise) => { try { await promise; return null; } catch (error) { return error.message; } };
const tenantCount = async () => Number((await db.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n);
const membershipCount = async () => Number((await db.query('SELECT count(*)::int AS n FROM tenant_users')).rows[0].n);

// ── RULES ────────────────────────────────────────────────────────────────────────────────────────

test('rules: the review capability is in the catalogue — and only platform administration holds it', () => {
  assert.equal(REVIEW, 'operations.garage_onboarding.review');
  for (const role of ['admin', 'platform_admin', 'super_admin']) {
    assert.ok(capabilitiesForContext({ platformRole: role }).includes(REVIEW), `${role} reviews garage applications`);
  }
  // OC-5E owner decision (fail closed): #209 put this in the shared people set, so government
  // gained — implicitly — the power to create business workspaces.
  assert.equal(hasOperationsCapability({ platformRole: 'government' }, REVIEW), false);
  for (const role of ['owner', 'mechanic', 'dealer', 'insurance', 'bank', 'reviewer']) {
    assert.equal(hasOperationsCapability({ platformRole: role }, REVIEW), false, `${role} must not review garage applications`);
  }
});

test('rules: a tenant role never confers review — a garage admin is not a CarUp reviewer', () => {
  assert.equal(hasOperationsCapability({ platformRole: 'owner', role: 'admin' }, REVIEW), false);
  assert.equal(hasOperationsCapability({ role: 'admin' }, REVIEW), false);
  assert.equal(hasOperationsCapability({ platformRole: 'owner', activeTenant: { type: 'garage', role: 'admin' } }, REVIEW), false);
});

test('rules: the decisions each state accepts — nothing for a draft, a waiting or a decided application', () => {
  assert.deepEqual(allowedDecisions('submitted'), ['start_review', 'request_more_info', 'approve', 'reject']);
  assert.deepEqual(allowedDecisions('under_review'), ['request_more_info', 'approve', 'reject']);
  for (const status of ['draft', 'information_required', 'approved', 'rejected', 'anything']) {
    assert.deepEqual(allowedDecisions(status), [], status);
  }
  assert.deepEqual(REVIEW_DECISIONS, ['start_review', 'request_more_info', 'approve', 'reject']);
  assert.ok(!REVIEW_VISIBLE.includes('draft'), 'a draft is never visible to a reviewer');
});

test('rules: approval blockers — an unreadable identity is not a finding, and removed evidence does not count', () => {
  const live = [{ id: 'd1', removed_at: null }];
  assert.deepEqual(approvalBlockers({}, live, { usable_for_identity_gated_actions: true }, null), []);
  const outage = approvalBlockers({}, live, null, 'connection reset');
  assert.equal(outage.length, 1);
  assert.match(outage[0], /could not be read/);
  assert.doesNotMatch(outage[0], /not approved/, 'an outage must never read as a refusal of the person');
  assert.match(approvalBlockers({}, live, null, null)[0], /No identity record/);
  assert.match(approvalBlockers({}, live, { usable_for_identity_gated_actions: false, identity_state: 'suspended' }, null)[0], /not approved \(suspended\)/);
  assert.match(approvalBlockers({}, [{ id: 'd1', removed_at: '2026-10-01' }], { usable_for_identity_gated_actions: true }, null)[0], /No business-presence evidence/);
});

// ── DATABASE: the decision function itself ────────────────────────────────────────────────────────

test('database: each decision moves the application; only a terminal one records who decided and why', async () => {
  const appRow = await application({ tradingName: 'DB Flow Motors' });
  const started = (await decide(appRow.id, 'start_review', USERS.admin[0])).rows[0].out;
  assert.equal(started.from_status, 'submitted');
  assert.equal(started.application.status, 'under_review');
  assert.equal(started.application.decided_at, null, 'starting a review decides nothing');
  const rejected = (await decide(appRow.id, 'reject', USERS.admin[0], 'The premises photo shows a different business.')).rows[0].out;
  assert.equal(rejected.application.status, 'rejected');
  assert.equal(rejected.application.decided_by_user_id, USERS.admin[0]);
  assert.equal(rejected.application.decision_reason, 'The premises photo shows a different business.');
  assert.deepEqual((await ledgerRows(appRow.id)).map((r) => r.decision), ['start_review', 'reject']);
});

test('database: a decision the state no longer accepts is refused AND leaves no ledger row (#209\'s orphan)', async () => {
  const appRow = await application({ tradingName: 'Race Motors' });
  await decide(appRow.id, 'approve', USERS.admin[0]);
  // The second reviewer read "submitted" a moment ago. #209 wrote their ledger row and then lost the
  // guarded update; the ledger said "rejected" about an approved application.
  const message = await refusal(decide(appRow.id, 'reject', USERS.government[0], 'Too late'));
  assert.match(message, /GARAGE_DECISION_CONFLICT:approved/);
  assert.deepEqual((await ledgerRows(appRow.id)).map((r) => r.decision), ['approve'], 'the losing decision left nothing');
  const { rows: [row] } = await db.query('SELECT status, decided_by_user_id FROM garage_applications WHERE id = $1', [appRow.id]);
  assert.deepEqual(row, { status: 'approved', decided_by_user_id: USERS.admin[0] });
});

test('database: self-decision, a missing reason, an unknown verb, no actor, a waiting or draft application — all refused, none recorded', async () => {
  const appRow = await seedSubmittedApplication(db, USERS.selfReviewer[0], { tradingName: 'Self Motors' });
  assert.match(await refusal(decide(appRow.id, 'approve', USERS.selfReviewer[0])), /GARAGE_DECISION_SELF/);
  assert.match(await refusal(decide(appRow.id, 'reject', USERS.admin[0], '   ')), /GARAGE_DECISION_REASON_REQUIRED/);
  assert.match(await refusal(decide(appRow.id, 'request_more_info', USERS.admin[0], null)), /GARAGE_DECISION_REASON_REQUIRED/);
  assert.match(await refusal(decide(appRow.id, 'activate', USERS.admin[0])), /GARAGE_DECISION_UNKNOWN/);
  assert.match(await refusal(decide(appRow.id, 'approve', '  ')), /GARAGE_DECISION_ACTOR_REQUIRED/);
  assert.match(await refusal(decide('00000000-0000-4000-8000-000000000000', 'approve', USERS.admin[0])), /GARAGE_APPLICATION_NOT_FOUND/);
  assert.deepEqual(await ledgerRows(appRow.id), []);

  const waiting = await application({ tradingName: 'Waiting Motors' });
  await decide(waiting.id, 'request_more_info', USERS.admin[0], 'A clearer photo of the signage, please.');
  assert.match(await refusal(decide(waiting.id, 'approve', USERS.admin[0])), /GARAGE_DECISION_CONFLICT:information_required/);
  assert.equal((await ledgerRows(waiting.id)).length, 1);

  const draft = await application({ tradingName: 'Draft Motors', status: 'draft' });
  assert.match(await refusal(decide(draft.id, 'start_review', USERS.admin[0])), /GARAGE_DECISION_CONFLICT:draft/);
  assert.deepEqual(await ledgerRows(draft.id), []);
});

test('database: approving creates no tenant and no membership', async () => {
  const tenants = await tenantCount();
  const memberships = await membershipCount();
  const appRow = await application({ tradingName: 'Judgment Only Motors' });
  await decide(appRow.id, 'approve', USERS.admin[0]);
  assert.equal(await tenantCount(), tenants);
  assert.equal(await membershipCount(), memberships);
});

test('database: only the backend may execute it; it runs as its caller with a pinned search_path', async () => {
  const { rows: [p] } = await db.query(
    `SELECT has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon,
            has_function_privilege('authenticated', '${FN}', 'EXECUTE') AS authenticated,
            has_function_privilege('service_role', '${FN}', 'EXECUTE') AS service_role`);
  assert.deepEqual(p, { anon: false, authenticated: false, service_role: true });
  const { rows: [f] } = await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = '${FN}'::regprocedure`);
  assert.equal(f.prosecdef, false, 'SECURITY INVOKER: no privilege beyond the caller\'s');
  assert.ok((f.proconfig || []).some((c) => /^search_path=public, pg_temp$/.test(c)), String(f.proconfig));
});

test('database: Up re-applies cleanly, and Down then Up round-trips', async () => {
  const sql = readFileSync(new URL(`../../database/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.ok(sql.includes('-- +migrate Up') && sql.includes('-- +migrate Down'));
  await db.exec(migrationUpSql(MIGRATION));
  await db.exec(sql.split('-- +migrate Down')[1]);
  const { rows: gone } = await db.query(`SELECT 1 FROM pg_proc WHERE proname = 'record_garage_application_decision'`);
  assert.equal(gone.length, 0);
  await db.exec(migrationUpSql(MIGRATION));
  const { rows: [p] } = await db.query(`SELECT has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon`);
  assert.equal(p.anon, false, 'the grants come back with the function');
});

// ── SERVICE over the real database ───────────────────────────────────────────────────────────────

test('service: approval is refused while the applicant has no approved identity, and while no live evidence exists', async () => {
  const actor = { id: USERS.admin[0], role: 'admin' };
  const unverified = await application({ tradingName: 'Unverified Motors' }, { identity: false });
  await assert.rejects(recordDecision(supabase, actor, unverified.id, { decision: 'approve' }), /identity is not approved/);
  assert.deepEqual(await ledgerRows(unverified.id), []);

  const noEvidence = await application({ tradingName: 'Empty Motors', evidence: false });
  await assert.rejects(recordDecision(supabase, actor, noEvidence.id, { decision: 'approve' }), /No business-presence evidence/);

  // An identity read that FAILS is a system problem, never a refusal recorded against the person.
  await assert.rejects(
    recordDecision(supabase, actor, noEvidence.id, { decision: 'approve' }, { getIdentityAssurance: async () => { throw new Error('connection reset'); } }),
    /could not be read just now/,
  );
});

// ── SHIPPED: the real app over the real database ─────────────────────────────────────────────────

test('shipped: who may open the queue — a real session with the capability, nobody else', async () => {
  assert.equal((await call('/api/admin/garage-applications')).status, 401);
  assert.equal((await call('/api/admin/garage-applications', { who: 'owner' })).status, 403);
  const gov = await call('/api/admin/garage-applications', { who: 'government' });
  assert.equal(gov.status, 403, 'government: the capability is platform administration only (OC-5E)');
  assert.equal(gov.body.code, 'OPERATIONS_CAPABILITY_REQUIRED');
  // The x-user-id fallback is never a reviewer.
  const fallback = await call('/api/admin/garage-applications', { headers: { 'x-user-id': USERS.admin[0], 'x-stakeholder-role': 'admin' } });
  assert.ok([401, 403].includes(fallback.status), `fallback identity got ${fallback.status}`);
  const ok = await call('/api/admin/garage-applications', { who: 'admin' });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(Array.isArray(ok.body.applications));
});

test('shipped: a reviewer never sees an application the applicant has not submitted', async () => {
  const draft = await application({ tradingName: 'Unsent Motors', status: 'draft' });
  const listed = await call('/api/admin/garage-applications?status=draft', { who: 'admin' });
  assert.equal(listed.status, 400, 'asking for drafts is refused, not answered with an empty list');
  const queue = await call('/api/admin/garage-applications?status=submitted,under_review,information_required,approved,rejected', { who: 'admin' });
  assert.equal(queue.status, 200);
  assert.ok(!queue.body.applications.some((a) => a.id === draft.id));
  assert.equal((await call(`/api/admin/garage-applications/${draft.id}`, { who: 'admin' })).status, 404);
  const docs = await db.query('SELECT id FROM garage_application_documents WHERE application_id = $1', [draft.id]);
  const preview = await call(`/api/admin/garage-applications/${draft.id}/evidence/${docs.rows[0].id}/preview`, { who: 'admin' });
  assert.equal(preview.status, 404, 'a draft\'s evidence is the applicant\'s own');
});

test('shipped: deciding needs a fresh step-up; the decision lands once, with the reviewer named', async () => {
  const appRow = await application({ tradingName: 'Shipped Motors' });
  const stale = await call(`/api/admin/garage-applications/${appRow.id}/decision`, { who: 'adminNoStepUp', method: 'POST', body: { decision: 'start_review' } });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'STEP_UP_REQUIRED');
  assert.deepEqual(await ledgerRows(appRow.id), []);

  const view = await call(`/api/admin/garage-applications/${appRow.id}`, { who: 'admin' });
  assert.equal(view.status, 200, view.text);
  assert.deepEqual(view.body.allowed_decisions, ['start_review', 'request_more_info', 'approve', 'reject']);
  assert.deepEqual(view.body.blocking, []);
  assert.equal(view.body.identity.usable_for_identity_gated_actions, true);
  assert.ok(view.body.documents.every((d) => !('file_ref' in d)), 'the storage path never reaches the browser');

  const approved = await call(`/api/admin/garage-applications/${appRow.id}/decision`, { who: 'admin', method: 'POST', body: { decision: 'approve' } });
  assert.equal(approved.status, 201, approved.text);
  assert.equal(approved.body.application.status, 'approved');
  assert.equal(approved.body.decision.actor_user_id, USERS.admin[0]);
  const again = await call(`/api/admin/garage-applications/${appRow.id}/decision`, { who: 'admin', method: 'POST', body: { decision: 'reject', reason: 'Second thoughts' } });
  assert.equal(again.status, 409);
  assert.deepEqual((await ledgerRows(appRow.id)).map((r) => r.decision), ['approve']);
  // The audit names its subject: which application, from which status, which ledger row.
  const { rows: audits } = await db.query(
    `SELECT previous_value, new_value, actor_user_id FROM trust_audit_events
      WHERE event_type = 'GARAGE_APPLICATION_DECISION' AND new_value->>'application_id' = $1`, [appRow.id]);
  assert.equal(audits.length, 1, 'the decision is audited once, against THIS application');
  assert.equal(audits[0].previous_value.status, 'submitted');
  assert.equal(audits[0].new_value.status, 'approved');
  assert.equal(audits[0].new_value.decision_id, approved.body.decision.id);
  assert.equal(audits[0].actor_user_id, USERS.admin[0]);
});

test('shipped: a reviewer cannot decide their own application', async () => {
  const own = await seedSubmittedApplication(db, USERS.selfReviewer2[0], { tradingName: 'Own Motors' });
  const res = await call(`/api/admin/garage-applications/${own.id}/decision`, { who: 'selfReviewer2', method: 'POST', body: { decision: 'approve' } });
  assert.equal(res.status, 403);
  assert.deepEqual(await ledgerRows(own.id), []);
});

test('shipped: a private document preview needs a step-up, is audited, and is never cached', async () => {
  const appRow = await application({ tradingName: 'Preview Motors' });
  const { rows: [doc] } = await db.query('SELECT id FROM garage_application_documents WHERE application_id = $1', [appRow.id]);
  const stale = await call(`/api/admin/garage-applications/${appRow.id}/evidence/${doc.id}/preview`, { who: 'adminNoStepUp' });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'STEP_UP_REQUIRED');
  const { rows: before } = await db.query(`SELECT count(*)::int AS n FROM trust_audit_events WHERE event_type = 'GARAGE_EVIDENCE_PREVIEWED_BY_REVIEWER'`);
  assert.equal(before[0].n, 0, 'a refused preview is not audited as a preview');
});

test('shipped: with a fresh step-up the preview is a short-lived link, audited before it is handed over', async () => {
  const { garageEvidenceStorage } = await import('../services/garageOnboarding/garageEvidenceService.js');
  const saved = garageEvidenceStorage.generateSecureReadUrl;
  const signed = [];
  garageEvidenceStorage.generateSecureReadUrl = async (bucket, ref, ttl) => {
    signed.push({ bucket, ref, ttl });
    return 'https://storage.example.invalid/signed?token=short-lived';
  };
  try {
    const appRow = await application({ tradingName: 'Signed Motors' });
    const { rows: [doc] } = await db.query('SELECT id, file_ref FROM garage_application_documents WHERE application_id = $1', [appRow.id]);
    const res = await fetch(`${baseUrl}/api/admin/garage-applications/${appRow.id}/evidence/${doc.id}/preview`, {
      headers: { 'x-session-token': 'gmo3-admin', 'x-bypass-rate-limit': 'true' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.url, 'https://storage.example.invalid/signed?token=short-lived');
    assert.equal(body.expiresInSeconds, 180);
    assert.deepEqual(signed, [{ bucket: 'ocr-documents', ref: doc.file_ref, ttl: 180 }]);
    const { rows: audits } = await db.query(
      `SELECT new_value FROM trust_audit_events WHERE event_type = 'GARAGE_EVIDENCE_PREVIEWED_BY_REVIEWER'`);
    assert.deepEqual(audits.map((a) => [a.new_value.application_id, a.new_value.document_id]), [[appRow.id, doc.id]],
      'exactly this preview, audited against its document');
    // A document of ANOTHER application cannot be reached through this one.
    const other = await application({ tradingName: 'Other Motors' });
    const cross = await call(`/api/admin/garage-applications/${other.id}/evidence/${doc.id}/preview`, { who: 'admin' });
    assert.equal(cross.status, 404);
  } finally {
    garageEvidenceStorage.generateSecureReadUrl = saved;
  }
});

test('source: the review service never writes the decision ledger or the application status itself', () => {
  // The transition is ONE transaction only while nothing else writes these rows. A direct insert or
  // update here would bring back #209's shape: a ledger row for a decision the guarded update lost.
  const src = readFileSync(new URL('../services/garageOnboarding/garageReviewService.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /from\(\s*'garage_application_decisions'\s*\)\s*\.\s*(insert|update|upsert|delete)/);
  assert.doesNotMatch(src, /from\(\s*'garage_applications'\s*\)\s*\.\s*(insert|update|upsert|delete)/);
  assert.match(src, /rpc\(\s*'record_garage_application_decision'/);
});
