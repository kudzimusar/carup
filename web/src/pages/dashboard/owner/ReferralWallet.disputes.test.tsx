import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Referral V1 Stage-4 remediation B (frontend): the Refer & Earn page must show the owner their own
 * dispute status and reflect administrator resolution after refetch.
 */

const walletTx = {
  id: 'wallet-tx-0001-abcd',
  amount: 15,
  currency: 'USD',
  status: 'pending',
  reason: 'Local marketplace referral converted',
  event_type: 'wallet.transaction_created',
  created_at: '2026-07-15T09:22:07.000Z',
}

const getOwnerReferralDisputes = vi.fn()
let walletTransactions = [walletTx]

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'refv1-owner', name: 'REFV1 Owner', role: 'owner' }, isAuthenticated: true }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    getReferralWallet: vi.fn().mockImplementation(() => Promise.resolve({ wallet: { pending_balance: 15, approved_balance: 0, payable_balance: 0, paid_or_applied_balance: 0 }, transactions: walletTransactions })),
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
    walletTransactions = [walletTx]
    getOwnerReferralDisputes.mockReset()
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [] })
  })

  it('shows a submitted (open) dispute status on the disputed benefit', async () => {
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [{ dispute_id: 'd-1', wallet_transaction_id: walletTx.id, status: 'open', submitted_at: '2026-07-15T10:00:00.000Z', resolved_at: null, owner_reason: 'looks wrong', owner_safe_resolution: 'Your dispute is open and awaiting review by a CarUp trust reviewer.', benefit_status: 'pending' }] })
    renderPage()
    await waitFor(() => expect(screen.getByTestId(`dispute-status-${walletTx.id}`)).toBeTruthy())
    expect(screen.getByTestId(`dispute-status-${walletTx.id}`).textContent).toContain('Dispute submitted')
    expect(screen.getByTestId(`dispute-status-${walletTx.id}`).textContent).toContain('awaiting review')
  })

  it('shows a resolved-upheld status with the owner-safe resolution after admin resolution', async () => {
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [{ dispute_id: 'd-1', wallet_transaction_id: walletTx.id, status: 'resolved_upheld', submitted_at: '2026-07-15T10:00:00.000Z', resolved_at: '2026-07-15T10:18:50.000Z', owner_reason: 'looks wrong', owner_safe_resolution: 'Reviewed: after checking the milestone and attribution, the benefit’s current status was upheld.', benefit_status: 'pending' }] })
    renderPage()
    await waitFor(() => expect(screen.getByTestId(`dispute-status-${walletTx.id}`)).toBeTruthy())
    const text = screen.getByTestId(`dispute-status-${walletTx.id}`).textContent || ''
    expect(text).toContain('upheld')
    expect(text).toContain('Resolved')
  })

  it('does not render a dispute panel for a benefit with no dispute', async () => {
    getOwnerReferralDisputes.mockResolvedValue({ disputes: [] })
    renderPage()
    await waitFor(() => expect(getOwnerReferralDisputes).toHaveBeenCalled())
    expect(screen.queryByTestId(`dispute-status-${walletTx.id}`)).toBeNull()
  })

  it('degrades safely when the dispute API fails (wallet still renders, no crash)', async () => {
    getOwnerReferralDisputes.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(getOwnerReferralDisputes).toHaveBeenCalled())
    expect(screen.getAllByText(/Local marketplace referral converted/).length).toBeGreaterThan(0)
    expect(screen.queryByTestId(`dispute-status-${walletTx.id}`)).toBeNull()
  })

  it('renders distinct safe transaction labels for same-type pending benefits', async () => {
    walletTransactions = [
      { ...walletTx, id: 'wallet-tx-public-suffix-09f8', amount: 5, created_at: '2026-07-16T22:53:00.000Z', wallet_id: 'internal-wallet-id-should-not-render', metadata: { admin_notes: 'confidential risk note', risk_score: 91 } },
      { ...walletTx, id: 'wallet-tx-public-suffix-44aa', amount: 10, created_at: '2026-07-17T08:01:00.000Z' },
    ]
    renderPage()
    const select = await screen.findByTestId('referral-dispute-transaction-select') as HTMLSelectElement

    await waitFor(() => {
      const populated = Array.from(select.options).map((option) => option.textContent || '')
      expect(populated.some((label) => label.includes('USD 5'))).toBe(true)
      expect(populated.some((label) => label.includes('USD 10'))).toBe(true)
    })
    const labels = Array.from(select.options).map((option) => option.textContent || '')

    expect(labels.some((label) => label.includes('pending'))).toBe(true)
    expect(labels.some((label) => label.includes('2026') || label.includes('07/16') || label.includes('16/07'))).toBe(true)
    expect(labels.some((label) => label.includes('…09f8'))).toBe(true)
    expect(labels.some((label) => label.includes('…44aa'))).toBe(true)
    expect(labels[1]).not.toEqual(labels[2])
    expect(labels.join(' ')).not.toContain('internal-wallet-id-should-not-render')
    expect(labels.join(' ')).not.toContain('confidential risk note')
    expect(labels.join(' ')).not.toContain('risk_score')

    fireEvent.change(select, { target: { value: 'wallet-tx-public-suffix-44aa' } })
    expect(select.value).toBe('wallet-tx-public-suffix-44aa')
  })

  it('keeps the dispute selector empty when the owner has no wallet transactions', async () => {
    walletTransactions = []
    renderPage()
    const select = await screen.findByTestId('referral-dispute-transaction-select') as HTMLSelectElement
    expect(select.options.length).toBe(1)
    expect(select.options[0].value).toBe('')
    expect(select.options[0].textContent).toContain('Select a transaction')
  })

  it('source: fetches owner disputes and refetches after filing', () => {
    expect(SRC).toMatch(/getOwnerReferralDisputes/)
    expect(SRC).toMatch(/loadDisputes/)
    expect(SRC).toMatch(/owner_safe_resolution/)
    expect(SRC).not.toMatch(/resolution_reason/)
  })
})
