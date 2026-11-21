/**
 * RX-06 — /diaspora/trade-profile unified desk: submitted is never verified, each status says what it
 * allows, resubmission only for a rejected profile, a 429 never auto-retries, the reviewer queue's
 * suspend asks first. Flag OFF keeps the legacy page. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ user: { id: 'fictional-trader', role: 'owner' } as { id: string; role: string }, isAuthenticated: true, loading: false }))
const api = vi.hoisted(() => ({
  fetchOwnDiasporaTradeProfiles: vi.fn(),
  listDiasporaTradeProfiles: vi.fn(),
  createDiasporaTradeProfile: vi.fn(),
  updateDiasporaTradeProfile: vi.fn(),
  submitDiasporaTradeProfileForReview: vi.fn(),
  verifyDiasporaTradeProfile: vi.fn(),
  suspendDiasporaTradeProfile: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const profile = (over: Record<string, unknown> = {}) => ({
  id: 'prof-fictional-1', role_type: 'buyer', city: 'Harare', country: 'Zimbabwe', verification_status: 'PENDING_REVIEW',
  created_at: '2026-11-10T08:00:00Z', updated_at: '2026-11-10T08:00:00Z', ...over,
})
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/diaspora/DiasporaTradeProfile')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = { id: 'fictional-trader', role: 'owner' }
  api.fetchOwnDiasporaTradeProfiles.mockResolvedValue([profile()])
  api.listDiasporaTradeProfiles.mockResolvedValue([])
  api.submitDiasporaTradeProfileForReview.mockResolvedValue(profile())
  api.createDiasporaTradeProfile.mockResolvedValue(profile())
  api.verifyDiasporaTradeProfile.mockResolvedValue(profile({ verification_status: 'VERIFIED' }))
  api.suspendDiasporaTradeProfile.mockResolvedValue(profile({ verification_status: 'SUSPENDED' }))
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Trade profile — unified desk', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByTestId('diaspora-trade-profile-route')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-profile')).toBeNull()
  })

  it('submitted is not verified: the chip is never green and SafeTrade does not count it', async () => {
    await mount()
    const card = await screen.findByTestId('trade-profile-card')
    const chip = within(card).getByTestId('trade-profile-card-status')
    expect(chip).toHaveTextContent('Submitted · awaiting CarUp review')
    expect(chip).not.toHaveAttribute('data-tone', 'success')
    expect(within(card).getByTestId('trade-profile-card-allows')).toHaveTextContent('does not yet count it as verified identity')
    expect(within(card).queryByTestId('trade-profile-resubmit')).toBeNull() // only a rejected profile resubmits
    expect(screen.getByTestId('trade-profile-next')).toHaveTextContent('with CarUp for review')
    expect(api.fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
  })

  it('only VERIFIED is green, and says what it allows', async () => {
    api.fetchOwnDiasporaTradeProfiles.mockResolvedValue([profile({ verification_status: 'VERIFIED' })])
    await mount()
    const chip = await screen.findByTestId('trade-profile-card-status')
    expect(chip).toHaveAttribute('data-tone', 'success')
    expect(screen.getByTestId('trade-profile-card-allows')).toHaveTextContent('SafeTrade’s eligibility check accepts a verified trade profile')
  })

  it('a rejected profile resubmits through the same handler', async () => {
    api.fetchOwnDiasporaTradeProfiles.mockResolvedValue([profile({ verification_status: 'REJECTED' })])
    await mount()
    fireEvent.click(await screen.findByTestId('trade-profile-resubmit'))
    await waitFor(() => expect(api.submitDiasporaTradeProfileForReview).toHaveBeenCalledWith('prof-fictional-1'))
  })

  it('no profile: an honest empty state whose action is the real next move', async () => {
    api.fetchOwnDiasporaTradeProfiles.mockResolvedValue([])
    await mount()
    const empty = await screen.findByTestId('trade-profile-empty')
    expect(empty).toHaveTextContent('waits for a CarUp reviewer')
    fireEvent.click(within(empty).getByTestId('trade-profile-next-create'))
    expect(screen.getByTestId('trade-profile-role')).toHaveFocus()
    expect(screen.queryByTestId('trade-profile-pulse')).toBeNull()
  })

  it('a 429 is a rate-limit state with a manual retry, never an automatic one', async () => {
    api.fetchOwnDiasporaTradeProfiles.mockRejectedValueOnce(httpError(429, 'Too many requests'))
    await mount()
    const limited = await screen.findByTestId('trade-profile-limited')
    expect(limited).toHaveTextContent('Nothing is retried automatically')
    await new Promise((r) => setTimeout(r, 100))
    expect(api.fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
    fireEvent.click(within(limited).getByRole('button', { name: /Retry now/ }))
    await waitFor(() => expect(api.fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(2))
  })

  it('a failed read is never "no profile", and the form says it cannot know what exists', async () => {
    api.fetchOwnDiasporaTradeProfiles.mockRejectedValueOnce(httpError(500, 'boom'))
    await mount()
    expect(await screen.findByTestId('trade-profile-failed')).toHaveTextContent('This is not a report that you have no profile')
    expect(screen.queryByTestId('trade-profile-empty')).toBeNull()
    expect(screen.getByTestId('trade-profile-form-unknown')).toHaveTextContent('The server refuses a duplicate')
  })

  it('creates a profile through the same handler (always recorded as submitted)', async () => {
    api.fetchOwnDiasporaTradeProfiles.mockResolvedValue([])
    await mount()
    await screen.findByTestId('trade-profile-empty')
    fireEvent.change(screen.getByTestId('trade-profile-country'), { target: { value: 'Zimbabwe' } })
    fireEvent.change(screen.getByTestId('trade-profile-city'), { target: { value: 'Harare' } })
    fireEvent.click(screen.getByTestId('trade-profile-submit'))
    await waitFor(() => expect(api.createDiasporaTradeProfile).toHaveBeenCalledWith({ role_type: 'buyer', country: 'Zimbabwe', city: 'Harare', organization_id: null }))
    expect(await screen.findByTestId('trade-profile-result')).toHaveTextContent('Profile created and submitted for review.')
  })

  it('a reviewer verifies, and suspends only after confirming', async () => {
    auth.user = { id: 'fictional-reviewer', role: 'admin' }
    api.listDiasporaTradeProfiles.mockResolvedValue([profile({ id: 'prof-fictional-9', role_type: 'seller', city: 'Kobe', country: 'Japan' })])
    await mount()
    const queue = await screen.findByTestId('trade-profile-queue')
    const row = await within(queue).findByTestId('trade-profile-queue-row')
    fireEvent.click(within(row).getByTestId('trade-profile-verify'))
    await waitFor(() => expect(api.verifyDiasporaTradeProfile).toHaveBeenCalledWith('prof-fictional-9'))
    fireEvent.click(await within(queue).findByTestId('trade-profile-suspend'))
    expect(api.suspendDiasporaTradeProfile).not.toHaveBeenCalled()
    fireEvent.click(await within(queue).findByTestId('trade-profile-suspend-confirm'))
    await waitFor(() => expect(api.suspendDiasporaTradeProfile).toHaveBeenCalledWith('prof-fictional-9', { reason: 'Suspended by reviewer' }))
  })
})
