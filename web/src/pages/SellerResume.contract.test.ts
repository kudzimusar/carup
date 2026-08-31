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

  it('restores Seller listing location from the governed listing projection', () => {
    expect(seller).toContain("location: String(raw.listing_city || raw.location || '')")
    expect(seller).toContain("province: String(raw.listing_province || raw.province || '')")
    expect(seller).toContain("raw.listing_location_visibility === 'public'")
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

  it('never reports a newer server-draft revision saved from an older autosave receipt', () => {
    expect(seller).toContain('const serverAutosaveRevision = useRef(0)')
    expect(seller).toContain('serverAutosaveRevision.current += 1')
    expect(seller).toContain("setServerAutosaveState('idle')")
    expect(seller).toContain('if (revision !== serverAutosaveRevision.current) return')
    expect(seller).toContain('autosaveReceiptMatches(payload, result.draft)')
    expect(seller).toContain("setServerAutosaveState('saved')")
  })

  it('requires the server to echo the exact persisted Seller draft before showing saved', () => {
    expect(seller).toContain('if (!receipt) return false')
    expect(seller).toContain("['description', 'description']")
    expect(seller).toContain("['location', 'location']")
    expect(seller).toContain("['province', 'province']")
    expect(seller).toContain("['location_visibility', 'location_visibility']")
    expect(seller).toContain("Object.prototype.hasOwnProperty.call(payload, 'features')")
    expect(seller).toContain("Object.prototype.hasOwnProperty.call(payload, 'price')")
    expect(seller).toContain("Object.prototype.hasOwnProperty.call(payload, 'public_seller_display_enabled')")
    // F18–F20: an answered history disclosure earns "saved" only when the receipt echoes the exact
    // structured statement — deep equality, same bar as features.
    expect(seller).toContain("['accident_disclosure', 'insurance_disclosure', 'finance_disclosure'] as const")
    expect(seller).toContain('JSON.stringify(payload[key] ?? null) !== JSON.stringify(receipt[key] ?? null)')
  })

  it('persists Vehicle History & Obligations disclosures through guest draft, autosave and resume', () => {
    // Guest form + browser draft + Studio hydration all carry the three disclosures…
    for (const source of [guest, seller]) {
      expect(source).toContain('accidentDisclosure')
      expect(source).toContain('insuranceDisclosure')
      expect(source).toContain('financeDisclosure')
    }
    // …the server autosave sends only ANSWERED disclosures (absence never retracts or defaults)…
    expect(seller).toContain('...(form.accidentDisclosure ? { accident_disclosure: form.accidentDisclosure } : {})')
    expect(seller).toContain('...(form.insuranceDisclosure ? { insurance_disclosure: form.insuranceDisclosure } : {})')
    expect(seller).toContain('...(form.financeDisclosure ? { finance_disclosure: form.financeDisclosure } : {})')
    // …and resume parses the stored value instead of trusting it (invalid hydrates as unanswered).
    expect(seller).toContain('parseAccidentDisclosure(raw.seller_accident_disclosure)')
    expect(seller).toContain('parseInsuranceDisclosure(raw.seller_insurance_disclosure)')
    expect(seller).toContain('parseFinanceDisclosure(raw.seller_finance_disclosure)')
  })

  it('does not silently drop a selected photo gallery', () => {
    expect(seller).toContain('CarUp did not confirm every selected photo upload.')
    expect(seller).toContain('images_recorded_count')
    expect(seller).toContain('Your browser draft has been kept')
  })
})
