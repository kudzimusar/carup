/**
 * Issue #164 Phase 8, Cluster H — physically observed responsive/accessibility defects.
 *
 * These are source-level assertions rather than rendered-layout ones on purpose. jsdom performs no
 * layout: every element has zero width, so an overflow assertion against `getBoundingClientRect`
 * would pass whatever the CSS said and prove nothing. What CAN be pinned deterministically is the
 * rule that produced each defect — a non-wrapping flex row, a disabled control faded to half opacity,
 * a control hidden below a breakpoint with no replacement, and an unbounded sticky panel.
 *
 * Each fails on the physically-tested baseline `993c1179`.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8')

const MY_LISTINGS = read('./MyListings.tsx')
const VEHICLE_DETAIL = read('../../VehicleDetail.tsx')
const DASHBOARD_LAYOUT = read('../../../components/layout/DashboardLayout.tsx')

describe('OBS-16 — My Listings action row must not overflow its card', () => {
  // Four actions sat in `flex gap-2`, the last of them the long "Publish to Marketplace". With no
  // wrapping, the CTA bled outside the listing card on a narrow viewport and gave the page
  // horizontal overflow.
  it('the listing action row wraps', () => {
    const row = MY_LISTINGS.match(/className="flex[^"]*gap-2 mt-3"/)
    expect(row, 'the action row must still exist').toBeTruthy()
    expect(row![0], 'the action row must wrap').toContain('flex-wrap')
  })

  it('the publish CTA is still inside that row, unchanged in meaning', () => {
    expect(MY_LISTINGS).toContain('Publish to Marketplace')
    expect(MY_LISTINGS).toContain('data-testid={`listing-actions-')
  })
})

describe('OBS-06 — unavailable direct actions must become legible governed next steps', () => {
  // Direct Call/WhatsApp are shown only when a public seller number exists. When they do not,
  // Vehicle Detail must not leave faded dead buttons behind; it offers a CarUp-routed inquiry.
  it('missing direct seller contact exposes the governed CarUp contact path', () => {
    expect(VEHICLE_DETAIL).toContain('data-testid="seller-contact-unavailable"')
    expect(VEHICLE_DETAIL).toContain('triggerLabel="Contact through CarUp"')
    expect(VEHICLE_DETAIL).toContain("intentMetadata={{ buyer_intent: 'seller_contact' }}")
  })

  // RX03-P1A-R2: the action panel is now a LIGHT decision rail. The rule these two tests pin is
  // unchanged — the secondary actions are outlined, full-strength and legible on the surface they
  // sit on — but the surface changed, so the classes that satisfy it changed with it. The old
  // dark-panel string (`bg-transparent text-white`) would now render white text on white, which is
  // exactly the illegible-control defect OBS-06 exists to catch, so its absence is asserted too.
  it('direct call and WhatsApp links are conditional on an actually published number', () => {
    expect(VEHICLE_DETAIL).toContain('sellerContactNumber && sellerWhatsAppLink ?')
    expect(VEHICLE_DETAIL).toContain('tel:${sellerContactNumber}')
    expect(VEHICLE_DETAIL).toContain('href={sellerWhatsAppLink}')
    expect(VEHICLE_DETAIL).toContain('border-slate-300 bg-white font-semibold text-[#09122A] hover:bg-slate-50 hover:text-[#09122A]')
    expect(VEHICLE_DETAIL, 'no white-on-white control on the light rail').not.toContain('bg-transparent text-white')
  })

  it('financing inquiry remains legible on the light decision rail', () => {
    expect(VEHICLE_DETAIL).toContain('triggerLabel="Ask about financing"')
    const at = VEHICLE_DETAIL.indexOf('triggerLabel="Ask about financing"')
    expect(VEHICLE_DETAIL.slice(at, at + 200)).toContain('triggerClassName={secondaryAction}')
    expect(VEHICLE_DETAIL).toMatch(/const secondaryAction = `h-12 w-full rounded-full border-slate-300 bg-white text-\[15px\] font-semibold text-\[#09122A\]/)
    expect(VEHICLE_DETAIL).not.toMatch(/const secondaryAction = `[^`]*opacity-/)
  })

  it('reservation stays a governed request until the server proves transaction state', () => {
    expect(VEHICLE_DETAIL).toContain('data-testid="reservation-request-entry"')
    expect(VEHICLE_DETAIL).toContain("intentMetadata={{ buyer_intent: 'reservation_request', safepay_requested: true }}")
    expect(VEHICLE_DETAIL).toContain('data-testid="reserved-state"')
    expect(VEHICLE_DETAIL).toContain("reservationSummary?.state === 'active' && reservationSummary.reserved === true")
    expect(VEHICLE_DETAIL).not.toContain('data-testid="reserve-vehicle"')
    expect(VEHICLE_DETAIL).not.toContain('vehicle.tenant_id ?? vehicle.sellerId')
    expect(VEHICLE_DETAIL).not.toContain("vehicle.status === 'Reserved'")
    expect(VEHICLE_DETAIL).not.toContain("vehicle.status === 'reserved'")
    expect(VEHICLE_DETAIL).not.toContain('createSafePayEscrow')
  })
})

describe('OBS-14 — owner search parity on mobile', () => {
  it('the desktop search remains, and mobile gets an equivalent affordance', () => {
    expect(DASHBOARD_LAYOUT).toContain('data-testid="owner-topbar-search"')
    expect(DASHBOARD_LAYOUT, 'a phone must not be left with no search at all')
      .toContain('data-testid="owner-topbar-search-mobile"')
  })

  it('the mobile affordance appears exactly where the desktop one is hidden', () => {
    // The form is `hidden sm:block`; its replacement must be `sm:hidden`, so there is always exactly
    // one search control and never two.
    expect(DASHBOARD_LAYOUT).toContain('hidden sm:block')
    const idx = DASHBOARD_LAYOUT.indexOf('data-testid="owner-topbar-search-mobile"')
    expect(DASHBOARD_LAYOUT.slice(idx - 300, idx)).toContain('sm:hidden')
  })

  it('the mobile affordance is labelled for assistive technology', () => {
    const idx = DASHBOARD_LAYOUT.indexOf('data-testid="owner-topbar-search-mobile"')
    expect(DASHBOARD_LAYOUT.slice(idx - 300, idx)).toContain('aria-label="Search vehicles"')
  })
})

describe('OBS-02 — the price/action panel must not obstruct the page', () => {
  // `sticky top-6` at every breakpoint, with no height bound: on a short viewport the panel pinned
  // itself over the vehicle details as the reader scrolled.
  //
  // RX03-P1A-R2: the price/action panel is now the decision rail (`vehicle-detail-intelligence-hero`)
  // and sits below the sticky 4rem site header, so it sticks at `top-20` and its cap grew from
  // 3rem to 6rem of reserved height (5rem offset + 1rem breathing room). The assertions are now
  // bound to that one element's class list instead of to the whole file, which is stricter: an
  // unscoped `sticky`/`top-*` anywhere on the rail fails, not only the one old spelling.
  const railClasses = (() => {
    const at = VEHICLE_DETAIL.indexOf('data-testid="vehicle-detail-intelligence-hero"')
    const before = VEHICLE_DETAIL.slice(0, at)
    const match = /className="([^"]*)"\s*$/.exec(before)
    return match ? match[1].split(/\s+/) : []
  })()

  it('the panel sticks only where there is a column to stick beside', () => {
    expect(railClasses.length, 'the rail className must be found').toBeGreaterThan(0)
    expect(railClasses, 'sticky must be breakpoint-scoped').toEqual(expect.arrayContaining(['lg:sticky', 'lg:top-20']))
    expect(railClasses, 'the unscoped sticky must be gone').not.toContain('sticky')
    expect(railClasses.filter((c) => /^top-/.test(c)), 'no unscoped top offset').toEqual([])
  })

  it('the panel is capped to the viewport and scrolls within itself', () => {
    expect(railClasses).toEqual(expect.arrayContaining(['lg:max-h-[calc(100vh-6rem)]', 'lg:overflow-y-auto']))
  })
})
