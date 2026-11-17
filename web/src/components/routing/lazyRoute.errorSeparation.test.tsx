/**
 * RX07-CERT-02 F1 — the per-page chunk boundary owns DOWNLOAD failures only. A page's own runtime
 * failure must reach the boundary that owned it before RX-07: the Seller recovery screen (with its
 * draft guidance), ShowroomRoute's boundary, or — for unguarded pages — the app, exactly as at R5.
 */
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { lazyRoute } from './lazyRoute'
import { LazyRouteBoundary, isChunkLoadError } from './LazyRouteBoundary'
import { SellerRouteErrorBoundary } from '@/components/sell/SellerRouteErrorBoundary'
import { clearGuestSellDraft, readGuestSellDraft, saveGuestSellDraft, GUEST_SELL_DURABLE_DRAFT_KEY } from '@/lib/guestSellDraft'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/SellVehicle-abc.js')
const SellerPage = () => <h1>Seller page</h1>
const Crashing = () => { throw new Error('Seller form exploded while rendering') }

class Outermost extends Component<{ children: ReactNode }, { caught: string | null }> {
  state = { caught: null as string | null }
  static getDerivedStateFromError(error: Error) { return { caught: error.message } }
  render() { return this.state.caught ? <p data-testid="outermost">{this.state.caught}</p> : this.props.children }
}

const DRAFT = {
  submissionId: '123e4567-e89b-42d3-a456-426614174000', make: 'Toyota', model: 'Hilux', year: '2021', vin: 'JTDKARFP0H3000731',
  color: 'White', mileage: '45000', condition: 'Used', category: 'Pickup', fuelType: 'Diesel', transmission: 'Automatic',
  drivetrain: '4WD', location: 'Harare', province: 'Harare', price: '28500', currency: 'USD',
  description: 'Synthetic seller draft used only to prove the recovery copy survives a crash.', engineNumber: '', chassisNumber: '',
  plateNumber: '', tempPlateId: '', registrationStatus: '', importStatus: '', features: ['Reverse camera'], images: [], imageLabels: [],
  coverImageIndex: null, historyPlan: {}, accidentDisclosure: null, insuranceDisclosure: null, financeDisclosure: null,
}

let quiet: Array<{ mockRestore: () => void }> = []
beforeEach(() => { quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})] })
afterEach(() => { quiet.forEach(s => s.mockRestore()); clearGuestSellDraft(); sessionStorage.clear(); localStorage.clear() })

describe('isChunkLoadError', () => {
  it.each([
    ['Failed to fetch dynamically imported module: https://x/assets/a.js', true],
    ['error loading dynamically imported module', true],
    ['Importing a module script failed.', true],
    ['Unable to preload CSS for /assets/VehicleSilhouette-x.css', true],
    ['Seller form exploded while rendering', false],
    ["Cannot read properties of undefined (reading 'vin')", false],
  ])('%s → %s', (message, chunk) => expect(isChunkLoadError(new Error(message))).toBe(chunk))
})

describe('F1 — Seller route keeps its own failure handling', () => {
  it('a Seller RUNTIME failure reaches the Seller recovery screen (not the generic download screen)', async () => {
    const Sell = lazyRoute(async () => ({ default: Crashing }), 'SellVehicle')
    render(<MemoryRouter><SellerRouteErrorBoundary><Sell /></SellerRouteErrorBoundary></MemoryRouter>)
    expect(await screen.findByTestId('seller-route-recovery')).toHaveTextContent('This Seller page stopped rendering')
    expect(screen.queryByTestId('lazy-route-error')).toBeNull()
  })

  it('the browser draft survives the crash and the Seller screen says a recovery copy is present', async () => {
    expect((await saveGuestSellDraft(DRAFT)).ok).toBe(true)
    const before = localStorage.getItem(GUEST_SELL_DURABLE_DRAFT_KEY)
    const Sell = lazyRoute(async () => ({ default: Crashing }), 'SellVehicle')
    render(<MemoryRouter><SellerRouteErrorBoundary><Sell /></SellerRouteErrorBoundary></MemoryRouter>)
    expect(await screen.findByTestId('seller-route-recovery')).toHaveTextContent('A browser recovery copy is present')
    expect(localStorage.getItem(GUEST_SELL_DURABLE_DRAFT_KEY)).toBe(before)
    expect(readGuestSellDraft()?.vin).toBe('JTDKARFP0H3000731')
  })

  it('a Seller DOWNLOAD failure shows the retryable download screen, and Retry recovers after the network returns', async () => {
    let online = false
    const importer = vi.fn(async () => { if (!online) throw chunkError(); return { default: SellerPage } })
    // Retry re-imports the failed chunk URL (browsers cache a failed module fetch); stand in for the network.
    const importUrl = vi.fn(async () => { if (!online) throw chunkError(); return { default: SellerPage } })
    const Sell = lazyRoute(importer, 'SellVehicle', { importUrl })
    render(<MemoryRouter><SellerRouteErrorBoundary><Sell /></SellerRouteErrorBoundary></MemoryRouter>)
    expect(await screen.findByTestId('lazy-route-error')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('seller-route-recovery')).toBeNull()
    online = true
    await userEvent.click(screen.getByTestId('lazy-route-retry'))
    expect(await screen.findByRole('heading', { name: 'Seller page' })).toBeInTheDocument()
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importUrl).toHaveBeenCalledTimes(1)
  })
})

describe('F1 — other owners of page failures are as at R5', () => {
  it('a showroom page runtime failure is handled by ShowroomRoute’s own (catch-all) boundary, as at R5', async () => {
    const Page = lazyRoute(async () => ({ default: Crashing }), 'ShowroomLanding')
    render(<MemoryRouter><LazyRouteBoundary><Page /></LazyRouteBoundary></MemoryRouter>)
    expect(await screen.findByTestId('lazy-route-error')).toBeInTheDocument()
  })

  it('an unguarded page runtime failure propagates (never swallowed into a retry shell)', async () => {
    const Page = lazyRoute(async () => ({ default: Crashing }), 'About')
    render(<MemoryRouter><Outermost><Page /></Outermost></MemoryRouter>)
    expect(await screen.findByTestId('outermost')).toHaveTextContent('Seller form exploded while rendering')
    expect(screen.queryByTestId('lazy-route-error')).toBeNull()
  })
})

describe('F1 — repeated failure never becomes an uncontrolled download loop', () => {
  it('each Retry is exactly one attempt; nothing retries on its own', async () => {
    const importer = vi.fn(async () => { throw chunkError() })
    const importUrl = vi.fn(async () => { throw chunkError() })
    const Page = lazyRoute(importer, 'About', { importUrl })
    render(<MemoryRouter><Page /></MemoryRouter>)
    await screen.findByTestId('lazy-route-error')
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByTestId('lazy-route-retry'))
      await screen.findByTestId('lazy-route-error')
    }
    await new Promise(r => setTimeout(r, 300))
    expect(importer.mock.calls.length + importUrl.mock.calls.length).toBe(4)
    expect(screen.getByTestId('lazy-route-reload')).toBeInTheDocument()
  })
})
