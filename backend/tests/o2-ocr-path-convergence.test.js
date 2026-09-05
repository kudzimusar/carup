/**
 * O2 OCR Path Convergence — permanent no-fabrication / single-path guards.
 * ZERO live provider calls. The provider/storage/persistence boundaries are injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  runVehicleEvidenceOcr,
  resolveVehicleOcrDocumentContract,
  toVehicleExtractionFields,
} = await import('../services/evidence/vehicleDocumentOcrService.js');

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const CONVERGENCE_ROUTER = read('../routes/ocrConvergenceRoutes.js');
const IDENTITY_ROUTER = read('../routes/identityVerificationRoutes.js');
const SERVER = read('../server.js');
const DIASPORA_ROUTER = read('../routes/diasporaRoutes.js');
const LEGACY_AI = read('../services/ai/aiServiceBus.js');

function queryResult(data, error = null) {
  return { data, error };
}

function makeClient({ vehicle, evidence, authority = null, transfers = [] } = {}) {
  const writes = [];
  const from = (table) => {
    const state = { table, filters: {}, op: 'select', payload: null };
    const chain = {
      select() { return chain; },
      update(payload) { state.op = 'update'; state.payload = payload; writes.push({ table, op: 'update', payload }); return chain; },
      insert(payload) { state.op = 'insert'; state.payload = payload; writes.push({ table, op: 'insert', payload }); return chain; },
      eq(key, value) { state.filters[key] = value; return chain; },
      maybeSingle() { return Promise.resolve(resolve()); },
      single() { return Promise.resolve(resolve()); },
      then(resolvePromise, rejectPromise) { return Promise.resolve(resolve()).then(resolvePromise, rejectPromise); },
    };
    const resolve = () => {
      if (table === 'vehicles') return queryResult(vehicle || null);
      if (table === 'vehicle_evidence') {
        const matches = evidence && (!state.filters.id || state.filters.id === evidence.id)
          && (!state.filters.vin || state.filters.vin === evidence.vin);
        return queryResult(matches ? evidence : null);
      }
      if (table === 'vehicle_ownership_transfers') return queryResult(transfers);
      if (table === 'vehicle_seller_authority') return queryResult(authority);
      if (table === 'trust_audit_events' || table === 'organization_audit_logs') return queryResult(null);
      return queryResult(null);
    };
    return chain;
  };
  return { from, writes };
}

const vehicle = {
  vin: 'JTDBR32E870123456',
  owner_id: 'owner-1',
  current_seller_id: 'owner-1',
  tenant_id: null,
  publication_status: 'draft',
  status: 'available',
  registration_status: 'local_registration_pending',
};

const registrationEvidence = {
  id: 'ev-registration',
  vin: vehicle.vin,
  evidence_type: 'registration_document',
  evidence_class: 'registration',
  evidence_subtype: 'registration_book',
  storage_bucket: 'ocr-documents',
  file_path: `${vehicle.vin}/registration_book_specimen.png`,
  mime_type: 'image/png',
  verification_status: 'pending',
  uploaded_by: 'owner-1',
};

const customsEvidence = {
  ...registrationEvidence,
  id: 'ev-customs',
  evidence_type: 'vehicle_life_document',
  evidence_class: 'import',
  evidence_subtype: 'customs_entry',
  file_path: `${vehicle.vin}/customs_entry_specimen.png`,
};

test('convergence: legacy generic OCR is retired at both route and service boundaries', () => {
  assert.match(CONVERGENCE_ROUTER, /router\.post\('\/api\/ai\/ocr'/);
  assert.match(CONVERGENCE_ROUTER, /LEGACY_OCR_PATH_RETIRED/);
  assert.match(CONVERGENCE_ROUTER, /res\.status\(410\)/);
  assert.match(LEGACY_AI, /LEGACY_OCR_PATH_RETIRED/, 'the compatibility symbol must fail closed if imported directly');
  assert.doesNotMatch(LEGACY_AI, /base64Data\.slice\(0,\s*100\)/, 'the hazardous truncated-base64 parser must be physically gone');
  assert.doesNotMatch(LEGACY_AI, /Image Payload Base64/, 'the old text-prompt OCR payload must not return');
  assert.match(IDENTITY_ROUTER, /ocrConvergenceRouter/);
  assert.ok(
    SERVER.indexOf('app.use(identityVerificationRouter)') < SERVER.indexOf("app.use('/api/diaspora', diasporaRouter)"),
    'convergence router must be mounted before Diaspora routes',
  );
  assert.ok(
    SERVER.indexOf('app.use(identityVerificationRouter)') < SERVER.indexOf("app.post('/api/ai/ocr'"),
    'convergence router must be mounted before the historical generic OCR handler',
  );
});

test('convergence: client-authored Diaspora OCR evidence is shadow-retired, genuine run-ocr remains distinct', () => {
  assert.match(CONVERGENCE_ROUTER, /CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED/);
  assert.match(CONVERGENCE_ROUTER, /\/api\/diaspora\/documents\/:documentId\/extractions/);
  assert.match(DIASPORA_ROUTER, /\/documents\/:id\/run-ocr/);
  assert.match(DIASPORA_ROUTER, /DocumentIntelligenceService\.extractDocumentData/);
});

test('convergence: only explicit canonical registration/customs document classes resolve', () => {
  assert.equal(resolveVehicleOcrDocumentContract(registrationEvidence)?.documentType, 'registration_book');
  assert.equal(resolveVehicleOcrDocumentContract(customsEvidence)?.documentType, 'customs_declaration');
  assert.equal(resolveVehicleOcrDocumentContract({
    ...registrationEvidence,
    evidence_class: null,
    evidence_subtype: null,
  }), null, 'legacy compatibility metadata alone must not choose an OCR schema');
  assert.equal(resolveVehicleOcrDocumentContract({
    ...registrationEvidence,
    evidence_class: 'inspection',
    evidence_subtype: 'roadworthiness',
  }), null);
});

test('convergence: extraction mapping persists observed values only and never invents confidence', () => {
  const fields = toVehicleExtractionFields(resolveVehicleOcrDocumentContract(registrationEvidence), {
    provider: 'cloudflare',
    model: '@cf/qwen/qwen3.8-27b',
    extractedData: {
      additional_fields: { vin: vehicle.vin, plate_number: 'ABC 1234', owner_name: 'SPECIMEN OWNER' },
      confidenceScore: null,
    },
  });
  assert.deepEqual(fields.map((f) => f.fieldName), ['vin', 'plate_number', 'owner_name']);
  assert.equal(fields.every((f) => f.confidence === null), true);
  assert.equal(fields.find((f) => f.fieldName === 'vin').comparedVehicleField, 'vin');
  assert.equal(fields.find((f) => f.fieldName === 'owner_name').comparedVehicleField, null);
});

test('convergence: owner registration-book OCR sends real stored bytes and persists review-pending candidates only', async () => {
  const client = makeClient({ vehicle, evidence: registrationEvidence });
  const calls = { storage: [], ocr: [], persist: [] };
  const result = await runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, vehicle.vin, registrationEvidence.id, {
    storage: {
      downloadFromStorage: async (bucket, path) => {
        calls.storage.push({ bucket, path });
        return { buffer: Buffer.from('real-synthetic-image-bytes'), mimeType: 'image/png' };
      },
    },
    ocr: {
      extractDocumentData: async (docType, dataUri, userId) => {
        calls.ocr.push({ docType, dataUri, userId });
        return {
          success: true,
          provider: 'cloudflare',
          model: '@cf/qwen/qwen3.8-27b',
          executionStatus: 'provider_succeeded',
          confidence: 0.95,
          extractedData: {
            confidenceScore: 0.95,
            additional_fields: {
              vin: vehicle.vin,
              chassis_number: vehicle.vin,
              plate_number: 'ABC1234',
              make: 'Toyota',
              model: 'Corolla',
              year: 2018,
              owner_name: 'SPECIMEN OWNER',
            },
          },
        };
      },
    },
    persistExtractions: async (payload) => {
      calls.persist.push(payload);
      return {
        extractions: payload.fields.map((field, index) => ({ id: `x-${index}`, review_status: 'pending', ...field })),
        mismatch_count: 0,
        pending_review_count: payload.fields.length,
      };
    },
    audit: async () => ({ success: true }),
  });

  assert.deepEqual(calls.storage, [{ bucket: 'ocr-documents', path: registrationEvidence.file_path }]);
  assert.equal(calls.ocr.length, 1);
  assert.equal(calls.ocr[0].docType, 'registration_book');
  assert.equal(calls.ocr[0].userId, 'owner-1');
  assert.match(calls.ocr[0].dataUri, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(calls.ocr[0].dataUri.split(',')[1], 'base64').toString(), 'real-synthetic-image-bytes');
  assert.equal(calls.persist.length, 1);
  assert.equal(calls.persist[0].evidenceId, registrationEvidence.id);
  assert.equal(calls.persist[0].fields.find((f) => f.fieldName === 'vin').comparedVehicleField, 'vin');
  assert.equal(result.evidence_verification_status, 'pending');
  assert.equal(result.candidates_persisted > 0, true);
  assert.deepEqual(result.authority_effects, {
    identity_verified: false,
    dealer_compliant: false,
    seller_authorised: false,
    vehicle_registered: false,
    vehicle_trusted: false,
    listing_published: false,
  });
  assert.equal(client.writes.some((w) => ['vehicles', 'vehicle_evidence'].includes(w.table)), false,
    'OCR may not mutate vehicle truth or evidence verification status');
});

test('convergence: customs entry uses the canonical customs schema and remains candidate-only', async () => {
  const client = makeClient({ vehicle, evidence: customsEvidence });
  let persisted;
  const result = await runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, vehicle.vin, customsEvidence.id, {
    storage: { downloadFromStorage: async () => ({ buffer: Buffer.from('customs-bytes'), mimeType: 'image/png' }) },
    ocr: { extractDocumentData: async (docType) => ({
      success: true,
      provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', executionStatus: 'provider_succeeded', confidence: 0.93,
      extractedData: { confidenceScore: 0.93, additional_fields: { vin: vehicle.vin, bill_entry_number: 'BOE-001', duty_value_zig: 100 } },
      _docType: docType,
    }) },
    persistExtractions: async (payload) => { persisted = payload; return { extractions: payload.fields, mismatch_count: 0, pending_review_count: payload.fields.length }; },
    audit: async () => ({ success: true }),
  });
  assert.equal(result.document_type, 'customs_declaration');
  assert.equal(persisted.documentType, 'customs_declaration');
  assert.equal(persisted.fields.find((f) => f.fieldName === 'vin').comparedVehicleField, 'vin');
  assert.equal(persisted.fields.find((f) => f.fieldName === 'bill_entry_number').comparedVehicleField, null);
  assert.equal(client.writes.some((w) => w.table === 'vehicles' || w.table === 'vehicle_evidence'), false);
});

test('convergence: unrelated user is refused before storage or OCR', async () => {
  const client = makeClient({ vehicle, evidence: registrationEvidence });
  let touched = false;
  await assert.rejects(
    runVehicleEvidenceOcr(client, { id: 'other-user', role: 'owner' }, vehicle.vin, registrationEvidence.id, {
      storage: { downloadFromStorage: async () => { touched = true; throw new Error('must not run'); } },
      ocr: { extractDocumentData: async () => { touched = true; throw new Error('must not run'); } },
      audit: async () => ({ success: true }),
    }),
    /scope over this vehicle/,
  );
  assert.equal(touched, false);
});

test('convergence: former seller is refused even if a stale current-seller relationship remains', async () => {
  const staleVehicle = { ...vehicle, owner_id: 'new-owner', current_seller_id: 'former-owner' };
  const client = makeClient({
    vehicle: staleVehicle,
    evidence: registrationEvidence,
    transfers: [{ id: 'tr-1', state: 'complete', previous_owner_id: 'former-owner', completed_at: '2026-09-01T00:00:00Z' }],
  });
  let touched = false;
  await assert.rejects(
    runVehicleEvidenceOcr(client, { id: 'former-owner', role: 'owner' }, vehicle.vin, registrationEvidence.id, {
      storage: { downloadFromStorage: async () => { touched = true; throw new Error('must not run'); } },
      ocr: { extractDocumentData: async () => { touched = true; throw new Error('must not run'); } },
      audit: async () => ({ success: true }),
    }),
    /no longer authorizes private document processing/,
  );
  assert.equal(touched, false);
});

test('convergence: unsupported canonical document is refused before provider execution', async () => {
  const unsupported = {
    ...registrationEvidence,
    id: 'ev-roadworthy',
    evidence_type: 'vehicle_life_document',
    evidence_class: 'inspection',
    evidence_subtype: 'roadworthiness',
  };
  const client = makeClient({ vehicle, evidence: unsupported });
  let providerCalls = 0;
  await assert.rejects(
    runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, vehicle.vin, unsupported.id, {
      storage: { downloadFromStorage: async () => ({ buffer: Buffer.from('x'), mimeType: 'image/png' }) },
      ocr: { extractDocumentData: async () => { providerCalls += 1; return {}; } },
      audit: async () => ({ success: true }),
    }),
    /OCR is not enabled for vehicle document inspection\/roadworthiness/,
  );
  assert.equal(providerCalls, 0);
});

test('convergence: provider failure creates no field-level candidates and cannot become authority', async () => {
  const client = makeClient({ vehicle, evidence: registrationEvidence });
  let persisted = false;
  const result = await runVehicleEvidenceOcr(client, { id: 'owner-1', role: 'owner' }, vehicle.vin, registrationEvidence.id, {
    storage: { downloadFromStorage: async () => ({ buffer: Buffer.from('bytes'), mimeType: 'image/png' }) },
    ocr: { extractDocumentData: async () => ({
      success: false,
      provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', executionStatus: 'provider_failed',
      confidence: null, extractedData: {},
    }) },
    persistExtractions: async () => { persisted = true; throw new Error('must not persist'); },
    audit: async () => ({ success: true }),
  });
  assert.equal(result.success, false);
  assert.equal(result.execution_status, 'provider_failed');
  assert.equal(result.candidates_persisted, 0);
  assert.equal(persisted, false);
  assert.equal(Object.values(result.authority_effects).every((value) => value === false), true);
});
