/**
 * Build provenance — which source revision a running instance was built from.
 *
 * Exists because this programme physically proved that CarUp's staging environment serves TWO
 * operational runtimes that can silently diverge:
 *
 *   api-staging.carup.dev             — webhooks and API
 *   carup-backend-staging.vercel.app  — the cron worker's target, i.e. what actually SENDS Email
 *
 * They drifted, and the result was a real production-shape defect: the API runtime had the marketing
 * unsubscribe control while the runtime that actually sent marketing Email did not, so a governed
 * marketing message reached a human inbox with no way to unsubscribe. Nothing detected it — the
 * defect was found by a person reading the delivered Email.
 *
 * Certification is only meaningful when the runtime under test is the runtime that acts. Reporting
 * the revision makes that checkable instead of assumed.
 */

/** Vercel injects these; they are present at runtime on every deployment. */
export function resolveBuildProvenance(env = process.env) {
  const commitSha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || env.CARUP_BUILD_SHA || null;
  return {
    commit_sha: commitSha,
    commit_sha_short: commitSha ? String(commitSha).slice(0, 8) : null,
    branch: env.VERCEL_GIT_COMMIT_REF || env.GITHUB_REF_NAME || null,
    deployment_id: env.VERCEL_DEPLOYMENT_ID || null,
    environment: env.VERCEL_ENV || env.NODE_ENV || null,
    // A runtime that cannot state its own revision cannot be certified against one. Reported
    // explicitly rather than left as a null that reads like "same as everything else".
    provenance_available: Boolean(commitSha),
  };
}

/**
 * Compare the provenance of several runtimes that MUST be running the same revision.
 *
 * Fails closed: unknown provenance is a failure, not a pass. A runtime that cannot say what it is
 * running is exactly the situation this guard exists to catch, so treating it as agreement would
 * defeat the purpose.
 *
 * @param {Array<{name: string, provenance: object|null, error?: string}>} runtimes
 * @param {string|null} expectedSha optional revision all runtimes must match
 */
export function assertRuntimeRevisionParity(runtimes = [], expectedSha = null) {
  const problems = [];
  const observed = [];

  for (const runtime of runtimes) {
    if (runtime.error || !runtime.provenance) {
      problems.push(`${runtime.name}: unreachable or no provenance (${runtime.error || 'no data'})`);
      continue;
    }
    const sha = runtime.provenance.commit_sha || null;
    if (!sha) {
      problems.push(`${runtime.name}: reports no commit sha, so its revision cannot be verified`);
      continue;
    }
    observed.push({ name: runtime.name, sha });
  }

  const distinct = [...new Set(observed.map((o) => o.sha))];
  if (distinct.length > 1) {
    problems.push(
      `runtimes disagree on revision: ${observed.map((o) => `${o.name}=${o.sha.slice(0, 8)}`).join(', ')}`,
    );
  }
  if (expectedSha) {
    for (const o of observed) {
      if (o.sha !== expectedSha) {
        problems.push(`${o.name} is on ${o.sha.slice(0, 8)}, expected ${String(expectedSha).slice(0, 8)}`);
      }
    }
  }

  return {
    pass: problems.length === 0 && observed.length === runtimes.length && runtimes.length > 0,
    problems,
    observed,
    revision: distinct.length === 1 ? distinct[0] : null,
  };
}
