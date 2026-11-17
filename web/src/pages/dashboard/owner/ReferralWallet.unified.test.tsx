/**
 * RX04-C2 — Refer & Earn, unified presentation (flag ON). Money only from the wallet read, in the
 * currency the server recorded; a failed read is never a zero balance.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const walletTx = {
  id: 'wallet-tx-0001-abcd',
  amount: 15,
  currency: 'USD',
  status: 'pending',
  reason: 'Local marketplace referral converted',
  created_at: '2026-07-15T09:22:07.000Z',
}

const getReferralWallet = vi.fn()
const getOwnerReferralDisputes = vi.fn()
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'refv1-owner', name: 'Fictional Owner', role: 'owner' }, isAuthenticated: true }),
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

async function renderPage() {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  const ReferralWallet = (await import('./ReferralWallet')).default
  return render(<MemoryRouter><ReferralWallet /></MemoryRouter>)
}

beforeEach(() => {
  getReferralWallet.mockReset()
  getOwnerReferralDisputes.mockReset()
  getOwnerReferralDisputes.mockResolvedValue({ disputes: [] })
})
afterAll(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Refer & Earn — unified presentation', () => {
  it('shows each balance in the wallet\'s recorded currency and each benefit in its own', async () => {
    getReferralWallet.mockResolvedValue({ wallet: { currency: 'USD', pending_balance: 15, approved_balance: 5, payable_balance: 2.5, paid_or_applied_balance: 0 }, transactions: [walletTx] })
    await renderPage()
    expect(await screen.findByTestId('referrals-unified')).toHaveAttribute('data-presentation', 'rx04')
    const wallet = screen.getByTestId('referral-wallet')
    await waitFor(() => expect(within(wallet).getAllByTestId('money-value').length).toBeGreaterThanOrEqual(3))
    const values = within(wallet).getAllByTestId('money-value').map(n => n.textContent)
    expect(values).toContain('$7.5 USD') // approved + payable, the only buckets returned
    expect(values).toContain('$15 USD')
    expect(screen.getByTestId(`referral-wallet-transaction-status-${walletTx.id}`)).toHaveTextContent('Pending')
  })

  it('never assumes a currency the wallet did not record', async () => {
    getReferralWallet.mockResolvedValue({ wallet: { pending_balance: 15 }, transactions: [{ ...walletTx, currency: null }] })
    await renderPage()
    await screen.findByTestId(`referral-wallet-transaction-${walletTx.id}`)
    const wallet = screen.getByTestId('referral-wallet')
    expect(within(wallet).getAllByTestId('money-currency-missing').length).toBeGreaterThan(0)
    // Approved and Settled were not returned: "Not recorded", never $0.
    expect(within(wallet).getAllByTestId('money-missing')).toHaveLength(2)
    expect(wallet.textContent).not.toContain('$')
    const select = screen.getByTestId('referral-dispute-transaction-select') as HTMLSelectElement
    expect(select.options[1].textContent).toContain('currency not recorded')
  })

  it('a failed wallet read is an error, not a zero balance', async () => {
    getReferralWallet.mockRejectedValue(new Error('relation does not exist'))
    await renderPage()
    expect(await screen.findByText(/This is not a zero balance/)).toBeInTheDocument()
    expect(screen.queryByTestId('money-value')).toBeNull()
    expect(screen.queryByTestId('money-missing')).toBeNull()
  })

  it('keeps dispute status on the disputed benefit and says when disputes could not be read', async () => {
    getReferralWallet.mockResolvedValue({ wallet: { currency: 'USD', pending_balance: 15 }, transactions: [walletTx] })
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [{ dispute_id: 'd-1', wallet_transaction_id: walletTx.id, status: 'open', submitted_at: '2026-07-15T10:00:00.000Z', resolved_at: null, owner_reason: 'x', owner_safe_resolution: 'Your dispute is open and awaiting review.', benefit_status: 'pending' }] })
    await renderPage()
    expect(await screen.findByTestId(`dispute-status-${walletTx.id}`)).toHaveTextContent('Dispute submitted')

    getOwnerReferralDisputes.mockReset()
    getOwnerReferralDisputes.mockRejectedValue(new Error('boom'))
    await renderPage()
    expect(await screen.findAllByTestId('referral-wallet-disputes-unavailable')).not.toHaveLength(0)
  })
})
