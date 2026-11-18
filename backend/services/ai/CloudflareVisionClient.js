/**
 * Cloudflare Workers AI vision client.
 *
 * Sends the ACTUAL document bytes to the selected Workers AI vision model and asks for a
 * structured reading. Like the Gemini vision client it THROWS on provider failure, so the caller
 * can tell a provider error from a model verdict and fail closed on its own terms.
 *
 * WORKERS AI MODELS DO NOT SHARE ONE CONTRACT. Every fact below was established by probing the
 * live API, not by assuming Llama's shape generalises:
 *
 *   - `@cf/meta/llama-3.2-11b-vision-instruct` takes the image as a TOP-LEVEL `image` base64
 *     field and answers at `result.response`.
 *   - `@cf/qwen/qwen3.8-27b` and `@cf/google/gemma-4-26b-a4b-it` are OpenAI-shaped: the image is
 *     an `image_url` content part INSIDE the user message, and the answer is at
 *     `result.choices[0].message.content`.
 *
 * That difference is not cosmetic. Sending Qwen the top-level `image` field returns HTTP 200 with
 * the image SILENTLY IGNORED — measured: prompt_tokens was identical to a request with no image
 * at all (106 vs 106), while the content-part form raised it to 172 and the model then described
 * the picture correctly. A naive port would have produced an "extraction" that never saw the
 * document, which is exactly the text-only failure this lane exists to eliminate. TRANSPORTS
 * therefore binds each model to the form proven to deliver its pixels.
 */

export const CLOUDFLARE_VISION_MODEL = '@cf/qwen/qwen3.8-27b';
const CLOUDFLARE_AI_BASE = 'https://api.cloudflare.com/client/v4/accounts';

/**
 * How each model actually accepts an image and returns an answer.
 *   inlineImage — image as a top-level base64 `image` field, answer at result.response
 *   contentPart — image as an `image_url` data URI inside the user message (OpenAI shape),
 *                 answer at result.choices[0].message.content
 */
/**
 * `sendResponseFormat` is FALSE for the OpenAI-shaped vision models, and that is a measurement,
 * not a preference. Holding the image and prompt constant and varying only the schema:
 *
 *   @cf/google/gemma-4-26b-a4b-it   with response_format -> 5/8 fields, and it declared
 *                                   date_of_birth, country and date_of_issue "unreadable"
 *                                   without response_format -> 8/8, every value correct
 *   @cf/qwen/qwen3.8-27b            with response_format -> 4/8    without -> 8/8
 *
 * Sending the schema SUPPRESSED fields both models can plainly read — the values are printed in
 * 25px bold. Cloudflare's own JSON Mode page agrees it is best-effort, and its supported-model
 * list names neither of these. Structure is therefore obtained the way that measurably works: an
 * absolute output-format instruction in the prompt, plus fail-closed JSON-object recovery in
 * DocumentIntelligenceService. CarUp's document schema remains the authority for what a field is.
 */
export const TRANSPORTS = {
  '@cf/qwen/qwen3.8-27b': { form: 'contentPart', maxTokens: 2048, sendResponseFormat: false },
  '@cf/google/gemma-4-26b-a4b-it': { form: 'contentPart', maxTokens: 4096, sendResponseFormat: false },
  '@cf/meta/llama-3.2-11b-vision-instruct': { form: 'inlineImage', maxTokens: 2048, sendResponseFormat: true },
};

export function transportFor(model) {
  const transport = TRANSPORTS[model];
  if (!transport) {
    // Fail closed. Guessing a transport is how an image gets silently dropped.
    throw new Error(`No verified Workers AI transport for "${model}". Probe the model's image and response shape before enabling it.`);
  }
  return transport;
}

export function isCloudflareVisionConfigured(env = process.env) {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

/** Builds the request body for a model using the transport proven to deliver its pixels. */
export function buildCloudflareRequestBody({ model, systemPrompt, textPrompt, image, jsonSchema, maxTokens }) {
  const transport = transportFor(model);
  const tokens = Number(maxTokens) > 0 ? Number(maxTokens) : transport.maxTokens;
  const base = {
    max_tokens: tokens,
    temperature: 0,
    ...(jsonSchema && transport.sendResponseFormat
      ? { response_format: { type: 'json_schema', json_schema: jsonSchema } }
      : {}),
  };

  if (transport.form === 'inlineImage') {
    return {
      ...base,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: textPrompt }],
      image: image.base64,
    };
  }

  return {
    ...base,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          { type: 'image_url', image_url: { url: `data:${image.mimeType || 'image/png'};base64,${image.base64}` } },
        ],
      },
    ],
  };
}

/** Reads the answer out of whichever envelope this model uses, without guessing. */
export function readCloudflareContent(model, result) {
  const transport = transportFor(model);
  if (transport.form === 'inlineImage') return result?.response;
  const choice = result?.choices?.[0];
  return choice?.message?.content ?? choice?.text;
}

/**
 * `images` is an array of `{ mimeType, base64 }`; these models accept a single image, so a second
 * is refused rather than silently dropped.
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

  const model = options.model || CLOUDFLARE_VISION_MODEL;
  const usable = images.filter((image) => image?.base64);
  if (usable.length === 0) {
    throw new Error('Cloudflare Workers AI vision requires an image; none was supplied.');
  }
  if (usable.length > 1) {
    throw new Error(`Cloudflare Workers AI vision accepts one image per request; ${usable.length} were supplied.`);
  }

  const body = buildCloudflareRequestBody({
    model, systemPrompt, textPrompt, image: usable[0], jsonSchema, maxTokens: options.maxTokens,
  });

  // A hung provider must not hold a user's upload open indefinitely.
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 90_000;

  let response;
  try {
    response = await fetch(`${CLOUDFLARE_AI_BASE}/${encodeURIComponent(accountId)}/ai/run/${model}`, {
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

  const content = readCloudflareContent(model, payload?.result);
  const finishReason = payload?.result?.choices?.[0]?.finish_reason;
  if (content === undefined || content === null || content === '') {
    // An empty answer with finish_reason "length" means the budget ran out before the model
    // emitted anything, which is a request-sizing fault and must not read as an unreadable document.
    const because = finishReason === 'length'
      ? ' (output budget exhausted before any content was produced — raise max_tokens for this model)'
      : finishReason ? ` (finish_reason: ${finishReason})` : '';
    throw new Error(`Cloudflare Workers AI returned no response content${because}`);
  }

  const usage = payload?.result?.usage ?? null;
  return {
    content,
    // `finishReason` and `transportForm` are EXECUTION EVIDENCE, not telemetry. The accuracy gate
    // uses them to tell a normal model completion apart from a truncation, a refusal or a request
    // whose image may never have been delivered. Absent means "the provider stated none".
    usage: {
      neurons: usage?.neurons ?? null,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      finishReason: finishReason ?? null,
      transportForm: transportFor(model).form,
      imageBytesSent: usable[0].base64.length,
    },
  };
}
