/**
 * O2-X5 — Dealer onboarding page (ported by OC-5C from PR #208).
 *
 * Pinned rules: the page renders SERVER truth for the applicant's OWN application; the applicant badge
 * never claims active-Dealer status; the eight compliance dimensions render verbatim with can_publish
 * decided elsewhere; the responsible person's standing is the server's subject-safe label; company
 * documents are not read automatically (the page says so and offers no extraction); a non-dealer is
 * sent back to registration.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DealerOnboarding from './DealerOnboarding'
import userEvent from '@testing-library/user-event'
import { installTailwindVisibility, tabTo } from '@/test/keyboardReach'

const fetchDealerOnboardingOverview = vi.fn()
const saveDealerOnboardingProfile = vi.fn()
const uploadDealerEvidence = vi.fn()
const addDealerOnboardingBranch = vi.fn()
const inspectDealerWorkbook = vi.fn()
const confirmDealerWorkbookMapping = vi.fn()
const runDealerWorkbookDryRun = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDealerOnboardingOverview,
    saveDealerOnboardingProfile,
    uploadDealerEvidence,
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
  documents: [{ id: 'doc-1', doc_type: 'company_registration', status: 'present', has_file: true }],
  branches: [{ id: 'b1', name: 'Harare CBD', address: '12 Samora Machel Ave' }],
  compliance: {
    identity_status: 'unverified', business_evidence_status: 'incomplete', compliance_review_state: 'not_started',
    active_state: 'inactive', restriction_state: 'none', suspension_state: 'none', investigation_state: 'none',
    expiry_state: 'none', can_publish: false, blocking_requirements: ['company_registration'],
  },
  responsible_person_identity: { status: 'verified', status_label: 'verified', capability_bearing: true, applicant_guidance: null, who_must_act: 'none' },
  who_must_act: 'subject_action',
  action_summary: { missing: [{ code: 'company_registration', label: 'company registration' }], awaiting_review: [] },
  workspace_access: { available: false, dependency: 'governed_dealer_role_or_tenant_relationship', note: 'Dealer tools unlock after Dealer Compliance approval establishes the governed dealer relationship — a business application alone never does.' },
  document_extraction: { available: false, reason: 'Automatic reading of company documents is not available yet — enter your business details yourself.' },
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
    fetchDealerOnboardingOverview.mockResolvedValue({ success: true, ...OVERVIEW })
    saveDealerOnboardingProfile.mockResolvedValue({ success: true })
    uploadDealerEvidence.mockResolvedValue({ success: true })
    addDealerOnboardingBranch.mockResolvedValue({ success: true })
  })

  it('renders server truth: applicant (never active Dealer), requirements, the eight dimensions verbatim, can_publish decided elsewhere', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dealer-who-must-act')).toBeTruthy())
    expect(screen.getByTestId('workspace-dependency').textContent).toMatch(/Applicant — not an active Dealer/)
    expect(screen.getByTestId('requirements-list').textContent).toMatch(/company registration \(blocking\)/)
    expect(screen.getByTestId('still-needed').textContent).toMatch(/CarUp still needs: company registration/)
    const dims = screen.getByTestId('compliance-dimensions').textContent || ''
    for (const dim of ['identity status', 'compliance review state', 'suspension state', 'expiry state']) expect(dims).toContain(dim)
    expect(screen.getByTestId('can-publish').textContent).toBe('false')
    expect(screen.getByTestId('documents-list').textContent).toMatch(/company registration/)
    expect(screen.getByTestId('branches-list').textContent).toMatch(/Harare CBD/)
  })

  it('OC-5C: no automatic document reading is offered — the page says so, and there is no extract button', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('extraction-unavailable')).toBeTruthy())
    expect(screen.getByTestId('extraction-unavailable').textContent).toMatch(/enter your business details yourself/)
    expect(screen.queryByText(/Extract details/)).toBeNull()
    expect(screen.queryByTestId('ocr-doc-1')).toBeNull()
  })

  it('OC-5C: the responsible person\'s standing is the server\'s subject-safe label', async () => {
    fetchDealerOnboardingOverview.mockResolvedValue({
      success: true, ...OVERVIEW,
      responsible_person_identity: { status: 'security_review', status_label: 'under security review', capability_bearing: false, applicant_guidance: 'For your security, CarUp is reviewing this account.', who_must_act: 'carup_review' },
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('responsible-person-identity').textContent).toMatch(/under security review/))
    expect(screen.getByTestId('responsible-person-identity').textContent).toMatch(/For your security/)
    expect(document.body.textContent).not.toMatch(/compromised/i)
  })

  it('saving submits the typed business details only — no candidates, no tenant, no status', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dealer-profile-form')).toBeTruthy())
    fireEvent.change(screen.getByTestId('dealer-field-tax_id'), { target: { value: 'TIN-998877' } })
    fireEvent.click(screen.getByTestId('save-dealer-profile'))
    await waitFor(() => expect(saveDealerOnboardingProfile).toHaveBeenCalledTimes(1))
    const payload = saveDealerOnboardingProfile.mock.calls[0][0]
    expect(payload.profile.tax_id).toBe('TIN-998877')
    expect(payload.profile.legal_name).toBe('Moyo Motors (Pvt) Ltd')
    expect(payload.profile.physical_address).toBeNull()
    expect(Object.keys(payload)).toEqual(['profile'])
    expect(Object.keys(payload.profile).sort()).toEqual(['legal_name', 'operating_country', 'physical_address', 'registration_number', 'responsible_person', 'tax_id', 'trading_name'])
  })

  it('adding a branch sends exactly what was typed', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('add-branch')).toBeTruthy())
    fireEvent.change(screen.getByTestId('branch-name'), { target: { value: 'Bulawayo' } })
    fireEvent.change(screen.getByTestId('branch-address'), { target: { value: '4 Main St' } })
    fireEvent.click(screen.getByTestId('add-branch'))
    await waitFor(() => expect(addDealerOnboardingBranch).toHaveBeenCalledWith({ name: 'Bulawayo', address: '4 Main St' }))
  })

  it('workbook lane: inspect suggests (each source labelled), the human edits and confirms the exact checksum-bound mapping, dry run only after confirmation', async () => {
    inspectDealerWorkbook.mockResolvedValue({
      checksum: 'c'.repeat(64), template_type: 'buyer', sheet_name: 'DIASPORA_IMPORT_ORDERS', row_count: 12,
      canonical_columns: ['VIN', 'CHASSIS_NUMBER', 'NOTES'],
      ai: { state: 'provider_executed', model: '@cf/google/gemma-4-26b-a4b-it' },
      proposals: [
        { source: 'Reg_No', proposed_target: 'VIN', confidence: 1, provider: 'deterministic' },
        { source: 'Stock ref', proposed_target: 'NOTES', confidence: 0.7, provider: 'ai', model: '@cf/google/gemma-4-26b-a4b-it' },
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

    expect(screen.getByTestId('source-Reg_No').textContent).toBe('Matched by name')
    expect(screen.getByTestId('source-Stock ref').textContent).toMatch(/AI suggestion \(@cf\/google\/gemma-4-26b-a4b-it\) · 70%/)
    expect(screen.getByTestId('source-Odd').textContent).toBe('Not mapped')
    expect((screen.getByTestId('run-dry-run') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('target-Odd'), { target: { value: 'CHASSIS_NUMBER' } })
    fireEvent.click(screen.getByTestId('confirm-mapping'))
    await waitFor(() => expect(confirmDealerWorkbookMapping).toHaveBeenCalledTimes(1))
    expect(confirmDealerWorkbookMapping.mock.calls[0][0]).toEqual({
      template_type: 'buyer',
      sheet_name: 'DIASPORA_IMPORT_ORDERS',
      workbook_checksum: 'c'.repeat(64),
      mappings: [
        { source: 'Reg_No', target: 'VIN' },
        { source: 'Stock ref', target: 'NOTES' },
        { source: 'Odd', target: 'CHASSIS_NUMBER' },
      ],
    })

    await waitFor(() => expect((screen.getByTestId('run-dry-run') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('run-dry-run'))
    await waitFor(() => expect(runDealerWorkbookDryRun).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('dry-run-result').textContent).toMatch(/Nothing has been imported yet/))
  })

  it('workbook lane: when AI is unavailable the page says so, and editing after a confirmation requires confirming again', async () => {
    inspectDealerWorkbook.mockResolvedValue({
      checksum: 'd'.repeat(64), template_type: 'buyer', sheet_name: 'DIASPORA_IMPORT_ORDERS', row_count: 1,
      canonical_columns: ['VIN', 'NOTES'], ai: { state: 'unavailable', code: 'AI_PROVIDER_TIMEOUT' },
      proposals: [{ source: 'X', proposed_target: null, confidence: null, provider: 'unmapped', reason: 'ai_unavailable:AI_PROVIDER_TIMEOUT' }],
    })
    confirmDealerWorkbookMapping.mockResolvedValue({ success: true })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('workbook-lane')).toBeTruthy())
    fireEvent.change(screen.getByTestId('workbook-file'), { target: { files: [new File(['x'], 'a.xlsx')] } })
    await waitFor(() => expect((screen.getByTestId('inspect-workbook') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('inspect-workbook'))
    await waitFor(() => expect(screen.getByTestId('ai-unavailable')).toBeTruthy())
    fireEvent.change(screen.getByTestId('target-X'), { target: { value: 'NOTES' } })
    fireEvent.click(screen.getByTestId('confirm-mapping'))
    await waitFor(() => expect((screen.getByTestId('run-dry-run') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByTestId('target-X'), { target: { value: 'VIN' } })
    expect((screen.getByTestId('run-dry-run') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a caller without a dealer registration is sent back to registration, not shown an empty application', async () => {
    fetchDealerOnboardingOverview.mockRejectedValue(new Error('DEALER_ONBOARDING_CONTEXT_REQUIRED: dealer onboarding is available once your registration records a dealer business.'))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dealer-onboarding-denied')).toBeTruthy())
    expect(screen.getByText(/Go to registration/)).toBeTruthy()
  })

  it('PC01-F F4: the document upload and the workbook picker are reachable by keyboard (WCAG 2.1.1)', async () => {
    const restore = installTailwindVisibility()
    try {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => expect(screen.getByTestId('upload-evidence')).toBeTruthy())
      const evidence = screen.getByTestId('upload-evidence').querySelector('input[type="file"]')!
      expect(await tabTo(user, evidence), 'Tab never reaches the document upload').toBe(true)
      expect(await tabTo(user, screen.getByTestId('workbook-file')), 'Tab never reaches the workbook picker').toBe(true)
    } finally {
      restore()
    }
  })
})
