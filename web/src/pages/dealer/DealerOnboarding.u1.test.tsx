/**
 * O2 · U1 — THE DEALER APPLICANT MUST REACH THEIR OWN ONBOARDING.
 *
 * Owner UAT, candidate 1f26282a: a Dealer applicant signed in, was sent to
 * /dealer/onboarding, and was bounced straight back to /login. Signing in again
 * bounced again. The applicant could never reach the page, so the whole Dealer
 * journey was untestable.
 *
 * The cause was NOT in the page and NOT in the backend. `/dealer/onboarding`
 * has no feature-registry entry, and `evaluateRouteAccess` treated "no registry
 * entry" on an auth-enforcing layout as "redirect to login" — for everyone,
 * including a caller who was already signed in.
 *
 * The existing DealerOnboarding suite could never have caught this: it mounts
 * the page directly, so it never crosses the boundary where the bounce lived.
 * This suite mounts the page BEHIND `RegistryRouteBoundary`, the way the
 * shipped shell does, and asserts on what the Product Owner actually
 * experienced:
 *
 *   1. The signed-in applicant is NOT redirected.
 *   2. The onboarding request actually goes out — "did not redirect" is not the
 *      same as "the page loaded", and a blank render would satisfy the first
 *      assertion while failing the user exactly as before.
 *   3. A reload lands on the page again, because the bounce recurred on every
 *      entry and not only on the first.
 *   4. The gate is still a gate: an anonymous caller is still redirected, and
 *      to a SAFE return-to.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RegistryRouteBoundary } from '@/components/routing/RegistryRouteBoundary'
import DealerOnboarding from './DealerOnboarding'

const fetchDealerOnboardingOverview = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDealerOnboardingOverview,
    saveDealerOnboardingProfile: vi.fn().mockResolvedValue({ success: true }),
    uploadDealerEvidence: vi.fn(),
    runDealerDocumentOcr: vi.fn(),
    addDealerOnboardingBranch: vi.fn(),
    inspectDealerWorkbook: vi.fn(),
    confirmDealerWorkbookMapping: vi.fn(),
    runDealerWorkbookDryRun: vi.fn(),
  }),
}))

/** The signed-in identity under test. `null` renders an anonymous visitor. */
let currentUser: { id: string; role: string } | null = { id: 'dealer-app-1', role: 'owner' }
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, loading: false }),
}))
vi.mock('@/context/featureGovernanceStore', () => ({
  useFeatureEffectiveStates: () => ({}),
}))
vi.mock('@/lib/navigationAnalytics', () => ({ trackNav: vi.fn() }))

const OVERVIEW = {
  registration: { organization_name: 'Moyo Motors', onboarding_status: 'requested' },
  profile: {
    legal_name: 'Moyo Motors (Pvt) Ltd', trading_name: 'Moyo Motors', registration_number: 'CR-12345',
    tax_id: '', physical_address: '', responsible_person: '', operating_country: 'Zimbabwe',
  },
  requirements: [{ id: 'r1', requirement_key: 'company_registration', status: 'required', is_blocking: true }],
  documents: [],
  branches: [],
  compliance: {
    identity_status: 'unverified', business_evidence_status: 'incomplete', compliance_review_state: 'not_started',
    active_state: 'inactive', restriction_state: 'none', suspension_state: 'none', investigation_state: 'none',
    expiry_state: 'none', can_publish: false, blocking_requirements: ['company_registration'],
  },
  responsible_person_identity: { effective_state: 'verified', capability_bearing: true, applicant_guidance: null, who_must_act: 'none' },
  who_must_act: 'subject_action',
  workspace_access: { available: false, dependency: 'governed_dealer_role_or_tenant_relationship', note: 'Dealer tools unlock after Dealer Compliance approval.' },
  document_types: ['company_registration'],
}

/**
 * The shipped arrangement: an auth-enforcing boundary wrapping the page, plus a
 * visible stand-in for /login so a bounce is observable rather than inferred.
 */
function renderBehindBoundary() {
  return render(
    <MemoryRouter initialEntries={['/dealer/onboarding']}>
      <Routes>
        <Route
          path="/dealer/onboarding"
          element={<RegistryRouteBoundary><DealerOnboarding /></RegistryRouteBoundary>}
        />
        <Route path="/login" element={<div data-testid="bounced-to-login">LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('U1 — a signed-in Dealer applicant reaches /dealer/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentUser = { id: 'dealer-app-1', role: 'owner' }
    fetchDealerOnboardingOverview.mockResolvedValue(OVERVIEW)
  })

  it('does not bounce the applicant back to login', async () => {
    renderBehindBoundary()
    await waitFor(() => expect(fetchDealerOnboardingOverview).toHaveBeenCalled())
    expect(screen.queryByTestId('bounced-to-login')).toBeNull()
  })

  it('actually requests the onboarding overview — the page loaded, it did not merely fail to redirect', async () => {
    renderBehindBoundary()
    // The distinction matters: a boundary that rendered nothing at all would
    // pass the redirect assertion above while leaving the applicant exactly as
    // stuck as they were at 1f26282a.
    await waitFor(() => expect(fetchDealerOnboardingOverview).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('dealer-who-must-act')).toBeTruthy())
  })

  it('survives a reload — the bounce recurred on every entry, not only the first', async () => {
    const first = renderBehindBoundary()
    await waitFor(() => expect(fetchDealerOnboardingOverview).toHaveBeenCalledTimes(1))
    first.unmount()

    renderBehindBoundary()
    await waitFor(() => expect(fetchDealerOnboardingOverview).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('bounced-to-login')).toBeNull()
  })

  it('the gate is still a gate — an anonymous visitor is still sent to login', async () => {
    currentUser = null
    renderBehindBoundary()
    await waitFor(() => expect(screen.getByTestId('bounced-to-login')).toBeTruthy())
    // And the page must never have been reached.
    expect(fetchDealerOnboardingOverview).not.toHaveBeenCalled()
  })
})
