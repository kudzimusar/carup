import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { describeBillingHealth, describeReconciliationRun } from '../billingOperationsHelpers'
import type { BillingHealth, BillingReconciliationRun } from '@/types'

/**
 * Billing operations panel (Issue #127, Deliverable D).
 *
 * The rule under test is the one an observability surface most easily breaks: **a route that
 * responds is not a healthy system.** A reconciliation scheduler that quietly stopped reports the
 * same "0 mismatches" as a healthy one, so freshness must be judged independently — otherwise the
 * most dangerous failure renders as all-clear.
 */

const fetchDiasporaBillingHealth = vi.fn()
const fetchDiasporaReconciliationRuns = vi.fn()
const runDiasporaBillingReconciliation = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDiasporaBillingHealth,
    fetchDiasporaReconciliationRuns,
    runDiasporaBillingReconciliation,
  }),
}))

const BillingOperationsPanel = (await import('../BillingOperationsPanel')).default

function health(over: Partial<BillingHealth> = {}): BillingHealth {
  return {
    tenantId: 'tenant-A',
    failedWebhooks: { count: 0, events: [] },
    supersededWebhooks: { count: 0, events: [] },
    reconciliation: { lastCompletedAt: '2026-07-27T00:00:00Z', ageMinutes: 5, stale: false, reason: null },
    checkout: { tenantId: 'tenant-A', total: 0, counts: { open: 0, completed: 0, abandoned: 0, expired: 0, cancelled: 0 }, abandonmentRate: null },
    ...over,
  }
}

function run(over: Partial<BillingReconciliationRun> = {}): BillingReconciliationRun {
  return {
    id: 'r1', tenant_id: 'tenant-A', provider: 'test', trigger: 'operator', state: 'completed',
    started_at: null, finished_at: null, checked_count: 3, mismatch_count: 0, repaired_count: 0,
    findings: [], initiated_by: 'u1', last_error: null, ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchDiasporaBillingHealth.mockResolvedValue(health())
  fetchDiasporaReconciliationRuns.mockResolvedValue([])
  runDiasporaBillingReconciliation.mockResolvedValue({ runId: 'r9', state: 'completed', trigger: 'operator', checked: 3, mismatches: 0, findings: [], correlationId: 'c1' })
})

describe('describeBillingHealth', () => {
  it('treats a never-completed reconciliation as failed, not as all-clear', () => {
    const s = describeBillingHealth(health({
      reconciliation: { lastCompletedAt: null, ageMinutes: null, stale: true, reason: 'NEVER_COMPLETED' },
    }))
    expect(s.reconciliation.tone).toBe('failed')
    expect(s.needsOperator).toBe(true)
    expect(s.reconciliation.detail).toMatch(/not the same as "no problems found"/i)
  })

  it('treats a stale reconciliation as failed even with zero mismatches', () => {
    // The decisive case: a stopped scheduler and a healthy one both report zero mismatches.
    const s = describeBillingHealth(health({
      reconciliation: { lastCompletedAt: '2026-07-01T00:00:00Z', ageMinutes: 9000, stale: true, reason: 'STALE' },
      failedWebhooks: { count: 0, events: [] },
    }))
    expect(s.reconciliation.tone).toBe('failed')
    expect(s.needsOperator).toBe(true)
    expect(s.needsOperatorReason).toMatch(/stale/i)
  })

  it('reports fresh reconciliation with no dead letters as healthy', () => {
    const s = describeBillingHealth(health())
    expect(s.reconciliation.tone).toBe('ok')
    expect(s.failedWebhooks.tone).toBe('ok')
    expect(s.needsOperator).toBe(false)
  })

  it('treats dead-lettered provider events as terminal, needing an operator', () => {
    const s = describeBillingHealth(health({ failedWebhooks: { count: 2, events: [] } }))
    expect(s.failedWebhooks.tone).toBe('failed')
    expect(s.failedWebhooks.detail).toMatch(/will not apply automatically/i)
    expect(s.needsOperator).toBe(true)
  })
})

describe('describeReconciliationRun', () => {
  it('never reports a failed run as a clean check', () => {
    const d = describeReconciliationRun(run({ state: 'failed' }))
    expect(d.tone).toBe('failed')
    expect(d.detail).toMatch(/cannot be treated as a clean check/i)
  })

  it('reports mismatches truthfully', () => {
    expect(describeReconciliationRun(run({ mismatch_count: 2 })).tone).toBe('failed')
    expect(describeReconciliationRun(run({ mismatch_count: 0 })).tone).toBe('ok')
  })

  it('does not describe a running run as complete', () => {
    expect(describeReconciliationRun(run({ state: 'running' })).tone).toBe('pending')
  })
})

describe('BillingOperationsPanel', () => {
  it('loads health exactly once and does not loop', async () => {
    const { rerender } = render(<BillingOperationsPanel />)
    await screen.findByTestId('billing-operations-panel')
    for (let i = 0; i < 4; i += 1) rerender(<BillingOperationsPanel />)
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(fetchDiasporaBillingHealth).toHaveBeenCalledTimes(1)
  })

  it('always labels the integration as test mode', async () => {
    const { container } = render(<BillingOperationsPanel />)
    await screen.findByTestId('billing-operations-panel')
    expect(container.textContent).toMatch(/test mode/i)
    expect(container.textContent).not.toMatch(/payment succeeded|card charged|live subscription activated/i)
  })

  it('surfaces a needs-operator state when reconciliation is stale', async () => {
    fetchDiasporaBillingHealth.mockResolvedValue(health({
      reconciliation: { lastCompletedAt: '2026-07-01T00:00:00Z', ageMinutes: 9000, stale: true, reason: 'STALE' },
    }))
    render(<BillingOperationsPanel />)
    const panel = await screen.findByTestId('billing-needs-operator')
    expect(panel.textContent).toMatch(/will not resolve on their own/i)
  })

  it('renders nothing at all for a non-manager (403), rather than an empty dashboard', async () => {
    const denial = Object.assign(new Error('forbidden'), { status: 403 })
    fetchDiasporaBillingHealth.mockRejectedValue(denial)
    fetchDiasporaReconciliationRuns.mockRejectedValue(denial)
    const { container } = render(<BillingOperationsPanel />)
    await waitFor(() => expect(container.querySelector('[data-testid="billing-operations-panel"]')).toBeNull())
  })

  it('a double-clicked reconcile starts exactly one run', async () => {
    let release: (v: unknown) => void = () => {}
    runDiasporaBillingReconciliation.mockImplementation(() => new Promise(r => { release = r }))
    render(<BillingOperationsPanel />)
    const btn = await screen.findByTestId('billing-reconcile-now')
    await act(async () => { fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn) })
    expect(runDiasporaBillingReconciliation).toHaveBeenCalledTimes(1)
    await act(async () => { release({ runId: 'r9', state: 'completed', trigger: 'operator', checked: 1, mismatches: 0, findings: [], correlationId: null }) })
  })

  it('reports a reconciliation that found mismatches without claiming success', async () => {
    runDiasporaBillingReconciliation.mockResolvedValue({ runId: 'r9', state: 'completed', trigger: 'operator', checked: 4, mismatches: 2, findings: [], correlationId: null })
    render(<BillingOperationsPanel />)
    await act(async () => { fireEvent.click(await screen.findByTestId('billing-reconcile-now')) })
    const outcome = await screen.findByTestId('billing-reconcile-outcome')
    expect(outcome.textContent).toMatch(/2 mismatches/i)
    expect(outcome.textContent).not.toMatch(/no mismatches/i)
  })

  it('offers a controlled retry when health cannot be read', async () => {
    fetchDiasporaBillingHealth.mockRejectedValueOnce(new Error('backend down'))
    fetchDiasporaReconciliationRuns.mockResolvedValue([])
    render(<BillingOperationsPanel />)
    const err = await screen.findByTestId('billing-ops-error')
    expect(err.textContent).toContain('backend down')
    expect(screen.getByTestId('billing-ops-retry')).toBeTruthy()
  })

  it('lists recent runs and marks a failed one as not clean', async () => {
    fetchDiasporaReconciliationRuns.mockResolvedValue([run({ id: 'r2', state: 'failed' })])
    render(<BillingOperationsPanel />)
    const row = await screen.findByTestId('billing-run-failed')
    expect(row.textContent).toMatch(/failed/i)
  })
})
