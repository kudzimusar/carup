/**
 * Owner device Gate 2 regressions (retest round 2):
 *
 *  P1 — classification consistency: a stored session may never claim
 *  "valid_identity_document" while extraction produced ZERO identity fields
 *  (the rejected case displayed "Valid identity document" beside
 *  "Not an identity document"). The invariant downgrades to `uncertain`.
 *
 *  P1 — RETRY POLICY A: rejection is terminal for the applicant. Creating a
 *  new session while the latest is rejected is refused; a reviewer reopens
 *  the SAME case via request_resubmission, after which the applicant may act.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  createVerificationSession,
  uploadVerificationSessionImage,
  submitVerificationSession,
  reviewVerificationSession,
} = await import('../services/identity/verificationSessionService.js');
const { ForbiddenError } = await import('../utils/errors.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class MockQuery {
  constructor(client, table) {
    this.client = client; this.table = table;
    this.operation = 'select'; this.payload = null; this.filters = [];
  }
  select() { return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  order() { return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  maybeSingle() { return this.execute({ single: true, maybe: true }); }
  single() { return this.execute({ single: true, maybe: false }); }
  then(resolve, reject) { return this.execute({ single: false, maybe: false }).then(resolve, reject); }
  rows() { return (this.client.data[this.table] ||= []); }
  matches(row) { return this.filters.every((f) => row[f.key] === f.value); }
  async execute({ single, maybe }) {
    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map((r) => ({
        id: r.id || `row-${++this.client.sequence}`,
        created_at: r.created_at || new Date(2026, 0, ++this.client.sequence).toISOString(),
        ...clone(r),
      }));
      this.rows().push(...inserted);
      return single ? { data: clone(inserted[0]), error: null } : { data: clone(inserted), error: null };
    }
    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) { Object.assign(row, clone(this.payload)); updated.push(clone(row)); }
      }
      if (single) return { data: updated[0] || null, error: updated.length || maybe ? null : { message: 'No rows updated' } };
      return { data: updated, error: null };
    }
    const rows = this.rows().filter((r) => this.matches(r)).map(clone);
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
    data: {
      verification_sessions: [],
      verification_decisions: [],
      trust_audit_events: [],
      organization_audit_logs: [],
      organization_users: [],
      ocr_documents: [{ id: 'ocr-1', file_path: 'placeholder' }],
      users: [{ id: 'owner-1', name: 'Ruvimbo Chigumba', email: 'ruvimbo@example.test' }],
      verification_ocr_provenance: [],
    },
    from(table) { return new MockQuery(this, table); },
  };
}

const owner = { id: 'owner-1', userId: 'owner-1', role: 'owner', tenantId: null };
const admin = { id: 'admin-1', userId: 'admin-1', role: 'admin', tenantId: null };
const image = 'data:image/jpeg;base64,' + Buffer.from('household-object-book').toString('base64');

let __imgSeq = 0;
function validImage() {
  const buf = Buffer.alloc(3000, (__imgSeq++ % 200) + 30);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

async function uploadedSession(client) {
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, { storage: { uploadToStorage: async () => 'front.jpg' } });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, { storage: { uploadToStorage: async () => 'selfie.jpg' } });
  return session;
}

function submit(client, sessionId, extractedData) {
  return submitVerificationSession(client, owner, sessionId, {
    storage: { downloadFromStorage: async () => ({ buffer: validImage(), mimeType: 'image/jpeg' }) },
    ocr: { extractDocumentData: async () => ({ success: true, ocrDocumentId: 'ocr-1', extractedData }) },
  });
}

// ---------------------------------------------------------------------------
// P1 — classification/extraction consistency invariant
// ---------------------------------------------------------------------------
test('P1: classification may not stay VALID when extraction finds NO identity fields', async () => {
  const client = createMockClient();
  const session = await uploadedSession(client);

  // Provider "succeeds" but extracts nothing (the book/household-object case).
  await submit(client, session.id, {});

  const row = client.data.verification_sessions.find((r) => r.id === session.id);
  assert.equal(row.extraction_trust_status, 'no_fields');
  assert.equal(row.ocr_execution_status, 'provider_succeeded');
  // The invariant: NEVER 'valid_identity_document' alongside zero fields.
  assert.notEqual(row.evidence_classification, 'valid_identity_document');
  assert.equal(row.evidence_classification, 'uncertain');
});

test('P1: classification stays VALID when core identity fields ARE extracted', async () => {
  const client = createMockClient();
  const session = await uploadedSession(client);

  await submit(client, session.id, {
    confidenceScore: 0.95,
    first_name: 'Ruvimbo',
    last_name: 'Chigumba',
    national_id_number: 'ZN0943248',
  });

  const row = client.data.verification_sessions.find((r) => r.id === session.id);
  assert.equal(row.evidence_classification, 'valid_identity_document');
  assert.equal(row.extraction_trust_status, 'partially_trusted');
});

// ---------------------------------------------------------------------------
// P1 — RETRY POLICY A: rejection is terminal; reviewer reopen unblocks
// ---------------------------------------------------------------------------
test('P1 policy A: applicant cannot self-start a new session after rejection; reviewer reopen unblocks', async () => {
  const client = createMockClient();
  const session = await uploadedSession(client);
  await submit(client, session.id, {});

  // Admin terminally rejects.
  const rejected = await reviewVerificationSession(client, admin, session.id, {
    action: 'reject',
    reasonCode: 'NON_DOCUMENT',
    applicantMessage: 'The submitted photo is not an identity document.',
  }, {});
  assert.equal(rejected.decision.action, 'reject');

  // Terminal: a NEW self-serve attempt is refused.
  await assert.rejects(
    () => createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false }),
    ForbiddenError,
  );
  await assert.rejects(
    () => createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false }),
    /closed by a reviewer/i,
  );

  // Reviewer reopens the SAME case (the sanctioned path).
  const reopened = await reviewVerificationSession(client, admin, session.id, {
    action: 'request_resubmission',
    reasonCode: 'DOCUMENT_NOT_VISIBLE',
    applicantMessage: 'Please submit a clear photo of your identity document.',
  }, {});
  assert.equal(reopened.decision.action, 'request_resubmission');

  // The latest session is no longer terminal — a new attempt is allowed again.
  const fresh = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  assert.ok(fresh.id);
});

test('policy A: a user with no rejected history is unaffected', async () => {
  const client = createMockClient();
  const first = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  const second = await createVerificationSession(client, owner, { documentType: 'national_id', doubleSided: true });
  assert.ok(first.id && second.id);
});
