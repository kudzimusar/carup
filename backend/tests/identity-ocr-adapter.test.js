import test from 'node:test';
import assert from 'node:assert/strict';
import { makeIdentityOcrAdapter } from '../services/identity/identityOcrAdapter.js';
import { configuredIdentityVisionProvider } from '../services/ai/ocrVisionProvider.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
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
  assert.deepEqual(await outage.extractDocumentData('passport', data), { success: false, error: 'OCR_PROVIDER_UNAVAILABLE', provider: 'fixture', model: 'fixture' });
});

test('real provider is off unless explicitly enabled and unsafe model remains refused', () => {
  assert.equal(configuredIdentityVisionProvider({}), null);
  assert.equal(configuredIdentityVisionProvider({ CARUP_IDENTITY_OCR_ENABLED: 'true', CARUP_OCR_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: 'test', CLOUDFLARE_API_TOKEN: 'test', CARUP_OCR_MODEL: '@cf/meta/llama-3.2-11b-vision-instruct' }), null);
});

test('classification sends the front image only and fails closed on provider outage', async () => {
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
