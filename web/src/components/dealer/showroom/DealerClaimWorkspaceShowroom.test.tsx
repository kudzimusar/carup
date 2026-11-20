/**
 * RX05-A — /dealers/claims in the unified presentation: a claim → application → legal → activation
 * journey built only from what the server returned. Submitted material never looks approved, and the
 * same gated controls (evidence type + confirmation) still guard every write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DealerClaimWorkspace from '@/pages/DealerClaimWorkspace'

type Call = { path: string; method: string }
const fixture = vi.hoisted(() => ({
  unified: true,
  claimStatus: 'AWAITING_DOCUMENTARY_EVIDENCE',
  evidence: [] as Array<Record<string, unknown>>,
  authority: { state: 'NOT_AUTHORIZED', operational: false } as Record<string, unknown>,
  submissions: [] as Array<Record<string, unknown>>,
  intake: null as null | Record<string, unknown>,
  failClaims: false,
  calls: [] as Call[],
}))

vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fixture.unified }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-claimant', role: 'member' }, token: 'synthetic-session' }) }))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async ({ path, options }: { path: string; options?: { method?: string } }) => {
    const method = options?.method || 'GET'
    fixture.calls.push({ path, method })
    if (path === '/dealership/claims/mine') {
      if (fixture.failClaims) throw new Error('Too many requests. Please try again later.')
      return { claims: [{ claim_id: 'claim-fictional-1', seed_dealer_id: 'ZW-DEAL-0004', claimed_scope: 'BRANCH', claim_status: fixture.claimStatus, created_at: '2026-11-16T10:00:00Z' }] }
    }
    const tail = path.replace('/dealership/claims/claim-fictional-1/', '')
    if (tail === 'evidence') return { evidence: fixture.evidence }
    if (tail === 'ocr-candidates') return { candidates: [] }
    if (tail === 'operational-authority') return { authority: fixture.authority }
    if (tail === 'compliance-submissions') return { submissions: fixture.submissions }
    if (tail === 'intake') return { intake: fixture.intake }
    if (tail === 'jurisdiction-preview') return { preview: { state: 'DRAFT_POLICY_REVIEW_ONLY', country: 'ZW', can_activate: false, can_publish: false, legal_review_complete: false, requirements: [] } }
    throw new Error('unexpected path ' + path)
  },
}))

function renderWorkspace() {
  return render(<MemoryRouter><DealerClaimWorkspace /></MemoryRouter>)
}

beforeEach(() => {
  fixture.unified = true
  fixture.claimStatus = 'AWAITING_DOCUMENTARY_EVIDENCE'
  fixture.evidence = []
  fixture.authority = { state: 'NOT_AUTHORIZED', operational: false }
  fixture.submissions = []
  fixture.intake = null
  fixture.failClaims = false
  fixture.calls = []
})

describe('DealerClaimWorkspace — unified journey', () => {
  it('shows submitted evidence as waiting for independent review — nothing reads as approved', async () => {
    fixture.evidence = [{ evidence_id: 'ev-1', document_class: 'COMPANY_REGISTRATION', created_at: '2026-11-16T10:05:00Z', mime_type: 'application/pdf', file_bytes: 2048, quarantined: false }]
    renderWorkspace()
    expect(await screen.findByTestId('dealer-claim-workspace-showroom')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'My dealership claim applications' })).toBeInTheDocument()
    const claimStage = await screen.findByTestId('dealer-claim-stage-claim')
    await within(claimStage).findByText('1 document submitted · awaiting independent review')
    expect(claimStage).toHaveAttribute('data-state', 'waiting')
    const journey = screen.getByTestId('dealer-claim-journey')
    expect(journey.querySelectorAll('[data-state="done"]')).toHaveLength(0)
    expect(screen.getByTestId('dealer-claim-next-step')).toHaveTextContent('Wait for the independent claim review')
    expect(screen.getByTestId('dealer-claim-next-step')).not.toHaveAttribute('data-tone', 'success')
    expect(within(screen.getByTestId('claim-evidence-record')).getByText('Private · submitted')).toBeInTheDocument()
    // Reads that exist only after approval are still not requested.
    expect(fixture.calls.some(call => /\/(intake|jurisdiction-preview|compliance-submissions)$/.test(call.path))).toBe(false)
  })

  it('keeps the evidence upload gated on a chosen type and an explicit confirmation', async () => {
    renderWorkspace()
    const upload = await screen.findByRole('button', { name: 'Upload private evidence' })
    expect(upload).toBeDisabled()
    expect(screen.getByLabelText(/Choose the evidence type first/)).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Evidence type'), { target: { value: 'COMPANY_REGISTRATION' } })
    expect(screen.getByTestId('claim-document-class-help')).toHaveTextContent('certificate of incorporation')
    expect(upload).toBeDisabled()
  })

  it('walks an approved, active claim through every stage from the server’s own statuses', async () => {
    fixture.claimStatus = 'CLAIM_APPROVED'
    fixture.intake = { schema_version: '1', submission_version: 1, state: 'CANDIDATE_AWAITING_COMPLIANCE', updated_at: '2026-11-16T12:00:00Z', content: { tab_rows: {} }, review_preview: null }
    fixture.submissions = [{ submission_id: 's-1', intake_version: 1, schema_version: '1', submitted_at: '2026-11-16T12:30:00Z', preliminary_status: 'READY_FOR_REGULATORY_REVIEW', correction_reason: null, reviewed_at: null }]
    fixture.authority = { state: 'CANONICAL_DEALER_ACTIVE', operational: true, public_storefront_approved: false, vehicle_listing_authority_granted: false }
    renderWorkspace()
    const activation = await screen.findByTestId('dealer-claim-stage-activation')
    await within(activation).findByText('Dealer workspace active')
    expect(within(activation).getByText('Public storefront not approved · vehicle listing authority not granted')).toBeInTheDocument()
    expect(screen.getByTestId('dealer-claim-stage-application')).toHaveTextContent('Version 1 · preliminary review complete')
    const next = screen.getByTestId('dealer-claim-next-step')
    expect(within(next).getByRole('link', { name: /Open your dealer workspace/ })).toHaveAttribute('href', '/dealer/dashboard')
    expect(screen.getByRole('button', { name: 'Download my prefilled Excel workbook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit frozen application for independent review' })).toBeDisabled()
    expect(screen.getByText('Public storefront not approved')).toBeInTheDocument()
  })

  it('never reads a failed claims list as "no claims", and retries the same read', async () => {
    fixture.failClaims = true
    renderWorkspace()
    expect(await screen.findByTestId('dealer-claims-read-failed')).toHaveTextContent('This is not evidence that you have none.')
    expect(screen.queryByText(/No claim requests yet/)).toBeNull()
    fixture.failClaims = false
    fireEvent.click(within(screen.getByTestId('dealer-claims-read-failed')).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('dealer-claim-list-ZW-DEAL-0004')).toBeInTheDocument()
  })

  it('points a rejected claim to its appeal', async () => {
    fixture.claimStatus = 'CLAIM_REJECTED'
    renderWorkspace()
    const claimStage = await screen.findByTestId('dealer-claim-stage-claim')
    expect(claimStage).toHaveAttribute('data-state', 'blocked')
    expect(screen.getByTestId('dealer-claim-next-step')).toHaveTextContent('Appeal the claim decision')
    expect(screen.getByRole('button', { name: 'Submit appeal for review' })).toBeDisabled()
  })
})

describe('DealerClaimWorkspace — flag OFF', () => {
  it('keeps the accepted workspace composition', async () => {
    fixture.unified = false
    renderWorkspace()
    expect(await screen.findByRole('heading', { name: 'Claim ZW-DEAL-0004' })).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-claim-workspace-showroom')).toBeNull()
    expect(screen.queryByTestId('dealer-claim-journey')).toBeNull()
  })
})
