/** Verify the reviewer queue returns operational metadata only. */
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

test('list SELECT does not query applicant details or OCR fields', async () => {
  const { captured, client } = makeCapturingClient();
  await listVerificationSessionsForReview(client, admin, {});
  assert.doesNotMatch(captured.select, /users!|users\(|ocr_result|review_notes/);
});

test('queue strips applicant and reviewer personal information even if returned by the database', async () => {
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
  assert.equal(row.id, 'vs-1');
  for (const field of ['applicant_name','applicant_email','user_id','ocr_result','review_notes','front_storage_path']) {
    assert.equal(Object.hasOwn(row, field), false, field);
  }
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
    /Verification service operation failed/,
  );
});
