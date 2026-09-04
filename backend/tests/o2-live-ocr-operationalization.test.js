/**
 * Live OCR Operationalization — permanent regression guards.
 *
 * These pin the four fabrications this lane removed, so none of them can return:
 *   1. extraction that never looked at the image (a text prompt carrying 150 characters of
 *      truncated base64);
 *   2. blur / glare / tamper-suspicion "measurements" derived from an MD5 hash of the payload;
 *   3. candidate placeholders — 'Unknown', 'N/A', today's date as a date of birth, sex 'M',
 *      year 2020, and the national-ID number reused as a plate number and a customs bill entry;
 *   4. a confidence score the provider never reported.
 *
 * The boundary itself (extraction observes, governed services decide) is pinned by
 * o2-x1-document-intelligence-authority.test.js and re-asserted here for the new code paths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { supabase } = await import('../db/supabase.js');
const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { evaluateOcrEvidence } = await import('../services/identity/verificationSessionService.js');
const { resolveSchema } = await import('../services/document-intelligence/documentSchemas.js');

const here = new URL('.', import.meta.url).pathname;
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const SERVICE = read('../services/document-intelligence/documentIntelligenceService.js');
const PROVIDER_BOUNDARY = read('../services/ai/ocrVisionProvider.js');
const CLOUDFLARE = read('../services/ai/CloudflareVisionClient.js');
const CLOUDFLARE_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const MEDIA = read('../services/document-intelligence/documentMedia.js');
const SCHEMAS = read('../services/document-intelligence/documentSchemas.js');

/** A real 1x1 PNG: signature, IHDR and all. The bytes matter — they are what gets sent. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_DATA_URI = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

function captureWrites(writes) {
  return () => (table) => ({
    insert: (row) => { writes.push({ table, op: 'insert', row }); return Promise.resolve({ data: null, error: null }); },
    update: (row) => { writes.push({ table, op: 'update', row }); return Promise.resolve({ data: null, error: null }); },
    upsert: (row) => { writes.push({ table, op: 'upsert', row }); return Promise.resolve({ data: null, error: null }); },
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  });
}

/** Runs the SHIPPED extraction against a provider stand-in, with a real API key present. */
async function extractWith(t, { reading, docType = 'national_id', payload = PNG_DATA_URI }) {
  const writes = [];
  const calls = [];
  t.mock.method(supabase, 'from', captureWrites(writes)());

  const savedMock = process.env.ALLOW_OCR_MOCK;
  process.env.ALLOW_OCR_MOCK = 'false';
  try {
    // A test double standing in for the CONFIGURED provider. It declares the identity it is
    // standing in for, so a reading can never be attributed to a provider never contacted.
    const visionClient = async (systemPrompt, textPrompt, images, jsonSchema) => {
      calls.push({ systemPrompt, textPrompt, images, jsonSchema });
      if (typeof reading === 'function') return reading();
      return typeof reading === 'string' ? reading : JSON.stringify(reading);
    };
    const result = await DocumentIntelligenceService.extractDocumentData(
      docType, payload, 'user-ocr-lane',
      { visionClient, visionClientIdentity: { id: 'cloudflare', model: CLOUDFLARE_MODEL } },
    );
    return { result, writes, calls };
  } finally {
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
}

// ---------------------------------------------------------------------------------------
// 1. The image is genuinely sent, and the text-only path cannot come back.
// ---------------------------------------------------------------------------------------

test('live-ocr: the document BYTES are sent to the provider as an inline media part', async (t) => {
  const { calls } = await extractWith(t, {
    reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.94, fields: { first_name: 'Tinashe', last_name: 'Moyo', national_id_number: '29-198427-G-45' } },
  });

  assert.equal(calls.length, 1, 'exactly one provider call is made');
  const [call] = calls;
  assert.ok(Array.isArray(call.images) && call.images.length === 1, 'the call carries an image part');
  assert.equal(call.images[0].mimeType, 'image/png', 'the media type travels with the bytes');
  assert.deepEqual(
    Buffer.from(call.images[0].base64, 'base64'),
    PNG_BYTES,
    'the provider receives the COMPLETE original bytes, not a truncated prefix',
  );
  assert.ok(call.jsonSchema && call.jsonSchema.schema, 'a structured response schema is requested');
  assert.equal(
    call.jsonSchema.schema.properties.fields.properties.first_name !== undefined, true,
    'the requested schema is derived from CarUp\'s own document schema',
  );
  assert.deepEqual(call.jsonSchema.schema.required, ['document_class_observed', 'fields'],
    'no document field is ever required of the reader — a required field invites invention');
  assert.ok(
    !`${call.systemPrompt}${call.textPrompt}`.includes(PNG_BYTES.toString('base64').slice(0, 24)),
    'no base64 payload is smuggled into the text prompt',
  );
});

test('live-ocr: the truncated-base64 text path is gone from the source', () => {
  assert.doesNotMatch(SERVICE, /askGemini\b(?!Vision)/, 'the text-only client must not be imported or called');
  assert.doesNotMatch(SERVICE, /base64Data\s*\.\s*slice/, 'no truncated base64 may be built');
  assert.doesNotMatch(SERVICE, /Image payload base64/, 'the text-prompt payload line must not return');
  assert.doesNotMatch(SERVICE, /slice\(0,\s*150\)/);
  assert.match(SERVICE, /configuredProvider\.extract\(/, 'extraction goes through the provider boundary');
  assert.match(SERVICE, /mimeType: media\.mimeType, base64: media\.base64/, 'the real bytes are the image part');
  assert.match(CLOUDFLARE, /image: usable\[0\]\.base64/, 'Cloudflare receives the real image bytes');
  assert.doesNotMatch(CLOUDFLARE, /\.slice\(0,\s*\d+\)/, 'no truncated payload may be sent');
});

// ---------------------------------------------------------------------------------------
// 2. Missing stays missing.
// ---------------------------------------------------------------------------------------

test('live-ocr: fields the provider did not read are ABSENT, never defaulted', async (t) => {
  const { result } = await extractWith(t, {
    reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.93, fields: { first_name: 'Tinashe' } },
  });

  const data = result.extractedData;
  assert.equal(data.first_name, 'Tinashe');
  for (const field of ['last_name', 'national_id_number', 'date_of_birth']) {
    assert.equal(data[field], undefined, `${field} was not read and must not be present`);
  }
  assert.equal(data.additional_fields.sex, undefined, 'sex must not default to M');
  assert.deepEqual(
    data.missingFields.sort(),
    ['country', 'date_of_birth', 'date_of_issue', 'last_name', 'national_id_number', 'place_of_birth', 'sex'],
    'every unobserved field is reported as missing',
  );

  // Only the candidate VALUES are searched: provenance legitimately carries today's date as the
  // moment extraction ran, which is a fact about the run, not a reading off the document.
  const values = JSON.stringify({ ...data.additional_fields, ...Object.fromEntries(
    Object.entries(data).filter(([key]) => !['additional_fields', 'provenance', 'observedFields', 'missingFields', 'unreadableFields', 'unnormalizedValues', 'observations', 'confidenceScore'].includes(key)),
  ) });
  for (const placeholder of ['Unknown', 'N/A', new Date().toISOString().split('T')[0]]) {
    assert.ok(!values.includes(placeholder), `a partial reading must not contain the placeholder ${placeholder}`);
  }
});

test('live-ocr: an incomplete reading writes NO structured candidate row', async (t) => {
  const { result, writes } = await extractWith(t, {
    reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.93, fields: { first_name: 'Tinashe' } },
  });

  assert.equal(writes.some((w) => w.table === 'ocr_national_ids'), false,
    'no candidate row may be manufactured from a reading missing its required fields');
  assert.equal(result.structuredCandidate.written, false);
  assert.equal(result.structuredCandidate.skippedReason, 'required_fields_not_observed');
  assert.equal(result.extractionStatus, 'Pending_Manual_Review');
});

test('live-ocr: a complete reading DOES write the structured candidate, with observed values only', async (t) => {
  const { result, writes } = await extractWith(t, {
    reading: {
      document_class_observed: 'zimbabwe_national_id',
      confidence: 0.96,
      fields: {
        first_name: 'Tinashe', last_name: 'Moyo', national_id_number: '29-198427-G-45',
        date_of_birth: '1984-06-15', sex: 'M', country: 'Zimbabwe',
      },
    },
  });

  const row = writes.find((w) => w.table === 'ocr_national_ids');
  assert.ok(row, 'a fully observed reading is recorded as a structured candidate');
  assert.equal(row.row.extracted_first_name, 'Tinashe');
  assert.equal(row.row.date_of_birth, '1984-06-15');
  assert.equal(row.row.raw_verification_confidence, 0.96);
  assert.equal(row.row.place_of_birth, undefined, 'an unobserved optional column is omitted, not filled');
  assert.equal(result.structuredCandidate.written, true);
  assert.equal(result.extractionStatus, 'Pending_Verification');
});

test('live-ocr: the source carries no candidate defaults at all', () => {
  for (const fabrication of [
    /\|\|\s*'Unknown'/, /\|\|\s*'N\/A'/, /\|\|\s*2020/, /\|\|\s*'M'/,
    /date_of_birth:\s*[^,\n]*new Date\(\)/,
    /extracted_stamp_date:\s*[^,\n]*new Date\(\)/,
    /parsedData\.national_id_number/,
    /confidenceScore\s*\|\|\s*0\.9/,
  ]) {
    assert.doesNotMatch(SERVICE, fabrication, `the service must not contain ${fabrication}`);
  }
  assert.doesNotMatch(SCHEMAS, /\|\|\s*'Unknown'|\|\|\s*'N\/A'/, 'schemas declare fields, they do not supply defaults');
});

test('live-ocr: an identity number is never reused as a plate number or a customs bill entry', async (t) => {
  const registration = await extractWith(t, {
    docType: 'registration_book',
    reading: {
      document_class_observed: 'vehicle_registration_book',
      confidence: 0.9,
      fields: { national_id_number: '29-198427-G-45', vin: 'JTDBR32E870123456', make: 'Toyota', model: 'Corolla', year: 2018, owner_name: 'Croco Motors' },
    },
  });
  assert.equal(registration.result.extractedData.additional_fields.plate_number, undefined,
    'an unread plate number stays unread — it is not borrowed from an identity number');
  assert.equal(registration.writes.some((w) => w.table === 'ocr_registration_books'), false,
    'and no registration candidate row is written without it');

  const customs = await extractWith(t, {
    docType: 'customs_declaration',
    reading: {
      document_class_observed: 'customs_declaration',
      confidence: 0.9,
      fields: { national_id_number: '29-198427-G-45', vin: 'JTDBR32E870123456', importer_name: 'Croco Motors', stamp_date: '2026-03-14', duty_value_zig: 100 },
    },
  });
  assert.equal(customs.result.extractedData.additional_fields.bill_entry_number, undefined,
    'an unread bill of entry number stays unread');
  assert.equal(customs.writes.some((w) => w.table === 'ocr_customs_declarations'), false);
});

// ---------------------------------------------------------------------------------------
// 3. Quality is observed or declared unmeasured — never invented.
// ---------------------------------------------------------------------------------------

test('live-ocr: image quality is reported as NOT MEASURED, with only genuinely readable media facts', async (t) => {
  const { result } = await extractWith(t, {
    reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.9, fields: { first_name: 'A', last_name: 'B', national_id_number: 'C' } },
  });

  const quality = result.qualityMetrics;
  assert.equal(quality.measured, false);
  assert.equal(quality.blur, 'not_measured');
  assert.equal(quality.glare, 'not_measured');
  assert.equal(quality.tamperSuspicion, 'not_measured');
  assert.equal(quality.blurScore, null);
  assert.equal(quality.glareScore, null);
  assert.equal(quality.tamperSuspicionScore, null);
  assert.equal(quality.qualityPassed, null);
  assert.equal(quality.media.mimeType, 'image/png');
  assert.equal(quality.media.byteSize, PNG_BYTES.length);
  assert.equal(quality.media.widthPx, 1, 'dimensions come from the PNG header, which really carries them');
  assert.equal(quality.media.heightPx, 1);
});

test('live-ocr: no hash-derived scores and no unmeasured quality verdicts remain', () => {
  assert.doesNotMatch(SERVICE, /createHash\(['"]md5['"]\)/, 'quality must not be derived from a digest');
  assert.doesNotMatch(MEDIA, /createHash/, 'the media reader measures nothing it cannot read');
  assert.doesNotMatch(SERVICE, /charCodeSum/);
  for (const verdict of [
    /status\s*[=:]\s*'Poor_Image_Quality'/, /status\s*[=:]\s*'Suspected_Tampering'/,
    /qualityIssues\.push\('(blur|glare|tampering)'\)/,
  ]) {
    assert.doesNotMatch(SERVICE, verdict,
      'CarUp does not measure image quality or tampering, so it may not return those verdicts');
  }
});

test('live-ocr: analyzeImageQuality answers honestly for readable and unreadable payloads alike', () => {
  const readable = DocumentIntelligenceService.analyzeImageQuality(PNG_DATA_URI);
  assert.equal(readable.measured, false);
  assert.equal(readable.media.widthPx, 1);

  const garbage = DocumentIntelligenceService.analyzeImageQuality('not-a-document');
  assert.equal(garbage.measured, false);
  assert.equal(garbage.media, null, 'nothing is claimed about bytes that could not be read');
});

// ---------------------------------------------------------------------------------------
// 4. Confidence exists only when the provider reported it.
// ---------------------------------------------------------------------------------------

test('live-ocr: an unreported confidence stays null and cannot verify anything', async (t) => {
  const { result } = await extractWith(t, {
    reading: {
      document_class_observed: 'zimbabwe_national_id',
      fields: { first_name: 'Tinashe', last_name: 'Moyo', national_id_number: '29-198427-G-45', date_of_birth: '1984-06-15' },
    },
  });

  assert.equal(result.extractedData.confidenceScore, null, 'no confidence is invented');
  assert.equal(result.confidenceReported, false);
  assert.equal(result.extractedData.provenance.confidenceReported, false);
  assert.equal(result.structuredCandidate.written, false);
  assert.equal(result.structuredCandidate.skippedReason, 'provider_reported_no_confidence',
    'a row whose confidence column is NOT NULL is not written on a confidence nobody gave');

  const verdict = evaluateOcrEvidence(result);
  assert.equal(verdict.sufficient, false);
  assert.match(verdict.reason, /did not report a confidence/);
});

test('live-ocr: the identity gate no longer substitutes an image-quality number for confidence', () => {
  const identity = read('../services/identity/verificationSessionService.js');
  assert.doesNotMatch(identity, /qualityMetrics\?\.\s*blurScore/,
    'blurScore must never stand in for a provider confidence again');
  assert.equal(
    evaluateOcrEvidence({ success: true, qualityMetrics: { blurScore: 0.99 }, extractedData: { first_name: 'A', last_name: 'B' } }).sufficient,
    false,
    'a high blur score cannot carry an extraction over the verification threshold',
  );
});

test('live-ocr: an out-of-range or non-numeric provider confidence is discarded, not clamped', async (t) => {
  for (const supplied of [1.4, -0.2, 'high', {}]) {
    const { result } = await extractWith(t, {
      reading: {
        document_class_observed: 'zimbabwe_national_id', confidence: supplied,
        fields: { first_name: 'A', last_name: 'B', national_id_number: 'C' },
      },
    });
    assert.equal(result.extractedData.confidenceScore, null, `confidence ${JSON.stringify(supplied)} is not usable and must be dropped`);
  }
});

// ---------------------------------------------------------------------------------------
// 5. Failure is honest, and distinct from "nothing found".
// ---------------------------------------------------------------------------------------

test('live-ocr: a provider that is not configured fails as a PROVIDER failure with no fields', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', captureWrites(writes)());
  const savedKey = process.env.GEMINI_API_KEY;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  delete process.env.GEMINI_API_KEY;
  process.env.ALLOW_OCR_MOCK = 'false';
  try {
    const result = await DocumentIntelligenceService.extractDocumentData('national_id', PNG_DATA_URI, 'user-ocr-lane');
    assert.equal(result.success, false);
    assert.equal(result.extractedData, undefined, 'a failed extraction surfaces no identity fields');
    assert.equal(result.ocrFailureReason, 'AI_OCR_EXTRACTION_FAILED');
    assert.equal(result.executionStatus, 'provider_failed');
    assert.equal(result.extractionStatus, 'OCR_Provider_Unavailable');
    assert.equal(writes.find((w) => w.table === 'ocr_documents').row.status, 'OCR_Provider_Unavailable');
  } finally {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

test('live-ocr: a provider error is a provider failure, distinct from a reading that found nothing', async (t) => {
  const failed = await extractWith(t, { reading: () => { throw new Error('502 Bad Gateway from vision endpoint'); } });
  assert.equal(failed.result.success, false);
  assert.equal(failed.result.executionStatus, 'provider_failed');
  assert.equal(failed.result.extractionStatus, 'OCR_Provider_Unavailable');
  assert.equal(failed.result.extractedData, undefined);

  const empty = await extractWith(t, {
    reading: { document_class_observed: 'non_document', legible: false, fields: {} },
  });
  assert.equal(empty.result.executionStatus, 'provider_succeeded', 'the provider answered — it did not fail');
  assert.equal(empty.result.extractionStatus, 'Pending_Manual_Review');
  assert.equal(empty.result.success, false, 'but nothing was read, so there is no candidate');
  assert.deepEqual(empty.result.extractedData.observedFields, []);
  assert.ok(empty.result.qualityMetrics.qualityIssues.includes('no_fields_extracted'));
  assert.ok(empty.result.qualityMetrics.qualityIssues.includes('provider_reported_illegible'));
});

test('live-ocr: a JSON object wrapped in provider prose is recovered — and NOTHING is inferred from the prose', async (t) => {
  const { result } = await extractWith(t, {
    reading: 'Here is the reading you asked for:\n\n```json\n{"document_class_observed":"zimbabwe_national_id","confidence":0.9,"fields":{"first_name":"TESTCASE","last_name":"SPECIMEN","national_id_number":"63-1234567-A-42"}}\n```\nHope that helps!',
  });
  assert.equal(result.success, true);
  assert.equal(result.extractedData.first_name, 'TESTCASE');
  assert.equal(result.extractedData.last_name, 'SPECIMEN');
  // Only the JSON object is read. Values mentioned in the prose are not evidence.
  const prose = await extractWith(t, {
    reading: 'The surname on this card is MOYO and the given name is TENDAI. {"document_class_observed":"zimbabwe_national_id","fields":{}}',
  });
  assert.equal(prose.result.extractedData.first_name, undefined, 'a name stated in prose is not a reading');
  assert.equal(prose.result.extractedData.last_name, undefined);
  assert.deepEqual(prose.result.extractedData.observedFields, []);
});

test('live-ocr: malformed provider output fails CLOSED', async (t) => {
  for (const malformed of ['this is not json', '[1,2,3]', '', 'I could not read the document, sorry.']) {
    const { result } = await extractWith(t, { reading: malformed });
    assert.equal(result.success, false, `output ${JSON.stringify(malformed)} must not produce a reading`);
    assert.equal(result.extractedData, undefined);
    assert.equal(result.extractionStatus, 'OCR_Provider_Unavailable');
  }
});

test('live-ocr: a file the provider cannot read is refused BEFORE any bytes are sent', async (t) => {
  const writes = [];
  const calls = [];
  t.mock.method(supabase, 'from', captureWrites(writes)());
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-provider-key-not-a-real-credential';
  try {
    const result = await DocumentIntelligenceService.extractDocumentData(
      'national_id',
      `data:text/plain;base64,${Buffer.from('this is a text file, not a document scan').toString('base64')}`,
      'user-ocr-lane',
      { visionClient: async (...args) => { calls.push(args); return '{}'; } },
    );
    assert.equal(calls.length, 0, 'an unsupported file is never uploaded to the provider');
    assert.equal(result.success, false);
    assert.equal(result.extractionStatus, 'Pending_Manual_Review', 'a human can still look at it — the provider did not fail');
    assert.equal(result.executionStatus, 'not_attempted');
    assert.ok(result.qualityMetrics.qualityIssues.includes('unsupported_media_type'));
  } finally {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
  }
});

// ---------------------------------------------------------------------------------------
// 6. Provenance, schemas, and the authority boundary.
// ---------------------------------------------------------------------------------------

test('live-ocr: every reading carries provider provenance', async (t) => {
  const { result } = await extractWith(t, {
    reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.91, fields: { first_name: 'A', last_name: 'B', national_id_number: 'C' } },
  });

  const { provenance } = result.extractedData;
  assert.equal(provenance.provider, 'cloudflare');
  assert.equal(provenance.model, CLOUDFLARE_MODEL);
  assert.equal(provenance.executionStatus, 'provider_succeeded');
  assert.equal(provenance.documentClassRequested, 'zimbabwe_national_id');
  assert.equal(provenance.documentClassObserved, 'zimbabwe_national_id');
  assert.equal(provenance.confidenceReported, true);
  assert.equal(provenance.imageBytesSent, PNG_BYTES.length);
  assert.equal(provenance.mimeTypeSent, 'image/png');
  assert.ok(Number.isFinite(provenance.latencyMs));
  assert.ok(!Number.isNaN(Date.parse(provenance.extractedAt)));
  assert.match(provenance.schemaVersion, /^\d{4}\.\d{2}\.ocr-v\d+$/);
  assert.equal(result.model, CLOUDFLARE_MODEL);
  assert.equal(result.provider, 'cloudflare');
  assert.equal(provenance.mediaWidthPx, 1, 'media facts travel with the reading');
  assert.equal('providerUsage' in provenance, true, 'provider-reported usage has a recorded slot');
});

test('live-ocr: each document class is extracted against its own schema', () => {
  const classes = {
    national_id: 'zimbabwe_national_id',
    passport: 'passport',
    drivers_license: 'drivers_licence',
    registration_book: 'vehicle_registration_book',
    customs_declaration: 'customs_declaration',
    dealer_business_registration: 'business_document',
  };
  for (const [docType, documentClass] of Object.entries(classes)) {
    assert.equal(resolveSchema(docType).documentClass, documentClass);
  }
  assert.equal(resolveSchema('registration_book').fields.first_name, undefined,
    'a registration book has no first name field to fill');
  assert.equal(resolveSchema('national_id').fields.vin, undefined,
    'a national ID has no VIN field to fill');
});

test('live-ocr: a reading is discarded when it cannot be normalized, and the raw value is kept as an observation', async (t) => {
  const { result } = await extractWith(t, {
    reading: {
      document_class_observed: 'zimbabwe_national_id', confidence: 0.9,
      fields: { first_name: 'A', last_name: 'B', national_id_number: 'C', date_of_birth: '03/04/1990', sex: 'X' },
    },
  });
  assert.equal(result.extractedData.date_of_birth, undefined,
    '03/04/1990 cannot be resolved to a day and month without guessing');
  assert.deepEqual(result.extractedData.unnormalizedValues.date_of_birth, { value: '03/04/1990', reason: 'ambiguous_day_month' });
  assert.equal(result.extractedData.additional_fields.sex, undefined, 'a sex the column cannot hold is not coerced to M');
  assert.deepEqual(result.extractedData.unnormalizedValues.sex, { value: 'X', reason: 'sex_marker_not_representable' },
    'an ICAO X marker is preserved as an observation rather than dropped or forced');
});

test('live-ocr: a registration book carries the chassis/VIN identifier across ONLY when it is a real VIN', async (t) => {
  // The document prints one 17-character identifier under a combined "Chassis / VIN" label, and a
  // reader that fills only one of the two fields has still read it. Carrying it across is not
  // invention — but only a value that IS a VIN may be carried.
  const carried = await extractWith(t, {
    docType: 'registration_book',
    reading: {
      document_class_observed: 'vehicle_registration_book', confidence: 0.95,
      fields: { chassis_number: 'JTDBR32E870123456', make: 'Toyota', model: 'Corolla', year: 2018, plate_number: 'AEB 4729', owner_name: 'Specimen Motors' },
    },
  });
  assert.equal(carried.result.extractedData.additional_fields.vin, 'JTDBR32E870123456');
  assert.deepEqual(carried.result.extractedData.carriedIdentifiers, [{ field: 'vin', from: 'chassis_number' }],
    'the carry is recorded, so the reading never looks like two independent observations');
  assert.equal(carried.result.extractedData.missingFields.includes('vin'), false);

  const notAVin = await extractWith(t, {
    docType: 'registration_book',
    reading: {
      document_class_observed: 'vehicle_registration_book', confidence: 0.95,
      fields: { chassis_number: 'CHS-2019-0042', make: 'Toyota', model: 'Corolla', year: 2018, plate_number: 'AEB 4729', owner_name: 'Specimen Motors' },
    },
  });
  assert.equal(notAVin.result.extractedData.additional_fields.vin, undefined,
    'a chassis number that is not a VIN leaves the VIN missing');
  assert.deepEqual(notAVin.result.extractedData.carriedIdentifiers, []);
  assert.equal(notAVin.writes.some((w) => w.table === 'ocr_registration_books'), false,
    'and with no VIN there is no structured candidate row');
});

test('live-ocr: the provider is told WHY it returned no text, and a hung call is bounded', () => {
  const client = read('../services/ai/GeminiClient.js');
  assert.doesNotMatch(client, /throw new Error\('Malformed Gemini vision API response'\)/,
    'one generic message hid a MAX_TOKENS finish, a safety block and an HTTP error alike');
  assert.match(client, /finishReason/, 'the finish reason is surfaced');
  assert.match(client, /blockReason/, 'a safety block is surfaced');
  assert.match(client, /AbortSignal\.timeout/, 'a hung provider call is bounded');
  assert.match(PROVIDER_BOUNDARY, /thinkingBudget: 0/, 'transcription does not spend its output budget on thinking');
  assert.match(CLOUDFLARE, /AbortSignal\.timeout/, 'a hung Cloudflare call is bounded too');
  assert.match(CLOUDFLARE, /refused the request/, 'Cloudflare refusals name the provider error');
});

test('live-ocr: absence spellings from the provider are read as absence, not as values', async (t) => {
  const { result } = await extractWith(t, {
    reading: {
      document_class_observed: 'zimbabwe_national_id', confidence: 0.9,
      fields: { first_name: 'Tinashe', last_name: 'N/A', national_id_number: 'not visible', date_of_birth: 'unknown' },
    },
  });
  assert.equal(result.extractedData.last_name, undefined);
  assert.equal(result.extractedData.national_id_number, undefined);
  assert.equal(result.extractedData.date_of_birth, undefined);
});

test('live-ocr: extraction still writes ONLY ocr evidence tables and decides nothing', async (t) => {
  const { writes } = await extractWith(t, {
    reading: {
      document_class_observed: 'zimbabwe_national_id', confidence: 0.99,
      fields: { first_name: 'Tinashe', last_name: 'Moyo', national_id_number: '29-198427-G-45', date_of_birth: '1984-06-15' },
    },
  });
  const allowed = new Set(['ocr_documents', 'ocr_national_ids', 'ocr_registration_books', 'ocr_customs_declarations']);
  for (const write of writes) {
    assert.ok(allowed.has(write.table), `extraction wrote to ${write.table}`);
  }
  assert.equal(typeof DocumentIntelligenceService.approveDocumentVerification, 'undefined');
  assert.doesNotMatch(SERVICE, /identity_verifications|is_verified|dealer_profiles|seller_authority/,
    'a candidate never becomes a verification, a dealer status or a seller authority here');
});

test('live-ocr: a machine candidate never reaches identity truth without the user and a governed reviewer', () => {
  const identity = read('../services/identity/verificationSessionService.js');
  assert.match(identity, /extractDocumentData\(session\.document_type, frontDataUri, session\.user_id\)/);
  assert.match(identity, /EXTRACTION_TRUST_STATUS\.(UNTRUSTED|PARTIALLY_TRUSTED)/,
    'a successful extraction is at most partially trusted');
  assert.doesNotMatch(
    identity,
    /status:\s*'verified'[\s\S]{0,200}extractDocumentData/,
    'extraction alone must not write a verified status',
  );
});

// ---------------------------------------------------------------------------------------
// 7. The test seam cannot become a production bypass, and no payload is logged.
// ---------------------------------------------------------------------------------------

test('live-ocr: no runtime module injects a vision client or enables the OCR mock', () => {
  const runtimeDirs = ['../routes', '../services', '../middleware'].map((d) => path.resolve(here, d));
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!full.endsWith('.js')) continue;
      const source = readFileSync(full, 'utf8');
      if (/visionClient\s*:/.test(source) || /ALLOW_OCR_MOCK\s*=\s*['"]true['"]/.test(source)) {
        offenders.push(path.relative(path.resolve(here, '..'), full));
      }
    }
  };
  runtimeDirs.forEach(walk);
  assert.deepEqual(offenders, [], 'the provider seam is for tests only');
});

test('live-ocr: no document bytes are written to the logs', async (t) => {
  const payloadBase64 = PNG_BYTES.toString('base64');
  const captured = [];
  const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = (...args) => captured.push(args.join(' '));
  console.warn = (...args) => captured.push(args.join(' '));
  console.error = (...args) => captured.push(args.join(' '));
  console.info = (...args) => captured.push(args.join(' '));
  try {
    await extractWith(t, {
      reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.9, fields: { first_name: 'A', last_name: 'B', national_id_number: 'C' } },
    });
    await extractWith(t, { reading: () => { throw new Error('provider exploded'); } });
  } finally {
    Object.assign(console, originals);
  }

  const transcript = captured.join('\n');
  assert.ok(!transcript.includes(payloadBase64), 'the base64 payload must never be logged');
  assert.ok(!transcript.includes(payloadBase64.slice(0, 32)), 'not even a prefix of it');
});

test('live-ocr: the persisted evidence row records provenance, not the document payload', async (t) => {
  const { writes } = await extractWith(t, {
    reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.9, fields: { first_name: 'A', last_name: 'B', national_id_number: 'C' } },
  });
  const master = writes.find((w) => w.table === 'ocr_documents');
  assert.ok(!master.row.extracted_json.includes(PNG_BYTES.toString('base64')), 'no payload is persisted');
  assert.ok(!/^data:/.test(master.row.file_path), 'no data URI is persisted as a file path');
  assert.equal(master.row.user_id, 'user-ocr-lane');
  assert.equal(JSON.parse(master.row.extracted_json).provenance.provider, 'cloudflare');
});

// ---------------------------------------------------------------------------------------
// 8. Test-mode simulation stays labelled as simulation.
// ---------------------------------------------------------------------------------------

test('live-ocr: the test-mode reader is labelled simulated everywhere it travels', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', captureWrites(writes)());
  const savedKey = process.env.GEMINI_API_KEY;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  delete process.env.GEMINI_API_KEY;
  process.env.ALLOW_OCR_MOCK = 'true';
  try {
    const result = await DocumentIntelligenceService.extractDocumentData('national_id', PNG_DATA_URI, 'user-ocr-lane');
    assert.equal(result.provider, 'mock');
    assert.equal(result.executionStatus, 'simulated');
    assert.equal(result.mock, true);
    assert.equal(result.extractedData.provenance.provider, 'mock');
    assert.equal(result.extractedData.provenance.executionStatus, 'simulated');
    assert.equal(JSON.parse(writes.find((w) => w.table === 'ocr_documents').row.extracted_json).provenance.provider, 'mock');
  } finally {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

test('live-ocr: simulation is unreachable once a real provider key is configured', async (t) => {
  const { result, calls } = await extractWith(t, {
    reading: { document_class_observed: 'zimbabwe_national_id', confidence: 0.9, fields: { first_name: 'A', last_name: 'B', national_id_number: 'C' } },
  });
  assert.equal(calls.length, 1, 'the provider is called, not the sample document');
  assert.equal(result.mock, undefined);
  assert.equal(result.provider, 'cloudflare');
  assert.match(SERVICE, /!configuredProvider\.isConfigured\(\) && DocumentIntelligenceService\.isOcrMockAllowed\(\)/);
});
