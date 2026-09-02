/**
 * Operations Control Plane M4 — Vehicle Operations workspace component tests.
 *
 * Pinned rules: the workspace renders the requirement matrix and canonical
 * evidence grouping; a legacy/canonical contradiction is SURFACED (canonical
 * meaning governs); actions render only when the server-derived allowed_actions
 * grant them; nothing offers an admin publish, a trust edit, or a ZIMRA/CVR
 * assertion; missing states render truthfully.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import VehicleOperationsReview from './VehicleOperationsReview'

const fetchVehicleOperationsReview = vi.fn()
const fetchEvidenceTaxonomy = vi.fn().mockResolvedValue({ classes: [] })

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchVehicleOperationsReview,
    fetchEvidenceTaxonomy,
    approveEvidence: vi.fn(),
    rejectEvidence: vi.fn(),
    correctEvidenceClassification: vi.fn(),
    reviewSellerAuthority: vi.fn(),
  }),
}))

const REVIEW = {
  vin: 'GFC27-027051',
  generated_at: '2026-09-03T00:00:00Z',
  vehicle: {
    vin: 'GFC27-027051', make: 'Nissan', model: 'Serena Highway Star', year: 2016,
    status: 'Available', publication_status: 'draft',
    chassis_number: 'GFC27-027051', engine_number: 'MR20961177B', import_source: 'import',
    price: 12800, currency: 'USD', listing_city: 'Harare',
    passport_verified: false, zimra_verified: false, duty_paid: false, created_at: '2026-09-01T09:00:00Z',
  },
  seller: {
    account: { id: 'u_k', name: 'Kingstone M', role: 'owner', account_verified: false, email_verified: false, member_since: '2026-09-01' },
    seller_type: 'Private Owner', owner_id: 'u_k', current_seller_id: 'u_k', tenant_id: null,
  },
  seller_authority: {
    seller_user_id: 'u_k', status: 'recognized', basis: 'existing_relationship', reason: null,
    policy_version: 'seller_authority.v1', decided_by: null, decided_at: null,
    existing_relationship: true, public_statement: 'Listed by the recorded CarUp seller', evidence_ids: [],
  },
  registration: {
    recorded_stage: null, stage_source: null, stage_provenance: 'not_recorded',
    lifecycle: { label: 'Registration status not established', status: 'not_recorded', publication_blocking: true, reason_codes: ['registration_stage_not_recorded'], lifecycle_status: null },
    plate_number_recorded: false, temporary_permit_recorded: false,
  },
  evidence: {
    total: 2,
    groups: {
      import: [{
        id: 'ev-inv', semantic_label: 'Import — Commercial invoice',
        evidence_class: 'import', evidence_subtype: 'commercial_invoice',
        semantic_source: 'canonical', legacy_evidence_type: 'registration_document',
        legacy_contradicts_canonical: true, verification_status: 'pending', visibility_level: 'private',
        uploader_role: 'owner', uploaded_by_seller: true, source_name: null, has_checksum: true,
        event_date: '2026-03-07', uploaded_at: '2026-09-02T11:34:08Z', verified_at: null,
        mime_type: 'application/pdf', ai_advisory_status: null, classification_history: [],
      }],
      inspection: [{
        id: 'ev-rw', semantic_label: 'Inspection — Roadworthiness',
        evidence_class: 'inspection', evidence_subtype: 'roadworthiness',
        semantic_source: 'canonical', legacy_evidence_type: 'registration_document',
        legacy_contradicts_canonical: true, verification_status: 'pending', visibility_level: 'private',
        uploader_role: 'owner', uploaded_by_seller: true, source_name: null, has_checksum: true,
        event_date: '2026-04-14', uploaded_at: '2026-09-02T11:22:30Z', verified_at: null,
        mime_type: 'application/pdf', ai_advisory_status: null, classification_history: [],
      }],
    },
  },
  document_intelligence: { unresolved_material_fields: [] },
  trust_summary: { trust_score: null, trust_band: null, evaluated: false, pending_fact_requests: 0 },
  governance_summary: { open_review_tasks: 0, open_disputes: 0 },
  risk_summary: { open_cases: 0, blocking_cases: 0, cases: [] },
  publication_readiness: {
    is_publishable: false, completeness_percent: 57, publication_status: 'draft',
    requirements: [
      { key: 'seller_authority', label: 'Seller authority to list this vehicle', category: 'seller_authority', blocking: true, status: 'pending_review', who_must_act: 'carup_review' },
      { key: 'registration_readiness', label: 'Registration status not established', category: 'registration', blocking: true, status: 'pending_review', who_must_act: 'seller' },
    ],
  },
  audit: [
    { id: 'a1', event_type: 'EVIDENCE_UPLOADED', actor_role: 'owner', reason: null, created_at: '2026-09-02T11:34:10Z' },
  ],
  allowed_actions: ['evidence.verify', 'evidence.reject', 'evidence.correct_classification', 'seller_authority.review'],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/vehicles/GFC27-027051/review']}>
      <Routes>
        <Route path="/admin/vehicles/:vin/review" element={<VehicleOperationsReview />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('VehicleOperationsReview', () => {
  beforeEach(() => {
    fetchVehicleOperationsReview.mockReset()
    fetchVehicleOperationsReview.mockResolvedValue({ success: true, review: REVIEW })
  })

  it('renders identity, requirement matrix, canonical grouping and the surfaced contradiction', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('vehicle-operations-review')).toBeTruthy())

    expect(screen.getByText(/2016 Nissan Serena Highway Star/)).toBeTruthy()
    expect(screen.getByTestId('ops-publishable-state').textContent).toMatch(/Not yet publishable/)
    expect(screen.getByText('Seller authority to list this vehicle')).toBeTruthy()
    expect(screen.getAllByText('Awaiting CarUp review').length).toBeGreaterThan(0)
    expect(screen.getByTestId('ops-evidence-group-import')).toBeTruthy()
    expect(screen.getByText('Import — Commercial invoice')).toBeTruthy()
    // The mislabel is surfaced, never hidden.
    expect(screen.getAllByTestId('ops-legacy-contradiction').length).toBe(2)
  })

  it('renders reviewer actions only from server-derived allowed_actions', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('vehicle-operations-review')).toBeTruthy())
    expect(screen.getAllByRole('button', { name: /Verify/ }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('ops-authority-decision')).toBeTruthy()

    // And with NO actions granted, none render.
    fetchVehicleOperationsReview.mockResolvedValue({ success: true, review: { ...REVIEW, allowed_actions: [] } })
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId('vehicle-operations-review').length).toBe(2))
    const second = screen.getAllByTestId('vehicle-operations-review')[1]
    expect(second.querySelectorAll('[data-testid="ops-authority-decision"]').length).toBe(0)
  })

  it('offers no admin publish, trust edit, or government-fact action', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('vehicle-operations-review')).toBeTruthy())
    const buttons = screen.getAllByRole('button').map((b) => b.textContent || '')
    for (const label of buttons) {
      expect(label).not.toMatch(/publish/i)
      expect(label).not.toMatch(/trust/i)
      expect(label).not.toMatch(/zimra|cvr/i)
    }
  })

  it('offers a governed correction on an ALREADY VERIFIED record, including its visibility', async () => {
    // A mis-classified or wrongly published document is almost always discovered AFTER review, so
    // gating the correction editor on verification_status === 'pending' made the capability dead by
    // construction for exactly the rows that need it. The real Serena's Tanzania T1 is verified AND
    // published, and could not be reached from this workspace at all.
    const verified = {
      ...REVIEW,
      evidence: {
        total: 1,
        groups: {
          import: [{
            ...REVIEW.evidence.groups.import[0],
            id: 'ev-t1', semantic_label: 'Import — Transit declaration',
            evidence_subtype: 'transit_declaration',
            verification_status: 'verified', visibility_level: 'public_safe',
            verified_at: '2026-09-02T19:17:26Z',
          }],
        },
      },
    }
    fetchVehicleOperationsReview.mockResolvedValue({ success: true, review: verified })
    renderPage()

    const correct = await screen.findByRole('button', { name: /correct record/i })
    // Verify/Reject must NOT be offered on a row that is no longer pending.
    expect(screen.queryByRole('button', { name: /^verify$/i })).toBeNull()

    correct.click()
    const visibility = await screen.findByTestId('ops-correction-visibility')
    expect(visibility).toBeTruthy()
    // It opens on the record's CURRENT visibility, so a reviewer sees what they are changing.
    expect((visibility as HTMLSelectElement).value).toBe('public_safe')
  })

  it('renders a truthful unavailable state when the review cannot load', async () => {
    fetchVehicleOperationsReview.mockRejectedValue(new Error('Forbidden. This action requires a capability.'))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('ops-review-error')).toBeTruthy())
    expect(screen.getByText(/Forbidden/)).toBeTruthy()
  })
})
