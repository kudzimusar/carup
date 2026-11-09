/**
 * R7 — `/dashboard/garage/:vin` is a private management workspace, not a VIN viewer.
 *
 * THE DEFECT THIS PINS. Owner UAT signed in as one owner and opened another owner's VIN on this
 * route. The Passport rendered inside the private portal — mileage, asking price, service count —
 * with an "Edit / continue listing" button that navigated to Seller Studio for a car the signed-in
 * user has no relationship with.
 *
 * CarUp's lookup policy deliberately makes exact-VIN passport reads public, and that decision is
 * untouched here: the public vehicle page is offered by name. What is refused is presenting a
 * stranger's vehicle as part of THIS account's garage, with owner affordances attached.
 *
 * Scope failure is closed, not open: while ownership is unknown — still loading, or the read
 * failed — no management control renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import VehicleProfile from './VehicleProfile'

const MINE = 'OWNEDVIN000000001'
const THEIRS = 'FOREIGNVIN0000001'

const fetchOwnedVehicles = vi.fn()
const fetchVehiclePassport = vi.fn()
const fetchServiceHistory = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchOwnedVehicles, fetchVehiclePassport, fetchServiceHistory,
    fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources,
    user: { id: 'u_owner', role: 'owner' },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  fetchOwnedVehicles.mockResolvedValue([{ vin: MINE, make: 'Isuzu', model: 'D-Max', owner_id: 'u_owner' }])
  fetchServiceHistory.mockResolvedValue([])
  fetchVehicleEvidence.mockResolvedValue([])
  fetchEvidenceTaxonomy.mockResolvedValue({ version: 'v1', classes: [] })
  fetchEvidenceSources.mockResolvedValue([])
  fetchVehiclePassport.mockImplementation(async (vin: string) => ({
    vehicle: { vin, make: 'Mazda', model: 'BT-50', year: 2020, mileage: 62000, price: 21000 },
    timeline: [],
  }))
})

const open = (vin: string) =>
  render(
    <MemoryRouter initialEntries={[`/dashboard/garage/${vin}`]}>
      <Routes><Route path="/dashboard/garage/:id" element={<VehicleProfile />} /></Routes>
    </MemoryRouter>,
  )

describe('R7 — private vehicle management boundary', () => {
  it('an owned vehicle is fully manageable', async () => {
    open(MINE)
    expect(await screen.findByTestId('edit-continue-listing', {}, { timeout: 15000 })).toBeTruthy()
    expect(screen.queryByTestId('vehicle-not-managed')).toBeNull()
  }, 40000)

  it('a foreign VIN is NOT presented as part of this account\'s garage', async () => {
    open(THEIRS)
    const notice = await screen.findByTestId('vehicle-not-managed', {}, { timeout: 15000 })
    expect(notice).toHaveTextContent(/not in your garage/i)
  }, 40000)

  it('a foreign VIN exposes NO owner-management control and no Seller Studio route', async () => {
    open(THEIRS)
    await screen.findByTestId('vehicle-not-managed', {}, { timeout: 15000 })

    expect(screen.queryByTestId('edit-continue-listing')).toBeNull()
    expect(screen.queryByTestId('upload-document')).toBeNull()
    expect(screen.queryByText(/Edit \/ continue listing/i)).toBeNull()

    // Nothing may route into Seller Studio for a VIN this account does not own.
    const sellerStudioLinks = screen.queryAllByRole('link')
      .filter((a) => (a.getAttribute('href') || '').includes('/dashboard/sell-vehicle'))
    expect(sellerStudioLinks).toHaveLength(0)
  }, 40000)

  it('does not disclose whether the foreign vehicle exists, and offers the public page instead', async () => {
    open(THEIRS)
    const notice = await screen.findByTestId('vehicle-not-managed', {}, { timeout: 15000 })
    // Consistent with CarUp's enumeration policy: this page makes no existence claim either way.
    expect(notice).toHaveTextContent(/has not told you whether this vehicle exists/i)
    // The deliberate public VIN surface is still offered by name — the public contract is unchanged.
    expect(screen.getByTestId('view-public-vehicle')).toBeTruthy()
    expect(screen.getByTestId('back-to-my-garage')).toBeTruthy()
  }, 40000)

  it('fails CLOSED when the ownership read fails — no management control appears', async () => {
    fetchOwnedVehicles.mockRejectedValue(new Error('network'))
    open(MINE)
    await waitFor(() => expect(fetchOwnedVehicles).toHaveBeenCalled())
    // Scope never resolved to "owned", so nothing manageable may render.
    await waitFor(() => expect(screen.queryByTestId('edit-continue-listing')).toBeNull())
    expect(screen.queryByTestId('upload-document')).toBeNull()
  }, 40000)
})
