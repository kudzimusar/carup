import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * DB-contract audit: GET /diaspora/subscription/entitlements returns an ENVELOPE
 * ({ tenantId, userId, planKey, source, entitlements, ... } — see the backend contract test
 * diaspora-subscription-routes.test.js asserting body.data.planKey / body.data.entitlements).
 * The page previously treated the envelope itself as the feature map and rendered its FIELD NAMES
 * ("Tenant Id — Not included") instead of real entitlements. It must iterate envelope.entitlements,
 * surface the plan context, and disclose the config fallback when source === 'config'.
 * Feature keys below are REAL keys from backend/constants/diaspora/diasporaEntitlements.js.
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

/** Backend-shaped envelope, mirroring resolveEffectiveEntitlements(). */
function envelope(
  entitlements: Record<string, boolean | number>,
  extra: Record<string, unknown> = {},
) {
  return {
    tenantId: 'tenant-1',
    userId: 'u-1',
    planKey: 'seller',
    planName: 'Seller',
    tier: 'standard',
    status: 'active',
    source: 'config',
    synthetic: false,
    entitlements,
    overrides: {},
    ...extra,
  }
}

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
  getDiasporaEntitlements.mockResolvedValue(envelope({}))
})

describe('DiasporaSubscription effective entitlements (envelope contract)', () => {
  it('renders envelope.entitlements — real feature rows, never the envelope field names', async () => {
    getDiasporaEntitlements.mockResolvedValue(envelope({
      'diaspora.workbook.bulk_import': 25,
      'diaspora.drive.connect': true,
      'diaspora.ai.execute_medium': 0,
    }))
    renderPage()

    await waitFor(() => expect(getDiasporaEntitlements).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByTestId('subscription-entitlement-row')).toHaveLength(3))

    const section = screen.getByTestId('subscription-entitlements')
    const text = section.textContent || ''
    expect(text).toContain('Effective entitlements')
    // Metered quota, boolean capability, and an unavailable feature — all truthfully labelled.
    expect(text).toContain('Workbook Bulk Import')
    expect(text).toContain('25 / month')
    expect(text).toContain('Drive Connect')
    expect(text).toContain('Included')
    expect(text).toContain('Ai Execute Medium')
    expect(text).toContain('Not included')
    // The regression this guards: envelope FIELD NAMES must never render as fake features.
    expect(text).not.toContain('Tenant Id')
    expect(text).not.toContain('User Id')
    expect(text).not.toContain('Plan Key')
    expect(text).not.toContain('Overrides')
  })

  it('surfaces the plan context (planName · tier · status) from the envelope', async () => {
    getDiasporaEntitlements.mockResolvedValue(envelope({ 'diaspora.stock.publish': true }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('subscription-entitlements-plan')).toBeTruthy())
    const header = screen.getByTestId('subscription-entitlements-plan')
    expect(header.textContent).toContain('Seller')
    expect(header.textContent).toContain('standard')
    expect(header.textContent).toContain('active')
  })

  it("discloses the config fallback when source === 'config' and stays silent for 'db'", async () => {
    getDiasporaEntitlements.mockResolvedValue(envelope({ 'diaspora.rfq.create': true }, { source: 'config' }))
    const { unmount } = renderPage()

    await waitFor(() => expect(screen.getByTestId('subscription-entitlements-source')).toBeTruthy())
    expect(screen.getByTestId('subscription-entitlements-source').textContent).toContain('config fallback')
    unmount()

    getDiasporaEntitlements.mockResolvedValue(envelope({ 'diaspora.rfq.create': true }, { source: 'db' }))
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId('subscription-entitlement-row')).toHaveLength(1))
    expect(screen.queryByTestId('subscription-entitlements-source')).toBeNull()
  })

  it('shows an honest empty state when the envelope carries no entitlements', async () => {
    renderPage()

    await waitFor(() => expect(getDiasporaEntitlements).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('subscription-entitlements-empty')).toBeTruthy())
    expect(screen.queryAllByTestId('subscription-entitlement-row')).toHaveLength(0)
  })
})
