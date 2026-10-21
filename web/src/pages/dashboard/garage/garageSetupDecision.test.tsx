/**
 * CARUP-MVP-STAB-01 F-019 — what the applicant reads once CarUp has acted.
 *
 *   information_required → "CarUp needs something more: <reason>", and the form stays editable;
 *   rejected             → "Your application was not approved: <reason>" + "Start a new application",
 *                          which creates a NEW application linked to the rejected one (supersedes);
 *   submitted / review   → "Pending review" — and, when identity stands in the way, "Before CarUp can
 *                          approve your garage, your identity must be verified." with the way to do it;
 *   identity unreadable  → said as a system problem, never as "not verified";
 *   not a garage         → the truthful mechanic answer, no false promise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchMyGarageApplication = vi.fn()
const startGarageApplication = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMyGarageApplication, startGarageApplication, saveGarageApplication: vi.fn(), submitGarageApplication: vi.fn(),
  }),
}))
vi.mock('./GarageEvidence', () => ({ default: () => <div data-testid="garage-evidence-stub" /> }))

const { default: GarageSetup } = await import('./GarageSetup')

const APP = {
  id: 'app-x', status: 'submitted', trading_name: 'Kambuzuma Brake Centre', address_line: '14 Kambuzuma Road',
  location_city: 'Harare', location_province: null, contact_phone: '+263771234999', contact_email: null,
  service_categories: ['brakes'], applicant_relationship: 'owner', attestation_accepted_at: 'x', submitted_at: 'x',
  decided_at: null, decision_reason: null, decision_reason_code: null, supersedes_application_id: null, activated_tenant_id: null,
}
const READY = { identity_ready: true, identity_next_step: null }

async function show(envelope: Record<string, unknown>) {
  fetchMyGarageApplication.mockResolvedValue({ blockers: [], editable: false, latest_decision: null, approval_prerequisites: READY, ...envelope })
  render(<MemoryRouter><GarageSetup /></MemoryRouter>)
  await screen.findByTestId('garage-c3-setup')
}

beforeEach(() => vi.clearAllMocks())

describe('information required', () => {
  it('names what CarUp asked for, and the applicant can change and resend the same application', async () => {
    await show({
      application: { ...APP, status: 'information_required' }, editable: true,
      latest_decision: { decision: 'request_more_info', reason_code: null, reason: 'Please add a clearer photo of your sign.', decided_at: '2026-10-20T09:00:00Z' },
    })
    expect(screen.getByTestId('garage-information-required')).toHaveTextContent('CarUp needs something more: Please add a clearer photo of your sign.')
    expect(screen.getByTestId('garage-field-trading_name')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send it back to CarUp' })).toBeTruthy()
  })
})

describe('rejected', () => {
  it('says why it was not approved, and "Start a new application" creates one linked to it', async () => {
    await show({
      application: { ...APP, status: 'rejected', decided_at: '2026-10-20T09:00:00Z', decision_reason: 'The premises are a different business.' },
      latest_decision: { decision: 'reject', reason_code: null, reason: 'The premises are a different business.', decided_at: '2026-10-20T09:00:00Z' },
      approval_prerequisites: null,
    })
    expect(screen.getByTestId('garage-rejected')).toHaveTextContent('Your application was not approved: The premises are a different business.')
    const draft = { ...APP, id: 'app-new', status: 'draft', submitted_at: null, supersedes_application_id: 'app-x' }
    startGarageApplication.mockResolvedValue({ application: draft, created: true, blockers: [] })
    fetchMyGarageApplication.mockResolvedValue({ application: draft, blockers: [], editable: true, latest_decision: null, approval_prerequisites: READY })
    fireEvent.click(screen.getByTestId('garage-reapply'))
    await waitFor(() => expect(startGarageApplication).toHaveBeenCalledWith({ supersedes: 'app-x' }))
    await waitFor(() => expect(screen.queryByTestId('garage-rejected')).toBeNull())
    expect(screen.getByTestId('garage-field-trading_name')).not.toBeDisabled()
  })
})

describe('pending review and the identity prerequisite', () => {
  it('pending, identity not verified: the notice and the way to verify', async () => {
    await show({ application: APP, approval_prerequisites: { identity_ready: false, identity_next_step: 'verify_identity' } })
    expect(screen.getByTestId('garage-pending-review')).toHaveTextContent('Pending review')
    const notice = screen.getByTestId('garage-identity-notice')
    expect(notice).toHaveTextContent('Before CarUp can approve your garage, your identity must be verified.')
    expect(screen.getByRole('link', { name: 'Verify your identity' }).getAttribute('href')).toBe('/onboarding')
  })

  it('under review with the identity documents still with CarUp: says so, still links the identity status', async () => {
    await show({ application: { ...APP, status: 'under_review' }, approval_prerequisites: { identity_ready: false, identity_next_step: 'identity_review_pending' } })
    expect(screen.getByTestId('garage-pending-review')).toHaveTextContent('Pending review')
    expect(screen.getByTestId('garage-identity-notice')).toHaveTextContent(/with CarUp for review/)
    expect(screen.getByRole('link', { name: 'See your identity status' }).getAttribute('href')).toBe('/onboarding')
  })

  it('identity verified: pending review, and no identity notice', async () => {
    await show({ application: APP })
    expect(screen.getByTestId('garage-pending-review')).toBeTruthy()
    expect(screen.queryByTestId('garage-identity-notice')).toBeNull()
  })

  it('identity could not be checked: a system problem, never "not verified"', async () => {
    await show({ application: APP, approval_prerequisites: { identity_ready: null, identity_next_step: 'try_again_later' } })
    const notice = screen.getByTestId('garage-identity-notice')
    expect(notice).toHaveTextContent(/could not check your identity status just now/i)
    expect(notice.textContent).not.toMatch(/must be verified/)
  })
})

describe('not a garage applicant', () => {
  it('the mechanic answer is true: no independent mechanic activation; a garage invites its mechanics', async () => {
    fetchMyGarageApplication.mockRejectedValue(new Error('GARAGE_ONBOARDING_CONTEXT_REQUIRED: garage setup is available once your registration records a garage business.'))
    render(<MemoryRouter><GarageSetup /></MemoryRouter>)
    expect(await screen.findByTestId('garage-setup-not-applicant')).toHaveTextContent(
      "CarUp doesn't activate independent mechanic accounts yet. If you work at a garage, ask its administrator to invite you to the garage's workspace.",
    )
  })
})
