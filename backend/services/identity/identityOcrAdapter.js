// Identity-only adapter over the historical O2 vision transport and document schemas.
// It emits observations, never identity decisions or trust changes.
import { configuredIdentityVisionProvider } from '../ai/ocrVisionProvider.js';
import { decodeDocumentPayload } from '../document-intelligence/documentMedia.js';
import { DOCUMENT_SCHEMAS, FIELD_ALIASES, OCR_SCHEMA_VERSION } from '../document-intelligence/documentSchemas.js';
import { evidenceImageMime } from './evidenceImageFormat.js';

const TYPES = Object.freeze({ national_id: 'national_id', passport: 'passport', driver_license: 'drivers_license', drivers_license: 'drivers_license' });

export function makeIdentityOcrAdapter(provider) {
  if (!provider || typeof provider.extract !== 'function') return null;
  return {
    async classifyDocument(front, _back, _selfie, docType) {
      const schema = DOCUMENT_SCHEMAS[TYPES[docType]];
      const mimeType = evidenceImageMime(front);
      if (!schema || !mimeType) return { classification: 'unsupported_document', classificationConfidence: null, reason: 'Unsupported document.', provider: provider.id, model: provider.model };
      try {
        const output = await provider.extract({
          systemPrompt: `Classify the attached image as ${schema.label} or not. Return only JSON with document_class_observed equal to ${schema.documentClass} or non_document, and legible as true or false.`,
          textPrompt: 'Classify the attached image without extracting personal details.',
          images: [{ mimeType, base64: front.toString('base64') }], jsonSchema: null,
        });
        const value = typeof output.content === 'string' ? JSON.parse(output.content) : output.content;
        const valid = value && value.document_class_observed === schema.documentClass && value.legible === true;
        return { classification: valid ? 'valid_identity_document' : 'uncertain', classificationConfidence: null, reason: valid ? 'Document classification requires independent review.' : 'Document could not be classified.', provider: provider.id, model: provider.model };
      } catch {
        return { classification: 'uncertain', classificationConfidence: null, reason: 'Classification provider unavailable.', reasonCode: 'OCR_PROVIDER_FAILED', provider: provider.id, model: provider.model };
      }
    },
    async extractDocumentData(docType, dataUri) {
    const key = TYPES[docType];
    const schema = key && DOCUMENT_SCHEMAS[key];
    if (!schema) return { success: false, error: 'UNSUPPORTED_DOCUMENT' };
    let media;
    try { media = decodeDocumentPayload(dataUri); } catch { return { success: false, error: 'INVALID_DOCUMENT_MEDIA' }; }
    const actualMime = evidenceImageMime(media.buffer);
    if (!actualMime || actualMime !== media.mimeType || (media.declaredMimeType && media.declaredMimeType.replace('image/jpg','image/jpeg') !== actualMime)) {
      return { success: false, error: 'INVALID_DOCUMENT_MEDIA' };
    }
    const fields = Object.keys(schema.fields);
    const systemPrompt = `Transcribe only legible text actually present in the attached ${schema.label}. Do not guess. Return only JSON with document_class_observed, legible, and fields. Allowed fields: ${fields.join(', ')}. If it is not a ${schema.label}, set document_class_observed to non_document and fields to {}. Expected document_class_observed for this type: ${schema.documentClass}.`;
    let output;
    try {
      output = await provider.extract({ systemPrompt, textPrompt: 'Classify the actual image and read only visible fields.', images: [{ mimeType: actualMime, base64: media.base64 }], jsonSchema: null });
    } catch { return { success: false, error: 'OCR_PROVIDER_UNAVAILABLE', provider: provider.id, model: provider.model }; }
    let parsed;
    try { parsed = typeof output.content === 'string' ? JSON.parse(output.content) : output.content; } catch { return { success: false, error: 'OCR_PROVIDER_INVALID_OUTPUT', provider: provider.id, model: provider.model }; }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || typeof parsed.document_class_observed !== 'string' || !parsed.fields || typeof parsed.fields !== 'object' || Array.isArray(parsed.fields)) {
      return { success: false, error: 'OCR_PROVIDER_INVALID_OUTPUT', provider: provider.id, model: provider.model };
    }
    if (parsed.document_class_observed !== schema.documentClass) return { success: false, error: 'UNSUPPORTED_DOCUMENT', provider: provider.id, model: provider.model };
    if (typeof parsed.legible !== 'boolean') return { success: false, error: 'OCR_PROVIDER_INVALID_OUTPUT', provider: provider.id, model: provider.model };
    if (parsed.legible === false) return { success: false, error: 'DOCUMENT_UNREADABLE', provider: provider.id, model: provider.model };
    const extractedData = {};
    const additional = {};
    for (const [name, spec] of Object.entries(schema.fields)) {
      const candidates = [name, ...(FIELD_ALIASES[name] || [])];
      const value = candidates.map(k => parsed.fields[k]).find(v => v !== undefined && v !== null && v !== '');
      const normalized = spec.normalize(value);
      if (normalized.value === undefined) continue;
      if (spec.target === 'top') extractedData[name] = normalized.value; else additional[name] = normalized.value;
    }
    if (Object.keys(additional).length) extractedData.additional_fields = additional;
    return { success: true, extractedData, provider: provider.id, model: provider.model,
      schemaVersion: OCR_SCHEMA_VERSION, documentClass: schema.documentClass, confidence: null };
  } };
}

export function configuredIdentityOcrAdapter() {
  return makeIdentityOcrAdapter(configuredIdentityVisionProvider());
}
