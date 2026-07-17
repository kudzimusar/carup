/**
 * Licensed-Insurer provider workflow — Vehicle Trust OS Full Activation (canonical doc §84–99).
 *
 * Extends the shared eligibility framework (backend/services/eligibility/*) for the licensed
 * INSURER capability and executes every provider call through the shared provider platform
 * (backend/services/providerPlatform/*). Nothing here re-implements gates, HMAC verification,
 * or the execution/retry/idempotency machinery — it REUSES them:
 *
 *   - Trust gates            → eligibility/eligibilityContract.evaluateGates('insurance', ctx)
 *   - Provider execution     → providerPlatform/providerFramework.executeProviderRequest
 *   - Deterministic sandbox  → providerPlatform/simulators.simulateProvider('insurance', …)
 *   - Signed/replay webhooks  → eligibility/webhookSecurity.{sign,verifyWebhook}
 *
 * Safety invariants:
 *   1. Fail-closed: an insurer that is not registered, not active, kill-switched, or in a
 *      non-callable mode never gets called — the request routes to 'unavailable'/'manual_review'.
 *   2. Consent is mandatory: no insurer request proceeds without a valid, unrevoked consent
 *      whose scope covers the insurer's min_data_projection.
 *   3. Honesty: an outcome is stamped with the provider's activation mode; a sandbox result is
 *      NEVER surfaced as live. An 'eligible' outcome is NEVER recorded without a confirmed
 *      provider_reference (else it degrades to 'manual_review').
 *   4. Privacy: only the minimum PUBLIC vehicle-fact projection is sent to the provider; the
 *      public status projection strips all gate context, raw provider payloads and any
 *      underwriting/applicant data.
 *   5. Append-only: every outcome is a new insurance_provider_decisions row; the eligibility
 *      request is updated with the latest status.
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { evaluateGates } from '../eligibility/eligibilityContract.js';
import { sign, verifyWebhook } from '../eligibility/webhookSecurity.js';
import { executeProviderRequest } from '../providerPlatform/providerFramework.js';

// The insurer webhook shares the insurance-capability HMAC identity (INSURANCE_WEBHOOK_SECRET).
// verifyWebhook() fail-closes when that secret is absent in production (returns unknown_provider).
export const INSURER_WEBHOOK_PROVIDER = 'insurance_sandbox';

// Insurer outcome ledger vocabulary (mirrors the insurance_provider_decisions.outcome CHECK).
export const INSURER_OUTCOMES = ['eligible', 'conditional', 'manual_review', 'declined', 'unavailable', 'expired', 'failed'];

// Insurer outcome -> shared eligibility request status.
export const OUTCOME_TO_STATUS = {
  eligible: 'eligible',
  conditional: 'conditionally_eligible',
  manual_review: 'manual_review',
  declined: 'not_eligible',
  unavailable: 'unavailable',
  failed: 'failed',
  expired: 'expired',
};

// Provider-platform activation mode -> honesty-labelled eligibility mode (CHECK on eligibility_requests.mode).
function eligibilityModeFor(activationMode) {
  switch (activationMode) {
    case 'live':
    case 'pilot_live': return 'live';
    case 'partner_file': return 'partner_file';
    case 'manual': return 'manual_review';
    case 'sandbox': return 'sandbox';
    default: return 'unavailable';
  }
}

function validityFrom(days) {
  return days ? new Date(Date.now() + days * 86400000).toISOString() : null;
}

// ── onboarding / control-plane ────────────────────────────────────────────────

/**
 * Register or update a licensed insurer profile against an already-registered provider_registry
 * row (capability_type='insurance'). Idempotent on provider_id. Fail-closed: active defaults false.
 * Never stores a secret — credential_ref is a reference only.
 */
export async function registerInsurerProfile(input, actor = {}) {
  if (!input.provider_id) throw new Error('provider_id required');
  if (!input.legal_name) throw new Error('legal_name required');
  const { data: provider } = await supabase.from('provider_registry').select('*').eq('id', input.provider_id).maybeSingle();
  if (!provider) throw new Error('provider not registered');
  if (provider.capability_type !== 'insurance') throw new Error('provider capability_type must be insurance');
  if (input.credential_ref && /(sbp_|eyJ[A-Za-z0-9_-]{20,}|postgres:\/\/|secret|password|BEGIN [A-Z ]*PRIVATE KEY)/i.test(String(input.credential_ref))) {
    throw new Error('refusing to store an apparent secret in credential_ref; store a reference (env key name) only');
  }

  const row = {
    provider_id: input.provider_id,
    legal_name: input.legal_name,
    products: input.products || [],
    regions: input.regions || [],
    contract_status: input.contract_status || 'none',
    credential_ref: input.credential_ref || null,
    consent_version: input.consent_version || 'insurer-consent-1.0.0',
    min_data_projection: input.min_data_projection || { required: ['vin'], optional: [] },
    active: input.active === true,
    tenant_id: input.tenant_id || provider.tenant_id || null,
  };

  const { data: existing } = await supabase.from('insurer_profiles').select('*').eq('provider_id', input.provider_id).maybeSingle();
  if (existing) {
    const { data, error } = await supabase.from('insurer_profiles')
      .update({ ...row, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase.from('insurer_profiles')
    .insert({ ...row, created_by: actor.id || null }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getActiveInsurerProfile({ insurerProfileId } = {}) {
  if (insurerProfileId) {
    const { data } = await supabase.from('insurer_profiles').select('*').eq('id', insurerProfileId).maybeSingle();
    return data && data.active ? data : (data || null);
  }
  const { data } = await supabase.from('insurer_profiles').select('*').eq('active', true).order('created_at', { ascending: false });
  return (data && data[0]) || null;
}

export async function listInsurerProviders() {
  const { data: profiles } = await supabase.from('insurer_profiles').select('*').order('created_at', { ascending: false });
  const out = [];
  for (const p of profiles || []) {
    const { data: reg } = await supabase.from('provider_registry').select('*').eq('id', p.provider_id).maybeSingle();
    out.push({
      insurer_profile_id: p.id,
      legal_name: p.legal_name,
      active: p.active,
      contract_status: p.contract_status,
      products: p.products,
      regions: p.regions,
      provider_key: reg?.provider_key || null,
      activation_mode: reg?.activation_mode || 'not_configured',
      kill_switch_enabled: reg?.kill_switch_enabled ?? true,
      health_state: reg?.health_state || 'unknown',
      incident_state: reg?.incident_state || 'none',
    });
  }
  return out;
}

// ── consent ───────────────────────────────────────────────────────────────────

/** Record an append-only consent grant. Returns the consent row (its id is the consentRef). */
export async function recordConsent(vin, { userId, insurerProfileId, scope, consentVersion } = {}) {
  if (!vin) throw new Error('vin required');
  const { data: vehicle } = await supabase.from('vehicles').select('vin').eq('vin', vin).maybeSingle();
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);
  const row = {
    vin,
    user_id: userId || null,
    insurer_profile_id: insurerProfileId || null,
    consent_version: consentVersion || 'insurer-consent-1.0.0',
    scope: scope || { fields: [] },
  };
  const { data, error } = await supabase.from('insurance_consents').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** One-way revocation (NULL -> timestamp). Enforced immutable by insurance_consent_guard. */
export async function revokeConsent(consentId) {
  const { data, error } = await supabase.from('insurance_consents')
    .update({ revoked_at: new Date().toISOString() }).eq('id', consentId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Verify a consent covers the insurer's min_data_projection. Returns { ok, reason?, consent? }.
 * Fail-closed on: missing ref, not found, revoked, version mismatch, insufficient scope.
 */
export async function verifyConsent(vin, consentRef, profile) {
  if (!consentRef) return { ok: false, reason: 'consent_missing' };
  const { data: consent } = await supabase.from('insurance_consents').select('*').eq('id', consentRef).eq('vin', vin).maybeSingle();
  if (!consent) return { ok: false, reason: 'consent_not_found' };
  if (consent.revoked_at) return { ok: false, reason: 'consent_revoked' };
  if (profile?.consent_version && consent.consent_version !== profile.consent_version) {
    return { ok: false, reason: 'consent_version_mismatch' };
  }
  const required = (profile?.min_data_projection?.required) || [];
  const granted = new Set((consent.scope?.fields) || []);
  const missing = required.filter((f) => !granted.has(f));
  if (missing.length) return { ok: false, reason: 'consent_scope_insufficient', missing };
  return { ok: true, consent };
}

/** Build the minimal PUBLIC vehicle-fact projection permitted by consent + min_data_projection. */
export function buildMinDataProjection(vehicle, profile, consent) {
  const required = (profile?.min_data_projection?.required) || [];
  const optional = (profile?.min_data_projection?.optional) || [];
  const granted = new Set((consent?.scope?.fields) || []);
  const projection = {};
  for (const field of [...required, ...optional]) {
    // Only PUBLIC vehicle facts, only if consent granted the field, only if present.
    if (granted.has(field) && vehicle[field] !== undefined && !PRIVATE_FIELDS.has(field)) {
      projection[field] = vehicle[field];
    }
  }
  return projection;
}
// Fields that must never be projected to an insurer as "public vehicle facts".
const PRIVATE_FIELDS = new Set(['owner_id', 'tenant_id']);

// ── request execution ──────────────────────────────────────────────────────────

/** Map a provider-framework result + insurer projection to an insurer decision. */
function mapOutcome(fw) {
  const evidence = fw.data || {};
  const providerRef = evidence.reference || null;
  const conditions = Array.isArray(evidence.conditions) ? evidence.conditions : [];
  const decide = (outcome, extra = {}) => ({ outcome, providerRef: extra.providerRef ?? providerRef, conditions: extra.conditions ?? [], validityDays: extra.validityDays ?? null });

  switch (fw.outcome) {
    case 'ok': {
      // Honesty gate: never claim an issued/eligible policy without confirmed provider evidence.
      if (!providerRef) return decide('manual_review', { providerRef: null, conditions: ['awaiting_provider_evidence'] });
      const elig = evidence.eligibility || 'eligible';
      if (elig === 'eligible') return decide('eligible', { validityDays: 365 });
      if (elig === 'conditional') return decide('conditional', { conditions, validityDays: 90 });
      if (elig === 'declined') return decide('declined');
      return decide('manual_review', { conditions });
    }
    case 'mismatch': return decide('conditional', { conditions: conditions.length ? conditions : ['valid_vid_required'], validityDays: 90 });
    case 'high_risk': return decide('declined');
    case 'no_record': return decide('manual_review', { conditions: ['no_insurer_record'] });
    case 'unavailable':
    case 'circuit_open': return decide('unavailable', { providerRef: null });
    case 'timeout':
    case 'rate_limited':
    case 'malformed':
    case 'error': return decide('failed', { providerRef: null });
    default: return decide('manual_review', { providerRef: null });
  }
}

async function insertRequest(row) {
  const { data, error } = await supabase.from('eligibility_requests').insert(row).select().single();
  if (error) throw new Error(`failed to persist insurer request: ${error.message}`);
  return data;
}

async function appendDecision({ requestId, insurerProfileId, vin, outcome, mode, providerRef, conditions, validityUntil, correlationId, source }) {
  const { data, error } = await supabase.from('insurance_provider_decisions').insert({
    eligibility_request_id: requestId || null,
    insurer_provider_id: insurerProfileId,
    vin,
    outcome,
    mode: mode || 'sandbox',
    provider_reference: providerRef || null,
    conditions: conditions || [],
    validity_until: validityUntil || null,
    correlation_id: correlationId || null,
    source: source || 'sync',
  }).select().single();
  if (error) throw new Error(`failed to persist insurer decision: ${error.message}`);
  return data;
}

/**
 * Request insurer eligibility for a vehicle.
 *   requestInsurerEligibility(vin, { consentRef, gateContext, insurerProfileId, requestedBy,
 *                                    idempotencyKey, async, scenario })
 * Returns { request, decision, public } (public is the underwriting-free projection).
 */
export async function requestInsurerEligibility(vin, opts = {}) {
  const correlationId = opts.correlationId || crypto.randomUUID();
  const idempotencyKey = opts.idempotencyKey || null;

  // 0. Request-level idempotency: a repeat key never creates a duplicate request.
  if (idempotencyKey) {
    const { data: existing } = await supabase.from('eligibility_requests').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) {
      const { data: decisions } = await supabase.from('insurance_provider_decisions').select('*').eq('eligibility_request_id', existing.id).order('created_at', { ascending: false });
      return { request: existing, decision: (decisions && decisions[0]) || null, public: publicProjection(existing, (decisions && decisions[0]) || null), deduped: true };
    }
  }

  // 1. Load the vehicle (PUBLIC facts only).
  const { data: vehicle } = await supabase.from('vehicles').select('*').eq('vin', vin).maybeSingle();
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  // 2. Resolve the insurer + its provider-platform registry row.
  const profile = await getActiveInsurerProfile({ insurerProfileId: opts.insurerProfileId });
  if (!profile || !profile.active) {
    return persistBlocked({ vin, vehicle, profile, correlationId, idempotencyKey, requestedBy: opts.requestedBy, gateCtx: opts.gateContext || {}, status: 'unavailable', outcome: 'unavailable', reasons: ['insurer_unavailable'], errorCategory: 'provider_error' });
  }
  const { data: provider } = await supabase.from('provider_registry').select('*').eq('id', profile.provider_id).maybeSingle();
  const activationMode = provider?.activation_mode || 'not_configured';

  // 3. Consent + min-data projection verification (fail-closed).
  const consentCheck = await verifyConsent(vin, opts.consentRef, profile);
  if (!consentCheck.ok) {
    return persistBlocked({ vin, vehicle, profile, correlationId, idempotencyKey, requestedBy: opts.requestedBy, gateCtx: opts.gateContext || {}, status: 'manual_review', outcome: 'manual_review', reasons: [consentCheck.reason], consentRef: opts.consentRef });
  }

  // 4. Trust gates — REUSE the shared eligibility gate evaluator (identity/fraud/publication/dealer),
  //    then apply the insurer-specific requirement (an active, callable provider).
  const gateCtx = { ...(opts.gateContext || {}), consent_reference: opts.consentRef };
  const gate = evaluateGates('insurance', gateCtx);
  if (!gate.allowed) {
    const status = gate.route; // 'not_eligible' | 'manual_review'
    const outcome = gate.route === 'not_eligible' ? 'declined' : 'manual_review';
    return persistBlocked({ vin, vehicle, profile, correlationId, idempotencyKey, requestedBy: opts.requestedBy, gateCtx, status, outcome, reasons: gate.reasons, consentRef: opts.consentRef, errorCategory: gate.route === 'not_eligible' ? 'gate_failed' : null });
  }

  // 5. Execute through the shared provider framework (sandbox simulator until live).
  const projection = buildMinDataProjection(vehicle, profile, consentCheck.consent);
  const fw = await executeProviderRequest(provider, { vin, reference: opts.scenario, scenario: opts.scenario, projection }, { correlationId, idempotencyKey });

  const mode = eligibilityModeFor(fw.mode || activationMode);
  const mapped = mapOutcome(fw);
  const status = OUTCOME_TO_STATUS[mapped.outcome];
  const validityUntil = validityFrom(mapped.validityDays);

  const request = await insertRequest({
    capability: 'insurance', vin, tenant_id: vehicle.tenant_id || null,
    requested_by: opts.requestedBy || null,
    provider_id: provider?.provider_key || profile.provider_id,
    mode, idempotency_key: idempotencyKey, correlation_id: correlationId,
    status, conditions: mapped.conditions, validity_until: validityUntil,
    consent_reference: opts.consentRef || null,
    decision_inputs: { ...gateCtx, insurer_profile_id: profile.id, provider_outcome: fw.outcome, calculation_version: 'insurer-1.0.0' },
    response_reference: mapped.providerRef, error_category: fw.ok ? null : (fw.blocked_reason || null),
  });

  const decision = await appendDecision({
    requestId: request.id, insurerProfileId: profile.id, vin,
    outcome: mapped.outcome, mode, providerRef: mapped.providerRef,
    conditions: mapped.conditions, validityUntil, correlationId,
    source: opts.async ? 'sync' : 'sync',
  });

  return { request, decision, public: publicProjection(request, decision) };
}

/** Persist a gate/consent/availability block WITHOUT calling the provider. */
async function persistBlocked({ vin, vehicle, profile, correlationId, idempotencyKey, requestedBy, gateCtx, status, outcome, reasons, consentRef, errorCategory }) {
  const mode = profile ? 'sandbox' : 'unavailable';
  const request = await insertRequest({
    capability: 'insurance', vin, tenant_id: vehicle?.tenant_id || null,
    requested_by: requestedBy || null,
    provider_id: profile?.provider_id || 'insurer_unregistered',
    mode: status === 'unavailable' ? 'unavailable' : mode,
    idempotency_key: idempotencyKey, correlation_id: correlationId,
    status, conditions: reasons || [], validity_until: null,
    consent_reference: consentRef || null,
    decision_inputs: { ...(gateCtx || {}), gate_reasons: reasons, insurer_profile_id: profile?.id || null, calculation_version: 'insurer-1.0.0' },
    response_reference: null, error_category: errorCategory || null,
  });
  let decision = null;
  if (profile) {
    decision = await appendDecision({
      requestId: request.id, insurerProfileId: profile.id, vin,
      outcome, mode: request.mode, providerRef: null, conditions: reasons || [],
      validityUntil: null, correlationId, source: 'sync',
    });
  }
  return { request, decision, public: publicProjection(request, decision) };
}

// ── webhook ingest (async path) ──────────────────────────────────────────────

/**
 * Ingest a signed insurer webhook (async decision). Verifies HMAC signature + replay window
 * (REUSING webhookSecurity.verifyWebhook), dedupes by idempotency key, then appends a NEW
 * append-only decision and updates the eligibility request. Fail-closed on a missing secret.
 * NEVER records 'eligible' without a confirmed provider_reference in the payload.
 */
export async function ingestInsurerWebhook({ providerId, payloadString, signature, timestamp, idempotencyKey, body } = {}, now = Date.now()) {
  const pid = providerId || INSURER_WEBHOOK_PROVIDER;
  const verdict = verifyWebhook(pid, payloadString, signature, timestamp, now);

  // Dedupe: a repeated key is recorded (append-only) but never re-applied.
  let duplicate = false;
  if (idempotencyKey) {
    const { data: seen } = await supabase.from('eligibility_webhook_events').select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (seen) duplicate = true;
  }

  // Append-only webhook audit (best-effort; a unique clash means it is already recorded).
  await supabase.from('eligibility_webhook_events').insert({
    request_id: body?.request_id || null, capability: 'insurance', provider_id: pid,
    event_type: body?.event_type || 'insurer_decision', signature_valid: verdict.valid,
    replay_detected: verdict.replay, idempotency_key: idempotencyKey || null, payload: body || null,
  }).select().single().then(() => {}, () => {});

  // Fail-closed: an unknown provider means no usable secret (production w/o INSURANCE_WEBHOOK_SECRET).
  if (!verdict.valid) return { applied: false, reason: verdict.reason, signature_valid: false };
  if (duplicate) return { applied: false, reason: 'duplicate', signature_valid: true };
  if (!body?.request_id || !body?.outcome) return { applied: false, reason: 'missing_fields', signature_valid: true };
  if (!INSURER_OUTCOMES.includes(body.outcome)) return { applied: false, reason: 'invalid_outcome', signature_valid: true };

  const { data: request } = await supabase.from('eligibility_requests').select('*').eq('id', body.request_id).maybeSingle();
  if (!request) return { applied: false, reason: 'unknown_request', signature_valid: true };
  const insurerProfileId = request.decision_inputs?.insurer_profile_id || body.insurer_profile_id;
  if (!insurerProfileId) return { applied: false, reason: 'unknown_insurer', signature_valid: true };

  // Honesty gate: 'eligible' requires confirmed provider evidence; otherwise route to review.
  let outcome = body.outcome;
  const providerRef = body.provider_reference || null;
  const conditions = Array.isArray(body.conditions) ? body.conditions : [];
  if (outcome === 'eligible' && !providerRef) { outcome = 'manual_review'; conditions.push('awaiting_provider_evidence'); }
  const status = OUTCOME_TO_STATUS[outcome];
  const validityUntil = body.validity_until || null;

  await supabase.from('eligibility_requests').update({
    status, conditions, response_reference: providerRef, updated_at: new Date().toISOString(),
  }).eq('id', request.id);

  const decision = await appendDecision({
    requestId: request.id, insurerProfileId, vin: request.vin,
    outcome, mode: request.mode || 'sandbox', providerRef, conditions,
    validityUntil, correlationId: request.correlation_id, source: 'webhook',
  });

  return { applied: true, reason: 'ok', signature_valid: true, outcome, decision_id: decision.id };
}

// ── read / projections ─────────────────────────────────────────────────────────

/**
 * PUBLIC projection: safe to return to an owner/dealer/reviewer. Strips gate context, raw
 * provider payloads, decision_inputs and ANY underwriting/applicant data.
 */
export function publicProjection(request, decision) {
  if (!request) return { capability: 'insurance', status: 'not_requested' };
  return {
    capability: 'insurance',
    vin: request.vin,
    status: request.status,
    outcome: decision?.outcome || null,
    mode: decision?.mode || request.mode,             // honesty label (e.g. 'sandbox')
    conditions: decision?.conditions || request.conditions || [],
    provider_reference: decision?.provider_reference || request.response_reference || null,
    validity_until: decision?.validity_until || request.validity_until || null,
    updated_at: request.updated_at || request.created_at || null,
  };
}

/** Latest insurer status (public projection) for a vehicle. */
export async function getInsurerStatus(vin) {
  const { data: requests } = await supabase.from('eligibility_requests').select('*').eq('vin', vin).eq('capability', 'insurance').order('created_at', { ascending: false });
  const request = requests && requests[0];
  if (!request) return { capability: 'insurance', vin, status: 'not_requested' };
  const { data: decisions } = await supabase.from('insurance_provider_decisions').select('*').eq('eligibility_request_id', request.id).order('created_at', { ascending: false });
  return publicProjection(request, (decisions && decisions[0]) || null);
}

/** ADMIN/support: full append-only decision history for a vehicle (privileged use only). */
export async function getInsurerDecisionHistory(vin) {
  const { data } = await supabase.from('insurance_provider_decisions').select('*').eq('vin', vin).order('created_at', { ascending: false });
  return data || [];
}

/** Helper for tests/tools: produce the signature an insurer would send for a payload. */
export function signInsurerWebhook(payloadString, timestamp, providerId = INSURER_WEBHOOK_PROVIDER) {
  return sign(providerId, payloadString, timestamp);
}

export default {
  INSURER_WEBHOOK_PROVIDER, INSURER_OUTCOMES, OUTCOME_TO_STATUS,
  registerInsurerProfile, getActiveInsurerProfile, listInsurerProviders,
  recordConsent, revokeConsent, verifyConsent, buildMinDataProjection,
  requestInsurerEligibility, ingestInsurerWebhook,
  publicProjection, getInsurerStatus, getInsurerDecisionHistory, signInsurerWebhook,
};
