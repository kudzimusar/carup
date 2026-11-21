/**
 * RX-06 — /diaspora/subscription unified plan & entitlements desk: plans and entitlements exactly as
 * returned, sandbox billing always explicit (no live checkout), a missing tenant and a 429 are their own
 * states (a rate limit is never "not permitted"), manager actions behind the same sandbox handlers with
 * confirmations. Flag OFF keeps the legacy page. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const flag = vi.hoisted(() => ({ on: true }))
const auth = vi.hoisted(() => ({ user: { id: 'fictional-owner', role: 'owner' } as { id: string; role: string }, isAuthenticated: true, loading: false }))
const api = vi.hoisted(() => ({
  getDiasporaSubscriptionPlans: vi.fn(),
  getDiasporaSubscriptionStatus: vi.fn(),
  getDiasporaEntitlements: vi.fn(),
  getDiasporaUsage: vi.fn(),
  createDiasporaCheckout: vi.fn(),
  createDiasporaBillingPortal: vi.fn(),
  changeDiasporaPlan: vi.fn(),
  cancelDiasporaSubscription: vi.fn(),
  fetchDiasporaBillingHealth: vi.fn(),
  fetchDiasporaReconciliationRuns: vi.fn(),
  runDiasporaBillingReconciliation: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/config/subscriptionFlag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/subscriptionFlag')>()),
  subscriptionUiEnabled: () => flag.on,
}))

const plans = [
  { planKey: 'free', name: 'Free', tier: 'free', sortOrder: 0, description: 'Browse and download templates.', entitlements: { 'diaspora.rfq.create': false, 'diaspora.workbook.download': true } },
  { planKey: 'diaspora_buyer', name: 'Diaspora Buyer', tier: 'buyer', sortOrder: 10, description: 'Create requests.', entitlements: { 'diaspora.rfq.create': true, 'diaspora.rfq.max_open': 10, 'diaspora.workbook.download': true } },
]
const status = { tenantId: 't', planKey: 'diaspora_buyer', status: 'active', synthetic: false, currentPeriodStart: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-01T00:00:00Z', cancelAtPeriodEnd: false, active: true }
const httpError = (code: number, message: string) => Object.assign(new Error(message), { status: code })

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/diaspora/DiasporaSubscription')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  flag.on = true
  auth.user = { id: 'fictional-owner', role: 'owner' }
  api.getDiasporaSubscriptionPlans.mockResolvedValue(plans)
  api.getDiasporaSubscriptionStatus.mockResolvedValue(status)
  api.getDiasporaEntitlements.mockResolvedValue({ tenantId: 't', userId: 'u', planKey: 'diaspora_buyer', planName: 'Diaspora Buyer', tier: 'buyer', status: 'active', source: 'db', entitlements: { 'diaspora.rfq.create': true, 'diaspora.rfq.max_open': 10 } })
  api.getDiasporaUsage.mockResolvedValue({ tenantId: 't', periodStart: '2026-11-01T00:00:00Z', usage: [{ featureKey: 'diaspora.rfq.max_open', limit: 10, used: 3, remaining: 7 }] })
  api.createDiasporaCheckout.mockResolvedValue({ sandbox: true })
  api.changeDiasporaPlan.mockResolvedValue({ sandbox: true })
  api.cancelDiasporaSubscription.mockResolvedValue({ sandbox: true })
  api.createDiasporaBillingPortal.mockResolvedValue({ sandbox: true })
  api.fetchDiasporaBillingHealth.mockResolvedValue({ tenantId: 't', failedWebhooks: { count: 0, events: [] }, supersededWebhooks: { count: 0, events: [] }, reconciliation: { lastCompletedAt: null, ageMinutes: null, stale: true, reason: 'NEVER_COMPLETED' }, checkout: { tenantId: 't', total: 0, counts: { open: 0, completed: 0, abandoned: 0, expired: 0, cancelled: 0 }, abandonmentRate: null } })
  api.fetchDiasporaReconciliationRuns.mockResolvedValue([])
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Plan & entitlements — unified desk', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByTestId('subscription-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-plan')).toBeNull()
  })

  it('the subscription UI flag off is a switched-off state that reads nothing', async () => {
    flag.on = false
    await mount()
    expect(await screen.findByTestId('trade-plan-unavailable')).toHaveAttribute('data-state', 'unavailable')
    expect(api.getDiasporaSubscriptionPlans).not.toHaveBeenCalled()
  })

  it('renders the plan, entitlements and usage exactly as returned — sandbox billing stated, read-only for an owner', async () => {
    await mount()
    expect(await screen.findByTestId('trade-plan-current-name')).toHaveTextContent('Diaspora Buyer')
    expect(screen.getByTestId('trade-plan-sandbox')).toHaveTextContent('No real payment is collected')
    const ent = screen.getByTestId('trade-plan-entitlements')
    expect(within(ent).getAllByTestId('trade-plan-entitlement-row').map((r) => r.textContent)).toEqual(['CreateIncluded', 'Max openUp to 10'])
    expect(screen.getByTestId('trade-plan-usage-row')).toHaveTextContent('3 of 10 used (7 remaining)')
    expect(screen.getByTestId('trade-plan-readonly')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-plan-manage')).toBeNull()
    const matrix = screen.getByTestId('trade-plan-matrix')
    expect(within(matrix).getByText('Your plan').closest('th')).toHaveAttribute('data-plan-key', 'diaspora_buyer')
    expect(screen.queryByText(/\$\d/)).toBeNull() // the catalogue carries no price, so none is shown
    expect(screen.queryByRole('button', { name: /^(pay|buy|subscribe|upgrade now)/i })).toBeNull()
  })

  it('a missing tenant is its own state, and the catalogue is still shown as returned (none marked yours)', async () => {
    api.getDiasporaSubscriptionStatus.mockRejectedValue(httpError(400, 'An x-tenant-id context is required for subscription operations'))
    await mount()
    expect(await screen.findByTestId('trade-plan-tenant')).toHaveAttribute('data-state', 'tenant')
    expect(screen.getByTestId('trade-plan-catalogue')).toBeInTheDocument()
    expect(screen.queryByText('Your plan')).toBeNull()
    expect(screen.queryByTestId('trade-plan-current')).toBeNull()
  })

  it('a 429 is the shared rate limit — never "not permitted"', async () => {
    api.getDiasporaSubscriptionStatus.mockRejectedValueOnce(httpError(429, 'Too many requests. Please try again later.'))
    await mount()
    const limited = await screen.findByTestId('trade-plan-failed')
    expect(limited).toHaveAttribute('data-state', 'limited')
    expect(limited).toHaveTextContent('This is not a permission problem')
    expect(screen.queryByText('Not permitted')).toBeNull()
    fireEvent.click(within(limited).getByRole('button', { name: /Retry now/ }))
    expect(await screen.findByTestId('trade-plan-current-name')).toHaveTextContent('Diaspora Buyer')
  })

  it('an unreadable usage read is not zero usage', async () => {
    api.getDiasporaUsage.mockRejectedValue(httpError(500, 'boom'))
    await mount()
    expect(await screen.findByTestId('trade-plan-usage-unreadable')).toHaveTextContent('This is not a report of zero usage')
  })

  it('a manager gets the sandbox controls: checkout runs at once, change and cancel ask first', async () => {
    auth.user = { id: 'fictional-admin', role: 'admin' }
    await mount()
    const manage = await screen.findByTestId('trade-plan-manage')
    expect(manage).toHaveTextContent('sandbox mode')
    expect(within(manage).getByTestId('trade-plan-checkout')).toHaveTextContent('Start sandbox checkout')
    fireEvent.click(within(manage).getByTestId('trade-plan-checkout'))
    await waitFor(() => expect(api.createDiasporaCheckout).toHaveBeenCalledWith('free'))
    expect(await within(manage).findByTestId('trade-plan-outcome')).toHaveTextContent('No real payment was collected')

    fireEvent.click(within(manage).getByTestId('trade-plan-change'))
    expect(api.changeDiasporaPlan).not.toHaveBeenCalled()
    fireEvent.click(await within(manage).findByTestId('trade-plan-change-confirm-yes'))
    await waitFor(() => expect(api.changeDiasporaPlan).toHaveBeenCalledWith('free'))

    fireEvent.click(within(manage).getByTestId('trade-plan-cancel'))
    const cancel = await within(manage).findByTestId('trade-plan-cancel-confirm')
    expect(cancel).toHaveTextContent('It is not cancelled immediately')
    fireEvent.click(within(cancel).getByTestId('trade-plan-cancel-confirm-yes'))
    await waitFor(() => expect(api.cancelDiasporaSubscription).toHaveBeenCalledWith(true))

    expect(await screen.findByTestId('trade-billing-ops')).toHaveTextContent('test mode')
    expect(await screen.findByTestId('trade-billing-reconciliation')).toHaveTextContent('Never run')
  })
})
