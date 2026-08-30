/**
 * Seller Journey 1.0 / S6 — the preview is the buyer's own control, wired into the page.
 *
 * The preview MODEL is proven by execution in `lib/sellerListingPreview.test.ts` — including that
 * an unentered mileage stays null rather than becoming "0 km". This file proves the PAGE actually
 * uses it, because "reuse the actual Marketplace listing card" is a claim about the rendered page,
 * and a correct helper nobody mounts would satisfy none of it.
 *
 * Scope note, stated rather than implied: the guest preview is step 4 of 4, and steps 2–3 gate on
 * Radix `Select` fields that `fireEvent.change` cannot drive. The wiring assertions below are
 * therefore source-level; the rendered preview itself is exercised by the unmocked staging
 * certification in `e2e/`. What is checked here is precisely what source can prove — the buyer's
 * component is imported, mounted with the shared model, and the bespoke layout it replaced is gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SOURCE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'GuestSell.tsx'), 'utf8')

/**
 * Source assertions target CODE, not prose. GuestSell.tsx documents the defect it removed by
 * quoting it, and a comment naming a fault is the opposite of committing it — so comments are
 * stripped before matching. (Same helper, same reason, as VehicleDetail.media.test.tsx.)
 */
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

vi.setConfig({ testTimeout: 30_000 })

const lookupVehiclePassport = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ lookupVehiclePassport }) }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const GuestSell = (await import('./GuestSell')).default

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  sessionStorage.clear()
  lookupVehiclePassport.mockRejectedValue(new Error('404 VIN not found'))
})

describe('S6 guest buyer preview', () => {
  it('advances out of vehicle details on the entries the step validates', async () => {
    render(<MemoryRouter><GuestSell /></MemoryRouter>)
    for (const [testId, value] of Object.entries({
      'guest-sell-make': 'Toyota',
      'guest-sell-model': 'Hilux',
      'guest-sell-year': '2021',
      'guest-sell-vin': 'JTDKARFP0H3000731',
      'guest-sell-color': 'White',
    })) {
      fireEvent.change(screen.getByTestId(testId), { target: { value } })
    }
    await waitFor(() => expect(screen.getByTestId('sell-vin-no-carup-record')).toBeTruthy(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByTestId('guest-sell-listing-step')).toBeTruthy())
  })

  it('mounts the real Marketplace card with the shared draft model', () => {
    expect(SOURCE).toContain("from '@/components/marketplace/MarketplaceListingCard'")
    expect(SOURCE).toContain('<MarketplaceListingCard')
    expect(SOURCE).toContain('sellerDraftToCardModel(form)')
    expect(SOURCE).toContain('guest-sell-preview-card')
  })

  it('has no bespoke preview layout left to drift from the buyer view', () => {
    // `PreviewFact` existed only to render the approximate preview S6 forbids. Its removal is the
    // evidence that the old model is gone rather than merely bypassed.
    expect(CODE).not.toContain('function PreviewFact')
    expect(CODE).not.toContain('<PreviewFact')
  })

  it('no longer coerces an unentered mileage into a fabricated zero', () => {
    // The exact expression that printed "0 km" for a seller who had entered nothing. Checked
    // against code with comments stripped, because the page now quotes the defect to explain it.
    expect(CODE).not.toContain('Number(form.mileage || 0)')
    expect(CODE).toContain('sellerDraftToCardModel(form)')
  })

  it('shows the discoverability summary and names what an unanswered filter costs', () => {
    expect(SOURCE).toContain('guest-sell-discoverability')
    expect(SOURCE).toContain('Buyers can find this by')
    expect(SOURCE).toContain('A filter you have not answered will not match this listing')
    expect(SOURCE).toContain('sellerDiscoverabilityFacets(form)')
  })
})
