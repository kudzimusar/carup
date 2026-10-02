/**
 * Capability declaration for the canonical CarUp AI gateway.
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

export class CarUpAiUnsupportedModalityError extends Error {
  constructor(modality) {
    super('Unsupported AI modality: ' + modality);
    this.name = 'CarUpAiUnsupportedModalityError';
    this.code = 'AI_UNSUPPORTED_MODALITY';
    this.modality = modality;
  }
}

export function assertSupportedInput(input = {}) {
  for (const modality of AI_UNSUPPORTED_MODALITIES) {
    if (input[modality] !== undefined && input[modality] !== null) {
      throw new CarUpAiUnsupportedModalityError(modality);
    }
  }
}

export function inspectAiCapabilities() {
  return {
    operations: Object.keys(AI_GATEWAY_CAPABILITIES),
    capabilities: AI_GATEWAY_CAPABILITIES,
    unsupportedModalities: [...AI_UNSUPPORTED_MODALITIES],
    authority:
      'AI may observe, extract, classify, explain, summarize, draft and recommend. Domain authorities decide.',
  };
}
