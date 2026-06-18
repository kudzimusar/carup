/**
 * Phase 7C Workstream D — OCR provenance persistence.
 *
 * Every automated OCR attempt records WHERE the extracted identity came from
 * (provider/model/mock), the evidence hash, confidence and success/failure —
 * and a provenance write must never block the verification flow.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  createVerificationSession,
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
    this.operation = 'select';
    this.payload = null;
    this.filters = [];
  }
  select() { return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  maybeSingle() { return this.execute({ single: true, maybe: true }); }
  single() { return this.execute({ single: true, maybe: false }); }
  then(resolve, reject) { return this.execute({ single: false, maybe: false }).then(resolve, reject); }
  rows() { return (this.client.data[this.table] ||= []); }
  matches(row) { return this.filters.every((f) => row[f.key] === f.value); }

  async execute({ single, maybe }) {
    // Simulate the provenance table NOT existing (pre-migration) when asked.
    if (this.table === 'verification_ocr_provenance' && this.client.failProvenance) {
      return { data: null, error: { message: 'relation "verification_ocr_provenance" does not exist' } };
    }
    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map((r) => ({ id: r.id || `row-${++this.client.sequence}`, ...clone(r) }));
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
    if (single) return { data: rows[0] || null, error: rows.length || maybe ? null : { message: 'No rows found' } };
    return { data: rows, error: null };
  }
}

function createMockClient() {
  return {
    sequence: 0,
    failProvenance: false,
    data: {
      verification_sessions: [],
      trust_audit_events: [],
      organization_audit_logs: [],
      ocr_documents: [{ id: 'ocr-1', file_path: 'placeholder' }],
      users: [{ id: 'owner-1', name: 'Ruvimbo Chigumba' }],
      verification_ocr_provenance: [],
    },
    from(table) { return new MockQuery(this, table); },
  };
}

const owner = { id: 'owner-1', userId: 'owner-1', role: 'owner', tenantId: null };
const image = 'data:image/jpeg;base64,' + Buffer.from('seed').toString('base64');

function validImage() {
  const buf = Buffer.alloc(3000, 0x33);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

async function uploadedSession(client) {
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, { storage: { uploadToStorage: async () => 'front.jpg' } });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, { storage: { uploadToStorage: async () => 'selfie.jpg' } });
  return session;
}

function submit(client, sessionId, ocrResult, opts = {}) {
  return submitVerificationSession(client, owner, sessionId, {
    storage: { downloadFromStorage: async () => ({ buffer: validImage(), mimeType: 'image/jpeg' }) },
    ocr: { extractDocumentData: async () => ocrResult, ...(opts.ocr || {}) },
  });
}

test('D: a real OCR run records provenance (provider, not mock, hash, confidence, succeeded)', async () => {
  const client = createMockClient();
  const session = await uploadedSession(client);

  await submit(client, session.id, {
    success: true,
    provider: 'gemini',
    ocrDocumentId: 'ocr-1',
    extractedData: { confidenceScore: 0.96, first_name: 'Ruvimbo', last_name: 'Chigumba', national_id_number: 'ZN1' },
  });

  const rows = client.data.verification_ocr_provenance;
  assert.equal(rows.length, 1);
  const p = rows[0];
  assert.equal(p.session_id, session.id);
  assert.equal(p.user_id, 'owner-1');
  assert.equal(p.provider, 'gemini');
  assert.equal(p.is_mock, false);
  assert.equal(p.succeeded, true);
  assert.equal(p.confidence_score, 0.96);
  assert.equal(p.document_type, 'passport');
  assert.ok(p.evidence_hashes && typeof p.evidence_hashes.front === 'string' && p.evidence_hashes.front.length === 64);
  assert.equal(p.metadata.final_status, 'pending_manual_review');
});

test('D: a MOCK/seeded result is flagged is_mock=true (must never be production evidence)', async () => {
  const client = createMockClient();
  const session = await uploadedSession(client);

  await submit(client, session.id, {
    success: true,
    mock: true,
    provider: 'mock',
    ocrDocumentId: 'ocr-1',
    extractedData: { confidenceScore: 0.99, first_name: 'Tinashe', last_name: 'Moyo', national_id_number: 'ZN9' },
  });

  const p = client.data.verification_ocr_provenance.at(-1);
  assert.equal(p.is_mock, true);
  assert.equal(p.provider, 'mock');
});

test('D: a failed OCR run records provenance with succeeded=false and no identity', async () => {
  const client = createMockClient();
  const session = await uploadedSession(client);

  await submit(client, session.id, null, {
    ocr: { extractDocumentData: async () => { throw new Error('OCR provider unavailable'); } },
  });

  const p = client.data.verification_ocr_provenance.at(-1);
  assert.equal(p.succeeded, false);
  assert.match(p.failure_reason, /OCR provider unavailable/);
  assert.equal(p.metadata.final_status, 'ocr_failed');
});

test('D: provenance write failure (e.g. pre-migration) NEVER breaks verification', async () => {
  const client = createMockClient();
  client.failProvenance = true; // simulate table not existing yet
  const session = await uploadedSession(client);

  // Must still resolve to a normal manual-review result despite provenance failing.
  const result = await submit(client, session.id, {
    success: true,
    provider: 'gemini',
    ocrDocumentId: 'ocr-1',
    extractedData: { confidenceScore: 0.9, first_name: 'Ruvimbo', last_name: 'Chigumba', national_id_number: 'ZN1' },
  });

  assert.equal(result.status, 'pending_manual_review');
  assert.equal(client.data.verification_ocr_provenance.length, 0);
});
