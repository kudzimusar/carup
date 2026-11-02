/**
 * PC01-F F4 — the guest listing's photo picker was a `hidden` input inside a <label>. Labels are not tab
 * stops, so a keyboard user could never add photos (WCAG 2.1.1, level A). The input is now `sr-only`:
 * still visually replaced by the dropzone, but in the tab order, with the dropzone showing focus.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installTailwindVisibility, tabTo } from '@/test/keyboardReach'

const lookupVehiclePassport = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ lookupVehiclePassport }) }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const GuestSell = (await import('./GuestSell')).default
const { saveGuestSellDraft, saveGuestSellStep } = await import('@/lib/guestSellDraft')

/** A guest draft that has passed the details and listing steps and has no photos yet. */
const DRAFT = {
  submissionId: '123e4567-e89b-42d3-a456-426614174000',
  make: 'Toyota', model: 'Hilux', year: '2021', vin: 'JTDKARFP0H3000731', color: 'White',
  mileage: '45000', condition: 'Used', category: 'Pickup', fuelType: 'Diesel', transmission: 'Automatic',
  drivetrain: '4WD', location: 'Harare', province: 'Harare', price: '28500', currency: 'USD',
  description: 'Synthetic seller draft with enough description for the listing step.',
  engineNumber: '', chassisNumber: '', plateNumber: '', tempPlateId: '', importStatus: '',
  features: [], images: [], imageLabels: [], coverImageIndex: null, historyPlan: {},
}

describe('Guest listing photos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    lookupVehiclePassport.mockRejectedValue(new Error('404 VIN not found'))
  })

  it('PC01-F F4: the photo picker is reachable by keyboard — Tab lands on its file input', async () => {
    // A returning guest resumes their draft at the photos step — the page's own persistence path.
    expect((await saveGuestSellDraft(DRAFT)).ok).toBe(true)
    saveGuestSellStep(2)
    const restore = installTailwindVisibility()
    try {
      const user = userEvent.setup()
      render(<MemoryRouter><GuestSell /></MemoryRouter>)
      fireEvent.click(screen.getByTestId('sell-intent-resume-draft'))
      await waitFor(() => expect(screen.getByTestId('guest-sell-photos-step')).toBeTruthy())

      const picker = screen.getByText('Drop in the vehicle story').closest('label')!.querySelector('input[type="file"]')!
      expect(await tabTo(user, picker), 'Tab never reaches the photo picker').toBe(true)
    } finally {
      restore()
    }
  }, 30_000) // walking the whole page's tab order in jsdom is slow, not wrong
})
