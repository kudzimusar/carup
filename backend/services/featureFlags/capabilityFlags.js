/**
 * Centralized capability feature flags — Workstream 12.
 *
 * Governs every new Vehicle Trust capability with fail-closed production defaults so
 * sandbox providers and new transaction surfaces never activate in production by accident.
 *
 * Resolution order per flag:
 *   1. Emergency kill switch: CAPABILITY_KILL_SWITCH=1 forces ALL flags OFF.
 *   2. Per-flag explicit override: FLAG_<NAME>=1|0 (e.g. FLAG_FRAUD_ENGINE=1).
 *   3. Default: enabled OUTSIDE production; in production OFF unless CAPABILITIES_LIVE=1.
 *
 * The set mirrors the directive's required flags: source adapters (zimra/cvr/zinara/vid/
 * cid), fraud engine, dealer compliance, mobile offline uploads, insurance, finance,
 * escrow, and the extended partner API.
 */
export const CAPABILITY_FLAGS = [
  'zimra_adapter', 'cvr_adapter', 'zinara_adapter', 'vid_adapter', 'cid_adapter',
  'fraud_engine', 'dealer_compliance', 'mobile_offline_uploads',
  'insurance_eligibility', 'finance_eligibility', 'escrow', 'partner_api',
];

export function isCapabilityEnabled(flag, env = process.env) {
  if (env.CAPABILITY_KILL_SWITCH === '1') return false; // emergency: everything off
  const explicit = env[`FLAG_${flag.toUpperCase()}`];
  if (explicit === '1') return true;
  if (explicit === '0') return false;
  const isProduction = env.NODE_ENV === 'production' || env.CARUP_ENV === 'production';
  return isProduction ? env.CAPABILITIES_LIVE === '1' : true; // fail-closed in production
}

/** Snapshot of all capability flags for an admin/governance view. */
export function capabilitySnapshot(env = process.env) {
  return CAPABILITY_FLAGS.reduce((acc, f) => { acc[f] = isCapabilityEnabled(f, env); return acc; }, {});
}

export default { CAPABILITY_FLAGS, isCapabilityEnabled, capabilitySnapshot };
