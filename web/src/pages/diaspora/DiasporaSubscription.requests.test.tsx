import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * /diaspora/subscription request lifecycle (Issue #127, Phase 8).
 *
 * The page held the aggregate object returned by useCarUpApi(). That hook returns a NEW OBJECT on
 * every render, so `load` — a useCallback keyed on `[api, canView]` — changed identity on every
 * render too, and the mount effect depended on `load`. Each of load's own setState calls therefore
 * re-fired the effect: load → setState → render → new api → new load → effect → load, unbounded.
 *
 * On the deployed staging candidate this left the page permanently showing "Loading subscription…"
 * while issuing subscription requests continuously.
 *
 * WHY NO EXISTING TEST CAUGHT IT
 * ------------------------------
 * The deployed browser matrix caught it (spec 36 asserts that no surface is left permanently
 * loading); nothing local did. A rendered-text assertion cannot see this — the page still reaches
 * its loaded state eventually — and jsdom resolves mocked promises fast enough that a spinner is
 * never sampled mid-flight. The only assertion that proves the loop is gone is a REQUEST COUNT, so
 * that is what these tests assert.
 *
 * This is the third occurrence of the same defect in this codebase: PR #130 fixed it on
 * DiasporaTradeProfile and the Drive lane fixed it on DiasporaDriveConnections. Hence a test that
 * reproduces the hazard itself — a fresh object literal per render — rather than one that trusts the
 * page to be written correctly.
 */

const getDiasporaSubscriptionPlans = vi.fn()
const getDiasporaSubscriptionStatus = vi.fn()
const getDiasporaEntitlements = vi.fn()
const getDiasporaUsage = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'Owner', role: 'owner' }, isAuthenticated: true, loading: false }),
}))

// Reproduces the real hook's hazard: a fresh object literal on every render. If the page derived its
// effect deps from this object, the effects would re-fire on every state change.
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
    <StrictMode>
      <MemoryRouter initialEntries={['/diaspora/subscription']}>
        <DiasporaSubscription />
      </MemoryRouter>
    </StrictMode>,
  )
}

describe('DiasporaSubscription request lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `entitlements` is required: PlanComparison maps over it to build its feature cells, and a plan
    // without it throws during render — which would surface as an unhandled error rather than as a
    // failed assertion, and could mask a real one.
    getDiasporaSubscriptionPlans.mockResolvedValue([
      {
        planKey: 'free',
        name: 'Free',
        tier: 'free',
        sortOrder: 0,
        description: 'Free tier',
        entitlements: { 'diaspora.workbook.download': true },
      },
    ])
    getDiasporaSubscriptionStatus.mockResolvedValue({ planKey: 'free', status: 'active' })
    getDiasporaEntitlements.mockResolvedValue({})
    getDiasporaUsage.mockResolvedValue(null)
  })

  it('loads its backbone a BOUNDED number of times, not once per render', async () => {
    renderPage()
    await waitFor(() => expect(getDiasporaSubscriptionStatus).toHaveBeenCalled())

    // Let every resolved promise settle and every resulting render flush. Under the loop each of
    // those renders produced a new `api`, a new `load`, and another request.
    await new Promise((resolve) => setTimeout(resolve, 150))

    // StrictMode intentionally double-invokes effects on mount, so 2 is the honest ceiling for a
    // correct page. The loop produced numbers that climbed with every settle.
    expect(
      getDiasporaSubscriptionStatus.mock.calls.length,
      `status was requested ${getDiasporaSubscriptionStatus.mock.calls.length} times; a bounded ` +
        'mount fetch is at most 2 under StrictMode. More means the effect is re-firing on its own ' +
        'state changes — the unbounded useCarUpApi() loop.',
    ).toBeLessThanOrEqual(2)
    expect(getDiasporaSubscriptionPlans.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('does not leave the page permanently in its loading state', async () => {
    renderPage()
    // The deployed matrix's assertion, reproduced locally: whatever else happens, the spinner must
    // go away. A page that never stops loading is the failure this whole file exists to prevent.
    await waitFor(
      () => expect(screen.queryByTestId('subscription-loading')).toBeNull(),
      { timeout: 3000 },
    )
  })

  it('a failing status request still settles the page instead of spinning forever', async () => {
    // The deployed fixtures are tenantless, so the real deployment answers this call with
    // 400 "An x-tenant-id context is required". The page must render that as a stated outcome.
    getDiasporaSubscriptionStatus.mockRejectedValue(
      Object.assign(new Error('An x-tenant-id context is required for subscription operations'), { status: 400 }),
    )
    renderPage()

    await waitFor(
      () => expect(screen.queryByTestId('subscription-loading')).toBeNull(),
      { timeout: 3000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(
      getDiasporaSubscriptionStatus.mock.calls.length,
      'a REJECTED status request re-fired the effect — the error path loops too',
    ).toBeLessThanOrEqual(2)
  })
})
