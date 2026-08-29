import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(path.resolve(here, relative), 'utf8')
const guest = read('./GuestSell.tsx')
const seller = read('./dashboard/owner/SellVehicle.tsx')
const notice = read('../components/sell/VehicleIdentificationNotice.tsx')
const draft = read('../lib/guestSellDraft.ts')
const app = read('../App.tsx')

describe('Seller existing-Passport and handoff regression', () => {
  it('makes the existing VIN verdict actionable instead of advisory-only', () => {
    expect(notice).toContain('sell-vin-passport-actions')
    expect(notice).toContain('Yes — this is the same vehicle')
    expect(notice).toContain('No — use another VIN')
    expect(guest).toContain('existingPassportConfirmed')
    expect(guest).toContain('Wait for the CarUp Passport check to finish')
  })

  it('requires governed Seller authority before reusing an existing Passport', () => {
    expect(seller).toContain('requestSellerAuthorityClaim')
    expect(seller).toContain('seller-existing-passport-authority')
    expect(seller).toContain('I own this vehicle')
    expect(seller).toContain('I am authorised to sell it')
    expect(seller).toContain('reuse_existing_passport:')
    expect(seller).toContain("authorityState === 'evidence_required'")
  })

  it('restores large media from explicit persisted state and never infers it from labels', () => {
    expect(draft).toContain('mediaExternalized: payload.images.length > 0')
    expect(draft).toContain('!draft.mediaExternalized')
    expect(seller).toContain('guestDraft?.mediaExternalized')
    expect(seller).not.toContain('guestDraft.imageLabels.length > 0')
  })

  it('a Seller render failure has a recoverable UI instead of a blank route', () => {
    expect(app).toContain('<SellerRouteErrorBoundary><SellVehicle /></SellerRouteErrorBoundary>')
  })
})
