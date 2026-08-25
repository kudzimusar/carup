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

describe('OBS-06 — a disabled action must stay legible', () => {
  // The base Button applies `disabled:opacity-50`. On the dark detail panel that rendered white text
  // on a half-opacity fill, and an outline button as `border-white/30 text-white` at half opacity —
  // effectively invisible. The label is what tells a buyer WHICH action is unavailable.
  it('the disabled contact actions override the global opacity fade', () => {
    for (const testid of ['call-disabled', 'whatsapp-disabled']) {
      const idx = VEHICLE_DETAIL.indexOf(`data-testid="${testid}"`)
      expect(idx, `${testid} must exist`).toBeGreaterThan(-1)
      const element = VEHICLE_DETAIL.slice(Math.max(0, idx - 400), idx + 100)
      expect(element, `${testid} must not render at 50% opacity`).toContain('disabled:opacity-100')
      expect(element, `${testid} must remain marked disabled`).toContain('aria-disabled')
    }
  })

  it('a disabled action is never re-enabled to make it visible', () => {
    // The remedy for an invisible disabled control is contrast, never removing `disabled`.
    const idx = VEHICLE_DETAIL.indexOf('data-testid="call-disabled"')
    expect(VEHICLE_DETAIL.slice(idx - 400, idx)).toContain('disabled')
  })

  it('the Reserve control keeps its disabled state and its explanation', () => {
    expect(VEHICLE_DETAIL).toContain('data-testid="reserve-vehicle"')
    expect(VEHICLE_DETAIL).toContain('data-testid="reserve-unavailable"')
    expect(VEHICLE_DETAIL).toContain('disabled={!resolvedSellerId}')
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
  it('the panel sticks only where there is a column to stick beside', () => {
    expect(VEHICLE_DETAIL, 'sticky must be breakpoint-scoped').toContain('lg:sticky lg:top-6')
    expect(VEHICLE_DETAIL, 'the unscoped sticky must be gone')
      .not.toMatch(/text-white sticky top-6/)
  })

  it('the panel is capped to the viewport and scrolls within itself', () => {
    expect(VEHICLE_DETAIL).toContain('lg:max-h-[calc(100vh-3rem)]')
    expect(VEHICLE_DETAIL).toContain('lg:overflow-y-auto')
  })
})
