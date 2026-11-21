/**
 * RX-06 — /diaspora/safetrade/operations unified operator console. Fictional data only.
 *
 * Proves: flag OFF keeps the legacy console; the queue → case → action console renders from the
 * page's own reads; a 404 / 403 / 429 / 500 queue read is its own state and never "none waiting" /
 * "everything reconciled"; approve and reject need an explicit confirm step and carry the optional
 * notes / reason the API accepts; a requester cannot approve their own request (server verdict) and
 * is offered no reject; drain / retry delivery are not offered to a non-admin reviewer; the sandbox /
 * LIVE_PAYMENT-off line is always present; and with the SafeTrade UI flag off nothing is fetched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  safeTradeUi: true,
  approvals: [] as unknown[],
  queue: [] as unknown[],
  backlog: { pending: 0, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: null } as unknown,
  deadLetters: [] as unknown[],
  errors: { approvals: null, queue: null, backlog: null, deadLetters: null } as Record<string, unknown>,
  approveError: null as unknown,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
}))
const auth = vi.hoisted(() => ({ user: { id: 'rev-1', role: 'admin' } as { id: string; role: string } | null, isAuthenticated: true, loading: false }))

vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/config/safeTradeFlag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/safeTradeFlag')>()
  return { ...actual, safeTradeUiEnabled: () => fx.safeTradeUi }
})
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))

const methods = vi.hoisted(() => {
  const log = (fn: string, args: unknown[]) => fx.calls.push({ fn, args })
  const read = (key: string, value: () => unknown) => async (...a: unknown[]) => {
    log(key, a)
    if (fx.errors[key]) throw fx.errors[key]
    return value()
  }
  return {
    getSafeTradeApprovals: read('approvals', () => fx.approvals),
    getSafeTradeReconciliationQueue: read('queue', () => fx.queue),
    getSafeTradeOutboxBacklog: read('backlog', () => fx.backlog),
    getSafeTradeOutboxDeadLetters: read('deadLetters', () => fx.deadLetters),
    approveSafeTradeDecision: async (...a: unknown[]) => { log('approve', a); if (fx.approveError) throw fx.approveError; return {} },
    rejectSafeTradeDecision: async (...a: unknown[]) => { log('reject', a); return {} },
    drainSafeTradeOutbox: async (...a: unknown[]) => { log('drain', a); return { claimed: 3, dispatched: 2, failed: 1, deadLettered: 0, noHandler: 0, results: [] } },
    replaySafeTradeOutboxEvent: async (...a: unknown[]) => { log('replay', a); return {} },
  }
})
// Like the real hook: stable methods inside a FRESH object on every render.
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...methods }) }))

const { default: Ops } = await import('@/pages/diaspora/DiasporaSafeTradeOperations')

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const renderPage = () => render(<MemoryRouter><Ops /></MemoryRouter>)
const calls = (fn: string) => fx.calls.filter((c) => c.fn === fn)

const approval = (over: Record<string, unknown> = {}) => ({
  id: 'ap-fx-1', transaction_id: 'txn-fx-1', milestone_id: null, decision_type: 'release', risk_level: 'HIGH',
  amount: 5000, currency: 'USD', requested_by: 'rev-other', requested_at: '2026-11-20T09:00:00Z',
  requested_reason: 'FICTIONAL high-risk release', expires_at: null, state: 'pending',
  canApprove: true, selfApprovalBlocked: false, ...over,
})
const deadLetter = (over: Record<string, unknown> = {}) => ({
  id: 'dl-fx-1', tenant_id: 'T', transaction_id: 'txn-fx-1', milestone_id: null, event_type: 'SAFETRADE_RELEASE_REQUESTED',
  status: 'dead_lettered', attempts: 5, last_error: 'handler timeout', created_at: '2026-11-20T08:00:00Z',
  next_attempt_at: null, payloadWithheld: true, payloadWithheldReason: 'Outbox payloads are never returned.', ...over,
})

beforeEach(() => {
  fx.unified = true
  fx.safeTradeUi = true
  fx.approvals = []
  fx.queue = []
  fx.backlog = { pending: 0, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: null }
  fx.deadLetters = []
  fx.errors = { approvals: null, queue: null, backlog: null, deadLetters: null }
  fx.approveError = null
  fx.calls = []
  auth.user = { id: 'rev-1', role: 'admin' }
  auth.isAuthenticated = true
  auth.loading = false
})

describe('SafeTrade operations — unified console', () => {
  it('flag OFF keeps the legacy console', async () => {
    fx.unified = false
    renderPage()
    expect(await screen.findByTestId('safetrade-ops-page')).toBeInTheDocument()
    expect(screen.queryByTestId('ops-console')).toBeNull()
  })

  it('with the SafeTrade UI flag off it says so and fetches nothing', async () => {
    fx.safeTradeUi = false
    renderPage()
    expect(await screen.findByTestId('ops-unavailable')).toHaveAttribute('data-state', 'unavailable')
    await new Promise((r) => setTimeout(r, 50))
    expect(fx.calls).toHaveLength(0)
  })

  it('a signed-in non-reviewer is refused without a read', async () => {
    auth.user = { id: 'dealer-1', role: 'dealer' }
    renderPage()
    expect(await screen.findByTestId('ops-denied')).toHaveTextContent('Reviewer access required')
    expect(fx.calls).toHaveLength(0)
  })

  it('renders the console with the backlog pulse, the sandbox line and the non-custodial notice', async () => {
    fx.backlog = { pending: 3, retrying: 1, deadLettered: 0, oldestPendingAgeSeconds: 30 }
    renderPage()
    expect(await screen.findByTestId('ops-console')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'SafeTrade operations' })).toBeInTheDocument()
    expect(await screen.findByTestId('ops-backlog-pending')).toHaveTextContent('3')
    expect(screen.getByTestId('ops-backlog-oldest')).toHaveTextContent('30s')
    expect(screen.getByTestId('ops-sandbox-line')).toHaveTextContent('LIVE_PAYMENT is off')
    expect(screen.getByTestId('ops-sandbox-chip')).toHaveAttribute('data-provenance', 'sandbox')
    expect(screen.getByTestId('ops-noncustodial')).toHaveTextContent('CarUp does not hold, receive or automatically release real customer funds')
    expect(await screen.findByTestId('ops-queue-empty-approvals')).toHaveTextContent('No approvals are waiting.')
  })

  it('404 / 403 / 429 / 500 queue reads are distinct and never a clean result', async () => {
    fx.errors = {
      approvals: httpError(404, 'SafeTrade transaction not found'),
      queue: httpError(403, 'Forbidden'),
      backlog: httpError(429, 'Too many requests. Please try again later.'),
      deadLetters: httpError(500, 'An unexpected internal server error occurred'),
    }
    renderPage()
    const approvals = await screen.findByTestId('ops-queue-failed-approvals')
    expect(approvals).toHaveAttribute('data-failure', 'unavailable')
    expect(approvals).toHaveTextContent('SafeTrade transaction not found')
    expect(approvals).toHaveTextContent('This is not a report that none are waiting.')
    expect(screen.queryByText('No approvals are waiting.')).toBeNull()

    fireEvent.click(screen.getByTestId('review-queue-tab-confirmation'))
    const recon = await screen.findByTestId('ops-queue-failed-confirmation')
    expect(recon).toHaveAttribute('data-failure', 'denied')
    expect(recon).toHaveTextContent('This is not a report that everything is reconciled.')
    expect(screen.queryByText('Everything is reconciled.')).toBeNull()

    fireEvent.click(screen.getByTestId('review-queue-tab-undeliverable'))
    const dead = await screen.findByTestId('ops-queue-failed-undeliverable')
    expect(dead).toHaveAttribute('data-failure', 'failed')
    expect(within(dead).getByRole('button', { name: /try again/i })).toBeInTheDocument()

    expect(screen.getByTestId('ops-backlog-failed')).toHaveAttribute('data-state', 'limited')
    expect(screen.getByTestId('ops-backlog-pulse')).toHaveTextContent('Event backlog not loaded')
  })

  it('approving needs an explicit confirm step and sends the optional notes', async () => {
    fx.approvals = [approval()]
    renderPage()
    const start = await screen.findByTestId('ops-approve-start-ap-fx-1')
    expect(calls('approve')).toHaveLength(0)
    fireEvent.click(start)
    expect(calls('approve')).toHaveLength(0) // opening the confirm step decides nothing
    fireEvent.change(screen.getByTestId('ops-approve-notes-ap-fx-1'), { target: { value: 'Checked the FICTIONAL milestone evidence' } })
    fireEvent.click(screen.getByTestId('ops-approve-confirm-ap-fx-1'))
    await waitFor(() => expect(calls('approve')).toHaveLength(1))
    expect(calls('approve')[0].args).toEqual(['ap-fx-1', 'Checked the FICTIONAL milestone evidence'])
    expect(await screen.findByTestId('ops-notice')).toHaveTextContent('Approval recorded.')
  })

  it('a refused approval shows the legacy message plus the server words', async () => {
    fx.approvals = [approval()]
    fx.approveError = httpError(400, 'This approval has expired and must be requested again')
    renderPage()
    fireEvent.click(await screen.findByTestId('ops-approve-start-ap-fx-1'))
    fireEvent.click(screen.getByTestId('ops-approve-confirm-ap-fx-1'))
    const notice = await screen.findByTestId('ops-notice')
    expect(notice).toHaveTextContent('That approval could not be recorded.')
    expect(notice).toHaveTextContent('This approval has expired and must be requested again')
  })

  it('rejecting needs an explicit confirm step and sends the optional reason', async () => {
    fx.approvals = [approval()]
    renderPage()
    fireEvent.click(await screen.findByTestId('ops-reject-start-ap-fx-1'))
    fireEvent.change(screen.getByTestId('ops-reject-reason-ap-fx-1'), { target: { value: 'Evidence incomplete' } })
    fireEvent.click(screen.getByTestId('ops-reject-confirm-ap-fx-1'))
    await waitFor(() => expect(calls('reject')).toHaveLength(1))
    expect(calls('reject')[0].args).toEqual(['ap-fx-1', 'Evidence incomplete'])
  })

  it('an empty note or reason is sent exactly as the legacy console sends it (nothing)', async () => {
    fx.approvals = [approval()]
    renderPage()
    fireEvent.click(await screen.findByTestId('ops-approve-start-ap-fx-1'))
    fireEvent.click(screen.getByTestId('ops-approve-confirm-ap-fx-1'))
    await waitFor(() => expect(calls('approve')).toHaveLength(1))
    expect(calls('approve')[0].args).toEqual(['ap-fx-1', undefined])
  })

  it('a requester cannot approve their own request and is offered no reject', async () => {
    fx.approvals = [approval({ requested_by: 'rev-1', canApprove: false, selfApprovalBlocked: true })]
    renderPage()
    const blocked = await screen.findByTestId('ops-approval-self-blocked-ap-fx-1')
    expect(blocked).toHaveTextContent('You requested this decision, so a different reviewer must approve it (maker-checker)')
    expect(screen.getByTestId('ops-approve-start-ap-fx-1')).toBeDisabled()
    expect(screen.queryByTestId('ops-reject-start-ap-fx-1')).toBeNull()
    expect(screen.getByTestId('ops-queue-item-ap-fx-1')).toHaveTextContent('Requested by You')
  })

  it('drain and retry delivery are not offered to a non-admin reviewer', async () => {
    auth.user = { id: 'rev-2', role: 'reviewer' }
    fx.deadLetters = [deadLetter()]
    renderPage()
    fireEvent.click(await screen.findByTestId('review-queue-tab-undeliverable'))
    expect(await screen.findByTestId('ops-replay-not-offered-dl-fx-1')).toHaveTextContent('platform administrators only')
    expect(screen.queryByTestId('ops-replay-start-dl-fx-1')).toBeNull()
    expect(screen.queryByTestId('ops-drain-open')).toBeNull()
  })

  it('an admin retries delivery and drains only after confirming, and sees the drain summary', async () => {
    fx.deadLetters = [deadLetter()]
    renderPage()
    fireEvent.click(await screen.findByTestId('review-queue-tab-undeliverable'))
    fireEvent.click(await screen.findByTestId('ops-replay-start-dl-fx-1'))
    expect(calls('replay')).toHaveLength(0)
    fireEvent.click(screen.getByTestId('ops-replay-confirm-dl-fx-1'))
    await waitFor(() => expect(calls('replay')).toHaveLength(1))

    fireEvent.click(screen.getByTestId('ops-drain-open'))
    expect(calls('drain')).toHaveLength(0)
    fireEvent.click(screen.getByTestId('ops-drain-confirm-go'))
    expect(await screen.findByTestId('ops-drain-receipt')).toHaveTextContent('3 claimed · 2 dispatched · 1 failed')
  })

  it('an unconfirmed operation is never presented as settled, and offers no action', async () => {
    fx.queue = [{
      id: 'op-fx-1', tenant_id: 'T', transaction_id: 'txn-fx-1', milestone_id: null, operation: 'release', state: 'reconciling',
      provider: 'sandbox', provider_ref: null, provider_status: null, amount: 100, currency: 'USD', attempts: 2,
      next_attempt_at: null, last_error_code: 'PROVIDER_RESULT_UNKNOWN', last_error: null,
      requested_at: '2026-11-20T09:00:00Z', dispatched_at: null, confirmed_at: null,
      userState: { state: 'reconciling', userMessage: 'Awaiting confirmation from the payment provider.', settled: false },
    }]
    renderPage()
    fireEvent.click(await screen.findByTestId('review-queue-tab-confirmation'))
    expect(await screen.findByTestId('ops-operation-message')).toHaveTextContent('Awaiting confirmation from the payment provider.')
    expect(screen.getByTestId('ops-operation-settled')).toHaveTextContent('Not settled')
    expect(screen.getByTestId('ops-operation-no-action')).toHaveTextContent('do not retry them here')
    expect(screen.getByTestId('ops-console')).not.toHaveTextContent(/\bCompleted\b/)
  })
})
