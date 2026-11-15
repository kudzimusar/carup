/**
 * Capability declaration and fail-closed input contract for the canonical
 * CarUp AI gateway.
 *
 * These are inference capabilities only. They do not grant domain authority.
 */

export const AI_GATEWAY_CAPABILITIES = Object.freeze({
  generateText: Object.freeze({ input: ['text'], output: 'text' }),
  generateJson: Object.freeze({ input: ['text'], output: 'json' }),
  analyzeImage: Object.freeze({ input: ['text', 'image'], output: 'text' }),
  classifyImage: Object.freeze({ input: ['text', 'image'], output: 'json' }),
  extractStructuredData: Object.freeze({ input: ['text', 'image?'], output: 'json' }),
});

export const AI_UNSUPPORTED_MODALITIES = Object.freeze(['audio', 'video']);
export const AI_SUPPORTED_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const NON_IMAGE_MEDIA_ALIASES = Object.freeze(['images', 'audio', 'video', 'media']);

export class CarUpAiUnsupportedModalityError extends Error {
  constructor(modality) {
    super('Unsupported AI modality: ' + modality);
    this.name = 'CarUpAiUnsupportedModalityError';
    this.code = 'AI_UNSUPPORTED_MODALITY';
    this.modality = modality;
  }
}

export class CarUpAiImageRequiredError extends Error {
  constructor(operation = 'image inference') {
    super(operation + ' requires exactly one supported image.');
    this.name = 'CarUpAiImageRequiredError';
    this.code = 'AI_IMAGE_REQUIRED';
  }
}

function hasInferencePayload(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (ArrayBuffer.isView(value)) return value.byteLength > 0;
  if (value instanceof ArrayBuffer) return value.byteLength > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function modalityForMime(mimeType) {
  if (!mimeType) return 'unknown-media';
  const [family] = mimeType.split('/');
  if (['audio', 'video', 'application', 'text', 'image'].includes(family)) {
    return family === 'image' ? mimeType : family;
  }
  return mimeType;
}

/**
 * Validate and normalize the single-image transport accepted by AI-01-B.
 *
 * A base64-bearing object is not accepted as an image unless its MIME type is
 * one of the formats explicitly certified for this provider path.
 */
export function normalizeSupportedImage(image, { operation = 'image inference' } = {}) {
  if (!hasInferencePayload(image)) {
    throw new CarUpAiImageRequiredError(operation);
  }

  if (Array.isArray(image)) {
    throw new CarUpAiUnsupportedModalityError('images');
  }

  if (typeof image !== 'object') {
    throw new CarUpAiUnsupportedModalityError('image');
  }

  const base64 = typeof image.base64 === 'string' ? image.base64.trim() : '';
  if (!base64) {
    throw new CarUpAiImageRequiredError(operation);
  }

  const mimeType = String(image.mimeType ?? '').trim().toLowerCase();
  if (!AI_SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new CarUpAiUnsupportedModalityError(modalityForMime(mimeType));
  }

  return {
    mimeType,
    base64,
  };
}

/**
 * Operation-specific media contract.
 *
 * Known media-bearing aliases are rejected rather than silently ignored.
 * Text-only operations reject image input. Image operations require one
 * certified image. Structured extraction permits text-only or text + one image.
 */
export function assertOperationInput(operation, input = {}) {
  for (const alias of NON_IMAGE_MEDIA_ALIASES) {
    if (hasInferencePayload(input[alias])) {
      throw new CarUpAiUnsupportedModalityError(alias === 'images' ? 'images' : alias);
    }
  }

  const hasImage = hasInferencePayload(input.image);

  switch (operation) {
    case 'generateText':
    case 'generateJson':
      if (hasImage) {
        throw new CarUpAiUnsupportedModalityError('image');
      }
      return;

    case 'analyzeImage':
    case 'classifyImage':
      normalizeSupportedImage(input.image, { operation });
      return;

    case 'extractStructuredData':
      if (hasImage) {
        normalizeSupportedImage(input.image, { operation });
      }
      return;

    default:
      throw new Error('Unknown CarUp AI gateway operation: ' + operation);
  }
}

/**
 * Compatibility guard retained for callers/tests that only need the global
 * audio/video rule. Canonical gateway operations use assertOperationInput().
 */
export function assertSupportedInput(input = {}) {
  for (const modality of AI_UNSUPPORTED_MODALITIES) {
    if (hasInferencePayload(input[modality])) {
      throw new CarUpAiUnsupportedModalityError(modality);
    }
  }
}

export function inspectAiCapabilities() {
  return {
    operations: Object.keys(AI_GATEWAY_CAPABILITIES),
    capabilities: AI_GATEWAY_CAPABILITIES,
    supportedImageMimeTypes: [...AI_SUPPORTED_IMAGE_MIME_TYPES],
    unsupportedModalities: [...AI_UNSUPPORTED_MODALITIES],
    authority:
      'AI may observe, extract, classify, explain, summarize, draft and recommend. Domain authorities decide.',
  };
}
