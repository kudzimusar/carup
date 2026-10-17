import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import GarageSetup from './GarageSetup'

const fetchMyGarageApplication = vi.fn()
const startGarageApplication = vi.fn()
const saveGarageApplication = vi.fn()
const submitGarageApplication = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMyGarageApplication,
    startGarageApplication,
    saveGarageApplication,
    submitGarageApplication,
  }),
}))

vi.mock('./GarageEvidence', () => ({
  default: ({ onUseValue }: { onUseValue?: (field: string, value: string) => void }) => (
    <div data-testid="garage-evidence-stub">
      <span>Candidate: OCR Motors</span>
      <button type="button" data-testid="apply-candidate" onClick={() => onUseValue?.('trading_name', 'OCR Motors')}>
        Use candidate
      </button>
    </div>
  ),
}))

const APP = {
  id: 'app-c3',
  status: 'draft',
  trading_name: null,
  address_line: null,
  location_city: null,
  location_province: null,
  contact_phone: null,
  contact_email: null,
  service_categories: [],
  applicant_relationship: null,
  attestation_accepted_at: null,
  submitted_at: null,
  decided_at: null,
  decision_reason: null,
  decision_reason_code: null,
  supersedes_application_id: null,
  activated_tenant_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMyGarageApplication.mockResolvedValue({ application: APP, blockers: ['a garage name'], editable: true })
  saveGarageApplication.mockResolvedValue({ application: APP, blockers: [] })
  submitGarageApplication.mockResolvedValue({ application: { ...APP, status: 'submitted' } })
})

describe('OCR 1.0-C3 Garage setup', () => {
  it('keeps every candidate application field manually editable when OCR is optional', async () => {
    render(<GarageSetup />)
    for (const field of [
      'trading_name', 'address_line', 'location_city', 'location_province', 'contact_phone', 'contact_email',
    ]) {
      expect(await screen.findByTestId(`garage-field-${field}`)).not.toBeDisabled()
    }

    const name = screen.getByTestId('garage-field-trading_name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Typed Garage' } })
    expect(name.value).toBe('Typed Garage')
    expect(screen.getByText(/complete all of these manually/i)).toBeTruthy()
  })

  it('does not place an OCR candidate in the application until the applicant explicitly chooses it', async () => {
    render(<GarageSetup />)
    const name = await screen.findByTestId('garage-field-trading_name') as HTMLInputElement

    expect(screen.getByText('Candidate: OCR Motors')).toBeTruthy()
    expect(name.value).toBe('')

    fireEvent.click(screen.getByTestId('apply-candidate'))
    expect(name.value).toBe('OCR Motors')
  })

  it('contains no reviewer approval or activation control', async () => {
    render(<GarageSetup />)
    await screen.findByTestId('garage-c3-setup')
    expect(screen.queryByText(/^Approve$/i)).toBeNull()
    expect(screen.queryByText(/Activate garage/i)).toBeNull()
    expect(screen.getByText(/Submit to CarUp for review/i)).toBeTruthy()
  })
})
