/**
 * OCR three-problem follow-up hardening.
 *
 * ZERO live provider calls. These guards prove the retired legacy parser cannot execute, Diaspora
 * cannot manufacture provider-backed OCR evidence, and vehicle-document OCR enforces its own
 * private-evidence authority boundary even if a future caller imports the service directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { runOcrParsing } = await import('../services/ai/aiServiceBus.js');
const { recordDocumentExtraction } = await import('../services/diaspora/diasporaDocumentService.js');
const { runVehicleEvidenceOcr } = await import('../services/evidence/vehicleDocumentOcrService.js');

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

function queryResult(data, error = null) {
  return { data, error };
}

function makeVehicleOnlyClient(vehicle) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle() {
          if (table === 'vehicles') return Promise.resolve(queryResult(vehicle));
          return Promise.resolve(queryResult(null));
        },
      };
      return chain;
    },
  };
}

test('problem 1: legacy runOcrParsing is permanently retired at the service boundary', async () => {
  await assert.rejects(
    runOcrParsing('registration_book', 'data:image/png;base64,AAAA', 'user-1'),
    (error) => error?.statusCode === 410 && error?.code === 'LEGACY_OCR_PATH_RETIRED',
  );

  const source = read('../services/ai/aiServiceBus.js');
  assert.doesNotMatch(source, /base64Data\.slice\(0,\s*100\)/);
  assert.doesNotMatch(source, /Image Payload Base64/);
  assert.match(source, /LEGACY_OCR_PATH_RETIRED/);
});

test('problem 2: client-authored Diaspora extraction is refused before any database read', async () => {
  await assert.rejects(
    recordDocumentExtraction(
      'doc-1',
      {
        extraction_provider: 'cloudflare',
        extracted_fields: { first_name: 'Fabricated' },
        confidence_score: 1,
        raw_response: {
          success: true,
          provider: 'cloudflare',
          model: '@cf/qwen/qwen3.8-27b',
          executionStatus: 'provider_succeeded',
        },
      },
      { id: 'user-1', role: 'owner' },
      { originalUrl: '/api/diaspora/documents/doc-1/extractions' },
    ),
    (error) => error?.statusCode === 410 && error?.code === 'CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED',
  );
});

test('problem 2: provider outage/no-reading cannot be persisted as OCR_EXTRACTED', async () => {
  await assert.rejects(
    recordDocumentExtraction(
      'doc-1',
      {
        extraction_provider: 'carup_ocr',
        extracted_fields: {},
        confidence_score: 0,
        raw_response: {
          success: false,
          provider: 'cloudflare',
          model: null,
          executionStatus: 'provider_failed',
          confidence: null,
          confidenceReported: false,
        },
      },
      { id: 'reviewer-1', role: 'reviewer' },
      { originalUrl: '/api/diaspora/documents/doc-1/run-ocr' },
    ),
    /Provider-backed OCR execution evidence is required/,
  );
});

test('problem 2: runtime persistence derives provider fields from raw provider result, not request duplicates', () => {
  const source = read('../services/diaspora/diasporaDocumentService.js');
  assert.match(source, /extractionProvider:\s*raw\.provider/);
  assert.match(source, /extractedFields,\s*confidenceScore,\s*rawResponse:\s*raw/);
  assert.match(source, /raw\.executionStatus !== 'provider_succeeded'/);
  assert.match(source, /raw\.success !== true/);
});

test('problem 3: vehicle OCR service refuses an unrelated tenant member who is not in dealer context', async () => {
  const vehicle = {
    vin: 'JTDBR32E870123456',
    owner_id: 'real-owner',
    current_seller_id: null,
    tenant_id: 'tenant-1',
    publication_status: 'draft',
    status: 'available',
    registration_status: 'local_registration_pending',
  };
  const client = makeVehicleOnlyClient(vehicle);
  let touched = false;

  await assert.rejects(
    runVehicleEvidenceOcr(
      client,
      { id: 'tenant-member', role: 'owner', tenantId: 'tenant-1' },
      vehicle.vin,
      'evidence-1',
      {
        storage: { downloadFromStorage: async () => { touched = true; return null; } },
        ocr: { extractDocumentData: async () => { touched = true; return {}; } },
      },
    ),
    /governed dealer scope/,
  );
  assert.equal(touched, false);
});

test('problem 3: vehicle OCR service refuses roles outside the governed private-document set', async () => {
  const vehicle = {
    vin: 'JTDBR32E870123456',
    owner_id: 'mechanic-1',
    current_seller_id: 'mechanic-1',
    tenant_id: null,
  };
  let queried = false;
  const client = {
    from() {
      queried = true;
      throw new Error('vehicle lookup must not run for an ineligible role');
    },
  };

  await assert.rejects(
    runVehicleEvidenceOcr(client, { id: 'mechanic-1', role: 'mechanic' }, vehicle.vin, 'evidence-1'),
    /cannot process private vehicle documents with OCR/,
  );
  assert.equal(queried, false);
});

test('problem 3: vehicle OCR route still requires proven identity and remains candidate-only', () => {
  const route = read('../routes/ocrConvergenceRoutes.js');
  const service = read('../services/evidence/vehicleDocumentOcrService.js');
  assert.match(route, /\/api\/vehicles\/:vin\/evidence\/:evidenceId\/run-ocr/);
  assert.match(route, /requireProvenIdentity\(\)/);
  assert.match(service, /Document Intelligence OBSERVES\. Vehicle Evidence \/ reviewers DECIDE/);
  assert.match(service, /identity_verified:\s*false/);
  assert.match(service, /dealer_compliant:\s*false/);
  assert.match(service, /seller_authorised:\s*false/);
  assert.match(service, /vehicle_registered:\s*false/);
  assert.match(service, /vehicle_trusted:\s*false/);
  assert.match(service, /listing_published:\s*false/);
});
