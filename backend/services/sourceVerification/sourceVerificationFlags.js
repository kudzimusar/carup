import { isDeployedRuntime } from '../../utils/runtimeEnvironment.js';

/**
 * Fail-closed enablement gates for the registry source adapters — Workstream 12.
 *
 * Deployment safety rule: sandbox/demonstration adapters must NOT run in any deployed runtime
 * (production, staging, or preview). They are local/test-only until a separately implemented
 * live adapter exists. SOURCE_VERIFICATION_LIVE is therefore not an override for these adapters.
 *
 * Per-provider override: SOURCE_<PROVIDER>_ENABLED = '1' | '0'.
 */
export function buildFlagGates(env = process.env) {
  const deployed = isDeployedRuntime(env);

  const gateFor = (provider) => () => {
    // The currently registered registry adapters are sandbox simulations. Until a real
    // adapter exists behind a separate live boundary, no deployed CarUp runtime may enable
    // them — not even through SOURCE_VERIFICATION_LIVE or a per-provider override.
    if (deployed) return false;
    const explicit = env[`SOURCE_${provider.toUpperCase()}_ENABLED`];
    if (explicit === '1') return true;
    if (explicit === '0') return false;
    return true;
  };

  return {
    zimra: gateFor('zimra'),
    cvr: gateFor('cvr'),
    zinara: gateFor('zinara'),
    vid: gateFor('vid'),
    cid: gateFor('cid'),
  };
}

export default { buildFlagGates };
