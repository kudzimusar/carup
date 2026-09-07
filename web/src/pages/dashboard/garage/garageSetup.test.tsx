/**
 * GMO-1 — the applicant surface.
 *
 * The seven onboarding states must never collapse into each other. A person waiting on their
 * livelihood deserves to know which one they are in, and the two most dangerous confusions are
 * "a failed read" shown as "no application", and "not approved" shown for something merely pending.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GarageSetup from './GarageSetup'
import { setupSteps, statusPresentation } from '@/lib/garageOnboarding'

const fetchMyGarageApplication = vi.fn()
const startGarageApplication = vi.fn()
const saveGarageApplication = vi.fn()
const submitGarageApplication = vi.fn()
// GMO-2: the page now composes the evidence section, which loads on mount.
const listGarageEvidence = vi.fn()
// GMO-5: the activated panel renders the real context switcher, which loads memberships.
const fetchMyMemberships = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMyGarageApplication, startGarageApplication, saveGarageApplication, submitGarageApplication,
    listGarageEvidence, fetchMyMemberships,
    uploadGarageEvidence: vi.fn(), removeGarageEvidence: vi.fn(), previewGarageEvidence: vi.fn(),
    extractGarageEvidence: vi.fn(), acknowledgeGarageEvidence: vi.fn(),
  }),
}))

const COMPLETE = {
  id: 'app-1', status: 'draft', trading_name: 'Mbare Motors', address_line: '12 Chaminuka Rd',
  location_city: 'Harare', location_province: null, contact_phone: '+263771234567',
  contact_email: null, service_categories: ['brakes'], applicant_relationship: 'owner',
  attestation_accepted_at: '2026-09-06T09:00:00Z', submitted_at: null, decided_at: null,
  decision_reason: null, decision_reason_code: null, supersedes_application_id: null,
  activated_tenant_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  saveGarageApplication.mockResolvedValue({ application: COMPLETE, blockers: [] })
  submitGarageApplication.mockResolvedValue({ application: { ...COMPLETE, status: 'submitted' } })
  listGarageEvidence.mockResolvedValue({ documents: [] })
  fetchMyMemberships.mockResolvedValue({ garages: [{ tenantId: 't-1', tenantName: 'Mbare Motors', tenantType: 'garage', tenantStatus: 'active', role: 'admin', canOperate: true }] })
})

const view = () => render(<MemoryRouter><GarageSetup /></MemoryRouter>)

describe('the applicant can start, resume and send', () => {
  it('offers a clear start when there is no application yet', async () => {
    fetchMyGarageApplication.mockResolvedValue({ application: null, blockers: null, editable: false })
    startGarageApplication.mockResolvedValue({ application: { ...COMPLETE, trading_name: null }, blockers: ['a garage name'], created: true })
    view()
    expect(await screen.findByTestId('setup-start')).toHaveTextContent(/Finish setting up your garage/i)
    fireEvent.click(screen.getByTestId('start-application'))
    await waitFor(() => expect(startGarageApplication).toHaveBeenCalled())
  })

  it('resumes an existing application with its values filled in', async () => {
    fetchMyGarageApplication.mockResolvedValue({ application: COMPLETE, blockers: [], editable: true })
    view()
    await screen.findByTestId('application-form')
    expect((screen.getByTestId('field-trading-name') as HTMLInputElement).value).toBe('Mbare Motors')
    expect((screen.getByTestId('field-city') as HTMLInputElement).value).toBe('Harare')
  })

  it('names what is missing BEFORE the send button can be used', async () => {
    fetchMyGarageApplication.mockResolvedValue({
      application: { ...COMPLETE, trading_name: null }, blockers: ['a garage name'], editable: true,
    })
    view()
    expect(await screen.findByTestId('submission-blockers')).toHaveTextContent('a garage name')
    expect((screen.getByTestId('submit-application') as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends a complete application, flushing pending edits first', async () => {
    fetchMyGarageApplication.mockResolvedValue({ application: COMPLETE, blockers: [], editable: true })
    view()
    fireEvent.click(await screen.findByTestId('submit-application'))
    // The save must land before the submit, or the server validates a stale row.
    await waitFor(() => expect(submitGarageApplication).toHaveBeenCalledWith('app-1'))
    expect(saveGarageApplication).toHaveBeenCalled()
  })

  it('says plainly that sending is not activation', async () => {
    fetchMyGarageApplication.mockResolvedValue({ application: COMPLETE, blockers: [], editable: true })
    const { container } = view()
    await screen.findByTestId('application-form')
    expect(container.textContent).toMatch(/does not make you a CarUp garage on its own/i)
  })
})

describe('the states never collapse into each other', () => {
  it('a failed read is a loading problem, NOT "you have no application"', async () => {
    fetchMyGarageApplication.mockRejectedValue(new Error('network'))
    view()
    expect(await screen.findByTestId('setup-error')).toHaveTextContent(/not a decision about your application/i)
    expect(screen.queryByTestId('setup-start')).toBeNull()
  })

  it('"not a garage applicant" is its own state, not an error and not an empty form', async () => {
    fetchMyGarageApplication.mockRejectedValue(new Error('GARAGE_ONBOARDING_CONTEXT_REQUIRED: ...'))
    view()
    expect(await screen.findByTestId('not-a-garage-applicant')).toBeTruthy()
    expect(screen.queryByTestId('setup-error')).toBeNull()
    expect(screen.queryByTestId('application-form')).toBeNull()
  })

  it('a submitted application is read-only and says what happens next', async () => {
    fetchMyGarageApplication.mockResolvedValue({
      application: { ...COMPLETE, status: 'submitted', submitted_at: '2026-09-06T10:00:00Z' },
      blockers: [], editable: false,
    })
    view()
    expect(await screen.findByTestId('application-status')).toHaveTextContent(/Sent — waiting for CarUp/i)
    expect(screen.getByTestId('application-next')).toHaveTextContent(/may ask for more/i)
    expect(screen.queryByTestId('application-form'), 'a sent application is not editable').toBeNull()
  })

  it('information_required keeps the SAME application editable — not a new one', async () => {
    fetchMyGarageApplication.mockResolvedValue({
      application: { ...COMPLETE, status: 'information_required', submitted_at: '2026-09-06T10:00:00Z' },
      blockers: [], editable: true,
    })
    view()
    expect(await screen.findByTestId('application-next')).toHaveTextContent(/same application, not a new one/i)
    expect(screen.getByTestId('application-form')).toBeTruthy()
    expect(screen.queryByTestId('reapply'), 'this is not a reapplication').toBeNull()
  })

  it('rejected is terminal, shows its reason, and offers a NEW application', async () => {
    fetchMyGarageApplication.mockResolvedValue({
      application: {
        ...COMPLETE, status: 'rejected', decided_at: '2026-09-06T12:00:00Z',
        decision_reason: 'We could not confirm the premises from the evidence supplied.',
      },
      blockers: [], editable: false,
    })
    startGarageApplication.mockResolvedValue({ application: { ...COMPLETE, id: 'app-2' }, created: true })
    view()
    expect(await screen.findByTestId('rejection-reason')).toHaveTextContent(/could not confirm the premises/i)
    expect(screen.getByTestId('rejected-panel')).toHaveTextContent(/record of this application stays as it is/i)
    fireEvent.click(screen.getByTestId('reapply'))
    await waitFor(() => expect(startGarageApplication).toHaveBeenCalledWith({ supersedes: 'app-1' }))
  })

  it('an activated application offers a way in that ESTABLISHES the garage context', async () => {
    fetchMyGarageApplication.mockResolvedValue({
      application: { ...COMPLETE, status: 'approved', decided_at: 'x', activated_tenant_id: 't-1' },
      blockers: [], editable: false,
    })
    view()
    expect(await screen.findByTestId('activated-panel')).toBeTruthy()
    // GMO-5 corrected this. It used to assert a plain <a href="/garage">, which is exactly the
    // behaviour that 403s: the founder's active membership was only resolved at login, so someone
    // approved while signed in landed on the garage with no tenant context. The panel now renders
    // the context switcher, which switches first and navigates second.
    // The switcher loads its memberships, so wait for the real thing rather than its spinner —
    // asserting at scroll-top on an async surface is how a check ends up seeing a loading state and
    // calling it a result.
    expect(await screen.findByTestId('garage-context-switcher')).toBeTruthy()
    expect(screen.queryByTestId('open-workshop'), 'a bare link would land on a 403').toBeNull()
  })
})

describe('the checklist reports what is known, never a guess', () => {
  it('does not tick a step that has not happened', () => {
    const steps = setupSteps({ ...COMPLETE, submitted_at: null } as never, ['a garage name'])
    expect(steps.find((s) => s.label === 'Your details')?.state).toBe('pending')
    expect(steps.find((s) => s.label === 'Sent to CarUp')?.state).toBe('pending')
    expect(steps.find((s) => s.label === 'Garage access')?.state).toBe('pending')
  })

  it('marks review as waiting once sent, and blocked only when rejected', () => {
    const sent = setupSteps({ ...COMPLETE, submitted_at: 'x' } as never, [])
    expect(sent.find((s) => s.label === 'Review')?.state).toBe('waiting')

    const rejected = setupSteps({ ...COMPLETE, submitted_at: 'x', decided_at: 'y', status: 'rejected' } as never, [])
    expect(rejected.find((s) => s.label === 'Garage access')?.state).toBe('blocked')
  })

  it('an unknown status reads as unknown, never as a decision', () => {
    const p = statusPresentation('something_new')
    expect(p.label).toMatch(/not recorded/i)
    expect(p.next).toMatch(/not a decision/i)
    expect(p.editable).toBe(false)
  })
})

describe('autosave keeps every edit, not just the last one', () => {
  // Real timers against the real 900ms debounce. Fake timers stalled the component's initial load,
  // so `application` was still null and autosave short-circuited — the test would have been
  // measuring a component that had not finished mounting.
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('a burst of edits saves ALL of them', async () => {
    fetchMyGarageApplication.mockResolvedValue({ application: COMPLETE, blockers: [], editable: true })
    view()
    await screen.findByTestId('application-form')

    // Faster than the debounce — exactly the case that used to lose everything but the last field.
    // Values that DIFFER from the loaded application. Setting a field to the value it already holds
    // fires no onChange, so the first version of this test was driving a form it never changed.
    fireEvent.change(screen.getByTestId('field-trading-name'), { target: { value: 'Highfield Auto' } })
    fireEvent.change(screen.getByTestId('field-city'), { target: { value: 'Bulawayo' } })
    fireEvent.change(screen.getByTestId('field-address'), { target: { value: '9 Leopold Takawira' } })
    await settle(1400)

    await waitFor(() => expect(saveGarageApplication).toHaveBeenCalled())
    const patches = saveGarageApplication.mock.calls.map((c) => c[1])
    const merged = Object.assign({}, ...patches)
    // Before the fix this was { address_line } alone: the timer AND the patch were replaced.
    expect(merged).toMatchObject({
      trading_name: 'Highfield Auto',
      location_city: 'Bulawayo',
      address_line: '9 Leopold Takawira',
    })
  }, 20000)

  it('a failed save keeps the edits pending rather than dropping them', async () => {
    fetchMyGarageApplication.mockResolvedValue({ application: COMPLETE, blockers: [], editable: true })
    saveGarageApplication.mockRejectedValueOnce(new Error('network'))
    view()
    await screen.findByTestId('application-form')

    fireEvent.change(screen.getByTestId('field-city'), { target: { value: 'Mutare' } })
    await settle(1400)
    await waitFor(() => expect(saveGarageApplication).toHaveBeenCalledTimes(1))

    // The next edit carries the failed one with it — one bad request must not lose an edit.
    fireEvent.change(screen.getByTestId('field-phone'), { target: { value: '+263779999999' } })
    await settle(1400)
    await waitFor(() => expect(saveGarageApplication).toHaveBeenCalledTimes(2))
    expect(saveGarageApplication.mock.calls[1][1]).toMatchObject({
      location_city: 'Mutare',
      contact_phone: '+263779999999',
    })
  }, 20000)
})
