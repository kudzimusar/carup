/** Disposable, loopback-only operational identity route certification. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
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

if (process.argv.includes('--veriff-test') || process.argv.includes('--veriff-test-restart')) {
  const database = new URL(process.env.CARUP_IDV_TEST_DATABASE_URL || 'about:blank');
  assert.equal(database.protocol, 'postgresql:');
  assert.equal(database.hostname, '127.0.0.1');
  assert.match(database.pathname, /^\/carup_idv_test_[a-z0-9_]+$/u);
  assert.equal(database.search, '');
  assert.equal(process.env.CARUP_IDV_TEST_DISPOSABLE, 'yes');
  assert.equal(process.env.CARUP_IDV_TEST_VERIFF_ORIGIN, 'https://veriff-fixture.invalid');
  const { default: pg } = await import('pg');
  const db = new pg.Pool({ connectionString: database.href });
  const root = session => applicantRoot + '/' + session + '/biometrics';
  const recoveryPath = (session, id) => root(session) + '/veriff-test/' + id + '/recover';
  const client = process.env.CARUP_IDV_TEST_VERIFF_CLIENT;
  const secret = process.env.CARUP_IDV_TEST_VERIFF_SECRET;

  async function start(session, purpose, requestId = randomUUID(), actor = applicant) {
    return request(root(session.id) + '/veriff-test/start', { actor, body: { requestId, revision: session.revision, purpose } });
  }
  async function grant(session, purposes) {
    await expectJson(root(session.id) + '/grant', { actor: applicant,
      body: { requestId: randomUUID(), revision: session.revision, purposes, notice: 'biometric_consent_text.v1' } });
  }
  async function stored(session, requestId) {
    return (await db.query('SELECT * FROM identity_veriff_test_attempts WHERE session_id=$1 AND request_id=$2', [session.id, requestId])).rows[0];
  }
  function decision(attempt, status = 'approved', time = Date.now()) {
    return { id: attempt.provider_session, attemptId: randomUUID(), vendorData: attempt.id,
      code: { approved: 9001, declined: 9102, review: 9121, resubmission_requested: 9103 }[status],
      status, decisionTime: new Date(time).toISOString() };
  }
  async function callback(event, change = {}) {
    const raw = JSON.stringify({ status: 'success', verification: event }, null, 2);
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    return fetch(origin + '/api/identity/veriff-test/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AUTH-CLIENT': change.client ?? client,
        ...(change.omit ? {} : { 'X-HMAC-SIGNATURE': change.signature ?? signature }) },
      body: change.mutate ? raw + ' ' : raw,
    });
  }
  async function outcome(event, expected) {
    const res = await callback(event);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).outcome, expected);
  }

  if (process.argv.includes('--veriff-test-restart')) {
    const recovery = JSON.parse(await readFile(process.env.CARUP_IDV_TEST_VERIFF_LOOKUP_FILE, 'utf8'));
    const event = Object.values(recovery)[0];
    const { rows: [attempt] } = await db.query('SELECT session_id,request_id FROM identity_veriff_test_attempts WHERE id=$1', [event.vendorData]);
    const { biometric } = await expectJson(recoveryPath(attempt.session_id, attempt.request_id), { actor: applicant, body: {} });
    assert.equal(biometric.test_decision, 'declined');
    assert.equal(biometric.liveness, 'not_run');
    const { rows: [audit] } = await db.query("SELECT count(*)::integer AS count FROM trust_audit_events WHERE new_value->>'test_attempt_id'=$1", [event.vendorData]);
    assert.equal(audit.count, 1);
    console.log('PASS persisted simulated recovery receipt and audit survived process restart');
    await db.end();
    process.exit(0);
  }

  const { rows: [permissions] } = await db.query(`SELECT
    has_function_privilege('service_role','public.record_identity_veriff_test_decision(uuid,uuid,uuid,text,timestamptz)','EXECUTE') AS worker,
    has_function_privilege('authenticated','public.record_identity_veriff_test_decision(uuid,uuid,uuid,text,timestamptz)','EXECUTE') AS browser,
    has_table_privilege('anon','public.identity_veriff_test_attempts','SELECT') AS anonymous,
    has_column_privilege('service_role','public.identity_veriff_test_attempts','session_id','UPDATE') AS can_rebind`);
  assert.deepEqual(permissions, { worker: true, browser: false, anonymous: false, can_rebind: false });

  const session = await createCase();
  const { id, revision } = session;
  const startPath = root(id) + '/veriff-test/start';
  const req = randomUUID();
  assert.equal((await start(session, 'face_document_match', req)).status, 409);
  await grant(session, ['face_document_match','liveness']);
  assert.equal((await start(session, 'face_document_match', req, unrelated)).status, 404);
  assert.equal((await start({ ...session, revision: revision - 1 }, 'face_document_match', req)).status, 409);
  assert.equal((await request(startPath, { actor: applicant, body: { requestId: req, revision, purpose: 'liveness', status: 'approved' } })).status, 400);
  const parallelStarts = await Promise.all([start(session, 'face_document_match', req), start(session, 'face_document_match', req)]);
  assert.deepEqual(parallelStarts.map(res => res.status), [200, 200]);
  const binding = await stored(session, req);
  assert.ok(binding.provider_session);
  assert.equal((await start(session, 'face_document_match')).status, 409);
  assert.equal((await start(session, 'liveness', req)).status, 409);
  const approved = { ...decision(binding), person: { firstName: 'SYNTHETIC-FIELD-MUST-NOT-PERSIST' } };
  assert.equal((await fetch(origin + '/api/identity/veriff-test/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(32_769),
  })).status, 413);
  assert.equal((await fetch(origin + '/api/identity/veriff-test/webhook', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  })).status, 415);
  assert.equal((await callback(approved, { omit: true })).status, 401);
  assert.equal((await callback(approved, { signature: '0'.repeat(64) })).status, 401);
  assert.equal((await callback(approved, { mutate: true })).status, 401);
  assert.equal((await callback(approved, { client: 'unrelated-fixture' })).status, 401);
  assert.equal((await callback({ ...approved, status: 'unexpected' })).status, 400);
  assert.equal((await callback({ ...approved, code: 9102 })).status, 400);
  await outcome({ ...approved, id: randomUUID() }, 'ignored');
  await outcome({ ...approved, vendorData: randomUUID() }, 'ignored');
  await outcome(decision(binding, 'approved', Date.now() + 300_000), 'ignored');
  await outcome(decision(binding, 'review', Date.now() - 1000), 'recorded');
  await outcome(decision(binding, 'resubmission_requested', Date.now() - 2000), 'ignored');

  const receipts = await Promise.all([callback(approved), callback(approved)]);
  assert.deepEqual((await Promise.all(receipts.map(async item => (await item.json()).outcome))).sort(), ['duplicate','recorded']);
  await outcome(decision(binding, 'declined', Date.now() + 5000), 'ignored');
  const result = await expectJson(recoveryPath(id, req), { actor: applicant, body: {} });
  assert.deepEqual([result.biometric.state, result.biometric.test_decision, result.biometric.provenance,
    result.biometric.face_match, result.biometric.liveness], ['veriff_test_simulated','approved','TEST_SIMULATED','not_run','not_run']);
  assert.doesNotMatch(JSON.stringify(result), /provider_session|vendorData|SYNTHETIC-FIELD/);
  assert.equal((await request(recoveryPath(id, req), { actor: unrelated, body: {} })).status, 404);
  const { rows: [persisted] } = await db.query(`SELECT
    (SELECT count(*)::integer FROM verification_assessments WHERE biometric_request_id=$1 AND
      face_match_status='not_run' AND liveness_status='not_run' AND provider_state='veriff_test_simulated') AS assessments,
    (SELECT count(*)::integer FROM trust_audit_events WHERE new_value->>'test_attempt_id'=$1::text) AS events,
    (SELECT status FROM verification_sessions WHERE id=$2) AS status,
    (SELECT count(*)::integer FROM domain_events WHERE payload->>'sessionId'=$2::text) AS outbox`, [binding.id, id]);
  assert.deepEqual(persisted, { assessments: 1, events: 2, status: session.status, outbox: 0 });
  const { session: readBack } = await expectJson(applicantRoot + '/' + id, { actor: applicant });
  assert.equal(readBack.biometric_checks.face_match, 'not_performed');
  assert.notEqual(readBack.status, 'verified');
  assert.equal(readBack.biometric_test_simulations, undefined);
  assert.equal((await request(reviewerRoot + '/' + id, { actor: first })).status, 403);
  const { session: review } = await readCase(first, id);
  assert.deepEqual(review.biometric_test_simulations.map(({ purpose, test_decision, provenance }) =>
    [purpose, test_decision, provenance]), [['face_document_match', 'approved', 'TEST_SIMULATED']]);
  assert.doesNotMatch(JSON.stringify(review.biometric_test_simulations), /provider_session|vendorData|SYNTHETIC-FIELD/);

  const liveReq = randomUUID();
  assert.equal((await start(session, 'liveness', liveReq)).status, 200);
  const live = await stored(session, liveReq);
  const lookupFile = process.env.CARUP_IDV_TEST_VERIFF_LOOKUP_FILE;
  await writeFile(lookupFile, JSON.stringify({ [live.provider_session]: 'unavailable' }));
  assert.equal((await request(recoveryPath(id, liveReq), { actor: applicant, body: {} })).status, 503);
  await writeFile(lookupFile, '{}');
  assert.equal((await expectJson(recoveryPath(id, liveReq), { actor: applicant, body: {} })).biometric.state, 'awaiting_test_decision');
  const declined = decision(live, 'declined');
  await writeFile(lookupFile, JSON.stringify({ [live.provider_session]: { ...declined, vendorData: randomUUID() } }));
  assert.equal((await request(recoveryPath(id, liveReq), { actor: applicant, body: {} })).status, 503);
  await writeFile(lookupFile, JSON.stringify({ [live.provider_session]: declined }));
  await db.query(`ALTER TABLE trust_audit_events ADD CONSTRAINT lr18_fixture_reject_test_audit
    CHECK (event_type <> 'VERIFICATION_BIOMETRIC_TEST_SIMULATION_RECORDED') NOT VALID`);
  try {
    assert.equal((await request(recoveryPath(id, liveReq), { actor: applicant, body: {} })).status, 503);
    assert.equal((await stored(session, liveReq)).decision_status, null);
    const { rows: [assessment] } = await db.query('SELECT count(*)::integer AS count FROM verification_assessments WHERE biometric_request_id=$1', [live.id]);
    assert.equal(assessment.count, 0);
  } finally {
    await db.query('ALTER TABLE trust_audit_events DROP CONSTRAINT lr18_fixture_reject_test_audit');
  }
  assert.equal((await expectJson(recoveryPath(id, liveReq), { actor: applicant, body: {} })).biometric.test_decision, 'declined');
  await outcome(declined, 'duplicate');

  const withdrawn = await createCase();
  await grant(withdrawn, ['liveness']);
  assert.equal((await start(withdrawn, 'face_document_match')).status, 409);
  const withdrawnReq = randomUUID();
  assert.equal((await start(withdrawn, 'liveness', withdrawnReq)).status, 200);
  const old = await stored(withdrawn, withdrawnReq);
  await expectJson(root(withdrawn.id) + '/withdraw', { actor: applicant,
    body: { requestId: randomUUID(), revision: withdrawn.revision } });
  await outcome(decision(old), 'ignored');
  assert.equal((await request(recoveryPath(withdrawn.id, withdrawnReq), { actor: applicant, body: {} })).status, 409);
  await grant(withdrawn, ['liveness']);
  await outcome(decision(old), 'ignored');

  const expiredReq = randomUUID();
  assert.equal((await start(withdrawn, 'liveness', expiredReq)).status, 200);
  const expired = await stored(withdrawn, expiredReq);
  await db.query("UPDATE identity_veriff_test_attempts SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
  await outcome(decision(expired), 'ignored');
  assert.equal((await request(recoveryPath(withdrawn.id, expiredReq), { actor: applicant, body: {} })).status, 409);

  const superseded = await createCase();
  await grant(superseded, ['face_document_match']);
  const supersededReq = randomUUID();
  assert.equal((await start(superseded, 'face_document_match', supersededReq)).status, 200);
  const replaced = await stored(superseded, supersededReq);
  await expectJson(applicantRoot + '/' + superseded.id + '/ocr-confirmation', { actor: applicant,
    body: { idempotencyKey: randomUUID(), revision: superseded.revision,
      fields: { first_name: 'Synthetic', last_name: 'Applicant', national_id_number: 'TEST123456' } } });
  await outcome(decision(replaced), 'ignored');
  assert.equal((await request(recoveryPath(superseded.id, supersededReq), { actor: applicant, body: {} })).status, 409);
  const { rows: [refusals] } = await db.query(`SELECT count(*)::integer AS count FROM trust_audit_events WHERE
    new_value->>'test_attempt_id'=ANY($1::text[])`, [[old.id,expired.id,replaced.id]]);
  assert.equal(refusals.count, 0);
  await db.end();
  console.log('PASS raw signatures, rejection and replay, authenticated applicant and purpose, attempt/session binding, atomic audit, timestamp order, no identity mutation, two simulated outcomes, poll recovery and outage, regrant, withdrawal, expiry and superseded evidence');
  process.exit(0);
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

if (process.argv.includes('--local-ocr') || process.argv.includes('--qualification')) {
  const directory = process.env.CARUP_IDV_TEST_IMAGE_DIR;
  assert.ok(directory);
  async function submitImages(type, front, back) {
    const { session } = await expectJson(applicantRoot, { actor: applicant, body: { documentType: type } }, 201);
    for (const [side, file] of [['front', front], ['back', back], ['selfie', null]]) {
      if (side === 'back' && !file) continue;
      const jpeg = file?.endsWith('.jpg');
      const image = file ? `data:image/${jpeg ? 'jpeg' : 'png'};base64,`
        + (await readFile(join(directory, jpeg ? file : file + '.png'))).toString('base64')
        : fixtureImage(++seed);
      await expectJson(`${applicantRoot}/${session.id}/upload/${side}`, { actor: applicant, body: { image } });
    }
    const before = performance.now();
    const submitted = (await expectJson(`${applicantRoot}/${session.id}/submit`, { actor: applicant, body: {} })).session;
    const elapsed = Math.round(performance.now() - before);
    assert.equal(submitted.status, 'pending_manual_review');
    return { submitted, elapsed };
  }

  if (process.argv.includes('--qualification')) {
    const { session } = await expectJson(applicantRoot, { actor: applicant, body: { documentType: 'national_id' } }, 201);
    for (const side of ['front', 'selfie']) {
      await expectJson(`${applicantRoot}/${session.id}/upload/${side}`, { actor: applicant, body: { image: fixtureImage(++seed) } });
    }
    const missing = await request(`${applicantRoot}/${session.id}/submit`, { actor: applicant, body: {} });
    assert.equal(missing.status, 400);
    assert.doesNotMatch(JSON.stringify(await missing.json()), /storage_path/);
    console.log('PASS missing reverse refused before OCR');
    for (const [type, front, back, expected] of [
      ['passport', 'var-passport', null, ['Anne Marie', 'Dube-Moyo', 'MOCKA1234', '1992-08-12']],
      ['national_id', 'var-id', 'var-id', ['TARIRO', "O'Neil", 'FX-TEST-9083', '1990-06-07']],
      ['drivers_license', 'var-licence.jpg', 'var-licence.jpg', ['NYASHA', 'VAN DER MERWE', 'DEMO-555121', '1995-04-19']],
    ]) {
      // Use a distinct reverse image with the same observed number for sided cases.
      const reverse = back ? (type === 'national_id' ? 'var-id-back' : 'var-licence-back') : null;
      const { submitted, elapsed } = await submitImages(type, front, reverse);
      const detail = (await readCase(first, submitted.id)).session;
      assert.equal(detail.evidence_classification, 'uncertain');
      assert.deepEqual(['first_name','last_name','national_id_number','date_of_birth'].map(field => submitted.ocr_result[field]), expected);
      if (reverse) assert.equal(detail.ocr_side_assessment.comparison, 'consistent_overlap');
      console.log(type, '4/4 expected fields; classification uncertain; latency_ms', elapsed);
    }
    for (const front of ['plain-paper','manipulated-passport','different-layout','missing-label','incomplete-value',
      'invalid-calendar','rotated-passport','low-res-passport','blurred-passport','blank','non-document','non-document-coins','mrz-valid','mrz-invalid']) {
      const { submitted } = await submitImages('passport', front);
      const detail = (await readCase(first, submitted.id)).session;
      assert.notEqual(detail.evidence_classification, 'valid_identity_document');
      assert.ok(!detail.assessment.allowed_actions.includes('approve'));
      assert.equal(submitted.ocr_side_assessment, undefined);
      if (['missing-label','incomplete-value','different-layout'].includes(front)) assert.equal(submitted.ocr_result?.national_id_number, undefined);
      if (['incomplete-value','invalid-calendar'].includes(front)) assert.equal(submitted.ocr_result?.date_of_birth, undefined);
      console.log(front, 'approval refused', detail.primary_reason_code, detail.ocr_side_assessment?.structure?.frontTd3Mrz || '-');
    }
    process.exit(0);
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
  assert.equal((await request(bio + '/assess', { actor: applicant, body: { ...assessment, face_match: 'match', liveness: 'passed' } })).status, 400);
  assert.equal((await request(bio + '/result', { actor: applicant, body: { ...assessment, provider_state: 'completed' } })).status, 404);
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
