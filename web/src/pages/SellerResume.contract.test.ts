import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const guest = readFileSync(path.resolve(here, './GuestSell.tsx'), 'utf8')
const seller = readFileSync(path.resolve(here, './dashboard/owner/SellVehicle.tsx'), 'utf8')
const garage = readFileSync(path.resolve(here, './dashboard/owner/MyGarage.tsx'), 'utf8')
const profile = readFileSync(path.resolve(here, './dashboard/owner/VehicleProfile.tsx'), 'utf8')
const listings = readFileSync(path.resolve(here, './dashboard/owner/MyListings.tsx'), 'utf8')

describe('Seller resume continuity', () => {
  it('hydrates Passport identity without inventing commercial seller facts', () => {
    for (const source of [guest, seller]) {
      expect(source).toContain("make: previous.make.trim() || found?.make || ''")
      expect(source).toContain("model: previous.model.trim() || found?.model || ''")
      expect(source).toContain("year: previous.year || (found?.year ? String(found.year) : '')")
    }
  })

  it('autosaves and restores stage across refresh/auth handoff', () => {
    expect(guest).toContain('saveGuestSellStep(step)')
    expect(seller).toContain('readGuestSellStep()')
    expect(seller).toContain('saveGuestSellStep(step)')
  })

  it('reopens an account listing instead of starting a blank registration', () => {
    expect(seller).toContain("searchParams.get('vin')")
    expect(seller).toContain('fetchOwnedVehicles()')
    expect(seller).toContain('seller-server-draft-loaded')
    expect(profile).toContain('/dashboard/sell-vehicle?vin=')
    expect(listings).toContain('/dashboard/sell-vehicle?vin=')
    expect(garage).toContain("if (vehicle.publication_status === 'published')")
  })

  it('does not silently drop a selected photo gallery', () => {
    expect(seller).toContain('CarUp did not confirm every selected photo upload.')
    expect(seller).toContain('images_recorded_count')
    expect(seller).toContain('Your browser draft has been kept')
  })
})
