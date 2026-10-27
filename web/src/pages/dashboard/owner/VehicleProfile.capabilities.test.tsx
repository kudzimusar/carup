import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { VehicleCapabilities } from '@/types'

/**
 * T11-CAP-LR01-R3 — the Vehicle Passport shows what THIS vehicle can do, not a row of unrelated buttons.
 *
 * R1 made "Journey & arrival" reachable from every vehicle's page with one link, "because the Journey page itself
 * says which of those it is". The R3 authority (§8, §16) supersedes that: a CAP action follows a real, readable
 * import journey, so a vehicle with none — the Serena — is not offered one, and a vehicle whose import status could
 * not be read is not told it has none.
 *
 *   Serena   owned vehicle + local Marketplace sale   -> Marketplace only; no CAP action, no hint of an import
 *   Vezel    owned vehicle + one import journey       -> two independent capabilities, "View CAP" on the order
 *   several  more than one readable import order      -> a chooser, never a pick
 *   failed   the import check could not be read       -> an honest fault; never "no journey"
 *   absent   the server sent no capabilities          -> nothing (not the owner): never an empty panel
 */

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()

// A later lineage's VehicleProfile also reads the owner's management scope and the governed service history; an older
// one never calls these, so providing them costs nothing and the same test holds on both.
const fetchOwnedVehicles = vi.fn()
const fetchServiceHistory = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchVehiclePassport, fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources, fetchOwnedVehicles, fetchServiceHistory }),
}))

const route = vi.hoisted(() => ({ id: 'VIN-WITH/SLASH 1' }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: route.id }) }
})

const VehicleProfile = (await import('./VehicleProfile')).default

const SERENA = 'GFC27-027051'
const VEZEL = 'RU3-1316558'
const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'

const passport = (vin: string, capabilities?: VehicleCapabilities | null, vehicle: Record<string, unknown> = {}) => ({
  vehicle: { vin, make: 'AnyMake', model: 'AnyModel', year: 2016, mileage: 63000, color: 'Maroon', price: 0, ...vehicle },
  ...(capabilities === undefined ? {} : { capabilities }),
  claims: {}, timeline: [], evidenceTimeline: [], chainVerification: { verified: false },
  trustReport: {
    score: 50, band: 'moderate', evaluation_state: 'evaluated', confidence: 'low', calculation_version: 'trust-decision-1.0.0',
    evaluated_at: '2026-08-24T02:35:46.874+00:00', known_limitations: [],
    evidence_basis: { governed_facts_total: 0, governed_facts_substantiated: 0, governed_facts_adverse: 0, connected_sources: 0, unbacked_legacy_claims: 0 },
  },
})

const show = async (vin: string, capabilities?: VehicleCapabilities | null, vehicle?: Record<string, unknown>) => {
  route.id = vin
  fetchVehiclePassport.mockResolvedValue(passport(vin, capabilities, vehicle))
  render(<MemoryRouter><VehicleProfile /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchVehicleEvidence.mockResolvedValue([])
  fetchOwnedVehicles.mockImplementation(async () => [{ vin: route.id }])
  fetchServiceHistory.mockResolvedValue([])
})

describe('Serena — an owned vehicle with a local Marketplace sale', () => {
  const capabilities: VehicleCapabilities = { marketplace: { state: 'published' }, trade_import: { state: 'none' } }

  it('shows the Marketplace state and its action, and offers NO import journey', async () => {
    await show(SERENA, capabilities, { make: 'Nissan', model: 'Serena Highway Star', year: 2016 })
    const panel = screen.getByTestId('vehicle-capability-panel')
    expect(within(panel).getByTestId('capability-marketplace')).toHaveAttribute('data-state', 'published')
    expect(within(panel).getByRole('link', { name: /Manage listing/ })).toHaveAttribute('href', '/dashboard/listings')
    // No CAP action anywhere on the page — not hidden, not disabled: absent.
    expect(screen.queryByTestId('vehicle-journey-link')).toBeNull()
    expect(screen.queryByTestId('capability-action-view-cap')).toBeNull()
    expect(screen.queryByTestId('capability-trade-import')).toBeNull()
    expect(screen.queryByRole('link', { name: /journey|CAP/i })).toBeNull()
    expect(screen.queryByText(/Journey & arrival/i)).toBeNull()
  })

  it('does not imply an import journey is missing or broken', async () => {
    await show(SERENA, capabilities)
    expect(within(screen.getByTestId('vehicle-capability-panel')).queryByText(/import|journey|shipment|CAP\b/i)).toBeNull()
  })
})

describe('Vezel — an owned vehicle with one import journey', () => {
  const capabilities: VehicleCapabilities = { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: ORDER } }

  it('shows two independent capabilities, each with its own state and action', async () => {
    await show(VEZEL, capabilities, { make: 'Honda', model: 'Vezel', year: 2018 })
    expect(screen.getByTestId('capability-marketplace')).toHaveAttribute('data-state', 'not_listed')
    expect(screen.getByTestId('capability-trade-import')).toHaveAttribute('data-state', 'single')
    expect(screen.getByRole('link', { name: /Sell this vehicle/ })).toHaveAttribute('href', `/dashboard/sell-vehicle?vin=${VEZEL}`)
    // View CAP goes to THE order — the Trade & Imports journey — not to a vehicle guess.
    expect(screen.getByTestId('capability-action-view-cap')).toHaveAttribute('href', `/diaspora/journey/import_order/${ORDER}`)
    expect(screen.getByTestId('capability-action-view-cap')).toHaveTextContent('View CAP')
    expect(screen.getByRole('link', { name: 'Import order' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
  })

  it('the old universal action is gone from this page', async () => {
    await show(VEZEL, capabilities)
    expect(screen.queryByTestId('vehicle-journey-link')).toBeNull()
    expect(screen.queryByText(/Journey & arrival/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /Edit \/ continue listing|Listing & Marketplace/ })).toBeNull()
  })

  it('publishing the vehicle does not touch the import capability, and having an import does not touch the listing', async () => {
    await show(VEZEL, { marketplace: { state: 'published' }, trade_import: { state: 'single', order_id: ORDER } })
    expect(screen.getByTestId('capability-action-view-cap')).toHaveAttribute('href', `/diaspora/journey/import_order/${ORDER}`)
    expect(screen.getByRole('link', { name: /Manage listing/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sell this vehicle/ })).toBeNull()
  })

  it('encodes an unusual frame number in the listing action', async () => {
    await show('RA/9 9', capabilities)
    expect(screen.getByRole('link', { name: /Sell this vehicle/ })).toHaveAttribute('href', '/dashboard/sell-vehicle?vin=RA%2F9%209')
  })
})

describe('several readable import orders — a chooser, never a guess', () => {
  it('offers one link to the chooser and names no order', async () => {
    await show(VEZEL, { marketplace: { state: 'not_listed' }, trade_import: { state: 'multiple', count: 2 } })
    const choose = screen.getByRole('link', { name: /Choose import journey/ })
    expect(choose).toHaveAttribute('href', `/diaspora/journey/vehicle/${VEZEL}`)
    expect(screen.queryByTestId('capability-action-view-cap')).toBeNull()
    expect(screen.getByTestId('capability-trade-import')).toHaveTextContent('2 import journeys')
  })
})

describe('a check that could not be read is not "none"', () => {
  it('an unreadable import status is shown as a fault with no CAP link, while the listing state is still shown', async () => {
    await show(VEZEL, { marketplace: { state: 'not_listed' }, trade_import: { state: 'unavailable' } })
    const trade = screen.getByTestId('capability-trade-import')
    expect(trade).toHaveAttribute('data-state', 'unavailable')
    expect(trade).toHaveTextContent(/not a report that there are none/)
    expect(screen.queryByTestId('capability-action-view-cap')).toBeNull()
    expect(screen.getByRole('link', { name: /Sell this vehicle/ })).toBeInTheDocument()
  })

  it('an unreadable listing state offers no listing action and does not hide a real import journey', async () => {
    await show(VEZEL, { marketplace: { state: 'unavailable' }, trade_import: { state: 'single', order_id: ORDER } })
    expect(screen.getByTestId('capability-marketplace')).toHaveAttribute('data-state', 'unavailable')
    expect(screen.queryByRole('link', { name: /Sell this vehicle|Continue listing|Manage listing/ })).toBeNull()
    expect(screen.getByTestId('capability-action-view-cap')).toBeInTheDocument()
  })
})

describe('no capabilities sent (not the vehicle\'s owner or seller)', () => {
  it.each([[undefined], [null]])('capabilities=%s: no panel and no capability action at all — the Passport itself is unaffected', async (capabilities) => {
    await show('OTHERS-0001', capabilities)
    expect(screen.queryByTestId('vehicle-capability-panel')).toBeNull()
    expect(screen.queryByRole('link', { name: /CAP|Manage listing|Sell this vehicle|Continue listing/ })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    cleanup()
  })
})

describe('where am I, what am I working on, where did I come from', () => {
  it('names the workspace, the vehicle and the parent — with exactly one heading level 1', async () => {
    await show(VEZEL, { marketplace: { state: 'not_listed' }, trade_import: { state: 'none' } }, { make: 'Honda', model: 'Vezel', year: 2018 })
    // where: the workspace layer says My Vehicles
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'vehicles')
    // what: the vehicle, named once as the page heading, and its frame number in full
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('2018 Honda Vezel')
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'vehicle-passport-title')
    expect(headings[0]).toHaveAttribute('id', 'vehicle-passport-title')
    expect(screen.getByTestId('seller-workspace-object')).toHaveTextContent(`VIN ${VEZEL}`)
    // from: an explicit parent and a trail that ends in the vehicle
    expect(screen.getByRole('link', { name: 'Back to My Garage' })).toHaveAttribute('href', '/dashboard/garage')
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'My Vehicles' })).toHaveAttribute('href', '/dashboard/garage')
    expect(within(trail).getByText('2018 Honda Vezel')).toHaveAttribute('aria-current', 'page')
  })

  it('uses the Seller header grammar (the same component My Garage and Seller Studio use)', async () => {
    await show(VEZEL, undefined)
    expect(screen.getByTestId('seller-workspace-header')).toBeInTheDocument()
  })
})

describe('an import order offers its Journey too', () => {
  it('links the order detail page to /diaspora/journey/import_order/<id>', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../diaspora/DiasporaTrade.tsx'), 'utf8')
    expect(src).toMatch(/data-testid="diaspora-open-journey-button"/)
    expect(src).toMatch(/to=\{`\/diaspora\/journey\/import_order\/\$\{encodeURIComponent\(order\.id\)\}`\}/)
  })
})
