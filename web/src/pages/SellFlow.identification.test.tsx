/**
 * Seller Journey 1.0 / S1 — existing-Passport detection is WIRED, not merely implemented.
 *
 * A prior CarUp lane shipped a correct collaborator whose production path was dead by construction.
 * These tests render the real Sell surfaces and assert the seller actually sees the S1 result, so
 * the detector cannot regress into an unreferenced module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const lookupVehiclePassport = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    lookupVehiclePassport,
    createVehicleListing: vi.fn(),
    uploadVehicleImages: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}))

vi.mock('@/components/VehicleCompletenessPanel', () => ({
  VehicleCompletenessPanel: () => null,
}))

const GuestSell = (await import('./GuestSell')).default
const SellVehicle = (await import('./dashboard/owner/SellVehicle')).default

const EXISTING_VIN = 'JTDKARFP0H3000731'

const renderGuest = () => {
  const rendered = render(<MemoryRouter><GuestSell /></MemoryRouter>)
  fireEvent.click(screen.getByTestId('sell-intent-known'))
  return rendered
}
const renderAuthenticated = () => render(<MemoryRouter><SellVehicle /></MemoryRouter>)

beforeEach(() => {
  lookupVehiclePassport.mockReset()
  sessionStorage.clear()
})

describe.each([
  ['guest sell', renderGuest, 'guest-sell-vin'],
  ['authenticated sell', renderAuthenticated, 'vehicle-vin-input'],
])('S1 identification on %s', (_name, renderSurface, vinTestId) => {
  it('warns the seller before form investment when CarUp already holds a Passport', async () => {
    lookupVehiclePassport.mockResolvedValue({
      vehicle: { vin: EXISTING_VIN, make: 'Toyota', model: 'Hilux', year: 2021, price: 18000, mileage: 42000 },
    })
    renderSurface()

    fireEvent.change(screen.getByTestId(vinTestId), { target: { value: EXISTING_VIN } })

    await waitFor(() => expect(screen.getByTestId('sell-vin-passport-exists')).toBeTruthy(), { timeout: 3000 })
    expect(lookupVehiclePassport).toHaveBeenCalledWith(EXISTING_VIN)

    const notice = screen.getByTestId('sell-vin-passport-exists').textContent || ''
    expect(notice).toContain('already holds a Vehicle Passport')
    expect(screen.getByTestId('sell-vin-passport-described').textContent).toContain('2021 Toyota Hilux')
    // Seller-stated dimensions from the existing record must never be surfaced as this seller's.
    expect(notice).not.toContain('18000')
    expect(notice).not.toContain('42000')
  })

  it('never claims the vehicle does not exist when CarUp simply has no record', async () => {
    lookupVehiclePassport.mockRejectedValue(new Error('404 VIN not found'))
    renderSurface()

    fireEvent.change(screen.getByTestId(vinTestId), { target: { value: EXISTING_VIN } })

    await waitFor(() => expect(screen.getByTestId('sell-vin-no-carup-record')).toBeTruthy(), { timeout: 3000 })
    const notice = screen.getByTestId('sell-vin-no-carup-record').textContent || ''
    expect(notice).toContain('CarUp holds no Passport for this VIN')
    expect(notice).not.toMatch(/does not exist|never registered|new vehicle/i)
  })

  it('degrades to an advisory notice — never a block — when the check is unreachable', async () => {
    lookupVehiclePassport.mockRejectedValue(new TypeError('Failed to fetch'))
    renderSurface()

    fireEvent.change(screen.getByTestId(vinTestId), { target: { value: EXISTING_VIN } })

    await waitFor(() => expect(screen.getByTestId('sell-vin-check-unavailable')).toBeTruthy(), { timeout: 3000 })
    expect(screen.getByTestId('sell-vin-check-unavailable').textContent).toContain('could not check')
  })

  it('does not look up an incomplete VIN', async () => {
    renderSurface()
    fireEvent.change(screen.getByTestId(vinTestId), { target: { value: 'JTDKARFP0H30' } })
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(lookupVehiclePassport).not.toHaveBeenCalled()
    expect(screen.queryByTestId('sell-vin-passport-exists')).toBeNull()
  })
})
