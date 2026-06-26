/**
 * Eligibility orchestrator — Workstreams C/D/E (insurance + finance).
 *
 * Flow: requestEligibility -> idempotency check -> evaluate trust gates -> (if allowed)
 * call the provider -> persist request + append-only decision. Webhooks update a request
 * asynchronously with signature+replay+idempotency. AI never sets a decision.
 */
import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';
import { CAPABILITIES, evaluateGates, buildSandboxEligibilityProvider } from './eligibilityContract.js';
import { verifyWebhook } from './webhookSecurity.js';

const providers = new Map(); // `${capability}` -> provider

export function initEligibility(flags = {}) {
  providers.clear();
  for (const cap of CAPABILITIES) {
    providers.set(cap, buildSandboxEligibilityProvider(cap, { isEnabled: flags[cap] }));
  }
  return [...providers.keys()];
}

export function getProvider(capability) { return providers.get(capability) || null; }

async function loadVehicle(vin) {
  const { data, error } = await supabase.from('vehicles')
    .select('vin, tenant_id, owner_id').eq('vin', vin).maybeSingle();
  if (error) throw new Error(`vehicle lookup failed: ${error.message}`);
  return data || null;
}

function validityFrom(days) {
  if (!days) return null;
  return new Date(Date.now() + days * 86400000).toISOString();
}

/**
 * Request eligibility. Idempotent on idempotency_key. Returns the persisted request row.
 * gateContext carries the trust-decision inputs (identity_status, fraud_block,
 * publication_status, dealer_suspended, source_coverage_connected, min_source_coverage,
 * consent_reference).
 */
export async function requestEligibility(capability, vin, opts = {}) {
  if (!CAPABILITIES.includes(capability)) throw new Error(`unknown capability: ${capability}`);
  const provider = getProvider(capability);
  if (!provider) throw new Error(`eligibility not initialised for ${capability}`);

  const idempotencyKey = opts.idempotencyKey || null;
  if (idempotencyKey) {
    const { data: existing } = await supabase.from('eligibility_requests')
      .select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) return existing; // idempotent: never create a duplicate
  }

  const vehicle = await loadVehicle(vin);
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  const correlationId = opts.correlationId || crypto.randomUUID();
  const gateCtx = opts.gateContext || {};
  const gate = evaluateGates(capability, { ...gateCtx, consent_reference: opts.consentReference ?? gateCtx.consent_reference });

  let mode, status, conditions = [], responseRef = null, validityUntil = null, errorCategory = null;

  if (!gate.allowed) {
    // Fail-closed / route-to-review BEFORE calling the provider.
    mode = provider.getMode();
    status = gate.route; // 'not_eligible' or 'manual_review'
    conditions = gate.reasons;
    errorCategory = gate.route === 'not_eligible' ? 'gate_failed' : null;
  } else {
    const decision = await provider.decide({ vin, capability, gateContext: gateCtx });
    mode = decision.mode;
    status = decision.status;
    conditions = decision.conditions || [];
    responseRef = decision.response_reference || null;
    validityUntil = validityFrom(decision.validity_days);
    errorCategory = decision.error_category || null;
  }

  const row = {
    capability, vin, tenant_id: vehicle.tenant_id || null,
    requested_by: opts.requestedBy || null,
    provider_id: provider.providerId,
    mode, idempotency_key: idempotencyKey, correlation_id: correlationId,
    status, conditions, validity_until: validityUntil,
    consent_reference: opts.consentReference || null,
    decision_inputs: { ...gateCtx, gate_reasons: gate.reasons, calculation_version: 'elig-1.0.0' },
    response_reference: responseRef, error_category: errorCategory,
  };
  const { data, error } = await supabase.from('eligibility_requests').insert(row).select().single();
  if (error) throw new Error(`failed to persist eligibility request: ${error.message}`);
  await appendDecision(data.id, status, conditions, responseRef, opts.requestedBy || 'system', gate.reasons.join(','));
  return data;
}

async function appendDecision(requestId, status, conditions, responseRef, actor, reason) {
  await supabase.from('eligibility_decisions').insert({
    request_id: requestId, status, conditions: conditions || [],
    response_reference: responseRef || null, actor: actor || 'system', reason: reason || null,
  });
}

export async function getRequests(capability, vin) {
  const { data, error } = await supabase.from('eligibility_requests')
    .select('*').eq('vin', vin).eq('capability', capability).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getLatestStatus(capability, vin) {
  const rows = await getRequests(capability, vin);
  return rows[0] || { capability, vin, status: 'not_requested' };
}

/**
 * Ingest a provider webhook: verify signature + replay, dedupe by idempotency key, then
 * append a decision + update the request status. Always records the webhook attempt
 * (append-only) including failed/replayed ones.
 */
export async function ingestWebhook(capability, { providerId, payloadString, signature, timestamp, idempotencyKey, body }, now = Date.now()) {
  const verdict = verifyWebhook(providerId, payloadString, signature, timestamp, now);

  // Dedup: a repeated idempotency key is recorded but not re-applied.
  let duplicate = false;
  if (idempotencyKey) {
    const { data: seen } = await supabase.from('eligibility_webhook_events')
      .select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (seen) duplicate = true;
  }

  await supabase.from('eligibility_webhook_events').insert({
    request_id: body?.request_id || null, capability, provider_id: providerId,
    event_type: body?.event_type || 'decision', signature_valid: verdict.valid,
    replay_detected: verdict.replay, idempotency_key: idempotencyKey || null, payload: body || null,
  }).select().single().then(() => {}, () => {}); // best-effort; unique-key clash => already recorded

  if (!verdict.valid) return { applied: false, reason: verdict.reason, signature_valid: false };
  if (duplicate) return { applied: false, reason: 'duplicate', signature_valid: true };
  if (!body?.request_id || !body?.status) return { applied: false, reason: 'missing_fields', signature_valid: true };

  await supabase.from('eligibility_requests')
    .update({ status: body.status, conditions: body.conditions || [], response_reference: body.response_reference || null, updated_at: new Date().toISOString() })
    .eq('id', body.request_id);
  await appendDecision(body.request_id, body.status, body.conditions || [], body.response_reference || null, `webhook:${providerId}`, 'provider_webhook');
  return { applied: true, reason: 'ok', signature_valid: true };
}

export default { initEligibility, getProvider, requestEligibility, getRequests, getLatestStatus, ingestWebhook };
