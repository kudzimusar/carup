/**
 * Sandbox adapter factory — Workstream 2.
 *
 * Builds a registry verification adapter that satisfies verificationContract from
 * provider-compatible synthetic fixtures. Every adapter built here reports
 * mode='sandbox' (unless explicitly degraded to 'unavailable'), so results are always
 * honestly labelled and can never masquerade as live government confirmations.
 *
 * Scenario selection is DETERMINISTIC from the queried VIN so staging/UAT and automated
 * tests can drive each path on demand:
 *   VIN contains "UNAVAIL"  -> mode 'unavailable', result 'unavailable'
 *   VIN contains "NORECORD" -> result 'no_record'
 *   VIN contains "STOLEN" or "RISK" -> result 'high_risk'
 *   VIN contains "MISMATCH" -> result 'mismatch'
 *   otherwise               -> result 'match' (clean)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = JSON.parse(
  readFileSync(join(HERE, '..', 'fixtures', 'registryScenarios.json'), 'utf-8')
);

function resolveScenarioKey(vin) {
  const v = String(vin || '').toUpperCase();
  if (v.includes('UNAVAIL')) return 'unavailable';
  if (v.includes('NORECORD')) return 'no_record';
  if (v.includes('STOLEN') || v.includes('RISK')) return 'high_risk';
  if (v.includes('MISMATCH')) return 'mismatch';
  return 'match';
}

/**
 * @param {object} cfg
 * @param {string} cfg.provider       one of PROVIDERS
 * @param {string} cfg.displayName    human label
 * @param {string[]} cfg.supportedQueryTypes
 * @param {string} cfg.legalBasis     honest description of the basis for this data
 * @param {() => boolean} [cfg.isEnabled]  flag gate; when false -> unavailable/not_contracted
 */
export function buildSandboxAdapter(cfg) {
  const fixtures = SCENARIOS[cfg.provider] || {};
  return {
    provider: cfg.provider,
    displayName: cfg.displayName,
    supportedQueryTypes: cfg.supportedQueryTypes,
    legalBasis: cfg.legalBasis,

    // Current operating mode. A disabled adapter degrades to 'unavailable' (fail-closed).
    getMode() {
      if (cfg.isEnabled && cfg.isEnabled() === false) return 'unavailable';
      return 'sandbox';
    },

    async verify(query) {
      const vin = query?.vin || query?.value || '';

      // Fail-closed: a disabled / not-contracted source reports UNAVAILABLE, never match.
      if (cfg.isEnabled && cfg.isEnabled() === false) {
        return {
          mode: 'unavailable',
          result: 'unavailable',
          confidence: null,
          error_class: 'not_contracted',
          identity_fields: {},
          mismatch_flags: [],
          legal_basis: cfg.legalBasis,
          raw_payload: { note: 'adapter disabled by feature flag', provider: cfg.provider },
        };
      }

      const key = resolveScenarioKey(vin);

      if (key === 'unavailable') {
        return {
          mode: 'unavailable',
          result: 'unavailable',
          confidence: null,
          error_class: 'timeout',
          identity_fields: {},
          mismatch_flags: [],
          legal_basis: cfg.legalBasis,
          raw_payload: { note: 'sandbox unavailable scenario', provider: cfg.provider },
        };
      }

      const scenario = fixtures[key] || fixtures.match;
      return {
        mode: 'sandbox',
        result: scenario.result,
        confidence: scenario.confidence,
        source_record_id:
          scenario.identity_fields?.customs_ref_number ||
          scenario.identity_fields?.registration_number ||
          scenario.identity_fields?.certificate_serial ||
          scenario.identity_fields?.clearance_ref_number ||
          scenario.identity_fields?.receipt_number ||
          `${cfg.provider.toUpperCase()}-SANDBOX-${key}`,
        retrieved_at: query?.now || null,
        identity_fields: scenario.identity_fields || {},
        mismatch_flags: scenario.mismatch_flags || [],
        error_class: null,
        legal_basis: cfg.legalBasis,
        // Raw payload retained for audit; privileged-read only (never reaches buyers).
        raw_payload: { scenario: key, provider: cfg.provider, fixture: scenario },
      };
    },
  };
}

export default { buildSandboxAdapter };
