/**
 * Provider execution framework — Full Activation.
 *
 * The single path every provider call goes through, regardless of capability. Enforces:
 *   - fail-closed gating (kill switch + callable mode + global capability flag);
 *   - idempotency (a repeated idempotency_key returns the recorded prior outcome);
 *   - retries with backoff on transient outcomes (timeout / rate_limit);
 *   - a simple circuit breaker per provider (recent consecutive failures open it);
 *   - a dead-letter record after exhausting retries;
 *   - append-only attempt logging with correlation ids;
 *   - honest mode propagation (a simulated result is never labelled live).
 *
 * The actual provider call is injected (`invoke`) so this is fully unit-testable and works
 * for simulator, partner-file, manual and (future) live transports without change.
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { isCallable } from './providerRegistry.js';
import { simulateProvider } from './simulators.js';
import { isCapabilityEnabled } from '../featureFlags/capabilityFlags.js';

const TRANSIENT = new Set(['timeout', 'rate_limited']);
const CIRCUIT_WINDOW = 5;          // look at the last N attempts
const CIRCUIT_TRIP = 4;            // this many failures in the window opens the circuit

const CAPABILITY_FLAG = {
  government_source: 'source_verification', // reuses the source flag family
  insurance: 'insurance_eligibility',
  finance: 'finance_eligibility',
  escrow: 'escrow',
};

/** Default invoker: the deterministic simulator (used for sandbox/pilot). */
function defaultInvoke(provider, req) {
  return simulateProvider(provider.capability_type, { ...req, mode: provider.activation_mode });
}

async function recordAttempt(provider, req, outcome, { attempt = 1, latency_ms = null, error_category = null, correlationId, idempotencyKey }) {
  try {
    await supabase.from('provider_request_attempts').insert({
      provider_id: provider.id, capability_type: provider.capability_type,
      correlation_id: correlationId, idempotency_key: idempotencyKey || null,
      vin: req.vin || null, request_ref: req.reference || null, mode: provider.activation_mode,
      outcome, attempt, latency_ms, error_category, tenant_id: provider.tenant_id || null,
    });
  } catch { /* unique idempotency clash -> already recorded; never block the request path */ }
}

async function circuitOpen(providerId) {
  const { data } = await supabase.from('provider_request_attempts')
    .select('outcome').eq('provider_id', providerId).order('created_at', { ascending: false }).limit(CIRCUIT_WINDOW);
  const rows = data || [];
  if (rows.length < CIRCUIT_TRIP) return false;
  const fails = rows.filter(r => ['timeout', 'rate_limited', 'unavailable', 'error', 'circuit_open'].includes(r.outcome)).length;
  return fails >= CIRCUIT_TRIP;
}

/**
 * Execute a governed provider request. Returns:
 *   { ok, outcome, mode, scenario?, data?, attempts, correlation_id, deduped?, blocked_reason? }
 */
export async function executeProviderRequest(provider, req = {}, opts = {}) {
  const correlationId = opts.correlationId || crypto.randomUUID();
  const idempotencyKey = opts.idempotencyKey || null;
  const invoke = opts.invoke || defaultInvoke;
  const maxRetries = opts.maxRetries ?? 2;

  // 0. Idempotency: a repeated key returns the recorded outcome (no re-execution).
  if (idempotencyKey) {
    const { data: prior } = await supabase.from('provider_request_attempts')
      .select('outcome, mode').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (prior) return { ok: prior.outcome === 'ok', outcome: prior.outcome, mode: prior.mode, deduped: true, correlation_id: correlationId, attempts: 0 };
  }

  // 1. Fail-closed gating: kill switch + callable mode.
  const gate = isCallable(provider);
  if (!gate.callable) {
    await recordAttempt(provider, req, 'unavailable', { correlationId, idempotencyKey, error_category: gate.reason });
    return { ok: false, outcome: 'unavailable', mode: provider.activation_mode, blocked_reason: gate.reason, correlation_id: correlationId, attempts: 0 };
  }
  // 2. Global capability flag (production defaults fail-closed).
  const flag = CAPABILITY_FLAG[provider.capability_type];
  if (flag && !isCapabilityEnabled(flag)) {
    await recordAttempt(provider, req, 'unavailable', { correlationId, idempotencyKey, error_category: 'capability_disabled' });
    return { ok: false, outcome: 'unavailable', mode: provider.activation_mode, blocked_reason: 'capability_disabled', correlation_id: correlationId, attempts: 0 };
  }
  // 3. Circuit breaker.
  if (await circuitOpen(provider.id)) {
    await recordAttempt(provider, req, 'circuit_open', { correlationId, idempotencyKey, error_category: 'circuit_open' });
    return { ok: false, outcome: 'circuit_open', mode: provider.activation_mode, blocked_reason: 'circuit_open', correlation_id: correlationId, attempts: 0 };
  }

  // 4. Execute with retries on transient outcomes.
  let attempt = 0, result = null;
  while (attempt < maxRetries + 1) {
    attempt++;
    const started = Date.now();
    result = await invoke(provider, { ...req, correlationId });
    const latency = Date.now() - started;
    const outcome = result.outcome || 'error';
    await recordAttempt(provider, req, outcome, { attempt, latency_ms: latency, error_category: result.error_category || null, correlationId, idempotencyKey: attempt === 1 ? idempotencyKey : null });
    if (!TRANSIENT.has(outcome)) {
      return { ok: outcome === 'ok', outcome, mode: provider.activation_mode, scenario: result.scenario, data: result.data ?? null, confidence: result.confidence ?? null, attempts: attempt, correlation_id: correlationId };
    }
    // transient -> backoff (bounded) and retry
    if (attempt <= maxRetries) await new Promise(r => setTimeout(r, Math.min(50 * 2 ** (attempt - 1), 400)));
  }
  // 5. Dead-letter after exhausting retries.
  await recordAttempt(provider, req, 'error', { attempt: attempt + 1, error_category: 'dead_letter', correlationId });
  return { ok: false, outcome: result?.outcome || 'error', mode: provider.activation_mode, dead_letter: true, attempts: attempt, correlation_id: correlationId };
}

export default { executeProviderRequest };
