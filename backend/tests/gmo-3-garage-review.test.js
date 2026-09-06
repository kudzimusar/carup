/**
 * GMO-3 — review and decision.
 *
 * The reviewer decides; the reviewer does not build. Approving records a judgment and creates
 * nothing — no tenant, no membership, no authority. That separation is what makes GMO-4's
 * activation idempotent and independently provable, and it is asserted structurally below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  listApplicationsForReview, getApplicationForReview, recordDecision,
  allowedDecisions, approvalBlockers, REVIEW_DECISIONS,
} = await import('../services/garageOnboarding/garageReviewService.js');
const {
  OPERATIONS_CAPABILITIES, hasOperationsCapability, capabilitiesForContext,
} = await import('../services/operations/operationsAuthorizationService.js');

const APPLICANT = 'u_applicant';
const REVIEWER = 'u_reviewer';
const APP = 'app-1';

const SUBMITTED = {
  id: APP, applicant_user_id: APPLICANT, status: 'submitted', trading_name: 'Mbare Motors',
  submitted_at: '2026-09-06T10:00:00Z', decided_at: null,
};
const GOOD_IDENTITY = {
  subject_user_id: APPLICANT, identity_state: 'approved',
  usable_for_identity_gated_actions: true,
};
const LIVE_DOC = { id: 'doc-1', evidence_type: 'signage_photo', removed_at: null };

const reviewer = { id: REVIEWER, role: 'admin' };

function client(tables, log = []) {
  const withDefaults = { audit_logs: () => ({ data: { id: 'a1' }, error: null }), ...tables };
  const from = (table) => {
    const filters = {}; let payload = null; let op = 'select';
    const result = () => {
      log.push({ table, op, filters: { ...filters }, payload });
      const entry = withDefaults[table];
      return typeof entry === 'function' ? entry(filters, { op, payload }) : { data: entry ?? null, error: null };
    };
    const chain = {
      select() { return chain; },
      insert(p) { op = 'insert'; payload = p; return chain; },
      update(p) { op = 'update'; payload = p; return chain; },
      eq(k, v) { filters[k] = v; return chain; },
      is(k, v) { filters[`is:${k}`] = v; return chain; },
      in(k, v) { filters[`in:${k}`] = v; return chain; },
      order() { return chain; }, limit() { return chain; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return chain;
  };
  return { from };
}

/** A client where the application row moves as decisions are applied. */
function decidingClient(initial, log = []) {
  let row = { ...initial };
  return client({
    garage_applications: (_f, { op, payload }) => {
      if (op === 'update') { row = { ...row, ...payload }; return { data: row, error: null }; }
      return { data: row, error: null };
    },
    garage_application_decisions: (_f, { op, payload }) => ({
      data: op === 'insert' ? { id: 'dec-1', ...payload } : [], error: null,
    }),
    garage_application_documents: [LIVE_DOC],
  }, log);
}

const goodIdentity = async () => GOOD_IDENTITY;

// ── PO-3: who may review ─────────────────────────────────────────────────────────────────────────

test('GMO-3: the review capability is part of the canonical Operations catalogue', () => {
  assert.equal(OPERATIONS_CAPABILITIES.GARAGE_ONBOARDING_REVIEW, 'operations.garage_onboarding.review');
  assert.ok(capabilitiesForContext({ platformRole: 'admin' }).includes(OPERATIONS_CAPABILITIES.GARAGE_ONBOARDING_REVIEW));
});

test('GMO-3 ACCESS UAT: an ordinary owner has no review capability', () => {
  for (const role of ['owner', 'mechanic', 'dealer', 'buyer', 'seller']) {
    assert.equal(
      hasOperationsCapability({ platformRole: role }, OPERATIONS_CAPABILITIES.GARAGE_ONBOARDING_REVIEW),
      false, `${role} must not be able to review garage applications`,
    );
  }
});

test('GMO-3: a tenant role can never confer review capability', () => {
  // The capability is derived from the SERVER-side platform role. A garage admin — which is what
  // GMO-4 creates — is admin inside one tenant, and that must not make them a CarUp reviewer.
  assert.equal(hasOperationsCapability({ platformRole: 'owner', role: 'admin' }, OPERATIONS_CAPABILITIES.GARAGE_ONBOARDING_REVIEW), false);
  assert.equal(hasOperationsCapability({ role: 'admin' }, OPERATIONS_CAPABILITIES.GARAGE_ONBOARDING_REVIEW), false);
});

test('GMO-3: the reviewer routes compose role, capability and step-up', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../routes/garageReviewRoutes.js'), 'utf8');
  assert.match(src, /authorizeRole\(ADMIN_ROLES\)/);
  assert.match(src, /requireOperationsCapability\(OPERATIONS_CAPABILITIES\.GARAGE_ONBOARDING_REVIEW\)/);
  // Deciding and viewing private evidence are both sensitive.
  const stepUps = src.match(/requireAuthenticationAssurance\(ACTION_CLASSES\.SENSITIVE\)/g) || [];
  assert.equal(stepUps.length, 2, 'the decision route and the evidence preview both need step-up');
});

test('GMO-3: a reviewer cannot decide their own application', async () => {
  const c = decidingClient({ ...SUBMITTED, applicant_user_id: REVIEWER });
  await assert.rejects(
    () => recordDecision(c, reviewer, APP, { decision: 'approve' }, { getIdentityAssurance: goodIdentity }),
    /cannot decide your own garage application/,
  );
});

// ── the six states, and what each permits ────────────────────────────────────────────────────────

test('GMO-3: allowed decisions follow the status, and the UI is told which', () => {
  assert.deepEqual(allowedDecisions('submitted'), ['start_review', 'request_more_info', 'approve', 'reject']);
  assert.deepEqual(allowedDecisions('under_review'), ['request_more_info', 'approve', 'reject']);
  // Waiting on the applicant is not the reviewer's to move.
  assert.deepEqual(allowedDecisions('information_required'), []);
  assert.deepEqual(allowedDecisions('approved'), []);
  assert.deepEqual(allowedDecisions('rejected'), []);
});

test('GMO-3: a decided application cannot be decided again', async () => {
  for (const status of ['approved', 'rejected']) {
    const c = decidingClient({ ...SUBMITTED, status });
    await assert.rejects(
      () => recordDecision(c, reviewer, APP, { decision: 'approve' }, { getIdentityAssurance: goodIdentity }),
      /cannot be/,
    );
  }
});

test('GMO-3 (PO-5): a rejected application is never rewritten back into review', async () => {
  const c = decidingClient({ ...SUBMITTED, status: 'rejected', decided_at: 'yesterday' });
  await assert.rejects(
    () => recordDecision(c, reviewer, APP, { decision: 'start_review' }),
    /cannot be/,
  );
});

test('GMO-3: an application waiting on the applicant says so, in the reviewer\'s words', async () => {
  const c = decidingClient({ ...SUBMITTED, status: 'information_required' });
  await assert.rejects(
    () => recordDecision(c, reviewer, APP, { decision: 'approve' }, { getIdentityAssurance: goodIdentity }),
    /waiting on the applicant/,
  );
});

test('GMO-3: pausing or closing an application must carry a reason', async () => {
  for (const decision of ['request_more_info', 'reject']) {
    const c = decidingClient(SUBMITTED);
    await assert.rejects(
      () => recordDecision(c, reviewer, APP, { decision }),
      /must carry a reason/,
      `${decision} without a reason must be refused`,
    );
  }
});

test('GMO-3: start_review moves to under_review and is NOT terminal', async () => {
  const log = [];
  const c = decidingClient(SUBMITTED, log);
  const { application } = await recordDecision(c, reviewer, APP, { decision: 'start_review' }, {});
  assert.equal(application.status, 'under_review');
  const update = log.find((l) => l.table === 'garage_applications' && l.op === 'update');
  assert.equal(update.payload.decided_at, undefined, 'starting a review is not a decision');
  assert.equal(update.payload.decided_by_user_id, undefined);
});

test('GMO-3: request_more_info keeps the SAME application and hands it back editable', async () => {
  const log = [];
  const c = decidingClient(SUBMITTED, log);
  const { application } = await recordDecision(
    c, reviewer, APP, { decision: 'request_more_info', reason: 'Please add a photo of the workshop.' }, {},
  );
  assert.equal(application.status, 'information_required');
  const update = log.find((l) => l.table === 'garage_applications' && l.op === 'update');
  assert.equal(update.payload.decided_at, undefined, 'asking for more is not a decision about the outcome');
  // Same row: no new application is created.
  assert.ok(!log.some((l) => l.table === 'garage_applications' && l.op === 'insert'));
});

test('GMO-3: reject is terminal, records who and why, and stays that way', async () => {
  const log = [];
  const c = decidingClient(SUBMITTED, log);
  const { application } = await recordDecision(
    c, reviewer, APP,
    { decision: 'reject', reason_code: 'PREMISES_UNCONFIRMED', reason: 'We could not confirm the premises.' }, {},
  );
  assert.equal(application.status, 'rejected');
  const update = log.find((l) => l.table === 'garage_applications' && l.op === 'update');
  assert.ok(update.payload.decided_at);
  assert.equal(update.payload.decided_by_user_id, REVIEWER);
  assert.equal(update.payload.decision_reason, 'We could not confirm the premises.');
  assert.equal(update.payload.decision_reason_code, 'PREMISES_UNCONFIRMED');
});

// ── approving decides; it does not build ─────────────────────────────────────────────────────────

test('GMO-3: approving creates NO tenant and NO membership', async () => {
  const log = [];
  const c = decidingClient(SUBMITTED, log);
  const { application } = await recordDecision(c, reviewer, APP, { decision: 'approve' }, { getIdentityAssurance: goodIdentity });
  assert.equal(application.status, 'approved');
  assert.ok(!log.some((l) => ['tenants', 'tenant_users'].includes(l.table)),
    'a decision must never touch tenancy — GMO-4 activates');
  const update = log.find((l) => l.table === 'garage_applications' && l.op === 'update');
  assert.equal(update.payload.activated_tenant_id, undefined, 'approval does not activate');
});

test('GMO-3: the review service is structurally incapable of granting authority', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../services/garageOnboarding/garageReviewService.js'), 'utf8');
  for (const table of ['tenants', 'tenant_users']) {
    assert.ok(!new RegExp(`from\\('${table}'\\)`).test(src), `the reviewer must never write ${table}`);
  }
  assert.ok(!/activated_tenant_id\s*:/.test(src), 'the reviewer never sets activated_tenant_id');
});

// ── PO-2: identity is a prerequisite, and an outage is not a finding ─────────────────────────────

test('GMO-3: approval is refused when the applicant has no approved identity', async () => {
  const c = decidingClient(SUBMITTED);
  await assert.rejects(
    () => recordDecision(c, reviewer, APP, { decision: 'approve' }, {
      getIdentityAssurance: async () => ({ identity_state: 'pending', usable_for_identity_gated_actions: false }),
    }),
    /identity is not approved/,
  );
});

test('GMO-3: a broken identity read blocks approval as a SYSTEM problem, not a finding', async () => {
  const c = decidingClient(SUBMITTED);
  await assert.rejects(
    () => recordDecision(c, reviewer, APP, { decision: 'approve' }, {
      getIdentityAssurance: async () => { throw new Error('identity service unreachable'); },
    }),
    /system problem, not a finding against them/,
  );
});

test('GMO-3: approval is refused with no business-presence evidence', async () => {
  const log = [];
  const c = client({
    garage_applications: (_f, { op, payload }) => ({ data: op === 'update' ? { ...SUBMITTED, ...payload } : SUBMITTED, error: null }),
    garage_application_decisions: () => ({ data: [], error: null }),
    garage_application_documents: [],
  }, log);
  await assert.rejects(
    () => recordDecision(c, reviewer, APP, { decision: 'approve' }, { getIdentityAssurance: goodIdentity }),
    /No business-presence evidence/,
  );
});

test('GMO-3: blockers name the system problem separately from the person problem', () => {
  const outage = approvalBlockers(SUBMITTED, [LIVE_DOC], null, 'timeout');
  assert.match(outage[0], /system problem, not a finding against them/);

  const notApproved = approvalBlockers(SUBMITTED, [LIVE_DOC], { identity_state: 'pending', usable_for_identity_gated_actions: false });
  assert.match(notApproved[0], /not approved/);
  assert.ok(!/system problem/.test(notApproved[0]));

  assert.deepEqual(approvalBlockers(SUBMITTED, [LIVE_DOC], GOOD_IDENTITY), []);
});

test('GMO-3: approval is NOT a claim that CarUp verified the business', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../services/garageOnboarding/garageReviewService.js'), 'utf8');
  // PO-2: "Garage workspace activated ≠ Business verified". Nothing here may write a verified flag.
  assert.ok(!/business_verified|verified\s*:\s*true|is_verified/.test(src),
    'approving must never set a business-verified claim');
});

// ── the record, and concurrency ──────────────────────────────────────────────────────────────────

test('GMO-3: the decision ledger is written BEFORE the status moves', async () => {
  const log = [];
  const c = decidingClient(SUBMITTED, log);
  await recordDecision(c, reviewer, APP, { decision: 'reject', reason: 'no' }, {});
  const ledgerAt = log.findIndex((l) => l.table === 'garage_application_decisions' && l.op === 'insert');
  const statusAt = log.findIndex((l) => l.table === 'garage_applications' && l.op === 'update');
  assert.ok(ledgerAt >= 0 && statusAt >= 0);
  assert.ok(ledgerAt < statusAt,
    'a decision that moved an application but recorded no author is worse than one that failed');
});

test('GMO-3: the ledger records who decided and in what role', async () => {
  const log = [];
  const c = decidingClient(SUBMITTED, log);
  await recordDecision(c, reviewer, APP, { decision: 'reject', reason: 'no' }, {});
  const insert = log.find((l) => l.table === 'garage_application_decisions' && l.op === 'insert');
  assert.equal(insert.payload.actor_user_id, REVIEWER);
  assert.equal(insert.payload.actor_role, 'admin');
  assert.equal(insert.payload.decision, 'reject');
});

test('GMO-3: two reviewers acting at once — the loser is told, not silently overwritten', async () => {
  const log = [];
  const c = client({
    garage_applications: (_f, { op }) => (op === 'update'
      ? { data: null, error: null }   // the guarded update matched no row: someone else moved it
      : { data: SUBMITTED, error: null }),
    garage_application_decisions: (_f, { op, payload }) => ({ data: op === 'insert' ? { id: 'd', ...payload } : [], error: null }),
    garage_application_documents: [LIVE_DOC],
  }, log);
  await assert.rejects(
    () => recordDecision(c, reviewer, APP, { decision: 'approve' }, { getIdentityAssurance: goodIdentity }),
    /changed while you were deciding.*was not applied/s,
  );
});

test('GMO-3: an unknown decision is refused', async () => {
  const c = decidingClient(SUBMITTED);
  await assert.rejects(() => recordDecision(c, reviewer, APP, { decision: 'activate' }), /decision must be one of/);
  assert.deepEqual(REVIEW_DECISIONS, ['start_review', 'request_more_info', 'approve', 'reject']);
});

test('GMO-3: a decision needs a reviewer identity', async () => {
  const c = decidingClient(SUBMITTED);
  await assert.rejects(() => recordDecision(c, {}, APP, { decision: 'start_review' }), /reviewer identity is required/);
});

// ── the queue and the detail view ────────────────────────────────────────────────────────────────

test('GMO-3: a broken queue read RAISES — an empty queue and a broken one are different', async () => {
  const c = client({ garage_applications: () => ({ data: null, error: { message: 'connection reset' } }) });
  await assert.rejects(() => listApplicationsForReview(c), /Could not load the review queue/);
});

test('GMO-3: the queue holds everything still with CarUp, oldest first', async () => {
  const log = [];
  const c = client({ garage_applications: [SUBMITTED] }, log);
  const { applications, statuses } = await listApplicationsForReview(c, {}, log);
  assert.equal(applications.length, 1);
  assert.deepEqual(statuses, ['submitted', 'under_review', 'information_required']);
});

test('GMO-3: the detail view gathers evidence, history and identity in one read', async () => {
  const c = client({
    garage_applications: SUBMITTED,
    garage_application_decisions: [{ id: 'd1', decision: 'start_review' }],
    garage_application_documents: [LIVE_DOC],
  });
  const out = await getApplicationForReview(c, APP, { getIdentityAssurance: goodIdentity });
  assert.equal(out.application.id, APP);
  assert.equal(out.decisions.length, 1);
  assert.equal(out.documents.length, 1);
  assert.equal(out.identity.usable_for_identity_gated_actions, true);
  assert.deepEqual(out.blocking, []);
  assert.deepEqual(out.allowed_decisions, ['start_review', 'request_more_info', 'approve', 'reject']);
});

test('GMO-3: a missing application is reported as missing', async () => {
  const c = client({ garage_applications: null });
  await assert.rejects(() => getApplicationForReview(c, 'nope'), /Application not found/);
});

test('GMO-3: an identity outage in the detail view is reported, not hidden as "not verified"', async () => {
  const c = client({
    garage_applications: SUBMITTED,
    garage_application_decisions: [],
    garage_application_documents: [LIVE_DOC],
  });
  const out = await getApplicationForReview(c, APP, {
    getIdentityAssurance: async () => { throw new Error('identity service unreachable'); },
  });
  assert.equal(out.identity, null);
  assert.match(out.identity_error, /unreachable/);
  assert.match(out.blocking[0], /system problem/);
});
