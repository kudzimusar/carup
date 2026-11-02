/**
 * PC01-F F3 — evidence is only accepted while the case is the APPLICANT's to prepare, and an upload must
 * be the image it claims to be.
 *
 * Found on #222 by the PC01-F semantic review (carried, inside a wider change, by #208 / RC2 P3): the
 * upload and submit service functions checked ownership only — any session status was accepted.
 *  - A REJECTED applicant could upload fresh evidence to the SAME session and submit it straight back
 *    into review, sidestepping retry policy A (a rejected applicant may not self-start; only a reviewer
 *    reopens the case).
 *  - A VERIFIED session's stored evidence could be replaced after approval, so the images an auditor
 *    opens were no longer the ones the reviewer approved.
 *  - A reviewer's rejection or escalation landing while an upload was in flight was overwritten by the
 *    upload's own status write, and a double submit ran the providers twice.
 * And the payload was trusted: Buffer.from(…, 'base64') silently drops characters outside the alphabet,
 * so arbitrary text was stored as an "image"; the declared MIME type was never compared with the bytes;
 * and nothing under the 2 KB evidence floor was refused until submit.
 *
 * The rule now: upload and submit are open only in the four applicant-owned states the registration
 * wizard offers (draft, captured, uploaded, retry_requested) — anything else is a 409 that stores nothing
 * and changes nothing; both status writes are compare-and-set on those states; and the payload must be
 * strict base64 whose magic bytes match the declared type, between MIN_IMAGE_BYTES and 15 MB. The 15 MB
 * ceiling is deliberately unchanged: the deployed platform refuses request bodies above 4.5 MB, and how
 * to close that gap is the owner's decision (PC01-F F3b), not this fix's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const {
  createVerificationSession,
  uploadVerificationSessionImage,
  submitVerificationSession,
} = await import('../services/identity/verificationSessionService.js');
const { VerificationDecisionRecorder } = await import('../services/identity/decisionRecorder.js');
const { DECISION_ACTION } = await import('../services/identity/caseWorkflow.js');
const { MIN_IMAGE_BYTES } = await import('../services/identity/evidenceValidation.js');
const { ConflictError, ForbiddenError, ValidationError } = await import('../utils/errors.js');

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // unchanged by F3 — see F3b
const SESSION_ID = '5e0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
const owner = { id: 'owner-1', userId: 'owner-1', role: 'owner', tenantId: null };
const APPLICANT_OWNED = ['draft', 'captured', 'uploaded', 'retry_requested'];
const NOT_APPLICANT_OWNED = ['ocr_pending', 'pending_manual_review', 'ocr_failed', 'verified', 'rejected'];
const USERS = [{ id: 'owner-1', role: 'owner', name: 'Rudo Chikore' }, { id: 'admin-1', role: 'admin', name: 'Platform Reviewer' }];

let seq = 0;
/** A JPEG-magic image of `size` bytes; a distinct fill per call keeps front, back and selfie distinct. */
function jpeg(size = 3000) {
  const buf = Buffer.alloc(size, (seq++ % 200) + 30);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}
function png(size = 3000) {
  const buf = Buffer.alloc(size, 0x41);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return buf;
}
const dataUri = (buf, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`;

/** A passport case (single-sided) whose front and selfie are already stored, in the given status. */
function seededWorld(status) {
  return createSupabaseWorld({
    users: USERS,
    verification_sessions: [{
      id: SESSION_ID, user_id: 'owner-1', status, document_type: 'passport', double_sided: false, version: 1,
      front_storage_path: 'owner-1/case/front-original.jpg', front_mime_type: 'image/jpeg',
      selfie_storage_path: 'owner-1/case/selfie-original.jpg', selfie_mime_type: 'image/jpeg',
      created_at: '2026-10-10T08:00:00.000Z', updated_at: '2026-10-10T08:00:00.000Z',
    }],
  });
}
const sessionRow = (w) => w.rows('verification_sessions')[0];

function recordingStorage() {
  const stored = [];
  return {
    stored,
    uploadToStorage: async (bucket, path, buffer, mimeType) => { stored.push({ bucket, path, buffer, mimeType }); return path; },
  };
}

/** Classifier, OCR and storage doubles that count every call — a refused submit must reach none of them. */
function submitProviders() {
  const calls = { download: 0, classify: 0, ocr: 0 };
  return {
    calls,
    options: {
      storage: { downloadFromStorage: async () => { calls.download += 1; return { buffer: jpeg(), mimeType: 'image/jpeg' }; } },
      classifier: {
        classify: async () => {
          calls.classify += 1;
          return {
            classification: 'valid_identity_document', classificationConfidence: 0.95, reasonCode: null, reasons: [], hashes: {},
            extractionAllowed: true, extractionTrust: 'partially_trusted', provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b',
          };
        },
        persistClassification: async () => {},
      },
      ocr: {
        extractDocumentData: async () => {
          calls.ocr += 1;
          return {
            success: true, ocrDocumentId: 'ocr-1', executionStatus: 'provider_succeeded',
            extractedData: { confidenceScore: 0.9, first_name: 'Rudo', last_name: 'Chikore', national_id_number: 'FN123456', provenance: { imageBytesSent: 3000 } },
          };
        },
      },
    },
  };
}

function decide(w, action, reasonCode, applicantMessage = null) {
  const s = sessionRow(w);
  return VerificationDecisionRecorder.recordDecision(w.client, {
    session: s, action, reasonCode, internalNote: null, applicantMessage,
    reviewerId: 'admin-1', reviewerRole: 'admin', currentWorkflowPhase: s.workflow_phase, req: null,
  });
}

/** A client whose case changes status right after the service has READ it — the race a CAS must win. */
function clientChangingStatusAfterRead(w, status) {
  let changed = false;
  return {
    ...w.client,
    from(table) {
      const query = w.client.from(table);
      if (table !== 'verification_sessions' || changed) return query;
      const read = query.maybeSingle;
      query.maybeSingle = async () => {
        const result = await read();
        if (!changed && result.data) { changed = true; sessionRow(w).status = status; }
        return result;
      };
      return query;
    },
  };
}

const isConflict = (err) => err instanceof ConflictError && err.statusCode === 409;
const isInvalid = (pattern) => (err) => err instanceof ValidationError && err.statusCode === 400 && pattern.test(err.message);

// ── the state gate ──────────────────────────────────────────────────────────────────────────────
test('F3: an upload outside the applicant-owned states is a 409 that stores nothing and changes nothing (incl. a VERIFIED case)', async () => {
  for (const status of NOT_APPLICANT_OWNED) {
    const w = seededWorld(status);
    const before = structuredClone(sessionRow(w));
    const storage = recordingStorage();
    await assert.rejects(
      () => uploadVerificationSessionImage(w.client, owner, SESSION_ID, 'front', { image: dataUri(jpeg()) }, { storage }),
      (err) => isConflict(err) && err.message.includes(status),
      status,
    );
    assert.equal(storage.stored.length, 0, `${status}: nothing reached storage`);
    assert.deepEqual(sessionRow(w), before, `${status}: the case — and the evidence a reviewer saw — is untouched`);
  }
});

test('F3: a submit outside the applicant-owned states is a 409 naming the state — no provider is called and the case is untouched', async () => {
  for (const status of NOT_APPLICANT_OWNED) {
    for (const incomplete of [false, true]) {
      const w = seededWorld(status);
      // A closed case with incomplete evidence must still answer "closed", never "missing selfie" — that
      // would send the applicant to an upload that is then refused.
      if (incomplete) sessionRow(w).selfie_storage_path = null;
      const before = structuredClone(sessionRow(w));
      const { calls, options } = submitProviders();
      await assert.rejects(
        () => submitVerificationSession(w.client, owner, SESSION_ID, options),
        (err) => isConflict(err) && err.message.includes(status),
        `${status}${incomplete ? ' (incomplete evidence)' : ''}`,
      );
      assert.deepEqual(calls, { download: 0, classify: 0, ocr: 0 }, `${status}: no provider ran`);
      assert.deepEqual(sessionRow(w), before, `${status}: the case is untouched`);
    }
  }
});

test('F3: every applicant-owned state still accepts an upload — the wizard flow is unchanged', async () => {
  for (const status of APPLICANT_OWNED) {
    const w = seededWorld(status);
    const storage = recordingStorage();
    await uploadVerificationSessionImage(w.client, owner, SESSION_ID, 'front', { image: dataUri(jpeg()) }, { storage });
    assert.equal(storage.stored.length, 1, status);
    assert.equal(sessionRow(w).front_storage_path, storage.stored[0].path, status);
    assert.equal(sessionRow(w).status, 'uploaded', `${status}: complete evidence reads as uploaded`);
  }
});

test('F3: a draft or captured case may call submit and gets the precise missing-evidence answer, not a conflict', async () => {
  const w = createSupabaseWorld({ users: USERS });
  const session = await createVerificationSession(w.client, owner, { documentType: 'national_id', doubleSided: true });
  await assert.rejects(() => submitVerificationSession(w.client, owner, session.id, submitProviders().options), isInvalid(/front document, back document, selfie/));
  await uploadVerificationSessionImage(w.client, owner, session.id, 'front', { image: dataUri(jpeg()) }, { storage: recordingStorage() });
  assert.equal(sessionRow(w).status, 'captured');
  await assert.rejects(() => submitVerificationSession(w.client, owner, session.id, submitProviders().options), isInvalid(/back document, selfie/));
});

// ── the exploit chain, through the real flow ────────────────────────────────────────────────────
test('F3: a rejected applicant cannot put fresh evidence back into review — only a reviewer reopen can', async () => {
  const w = createSupabaseWorld({ users: USERS });
  const session = await createVerificationSession(w.client, owner, { documentType: 'passport' });
  await uploadVerificationSessionImage(w.client, owner, session.id, 'front', { image: dataUri(jpeg()) }, { storage: recordingStorage() });
  await uploadVerificationSessionImage(w.client, owner, session.id, 'selfie', { image: dataUri(jpeg()) }, { storage: recordingStorage() });
  await submitVerificationSession(w.client, owner, session.id, submitProviders().options);
  assert.equal(sessionRow(w).status, 'pending_manual_review');
  await decide(w, DECISION_ACTION.REJECT, 'BLURRY', 'The photo is too blurred to read.');
  assert.equal(sessionRow(w).status, 'rejected');
  const decidedEvidence = { front: sessionRow(w).front_storage_path, selfie: sessionRow(w).selfie_storage_path };

  const storage = recordingStorage();
  const providers = submitProviders();
  await assert.rejects(() => uploadVerificationSessionImage(w.client, owner, session.id, 'front', { image: dataUri(jpeg()) }, { storage }), isConflict);
  await assert.rejects(() => submitVerificationSession(w.client, owner, session.id, providers.options), isConflict);
  await assert.rejects(() => createVerificationSession(w.client, owner, { documentType: 'passport' }), ForbiddenError, 'policy A still holds');
  assert.equal(sessionRow(w).status, 'rejected');
  assert.deepEqual({ front: sessionRow(w).front_storage_path, selfie: sessionRow(w).selfie_storage_path }, decidedEvidence);
  assert.equal(storage.stored.length + providers.calls.ocr + providers.calls.classify, 0);

  // The governed way back in is unchanged: a reviewer requests resubmission on the same case.
  await decide(w, DECISION_ACTION.REQUEST_RESUBMISSION, 'BLURRY', 'Please retake the photo in daylight.');
  assert.equal(sessionRow(w).status, 'retry_requested');
  await uploadVerificationSessionImage(w.client, owner, session.id, 'front', { image: dataUri(jpeg()) }, { storage });
  await submitVerificationSession(w.client, owner, session.id, submitProviders().options);
  assert.equal(sessionRow(w).status, 'pending_manual_review', 'the reopened case is back with a reviewer');
});

// ── the races ───────────────────────────────────────────────────────────────────────────────────
test('F3: a reviewer decision that lands while an upload is in flight is never written over', async () => {
  for (const decided of ['rejected', 'pending_manual_review']) {
    const w = seededWorld('retry_requested');
    const original = sessionRow(w).front_storage_path;
    const storage = { uploadToStorage: async (_bucket, path) => { sessionRow(w).status = decided; return path; } };
    await assert.rejects(
      () => uploadVerificationSessionImage(w.client, owner, SESSION_ID, 'front', { image: dataUri(jpeg()) }, { storage }),
      isConflict,
      decided,
    );
    assert.equal(sessionRow(w).status, decided, `the ${decided} decision stands`);
    assert.equal(sessionRow(w).front_storage_path, original, 'the evidence the reviewer decided on is still the evidence on file');
  }
});

test('F3: the submit transition is compare-and-set — a status change after the read wins, and no provider runs', async () => {
  const w = seededWorld('uploaded');
  const { calls, options } = submitProviders();
  const client = clientChangingStatusAfterRead(w, 'pending_manual_review');
  await assert.rejects(() => submitVerificationSession(client, owner, SESSION_ID, options), isConflict);
  assert.equal(sessionRow(w).status, 'pending_manual_review');
  assert.deepEqual(calls, { download: 0, classify: 0, ocr: 0 });
});

test('F3: a double submit runs the providers once — the second is a 409', async () => {
  const w = seededWorld('uploaded');
  const { calls, options } = submitProviders();
  const results = await Promise.allSettled([
    submitVerificationSession(w.client, owner, SESSION_ID, options),
    submitVerificationSession(w.client, owner, SESSION_ID, options),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.ok(isConflict(results.find((r) => r.status === 'rejected').reason));
  assert.equal(calls.classify, 1);
  assert.equal(calls.ocr, 1);
});

// ── the payload ─────────────────────────────────────────────────────────────────────────────────
test('F3: an upload must be the image it claims to be — otherwise a 400, and nothing is stored', async () => {
  const cases = [
    ['arbitrary text in a data URI', { image: 'data:image/jpeg;base64,not a real document!!' }, /not valid base64/],
    ['base64 of a broken length', { image: 'data:image/jpeg;base64,QUJDA' }, /not valid base64/],
    ['a bare data-URI header', { image: 'data:image/jpeg;base64,' }, /not valid base64/],
    ['text bytes declared as a JPEG', { image: dataUri(Buffer.alloc(3000, 0x61)) }, /not the image type it claims/],
    ['a PNG declared as a JPEG', { image: dataUri(png(), 'image/jpeg') }, /not the image type it claims/],
    ['a JPEG declared as a PNG', { image: dataUri(jpeg(), 'image/png') }, /not the image type it claims/],
    ['raw base64 whose mimeType field lies', { image: jpeg().toString('base64'), mimeType: 'image/webp' }, /not the image type it claims/],
    ['an image one byte under the evidence floor', { image: dataUri(jpeg(MIN_IMAGE_BYTES - 1)) }, /too small/],
    ['one byte over the 15 MB ceiling', { image: dataUri(jpeg(MAX_IMAGE_BYTES + 1)) }, /exceeds the 15MB limit/],
    ['an unsupported type', { image: dataUri(jpeg(), 'image/gif') }, /Unsupported/],
  ];
  for (const [label, payload, pattern] of cases) {
    const w = seededWorld('draft');
    const before = structuredClone(sessionRow(w));
    const storage = recordingStorage();
    await assert.rejects(() => uploadVerificationSessionImage(w.client, owner, SESSION_ID, 'front', payload, { storage }), isInvalid(pattern), label);
    assert.equal(storage.stored.length, 0, `${label}: nothing reached storage`);
    assert.deepEqual(sessionRow(w), before, `${label}: the case is untouched`);
  }
});

test('F3: boundaries — the evidence floor and the 15 MB ceiling are accepted, image/jpg means image/jpeg, wrapped base64 is read whole', async () => {
  const accepted = [
    ['exactly the evidence floor', jpeg(MIN_IMAGE_BYTES), 'image/jpeg', (b) => dataUri(b)],
    ['exactly 15 MB', jpeg(MAX_IMAGE_BYTES), 'image/jpeg', (b) => dataUri(b)],
    ['declared as image/jpg', jpeg(), 'image/jpeg', (b) => dataUri(b, 'image/jpg')],
    ['a real PNG', png(), 'image/png', (b) => dataUri(b, 'image/png')],
    ['base64 wrapped at 76 columns', jpeg(), 'image/jpeg', (b) => dataUri(b).replace(/(.{76})/g, '$1\n')],
  ];
  for (const [label, buf, storedType, encode] of accepted) {
    const w = seededWorld('draft');
    const storage = recordingStorage();
    await uploadVerificationSessionImage(w.client, owner, SESSION_ID, 'front', { image: encode(buf) }, { storage });
    assert.equal(storage.stored.length, 1, label);
    assert.ok(storage.stored[0].buffer.equals(buf), `${label}: the stored bytes are exactly the uploaded image`);
    assert.equal(storage.stored[0].mimeType, storedType, label);
    assert.equal(sessionRow(w).front_mime_type, storedType, label);
  }
});

// ── the shipped routes ──────────────────────────────────────────────────────────────────────────
test('F3 (routes): the shipped endpoints answer 409 for a closed case and 400 for a false image', async () => {
  const w = seededWorld('rejected');
  w.rows('users').forEach((u) => { u.email = `${u.id}@example.invalid`; u.is_verified = false; });
  w.rows('user_sessions').push({ token: 'pc01-f3-owner', user_id: 'owner-1', is_valid: true, expires_at: new Date(Date.now() + 3600 * 1000).toISOString() });
  const { app } = await import('../server.js');
  const { supabase } = await import('../db/supabase.js');
  const restore = installSupabaseWorld(supabase, w);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', 'x-session-token': 'pc01-f3-owner' },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  };
  try {
    const upload = await post(`/api/identity/verification-sessions/${SESSION_ID}/upload/front`, { image: dataUri(jpeg()) });
    assert.equal(upload.status, 409, upload.text.slice(0, 300));
    const submit = await post(`/api/identity/verification-sessions/${SESSION_ID}/submit`, {});
    assert.equal(submit.status, 409, submit.text.slice(0, 300));
    assert.equal(sessionRow(w).status, 'rejected');

    sessionRow(w).status = 'retry_requested';
    const falseImage = await post(`/api/identity/verification-sessions/${SESSION_ID}/upload/front`, { image: 'data:image/jpeg;base64,not a real document!!' });
    assert.equal(falseImage.status, 400, falseImage.text.slice(0, 300));
    assert.equal(w.objects.size, 0, 'nothing reached storage');
    assert.equal(sessionRow(w).front_storage_path, 'owner-1/case/front-original.jpg');
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});
