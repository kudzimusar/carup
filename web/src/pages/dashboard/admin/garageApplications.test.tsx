/**
 * GMO-3 — the reviewer's workspace.
 *
 * The browser never decides what is possible: `allowed_decisions` and `blocking` come from the
 * server, so a reviewer cannot reach an action the server would refuse. And nothing on this page
 * builds anything — approving records a judgment; GMO-4 creates the workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import GarageApplications from './GarageApplications'

const fetchGarageApplicationsForReview = vi.fn()
const fetchGarageApplicationForReview = vi.fn()
const decideGarageApplication = vi.fn()
const previewGarageEvidenceForReview = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchGarageApplicationsForReview, fetchGarageApplicationForReview,
    decideGarageApplication, previewGarageEvidenceForReview,
  }),
}))

const APP = {
  id: 'app-1', status: 'submitted', trading_name: 'Mbare Motors', address_line: '12 Chaminuka Rd',
  location_city: 'Harare', location_province: null, contact_phone: '+263771234567',
  contact_email: null, service_categories: ['brakes'], applicant_relationship: 'owner',
  attestation_accepted_at: 'x', submitted_at: '2026-09-06T10:00:00Z', decided_at: null,
  decision_reason: null, decision_reason_code: null, supersedes_application_id: null,
  activated_tenant_id: null,
}

const DETAIL = {
  application: APP,
  decisions: [],
  documents: [{ id: 'doc-1', evidence_type: 'signage_photo', removed_at: null, has_file: true }],
  identity: { identity_state: 'approved', usable_for_identity_gated_actions: true },
  identity_error: null,
  allowed_decisions: ['start_review', 'request_more_info', 'approve', 'reject'],
  blocking: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchGarageApplicationsForReview.mockResolvedValue({ applications: [APP] })
  fetchGarageApplicationForReview.mockResolvedValue(DETAIL)
  decideGarageApplication.mockResolvedValue({ application: { ...APP, status: 'approved' } })
})

const open = async () => {
  render(<GarageApplications />)
  fireEvent.click(await screen.findByTestId('queue-item'))
  await screen.findByTestId('application-detail')
}

describe('the queue', () => {
  it('lists what is waiting', async () => {
    render(<GarageApplications />)
    expect(await screen.findByTestId('review-queue')).toHaveTextContent('Mbare Motors')
  })

  it('a broken queue is a loading problem, not "nothing is waiting"', async () => {
    fetchGarageApplicationsForReview.mockRejectedValue(new Error('network'))
    render(<GarageApplications />)
    expect(await screen.findByTestId('queue-error'))
      .toHaveTextContent(/does not mean there is nothing waiting/i)
    expect(screen.queryByTestId('queue-empty')).toBeNull()
  })

  it('a genuinely empty queue says so plainly', async () => {
    fetchGarageApplicationsForReview.mockResolvedValue({ applications: [] })
    render(<GarageApplications />)
    expect(await screen.findByTestId('queue-empty')).toHaveTextContent(/Nothing is waiting/i)
  })
})

describe('the browser renders authority, it never computes it', () => {
  it('offers exactly the decisions the server allowed', async () => {
    await open()
    for (const d of ['start_review', 'request_more_info', 'approve', 'reject']) {
      expect(screen.getByTestId(`decision-${d}`)).toBeTruthy()
    }
  })

  it('offers no decisions when the server allows none', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL, application: { ...APP, status: 'information_required' }, allowed_decisions: [],
    })
    await open()
    expect(screen.queryByTestId('decision-panel')).toBeNull()
    expect(screen.getByTestId('no-decisions')).toHaveTextContent(/comes back to you when they send it again/i)
  })

  it('a closed application offers nothing further', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL, application: { ...APP, status: 'rejected', decided_at: 'x' }, allowed_decisions: [],
    })
    await open()
    expect(screen.getByTestId('no-decisions')).toHaveTextContent(/closed/i)
  })

  it('approve is unreachable while the server reports blockers', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL,
      identity: { identity_state: 'pending', usable_for_identity_gated_actions: false },
      blocking: ['The applicant\'s identity is not approved (pending).'],
    })
    await open()
    expect(screen.getByTestId('approval-blockers')).toHaveTextContent(/identity is not approved/i)
    expect((screen.getByTestId('decision-approve') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('a decision that closes or pauses must say why', () => {
  it('reject and ask-for-more stay disabled until a reason is written', async () => {
    await open()
    expect((screen.getByTestId('decision-reject') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('decision-request_more_info') as HTMLButtonElement).disabled).toBe(true)
    // Starting a review changes nothing for the applicant, so it needs no justification.
    expect((screen.getByTestId('decision-start_review') as HTMLButtonElement).disabled).toBe(false)

    fireEvent.change(screen.getByTestId('decision-reason'), { target: { value: 'Please add a photo.' } })
    expect((screen.getByTestId('decision-reject') as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends the reason with the decision', async () => {
    await open()
    fireEvent.change(screen.getByTestId('decision-reason'), { target: { value: 'Premises unconfirmed.' } })
    fireEvent.click(screen.getByTestId('decision-reject'))
    await waitFor(() => expect(decideGarageApplication).toHaveBeenCalledWith('app-1', {
      decision: 'reject', reason: 'Premises unconfirmed.',
    }))
  })

  it('a refused decision is reported, not swallowed', async () => {
    decideGarageApplication.mockRejectedValue(new Error('This application changed while you were deciding.'))
    await open()
    fireEvent.click(screen.getByTestId('decision-start_review'))
    expect(await screen.findByTestId('decision-error')).toHaveTextContent(/changed while you were deciding/i)
  })
})

describe('what the reviewer is told about the applicant', () => {
  it('an unreadable identity is a system problem, never a finding against them', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL, identity: null, identity_error: 'identity service unreachable',
      blocking: ['The applicant\'s identity status could not be read just now. This is a system problem, not a finding against them — try again before deciding.'],
    })
    await open()
    const panel = screen.getByTestId('identity-unreadable')
    expect(panel).toHaveTextContent(/system problem, not a finding against them/i)
    expect(panel.textContent).not.toMatch(/not approved|rejected|failed/i)
  })

  it('an approved identity says so', async () => {
    await open()
    expect(screen.getByTestId('identity-state')).toHaveTextContent(/Approved and usable/i)
  })

  it('withdrawn evidence is still shown, marked as withdrawn', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL,
      documents: [{ id: 'doc-1', evidence_type: 'utility_bill', removed_at: '2026-09-06T11:00:00Z', has_file: true }],
    })
    await open()
    // A reviewer must not find a gap where their reasoning used to be.
    expect(screen.getByTestId('review-evidence-item')).toHaveTextContent(/withdrawn by the applicant/i)
  })

  it('a field with no value reads as "Not recorded", never as an empty cell', async () => {
    await open()
    expect(screen.getByTestId('application-detail')).toHaveTextContent('Not recorded')
  })
})

describe('approving is not verifying, and does not build', () => {
  it('says plainly that approval neither verifies nor creates the workspace', async () => {
    await open()
    const panel = screen.getByTestId('decision-panel')
    expect(panel).toHaveTextContent(/does not verify the business/i)
    expect(panel).toHaveTextContent(/workspace is\s+created separately/i)
  })

  it('the page offers no control that creates a tenant, membership or role', async () => {
    await open()
    const text = document.body.textContent ?? ''
    for (const forbidden of [/create tenant/i, /add member/i, /grant role/i, /assign admin/i]) {
      expect(text, `the reviewer must not be offered: ${forbidden}`).not.toMatch(forbidden)
    }
  })
})
