import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { VehicleCapabilities } from '@/types'

/**
 * T11-CAP-LR01-R3 (Step F) — Serena and Vezel are two vehicles in ONE Garage, not two kinds of product.
 *
 * Both cards share the same base grammar: identity first, then Relationship / Marketplace / Garage record. Their capabilities
 * differ only where the facts differ: the Serena is published and has no import journey (so the card says nothing about
 * imports); the Vezel is not listed and has one (so the card gains a Trade & Imports row and a View CAP action). There is no
 * "imported vehicle" card class. Every capability arrives from the server; the card derives nothing from the row.
 */

const SERENA = 'GFC27-027051'
const VEZEL = 'RU3-1316558'
const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'

const fetchOwnedVehicles = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchOwnedVehicles }) }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1', name: 'Kingston Musarurwa', email: 'owner@staging.carup.local', role: 'owner' }, isAuthenticated: true, loading: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const MyGarage = (await import('./MyGarage')).default

const base = (vin: string, over: Record<string, unknown> = {}) => ({
  vin, year: 2018, make: 'Honda', model: 'Vezel', color: 'Pearl', mileage: 134741, price: 0, currency: null, status: 'Pending',
  created_at: '2026-10-25T00:00:00.000Z', publication_status: 'draft', owner_id: 'owner-1', current_seller_id: null,
  listing_media: { state: 'none', items: [], unpublishable_count: 0, empty_statement: null },
  trust: { vin, score: null, band: null, evaluation_state: 'not_evaluated', confidence: 'not_evaluated', evidence_basis: null, calculation_version: null, evaluated_at: null, known_limitations: [], source: 'cache' },
  ...over,
})
const serena = (capabilities?: VehicleCapabilities) => base(SERENA, {
  year: 2016, make: 'Nissan', model: 'Serena Highway Star', status: 'Available', publication_status: 'published', price: 12800, currency: 'USD', current_seller_id: 'owner-1',
  ...(capabilities ? { capabilities } : {}),
})
const vezel = (capabilities?: VehicleCapabilities) => base(VEZEL, capabilities ? { capabilities } : {})

const SERENA_CAPS: VehicleCapabilities = { marketplace: { state: 'published' }, trade_import: { state: 'none' } }
const VEZEL_CAPS: VehicleCapabilities = { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: ORDER } }

const renderGarage = async (rows: unknown[]) => {
  fetchOwnedVehicles.mockResolvedValue(rows)
  render(<MemoryRouter><MyGarage /></MemoryRouter>)
  await screen.findByTestId('owner-vehicles-table')
}
const card = (vin: string) => screen.getByTestId(`vehicle-row-${vin}`)

beforeEach(() => { vi.clearAllMocks(); cleanup() })

describe('Serena — an owned vehicle with a local Marketplace sale', () => {
  it('says it is published, offers Manage listing, and says nothing about imports', async () => {
    await renderGarage([serena(SERENA_CAPS)])
    const c = card(SERENA)
    expect(within(c).getByTestId(`garage-marketplace-${SERENA}`)).toHaveAttribute('data-state', 'published')
    expect(within(c).getByTestId(`garage-marketplace-${SERENA}`)).toHaveTextContent('Published on Marketplace')
    expect(within(c).getByTestId(`garage-manage-${SERENA}`)).toHaveAttribute('href', '/dashboard/listings')
    expect(within(c).getByTestId(`garage-manage-${SERENA}`)).toHaveTextContent('Manage listing')
    expect(within(c).queryByTestId(`garage-trade-${SERENA}`)).toBeNull()
    expect(within(c).queryByTestId(`garage-cap-${SERENA}`)).toBeNull()
    expect(c.textContent).not.toMatch(/CAP\b|import journey|import order|Trade & Imports/i)
  })

  it('stays a summary: one Marketplace action on the card — the Studio edit entry lives on the Passport', async () => {
    await renderGarage([serena(SERENA_CAPS)])
    expect(card(SERENA).textContent).not.toMatch(/Edit listing details/)
    expect(within(card(SERENA)).queryByTestId(`garage-edit-details-${SERENA}`)).toBeNull()
  })
})

describe('Vezel — an owned vehicle with one import journey and no listing', () => {
  it('says it is not listed, offers Sell this vehicle, and adds a Trade & Imports row with View CAP', async () => {
    await renderGarage([vezel(VEZEL_CAPS)])
    const c = card(VEZEL)
    expect(within(c).getByTestId(`garage-marketplace-${VEZEL}`)).toHaveAttribute('data-state', 'not_listed')
    expect(within(c).getByTestId(`garage-marketplace-${VEZEL}`)).toHaveTextContent('Not listed')
    expect(within(c).getByTestId(`garage-sell-${VEZEL}`)).toHaveAttribute('href', `/dashboard/sell-vehicle?vin=${VEZEL}`)
    expect(within(c).getByTestId(`garage-trade-${VEZEL}`)).toHaveTextContent('Import journey available')
    expect(within(c).getByTestId(`garage-cap-${VEZEL}`)).toHaveAttribute('href', `/diaspora/journey/import_order/${ORDER}`)
    expect(within(c).getByTestId(`garage-cap-${VEZEL}`)).toHaveTextContent('View CAP')
  })

  it('does not call a never-listed vehicle "Pending availability" — that word describes a listing', async () => {
    await renderGarage([vezel(VEZEL_CAPS)])
    const status = screen.getByTestId(`vehicle-status-${VEZEL}`)
    expect(status).toHaveTextContent('no Marketplace listing')
    expect(status.textContent).not.toMatch(/Availability|Pending/)
  })

  it('still names a published vehicle\'s availability', async () => {
    await renderGarage([serena(SERENA_CAPS)])
    expect(screen.getByTestId(`vehicle-status-${SERENA}`)).toHaveTextContent('Availability: Available')
  })
})

describe('the two cards share ONE base grammar', () => {
  it('both have the same three base cells in the same order; only the facts and the optional Trade row differ', async () => {
    await renderGarage([serena(SERENA_CAPS), vezel(VEZEL_CAPS)])
    const labels = (vin: string) => Array.from(card(vin).querySelectorAll('[class*="gap-px"] > div p:first-child')).map((p) => p.textContent)
    expect(labels(SERENA)).toEqual(['Relationship', 'Marketplace', 'Garage record'])
    expect(labels(VEZEL)).toEqual(['Relationship', 'Marketplace', 'Garage record', 'Trade & Imports'])
    // Same identity treatment: a vehicle heading, the VIN over the photograph, a Vehicle Passport link and exactly one Marketplace action.
    for (const vin of [SERENA, VEZEL]) {
      const c = card(vin)
      expect(within(c).getByRole('heading', { level: 2 })).toBeInTheDocument()
      expect(within(c).getByRole('link', { name: /View Vehicle Passport/ })).toHaveAttribute('href', `/dashboard/garage/${vin}`)
      expect(c.querySelectorAll('[data-testid^="garage-manage-"],[data-testid^="garage-sell-"],[data-testid^="garage-continue-"],[data-testid^="garage-view-listing-"]')).toHaveLength(1)
    }
  })

  it('there is no imported-vehicle card class: a Vezel with the Serena\'s facts renders like the Serena', async () => {
    const listedVezel = base(VEZEL, { publication_status: 'published', status: 'Available', current_seller_id: 'owner-1', price: 12800, currency: 'USD', capabilities: SERENA_CAPS })
    await renderGarage([listedVezel])
    const c = card(VEZEL)
    expect(within(c).getByTestId(`garage-manage-${VEZEL}`)).toBeInTheDocument()
    expect(within(c).queryByTestId(`garage-trade-${VEZEL}`)).toBeNull()
  })
})

describe('the other Marketplace states', () => {
  it.each([
    ['in_progress', 'Listing in progress', 'garage-continue-', 'Continue listing', `/dashboard/sell-vehicle?vin=${VEZEL}`],
    ['sold', 'Sold', 'garage-view-listing-', 'View listing', '/dashboard/listings'],
  ] as const)('%s', async (state, label, idPrefix, actionLabel, href) => {
    await renderGarage([vezel({ marketplace: { state }, trade_import: { state: 'none' } })])
    expect(within(card(VEZEL)).getByTestId(`garage-marketplace-${VEZEL}`)).toHaveTextContent(label)
    const action = within(card(VEZEL)).getByTestId(`${idPrefix}${VEZEL}`)
    expect(action).toHaveTextContent(actionLabel)
    expect(action).toHaveAttribute('href', href)
  })
})

describe('reads that failed are shown as failed — never as "none" or "not listed"', () => {
  it('an unreadable listing state offers no listing action, but the Passport and the CAP stay reachable', async () => {
    await renderGarage([vezel({ marketplace: { state: 'unavailable' }, trade_import: { state: 'single', order_id: ORDER } })])
    const c = card(VEZEL)
    expect(within(c).getByTestId(`garage-marketplace-${VEZEL}`)).toHaveAttribute('data-state', 'unavailable')
    expect(within(c).queryByTestId(`garage-sell-${VEZEL}`)).toBeNull()
    expect(within(c).getByTestId(`garage-cap-${VEZEL}`)).toBeInTheDocument()
    expect(within(c).getByRole('link', { name: /View Vehicle Passport/ })).toBeInTheDocument()
  })

  it('an unreadable import status says it could not be checked and offers no CAP action', async () => {
    await renderGarage([vezel({ marketplace: { state: 'not_listed' }, trade_import: { state: 'unavailable' } })])
    const trade = within(card(VEZEL)).getByTestId(`garage-trade-${VEZEL}`)
    expect(trade).toHaveAttribute('data-state', 'unavailable')
    expect(trade).toHaveTextContent(/not a report that there are none/)
    expect(within(card(VEZEL)).queryByTestId(`garage-cap-${VEZEL}`)).toBeNull()
    expect(within(card(VEZEL)).getByTestId(`garage-sell-${VEZEL}`)).toBeInTheDocument()
  })

  it('several import journeys: one chooser, no pick', async () => {
    await renderGarage([vezel({ marketplace: { state: 'not_listed' }, trade_import: { state: 'multiple', count: 2 } })])
    const choose = within(card(VEZEL)).getByTestId(`garage-choose-journey-${VEZEL}`)
    expect(choose).toHaveTextContent('Choose import journey')
    expect(choose).toHaveAttribute('href', `/diaspora/journey/vehicle/${VEZEL}`)
  })

  it('no capabilities sent at all: says the listing state is not loaded and offers neither a listing action nor a CAP action', async () => {
    await renderGarage([vezel()])
    const c = card(VEZEL)
    expect(within(c).getByTestId(`garage-marketplace-${VEZEL}`)).toHaveAttribute('data-state', 'not_loaded')
    expect(within(c).getByTestId(`garage-marketplace-${VEZEL}`)).toHaveTextContent('Listing state not loaded')
    expect(within(c).queryByTestId(`garage-sell-${VEZEL}`)).toBeNull()
    expect(within(c).queryByTestId(`garage-trade-${VEZEL}`)).toBeNull()
    expect(within(c).getByRole('link', { name: /View Vehicle Passport/ })).toBeInTheDocument()
  })
})

describe('where am I', () => {
  it('names the workspace and keeps a way out that is not the browser Back button', async () => {
    await renderGarage([serena(SERENA_CAPS)])
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'vehicles')
    expect(screen.getByRole('heading', { level: 1, name: 'My Garage' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
    // …and the other two workspaces are one tap away.
    const bar = screen.getByTestId('workspace-bar')
    expect(within(bar).getByRole('link', { name: 'Marketplace' })).toHaveAttribute('href', '/dashboard/listings')
    expect(within(bar).getByRole('link', { name: 'Trade & Imports' })).toHaveAttribute('href', '/diaspora/imports')
  })

  it('waits for the read: an unreadable Garage is not shown as an empty one', async () => {
    fetchOwnedVehicles.mockRejectedValue(new Error('down'))
    render(<MemoryRouter><MyGarage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your Garage could not be read.'))
    expect(screen.queryByTestId('owner-vehicles-table')).toBeNull()
  })
})
