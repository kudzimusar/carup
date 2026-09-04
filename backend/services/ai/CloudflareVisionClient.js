/**
 * Cloudflare Workers AI vision client.
 *
 * Sends the ACTUAL document bytes to `@cf/meta/llama-3.2-11b-vision-instruct` and asks for a
 * structured reading. Like the Gemini vision client it THROWS on provider failure, so the caller
 * can tell a provider error from a model verdict and fail closed on its own terms.
 *
 * Two contract facts were established by measuring the live API, not assumed:
 *
 *   1. The bare `prompt` form returns PROSE wrapping a fenced JSON block. Supplying `messages`
 *      (a system turn plus a user turn) instead makes Workers AI return `result.response` as a
 *      parsed JSON OBJECT. That is why this client always uses the messages form.
 *   2. `response_format` / `guided_json` are ACCEPTED by the API but do NOT constrain key names on
 *      this model — a schema asking for `colour` came back as `dominant_colour`. The schema is
 *      still sent (it is the documented contract and costs nothing), but it is NOT trusted: the
 *      authority for what a field is remains CarUp's own document schema and its normalizers,
 *      which drop anything they cannot verify. Nothing here parses prose.
 */

export const CLOUDFLARE_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const CLOUDFLARE_AI_BASE = 'https://api.cloudflare.com/client/v4/accounts';

export function isCloudflareVisionConfigured(env = process.env) {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

/**
 * `images` is an array of `{ mimeType, base64 }`; this model accepts a single image, so the first
 * is sent and any further images are reported rather than silently dropped.
 *
 * Returns `{ content, usage }` where `content` is whatever the model returned (an object when
 * Workers AI parsed it, otherwise the raw string) and `usage` is the provider's own accounting.
 */
export async function askCloudflareVision(systemPrompt, textPrompt, images = [], jsonSchema = null, options = {}) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Cloudflare Workers AI unavailable: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are both required.');
  }

  const usable = images.filter((image) => image?.base64);
  if (usable.length === 0) {
    throw new Error('Cloudflare Workers AI vision requires an image; none was supplied.');
  }
  if (usable.length > 1) {
    throw new Error(`Cloudflare Workers AI vision accepts one image per request; ${usable.length} were supplied.`);
  }

  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: textPrompt },
    ],
    image: usable[0].base64,
    max_tokens: Number(options.maxTokens) > 0 ? Number(options.maxTokens) : 2048,
    temperature: 0,
    ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: jsonSchema } } : {}),
  };

  // A hung provider must not hold a user's upload open indefinitely.
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 90_000;

  let response;
  try {
    response = await fetch(`${CLOUDFLARE_AI_BASE}/${encodeURIComponent(accountId)}/ai/run/${CLOUDFLARE_VISION_MODEL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error(`Cloudflare Workers AI request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Cloudflare Workers AI request failed: ${error.message}`);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    // Say WHY. Cloudflare returns a structured error list; a bare status hides an expired token,
    // a missing Workers AI permission and a rate limit behind one indistinguishable message.
    const errors = Array.isArray(payload?.errors) && payload.errors.length
      ? payload.errors.map((e) => `${e.code}: ${e.message}`).join('; ')
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare Workers AI refused the request — ${errors}`);
  }

  const content = payload?.result?.response;
  if (content === undefined || content === null || content === '') {
    throw new Error('Cloudflare Workers AI returned no response content');
  }

  const usage = payload?.result?.usage ?? null;
  return {
    content,
    usage: usage
      ? {
        neurons: usage.neurons ?? null,
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
      }
      : null,
  };
}
