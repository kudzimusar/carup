/**
 * OCR 1.0-C2 — Identity classifier provider convergence.
 *
 * Behavioral proof that the canonical Person Identity classifier uses the same governed vision
 * provider boundary as OCR extraction, sends the real document bytes, persists exact provider/model
 * provenance, fails closed on provider/document failures, and never creates Identity authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { DocumentClassifier, EVIDENCE_CLASSIFICATION } = await import(
  '../services/identity/documentClassifier.js'
);
const { submitVerificationSession } = await import(
  '../services/identity/verificationSessionService.js'
);

const MODEL = '@cf/qwen/qwen3.8-27b';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, '../services/identity/documentClassifier.js'),
  'utf8',
);

function jpeg(fill = 0x41) {
  const b = Buffer.alloc(3000, fill);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff;
  return b;
}

function providerPayload(classification, confidence = 0.98, reason = 'Document visible.') {
  return {
    success: true,
    result: {
      choices: [{
        message: {
          content: JSON.stringify({
            classification,
            classification_confidence: confidence,
            reason,
            // Deliberately malicious/irrelevant personal field: classification must drop it.
            first_name: 'MUST_NOT_ESCAPE_CLASSIFICATION',
          }),
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    },
  };
}

function configureCloudflare(t) {
  const saved = {
    provider: process.env.CARUP_OCR_PROVIDER,
    model: process.env.CARUP_OCR_MODEL,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    mock: process.env.ALLOW_OCR_MOCK,
    gemini: process.env.GEMINI_API_KEY,
  };
  process.env.CARUP_OCR_PROVIDER = 'cloudflare';
  delete process.env.CARUP_OCR_MODEL;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.ALLOW_OCR_MOCK = 'false';
  // Presence of a Gemini key must be irrelevant to the current classifier.
  process.env.GEMINI_API_KEY = 'present-but-not-used';
  t.after(() => {
    const pairs = {
      CARUP_OCR_PROVIDER: saved.provider,
      CARUP_OCR_MODEL: saved.model,
      CLOUDFLARE_ACCOUNT_ID: saved.account,
      CLOUDFLARE_API_TOKEN: saved.token,
      ALLOW_OCR_MOCK: saved.mock,
      GEMINI_API_KEY: saved.gemini,
    };
    for (const [key, value] of Object.entries(pairs)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('C2 source: Identity classifier has no direct Gemini dependency and resolves the governed provider', () => {
  assert.match(source, /resolveVisionProvider/);
  assert.doesNotMatch(source, /GeminiClient/);
  assert.doesNotMatch(source, /askGemini(?:Vision)?/);
  assert.doesNotMatch(source, /GEMINI_API_KEY/);
});

test('C2: classifier sends real front/back bytes through Cloudflare/Qwen and returns exact provenance', async (t) => {
  configureCloudflare(t);
  const front = jpeg(0x51);
  const back = jpeg(0x62);
  const requests = [];

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      async json() { return providerPayload('valid_identity_document'); },
    };
  });

  const result = await DocumentClassifier.classifyDocument(front, back, null, 'national_id');

  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.model, MODEL);
  assert.equal(result.classification, EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT);
  assert.equal(result.first_name, undefined, 'classification must never surface personal-field extraction');
  assert.equal(requests.length, 2, 'front and back are classified independently by the one-image provider transport');

  const frontBody = JSON.stringify(requests[0].body);
  const backBody = JSON.stringify(requests[1].body);
  assert.ok(frontBody.includes(front.toString('base64')), 'front bytes did not reach provider request');
  assert.ok(backBody.includes(back.toString('base64')), 'back bytes did not reach provider request');
  assert.ok(requests.every((r) => r.url.includes(encodeURIComponent(MODEL))), 'wrong model endpoint used');
});

test('C2: governed provider failure fails closed as UNCERTAIN and is not a document verdict', async (t) => {
  configureCloudflare(t);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 503,
    async json() {
      return { success: false, errors: [{ code: 9100, message: 'Workers AI temporarily unavailable' }] };
    },
  }));

  const result = await DocumentClassifier.classifyDocument(jpeg(), null, null, 'passport');
  assert.equal(result.classification, EVIDENCE_CLASSIFICATION.UNCERTAIN);
  assert.equal(result.classificationConfidence, 0);
  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.model, MODEL);
  assert.match(result.reason, /Classification provider error:/);
  assert.match(result.reason, /Workers AI temporarily unavailable/);
});

function clone(v) { return JSON.parse(JSON.stringify(v)); }

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.operation = 'select';
    this.payload = null;
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
      const inserted = rows.map((row) => ({ id: row.id || `row-${++this.client.sequence}`, ...clone(row) }));
      this.rows().push(...inserted);
      return single ? { data: clone(inserted[0]), error: null } : { data: clone(inserted), error: null };
    }
    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) { Object.assign(row, clone(this.payload)); updated.push(clone(row)); }
      }
      if (single) {
        if (!updated.length && !maybe) return { data: null, error: { message: 'No rows updated' } };
        return { data: updated[0] || null, error: null };
      }
      return { data: updated, error: null };
    }
    const rows = this.rows().filter((row) => this.matches(row)).map(clone);
    if (single) {
      if (!rows.length && !maybe) return { data: null, error: { message: 'No rows found' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

function clientWithSession() {
  return {
    sequence: 0,
    data: {
      verification_sessions: [{
        id: 'session-c2',
        user_id: 'owner-c2',
        document_type: 'passport',
        double_sided: false,
        status: 'uploaded',
        front_storage_path: 'owner-c2/session-c2/front.jpg',
        front_mime_type: 'image/jpeg',
        selfie_storage_path: 'owner-c2/session-c2/selfie.jpg',
        selfie_mime_type: 'image/jpeg',
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
      }],
      verification_assessments: [],
      verification_decisions: [],
      verification_ocr_provenance: [],
      trust_audit_events: [],
      organization_audit_logs: [],
      organization_users: [],
      ocr_documents: [{ id: 'ocr-c2', file_path: 'placeholder' }],
      users: [{ id: 'owner-c2', name: 'C2 Specimen Owner' }],
    },
    from(table) { return new MockQuery(this, table); },
  };
}

const owner = { id: 'owner-c2', userId: 'owner-c2', role: 'owner', tenantId: null };

function storageFor(front, selfie) {
  return {
    async downloadFromStorage(_bucket, storagePath) {
      if (storagePath.includes('/front.')) return { buffer: front, mimeType: 'image/jpeg' };
      return { buffer: selfie, mimeType: 'image/jpeg' };
    },
  };
}

test('C2: non-document classifier verdict routes to manual review and never calls OCR extraction', async (t) => {
  configureCloudflare(t);
  const front = jpeg(0x71);
  const selfie = jpeg(0x72);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    async json() { return providerPayload('non_document', 0.99, 'Image shows an object, not a document.'); },
  }));

  const client = clientWithSession();
  let extractionCalls = 0;
  const result = await submitVerificationSession(client, owner, 'session-c2', {
    storage: storageFor(front, selfie),
    ocr: {
      async extractDocumentData() {
        extractionCalls += 1;
        throw new Error('OCR MUST NOT RUN after non_document classification');
      },
    },
  });

  assert.equal(extractionCalls, 0);
  assert.equal(result.status, 'pending_manual_review');
  assert.equal(result.ocr_result, null);
  assert.equal(client.data.verification_decisions.length, 0);
  assert.equal(client.data.verification_assessments.length, 1);
  assert.equal(client.data.verification_assessments[0].provider, 'cloudflare');
  assert.equal(client.data.verification_assessments[0].provider_model, MODEL);
});

test('C2: valid classifier + OCR stay candidate-only and persist exact classifier provider/model', async (t) => {
  configureCloudflare(t);
  const front = jpeg(0x81);
  const selfie = jpeg(0x82);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    async json() { return providerPayload('valid_identity_document', 0.99, 'Identity document visible.'); },
  }));

  const client = clientWithSession();
  const result = await submitVerificationSession(client, owner, 'session-c2', {
    storage: storageFor(front, selfie),
    ocr: {
      async extractDocumentData(_docType, dataUri, userId) {
        assert.equal(userId, 'owner-c2');
        assert.ok(dataUri.includes(front.toString('base64')), 'extraction did not receive the real front bytes');
        return {
          success: true,
          provider: 'cloudflare',
          model: MODEL,
          executionStatus: 'provider_succeeded',
          ocrDocumentId: 'ocr-c2',
          extractedData: {
            confidenceScore: 0.97,
            first_name: 'C2',
            last_name: 'Specimen',
            national_id_number: 'C2-TEST-001',
          },
        };
      },
    },
  });

  assert.equal(result.status, 'pending_manual_review');
  assert.equal(result.evidence_classification, 'valid_identity_document');
  assert.equal(result.ocr_execution_status, 'provider_succeeded');
  assert.equal(client.data.verification_decisions.length, 0, 'classifier/OCR must not create Identity approval authority');

  const assessment = client.data.verification_assessments[0];
  assert.equal(assessment.provider, 'cloudflare');
  assert.equal(assessment.provider_model, MODEL);
  assert.equal(assessment.evidence_classification, 'valid_identity_document');

  const provenance = client.data.verification_ocr_provenance[0];
  assert.equal(provenance.provider, 'cloudflare');
  assert.equal(provenance.model, MODEL);
  assert.equal(provenance.succeeded, true);
});
