import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Referral V1 Stage-4 remediation B (frontend): the Refer & Earn page must show the owner their own
 * dispute status and reflect administrator resolution after refetch.
 */

const walletTx = {
  id: 'tx-1',
  amount: 15,
  currency: 'USD',
  status: 'pending',
  reason: 'Local marketplace referral converted',
  event_type: 'wallet.transaction_created',
  created_at: '2026-07-15T09:22:07.000Z',
}

const getOwnerReferralDisputes = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'refv1-owner', name: 'REFV1 Owner', role: 'owner' }, isAuthenticated: true }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    getReferralWallet: vi.fn().mockResolvedValue({ wallet: { pending_balance: 15, approved_balance: 0, payable_balance: 0, paid_or_applied_balance: 0 }, transactions: [walletTx] }),
    validateReferralCode: vi.fn(),
    createReferralChannelShareKit: vi.fn(),
    explainReferralBenefit: vi.fn(),
    createReferralDispute: vi.fn(),
    getOwnerReferralDisputes,
    getReferralAgentTools: vi.fn().mockResolvedValue({ tools: [] }),
  }),
}))

const ReferralWallet = (await import('./ReferralWallet')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'ReferralWallet.tsx'), 'utf8')

function renderPage() {
  return render(<MemoryRouter><ReferralWallet /></MemoryRouter>)
}

describe('ReferralWallet dispute visibility (Stage-4 remediation B)', () => {
  beforeEach(() => {
    cleanup()
    getOwnerReferralDisputes.mockReset()
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [] })
  })

  it('shows a submitted (open) dispute status on the disputed benefit', async () => {
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [{ dispute_id: 'd-1', wallet_transaction_id: 'tx-1', status: 'open', submitted_at: '2026-07-15T10:00:00.000Z', resolved_at: null, owner_reason: 'looks wrong', owner_safe_resolution: 'Your dispute is open and awaiting review by a CarUp trust reviewer.', benefit_status: 'pending' }] })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dispute-status-tx-1')).toBeTruthy())
    expect(screen.getByTestId('dispute-status-tx-1').textContent).toContain('Dispute submitted')
    expect(screen.getByTestId('dispute-status-tx-1').textContent).toContain('awaiting review')
  })

  it('shows a resolved-upheld status with the owner-safe resolution after admin resolution', async () => {
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [{ dispute_id: 'd-1', wallet_transaction_id: 'tx-1', status: 'resolved_upheld', submitted_at: '2026-07-15T10:00:00.000Z', resolved_at: '2026-07-15T10:18:50.000Z', owner_reason: 'looks wrong', owner_safe_resolution: 'Reviewed: after checking the milestone and attribution, the benefit’s current status was upheld.', benefit_status: 'pending' }] })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dispute-status-tx-1')).toBeTruthy())
    const text = screen.getByTestId('dispute-status-tx-1').textContent || ''
    expect(text).toContain('upheld')
    expect(text).toContain('Resolved')
  })

  it('does not render a dispute panel for a benefit with no dispute', async () => {
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [] })
    renderPage()
    // Wallet renders; no dispute panel for tx-1.
    await waitFor(() => expect(getOwnerReferralDisputes).toHaveBeenCalled())
    expect(screen.queryByTestId('dispute-status-tx-1')).toBeNull()
  })

  it('degrades safely when the dispute API fails (wallet still renders, no crash)', async () => {
    getOwnerReferralDisputes.mockRejectedValue(new Error('boom'))
    renderPage()
    // The wallet benefit row still renders even though the dispute fetch rejected.
    await waitFor(() => expect(getOwnerReferralDisputes).toHaveBeenCalled())
    expect(screen.getAllByText(/Local marketplace referral converted/).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('dispute-status-tx-1')).toBeNull()
  })

  it('source: fetches owner disputes and refetches after filing', () => {
    expect(SRC).toMatch(/getOwnerReferralDisputes/)
    expect(SRC).toMatch(/loadDisputes/)
    // owner-safe resolution surfaced, raw admin note never referenced
    expect(SRC).toMatch(/owner_safe_resolution/)
    expect(SRC).not.toMatch(/resolution_reason/)
  })
})
