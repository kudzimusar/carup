import { mockIdentityClaim } from './support/mockIdentityClaim.js';
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  createVerificationSession,
  getVerificationSession,
  submitVerificationSession,
  uploadVerificationSessionImage,
} = await import('../services/identity/verificationSessionService.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.operation = 'select';
    this.payload = null;
  }

  select() {
    return this;
  }

  eq(key, value) {
    this.filters.push({ key, value });
    return this;
  }

  insert(payload) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  maybeSingle() {
    return this.execute({ single: true, maybe: true });
  }

  single() {
    return this.execute({ single: true, maybe: false });
  }

  then(resolve, reject) {
    return this.execute({ single: false, maybe: false }).then(resolve, reject);
  }

  rows() {
    if (!this.client.data[this.table]) this.client.data[this.table] = [];
    return this.client.data[this.table];
  }

  matches(row) {
    return this.filters.every(filter => row[filter.key] === filter.value);
  }

  async execute({ single, maybe }) {
    if ((this.table === 'trust_audit_events' || this.table === 'organization_audit_logs') && this.operation === 'insert' && this.client.failAudit) {
      return { data: null, error: { message: `${this.table} failed` } };
    }

    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map(row => ({
        id: row.id || `session-${++this.client.sequence}`,
        ...(this.table === 'verification_sessions' ? { version: 1 } : {}),
        ...clone(row),
      }));
      this.rows().push(...inserted);
      return single ? { data: clone(inserted[0]), error: null } : { data: clone(inserted), error: null };
    }

    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) {
          Object.assign(row, clone(this.payload));
          updated.push(clone(row));
        }
      }
      if (single) {
        if (!updated.length && !maybe) return { data: null, error: { message: 'No rows updated' } };
        return { data: updated[0] || null, error: null };
      }
      return { data: updated, error: null };
    }

    const rows = this.rows().filter(row => this.matches(row)).map(clone);
    if (single) {
      if (!rows.length && !maybe) return { data: null, error: { message: 'No rows found' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

function createMockClient() {
  return {
    sequence: 0,
    rpc(name, payload) { return mockIdentityClaim(this, name, payload); },
    failAudit: false,
    data: {
      verification_sessions: [],
      trust_audit_events: [],
      organization_audit_logs: [],
      organization_users: [],
      ocr_documents: [{ id: 'ocr-1', file_path: 'placeholder' }],
    },
    from(table) {
      return new MockQuery(this, table);
    },
  };
}

const owner = { id: 'owner-1', userId: 'owner-1', role: 'owner', tenantId: null };
const image = 'data:image/jpeg;base64,' + Buffer.from('not-a-real-document').toString('base64');

// A buffer that passes Workstream C evidence validation (valid JPEG magic,
// non-trivial size) so the OCR-decision path is exercised. Distinct fill per
// call avoids false duplicate detection.
let __imgSeq = 0;
function validImage() {
  const buf = Buffer.alloc(3000, (__imgSeq++ % 200) + 30);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

test('creates verification session and writes audit event', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, {
    documentType: 'national_id',
    doubleSided: true,
  });

  assert.equal(session.status, 'draft');
  assert.equal(session.double_sided, true);
  assert.equal(session.uploaded_sides.front, false);
  assert.equal(client.data.trust_audit_events.at(-1).event_type, 'VERIFICATION_SESSION_CREATED');
});

test('uploads images to private storage and returns sanitized session', async () => {
  const client = createMockClient();
  const uploads = [];
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });

  const updated = await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: {
      uploadToStorage: async (bucket, path, buffer, mimeType) => {
        uploads.push({ bucket, path, bytes: buffer.length, mimeType });
        return path;
      },
    },
  });

  assert.equal(uploads[0].bucket, 'ocr-documents');
  assert.match(uploads[0].path, /^owner-1\/session-1\/front-/);
  assert.equal(updated.uploaded_sides.front, true);
  assert.equal(Object.hasOwn(updated, 'front_storage_path'), false);
  assert.equal(client.data.verification_sessions[0].front_storage_path, uploads[0].path);
});

test('submit requires all requested sides before OCR', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, { documentType: 'national_id', doubleSided: true });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: { uploadToStorage: async () => 'front-path.jpg' },
  });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, {
    storage: { uploadToStorage: async () => 'selfie-path.jpg' },
  });

  await assert.rejects(() => submitVerificationSession(client, owner, session.id), /back document/);
});

test('submit runs OCR but NEVER auto-verifies — routes to manual review (fail closed)', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: { uploadToStorage: async () => 'front-path.jpg' },
  });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, {
    storage: { uploadToStorage: async () => 'selfie-path.jpg' },
  });

  const result = await submitVerificationSession(client, owner, session.id, {
    storage: {
      downloadFromStorage: async () => ({ buffer: validImage(), mimeType: 'image/jpeg' }),
    },
    ocr: {
      extractDocumentData: async (_docType, dataUri) => {
        assert.match(dataUri, /^data:image\/jpeg;base64,/);
        return {
          success: true,
          ocrDocumentId: 'ocr-1',
          extractedData: {
            confidenceScore: 0.96,
            first_name: 'Ruvimbo',
            last_name: 'Chigumba',
            national_id_number: 'ZN0943248',
            country: 'Zimbabwe',
            additional_fields: {
              expiry: '2030-05-18',
              private_note: 'should not surface',
            },
          },
        };
      },
    },
  });

  // P0: even a clean, high-confidence OCR result must NOT auto-verify. Verified
  // is reachable only through admin review of the actual evidence.
  assert.notEqual(result.status, 'verified');
  assert.equal(result.status, 'pending_manual_review');
  assert.match(client.data.verification_sessions[0].failure_reason, /manual review/i);
  // Sanitization still holds: extracted fields surface, private notes stripped.
  assert.equal(result.ocr_result.first_name, 'Ruvimbo');
  assert.equal(result.ocr_result.additional_fields.expiry, '2030-05-18');
  assert.equal(result.ocr_result.additional_fields.private_note, undefined);
  assert.equal(Object.hasOwn(result, 'front_storage_path'), false);
  assert.equal(client.data.ocr_documents[0].file_path, client.data.verification_sessions[0].front_storage_path);
  assert.ok(client.data.trust_audit_events.some(event => event.event_type === 'VERIFICATION_OCR_COMPLETED'));
});

test('P0: a non-document with HALLUCINATED high-confidence identity fields cannot become verified (cup scenario)', async () => {
  const client = createMockClient();
  const session = await createUploadedSession(client);

  // Simulates the real failure mode: a cup image is sent to an OCR provider
  // which hallucinates a plausible Zimbabwe ID with high confidence.
  const result = await submitWithOcr(client, session.id, {
    success: true,
    ocrDocumentId: 'ocr-1',
    extractedData: {
      confidenceScore: 0.98,
      first_name: 'Tafadzwa',
      last_name: 'Moyo',
      national_id_number: '63-123456-A-77',
      country: 'Zimbabwe',
    },
  });

  assert.notEqual(result.status, 'verified');
  assert.equal(result.status, 'pending_manual_review');
});

test('P0: OCR provider failure surfaces NO identity fields (no seeded fallback)', async () => {
  const client = createMockClient();
  const session = await createUploadedSession(client);

  const result = await submitVerificationSession(client, owner, session.id, {
    storage: { downloadFromStorage: async () => ({ buffer: validImage(), mimeType: 'image/jpeg' }) },
    ocr: { extractDocumentData: async () => ({ success: false, error: 'AI_OCR_EXTRACTION_FAILED' }) },
  });

  assert.notEqual(result.status, 'verified');
  assert.ok(['ocr_failed', 'pending_manual_review'].includes(result.status));
  // No seeded identity must appear on a failed extraction.
  const ocr = result.ocr_result || {};
  assert.equal(ocr.first_name, undefined);
  assert.equal(ocr.national_id_number, undefined);
});

test('OCR failure marks session ocr_failed and remains fetchable as sanitized status', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: { uploadToStorage: async () => 'front-path.jpg' },
  });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, {
    storage: { uploadToStorage: async () => 'selfie-path.jpg' },
  });

  const result = await submitVerificationSession(client, owner, session.id, {
    storage: {
      downloadFromStorage: async () => ({ buffer: validImage(), mimeType: 'image/jpeg' }),
    },
    ocr: {
      extractDocumentData: async () => {
        throw new Error('OCR provider unavailable');
      },
    },
  });

  assert.equal(result.status, 'ocr_failed');
  assert.match(client.data.verification_sessions[0].failure_reason, /OCR provider unavailable/);
  assert.equal(Object.hasOwn(result, 'front_storage_path'), false);

  const fetched = await getVerificationSession(client, owner, session.id);
  assert.equal(fetched.status, 'ocr_failed');
});

test('audit failure blocks session creation', async () => {
  const client = createMockClient();
  client.failAudit = true;

  await assert.rejects(
    () => createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false }),
    /Verification audit failed/
  );
});

// --- Phase 7B quality gate: OCR completing is not sufficient evidence ---

async function createUploadedSession(client) {
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: { uploadToStorage: async () => 'front-path.jpg' },
  });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, {
    storage: { uploadToStorage: async () => 'selfie-path.jpg' },
  });
  return session;
}

function submitWithOcr(client, sessionId, ocrResult) {
  return submitVerificationSession(client, owner, sessionId, {
    storage: {
      downloadFromStorage: async () => ({ buffer: validImage(), mimeType: 'image/png' }),
    },
    ocr: { extractDocumentData: async () => ocrResult },
  });
}

test('blank/1x1 image (OCR success with zero confidence, no fields) cannot become verified', async () => {
  const client = createMockClient();
  const session = await createUploadedSession(client);

  const result = await submitWithOcr(client, session.id, {
    success: true,
    ocrDocumentId: 'ocr-1',
    extractedData: { confidenceScore: 0 },
  });

  assert.notEqual(result.status, 'verified');
  assert.equal(result.status, 'pending_manual_review');
  assert.equal(client.data.verification_sessions[0].extraction_trust_status, 'no_fields');
  assert.match(client.data.verification_sessions[0].failure_reason, /requires manual review/);
});

test('high confidence without extracted identity fields cannot become verified', async () => {
  const client = createMockClient();
  const session = await createUploadedSession(client);

  const result = await submitWithOcr(client, session.id, {
    success: true,
    ocrDocumentId: 'ocr-1',
    extractedData: { confidenceScore: 0.99, country: 'Zimbabwe' },
  });

  assert.equal(result.status, 'pending_manual_review');
  assert.equal(client.data.verification_sessions[0].extraction_trust_status, 'untrusted');
  assert.equal(client.data.verification_sessions[0].primary_reason_code, 'REQUIRED_FIELDS_MISSING');
  assert.match(client.data.verification_sessions[0].failure_reason, /requires manual review/);
});

test('identity fields with low confidence cannot become verified', async () => {
  const client = createMockClient();
  const session = await createUploadedSession(client);

  const result = await submitWithOcr(client, session.id, {
    success: true,
    ocrDocumentId: 'ocr-1',
    extractedData: {
      confidenceScore: 0.4,
      first_name: 'Ruvimbo',
      last_name: 'Chigumba',
      national_id_number: 'ZN0943248',
    },
  });

  assert.equal(result.status, 'pending_manual_review');
  // Has identity fields but identity binding is indeterminate (no account user)
  assert.equal(client.data.verification_sessions[0].extraction_trust_status, 'partially_trusted');
  assert.equal(client.data.verification_sessions[0].primary_reason_code, null);
  assert.notEqual(client.data.verification_sessions[0].failure_reason, null);
});

test('P0/C: a non-image / tiny front (cup-as-blank, screenshot) fails closed before OCR', async () => {
  const client = createMockClient();
  const session = await createUploadedSession(client);

  let ocrCalled = false;
  const result = await submitVerificationSession(client, owner, session.id, {
    storage: {
      // 12-byte non-image buffer — fails Workstream C validation.
      downloadFromStorage: async () => ({ buffer: Buffer.from('not an image'), mimeType: 'image/jpeg' }),
    },
    ocr: {
      extractDocumentData: async () => { ocrCalled = true; return { success: true, extractedData: { confidenceScore: 0.99, first_name: 'X', last_name: 'Y', national_id_number: 'Z' } }; },
    },
  });

  assert.equal(ocrCalled, false); // OCR must not run on invalid evidence
  assert.notEqual(result.status, 'verified');
  assert.equal(result.status, 'pending_manual_review');
  assert.match(client.data.verification_sessions[0].failure_reason, /too small|not a supported/);
  // No identity fields populated from a non-document.
  assert.ok(!result.ocr_result || result.ocr_result.first_name === undefined);
});

test('F: account/document identity MISMATCH is surfaced (and never auto-verifies)', async () => {
  const client = createMockClient();
  client.data.users = [{ id: 'owner-1', name: 'Phase7B Tester' }];
  const session = await createUploadedSession(client);

  const result = await submitWithOcr(client, session.id, {
    success: true,
    ocrDocumentId: 'ocr-1',
    extractedData: {
      confidenceScore: 0.98,
      first_name: 'Tafadzwa',
      last_name: 'Moyo',
      national_id_number: '63-123456-A-77',
      country: 'Zimbabwe',
    },
  });

  assert.notEqual(result.status, 'verified');
  assert.equal(result.status, 'pending_manual_review');
  assert.match(client.data.verification_sessions[0].failure_reason, /Identity mismatch/i);
  assert.match(client.data.verification_sessions[0].review_notes, /MISMATCH/);
  assert.match(client.data.verification_sessions[0].review_notes, /Phase7B Tester/);
  assert.match(client.data.verification_sessions[0].review_notes, /Tafadzwa Moyo/);
  const ocrEvent = client.data.trust_audit_events.find(e => e.event_type === 'VERIFICATION_OCR_COMPLETED');
  assert.equal(ocrEvent.new_value.identity_binding, 'mismatch');
});

test('F: matching account/document identity is NOT flagged as a mismatch', async () => {
  const client = createMockClient();
  client.data.users = [{ id: 'owner-1', name: 'Ruvimbo Chigumba' }];
  const session = await createUploadedSession(client);

  const result = await submitWithOcr(client, session.id, {
    success: true,
    ocrDocumentId: 'ocr-1',
    extractedData: {
      confidenceScore: 0.98,
      first_name: 'Ruvimbo',
      last_name: 'Chigumba',
      national_id_number: 'ZN0943248',
    },
  });

  assert.equal(result.status, 'pending_manual_review');
  assert.doesNotMatch(client.data.verification_sessions[0].failure_reason, /Identity mismatch/i);
  assert.doesNotMatch(client.data.verification_sessions[0].review_notes, /MISMATCH/);
});

test('evaluateOcrEvidence unit cases', async () => {
  const { evaluateOcrEvidence } = await import('../services/identity/verificationSessionService.js');

  assert.equal(evaluateOcrEvidence({ success: false }).sufficient, false);
  assert.equal(evaluateOcrEvidence({ success: true, extractedData: {} }).sufficient, false);
  assert.equal(evaluateOcrEvidence({ success: true, extractedData: { confidenceScore: 0.9, national_id_number: '  ' } }).sufficient, false);
  assert.equal(
    evaluateOcrEvidence({ success: true, extractedData: { confidenceScore: 0.9, national_id_number: 'ZN1' } }).sufficient,
    true
  );
  assert.equal(
    evaluateOcrEvidence({ success: true, extractedData: { confidenceScore: 0.9, first_name: 'A', last_name: 'B' } }).sufficient,
    true
  );
});

test('applicant detail is self-scoped for all roles and omits private review data', async () => {
  const client = createMockClient();
  client.data.verification_sessions.push({
    id: 'private-case', user_id: owner.id, status: 'pending_manual_review',
    review_notes: 'private note', reviewer_identity: 'reviewer', failure_reason: 'private exception',
    front_storage_path: 'private/path', ocr_result: { first_name: 'Test', secret: 'hidden' },
  });
  const own = await getVerificationSession(client, owner, 'private-case');
  assert.equal(own.ocr_result.first_name, 'Test');
  for (const key of ['review_notes', 'reviewer_identity', 'failure_reason', 'front_storage_path']) {
    assert.equal(Object.hasOwn(own, key), false);
  }
  for (const role of ['buyer', 'admin', 'government']) {
    await assert.rejects(() => getVerificationSession(client, { id: 'other', role }, 'private-case'), /not found/i);
  }
});

test('submission claim admits one processor and repeated pending submission is stable', async () => {
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'atomic-case', user_id: owner.id, status: 'uploaded', version: 1,
    document_type: 'passport', double_sided: false, front_storage_path: 'front', selfie_storage_path: 'selfie' });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let downloads = 0;
  const first = submitVerificationSession(client, owner, 'atomic-case', { ocr: {}, storage: {
    downloadFromStorage: async () => { downloads++; await hold; throw new Error('provider offline'); },
  } });
  while (downloads === 0) await new Promise(resolve => setImmediate(resolve));
  const second = await submitVerificationSession(client, owner, 'atomic-case');
  assert.equal(second.status, 'ocr_pending');
  assert.equal(downloads, 1);
  assert.equal(client.data.trust_audit_events.filter(e => e.event_type === 'VERIFICATION_SUBMITTED').length, 1);
  release();
  const done = await first;
  assert.equal(done.status, 'ocr_failed');
  assert.equal(client.data.verification_sessions[0].version, 3);
});

test('a late processor cannot overwrite a reviewer decision', async () => {
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'stale-case', user_id: owner.id, status: 'uploaded', version: 1,
    document_type: 'passport', double_sided: false, front_storage_path: 'front', selfie_storage_path: 'selfie' });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let started = false;
  const task = submitVerificationSession(client, owner, 'stale-case', { ocr: {}, storage: {
    downloadFromStorage: async () => { started = true; await hold; throw new Error('late error'); },
  } });
  while (!started) await new Promise(resolve => setImmediate(resolve));
  Object.assign(client.data.verification_sessions[0], { status: 'rejected', version: 3, review_decision: 'reject' });
  release();
  await assert.rejects(task, /changed during processing/);
  assert.equal(client.data.verification_sessions[0].status, 'rejected');
  assert.equal(client.data.trust_audit_events.filter(e => e.event_type === 'VERIFICATION_OCR_FAILED').length, 0);
});

test('terminal and processing cases cannot accept replacement images', async () => {
  for (const status of ['ocr_pending', 'pending_manual_review', 'verified', 'rejected']) {
    const client = createMockClient();
    client.data.verification_sessions.push({ id: 'locked', user_id: owner.id, status, version: 1 });
    let uploads = 0;
    await assert.rejects(() => uploadVerificationSessionImage(client, owner, 'locked', 'front', { image }, {
      storage: { uploadToStorage: async () => { uploads++; } },
    }), /cannot be changed/);
    assert.equal(uploads, 0);
  }
});

test('simultaneous submits claim one processing attempt', async () => {
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'race', user_id: owner.id, status: 'uploaded', version: 1,
    document_type: 'passport', double_sided: false, front_storage_path: 'front', selfie_storage_path: 'selfie' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let downloads = 0;
  const opts = { ocr: {}, storage: { downloadFromStorage: async () => { downloads++; await gate; throw new Error('offline'); } } };
  const first = submitVerificationSession(client, owner, 'race', opts);
  const second = submitVerificationSession(client, owner, 'race', opts);
  while (!downloads) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(downloads, 1);
  release();
  const outcomes = await Promise.all([first, second]);
  assert.ok(outcomes.every(x => ['ocr_pending', 'ocr_failed'].includes(x.status)));
  assert.equal(client.data.trust_audit_events.filter(x => x.event_type === 'VERIFICATION_SUBMITTED').length, 1);
});

test('upload losing a version race removes its unattached object', async () => {
  const client = createMockClient();
  const row = { id: 'upload-race', user_id: owner.id, status: 'uploaded', version: 1,
    document_type: 'passport', double_sided: false, front_storage_path: 'old', selfie_storage_path: 'selfie' };
  client.data.verification_sessions.push(row);
  let removed;
  await assert.rejects(() => uploadVerificationSessionImage(client, owner, 'upload-race', 'front', { image }, {
    storage: {
      uploadToStorage: async () => { row.status = 'ocr_pending'; row.version++; },
      removeFromStorage: async (bucket, path) => { removed = [bucket, path]; },
    },
  }), /changed while/);
  assert.equal(removed[0], 'ocr-documents');
  assert.match(removed[1], /front-/);
  assert.equal(row.front_storage_path, 'old');
});

test('review decision and idempotent replay project reviewer fields without private paths', async () => {
  const { reviewVerificationSession } = await import('../services/identity/verificationSessionService.js');
  const { VerificationDecisionRecorder } = await import('../services/identity/decisionRecorder.js');
  const original = VerificationDecisionRecorder.recordDecision;
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'review-case', user_id: owner.id, status: 'pending_manual_review',
    front_storage_path: 'private/front', selfie_storage_path: 'private/selfie', review_notes: 'internal note' });
  try {
    for (const replay of [false, true]) {
      VerificationDecisionRecorder.recordDecision = async () => ({ session: client.data.verification_sessions[0], idempotent_replay: replay });
      const result = await reviewVerificationSession(client, { id: 'reviewer', role: 'admin' }, 'review-case', { action: 'reject' });
      assert.equal(result.session.review_notes, 'internal note');
      assert.equal(Object.hasOwn(result.session, 'front_storage_path'), false);
      assert.equal(Object.hasOwn(result.session, 'selfie_storage_path'), false);
    }
    await assert.rejects(() => reviewVerificationSession(client, owner, 'review-case', { action: 'reject' }), /admin role/i);
  } finally {
    VerificationDecisionRecorder.recordDecision = original;
  }
});

test('identity OCR is unavailable by default and does not invoke legacy OCR or download evidence', async () => {
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'no-provider', user_id: owner.id, status: 'uploaded', version: 1,
    document_type: 'passport', double_sided: false, front_storage_path: 'front', selfie_storage_path: 'selfie' });
  let downloads = 0;
  const result = await submitVerificationSession(client, owner, 'no-provider', {
    storage: { downloadFromStorage: async () => { downloads++; throw new Error('unexpected download'); } },
  });
  assert.equal(result.status, 'ocr_failed');
  assert.equal(result.ocr_result, null);
  assert.equal(downloads, 0);
  assert.equal(Object.hasOwn(result, 'failure_reason'), false);
});

test('rejected case cannot be submitted, even when evidence is missing', async () => {
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'closed', user_id: owner.id, status: 'rejected', version: 4 });
  await assert.rejects(() => submitVerificationSession(client, owner, 'closed'), /cannot be submitted/);
  assert.equal(client.data.verification_sessions[0].status, 'rejected');
});

test('upload provider errors do not escape to the applicant', async () => {
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'upload-error', user_id: owner.id, status: 'draft', version: 1 });
  await assert.rejects(() => uploadVerificationSessionImage(client, owner, 'upload-error', 'front', { image }, {
    storage: { uploadToStorage: async () => { throw new Error('private bucket and credentials'); } },
  }), error => error.message === 'Verification image upload failed.');
});

test('new OCR cases cannot be approved before the applicant confirms', async () => {
  const { reviewVerificationSession } = await import('../services/identity/verificationSessionService.js');
  const client = createMockClient();
  client.data.verification_sessions.push({ id: 'unconfirmed', user_id: owner.id, status: 'pending_manual_review',
    ocr_confirmation_required: true, ocr_confirmed_at: null, version: 3 });
  await assert.rejects(() => reviewVerificationSession(client, { id: 'reviewer', role: 'admin' }, 'unconfirmed', { action: 'approve' }), /confirmation is required/i);
  assert.equal(client.data.verification_sessions[0].status, 'pending_manual_review');
});

test('expired processing lease may be reclaimed while a fresh claim cannot', async () => {
  const client = createMockClient();
  const row = { id: 'lease', user_id: owner.id, status: 'ocr_pending', version: 2,
    document_type: 'passport', double_sided: false, front_storage_path: 'front', selfie_storage_path: 'selfie', ocr_started_at: new Date().toISOString() };
  client.data.verification_sessions.push(row);
  let downloads = 0;
  const opts = { ocr: {}, storage: { downloadFromStorage: async () => { downloads++; throw new Error('offline'); } } };
  assert.equal((await submitVerificationSession(client, owner, 'lease', opts)).status, 'ocr_pending');
  assert.equal(downloads, 0);
  row.ocr_started_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  assert.equal((await submitVerificationSession(client, owner, 'lease', opts)).status, 'ocr_failed');
  assert.equal(downloads, 1);
  assert.equal(row.version, 4);
});

test('expired worker cannot overwrite its replacement attempt', async () => {
  const client = createMockClient();
  const row = { id: 'lease-race', user_id: owner.id, status: 'uploaded', version: 1,
    document_type: 'passport', double_sided: false, front_storage_path: 'front', selfie_storage_path: 'selfie' };
  client.data.verification_sessions.push(row);
  let release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  const first = submitVerificationSession(client, owner, 'lease-race', { ocr: {}, storage: { downloadFromStorage: async () => { started = true; await gate; throw new Error('old failure'); } } });
  while (!started) await new Promise(resolve => setImmediate(resolve));
  row.ocr_started_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const second = await submitVerificationSession(client, owner, 'lease-race', { ocr: {}, storage: { downloadFromStorage: async () => { throw new Error('new failure'); } } });
  assert.equal(second.status, 'ocr_failed');
  const version = row.version;
  release();
  await assert.rejects(first, /changed during processing/);
  assert.equal(row.status, 'ocr_failed'); assert.equal(row.version, version);
  assert.equal(client.data.trust_audit_events.filter(e => e.event_type === 'VERIFICATION_OCR_FAILED').length, 1);
});
