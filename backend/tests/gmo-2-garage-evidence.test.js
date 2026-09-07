/**
 * GMO-2 — business-presence evidence, and OCR as assistance only.
 *
 * The single most dangerous thing this feature could do is let a machine's reading of a document
 * become an authority decision. The second most dangerous is to tell a person that a failure to
 * read their document is a problem with their application. Most of what follows tests those two.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  uploadEvidence, removeEvidence, runEvidenceExtraction, acknowledgeExtraction,
  listOwnEvidence, getOwnEvidencePreview, isExtractionEnabled, sanitizeEvidence,
  EXTRACTION_STATE, GARAGE_EVIDENCE_TYPES,
} = await import('../services/garageOnboarding/garageEvidenceService.js');
const { submissionBlockers, countLiveEvidence } = await import('../services/garageOnboarding/garageApplicationService.js');

const APPLICANT = 'u_garage_applicant_1';
const OTHER = 'u_someone_else';
const APP = 'app-1';
const DOC = 'doc-1';

const GARAGE_PROFILE = {
  user_id: APPLICANT, account_kind: 'business', business_type: 'garage',
  organization_name: 'Mbare Motors', onboarding_status: 'requested',
};
const DRAFT_APP = { id: APP, applicant_user_id: APPLICANT, status: 'draft' };
const BASE_DOC = {
  id: DOC, application_id: APP, uploaded_by_user_id: APPLICANT, evidence_type: 'utility_bill',
  file_ref: 'garage-onboarding/app-1/utility_bill-x.pdf', mime_type: 'application/pdf',
  size_bytes: 1024, extraction_state: 'not_attempted', removed_at: null,
};
const actor = { id: APPLICANT, role: 'owner' };

/** Supabase-shaped stub: `.is()`, head/count selects and update-returning all behave. */
function client(tables, log = []) {
  const from = (table) => {
    const filters = {};
    let payload = null; let op = 'select'; let head = false;
    const result = () => {
      log.push({ table, op, filters: { ...filters }, payload });
      const entry = tables[table];
      const out = typeof entry === 'function' ? entry(filters, { op, payload }) : { data: entry ?? null, error: null };
      if (head && out.data !== undefined && out.count === undefined) {
        out.count = Array.isArray(out.data) ? out.data.length : (out.data ? 1 : 0);
      }
      return out;
    };
    const chain = {
      select(_c, opts) { if (opts?.head) head = true; return chain; },
      insert(p) { op = 'insert'; payload = p; return chain; },
      update(p) { op = 'update'; payload = p; return chain; },
      eq(k, v) { filters[k] = v; return chain; },
      is(k, v) { filters[`is:${k}`] = v; return chain; },
      in(k, v) { filters[`in:${k}`] = v; return chain; },
      order() { return chain; }, limit() { return chain; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return chain;
  };
  return { from };
}

const okAudit = { audit_logs: () => ({ data: { id: 'a1' }, error: null }) };
const storage = () => ({
  uploadToStorage: async () => ({ ok: true }),
  downloadFromStorage: async () => ({ buffer: Buffer.from('pdf-bytes'), mimeType: 'application/pdf' }),
  generateSecureReadUrl: async () => 'https://signed.example/doc?token=x',
});

// ── the evidence requirement (PO-2 item 9) ───────────────────────────────────────────────────────

test('GMO-2: submission asks for at least one piece of evidence', () => {
  const complete = {
    trading_name: 'Mbare Motors', location_city: 'Harare', address_line: '12 Chaminuka Rd',
    contact_phone: '+263771234567', applicant_relationship: 'owner',
    service_categories: ['brakes'], attestation_accepted_at: 'now',
  };
  assert.deepEqual(submissionBlockers(complete, 1), []);
  const withoutEvidence = submissionBlockers(complete, 0);
  assert.equal(withoutEvidence.length, 1);
  assert.match(withoutEvidence[0], /shows your garage is real/);
});

test('GMO-2: an unmeasured evidence count never manufactures a blocker', () => {
  // A caller that forgot to count must not tell an applicant their evidence is missing.
  const complete = {
    trading_name: 'X', location_city: 'Harare', address_line: 'a', contact_phone: 'p',
    applicant_relationship: 'owner', service_categories: ['brakes'], attestation_accepted_at: 'now',
  };
  assert.deepEqual(submissionBlockers(complete, null), []);
  assert.deepEqual(submissionBlockers(complete), []);
});

test('GMO-2: a broken evidence count RAISES — it never reads as zero evidence', async () => {
  const c = client({ garage_application_documents: () => ({ data: null, error: { message: 'connection reset' } }) });
  await assert.rejects(() => countLiveEvidence(c, APP), /Could not check the evidence/);
});

test('GMO-2: incorporation is one option among many, never the requirement', () => {
  // PO-2: a legitimate Zimbabwe garage must not need a company to use the Service Network.
  assert.ok(GARAGE_EVIDENCE_TYPES.includes('company_registration'));
  for (const informal of ['premises_photo', 'signage_photo', 'utility_bill', 'lease_or_title']) {
    assert.ok(GARAGE_EVIDENCE_TYPES.includes(informal), `${informal} must be acceptable evidence`);
  }
});

// ── upload, ownership and withdrawal ─────────────────────────────────────────────────────────────

test('GMO-2: an applicant uploads evidence to their own application', async () => {
  const log = [];
  const c = client({
    user_registration_profiles: GARAGE_PROFILE,
    garage_applications: DRAFT_APP,
    garage_application_documents: () => ({ data: { ...BASE_DOC }, error: null }),
    ...okAudit,
  }, log);
  const { document } = await uploadEvidence(c, actor, APP, {
    evidence_type: 'utility_bill', mime_type: 'application/pdf',
    file_base64: Buffer.from('hello').toString('base64'),
  }, { storage: storage() });
  assert.equal(document.evidence_type, 'utility_bill');
  assert.equal(document.extraction_state, 'not_attempted');
  const insert = log.find((l) => l.op === 'insert' && l.table === 'garage_application_documents');
  assert.equal(insert.payload.uploaded_by_user_id, APPLICANT, 'attribution comes from the session, not the body');
});

test('GMO-2: the storage path never reaches the client', async () => {
  const safe = sanitizeEvidence({ ...BASE_DOC });
  assert.equal(safe.file_ref, undefined);
  assert.equal(safe.has_file, true);
  assert.ok(!JSON.stringify(safe).includes('garage-onboarding/'));
});

test("GMO-2: another person's application is reported as absent, not forbidden", async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE,
    garage_applications: { id: APP, applicant_user_id: OTHER, status: 'draft' },
    ...okAudit,
  });
  await assert.rejects(
    () => uploadEvidence(c, actor, APP, {
      evidence_type: 'utility_bill', mime_type: 'application/pdf',
      file_base64: Buffer.from('x').toString('base64'),
    }, { storage: storage() }),
    // A 403 would confirm the application exists. Absent is the honest answer to give a stranger.
    (e) => e.message === 'Application not found' || /not found/i.test(e.message),
  );
});

test('GMO-2: evidence cannot be swapped underneath a reviewer', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE,
    garage_applications: { ...DRAFT_APP, status: 'under_review' },
    ...okAudit,
  });
  await assert.rejects(
    () => uploadEvidence(c, actor, APP, {
      evidence_type: 'utility_bill', mime_type: 'application/pdf',
      file_base64: Buffer.from('x').toString('base64'),
    }, { storage: storage() }),
    /with CarUp for review/,
  );
});

test('GMO-2: withdrawing a document is soft — the record survives', async () => {
  const log = [];
  const c = client({
    user_registration_profiles: GARAGE_PROFILE,
    garage_applications: DRAFT_APP,
    garage_application_documents: () => ({ data: { ...BASE_DOC, removed_at: 'now' }, error: null }),
    ...okAudit,
  }, log);
  await removeEvidence(c, actor, APP, DOC, {});
  const write = log.find((l) => l.table === 'garage_application_documents' && l.op === 'update');
  assert.ok(write, 'withdrawal is an update');
  assert.ok(write.payload.removed_at, 'it stamps removed_at');
  assert.equal(write.payload.removed_by_user_id, APPLICANT);
  assert.ok(!log.some((l) => l.op === 'delete'), 'nothing is deleted');
});

test('GMO-2: a file that is not a photo or PDF is refused in words a person can act on', async () => {
  const c = client({ user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP, ...okAudit });
  await assert.rejects(
    () => uploadEvidence(c, actor, APP, { evidence_type: 'utility_bill', mime_type: 'application/zip', file_base64: 'AAA' }, { storage: storage() }),
    /photo \(JPG, PNG or WEBP\) or a PDF/,
  );
});

// ── extraction never becomes authority ───────────────────────────────────────────────────────────

test('GMO-2: extraction is OFF unless a deployment turns it on', () => {
  assert.equal(isExtractionEnabled({}), false, 'an empty environment must not reach a provider');
  assert.equal(isExtractionEnabled({ GARAGE_OCR_ENABLED: 'false' }), false);
  assert.equal(isExtractionEnabled({ NODE_ENV: 'production', GEMINI_API_KEY: 'real-key' }), false,
    'a configured provider key alone must never switch extraction on');
  assert.equal(isExtractionEnabled({ GARAGE_OCR_ENABLED: 'true' }), true);
});

test('GMO-2: the mock allowance agrees with the canonical OCR predicate', async () => {
  // `isExtractionEnabled` inlines the mock condition so it honours its own env argument. This pins
  // it to the canonical predicate under the ambient environment so the two cannot drift.
  const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
  const inlined = process.env.NODE_ENV === 'test' && process.env.ALLOW_OCR_MOCK === 'true';
  assert.equal(inlined, DocumentIntelligenceService.isOcrMockAllowed());
});

test('GMO-2: with extraction off the applicant is told to type it in — not that something failed', async () => {
  const log = [];
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({ data: { ...BASE_DOC, ...(payload || {}) }, error: null }),
    ...okAudit,
  }, log);
  const ocr = { extractDocumentData: async () => { throw new Error('provider must not be called'); } };
  const out = await runEvidenceExtraction(c, actor, APP, DOC, { storage: storage(), ocr, env: {} });
  assert.equal(out.extraction_state, EXTRACTION_STATE.UNAVAILABLE);
  assert.match(out.document.extraction_note, /works exactly as well/);
  assert.equal(out.candidates, null);
});

test('GMO-2: a photo has nothing to read, and says so as availability not failure', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({
      data: { ...BASE_DOC, evidence_type: 'premises_photo', ...(payload || {}) }, error: null,
    }),
    ...okAudit,
  });
  const out = await runEvidenceExtraction(c, actor, APP, DOC, {
    storage: storage(), ocr: { extractDocumentData: async () => { throw new Error('must not run'); } },
    env: { GARAGE_OCR_ENABLED: 'true' },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.UNAVAILABLE);
  assert.match(out.document.extraction_note, /no text to read/);
});

test('GMO-2: a provider outage is an extraction failure, NOT an application failure', async () => {
  const log = [];
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({ data: { ...BASE_DOC, ...(payload || {}) }, error: null }),
    ...okAudit,
  }, log);
  const out = await runEvidenceExtraction(c, actor, APP, DOC, {
    storage: storage(), ocr: { extractDocumentData: async () => { throw new Error('502 from provider'); } },
    env: { GARAGE_OCR_ENABLED: 'true' },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.FAILED);
  assert.match(out.document.extraction_note, /Your upload is safe/);
  // The load-bearing assertion: no write touched the application.
  assert.ok(!log.some((l) => l.table === 'garage_applications' && l.op !== 'select'),
    'a failed extraction must never write the application');
});

test('GMO-2: OCR output can never approve, reject or advance an application', async () => {
  const log = [];
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({ data: { ...BASE_DOC, ...(payload || {}) }, error: null }),
    ...okAudit,
  }, log);
  const ocr = {
    // A hostile provider returning exactly the fields an attacker would want to be authority.
    extractDocumentData: async () => ({
      success: true, provider: 'mock', extractedData: {
        company_name: 'Totally Legitimate Motors', address: '1 Nowhere', city: 'Harare',
        confidenceScore: 0.99, status: 'approved', verified: true, approved: true, tenant_id: 'evil',
      },
    }),
  };
  const out = await runEvidenceExtraction(c, actor, APP, DOC, { storage: storage(), ocr, env: { GARAGE_OCR_ENABLED: 'true' } });
  assert.equal(out.extraction_state, EXTRACTION_STATE.AWAITING_CONFIRMATION);
  assert.ok(!log.some((l) => l.table === 'garage_applications' && l.op !== 'select'));
  assert.ok(!log.some((l) => ['tenants', 'tenant_users'].includes(l.table)));
  // Only the three narrow fields may be proposed. `approved`/`verified`/`tenant_id` are not candidates.
  assert.deepEqual(Object.keys(out.candidates).sort(), ['address_line', 'location_city', 'trading_name']);
});

test('GMO-2: candidates are proposals — accepting them is a separate act by the person', async () => {
  const log = [];
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({ data: { ...BASE_DOC, ...(payload || {}) }, error: null }),
    ...okAudit,
  }, log);
  const ocr = {
    extractDocumentData: async () => ({
      success: true, provider: 'mock',
      extractedData: { company_name: 'Mbare Motors', address: '12 Chaminuka Rd', confidenceScore: 0.9 },
    }),
  };
  const out = await runEvidenceExtraction(c, actor, APP, DOC, { storage: storage(), ocr, env: { GARAGE_OCR_ENABLED: 'true' } });
  assert.equal(out.candidates.trading_name.state, 'machine_candidate');
  assert.equal(out.candidates.trading_name.value, 'Mbare Motors');
  // Nothing was written to the application: the value reaches the form only when the person saves it.
  assert.ok(!log.some((l) => l.table === 'garage_applications' && l.op === 'update'));
});

test('GMO-2: "N/A" is never offered to a person as their own address', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({ data: { ...BASE_DOC, ...(payload || {}) }, error: null }),
    ...okAudit,
  });
  const ocr = {
    extractDocumentData: async () => ({
      success: true, provider: 'mock',
      extractedData: { company_name: 'Real Garage', address: 'N/A', city: 'unknown', confidenceScore: 0.9 },
    }),
  };
  const out = await runEvidenceExtraction(c, actor, APP, DOC, { storage: storage(), ocr, env: { GARAGE_OCR_ENABLED: 'true' } });
  assert.equal(out.candidates.address_line.state, 'missing');
  assert.equal(out.candidates.location_city.state, 'missing');
  assert.equal(out.candidates.trading_name.value, 'Real Garage');
});

test('GMO-2: a technically successful run that found nothing usable is not shown as success', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({ data: { ...BASE_DOC, ...(payload || {}) }, error: null }),
    ...okAudit,
  });
  const out = await runEvidenceExtraction(c, actor, APP, DOC, {
    storage: storage(),
    ocr: { extractDocumentData: async () => ({ success: true, provider: 'mock', extractedData: { confidenceScore: 0.95 } }) },
    env: { GARAGE_OCR_ENABLED: 'true' },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.FAILED);
  assert.match(out.document.extraction_note, /could not find the garage details/);
});

test('GMO-2: low confidence is its own state, and says to check each value', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { payload }) => ({ data: { ...BASE_DOC, ...(payload || {}) }, error: null }),
    ...okAudit,
  });
  const out = await runEvidenceExtraction(c, actor, APP, DOC, {
    storage: storage(),
    ocr: { extractDocumentData: async () => ({ success: true, provider: 'mock', extractedData: { company_name: 'Blurry Motors', confidenceScore: 0.31 } }) },
    env: { GARAGE_OCR_ENABLED: 'true' },
  });
  assert.equal(out.extraction_state, EXTRACTION_STATE.LOW_CONFIDENCE);
  assert.match(out.document.extraction_note, /not confident/);
  assert.equal(out.document.extraction_confidence, 0.31);
});

test('GMO-2: confirming requires something to confirm', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: { ...BASE_DOC, extraction_state: 'not_attempted' },
    ...okAudit,
  });
  await assert.rejects(() => acknowledgeExtraction(c, actor, APP, DOC, {}), /no suggested values/);
});

test('GMO-2: a document that changed while being read refuses the stale confirmation', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: (_f, { op }) => (op === 'update'
      ? { data: null, error: null }       // the guarded update matched no row
      : { data: { ...BASE_DOC, extraction_state: 'awaiting_confirmation' }, error: null }),
    ...okAudit,
  });
  await assert.rejects(() => acknowledgeExtraction(c, actor, APP, DOC, {}), /changed while you were looking/);
});

// ── structural: this file cannot grant anything ──────────────────────────────────────────────────

test('GMO-2: the evidence service touches no authority table at all', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../services/garageOnboarding/garageEvidenceService.js'), 'utf8');
  for (const table of ['tenant_users', 'tenants', 'users', 'sessions']) {
    assert.ok(!new RegExp(`from\\('${table}'\\)`).test(src), `evidence must never query ${table}`);
  }
  // And it must not be able to move an application's status even by accident.
  assert.ok(!/from\('garage_applications'\)[\s\S]{0,200}?\.update\(/.test(src),
    'the evidence service must never update garage_applications');
});

test('GMO-2: preview hands back a short-lived link, never a storage path', async () => {
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: { ...BASE_DOC }, ...okAudit,
  });
  const out = await getOwnEvidencePreview(c, actor, APP, DOC, { storage: storage() });
  assert.match(out.url, /^https:\/\//);
  assert.equal(out.expiresInSeconds, 180);
  assert.ok(!out.url.includes('garage-onboarding/app-1'), 'the path is not the URL');
});

test('GMO-2: listing your own evidence is scoped to you', async () => {
  const log = [];
  const c = client({
    user_registration_profiles: GARAGE_PROFILE, garage_applications: DRAFT_APP,
    garage_application_documents: [{ ...BASE_DOC }], ...okAudit,
  }, log);
  const { documents } = await listOwnEvidence(c, actor, APP);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].file_ref, undefined);
  const read = log.find((l) => l.table === 'garage_application_documents');
  assert.equal(read.filters['is:removed_at'], null, 'withdrawn documents are not listed');
});
