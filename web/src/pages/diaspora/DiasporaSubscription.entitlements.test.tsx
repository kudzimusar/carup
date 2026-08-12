import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { EffectiveEntitlementsEnvelope } from '@/types'

/**
 * F42 (envelope half): GET /diaspora/subscription/entitlements returns an ENVELOPE —
 * { tenantId, userId, planKey, planName, tier, status, source, synthetic, entitlements, overrides }
 * (mirrors backend/tests/diaspora-subscription-routes.test.js asserting body.data.planKey and
 * body.data.entitlements). Typing it as a flat feature map made the page render the envelope's
 * FIELD NAMES ("Tenant Id — Not included") and zero real entitlements. The page must iterate
 * envelope.entitlements, show the plan header, and disclose a config-fallback resolution.
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

function envelope(overrides: Partial<EffectiveEntitlementsEnvelope> = {}): EffectiveEntitlementsEnvelope {
  return {
    tenantId: 'tenant-A',
    userId: 'u-1',
    planKey: 'seller',
    planName: 'Seller / Supplier',
    tier: 'seller',
    status: 'active',
    source: 'config',
    synthetic: false,
    entitlements: {},
    overrides: {},
    ...overrides,
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
    { planKey: 'seller', name: 'Seller / Supplier', sortOrder: 20, entitlements: {} },
  ])
  getDiasporaSubscriptionStatus.mockResolvedValue({ planKey: 'seller', status: 'active', synthetic: false })
  getDiasporaUsage.mockResolvedValue({ usage: [] })
  getDiasporaEntitlements.mockResolvedValue(envelope())
})

describe('DiasporaSubscription effective entitlements envelope (F42)', () => {
  it('renders envelope.entitlements — never the envelope field names', async () => {
    getDiasporaEntitlements.mockResolvedValue(envelope({
      entitlements: {
        'diaspora.workbook.bulk_import': 25,
        'diaspora.drive.connect': true,
        'diaspora.ai.execute_medium': 0,
      },
    }))
    renderPage()

    await waitFor(() => expect(getDiasporaEntitlements).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByTestId('subscription-entitlement-row')).toHaveLength(3))

    const section = screen.getByTestId('subscription-entitlements')
    const text = section.textContent || ''
    expect(text).toContain('Effective entitlements')
    // Metered quota, boolean capability, and a zero quota — all truthfully labelled.
    expect(text).toContain('Workbook Bulk Import')
    expect(text).toContain('25 / month')
    expect(text).toContain('Drive Connect')
    expect(text).toContain('Included')
    expect(text).toContain('Ai Execute Medium')
    expect(text).toContain('Not included')
    // Envelope metadata must never be presented as entitlements.
    expect(text).not.toContain('Tenant Id')
    expect(text).not.toContain('User Id')
    expect(text).not.toContain('Plan Key')
    expect(text).not.toContain('Synthetic')
  })

  it('shows the plan header derived from the envelope (planName · tier · status)', async () => {
    getDiasporaEntitlements.mockResolvedValue(envelope({
      entitlements: { 'diaspora.drive.connect': true },
    }))
    renderPage()

    const header = await screen.findByTestId('subscription-entitlements-plan')
    expect(header.textContent).toContain('Seller / Supplier')
    expect(header.textContent).toContain('seller')
    expect(header.textContent).toContain('active')
  })

  it("discloses 'source: config fallback' when the catalog resolved the plan", async () => {
    getDiasporaEntitlements.mockResolvedValue(envelope({
      source: 'config',
      entitlements: { 'diaspora.workbook.download': true },
    }))
    renderPage()

    const note = await screen.findByTestId('subscription-entitlements-source')
    expect(note.textContent).toContain('source: config fallback')
  })

  it('omits the config-fallback note when the plan row came from the database', async () => {
    getDiasporaEntitlements.mockResolvedValue(envelope({
      source: 'db',
      entitlements: { 'diaspora.workbook.download': true },
    }))
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
