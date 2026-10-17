/**
 * GMO-4 (OC-5E) — what the applicant is told once CarUp has decided.
 *
 * Only an application whose workspace EXISTS (`activated_tenant_id`) offers the way in. An approved
 * application without one says so — the workspace is CarUp's to build — and offers nothing that would
 * try to select a garage that does not exist. Anything earlier shows neither.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchMyGarageApplication = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMyGarageApplication, startGarageApplication: vi.fn(), saveGarageApplication: vi.fn(), submitGarageApplication: vi.fn(),
  }),
}))
vi.mock('./GarageEvidence', () => ({ default: () => <div data-testid="garage-evidence-stub" /> }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ selectActiveTenant: vi.fn(), refreshSession: vi.fn() }) }))

const { default: GarageSetup } = await import('./GarageSetup')

const APP = {
  id: 'app-c3', status: 'submitted', trading_name: 'Mbare Motors', address_line: null, location_city: 'Harare',
  location_province: null, contact_phone: null, contact_email: null, service_categories: [],
  applicant_relationship: 'owner', attestation_accepted_at: 'x', submitted_at: 'x', decided_at: null,
  decision_reason: null, decision_reason_code: null, supersedes_application_id: null, activated_tenant_id: null,
}

const show = async (application: Record<string, unknown>) => {
  fetchMyGarageApplication.mockResolvedValue({ application, blockers: [], editable: false })
  render(<MemoryRouter><GarageSetup /></MemoryRouter>)
  await screen.findByTestId('garage-c3-setup')
}

beforeEach(() => vi.clearAllMocks())

describe('after the decision', () => {
  it('an activated application offers the way into the garage', async () => {
    await show({ ...APP, status: 'approved', decided_at: 'x', activated_tenant_id: 'garage-123' })
    expect(screen.getByTestId('garage-workspace-ready')).toBeTruthy()
    expect(screen.getByTestId('open-garage-workspace')).toBeTruthy()
    expect(screen.queryByTestId('garage-workspace-pending')).toBeNull()
  })

  it('an approved application without a workspace says so, and offers no way into a garage that does not exist', async () => {
    await show({ ...APP, status: 'approved', decided_at: 'x' })
    expect(screen.getByTestId('garage-workspace-pending')).toHaveTextContent(/has not been created yet/)
    expect(screen.queryByTestId('open-garage-workspace')).toBeNull()
  })

  it('an application still in review shows neither', async () => {
    await show(APP)
    expect(screen.queryByTestId('garage-workspace-ready')).toBeNull()
    expect(screen.queryByTestId('garage-workspace-pending')).toBeNull()
  })
})
