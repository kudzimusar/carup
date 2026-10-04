import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  GARAGE_EVIDENCE_TYPES,
  EXTRACTION_STATE,
  acknowledgeExtraction,
  garageOcrAvailability,
  getOwnEvidencePreview,
  isExtractionEnabled,
  runEvidenceExtraction,
  sanitizeEvidence,
} = await import('../services/garageOnboarding/garageEvidenceService.js');
const { submissionBlockers } = await import('../services/garageOnboarding/garageApplicationService.js');

const USER = 'garage-user-c3';
const APP = 'garage-app-c3';
const DOC = 'garage-doc-c3';
const actor = { id: USER, userId: USER, role: 'owner' };
const profile = {
  user_id: USER,
  account_kind: 'business',
  business_type: 'garage',
  organization_name: 'Specimen Motors',
  onboarding_status: 'requested',
};
const application = { id: APP, applicant_user_id: USER, status: 'draft' };
const documentRow = {
  id: DOC,
  application_id: APP,
  uploaded_by_user_id: USER,
  evidence_type: 'utility_bill',
  file_ref: 'garage-onboarding/garage-app-c3/utility.png',
  mime_type: 'image/png',
  size_bytes: 2048,
  extraction_state: 'not_attempted',
  extraction_candidates: null,
  extraction_provider: null,
  extraction_model: null,
  extraction_confidence: null,
  extraction_note: null,
  removed_at: null,
};

// The canonical boundary's certified model. Garage holds no copy of it; the tests name it only to
// prove Garage records what the boundary and Document Intelligence report.
const QWEN = '@cf/qwen/qwen3.8-27b';
const ENABLED = { GARAGE_OCR_ENABLED: 'true' };
// A configured canonical provider, injected the same way production resolves one. Readiness is
// asked of THIS object, and the same object is handed to Document Intelligence for the run.
const readyProvider = {
  id: 'cloudflare',
  model: QWEN,
  isConfigured: () => true,
  requiredEnv: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  async extract() { throw new Error('the injected Document Intelligence double answers; Garage never calls the provider directly'); },
};
const READY = { env: ENABLED, visionProvider: readyProvider };

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function mockClient(overrides = {}, writes = []) {
  const tables = {
    user_registration_profiles: [clone(profile)],
    garage_applications: [clone(application)],
    garage_application_documents: [clone(documentRow)],
    audit_logs: [],
    ...overrides,
  };

  return {
    from(table) {
      let op = 'select';
      let payload = null;
      const filters = [];
      let head = false;
      const chain = {
        select(_columns, options) { if (options?.head) head = true; return chain; },
        insert(value) { op = 'insert'; payload = value; return chain; },
        update(value) { op = 'update'; payload = value; return chain; },
        eq(key, value) { filters.push(['eq', key, value]); return chain; },
        is(key, value) { filters.push(['is', key, value]); return chain; },
        in(key, value) { filters.push(['in', key, value]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() { return execute(true); },
        single() { return execute(true); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };

      function matches(row) {
        return filters.every(([kind, key, value]) => {
          if (kind === 'eq') return row?.[key] === value;
          if (kind === 'is') return row?.[key] === value;
          if (kind === 'in') return Array.isArray(value) && value.includes(row?.[key]);
          return true;
        });
      }

      function execute(single) {
        const source = typeof tables[table] === 'function'
          ? tables[table]({ op, payload, filters })
          : tables[table];
        if (source && !Array.isArray(source) && ('data' in source || 'error' in source)) return source;

        const rows = Array.isArray(source) ? source : (source ? [source] : []);
        if (op === 'update') {
          writes.push({ table, op, payload: clone(payload), filters: clone(filters) });
          const updated = rows.filter(matches).map((row) => ({ ...clone(row), ...clone(payload) }));
          return single ? { data: updated[0] || null, error: null } : { data: updated, error: null };
        }
        if (op === 'insert') {
          writes.push({ table, op, payload: clone(payload), filters: clone(filters) });
          const row = { id: payload.id || 'inserted-row', ...clone(payload) };
          return single ? { data: row, error: null } : { data: [row], error: null };
        }
        const selected = rows.filter(matches).map(clone);
        if (head) return { data: null, count: selected.length, error: null };
        return single ? { data: selected[0] || null, error: null } : { data: selected, error: null };
      }
      return chain;
    },
  };
}

const storage = {
  async downloadFromStorage() {
    return { buffer: Buffer.from('garage-real-image-bytes'), mimeType: 'image/png' };
  },
  async generateSecureReadUrl() {
    return 'https://signed.example.test/evidence?token=short-lived';
  },
};

/** The exact result shape canonical Document Intelligence returns for a provider reading. */
function successOcr(extra = {}, top = {}) {
  return {
    success: true,
    provider: 'cloudflare',
    model: QWEN,
    executionStatus: 'provider_succeeded',
    confidence: 0.91,
    confidenceReported: true,
    extractedData: {
      trading_name: 'Specimen Motors',
      additional_fields: { physical_address: '12 Test Road' },
      confidenceScore: 0.91,
      ...extra,
    },
    ...top,
  };
}

test('C3 readiness = Garage feature policy AND the canonical provider is ready — nothing else', () => {
  assert.equal(isExtractionEnabled({}), false, 'off unless the deployment turns it on');
  assert.equal(isExtractionEnabled({}, { provider: readyProvider }), false, 'a ready provider does not switch the feature on');
  assert.equal(isExtractionEnabled(ENABLED, { provider: { ...readyProvider, isConfigured: () => false } }), false);
  assert.equal(isExtractionEnabled(ENABLED, { provider: readyProvider }), true);
  const ready = garageOcrAvailability(ENABLED, { provider: readyProvider });
  assert.equal(ready.available, true);
  assert.equal(ready.reason, null);
  assert.equal(ready.provider, 'cloudflare');
  assert.equal(ready.model, QWEN);
  // The canonical boundary refuses a rejected model by throwing from `model`; Garage reports that as
  // not ready instead of substituting a model of its own.
  const refused = { ...readyProvider, get model() { throw new Error('Refusing to use a rejected model'); } };
  assert.equal(garageOcrAvailability(ENABLED, { provider: refused }).available, false);
});

test('C3 Garage holds no provider or model of its own — the canonical boundary decides', () => {
  // Real boundary, no injection: the canonical default resolves to Cloudflare/Qwen. It is not READY
  // here only because this test process has no Cloudflare credentials.
  const ambient = garageOcrAvailability(ENABLED);
  assert.equal(ambient.provider, 'cloudflare');
  assert.equal(ambient.model, QWEN);
  assert.equal(ambient.available, false);
  assert.equal(ambient.reason, 'canonical_provider_not_ready');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '../services/garageOnboarding/garageEvidenceService.js'), 'utf8');
  assert.doesNotMatch(source, /@cf\/|qwen|gemma|llama/i, 'Garage names a model: model choice belongs to the canonical boundary');
  assert.doesNotMatch(source, /=== 'cloudflare'|GARAGE_OCR_PROVIDER|GARAGE_OCR_MODEL/, 'Garage pins a provider');
});

test('C3 preserves the broad Garage evidence catalogue without making incorporation mandatory', () => {
  for (const type of ['premises_photo','signage_photo','utility_bill','lease_or_title','council_or_trade_licence','company_registration','tax_document','bank_or_mobile_money_statement','other']) {
    assert.ok(GARAGE_EVIDENCE_TYPES.includes(type));
  }
  const complete = {
    trading_name: 'Specimen Motors',
    address_line: '12 Test Road',
    location_city: 'Harare',
    contact_phone: '+263700000000',
    applicant_relationship: 'owner',
    service_categories: ['general_service'],
    attestation_accepted_at: '2026-10-02T00:00:00Z',
  };
  assert.deepEqual(submissionBlockers(complete, 1), []);
});

test('C3 private storage path is never returned to the browser projection', () => {
  const safe = sanitizeEvidence(documentRow);
  assert.equal(safe.file_ref, undefined);
  assert.equal(safe.has_file, true);
  assert.equal(JSON.stringify(safe).includes('garage-onboarding/'), false);
});

test('C3 successful OCR uses business_document and produces candidates only', async () => {
  const writes = [];
  const client = mockClient({}, writes);
  const calls = [];
  const out = await runEvidenceExtraction(client, actor, APP, DOC, {
    ...READY,
    storage,
    ocr: {
      async extractDocumentData(docType, dataUri, userId, options) {
        calls.push({ docType, dataUri, userId, options });
        return successOcr();
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].docType, 'business_document');
  assert.equal(calls[0].userId, USER);
  assert.match(calls[0].dataUri, /^data:image\/png;base64,/);
  assert.equal(calls[0].options.visionProvider, readyProvider, 'DI reads with the provider that answered ready');
  assert.equal(out.extraction_state, EXTRACTION_STATE.AWAITING_CONFIRMATION);
  assert.equal(out.candidates.trading_name.state, 'machine_candidate');
  assert.equal(out.candidates.trading_name.value, 'Specimen Motors');
  assert.equal(out.candidates.address_line.value, '12 Test Road');
  assert.equal(out.candidates.location_city.state, 'missing');
  assert.equal(out.document.extraction_provider, 'cloudflare');
  assert.equal(out.document.extraction_model, QWEN);
  assert.equal(writes.some((w) => w.table === 'garage_applications'), false);
});

test('C3 null-like OCR text is never converted into applicant data', async () => {
  const client = mockClient();
  const out = await runEvidenceExtraction(client, actor, APP, DOC, {
    ...READY,
    storage,
    ocr: { async extractDocumentData() {
      return successOcr({
        trading_name: 'Real Garage',
        additional_fields: { physical_address: 'N/A', city: 'null' },
      });
    } },
  });
  assert.equal(out.candidates.trading_name.state, 'machine_candidate');
  assert.equal(out.candidates.trading_name.value, 'Real Garage');
  assert.equal(out.candidates.address_line.state, 'missing');
  assert.equal(out.candidates.location_city.state, 'missing');
});

test('C3 provider failure is FAILED and leaves the manual application path untouched', async () => {
  const writes = [];
  const client = mockClient({}, writes);
  const out = await runEvidenceExtraction(client, actor, APP, DOC, {
    ...READY,
    storage,
    ocr: { async extractDocumentData() { throw new Error('provider transport unavailable'); } },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.FAILED);
  assert.match(out.document.extraction_note, /type the details in yourself/i);
  assert.equal(writes.some((w) => w.table === 'garage_applications'), false);
});

test('C3 unconfigured OCR is UNAVAILABLE, distinct from provider failure', async () => {
  let calls = 0;
  const client = mockClient();
  const out = await runEvidenceExtraction(client, actor, APP, DOC, {
    env: ENABLED,
    visionProvider: { ...readyProvider, isConfigured: () => false },
    storage,
    ocr: { async extractDocumentData() { calls += 1; return successOcr(); } },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.UNAVAILABLE);
  assert.equal(calls, 0);
  assert.match(out.document.extraction_note, /type the details in yourself/i);
});

test('C3 premises/signage evidence never invokes document extraction', async () => {
  for (const evidence_type of ['premises_photo', 'signage_photo']) {
    let calls = 0;
    const client = mockClient({
      garage_application_documents: [{ ...documentRow, evidence_type }],
    });
    const out = await runEvidenceExtraction(client, actor, APP, DOC, {
      ...READY,
      storage,
      ocr: { async extractDocumentData() { calls += 1; return successOcr(); } },
    });
    assert.equal(out.extraction_state, EXTRACTION_STATE.UNAVAILABLE);
    assert.equal(calls, 0);
  }
});

test('C3 PDF is valid evidence but unsupported for current image OCR transport', async () => {
  let calls = 0;
  const client = mockClient({
    garage_application_documents: [{ ...documentRow, mime_type: 'application/pdf', file_ref: 'garage-onboarding/a/bill.pdf' }],
  });
  const out = await runEvidenceExtraction(client, actor, APP, DOC, {
    ...READY,
    storage,
    ocr: { async extractDocumentData() { calls += 1; return successOcr(); } },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.UNAVAILABLE);
  assert.equal(calls, 0);
  assert.match(out.document.extraction_note, /PDFs is not available/i);
});

test('C3 low-confidence extraction remains a warning state, not verified evidence', async () => {
  const client = mockClient();
  const out = await runEvidenceExtraction(client, actor, APP, DOC, {
    ...READY,
    storage,
    ocr: { async extractDocumentData() { return successOcr({ confidenceScore: 0.31 }, { confidence: 0.31 }); } },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.LOW_CONFIDENCE);
  assert.equal(out.document.extraction_confidence, 0.31);
  assert.match(out.document.extraction_note, /not confident/i);
});

test('C3 applicant confirmation records reviewed candidates only', async () => {
  const writes = [];
  const client = mockClient({
    garage_application_documents: [{
      ...documentRow,
      extraction_state: 'awaiting_confirmation',
      extraction_candidates: { trading_name: { state: 'machine_candidate', value: 'Specimen Motors' } },
    }],
  }, writes);
  const out = await acknowledgeExtraction(client, actor, APP, DOC);
  assert.equal(out.document.extraction_state, EXTRACTION_STATE.CONFIRMED);
  assert.equal(writes.some((w) => w.table === 'garage_applications'), false);
  assert.equal(writes.some((w) => ['tenants','tenant_users'].includes(w.table)), false);
});

test('C3 extraction touches no Garage approval, tenant, Trust or Seller Authority ledger', async () => {
  const writes = [];
  const client = mockClient({}, writes);
  await runEvidenceExtraction(client, actor, APP, DOC, {
    ...READY,
    storage,
    ocr: { async extractDocumentData() { return successOcr(); } },
  });
  const forbidden = new Set([
    'garage_applications','tenants','tenant_users','vehicles','trust_score_history',
    'vehicle_trust_decisions','vehicle_seller_authority',
  ]);
  assert.deepEqual(writes.filter((w) => forbidden.has(w.table)), []);
});

test('C3 evidence preview is short-lived and does not reveal the server storage path', async () => {
  const client = mockClient();
  const out = await getOwnEvidencePreview(client, actor, APP, DOC, { storage });
  assert.match(out.url, /^https:\/\//);
  assert.equal(out.expiresInSeconds, 180);
  assert.equal(out.url.includes('garage-onboarding'), false);
});

test('C3 migrations force RLS and revoke direct browser access without importing later #209 authority', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(here, '../..');
  const rls = readFileSync(path.join(root, 'database/migrations/20260918110000_ocr_c3_garage_onboarding_rls.sql'), 'utf8');
  for (const table of ['garage_applications','garage_application_decisions','garage_application_documents']) {
    assert.match(rls, new RegExp('ALTER TABLE public\\.' + table + '[\\s\\S]*?ENABLE ROW LEVEL SECURITY'));
    assert.match(rls, new RegExp('ALTER TABLE public\\.' + table + '[\\s\\S]*?FORCE ROW LEVEL SECURITY'));
    assert.match(rls, new RegExp('REVOKE ALL ON public\\.' + table + ' FROM PUBLIC, anon, authenticated'));
  }
  assert.doesNotMatch(rls, /garage_invitations|activate_garage_application/);
});

test('C3 source has one provider boundary and no direct Gemini/Garage-specific OCR schema', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '../services/garageOnboarding/garageEvidenceService.js'), 'utf8');
  assert.match(source, /resolveVisionProvider/);
  assert.match(source, /DocumentIntelligenceService/);
  assert.match(source, /extractDocumentData\('business_document'/);
  assert.doesNotMatch(source, /GeminiClient|askGemini|GEMINI_API_KEY/);
  assert.doesNotMatch(source, /extractDocumentData\(`garage_/);
});
