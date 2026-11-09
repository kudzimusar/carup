/**
 * Resolve — and REFUSE — a governed exact-head preview pair for a deployed staging gate.
 *
 * This exists because the `Diaspora Deployed Staging UAT` gate had been pinned for months to
 * `github.head_ref == 'claude/diaspora-phases-8-10-production-program'` with hardcoded URLs
 * belonging to a *different* Vercel project. It could not run on any current branch, so it reported
 * `skipped` on every PR — a green tick for a gate that had certified nothing since that branch died.
 *
 * Replacing one hardcoded branch with another would reproduce the defect on a slower clock. So the
 * pair is resolved from the governed manifests the rest of Trade OS already uses, and every way the
 * resolution can be wrong is a NAMED refusal rather than a silent fallback.
 *
 * The logic lives here, not in YAML, because a refusal nobody can test is not a gate.
 * `backend/tests/ci-governed-preview-pair.test.js` breaks each rule and asserts the refusal.
 */

export const REFUSALS = Object.freeze({
  NO_BRANCH: 'No candidate branch was supplied, so there is nothing to resolve a pair for.',
  NO_SHA: 'No candidate SHA was supplied, so no deployment could be proved to be the candidate.',
  UNGOVERNED_BRANCH: 'This branch has no governed preview pair. Add it to web/preview-frontend-pairing.json and web/preview-backend-pairing.json rather than hardcoding a URL in the workflow.',
  PRODUCTION_ORIGIN: 'A resolved origin points at production. A staging gate must never certify against production.',
  FRONTEND_UNREACHABLE: 'The frontend deployment did not serve carup-provenance.json.',
  BACKEND_UNREACHABLE: 'The backend deployment did not serve a healthy /api/health.',
  FRONTEND_STALE: 'The frontend is serving a different commit from the candidate.',
  BACKEND_STALE: 'The backend is serving a different commit from the candidate.',
  UNPAIRED: 'The frontend reports unpaired:true — it is not talking to this branch\'s backend, so anything it certifies is another candidate\'s contract.',
  PAIR_MISMATCH: 'The frontend is talking to a backend other than the one this branch is paired to.',
  WRONG_STAGING_PROJECT: 'The staging database URL is not the approved staging project.',
  BACKEND_DATABASE_UNHEALTHY: 'The backend is serving the candidate but reports its database is unhealthy. Provenance and liveness are different questions: proving the deployment is the right CODE says nothing about whether its DEPENDENCIES answer.',
});

/**
 * Anything that is not a per-branch preview of the staging projects.
 *
 * Deliberately a deny-list of production shapes rather than an allow-list of one hostname: a gate
 * that only knows the host it was written with is the gate this replaces.
 */
const PRODUCTION_MARKERS = [
  'carup.co.zw',
  'www.carup',
  'carup-production',
  'carup-prod',
];

function looksLikeProduction(url) {
  const host = String(url || '').toLowerCase();
  if (!host) return false;
  if (PRODUCTION_MARKERS.some((m) => host.includes(m))) return true;
  // A bare project alias with no branch segment is the stable deployment, not a branch preview.
  // `carup-staging.vercel.app` serves whatever was last promoted; certifying against it proves
  // nothing about this candidate.
  return /^https:\/\/carup(-backend)?-staging\.vercel\.app\/?$/.test(host);
}

const strip = (u) => String(u || '').replace(/\/$/, '');

/**
 * @param {object} input
 * @param {string} input.branch            the candidate branch (VERCEL_GIT_COMMIT_REF shape)
 * @param {string} input.sha               the exact candidate head SHA
 * @param {object} input.frontendPairs     web/preview-frontend-pairing.json → branches
 * @param {object} input.backendPairs      web/preview-backend-pairing.json  → branches
 * @param {string} [input.stagingDbUrl]    the staging operator DB URL, if the gate needs one
 * @param {string} [input.expectedProjectRef]
 * @returns {{ok: true, frontend: string, backend: string} | {ok: false, refusal: string, reason: string}}
 */
export function resolvePair({ branch, sha, frontendPairs = {}, backendPairs = {}, stagingDbUrl, expectedProjectRef }) {
  const refuse = (refusal, extra = {}) => ({ ok: false, refusal, reason: REFUSALS[refusal], branch, ...extra });

  if (!branch) return refuse('NO_BRANCH');
  if (!sha) return refuse('NO_SHA');

  const frontend = strip(frontendPairs[branch]);
  const backend = strip(backendPairs[branch]);
  if (!frontend || !backend) {
    return refuse('UNGOVERNED_BRANCH', { frontend_configured: Boolean(frontend), backend_configured: Boolean(backend) });
  }
  if (looksLikeProduction(frontend) || looksLikeProduction(backend)) {
    return refuse('PRODUCTION_ORIGIN', { frontend, backend });
  }
  // Only checked when the gate actually needs the database. A gate that does not touch it should not
  // be blocked on a secret it never uses.
  if (expectedProjectRef && stagingDbUrl !== undefined) {
    if (!String(stagingDbUrl).includes(expectedProjectRef)) return refuse('WRONG_STAGING_PROJECT');
  }
  return { ok: true, branch, sha, frontend, backend };
}

/**
 * Given what the two deployments actually SAID, decide whether they are this candidate.
 *
 * Separated from `resolvePair` because these are different failures: one is a governance error a
 * human fixes in a manifest, the other is a deployment that has not caught up — or a stale one
 * quietly serving an older commit, which is the failure that makes a green gate a lie.
 */
export function verifyProvenance({ sha, frontend, backend, provenance, health }) {
  const refuse = (refusal, extra = {}) => ({ ok: false, refusal, reason: REFUSALS[refusal], ...extra });

  if (!provenance) return refuse('FRONTEND_UNREACHABLE');
  if (!health) return refuse('BACKEND_UNREACHABLE');
  if (health.status && health.status !== 'UP') return refuse('BACKEND_UNREACHABLE', { status: health.status });

  // `/api/health` returns `status: 'UP'` whenever the PROCESS is up — it reports the database
  // separately, and this check used to ignore that field. On 2026-09-08 the paired backend answered
  // exactly `{status: 'UP', supabase: {status: 'unhealthy'}}` for hours while PostgREST could not
  // start, and the gate would have admitted it and handed a dead database to every spec. The failure
  // then presents as a wall of uniform ~30s `waitForResponse` timeouts, which reads like a broad
  // product regression and is not one.
  const databaseStatus = health.supabase?.status;
  if (databaseStatus && databaseStatus !== 'healthy') {
    return refuse('BACKEND_DATABASE_UNHEALTHY', { database_status: databaseStatus });
  }

  if (provenance.unpaired !== false) return refuse('UNPAIRED', { unpaired: provenance.unpaired });
  if (provenance.commit_sha !== sha) return refuse('FRONTEND_STALE', { serving: provenance.commit_sha || null, expected: sha });

  const backendSha = health.build?.commit_sha;
  if (backendSha !== sha) return refuse('BACKEND_STALE', { serving: backendSha || null, expected: sha });

  // The frontend must be talking to the backend this branch is PAIRED to — not merely to a backend
  // that happens to be serving the right commit. Both can be true of another branch's deployment.
  if (strip(provenance.api_base_url) !== strip(backend)) {
    return refuse('PAIR_MISMATCH', { frontend_calls: provenance.api_base_url || null, paired_to: backend });
  }

  return { ok: true, frontend, backend, sha, deployment_id: health.build?.deployment_id || null };
}

// ── CLI ────────────────────────────────────────────────────────────────────
// Writes STAGING_WEB_URL / STAGING_API_URL to $GITHUB_ENV on success; exits non-zero with a named
// refusal otherwise. Used by .github/workflows/diaspora-deployed-staging-uat.yml.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { readFileSync, appendFileSync } = await import('node:fs');
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')).branches || {}; } catch { return {}; } };

  const resolved = resolvePair({
    branch: process.env.CANDIDATE_BRANCH,
    sha: process.env.EXPECTED_HEAD_SHA,
    frontendPairs: read('web/preview-frontend-pairing.json'),
    backendPairs: read('web/preview-backend-pairing.json'),
    stagingDbUrl: process.env.DIASPORA_STAGING_DATABASE_URL,
    expectedProjectRef: process.env.EXPECTED_STAGING_PROJECT_REF,
  });
  if (!resolved.ok) {
    console.error(`::error::${resolved.refusal} — ${resolved.reason}`);
    console.error(JSON.stringify(resolved, null, 2));
    process.exit(1);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = null;
  for (let attempt = 1; attempt <= 72; attempt += 1) {
    let provenance = null; let health = null;
    try {
      const [p, h] = await Promise.all([
        fetch(`${resolved.frontend}/carup-provenance.json?attempt=${attempt}`, { cache: 'no-store' }),
        fetch(`${resolved.backend}/api/health?attempt=${attempt}`, { cache: 'no-store' }),
      ]);
      provenance = p.ok ? await p.json() : null;
      health = h.ok ? await h.json() : null;
    } catch (error) {
      console.log(`attempt ${attempt}: ${error.message}`);
    }
    last = verifyProvenance({ sha: resolved.sha, frontend: resolved.frontend, backend: resolved.backend, provenance, health });
    if (last.ok) {
      appendFileSync(process.env.GITHUB_ENV, `STAGING_WEB_URL=${resolved.frontend}\nSTAGING_API_URL=${resolved.backend}/api\n`);
      // Every shard writes what it certified against. The aggregate compares them, so three green
      // shards that ran against three different candidates cannot add up to a pass.
      const record = {
        branch: resolved.branch,
        sha: resolved.sha,
        frontend: resolved.frontend,
        backend: resolved.backend,
        api_base_url: provenance.api_base_url,
        unpaired: provenance.unpaired,
        deployment_id: last.deployment_id,
        staging_project_ref: process.env.EXPECTED_STAGING_PROJECT_REF || null,
        project: process.env.PLAYWRIGHT_PROJECT || null,
      };
      const out = process.env.PAIRING_RECORD_PATH;
      if (out) { const { writeFileSync } = await import('node:fs'); writeFileSync(out, JSON.stringify(record, null, 2)); }
      console.log(JSON.stringify(last));
      process.exit(0);
    }
    console.log(`attempt ${attempt}: ${last.refusal} ${JSON.stringify({ ...last, reason: undefined })}`);
    await sleep(5000);
  }
  console.error(`::error::${last?.refusal || 'FRONTEND_UNREACHABLE'} — the candidate pair never reported ${resolved.sha}.`);
  console.error(JSON.stringify(last, null, 2));
  process.exit(1);
}
