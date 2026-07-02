/**
 * Source Verification Orchestrator — Workstream 2 + feeds Workstream 10.
 *
 * Runs registry adapters for a VIN, persists each result as an APPEND-ONLY row in
 * source_verification_results, and exposes coverage for the unified trust decision model
 * and the buyer/partner surfaces.
 *
 * Guarantees:
 *   - Every result is honestly mode-labelled (live/sandbox/partner_file/manual/unavailable).
 *   - A failed adapter is recorded as 'unavailable' (fail-closed) — never dropped, never
 *     turned into a match.
 *   - Raw provider payloads are stored privileged-only; buyer/partner surfaces read the
 *     public coverage view (status + mode only, no identity PII).
 *   - AI/automation never sets these results; they come from adapters or authorized
 *     manual verification.
 */
import { supabase } from '../../db/supabase.js';
import {
  registerAdapter,
  getAdapter,
  listAdapters,
  normalizeVerificationResult,
  _resetRegistry,
  PROVIDERS,
} from './verificationContract.js';
import { buildRegistryAdapters } from './adapters/registryAdapters.js';

const TABLE = 'source_verification_results';

/**
 * Register the default sandbox adapters. `flags` maps provider -> () => boolean.
 * Idempotent: clears then re-registers.
 */
export function initSourceVerification(flags = {}) {
  _resetRegistry();
  for (const adapter of buildRegistryAdapters(flags)) {
    registerAdapter(adapter);
  }
  return listAdapters();
}

/** Compare what a source returned with the canonical vehicle identity. */
function deriveMismatchFlags(provider, identityFields, vehicle) {
  const flags = [];
  if (!vehicle) return flags;
  const sourceYear = identityFields.declared_year || identityFields.registered_year;
  if (sourceYear && vehicle.year && Number(sourceYear) !== Number(vehicle.year)) {
    flags.push(`${provider}_year_mismatch`);
  }
  const sourceMake = identityFields.declared_make || identityFields.registered_make;
  if (sourceMake && vehicle.make && String(sourceMake).toLowerCase() !== String(vehicle.make).toLowerCase()) {
    flags.push(`${provider}_make_mismatch`);
  }
  const sourceModel = identityFields.declared_model || identityFields.registered_model;
  if (sourceModel && vehicle.model && String(sourceModel).toLowerCase() !== String(vehicle.model).toLowerCase()) {
    flags.push(`${provider}_model_mismatch`);
  }
  return flags;
}

async function loadVehicle(vin) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('vin, make, model, year, plate_number, chassis_number, engine_number, tenant_id')
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error(`vehicle lookup failed: ${error.message}`);
  return data || null;
}

/**
 * Verify a single source for a VIN and persist the result (append-only).
 * @returns the persisted, public-safe result row (raw_payload stripped).
 */
export async function verifySource(vin, provider, opts = {}) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`unknown provider: ${provider}`);
  }
  const adapter = getAdapter(provider);
  if (!adapter) {
    throw new Error(`adapter not registered: ${provider} (call initSourceVerification first)`);
  }

  const vehicle = await loadVehicle(vin);
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  const queryType = opts.queryType || 'vin';
  const queryValue = opts.queryValue || vin;

  let normalized;
  try {
    const raw = await adapter.verify({ vin, value: queryValue, now: opts.now }, { vehicle });
    normalized = normalizeVerificationResult(provider, raw);
  } catch (err) {
    // Fail-closed: an adapter that throws becomes an honest 'unavailable' record.
    normalized = normalizeVerificationResult(provider, {
      mode: 'unavailable',
      result: 'unavailable',
      confidence: null,
      error_class: 'provider_error',
      identity_fields: {},
      mismatch_flags: [],
      raw_payload: { error: String(err && err.message ? err.message : err) },
    });
  }

  // Cross-check returned identity against the canonical vehicle. If the source said
  // 'match' but identity actually disagrees, downgrade to 'mismatch' (never the reverse).
  const derivedFlags = deriveMismatchFlags(provider, normalized.identity_fields, vehicle);
  let result = normalized.result;
  let mismatchFlags = [...normalized.mismatch_flags];
  if (derivedFlags.length > 0) {
    mismatchFlags = [...new Set([...mismatchFlags, ...derivedFlags])];
    if (result === 'match') result = 'mismatch';
  }

  const row = {
    vin,
    provider,
    mode: normalized.mode,
    query_type: queryType,
    query_value: queryValue,
    result,
    confidence: normalized.confidence,
    source_record_id: normalized.source_record_id,
    retrieved_at: normalized.retrieved_at || new Date().toISOString(),
    identity_fields: normalized.identity_fields,
    mismatch_flags: mismatchFlags,
    error_class: normalized.error_class,
    raw_payload: normalized.raw_payload,
    feature_flag: opts.featureFlag || `vehicle-trust.source.${provider}`,
    legal_basis: normalized.legal_basis,
    requested_by: opts.requestedBy || null,
    tenant_id: vehicle.tenant_id || null,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (error) throw new Error(`failed to persist verification result: ${error.message}`);
  return stripRaw(data);
}

/** Run all registered sources for a VIN. Returns one public-safe result per provider. */
export async function verifyAllSources(vin, opts = {}) {
  const out = [];
  for (const provider of PROVIDERS) {
    if (!getAdapter(provider)) continue;
    out.push(await verifySource(vin, provider, opts));
  }
  return out;
}

/**
 * Record an authorized MANUAL verification. The result is honestly mode-labelled
 * 'manual_verification' and carries the actor + reason for audit.
 */
export async function recordManualVerification(vin, provider, payload, actor) {
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider: ${provider}`);
  if (!actor || !actor.id) throw new Error('manual verification requires an authenticated actor');
  const allowed = ['match', 'mismatch', 'no_record', 'manual_review', 'high_risk'];
  if (!allowed.includes(payload.result)) {
    throw new Error(`manual verification result must be one of ${allowed.join('|')}`);
  }
  const vehicle = await loadVehicle(vin);
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  const row = {
    vin,
    provider,
    mode: 'manual_verification',
    query_type: payload.query_type || 'vin',
    query_value: payload.query_value || vin,
    result: payload.result,
    confidence: payload.confidence ?? null,
    source_record_id: payload.source_record_id || null,
    retrieved_at: new Date().toISOString(),
    identity_fields: payload.identity_fields || {},
    mismatch_flags: payload.mismatch_flags || [],
    error_class: null,
    raw_payload: payload.evidence ? { evidence: payload.evidence } : null,
    manual_verified_by: actor.id,
    manual_reason: payload.reason || null,
    feature_flag: `vehicle-trust.source.${provider}`,
    legal_basis: 'CarUp authorized manual document review. Not a live government API confirmation.',
    requested_by: actor.id,
    tenant_id: vehicle.tenant_id || null,
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (error) throw new Error(`failed to persist manual verification: ${error.message}`);
  return stripRaw(data);
}

/** Buyer/partner-safe coverage: latest status per provider, no identity PII, no raw. */
export async function getCoverage(vin) {
  const { data, error } = await supabase
    .from('source_verification_coverage_public')
    .select('*')
    .eq('vin', vin);
  if (error) throw new Error(`coverage lookup failed: ${error.message}`);
  return data || [];
}

/**
 * Privileged result history (admin/reviewer). Includes identity_fields; raw_payload is
 * included only when `includeRaw` is explicitly true (admin/government).
 */
export async function getResults(vin, { includeRaw = false } = {}) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('vin', vin)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`results lookup failed: ${error.message}`);
  return (data || []).map((r) => (includeRaw ? r : stripRaw(r)));
}

function stripRaw(row) {
  if (!row) return row;
  const { raw_payload, ...safe } = row;
  return safe;
}

export default {
  initSourceVerification,
  verifySource,
  verifyAllSources,
  recordManualVerification,
  getCoverage,
  getResults,
};
