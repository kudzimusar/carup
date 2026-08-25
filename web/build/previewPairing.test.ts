/**
 * Issue #164 Phase 8, Cluster I — build-time candidate pairing.
 *
 * These fail on baseline `993c1179`, where a preview build had no notion of a paired backend at all
 * and every preview inherited the stable staging backend at runtime.
 */

import { describe, it, expect } from 'vitest'
import { resolvePreviewApiUrl, loadPairingFile, UNPAIRED_PREVIEW_API_BASE_URL } from './previewPairing'
import { UNPAIRED_PREVIEW_API_BASE_URL as RUNTIME_SENTINEL } from '../src/lib/apiClient'

const PROGRAMME_BRANCH = 'integration/canonical-vehicle-truth-closure'
const pairing = { branches: { [PROGRAMME_BRANCH]: 'https://backend-for-that-branch.example.app' } }

describe('resolvePreviewApiUrl', () => {
  it('pairs a preview with its own branch backend', () => {
    const r = resolvePreviewApiUrl({ vercelEnv: 'preview', gitRef: PROGRAMME_BRANCH, pairing })
    expect(r.apiUrl).toBe('https://backend-for-that-branch.example.app')
    expect(r.unpaired).toBe(false)
  })

  // THE REGRESSION: an unlisted branch must NOT inherit the stable staging backend.
  it('fails closed for a branch that is not paired', () => {
    const r = resolvePreviewApiUrl({ vercelEnv: 'preview', gitRef: 'some/other-branch', pairing })
    expect(r.apiUrl).toBe(UNPAIRED_PREVIEW_API_BASE_URL)
    expect(r.unpaired).toBe(true)
    expect(r.apiUrl).not.toContain('carup-backend-staging.vercel.app')
  })

  it('fails closed for a preview with no identifiable branch', () => {
    const r = resolvePreviewApiUrl({ vercelEnv: 'preview', pairing })
    expect(r.unpaired).toBe(true)
    expect(r.apiUrl).toBe(UNPAIRED_PREVIEW_API_BASE_URL)
  })

  it('lets an explicit VITE_API_URL win everywhere', () => {
    const r = resolvePreviewApiUrl({
      configuredApiUrl: 'https://explicit.example.app/api',
      vercelEnv: 'preview',
      gitRef: 'some/other-branch',
      pairing,
    })
    expect(r.apiUrl).toBe('https://explicit.example.app/api')
    expect(r.unpaired).toBe(false)
  })

  it('leaves non-preview builds to runtime host resolution', () => {
    for (const vercelEnv of ['production', 'development', undefined]) {
      const r = resolvePreviewApiUrl({ vercelEnv, gitRef: 'main', pairing })
      expect(r.apiUrl).toBeUndefined()
      expect(r.unpaired).toBe(false)
    }
  })
})

describe('the checked-in pairing map', () => {
  it('pairs the Issue #164 programme branch', () => {
    const file = loadPairingFile()
    expect(file.branches?.[PROGRAMME_BRANCH]).toBeTruthy()
  })

  // The mapped backend must be a per-branch preview, never the stable alias that serves `main`.
  it('never points a branch at the stable staging backend', () => {
    for (const [branch, target] of Object.entries(loadPairingFile().branches ?? {})) {
      expect(target, `${branch} must not target the stable staging backend`)
        .not.toMatch(/^https:\/\/carup-backend-staging\.vercel\.app/)
      expect(target, `${branch} must be an absolute https origin`).toMatch(/^https:\/\//)
    }
  })
})

describe('build-time and runtime sentinels', () => {
  // They are declared in two modules that cannot import each other (one is Node-only build code, the
  // other ships to the browser). If they ever drift, an unpaired preview would resolve to a host the
  // runtime guard does not recognise, and the banner would misreport it as merely unreachable.
  it('agree on the unpaired sentinel', () => {
    expect(UNPAIRED_PREVIEW_API_BASE_URL).toBe(RUNTIME_SENTINEL)
  })
})
