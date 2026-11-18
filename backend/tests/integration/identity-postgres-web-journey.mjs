/** Transport-level exercise of the same loopback API used by the browser preview. */
import assert from 'node:assert/strict';
import { randomFillSync, randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';

const password = process.env.CARUP_IDV_TEST_PASSWORD;
if (!password) throw new Error('Set the ephemeral synthetic password.');
const base = 'http://127.0.0.1:5074';
const applicantRoot = '/api/identity/verification-sessions';
const reviewerRoot = '/api/admin/identity/verification-sessions';

async function request(path, { account, body, extra, expected = 200 } = {}) {
  const headers = account ? { 'x-session-token': account.token, 'x-user-id': account.user.id } : {};
  if (body !== undefined) {
    const csrf = await fetch(base + '/api/security/csrf-token', { headers });
    assert.equal(csrf.status, 200);
    headers.cookie = csrf.headers.get('set-cookie').split(';')[0];
    headers['x-csrf-token'] = (await csrf.json()).csrfToken;
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${path.replace(/\/[^/]+(?=\/preview$)/, '/fixture')}: ${result?.error?.message ?? result?.message ?? response.statusText}`);
  return result;
}

async function login(kind) {
  return request('/api/auth/login', { body: { email: `${kind}@lr13.example.invalid`, password } });
}

function image() {
  const png = new PNG({ width: 320, height: 220 });
  randomFillSync(png.data);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

const applicant = await login('applicant');
const reviewer = await login('reviewer');
const session = (await request(applicantRoot, {
  account: applicant, body: { documentType: 'passport', doubleSided: false }, expected: 201,
})).session;
const applicantCase = applicantRoot + '/' + session.id;
const reviewerCase = reviewerRoot + '/' + session.id;

async function uploadAndSubmit() {
  for (const side of ['front', 'selfie']) {
    await request(applicantCase + '/upload/' + side, { account: applicant, body: { image: image() } });
  }
  const submitted = (await request(applicantCase + '/submit', { account: applicant, body: {} })).session;
  const replayed = (await request(applicantCase + '/submit', { account: applicant, body: {} })).session;
  assert.equal(replayed.revision, submitted.revision);
  assert.equal(submitted.status, 'pending_manual_review', 'OCR fixture must never approve the case');
  return submitted;
}

async function confirm(submitted) {
  const body = {
    revision: submitted.revision, idempotencyKey: randomUUID(),
    fields: { first_name: 'Synthetic', last_name: 'Applicant', national_id_number: 'TEST123457', passport_number: 'TEST123457' },
  };
  const result = await request(applicantCase + '/ocr-confirmation', { account: applicant, body });
  assert.equal((await request(applicantCase + '/ocr-confirmation', { account: applicant, body })).confirmation.replayed, true);
  return result.confirmation.revision;
}

async function proof(operation) {
  return (await request(reviewerCase + '/step-up', { account: reviewer, body: { operation, password } })).proof;
}
async function reviewedRequest(path, operation, args = {}) {
  return request(path, { ...args, account: reviewer, extra: { ...args.extra, 'x-review-step-up': await proof(operation) } });
}

const submitted = await uploadAndSubmit();
const initialRevision = await confirm(submitted);

// Leave a persisted, confirmed case for browser workbench and applicant readback.
if (process.argv.includes('--prepare-browser')) {
  console.log('Prepared via actual authenticated routes, persisted media, submission and OCR correction:', session.id);
} else {
  await request(reviewerCase, { account: applicant, expected: 403 });
  await request(reviewerCase, { account: reviewer, expected: 403 });
  const queue = await request(reviewerRoot + '?workflow_phase=reviewer_action_required', { account: reviewer });
  assert.ok(queue.sessions.some(entry => entry.id === session.id));
  const detail = await reviewedRequest(reviewerCase, 'case:detail');
  assert.doesNotMatch(JSON.stringify(detail), /front_storage_path|selfie_storage_path/);
  const token = await proof('preview:front');
  const previewPath = reviewerCase + '/evidence/front/preview';
  const preview = await request(previewPath, { account: reviewer, extra: { 'x-review-step-up': token } });
  const media = await fetch(preview.preview.url);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('cache-control'), 'no-store');
  assert.equal(media.headers.get('content-type'), 'image/png');
  await request(previewPath, { account: reviewer, extra: { 'x-review-step-up': token }, expected: 403 });
  const requestBody = { action: 'request_resubmission', expectedRevision: initialRevision,
    reasonCode: 'BLURRY_IMAGE', applicantMessage: 'Retake the synthetic front image.', internalNote: 'Internal fixture note.' };
  const idempotency = { 'x-idempotency-key': randomUUID() };
  const retry = await reviewedRequest(reviewerCase + '/review', 'decision:request_resubmission', { body: requestBody, extra: idempotency });
  const replay = await reviewedRequest(reviewerCase + '/review', 'decision:request_resubmission', { body: requestBody, extra: idempotency });
  assert.equal(replay.decision.id, retry.decision.id);
  assert.equal(replay.idempotent_replay, true);
  const readback = (await request(applicantRoot + '/latest', { account: applicant })).session;
  assert.equal(readback.status, 'retry_requested');
  assert.equal(readback.retry_reason, requestBody.applicantMessage);
  assert.doesNotMatch(JSON.stringify(readback), /Internal fixture note|storage_path/);
  const revision = await confirm(await uploadAndSubmit());
  const approved = await reviewedRequest(reviewerCase + '/review', 'decision:approve', {
    body: { action: 'approve', expectedRevision: revision },
    extra: { 'x-idempotency-key': randomUUID() },
  });
  assert.equal(approved.session.status, 'verified');
  assert.equal((await request(applicantRoot + '/latest', { account: applicant })).session.status, 'verified');
  console.log('PASS persisted upload, OCR correction, protected queue/detail/media, proof replay denial, resubmission, decision replay and approval:', session.id);
}
