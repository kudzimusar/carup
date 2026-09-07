/**
 * GMO-1 — the Garage application.
 *
 * The applicant journey that did not exist. Before this, a person who registered as a garage got a
 * correct, honest, safe account and a dead end: no entry point, no reviewer, no status surface, and
 * `onboarding_status` frozen at `requested` forever.
 *
 * The load-bearing property throughout: **an application grants nothing.** These tests check the
 * journey works AND that it stays inert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  assertGarageOnboardingContext,
  getMyApplication,
  startApplication,
  submitApplication,
  updateApplication,
  submissionBlockers,
  APPLICANT_RELATIONSHIPS,
} = await import('../services/garageOnboarding/garageApplicationService.js');

const APPLICANT = 'u_garage_applicant_1';
const OTHER = 'u_someone_else';

/**
 * Supabase-shaped stub. Tables may be arrays, objects or functions of the filters.
 *
 * GMO-2 added a second read to the submission path — the live-evidence count that PO-2 item 9
 * requires — so the stub answers `garage_application_documents` with one live document by default.
 * Tests that care about the evidence gate override it explicitly; every other test here is about
 * the application itself and should not have to restate that evidence exists.
 */
function client(tables, log = []) {
  const withDefaults = { garage_application_documents: [{ id: 'ev-1' }], ...tables };
  const from = (table) => {
    const filters = {};
    let inFilter = null;
    let payload = null;
    let op = 'select';
    let head = false;
    const result = () => {
      log.push({ table, op, filters: { ...filters }, in: inFilter, payload });
      const entry = withDefaults[table];
      const out = typeof entry === 'function'
        ? entry(filters, { op, payload, inFilter })
        : { data: entry === undefined ? null : entry, error: null };
      if (head && out.count === undefined) {
        out.count = Array.isArray(out.data) ? out.data.length : (out.data ? 1 : 0);
      }
      return out;
    };
    const chain = {
      select(_cols, opts) { if (opts?.head) head = true; return chain; },
      insert(p) { op = 'insert'; payload = p; return chain; },
      update(p) { op = 'update'; payload = p; return chain; },
      eq(k, v) { filters[k] = v; return chain; },
      is(k, v) { filters[`is:${k}`] = v; return chain; },
      in(k, v) { inFilter = { key: k, values: v }; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return chain;
  };
  return { from };
}

const GARAGE_PROFILE = {
  user_id: APPLICANT, account_kind: 'business', business_type: 'garage',
  organization_name: 'Mbare Motors', onboarding_status: 'requested',
};

const COMPLETE = {
  id: 'app-1', applicant_user_id: APPLICANT, status: 'draft',
  trading_name: 'Mbare Motors', address_line: '12 Chaminuka Rd', location_city: 'Harare',
  contact_phone: '+263771234567', applicant_relationship: 'owner',
  service_categories: ['brakes'], attestation_accepted_at: '2026-09-06T09:00:00Z',
};

const actor = { id: APPLICANT, role: 'owner' };

// ── the self-service gate ────────────────────────────────────────────────────────────────────────

test('GMO-1: a garage applicant may open their own application', async () => {
  const ctx = await assertGarageOnboardingContext(client({ user_registration_profiles: GARAGE_PROFILE }), actor);
  assert.equal(ctx.userId, APPLICANT);
  assert.equal(ctx.registrationProfile.business_type, 'garage');
});

test('GMO-1: someone who never declared a garage business cannot', async () => {
  for (const [label, profile] of [
    ['an individual account', { ...GARAGE_PROFILE, account_kind: 'individual', business_type: null }],
    ['a dealer applicant', { ...GARAGE_PROFILE, business_type: 'dealer' }],
    ['no profile at all', null],
  ]) {
    await assert.rejects(
      assertGarageOnboardingContext(client({ user_registration_profiles: profile }), actor),
      /GARAGE_ONBOARDING_CONTEXT_REQUIRED/,
      `must refuse: ${label}`,
    );
  }
});

test('GMO-1: a BROKEN profile read is a failure, never "you are not a garage applicant"', async () => {
  // The defect this codebase has already shipped once: an error swallowed into a confident answer.
  await assert.rejects(
    assertGarageOnboardingContext(
      client({ user_registration_profiles: () => ({ data: null, error: { message: 'column does not exist' } }) }),
      actor,
    ),
    /Could not read your registration profile/,
  );
});

test('GMO-1: the claim opens the form and NOTHING else', async () => {
  // The reconciled invariant with O2: a claim may gate your own onboarding surface; it may never
  // reach a capability, tenant or membership. Proven structurally — the module must not touch them.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../services/garageOnboarding/garageApplicationService.js', import.meta.url), 'utf8');
  for (const forbidden of ['tenant_users', "from('tenants')", "from('users')", 'active_tenant_role', 'GARAGE_ROLES']) {
    assert.ok(!src.includes(forbidden),
      `the application service must never touch ${forbidden} — an application is not an authority`);
  }
});

// ── starting and resuming ────────────────────────────────────────────────────────────────────────

test('GMO-1: starting twice returns the SAME application', async () => {
  // A double tap on "Finish setting up your garage", or a retried request, must not create two.
  const live = { ...COMPLETE, status: 'draft' };
  const first = await startApplication(client({ garage_applications: [live] }), actor);
  assert.equal(first.created, false, 'an existing live application is returned, not duplicated');
  assert.equal(first.application.id, 'app-1');
});

test('GMO-1: a lost race returns the winner rather than failing the person', async () => {
  let attempted = false;
  const c = client({
    garage_applications: (filters, { op }) => {
      if (op === 'insert') { attempted = true; return { data: null, error: { code: '23505', message: 'duplicate' } }; }
      return { data: attempted ? [COMPLETE] : [], error: null };
    },
  });
  const result = await startApplication(c, actor);
  assert.equal(result.created, false);
  assert.equal(result.application.id, 'app-1', 'the concurrent winner is returned');
});

test('GMO-1: the applicant finds their application again', async () => {
  const found = await getMyApplication(client({ garage_applications: [COMPLETE] }), actor);
  assert.equal(found.application.id, 'app-1');
  assert.equal(found.editable, true);
  assert.deepEqual(found.blockers, [], 'a complete draft has nothing outstanding');
});

// ── autosave ─────────────────────────────────────────────────────────────────────────────────────

test('GMO-1: a partial save is normal and does not demand completeness', async () => {
  const draft = { ...COMPLETE, trading_name: null, location_city: null, service_categories: [] };
  const c = client({
    garage_applications: (filters, { op, payload }) =>
      op === 'update' ? { data: { ...draft, ...payload }, error: null } : { data: draft, error: null },
  });
  const saved = await updateApplication(c, actor, 'app-1', { trading_name: 'Mbare Motors' });
  assert.equal(saved.application.trading_name, 'Mbare Motors');
  assert.ok(saved.blockers.length > 0, 'and it still reports what is outstanding');
});

test('GMO-1: an unknown service category is refused', async () => {
  await assert.rejects(
    updateApplication(client({ garage_applications: COMPLETE }), actor, 'app-1',
      { service_categories: ['brakes', 'time_travel'] }),
    /Unknown service category: time_travel/,
  );
});

test('GMO-1: an unknown relationship is refused; the governed ones are accepted', async () => {
  await assert.rejects(
    updateApplication(client({ garage_applications: COMPLETE }), actor, 'app-1',
      { applicant_relationship: 'landlord' }),
    /applicant_relationship must be one of/,
  );
  for (const rel of APPLICANT_RELATIONSHIPS) {
    const c = client({
      garage_applications: (f, { op, payload }) =>
        op === 'update' ? { data: { ...COMPLETE, ...payload }, error: null } : { data: COMPLETE, error: null },
    });
    const saved = await updateApplication(c, actor, 'app-1', { applicant_relationship: rel });
    assert.equal(saved.application.applicant_relationship, rel);
  }
});

test("GMO-1: another person's application is not found — the id is not an oracle", async () => {
  await assert.rejects(
    updateApplication(client({ garage_applications: { ...COMPLETE, applicant_user_id: OTHER } }), actor,
      'app-1', { trading_name: 'Hijacked' }),
    /Application not found/,
    'the same wording as a genuinely missing application',
  );
});

// ── submission ───────────────────────────────────────────────────────────────────────────────────

test('GMO-1: an incomplete application names what is missing BEFORE submitting', async () => {
  const bare = { id: 'app-1', applicant_user_id: APPLICANT, status: 'draft', service_categories: [] };
  const blockers = submissionBlockers(bare);
  assert.ok(blockers.includes('a garage name'));
  assert.ok(blockers.includes('the city you operate in'));
  assert.ok(blockers.includes('your confirmation that the details are true'));

  await assert.rejects(
    submitApplication(client({ garage_applications: bare }), actor, 'app-1'),
    /Before you can submit, add: .*a garage name/,
  );
});

test('GMO-1: a complete application submits, and the person-level status follows', async () => {
  const log = [];
  const events = [];
  const c = client({
    garage_applications: (f, { op, payload }) =>
      op === 'update' ? { data: { ...COMPLETE, ...payload }, error: null } : { data: COMPLETE, error: null },
    user_registration_profiles: { ...GARAGE_PROFILE },
  }, log);

  const result = await submitApplication(c, actor, 'app-1', {
    emitDomainEvent: async (_c, type, payload) => { events.push({ type, payload }); },
  });
  assert.equal(result.application.status, 'submitted');
  assert.ok(result.application.submitted_at, 'submission is stamped');

  const profileWrite = log.find((q) => q.table === 'user_registration_profiles' && q.op === 'update');
  assert.equal(profileWrite.payload.onboarding_status, 'in_review',
    'the person-level onboarding status advances past `requested` for the first time');

  assert.equal(events[0].type, 'garage.application.submitted');
  assert.equal(events[0].payload.applicantUserId, APPLICANT);
});

test('GMO-1: submitting an already-submitted application is refused', async () => {
  await assert.rejects(
    submitApplication(client({ garage_applications: { ...COMPLETE, status: 'under_review' } }), actor, 'app-1'),
    /already under review/,
  );
});

test('GMO-1: a concurrent change during submission is reported, not silently overwritten', async () => {
  const c = client({
    garage_applications: (f, { op }) =>
      op === 'update' ? { data: null, error: null } : { data: COMPLETE, error: null },
  });
  await assert.rejects(
    submitApplication(c, actor, 'app-1'),
    /changed while you were submitting it/,
  );
});

test('GMO-1: a failed profile update does not fail the submission the applicant completed', async () => {
  const c = client({
    garage_applications: (f, { op, payload }) =>
      op === 'update' ? { data: { ...COMPLETE, ...payload }, error: null } : { data: COMPLETE, error: null },
    user_registration_profiles: () => ({ data: null, error: { message: 'transient' } }),
  });
  const result = await submitApplication(c, actor, 'app-1');
  assert.equal(result.application.status, 'submitted', 'their work is not lost to a secondary write');
});

// ── PO-5 reapplication ───────────────────────────────────────────────────────────────────────────

test('GMO-1 (PO-5): a rejected application is replaced by a NEW one that links to it', async () => {
  const rejected = { ...COMPLETE, id: 'app-old', status: 'rejected', decided_at: '2026-09-05T10:00:00Z' };
  const c = client({
    garage_applications: (f, { op, payload }) => {
      if (op === 'insert') return { data: { id: 'app-new', status: 'draft', ...payload }, error: null };
      if (f.id === 'app-old') return { data: rejected, error: null };
      return { data: [rejected], error: null };
    },
  });
  const result = await startApplication(c, actor, { supersedes: 'app-old' });
  assert.equal(result.created, true);
  assert.equal(result.application.supersedes_application_id, 'app-old',
    'the prior audit history stays attached rather than being overwritten');
});

test('GMO-1 (PO-5): a non-rejected application cannot be replaced', async () => {
  const live = { ...COMPLETE, id: 'app-old', status: 'under_review' };
  const c = client({
    garage_applications: (f, { op }) => {
      if (f.id === 'app-old') return { data: live, error: null };
      return { data: [], error: null };
    },
  });
  await assert.rejects(
    startApplication(c, actor, { supersedes: 'app-old' }),
    /Only a rejected application can be replaced/,
  );
});

test("GMO-1 (PO-5): another person's rejected application cannot be superseded", async () => {
  const c = client({
    garage_applications: (f, { op }) => {
      if (f.id === 'app-old') return { data: { ...COMPLETE, id: 'app-old', status: 'rejected', applicant_user_id: OTHER }, error: null };
      return { data: [], error: null };
    },
  });
  await assert.rejects(
    startApplication(c, actor, { supersedes: 'app-old' }),
    /was not found/,
  );
});
