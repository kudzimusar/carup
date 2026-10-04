import dotenv from 'dotenv';
import { isTestFixtureAllowed } from '../../config/testFixtureGuard.js';
dotenv.config();

/**
 * Text model used by `askGemini`. The SAME constant builds the request URL and labels the result, so
 * a provenance label cannot drift from the model that was actually asked (OC-3B: callers logged
 * 'gemini-pro' / 'gemini-pro-v1' for gemini-2.5-flash calls).
 */
export const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';

/**
 * A provider failure, typed (OC-3B).
 *
 * `askGemini` used to CATCH every HTTP, transport and parse failure and RETURN
 * `JSON.stringify({ error: true, message })` — a successful-looking reply. `runFraudAnalysis` parsed
 * that envelope as a model verdict, found no `riskRating`, defaulted to 'Low', persisted it and
 * answered 200: a provider outage became "low fraud risk". A failure now throws, and every caller
 * must decide what an absent answer means on its own terms.
 */
export class AiProviderError extends Error {
  constructor(message, { code = 'AI_PROVIDER_FAILED', provider = 'gemini', model = GEMINI_TEXT_MODEL, status = null, retryable = false, cause } = {}) {
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
 * The scripted test reply exists ONLY in the test-fixture runtime (NODE_ENV=test + ALLOW_OCR_MOCK, and
 * no declared deployment — OC-3B-R): its canned "Low" fraud verdict must never answer a real caller.
 */
export function isGeminiTestMockAllowed(env = process.env) {
  return isTestFixtureAllowed(env);
}

/** Provenance of the scripted test reply: never a real provider or model name. */
export const GEMINI_TEST_MOCK = Object.freeze({ provider: 'simulated', model: 'gemini-test-mock', execution: 'simulated' });

function simulatedReply(userPrompt, jsonMode) {
  if (jsonMode) {
    const lowerPrompt = userPrompt.toLowerCase();

    if (lowerPrompt.includes('zimra') || lowerPrompt.includes('logbook') || lowerPrompt.includes('ocr')) {
      return JSON.stringify({
        simulated: true,
        confidenceScore: 0.94,
        vin: 'VIN74329849204928',
        owner: 'Tendai Moyo',
        engineNumber: '1GD-FTV-892301',
        make: 'Toyota',
        model: 'Hilux',
        year: 2021,
        importSource: 'South Africa',
        dutyPaid: true
      });
    }

    if (lowerPrompt.includes('fraud') || lowerPrompt.includes('listing') || lowerPrompt.includes('title')) {
      return JSON.stringify({
        simulated: true,
        isFraudulent: false,
        riskRating: 'Low',
        reasons: ['VIN exists in national ledger', 'Price is within market standard values', 'Owner verified through OTP'],
        confidence: 0.98
      });
    }

    if (lowerPrompt.includes('risk') || lowerPrompt.includes('insurance') || lowerPrompt.includes('mileage')) {
      return JSON.stringify({
        simulated: true,
        riskScore: 24.5,
        factors: [
          { name: 'Odometer integrity verified', impact: 'Positive' },
          { name: 'Service consistency maintained', impact: 'Positive' },
          { name: 'Import ZIMRA duty cleared', impact: 'Positive' }
        ]
      });
    }

    // Fallback valid JSON if no matching keyword
    return JSON.stringify({
      success: true,
      simulated: true,
      message: "Simulated JSON payload from CarUp AI Orchestration."
    });
  }

  return "This is a simulated response from the CarUp test harness (no AI provider was called).";
}

/**
 * askGemini with its provenance: `{ text, provider, model, execution }`.
 * `execution` is 'provider_executed' when Gemini answered and 'simulated' for the test mock, so a
 * caller can refuse to treat a simulation as a verdict.
 */
export async function askGeminiWithProvenance(systemPrompt, userPrompt, jsonMode = false, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // SECURITY (P0): mock provider responses must NEVER run in a real runtime.
    // Seeded/simulated payloads previously leaked into live identity
    // verification. Mock is permitted ONLY under NODE_ENV=test with an explicit
    // flag; otherwise fail closed so the caller records an honest failure.
    if (!isGeminiTestMockAllowed()) {
      throw new AiProviderError(
        'OCR provider unavailable: Gemini API key missing and mock OCR is only permitted under NODE_ENV=test with ALLOW_OCR_MOCK=true.',
        { code: 'AI_PROVIDER_UNCONFIGURED', retryable: false },
      );
    }
    return { text: simulatedReply(userPrompt, jsonMode), ...GEMINI_TEST_MOCK };
  }

  const model = GEMINI_TEXT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30_000;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
        ],
        generationConfig: jsonMode ? { responseMimeType: 'application/json' } : undefined
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new AiProviderError(
      timedOut ? `Gemini request timed out after ${timeoutMs}ms` : `Gemini request failed: ${error?.message || 'transport error'}`,
      { code: 'AI_PROVIDER_FAILED', model, status: null, retryable: true, cause: error },
    );
  }

  const retryable = response.status === 429 || response.status >= 500;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AiProviderError(
      `Gemini returned HTTP ${response.status}${data?.error?.status ? ` (${data.error.status})` : ''}`,
      { code: 'AI_PROVIDER_FAILED', model, status: response.status, retryable },
    );
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text) {
    const reason = data ? (data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'no text part in the response') : 'unparseable response body';
    throw new AiProviderError(`Gemini returned no text: ${reason}`, { code: 'AI_PROVIDER_FAILED', model, status: response.status, retryable: false });
  }
  return { text, provider: 'gemini', model, execution: 'provider_executed' };
}

/** Text-only Gemini call. Returns the reply text; THROWS AiProviderError on any provider failure. */
export async function askGemini(systemPrompt, userPrompt, jsonMode = false, options = {}) {
  return (await askGeminiWithProvenance(systemPrompt, userPrompt, jsonMode, options)).text;
}

/**
 * Vision variant of askGemini: sends the actual image bytes as inline_data
 * parts so the model can SEE the evidence — a text prompt carrying truncated
 * base64 cannot be classified visually. `images` is an array of
 * `{ mimeType, base64 }`. Unlike askGemini, provider failures THROW so the
 * caller can distinguish "provider error" from a model verdict and fail
 * closed on its own terms.
 *
 * The mock gate matches askGemini exactly (NODE_ENV=test + ALLOW_OCR_MOCK)
 * and returns the same generic simulated payload, so test-mode behaviour of
 * callers is identical to the text path.
 */
export const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

export async function askGeminiVision(systemPrompt, textPrompt, images = [], jsonMode = false, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    if (!isGeminiTestMockAllowed()) {
      throw new Error('Vision provider unavailable: Gemini API key missing and mock is only permitted under NODE_ENV=test with ALLOW_OCR_MOCK=true.');
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
      throw new Error(`Gemini vision request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Gemini vision request failed: ${error.message}`);
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

  throw new Error(`Gemini vision returned no text: ${reason}${quotaDetail}${usage}`);
}
