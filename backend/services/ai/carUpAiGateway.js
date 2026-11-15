import {
  AI_GATEWAY_CAPABILITIES,
  assertOperationInput,
  inspectAiCapabilities,
} from './aiCapabilities.js';
import { CARUP_AI_MODEL, CARUP_AI_PROVIDER } from './aiRuntimeConfig.js';
import {
  CarUpAiProviderError,
  createCloudflareGemmaProvider,
} from './cloudflareGemmaProvider.js';

function provenanceFrom(provider, result = null) {
  return result?.provenance || {
    provider: provider?.id || CARUP_AI_PROVIDER,
    model: provider?.model || CARUP_AI_MODEL,
  };
}

function normalizeFailure(error, provider) {
  return {
    ok: false,
    error: {
      code: error?.code || 'AI_GATEWAY_ERROR',
      message: error?.message || 'CarUp AI gateway request failed.',
      retryable: Boolean(error?.retryable),
      status: error?.status ?? null,
    },
    provenance: provenanceFrom(provider),
  };
}

function parseStructuredContent(content) {
  if (content && typeof content === 'object') return content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new CarUpAiProviderError(
      'Gemma returned no structured content.',
      { code: 'AI_MALFORMED_RESPONSE' },
    );
  }

  try {
    return JSON.parse(content.trim());
  } catch {
    throw new CarUpAiProviderError(
      'Gemma returned malformed JSON; no structured result was accepted.',
      { code: 'AI_MALFORMED_RESPONSE' },
    );
  }
}

export function createCarUpAiGateway({
  env = process.env,
  fetchImpl = globalThis.fetch,
  provider = null,
} = {}) {
  const selectedProvider = provider || createCloudflareGemmaProvider({ env, fetchImpl });

  async function run(operation, input, request, transform = (value) => value) {
    try {
      assertOperationInput(operation, input);
      const result = await selectedProvider.generate(request);
      return {
        ok: true,
        value: transform(result.content),
        provenance: provenanceFrom(selectedProvider, result),
        usage: result.usage ?? null,
      };
    } catch (error) {
      return normalizeFailure(error, selectedProvider);
    }
  }

  return Object.freeze({
    async generateText(input = {}) {
      return run('generateText', input, {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        signal: input.signal,
      });
    },

    async generateJson(input = {}) {
      return run('generateJson', input, {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        expectJson: true,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        signal: input.signal,
      }, parseStructuredContent);
    },

    async analyzeImage(input = {}) {
      return run('analyzeImage', input, {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        image: input.image,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        signal: input.signal,
      });
    },

    async classifyImage(input = {}) {
      return run('classifyImage', input, {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        image: input.image,
        expectJson: true,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        signal: input.signal,
      }, parseStructuredContent);
    },

    async extractStructuredData(input = {}) {
      return run('extractStructuredData', input, {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        image: input.image || null,
        expectJson: true,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        signal: input.signal,
      }, parseStructuredContent);
    },

    inspect() {
      try {
        return {
          ok: true,
          runtime: selectedProvider.inspect(),
          capabilities: inspectAiCapabilities(),
        };
      } catch (error) {
        return normalizeFailure(error, selectedProvider);
      }
    },
  });
}

const defaultGateway = createCarUpAiGateway();

export const generateText = (input) => defaultGateway.generateText(input);
export const generateJson = (input) => defaultGateway.generateJson(input);
export const analyzeImage = (input) => defaultGateway.analyzeImage(input);
export const classifyImage = (input) => defaultGateway.classifyImage(input);
export const extractStructuredData = (input) => defaultGateway.extractStructuredData(input);
export const inspectCarUpAiGateway = () => defaultGateway.inspect();

export { AI_GATEWAY_CAPABILITIES };
