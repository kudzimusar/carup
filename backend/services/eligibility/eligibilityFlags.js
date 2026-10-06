/**
 * Fail-closed enablement for eligibility capabilities — Workstream 12.
 *
 * The currently shipped finance/insurance eligibility adapters are simulations. They are available
 * only to local development/tests. Staging, preview and production expose the capability as
 * unavailable until a separately implemented real provider boundary exists.
 */
import { isDeployedRuntime } from '../../utils/runtimeEnvironment.js';

export function buildEligibilityFlags(env = process.env) {
  const deployed = isDeployedRuntime(env);
  const gate = (cap) => () => {
    if (deployed) return false;
    const explicit = env[`ELIGIBILITY_${cap.toUpperCase()}_ENABLED`];
    if (explicit === '1') return true;
    if (explicit === '0') return false;
    return true;
  };
  return { insurance: gate('insurance'), finance: gate('finance') };
}

export default { buildEligibilityFlags };
