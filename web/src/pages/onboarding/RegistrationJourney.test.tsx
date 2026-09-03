/**
 * O2-X2 — Registration journey page.
 *
 * Pinned rules: the page renders SERVER truth (ladder, who-must-act, locked reasons) and
 * decides nothing; OCR output is candidates only — a missing/marker field says "Not read
 * from document" and never shows a placeholder as data; using a candidate records exactly
 * what was SHOWN so the server can derive confirmed-vs-corrected; an OCR problem leaves
 * manual profile completion open; identity approval renders alongside still-locked
 * seller/dealer capabilities.
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
          state: 'not_started', session_id: null,
          uploaded_sides: { front: false, back: false, selfie: false },
          double_sided: null, document_type: null, who_must_act: 'subject_action',
          guidance: 'Upload an identity document and selfie to start verification when you are ready.',
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
    saveRegistrationProfile.mockResolvedValue({ success: true, field_provenance: {} })
  })

  it('renders server truth: ladder, who-must-act, locked reasons, and the context form for a fresh account', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('who-must-act')).toBeTruthy())
    expect(screen.getByTestId('who-must-act').textContent).toMatch(/Your action needed/)
    expect(screen.getByTestId('stage-basic_account').textContent).toMatch(/Account created/)
    expect(screen.getByTestId('locked-sell_vehicle_publicly').textContent).toMatch(/identity verification never grants it/)
    expect(screen.getByTestId('locked-dealer_tools').textContent).toMatch(/its own governed decision/)
    expect(screen.getByTestId('context-form')).toBeTruthy()
    expect(screen.getByTestId('start-identity')).toBeTruthy()
  })

  it('renders extracted candidates as candidates — a missing field says so and no placeholder appears as data', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      identity_session: { id: 'vs-1', status: 'pending_manual_review' },
      journey: {
        ...journeyFixture().journey,
        steps: {
          ...journeyFixture().journey.steps,
          identity: { ...journeyFixture().journey.steps.identity, state: 'in_review', session_id: 'vs-1', who_must_act: 'carup_review', guidance: 'A CarUp reviewer will check your documents. No action is needed from you right now.' },
        },
        who_must_act: 'carup_review',
      },
    }))
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

  it('using a candidate records exactly what was shown; the save carries candidates_seen for server-side provenance', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      identity_session: { id: 'vs-1', status: 'pending_manual_review' },
    }))
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

    const inputs = screen.getByTestId('context-form').querySelectorAll('input')
    // country, city, province, then checkboxes — fill the required rest.
    fireEvent.change(inputs[1], { target: { value: 'Harare' } })
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
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      identity_session: { id: 'vs-1', status: 'pending_manual_review' },
    }))
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

    const inputs = screen.getByTestId('context-form').querySelectorAll('input')
    fireEvent.change(inputs[0], { target: { value: 'United Kingdom' } }) // correct the candidate
    fireEvent.change(inputs[1], { target: { value: 'Leeds' } })
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
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      identity_session: { id: 'vs-1', status: 'ocr_failed' },
      journey: {
        ...journeyFixture().journey,
        steps: {
          ...journeyFixture().journey.steps,
          identity: {
            ...journeyFixture().journey.steps.identity,
            state: 'in_review', session_id: 'vs-1', who_must_act: 'carup_review',
            guidance: 'A CarUp reviewer will check your documents. No action is needed from you right now.',
          },
        },
      },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('identity-state').textContent).toMatch(/In human review/))
    expect(screen.getByTestId('context-form')).toBeTruthy()
    expect(screen.getByTestId('save-profile')).toBeTruthy()
  })

  it('identity approval renders as verified while seller/dealer capabilities stay visibly locked by their own authorities', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      profile: { account_kind: 'individual', market_relationship: 'diaspora', country_of_residence: 'Zimbabwe', city: 'Leeds', intended_use: 'buy_sell' },
      identity_session: { id: 'vs-2', status: 'verified' },
      journey: {
        ...journeyFixture().journey,
        steps: {
          account_created: true,
          context_established: true,
          identity: {
            ...journeyFixture().journey.steps.identity,
            state: 'approved', session_id: 'vs-2', who_must_act: 'none', guidance: 'Your identity is verified.',
          },
        },
        who_must_act: 'none',
        required_action: 'Your identity is verified.',
        capability_ladder: LADDER.map((s) => ({ ...s, reached: true })),
      },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('identity-state').textContent).toBe('Verified'))
    expect(screen.getByText(/still have their own separate steps/)).toBeTruthy()
    expect(screen.getByTestId('locked-sell_vehicle_publicly')).toBeTruthy()
    expect(screen.getByTestId('locked-dealer_tools')).toBeTruthy()
    // Resume: the saved profile renders as a summary — no forced re-entry.
    expect(screen.getByTestId('context-summary').textContent).toMatch(/Zimbabwe/)
  })

  it('X3: reverification_required shows the reason, a re-verify CTA, and the lifecycle-locked capabilities', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      profile: { account_kind: 'individual', market_relationship: 'diaspora', country_of_residence: 'Zimbabwe', city: 'Leeds', intended_use: 'buy_sell' },
      identity_session: { id: 'vs-old', status: 'verified' },
      journey: {
        ...journeyFixture().journey,
        steps: {
          account_created: true,
          context_established: true,
          identity: {
            ...journeyFixture().journey.steps.identity,
            state: 'reverification_required',
            who_must_act: 'subject_action',
            guidance: 'The identity document you verified with has expired. Please verify with a current document.',
            lifecycle: { effective_state: 'reverification_required', reason_code: 'DOCUMENT_EXPIRED', applicant_guidance: 'The identity document you verified with has expired. Please verify with a current document.', who_must_act: 'subject_action', capability_bearing: false },
          },
        },
        who_must_act: 'subject_action',
        required_action: 'The identity document you verified with has expired. Please verify with a current document.',
        locked_capabilities: [
          { capability: 'present_as_identity_verified', locked_by: 'identity_lifecycle', reason: 'The identity document you verified with has expired. Please verify with a current document.' },
          ...LOCKED,
        ],
      },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('identity-state').textContent).toBe('Re-verification required'))
    expect(screen.getByTestId('identity-guidance').textContent).toMatch(/expired/i)
    expect(screen.getByTestId('start-identity').textContent).toMatch(/Verify again/)
    expect(screen.getByTestId('locked-present_as_identity_verified').textContent).toMatch(/expired/i)
    expect(screen.getByTestId('locked-sell_vehicle_publicly')).toBeTruthy()
  })

  it('X3: a security hold renders the applicant-safe banner with CarUp as the actor — no restart CTA, no internal detail', async () => {
    fetchRegistrationJourney.mockResolvedValue(journeyFixture({
      identity_session: { id: 'vs-old', status: 'verified' },
      journey: {
        ...journeyFixture().journey,
        steps: {
          ...journeyFixture().journey.steps,
          identity: {
            ...journeyFixture().journey.steps.identity,
            state: 'compromised',
            who_must_act: 'carup_review',
            guidance: 'For your security, CarUp is reviewing this account. Contact support if you need help.',
            lifecycle: { effective_state: 'compromised', reason_code: 'SUSPECTED_ACCOUNT_TAKEOVER', applicant_guidance: 'For your security, CarUp is reviewing this account. Contact support if you need help.', who_must_act: 'carup_review', capability_bearing: false },
          },
        },
        who_must_act: 'carup_review',
        required_action: 'For your security, CarUp is reviewing this account. Contact support if you need help.',
      },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('identity-state').textContent).toBe('Security review'))
    expect(screen.getByTestId('lifecycle-hold').textContent).toMatch(/With CarUp review/)
    expect(screen.queryByTestId('start-identity')).toBeNull()
    expect(screen.getByTestId('identity-guidance').textContent).not.toMatch(/takeover|SUSPECTED/i)
  })

  it('the identity wizard drives the applicant routes: start, per-side upload with visible state, submit', async () => {
    fetchRegistrationJourney
      .mockResolvedValueOnce(journeyFixture())
      .mockResolvedValue(journeyFixture({
        identity_session: { id: 'vs-3', status: 'uploaded' },
        journey: {
          ...journeyFixture().journey,
          steps: {
            ...journeyFixture().journey.steps,
            identity: {
              ...journeyFixture().journey.steps.identity,
              state: 'ready_to_submit', session_id: 'vs-3', double_sided: true,
              uploaded_sides: { front: true, back: true, selfie: true },
              guidance: 'All images are uploaded — submit them for verification.',
            },
          },
        },
      }))
    createIdentitySession.mockResolvedValue({ success: true, session: { id: 'vs-3' } })
    submitIdentitySession.mockResolvedValue({ success: true, session: { id: 'vs-3', status: 'ocr_pending' } })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('start-identity')).toBeTruthy())
    fireEvent.click(screen.getByTestId('start-identity'))
    await waitFor(() => expect(createIdentitySession).toHaveBeenCalledWith('national_id'))

    await waitFor(() => expect(screen.getByTestId('upload-tiles')).toBeTruthy())
    expect(screen.getByTestId('upload-front').textContent).toMatch(/Uploaded — tap to replace/)

    fireEvent.click(screen.getByTestId('submit-identity'))
    await waitFor(() => expect(submitIdentitySession).toHaveBeenCalledWith('vs-3'))
  })
})
