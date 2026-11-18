// Cloudflare transport selected from ce780bd283e981bac5556abbdcdce669df94ea2f.
// Identity OCR has no automatic fallback, no client-selected model and is OFF by default.
import { askCloudflareVision, CLOUDFLARE_VISION_MODEL, isCloudflareVisionConfigured, TRANSPORTS } from './CloudflareVisionClient.js';

export function configuredIdentityVisionProvider(env = process.env) {
  if (env.CARUP_IDENTITY_OCR_ENABLED !== 'true') return null;
  if (env.CARUP_OCR_PROVIDER !== 'cloudflare' || !isCloudflareVisionConfigured(env)) return null;
  const model = String(env.CARUP_OCR_MODEL || CLOUDFLARE_VISION_MODEL).trim();
  if (model === '@cf/meta/llama-3.2-11b-vision-instruct' || !TRANSPORTS[model]) return null;
  return { id: 'cloudflare', model, extract: args => askCloudflareVision(args.systemPrompt, args.textPrompt, args.images, args.jsonSchema, { model, timeoutMs: 90000 }) };
}
