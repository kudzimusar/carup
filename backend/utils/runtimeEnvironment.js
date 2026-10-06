/**
 * Canonical runtime classification for safety gates.
 *
 * NODE_ENV is a build/runtime implementation detail and has previously been mis-set on deployed
 * staging. No mock, sandbox, fixture or volatile credential store may become reachable merely
 * because NODE_ENV says "test" or "development" inside a real deployment.
 */
const DEPLOYED_CARUP_ENVS = new Set(['staging', 'production']);
const DEPLOYED_VERCEL_ENVS = new Set(['preview', 'production']);

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isDeployedRuntime(env = process.env) {
  return DEPLOYED_CARUP_ENVS.has(normalized(env?.CARUP_ENV))
    || DEPLOYED_VERCEL_ENVS.has(normalized(env?.VERCEL_ENV));
}

export function isProductionLikeRuntime(env = process.env) {
  return isDeployedRuntime(env) || normalized(env?.NODE_ENV) === 'production';
}

export function isFixtureRuntime(env = process.env) {
  return normalized(env?.NODE_ENV) === 'test' && !isDeployedRuntime(env);
}

export default { isDeployedRuntime, isProductionLikeRuntime, isFixtureRuntime };
