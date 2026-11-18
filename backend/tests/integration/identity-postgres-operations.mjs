/** Disposable, loopback-only operational identity route certification. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';

const password = process.env.CARUP_IDV_TEST_PASSWORD;
if (!password || password.length < 16) throw new Error('An ephemeral synthetic password is required.');
const port = Number(process.env.CARUP_IDV_TEST_PREVIEW_PORT || 5074);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port.');
const origin = `http://127.0.0.1:${port}`;
const applicantRoot = '/api/identity/verification-sessions';
const reviewerRoot = '/api/admin/identity/verification-sessions';
const baseline = process.argv.includes('--baseline');
const offline = process.argv.includes('--offline');
const reviewerTwo = process.argv.includes('--second-reviewer');
const stages = { uploads: 0, completed: 0, operations: 0, denied: 0 };
const started = performance.now();

async function request(path, { actor, body, proof, key } = {}) {
  const headers = actor ? { 'x-session-token': actor.token, 'x-user-id': actor.user.id } : {};
  if (proof) headers['x-review-step-up'] = proof;
  if (key) headers['x-idempotency-key'] = key;
  if (body !== undefined) {
    const csrf = await fetch(origin + '/api/security/csrf-token', { headers });
    assert.equal(csrf.status, 200);
    headers.cookie = csrf.headers.get('set-cookie').split(';')[0];
    headers['x-csrf-token'] = (await csrf.json()).csrfToken;
    headers['content-type'] = 'application/json';
  }
  return fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectJson(path, args, status = 200) {
  const res = await request(path, args);
  assert.equal(res.status, status, path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':case'));
  return res.json();
}

async function login(kind) {
  return expectJson('/api/auth/login', { body: { email: `${kind}@lr13.example.invalid`, password } });
}

function fixtureImage(seed) {
  const png = new PNG({ width: 320, height: 180 });
  for (let i = 0; i < png.data.length; i += 4) {
    const j = i / 4;
    png.data[i] = (j * 23 + seed * 11) % 255;
    png.data[i + 1] = (j * 13 + seed * 19) % 255;
    png.data[i + 2] = (j * 7 + seed * 23) % 255;
    png.data[i + 3] = 255;
  }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

const applicant = await login('applicant');
const unrelated = await login('applicant-two');
const first = await login(reviewerTwo ? 'reviewer-two' : 'reviewer');
const alternate = await login(reviewerTwo ? 'reviewer-two' : 'reviewer');
const second = await login(reviewerTwo ? 'reviewer' : 'reviewer-two');

let seed = 0;
async function createCase(actor = applicant) {
  const { session } = await expectJson(applicantRoot, {
    actor, body: { documentType: 'passport', doubleSided: true },
  }, 201);
  for (const side of ['front', 'back', 'selfie']) {
    const image = fixtureImage(++seed);
    await expectJson(`${applicantRoot}/${session.id}/upload/${side}`, { actor, body: { image } });
    stages.uploads++;
  }
  const { session: submitted } = await expectJson(`${applicantRoot}/${session.id}/submit`, { actor, body: {} });
  assert.ok(['ocr_failed', 'pending_manual_review'].includes(submitted.status), 'automated OCR must never verify identity');
  return submitted;
}

function issue(actor, id, operation, value = password) {
  return request(`${reviewerRoot}/${id}/step-up`, { actor, body: { operation, password: value } });
}

async function getProof(actor, id, operation) {
  const result = await issue(actor, id, operation);
  if (result.status === 429) {
    stages.denied++;
    throw new Error('CAPACITY_429');
  }
  assert.equal(result.status, 200, operation);
  stages.operations++;
  return (await result.json()).proof;
}

async function readCase(actor, id) {
  return expectJson(`${reviewerRoot}/${id}`, { actor, proof: await getProof(actor, id, 'case:detail') });
}

async function preview(actor, id, side) {
  const path = `${reviewerRoot}/${id}/evidence/${side}/preview`;
  const proof = await getProof(actor, id, `preview:${side}`);
  const response = await request(path, { actor, proof });
  assert.equal(response.status, 200, side);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { preview: signed } = await response.json();
  const signedUrl = new URL(signed.url);
  assert.equal(signedUrl.origin, origin);
  const image = await fetch(signedUrl);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal((await request(path, { actor, proof })).status, 403);
}

async function finish(row, actor) {
  const details = await readCase(actor, row.id);
  assert.doesNotMatch(JSON.stringify(details), /front_storage_path|selfie_storage_path|\/private-fixture\//);
  for (const side of ['front', 'back', 'selfie']) await preview(actor, row.id, side);
  const saved = await expectJson(`${reviewerRoot}/${row.id}/review`, {
    actor, proof: await getProof(actor, row.id, 'decision:request_resubmission'), key: randomUUID(),
    body: { action: 'request_resubmission', expectedRevision: details.session.revision,
      reasonCode: 'BLURRY_IMAGE', applicantMessage: 'Retake the synthetic images.' },
  });
  assert.equal(saved.session.status, 'retry_requested');
  const readback = await expectJson(`${applicantRoot}/${row.id}`, { actor: applicant });
  assert.equal(readback.session.retry_reason, 'Retake the synthetic images.');
  stages.completed++;
}

if (process.argv.includes('--local-ocr-recovery')) {
  const { session } = await expectJson(applicantRoot + '/latest', { actor: applicant });
  assert.equal(session.status, 'pending_manual_review');
  assert.equal(session.ocr_result.national_id_number, 'DEMO-445566');
  const { session: replay } = await expectJson(`${applicantRoot}/${session.id}/submit`, { actor: applicant, body: {} });
  assert.equal(replay.revision, session.revision);
  assert.equal((await request(`${applicantRoot}/${session.id}/biometrics`, { actor: applicant })).status, 503);
  console.log('PASS restart readback, idempotent submission and disabled biometric endpoint.');
  process.exit(0);
}

if (process.argv.includes('--local-ocr')) {
  const directory = process.env.CARUP_IDV_TEST_IMAGE_DIR;
  assert.ok(directory);
  async function submitImages(type, front, back) {
    const { session } = await expectJson(applicantRoot, { actor: applicant, body: { documentType: type } }, 201);
    for (const [side, file] of [['front', front], ['back', back], ['selfie', null]]) {
      if (side === 'back' && !file) continue;
      const image = file ? 'data:image/png;base64,' + (await readFile(join(directory, file + '.png'))).toString('base64')
        : fixtureImage(++seed);
      await expectJson(`${applicantRoot}/${session.id}/upload/${side}`, { actor: applicant, body: { image } });
    }
    const before = performance.now();
    const submitted = (await expectJson(`${applicantRoot}/${session.id}/submit`, { actor: applicant, body: {} })).session;
    const elapsed = Math.round(performance.now() - before);
    assert.equal(submitted.status, 'pending_manual_review');
    return { submitted, elapsed };
  }

  let accepted = 0;
  let primaryCase;
  for (const [type, front, back, expected] of [
    ['passport', 'passport', null, 'EXAMPLE123'],
    ['national_id', 'national-id', 'national-id-back', 'TEST-784223'],
    ['drivers_license', 'licence', 'licence-back', 'DEMO-445566'],
  ]) {
    const { submitted, elapsed } = await submitImages(type, front, back);
    const expectedFields = { first_name: 'AMA', last_name: 'TEST', national_id_number: expected, date_of_birth: '1992-01-01' };
    for (const [field, value] of Object.entries(expectedFields)) {
      assert.equal(submitted.ocr_result[field], value, `${type}.${field}`);
      accepted++;
    }
    const detail = (await readCase(first, submitted.id)).session;
    assert.equal(detail.evidence_classification, 'uncertain');
    assert.equal(detail.extraction_trust_status, 'untrusted');
    if (back) {
      assert.equal(detail.ocr_side_assessment.comparison, 'consistent_overlap');
      assert.deepEqual(detail.ocr_side_assessment.fieldSources.national_id_number, ['front', 'back']);
    }
    assert.equal(submitted.ocr_side_assessment, undefined);
    console.log(type, '4/4 fields; classification uncertain; latency_ms', elapsed);
    primaryCase = submitted;
  }
  console.log('Exact synthetic fields', accepted, '/ 12');
  for (const [type, front, back, reason] of [
    ['national_id', 'national-id', 'national-id-back-conflict', 'DOCUMENT_SIDE_MISMATCH'],
    ['passport', 'blank', null, 'UNREADABLE_DOCUMENT'],
    ['passport', 'non-document', null, null],
    ['passport', 'partial-passport', null, 'REQUIRED_FIELDS_MISSING'],
    ['passport', 'licence', null, 'OCR_RESULT_UNTRUSTED'],
  ]) {
    const { submitted, elapsed } = await submitImages(type, front, back);
    const detail = (await readCase(first, submitted.id)).session;
    assert.equal(detail.evidence_classification, 'uncertain');
    if (reason) assert.equal(detail.primary_reason_code, reason);
    assert.notEqual(detail.status, 'verified');
    console.log(front, detail.primary_reason_code, 'latency_ms', elapsed);
  }
  const root = `${applicantRoot}/${primaryCase.id}`;
  assert.equal((await expectJson(root + '/submit', { actor: applicant, body: {} })).session.revision, primaryCase.revision);
  const { confirmation } = await expectJson(root + '/ocr-confirmation', { actor: applicant, body: {
    idempotencyKey: randomUUID(), revision: primaryCase.revision,
    fields: { first_name: 'AMA', last_name: 'TEST', national_id_number: 'DEMO-445567' },
  } });
  const refused = await request(`${reviewerRoot}/${primaryCase.id}/review`, {
    actor: first, proof: await getProof(first, primaryCase.id, 'decision:approve'), key: randomUUID(),
    body: { action: 'approve', expectedRevision: confirmation.revision },
  });
  assert.equal(refused.status, 403);
  const correction = (await readCase(first, primaryCase.id)).session.applicant_confirmations[0];
  assert.equal(correction.original_observations.national_id_number, 'DEMO-445566');
  assert.equal(correction.applicant_fields.national_id_number, 'DEMO-445567');

  const bio = root + '/biometrics';
  assert.equal((await request(bio, { actor: unrelated })).status, 404);
  assert.equal((await expectJson(bio, { actor: applicant })).biometric.status, 'not_granted');
  const revision = confirmation.revision;
  const grant = { requestId: randomUUID(), revision, purposes: ['face_document_match'], notice: 'biometric_consent_text.v1' };
  assert.equal((await expectJson(bio + '/grant', { actor: applicant, body: grant })).biometric.status, 'granted');
  const assessment = { requestId: randomUUID(), revision, purposes: ['face_document_match'] };
  assert.equal((await request(bio + '/assess', { actor: applicant, body: { ...assessment, purposes: ['liveness'] } })).status, 409);
  assert.equal((await request(bio + '/assess', { actor: applicant, body: { ...assessment, revision: revision - 1 } })).status, 409);
  const receipts = await Promise.all([1, 2].map(() => expectJson(bio + '/assess', { actor: applicant, body: assessment })));
  assert.deepEqual(receipts.map(x => x.biometric.replayed).sort(), [false, true]);
  assert.ok(receipts.every(x => x.biometric.provider_state === 'not_configured'));
  await expectJson(bio + '/withdraw', { actor: applicant, body: { requestId: randomUUID(), revision } });
  assert.equal((await request(bio + '/assess', { actor: applicant, body: assessment })).status, 409);
  assert.equal((await expectJson(bio + '/grant', { actor: applicant, body: grant })).biometric.status, 'withdrawn');
  console.log('PASS duplicate submission, applicant correction, blocked approval, consent ownership, purpose, revision, concurrent replay and withdrawal');
  process.exit(0);
}

if (process.argv.includes('--side-conflict')) {
  const submitted = await createCase();
  assert.equal(submitted.status, 'pending_manual_review');
  assert.equal(submitted.ocr_result?.national_id_number, undefined);
  assert.equal(submitted.ocr_side_assessment, undefined);
  assert.deepEqual(submitted.biometric_checks, {
    face_match: 'not_performed', liveness: 'not_performed', provider_state: 'not_configured',
  });
  const detail = (await readCase(first, submitted.id)).session;
  assert.equal(detail.primary_reason_code, 'DOCUMENT_SIDE_MISMATCH');
  assert.equal(detail.ocr_side_assessment.classification.back, 'valid_identity_document');
  assert.equal(detail.ocr_side_assessment.comparison, 'conflict');
  assert.ok(detail.ocr_side_assessment.conflictingFields.includes('passport_number'));
  const refused = await request(`${reviewerRoot}/${submitted.id}/review`, {
    actor: first, proof: await getProof(first, submitted.id, 'decision:approve'), key: randomUUID(),
    body: { action: 'approve', expectedRevision: detail.revision },
  });
  assert.equal(refused.status, 403);
  assert.match(JSON.stringify(await refused.json()), /DOCUMENT_SIDE_MISMATCH/);
  assert.equal((await readCase(first, submitted.id)).session.revision, detail.revision);
  console.log('PASS conflicting side observations persist privately and block an authorized approval.');
  process.exit(0);
}

if (process.argv.includes('--latest-after-restart')) {
  const expectedId = '10000000-0000-4000-8000-000000000001';
  for (const actor of [unrelated, await login('applicant-two')]) {
    const latest = await expectJson(`${applicantRoot}/latest`, { actor });
    assert.equal(latest.session.id, expectedId);
    assert.equal(latest.session.status, 'rejected');
    assert.equal((await request(applicantRoot, { actor, body: { documentType: 'passport' } })).status, 403);
  }
  console.log('PASS latest case and restart guard agree on millisecond ordering across applicant sessions');
  process.exit(0);
}

if (offline) {
  const forEscalation = await createCase(applicant);
  const escalationCase = await readCase(first, forEscalation.id);
  assert.equal(escalationCase.session.status, 'ocr_failed');
  await preview(first, forEscalation.id, 'front');
  const reviewPath = `${reviewerRoot}/${forEscalation.id}/review`;
  const approval = await request(reviewPath, { actor: first, proof: await getProof(first, forEscalation.id, 'decision:approve'),
    key: randomUUID(), body: { action: 'approve', expectedRevision: escalationCase.session.revision } });
  assert.equal(approval.status, 403);
  assert.match(JSON.stringify(await approval.json()), /Approval is not permitted/);
  const escalation = await expectJson(reviewPath, { actor: first, proof: await getProof(first, forEscalation.id, 'decision:escalate'),
    key: randomUUID(), body: { action: 'escalate', expectedRevision: escalationCase.session.revision,
      reasonCode: 'SPECIALIST_REVIEW_REQUIRED', internalNote: 'Sensitive fixture rationale.' } });
  assert.equal(escalation.session.workflow_phase, 'escalated');
  const safeCase = await expectJson(`${applicantRoot}/${forEscalation.id}`, { actor: applicant });
  assert.equal(safeCase.session.status, 'pending_manual_review');
  assert.doesNotMatch(JSON.stringify(safeCase), /Sensitive fixture rationale|storage_path|signedUrl/);

  const forRejection = await createCase(unrelated);
  const rejectionCase = await readCase(first, forRejection.id);
  const rejected = await expectJson(`${reviewerRoot}/${forRejection.id}/review`, {
    actor: first, proof: await getProof(first, forRejection.id, 'decision:reject'), key: randomUUID(),
    body: { action: 'reject', expectedRevision: rejectionCase.session.revision,
      reasonCode: 'SUSPECTED_FRAUD', applicantMessage: 'Verification could not be completed.' },
  });
  assert.equal(rejected.session.status, 'rejected');
  const latest = await expectJson(`${applicantRoot}/latest`, { actor: unrelated });
  assert.equal(latest.session.id, forRejection.id);
  assert.equal(latest.session.status, 'rejected');
  const restart = await request(applicantRoot, { actor: unrelated, body: { documentType: 'passport' } });
  assert.equal(restart.status, 403);
  assert.match(JSON.stringify(await restart.json()), /previous verification was closed/);
  console.log('PASS provider OFF, protected manual preview, blocked approval, private escalation, terminal rejection and restart refusal');
  console.log('Elapsed milliseconds:', Math.round(performance.now() - started));
  process.exit(0);
}

const cases = [];
for (let i = 0; i < 10; i++) cases.push(await createCase());
if (baseline) {
  let error;
  try { for (const row of cases) await finish(row, first); } catch (e) { error = e; }
  assert.equal(error?.message, 'CAPACITY_429');
  assert.equal(stages.completed, 3);
  const bad = await expectJson(applicantRoot, { actor: unrelated, body: { documentType: 'passport' } }, 201);
  assert.equal((await request(`${applicantRoot}/${bad.session.id}/upload/front`,
    { actor: unrelated, body: { image: 'data:image/png;base64,QUJDRA==' } })).status, 200);
  console.log('REPRODUCED frozen 429 after three of ten complete reviews and non-image bytes accepted:', JSON.stringify(stages));
} else {
  for (const row of cases) await finish(row, first);
  assert.equal(stages.completed, 10);
  const id = cases[0].id;
  await readCase(second, id);
  const proof = await getProof(first, id, 'case:detail');
  const denied = await request(`${reviewerRoot}/${id}`, { actor: alternate, proof });
  assert.equal(denied.status, 403);
  assert.equal((await request(`${reviewerRoot}/${id}`, { actor: first, proof })).status, 200);
  assert.equal((await request(`${applicantRoot}/${id}`, { actor: unrelated })).status, 404);
  assert.equal((await request(`${reviewerRoot}/${id}/evidence/front/preview`, { actor: applicant })).status, 403);
  const bad = await expectJson(applicantRoot, { actor: unrelated, body: { documentType: 'passport' } }, 201);
  for (const image of ['data:image/png;base64,QUJDRA==', 'data:image/jpeg;base64,' + fixtureImage(++seed).split(',')[1],
    'data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,a!b$c']) {
    assert.equal((await request(`${applicantRoot}/${bad.session.id}/upload/front`, { actor: unrelated, body: { image } })).status, 400);
  }
  const wrong = await Promise.all(Array.from({ length: 15 }, (_, index) =>
    issue(index % 2 ? first : alternate, id, 'case:detail', 'wrong-fixture-password')));
  assert.ok(wrong.every(res => res.status === 403));
  assert.equal((await issue(first, id, 'case:detail')).status, 429);
  await readCase(second, id);
  console.log('PASS ten cases, correct-password reauthentication, cross-session and replay refusal, reviewer isolation, invalid input, shared password exhaustion:', JSON.stringify(stages));
}
console.log('Elapsed milliseconds:', Math.round(performance.now() - started));
