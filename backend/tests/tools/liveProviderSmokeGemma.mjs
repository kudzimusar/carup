/**
 * OC-5R-PROV-01 D2 — the Gemma leg of the live-provider smoke: ONE fixed advisory completion through
 * CarUp's own general AI gateway (domainAdvisoryAdapter -> carUpAiGateway -> cloudflareGemmaProvider),
 * so the evidence is about this lineage's client, not a hand-rolled request. The prompt carries no
 * customer data and the answer decides nothing: gateway answers are `advisory` by construction.
 */
import { requestAdvisoryJson, inspectAdvisoryRuntime } from '../../services/ai/domainAdvisoryAdapter.js';
import { STATUS } from './liveProviderSmoke.mjs';

export async function gemmaGatewaySmoke(_env, deps = {}) {
  const runtime = inspectAdvisoryRuntime(deps);
  const started = Date.now();
  const out = await requestAdvisoryJson({
    systemPrompt: 'You output only a raw JSON object and nothing else.',
    userPrompt: 'Reply with exactly {"ok":true}.',
    timeoutMs: 20000,
    purpose: 'OC-5R live provider smoke',
  }, deps);
  const latency_ms = Date.now() - started;
  const ok = out?.value?.ok === true;
  return {
    status: ok ? STATUS.SUCCEEDED : STATUS.FAILED,
    provider: { name: 'Cloudflare Workers AI', model: out.model },
    request_class: 'one advisory JSON completion through CarUp\'s general AI gateway (requestAdvisoryJson) with a fixed instruction and no customer data',
    execution_evidence: {
      latency_ms,
      gateway_provider: out.provider,
      execution: out.execution,
      usage: out.usage ?? null,
      runtime: { authority: runtime?.authority ?? null, provider: runtime?.runtime?.provider ?? null, model: runtime?.runtime?.model ?? null, configured: runtime?.runtime?.configured ?? null },
    },
    result: ok ? `provider executed; answer {"ok":true} parsed as advisory JSON (model ${out.model})` : `provider answered but not with the fixed {"ok":true} (model ${out.model})`,
    not_claimed: 'any domain advisory quality (buyer assistant, listing draft, fraud scan); any governed decision; deployed wiring',
  };
}
