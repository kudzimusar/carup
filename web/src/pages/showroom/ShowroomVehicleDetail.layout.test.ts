/**
 * RX03 — source-level guards for the showroom Vehicle Detail, mirroring the ones the accepted page
 * carries in `dashboard/owner/MyListings.responsive.test.tsx` (OBS-06, OBS-02) and
 * `VehicleDetail.parity.test.ts`. jsdom performs no layout, so the rule that would produce each
 * defect is pinned in the source instead. The accepted page keeps its own original assertions.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const DETAIL = readFileSync(path.resolve(here, './ShowroomVehicleDetail.tsx'), 'utf8')

describe('OBS-06 — governed next steps stay legible on the light decision rail', () => {
  it('missing direct seller contact exposes the governed CarUp contact path', () => {
    expect(DETAIL).toContain('data-testid="seller-contact-unavailable"')
    expect(DETAIL).toContain('triggerLabel="Contact through CarUp"')
    expect(DETAIL).toContain("intentMetadata={{ buyer_intent: 'seller_contact' }}")
  })

  it('direct call and WhatsApp are conditional on a published number and legible on white', () => {
    expect(DETAIL).toContain('sellerContactNumber && sellerWhatsAppLink ?')
    expect(DETAIL).toContain('tel:${sellerContactNumber}')
    expect(DETAIL).toContain('href={sellerWhatsAppLink}')
    expect(DETAIL).toContain('border-slate-300 bg-white font-semibold text-[#09122A] hover:bg-slate-50 hover:text-[#09122A]')
    expect(DETAIL, 'no white-on-white control on the light rail').not.toContain('bg-transparent text-white')
  })

  it('financing inquiry uses the full-strength secondary action', () => {
    expect(DETAIL).toContain('triggerLabel="Ask about financing"')
    const at = DETAIL.indexOf('triggerLabel="Ask about financing"')
    expect(DETAIL.slice(at, at + 200)).toContain('triggerClassName={secondaryAction}')
    expect(DETAIL).toMatch(/const secondaryAction = `h-12 w-full rounded-full border-slate-300 bg-white text-\[15px\] font-semibold text-\[#09122A\]/)
    expect(DETAIL).not.toMatch(/const secondaryAction = `[^`]*opacity-/)
  })

  it('reservation stays a governed request until the server proves transaction state', () => {
    expect(DETAIL).toContain('data-testid="reservation-request-entry"')
    expect(DETAIL).toContain("intentMetadata={{ buyer_intent: 'reservation_request', safepay_requested: true }}")
    expect(DETAIL).toContain('data-testid="reserved-state"')
    expect(DETAIL).toContain("reservationSummary?.state === 'active' && reservationSummary.reserved === true")
    expect(DETAIL).not.toContain('createSafePayEscrow')
    expect(DETAIL).toContain('Request reservation')
    expect(DETAIL).toContain('SafePay opens only after CarUp verifies transaction eligibility')
    expect(DETAIL).toContain('detail && !isSellerPreview')
    expect(DETAIL).toContain('data-testid="seller-preview-transactions-disabled"')
  })
})

describe('OBS-02 — the decision rail never obstructs the page', () => {
  // The rail sits below the sticky 4rem site header: it sticks at top-20 only where there is a
  // second column, and is capped to the viewport with its own scroll.
  const railClasses = (() => {
    const at = DETAIL.indexOf('data-testid="vehicle-detail-intelligence-hero"')
    const match = /className="([^"]*)"\s*$/.exec(DETAIL.slice(0, at))
    return match ? match[1].split(/\s+/) : []
  })()

  it('sticks only where there is a column to stick beside', () => {
    expect(railClasses.length, 'the rail className must be found').toBeGreaterThan(0)
    expect(railClasses).toEqual(expect.arrayContaining(['lg:sticky', 'lg:top-20']))
    expect(railClasses).not.toContain('sticky')
    expect(railClasses.filter(c => /^top-/.test(c))).toEqual([])
  })

  it('is capped to the viewport and scrolls within itself', () => {
    expect(railClasses).toEqual(expect.arrayContaining(['lg:max-h-[calc(100vh-6rem)]', 'lg:overflow-y-auto']))
  })
})
