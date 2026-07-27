/**
 * SafeTrade Operations console — component tests (ST-3 #1/#2/#3, Issue #127).
 *
 * The console's job is to make three invisible failure modes visible. These tests target exactly
 * those, plus the containment property that a money console must never break:
 *
 *   · a stalled drainer (small count, very old head) is called out, not left to be inferred;
 *   · an unconfirmed operation is never presented as success;
 *   · self-approval is explained, not merely greyed out;
 *   · a hostile API response cannot paint participant data onto an operator's screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({
  flagOn: true,
  user: { id: 'rev-1', role: 'reviewer' } as { id: string; role: string } | null,
  isAuthenticated: true,
  authLoading: false,
  approvals: [] as unknown[],
  queue: [] as unknown[],
  backlog: null as unknown,
  deadLetters: [] as unknown[],
  approvalsError: null as Error | null,
  approved: [] as string[],
  drained: 0,
  replayed: [] as string[],
}))

vi.mock('@/config/safeTradeFlag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/safeTradeFlag')>()
  return { ...actual, safeTradeUiEnabled: () => state.flagOn }
})
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: state.user, isAuthenticated: state.isAuthenticated, loading: state.authLoading }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    getSafeTradeApprovals: async () => { if (state.approvalsError) throw state.approvalsError; return state.approvals },
    getSafeTradeReconciliationQueue: async () => state.queue,
    getSafeTradeOutboxBacklog: async () => state.backlog,
    getSafeTradeOutboxDeadLetters: async () => state.deadLetters,
    approveSafeTradeDecision: async (id: string) => { state.approved.push(id); return {} },
    rejectSafeTradeDecision: async () => ({}),
    drainSafeTradeOutbox: async () => { state.drained += 1; return {} },
    replaySafeTradeOutboxEvent: async (id: string) => { state.replayed.push(id); return {} },
  }),
}))

const { default: Ops } = await import('./DiasporaSafeTradeOperations')
const { formatAge, outboxHealth, OUTBOX_STALL_WARN_SECONDS } = await import('./safeTradeOperationsHelpers')

const renderPage = () => render(<MemoryRouter><Ops /></MemoryRouter>)

const healthyBacklog = { pending: 0, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: null }

beforeEach(() => {
  state.flagOn = true
  state.user = { id: 'rev-1', role: 'reviewer' }
  state.isAuthenticated = true
  state.authLoading = false
  state.approvals = []
  state.queue = []
  state.backlog = healthyBacklog
  state.deadLetters = []
  state.approvalsError = null
  state.approved = []
  state.drained = 0
  state.replayed = []
})
afterEach(() => vi.clearAllMocks())

describe('gating', () => {
  it('fails closed with the flag off and fetches nothing', async () => {
    state.flagOn = false
    renderPage()
    expect(await screen.findByTestId('safetrade-ops-unavailable')).toBeTruthy()
  })

  it('refuses a non-reviewer', async () => {
    state.user = { id: 'u', role: 'owner' }
    renderPage()
    expect(await screen.findByTestId('safetrade-ops-forbidden')).toBeTruthy()
  })

  it('admits a reviewer', async () => {
    renderPage()
    expect(await screen.findByTestId('safetrade-ops-page')).toBeTruthy()
  })
})

describe('ST-3 #2 · approvals', () => {
  it('explains self-approval rather than silently disabling the control', async () => {
    state.approvals = [{
      id: 'ap1', transaction_id: 't1', milestone_id: null, decision_type: 'release', risk_level: 'HIGH',
      amount: 5000, currency: 'USD', requested_by: 'rev-1', requested_at: '2026-07-28T09:00:00Z',
      requested_reason: 'High-risk release', expires_at: null, state: 'pending',
      canApprove: false, selfApprovalBlocked: true,
    }]
    renderPage()
    const blocked = await screen.findByTestId('approval-self-blocked-ap1')
    expect(blocked.textContent).toContain('a different reviewer must approve it')
    expect(screen.queryByTestId('approve-ap1')).toBeNull()
  })

  it('offers approve/reject for someone else\'s request', async () => {
    state.approvals = [{
      id: 'ap2', transaction_id: 't1', milestone_id: null, decision_type: 'release', risk_level: 'HIGH',
      amount: null, currency: null, requested_by: 'rev-other', requested_at: '2026-07-28T09:00:00Z',
      requested_reason: null, expires_at: null, state: 'pending', canApprove: true, selfApprovalBlocked: false,
    }]
    renderPage()
    const btn = await screen.findByTestId('approve-ap2')
    await userEvent.click(btn)
    await waitFor(() => expect(state.approved).toEqual(['ap2']))
  })

  it('shows an empty state when nothing is waiting', async () => {
    renderPage()
    expect(await screen.findByTestId('approvals-empty')).toBeTruthy()
  })
})

describe('ST-3 #3 · reconciliation', () => {
  it('never presents an unconfirmed operation as success', async () => {
    state.queue = [{
      id: 'op1', tenant_id: 'T', transaction_id: 't1', milestone_id: null, operation: 'release',
      state: 'reconciling', provider: 'sandbox', provider_ref: null, provider_status: null,
      amount: 100, currency: 'USD', attempts: 2, next_attempt_at: null,
      last_error_code: 'PROVIDER_RESULT_UNKNOWN', last_error: null,
      requested_at: '2026-07-28T09:00:00Z', dispatched_at: null, confirmed_at: null,
      userState: { state: 'reconciling', userMessage: 'Awaiting confirmation from the payment provider. Our team is reconciling this — do not retry.', settled: false },
    }]
    const { container } = renderPage()
    await screen.findByTestId('recon-op1')
    expect(screen.getByTestId('recon-message-op1').textContent).toContain('Awaiting confirmation')
    expect(container.textContent).not.toMatch(/\bCompleted\b/)
  })

  it('tells the operator explicitly not to retry from this screen', async () => {
    renderPage()
    const page = await screen.findByTestId('safetrade-ops-page')
    expect(page.textContent).toContain('do not retry them here')
  })
})

describe('ST-3 #1 · outbox backlog', () => {
  it('calls out a stalled drainer instead of leaving it to be inferred', async () => {
    // The signature of a stall: a SMALL count with a very OLD head. A count alone looks harmless.
    state.backlog = { pending: 3, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: 4 * 3600 }
    renderPage()
    const stalled = await screen.findByTestId('outbox-stalled')
    expect(stalled.textContent).toContain('not being delivered')
    expect(screen.getByTestId('outbox-oldest').textContent).toContain('4 hr')
  })

  it('does not warn when the head is fresh', async () => {
    state.backlog = { pending: 40, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: 5 }
    renderPage()
    await screen.findByTestId('outbox-backlog')
    expect(screen.queryByTestId('outbox-stalled')).toBeNull()
  })

  it('hides drain and replay from a non-platform-admin reviewer', async () => {
    state.user = { id: 'rev-1', role: 'reviewer' }
    state.deadLetters = [{
      id: 'dl1', tenant_id: 'T', transaction_id: 't1', milestone_id: null, event_type: 'X',
      status: 'dead_lettered', attempts: 5, last_error: 'boom', created_at: '2026-07-28T09:00:00Z',
      next_attempt_at: null, payloadWithheld: true, payloadWithheldReason: 'Outbox payloads are never returned.',
    }]
    renderPage()
    await screen.findByTestId('outbox-dead-list')
    expect(screen.queryByTestId('outbox-drain')).toBeNull()
    expect(screen.queryByTestId('outbox-replay-dl1')).toBeNull()
  })

  it('offers drain and replay to a platform admin', async () => {
    state.user = { id: 'admin-1', role: 'platform_admin' }
    state.deadLetters = [{
      id: 'dl1', tenant_id: 'T', transaction_id: 't1', milestone_id: null, event_type: 'X',
      status: 'dead_lettered', attempts: 5, last_error: 'boom', created_at: '2026-07-28T09:00:00Z',
      next_attempt_at: null, payloadWithheld: true, payloadWithheldReason: 'Outbox payloads are never returned.',
    }]
    renderPage()
    await userEvent.click(await screen.findByTestId('outbox-replay-dl1'))
    await waitFor(() => expect(state.replayed).toEqual(['dl1']))
  })
})

describe('resilience', () => {
  it('keeps the other queues usable when one read fails', async () => {
    // A money console that blanks entirely because one of four reads failed is worse than one that
    // shows three true queues and says so.
    state.approvalsError = new Error('approvals unavailable')
    state.backlog = { pending: 1, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: 10 }
    renderPage()
    expect(await screen.findByTestId('safetrade-ops-partial')).toBeTruthy()
    expect(screen.getByTestId('outbox-backlog')).toBeTruthy()
  })

  it('announces status through a live region', async () => {
    renderPage()
    const a = await screen.findByTestId('safetrade-ops-announcer')
    expect(a.getAttribute('role')).toBe('status')
    expect(a.getAttribute('aria-live')).toBe('polite')
  })

  it('carries the non-custodial notice verbatim', async () => {
    renderPage()
    const notice = await screen.findByTestId('safetrade-ops-notice-noncustodial')
    expect(notice.textContent).toContain('CarUp does not hold, receive or automatically release real customer funds')
  })
})

describe('adversarial containment', () => {
  it('cannot render participant data injected by the API', async () => {
    const POISON = {
      email: 'victim@example.com', phone: '+263771234567',
      participantId: 'participant-7f3a91', statement: 'free text a participant typed',
    }
    state.user = { id: 'admin-1', role: 'platform_admin' }
    state.approvals = [{
      id: 'ap1', transaction_id: 't1', milestone_id: null, decision_type: 'release', risk_level: 'HIGH',
      amount: null, currency: null, requested_by: 'rev-other', requested_at: '2026-07-28T09:00:00Z',
      requested_reason: null, expires_at: null, state: 'pending', canApprove: true,
      ...POISON,
    }]
    state.deadLetters = [{
      id: 'dl1', tenant_id: 'T', transaction_id: 't1', milestone_id: null, event_type: 'X',
      status: 'dead_lettered', attempts: 5, last_error: 'boom', created_at: '2026-07-28T09:00:00Z',
      next_attempt_at: null, payloadWithheld: true, payloadWithheldReason: 'Outbox payloads are never returned.',
      payload: POISON,
    }]
    const { container } = renderPage()
    await screen.findByTestId('outbox-dead-list')
    for (const [field, value] of Object.entries(POISON)) {
      expect(container.textContent, `${field} must not be rendered`).not.toContain(value)
    }
  })
})

describe('pure helpers', () => {
  it('formatAge is readable at every scale', () => {
    expect(formatAge(30)).toBe('30s')
    expect(formatAge(600)).toBe('10 min')
    expect(formatAge(7200)).toBe('2 hr')
    expect(formatAge(3 * 86400)).toBe('3 days')
    expect(formatAge(null)).toBe('unknown')
  })

  it('outboxHealth treats a dead letter as an error regardless of age', () => {
    expect(outboxHealth({ pending: 0, retrying: 0, deadLettered: 1, oldestPendingAgeSeconds: 0 })).toBe('error')
  })

  it('outboxHealth warns purely on the age of the head', () => {
    expect(outboxHealth({ pending: 1, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: OUTBOX_STALL_WARN_SECONDS })).toBe('warn')
    expect(outboxHealth({ pending: 999, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: 1 })).toBe('ok')
  })
})
