/**
 * The strict-OCR startup check, against the provider the runtime will actually use (OC-4B).
 *
 * server.js refused to boot in OCR_MODE=strict unless GEMINI_API_KEY or GROQ_API_KEY was set — an
 * OCR-provider requirement that outlived both: OCR runs on the provider boundary (Cloudflare Qwen by
 * default; Gemini only when CARUP_OCR_PROVIDER selects it), and Groq was never an OCR provider. So a
 * strict deployment with Cloudflare configured and no Gemini/Groq key was refused, while one with a
 * stray Gemini key and no Cloudflare credentials booted into an OCR runtime that could not read a
 * document. The check now asks the canonical resolver which provider is selected, and whether THAT
 * provider is configured. It reads env-var presence only, never a value.
 */
import { resolveVisionProvider } from '../services/ai/ocrVisionProvider.js';

/** The fatal startup message for this environment, or null when the runtime may boot. */
export function strictOcrStartupError(env = process.env) {
  if (env.OCR_MODE !== 'strict') return null;
  let provider;
  try {
    provider = resolveVisionProvider(env);
  } catch (error) {
    return `FATAL: STRICT OCR MODE: ${error.message}`;
  }
  let configured = false;
  try {
    configured = provider.isConfigured() === true;
  } catch {
    configured = false;
  }
  if (configured) return null;
  return `FATAL: STRICT OCR MODE REQUIRES THE SELECTED OCR PROVIDER ("${provider.id}") TO BE CONFIGURED `
    + `(${(provider.requiredEnv || []).join(', ')})`;
}

export default { strictOcrStartupError };
