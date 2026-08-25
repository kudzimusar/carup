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
 * The check reads the DEPLOYED build's own manifest (`/carup-provenance.json`, emitted by
 * web/vite.config.ts) rather than trusting the repository's source, so it describes the artifact a
 * tester will actually open.
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
  // 1. What the build says it is paired to.
  //
  //    This comes from the build's own manifest, NOT from scanning the bundle. Vite inlines
  //    `import.meta.env.VITE_API_URL` at each call site while `DEFAULT_STAGING_API_BASE_URL` stays in
  //    the bundle as an unused constant, so "the stable staging host appears in the bundle" proves
  //    nothing about which base is live — a scan blocked a correctly-paired preview on this guard's
  //    first run. The manifest is emitted by `provenanceManifest()` in web/vite.config.ts.
  const manifestRes = await fetch(`${frontend}/carup-provenance.json`, { headers: { Accept: 'application/json' } })
  if (!manifestRes.ok) {
    fail(`${frontend}/carup-provenance.json returned HTTP ${manifestRes.status}. This build predates the `
      + 'provenance manifest, so its pairing cannot be proved. Redeploy from a head that includes it.')
  }
  let manifest
  try {
    manifest = await manifestRes.json()
  } catch {
    fail(`${frontend}/carup-provenance.json is not valid JSON`)
  }

  const frontendSha = manifest.commit_sha || null
  const apiBaseUrl = manifest.api_base_url || null
  if (!apiBaseUrl) {
    fail('the build recorded no API base URL, so it resolves its backend from the runtime host. A '
      + `preview must be paired explicitly. Build reason: ${manifest.api_base_source || 'unknown'}`)
  }

  const callsStableStaging = new URL(apiBaseUrl).hostname === STABLE_STAGING_BACKEND
  const pairedBackend = apiBaseUrl.replace(/\/api\/?$/, '')

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
  line('API base compiled into the bundle', apiBaseUrl)
  line('API base source', manifest.api_base_source || 'unknown')
  line('frontend candidate SHA', frontendSha || 'NOT RECORDED BY BUILD')
  line('frontend git ref', manifest.git_ref || 'unknown')
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
  if (!frontendSha) fail('the build recorded no commit SHA, so the pairing cannot be proved.')
  if (!equal) fail(`frontend ${frontendSha.slice(0, 8)} != backend ${String(backendSha).slice(0, 8)}. `
    + 'Redeploy so both serve the same candidate before running UAT.')
  if (!expectedOk) fail(`pairing is self-consistent at ${backendSha.slice(0, 8)} but --expected-sha was ${args['expected-sha'].slice(0, 8)}.`)

  console.log(`\n  VALID FOR UAT — both surfaces serve ${frontendSha.slice(0, 8)}.\n`)
}

main().catch((err) => { console.error(err); process.exit(1) })
