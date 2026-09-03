/**
 * Operations Control Plane M1 — canonical-first evidence upload UX.
 *
 * THE DEFECT THIS PINS: the modal used to hard-require a legacy evidence_type
 * before the canonical class/subtype selection, which is exactly how the
 * Serena's BE FORWARD commercial invoice ended up stored under legacy
 * 'registration_document'. Canonical-first mode must:
 *   1. never render the legacy "Evidence Category" select when the taxonomy loads;
 *   2. require life stage + subtype instead;
 *   3. submit evidence_class + evidence_subtype WITHOUT any evidence_type —
 *      the server derives the compatibility value;
 *   4. keep the legacy select as fallback when the taxonomy is unavailable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import EvidenceUploadModal from './EvidenceUploadModal'

const uploadEvidence = vi.fn().mockResolvedValue({ id: 'ev-new' })
const fetchEvidenceTaxonomy = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    uploadEvidence,
    fetchEvidenceTaxonomy,
    user: { id: 'u_owner', role: 'owner' },
  }),
}))

const TAXONOMY = {
  version: 'vehicle_life_evidence.v1',
  classes: [
    {
      evidence_class: 'import',
      subtypes: [
        { subtype_code: 'commercial_invoice', label: 'Commercial invoice', is_document: true, requires_event_date: true, requires_mileage: false, supports_components: false },
        { subtype_code: 'port_photo', label: 'Port photo', is_document: false, requires_event_date: true, requires_mileage: false, supports_components: false },
      ],
    },
    {
      evidence_class: 'registration',
      subtypes: [
        { subtype_code: 'registration_book', label: 'Registration book / certificate', is_document: true, requires_event_date: true, requires_mileage: false, supports_components: false },
        { subtype_code: 'police_clearance_first_registration', label: 'Police clearance for first registration', is_document: true, requires_event_date: true, requires_mileage: false, supports_components: false },
      ],
    },
  ],
  legacy_type_to_class: {},
}

function renderModal() {
  return render(
    <EvidenceUploadModal
      isOpen
      onClose={() => {}}
      vin="GFC27-027051"
      timelineEvents={[]}
      onSuccess={() => {}}
    />
  )
}

async function attachPdf() {
  const file = new File(['%PDF-1.4 test'], 'invoice.pdf', { type: 'application/pdf' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  // The selected-file card appears synchronously, but the base64 payload is set
  // by an async FileReader — give it a beat so submit sees the file bytes.
  await screen.findByText('invoice.pdf')
  await new Promise((resolve) => setTimeout(resolve, 150))
}

describe('canonical-first mode', () => {
  beforeEach(() => {
    uploadEvidence.mockClear()
    fetchEvidenceTaxonomy.mockReset()
    fetchEvidenceTaxonomy.mockResolvedValue(TAXONOMY)
  })

  it('requires life stage + subtype and never shows the legacy category select', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByLabelText(/Life stage/)).toBeTruthy())
    expect(screen.queryByLabelText(/Evidence Category/)).toBeNull()
    expect(screen.getByLabelText(/What is this evidence\?/)).toBeTruthy()
  })

  it('submits evidence_class + evidence_subtype with NO legacy evidence_type', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByLabelText(/Life stage/)).toBeTruthy())

    fireEvent.change(screen.getByLabelText(/Life stage/), { target: { value: 'import' } })
    fireEvent.change(screen.getByLabelText(/What is this evidence\?/), { target: { value: 'commercial_invoice' } })
    await attachPdf()

    fireEvent.submit(document.querySelector('form') as HTMLFormElement)
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(1))

    const [vin, payload] = uploadEvidence.mock.calls[0]
    expect(vin).toBe('GFC27-027051')
    expect(payload.evidence_class).toBe('import')
    expect(payload.evidence_subtype).toBe('commercial_invoice')
    expect('evidence_type' in payload).toBe(false)
  })

  it('defaults a document subtype to Restricted visibility', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByLabelText(/Life stage/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/Life stage/), { target: { value: 'import' } })
    fireEvent.change(screen.getByLabelText(/What is this evidence\?/), { target: { value: 'commercial_invoice' } })
    const visibility = screen.getByLabelText(/Requested Visibility/) as HTMLSelectElement
    expect(visibility.value).toBe('restricted')
  })

  it('hides role-restricted subtypes from an owner (police clearance is government-scoped)', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByLabelText(/Life stage/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/Life stage/), { target: { value: 'registration' } })
    const subtypeSelect = screen.getByLabelText(/What is this evidence\?/) as HTMLSelectElement
    const options = Array.from(subtypeSelect.options).map((o) => o.value)
    expect(options).toContain('registration_book')
    expect(options).not.toContain('police_clearance_first_registration')
  })
})

describe('legacy fallback mode', () => {
  beforeEach(() => {
    uploadEvidence.mockClear()
    fetchEvidenceTaxonomy.mockReset()
    fetchEvidenceTaxonomy.mockRejectedValue(new Error('taxonomy unavailable'))
  })

  it('keeps the legacy category select so uploads never become impossible', async () => {
    renderModal()
    await waitFor(() => expect(fetchEvidenceTaxonomy).toHaveBeenCalled())
    expect(screen.getByLabelText(/Evidence Category/)).toBeTruthy()
    expect(screen.queryByLabelText(/Life stage/)).toBeNull()
  })
})
