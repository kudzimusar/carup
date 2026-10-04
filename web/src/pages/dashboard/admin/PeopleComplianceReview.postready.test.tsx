/**
 * O2 — post-Ready automated review closure (web halves of C2–C3), ported by OC-4D from #208.
 *
 * C2  identity decisions must send the fields the decision recorder actually reads.
 * C3  dealer decisions must use the governed vocabulary, which has never held `pass_review`.
 *
 * C1 (the step-up retry runner) is not ported: it satisfies the O2-X3 authentication-assurance
 * gate, which this lineage does not have yet. It arrives with that slice. What this lineage pins
 * instead is the property C1 was built to protect — a refusal reaches the reviewer by name.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PeopleComplianceReview from './PeopleComplianceReview'

const fetchPersonComplianceReview = vi.fn()
const reviewIdentitySession = vi.fn()
const recordDealerComplianceDecision = vi.fn()
const toastError = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchPersonComplianceReview, reviewIdentitySession, recordDealerComplianceDecision,
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: () => undefined },
}))

const REVIEW = {
  person: {
    id: 'u1', name: 'Sample Seller', email: 's@e.test', role: 'owner',
    email_verified: true, joined_at: '2026-08-01', tenant_memberships: [],
  },
  identity: {
    evaluated: true,
    latest: {
      id: 'vs-1', status: 'pending_review', workflow_phase: 'reviewer_action_required',
      final_disposition: 'none', primary_reason_code: null, review_decision: null, retry_reason: null,
      created_at: null, submitted_at: null, reviewed_at: null, who_must_act: 'carup_review',
    },
    sessions: [], who_must_act: 'carup_review',
  },
  seller_authority: { total: 0, records: [] },
  ownership: { vehicles_owned: [], transfers: [] },
  dealer_compliance: {
    is_dealer: true,
    profile: { id: 'dp-1', suspension_state: 'none', restriction_state: 'none', compliance_review_state: 'pending', identity_status: 'verified', expiry_state: 'valid' },
    requirements: [{ requirement_key: 'business_licence', status: 'submitted', is_blocking: true, still_blocking: true }],
    who_must_act: 'carup_review',
  },
  audit: [],
  allowed_actions: ['identity.review', 'dealer_compliance.decide'],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/people/u1/review']}>
      <Routes><Route path="/admin/people/:userId/review" element={<PeopleComplianceReview />} /></Routes>
    </MemoryRouter>
  )
}

const setValue = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

describe('O2 post-Ready closure — People & Compliance decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchPersonComplianceReview.mockResolvedValue({ success: true, review: REVIEW })
    reviewIdentitySession.mockResolvedValue({ success: true })
    recordDealerComplianceDecision.mockResolvedValue({ success: true })
  })

  /* ── C2 ─────────────────────────────────────────────────────────────────────────── */
  it('C2: a rejection sends reason_code — the field the recorder requires — and never `notes`', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    setValue('identity-reason-code', 'BLURRY')
    setValue('identity-decision-note', 'Both sides unreadable.')
    fireEvent.click(screen.getByTestId('identity-reject'))

    await waitFor(() => expect(reviewIdentitySession).toHaveBeenCalledTimes(1))
    const [, payload] = reviewIdentitySession.mock.calls[0]
    expect(payload.action).toBe('reject')
    expect(payload.reasonCode).toBe('BLURRY')
    expect(payload.internalNote).toBe('Both sides unreadable.')
    expect(payload).not.toHaveProperty('notes')
  })

  it('C2: a rejection without a reason code is refused BEFORE it reaches the service', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    setValue('identity-decision-note', 'Looks wrong.')
    fireEvent.click(screen.getByTestId('identity-reject'))
    await waitFor(() => expect(reviewIdentitySession).not.toHaveBeenCalled())
  })

  it('C2: requesting resubmission carries BOTH a reason code and the applicant message', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    setValue('identity-reason-code', 'DOCUMENT_NOT_VISIBLE')
    fireEvent.click(screen.getByTestId('identity-request_resubmission'))
    // The applicant message is required, so nothing is sent yet.
    await waitFor(() => expect(reviewIdentitySession).not.toHaveBeenCalled())

    setValue('identity-applicant-message', 'Please retake in better light.')
    fireEvent.click(screen.getByTestId('identity-request_resubmission'))
    await waitFor(() => expect(reviewIdentitySession).toHaveBeenCalledTimes(1))
    const [, payload] = reviewIdentitySession.mock.calls[0]
    expect(payload.reasonCode).toBe('DOCUMENT_NOT_VISIBLE')
    expect(payload.applicantMessage).toBe('Please retake in better light.')
  })

  it('C2: escalate keeps the reviewer’s note instead of silently dropping it', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    setValue('identity-decision-note', 'Second opinion needed on the address.')
    fireEvent.click(screen.getByTestId('identity-escalate'))
    await waitFor(() => expect(reviewIdentitySession).toHaveBeenCalledTimes(1))
    expect(reviewIdentitySession.mock.calls[0][1].internalNote).toBe('Second opinion needed on the address.')
  })

  /* ── C3 ─────────────────────────────────────────────────────────────────────────── */
  it('C3: no control anywhere submits the unsupported `pass_review` decision', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    expect(screen.queryByRole('button', { name: /pass review/i })).toBeNull()

    // Every dealer control on the screen, exercised one at a time (each decision clears the
    // reason box and disables the row while it runs, so they cannot be fired in one burst).
    const controlIds = Array.from(document.querySelectorAll('[data-testid^="dealer-"]'))
      .filter((el) => el.tagName === 'BUTTON')
      .map((el) => el.getAttribute('data-testid') as string)
    expect(controlIds.length).toBeGreaterThan(0)

    for (let i = 0; i < controlIds.length; i += 1) {
      setValue('dealer-decision-reason', 'Licence checked against the registry.')
      fireEvent.click(screen.getByTestId(controlIds[i]))
      await waitFor(() => expect(recordDealerComplianceDecision).toHaveBeenCalledTimes(i + 1))
    }

    const sent = recordDealerComplianceDecision.mock.calls.map(([, payload]) => payload.decision)
    expect(sent).not.toContain('pass_review')
    // and every verb that IS sent belongs to the governed vocabulary.
    const GOVERNED = ['approve_requirement', 'reject_requirement', 'request_more_info', 'restrict', 'suspend', 'reinstate', 'set_expiry']
    for (const decision of sent) expect(GOVERNED).toContain(decision)
  })

  it('C3: the positive dealer action approves a NAMED requirement, with its key', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    setValue('dealer-decision-reason', 'Licence checked against the registry.')
    fireEvent.click(screen.getByTestId('dealer-approve_requirement-business_licence'))

    await waitFor(() => expect(recordDealerComplianceDecision).toHaveBeenCalledTimes(1))
    const [dealerId, payload] = recordDealerComplianceDecision.mock.calls[0]
    expect(dealerId).toBe('dp-1')
    expect(payload.decision).toBe('approve_requirement')
    expect(payload.requirement_key).toBe('business_licence')
    expect(payload.reason).toBe('Licence checked against the registry.')
  })

  it('C3: a profile-level decision sends NO requirement key, because the service takes none', async () => {
    renderPage()
    await screen.findByTestId('people-compliance-review')
    setValue('dealer-decision-reason', 'Repeated non-compliance.')
    fireEvent.click(screen.getByTestId('dealer-suspend'))
    await waitFor(() => expect(recordDealerComplianceDecision).toHaveBeenCalledTimes(1))
    const [, payload] = recordDealerComplianceDecision.mock.calls[0]
    expect(payload.decision).toBe('suspend')
    expect(payload).not.toHaveProperty('requirement_key')
  })

  /* ── Refusals ────────────────────────────────────────────────────────────────────── */
  it('a refused identity decision is surfaced by name, and nothing is retried', async () => {
    reviewIdentitySession.mockRejectedValueOnce(Object.assign(new Error('A reviewer cannot decide their own identity verification session.'), {
      status: 403,
    }))
    renderPage()
    await screen.findByTestId('people-compliance-review')
    fireEvent.click(screen.getByTestId('identity-approve'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('A reviewer cannot decide their own identity verification session.'))
    expect(reviewIdentitySession).toHaveBeenCalledTimes(1)
  })

  it('a refused dealer decision is surfaced by name, and nothing is retried', async () => {
    recordDealerComplianceDecision.mockRejectedValueOnce(new Error('requirement_key is required for approve_requirement'))
    renderPage()
    await screen.findByTestId('people-compliance-review')
    setValue('dealer-decision-reason', 'Licence verified.')
    fireEvent.click(screen.getByTestId('dealer-approve_requirement-business_licence'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('requirement_key is required for approve_requirement'))
    expect(recordDealerComplianceDecision).toHaveBeenCalledTimes(1)
  })
})
