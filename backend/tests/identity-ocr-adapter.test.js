import { PNG } from 'pngjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeIdentityOcrAdapter } from '../services/identity/identityOcrAdapter.js';
import { configuredIdentityVisionProvider } from '../services/ai/ocrVisionProvider.js';

const png = PNG.sync.write(new PNG({ width: 16, height: 16 }));
const data = `data:image/png;base64,${png.toString('base64')}`;

test('adapter sends actual bytes and retains only schema observations', async () => {
  let input;
  const adapter = makeIdentityOcrAdapter({ id: 'test-double', model: 'fixture', extract: async request => {
    input = request;
    return { content: { document_class_observed: 'passport', legible: true, fields: { first_name: 'Ada', last_name: 'Banda', national_id_number: 'AB123', mystery: 'ignore' } } };
  } });
  const result = await adapter.extractDocumentData('passport', data);
  assert.equal(result.success, true);
  assert.deepEqual(Buffer.from(input.images[0].base64, 'base64'), png);
  assert.equal(result.extractedData.first_name, 'Ada');
  assert.equal(result.extractedData.mystery, undefined);
  assert.equal(result.extractedData.date_of_birth, undefined);
  assert.equal(result.confidence, null);
  assert.equal(result.provider, 'test-double');
});

test('unsupported, invalid media and non-document fail closed', async () => {
  const adapter = makeIdentityOcrAdapter({ id: 'fixture', model: 'fixture', extract: async () => ({ content: { document_class_observed: 'non_document', fields: { first_name: 'Hallucination' } } }) });
  assert.equal((await adapter.extractDocumentData('residence_permit', data)).error, 'UNSUPPORTED_DOCUMENT');
  assert.equal((await adapter.extractDocumentData('passport', 'data:image/png;base64,Ym9ndXM=')).error, 'INVALID_DOCUMENT_MEDIA');
  assert.equal((await adapter.extractDocumentData('passport', data)).error, 'UNSUPPORTED_DOCUMENT');
});

test('bad output and provider failure remain distinct and contain no invented data', async () => {
  const invalid = makeIdentityOcrAdapter({ id: 'fixture', model: 'fixture', extract: async () => ({ content: 'bad json' }) });
  const outage = makeIdentityOcrAdapter({ id: 'fixture', model: 'fixture', extract: async () => { throw new Error('private'); } });
  assert.equal((await invalid.extractDocumentData('passport', data)).error, 'OCR_PROVIDER_INVALID_OUTPUT');
  const failure = await outage.extractDocumentData('passport', data);
  assert.equal(failure.error, 'OCR_PROVIDER_UNAVAILABLE');
  assert.equal(failure.sideAssessment.front, 'failed');
  assert.doesNotMatch(JSON.stringify(failure), /private/);
});

test('configured document classes preserve only their own observations and require a legibility verdict', async () => {
  for (const [type, documentClass, field] of [
    ['national_id', 'zimbabwe_national_id', 'national_id_number'],
    ['passport', 'passport', 'passport_number'],
    ['drivers_license', 'drivers_licence', 'licence_number'],
  ]) {
    function adapter(output) {
      return makeIdentityOcrAdapter({ id: 'fixture', model: 'fixture', extract: async () => ({ content: output }) });
    }
    const fields = { [field]: 'FIXTURE-123', date_of_birth: 'unreadable', mystery_field: 'must not appear' };
    const result = await adapter({ document_class_observed: documentClass, legible: true, fields }).extractDocumentData(type, data);
    assert.equal(result.documentClass, documentClass);
    assert.equal(result.schemaVersion, '2026.09.ocr-v1');
    assert.equal((result.extractedData[field] ?? result.extractedData.additional_fields?.[field]), 'FIXTURE-123');
    assert.equal(result.extractedData.date_of_birth, undefined);
    assert.doesNotMatch(JSON.stringify(result), /mystery_field|must not appear/);
    assert.equal((await adapter({ document_class_observed: documentClass, fields }).extractDocumentData(type, data)).error, 'OCR_PROVIDER_INVALID_OUTPUT');
    assert.equal((await adapter({ document_class_observed: documentClass, legible: false, fields }).extractDocumentData(type, data)).error, 'DOCUMENT_UNREADABLE');
  }
});

test('real provider is off unless explicitly enabled and unsafe model remains refused', () => {
  assert.equal(configuredIdentityVisionProvider({}), null);
  assert.equal(configuredIdentityVisionProvider({ CARUP_IDENTITY_OCR_ENABLED: 'true', CARUP_OCR_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: 'test', CLOUDFLARE_API_TOKEN: 'test', CARUP_OCR_MODEL: '@cf/meta/llama-3.2-11b-vision-instruct' }), null);
});

test('single-sided classification excludes the selfie and fails closed on provider outage', async () => {
  let request;
  const adapter = makeIdentityOcrAdapter({ id: 'fixture', model: 'fixture', extract: async input => {
    request = input; return { content: { document_class_observed: 'passport', legible: true } };
  } });
  const result = await adapter.classifyDocument(png, null, Buffer.from('selfie'), 'passport');
  assert.equal(result.classification, 'valid_identity_document');
  assert.equal(request.images.length, 1);
  assert.deepEqual(Buffer.from(request.images[0].base64, 'base64'), png);
  const outage = makeIdentityOcrAdapter({ id: 'fixture', model: 'fixture', extract: async () => { throw new Error('private'); } });
  const unavailable = await outage.classifyDocument(png, null, null, 'passport');
  assert.equal(unavailable.reasonCode, 'OCR_PROVIDER_FAILED');
  assert.equal(unavailable.classification, 'uncertain');
});

test('two-sided evidence attributes readings and refuses conflicting observations', async () => {
  const reverse = PNG.sync.write(new PNG({ width: 20, height: 20 }));
  const backDataUri = 'data:image/png;base64,' + reverse.toString('base64');
  const observed = [];
  let backNumber = 'AB-123';
  let backClass = 'zimbabwe_national_id';
  const adapter = makeIdentityOcrAdapter({ id: 'fixture', model: 'fixture', extract: async ({ images }) => {
    const bytes = Buffer.from(images[0].base64, 'base64');
    const isBack = bytes.equals(reverse);
    assert.ok(isBack || bytes.equals(png));
    observed.push(isBack ? 'back' : 'front');
    return { content: { document_class_observed: isBack ? backClass : 'zimbabwe_national_id', legible: true,
      fields: isBack ? { national_id_number: backNumber, date_of_birth: '1992-01-01' }
        : { national_id_number: 'AB123', first_name: 'Synthetic' } } };
  } });
  assert.equal((await adapter.classifyDocument(png, reverse, null, 'national_id')).classification, 'valid_identity_document');
  assert.deepEqual(observed.sort(), ['back', 'front']);
  const matching = await adapter.extractDocumentData('national_id', data, null, { backDataUri });
  assert.equal(matching.sideAssessment.comparison, 'consistent_overlap');
  assert.equal(matching.extractedData.date_of_birth, '1992-01-01');
  assert.deepEqual(matching.sideAssessment.fieldSources.date_of_birth, ['back']);
  backNumber = 'ZZ999';
  const conflict = await adapter.extractDocumentData('national_id', data, null, { backDataUri });
  assert.equal(conflict.success, false);
  assert.equal(conflict.error, 'DOCUMENT_SIDE_MISMATCH');
  assert.deepEqual(conflict.sideAssessment.conflictingFields, ['national_id_number']);
  assert.deepEqual(conflict.extractedData, {});
  backClass = 'non_document';
  assert.equal((await adapter.classifyDocument(png, reverse, null, 'national_id')).classification, 'uncertain');
});

test('decoder refuses corrupted image data and dimensions beyond the pixel limit', async () => {
  const { validateDecodedEvidenceImage } = await import('../services/identity/decodeEvidenceImage.js');
  const damaged = Buffer.from(png);
  damaged.fill(0xff, 41, 49); // Damage IDAT while retaining the PNG envelope.
  await assert.rejects(validateDecodedEvidenceImage(damaged), /readable single image/);
  const oversized = new PNG({ width: 4096, height: 4000 });
  await assert.rejects(validateDecodedEvidenceImage(PNG.sync.write(oversized)), /size limits/);
});
