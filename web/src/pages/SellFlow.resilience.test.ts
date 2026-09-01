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
    expect(GUEST_SELL).toContain('screenListingImages(')
    expect(GUEST_SELL).toContain('Promise.all(files.map(file => new Promise<string>')
    expect(GUEST_SELL).toContain('const nextImages = [...previous.images, ...images].slice(0, LISTING_IMAGE_LIMIT)')
    expect(GUEST_SELL).toContain('images: nextImages')
    // The aligned annotation array grows in the same atomic state update, so async reads cannot
    // detach an angle label from the photo it describes.
    expect(GUEST_SELL).toContain("imageLabels: [...previous.imageLabels, ...Array(addedCount).fill('')].slice(0, LISTING_IMAGE_LIMIT)")
  })

  it('authenticated seller photos use the same ordered batch rule', () => {
    // The inline `image/*` filter moved into `screenListingImages` during S4, which applies the same
    // rule plus a size and count check and NAMES every refusal instead of dropping it silently.
    // The property this test exists for — order-preserving batch read, capped append — is unchanged;
    // only the place the filtering lives has moved, and it has its own suite there.
    expect(AUTHENTICATED_SELL).toContain('screenListingImages(')
    expect(AUTHENTICATED_SELL).toContain('Promise.all(files.map(file => new Promise<string>')
    expect(AUTHENTICATED_SELL).toContain('const nextImages = [...previous.images, ...images].slice(0, LISTING_IMAGE_LIMIT)')
    expect(AUTHENTICATED_SELL).toContain('images: nextImages')
    expect(AUTHENTICATED_SELL).toContain("imageLabels: [...previous.imageLabels, ...Array(addedCount).fill('')].slice(0, LISTING_IMAGE_LIMIT)")
  })

  it('a large guest draft externalizes photo bytes without losing business or media metadata', () => {
    expect(GUEST_DRAFT).toContain("mediaExternalized: payload.images.length > 0")
    expect(GUEST_DRAFT).toContain("writeGuestSellMedia(payload.images)")
    expect(GUEST_DRAFT).toContain("media_externalized: payload.images.length > 0")
    expect(GUEST_DRAFT).toContain("!draft.mediaExternalized")
    expect(GUEST_DRAFT).toContain("readGuestSellDraftWithMedia")
    // Labels, cover and history intent stay in the lightweight canonical draft. Only the heavy
    // image payload moves to IndexedDB, so auth handoff can reconstruct the exact Seller preview.
    expect(GUEST_DRAFT).not.toContain("imageLabels: []")
    expect(GUEST_DRAFT).not.toContain("coverImageIndex: null })")
    expect(GUEST_DRAFT).not.toContain("historyPlan: {} })")
  })

  it('auth is requested only at commitment and returns to the governed seller flow', () => {
    expect(GUEST_SELL).toContain('data-testid="guest-sell-commit"')
    expect(GUEST_SELL).toContain('/register?returnTo=%2Fdashboard%2Fsell-vehicle')
    expect(GUEST_SELL).toContain('/login?returnTo=%2Fdashboard%2Fsell-vehicle')
    expect(AUTHENTICATED_SELL).toContain('readGuestSellDraft()')
    expect(AUTHENTICATED_SELL).toContain('readGuestSellDraftWithMedia()')
    expect(AUTHENTICATED_SELL).toContain('seller-guest-media-restoring')
    expect(AUTHENTICATED_SELL).toContain('clearGuestSellDraft()')
  })

  it('checkpoints the final form before submit and establishes a server resume URL before clearing it', () => {
    const submit = AUTHENTICATED_SELL.indexOf('const handleSubmit = async () =>')
    const checkpoint = AUTHENTICATED_SELL.indexOf('await saveGuestSellDraft({', submit)
    const mutation = AUTHENTICATED_SELL.indexOf('const result = await createVehicleListing({', submit)
    expect(submit).toBeGreaterThanOrEqual(0)
    expect(checkpoint).toBeGreaterThan(submit)
    expect(mutation).toBeGreaterThan(checkpoint)

    const resumeAnchor = AUTHENTICATED_SELL.indexOf(
      'navigate(`/dashboard/sell-vehicle?vin=\${encodeURIComponent(returnedVin)}`, { replace: true })',
      mutation,
    )
    const clear = AUTHENTICATED_SELL.indexOf('clearGuestSellDraft()', mutation)
    expect(resumeAnchor).toBeGreaterThan(mutation)
    expect(clear).toBeGreaterThan(resumeAnchor)
  })
})
