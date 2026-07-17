/**
 * Round-4 staging regression — the admin queue join.
 *
 * verification_sessions carries TWO foreign keys to users
 * (user_id → applicant, reviewed_by → reviewer), so a bare `users(...)`
 * embed is ambiguous and PostgREST answers 500 — the web admin showed
 * "Failed to load verification sessions" with false zero counts.
 *
 * Contracts under test:
 *  1. the list SELECT names the applicant relationship EXPLICITLY via the
 *     user_id FK (constraint name confirmed on staging:
 *     verification_sessions_user_id_fkey) and never uses a bare users();
 *  2. applicant_name/email map from the `applicant` embed — never from a
 *     reviewer join;
 *  3. workflow_phase filters (reviewer_action_required, resolved_rejected)
 *     reach the query;
 *  4. an empty result resolves to [] (a 200, not an error);
 *  5. a database/PostgREST error THROWS — it must never be swallowed into an
 *     empty list that the UI would render as zero cases.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { listVerificationSessionsForReview } = await import('../services/identity/verificationSessionService.js');

const admin = { id: 'admin-1', userId: 'admin-1', role: 'admin', tenantId: null };

/** Mock that CAPTURES the select string and filters, then returns fixed rows. */
function makeCapturingClient({ rows = [], error = null } = {}) {
  const captured = { select: null, filters: [] };
  const query = {
    select(arg) { captured.select = arg; return query; },
    eq(key, value) { captured.filters.push({ key, value }); return query; },
    order() { return query; },
    then(resolve, reject) {
      return Promise.resolve({ data: error ? null : rows, error }).then(resolve, reject);
    },
  };
  return { captured, client: { from: () => query } };
}

test('list SELECT embeds the applicant via the user_id FK — never a bare users()', async () => {
  const { captured, client } = makeCapturingClient();
  await listVerificationSessionsForReview(client, admin, {});
  assert.ok(captured.select.includes('applicant:users!verification_sessions_user_id_fkey'), captured.select);
  assert.equal(/[^!:\w]users\(/.test(captured.select), false, `ambiguous users() embed present: ${captured.select}`);
  assert.equal(captured.select.includes('reviewed_by_fkey'), false, 'must not join through reviewed_by');
});

test('applicant_name/email come from the applicant embed, not a reviewer join', async () => {
  const { client } = makeCapturingClient({
    rows: [{
      id: 'vs-1', user_id: 'u-app', status: 'pending_manual_review',
      workflow_phase: 'reviewer_action_required', document_type: 'passport',
      created_at: '2026-07-14T00:00:00Z', updated_at: '2026-07-14T00:00:00Z',
      applicant: { name: 'Applicant Person', email: 'applicant@example.test' },
      reviewer: { name: 'Reviewer Person', email: 'reviewer@example.test' },
    }],
  });
  const [row] = await listVerificationSessionsForReview(client, admin, {});
  assert.equal(row.applicant_name, 'Applicant Person');
  assert.equal(row.applicant_email, 'applicant@example.test');
});

test('workflow_phase filters reach the query (both failing staging URLs)', async () => {
  for (const phase of ['reviewer_action_required', 'resolved_rejected']) {
    const { captured, client } = makeCapturingClient();
    await listVerificationSessionsForReview(client, admin, { workflow_phase: phase });
    assert.deepEqual(captured.filters, [{ key: 'workflow_phase', value: phase }]);
  }
});

test('an empty queue resolves to [] — a legitimate 200, never an error', async () => {
  const { client } = makeCapturingClient({ rows: [] });
  const out = await listVerificationSessionsForReview(client, admin, { workflow_phase: 'resolved_rejected' });
  assert.deepEqual(out, []);
});

test('a database/PostgREST error THROWS — never silently an empty list', async () => {
  const { client } = makeCapturingClient({
    error: { message: "Could not embed because more than one relationship was found for 'verification_sessions' and 'users'" },
  });
  await assert.rejects(
    () => listVerificationSessionsForReview(client, admin, { workflow_phase: 'reviewer_action_required' }),
    /more than one relationship/,
  );
});
