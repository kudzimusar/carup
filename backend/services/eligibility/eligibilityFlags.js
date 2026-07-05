/**
 * Fail-closed enablement for eligibility capabilities — Workstream 12.
 *
 * Sandbox eligibility providers are enabled OUTSIDE production (staging + tests). In
 * production each capability is disabled (-> 'unavailable') unless ELIGIBILITY_LIVE=1 AND a
 * real provider is wired — so production never silently calls a sandbox provider.
 * Per-capability override: ELIGIBILITY_<CAP>_ENABLED = '1' | '0'.
 */
export function buildEligibilityFlags(env = process.env) {
  const isProduction = env.NODE_ENV === 'production' || env.CARUP_ENV === 'production';
  const liveAllowed = env.ELIGIBILITY_LIVE === '1';
  const gate = (cap) => () => {
    const explicit = env[`ELIGIBILITY_${cap.toUpperCase()}_ENABLED`];
    if (explicit === '1') return true;
    if (explicit === '0') return false;
    return isProduction ? liveAllowed : true;
  };
  return { insurance: gate('insurance'), finance: gate('finance') };
}

export default { buildEligibilityFlags };
