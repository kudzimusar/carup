import { isProductionLikeRuntime } from '../../utils/runtimeEnvironment.js';

/**
 * Fail-closed enablement gates for the registry source adapters — Workstream 12.
 *
 * Production safety rule: sandbox/demonstration adapters must NOT run in production
 * unless explicitly authorized. Each provider is enabled by default OUTSIDE production
 * (staging + tests). In production every provider is disabled (-> 'unavailable') unless
 * SOURCE_VERIFICATION_LIVE=1 AND a real live adapter is wired. This prevents production
 * from ever silently calling a sandbox provider and presenting it as real.
 *
 * Per-provider override: SOURCE_<PROVIDER>_ENABLED = '1' | '0'.
 */
export function buildFlagGates(env = process.env) {
  const deployed = isProductionLikeRuntime(env);

  const gateFor = (provider) => () => {
    // Every adapter registered today is sandbox/demonstration-only. No flag can turn one into
    // registry truth in staging/preview/production. A future live adapter needs its own selector.
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
