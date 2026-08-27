/**
 * Marketplace Iteration 2 — progressive sell-flow resilience.
 *
 * FileReader completion order is nondeterministic. The sell flows must preserve the seller's
 * selection order and must not lose all business fields when a browser draft is too large.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(path.resolve(here, relative), 'utf8')

const GUEST_SELL = read('./GuestSell.tsx')
const AUTHENTICATED_SELL = read('./dashboard/owner/SellVehicle.tsx')
const GUEST_DRAFT = read('../lib/guestSellDraft.ts')

describe('Marketplace progressive sell resilience', () => {
  it('guest photos are filtered, batch-read and appended in selection order', () => {
    expect(GUEST_SELL).toContain(".filter(file => file.type.startsWith('image/'))")
    expect(GUEST_SELL).toContain('Promise.all(files.map(file => new Promise<string>')
    expect(GUEST_SELL).toContain('images: [...previous.images, ...images].slice(0, 10)')
  })

  it('authenticated seller photos use the same ordered batch rule', () => {
    expect(AUTHENTICATED_SELL).toContain(".filter(file => file.type.startsWith('image/'))")
    expect(AUTHENTICATED_SELL).toContain('Promise.all(files.map(file => new Promise<string>')
    expect(AUTHENTICATED_SELL).toContain('images: [...previous.images, ...images].slice(0, 15)')
  })

  it('the guest draft degrades by removing photos rather than business fields', () => {
    expect(GUEST_DRAFT).toContain("JSON.stringify({ ...payload, images: [] })")
    expect(GUEST_DRAFT).toContain("images_omitted: true")
  })

  it('auth is requested only at commitment and returns to the governed seller flow', () => {
    expect(GUEST_SELL).toContain('data-testid="guest-sell-commit"')
    expect(GUEST_SELL).toContain('/register?returnTo=%2Fdashboard%2Fsell-vehicle')
    expect(GUEST_SELL).toContain('/login?returnTo=%2Fdashboard%2Fsell-vehicle')
    expect(AUTHENTICATED_SELL).toContain('readGuestSellDraft()')
    expect(AUTHENTICATED_SELL).toContain('clearGuestSellDraft()')
  })
})
