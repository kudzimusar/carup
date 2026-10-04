/**
 * OCR 1.0-C3 — Garage evidence: isolation, truthful OCR semantics, and authority negatives.
 *
 * The consumer suite (o2-ocr-c3-garage-consumer) proves the happy paths. This suite proves the
 * properties that are invisible when they break:
 *
 *   - ISOLATION   another applicant's application or document is unreachable through every route
 *                 function, and a document cannot be addressed through someone else's application;
 *   - TRUTH       a provider that reports no confidence yields NULL (never 0), failed runs record
 *                 only the provenance Document Intelligence reported, and a failed re-run clears
 *                 the previous reading;
 *   - AUTHORITY   no applicant-reachable function writes a decision, activation, tenant, membership,
 *                 Seller Authority or Trust row — and the application writes that DO exist cannot
 *                 be steered into a status or decision field;
 *   - END TO END  real Document Intelligence + the real canonical Cloudflare provider + the real
 *                 Qwen request shape, with only the network stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  EXTRACTION_STATE,
  acknowledgeExtraction,
  getOwnEvidencePreview,
  listOwnEvidence,
  removeEvidence,
  runEvidenceExtraction,
  uploadEvidence,
} = await import('../services/garageOnboarding/garageEvidenceService.js');
const {
  startApplication,
  submitApplication,
  updateApplication,
} = await import('../services/garageOnboarding/garageApplicationService.js');
const { resolveVisionProvider } = await import('../services/ai/ocrVisionProvider.js');

const QWEN = '@cf/qwen/qwen3.8-27b';
const ALICE = 'garage-alice';
const BOB = 'garage-bob';
const APP_ALICE = 'app-alice';
const APP_BOB = 'app-bob';
const DOC_ALICE = 'doc-alice';
const DOC_BOB = 'doc-bob';
const alice = { id: ALICE, userId: ALICE, role: 'owner' };
const bob = { id: BOB, userId: BOB, role: 'owner' };
const ENABLED = { GARAGE_OCR_ENABLED: 'true' };
const readyProvider = {
  id: 'cloudflare', model: QWEN, isConfigured: () => true, requiredEnv: [],
  async extract() { throw new Error('the Document Intelligence double answers in these tests'); },
};
const READY = { env: ENABLED, visionProvider: readyProvider };

/** Tables an applicant-reachable Garage function must never write. */
const FORBIDDEN = new Set([
  'garage_application_decisions', 'tenants', 'tenant_users', 'vehicles', 'trust_score_history',
  'vehicle_trust_decisions', 'vehicle_seller_authority', 'garage_invitations', 'user_roles',
  'vehicle_listings', 'garage_publications',
]);

const clone = (v) => JSON.parse(JSON.stringify(v));
const profile = (userId) => ({ user_id: userId, account_kind: 'business', business_type: 'garage', organization_name: 'X', onboarding_status: 'requested' });
const docRow = (id, applicationId, userId, extra = {}) => ({
  id, application_id: applicationId, uploaded_by_user_id: userId, evidence_type: 'utility_bill',
  file_ref: `garage-onboarding/${applicationId}/utility_bill-${id}.png`, mime_type: 'image/png', size_bytes: 64,
  extraction_state: 'not_attempted', extraction_candidates: null, extraction_provider: null,
  extraction_model: null, extraction_confidence: null, extraction_note: null, extracted_at: null,
  removed_at: null, removed_by_user_id: null, created_at: '2026-10-03T00:00:00Z', ...extra,
});

function world(overrides = {}) {
  const tables = {
    user_registration_profiles: [profile(ALICE), profile(BOB)],
    garage_applications: [
      { id: APP_ALICE, applicant_user_id: ALICE, status: 'draft' },
      { id: APP_BOB, applicant_user_id: BOB, status: 'draft' },
    ],
    garage_application_documents: [docRow(DOC_ALICE, APP_ALICE, ALICE), docRow(DOC_BOB, APP_BOB, BOB)],
    audit_logs: [],
    ...overrides,
  };
  const writes = [];
  const client = {
    from(table) {
      let op = 'select'; let payload = null; let head = false; const filters = [];
      const matches = (row) => filters.every(([k, key, value]) => (
        k === 'in' ? value.includes(row?.[key]) : row?.[key] === value));
      const execute = (single) => {
        const rows = tables[table] || (tables[table] = []);
        if (op === 'update') {
          writes.push({ table, op, payload: clone(payload), filters: clone(filters) });
          const hit = rows.filter(matches);
          hit.forEach((row) => Object.assign(row, clone(payload)));
          return single ? { data: hit[0] ? clone(hit[0]) : null, error: null } : { data: clone(hit), error: null };
        }
        if (op === 'insert') {
          writes.push({ table, op, payload: clone(payload), filters: [] });
          const row = { id: payload.id || `new-${table}-${rows.length + 1}`, ...clone(payload) };
          rows.push(row);
          return single ? { data: clone(row), error: null } : { data: [clone(row)], error: null };
        }
        const selected = rows.filter(matches).map(clone);
        if (head) return { data: null, count: selected.length, error: null };
        return single ? { data: selected[0] || null, error: null } : { data: selected, error: null };
      };
      const chain = {
        select(_c, o) { if (o?.head) head = true; return chain; },
        insert(v) { op = 'insert'; payload = v; return chain; },
        update(v) { op = 'update'; payload = v; return chain; },
        eq(key, value) { filters.push(['eq', key, value]); return chain; },
        is(key, value) { filters.push(['is', key, value]); return chain; },
        in(key, value) { filters.push(['in', key, value]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() { return execute(true); },
        single() { return execute(true); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };
      return chain;
    },
  };
  return { client, tables, writes };
}

function storageSpy() {
  const calls = [];
  return {
    calls,
    async uploadToStorage(bucket, path, buffer, mime) { calls.push({ op: 'upload', bucket, path, size: buffer.length, mime }); },
    async downloadFromStorage(bucket, path) { calls.push({ op: 'download', bucket, path }); return { buffer: Buffer.from('png-bytes'), mimeType: 'image/png' }; },
    async generateSecureReadUrl(bucket, path, ttl) { calls.push({ op: 'sign', bucket, path, ttl }); return 'https://signed.example.test/x?token=t'; },
  };
}

function ocrSpy(result) {
  const calls = [];
  return { calls, async extractDocumentData(...args) { calls.push(args); return typeof result === 'function' ? result() : result; } };
}

const reading = (top = {}, extracted = {}) => ({
  success: true, provider: 'cloudflare', model: QWEN, executionStatus: 'provider_succeeded',
  confidence: 0.88, confidenceReported: true,
  extractedData: { trading_name: 'Mbare Motors', additional_fields: { physical_address: 'Stand 4, Mbare' }, confidenceScore: 0.88, ...extracted },
  ...top,
});

const assertNoForbiddenWrites = (writes, label) => {
  assert.deepEqual(writes.filter((w) => FORBIDDEN.has(w.table)).map((w) => w.table), [], `${label}: wrote an authority table`);
};

// ── ISOLATION ───────────────────────────────────────────────────────────────────────────────────

test('ISOLATION: every evidence function refuses another applicant\'s application as NOT FOUND, with no side effect', async () => {
  const cases = {
    list: (c, s, o) => listOwnEvidence(c, alice, APP_BOB, { env: ENABLED }),
    upload: (c, s) => uploadEvidence(c, alice, APP_BOB, { evidence_type: 'utility_bill', mime_type: 'image/png', file_base64: Buffer.from('x').toString('base64') }, { storage: s }),
    remove: (c) => removeEvidence(c, alice, APP_BOB, DOC_BOB),
    preview: (c, s) => getOwnEvidencePreview(c, alice, APP_BOB, DOC_BOB, { storage: s }),
    extract: (c, s, o) => runEvidenceExtraction(c, alice, APP_BOB, DOC_BOB, { ...READY, storage: s, ocr: o }),
    acknowledge: (c) => acknowledgeExtraction(c, alice, APP_BOB, DOC_BOB),
  };
  for (const [name, call] of Object.entries(cases)) {
    const { client, writes } = world();
    const storage = storageSpy();
    const ocr = ocrSpy(reading());
    await assert.rejects(() => call(client, storage, ocr), (err) => err.name === 'NotFoundError', `${name} leaked another applicant's application`);
    assert.deepEqual(writes, [], `${name} wrote something for a foreign application`);
    assert.deepEqual(storage.calls, [], `${name} touched storage for a foreign application`);
    assert.equal(ocr.calls.length, 0, `${name} ran OCR on a foreign document`);
  }
});

test('ISOLATION: a document cannot be addressed through the caller\'s OWN application when it belongs to another', async () => {
  for (const [name, call] of Object.entries({
    preview: (c, s) => getOwnEvidencePreview(c, alice, APP_ALICE, DOC_BOB, { storage: s }),
    extract: (c, s, o) => runEvidenceExtraction(c, alice, APP_ALICE, DOC_BOB, { ...READY, storage: s, ocr: o }),
    remove: (c) => removeEvidence(c, alice, APP_ALICE, DOC_BOB),
    acknowledge: (c) => acknowledgeExtraction(c, alice, APP_ALICE, DOC_BOB),
  })) {
    const { client, tables } = world();
    const storage = storageSpy();
    const ocr = ocrSpy(reading());
    await assert.rejects(() => call(client, storage, ocr), (err) => err.name === 'NotFoundError', `${name} crossed applications`);
    assert.equal(storage.calls.length, 0, `${name} signed or read Bob's file`);
    assert.equal(ocr.calls.length, 0);
    const bobDoc = tables.garage_application_documents.find((d) => d.id === DOC_BOB);
    assert.equal(bobDoc.removed_at, null);
    assert.equal(bobDoc.extraction_state, 'not_attempted');
  }
});

test('ISOLATION: a caller without a garage registration context is refused before any read of evidence', async () => {
  const { client, writes } = world({ user_registration_profiles: [{ ...profile(ALICE), business_type: 'dealer' }] });
  await assert.rejects(() => listOwnEvidence(client, alice, APP_ALICE), /GARAGE_ONBOARDING_CONTEXT_REQUIRED/);
  await assert.rejects(() => runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, READY), /GARAGE_ONBOARDING_CONTEXT_REQUIRED/);
  assert.deepEqual(writes, []);
});

test('STORAGE: the path is server-composed under the caller\'s own application, and never returned', async () => {
  const { client } = world();
  const storage = storageSpy();
  const out = await uploadEvidence(client, alice, APP_ALICE, {
    evidence_type: 'utility_bill', mime_type: 'image/png', file_base64: Buffer.from('png').toString('base64'),
    file_ref: '../../app-bob/steal.png', path: '../../etc/passwd',
  }, { storage });
  const upload = storage.calls.find((c) => c.op === 'upload');
  assert.match(upload.path, new RegExp(`^garage-onboarding/${APP_ALICE}/utility_bill-[0-9a-f-]{36}\\.png$`));
  assert.equal(upload.path.includes('..'), false);
  assert.equal(out.document.file_ref, undefined);
  assert.equal(JSON.stringify(out).includes('garage-onboarding/'), false);

  // An evidence type is never a path segment: anything outside the catalogue is refused first.
  await assert.rejects(() => uploadEvidence(client, alice, APP_ALICE, {
    evidence_type: '../app-bob', mime_type: 'image/png', file_base64: 'eA==',
  }, { storage }), (err) => err.name === 'ValidationError');
  // MIME is validated, not trusted to the extension.
  await assert.rejects(() => uploadEvidence(client, alice, APP_ALICE, {
    evidence_type: 'utility_bill', mime_type: 'text/html', file_base64: 'eA==',
  }, { storage }), (err) => err.name === 'ValidationError');
});

// ── REMOVE ──────────────────────────────────────────────────────────────────────────────────────

test('REMOVE: own evidence is withdrawn softly and audited; a withdrawn document cannot be read', async () => {
  const { client, tables, writes } = world();
  const out = await removeEvidence(client, alice, APP_ALICE, DOC_ALICE);
  assert.ok(out.document.removed_at);
  assert.equal(out.document.removed_by_user_id, ALICE);
  assert.ok(tables.garage_application_documents.some((d) => d.id === DOC_ALICE), 'the row still exists for the reviewer');
  assert.ok(writes.some((w) => w.table === 'trust_audit_events' && w.payload?.event_type === 'GARAGE_EVIDENCE_WITHDRAWN'), 'withdrawal is audited');
  const ocr = ocrSpy(reading());
  await assert.rejects(() => runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, { ...READY, storage: storageSpy(), ocr }),
    (err) => err.name === 'ValidationError');
  assert.equal(ocr.calls.length, 0);
  await assert.rejects(() => removeEvidence(client, alice, APP_ALICE, DOC_ALICE), (err) => err.name === 'NotFoundError',
    'a document cannot be withdrawn twice');
});

test('REMOVE: evidence on an application CarUp is reviewing cannot be changed', async () => {
  const { client, writes } = world({
    garage_applications: [{ id: APP_ALICE, applicant_user_id: ALICE, status: 'submitted' }],
  });
  await assert.rejects(() => removeEvidence(client, alice, APP_ALICE, DOC_ALICE), (err) => err.name === 'ValidationError');
  await assert.rejects(() => runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, { ...READY, storage: storageSpy(), ocr: ocrSpy(reading()) }),
    (err) => err.name === 'ValidationError');
  assert.deepEqual(writes, []);
});

// ── TRUTHFUL OCR SEMANTICS ──────────────────────────────────────────────────────────────────────

test('CONFIDENCE: a provider that reports none yields NULL and awaiting_confirmation — never 0, never low_confidence', async () => {
  // Exactly what canonical DI returns when the provider omits confidence: confidence null,
  // confidenceReported false, extractedData.confidenceScore null. Number(null) is 0 — the defect.
  const { client } = world();
  const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, {
    ...READY, storage: storageSpy(),
    ocr: ocrSpy(reading({ confidence: null, confidenceReported: false }, { confidenceScore: null })),
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.AWAITING_CONFIRMATION);
  assert.equal(out.document.extraction_confidence, null);
  assert.doesNotMatch(out.document.extraction_note, /not confident/i);
  assert.match(out.document.extraction_note, /did not say how sure/i);
});

test('CONFIDENCE: a reported number is used as reported, and only a reported low number is low_confidence', async () => {
  for (const [conf, state] of [[0.31, 'low_confidence'], [0.6, 'awaiting_confirmation'], [0.95, 'awaiting_confirmation']]) {
    const { client } = world();
    const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, {
      ...READY, storage: storageSpy(), ocr: ocrSpy(reading({ confidence: conf }, { confidenceScore: conf })),
    });
    assert.equal(out.extraction_state, state, `confidence ${conf}`);
    assert.equal(out.document.extraction_confidence, conf);
  }
  // The garage never reads the confidence from anywhere but DI's reported top-level value.
  const { client } = world();
  const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, {
    ...READY, storage: storageSpy(),
    ocr: ocrSpy(reading({ confidence: null, confidenceReported: false }, { confidenceScore: 0.12 })),
  });
  assert.equal(out.document.extraction_confidence, null);
});

test('PROVENANCE: a run that threw records NO provider and NO model — nothing answered', async () => {
  const { client } = world();
  const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, {
    ...READY, storage: storageSpy(), ocr: ocrSpy(() => { throw new Error('transport down'); }),
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.FAILED);
  assert.equal(out.document.extraction_provider, null);
  assert.equal(out.document.extraction_model, null);
});

test('PROVENANCE: a failed DI result records exactly what DI reported — the model is never filled in', async () => {
  const { client } = world();
  const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, {
    ...READY, storage: storageSpy(),
    ocr: ocrSpy({ success: false, provider: 'cloudflare', model: null, executionStatus: 'provider_failed', confidence: null, confidenceReported: false }),
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.FAILED);
  assert.equal(out.document.extraction_provider, 'cloudflare');
  assert.equal(out.document.extraction_model, null, 'Garage invented the model of a provider run that failed');
});

test('PROVENANCE: simulated, foreign or unattributed readings never become applicant candidates', async () => {
  for (const [label, result] of [
    ['simulated', reading({ provider: 'mock', model: 'simulated-document-reader', executionStatus: 'simulated' })],
    ['foreign provider', reading({ provider: 'gemini', model: 'gemini-2.5-flash' })],
    ['foreign model', reading({ model: '@cf/meta/llama-3.2-11b-vision-instruct' })],
    ['unattributed', reading({ provider: null, model: null })],
    ['no execution status', reading({ executionStatus: undefined })],
  ]) {
    const { client } = world();
    const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, { ...READY, storage: storageSpy(), ocr: ocrSpy(result) });
    assert.equal(out.extraction_state, EXTRACTION_STATE.FAILED, label);
    assert.equal(out.candidates, null, label);
    assert.equal(out.document.extraction_candidates, null, label);
  }
});

test('RE-RUN: a failed run after an earlier reading clears the old candidates (the table CHECK requires it)', async () => {
  const { client, tables } = world({
    garage_application_documents: [docRow(DOC_ALICE, APP_ALICE, ALICE, {
      extraction_state: 'awaiting_confirmation',
      extraction_candidates: { trading_name: { state: 'machine_candidate', value: 'Old Name' } },
      extraction_provider: 'cloudflare', extraction_model: QWEN, extraction_confidence: 0.9,
      extracted_at: '2026-10-01T00:00:00Z',
    })],
  });
  const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, {
    ...READY, storage: storageSpy(), ocr: ocrSpy({ success: false, provider: 'cloudflare', model: null }),
  });
  const row = tables.garage_application_documents.find((d) => d.id === DOC_ALICE);
  assert.equal(out.extraction_state, 'failed');
  assert.equal(row.extraction_candidates, null, 'a stale candidate survived a failed re-run');
  assert.equal(row.extraction_confidence, null);
  assert.equal(row.extraction_model, null);
});

test('UPLOAD: visual evidence starts unavailable (nothing to read); documents start not_attempted', async () => {
  for (const [type, state] of [['premises_photo', 'unavailable'], ['signage_photo', 'unavailable'], ['other', 'unavailable'], ['utility_bill', 'not_attempted'], ['tax_document', 'not_attempted']]) {
    const { client } = world();
    const out = await uploadEvidence(client, alice, APP_ALICE, {
      evidence_type: type, mime_type: 'image/jpeg', file_base64: Buffer.from('jpg').toString('base64'),
    }, { storage: storageSpy() });
    assert.equal(out.document.extraction_state, state, type);
    assert.equal(out.document.extracted_at ?? null, null, `${type}: an unattempted reading has no timestamp`);
  }
});

test('LIST: the applicant learns whether automatic reading is available — and nothing about the provider object', async () => {
  const { client } = world();
  const off = await listOwnEvidence(client, alice, APP_ALICE, { env: {} });
  assert.deepEqual(off.extraction, { available: false, reason: 'feature_disabled' });
  const on = await listOwnEvidence(client, alice, APP_ALICE, READY);
  assert.deepEqual(on.extraction, { available: true, reason: null });
  assert.equal(JSON.stringify(on).includes('isConfigured'), false);
  assert.equal(on.documents.every((d) => d.file_ref === undefined), true);
});

// ── AUTHORITY ───────────────────────────────────────────────────────────────────────────────────

test('AUTHORITY: no evidence/OCR path writes the application, a decision, a tenant, membership, Seller Authority or Trust', async () => {
  const flows = [
    ['upload', (c, s) => uploadEvidence(c, alice, APP_ALICE, { evidence_type: 'utility_bill', mime_type: 'image/png', file_base64: 'eA==' }, { storage: s })],
    ['extract success', (c, s) => runEvidenceExtraction(c, alice, APP_ALICE, DOC_ALICE, { ...READY, storage: s, ocr: ocrSpy(reading()) })],
    ['extract failure', (c, s) => runEvidenceExtraction(c, alice, APP_ALICE, DOC_ALICE, { ...READY, storage: s, ocr: ocrSpy(() => { throw new Error('x'); }) })],
    ['extract disabled', (c, s) => runEvidenceExtraction(c, alice, APP_ALICE, DOC_ALICE, { env: {}, storage: s, ocr: ocrSpy(reading()) })],
    ['preview', (c, s) => getOwnEvidencePreview(c, alice, APP_ALICE, DOC_ALICE, { storage: s })],
    ['remove', (c) => removeEvidence(c, alice, APP_ALICE, DOC_ALICE)],
  ];
  for (const [label, run] of flows) {
    const { client, writes, tables } = world();
    await run(client, storageSpy());
    assertNoForbiddenWrites(writes, label);
    assert.equal(writes.some((w) => w.table === 'garage_applications'), false, `${label} wrote the application`);
    assert.equal(tables.garage_applications.find((a) => a.id === APP_ALICE).status, 'draft');
  }
  // Confirming candidates records that they were reviewed — and nothing else.
  const { client, writes, tables } = world({
    garage_application_documents: [docRow(DOC_ALICE, APP_ALICE, ALICE, {
      extraction_state: 'awaiting_confirmation', extracted_at: '2026-10-03T00:00:00Z',
      extraction_candidates: { trading_name: { state: 'machine_candidate', value: 'Mbare Motors' } },
    })],
  });
  await acknowledgeExtraction(client, alice, APP_ALICE, DOC_ALICE);
  assertNoForbiddenWrites(writes, 'acknowledge');
  assert.equal(writes.some((w) => w.table === 'garage_applications'), false);
  assert.equal(tables.garage_applications.find((a) => a.id === APP_ALICE).trading_name, undefined,
    'a confirmed candidate wrote itself into the application');
});

test('AUTHORITY: application autosave cannot be steered into status, decision, activation or ownership fields', async () => {
  const { client, writes, tables } = world();
  await updateApplication(client, alice, APP_ALICE, {
    trading_name: 'Mbare Motors',
    status: 'approved', decided_at: '2026-10-03T00:00:00Z', decided_by_user_id: 'x', decision_reason: 'x',
    activated_tenant_id: '00000000-0000-4000-8000-000000000000', applicant_user_id: BOB, submitted_at: 'x', id: 'other',
  });
  const update = writes.find((w) => w.table === 'garage_applications' && w.op === 'update');
  for (const field of ['status', 'decided_at', 'decided_by_user_id', 'decision_reason', 'activated_tenant_id', 'applicant_user_id', 'submitted_at', 'id']) {
    assert.equal(field in update.payload, false, `autosave accepted ${field}`);
  }
  const row = tables.garage_applications.find((a) => a.id === APP_ALICE);
  assert.equal(row.status, 'draft');
  assert.equal(row.applicant_user_id, ALICE);
  assertNoForbiddenWrites(writes, 'autosave');
});

test('AUTHORITY: another applicant\'s application cannot be saved or submitted; a reviewed one cannot be edited', async () => {
  {
    const { client, writes } = world();
    await assert.rejects(() => updateApplication(client, alice, APP_BOB, { trading_name: 'Hijack' }), (err) => err.name === 'NotFoundError');
    await assert.rejects(() => submitApplication(client, alice, APP_BOB), (err) => err.name === 'NotFoundError');
    assert.deepEqual(writes, []);
  }
  {
    const { client, writes } = world({ garage_applications: [{ id: APP_ALICE, applicant_user_id: ALICE, status: 'under_review' }] });
    await assert.rejects(() => updateApplication(client, alice, APP_ALICE, { trading_name: 'Late edit' }), (err) => err.name === 'ConflictError');
    assert.deepEqual(writes, []);
  }
});

test('AUTHORITY: submit hands the application to review and does nothing else', async () => {
  const complete = {
    id: APP_ALICE, applicant_user_id: ALICE, status: 'draft', trading_name: 'Mbare Motors', address_line: 'Stand 4',
    location_city: 'Harare', contact_phone: '+263700000000', applicant_relationship: 'owner',
    service_categories: ['general_service'], attestation_accepted_at: '2026-10-03T00:00:00Z',
  };
  const { client, writes, tables } = world({ garage_applications: [complete] });
  await submitApplication(client, alice, APP_ALICE);
  assert.equal(tables.garage_applications[0].status, 'submitted');
  const appWrites = writes.filter((w) => w.table === 'garage_applications');
  assert.equal(appWrites.length, 1);
  assert.deepEqual(Object.keys(appWrites[0].payload).sort(), ['status', 'submitted_at', 'updated_at']);
  assertNoForbiddenWrites(writes, 'submit');
});

test('AUTHORITY: starting an application creates a DRAFT owned by the caller, never another user', async () => {
  const { client, writes } = world({ garage_applications: [] });
  await startApplication(client, alice);
  const insert = writes.find((w) => w.table === 'garage_applications' && w.op === 'insert');
  assert.equal(insert.payload.applicant_user_id, ALICE);
  assert.equal(insert.payload.status, 'draft');
  assertNoForbiddenWrites(writes, 'start');
});

// ── END TO END: real DI, real canonical provider, real Qwen request — network stubbed ────────────

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('END TO END: document bytes → canonical DI → Cloudflare → Qwen → candidate values only', async (t) => {
  const savedEnv = { ...process.env };
  const savedFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'e2e-account';
  process.env.CLOUDFLARE_API_TOKEN = 'e2e-token';
  delete process.env.CARUP_OCR_PROVIDER;
  delete process.env.CARUP_OCR_MODEL;
  const providerCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/ai/run/')) {
      providerCalls.push({ href, body: JSON.parse(init.body) });
      // The provider reads the document but reports NO confidence — the realistic Qwen case.
      const content = JSON.stringify({ legible: true, fields: { trading_name: 'Mbare Motors', physical_address: 'Stand 4, Mbare' } });
      return new Response(JSON.stringify({ success: true, result: { choices: [{ message: { content }, finish_reason: 'stop' }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Everything else (DI's own ocr_documents bookkeeping) is accepted and ignored.
    return new Response('[]', { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { process.env = savedEnv; globalThis.fetch = savedFetch; });

  const { client, writes } = world();
  const storage = {
    async downloadFromStorage() { return { buffer: Buffer.from(ONE_PIXEL_PNG, 'base64'), mimeType: 'image/png' }; },
  };
  const out = await runEvidenceExtraction(client, alice, APP_ALICE, DOC_ALICE, { env: ENABLED, storage });

  assert.equal(resolveVisionProvider().id, 'cloudflare');
  assert.equal(providerCalls.length, 1, 'exactly one provider call');
  assert.match(providerCalls[0].href, /\/ai\/run\/@cf\/qwen\/qwen3\.8-27b$/);
  const userContent = providerCalls[0].body.messages.find((m) => m.role === 'user').content;
  const image = userContent.find((part) => part.type === 'image_url');
  assert.equal(image.image_url.url, `data:image/png;base64,${ONE_PIXEL_PNG}`, 'the real document bytes reached the provider');

  assert.equal(out.extraction_state, EXTRACTION_STATE.AWAITING_CONFIRMATION);
  assert.equal(out.document.extraction_provider, 'cloudflare');
  assert.equal(out.document.extraction_model, QWEN);
  assert.equal(out.document.extraction_confidence, null, 'an unreported confidence stayed unreported');
  assert.deepEqual(out.candidates.trading_name, { state: 'machine_candidate', value: 'Mbare Motors' });
  assert.deepEqual(out.candidates.address_line, { state: 'machine_candidate', value: 'Stand 4, Mbare' });
  assert.deepEqual(out.candidates.location_city, { state: 'missing' });
  assert.equal(writes.some((w) => w.table === 'garage_applications'), false, 'the reading wrote the application');
  assertNoForbiddenWrites(writes, 'end to end');
});
