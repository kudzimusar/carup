import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * OC-4F (RC1 residual scan) — the web client calls no retired route.
 *
 * OC-4C retired POST /api/ai/ocr on the server (it now answers 410 with the replacement routes) and
 * OC-2A retired the self-authorizing /api/verification router. The RC1 scan found the web client
 * still exporting a `runOcrParsing` helper that POSTed to /ai/ocr — dead (no caller; the owner
 * dashboard tests already pin that it never calls it), but one import away from a user-facing 410.
 * The helper is removed; this pins that no client code reintroduces either path.
 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('the web client calls no retired route (OC-4F)', () => {
  const files = sources(SRC_ROOT)

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((f) => f.endsWith('hooks/useCarUpApi.ts'))).toBe(true)
  })

  it('never requests the retired /api/ai/ocr', () => {
    const offenders = files.filter((f) => /['"`]\/(?:api\/)?ai\/ocr['"`/?]/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => relative(SRC_ROOT, f))).toEqual([])
  })

  // The live trust-fact routes share the /verification/ prefix (review-queue, trust-facts,
  // audit-trail) and stay; these are the retired router's own routes.
  it('never requests the retired /api/verification router routes', () => {
    const offenders = files.filter((f) => /['"`]\/(?:api\/)?verification\/(?:ocr|fraud-scan|promote-trust|trust-score)\b/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => relative(SRC_ROOT, f))).toEqual([])
  })

  it('exports no runOcrParsing helper', () => {
    const api = readFileSync(join(SRC_ROOT, 'hooks/useCarUpApi.ts'), 'utf8')
    expect(api).not.toMatch(/\brunOcrParsing\b/)
  })
})
