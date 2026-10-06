/**
 * Deployment-runtime classification used by every "test/demo/sandbox/mock" gate.
 *
 * NODE_ENV alone is not a deployment boundary: Vercel previews and CarUp staging have
 * previously run with NODE_ENV values other than "production". A deployed runtime is any
 * production/preview Vercel target or any CarUp staging/production environment.
 *
 * Tests and explicit local development remain outside this boundary.
 */
export function isDeployedRuntime(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const vercelEnv = String(env.VERCEL_ENV || '').trim().toLowerCase();
  const carupEnv = String(env.CARUP_ENV || '').trim().toLowerCase();

  return nodeEnv === 'production'
    || vercelEnv === 'production'
    || vercelEnv === 'preview'
    || carupEnv === 'production'
    || carupEnv === 'staging';
}

export function assertNotDeployedRuntime(feature, env = process.env) {
  if (isDeployedRuntime(env)) {
    throw new Error(`${feature} is test/local-only and is refused in a deployed CarUp runtime`);
  }
}
