/**
 * CARUP-MVP-STAB-01 SVC-004 — the reviewer sees who applied, the history, and who must act.
 *
 * The server sends `applicant` (from the applicant's account), the decision history (roles, never
 * reviewer ids) and `who_must_act`; the page renders them as told. A detail from a server that does
 * not send them yet still renders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const fetchGarageApplicationsForReview = vi.fn()
const fetchGarageApplicationForReview = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchGarageApplicationsForReview, fetchGarageApplicationForReview,
    decideGarageApplication: vi.fn(), activateGarageApplication: vi.fn(), previewGarageEvidenceForReview: vi.fn(), stepUpSession: vi.fn(),
  }),
}))

const { default: GarageApplications } = await import('./GarageApplications')

const APP = {
  id: 'app-1', status: 'information_required', trading_name: 'Kambuzuma Brake Centre', address_line: null,
  location_city: 'Harare', location_province: null, contact_phone: null, contact_email: null, service_categories: ['brakes'],
  applicant_relationship: 'owner', attestation_accepted_at: 'x', submitted_at: '2026-10-19T10:00:00Z', decided_at: null,
  decision_reason: null, decision_reason_code: null, supersedes_application_id: null, activated_tenant_id: null,
}
const DETAIL = {
  application: APP,
  applicant: { user_id: 'user-77', name: 'Rudo Moyo', email: 'rudo@example.invalid' },
  decisions: [
    { id: 'd2', decision: 'request_more_info', reason_code: 'signage_unreadable', reason: 'A clearer photo of the sign, please.', actor_role: 'admin', created_at: '2026-10-20T09:00:00Z' },
    { id: 'd1', decision: 'start_review', reason_code: null, reason: null, actor_role: 'admin', created_at: '2026-10-20T08:00:00Z' },
  ],
  who_must_act: 'applicant',
  documents: [],
  identity: { identity_state: 'verified', usable_for_identity_gated_actions: true },
  identity_error: null,
  allowed_decisions: [],
  blocking: [],
}

const open = async () => {
  render(<GarageApplications />)
  fireEvent.click(await screen.findByTestId('queue-item'))
  await screen.findByTestId('application-detail')
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchGarageApplicationsForReview.mockResolvedValue({ applications: [APP] })
})

describe('the reviewer detail', () => {
  it('names the applicant from their account', async () => {
    fetchGarageApplicationForReview.mockResolvedValue(DETAIL)
    await open()
    const summary = screen.getByTestId('applicant-summary')
    expect(summary).toHaveTextContent('Rudo Moyo')
    expect(summary).toHaveTextContent('rudo@example.invalid')
    expect(summary).toHaveTextContent('user-77')
  })

  it('says who must act next', async () => {
    fetchGarageApplicationForReview.mockResolvedValue(DETAIL)
    await open()
    expect(screen.getByTestId('who-must-act')).toHaveTextContent('Waiting on the applicant')
  })

  it('shows every decision with its reason, reason code and role', async () => {
    fetchGarageApplicationForReview.mockResolvedValue(DETAIL)
    await open()
    const items = screen.getAllByTestId('history-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Ask for more')
    expect(items[0]).toHaveTextContent('A clearer photo of the sign, please.')
    expect(items[0]).toHaveTextContent('signage_unreadable')
    expect(items[0]).toHaveTextContent(/admin/)
    expect(items[1]).toHaveTextContent('Start reviewing')
  })

  it('a detail without the new fields still renders, claiming nothing', async () => {
    const older: Record<string, unknown> = { ...DETAIL }
    delete older.applicant
    delete older.who_must_act
    fetchGarageApplicationForReview.mockResolvedValue({ ...older, decisions: [] })
    await open()
    expect(screen.queryByTestId('applicant-summary')).toBeNull()
    expect(screen.queryByTestId('who-must-act')).toBeNull()
  })
})
