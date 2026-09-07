/**
 * GMO-2 — the evidence surface.
 *
 * Two things must hold no matter what the machine says. A person whose document cannot be read is
 * not being rejected, and must be told so in words that leave them a way forward. And a value the
 * machine guessed never reaches the form on its own — a person puts it there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import GarageEvidence from './GarageEvidence'
import { extractionPresentation, setupSteps, GARAGE_EVIDENCE_TYPES, type EvidenceDocument } from '@/lib/garageOnboarding'

const listGarageEvidence = vi.fn()
const uploadGarageEvidence = vi.fn()
const removeGarageEvidence = vi.fn()
const previewGarageEvidence = vi.fn()
const extractGarageEvidence = vi.fn()
const acknowledgeGarageEvidence = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    listGarageEvidence, uploadGarageEvidence, removeGarageEvidence,
    previewGarageEvidence, extractGarageEvidence, acknowledgeGarageEvidence,
  }),
}))

const DOC: EvidenceDocument = {
  id: 'doc-1', evidence_type: 'utility_bill', description: null, mime_type: 'application/pdf',
  size_bytes: 2048, extraction_state: 'not_attempted', extraction_candidates: null,
  extraction_confidence: null, extraction_note: null, created_at: '2026-09-06T09:00:00Z', has_file: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  listGarageEvidence.mockResolvedValue({ documents: [] })
})

const view = (props: Partial<React.ComponentProps<typeof GarageEvidence>> = {}) =>
  render(<GarageEvidence applicationId="app-1" editable {...props} />)

describe('adding evidence', () => {
  it('does not require a registered company', async () => {
    view()
    await screen.findByTestId('evidence-section')
    // PO-2: a legitimate Zimbabwe garage must be able to prove itself without incorporation.
    const select = screen.getByTestId('evidence-type') as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values[0]).toBe('premises_photo')
    expect(values).toContain('signage_photo')
    expect(screen.getByTestId('evidence-section').textContent)
      .toMatch(/do not need a registered company/i)
    // It is offered, just never first and never required.
    expect(values).toContain('company_registration')
    expect(GARAGE_EVIDENCE_TYPES.find(([v]) => v === 'company_registration')?.[2])
      .toMatch(/not required/i)
  })

  it('uploads a chosen file and refreshes the list', async () => {
    uploadGarageEvidence.mockResolvedValue({ document: DOC })
    view()
    await screen.findByTestId('evidence-file')
    const file = new File(['bytes'], 'bill.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('evidence-file'), { target: { files: [file] } })
    await waitFor(() => expect(uploadGarageEvidence).toHaveBeenCalled())
    const [appId, body] = uploadGarageEvidence.mock.calls[0]
    expect(appId).toBe('app-1')
    expect(body.evidence_type).toBe('premises_photo')
    expect(body.mime_type).toBe('application/pdf')
  })

  it('refuses an oversized file before sending it anywhere', async () => {
    view()
    await screen.findByTestId('evidence-file')
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 })
    fireEvent.change(screen.getByTestId('evidence-file'), { target: { files: [big] } })
    expect(await screen.findByTestId('evidence-action-error')).toHaveTextContent(/larger than 15MB/i)
    expect(uploadGarageEvidence).not.toHaveBeenCalled()
  })

  it('reports the count upward so the checklist can be truthful', async () => {
    listGarageEvidence.mockResolvedValue({ documents: [DOC, { ...DOC, id: 'doc-2' }] })
    const onChanged = vi.fn()
    view({ onChanged })
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(2))
  })
})

describe('a failure to read is never a failure of the application', () => {
  it('a failed read says the upload is safe and offers the manual path', async () => {
    listGarageEvidence.mockResolvedValue({
      documents: [{ ...DOC, extraction_state: 'failed', extraction_note: null }],
    })
    view()
    const detail = await screen.findByTestId('evidence-detail')
    expect(detail).toHaveTextContent(/your upload is safe/i)
    expect(detail).toHaveTextContent(/type the details in yourself/i)
    expect(detail.textContent).not.toMatch(/reject|denied|invalid/i)
  })

  it('"unavailable" is not phrased as anything going wrong', async () => {
    listGarageEvidence.mockResolvedValue({
      documents: [{ ...DOC, extraction_state: 'unavailable', extraction_note: null }],
    })
    view()
    expect(await screen.findByTestId('evidence-state')).toHaveTextContent('Received')
    expect(screen.getByTestId('evidence-detail')).toHaveTextContent(/not available/i)
    expect(screen.getByTestId('evidence-detail').textContent).not.toMatch(/fail|error|problem/i)
  })

  it('a failed LIST is a loading problem, not "you have uploaded nothing"', async () => {
    listGarageEvidence.mockRejectedValue(new Error('network'))
    view()
    const err = await screen.findByTestId('evidence-error')
    expect(err).toHaveTextContent(/does not mean your documents are missing/i)
    expect(screen.queryByTestId('evidence-empty')).toBeNull()
  })

  it('every extraction state has its own words', () => {
    const seen = new Set<string>()
    for (const s of ['not_attempted', 'unavailable', 'failed', 'low_confidence', 'awaiting_confirmation', 'confirmed'] as const) {
      const p = extractionPresentation({ ...DOC, extraction_state: s, extraction_note: null })
      seen.add(`${p.label}|${p.detail}`)
    }
    // Six states, six distinct things said. Collapsing any two is how a person is misled.
    expect(seen.size).toBe(6)
  })

  it('an unknown state reads as unrecorded, never as a decision', () => {
    const p = extractionPresentation({ ...DOC, extraction_state: 'something_new' as never })
    expect(p.detail).toMatch(/not recorded/i)
    expect(p.showCandidates).toBe(false)
  })
})

describe('a machine guess never becomes the form on its own', () => {
  const READ: EvidenceDocument = {
    ...DOC, extraction_state: 'awaiting_confirmation',
    extraction_candidates: {
      trading_name: { state: 'machine_candidate', value: 'Mbare Motors' },
      address_line: { state: 'missing' },
    },
    extraction_confidence: 0.91,
  }

  it('shows candidates as suggestions, and says nothing is filled in yet', async () => {
    listGarageEvidence.mockResolvedValue({ documents: [READ] })
    view({ onUseValue: vi.fn() })
    const panel = await screen.findByTestId('evidence-candidates')
    expect(panel).toHaveTextContent('Mbare Motors')
    expect(panel).toHaveTextContent(/Nothing is filled in until you press/i)
  })

  it('a value reaches the form only when the person presses the button', async () => {
    listGarageEvidence.mockResolvedValue({ documents: [READ] })
    const onUseValue = vi.fn()
    view({ onUseValue })
    await screen.findByTestId('evidence-candidates')
    expect(onUseValue, 'nothing may be written on render').not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('evidence-use-value'))
    expect(onUseValue).toHaveBeenCalledWith('trading_name', 'Mbare Motors')
  })

  it('a missing candidate is not offered at all', async () => {
    listGarageEvidence.mockResolvedValue({ documents: [READ] })
    view({ onUseValue: vi.fn() })
    await screen.findByTestId('evidence-candidates')
    // `address_line` came back as missing; there must be no button proposing an empty address.
    expect(screen.getAllByTestId('evidence-use-value')).toHaveLength(1)
  })

  it('low confidence tells the person to check each value', async () => {
    listGarageEvidence.mockResolvedValue({
      documents: [{ ...READ, extraction_state: 'low_confidence', extraction_confidence: 0.3, extraction_note: null }],
    })
    view({ onUseValue: vi.fn() })
    expect(await screen.findByTestId('evidence-detail')).toHaveTextContent(/not confident/i)
    expect(screen.getByTestId('evidence-candidates')).toBeTruthy()
  })
})

describe('a submitted application is not quietly editable', () => {
  it('offers no upload, remove or extract controls while CarUp holds it', async () => {
    listGarageEvidence.mockResolvedValue({ documents: [DOC] })
    view({ editable: false })
    await screen.findByTestId('evidence-item')
    expect(screen.queryByTestId('evidence-upload')).toBeNull()
    expect(screen.queryByTestId('evidence-remove')).toBeNull()
    expect(screen.queryByTestId('evidence-extract')).toBeNull()
    expect(screen.getByTestId('evidence-locked')).toHaveTextContent(/cannot be changed right now/i)
    // Viewing your own document stays available — it is yours.
    expect(screen.getByTestId('evidence-preview')).toBeTruthy()
  })
})

describe('the checklist counts evidence honestly', () => {
  const APP = {
    id: 'app-1', status: 'draft', submitted_at: null, decided_at: null, activated_tenant_id: null,
  } as never

  it('an unmeasured count is not reported as zero documents', () => {
    const step = setupSteps(APP, [], null).find((s) => s.label === 'Proof your garage is real')
    expect(step?.state).toBe('pending')
    expect(step?.detail).toMatch(/not loaded yet/i)
    expect(step?.detail).not.toMatch(/^0 /)
  })

  it('a real count is stated, and completes the step', () => {
    const step = setupSteps(APP, [], 2).find((s) => s.label === 'Proof your garage is real')
    expect(step?.state).toBe('complete')
    expect(step?.detail).toBe('2 documents uploaded.')
    expect(setupSteps(APP, [], 1).find((s) => s.label === 'Proof your garage is real')?.detail)
      .toBe('1 document uploaded.')
  })

  it('genuinely zero evidence asks for it plainly', () => {
    const step = setupSteps(APP, [], 0).find((s) => s.label === 'Proof your garage is real')
    expect(step?.state).toBe('pending')
    expect(step?.detail).toMatch(/at least one document or photo/i)
  })
})
