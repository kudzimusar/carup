/**
 * O2/P3+P4 — People & Compliance workspace.
 *
 * Pinned rules: the five concepts render as five separate sections (never one "verified" badge);
 * who-must-act chips are the server's own projections; actions render ONLY from server-derived
 * allowed_actions; identity decisions require a written reason except approve; dealer statuses
 * appear VERBATIM; missing states render truthfully.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PeopleComplianceReview from './PeopleComplianceReview'

const fetchPersonComplianceReview = vi.fn()
const reviewIdentitySession = vi.fn()
const recordDealerComplianceDecision = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchPersonComplianceReview, reviewIdentitySession, recordDealerComplianceDecision }),
}))

const REVIEW = {
  person: {
    id: 'u_seller_1', name: 'Sample Seller', email: 'seller@example.test', role: 'owner',
    email_verified: true, joined_at: '2026-08-01', tenant_memberships: [],
  },
  identity: {
    evaluated: true,
    latest: {
      id: 'vs-1', status: 'pending_review', workflow_phase: 'reviewer_action_required',
      final_disposition: 'none', primary_reason_code: null, review_decision: null, retry_reason: null,
      created_at: '2026-09-01T10:00:00Z', submitted_at: '2026-09-01T10:05:00Z', reviewed_at: null,
      who_must_act: 'carup_review',
    },
    sessions: [],
    who_must_act: 'carup_review',
  },
  seller_authority: {
    total: 2,
    records: [
      { vin: 'VIN-A', claim_type: 'owner', status: 'confirmed', basis: 'existing_relationship', reason: null, policy_version: 'seller_authority.v1', decided_by_role: 'admin', decided_at: '2026-09-02', who_must_act: 'none' },
      { vin: 'VIN-B', claim_type: 'owner', status: 'insufficient', basis: null, reason: null, policy_version: 'seller_authority.v1', decided_by_role: 'government', decided_at: '2026-09-02', who_must_act: 'subject_action' },
    ],
  },
  ownership: {
    vehicles_owned: [{ vin: 'VIN-A', publication_status: 'published', label: '2019 Toyota Hilux' }],
    transfers: [{ id: 'tr-1', vin: 'VIN-OLD', state: 'registry_pending', relationship: 'previous_owner', completed_at: null, who_must_act: 'external_authority' }],
  },
  dealer_compliance: { is_dealer: false },
  audit: [{ id: 'a1', event_type: 'SELLER_AUTHORITY_REVIEWED', actor_role: 'admin', reason: 'governed review', created_at: '2026-09-02T00:00:01Z' }],
  allowed_actions: ['identity.review', 'seller_authority.review', 'dealer_compliance.decide'],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/people/u_seller_1/review']}>
      <Routes>
        <Route path="/admin/people/:userId/review" element={<PeopleComplianceReview />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PeopleComplianceReview', () => {
  beforeEach(() => {
    fetchPersonComplianceReview.mockReset()
    reviewIdentitySession.mockReset()
    fetchPersonComplianceReview.mockResolvedValue({ success: true, review: REVIEW })
  })

  it('renders the five concepts as separate sections and never one combined badge', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')

    // Email verification, identity, authority, ownership and dealer state each stand alone.
    expect(screen.getByText('email verified')).toBeTruthy()
    expect(screen.getByTestId('people-identity-section').textContent).toMatch(/reviewer action required/i)
    expect(screen.getByTestId('people-authority-section').textContent).toMatch(/VIN-A/)
    expect(screen.getByTestId('people-ownership-section').textContent).toMatch(/registry pending/i)
    expect(screen.getByTestId('people-dealer-section').textContent).toMatch(/Not a dealer/i)

    // No collapsed verdict anywhere.
    expect(document.body.textContent).not.toMatch(/verified seller|fully verified|trusted seller/i)
  })

  it('shows the server-projected who-must-act chips, including the external-authority registry wait', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    expect(screen.getAllByText(/carup review/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/subject action/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/external authority/i).length).toBeGreaterThan(0)
  })

  it('renders identity decisions only from server allowed_actions, and refuses a reason-less rejection', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    const reject = screen.getByRole('button', { name: /^reject$/i })
    reject.click()
    await waitFor(() => expect(reviewIdentitySession).not.toHaveBeenCalled())
  })

  it('renders NO decision controls when the server grants no actions', async () => {
    fetchPersonComplianceReview.mockResolvedValue({ success: true, review: { ...REVIEW, allowed_actions: [] } })
    renderPage()
    await screen.findByTestId('people-compliance-review')
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull()
  })

  it('renders dealer statuses VERBATIM when the person is a dealer', async () => {
    fetchPersonComplianceReview.mockResolvedValue({
      success: true,
      review: {
        ...REVIEW,
        dealer_compliance: {
          is_dealer: true,
          profile: { id: 'dp-1', suspension_state: 'suspended', restriction_state: 'none', compliance_review_state: 'passed', identity_status: 'verified', expiry_state: 'valid' },
          requirements: [{ requirement_key: 'business_licence', status: 'submitted', is_blocking: true, still_blocking: true }],
          who_must_act: 'subject_action',
        },
      },
    })
    renderPage()
    await screen.findByTestId('people-compliance-review')
    const dealer = screen.getByTestId('people-dealer-section').textContent || ''
    expect(dealer).toMatch(/suspended/)
    expect(dealer).toMatch(/business_licence: submitted · blocking/)
  })

  it('renders a truthful unavailable state when the review cannot load', async () => {
    fetchPersonComplianceReview.mockRejectedValue(new Error('Forbidden'))
    renderPage()
    await screen.findByTestId('people-review-unavailable')
    expect(screen.getByText(/Forbidden/)).toBeTruthy()
  })
})
