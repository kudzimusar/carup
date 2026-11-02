/**
 * The canonical CarUp AI gateway — general inference, advisory only.
 *
 * Converged from PR #217 (AI-01-B, head 6c8ff6f7) by OC-3C:
 *
 *   domain adapter → carUpAiGateway → cloudflareGemmaProvider (policy) → cloudflareAiTransport → Workers AI
 *
 * Every result is MACHINE OUTPUT with ADVISORY authority, and says so on its face:
 *   { ok, value?, error?, machine_output, authority: 'advisory', provenance: { provider, model, execution }, usage? }
 * `execution` is 'provider_executed' only when the provider answered and its answer passed the
 * operation's contract; any failure is `ok: false` with `execution: 'failed'` and no value. The
 * gateway never throws, never retries, never falls back to another model or vendor, and exposes
 * inference operations only — no domain decision. Domain authorities decide what an answer means.
 *
 * Not the OCR path: certified OCR keeps its own policy (ocrVisionProvider.js) on the same transport.
 */
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

/** The authority every gateway answer carries. A domain adapter may never upgrade it. */
export const AI_GATEWAY_AUTHORITY = 'advisory';

function provenanceFrom(provider, result = null, execution = 'provider_executed') {
  const base = result?.provenance || {
    provider: provider?.id || CARUP_AI_PROVIDER,
    model: provider?.model || CARUP_AI_MODEL,
  };
  return { provider: base.provider, model: base.model, execution };
}

function normalizeFailure(error, provider) {
  return {
    ok: false,
    machine_output: false,
    authority: AI_GATEWAY_AUTHORITY,
    error: {
      code: error?.code || 'AI_GATEWAY_ERROR',
      message: error?.message || 'CarUp AI gateway request failed.',
      retryable: Boolean(error?.retryable),
      status: error?.status ?? null,
    },
    provenance: provenanceFrom(provider, null, 'failed'),
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
  fetchImpl = null,
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
        machine_output: true,
        authority: AI_GATEWAY_AUTHORITY,
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
          authority: AI_GATEWAY_AUTHORITY,
          runtime: selectedProvider.inspect(),
          capabilities: inspectAiCapabilities(),
        };
      } catch (error) {
        return normalizeFailure(error, selectedProvider);
      }
    },
  });
}

// The default gateway reads process.env and resolves fetch at CALL time (the transport does), so
// configuration changes and test doubles are honoured without re-importing this module.
const defaultGateway = createCarUpAiGateway();

export const generateText = (input) => defaultGateway.generateText(input);
export const generateJson = (input) => defaultGateway.generateJson(input);
export const analyzeImage = (input) => defaultGateway.analyzeImage(input);
export const classifyImage = (input) => defaultGateway.classifyImage(input);
export const extractStructuredData = (input) => defaultGateway.extractStructuredData(input);
export const inspectCarUpAiGateway = () => defaultGateway.inspect();

export { AI_GATEWAY_CAPABILITIES };
