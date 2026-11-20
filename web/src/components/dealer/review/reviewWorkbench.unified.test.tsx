/**
 * RX05-D — the eight independent reviewer workbenches in the unified ReviewWorkbench composition
 * (queue → case → evidence → decision → audit). Each page renders this view only inside the unified
 * reviewer chrome (ReviewWorkbenchContext = true, which the layout provides only when the unified flag
 * is on); outside it the legacy composition is unchanged.
 *
 * Truth rules asserted for every page:
 *  - the consequential decision is disabled without the required reason, and without the password
 *    step-up (the page's own ReviewerStepUpField is still the field that carries it);
 *  - material nobody has decided on is never toned like a verified decision;
 *  - what the applicant (or the public) sees and the internal reviewer notes are separate, labelled regions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({
  user: { id: 'fictional-reviewer', name: 'Fictional Reviewer', email: 'reviewer@example.invalid', role: 'reviewer', phone: '' },
  token: 'synthetic-session', isAuthenticated: true, loading: false, login: () => {}, logout: () => {},
}))
type Call = { path: string; method: string; body: Record<string, unknown> }
const api = vi.hoisted(() => ({
  calls: [] as Call[],
  handler: (async () => ({})) as (path: string, method: string, body: Record<string, unknown>) => Promise<unknown>,
}))

const LOADERS = {
  claims: () => import('@/pages/DealerClaimReview'),
  research: () => import('@/pages/DealerResearchReview'),
  compliance: () => import('@/pages/DealerComplianceApplicationReview'),
  legal: () => import('@/pages/DealerLegalActivationReview'),
  storefront: () => import('@/pages/DealerFullStorefrontReview'),
  feedback: () => import('@/pages/DealerBuyerFeedbackReview'),
  lifecycle: () => import('@/pages/DealerOperatingLifecycleReview'),
  evidence: () => import('@/pages/dashboard/admin/EvidenceReview'),
} as const

async function mount(page: keyof typeof LOADERS, handler: typeof api.handler, workbench = true) {
  vi.resetModules()
  api.calls = []
  api.handler = handler
  vi.doMock('@/context/AuthContext', () => ({ useAuth: () => auth }))
  vi.doMock('@/lib/apiClient', () => ({
    resolveApiBaseUrl: () => '/api',
    apiRequest: async ({ path, options }: { path: string; options?: { method?: string; body?: string } }) => {
      const method = options?.method || 'GET'
      const body = JSON.parse(options?.body || '{}') as Record<string, unknown>
      api.calls.push({ path, method, body })
      return api.handler(path, method, body)
    },
  }))
  const Page = (await LOADERS[page]()).default
  const { ReviewWorkbenchContext } = await import('@/components/dealer/reviewWorkbenchContext')
  return render(
    <MemoryRouter>
      {workbench ? <ReviewWorkbenchContext.Provider value={true}><Page /></ReviewWorkbenchContext.Provider> : <Page />}
    </MemoryRouter>,
  )
}
afterEach(() => {
  vi.doUnmock('@/context/AuthContext'); vi.doUnmock('@/lib/apiClient')
  vi.doUnmock('@/hooks/useCarUpApi'); vi.doUnmock('@/components/ExtractionReviewPanel')
})

const type = (el: Element | null, value: string) => { act(() => { fireEvent.change(el as Element, { target: { value } }) }) }
const byId = (id: string) => document.getElementById(id)
const LONG = (n: number) => 'Independent finding from the original documents and public registry. '.repeat(4).slice(0, n)

/** The facing summary and the internal notes are separate labelled regions; neither contains the other. */
function expectSeparatedAudiences(facingTitle = /facing summary/) {
  const facing = screen.getByTestId('review-facing-summary')
  const internal = screen.getByTestId('review-internal-notes')
  expect(facing).toHaveAccessibleName(facingTitle)
  expect(internal).toHaveAccessibleName('Internal reviewer notes')
  expect(facing.contains(internal)).toBe(false)
  expect(internal.contains(facing)).toBe(false)
  return { facing, internal }
}
/** No status or provenance on screen claims a positive, verified outcome. */
function expectNothingShownAsVerified() {
  expect(document.querySelectorAll('[data-tone="positive"]')).toHaveLength(0)
}

/* ─────────────────────────────── claims ─────────────────────────────── */
const CLAIMS = { claims: [
  { claim_id: 'c-1', seed_dealer_id: 'ZW-DEAL-0002', claimed_scope: 'BRANCH', claim_status: 'AWAITING_DOCUMENTARY_EVIDENCE', created_at: '2026-11-15T10:00:00Z' },
  { claim_id: 'c-2', seed_dealer_id: 'ZW-DEAL-0001', claimed_scope: 'BRANCH', claim_status: 'CLAIM_APPROVED', created_at: '2026-11-14T10:00:00Z' },
] }
const CLAIM_EVIDENCE = { evidence: [{ evidence_id: 'e-1', document_class: 'COMPANY_REGISTRATION', created_at: '2026-11-15T10:00:00Z', content_sha256: 'abcdef0123456789abcdef', mime_type: 'application/pdf', file_bytes: 2048 }] }
const claimsApi = async (path: string) => path.endsWith('/claims/queue') ? CLAIMS : CLAIM_EVIDENCE

describe('Claims workbench (unified)', () => {
  it('waiting claims are never toned as approved; only the recorded approval is', async () => {
    await mount('claims', claimsApi)
    const queue = await screen.findByTestId('claim-queue')
    const waiting = within(queue).getByText('ZW-DEAL-0002').closest('button')!
    expect(waiting.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'pending')
    const approved = within(queue).getByText('ZW-DEAL-0001').closest('button')!
    expect(approved.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'positive')
    expect(within(screen.getByTestId('claim-case-identity')).getByTestId('review-case-status')).toHaveAttribute('data-tone', 'pending')
    // The applicant's document is labelled as unverified material.
    await screen.findByText('COMPANY REGISTRATION')
    expect(within(screen.getByTestId('claim-evidence')).getByTestId('review-provenance')).toHaveAttribute('data-unverified', 'true')
  })

  it('separates the applicant-facing summary from internal reviewer notes', async () => {
    await mount('claims', claimsApi)
    await screen.findByText('COMPANY REGISTRATION')
    const { facing, internal } = expectSeparatedAudiences(/Applicant-facing summary/)
    expect(facing).toHaveTextContent('never your findings')
    expect(internal).not.toHaveTextContent('ZW-DEAL')
  })

  it('the decision needs the step-up password AND the required findings', async () => {
    await mount('claims', claimsApi)
    await screen.findByText('COMPANY REGISTRATION')
    const decision = screen.getByTestId('claim-decision')
    const submit = within(decision).getByRole('button', { name: 'Record immutable review decision' })
    // The unchanged step-up field is still the one that carries the password.
    expect(within(decision).getByLabelText('Re-enter your own CarUp account password')).toHaveAttribute('type', 'password')
    expect(within(decision).getByTestId('claim-reviewer-password-username-anchor')).toHaveAttribute('autocomplete', 'username')
    type(byId('claim-reviewer-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeDisabled()
    type(byId('claim-review-reason'), LONG(39))
    expect(submit).toBeDisabled()
    type(byId('claim-review-reason'), LONG(45))
    expect(submit).toBeEnabled()
    type(byId('claim-reviewer-password'), '')
    expect(submit).toBeDisabled()
    // Approval additionally needs an opened, confirmed original — a reason and password are not enough.
    type(byId('claim-reviewer-password'), 'Correct-reviewer-pass-1')
    fireEvent.click(byId('claim-verdict-CLAIM_APPROVED')!)
    type(byId('claim-issuer'), 'Registrar of Companies')
    expect(submit).toBeDisabled()
    expect(byId('claim-document-confirmed')).toBeDisabled()
  })
})

/* ─────────────────────────────── research ─────────────────────────────── */
const RESEARCH = {
  entries: [
    { seed_dealer_id: 'ZW-DEAL-0001', source_row: 8, source_display_name: 'Synthetic Fictional Car Dealer 1', source_city: 'Harare',
      source_category_unverified: 'Official dealer — UNVERIFIED', grouping_status: 'UNREVIEWED_PARENT_BRANCH_MATCH', source_row_sha256: 'f'.repeat(64),
      publication_state: 'PRELISTED_UNCLAIMED', review_revision: 1, legal_business_verified: false },
    { seed_dealer_id: 'ZW-DEAL-0007', source_row: 14, source_display_name: 'Synthetic Fictional Car Dealer 7', source_city: 'Harare',
      source_category_unverified: 'Independent', grouping_status: 'UNREVIEWED_PARENT_BRANCH_MATCH', source_row_sha256: 'e'.repeat(64),
      publication_state: 'PENDING_HUMAN_SOURCE_ELIGIBILITY', review_revision: 0, legal_business_verified: false },
  ],
  page: 1, limit: 20, total: 2, real_review_required: true, bulk_publication_available: false,
}
const researchApi = async (path: string) => path.includes('/corrections') ? { requests: [] } : RESEARCH

describe('Source review workbench (unified)', () => {
  it('unclaimed research is shown as listed-not-claimed, never as verified', async () => {
    await mount('research', researchApi)
    await screen.findByTestId('research-case-identity')
    expectNothingShownAsVerified()
    const { facing } = expectSeparatedAudiences(/Public-facing summary/)
    expect(facing).toHaveTextContent('Listed from public sources · not claimed')
    expect(within(screen.getByTestId('research-evidence')).getByTestId('review-provenance')).toHaveTextContent('not verified')
    expect(screen.getByTestId('research-queue-item-ZW-DEAL-0007').querySelector('[data-tone]')).toHaveAttribute('data-tone', 'pending')
  })

  it('the eligibility decision needs the step-up and the per-decision minimum reason', async () => {
    await mount('research', researchApi)
    await screen.findByTestId('research-case-identity')
    const submit = screen.getByRole('button', { name: 'Record independent eligibility decision' })
    type(byId('source-reason'), LONG(30))
    expect(submit).toBeDisabled()
    type(byId('source-reviewer-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeEnabled()
    // Publishing unclaimed research needs the longer (80) rationale.
    fireEvent.click(byId('source-decision-PRELISTED_UNCLAIMED')!)
    expect(submit).toBeDisabled()
    type(byId('source-reason'), LONG(85))
    expect(submit).toBeEnabled()
  })
})

/* ─────────────────────────────── compliance ─────────────────────────────── */
const SUBMISSIONS = { submissions: [{ submission_id: 's-1', claim_id: 'c-1', intake_version: 2, submitted_at: '2026-11-15T10:00:00Z', independent_review_required: true }] }
const COMPLIANCE_PREVIEW = { preview: {
  submission_id: 's-1', claim_id: 'c-1', intake_version: 2, submitted_at: '2026-11-15T10:00:00Z',
  application_snapshot: { tab_rows: { BUSINESS: [{ legal_name: 'Fictional Motors (Pvt) Ltd', trading_name: 'Fictional Motors' }] } },
  snapshot_sha256: 'a'.repeat(64), verified: false, can_activate: false, legal_compliance_approved: false,
} }
const complianceApi = async (path: string) => path.endsWith('/preview') ? COMPLIANCE_PREVIEW : SUBMISSIONS

describe('Application evidence workbench (unified)', () => {
  it('no finding can be recorded before the private application is opened with the step-up', async () => {
    await mount('compliance', complianceApi)
    await screen.findByTestId('compliance-case-identity')
    expect(screen.queryByRole('button', { name: 'Record immutable preliminary finding' })).toBeNull()
    const open = screen.getByRole('button', { name: 'Inspect private frozen application' })
    expect(open).toBeDisabled()
    type(byId('case-password'), 'Correct-reviewer-pass-1')
    fireEvent.click(open)
    expect(await screen.findByTestId('compliance-evidence')).toHaveTextContent('Applicant declarations only')
    expect(within(screen.getByTestId('compliance-evidence')).getByTestId('review-provenance')).toHaveTextContent('Submitted by applicant · not verified')
    expectNothingShownAsVerified()
    const submit = screen.getByRole('button', { name: 'Record immutable preliminary finding' })
    type(byId('finding-reason'), LONG(45))
    expect(submit).toBeDisabled() // the step-up password was cleared after opening
    type(byId('finding-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeEnabled()
    type(byId('finding-reason'), 'too short')
    expect(submit).toBeDisabled()
  })

  it('says when the rationale is applicant-facing and when it stays internal', async () => {
    await mount('compliance', complianceApi)
    await screen.findByTestId('compliance-case-identity')
    expectSeparatedAudiences(/Applicant-facing summary/)
    type(byId('case-password'), 'Correct-reviewer-pass-1')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect private frozen application' }))
    await screen.findByTestId('compliance-evidence')
    expect(screen.getByTestId('review-reason-audience')).toHaveTextContent(/^Applicant-facing/)
    fireEvent.click(byId('finding-READY_FOR_REGULATORY_REVIEW')!)
    expect(screen.getByTestId('review-reason-audience')).toHaveTextContent(/^Internal reviewer note/)
  })
})

/* ─────────────────────────────── legal ─────────────────────────────── */
const legalApi = async (path: string) => {
  if (path.endsWith('/legal-policy/readiness')) return { policies: [{ country_code: 'ZW', policy_version: 'zw-2026-01', policy_state: 'APPROVED', effective_at: null, expires_at: null, eligibility: 'REQUIRES_INDEPENDENT_CASE_REVIEW' }] }
  if (path.endsWith('/legal-cases')) return { cases: [{ submission_id: 's-1', claim_id: 'c-1', intake_version: 2, seed_dealer_id: 'ZW-DEAL-0002', declared_legal_name: 'Fictional Motors (Pvt) Ltd',
    evidence: [{ evidence_id: 'e-1', document_class: 'COMPANY_REGISTRATION', mime_type: 'application/pdf', file_bytes: 2048, uploaded_at: '2026-11-15T10:00:00Z' }],
    separate_legal_reviewer_required: true, compliance_approved: false }] }
  return { cases: [{ legal_review_id: 'l-1', submission_id: 's-1', country_code: 'ZW', policy_version: 'zw-2026-01', legal_expires_at: '2027-11-15T23:59:59Z',
    independent_activator_required: true, seed_dealer_id: 'ZW-DEAL-0002', declared_legal_name: 'Fictional Motors (Pvt) Ltd', state: 'AWAITING_INDEPENDENT_ACTIVATION' }] }
}

describe('Legal activation workbench (unified)', () => {
  it('a reason and password alone never enable the legal approval', async () => {
    await mount('legal', legalApi)
    await screen.findByTestId('legal-case-identity')
    expectSeparatedAudiences(/Applicant-facing summary/)
    expect(within(screen.getByTestId('legal-evidence')).getByTestId('review-provenance')).toHaveAttribute('data-unverified', 'true')
    const submit = screen.getByRole('button', { name: 'Record independent legal approval (requires approved real policy)' })
    type(byId('legal-reason'), LONG(90))
    type(byId('legal-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeDisabled()
    expect(screen.getByTestId('review-requirements').querySelectorAll('[data-met="false"]').length).toBeGreaterThan(0)
  })

  it('final activation is pending (not green) and needs the reason and the final approver step-up', async () => {
    await mount('legal', legalApi)
    await screen.findByTestId('legal-case-identity')
    fireEvent.click(screen.getByTestId('review-queue-tab-activation'))
    const header = await screen.findByTestId('activation-case-identity')
    expect(within(header).getByTestId('review-case-status')).toHaveAttribute('data-tone', 'pending')
    expect(within(screen.getByTestId('legal-queue')).getByTestId('activation-queue-item-l-1').querySelector('[data-tone]')).toHaveAttribute('data-tone', 'pending')
    const submit = screen.getByRole('button', { name: 'Activate canonical organization, tenant & owner membership' })
    type(byId('final-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeDisabled()
    type(byId('activation-reason'), LONG(90))
    expect(submit).toBeEnabled()
    type(byId('final-password'), '')
    expect(submit).toBeDisabled()
  })
})

/* ─────────────────────────────── storefront ─────────────────────────────── */
const storefrontApi = async (path: string) => {
  if (path.endsWith('/full-storefronts/queue')) return { cases: [{ seed_dealer_id: 'ZW-DEAL-0901', operating_status: 'OPERATIONAL', independent_reviewer_required: true }] }
  if (path.endsWith('/storefront-media/queue')) return { items: [{
    media_id: 'm-1', seed_dealer_id: 'ZW-DEAL-0901', branch_id: null, mime_type: 'image/png', file_bytes: 30822,
    media_category: 'COMPANY_COVER_IMAGE', caption: 'Fictional cover image', alt_text: 'Navy banner', rights_attestation: 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',
    review_status: 'PENDING_INDEPENDENT_REVIEW', created_at: '2026-11-08T07:30:24.000Z', independent_reviewer_required: true,
    preview_ticket: 'rt1.preview.1', decision_ticket: 'rt1.decision.1', ticket_expires_at: '2026-11-08T10:40:00.000Z', logo_rights_approved: false,
  }] }
  return {}
}

describe('Public storefront workbench (unified)', () => {
  it('publishing needs inspection, a selected branch, the reason and the step-up', async () => {
    await mount('storefront', storefrontApi)
    await screen.findByTestId('storefront-case-identity')
    expectSeparatedAudiences(/Public-facing summary/)
    const submit = screen.getByRole('button', { name: 'Record immutable publication decision' })
    type(byId('storefront-password'), 'Correct-reviewer-pass-1')
    type(byId('storefront-reason'), LONG(90))
    expect(submit).toBeDisabled() // PUBLISHED_FULL without an inspected candidate / selected branch
    fireEvent.click(byId('storefront-decision-RETRACTED')!)
    expect(submit).toBeEnabled()
    type(byId('storefront-reason'), LONG(60))
    expect(submit).toBeDisabled()
  })

  it('a submitted photograph is labelled not approved and its decision needs a reason', async () => {
    await mount('storefront', storefrontApi)
    await screen.findByTestId('storefront-case-identity')
    fireEvent.click(screen.getByTestId('review-queue-tab-media'))
    const header = await screen.findByTestId('storefront-media-identity')
    expect(within(header).getByTestId('review-case-status')).toHaveAttribute('data-tone', 'pending')
    expect(within(screen.getByTestId('dealer-media-review-section')).getByTestId('review-provenance')).toHaveTextContent('not approved')
    expect(screen.getByTestId('review-facing-summary')).toHaveTextContent('Not public')
    const submit = screen.getByRole('button', { name: 'Record storefront media decision' })
    type(byId('storefront-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeDisabled()
    type(byId('storefront-media-reason'), LONG(45))
    expect(submit).toBeEnabled()
  })
})

/* ─────────────────────────────── buyer feedback ─────────────────────────────── */
const feedbackApi = async (path: string) => path.endsWith('/preview')
  ? { preview: { case_id: 'k-1', seed_dealer_id: 'ZW-DEAL-0002', transaction_intent_id: 'ti-1', buyer_user_id: 'buyer-ref-1', statement: 'Fictional statement.',
      case_type: 'SERVICE_COMPLAINT', submitted_rating: 2, canonical_transaction_state_at_submission: 'ESCROW_HELD', verified_real_purchase: false, public_review_eligible: false } }
  : { cases: [{ case_id: 'k-1', seed_dealer_id: 'ZW-DEAL-0002', case_type: 'SERVICE_COMPLAINT', submitted_at: '2026-11-15T10:00:00Z' }] }

describe('Buyer complaints workbench (unified)', () => {
  it('the statement opens only with the step-up, and the finding needs the reason and a fresh password', async () => {
    await mount('feedback', feedbackApi)
    await screen.findByTestId('buyer-feedback-case-identity')
    expectSeparatedAudiences(/Public-facing summary/)
    expect(screen.queryByText('Fictional statement.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record immutable private finding' })).toBeNull()
    type(byId('buyer-feedback-review-password'), 'Correct-reviewer-pass-1')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect private buyer statement' }))
    expect(await screen.findByText('Fictional statement.')).toBeInTheDocument()
    expect(within(screen.getByTestId('buyer-feedback-evidence')).getByTestId('review-provenance')).toHaveTextContent('Submitted by buyer · not verified')
    expectNothingShownAsVerified()
    const submit = screen.getByRole('button', { name: 'Record immutable private finding' })
    type(byId('buyer-case-rationale'), LONG(90))
    expect(submit).toBeDisabled()
    type(byId('buyer-feedback-review-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeEnabled()
  })
})

/* ─────────────────────────────── lifecycle ─────────────────────────────── */
const lifecycleApi = async (path: string) => path.endsWith('/operating-lifecycle')
  ? { cases: [{ seed_dealer_id: 'ZW-DEAL-0002', operating_status: 'OPERATIONAL' }] }
  : { lifecycle: { seed_dealer_id: 'ZW-DEAL-0002', operating_status: 'SUSPENDED', renewal_candidates: [], events: [
    { event_id: 'ev-1', action: 'SUSPEND', previous_operating_status: 'OPERATIONAL', next_operating_status: 'SUSPENDED', public_listings_withdrawn: 3,
      created_at: '2026-11-16T10:00:00Z', recorded_by_this_reviewer: true, reason: 'Fictional internal suspension reason for the next reviewer.' }] } }

describe('Operating lifecycle workbench (unified)', () => {
  it('shows the recorded history as an audit trail and requires reason + step-up for a decision', async () => {
    await mount('lifecycle', lifecycleApi)
    fireEvent.click(await screen.findByTestId('lifecycle-queue-item-ZW-DEAL-0002'))
    const history = await screen.findByTestId('lifecycle-history')
    await waitFor(() => expect(history).toHaveTextContent('Fictional internal suspension reason'))
    expect(history).toHaveTextContent('recorded by you')
    const { facing } = expectSeparatedAudiences(/Dealer-facing summary/)
    expect(facing).toHaveTextContent('never shown to the dealership')
    const submit = screen.getByRole('button', { name: 'Record immutable lifecycle decision' })
    type(byId('lifecycle-reason'), LONG(45))
    expect(submit).toBeDisabled()
    type(byId('lifecycle-password'), 'Correct-reviewer-pass-1')
    expect(submit).toBeEnabled()
    fireEvent.click(byId('lifecycle-action-RENEW')!)
    expect(submit).toBeDisabled() // renewal needs a newer independent legal review
  })
})

/* ─────────────────────────────── vehicle evidence ─────────────────────────────── */
describe('Vehicle documents workbench (unified)', () => {
  it('an AI "passed / approve" scan is advisory and never green; a decision needs an option and a reason', async () => {
    const approveEvidence = vi.fn(async () => ({}))
    const hooks = { fetchEvidenceReviewQueue: async () => [{
      id: 'ev-1', vehicle_id: 'v-1', vin: 'AHTFR22G406012345', event_type: 'registration', evidence_type: 'registration_document', evidence_class: 'import',
      evidence_subtype: 'customs_clearance', file_url: null, uploaded_by: 'u-1', uploader_role: 'owner', captured_at: '2026-11-10T10:00:00Z',
      uploaded_at: '2026-11-15T10:00:00Z', verification_status: 'pending', trust_score_impact: 0,
      metadata: { ai_analysis: { risk_score: 0.1, confidence: 0.92, ai_status: 'ai_passed', reviewer_summary: 'Fictional scan summary.', recommended_action: 'approve', visible_vin: 'AHTFR22G406012345' } },
    }], approveEvidence, rejectEvidence: vi.fn() }
    vi.doMock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hooks }))
    vi.doMock('@/components/ExtractionReviewPanel', () => ({ default: () => <div data-testid="extraction-panel-stub" /> }))
    await mount('evidence', async () => ({}))
    await screen.findByTestId('vehicle-evidence-case-identity')
    expectNothingShownAsVerified()
    expect(screen.getByTestId('vehicle-evidence-automated-scan')).toHaveTextContent('Advisory only · not a decision')
    expect(within(screen.getByTestId('vehicle-evidence-file')).getByTestId('review-provenance')).toHaveAttribute('data-unverified', 'true')
    expectSeparatedAudiences(/Uploader-facing summary/)
    const submit = screen.getByRole('button', { name: 'Record decision' })
    expect(submit).toBeDisabled()
    fireEvent.click(byId('vehicle-evidence-decision-approve')!)
    expect(submit).toBeDisabled() // no automatic reason any more
    type(byId('vehicle-evidence-note'), 'Matches the customs clearance on file.')
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(approveEvidence).toHaveBeenCalledWith('AHTFR22G406012345', 'ev-1', 'Matches the customs clearance on file.', 3))
  })
})

/* ─────────────────────────────── flags OFF ─────────────────────────────── */
describe('outside the unified workbench the legacy composition is unchanged', () => {
  it.each([
    ['research', researchApi, 'Dealer research eligibility review'],
    ['compliance', complianceApi, 'Independent dealer application review'],
    ['legal', legalApi, 'Dealer legal authorization & canonical activation'],
    ['storefront', storefrontApi, 'Full dealership publication'],
    ['feedback', feedbackApi, 'Independent buyer complaint review'],
    ['lifecycle', lifecycleApi, 'Dealership operating lifecycle'],
  ] as const)('%s', async (page, handler, heading) => {
    await mount(page, handler, false)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.queryByTestId('review-facing-summary')).toBeNull()
    expect(screen.queryByTestId('review-step-up')).toBeNull()
  })
})
