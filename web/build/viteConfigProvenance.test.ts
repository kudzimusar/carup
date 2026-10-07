// @vitest-environment node
/**
 * OC-5R-REL-01 — the build identity is WIRED, not just correct.
 *
 * `resolveBuildIdentity` is unit-tested in previewPairing.test.ts; this proves vite.config.ts actually
 * uses it: with no Vercel Git variables (a CLI release) and the deployer's explicit inputs set, loading
 * the config stamps exactly that revision and branch into the bundle's provenance environment.
 */
import { describe, it, expect, beforeAll } from 'vitest'

const SHA = 'c'.repeat(40)
const REF = 'fix/oc5r-real-runtime-source-closure'

describe('vite.config.ts stamps the build identity it was given', () => {
  beforeAll(async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
    delete process.env.VERCEL_GIT_COMMIT_REF
    process.env.CARUP_BUILD_SHA = SHA
    process.env.CARUP_BUILD_REF = REF
    await import('../vite.config')
  })

  it('a CLI release is stamped with the explicit revision and branch', () => {
    expect(process.env.VITE_COMMIT_SHA).toBe(SHA)
    expect(process.env.VITE_GIT_REF).toBe(REF)
  })
})
