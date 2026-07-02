import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildFeatureManifest } from './featureRegistry'

/**
 * Drift gate: the committed framework-neutral manifest consumed by the Express
 * backend MUST stay byte-for-byte in sync with what the registry produces.
 * If this fails, run: node scripts/generate-feature-manifest.mjs
 */
describe('Feature governance manifest — frontend/backend drift gate', () => {
  const manifestPath = path.resolve(__dirname, '../../../shared/navigation/feature-manifest.json')

  it('committed shared/navigation/feature-manifest.json matches the live registry', () => {
    const committed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    expect(committed).toEqual(buildFeatureManifest())
  })

  it('serialized form is deterministic and current (catches unregenerated edits)', () => {
    const committedRaw = fs.readFileSync(manifestPath, 'utf-8')
    const expectedRaw = JSON.stringify(buildFeatureManifest(), null, 2) + '\n'
    expect(committedRaw).toBe(expectedRaw)
  })

  it('every manifest entry has a valid lifecycle and at least one role', () => {
    const valid = new Set(['active', 'beta', 'planned', 'hidden', 'disabled', 'deprecated'])
    for (const entry of buildFeatureManifest()) {
      expect(valid.has(entry.defaultLifecycle)).toBe(true)
      expect(Array.isArray(entry.defaultRoles)).toBe(true)
      // immutableRoles must be a superset-bound of defaultRoles (override can't broaden beyond it)
      for (const r of entry.defaultRoles) {
        expect(entry.immutableRoles).toContain(r)
      }
    }
  })
})
