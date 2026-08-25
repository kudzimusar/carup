/**
 * Candidate-provenance guard — Issue #164 Phase 8, Cluster I.
 *
 * ## What this defends against
 *
 * The first Phase 8 physical UAT produced 18 failures against PR #165. It was later proved that the
 * preview frontend had been talking to `https://carup-backend-staging.vercel.app` — the STABLE staging
 * backend, which serves `main` — because `resolveApiBaseUrl` treated per-branch previews as ordinary
 * staging hosts. Four of those failures were for a contract defect the candidate had already fixed;
 * the rest measured the wrong backend entirely. The run could not certify anything.
 *
 * The failure mode is nasty precisely because it is silent: every request succeeded, every page
 * rendered, and the evidence looked real. Nothing in CI could catch it, because CI never exercises the
 * deployed pairing.
 *
 * So the pairing is now checked at runtime, by the running app, against the backend it actually calls:
 *
 *   the frontend's build SHA MUST equal the backend's `/api/health` `commit_sha`
 *
 * `evaluateProvenance` is pure so the whole matrix is unit-testable; `PreviewProvenanceBanner` renders
 * it. The check is scoped to preview hosts — the stable aliases and production are correctly paired by
 * construction and must not carry a banner.
 */

import { UNPAIRED_PREVIEW_API_BASE_URL, isPreviewFrontendHost } from './apiClient'

export type ProvenanceStatus =
  /** Not a preview host — pairing is correct by construction. No check, no banner. */
  | 'not_applicable'
  /** A preview built without a paired backend. It cannot reach any API at all. */
  | 'unpaired'
  /** The paired backend did not answer `/api/health`. */
  | 'unreachable'
  /** The backend is serving a DIFFERENT commit than this bundle was built from. */
  | 'mismatch'
  /** Built outside Vercel, so there is no build SHA to compare. Cannot certify. */
  | 'indeterminate'
  /** Frontend and backend are the same commit. Safe to UAT. */
  | 'paired'

export type ProvenanceVerdict = {
  status: ProvenanceStatus
  /** True when a physical UAT run against this pairing would be invalid. */
  blocksUat: boolean
  headline: string
  detail: string
}

export type ProvenanceInput = {
  hostname?: string | null
  /** The base the app actually calls, as resolved by `resolveApiBaseUrl`. */
  apiBaseUrl: string
  /** `VITE_COMMIT_SHA` — the commit this bundle was built from. */
  buildSha?: string | null
  /** `build.commit_sha` from the backend's `/api/health`, or null when the read failed. */
  backendSha?: string | null
  /** True when the `/api/health` read itself failed (network error / non-200). */
  healthReadFailed?: boolean
}

const short = (sha?: string | null): string => (sha ? sha.slice(0, 8) : 'unknown')

/**
 * Classify a frontend/backend pairing.
 *
 * Every non-`paired` preview outcome sets `blocksUat`. That is the fail-closed choice the Phase 8
 * correction requires: "prefer fail-closed / explicit unavailable state over silently testing against
 * a different backend". An unverifiable pairing is treated exactly like a wrong one, because the first
 * UAT proved that an unverified pairing is indistinguishable from a correct one until it is too late.
 */
export function evaluateProvenance(input: ProvenanceInput): ProvenanceVerdict {
  if (!isPreviewFrontendHost(input.hostname)) {
    return {
      status: 'not_applicable',
      blocksUat: false,
      headline: '',
      detail: '',
    }
  }

  if (input.apiBaseUrl === UNPAIRED_PREVIEW_API_BASE_URL) {
    return {
      status: 'unpaired',
      blocksUat: true,
      headline: 'This preview has no paired backend',
      detail: 'It was built without a backend for its branch, so it cannot load data and must not be '
        + 'used for UAT. Add the branch to web/preview-backend-pairing.json and redeploy.',
    }
  }

  if (input.healthReadFailed || !input.backendSha) {
    return {
      status: 'unreachable',
      blocksUat: true,
      headline: 'Could not verify which backend this preview is talking to',
      detail: `The API at ${input.apiBaseUrl} did not return build provenance. Until it does, results `
        + 'from this preview cannot be attributed to a candidate.',
    }
  }

  if (!input.buildSha) {
    return {
      status: 'indeterminate',
      blocksUat: true,
      headline: 'This preview cannot prove which commit it was built from',
      detail: `The backend reports ${short(input.backendSha)}, but this bundle carries no build SHA, so `
        + 'the pair cannot be verified. Builds outside Vercel are not valid UAT candidates.',
    }
  }

  if (input.buildSha !== input.backendSha) {
    return {
      status: 'mismatch',
      blocksUat: true,
      headline: 'Frontend and backend are different commits — do not UAT this preview',
      detail: `This page was built from ${short(input.buildSha)}, but ${input.apiBaseUrl} is serving `
        + `${short(input.backendSha)}. Any result here describes a combination that does not exist as a `
        + 'candidate. This is the exact fault that invalidated the first Issue #164 Phase 8 UAT.',
    }
  }

  return {
    status: 'paired',
    blocksUat: false,
    headline: `Candidate ${short(input.buildSha)}`,
    detail: `Frontend and backend both serve ${short(input.buildSha)}. This pairing is valid for UAT.`,
  }
}

export type BackendProvenance = { sha: string | null; failed: boolean }

/**
 * Read the paired backend's build provenance. Never throws: a failure is a verdict input, not an
 * exception, so the banner can explain it rather than the app crashing on an unpaired preview.
 */
export async function fetchBackendProvenance(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BackendProvenance> {
  try {
    const res = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, '')}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { sha: null, failed: true }
    const body = await res.json() as { build?: { commit_sha?: unknown } }
    const sha = body?.build?.commit_sha
    return typeof sha === 'string' && sha ? { sha, failed: false } : { sha: null, failed: true }
  } catch {
    return { sha: null, failed: true }
  }
}

/** The commit this bundle was built from, injected by `vite.config.ts`. */
export function readBuildSha(): string {
  const env = (typeof import.meta !== 'undefined' ? import.meta.env : undefined) as
    | Record<string, string | undefined>
    | undefined
  return (env?.VITE_COMMIT_SHA || '').trim()
}
