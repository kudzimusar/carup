/**
 * Regulated-lender (finance) provider workflow — Full Activation (canonical goal §101-113).
 *
 * EXTENDS the shared eligibility framework (services/eligibility) and the provider platform
 * (services/providerPlatform). It does NOT replace them:
 *   • trust/evidence/fraud/publication/dealer gates run BEFORE any lender call (evaluateGates);
 *   • the actual lender request goes through providerFramework.executeProviderRequest, so it
 *     inherits fail-closed gating, idempotency, retries, circuit breaker and honest mode
 *     labelling (sandbox until a real provider is live);
 *   • webhooks are verified with the same signature + replay + idempotency primitives
 *     (webhookSecurity), fail-closed on a missing secret.
 *
 * PRIVACY INVARIANT (canonical §112): this module never stores or projects raw applicant,
 * affordability, income or credit data. Decisions snapshot ONLY the gate context. Public /
 * Partner projections expose a COARSE availability state only — never a per-applicant
 * decision, and never any credit detail.
 *
 * AI never sets a decision. A provider must never silently fall back from live to sandbox.
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { getProvider as getRegistryProvider, isCallable } from '../providerPlatform/providerRegistry.js';
import { executeProviderRequest } from '../providerPlatform/providerFramework.js';
import { evaluateGates } from '../eligibility/eligibilityContract.js';
import { verifyWebhook } from '../eligibility/webhookSecurity.js';

// Finance decision outcomes persisted to finance_provider_decisions (mirror the DB CHECK).
export const FINANCE_OUTCOMES = [
  'potentially_eligible', 'conditional', 'manual_review', 'declined', 'unavailable', 'expired', 'failed',
];

// The webhook signing identity for the finance capability (webhookSecurity knows this key).
// In production the secret comes from FINANCE_WEBHOOK_SECRET; absent it, verification
// fail-closes (no committed literal is ever usable).
export const FINANCE_WEBHOOK_PROVIDER_ID = 'finance_sandbox';

// Map a providerFramework/simulator outcome onto a finance decision outcome.
const OUTCOME_MAP = {
  ok: 'potentially_eligible',
  mismatch: 'conditional',
  high_risk: 'declined',
  no_record: 'manual_review',
  unavailable: 'unavailable',
  circuit_open: 'unavailable',
  timeout: 'failed',
  rate_limited: 'failed',
  malformed: 'failed',
  invalid_signature: 'failed',
  error: 'failed',
};

// Sensitive keys that must never be persisted in a decision snapshot or projected publicly.
const FORBIDDEN_SNAPSHOT_KEYS = new Set([
  'income', 'monthly_income', 'credit_score', 'affordability', 'monthly_debts', 'ssn',
  'dti', 'debt_to_income', 'salary', 'bank_balance', 'net_worth',
]);

export function mapOutcome(providerOutcome) {
  return OUTCOME_MAP[providerOutcome] || 'failed';
}

/** Build the gate snapshot: ONLY the trust/evidence/fraud/publication/dealer context. */
export function buildGateSnapshot(gateContext = {}, extra = {}) {
  const allow = ['identity_status', 'fraud_block', 'publication_status', 'dealer_suspended',
    'evidence_sufficient', 'source_coverage_connected', 'min_source_coverage'];
  const snap = {};
  for (const k of allow) if (gateContext[k] !== undefined) snap[k] = gateContext[k];
  // Defensive: never let a sensitive key leak into the snapshot even if a caller passes it.
  for (const k of Object.keys(snap)) if (FORBIDDEN_SNAPSHOT_KEYS.has(k)) delete snap[k];
  return { ...snap, gate_version: 'finance-gate-1.0.0', ...extra };
}

async function loadVehicle(vin) {
  const { data } = await supabase.from('vehicles').select('vin, owner_id, tenant_id').eq('vin', vin).maybeSingle();
  return data || null;
}

/** Load the applicant's consent by reference (id). Active = not revoked, not erasure-requested. */
async function loadConsent(consentRef) {
  if (!consentRef) return null;
  const { data } = await supabase.from('finance_consents').select('*').eq('id', consentRef).maybeSingle();
  return data || null;
}
function consentIsActive(consent) {
  return !!consent && !consent.revoked_at && !consent.deletion_requested_at;
}

/**
 * A consent satisfies the mandatory-consent gate only if it is BOUND to this request.
 *
 * `loadConsent` resolves a row by id alone, and "active" only ever meant not-revoked and
 * not-erasure-requested. Neither `consent.vin` nor `consent.applicant_user_id` was compared to the
 * vehicle being underwritten or the caller asking — so any consent reference the caller could
 * produce satisfied the gate for any vin, and a lender decision for a stranger's vehicle came back
 * in the response body.
 *
 * Both halves are required:
 *   · VIN      — a consent is granted for ONE vehicle. Reusing it for another is not consent.
 *   · APPLICANT— consent is personal. A consent granted by someone else is not the caller's to spend.
 *
 * Fail closed: a consent row that does not carry the field cannot be shown to match, so it does
 * not satisfy the gate.
 */
function consentBindsRequest(consent, vin, requestedBy) {
  if (!consentIsActive(consent)) return false;
  if (consent.vin !== vin) return false;
  // `requestedBy` is the authenticated caller. A consent with no recorded applicant cannot be
  // proven to be theirs, so it does not bind.
  if (!requestedBy || !consent.applicant_user_id) return false;
  return consent.applicant_user_id === requestedBy;
}

function validityFrom(days) {
  if (!days) return null;
  return new Date(Date.now() + days * 86400000).toISOString();
}

/**
 * Record an applicant consent grant (append-only). Returns the consent row; its `id` is the
 * `applicantConsentRef` used by requestLenderEligibility.
 */
export async function recordApplicantConsent(vin, applicantUserId, { consentVersion, scope, tenantId } = {}) {
  if (!vin) throw new Error('vin required');
  if (!applicantUserId) throw new Error('applicant_user_id required');
  if (!consentVersion) throw new Error('consent_version required');
  const { data, error } = await supabase.from('finance_consents').insert({
    vin, applicant_user_id: applicantUserId, consent_version: consentVersion,
    scope: scope || {}, tenant_id: tenantId || null,
  }).select().single();
  if (error) throw new Error(`failed to record consent: ${error.message}`);
  return data;
}

/**
 * Record an applicant erasure/retention request (retention control). Stamps
 * deletion_requested_at (and revoked_at) on the consent — the actual data purge is a
 * separate, documented retention job. Consent rows are never hard-deleted (audit).
 */
export async function requestApplicantDeletion(consentRef, { actor } = {}) {
  const consent = await loadConsent(consentRef);
  if (!consent) throw new Error('consent not found');
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('finance_consents')
    .update({ deletion_requested_at: now, revoked_at: consent.revoked_at || now })
    .eq('id', consentRef).select().single();
  if (error) throw new Error(`failed to record deletion request: ${error.message}`);
  return { consent: data, deletion_requested_at: now, actor: actor || 'applicant' };
}

async function persistDecision(fields) {
  const { data, error } = await supabase.from('finance_provider_decisions').insert(fields).select().single();
  if (error) throw new Error(`failed to persist finance decision: ${error.message}`);
  return data;
}

async function upsertEligibilityRequest({ vin, tenantId, requestedBy, providerId, mode, idempotencyKey, correlationId, status, conditions, validityUntil, consentReference, snapshot, responseRef, errorCategory }) {
  if (idempotencyKey) {
    const { data: existing } = await supabase.from('eligibility_requests').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) {
      const { data: upd } = await supabase.from('eligibility_requests')
        .update({ status, conditions: conditions || [], response_reference: responseRef || null, validity_until: validityUntil || null, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      return upd || existing;
    }
  }
  const row = {
    capability: 'finance', vin, tenant_id: tenantId || null, requested_by: requestedBy || null,
    provider_id: providerId, mode, idempotency_key: idempotencyKey || null, correlation_id: correlationId,
    status, conditions: conditions || [], validity_until: validityUntil || null,
    consent_reference: consentReference || null,
    decision_inputs: { ...snapshot, calculation_version: 'finance-elig-1.0.0' },
    response_reference: responseRef || null, error_category: errorCategory || null,
  };
  const { data, error } = await supabase.from('eligibility_requests').insert(row).select().single();
  if (error) throw new Error(`failed to persist eligibility request: ${error.message}`);
  return data;
}

/**
 * Request lender eligibility for a vehicle.
 *
 * @param {string} vin
 * @param {object} opts
 *   applicantConsentRef  (required) — id of an active finance_consents row
 *   gateContext          — trust/evidence/fraud/publication/dealer inputs (evaluateGates)
 *   requestedBy          — applicant user id
 *   idempotencyKey       — dedup key (shared with the provider framework)
 *   providerKey          — registered lender provider_key (default 'lender_sandbox')
 *   jurisdiction         — default 'ZW'
 *   invoke               — optional provider invoker (tests inject; default = simulator)
 *
 * Persists an append-only finance_provider_decisions row and updates the eligibility_request.
 * The lender is NEVER called when a gate blocks or consent is missing/revoked.
 */
export async function requestLenderEligibility(vin, opts = {}) {
  const correlationId = opts.correlationId || crypto.randomUUID();
  const providerKey = opts.providerKey || 'lender_sandbox';
  const jurisdiction = opts.jurisdiction || 'ZW';
  const gateContext = opts.gateContext || {};
  const idempotencyKey = opts.idempotencyKey || null;

  const vehicle = await loadVehicle(vin);
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  // 1. Consent is mandatory (minimum approved data projection cannot proceed without it), and it
  //    must be THIS applicant's consent for THIS vehicle — see consentBindsRequest.
  const consent = await loadConsent(opts.applicantConsentRef);
  const consentOk = consentBindsRequest(consent, vin, opts.requestedBy);
  const snapshot = buildGateSnapshot(gateContext);

  // 2. Trust gates (finance without consent => manual_review; hard blocks => declined).
  const gate = evaluateGates('finance', { ...gateContext, consent_reference: consentOk ? opts.applicantConsentRef : null });

  const lender = await getRegistryProvider(providerKey, 'finance', jurisdiction);
  const mode = lender?.activation_mode || 'unavailable';

  // 3a. Blocked by a gate (or missing/invalid consent) — do NOT call the lender.
  if (!gate.allowed) {
    const outcome = gate.route === 'not_eligible' ? 'declined' : 'manual_review';
    const errorCategory = gate.route === 'not_eligible' ? 'gate_failed' : null;
    const req = await upsertEligibilityRequest({
      vin, tenantId: vehicle.tenant_id, requestedBy: opts.requestedBy, providerId: providerKey,
      mode, idempotencyKey, correlationId, status: outcome === 'declined' ? 'not_eligible' : 'manual_review',
      conditions: gate.reasons, consentReference: consentOk ? opts.applicantConsentRef : null, snapshot, errorCategory,
    });
    const decision = await persistDecision({
      eligibility_request_id: req.id, lender_provider_id: lender?.id || null,
      consent_id: consentOk ? opts.applicantConsentRef : null, vin, mode, outcome,
      conditions: gate.reasons, decision_inputs_snapshot: snapshot, correlation_id: correlationId,
      error_category: errorCategory, actor: opts.requestedBy || 'system',
    });
    return { request: req, decision, gated: true, reasons: gate.reasons, providerCalled: false };
  }

  // 3b. Lender must be registered + callable (fail-closed). Otherwise: unavailable.
  const callable = isCallable(lender);
  if (!lender || !callable.callable) {
    const req = await upsertEligibilityRequest({
      vin, tenantId: vehicle.tenant_id, requestedBy: opts.requestedBy, providerId: providerKey,
      mode, idempotencyKey, correlationId, status: 'unavailable', conditions: [],
      consentReference: opts.applicantConsentRef, snapshot, errorCategory: 'provider_error',
    });
    const decision = await persistDecision({
      eligibility_request_id: req.id, lender_provider_id: lender?.id || null,
      consent_id: opts.applicantConsentRef, vin, mode: lender?.activation_mode || 'unavailable',
      outcome: 'unavailable', decision_inputs_snapshot: snapshot, correlation_id: correlationId,
      error_category: callable.reason || 'not_registered', actor: opts.requestedBy || 'system',
    });
    return { request: req, decision, providerCalled: false, blocked_reason: callable.reason || 'not_registered' };
  }

  // 4. Call the lender THROUGH the provider framework (sandbox until live).
  const result = await executeProviderRequest(lender, { vin, reference: correlationId, scenario: opts.scenario },
    { correlationId, idempotencyKey, invoke: opts.invoke });
  const outcome = mapOutcome(result.outcome);
  const conditions = outcome === 'conditional' ? ['lender_conditions_apply'] : [];
  const validityUntil = outcome === 'potentially_eligible' || outcome === 'conditional'
    ? validityFrom(result.data?.validity_days || 30) : null;
  const providerRef = result.data?.reference || null;
  const status = statusForOutcome(outcome);

  const req = await upsertEligibilityRequest({
    vin, tenantId: vehicle.tenant_id, requestedBy: opts.requestedBy, providerId: providerKey,
    mode: result.mode || mode, idempotencyKey, correlationId, status, conditions,
    validityUntil, consentReference: opts.applicantConsentRef, snapshot, responseRef: providerRef,
    errorCategory: outcome === 'failed' ? (result.error_category || 'provider_error') : null,
  });
  const decision = await persistDecision({
    eligibility_request_id: req.id, lender_provider_id: lender.id, consent_id: opts.applicantConsentRef,
    vin, mode: result.mode || mode, outcome, conditions, provider_reference: providerRef,
    decision_inputs_snapshot: snapshot, correlation_id: correlationId, validity_until: validityUntil,
    error_category: outcome === 'failed' ? (result.error_category || 'provider_error') : null,
    actor: opts.requestedBy || 'system',
  });
  return { request: req, decision, providerCalled: true, providerResult: result, deduped: result.deduped || false };
}

// Map a finance decision outcome to the eligibility_requests.status vocabulary.
function statusForOutcome(outcome) {
  switch (outcome) {
    case 'potentially_eligible': return 'potentially_eligible';
    case 'conditional': return 'conditionally_eligible';
    case 'manual_review': return 'manual_review';
    case 'declined': return 'not_eligible';
    case 'unavailable': return 'unavailable';
    case 'expired': return 'expired';
    default: return 'failed';
  }
}

/**
 * Ingest an asynchronous lender webhook: verify signature + replay + idempotency, record an
 * audit event, then append a NEW finance decision + update the eligibility_request. Fail-closed
 * on a missing secret (verifyWebhook returns unknown_provider). Never mutates a prior decision.
 */
export async function ingestLenderWebhook({ providerId, payloadString, signature, timestamp, idempotencyKey, body }, now = Date.now()) {
  const provider = providerId || FINANCE_WEBHOOK_PROVIDER_ID;
  const verdict = verifyWebhook(provider, payloadString, signature, timestamp, now);

  // Dedup on the shared finance webhook audit ledger.
  let duplicate = false;
  if (idempotencyKey) {
    const { data: seen } = await supabase.from('eligibility_webhook_events').select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (seen) duplicate = true;
  }
  // Best-effort append-only audit (records failed/replayed events too).
  await supabase.from('eligibility_webhook_events').insert({
    request_id: body?.request_id || null, capability: 'finance', provider_id: provider,
    event_type: body?.event_type || 'lender_decision', signature_valid: verdict.valid,
    replay_detected: verdict.replay, idempotency_key: idempotencyKey || null, payload: body || null,
  }).select().single().then(() => {}, () => {});

  if (!verdict.valid) return { applied: false, reason: verdict.reason, signature_valid: false };
  if (duplicate) return { applied: false, reason: 'duplicate', signature_valid: true };
  if (!body?.request_id || !body?.outcome) return { applied: false, reason: 'missing_fields', signature_valid: true };
  if (!FINANCE_OUTCOMES.includes(body.outcome)) return { applied: false, reason: 'invalid_outcome', signature_valid: true };

  const { data: req } = await supabase.from('eligibility_requests').select('*').eq('id', body.request_id).maybeSingle();
  if (!req) return { applied: false, reason: 'unknown_request', signature_valid: true };

  const validityUntil = body.validity_days ? validityFrom(body.validity_days) : (req.validity_until || null);
  await supabase.from('eligibility_requests')
    .update({ status: statusForOutcome(body.outcome), conditions: body.conditions || [], response_reference: body.provider_reference || null, validity_until: validityUntil, updated_at: new Date().toISOString() })
    .eq('id', req.id);
  const decision = await persistDecision({
    eligibility_request_id: req.id, lender_provider_id: req.provider_id && isUuid(req.provider_id) ? req.provider_id : (body.lender_provider_id || null),
    consent_id: req.consent_reference || null, vin: req.vin, mode: req.mode, outcome: body.outcome,
    conditions: body.conditions || [], provider_reference: body.provider_reference || null,
    decision_inputs_snapshot: buildGateSnapshot(req.decision_inputs || {}, { source: 'webhook' }),
    correlation_id: req.correlation_id, validity_until: validityUntil, actor: `webhook:${provider}`,
  });
  return { applied: true, reason: 'ok', signature_valid: true, decision };
}
function isUuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }

/** Latest lender decision for a vehicle (PRIVATE — applicant/admin only). */
export async function getLenderStatus(vin) {
  const { data } = await supabase.from('finance_provider_decisions').select('*').eq('vin', vin).order('created_at', { ascending: false });
  const rows = data || [];
  return rows[0] ? toApplicantView(rows[0]) : { vin, outcome: 'not_requested' };
}

/** Full private decision history (applicant/admin). */
export async function getLenderHistory(vin) {
  const { data } = await supabase.from('finance_provider_decisions').select('*').eq('vin', vin).order('created_at', { ascending: false });
  return (data || []).map(toApplicantView);
}

/**
 * Private applicant/admin view. Still contains NO raw income/credit data (never stored), but
 * DOES include the decision outcome, conditions, provider reference and validity.
 */
export function toApplicantView(decision) {
  if (!decision) return null;
  return {
    vin: decision.vin, outcome: decision.outcome, conditions: decision.conditions || [],
    provider_reference: decision.provider_reference || null, mode: decision.mode,
    validity_until: decision.validity_until || null, created_at: decision.created_at,
  };
}

/**
 * COARSE public / Partner-API projection (canonical §112). Exposes ONLY whether finance is
 * offered for the vehicle — NEVER an applicant, a decision outcome, credit/income/affordability
 * data, provider reference, conditions or gate snapshot. Safe for the public passport and the
 * general Partner API.
 */
export async function financeAvailabilityPublic(vin, { jurisdiction = 'ZW' } = {}) {
  const { data } = await supabase.from('lender_profiles').select('active').eq('active', true);
  const anyActive = (data || []).length > 0;
  return { vin, finance: anyActive ? 'available' : 'not_offered', detail: 'coarse_availability_only' };
}

/** Sanitiser used by any projection layer to strip forbidden keys defensively. */
export function stripSensitive(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!FORBIDDEN_SNAPSHOT_KEYS.has(k)) out[k] = v;
  return out;
}

export const FORBIDDEN_KEYS = [...FORBIDDEN_SNAPSHOT_KEYS];

export default {
  FINANCE_OUTCOMES, FINANCE_WEBHOOK_PROVIDER_ID, FORBIDDEN_KEYS,
  mapOutcome, buildGateSnapshot, recordApplicantConsent, requestApplicantDeletion,
  requestLenderEligibility, ingestLenderWebhook, getLenderStatus, getLenderHistory,
  toApplicantView, financeAvailabilityPublic, stripSensitive,
};
