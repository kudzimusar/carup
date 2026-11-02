/**
 * Bounded diagnostic: is CarUp's requested json_schema SUPPRESSING fields the model can read?
 *
 * Both Qwen and Gemma independently declared date_of_birth, country and date_of_issue
 * "unreadable" on a fixture where those values are printed in 25px bold. That coincidence points
 * at the request rather than the models. This probe sends the SAME image and SAME prompt with the
 * schema varied, and reports which fields come back. It changes no product behaviour.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.env.ALLOW_OCR_MOCK = 'false';
process.env.NODE_ENV ||= 'production';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'probe';
process.env.SUPABASE_ANON_KEY ||= 'probe';
process.env.JWT_SECRET ||= 'probe';

const { askCloudflareVision } = await import(`${root}/backend/services/ai/CloudflareVisionClient.js`);
const { resolveCloudflareModel } = await import(`${root}/backend/services/ai/ocrVisionProvider.js`);
const { resolveSchema, printedLabelsFor } = await import(`${root}/backend/services/document-intelligence/documentSchemas.js`);

const MODELS = process.env.CARUP_OCR_MODEL
  ? [process.env.CARUP_OCR_MODEL]
  : ['@cf/google/gemma-4-26b-a4b-it', '@cf/qwen/qwen3.8-27b'];
const schema = resolveSchema('national_id');
const base64 = readFileSync(`${root}/docs/features/o2/uat-assets/ocr-corpus/national-id-clean.png`).toString('base64');
const image = [{ mimeType: 'image/png', base64 }];

const fieldLines = Object.keys(schema.fields).map((f) => {
  const label = printedLabelsFor(f);
  return label ? `  - ${f} — printed on the document as ${label}` : `  - ${f}`;
}).join('\n');

const systemPrompt = `You are the CarUp document transcription agent. You are shown the actual image of a ${schema.label}.

Transcribe ONLY what is legibly printed on the attached document.

Fields to look for:
${fieldLines}

RULES:
- OMIT any field you cannot read on the document. Do not guess or infer.
- Any format or shape described here is a description only; never copy an example into a value.

OUTPUT FORMAT — absolute: your entire reply must be ONE raw JSON object and nothing else.

{"document_class_observed": string, "legible": boolean, "fields": {}, "unreadable_fields": [], "observations": [], "confidence": number|null}`;

const withUnionTypes = {
  name: 'carup_reading',
  schema: {
    type: 'object',
    properties: {
      document_class_observed: { type: 'string' }, legible: { type: 'boolean' },
      confidence: { type: ['number', 'null'] },
      unreadable_fields: { type: 'array', items: { type: 'string' } },
      observations: { type: 'array', items: { type: 'string' } },
      fields: { type: 'object', properties: Object.fromEntries(Object.keys(schema.fields).map((f) => [f, { type: ['string', 'number', 'null'] }])) },
    },
    required: ['document_class_observed', 'fields'],
  },
};
const withStringTypes = JSON.parse(JSON.stringify(withUnionTypes));
for (const k of Object.keys(withStringTypes.schema.properties.fields.properties)) {
  withStringTypes.schema.properties.fields.properties[k] = { type: 'string' };
}
withStringTypes.schema.properties.confidence = { type: 'number' };

const variants = [
  ['A: current schema (union types incl. null)', withUnionTypes],
  ['B: plain string types', withStringTypes],
  ['C: NO response_format at all', null],
];

const EXPECT = ['first_name', 'last_name', 'national_id_number', 'date_of_birth', 'country', 'sex', 'place_of_birth', 'date_of_issue'];
for (const model of MODELS) {
console.log(`\n================ ${model} ================`);
for (const [label, jsonSchema] of variants) {
  try {
    const { content, usage } = await askCloudflareVision(systemPrompt, `Transcribe the attached ${schema.label}.`, image, jsonSchema, { model });
    let parsed = content;
    if (typeof parsed === 'string') {
      const a = parsed.indexOf('{'); const b = parsed.lastIndexOf('}');
      try { parsed = JSON.parse(a > -1 && b > a ? parsed.slice(a, b + 1) : parsed); } catch { parsed = { __raw: String(content).slice(0, 300) }; }
    }
    const fields = parsed?.fields ?? {};
    const got = EXPECT.filter((f) => fields[f] !== undefined && fields[f] !== null && String(fields[f]).trim() !== '');
    console.log(`${label}`);
    console.log(`   read ${got.length}/8 : ${got.join(', ')}`);
    console.log(`   missing         : ${EXPECT.filter((f) => !got.includes(f)).join(', ') || '(none)'}`);
    console.log(`   unreadable_fields: ${JSON.stringify(parsed?.unreadable_fields ?? null)}`);
    console.log(`   values          : ${JSON.stringify(fields).slice(0, 320)}`);
    console.log(`   neurons ${usage?.neurons?.toFixed?.(2) ?? '?'}  completionTokens ${usage?.completionTokens ?? '?'}\n`);
  } catch (e) {
    console.log(`${label}\n   FAILED: ${e.message}\n`);
  }
}
}
