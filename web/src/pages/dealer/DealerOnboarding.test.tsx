/**
 * O2-X5 — Dealer onboarding page.
 *
 * Pinned rules: the page renders SERVER truth for the applicant's OWN application; the
 * applicant badge never claims active-Dealer status; the eight compliance dimensions render
 * verbatim with can_publish decided elsewhere; OCR candidates are used only by explicit click
 * and travel back as candidates_seen; the workbook lane is inspect → human-editable mapping →
 * confirm (exact checksum-bound payload) → dry run, with dry run disabled until the mapping is
 * confirmed.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DealerOnboarding from './DealerOnboarding'

const fetchDealerOnboardingOverview = vi.fn()
const saveDealerOnboardingProfile = vi.fn()
const uploadDealerEvidence = vi.fn()
const runDealerDocumentOcr = vi.fn()
const addDealerOnboardingBranch = vi.fn()
const inspectDealerWorkbook = vi.fn()
const confirmDealerWorkbookMapping = vi.fn()
const runDealerWorkbookDryRun = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDealerOnboardingOverview,
    saveDealerOnboardingProfile,
    uploadDealerEvidence,
    runDealerDocumentOcr,
    addDealerOnboardingBranch,
    inspectDealerWorkbook,
    confirmDealerWorkbookMapping,
    runDealerWorkbookDryRun,
  }),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'dealer-app-1', role: 'owner' } }),
}))

const OVERVIEW = {
  registration: { organization_name: 'Moyo Motors', onboarding_status: 'requested' },
  profile: {
    legal_name: 'Moyo Motors (Pvt) Ltd', trading_name: 'Moyo Motors', registration_number: 'CR-12345',
    tax_id: '', physical_address: '', responsible_person: '', operating_country: 'Zimbabwe',
  },
  requirements: [
    { id: 'r1', requirement_key: 'company_registration', status: 'required', is_blocking: true },
    { id: 'r2', requirement_key: 'tax_clearance', status: 'verified', is_blocking: true },
  ],
  documents: [
    {
      id: 'doc-1', doc_type: 'company_registration', status: 'present', has_file: true,
      extraction_candidates: {
        legal_name: { state: 'machine_candidate', value: 'Moyo Motors (Pvt) Ltd' },
        tax_id: { state: 'missing' },
      },
    },
  ],
  branches: [{ id: 'b1', name: 'Harare CBD', address: '12 Samora Machel Ave' }],
  compliance: {
    identity_status: 'unverified', business_evidence_status: 'incomplete', compliance_review_state: 'not_started',
    active_state: 'inactive', restriction_state: 'none', suspension_state: 'none', investigation_state: 'none',
    expiry_state: 'none', can_publish: false, blocking_requirements: ['company_registration'],
  },
  responsible_person_identity: { effective_state: 'verified', capability_bearing: true, applicant_guidance: null, who_must_act: 'none' },
  who_must_act: 'subject_action',
  workspace_access: { available: false, dependency: 'governed_dealer_role_or_tenant_relationship', note: 'Dealer tools unlock after Dealer Compliance approval establishes the governed dealer relationship — a business application alone never does.' },
  document_types: ['company_registration', 'tax_document', 'business_licence', 'address_evidence', 'banking_evidence', 'other'],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dealer/onboarding']}>
      <DealerOnboarding />
    </MemoryRouter>
  )
}

describe('DealerOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchDealerOnboardingOverview.mockResolvedValue(OVERVIEW)
    saveDealerOnboardingProfile.mockResolvedValue({ success: true })
  })

  it('renders the applicant truth: never an active Dealer, dimensions verbatim, requirements independent, identity from O2', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dealer-who-must-act')).toBeTruthy())
    expect(screen.getByTestId('workspace-dependency').textContent).toMatch(/not an active Dealer/i)
    expect(screen.getByText(/a business application alone never does/i)).toBeTruthy()

    expect(screen.getByTestId('requirements-list').textContent).toMatch(/company registration/)
    expect(screen.getByTestId('requirements-list').textContent).toMatch(/verified/)
    const dims = screen.getByTestId('compliance-dimensions').textContent || ''
    for (const verbatim of ['unverified', 'incomplete', 'not_started', 'inactive']) {
      expect(dims).toContain(verbatim)
    }
    expect(screen.getByTestId('can-publish').textContent).toBe('false')
    expect(screen.getByTestId('responsible-person-identity').textContent).toMatch(/verified/)
  })

  it('access refusal renders the honest gate, not a broken page', async () => {
    fetchDealerOnboardingOverview.mockRejectedValue(new Error('DEALER_ONBOARDING_CONTEXT_REQUIRED: dealer onboarding is available once your registration profile records a dealer business.'))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dealer-onboarding-denied')).toBeTruthy())
  })

  it('an OCR candidate enters the form only by explicit click, and the save carries candidates_seen', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('candidates-doc-1')).toBeTruthy())
    expect(screen.getByTestId('candidates-doc-1').textContent).toMatch(/tax id: not read/)

    fireEvent.click(screen.getByTestId('use-doc-1-legal_name'))
    fireEvent.click(screen.getByTestId('save-dealer-profile'))
    await waitFor(() => expect(saveDealerOnboardingProfile).toHaveBeenCalledTimes(1))
    const payload = saveDealerOnboardingProfile.mock.calls[0][0]
    expect(payload.candidates_seen).toEqual({ legal_name: 'Moyo Motors (Pvt) Ltd' })
    expect(payload.profile.legal_name).toBe('Moyo Motors (Pvt) Ltd')
  })

  it('workbook lane: inspect proposes, the human edits and confirms the exact checksum-bound mapping, dry run only after confirmation', async () => {
    inspectDealerWorkbook.mockResolvedValue({
      checksum: 'c'.repeat(64), template_type: 'buyer', sheet_name: 'DIASPORA_IMPORT_ORDERS', row_count: 12,
      canonical_columns: ['VIN', 'CHASSIS_NUMBER', 'NOTES'],
      proposals: [
        { source: 'Reg_No', proposed_target: 'VIN', confidence: 1, provider: 'deterministic' },
        { source: 'Odd', proposed_target: null, confidence: null, provider: 'unmapped' },
      ],
    })
    confirmDealerWorkbookMapping.mockResolvedValue({ success: true })
    runDealerWorkbookDryRun.mockResolvedValue({ success: true, data: { summary: { accepted: 10, blocked: 2 } } })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('workbook-lane')).toBeTruthy())

    const file = new File(['fake'], 'stock.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(screen.getByTestId('workbook-file'), { target: { files: [file] } })
    await waitFor(() => expect((screen.getByTestId('inspect-workbook') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('inspect-workbook'))
    await waitFor(() => expect(screen.getByTestId('mapping-table')).toBeTruthy())

    expect((screen.getByTestId('run-dry-run') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('target-Odd'), { target: { value: 'NOTES' } })
    fireEvent.click(screen.getByTestId('confirm-mapping'))
    await waitFor(() => expect(confirmDealerWorkbookMapping).toHaveBeenCalledTimes(1))
    expect(confirmDealerWorkbookMapping.mock.calls[0][0]).toEqual({
      template_type: 'buyer',
      sheet_name: 'DIASPORA_IMPORT_ORDERS',
      workbook_checksum: 'c'.repeat(64),
      mappings: [
        { source: 'Reg_No', target: 'VIN' },
        { source: 'Odd', target: 'NOTES' },
      ],
    })

    await waitFor(() => expect((screen.getByTestId('run-dry-run') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('run-dry-run'))
    await waitFor(() => expect(runDealerWorkbookDryRun).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('dry-run-result').textContent).toMatch(/Nothing has been imported yet/))
  })
})
