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
// Outcomes that count as an infrastructure failure for the circuit breaker. Valid provider
// answers (mismatch / no_record / high_risk) mean the provider is HEALTHY and never trip it.
const FAILURE_OUTCOMES = new Set(['timeout', 'rate_limited', 'error', 'unavailable']);
// error_category values marking a row as a GATE BLOCK (kill switch / non-callable mode /
// capability flag / not-registered) rather than a genuine provider invocation — excluded from
// the breaker window so a kill-switch period never latches the circuit.
const GATING_CATEGORIES = new Set(['kill_switch', 'not_registered', 'capability_disabled']);
const isGatingRow = (r) =>
  GATING_CATEGORIES.has(r.error_category) ||
  (typeof r.error_category === 'string' && r.error_category.startsWith('mode_'));
const CIRCUIT_WINDOW = 5;          // look at the last N genuine invocations
const CIRCUIT_TRIP = 4;            // this many failures in the window opens the circuit
const CIRCUIT_COOLDOWN = 3;        // consecutive sheds allowed before a half-open probe
const CIRCUIT_LOOKBACK = 40;       // rows to scan (must comfortably contain CIRCUIT_WINDOW invocations)

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
  const base = {
    provider_id: provider.id, capability_type: provider.capability_type,
    correlation_id: correlationId, vin: req.vin || null, request_ref: req.reference || null,
    mode: provider.activation_mode, outcome, attempt, latency_ms, error_category,
    tenant_id: provider.tenant_id || null,
  };
  try {
    const { error } = await supabase.from('provider_request_attempts').insert({ ...base, idempotency_key: idempotencyKey || null });
    if (error && idempotencyKey) {
      // The (provider_id, idempotency_key) slot is already claimed by a concurrent duplicate.
      // Still audit THIS invocation — just without owning the key — so the ledger stays complete.
      await supabase.from('provider_request_attempts').insert({ ...base, idempotency_key: null });
    }
  } catch { /* never block the request path on an audit-write failure */ }
}

/**
 * Circuit-breaker state with half-open recovery. The window is the most recent genuine
 * INVOCATIONS (shed `circuit_open` rows and gate-block rows excluded). If >= CIRCUIT_TRIP of the
 * last CIRCUIT_WINDOW invocations failed, the circuit is open — but after CIRCUIT_COOLDOWN
 * consecutive sheds a single probe is allowed through (half-open) so a recovered provider can
 * re-close it. Excluding the shed rows is what prevents the breaker from latching open forever.
 */
async function circuitState(providerId) {
  const { data } = await supabase.from('provider_request_attempts')
    .select('outcome, error_category').eq('provider_id', providerId)
    .order('created_at', { ascending: false }).limit(CIRCUIT_LOOKBACK);
  const rows = data || [];
  // consecutive sheds since the most recent genuine invocation (drives half-open probing)
  let shedsSinceInvocation = 0;
  for (const r of rows) { if (r.outcome === 'circuit_open') shedsSinceInvocation++; else break; }
  const invocations = rows.filter(r => r.outcome !== 'circuit_open' && !isGatingRow(r)).slice(0, CIRCUIT_WINDOW);
  if (invocations.length < CIRCUIT_TRIP) return { open: false };
  const fails = invocations.filter(r => FAILURE_OUTCOMES.has(r.outcome)).length;
  if (fails < CIRCUIT_TRIP) return { open: false };
  // would be open; allow a half-open probe after the cooldown so recovery is possible
  if (shedsSinceInvocation >= CIRCUIT_COOLDOWN) return { open: false, halfOpen: true };
  return { open: true };
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

  // 0. Idempotency: a repeated key for THE SAME PROVIDER returns the recorded outcome (no
  //    re-execution). Scoped by provider_id so a client may reuse one key across providers.
  if (idempotencyKey) {
    const { data: prior } = await supabase.from('provider_request_attempts')
      .select('outcome, mode').eq('provider_id', provider.id).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (prior) return { ok: prior.outcome === 'ok', outcome: prior.outcome, mode: prior.mode, deduped: true, correlation_id: correlationId, attempts: 0 };
  }

  // 1. Fail-closed gating: kill switch + callable mode. Gate blocks do NOT consume the
  //    idempotency key (so a retry after re-enable can still execute) and are excluded from the
  //    circuit-breaker window.
  const gate = isCallable(provider);
  if (!gate.callable) {
    await recordAttempt(provider, req, 'unavailable', { correlationId, error_category: gate.reason });
    return { ok: false, outcome: 'unavailable', mode: provider.activation_mode, blocked_reason: gate.reason, correlation_id: correlationId, attempts: 0 };
  }
  // 2. Global capability flag (production defaults fail-closed).
  const flag = CAPABILITY_FLAG[provider.capability_type];
  if (flag && !isCapabilityEnabled(flag)) {
    await recordAttempt(provider, req, 'unavailable', { correlationId, error_category: 'capability_disabled' });
    return { ok: false, outcome: 'unavailable', mode: provider.activation_mode, blocked_reason: 'capability_disabled', correlation_id: correlationId, attempts: 0 };
  }
  // 3. Circuit breaker (half-open recovery; a shed never claims the idempotency key).
  const circuit = await circuitState(provider.id);
  if (circuit.open) {
    await recordAttempt(provider, req, 'circuit_open', { correlationId, error_category: 'circuit_open' });
    return { ok: false, outcome: 'circuit_open', mode: provider.activation_mode, blocked_reason: 'circuit_open', correlation_id: correlationId, attempts: 0 };
  }

  // 4. Execute with retries on transient outcomes. The idempotency key is claimed only on the
  //    TERMINAL attempt, so a replay returns the request's FINAL outcome (not a mid-retry timeout).
  let attempt = 0, result = null;
  while (attempt < maxRetries + 1) {
    attempt++;
    const started = Date.now();
    result = await invoke(provider, { ...req, correlationId });
    const latency = Date.now() - started;
    const outcome = result.outcome || 'error';
    const terminal = !TRANSIENT.has(outcome) || attempt === maxRetries + 1;
    await recordAttempt(provider, req, outcome, { attempt, latency_ms: latency, error_category: result.error_category || null, correlationId, idempotencyKey: terminal ? idempotencyKey : null });
    if (!TRANSIENT.has(outcome)) {
      return { ok: outcome === 'ok', outcome, mode: provider.activation_mode, scenario: result.scenario, data: result.data ?? null, confidence: result.confidence ?? null, attempts: attempt, correlation_id: correlationId };
    }
    // transient -> backoff (bounded) and retry
    if (attempt <= maxRetries) await new Promise(r => setTimeout(r, Math.min(50 * 2 ** (attempt - 1), 400)));
  }
  // 5. Dead-letter after exhausting retries. The terminal transient attempt already carries the
  //    idempotency key (a replay returns that failure); this row is audit-only.
  await recordAttempt(provider, req, 'error', { attempt: attempt + 1, error_category: 'dead_letter', correlationId });
  return { ok: false, outcome: result?.outcome || 'error', mode: provider.activation_mode, dead_letter: true, attempts: attempt, correlation_id: correlationId };
}

export default { executeProviderRequest };
