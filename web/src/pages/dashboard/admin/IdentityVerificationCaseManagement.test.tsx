import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IdentityVerificationCaseManagement from './IdentityVerificationCaseManagement'

const mockToast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))

vi.setConfig({ testTimeout: 15000 })

vi.mock('sonner', () => ({
  toast: mockToast,
}))

const SESSION_ID_1 = 'aaaaaaaa-0000-0000-0000-000000000001'

const defaultSessions = [
  {
    id: SESSION_ID_1,
    user_id: 'user-1111-1111',
    document_type: 'passport',
    double_sided: false,
    status: 'pending_review',
    workflow_phase: 'reviewer_action_required',
    primary_reason_code: null,
    uploaded_sides: { front: true, back: false, selfie: true },
    submitted_at: '2025-06-01T12:00:00Z',
    created_at: '2025-06-01T10:00:00Z',
    updated_at: '2025-06-01T12:00:00Z',
    ocr_result: null,
    confidence_score: null,
    failure_reason: null,
    review_notes: null,
    review_decision: null,
    retry_reason: null,
    liveness_status: null,
    reviewed_by: null,
    reviewed_at: null,
    ocr_started_at: null,
    ocr_completed_at: null,
    identity_binding: null,
    evidence_classification: null,
    extraction_trust_status: null,
    ocr_execution_status: null,
    identity_binding_status: null,
    next_actor: null,
    required_action: null,
    assessment: null,
    decisions: [],
    final_disposition: null,
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    user_id: 'user-2222-2222',
    document_type: 'drivers_license',
    double_sided: true,
    status: 'pending_review',
    workflow_phase: 'reviewer_action_required',
    primary_reason_code: 'BLURRY',
    uploaded_sides: { front: true, back: true, selfie: true },
    submitted_at: '2025-06-02T08:30:00Z',
    created_at: '2025-06-02T06:00:00Z',
    updated_at: '2025-06-02T08:30:00Z',
    ocr_result: null,
    confidence_score: null,
    failure_reason: null,
    review_notes: null,
    review_decision: null,
    retry_reason: null,
    liveness_status: null,
    reviewed_by: null,
    reviewed_at: null,
    ocr_started_at: null,
    ocr_completed_at: null,
    identity_binding: null,
    evidence_classification: null,
    extraction_trust_status: null,
    ocr_execution_status: null,
    identity_binding_status: null,
    next_actor: null,
    required_action: null,
    assessment: null,
    decisions: [],
    final_disposition: null,
  },
]

const sessionDetail = {
  ...defaultSessions[0],
  evidence_classification: 'valid_identity_document',
  extraction_trust_status: 'trusted',
  ocr_execution_status: 'completed',
  ocr_result: { 'Full Name': 'Jane Doe', 'Date of Birth': '1990-01-15' },
  identity_binding: {
    status: 'match',
    account_holder_name: 'Jane Doe',
    document_holder_name: 'Jane Doe',
    reason: null,
  },
  assessment: {
    risk_level: 'low',
    recommended_action: 'approve',
    evidence_classification: 'valid_identity_document',
    extraction_trust_status: 'trusted',
    ocr_execution_status: 'completed',
    allowed_actions: ['approve', 'request_resubmission', 'reject', 'escalate', 'add_internal_note'],
  },
  decisions: [
    {
      id: 'dec-001',
      decision: 'escalate',
      reason_code: 'BLURRY',
      internal_note: 'Images too blurry, requesting resubmission',
      applicant_message: 'Please provide clearer images',
      reviewer_id: 'reviewer-1',
      created_at: '2025-06-01T11:00:00Z',
    },
  ],
}

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

function jsonResponse(data: unknown, ok = true): FetchResponse {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) }
}

function openFirstSession() {
  const cards = screen.getAllByText(/aaaaaaaa-000/)
  return cards[0].closest('.cursor-pointer') as HTMLElement
}

async function waitForSessions() {
  await waitFor(() => {
    expect(screen.getAllByText(/aaaaaaaa-000/).length).toBeGreaterThanOrEqual(1)
  })
}

async function openDialog() {
  await waitForSessions()
  await userEvent.click(openFirstSession())
  await waitFor(() => {
    expect(screen.getByText('Case Disposition')).toBeInTheDocument()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('IdentityVerificationCaseManagement', () => {
  describe('initial render and loading state', () => {
    it('shows loading state while fetching sessions', () => {
      globalThis.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<IdentityVerificationCaseManagement />)
      expect(screen.getByText('Identity Verification')).toBeInTheDocument()
      expect(screen.getByText('Case management and review queue')).toBeInTheDocument()
      expect(screen.queryByText('No cases in this queue.')).not.toBeInTheDocument()
    })

    it('shows empty state when no sessions returned', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true, sessions: [] }))
      render(<IdentityVerificationCaseManagement />)
      await waitFor(() => {
        expect(screen.getByText('No cases in this queue.')).toBeInTheDocument()
      })
    })

    it('shows error toast when sessions fetch fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'Server error' }, false))
      render(<IdentityVerificationCaseManagement />)
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to load verification sessions')
      })
    })
  })

  describe('sessions list rendering', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true, sessions: defaultSessions }))
    })

    it('renders session cards with correct data', async () => {
      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()
      expect(screen.getByText(/Passport/)).toBeInTheDocument()
      expect(screen.getAllByText(/Reviewer Action Required/).length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('tab switching', () => {
    it('switches tabs and fetches with correct phase parameter', async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ success: true, sessions: [] }))
      globalThis.fetch = fetchFn
      render(<IdentityVerificationCaseManagement />)
      await waitFor(() => { expect(fetchFn).toHaveBeenCalled() })

      const initialUrl = fetchFn.mock.calls[0][0] as string
      expect(initialUrl).toContain('workflow_phase=reviewer_action_required')

      await userEvent.click(screen.getByText('All Cases'))
      await waitFor(() => { expect(fetchFn).toHaveBeenCalledTimes(2) })

      const allUrl = fetchFn.mock.calls[1][0] as string
      expect(allUrl).not.toContain('workflow_phase')
    })

    it('switches to escalated tab', async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ success: true, sessions: [] }))
      globalThis.fetch = fetchFn
      render(<IdentityVerificationCaseManagement />)
      await waitFor(() => { expect(fetchFn).toHaveBeenCalled() })

      await userEvent.click(screen.getByText('Escalated Cases'))
      await waitFor(() => { expect(fetchFn).toHaveBeenCalledTimes(2) })

      const url = fetchFn.mock.calls[1][0] as string
      expect(url).toContain('workflow_phase=escalated')
    })
  })

  describe('session detail dialog', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ success: true, session: sessionDetail }))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })
    })

    it('opens dialog and loads session detail when clicking a session', async () => {
      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()
      await userEvent.click(openFirstSession())

      await waitFor(() => {
        expect(screen.getByText('Decision Summary')).toBeInTheDocument()
      })
      expect(screen.getByText('low')).toBeInTheDocument()
      expect(screen.getByText('Approve')).toBeInTheDocument()
    })

    it('shows identity binding match information', async () => {
      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()
      await userEvent.click(openFirstSession())

      await waitFor(() => {
        expect(screen.getByText('Identity Comparison')).toBeInTheDocument()
      })
    })

    it('displays case timeline when decisions exist', async () => {
      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()
      await userEvent.click(openFirstSession())

      await waitFor(() => {
        expect(screen.getByText('Case Timeline')).toBeInTheDocument()
      })
    })
  })

  describe('evidence preview', () => {
    it('loads and displays evidence preview image on button click', async () => {
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes('/evidence/front/preview')) {
          return Promise.resolve(jsonResponse({
            success: true,
            preview: { side: 'front', url: 'https://cdn.example.com/front.jpg', expiresInSeconds: 300 },
          }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ success: true, session: sessionDetail }))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })

      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()
      await userEvent.click(openFirstSession())

      await waitFor(() => { expect(screen.getByText('Evidence')).toBeInTheDocument() })

      await userEvent.click(screen.getByText('Show front'))

      await waitFor(() => {
        const img = screen.getByAltText('front evidence')
        expect(img).toHaveAttribute('src', 'https://cdn.example.com/front.jpg')
      })
    })
  })

  describe('decision form', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes('/review')) {
          return Promise.resolve(jsonResponse({
            success: true,
            decision: {
              id: 'dec-002', action: 'approve', reason_code: null,
              previous_phase: 'reviewer_action_required', resulting_phase: 'resolved_approved',
              legacy_status: null, final_disposition: 'approved',
              applicant_message: null, internal_note: 'Looks good',
              reviewer_id: 'reviewer-1', created_at: '2025-06-01T13:00:00Z',
              audit_event_type: 'identity.verification.approved',
            },
            session: sessionDetail, allowed_actions: [],
          }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ success: true, session: sessionDetail }))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })
    })

    it('renders all five disposition options', async () => {
      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      expect(screen.getByText('Approve identity')).toBeInTheDocument()
      expect(screen.getByText('Request a new submission')).toBeInTheDocument()
      expect(screen.getByText('Reject verification')).toBeInTheDocument()
      expect(screen.getByText('Escalate for specialist review')).toBeInTheDocument()
      expect(screen.getByText('Continue investigation / save internal note')).toBeInTheDocument()
    })

    it('shows reason code dropdown when selecting reject', async () => {
      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      await userEvent.click(screen.getByText('Reject verification'))

      await waitFor(() => {
        expect(screen.getByText('Select a reason code')).toBeInTheDocument()
      })
    })

    it('submits an approve decision through the confirmation dialog and shows success panel', async () => {
      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      await userEvent.click(screen.getByText('Approve identity'))

      await userEvent.click(screen.getByText('Confirm Decision'))

      await waitFor(() => {
        expect(screen.getByText(/Confirm Approve/i)).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

      await waitFor(() => {
        expect(screen.getByText(/Decision saved/i)).toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('shows error toast when session detail fetch fails', async () => {
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ error: 'Not found' }, false))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })

      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()
      await userEvent.click(openFirstSession())

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to load session detail')
      })
    })
  })

  describe('disposition flows', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes('/review')) {
          return Promise.resolve(jsonResponse({
            success: true,
            decision: {
              id: 'dec-002', action: 'request_resubmission', reason_code: 'DOCUMENT_NOT_VISIBLE',
              previous_phase: 'reviewer_action_required', resulting_phase: 'applicant_action_required',
              legacy_status: 'retry_requested', final_disposition: 'retry_requested',
              applicant_message: 'Please retake with better lighting.',
              internal_note: 'Blurry', reviewer_id: 'reviewer-1',
              created_at: '2025-06-01T13:00:00Z',
              audit_event_type: 'VERIFICATION_REVIEW_RETRY_REQUESTED',
            },
            session: sessionDetail, allowed_actions: [],
          }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ success: true, session: sessionDetail }))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })
    })

    it('submits request_resubmission through confirmation dialog', async () => {
      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      await userEvent.click(screen.getByText('Request a new submission'))

      await waitFor(() => {
        expect(screen.getByText('Select a reason code')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: /Confirm Decision/i }))
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('An applicant message is required when requesting resubmission.')
      })
    })

    it('reject flow requires reason code before confirming', async () => {
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes('/review')) {
          return Promise.resolve(jsonResponse({
            success: true,
            decision: { id: 'dec-003', action: 'reject', reason_code: 'NON_DOCUMENT' },
            session: sessionDetail, allowed_actions: [],
          }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ success: true, session: sessionDetail }))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })

      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      await userEvent.click(screen.getByText('Reject verification'))
      await waitFor(() => {
        expect(screen.getByText('Select a reason code')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('Confirm Decision'))
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('A reason code is required for this action.')
      })
    })

    it('escalate flow shows reason code dropdown', async () => {
      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      await userEvent.click(screen.getByText('Escalate for specialist review'))

      await waitFor(() => {
        expect(screen.getByText('Select a reason code')).toBeInTheDocument()
      })
    })

    it('internal note flow shows Save Note button and no reason code selector', async () => {
      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      await userEvent.click(screen.getByText('Continue investigation / save internal note'))

      await waitFor(() => {
        expect(screen.getByText('Save Note')).toBeInTheDocument()
      })
      expect(screen.queryByText('Select a reason code')).not.toBeInTheDocument()
    })

    it('approve confirm dialog title reflects action', async () => {
      render(<IdentityVerificationCaseManagement />)
      await openDialog()

      await userEvent.click(screen.getByText('Approve identity'))
      await userEvent.click(screen.getByText('Confirm Decision'))

      await waitFor(() => {
        expect(screen.getByText(/Confirm Approve/i)).toBeInTheDocument()
      })
    })
  })

  describe('close and state reset', () => {
    it('cancel button in decision form closes dialog', async () => {
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ success: true, session: sessionDetail }))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })
      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()

      await userEvent.click(openFirstSession())
      await waitFor(() => {
        expect(screen.getByText('Case Disposition')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('Cancel'))
      await waitFor(() => {
        expect(screen.queryByText('Case Disposition')).not.toBeInTheDocument()
      })
    })
  })

  describe('session without decisions', () => {
    it('does not show case timeline when no decisions exist', async () => {
      const noDecisions = { ...sessionDetail, decisions: [] }
      globalThis.fetch = vi.fn((url: string) => {
        if (url.includes('/security/csrf-token')) {
          return Promise.resolve(jsonResponse({ csrfToken: 'test-csrf-token' }))
        }
        if (url.includes(SESSION_ID_1)) {
          return Promise.resolve(jsonResponse({ success: true, session: noDecisions }))
        }
        return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
      })

      render(<IdentityVerificationCaseManagement />)
      await waitForSessions()
      await userEvent.click(openFirstSession())

      await waitFor(() => {
        expect(screen.getByText('Decision Summary')).toBeInTheDocument()
      })
      expect(screen.queryByText('Case Timeline')).not.toBeInTheDocument()
    })
  })
})


describe('device retest round 2 regressions (source-level)', () => {
  const src = readFileSync(
    pathResolve(__dirname, './IdentityVerificationCaseManagement.tsx'),
    'utf-8',
  )

  it('the detail drawer dismiss is labelled "Close", never the case-action-like "Close Case"', () => {
    expect(src).not.toContain('>Close Case<')
    expect(src).toContain('onClick={closeDetail}>Close<')
  })

  it('classification chips are framed as AUTOMATED so they cannot contradict the decision reason', () => {
    expect(src).toContain('Automated Classification:')
    expect(src).toContain('`Automated: ${EVIDENCE_CLASSIFICATION_LABELS[session.evidence_classification]}`')
  })

  it('admin cards surface the applicant identity with a user-id fallback', () => {
    expect(src).toContain('session.applicant_name')
    expect(src).toContain('session.applicant_email')
  })

  it('the resubmission queue has a distinct sub-filter label', () => {
    expect(src).toContain("label: 'Resubmission Requested'")
  })

  it('a failed load NEVER renders zero counts — counts show — and the error panel offers Retry', () => {
    expect(src).toContain('setLoadError(true)')
    expect(src).toContain("'(—)'")
    expect(src).toContain('Could not load verification sessions.')
    expect(src).toContain('they are NOT zero')
  })
})

describe('X4 — biometric evidence section (evidence only, no shortcut actions)', () => {
  const biometricDetail = {
    ...sessionDetail,
    biometric: {
      face_match_status: 'mismatch',
      face_match_score: 0.21,
      liveness_status: 'passed',
      liveness_score: 0.91,
      provider: 'test-provider',
      provider_state: 'completed',
      provider_reference: 'ref-9',
      threshold_policy_version: 'biometric_threshold.v1',
      assessed_at: '2026-09-03T10:00:00.000Z',
      risk_flags: ['face_mismatch'],
      consent_id: 'consent-1',
    },
    biometric_consent: {
      active: true, status: 'granted', consent_text_version: 'biometric_consent_text.v1',
      granted_at: '2026-09-03T09:00:00.000Z', withdrawn_at: null,
    },
  }

  it('renders consent state, provider provenance, face and liveness — and offers NO buttons of its own', async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes('/security/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 't' }))
      if (url.includes(SESSION_ID_1)) return Promise.resolve(jsonResponse({ success: true, session: biometricDetail }))
      return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
    })
    render(<IdentityVerificationCaseManagement />)
    await waitForSessions()
    await userEvent.click(openFirstSession())
    await waitFor(() => expect(screen.getByTestId('biometric-evidence')).toBeInTheDocument())

    expect(screen.getByTestId('biometric-consent-state').textContent).toMatch(/Granted \(biometric_consent_text.v1\)/)
    expect(screen.getByTestId('biometric-face').textContent).toMatch(/Mismatch \(0.21\)/)
    expect(screen.getByTestId('biometric-liveness').textContent).toMatch(/Passed \(0.91\)/)
    expect(screen.getByTestId('biometric-evidence').textContent).toMatch(/biometric_threshold.v1/)
    // The disposition still travels ONLY through the decision controls below: the evidence
    // card itself carries no buttons and no "approve because biometric" shortcut exists.
    expect(screen.getByTestId('biometric-evidence').querySelectorAll('button').length).toBe(0)
    expect(screen.queryByText(/because biometric/i)).toBeNull()
  })

  it('says so honestly when no biometric assessment was run', async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes('/security/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 't' }))
      if (url.includes(SESSION_ID_1)) return Promise.resolve(jsonResponse({ success: true, session: { ...sessionDetail, biometric: null, biometric_consent: { active: false, status: 'none', consent_text_version: null, granted_at: null, withdrawn_at: null } } }))
      return Promise.resolve(jsonResponse({ success: true, sessions: defaultSessions }))
    })
    render(<IdentityVerificationCaseManagement />)
    await waitForSessions()
    await userEvent.click(openFirstSession())
    await waitFor(() => expect(screen.getByTestId('biometric-none')).toBeInTheDocument())
    expect(screen.getByTestId('biometric-consent-state').textContent).toMatch(/Not granted/)
  })
})
