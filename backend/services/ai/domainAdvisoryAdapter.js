/**
 * Domain adapter → the canonical CarUp AI gateway (OC-3E wave 1).
 *
 *   domain service (fraud, risk, marketplace assistant)
 *     → requestAdvisoryJson (this module)
 *     → carUpAiGateway.generateJson → cloudflareGemmaProvider → cloudflareAiTransport → Workers AI
 *
 * The ONE way a domain service asks the general model for an advisory JSON answer. It returns only
 * an answer the gateway marked as executed, advisory machine output; anything else — a provider
 * failure, a timeout, malformed JSON, missing credentials, a gateway that broke its own contract —
 * is an AiAdvisoryError carrying the gateway's code, provider, model and retryability. What the
 * answer MEANS (a verdict, a risk index, listing copy) is decided by the domain service, never here,
 * and never by the model: the authority is advisory and an adapter cannot upgrade it.
 */
import { createCarUpAiGateway } from './carUpAiGateway.js';
import { CARUP_AI_MODEL, CARUP_AI_PROVIDER } from './aiRuntimeConfig.js';

export class AiAdvisoryError extends Error {
  constructor(message, {
    code = 'AI_GATEWAY_ERROR',
    provider = CARUP_AI_PROVIDER,
    model = CARUP_AI_MODEL,
    status = null,
    retryable = false,
  } = {}) {
    super(message);
    this.name = 'AiAdvisoryError';
    this.code = code;
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.retryable = retryable;
  }
}

let sharedGateway = null;
function defaultGateway() {
  // Reads process.env and resolves fetch at call time, so one instance serves every request.
  sharedGateway ||= createCarUpAiGateway();
  return sharedGateway;
}

/**
 * Ask for one advisory JSON value.
 *
 * Returns `{ value, provider, model, execution: 'provider_executed', usage }`; throws AiAdvisoryError
 * otherwise. `purpose` prefixes every failure message ("fraud analysis: …"). `deps.gateway` lets a
 * caller or a test supply a gateway; production uses the canonical one.
 */
export async function requestAdvisoryJson({ systemPrompt, userPrompt, timeoutMs, purpose = 'AI advisory' }, deps = {}) {
  const gateway = deps.gateway || defaultGateway();
  const out = await gateway.generateJson({ systemPrompt, userPrompt, timeoutMs });
  const provider = out?.provenance?.provider ?? CARUP_AI_PROVIDER;
  const model = out?.provenance?.model ?? CARUP_AI_MODEL;

  if (!out?.ok) {
    throw new AiAdvisoryError(`${purpose}: ${out?.error?.message || 'the AI gateway produced no answer'}`, {
      code: out?.error?.code || 'AI_GATEWAY_ERROR',
      provider,
      model,
      status: out?.error?.status ?? null,
      retryable: Boolean(out?.error?.retryable),
    });
  }

  // Defence in depth: only an executed, advisory machine output is an answer.
  if (out.machine_output !== true || out.authority !== 'advisory' || out.provenance?.execution !== 'provider_executed') {
    throw new AiAdvisoryError(`${purpose}: the gateway answer was not an executed advisory output`, {
      code: 'AI_GATEWAY_CONTRACT_VIOLATION', provider, model,
    });
  }

  return { value: out.value, provider, model, execution: out.provenance.execution, usage: out.usage ?? null };
}

export default { AiAdvisoryError, requestAdvisoryJson };
