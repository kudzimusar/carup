/**
 * GMO-3/4 (OC-5E) — the reviewer's workspace.
 *
 * The browser never decides what is possible: `allowed_decisions` and `blocking` come from the
 * server, so a reviewer cannot reach an action the server would refuse. Approving records a
 * judgment; the server builds the workspace and reports that outcome separately. Every
 * consequential action recovers from STEP_UP_REQUIRED through the ONE shared guard — including the
 * workspace retry, which #209 left unguarded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const fetchGarageApplicationsForReview = vi.fn()
const fetchGarageApplicationForReview = vi.fn()
const decideGarageApplication = vi.fn()
const previewGarageEvidenceForReview = vi.fn()
const activateGarageApplication = vi.fn()
const stepUpSession = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: () => undefined } }))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchGarageApplicationsForReview, fetchGarageApplicationForReview,
    decideGarageApplication, activateGarageApplication, previewGarageEvidenceForReview, stepUpSession,
  }),
}))

const { default: GarageApplications } = await import('./GarageApplications')

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

/** What the API client throws for a guarded route without a fresh step-up. */
const stepUpRefusal = () => Object.assign(new Error('Recent re-authentication is required for this action.'), { code: 'STEP_UP_REQUIRED' })

beforeEach(() => {
  vi.clearAllMocks()
  fetchGarageApplicationsForReview.mockResolvedValue({ applications: [APP] })
  fetchGarageApplicationForReview.mockResolvedValue(DETAIL)
  decideGarageApplication.mockResolvedValue({ application: { ...APP, status: 'under_review' } })
  stepUpSession.mockResolvedValue({ success: true })
})

const open = async () => {
  render(<GarageApplications />)
  fireEvent.click(await screen.findByTestId('queue-item'))
  await screen.findByTestId('application-detail')
}

const confirmPassword = async () => {
  await screen.findByTestId('step-up-dialog')
  fireEvent.change(screen.getByTestId('step-up-password'), { target: { value: 'correct horse' } })
  fireEvent.click(screen.getByTestId('step-up-confirm'))
}

describe('the queue', () => {
  it('lists what is waiting', async () => {
    render(<GarageApplications />)
    expect(await screen.findByTestId('review-queue')).toHaveTextContent('Mbare Motors')
  })

  it('a broken queue is a loading problem, not "nothing is waiting"', async () => {
    fetchGarageApplicationsForReview.mockRejectedValue(new Error('network'))
    render(<GarageApplications />)
    expect(await screen.findByTestId('queue-error')).toHaveTextContent(/does not mean there is nothing waiting/i)
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
    fetchGarageApplicationForReview.mockResolvedValue({ ...DETAIL, allowed_decisions: ['request_more_info', 'reject'] })
    await open()
    expect(screen.queryByTestId('decision-start_review')).toBeNull()
    expect(screen.queryByTestId('decision-approve')).toBeNull()
    expect(screen.getByTestId('decision-reject')).toBeTruthy()
  })

  it('a waiting application offers no decisions, and says who holds it', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL, application: { ...APP, status: 'information_required' }, allowed_decisions: [],
    })
    await open()
    expect(screen.queryByTestId('decision-panel')).toBeNull()
    expect(screen.getByTestId('no-decisions')).toHaveTextContent(/comes back to you when they send it again/i)
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

  it('an unreadable identity is shown as a system problem, never as a finding', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({ ...DETAIL, identity: null, identity_error: 'timeout' })
    await open()
    expect(screen.getByTestId('identity-unreadable')).toHaveTextContent(/not a finding against them/i)
  })
})

describe('a decision that closes or pauses must say why', () => {
  it('reject and ask-for-more stay disabled until a reason is written', async () => {
    await open()
    expect((screen.getByTestId('decision-reject') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('decision-request_more_info') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('decision-reason'), { target: { value: 'Signage photo is unreadable.' } })
    expect((screen.getByTestId('decision-reject') as HTMLButtonElement).disabled).toBe(false)
  })

  it('the reason travels with the decision', async () => {
    await open()
    fireEvent.change(screen.getByTestId('decision-reason'), { target: { value: 'Signage photo is unreadable.' } })
    fireEvent.click(screen.getByTestId('decision-request_more_info'))
    await waitFor(() => expect(decideGarageApplication).toHaveBeenCalledWith('app-1', { decision: 'request_more_info', reason: 'Signage photo is unreadable.' }))
  })
})

describe('step-up: the ONE shared recovery path', () => {
  it('a decision refused for a stale session asks for the password and retries the SAME decision', async () => {
    decideGarageApplication
      .mockRejectedValueOnce(stepUpRefusal())
      .mockResolvedValueOnce({ application: { ...APP, status: 'under_review' } })
    await open()
    fireEvent.click(screen.getByTestId('decision-start_review'))
    await confirmPassword()
    await waitFor(() => expect(decideGarageApplication).toHaveBeenCalledTimes(2))
    expect(stepUpSession).toHaveBeenCalledWith('correct horse')
    expect(decideGarageApplication.mock.calls[1]).toEqual(['app-1', { decision: 'start_review', reason: undefined }])
    expect(screen.queryByTestId('decision-error')).toBeNull()
  })

  it('opening a private document is guarded the same way', async () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    previewGarageEvidenceForReview
      .mockRejectedValueOnce(stepUpRefusal())
      .mockResolvedValueOnce({ url: 'https://signed.example.invalid/doc', expiresInSeconds: 180 })
    await open()
    fireEvent.click(screen.getByTestId('review-evidence-preview'))
    await confirmPassword()
    await waitFor(() => expect(opened).toHaveBeenCalledWith('https://signed.example.invalid/doc', '_blank', 'noopener,noreferrer'))
    opened.mockRestore()
  })

  it('the workspace retry is guarded too (#209 left it unguarded)', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL, application: { ...APP, status: 'approved', decided_at: 'x' }, allowed_decisions: [],
    })
    activateGarageApplication
      .mockRejectedValueOnce(stepUpRefusal())
      .mockResolvedValueOnce({ created: true, tenantId: 't-1' })
    await open()
    fireEvent.click(screen.getByTestId('retry-activation'))
    await confirmPassword()
    await waitFor(() => expect(activateGarageApplication).toHaveBeenCalledTimes(2))
  })

  it('any other refusal is shown where the reviewer can read it — not hidden in a toast', async () => {
    decideGarageApplication.mockRejectedValueOnce(Object.assign(new Error('This application changed while you were deciding. Open it again — your decision was not applied.'), { code: 'CONFLICT' }))
    await open()
    fireEvent.click(screen.getByTestId('decision-start_review'))
    expect(await screen.findByTestId('decision-error')).toHaveTextContent(/changed while you were deciding/)
    expect(screen.queryByTestId('step-up-dialog')).toBeNull()
  })
})

describe('GMO-4: what became of the workspace, said plainly', () => {
  it('an approval whose workspace was not built offers the retry and keeps the approval', async () => {
    decideGarageApplication.mockResolvedValue({
      application: { ...APP, status: 'approved' },
      activation: { activated: false, reason: 'This application has no garage name.', retryable: true },
    })
    fetchGarageApplicationForReview
      .mockResolvedValueOnce(DETAIL)
      .mockResolvedValue({ ...DETAIL, application: { ...APP, status: 'approved', decided_at: 'x' }, allowed_decisions: [] })
    await open()
    fireEvent.click(screen.getByTestId('decision-approve'))
    const pending = await screen.findByTestId('activation-pending')
    expect(pending).toHaveTextContent(/Your decision was recorded, but the workspace was not created/)
    expect(pending).toHaveTextContent(/no garage name/)
    expect(screen.getByTestId('retry-activation')).toBeTruthy()
  })

  it('an approved application opened later still offers the retry (it was session-only in #209)', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL, application: { ...APP, status: 'approved', decided_at: 'x' }, allowed_decisions: [],
    })
    await open()
    expect(screen.getByTestId('activation-pending')).toHaveTextContent(/has not been created/)
  })

  it('a built workspace is reported as built, with no retry', async () => {
    fetchGarageApplicationForReview.mockResolvedValue({
      ...DETAIL, application: { ...APP, status: 'approved', decided_at: 'x', activated_tenant_id: 't-1' }, allowed_decisions: [],
    })
    await open()
    expect(screen.getByTestId('workspace-activated')).toBeTruthy()
    expect(screen.queryByTestId('retry-activation')).toBeNull()
  })
})
