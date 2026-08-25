/**
 * Build-time resolution of a preview frontend's paired backend — Issue #164 Phase 8, Cluster I.
 *
 * ## Why this exists
 *
 * The first Phase 8 physical UAT ran the PR #165 preview frontend against
 * `https://carup-backend-staging.vercel.app`, which serves `main`. The candidate's own backend was
 * never exercised. Four UAT steps failed for a defect `main` still had and the candidate had already
 * fixed, and every other backend-dependent step measured the wrong contract.
 *
 * The invariant this module enforces at build time:
 *
 *   A branch frontend preview MUST be built against the matching branch backend preview, and must
 *   never fall back to the stable-main staging backend.
 *
 * Resolution is deliberately fail-closed: an unpaired preview gets a reserved `.invalid` base that
 * cannot resolve, so it breaks loudly instead of producing plausible-but-wrong UAT evidence.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** Mirrors `UNPAIRED_PREVIEW_API_BASE_URL` in `src/lib/apiClient.ts` (asserted equal by its test). */
export const UNPAIRED_PREVIEW_API_BASE_URL = 'https://unpaired-preview.carup.invalid/api'

export type PairingFile = { branches?: Record<string, string> }

export type PairingInput = {
  /** An explicit `VITE_API_URL` from the environment. Always wins when set. */
  configuredApiUrl?: string
  /** Vercel's `VERCEL_ENV`: 'production' | 'preview' | 'development'. */
  vercelEnv?: string
  /** Vercel's `VERCEL_GIT_COMMIT_REF` — the branch being built. */
  gitRef?: string
  /** Parsed `preview-backend-pairing.json`. */
  pairing: PairingFile
}

export type PairingResult = {
  /** The value to expose as `VITE_API_URL`, or undefined to leave runtime resolution untouched. */
  apiUrl?: string
  /** Why — surfaced in the build log so a mis-paired preview is visible in CI output. */
  reason: string
  /** True when a preview could not be paired and was deliberately failed closed. */
  unpaired: boolean
}

/**
 * Decide the API base a build should bake in.
 *
 * Non-preview builds return `apiUrl: undefined` on purpose: production and local builds keep their
 * existing behaviour (explicit env var, else the runtime host-based fallback in `apiClient.ts`).
 * This module only takes responsibility for previews, which are the case that was broken.
 */
export function resolvePreviewApiUrl(input: PairingInput): PairingResult {
  const configured = input.configuredApiUrl?.trim()
  if (configured) {
    return { apiUrl: configured, reason: 'explicit VITE_API_URL in the environment', unpaired: false }
  }

  if (input.vercelEnv !== 'preview') {
    return {
      apiUrl: undefined,
      reason: `not a preview build (VERCEL_ENV=${input.vercelEnv ?? 'unset'}); runtime host resolution applies`,
      unpaired: false,
    }
  }

  const ref = input.gitRef?.trim()
  if (!ref) {
    return {
      apiUrl: UNPAIRED_PREVIEW_API_BASE_URL,
      reason: 'preview build with no VERCEL_GIT_COMMIT_REF — cannot identify the paired backend',
      unpaired: true,
    }
  }

  const target = input.pairing.branches?.[ref]?.trim()
  if (!target) {
    return {
      apiUrl: UNPAIRED_PREVIEW_API_BASE_URL,
      reason: `branch "${ref}" is not listed in preview-backend-pairing.json`,
      unpaired: true,
    }
  }

  return { apiUrl: target, reason: `paired from preview-backend-pairing.json for "${ref}"`, unpaired: false }
}

/** Read the checked-in pairing map. A missing or invalid file yields an empty map, which fails closed. */
export function loadPairingFile(fromDir?: string): PairingFile {
  const dir = fromDir ?? path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(dir, '..', 'preview-backend-pairing.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PairingFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
