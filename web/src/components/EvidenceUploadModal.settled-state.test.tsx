/**
 * OC-5R-REL-02 — the evidence uploader's own "done".
 *
 * The deployed seller-media gate (tests/agents/42-seller-media-lifecycle-staging.spec.ts) uploads the
 * ownership document through this modal, then waits for the uploader to CLOSE before a reviewer reads
 * the evidence list. It used to click Submit and read at once, so on a slower shard the read landed
 * inside the product's own POST (run 37723228342, tablet) and found no row — a test-side race, with the
 * product right.
 *
 * That wait is only honest if the modal's closing means exactly one thing. This pins the contract the
 * gate now leans on:
 *   1. an open uploader is a dialog NAMED "Upload Vehicle Evidence" — if it were renamed or lost its
 *      name, "no such dialog" would pass the gate's wait vacuously, before the upload had settled;
 *   2. it closes (onClose) ONLY after the server accepted the upload, and tells its parent (onSuccess)
 *      first;
 *   3. a refused upload leaves it open and showing the reason — a failure can never look like "done";
 *   4. while the upload is in flight it neither closes nor accepts a second press.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import EvidenceUploadModal from './EvidenceUploadModal'

const uploadEvidence = vi.fn()
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
      evidence_class: 'registration',
      subtypes: [
        { subtype_code: 'registration_book', label: 'Registration book / certificate', is_document: true, requires_event_date: true, requires_mileage: false, supports_components: false },
      ],
    },
  ],
  legacy_type_to_class: {},
}

const DIALOG_NAME = /Upload Vehicle Evidence/i

function renderModal() {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const view = render(
    <EvidenceUploadModal isOpen onClose={onClose} vin="JTMLCTAB232283422" timelineEvents={[]} onSuccess={onSuccess} />,
  )
  return { onClose, onSuccess, ...view }
}

async function fillAndAttach() {
  await waitFor(() => expect(screen.getByLabelText(/Life stage/)).toBeTruthy())
  fireEvent.change(screen.getByLabelText(/Life stage/), { target: { value: 'registration' } })
  fireEvent.change(screen.getByLabelText(/What is this evidence\?/), { target: { value: 'registration_book' } })
  const file = new File(['\x89PNG registration book'], 'registration-book.png', { type: 'image/png' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  // The selected-file card appears synchronously; the base64 payload arrives from an async FileReader.
  await screen.findByText('registration-book.png')
  await new Promise((resolve) => setTimeout(resolve, 150))
}

const submit = () => fireEvent.submit(document.querySelector('form') as HTMLFormElement)

describe('the evidence uploader: what "closed" means', () => {
  beforeEach(() => {
    uploadEvidence.mockReset()
    fetchEvidenceTaxonomy.mockReset()
    fetchEvidenceTaxonomy.mockResolvedValue(TAXONOMY)
  })

  it('is a dialog named "Upload Vehicle Evidence" while it is open', async () => {
    renderModal()
    expect(screen.getAllByRole('dialog', { name: DIALOG_NAME })).toHaveLength(1)
  })

  it('tells its parent, then closes, only after the server accepted the upload', async () => {
    const accepted = { id: 'ev-new', evidence_type: 'registration_document' }
    uploadEvidence.mockResolvedValue(accepted)
    const order: string[] = []
    const { onClose, onSuccess } = renderModal()
    onSuccess.mockImplementation(() => order.push('onSuccess'))
    onClose.mockImplementation(() => order.push('onClose'))
    await fillAndAttach()

    submit()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(uploadEvidence).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(accepted)
    expect(order).toEqual(['onSuccess', 'onClose'])
  })

  it('stays open, shows the reason and never reports success when the upload is refused', async () => {
    uploadEvidence.mockRejectedValue(new Error('Ownership evidence needs a document, not a photograph'))
    const { onClose, onSuccess } = renderModal()
    await fillAndAttach()

    submit()
    await screen.findByText('Ownership evidence needs a document, not a photograph')

    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getAllByRole('dialog', { name: DIALOG_NAME })).toHaveLength(1)
    // …and it is usable again, so the person can correct and retry.
    expect((screen.getByRole('button', { name: /Submit Evidence/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not close, and cannot be pressed twice, while the upload is in flight', async () => {
    let settle: (value: unknown) => void = () => {}
    uploadEvidence.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
    const { onClose, onSuccess } = renderModal()
    await fillAndAttach()

    submit()
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(1))
    expect((screen.getByRole('button', { name: /Submit Evidence/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()

    settle({ id: 'ev-late' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith({ id: 'ev-late' })
  })
})
