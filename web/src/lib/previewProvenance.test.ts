/**
 * Issue #164 Phase 8, Cluster I — candidate-provenance guard.
 *
 * Every test here fails on the physically-tested baseline `993c1179`, where none of this existed and a
 * preview frontend served against another candidate's backend was indistinguishable from a correct
 * pairing. That silence invalidated a complete 32-step physical UAT.
 */

import { describe, it, expect, vi } from 'vitest'
import { evaluateProvenance, fetchBackendProvenance } from './previewProvenance'
import { UNPAIRED_PREVIEW_API_BASE_URL, DEFAULT_STAGING_API_BASE_URL } from './apiClient'

const PREVIEW_HOST = 'carup-staging-git-integration-canonical-vehicle-tr-7bafc7-11-11.vercel.app'
const CANDIDATE_BACKEND = 'https://carup-backend-staging-git-integration-canonical-ve-df06b3-11-11.vercel.app/api'
const CANDIDATE_SHA = 'f1ae9735a07583bdbf58574fe5ce624db0daaab3'
const MAIN_SHA = '87033020760f04b74f7d071d3d158f9f45f47524'

describe('evaluateProvenance', () => {
  it('passes a preview whose backend serves the same commit', () => {
    const v = evaluateProvenance({
      hostname: PREVIEW_HOST,
      apiBaseUrl: CANDIDATE_BACKEND,
      buildSha: CANDIDATE_SHA,
      backendSha: CANDIDATE_SHA,
    })
    expect(v.status).toBe('paired')
    expect(v.blocksUat).toBe(false)
  })

  // THE REGRESSION. This is the exact configuration of the first Phase 8 physical UAT: the PR #165
  // preview frontend, calling the stable staging backend, which was serving `main`.
  it('blocks UAT when the backend serves a DIFFERENT commit (the first Phase 8 UAT fault)', () => {
    const v = evaluateProvenance({
      hostname: PREVIEW_HOST,
      apiBaseUrl: DEFAULT_STAGING_API_BASE_URL,
      buildSha: CANDIDATE_SHA,
      backendSha: MAIN_SHA,
    })
    expect(v.status).toBe('mismatch')
    expect(v.blocksUat).toBe(true)
    // Both SHAs must be named, so the operator can see which two candidates were crossed.
    expect(v.detail).toContain(CANDIDATE_SHA.slice(0, 8))
    expect(v.detail).toContain(MAIN_SHA.slice(0, 8))
  })

  it('blocks UAT for a preview that was built with no paired backend', () => {
    const v = evaluateProvenance({
      hostname: PREVIEW_HOST,
      apiBaseUrl: UNPAIRED_PREVIEW_API_BASE_URL,
      buildSha: CANDIDATE_SHA,
    })
    expect(v.status).toBe('unpaired')
    expect(v.blocksUat).toBe(true)
  })

  it('blocks UAT when the backend will not report its provenance', () => {
    const v = evaluateProvenance({
      hostname: PREVIEW_HOST,
      apiBaseUrl: CANDIDATE_BACKEND,
      buildSha: CANDIDATE_SHA,
      backendSha: null,
      healthReadFailed: true,
    })
    expect(v.status).toBe('unreachable')
    expect(v.blocksUat).toBe(true)
  })

  it('blocks UAT when the bundle cannot prove its own commit', () => {
    const v = evaluateProvenance({
      hostname: PREVIEW_HOST,
      apiBaseUrl: CANDIDATE_BACKEND,
      buildSha: '',
      backendSha: CANDIDATE_SHA,
    })
    expect(v.status).toBe('indeterminate')
    expect(v.blocksUat).toBe(true)
  })

  // An unverifiable pairing is treated exactly like a wrong one. The first UAT proved that an
  // unverified pairing is indistinguishable from a correct one until the evidence is already spent.
  it('never reports a non-paired preview as safe to UAT', () => {
    const cases = [
      { apiBaseUrl: UNPAIRED_PREVIEW_API_BASE_URL, buildSha: CANDIDATE_SHA },
      { apiBaseUrl: CANDIDATE_BACKEND, buildSha: CANDIDATE_SHA, backendSha: MAIN_SHA },
      { apiBaseUrl: CANDIDATE_BACKEND, buildSha: CANDIDATE_SHA, healthReadFailed: true },
      { apiBaseUrl: CANDIDATE_BACKEND, buildSha: '', backendSha: CANDIDATE_SHA },
    ]
    for (const c of cases) {
      expect(evaluateProvenance({ hostname: PREVIEW_HOST, ...c }).blocksUat).toBe(true)
    }
  })

  it('does not apply to non-preview hosts, which are paired by construction', () => {
    for (const host of ['carup-staging.vercel.app', 'staging.carup.dev', 'carup.dev', 'localhost']) {
      const v = evaluateProvenance({ hostname: host, apiBaseUrl: DEFAULT_STAGING_API_BASE_URL, buildSha: '' })
      expect(v.status).toBe('not_applicable')
      expect(v.blocksUat).toBe(false)
    }
  })
})

describe('fetchBackendProvenance', () => {
  it('reads build.commit_sha from /api/health', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ build: { commit_sha: CANDIDATE_SHA } }),
    }) as unknown as typeof fetch
    await expect(fetchBackendProvenance(CANDIDATE_BACKEND, fetchImpl))
      .resolves.toEqual({ sha: CANDIDATE_SHA, failed: false })
    expect(fetchImpl).toHaveBeenCalledWith(`${CANDIDATE_BACKEND}/health`, expect.anything())
  })

  it('reports failure instead of throwing when the backend is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
    await expect(fetchBackendProvenance(UNPAIRED_PREVIEW_API_BASE_URL, fetchImpl))
      .resolves.toEqual({ sha: null, failed: true })
  })

  it('reports failure when provenance is absent from an otherwise-healthy response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'UP' }),
    }) as unknown as typeof fetch
    await expect(fetchBackendProvenance(CANDIDATE_BACKEND, fetchImpl))
      .resolves.toEqual({ sha: null, failed: true })
  })
})
