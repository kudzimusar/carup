#!/usr/bin/env node
/**
 * Issue #164 Phase 8 — UAT provenance receipt (Cluster I).
 *
 * Produces the receipt that must precede any physical UAT run, proving the frontend preview under test
 * and the backend it actually calls are the SAME candidate commit.
 *
 * This exists because the first complete 32-step Phase 8 physical UAT was invalidated after the fact:
 * the PR #165 preview frontend had been resolving its API base to `carup-backend-staging.vercel.app`,
 * which serves `main`. Eighteen steps failed; four of them for a contract defect the candidate had
 * already fixed. Nothing in CI could have caught it, because CI never exercises the deployed pairing.
 *
 * The check is performed the way the browser performs it: by reading the DEPLOYED bundle and
 * extracting the API base it compiled, rather than trusting the repository's source.
 *
 * Usage:
 *   node scripts/issue164-uat-provenance-receipt.mjs \
 *     --frontend=https://carup-staging-git-<branch>-<team>.vercel.app \
 *     [--expected-sha=<full sha>]
 *
 * Exit code 0 only when the pairing is valid for UAT.
 */

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=')
      return i === -1 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)]
    }),
)

const frontend = (args.frontend || '').replace(/\/+$/, '')
if (!frontend) {
  console.error('usage: --frontend=<frontend preview URL> [--expected-sha=<sha>]')
  process.exit(2)
}

/** The stable staging backend. A branch preview reaching this is the exact fault being guarded. */
const STABLE_STAGING_BACKEND = 'carup-backend-staging.vercel.app'

const fail = (msg) => { console.error(`\n  BLOCKED: ${msg}\n`); process.exit(1) }

async function main() {
  // 1. The deployed HTML, and the bundle it loads.
  const indexRes = await fetch(frontend, { headers: { Accept: 'text/html' } })
  if (!indexRes.ok) fail(`frontend ${frontend} returned HTTP ${indexRes.status}`)
  const html = await indexRes.text()
  const asset = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0]
  if (!asset) fail(`could not find the JS bundle in ${frontend} — is this a built SPA?`)

  const bundleRes = await fetch(`${frontend}${asset}`)
  if (!bundleRes.ok) fail(`bundle ${asset} returned HTTP ${bundleRes.status}`)
  const bundle = await bundleRes.text()

  // 2. What the BROWSER will use — read out of the shipped bundle, not the repo.
  //    `vite.config.ts` bakes VITE_API_URL and VITE_COMMIT_SHA in at build time, so both appear as
  //    string literals. The API base is recovered by looking for the backend origins the bundle can
  //    reach; the build SHA by its 40-hex shape.
  const apiHosts = [...new Set(
    (bundle.match(/https:\/\/[A-Za-z0-9.-]*(?:carup|backend)[A-Za-z0-9.-]*\.(?:vercel\.app|dev|invalid)/g) || []),
  )]
  const frontendSha = (bundle.match(/\b[0-9a-f]{40}\b/g) || [])[0] || null

  const callsStableStaging = apiHosts.some((h) => h.includes(STABLE_STAGING_BACKEND))
  const pairedBackend = apiHosts.find((h) => h.includes('carup-backend-staging-git'))
    || (callsStableStaging ? `https://${STABLE_STAGING_BACKEND}` : null)

  if (!pairedBackend) fail(`could not determine the backend this bundle calls. Hosts found: ${apiHosts.join(', ') || 'none'}`)

  // 3. The backend's own provenance.
  const healthRes = await fetch(`${pairedBackend}/api/health`, { headers: { Accept: 'application/json' } })
  if (!healthRes.ok) fail(`${pairedBackend}/api/health returned HTTP ${healthRes.status}`)
  const health = await healthRes.json()
  const backendSha = health?.build?.commit_sha || null

  const equal = !!frontendSha && !!backendSha && frontendSha === backendSha
  const expectedOk = !args['expected-sha'] || args['expected-sha'] === backendSha

  // 4. The receipt.
  const line = (k, v) => console.log(`  ${k.padEnd(34)} ${v}`)
  console.log('\nISSUE #164 PHASE 8 — UAT PROVENANCE RECEIPT')
  console.log('='.repeat(78))
  line('frontend preview URL', frontend)
  line('backend preview URL', pairedBackend)
  line('API base compiled into the bundle', pairedBackend)
  line('frontend candidate SHA', frontendSha || 'NOT PRESENT IN BUNDLE')
  line('backend /api/health SHA', backendSha || 'NOT REPORTED')
  line('backend branch', health?.build?.branch ?? 'unknown')
  line('SHA equality', equal ? 'EQUAL' : 'NOT EQUAL')
  line(`calls stable ${STABLE_STAGING_BACKEND}`, callsStableStaging ? 'YES — INVALID' : 'no')
  if (args['expected-sha']) line('matches --expected-sha', expectedOk ? 'yes' : 'NO')
  console.log('='.repeat(78))

  if (callsStableStaging) {
    fail('the branch preview calls the STABLE staging backend. This is the fault that invalidated the '
      + 'first Phase 8 physical UAT. Pair the branch in web/preview-backend-pairing.json and redeploy.')
  }
  if (!frontendSha) fail('the bundle carries no build SHA, so the pairing cannot be proved.')
  if (!equal) fail(`frontend ${frontendSha.slice(0, 8)} != backend ${String(backendSha).slice(0, 8)}. `
    + 'Redeploy so both serve the same candidate before running UAT.')
  if (!expectedOk) fail(`pairing is self-consistent at ${backendSha.slice(0, 8)} but --expected-sha was ${args['expected-sha'].slice(0, 8)}.`)

  console.log(`\n  VALID FOR UAT — both surfaces serve ${frontendSha.slice(0, 8)}.\n`)
}

main().catch((err) => { console.error(err); process.exit(1) })
