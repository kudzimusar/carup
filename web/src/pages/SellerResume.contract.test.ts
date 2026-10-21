import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const guest = readFileSync(path.resolve(here, './GuestSell.tsx'), 'utf8')
const seller = readFileSync(path.resolve(here, './dashboard/owner/SellVehicle.tsx'), 'utf8')
// CARUP-MVP-STAB-01 F-009 — the receipt comparison moved out of the page into one shared,
// unit-tested authority (behaviour: src/lib/sellerDraftReceipt.test.ts).
const receipt = readFileSync(path.resolve(here, '../lib/sellerDraftReceipt.ts'), 'utf8')
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
    // Both writes Studio makes — draft autosave and the published-listing save — earn "saved" only
    // through the receipt check.
    expect(seller.match(/sellerDraftReceiptMatches\(payload, result\.draft\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(seller).toContain("setServerAutosaveState('saved')")
    // F-007: loading the listing is not an edit, so it schedules no write.
    expect(seller).toContain('if (serverAutosaveRevision.current <= serverPersistedRevision.current) return')
  })

  it('requires the server to echo the persisted Seller statement before showing saved', () => {
    // F-009 — the comparison is by PERSISTED MEANING: the same normaliser on both sides, so a
    // trimmed, de-duplicated or JSONB-reordered echo is a save and a different value is not.
    // The exact byte comparison it replaces is the defect (Postgres JSONB reorders keys), so its
    // spelling is pinned ABSENT; sellerDraftReceipt.test.ts proves every field's mismatch fails.
    expect(seller).toContain("import { sellerDraftReceiptMatches, type SellerDraftPayload } from '@/lib/sellerDraftReceipt'")
    expect(seller).not.toContain('function autosaveReceiptMatches(')
    expect(seller).not.toContain('JSON.stringify(payload[key] ?? null) !== JSON.stringify(receipt[key] ?? null)')

    expect(receipt).toContain('if (!receipt) return false')
    expect(receipt).toContain("['description', 'description']")
    expect(receipt).toContain("['location', 'location']")
    expect(receipt).toContain("['province', 'province']")
    // Every comparison is gated on the key having been SENT: an absent key is untouched server-side.
    expect(receipt).toContain('const sent = (key: keyof SellerDraftPayload) => Object.prototype.hasOwnProperty.call(payload, key)')
    expect(receipt).toContain("sent('location_visibility')")
    expect(receipt).toContain("sent('features')")
    expect(receipt).toContain("sent('price')")
    expect(receipt).toContain("sent('public_seller_display_enabled')")
    // F18–F20: an answered history disclosure earns "saved" only when the receipt holds the same
    // structured statement — compared as canonical JSON of the stored form.
    expect(receipt).toContain("['accident_disclosure', 'insurance_disclosure', 'finance_disclosure'] as const")
    expect(receipt).toContain('canonicalDisclosureJson(key, payload[key]) !== canonicalDisclosureJson(key, receipt[key])')
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
