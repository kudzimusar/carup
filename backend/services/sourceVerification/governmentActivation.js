/**
 * Government Source Activation — Full Activation (ZIMRA · CVR · ZINARA · VID · CID).
 *
 * The live-activation layer that runs a government registry check through the SHARED,
 * governed provider execution path and maps the outcome INTO the existing append-only
 * source-verification contract. It is the seam where a source moves from sandbox to
 * partner_file to pilot/live WITHOUT changing persistence, routes, buyer projections, or
 * the fraud/review gates.
 *
 * HONESTY IS STRUCTURAL — enforced end to end:
 *   1. The provider is resolved from provider_registry (capability_type='government_source').
 *      An UNCONTRACTED source (no registry row) or a KILLED/non-callable provider fails
 *      CLOSED to result='unavailable' + error_class='not_contracted' — NEVER a fabricated
 *      match. Fabrication is impossible: real transports (official/partner/webhook/batch)
 *      are a stub that returns 'credential_pending' -> 'unavailable' until wired.
 *   2. The framework's activation_mode is carried through to the persisted honesty MODE
 *      (sandbox/partner_file/manual_verification/live/unavailable). A sandbox result can
 *      never be relabelled as a live government confirmation.
 *   3. Results are normalized through the EXISTING verificationContract honesty guards and
 *      written as an APPEND-ONLY source_verification_results row (same table + shape the
 *      orchestrator uses), so provenance, the coverage view, and RLS all apply unchanged.
 *   4. A mismatch/high_risk result feeds the EXISTING fraud engine (evaluateAndPersist),
 *      which opens/refreshes a fraud_case and applies the publication block. See §"fraud".
 *   5. Buyer/partner surfaces read only the safe projection (projectResultForAudience) —
 *      never customs/clearance references, logbook serials, or owner identity.
 *   6. CID access is strictly logged: every check writes an append-only
 *      provider_request_attempts row (correlation_id + vin + outcome), including on denial.
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { getProvider, setKillSwitch, setActivationMode } from '../providerPlatform/providerRegistry.js';
import { executeProviderRequest } from '../providerPlatform/providerFramework.js';
import { resolveScenario, SCENARIO_OUTCOME } from '../providerPlatform/simulators.js';
import { normalizeVerificationResult } from './verificationContract.js';
import { evaluateAndPersist } from '../fraud/fraudEngine.js';

export const GOV_CAPABILITY = 'government_source';
export const SOURCE_KEYS = ['zimra', 'cvr', 'zinara', 'vid', 'cid'];
const SVR_TABLE = 'source_verification_results';

// Provider activation_mode -> source-verification honesty MODE. A real/pilot connection maps
// to 'live'; everything below maps to its honest label. Blocked calls are forced 'unavailable'.
const MODE_MAP = {
  sandbox: 'sandbox',
  partner_file: 'partner_file',
  manual: 'manual_verification',
  pilot_live: 'live',
  live: 'live',
};

// Framework outcome -> (source-verification result, error_class|null). Anything that is not a
// clean verdict fails closed to 'unavailable' with an honest error classification.
const OUTCOME_MAP = {
  ok: { result: 'match', error_class: null },
  mismatch: { result: 'mismatch', error_class: null },
  no_record: { result: 'no_record', error_class: null },
  high_risk: { result: 'high_risk', error_class: null },
  unavailable: { result: 'unavailable', error_class: 'provider_error' },
  timeout: { result: 'unavailable', error_class: 'timeout' },
  rate_limited: { result: 'unavailable', error_class: 'rate_limited' },
  malformed: { result: 'unavailable', error_class: 'malformed_response' },
  invalid_signature: { result: 'unavailable', error_class: 'unauthorized' },
  duplicate: { result: 'unavailable', error_class: 'provider_error' },
  circuit_open: { result: 'unavailable', error_class: 'provider_error' },
  error: { result: 'unavailable', error_class: 'provider_error' },
};

// A blocked_reason (kill switch / mode / capability / not registered) is a governance denial,
// which we classify honestly as 'not_contracted'. 'circuit_open' is a provider health problem.
function errorClassForBlock(reason) {
  if (reason === 'circuit_open') return 'provider_error';
  return 'not_contracted';
}

// ── §76-80 minimum-semantics field maps ─────────────────────────────────────────
// Per source: what identifiers it needs, what fields it returns, which of those are
// buyer-safe, and how a raw payload maps into privileged identity_fields + mismatch_flags.
// `buyerSafe` is the ALLOW-LIST for buyer/partner projections; anything not listed is
// privileged-only (references, serials, owner identity, chassis/engine verification, etc.).
export const GOVERNMENT_FIELD_MAPS = {
  // §76 ZIMRA: import/customs reference, declared identity, import date, duty/status category.
  zimra: {
    displayName: 'ZIMRA (Customs & Import Duty)',
    requiredIdentifiers: ['vin', 'chassis'],
    expectedFields: ['customs_ref_number', 'import_date', 'port_of_entry',
      'declared_make', 'declared_model', 'declared_year', 'duty_status'],
    buyerSafe: ['import_date', 'duty_status', 'declared_make', 'declared_model', 'declared_year'],
    privacyNote: 'customs_ref_number is a permitted internal reference held privileged-only.',
    mapIdentity: (raw = {}) => ({
      identity_fields: {
        customs_ref_number: raw.customs_ref_number ?? null,
        import_date: raw.import_date ?? null,
        port_of_entry: raw.port_of_entry ?? null,
        declared_make: raw.declared_make ?? null,
        declared_model: raw.declared_model ?? null,
        declared_year: raw.declared_year ?? null,
        duty_status: raw.duty_status ?? null,
      },
      mismatch_flags: raw.mismatch_flags || [],
    }),
  },

  // §77 CVR: registration status, registered identity, privacy-safe ownership-verification state.
  cvr: {
    displayName: 'Central Vehicle Registry (Registration & Ownership)',
    requiredIdentifiers: ['vin', 'plate'],
    expectedFields: ['registration_number', 'registration_status', 'registered_make',
      'registered_model', 'registered_year', 'ownership_verified', 'logbook_serial'],
    // Registered identity make/model/year are public vehicle facts; registration_status and a
    // BOOLEAN ownership-verification state are buyer-safe. registration_number, logbook_serial
    // and any owner identity are NEVER exposed to buyers.
    buyerSafe: ['registration_status', 'ownership_verification_state',
      'registered_make', 'registered_model', 'registered_year'],
    privacyNote: 'Owner identity is never returned. Ownership is exposed only as a verified/unverified/disputed state.',
    mapIdentity: (raw = {}) => ({
      identity_fields: {
        registration_number: raw.registration_number ?? null,
        registration_status: raw.registration_status ?? null,
        registered_make: raw.registered_make ?? null,
        registered_model: raw.registered_model ?? null,
        registered_year: raw.registered_year ?? null,
        ownership_verified: raw.ownership_verified ?? null,
        // privacy-safe derived state — never the owner's name/id
        ownership_verification_state:
          raw.ownership_verification_state ||
          (raw.ownership_verified === true ? 'verified'
            : raw.ownership_verified === false ? 'unverified' : 'unknown'),
        logbook_serial: raw.logbook_serial ?? null,
      },
      mismatch_flags: raw.mismatch_flags || [],
    }),
  },

  // §78 ZINARA: licence status, expiry, identity match, permitted status category.
  zinara: {
    displayName: 'ZINARA (Road Licensing)',
    requiredIdentifiers: ['plate', 'vin'],
    expectedFields: ['plate_number', 'licence_status', 'licence_expiry',
      'status_category', 'receipt_number'],
    buyerSafe: ['licence_status', 'licence_expiry', 'status_category'],
    privacyNote: 'receipt_number is a permitted internal reference held privileged-only.',
    mapIdentity: (raw = {}) => ({
      identity_fields: {
        plate_number: raw.plate_number ?? null,
        licence_status: raw.licence_status ?? null,
        licence_expiry: raw.licence_expiry ?? null,
        status_category: raw.status_category || raw.licence_status || null,
        receipt_number: raw.receipt_number ?? null,
      },
      mismatch_flags: raw.mismatch_flags || [],
    }),
  },

  // §79 VID: inspection/fitness status, test/expiry dates, result category, identity mismatch.
  vid: {
    displayName: 'VID (Vehicle Inspection / Roadworthiness)',
    requiredIdentifiers: ['vin'],
    expectedFields: ['inspection_status', 'inspection_date', 'expiry_date',
      'result_category', 'certificate_serial'],
    buyerSafe: ['inspection_status', 'inspection_date', 'expiry_date', 'result_category'],
    privacyNote: 'certificate_serial and raw odometer readings are held privileged-only.',
    mapIdentity: (raw = {}) => ({
      identity_fields: {
        inspection_status: raw.inspection_status ?? null,
        inspection_date: raw.inspection_date ?? null,
        expiry_date: raw.expiry_date ?? null,
        result_category: raw.result_category || raw.inspection_status || null,
        certificate_serial: raw.certificate_serial ?? null,
        odometer_reading: raw.odometer_reading ?? null,
      },
      mismatch_flags: raw.mismatch_flags || [],
    }),
  },

  // §80 CID: stolen/reported-interest status, query time, permitted reference, confidence,
  // strict access logging (the provider_request_attempts row is the access log).
  cid: {
    displayName: 'CID (Police Clearance / Stolen Check)',
    requiredIdentifiers: ['vin', 'chassis', 'engine'],
    expectedFields: ['stolen_check_status', 'clearance_ref_number', 'chassis_verified',
      'engine_number_verified', 'interpol_queried', 'case_reference', 'queried_at'],
    // Only a coarse stolen-status CATEGORY + query time reach buyers. Case/clearance
    // references and per-identifier verification booleans are strictly privileged.
    buyerSafe: ['stolen_status_category', 'queried_at'],
    privacyNote: 'Clearance and case references are never exposed to buyers. Every access is audit-logged (provider_request_attempts).',
    strictAccessLog: true,
    mapIdentity: (raw = {}) => {
      const s = String(raw.stolen_check_status || '').toLowerCase();
      const stolen_status_category = s.includes('flag') || s.includes('stolen') ? 'flagged'
        : s.includes('clear') ? 'cleared' : 'unknown';
      return {
        identity_fields: {
          stolen_check_status: raw.stolen_check_status ?? null,
          stolen_status_category,
          clearance_ref_number: raw.clearance_ref_number ?? null,
          chassis_verified: raw.chassis_verified ?? null,
          engine_number_verified: raw.engine_number_verified ?? null,
          interpol_queried: raw.interpol_queried ?? null,
          case_reference: raw.case_reference ?? null,
          queried_at: raw.queried_at || new Date().toISOString(),
        },
        mismatch_flags: raw.mismatch_flags || [],
      };
    },
  },
};

// ── sandbox transport payloads (HONESTLY tagged, never real registry data) ───────
// Source-specific, scenario-keyed synthetic payloads that exercise the §76-80 field maps.
// Used ONLY for sandbox/partner_file/manual transports. Live/pilot transports NEVER read
// these — they return credential_pending until a real transport is wired.
const SANDBOX_PAYLOADS = {
  zimra: {
    match: { customs_ref_number: 'ZIMRA-CE-SANDBOX-44021', import_date: '2024-03-11', port_of_entry: 'Beitbridge', declared_make: 'Toyota', declared_model: 'Hilux', declared_year: 2018, duty_status: 'paid' },
    mismatch: { customs_ref_number: 'ZIMRA-CE-SANDBOX-44099', import_date: '2024-03-11', port_of_entry: 'Beitbridge', declared_year: 2016, duty_status: 'partial', mismatch_flags: ['declared_year_differs', 'duty_status_partial'] },
    high_risk: { duty_status: 'unpaid', customs_flag: 'under_investigation', mismatch_flags: ['duty_unpaid', 'customs_record_flagged'] },
    no_record: {},
  },
  cvr: {
    match: { registration_number: 'ADZ-SANDBOX-1182', registration_status: 'Current', registered_make: 'Toyota', registered_model: 'Hilux', registered_year: 2018, ownership_verified: true, logbook_serial: 'CVR-LB-SANDBOX-77310' },
    mismatch: { registration_number: 'ADZ-SANDBOX-1182', registration_status: 'Current', registered_model: 'Fortuner', ownership_verified: true, mismatch_flags: ['registered_model_differs'] },
    high_risk: { registration_status: 'Cancelled', ownership_verified: false, mismatch_flags: ['registration_cancelled', 'ownership_dispute'] },
    no_record: {},
  },
  zinara: {
    match: { plate_number: 'ADZ-SANDBOX-1182', licence_status: 'Current', licence_expiry: '2026-09-30', status_category: 'Current', receipt_number: 'ZIN-SANDBOX-55218' },
    mismatch: { plate_number: 'ADX-SANDBOX-9921', licence_status: 'Current', status_category: 'Current', mismatch_flags: ['plate_differs_from_vehicle'] },
    high_risk: { licence_status: 'Arrears', licence_expiry: '2025-01-31', status_category: 'Arrears', mismatch_flags: ['licence_in_arrears'] },
    no_record: {},
  },
  vid: {
    match: { inspection_status: 'Passed', inspection_date: '2025-11-04', expiry_date: '2026-11-04', result_category: 'Roadworthy', certificate_serial: 'VID-SANDBOX-30144' },
    mismatch: { inspection_status: 'Roadworthy_Conditional', result_category: 'Conditional', odometer_reading: 142000, mismatch_flags: ['odometer_differs_from_listing'] },
    high_risk: { inspection_status: 'Failed_Unroadworthy', result_category: 'Failed', mismatch_flags: ['failed_unroadworthy'] },
    no_record: {},
  },
  cid: {
    match: { clearance_ref_number: 'CID-SANDBOX-88017', stolen_check_status: 'Cleared', chassis_verified: true, engine_number_verified: true, interpol_queried: true },
    mismatch: { stolen_check_status: 'Cleared', engine_number_verified: false, mismatch_flags: ['engine_number_unverified'] },
    high_risk: { stolen_check_status: 'Flagged_Stolen', case_reference: 'CID-CASE-SANDBOX-2207', mismatch_flags: ['flagged_stolen', 'immediate_escalation'] },
    no_record: {},
  },
};

const SANDBOX_CONFIDENCE = { match: 0.85, mismatch: 0.65, high_risk: 0.9, no_record: 0.2 };

/**
 * Build the injectable `invoke` transport for a government source.
 *   - sandbox / partner_file / manual : deterministic source-specific SYNTHETIC payload,
 *     honestly tagged 'SANDBOX'; scenario chosen from the VIN (STOLEN/MISMATCH/NORECORD/…).
 *   - pilot_live / live               : LIVE STUB — returns 'unavailable' + 'credential_pending'.
 *     No real endpoint is invented; never fabricates a verdict.
 */
export function makeGovernmentInvoke(sourceKey) {
  return async function governmentInvoke(provider, req) {
    const mode = provider.activation_mode;

    // Live/pilot transport is not wired: fail closed, never fabricate.
    if (mode === 'live' || mode === 'pilot_live') {
      return {
        scenario: 'unavailable', outcome: 'unavailable', retryable: false, confidence: null,
        error_category: 'credential_pending',
        data: { tag: 'LIVE_STUB', provider: sourceKey, note: 'live transport not yet wired — credential_pending' },
      };
    }

    // Sandbox family: deterministic synthetic result exercising the §76-80 maps.
    const scenario = resolveScenario({ vin: req.vin, scenario: req.scenario });
    const outcome = SCENARIO_OUTCOME[scenario];
    if (['timeout', 'rate_limit', 'malformed', 'outage', 'unavailable'].includes(scenario)) {
      return {
        scenario, outcome, retryable: ['timeout', 'rate_limit'].includes(scenario), confidence: null,
        error_category: scenario === 'timeout' ? 'timeout' : scenario === 'rate_limit' ? 'rate_limited'
          : scenario === 'malformed' ? 'malformed_response' : 'unavailable',
        data: null,
      };
    }
    const key = scenario === 'success' ? 'match' : scenario; // mismatch/high_risk/no_record share names
    const payload = SANDBOX_PAYLOADS[sourceKey][key] || SANDBOX_PAYLOADS[sourceKey].match;
    return {
      scenario, outcome,
      retryable: false,
      confidence: SANDBOX_CONFIDENCE[key] ?? null,
      error_category: null,
      data: { tag: 'SANDBOX', provider: sourceKey, note: 'sandbox demonstration — not an official confirmation', fields: payload },
    };
  };
}

async function loadVehicle(vin) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('vin, make, model, year, plate_number, chassis_number, engine_number, temp_plate_id, owner_id, tenant_id')
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error(`vehicle lookup failed: ${error.message}`);
  return data || null;
}

function legalBasisFor(sourceKey, svrMode) {
  const name = (GOVERNMENT_FIELD_MAPS[sourceKey]?.displayName || sourceKey.toUpperCase());
  if (svrMode === 'live') return `Live ${name} confirmation via governed provider transport.`;
  if (svrMode === 'partner_file') return `${name} result from an approved partner-file import. Reviewed, not a live API confirmation.`;
  if (svrMode === 'manual_verification') return `CarUp authorized manual ${name} review. Not a live government API confirmation.`;
  if (svrMode === 'sandbox') return `SANDBOX demonstration of ${name} verification. Not a live ${sourceKey.toUpperCase()} confirmation.`;
  return `${name} source unavailable (fail-closed). Not a confirmation.`;
}

/**
 * Map a governed framework result into an honest source-verification row and persist it
 * append-only. Returns the persisted, public-safe row (raw_payload stripped).
 *
 * @param {string} sourceKey
 * @param {object} vehicle    canonical vehicle row (for tenant_id + identity cross-check)
 * @param {object} fw         result from executeProviderRequest OR a synthetic block result
 * @param {object} opts
 */
async function persistMappedResult(sourceKey, vehicle, fw, opts = {}) {
  const map = OUTCOME_MAP[fw.outcome] || OUTCOME_MAP.error;
  let result = map.result;
  let error_class = map.error_class;

  // A governance block (kill switch / uncontracted / capability off) is 'not_contracted'.
  if (fw.blocked_reason) error_class = errorClassForBlock(fw.blocked_reason);

  // Honest MODE: only a real verdict keeps the provider mode; anything unavailable is 'unavailable'.
  let svrMode;
  if (result === 'unavailable') {
    svrMode = 'unavailable';
  } else {
    svrMode = MODE_MAP[fw.mode] || 'unavailable';
    // Defensive: a non-mapped/blocked mode with a "verdict" is downgraded to unavailable.
    if (svrMode === 'unavailable') { result = 'unavailable'; error_class = error_class || 'not_contracted'; }
  }

  // Extract the raw provider fields (sandbox payload lives under data.fields).
  const rawFields = (fw.data && fw.data.fields) ? fw.data.fields : {};
  const fieldMap = GOVERNMENT_FIELD_MAPS[sourceKey];
  const mapped = (result === 'unavailable')
    ? { identity_fields: {}, mismatch_flags: [] }
    : fieldMap.mapIdentity(rawFields);

  // Normalize through the EXISTING honesty guards (mode/result consistency, confidence bounds).
  const normalized = normalizeVerificationResult(sourceKey, {
    mode: svrMode,
    result,
    confidence: result === 'unavailable' ? null : (fw.confidence ?? null),
    identity_fields: mapped.identity_fields,
    mismatch_flags: mapped.mismatch_flags,
    error_class,
    source_record_id: mapped.identity_fields.customs_ref_number
      || mapped.identity_fields.registration_number
      || mapped.identity_fields.receipt_number
      || mapped.identity_fields.certificate_serial
      || mapped.identity_fields.clearance_ref_number
      || null,
    retrieved_at: opts.now || new Date().toISOString(),
    legal_basis: legalBasisFor(sourceKey, svrMode),
    raw_payload: {
      transport_mode: fw.mode,
      framework_outcome: fw.outcome,
      correlation_id: fw.correlation_id || opts.correlationId || null,
      blocked_reason: fw.blocked_reason || null,
      scenario: fw.scenario || null,
      provider_data: fw.data || null,
    },
  });

  const row = {
    vin: vehicle.vin,
    provider: sourceKey,
    mode: normalized.mode,
    query_type: opts.queryType || 'vin',
    query_value: opts.queryValue || vehicle.vin,
    result: normalized.result,
    confidence: normalized.confidence,
    source_record_id: normalized.source_record_id,
    retrieved_at: normalized.retrieved_at,
    identity_fields: normalized.identity_fields,
    mismatch_flags: normalized.mismatch_flags,
    error_class: normalized.error_class,
    raw_payload: normalized.raw_payload,
    feature_flag: opts.featureFlag || `vehicle-trust.source.${sourceKey}`,
    legal_basis: normalized.legal_basis,
    requested_by: opts.requestedBy || null,
    tenant_id: vehicle.tenant_id || null,
  };

  const { data, error } = await supabase.from(SVR_TABLE).insert(row).select().single();
  if (error) throw new Error(`failed to persist government verification: ${error.message}`);
  const { raw_payload, ...safe } = data;
  return safe;
}

/**
 * Feed a mismatch/high_risk verdict into the EXISTING fraud/review/publication gate.
 *
 * The fraud engine (fraudEngine.evaluateAndPersist) READS source_verification_results and,
 * via its detectSourceIdentityConflict + detectCidHighRisk detectors, raises append-only
 * fraud_signals, opens/refreshes the vehicle's fraud_case, and sets blocks_publication. We
 * call it AFTER the row is persisted so the engine sees this verdict. Fail-SOFT: a fraud
 * engine error never breaks the government check (the honest verdict is already durable).
 */
async function feedFraudReview(vehicle, opts) {
  try {
    const out = await evaluateAndPersist(vehicle.vin, {
      tenantId: vehicle.tenant_id || null,
      actorId: opts.requestedBy || null,
      actorRole: opts.actorRole || null,
      reason: 'government_source_verdict',
    });
    return {
      fraud_case_id: out.case ? out.case.id : null,
      blocks_publication: !!(out.block && out.block.blocked),
      signal_codes: (out.evaluated || []).map((s) => s.signal_code),
    };
  } catch (err) {
    return { fraud_case_id: null, blocks_publication: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * Run a government registry check for a VIN through the governed provider path and persist
 * the honest result.
 *
 * @param {string} sourceKey  one of SOURCE_KEYS
 * @param {string} vin
 * @param {object} opts { requestedBy, actorRole, queryType, queryValue, idempotencyKey, correlationId, now }
 * @returns {{ source, result, review }} public-safe result + fraud-feed summary
 */
export async function runGovernmentCheck(sourceKey, vin, opts = {}) {
  if (!SOURCE_KEYS.includes(sourceKey)) throw new Error(`unknown government source: ${sourceKey}`);
  if (!vin) throw new Error('vin is required');

  const vehicle = await loadVehicle(vin);
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  const provider = await getProvider(sourceKey, GOV_CAPABILITY);
  const correlationId = opts.correlationId || crypto.randomUUID();

  let fw;
  if (!provider) {
    // Uncontracted: no registry row. Fail closed — honest 'unavailable', never fabricated.
    // (We DON'T call the framework with a null provider.) Still record the access attempt so
    // even a query to an unconfigured source is auditable.
    await recordUncontractedAttempt(sourceKey, vin, correlationId, vehicle);
    fw = { ok: false, outcome: 'unavailable', mode: 'unavailable', blocked_reason: 'not_registered', correlation_id: correlationId, data: null };
  } else {
    fw = await executeProviderRequest(provider, { vin, reference: opts.queryValue || vin }, {
      invoke: makeGovernmentInvoke(sourceKey),
      idempotencyKey: opts.idempotencyKey || null,
      correlationId,
    });
  }

  const result = await persistMappedResult(sourceKey, vehicle, fw, { ...opts, correlationId });

  let review = null;
  if (result.result === 'mismatch' || result.result === 'high_risk') {
    review = await feedFraudReview(vehicle, opts);
  }

  return { source: sourceKey, result, review };
}

/** Append-only access log for a query to an UNCONTRACTED source (no provider_registry row). */
async function recordUncontractedAttempt(sourceKey, vin, correlationId, vehicle) {
  try {
    await supabase.from('provider_request_attempts').insert({
      provider_id: null, capability_type: GOV_CAPABILITY, correlation_id: correlationId,
      idempotency_key: null, vin, request_ref: vin, mode: 'unavailable',
      outcome: 'unavailable', attempt: 1, latency_ms: null, error_category: 'not_registered',
      tenant_id: vehicle.tenant_id || null,
    });
  } catch { /* audit best-effort; never block the fail-closed path */ }
}

// ── buyer/partner projection ─────────────────────────────────────────────────────
/**
 * Project a persisted result row for an audience.
 *   - 'admin' | 'government' : full privileged view (identity_fields as stored).
 *   - 'buyer' | 'partner'    : coverage-safe — status + honesty mode + ONLY the source's
 *     buyer-safe fields. References, serials, ownership identity, per-identifier
 *     verification booleans and raw payloads are stripped.
 */
export function projectResultForAudience(row, audience = 'buyer') {
  if (!row) return row;
  if (audience === 'admin' || audience === 'government') {
    const { raw_payload, ...rest } = row;
    return rest;
  }
  const map = GOVERNMENT_FIELD_MAPS[row.provider];
  const allow = new Set(map ? map.buyerSafe : []);
  const idf = row.identity_fields || {};
  const safeIdentity = {};
  for (const k of Object.keys(idf)) if (allow.has(k)) safeIdentity[k] = idf[k];
  return {
    vin: row.vin,
    provider: row.provider,
    mode: row.mode,
    result: row.result,
    coverage_status: coverageStatus(row.result, row.mode),
    retrieved_at: row.retrieved_at || null,
    identity_fields: safeIdentity,
  };
}

// Mirror of source_verification_coverage_public status labels (buyer-facing honesty).
function coverageStatus(result, mode) {
  if (result === 'match' && mode === 'live') return 'source_connected';
  if (result === 'match' && mode === 'sandbox') return 'sandbox_demonstration';
  if (result === 'match' && mode === 'partner_file') return 'partner_file_reviewed';
  if (result === 'manual_review' || mode === 'manual_verification') return 'carup_manual_reviewed';
  if (result === 'mismatch') return 'conflict_under_review';
  if (result === 'high_risk') return 'risk_flagged';
  if (result === 'no_record') return 'no_record_found';
  if (result === 'unavailable') return 'source_unavailable';
  return 'pending';
}

// ── operator surfaces (health / imports / errors / suspension) ───────────────────

/** Record a secure batch/file import (Storage PATH reference ONLY — never contents). */
export async function recordBatchImport({ sourceKey, fileRef, checksum, rowCount, status, detail }, actor = {}) {
  if (!SOURCE_KEYS.includes(sourceKey)) throw new Error(`unknown government source: ${sourceKey}`);
  if (!fileRef) throw new Error('file_ref (Storage path) is required');
  if (/^https?:\/\//i.test(fileRef)) throw new Error('file_ref must be a Storage path, not a URL/contents');
  const provider = await getProvider(sourceKey, GOV_CAPABILITY);
  if (!provider) throw new Error(`government source not registered: ${sourceKey}`);
  const st = status || 'pending';
  if (!['pending', 'processing', 'imported', 'rejected'].includes(st)) throw new Error(`invalid status: ${st}`);
  const { data, error } = await supabase.from('government_source_batch_imports').insert({
    provider_id: provider.id, source_key: sourceKey, file_ref: fileRef,
    checksum: checksum || null, row_count: rowCount ?? null, status: st, detail: detail || null,
    imported_by: actor.id || null, tenant_id: provider.tenant_id || null,
  }).select().single();
  if (error) throw new Error(`failed to record batch import: ${error.message}`);
  return data;
}

/** List batch import events (admin/government), newest first. */
export async function listBatchImports({ sourceKey } = {}) {
  let q = supabase.from('government_source_batch_imports').select('*');
  if (sourceKey) q = q.eq('source_key', sourceKey);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(`failed to list batch imports: ${error.message}`);
  return data || [];
}

/** Health snapshot of the five government providers (registry state, no secrets). */
export async function getGovernmentHealth() {
  const { data, error } = await supabase.from('provider_registry').select('*').eq('capability_type', GOV_CAPABILITY);
  if (error) throw new Error(`failed to load government provider health: ${error.message}`);
  return (data || []).map((p) => ({
    source_key: p.provider_key,
    display_name: p.display_name,
    activation_mode: p.activation_mode,
    transport: p.transport,
    health_state: p.health_state,
    incident_state: p.incident_state,
    kill_switch_enabled: p.kill_switch_enabled,
    contract_status: p.contract_status,
    callable: !p.kill_switch_enabled && ['sandbox', 'partner_file', 'manual', 'pilot_live', 'live'].includes(p.activation_mode),
  }));
}

/** Recent non-clean attempts (errors/unavailable) across government providers. */
export async function listGovernmentErrors({ limit = 50 } = {}) {
  const { data, error } = await supabase.from('provider_request_attempts')
    .select('*').eq('capability_type', GOV_CAPABILITY).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`failed to load government errors: ${error.message}`);
  const bad = new Set(['unavailable', 'timeout', 'rate_limited', 'malformed', 'invalid_signature', 'circuit_open', 'error']);
  return (data || []).filter((a) => bad.has(a.outcome));
}

/** Suspend a source (kill switch on). Non-destructive; recorded in activation history. */
export async function suspendSource(sourceKey, { reason, actor } = {}) {
  const provider = await requireProvider(sourceKey);
  return setKillSwitch(provider.id, true, { reason: reason || 'operator suspend', actor });
}

/** Emergency disable: kill switch on AND mode -> 'suspended' (blocks even a mode flip back). */
export async function emergencyDisableSource(sourceKey, { reason, actor } = {}) {
  const provider = await requireProvider(sourceKey);
  await setKillSwitch(provider.id, true, { reason: reason || 'emergency disable', actor });
  return setActivationMode(provider.id, 'suspended', { reason: reason || 'emergency disable', actor });
}

async function requireProvider(sourceKey) {
  if (!SOURCE_KEYS.includes(sourceKey)) throw new Error(`unknown government source: ${sourceKey}`);
  const provider = await getProvider(sourceKey, GOV_CAPABILITY);
  if (!provider) throw new Error(`government source not registered: ${sourceKey}`);
  return provider;
}

export default {
  GOV_CAPABILITY,
  SOURCE_KEYS,
  GOVERNMENT_FIELD_MAPS,
  makeGovernmentInvoke,
  runGovernmentCheck,
  projectResultForAudience,
  recordBatchImport,
  listBatchImports,
  getGovernmentHealth,
  listGovernmentErrors,
  suspendSource,
  emergencyDisableSource,
};
