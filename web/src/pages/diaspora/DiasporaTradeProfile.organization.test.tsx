import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchOwnDiasporaTradeProfiles = vi.fn()
const listDiasporaTradeProfiles = vi.fn()
const createDiasporaTradeProfile = vi.fn()
const updateDiasporaTradeProfile = vi.fn()
const submitDiasporaTradeProfileForReview = vi.fn()
const verifyDiasporaTradeProfile = vi.fn()
const suspendDiasporaTradeProfile = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1', name: 'Trade Owner', role: 'owner' },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchOwnDiasporaTradeProfiles,
    listDiasporaTradeProfiles,
    createDiasporaTradeProfile,
    updateDiasporaTradeProfile,
    submitDiasporaTradeProfileForReview,
    verifyDiasporaTradeProfile,
    suspendDiasporaTradeProfile,
  }),
}))

const DiasporaTradeProfile = (await import('./DiasporaTradeProfile')).default

beforeEach(() => {
  vi.clearAllMocks()
  fetchOwnDiasporaTradeProfiles.mockResolvedValue([])
  listDiasporaTradeProfiles.mockResolvedValue([])
  createDiasporaTradeProfile.mockResolvedValue({
    id: 'profile-1',
    role_type: 'buyer',
    country: 'Zimbabwe',
    city: 'Harare',
    verification_status: 'PENDING_REVIEW',
  })
})

describe('Diaspora trade-profile organization truthfulness', () => {
  it('does not expose an organization free-text field', async () => {
    render(<MemoryRouter><DiasporaTradeProfile /></MemoryRouter>)

    await screen.findByTestId('diaspora-trade-profile-empty')
    expect(screen.queryByTestId('diaspora-trade-profile-organization')).toBeNull()
    expect(screen.getByTestId('diaspora-trade-profile-organization-note').textContent)
      .toMatch(/approved organization record/i)
  })

  it('does not submit an arbitrary organization id during self-service creation', async () => {
    render(<MemoryRouter><DiasporaTradeProfile /></MemoryRouter>)
    await screen.findByTestId('diaspora-trade-profile-empty')

    fireEvent.change(screen.getByTestId('diaspora-trade-profile-country'), { target: { value: 'Zimbabwe' } })
    fireEvent.change(screen.getByTestId('diaspora-trade-profile-city'), { target: { value: 'Harare' } })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-submit')) })

    await waitFor(() => expect(createDiasporaTradeProfile).toHaveBeenCalledTimes(1))
    expect(createDiasporaTradeProfile.mock.calls[0][0]).not.toHaveProperty('organization_id')
  })
})
