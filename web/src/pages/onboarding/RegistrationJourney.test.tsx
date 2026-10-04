/**
 * O2-X2 — Registration journey page (ported by OC-5C from PR #208).
 *
 * Pinned rules: the page renders SERVER truth (ladder, who-must-act, locked reasons) and
 * decides nothing; OCR output is candidates only — a missing/marker field says "Not read
 * from document" and never shows a placeholder as data; using a candidate records exactly
 * what was SHOWN so the server can derive confirmed-vs-corrected; an OCR problem leaves
 * manual profile completion open; identity approval renders alongside still-locked
 * seller/dealer capabilities.
 *
 * OC-5C: the current standing renders from the server's subject-safe codes (never an internal state);
 * a registered account type / business type is shown read-only; documents are images only.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RegistrationJourney from './RegistrationJourney'

const fetchRegistrationJourney = vi.fn()
const fetchRegistrationCandidates = vi.fn()
const saveRegistrationProfile = vi.fn()
const createIdentitySession = vi.fn()
const uploadIdentitySide = vi.fn()
const submitIdentitySession = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchRegistrationJourney,
    fetchRegistrationCandidates,
    saveRegistrationProfile,
    createIdentitySession,
    uploadIdentitySide,
    submitIdentitySession,
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-a', name: 'Tinashe Moyo', role: 'owner' } }),
}))

const LADDER = [
  { stage: 'basic_account', reached: true, unlocks: ['browse_marketplace', 'save_vehicles'] },
  { stage: 'contact_context_established', reached: false, unlocks: ['continue_draft_workflows'] },
  { stage: 'identity_pending', reached: false, unlocks: ['continue_safe_preparation_work'] },
  { stage: 'identity_approved', reached: false, unlocks: ['consume_identity_assurance'] },
]

const LOCKED = [
  { capability: 'sell_vehicle_publicly', locked_by: 'seller_authority', reason: 'Seller Authority is decided per vehicle by its own governed review — identity verification never grants it.' },
  { capability: 'dealer_tools', locked_by: 'dealer_compliance', reason: 'Dealer Compliance is its own governed decision — identity verification never grants it.' },
]

function journeyFixture(overrides: Record<string, unknown> = {}) {
  const base = {
    user: { id: 'user-a', name: 'Tinashe Moyo', email: 'a@x.test', phone: null, email_verified: true },
    profile: null as unknown,
    identity_session: null as unknown,
    journey: {
      steps: {
        account_created: true,
        context_established: false,
        identity: {
          state: 'not_started', session_id: null as string | null,
          uploaded_sides: { front: false, back: false, selfie: false },
          double_sided: null as boolean | null, document_type: null, who_must_act: 'subject_action',
          guidance: 'Upload an identity document and selfie to start verification when you are ready.',
          lifecycle: null as unknown,
        },
      },
      who_must_act: 'subject_action',
      required_action: 'Upload an identity document and selfie to start verification when you are ready.',
      capability_ladder: LADDER,
      locked_capabilities: LOCKED,
    },
  }
  return { ...base, ...overrides } as typeof base
}

function withIdentity(identity: Record<string, unknown>, rest: Record<string, unknown> = {}) {
  const base = journeyFixture()
  return journeyFixture({
    ...rest,
    journey: {
      ...base.journey,
      ...((rest.journey as Record<string, unknown>) || {}),
      steps: { ...base.journey.steps, ...((rest.steps as Record<string, unknown>) || {}), identity: { ...base.journey.steps.identity, ...identity } },
    },
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <RegistrationJourney />
    </MemoryRouter>
  )
}

describe('RegistrationJourney', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchRegistrationJourney.mockResolvedValue(journeyFixture())
    fetchRegistrationCandidates.mockResolvedValue({ candidates: { available: false, document_fields: {}, profile_candidates: {} } })
    saveRegistrationProfile.mockResolvedValue({ success: true, field_provenance: {}, audit_recorded: true })
  })

  it('renders server truth: ladder, who-must-act, locked reasons, and the context form for a fresh account', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('who-must-act')).toBeTruthy())
    expect(screen.getByTestId('who-must-act').textContent).toMatch(/Your action needed/)
    expect(screen.getByTestId('stage-basic_account').textContent).toMatch(/Account created/)
    expect(screen.getByTestId('locked-sell_vehicle_publicly').textContent).toMatch(/identity verification never grants it/)
    expect(screen.getByTestId('locked-dealer_tools').textContent).toMatch(/its own governed decision/)
    expect(screen.getByTestId('context-form')).toBeTruthy()
    expect(screen.getByTestId('account-kind')).toBeTruthy()
    expect(screen.getByTestId('start-identity')).toBeTruthy()
  })

  it('renders extracted candidates as candidates — a missing field says so and no placeholder appears as data', async () => {
    fetchRegistrationJourney.mockResolvedValue(withIdentity(
      { state: 'in_review', session_id: 'vs-1', who_must_act: 'carup_review', guidance: 'A CarUp reviewer will check your documents. No action is needed from you right now.' },
      { identity_session: { id: 'vs-1', status: 'pending_manual_review' }, journey: { who_must_act: 'carup_review' } },
    ))
    fetchRegistrationCandidates.mockResolvedValue({
      candidates: {
        available: true,
        source: { document_type: 'national_id', confidence_score: 0.9 },
        document_fields: {
          first_name: { state: 'machine_candidate', value: 'Tinashe' },
          national_id_number: { state: 'missing' },
          date_of_birth: { state: 'missing' },
        },
        profile_candidates: { country_of_residence: { state: 'machine_candidate', value: 'Zimbabwe', extracted_from: 'country' } },
      },
    })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('candidates')).toBeTruthy())
    expect(screen.getByTestId('candidate-first_name').textContent).toBe('Tinashe')
    expect(screen.getByTestId('candidate-national_id_number').textContent).toMatch(/Not read from document/)
    expect(screen.getByTestId('candidate-date_of_birth').textContent).toMatch(/Not read from document/)
    expect(screen.queryByText('N/A')).toBeNull()
    expect(screen.getByTestId('candidates').textContent).toMatch(/candidates only/)
  })

  it('OC-5C: a reading the server will not propose shows its reason — and no "use this" suggestion', async () => {
    fetchRegistrationJourney.mockResolvedValue(withIdentity(
      { state: 'in_review', session_id: 'vs-1', who_must_act: 'carup_review' },
      { identity_session: { id: 'vs-1', status: 'pending_manual_review' } },
    ))
    fetchRegistrationCandidates.mockResolvedValue({
      candidates: { available: false, reason: 'Your document could not be read reliably, so nothing is suggested — enter your details yourself.', document_fields: {}, profile_candidates: {} },
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('candidates-unavailable')).toBeTruthy())
    expect(screen.getByTestId('candidates-unavailable').textContent).toMatch(/enter your details yourself/)
    expect(screen.queryByTestId('use-country-candidate')).toBeNull()
    expect(screen.queryByTestId('candidates')).toBeNull()
  })

  it('using a candidate records exactly what was shown; the save carries candidates_seen for server-side provenance', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({ identity_session: { id: 'vs-1', status: 'pending_manual_review' } }))
    fetchRegistrationCandidates.mockResolvedValue({
      candidates: {
        available: true,
        document_fields: {},
        profile_candidates: { country_of_residence: { state: 'machine_candidate', value: 'Zimbabwe', extracted_from: 'country' } },
      },
    })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('use-country-candidate')).toBeTruthy())
    fireEvent.click(screen.getByTestId('use-country-candidate'))
    fireEvent.change(screen.getByTestId('city-input'), { target: { value: 'Harare' } })
    const checkboxes = screen.getByTestId('context-form').querySelectorAll('input[type="checkbox"]')
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByTestId('save-profile'))

    await waitFor(() => expect(saveRegistrationProfile).toHaveBeenCalledTimes(1))
    const payload = saveRegistrationProfile.mock.calls[0][0]
    expect(payload.profile.country_of_residence).toBe('Zimbabwe')
    expect(payload.candidates_seen).toEqual({ country_of_residence: 'Zimbabwe' })
  })

  it('a corrected value still reports what was SHOWN — the server, not the client, judges confirmed vs corrected', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({ identity_session: { id: 'vs-1', status: 'pending_manual_review' } }))
    fetchRegistrationCandidates.mockResolvedValue({
      candidates: {
        available: true,
        document_fields: {},
        profile_candidates: { country_of_residence: { state: 'machine_candidate', value: 'Zimbabwe', extracted_from: 'country' } },
      },
    })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('use-country-candidate')).toBeTruthy())
    fireEvent.click(screen.getByTestId('use-country-candidate'))
    fireEvent.change(screen.getByTestId('country-input'), { target: { value: 'United Kingdom' } }) // correct the candidate
    fireEvent.change(screen.getByTestId('city-input'), { target: { value: 'Leeds' } })
    const checkboxes = screen.getByTestId('context-form').querySelectorAll('input[type="checkbox"]')
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByTestId('save-profile'))

    await waitFor(() => expect(saveRegistrationProfile).toHaveBeenCalledTimes(1))
    const payload = saveRegistrationProfile.mock.calls[0][0]
    expect(payload.profile.country_of_residence).toBe('United Kingdom')
    expect(payload.candidates_seen).toEqual({ country_of_residence: 'Zimbabwe' })
  })

  it('an OCR problem never blocks manual completion — the context form and save stay available', async () => {
    fetchRegistrationJourney.mockResolvedValue(withIdentity(
      { state: 'in_review', session_id: 'vs-1', who_must_act: 'carup_review', guidance: 'A CarUp reviewer will check your documents. No action is needed from you right now.' },
      { identity_session: { id: 'vs-1', status: 'ocr_failed' } },
    ))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('identity-state').textContent).toMatch(/In human review/))
    expect(screen.getByTestId('context-form')).toBeTruthy()
    expect(screen.getByTestId('save-profile')).toBeTruthy()
  })

  it('identity approval renders as verified while seller/dealer capabilities stay visibly locked by their own authorities', async () => {
    fetchRegistrationJourney.mockResolvedValue(withIdentity(
      { state: 'approved', session_id: 'vs-2', who_must_act: 'none', guidance: 'Your identity is verified.' },
      {
        profile: { account_kind: 'individual', market_relationship: 'diaspora', country_of_residence: 'Zimbabwe', city: 'Leeds', intended_use: 'buy_sell' },
        identity_session: { id: 'vs-2', status: 'verified' },
        steps: { context_established: true },
        journey: { who_must_act: 'none', required_action: 'Your identity is verified.', capability_ladder: LADDER.map((s) => ({ ...s, reached: true })) },
      },
    ))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('identity-state').textContent).toBe('Verified'))
    expect(screen.getByText(/still have their own separate steps/)).toBeTruthy()
    expect(screen.getByTestId('locked-sell_vehicle_publicly')).toBeTruthy()
    expect(screen.getByTestId('locked-dealer_tools')).toBeTruthy()
    // Resume: the saved profile renders as a summary — no forced re-entry.
    expect(screen.getByTestId('context-summary').textContent).toMatch(/Zimbabwe/)
  })

  it('OC-5C: a held identity renders the subject-safe standing and pauses — "Security review", never "compromised"', async () => {
    fetchRegistrationJourney.mockResolvedValue(withIdentity(
      {
        state: 'security_review', session_id: 'vs-2', who_must_act: 'carup_review',
        guidance: 'For your security, CarUp is reviewing this account. Contact support if you need help.',
        lifecycle: { status: 'security_review', status_label: 'under security review', applicant_guidance: 'For your security, CarUp is reviewing this account. Contact support if you need help.', who_must_act: 'carup_review', capability_bearing: false },
      },
      { identity_session: { id: 'vs-2', status: 'verified' }, journey: { who_must_act: 'carup_review' } },
    ))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('identity-state').textContent).toBe('Security review'))
    expect(screen.getByTestId('lifecycle-hold').textContent).toMatch(/identity-dependent features are paused/)
    expect(screen.getByTestId('identity-guidance').textContent).toMatch(/For your security/)
    expect(document.body.textContent).not.toMatch(/compromised/i)
    expect(screen.queryByTestId('start-identity')).toBeNull()

    for (const [state, label] of [['on_hold', 'On hold'], ['disputed', 'Under review'], ['revoked', 'No longer verified']]) {
      fetchRegistrationJourney.mockResolvedValue(withIdentity({ state, session_id: 'vs-2', who_must_act: 'carup_review' }))
      const { unmount } = renderPage()
      await waitFor(() => expect(screen.getAllByTestId('identity-state').at(-1)!.textContent).toBe(label))
      unmount()
    }
  })

  it('OC-5C: a registered account type and business type render read-only — the edit form offers no switch', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      profile: { account_kind: 'business', business_type: 'garage', organization_name: 'Moyo Garage', market_relationship: 'zimbabwe_local', country_of_residence: 'Zimbabwe', city: 'Harare', intended_use: 'professional_services' },
      journey: { ...journeyFixture().journey, steps: { ...journeyFixture().journey.steps, context_established: true } },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('context-summary').textContent).toMatch(/Garage \/ service centre/))
    fireEvent.click(screen.getByTestId('edit-context'))
    await waitFor(() => expect(screen.getByTestId('fixed-identity-fields')).toBeTruthy())
    expect(screen.getByTestId('fixed-identity-fields').textContent).toMatch(/Business — Garage \/ service centre/)
    expect(screen.getByTestId('fixed-identity-fields').textContent).toMatch(/contact CarUp support/)
    expect(screen.queryByTestId('account-kind')).toBeNull()
    expect(screen.queryByTestId('business-type')).toBeNull()

    fireEvent.change(screen.getByTestId('city-input'), { target: { value: 'Bulawayo' } })
    fireEvent.click(screen.getByTestId('save-profile'))
    await waitFor(() => expect(saveRegistrationProfile).toHaveBeenCalledTimes(1))
    const { profile } = saveRegistrationProfile.mock.calls[0][0]
    expect([profile.account_kind, profile.business_type, profile.city]).toEqual(['business', 'garage', 'Bulawayo'])
  })

  it('the identity wizard drives the applicant routes: start, per-side upload with visible state, submit', async () => {
    fetchRegistrationJourney
      .mockResolvedValueOnce(journeyFixture())
      .mockResolvedValue(withIdentity(
        { state: 'ready_to_submit', session_id: 'vs-3', double_sided: true, uploaded_sides: { front: true, back: true, selfie: true }, guidance: 'All images are uploaded — submit them for verification.' },
        { identity_session: { id: 'vs-3', status: 'uploaded' } },
      ))
    createIdentitySession.mockResolvedValue({ success: true, session: { id: 'vs-3' } })
    submitIdentitySession.mockResolvedValue({ success: true, session: { id: 'vs-3', status: 'ocr_pending' } })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('start-identity')).toBeTruthy())
    fireEvent.click(screen.getByTestId('start-identity'))
    await waitFor(() => expect(createIdentitySession).toHaveBeenCalledWith('national_id'))

    await waitFor(() => expect(screen.getByTestId('upload-tiles')).toBeTruthy())
    expect(screen.getByTestId('upload-front').textContent).toMatch(/Uploaded — tap to replace/)
    // Images only on this lineage: no PDF is offered.
    const inputs = screen.getByTestId('upload-tiles').querySelectorAll('input[type="file"]')
    for (const input of Array.from(inputs)) expect(input.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')

    fireEvent.click(screen.getByTestId('submit-identity'))
    await waitFor(() => expect(submitIdentitySession).toHaveBeenCalledWith('vs-3'))
  })
})
