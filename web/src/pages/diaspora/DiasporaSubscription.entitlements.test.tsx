import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * F42: the page fetched the tenant's effective entitlements and then discarded them
 * (`const [, setEntitlements]`), so the promised "effective entitlements" were never rendered.
 * They must now appear as a truthful, API-derived list.
 */

const getDiasporaSubscriptionPlans = vi.fn()
const getDiasporaSubscriptionStatus = vi.fn()
const getDiasporaEntitlements = vi.fn()
const getDiasporaUsage = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'Owner', role: 'owner' }, isAuthenticated: true, loading: false }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    getDiasporaSubscriptionPlans,
    getDiasporaSubscriptionStatus,
    getDiasporaEntitlements,
    getDiasporaUsage,
  }),
}))

vi.mock('@/config/subscriptionFlag', () => ({ subscriptionUiEnabled: () => true }))

const { default: DiasporaSubscription } = await import('./DiasporaSubscription')

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/diaspora/subscription']}>
      <DiasporaSubscription />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getDiasporaSubscriptionPlans.mockResolvedValue([
    { planKey: 'free', name: 'Free', sortOrder: 0, entitlements: {} },
  ])
  getDiasporaSubscriptionStatus.mockResolvedValue({ planKey: 'free', status: 'active', synthetic: true })
  getDiasporaUsage.mockResolvedValue({ usage: [] })
  getDiasporaEntitlements.mockResolvedValue({})
})

describe('DiasporaSubscription effective entitlements (F42)', () => {
  it('renders the fetched effective entitlements instead of discarding them', async () => {
    getDiasporaEntitlements.mockResolvedValue({
      'diaspora.workbook.bulk_import': 25,
      'diaspora.drive.sync': true,
      'diaspora.ai.execute_medium': 0,
    })
    renderPage()

    await waitFor(() => expect(getDiasporaEntitlements).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByTestId('subscription-entitlement-row')).toHaveLength(3))

    const section = screen.getByTestId('subscription-entitlements')
    const text = section.textContent || ''
    expect(text).toContain('Effective entitlements')
    // Metered quota, boolean capability, and an unavailable feature — all truthfully labelled.
    expect(text).toContain('Workbook Bulk Import')
    expect(text).toContain('25 / month')
    expect(text).toContain('Drive Sync')
    expect(text).toContain('Included')
    expect(text).toContain('Ai Execute Medium')
    expect(text).toContain('Not included')
  })

  it('shows an honest empty state when the entitlement fetch yields nothing', async () => {
    renderPage()

    await waitFor(() => expect(getDiasporaEntitlements).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('subscription-entitlements-empty')).toBeTruthy())
    expect(screen.queryAllByTestId('subscription-entitlement-row')).toHaveLength(0)
  })
})
