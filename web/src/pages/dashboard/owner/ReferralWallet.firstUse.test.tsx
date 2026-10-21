import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildApiFailure } from '@/lib/apiClient'

/**
 * CARUP-MVP-STAB-01 F-025 — a new account has no referral wallet row until it earns a first benefit,
 * and `GET /api/referrals/wallets/:userId` answers that with 404 RESOURCE_NOT_FOUND. The page printed
 * the raw "Referral wallet not found." in red, so every first-time owner was shown an error for the
 * normal starting state. Only THAT answer is the first-use state; every other failure stays an error.
 *
 * The rejections are built with the real client's `buildApiFailure`, so `status` and `code` arrive
 * exactly as `useCarUpApi().request` throws them.
 */

const getReferralWallet = vi.fn()
const getOwnerReferralDisputes = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'first-use-owner', name: 'New Owner', role: 'owner' }, isAuthenticated: true }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    getReferralWallet,
    validateReferralCode: vi.fn(),
    createReferralChannelShareKit: vi.fn(),
    explainReferralBenefit: vi.fn(),
    createReferralDispute: vi.fn(),
    getOwnerReferralDisputes,
  }),
}))

const ReferralWallet = (await import('./ReferralWallet')).default

const walletNotFound = () => buildApiFailure('Referral wallet not found.', 404, {
  error: { code: 'RESOURCE_NOT_FOUND', message: 'Referral wallet not found.' },
})

function renderPage() {
  return render(<MemoryRouter><ReferralWallet /></MemoryRouter>)
}

describe('Refer & Earn — a wallet that does not exist yet is the first-use state (F-025)', () => {
  beforeEach(() => {
    cleanup()
    getReferralWallet.mockReset()
    getOwnerReferralDisputes.mockReset()
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [] })
  })

  it('404 RESOURCE_NOT_FOUND shows the first-use copy, not an error', async () => {
    getReferralWallet.mockRejectedValue(walletNotFound())
    const { container } = renderPage()

    expect((await screen.findByTestId('referral-wallet-first-use')).textContent).toMatch(/No referral benefits yet/)
    expect(screen.queryByTestId('referral-wallet-error')).toBeNull()
    expect(container.textContent).not.toContain('Referral wallet not found.')
    // No balance exists to state: no figures, no dashes standing in for them.
    expect(screen.queryByTestId('referral-wallet-balances')).toBeNull()
    expect(getReferralWallet).toHaveBeenCalledWith('first-use-owner')
  })

  it('a server failure stays a failure', async () => {
    getReferralWallet.mockRejectedValue(buildApiFailure('Internal server error', 500, {
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
    }))
    renderPage()

    expect((await screen.findByTestId('referral-wallet-error')).textContent).toContain('Internal server error')
    expect(screen.queryByTestId('referral-wallet-first-use')).toBeNull()
  })

  it('a 404 that is not "no wallet yet" (no RESOURCE_NOT_FOUND code) stays a failure', async () => {
    getReferralWallet.mockRejectedValue(buildApiFailure('Not Found', 404, { error: 'Not Found' }))
    renderPage()

    expect((await screen.findByTestId('referral-wallet-error')).textContent).toContain('Not Found')
    expect(screen.queryByTestId('referral-wallet-first-use')).toBeNull()
  })

  it('a network failure stays a failure', async () => {
    getReferralWallet.mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()

    expect(await screen.findByTestId('referral-wallet-error')).toBeTruthy()
    expect(screen.queryByTestId('referral-wallet-first-use')).toBeNull()
  })

  it('an existing wallet still shows its balances', async () => {
    getReferralWallet.mockResolvedValue({
      wallet: { pending_balance: 15, approved_balance: 5, payable_balance: 0, paid_or_applied_balance: 0 },
      transactions: [],
    })
    renderPage()

    expect((await screen.findByTestId('referral-wallet-balances')).textContent).toContain('$15')
    expect(screen.queryByTestId('referral-wallet-error')).toBeNull()
  })
})
