import dotenv from 'dotenv';
import { isTestFixtureAllowed } from '../../config/testFixtureGuard.js';
dotenv.config();

/**
 * The legacy Gemini client — VISION ONLY (OC-4B).
 *
 * Its TEXT path (askGemini / askGeminiWithProvenance, and the scripted `simulatedReply` behind them)
 * had no runtime caller once OC-3E-W1 moved fraud, risk and the marketplace assistant to the CarUp AI
 * gateway and OC-4B moved Communications text there too. It is RETIRED — including the canned reply
 * that once fabricated a "Low" fraud verdict and a named OCR identity. What remains serves exactly one
 * consumer: the NON-default Gemini OCR provider (ocrVisionProvider, CARUP_OCR_PROVIDER=gemini). The
 * OCR authority is Qwen on Cloudflare; this is not a general AI path, and a Gemini key becoming
 * available does not make it one.
 */
export const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

/**
 * A provider failure, typed (OC-3B; carried onto the vision path by OC-4B).
 *
 * The text path used to CATCH every failure and RETURN `JSON.stringify({ error: true, message })` — a
 * successful-looking reply that `runFraudAnalysis` read as "low fraud risk". A failure throws, and
 * every caller decides what an absent answer means on its own terms.
 */
export class AiProviderError extends Error {
  constructor(message, { code = 'AI_PROVIDER_FAILED', provider = 'gemini', model = GEMINI_VISION_MODEL, status = null, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AiProviderError';
    this.code = code;
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * The simulated vision reply exists ONLY in the test-fixture runtime (NODE_ENV=test + ALLOW_OCR_MOCK,
 * and no declared deployment — OC-3B-R).
 */
export function isGeminiTestMockAllowed(env = process.env) {
  return isTestFixtureAllowed(env);
}

/**
 * Sends the actual image bytes as inline_data parts so the model can SEE the evidence — a text prompt
 * carrying truncated base64 cannot be classified visually. `images` is an array of
 * `{ mimeType, base64 }`. Provider failures THROW a typed AiProviderError (same messages as before) so
 * the caller can distinguish "provider error" from a model verdict and fail closed on its own terms.
 */

export async function askGeminiVision(systemPrompt, textPrompt, images = [], jsonMode = false, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    if (!isGeminiTestMockAllowed()) {
      throw new AiProviderError(
        'Vision provider unavailable: Gemini API key missing and mock is only permitted under NODE_ENV=test with ALLOW_OCR_MOCK=true.',
        { code: 'AI_PROVIDER_UNCONFIGURED', retryable: false },
      );
    }
    if (jsonMode) {
      return JSON.stringify({
        success: true,
        simulated: true,
        message: 'Simulated JSON payload from CarUp AI Orchestration.'
      });
    }
    return 'This is a simulated high-fidelity response from the CarUp OS AI Orchestration engine.';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`;
  const parts = [{ text: `${systemPrompt}\n\n${textPrompt}` }];
  for (const image of images) {
    if (!image?.base64) continue;
    parts.push({ inline_data: { mime_type: image.mimeType || 'image/jpeg', data: image.base64 } });
  }

  const generationConfig = { ...(jsonMode ? { responseMimeType: 'application/json' } : {}), ...(options.generationConfig || {}) };

  // A hung provider must not hold a user's upload open indefinitely; without this a stalled
  // call ran for 105 seconds before surfacing as an unexplained "malformed response".
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 90_000;
  const abort = AbortSignal.timeout(timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        ...(Object.keys(generationConfig).length ? { generationConfig } : {})
      }),
      signal: abort,
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new AiProviderError(`Gemini vision request timed out after ${timeoutMs}ms`, { retryable: true, cause: error });
    }
    throw new AiProviderError(`Gemini vision request failed: ${error.message}`, { retryable: true, cause: error });
  }

  const data = await response.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text) return text;

  // Say WHY there is no text. "Malformed response" hid a MAX_TOKENS finish, a safety block and
  // an HTTP error behind one message, which is unusable for diagnosis and, worse, indistinguishable
  // from a genuinely unreadable document.
  const candidate = data?.candidates?.[0];
  const reason = data?.error?.status || data?.error?.message
    || data?.promptFeedback?.blockReason
    || candidate?.finishReason
    || (response.ok ? 'no text part in the response' : `HTTP ${response.status}`);
  const usage = data?.usageMetadata
    ? ` (tokens: prompt ${data.usageMetadata.promptTokenCount ?? '?'}, candidates ${data.usageMetadata.candidatesTokenCount ?? '?'}, thoughts ${data.usageMetadata.thoughtsTokenCount ?? '?'})`
    : '';

  // A quota refusal must say WHICH quota. "Rate limited" and "you have used your allowance for
  // the day" call for completely different responses, and only the provider knows which it is.
  const quota = (data?.error?.details || [])
    .flatMap((detail) => detail?.violations || [])
    .map((violation) => violation.quotaId || violation.quotaMetric)
    .filter(Boolean);
  const retryAfter = (data?.error?.details || []).find((detail) => detail?.retryDelay)?.retryDelay;
  const quotaDetail = quota.length
    ? ` [quota: ${quota.join(', ')}${retryAfter ? `; provider suggests retrying after ${retryAfter}` : ''}]`
    : '';

  throw new AiProviderError(`Gemini vision returned no text: ${reason}${quotaDetail}${usage}`, {
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
  });
}
