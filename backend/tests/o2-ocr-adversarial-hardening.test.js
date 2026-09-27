/**
 * O2 OCR — adversarial hardening regression.
 *
 * ZERO live provider calls. Every provider, storage and persistence boundary is injected.
 *
 * The sibling suites (o2-ocr-path-convergence, o2-ocr-three-problem-hardening) prove the happy
 * paths and the coarse refusals. This suite exists because four of their guards assert SOURCE TEXT
 * rather than behaviour, and because the evidence-object scope had no coverage at all. Everything
 * here executes the real function and asserts on its result:
 *
 *   1. A caller cannot forge provider, confidence or extracted fields on the governed run-ocr route.
 *   2. A vehicle evidence object cannot be escaped (bucket, VIN prefix, traversal, cross-VIN id).
 *   3. The runtime-mode branches — the ones NODE_ENV=test deliberately relaxes — are proven by
 *      running them with NODE_ENV set away from 'test'.
 *   4. The governed dealer branch is live, not dead code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { normalizeProviderBackedExtraction } = await import('../services/diaspora/diasporaDocumentService.js');
const { runVehicleEvidenceOcr } = await import('../services/evidence/vehicleDocumentOcrService.js');

/** Run `fn` with NODE_ENV temporarily set away from 'test' to reach the runtime-only branches. */
async function asRuntime(fn) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

const GOVERNED_ROUTE = { originalUrl: '/api/diaspora/documents/doc-1/run-ocr' };

/** A genuine, server-observed provider result. */
function providerResult(overrides = {}) {
  return {
    success: true,
    provider: 'cloudflare',
    model: '@cf/qwen/qwen3.8-27b',
    executionStatus: 'provider_succeeded',
    extractedData: { first_name: 'TESTCASE', last_name: 'SPECIMEN' },
    confidence: 0.91,
    confidenceReported: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Diaspora — the caller's own claims are discarded, not merged
// ---------------------------------------------------------------------------------------------

test('adversarial: forged provider, confidence and fields are discarded in favour of the observed provider result', () => {
  const normalized = normalizeProviderBackedExtraction(
    {
      extraction_provider: 'FORGED_PROVIDER',
      extracted_fields: { first_name: 'FORGED', national_id_number: '00-0000000-X-00' },
      confidence_score: 1,
      raw_response: providerResult(),
    },
    GOVERNED_ROUTE,
  );

  assert.equal(normalized.extractionProvider, 'cloudflare', 'the caller may not name the provider');
  assert.equal(normalized.confidenceScore, 0.91, 'the caller may not supply the confidence');
  assert.deepEqual(normalized.extractedFields, { first_name: 'TESTCASE', last_name: 'SPECIMEN' });
  assert.equal(normalized.extractedFields.national_id_number, undefined,
    'a field the provider never read must not appear because the caller sent it');
  assert.equal(normalized.rawResponse.provider, 'cloudflare');
});

test('adversarial: an unreported confidence is stored as the zero sentinel, never as the caller value', () => {
  const normalized = normalizeProviderBackedExtraction(
    { confidence_score: 1, raw_response: providerResult({ confidence: 0.99, confidenceReported: false }) },
    GOVERNED_ROUTE,
  );
  assert.equal(normalized.confidenceScore, 0,
    'no confidenceReported flag means no measurement existed; 1 came from the caller and 0.99 was never attested');
  assert.equal(normalized.rawResponse.confidenceReported, false,
    'the raw result stays intact so a reviewer can see the measurement was absent');
});

test('adversarial: a provider result missing any execution proof is refused', () => {
  const cases = [
    ['no model', providerResult({ model: null })],
    ['no provider', providerResult({ provider: null })],
    ['succeeded status but success false', providerResult({ success: false })],
    ['success true but status not provider_succeeded', providerResult({ executionStatus: 'provider_failed' })],
    ['status absent entirely', providerResult({ executionStatus: undefined })],
    ['mock provider execution claiming success', providerResult({ executionStatus: 'mocked' })],
    ['no raw_response at all', undefined],
  ];
  for (const [label, raw] of cases) {
    assert.throws(
      () => normalizeProviderBackedExtraction({ raw_response: raw }, GOVERNED_ROUTE),
      /Provider-backed OCR execution evidence is required/,
      `must refuse: ${label}`,
    );
  }
});

test('adversarial: a successful provider that read nothing yields no fields and no invented confidence', () => {
  const normalized = normalizeProviderBackedExtraction(
    { extracted_fields: { first_name: 'FORGED' }, confidence_score: 0.8, raw_response: providerResult({ extractedData: undefined, confidenceReported: false }) },
    GOVERNED_ROUTE,
  );
  assert.deepEqual(normalized.extractedFields, {}, 'a no-content read must persist no fields');
  assert.equal(normalized.confidenceScore, 0);
});

test('adversarial: only the governed Diaspora run-ocr route may record provider-backed extraction', () => {
  const accepted = [
    '/api/diaspora/documents/doc-1/run-ocr',
    '/api/diaspora/trade-documents/doc-1/run-ocr',
    '/api/diaspora/documents/doc-1/run-ocr?trace=1',
  ];
  for (const originalUrl of accepted) {
    assert.doesNotThrow(
      () => normalizeProviderBackedExtraction({ raw_response: providerResult() }, { originalUrl }),
      `governed route must be accepted: ${originalUrl}`,
    );
  }

  const refused = [
    '/api/diaspora/documents/doc-1/extractions',
    '/api/diaspora/documents/doc-1/run-ocr-evil',
    '/api/diaspora/documents/doc-1/run-ocr/../extractions',
    '/api/vehicles/JTDBR32E870123456/evidence/ev-1/run-ocr',
    '/api/ai/ocr',
    '',
  ];
  for (const originalUrl of refused) {
    assert.throws(
      () => normalizeProviderBackedExtraction({ raw_response: providerResult() }, { originalUrl }),
      /Client-authored OCR extraction records are retired/,
      `must refuse: ${originalUrl || '(empty route)'}`,
    );
  }
});

test('adversarial: in runtime mode a call with no request context cannot use the test-mode passthrough', async () => {
  await asRuntime(() => {
    assert.throws(
      () => normalizeProviderBackedExtraction({
        extraction_provider: 'FORGED_PROVIDER',
        extracted_fields: { first_name: 'FORGED' },
        confidence_score: 1,
      }, null),
      /Client-authored OCR extraction records are retired/,
      'the NODE_ENV=test passthrough must not exist outside the test environment',
    );
  });

  // And the passthrough that does exist under test must never be reachable from the governed route
  // with forged content — it is bypassed entirely once a request is present.
  assert.throws(
    () => normalizeProviderBackedExtraction({ extraction_provider: 'FORGED' }, GOVERNED_ROUTE),
    /Provider-backed OCR execution evidence is required/,
  );
});

// ---------------------------------------------------------------------------------------------
// 2. Vehicle evidence — object scope
// ---------------------------------------------------------------------------------------------

const VIN = 'JTDBR32E870123456';

const baseVehicle = Object.freeze({
  vin: VIN,
  owner_id: 'owner-1',
  current_seller_id: 'owner-1',
  tenant_id: null,
  publication_status: 'draft',
  status: 'available',
  registration_status: 'local_registration_pending',
});

const baseEvidence = Object.freeze({
  id: 'ev-registration',
  vin: VIN,
  evidence_type: 'registration_document',
  evidence_class: 'registration',
  evidence_subtype: 'registration_book',
  storage_bucket: 'ocr-documents',
  file_path: `${VIN}/registration_book_specimen.png`,
  mime_type: 'image/png',
  verification_status: 'pending',
  uploaded_by: 'owner-1',
});

function makeClient({ vehicle = baseVehicle, evidence = null, authority = null, transfers = [] } = {}) {
  const writes = [];
  const from = (table) => {
    const filters = {};
    const chain = {
      select() { return chain; },
      update(payload) { writes.push({ table, op: 'update', payload }); return chain; },
      insert(payload) { writes.push({ table, op: 'insert', payload }); return chain; },
      eq(key, value) { filters[key] = value; return chain; },
      maybeSingle() { return Promise.resolve(resolve()); },
      single() { return Promise.resolve(resolve()); },
      then(res, rej) { return Promise.resolve(resolve()).then(res, rej); },
    };
    const resolve = () => {
      if (table === 'vehicles') return { data: vehicle || null, error: null };
      if (table === 'vehicle_evidence') {
        const matches = evidence
          && (!filters.id || filters.id === evidence.id)
          && (!filters.vin || filters.vin === evidence.vin);
        return { data: matches ? evidence : null, error: null };
      }
      if (table === 'vehicle_ownership_transfers') return { data: transfers, error: null };
      if (table === 'vehicle_seller_authority') return { data: authority, error: null };
      return { data: null, error: null };
    };
    return chain;
  };
  return { from, writes };
}

/** Storage and provider that record any contact — reaching either is itself the failure. */
function tripwires() {
  const touched = { storage: 0, ocr: 0, persist: 0 };
  return {
    touched,
    options: {
      storage: { downloadFromStorage: async () => { touched.storage += 1; return { buffer: Buffer.from('bytes'), mimeType: 'image/png' }; } },
      ocr: { extractDocumentData: async () => { touched.ocr += 1; return { success: true, provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', executionStatus: 'provider_succeeded', extractedData: {} }; } },
      persistExtractions: async () => { touched.persist += 1; return { extractions: [], mismatch_count: 0, pending_review_count: 0 }; },
      audit: async () => ({ success: true }),
    },
  };
}

test('adversarial: an evidence object outside this vehicle scope cannot be reached', async () => {
  const cases = [
    ['a different private bucket', { storage_bucket: 'vehicle-photos' }, /private document bucket/],
    ['a public bucket', { storage_bucket: 'public' }, /private document bucket/],
    ['a path belonging to another VIN', { file_path: 'WDB1234567890ABCD/registration_book.png' }, /outside this vehicle scope/],
    ['a traversal escape', { file_path: `${VIN}/../WDB1234567890ABCD/registration_book.png` }, /outside this vehicle scope/],
    ['an absolute path', { file_path: `/${VIN}/registration_book.png` }, /outside this vehicle scope/],
    ['a VIN-prefixed lookalike directory', { file_path: `${VIN}EXTRA/registration_book.png` }, /outside this vehicle scope/],
    ['no stored path at all', { file_path: null }, /no private storage path/],
    ['a photo rather than a document artifact', { evidence_type: 'vehicle_photo', evidence_class: null, evidence_subtype: null }, /canonical vehicle document artifact/],
  ];

  for (const [label, override, expected] of cases) {
    const evidence = { ...baseEvidence, ...override };
    const client = makeClient({ evidence });
    const { touched, options } = tripwires();
    await assert.rejects(
      runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, VIN, evidence.id, options),
      expected,
      `must refuse: ${label}`,
    );
    assert.equal(touched.storage, 0, `${label}: private bytes must not be downloaded`);
    assert.equal(touched.ocr, 0, `${label}: the provider must not be called`);
    assert.equal(touched.persist, 0, `${label}: nothing may be persisted`);
  }
});

test('adversarial: an evidence id belonging to another vehicle is not found under this VIN', async () => {
  const foreign = { ...baseEvidence, id: 'ev-foreign', vin: 'WDB1234567890ABCD' };
  const client = makeClient({ evidence: foreign });
  const { touched, options } = tripwires();
  await assert.rejects(
    runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, VIN, foreign.id, options),
    /Vehicle evidence item not found/,
  );
  assert.equal(touched.storage + touched.ocr + touched.persist, 0);
});

test('adversarial: a legacy compatibility label alone cannot select an OCR schema', async () => {
  // The row is a document artifact and passes object scope, but carries no canonical class. A
  // compatibility label is not a document-class authority, so the provider must never run.
  const legacyOnly = { ...baseEvidence, evidence_class: null, evidence_subtype: null };
  const client = makeClient({ evidence: legacyOnly });
  const { touched, options } = tripwires();
  await assert.rejects(
    runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, VIN, legacyOnly.id, options),
    /OCR is not enabled for vehicle document/,
  );
  assert.equal(touched.ocr, 0, 'no schema means no provider execution');
  assert.equal(touched.persist, 0);
});

// ---------------------------------------------------------------------------------------------
// 3. Vehicle evidence — authorization matrix, including the branches only runtime reaches
// ---------------------------------------------------------------------------------------------

test('adversarial: the governed dealer branch is live — matching tenant proceeds, foreign tenant is refused', async () => {
  const dealerVehicle = { ...baseVehicle, owner_id: 'someone-else', current_seller_id: null, tenant_id: 'tenant-1' };

  // Positive: without this the dealer branch could be dead code and every negative test would still pass.
  const okClient = makeClient({ vehicle: dealerVehicle, evidence: baseEvidence });
  const ok = tripwires();
  const result = await runVehicleEvidenceOcr(
    okClient,
    { id: 'dealer-user', role: 'dealer', tenantId: 'tenant-1' },
    VIN,
    baseEvidence.id,
    ok.options,
  );
  assert.equal(ok.touched.ocr, 1, 'a governed dealer in the vehicle tenant must reach the provider');
  assert.equal(result.vin, VIN);
  assert.equal(Object.values(result.authority_effects).every((v) => v === false), true);

  // Negative: a dealer whose verified tenant is not this vehicle's tenant.
  const foreignClient = makeClient({ vehicle: dealerVehicle, evidence: baseEvidence });
  const foreign = tripwires();
  await assert.rejects(
    runVehicleEvidenceOcr(foreignClient, { id: 'dealer-user', role: 'dealer', tenantId: 'tenant-2' }, VIN, baseEvidence.id, foreign.options),
    /governed dealer scope/,
  );
  assert.equal(foreign.touched.storage + foreign.touched.ocr, 0);

  // Negative: a dealer asserting no tenant at all.
  const noTenantClient = makeClient({ vehicle: dealerVehicle, evidence: baseEvidence });
  const noTenant = tripwires();
  await assert.rejects(
    runVehicleEvidenceOcr(noTenantClient, { id: 'dealer-user', role: 'dealer' }, VIN, baseEvidence.id, noTenant.options),
    /governed dealer scope/,
  );
  assert.equal(noTenant.touched.storage + noTenant.touched.ocr, 0);
});

test('adversarial: a revoked seller authority denies private document processing', async () => {
  const sellerVehicle = { ...baseVehicle, owner_id: 'new-owner', current_seller_id: 'seller-1' };
  const client = makeClient({ vehicle: sellerVehicle, evidence: baseEvidence, authority: { status: 'revoked' } });
  const { touched, options } = tripwires();
  await assert.rejects(
    runVehicleEvidenceOcr(client, { id: 'seller-1', role: 'owner' }, VIN, baseEvidence.id, options),
    /no longer authorizes private document processing/,
  );
  assert.equal(touched.storage + touched.ocr, 0);
});

test('adversarial: in runtime mode an asserted identity cannot process private vehicle documents', async () => {
  await asRuntime(async () => {
    const client = makeClient({ evidence: baseEvidence });
    const { touched, options } = tripwires();

    // No authenticationMethod at all — the shape a direct internal caller would produce.
    await assert.rejects(
      runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, VIN, baseEvidence.id, options),
      /requires a proven authenticated session/,
    );

    // Explicitly the header fallback, which requireProvenIdentity refuses at the route.
    await assert.rejects(
      runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner', authenticationMethod: 'x-user-id-fallback' }, VIN, baseEvidence.id, options),
      /requires a proven authenticated session/,
    );
    assert.equal(touched.storage + touched.ocr + touched.persist, 0,
      'an unproven identity must not reach private bytes');

    // A proven session is still allowed, so the guard is a gate and not a blanket refusal.
    const proven = makeClient({ evidence: baseEvidence });
    const provenCalls = tripwires();
    await runVehicleEvidenceOcr(
      proven,
      { id: 'owner-1', role: 'owner', authenticationMethod: 'session' },
      VIN,
      baseEvidence.id,
      provenCalls.options,
    );
    assert.equal(provenCalls.touched.ocr, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Candidate-only authority under adverse conditions
// ---------------------------------------------------------------------------------------------

test('adversarial: a provider claiming decisions and a failing audit still yield candidates only', async () => {
  const client = makeClient({ evidence: baseEvidence });
  const result = await runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, VIN, baseEvidence.id, {
    storage: { downloadFromStorage: async () => ({ buffer: Buffer.from('bytes'), mimeType: 'image/png' }) },
    ocr: {
      // A hostile provider response that asserts truth outcomes it has no authority to assert.
      extractDocumentData: async () => ({
        success: true,
        provider: 'cloudflare',
        model: '@cf/qwen/qwen3.8-27b',
        executionStatus: 'provider_succeeded',
        confidence: 1,
        verified: true,
        identity_verified: true,
        vehicle_registered: true,
        verification_status: 'verified',
        extractedData: { confidenceScore: 1, additional_fields: { vin: VIN, plate_number: 'ABC1234' } },
      }),
    },
    persistExtractions: async (payload) => ({
      extractions: payload.fields.map((f, i) => ({ id: `x-${i}`, review_status: 'pending', ...f })),
      mismatch_count: 0,
      pending_review_count: payload.fields.length,
    }),
    // Audit is secondary evidence: its failure may neither mint nor withhold the candidates.
    audit: async () => { throw new Error('audit sink unavailable'); },
  });

  assert.equal(result.success, true);
  assert.equal(result.candidates_persisted > 0, true, 'a failing audit must not withhold candidates');
  assert.equal(result.evidence_verification_status, 'pending',
    'a provider claiming "verified" may not advance the evidence status');
  assert.deepEqual(result.authority_effects, {
    identity_verified: false,
    dealer_compliant: false,
    seller_authorised: false,
    vehicle_registered: false,
    vehicle_trusted: false,
    listing_published: false,
  });
  assert.equal(
    client.writes.some((w) => ['vehicles', 'vehicle_evidence', 'vehicle_seller_authority'].includes(w.table)),
    false,
    'OCR may not write vehicle truth, evidence status or seller authority',
  );
});
