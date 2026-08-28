/**
 * Seller Journey 1.0 / S1 — guest → authenticated draft continuity is total.
 *
 * S1's gate: "A guest can begin, authenticate later and resume without losing or corrupting
 * entered information." A field added to Guest Sell but forgotten in the draft shape, or persisted
 * but never read back by authenticated Sell, silently drops a seller's answer — the exact failure
 * Invariant 1 forbids (ask once → store once → reuse everywhere).
 *
 * This walks the three surfaces structurally so the omission is caught by CI rather than by a
 * seller retyping their vehicle.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(path.resolve(here, relative), 'utf8')

const GUEST_SELL = read('../pages/GuestSell.tsx')
const GUEST_DRAFT = read('./guestSellDraft.ts')
const AUTHENTICATED_SELL = read('../pages/dashboard/owner/SellVehicle.tsx')

/** Field names in Guest Sell's INITIAL form shape — every question the guest is actually asked. */
const guestFormFields = (): string[] => {
  const block = /const INITIAL = \{([\s\S]*?)\n\}/.exec(GUEST_SELL)
  expect(block, 'Guest Sell INITIAL form shape must remain statically readable').toBeTruthy()
  return [...new Set([...(block as RegExpExecArray)[1].matchAll(/(\w+):/g)].map(m => m[1]))]
}

/** Field names the browser draft persists, excluding its envelope. */
const draftFields = (): string[] => {
  const block = /export interface GuestSellDraft \{([\s\S]*?)\n\}/.exec(GUEST_DRAFT)
  expect(block, 'GuestSellDraft interface must remain statically readable').toBeTruthy()
  return [...(block as RegExpExecArray)[1].matchAll(/^\s*(\w+):/gm)]
    .map(m => m[1])
    .filter(name => name !== 'version' && name !== 'saved_at')
}

/** Field names authenticated Sell actually reads back off the claimed draft. */
const consumedFields = (): string[] => [
  ...new Set([...AUTHENTICATED_SELL.matchAll(/guestDraft\.(\w+)/g)].map(m => m[1])),
]

describe('S1 guest draft continuity', () => {
  it('every question Guest Sell asks survives into the browser draft', () => {
    const missing = guestFormFields().filter(field => !draftFields().includes(field))
    expect(missing, `Guest Sell collects these but the draft drops them: ${missing.join(', ')}`).toEqual([])
  })

  it('every persisted draft field is read back by authenticated Sell', () => {
    const dropped = draftFields().filter(field => !consumedFields().includes(field))
    expect(dropped, `The draft persists these but authenticated Sell never reads them: ${dropped.join(', ')}`).toEqual([])
  })

  it('the draft is versioned and rejects a shape it does not understand', () => {
    expect(GUEST_DRAFT).toContain('version: 1')
    expect(GUEST_DRAFT).toContain("if (parsed.version !== 1")
  })

  it('the claimed draft is cleared only after the server accepted the listing', () => {
    // clearGuestSellDraft must sit after the awaited createVehicleListing, never before it —
    // clearing first would lose the seller's work if the write failed.
    const created = AUTHENTICATED_SELL.indexOf('await createVehicleListing(')
    const cleared = AUTHENTICATED_SELL.indexOf('clearGuestSellDraft()')
    expect(created).toBeGreaterThan(-1)
    expect(cleared).toBeGreaterThan(created)
  })
})
