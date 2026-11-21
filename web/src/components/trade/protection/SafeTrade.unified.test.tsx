/**
 * RX-06 — /diaspora/safetrade and /diaspora/safetrade/:id unified views. SafeTrade is non-custodial and
 * a sandbox simulation: the assurance notice is verbatim on both, totals are "declared", no custodial
 * wording appears; action controls come only from the server's projection, refused actions stay
 * disabled with their reason, confirmations carry the sandbox wording; switched-off (404), rate-limited,
 * refused and missing reads are distinct. Flags OFF keep the legacy pages. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SAFETRADE_NON_CUSTODIAL_NOTICE } from '@/config/safeTradeFlag'

const flag = vi.hoisted(() => ({ on: true }))
const auth = vi.hoisted(() => ({ user: { id: 'fictional-buyer', role: 'owner' } as { id: string; role: string }, isAuthenticated: true, loading: false }))
const api = vi.hoisted(() => ({
  getSafeTradeCases: vi.fn(),
  getSafeTradeCase: vi.fn(),
  getSafeTradeTimeline: vi.fn(),
  getSafeTradeEligibility: vi.fn(),
  getSafeTradeMilestones: vi.fn(),
  getSafeTradeDisputes: vi.fn(),
  getSafeTradeAvailableActions: vi.fn(),
  getSafeTradeDisputeEvidence: vi.fn(),
  commitSafeTrade: vi.fn(),
  evaluateSafeTradeRelease: vi.fn(),
  requestSafeTradeRelease: vi.fn(),
  approveSafeTradeRelease: vi.fn(),
  cancelSafeTrade: vi.fn(),
  openSafeTradeDispute: vi.fn(),
  addSafeTradeDisputeEvidence: vi.fn(),
  resolveSafeTradeDispute: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/config/safeTradeFlag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/safeTradeFlag')>()),
  safeTradeUiEnabled: () => flag.on,
}))

const txn = {
  id: 'txn-fictional-0001', tenant_id: null, import_order_id: 'ord-fictional-0001', accepted_quote_id: 'quo-fictional-a',
  buyer_id: 'fictional-buyer', seller_id: 'fictional-seller', currency: 'USD', total_amount: 9000, status: 'INITIATED',
  payment_provider: 'sandbox', live_payment: false, policy_version: 'st-policy-fictional-1',
  created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-19T10:00:00Z',
}
const act = (actionKey: string, over: Record<string, unknown> = {}) => ({
  actionKey, labelKey: actionKey, permitted: false, disabledReasonCode: 'WRONG_STATE', confirmationRequired: false,
  reviewerRequired: false, sandboxOnly: false, requiredEvidenceCategories: [], ...over,
})
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const setUnified = (on: boolean) => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = on ? true : undefined }

async function mountList(unified = true) {
  vi.resetModules()
  setUnified(unified)
  const { default: Page } = await import('@/pages/diaspora/DiasporaSafeTrade')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}
async function mountCase(unified = true) {
  vi.resetModules()
  setUnified(unified)
  const { default: Page } = await import('@/pages/diaspora/DiasporaSafeTradeDetail')
  return render(
    <MemoryRouter initialEntries={[`/diaspora/safetrade/${txn.id}`]}>
      <Routes><Route path="/diaspora/safetrade/:id" element={<Page />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  flag.on = true
  auth.user = { id: 'fictional-buyer', role: 'owner' }
  api.getSafeTradeCases.mockResolvedValue({ data: [] })
  api.getSafeTradeCase.mockResolvedValue(txn)
  api.getSafeTradeTimeline.mockResolvedValue([{ action: 'SAFETRADE_INITIATED', created_at: '2026-11-18T10:00:00Z' }])
  api.getSafeTradeEligibility.mockResolvedValue({ eligible: false, blockers: [{ code: 'IDENTITY_UNVERIFIED_SELLER', message: 'SELLER identity is not verified (status=none).', severity: 'BLOCK', evidenceRef: null, remediation: 'Complete seller identity verification.', policyClause: '§40.identity' }], evidenceRefs: [], policyVersion: 'st-policy-fictional-1', evaluatedAt: '2026-11-19T10:00:00Z' })
  api.getSafeTradeMilestones.mockResolvedValue([])
  api.getSafeTradeDisputes.mockResolvedValue([])
  api.getSafeTradeDisputeEvidence.mockResolvedValue([])
  api.getSafeTradeAvailableActions.mockResolvedValue([
    act('buyer-commit', { permitted: true, disabledReasonCode: null, confirmationRequired: true }),
    act('seller-commit', { disabledReasonCode: 'WRONG_ROLE' }),
    act('hold-payment', { disabledReasonCode: 'LIVE_PAYMENT_DISABLED', sandboxOnly: true }),
    act('approve-release', { reviewerRequired: true, disabledReasonCode: 'NEEDS_REVIEWER', sandboxOnly: true }),
    act('release-escrow', { reviewerRequired: true, disabledReasonCode: 'NEEDS_REVIEWER' }),
    act('open-dispute', { disabledReasonCode: 'WRONG_STATE' }),
  ])
  api.commitSafeTrade.mockResolvedValue({})
})
afterEach(() => setUnified(false))

describe('SafeTrade cases — unified ledger', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mountList(false)
    expect(await screen.findByTestId('safetrade-list-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-safetrade')).toBeNull()
  })

  it('the SafeTrade UI flag off reads nothing', async () => {
    flag.on = false
    await mountList()
    expect(await screen.findByTestId('trade-safetrade-unavailable')).toHaveAttribute('data-state', 'unavailable')
    expect(api.getSafeTradeCases).not.toHaveBeenCalled()
  })

  it('empty: verbatim non-custodial notice, what opens a case, and no way to fake one', async () => {
    await mountList()
    const empty = await screen.findByTestId('trade-safetrade-empty')
    expect(empty).toHaveTextContent('accepted a seller’s quote and both trade profiles are verified')
    expect(empty).toHaveTextContent('Opening a case is not offered on this page')
    expect(screen.getByTestId('trade-safetrade-assurance-primary')).toHaveTextContent(SAFETRADE_NON_CUSTODIAL_NOTICE)
    expect(screen.queryByRole('button', { name: /open a case|create|start safetrade/i })).toBeNull()
  })

  it('switched off on the server (404), rate-limited (429) and failed reads are distinct and never "no cases"', async () => {
    api.getSafeTradeCases.mockRejectedValueOnce(httpError(404, 'SafeTrade is not enabled'))
    const a = await mountList()
    expect(await screen.findByTestId('trade-safetrade-failed')).toHaveAttribute('data-state', 'unavailable')
    expect(screen.queryByTestId('trade-safetrade-empty')).toBeNull()
    a.unmount()
    api.getSafeTradeCases.mockRejectedValueOnce(httpError(429, 'Too many requests. Please try again later.'))
    const b = await mountList()
    expect(await screen.findByTestId('trade-safetrade-failed')).toHaveAttribute('data-state', 'limited')
    b.unmount()
    api.getSafeTradeCases.mockRejectedValueOnce(httpError(500, 'boom'))
    await mountList()
    const failed = await screen.findByTestId('trade-safetrade-failed')
    expect(failed).toHaveAttribute('data-state', 'failed')
    fireEvent.click(within(failed).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('trade-safetrade-empty')).toBeInTheDocument()
  })

  it('rows read as declared sandbox totals, and the status filter asks the server', async () => {
    api.getSafeTradeCases.mockResolvedValue({ data: [{ ...txn, status: 'FUNDS_HELD' }] })
    await mountList()
    const row = await screen.findByTestId(`trade-safetrade-row-${txn.id}`)
    expect(within(row).getByTestId(`trade-safetrade-row-${txn.id}-state`)).toHaveTextContent('Sandbox payment held (simulated)')
    expect(row).toHaveTextContent('$9,000.00')
    expect(row).toHaveTextContent('You are the buyer')
    expect(screen.getByTestId('trade-safetrade')).toHaveTextContent('It is not money CarUp holds')
    fireEvent.change(screen.getByTestId('trade-safetrade-filter-status'), { target: { value: 'DISPUTED' } })
    await waitFor(() => expect(api.getSafeTradeCases).toHaveBeenLastCalledWith({ status: 'DISPUTED' }))
  })
})

describe('SafeTrade case — unified object page', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mountCase(false)
    expect(await screen.findByTestId('safetrade-detail-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-safetrade-case')).toBeNull()
  })

  it('header, verbatim notice, declared total, and no custodial wording anywhere', async () => {
    const { container } = await mountCase()
    expect(await screen.findByTestId('trade-safetrade-case-state')).toHaveTextContent('Awaiting buyer commitment')
    expect(screen.getByTestId('trade-safetrade-case-sandbox')).toHaveTextContent('Sandbox simulation · live payment off')
    expect(screen.getByTestId('trade-safetrade-assurance-primary')).toHaveTextContent(SAFETRADE_NON_CUSTODIAL_NOTICE)
    expect(screen.getByTestId('trade-safetrade-case-total')).toHaveTextContent('$9,000.00')
    expect(container.textContent).toMatch(/not held by CarUp/)
    expect(container.textContent).not.toMatch(/funds secured|escrow balance|guaranteed/i)
    expect(screen.getByTestId('trade-safetrade-case-blockers')).toHaveTextContent('Complete seller identity verification.')
  })

  it('the next move is the permitted action; it asks first, then commits through the same mapping', async () => {
    await mountCase()
    const next = await screen.findByTestId('trade-safetrade-case-next')
    expect(next).toHaveTextContent('Confirm as buyer — this step is yours')
    fireEvent.click(within(next).getByTestId('trade-safetrade-case-next-action'))
    expect(api.commitSafeTrade).not.toHaveBeenCalled()
    const confirm = await screen.findByTestId('trade-safetrade-case-runner-confirm')
    expect(confirm).toHaveTextContent('The backend remains authoritative')
    fireEvent.click(within(confirm).getByTestId('trade-safetrade-case-runner-confirm-submit'))
    await waitFor(() => expect(api.commitSafeTrade).toHaveBeenCalledWith(txn.id, { event: 'BUYER_COMMIT', idempotencyKey: expect.any(String) }))
    expect(await screen.findByTestId('trade-safetrade-case-runner-result')).toHaveTextContent('Confirm as buyer submitted.')
  })

  it('server-refused actions stay disabled with their reason in words; unwired ones are listed, never faked', async () => {
    await mountCase()
    fireEvent.click(await screen.findByRole('tab', { name: /Actions/ }))
    const seller = await screen.findByTestId('trade-safetrade-action-seller-commit')
    expect(within(seller).getByRole('button')).toBeDisabled()
    expect(within(seller).getByTestId('trade-safetrade-action-seller-commit-reason')).toHaveTextContent('Not available for your role on this case.')
    const hold = screen.getByTestId('trade-safetrade-action-hold-payment')
    expect(within(hold).getByRole('button')).toBeDisabled()
    expect(hold).toHaveTextContent('Live payment is not active (sandbox only).')
    const reviewer = screen.getByTestId('trade-safetrade-actions-reviewer')
    expect(reviewer).toHaveTextContent('no real funds move')
    expect(within(screen.getByTestId('trade-safetrade-action-approve-release')).getByRole('button')).toBeDisabled()
    expect(screen.getByTestId('trade-safetrade-reported-release-escrow')).toHaveTextContent('Server says: A reviewer or administrator must perform this.')
    fireEvent.click(within(seller).getByRole('button'))
    expect(api.commitSafeTrade).not.toHaveBeenCalled()
  })

  it('a dispute cannot be raised when the server refuses it, and says why', async () => {
    await mountCase()
    fireEvent.click(await screen.findByRole('tab', { name: /Disputes/ }))
    expect(await screen.findByTestId('trade-safetrade-dispute-open-blocked')).toHaveTextContent('Not available at this stage.')
    expect(screen.queryByTestId('trade-safetrade-dispute-submit')).toBeNull()
    expect(screen.getByTestId('trade-safetrade-disputes-empty')).toBeInTheDocument()
  })

  it('the timeline is deriveTimeline: the current phase is marked, nothing later is completed', async () => {
    await mountCase()
    fireEvent.click(await screen.findByRole('tab', { name: /Timeline/ }))
    const current = (await screen.findAllByTestId('trade-safetrade-phase')).find((p) => p.getAttribute('aria-current') === 'step')
    expect(current).toHaveAttribute('data-state', 'AWAITING_BUYER_COMMITMENT')
    const later = screen.getAllByTestId('trade-safetrade-phase').find((p) => p.getAttribute('data-state') === 'COMPLETED')
    expect(later).toHaveAttribute('data-status', 'unavailable')
  })

  it('unreadable sections say so instead of looking empty', async () => {
    api.getSafeTradeAvailableActions.mockRejectedValue(httpError(500, 'boom'))
    api.getSafeTradeMilestones.mockRejectedValue(httpError(500, 'boom'))
    await mountCase()
    expect(await screen.findByTestId('trade-safetrade-case-next')).toHaveTextContent('The available actions could not be loaded')
    fireEvent.click(screen.getByRole('tab', { name: /Milestones/ }))
    expect(await screen.findByTestId('trade-safetrade-milestones-unreadable')).toHaveTextContent('This case may well have milestones')
  })

  it('switched off (404 "not enabled"), not found, refused and rate-limited case reads are distinct', async () => {
    api.getSafeTradeCase.mockRejectedValueOnce(httpError(404, 'SafeTrade is not enabled'))
    const a = await mountCase()
    expect(await screen.findByTestId('trade-safetrade-case-fatal')).toHaveAttribute('data-state', 'unavailable')
    a.unmount()
    api.getSafeTradeCase.mockRejectedValueOnce(httpError(404, 'SafeTrade transaction not found'))
    const b = await mountCase()
    expect(await screen.findByTestId('trade-safetrade-case-fatal')).toHaveTextContent('This SafeTrade case was not found')
    b.unmount()
    api.getSafeTradeCase.mockRejectedValueOnce(httpError(403, 'You do not have access to this SafeTrade transaction'))
    const c = await mountCase()
    expect(await screen.findByTestId('trade-safetrade-case-fatal')).toHaveAttribute('data-state', 'denied')
    c.unmount()
    api.getSafeTradeCase.mockRejectedValueOnce(httpError(429, 'Too many requests. Please try again later.'))
    await mountCase()
    expect(await screen.findByTestId('trade-safetrade-case-fatal')).toHaveAttribute('data-state', 'limited')
  })
})
