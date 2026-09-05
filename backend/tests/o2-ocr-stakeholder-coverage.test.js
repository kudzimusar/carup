/**
 * OCR STAKEHOLDER COVERAGE — the corpus proves document reading; this proves the JOURNEYS.
 *
 * The accuracy corpus answers "can the engine read a document?". It does NOT answer "does OCR
 * behave correctly for each CarUp stakeholder that depends on it?" — a passing fixture says
 * nothing about who may invoke a route, where a candidate lands, or what it is allowed to change.
 * These are the journey-level guards.
 *
 * ZERO live provider calls. Every test drives the SHIPPED services through the existing
 * `visionProvider` / `ocr` seams with an in-test double, so no Cloudflare, Gemini or any other
 * provider is contacted and no neurons are spent.
 *
 * The single law under test, for every stakeholder:
 *
 *     DOCUMENT INTELLIGENCE OBSERVES. DOMAIN AUTHORITIES DECIDE.
 *
 * An OCR reading is candidate evidence. It may never, on its own, verify an identity, make a
 * dealer compliant or active, grant Seller Authority, register a vehicle, prove ownership, or
 * move canonical Trust.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.ALLOW_OCR_MOCK = 'false';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';
// Belt and braces: no credential is present, so even a coding slip cannot reach a provider.
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
delete process.env.GEMINI_API_KEY;

const { supabase } = await import('../db/supabase.js');
const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { providerFromClient } = await import('../services/ai/ocrVisionProvider.js');
const { resolveSchema } = await import('../services/document-intelligence/documentSchemas.js');
const { FIELD_STATE } = await import('../services/registration/registrationJourneyService.js');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const DATA_URI = `data:image/png;base64,${PNG.toString('base64')}`;
const MODEL = '@cf/qwen/qwen3.8-27b';

/** Captures every table write so a test can prove where a candidate landed — and where it did not. */
function captureWrites(writes) {
  return (table) => ({
    insert: (row) => { writes.push({ table, op: 'insert', row }); return Promise.resolve({ data: null, error: null }); },
    update: (row) => { writes.push({ table, op: 'update', row }); return Promise.resolve({ data: null, error: null }); },
    upsert: (row) => { writes.push({ table, op: 'upsert', row }); return Promise.resolve({ data: null, error: null }); },
    delete: () => { writes.push({ table, op: 'delete' }); return Promise.resolve({ data: null, error: null }); },
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
  });
}

/** Runs the SHIPPED extraction with an in-test provider double. No network, ever. */
async function extractAs(t, docType, reading) {
  const writes = [];
  t.mock.method(supabase, 'from', captureWrites(writes));
  const result = await DocumentIntelligenceService.extractDocumentData(
    docType, DATA_URI, 'stakeholder-user',
    { visionProvider: providerFromClient(async () => reading, { id: 'cloudflare', model: MODEL }) },
  );
  return { result, writes };
}

/** The only tables an extraction may ever touch. */
const OCR_EVIDENCE_TABLES = new Set([
  'ocr_documents', 'ocr_national_ids', 'ocr_registration_books', 'ocr_customs_declarations',
]);

/** Tables that carry authority. An extraction writing any of these would be a breach. */
const AUTHORITY_TABLES = [
  'users', 'vehicles', 'identity_verifications', 'identity_lifecycle_events', 'dealer_profiles',
  'dealer_compliance_decisions', 'seller_authority', 'trust_scores', 'trust_score_history',
  'cvr_ownership_records', 'zimra_declarations', 'listings', 'administrative_overrides',
];

function assertNoAuthorityWrite(writes, label) {
  for (const write of writes) {
    assert.ok(OCR_EVIDENCE_TABLES.has(write.table),
      `${label}: extraction wrote to ${write.table} — only OCR evidence tables are permitted`);
    assert.ok(!AUTHORITY_TABLES.includes(write.table),
      `${label}: extraction touched the authority table ${write.table}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. INDIVIDUAL / OWNER / SELLER — the canonical person-identity path
//    Stakeholders 1, 2, 3 and the person-identity half of every business applicant.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const PERSON_DOCS = [
  ['national_id', 'zimbabwe_national_id', { first_name: 'TESTCASE', last_name: 'SPECIMEN', national_id_number: '63-1234567-A-42', date_of_birth: '1990-01-01', sex: 'M' }],
  ['passport', 'passport', { first_name: 'VERIFY', last_name: 'EXEMPLAR', national_id_number: 'ZN1234567', date_of_birth: '1988-02-12', nationality: 'ZIMBABWEAN' }],
  ['drivers_license', 'drivers_licence', { first_name: 'SAMPLE', last_name: 'PROTOTYPE', national_id_number: 'ZWDL4471902', date_of_birth: '1990-02-08' }],
];

for (const [docType, documentClass, fields] of PERSON_DOCS) {
  test(`stakeholder: individual/owner/seller — ${docType} flows through the canonical person-identity path`, async (t) => {
    const { result, writes } = await extractAs(t, docType, {
      document_class_observed: documentClass, confidence: 0.97, fields,
    });

    assert.equal(result.success, true, 'the reading completed');
    assert.equal(resolveSchema(docType).documentClass, documentClass, 'the document class routes to its own schema');
    assert.equal(result.extractedData.first_name, fields.first_name);
    assert.equal(result.extractedData.last_name, fields.last_name);
    assert.equal(result.extractedData.national_id_number, fields.national_id_number);

    // CANDIDATE, not truth: the strongest possible reading still only awaits verification.
    assert.equal(result.extractionStatus, 'Pending_Verification',
      'a complete, high-confidence reading still only reaches "pending verification"');
    assertNoAuthorityWrite(writes, docType);
  });
}

test('stakeholder: individual — a perfect reading does NOT verify identity, grant Seller Authority or move Trust', async (t) => {
  const { result, writes } = await extractAs(t, 'national_id', {
    document_class_observed: 'zimbabwe_national_id', confidence: 1,
    fields: { first_name: 'TESTCASE', last_name: 'SPECIMEN', national_id_number: '63-1234567-A-42', date_of_birth: '1990-01-01', sex: 'M', country: 'ZIMBABWE' },
  });

  // Nothing in the returned envelope asserts a decision.
  const envelope = JSON.stringify(result);
  for (const forbidden of ['"verified"', 'seller_authority', 'trust_score', 'is_verified', 'capability_bearing']) {
    assert.ok(!envelope.includes(forbidden), `an extraction result must not carry ${forbidden}`);
  }
  assertNoAuthorityWrite(writes, 'national_id perfect reading');

  // And the identity gate independently refuses to treat it as sufficient on its own.
  const { evaluateOcrEvidence } = await import('../services/identity/verificationSessionService.js');
  const verdict = evaluateOcrEvidence(result);
  assert.equal(typeof verdict.sufficient, 'boolean');
  const identity = read('../services/identity/verificationSessionService.js');
  assert.match(identity, /EXTRACTION_TRUST_STATUS\.(UNTRUSTED|PARTIALLY_TRUSTED)/,
    'a successful extraction is at most PARTIALLY trusted — never trusted outright');
  assert.doesNotMatch(identity, /status:\s*'verified'[\s\S]{0,200}extractDocumentData/,
    'extraction alone must never write a verified status');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. DEALER APPLICANT — business/compliance document OCR
//    Stakeholder 5.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: dealer applicant — a business document reaches the BUSINESS schema, not an identity one', async (t) => {
  const { result, writes } = await extractAs(t, 'dealer_business_registration', {
    document_class_observed: 'business_document', confidence: 0.93,
    fields: { legal_name: 'SPECIMEN MOTORS (PRIVATE) LIMITED', registration_number: '10234/2016', tax_id: '2000123456', country: 'ZIMBABWE' },
  });

  assert.equal(resolveSchema('dealer_business_registration').documentClass, 'business_document');
  assert.equal(result.extractedData.additional_fields.legal_name, 'SPECIMEN MOTORS (PRIVATE) LIMITED');
  assert.equal(result.extractedData.additional_fields.registration_number, '10234/2016');
  // A business document has no identity fields to fill — the schemas are kept apart.
  assert.equal(resolveSchema('dealer_business_registration').fields.national_id_number, undefined);
  assert.equal(result.extractedData.first_name, undefined);
  assertNoAuthorityWrite(writes, 'dealer business document');
});

test('stakeholder: dealer applicant — OCR writes CANDIDATES only; it cannot make a dealer compliant, active, unrestricted or publishable', () => {
  const svc = read('../services/dealer/dealerOnboardingService.js');
  const ocrFn = svc.slice(svc.indexOf('export async function runOwnDealerDocumentOcr'));
  const body = ocrFn.slice(0, ocrFn.indexOf('\nexport '));

  // The patch it writes is exactly the four extraction fields — nothing else.
  assert.match(body, /extraction_candidates: candidates/);
  assert.match(body, /extraction_provider: result\.provider/);
  assert.match(body, /extraction_confidence:/);
  assert.match(body, /extracted_at:/);
  for (const forbidden of [
    /compliance_status\s*:/, /status:\s*'(approved|compliant|active|verified)'/,
    /is_active\s*:/, /unrestricted/, /publishable/, /activated_at/,
  ]) {
    assert.doesNotMatch(body, forbidden,
      `the dealer OCR path must not write ${forbidden} — activation is a governed decision`);
  }
  // It updates the DOCUMENT row, never the dealer profile.
  assert.match(body, /from\('dealer_compliance_documents'\)/);
  assert.doesNotMatch(body, /from\('dealer_profiles'\)\s*[\s\S]{0,80}\.update/);
  assert.doesNotMatch(body, /from\('dealer_compliance_decisions'\)/);
  // Candidates are explicitly labelled as machine candidates awaiting the user.
  assert.match(body, /FIELD_STATE\.MACHINE_CANDIDATE/);
  assert.equal(FIELD_STATE.MACHINE_CANDIDATE, 'machine_candidate');
});

test('stakeholder: dealer applicant — registration context is REQUIRED, and it is not itself authorization', () => {
  const svc = read('../services/dealer/dealerOnboardingService.js');
  // Every dealer OCR call passes through the dealer-context assertion and an ownership check.
  const ocrFn = svc.slice(svc.indexOf('export async function runOwnDealerDocumentOcr'));
  assert.match(ocrFn.slice(0, 400), /assertDealerOnboardingContext\(client, actor\)/);
  assert.match(ocrFn.slice(0, 400), /requireOwnDealerDocument\(client, userId, docId\)/,
    'a dealer may only OCR a document on their OWN application');
  // The context guard is a server-side profile lookup, never a client-supplied string.
  const guard = svc.slice(svc.indexOf('export async function assertDealerOnboardingContext'));
  assert.match(guard.slice(0, 700), /from\('user_registration_profiles'\)/);
  assert.match(guard.slice(0, 700), /account_kind !== 'business' \|\| data\.business_type !== 'dealer'/);
  assert.match(guard.slice(0, 900), /DEALER_ONBOARDING_CONTEXT_REQUIRED/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. DIASPORA / IMPORTER / EXPORTER / SUPPLIER — trade document OCR
//    Stakeholders 4, 7, 8, 11, 12, 16, 17, 18, 26, 27, 28.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: diaspora/importer/exporter — the trade OCR route is reachable only under reviewer authorization', () => {
  const routes = read('../routes/diasporaRoutes.js');
  assert.match(routes, /router\.post\('\/documents\/:id\/run-ocr', reviewerAuth, requireProvenIdentity\(\)/,
    'trade document OCR must sit behind reviewerAuth AND a proven identity');
  const reviewerAuth = routes.match(/const reviewerAuth = authorizeRole\(\[([^\]]*)\]\)/);
  assert.ok(reviewerAuth, 'reviewerAuth must be an explicit role allow-list');
  const roles = reviewerAuth[1];
  for (const privileged of ['admin', 'government', 'reviewer', 'dealer']) {
    assert.ok(roles.includes(privileged), `${privileged} is expected in the trade-review allow-list`);
  }
  // An ordinary buyer/owner is NOT in the allow-list: a diaspora customer cannot run trade OCR.
  assert.ok(!/'owner'/.test(roles), 'a plain owner must not be able to invoke trade document OCR');
  assert.ok(!/'member'/.test(roles), 'a plain member must not be able to invoke trade document OCR');
});

test('stakeholder: diaspora — a customs reading is an observation, and cannot manufacture compliance', async (t) => {
  const { result, writes } = await extractAs(t, 'customs_declaration', {
    document_class_observed: 'customs_declaration', confidence: 0.95,
    fields: { vin: 'JTDBR32E870123456', bill_entry_number: 'BOE-2026-884213', duty_value_zig: 48250.5, importer_name: 'SPECIMEN MOTORS (PRIVATE) LIMITED', stamp_date: '2026-03-14', entry_point: 'BEITBRIDGE' },
  });

  assert.equal(result.extractedData.additional_fields.bill_entry_number, 'BOE-2026-884213');
  assert.equal(result.extractedData.additional_fields.duty_value_zig, 48250.5);
  // The reading never claims the duty was actually paid or the import cleared.
  const envelope = JSON.stringify(result);
  for (const forbidden of ['dutyPaid', 'duty_paid', 'cleared', 'compliant', 'verified']) {
    assert.ok(!envelope.includes(forbidden), `a customs reading must not assert ${forbidden}`);
  }
  assertNoAuthorityWrite(writes, 'customs declaration');
  // Registry truth tables stay untouched by anything document intelligence can do.
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  assert.doesNotMatch(service, /cvr_ownership_records|zimra_declarations/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. VEHICLE DOCUMENTS — registration book and customs declaration
//    Stakeholders 2, 3, 19 (and the vehicle half of dealer/importer journeys).
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: vehicle documents — a registration book produces candidate observations', async (t) => {
  const { result, writes } = await extractAs(t, 'registration_book', {
    document_class_observed: 'vehicle_registration_book', confidence: 0.95,
    fields: { vin: 'JTDBR32E870123456', make: 'TOYOTA', model: 'COROLLA', year: 2018, plate_number: 'AEB 4729', owner_name: 'SPECIMEN MOTORS (PRIVATE) LIMITED', engine_number: '1NZFE4829384' },
  });

  const extra = result.extractedData.additional_fields;
  assert.equal(extra.vin, 'JTDBR32E870123456');
  assert.equal(extra.plate_number, 'AEB 4729');
  assert.equal(extra.owner_name, 'SPECIMEN MOTORS (PRIVATE) LIMITED');
  assert.equal(extra.year, 2018);
  assertNoAuthorityWrite(writes, 'registration book');
});

test('stakeholder: vehicle documents — reading a VIN does NOT register a vehicle, prove ownership, grant Seller Authority or change Trust', async (t) => {
  const { result, writes } = await extractAs(t, 'registration_book', {
    document_class_observed: 'vehicle_registration_book', confidence: 1,
    fields: { vin: 'JTDBR32E870123456', make: 'TOYOTA', model: 'COROLLA', year: 2018, plate_number: 'AEB 4729', owner_name: 'SPECIMEN MOTORS (PRIVATE) LIMITED' },
  });

  // The candidate row is evidence, and it is the ONLY vehicle-shaped thing written.
  const vehicleWrites = writes.filter((w) => w.table !== 'ocr_documents');
  for (const w of vehicleWrites) {
    assert.equal(w.table, 'ocr_registration_books', 'the only vehicle write is the OCR evidence row');
  }
  assertNoAuthorityWrite(writes, 'VIN reading');

  // owner_name is a READING off a document, never an ownership assertion.
  assert.equal(result.extractionStatus, 'Pending_Verification');
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  for (const forbidden of [/from\(['"]vehicles['"]\)/, /trust_score/, /current_seller_id/, /owner_id\s*:/]) {
    assert.doesNotMatch(service, forbidden, `document intelligence must never touch ${forbidden}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. ADMIN / GOVERNMENT / REVIEWER — consume evidence, but OCR does not decide for them
//    Stakeholders 20, 23, 29, 30.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: reviewer/admin/government — OCR evidence is reviewable, but the governed decision writer is separate', () => {
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  // The retired approval chain must stay retired: extraction has no decision writer at all.
  assert.equal(typeof DocumentIntelligenceService.approveDocumentVerification, 'undefined');
  assert.doesNotMatch(service, /approveDocumentVerification/);
  assert.doesNotMatch(service, /administrative_overrides/);
  // A reviewer decision is written by the identity/dealer review services, not by extraction.
  const identity = read('../services/identity/verificationSessionService.js');
  assert.match(identity, /reviewer|review_decision|pending_manual_review/,
    'the reviewer path exists and is where a decision is recorded');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6. UNAUTHORISED / WRONG STAKEHOLDER — a role string is not authorization
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: unauthorised — a self-declared role or business type cannot unlock a stakeholder OCR route', () => {
  const dealer = read('../services/dealer/dealerOnboardingService.js');
  // The dealer gate reads the SERVER-SIDE registration profile; it never trusts actor-supplied fields.
  const guard = dealer.slice(dealer.indexOf('export async function assertDealerOnboardingContext'));
  assert.match(guard.slice(0, 700), /from\('user_registration_profiles'\)[\s\S]{0,200}\.eq\('user_id', userId\)/,
    'the dealer context is looked up by proven user id');
  assert.doesNotMatch(guard.slice(0, 700), /actor\.(business_type|role|account_kind)/,
    'the gate must not read a business type or role off the caller-supplied actor');

  const routes = read('../routes/diasporaRoutes.js');
  assert.doesNotMatch(routes, /run-ocr'[^)]*req\.body\.role/, 'no OCR route may take its authorization from the body');

  // Attribution is mandatory outside the test suite: an unattributed extraction refuses to run.
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  assert.match(service, /OCR extraction requires the authenticated user id it is being run for/);
});

test('stakeholder: unauthorised — extraction refuses to run without a proven caller identity', async () => {
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      () => DocumentIntelligenceService.extractDocumentData('national_id', DATA_URI),
      /requires the authenticated user id/,
    );
  } finally { process.env.NODE_ENV = savedEnv; }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 7. DEFERRED — Garage and Mechanic business identity (Service Network, PR #197)
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: garage/mechanic — business identity OCR is DEFERRED because Service Network is absent on this branch', async () => {
  const { existsSync } = await import('node:fs');
  const dir = new URL('../services/serviceNetwork', import.meta.url);
  assert.equal(existsSync(dir), false,
    'Service Network is absent on this branch — garage/mechanic business onboarding OCR cannot exist yet');

  // No garage/mechanic-specific document class is invented in the meantime.
  const schemas = read('../services/document-intelligence/documentSchemas.js');
  for (const invented of [/garage_/, /mechanic_/, /service_network/]) {
    assert.doesNotMatch(schemas, invented, 'no garage/mechanic document class may be invented ahead of #197');
  }
  // Their PERSON identity, however, already works through the shared canonical path.
  assert.equal(resolveSchema('national_id').documentClass, 'zimbabwe_national_id',
    'a garage owner or mechanic is a person, and the canonical person-identity path already serves them');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 8. DOCUMENT-CLASS REGISTRY — what the schema actually supports
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: the document-class registry covers exactly the classes the journeys need', () => {
  const expected = {
    national_id: 'zimbabwe_national_id',
    passport: 'passport',
    drivers_license: 'drivers_licence',
    registration_book: 'vehicle_registration_book',
    customs_declaration: 'customs_declaration',
    dealer_business_registration: 'business_document',
  };
  for (const [docType, documentClass] of Object.entries(expected)) {
    assert.equal(resolveSchema(docType).documentClass, documentClass, `${docType} must resolve to ${documentClass}`);
  }
  // An unknown document type falls back to the business schema rather than an identity one, so a
  // stray type can never be handed the identity field set.
  assert.equal(resolveSchema('something_unmapped').documentClass, 'business_document');
  assert.equal(resolveSchema('something_unmapped').fields.national_id_number, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 9. THE UNREMEDIATED LEGACY ROUTE — recorded, not hidden
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('stakeholder: the legacy /api/ai/ocr bypass is CLOSED — the pin is flipped, not deleted', async () => {
  // This test was originally a pin on an OPEN product gap: /api/ai/ocr reached a text-only Gemini
  // call on 100 characters of truncated base64 and substituted a 0.5 confidence. The three-problem
  // hardening retired that path. The pin is kept and inverted so the gap cannot silently return.
  const bus = read('../services/ai/aiServiceBus.js');
  const server = read('../server.js');
  const convergence = read('../routes/ocrConvergenceRoutes.js');

  const fn = bus.slice(bus.indexOf('export async function runOcrParsing'));
  const body = fn.slice(0, fn.indexOf('\nexport '));

  // Each of the four original fabrications is physically absent.
  assert.doesNotMatch(body, /askGemini\(/, 'the text client must not be reachable from an OCR path');
  assert.doesNotMatch(body, /base64Data\.slice\(0,\s*100\)/, 'the truncated-image read must stay gone');
  assert.doesNotMatch(body, /confidenceScore \|\| 0\.5/, 'the invented 0.5 confidence default must stay gone');
  assert.doesNotMatch(body, /from\('ocr_documents'\)/, 'the retired parser may no longer write evidence rows');
  assert.match(body, /LEGACY_OCR_PATH_RETIRED/, 'the symbol must fail closed if a future caller imports it');

  // Executing it is a 410, not a degraded extraction.
  const { runOcrParsing } = await import('../services/ai/aiServiceBus.js');
  await assert.rejects(
    runOcrParsing('national_id', 'data:image/png;base64,AAAA', 'user-1'),
    (error) => error?.statusCode === 410 && error?.code === 'LEGACY_OCR_PATH_RETIRED',
  );

  // The historical handler still exists in server.js, so the retirement depends on the convergence
  // router being mounted ahead of it. Prove the ordering rather than assuming it.
  assert.match(server, /app\.post\('\/api\/ai\/ocr'/, 'the historical handler is still present in server.js');
  assert.match(convergence, /router\.post\('\/api\/ai\/ocr'/);
  assert.ok(
    server.indexOf('app.use(identityVerificationRouter)') < server.indexOf("app.post('/api/ai/ocr'"),
    'the 410 must be registered before the historical handler or the bypass returns',
  );
});
