import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(resolve(here, 'SellerIntelligence.tsx'), 'utf8')
const registry = readFileSync(resolve(here, '../../../config/featureRegistry.ts'), 'utf8')
const app = readFileSync(resolve(here, '../../../App.tsx'), 'utf8')

describe('Seller master Phase N — decision-grade intelligence surface', () => {
  it('is a first-class Seller workspace, not the Gutu AI records page', () => {
    expect(registry).toContain("id: 'owner.intelligence'")
    expect(registry).toContain("route: '/dashboard/intelligence'")
    expect(app).toContain('SellerIntelligence')
    expect(app).toContain('path="/dashboard/intelligence"')
  })

  it('renders governed KPIs, time series, funnel, listing comparison and response state', () => {
    expect(page).toContain('seller-intelligence-kpi-band')
    expect(page).toContain('seller-intelligence-time-series')
    expect(page).toContain('seller-intelligence-funnel')
    expect(page).toContain('seller-intelligence-listing-comparison')
    expect(page).toContain('Response state')
    expect(page).toContain('Inquiry distribution')
  })

  it('refuses to fabricate unsupported geographic/source/price-response analytics', () => {
    expect(page).toContain('Discovery sources')
    expect(page).toContain('Geographic interest')
    expect(page).toContain('Price-change response')
    expect(page).toContain('Not tracked in the current Seller projection')
    expect(page).toContain('listing completeness · not Trust')
  })

  it('keeps unread/unmeasured metrics distinct from measured zero', () => {
    expect(page).toContain('displayMetric')
    expect(page).toContain('envelopeMessage')
    expect(page).toContain('These figures are unavailable, not zero')
    expect(page).not.toContain("|| 0}</")
  })
})
