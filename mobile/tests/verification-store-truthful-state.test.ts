import { describe, it, expect, beforeEach } from 'vitest'
import { useVerificationStore } from '../store/verificationStore'
import { mapSessionToVerificationOutcome, type VerificationSession } from '../utils/verificationApi'

function session(status: VerificationSession['status'], overrides: Partial<VerificationSession> = {}): VerificationSession {
  return {
    id: 'session-1',
    document_type: 'national_id',
    double_sided: true,
    status,
    uploaded_sides: { front: true, back: true, selfie: true },
    ocr_document_id: null,
    ocr_result: null,
    confidence_score: null,
    failure_reason: null,
    review_notes: null,
    retry_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    submitted_at: null,
    ocr_completed_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  useVerificationStore.getState().clear()
})

describe('VerificationStore — truthful state management', () => {
  describe('initial state', () => {
    it('starts idle with no captured data', () => {
      const s = useVerificationStore.getState()
      expect(s.verificationStatus).toBe('idle')
      expect(s.capturedFront).toBeNull()
      expect(s.capturedBack).toBeNull()
      expect(s.capturedSelfie).toBeNull()
      expect(s.ocrResult).toBeNull()
      expect(s.processingError).toBeNull()
      expect(s.verificationSessionId).toBeNull()
      expect(s.verificationSessionStatus).toBeNull()
      expect(s.isRefreshing).toBe(false)
    })
  })

  describe('hasRequiredImages', () => {
    it('returns false when no images captured', () => {
      expect(useVerificationStore.getState().hasRequiredImages(true)).toBe(false)
      expect(useVerificationStore.getState().hasRequiredImages(false)).toBe(false)
    })

    it('returns false when back is missing for double-sided', () => {
      useVerificationStore.getState().setCapturedFront('data:image/png;base64,f')
      useVerificationStore.getState().setCapturedSelfie('data:image/png;base64,s')
      expect(useVerificationStore.getState().hasRequiredImages(true)).toBe(false)
      expect(useVerificationStore.getState().hasRequiredImages(false)).toBe(true)
    })

    it('returns true when all images present for double-sided', () => {
      useVerificationStore.getState().setCapturedFront('data:image/png;base64,f')
      useVerificationStore.getState().setCapturedBack('data:image/png;base64,b')
      useVerificationStore.getState().setCapturedSelfie('data:image/png;base64,s')
      expect(useVerificationStore.getState().hasRequiredImages(true)).toBe(true)
    })
  })

  describe('setVerificationOutcome — truthful backend-driven transitions', () => {
    it('maps needs_review when backend reports pending manual review', () => {
      useVerificationStore.getState().setVerificationOutcome('needs_review', 'session-1', 'Pending manual review.', 'pending_manual_review')
      const s = useVerificationStore.getState()
      expect(s.verificationStatus).toBe('needs_review')
      expect(s.verificationStatus).not.toBe('verified')
      expect(s.verificationSessionId).toBe('session-1')
      expect(s.verificationSessionStatus).toBe('pending_manual_review')
    })

    it('maps verified only when backend confirms', () => {
      useVerificationStore.getState().setVerificationOutcome('verified', 'session-1', null, 'verified')
      expect(useVerificationStore.getState().verificationStatus).toBe('verified')
    })

    it('maps retry_requested when admin requests reupload', () => {
      useVerificationStore.getState().setVerificationOutcome('retry_requested', 'session-1', 'Reupload a sharper photo.', 'retry_requested')
      const s = useVerificationStore.getState()
      expect(s.verificationStatus).toBe('retry_requested')
      expect(s.processingError).toContain('sharper')
    })

    it('never stores verified for non-verified backend statuses', () => {
      const nonVerified: ('needs_review' | 'ocr_failed' | 'retry_requested' | 'rejected')[] = [
        'needs_review', 'ocr_failed', 'retry_requested', 'rejected',
      ]
      for (const status of nonVerified) {
        useVerificationStore.getState().clear()
        useVerificationStore.getState().setVerificationOutcome(status, 's1', null, status)
        expect(useVerificationStore.getState().verificationStatus).not.toBe('verified')
      }
    })

    it('maintains backend-unreachable as not verified', () => {
      useVerificationStore.getState().setVerificationOutcome('backend_pending', null, 'Backend unreachable.', null)
      const s = useVerificationStore.getState()
      expect(s.verificationStatus).not.toBe('verified')
      expect(s.verificationSessionStatus).toBeNull()
    })
  })

  describe('setRefreshing', () => {
    it('toggles the refreshing state', () => {
      useVerificationStore.getState().setRefreshing(true)
      expect(useVerificationStore.getState().isRefreshing).toBe(true)
      useVerificationStore.getState().setRefreshing(false)
      expect(useVerificationStore.getState().isRefreshing).toBe(false)
    })
  })

  describe('clear', () => {
    it('resets all fields to initial values', () => {
      useVerificationStore.getState().setCapturedFront('x')
      useVerificationStore.getState().setCapturedBack('x')
      useVerificationStore.getState().setCapturedSelfie('x')
      useVerificationStore.getState().setOcrResult({ first_name: 'T' })
      useVerificationStore.getState().setProcessingError('err')
      useVerificationStore.getState().setVerificationOutcome('verified', 's99', null, 'verified')
      useVerificationStore.getState().setRefreshing(true)
      useVerificationStore.getState().clear()

      const s = useVerificationStore.getState()
      expect(s.capturedFront).toBeNull()
      expect(s.capturedBack).toBeNull()
      expect(s.capturedSelfie).toBeNull()
      expect(s.ocrResult).toBeNull()
      expect(s.processingError).toBeNull()
      expect(s.verificationStatus).toBe('idle')
      expect(s.verificationSessionId).toBeNull()
      expect(s.verificationSessionStatus).toBeNull()
      expect(s.isRefreshing).toBe(false)
      expect(s.hasRequiredImages(true)).toBe(false)
    })
  })

  describe('full flow', () => {
    it('completes a double-sided verification lifecycle', () => {
      useVerificationStore.getState().setCapturedFront('data:image/png;base64,f')
      useVerificationStore.getState().setCapturedBack('data:image/png;base64,b')
      useVerificationStore.getState().setCapturedSelfie('data:image/png;base64,s')
      expect(useVerificationStore.getState().hasRequiredImages(true)).toBe(true)

      useVerificationStore.getState().setVerificationOutcome('needs_review', 'session-abc', null, 'pending_manual_review')
      expect(useVerificationStore.getState().verificationStatus).toBe('needs_review')

      useVerificationStore.getState().setVerificationOutcome('verified', 'session-abc', null, 'verified')
      expect(useVerificationStore.getState().verificationStatus).toBe('verified')
    })
  })
})

describe('mapSessionToVerificationOutcome — truthful backend mapping', () => {
  it('maps verified with OCR data and sessionStatus', () => {
    const outcome = mapSessionToVerificationOutcome(session('verified', {
      ocr_result: { first_name: 'Ruvimbo', country: 'Zimbabwe' },
    }))
    expect(outcome.status).toBe('verified')
    expect(outcome.sessionStatus).toBe('verified')
    expect(outcome.ocrResult?.first_name).toBe('Ruvimbo')
    expect(outcome.processingError).toBeNull()
  })

  it('maps pending_manual_review to needs_review without claiming verified', () => {
    const outcome = mapSessionToVerificationOutcome(session('pending_manual_review', {
      review_notes: 'Reviewer must inspect.',
    }))
    expect(outcome.status).toBe('needs_review')
    expect(outcome.status).not.toBe('verified')
    expect(outcome.processingError).toContain('Reviewer')
  })

  it('maps ocr_failed with failure reason', () => {
    const outcome = mapSessionToVerificationOutcome(session('ocr_failed', {
      failure_reason: 'OCR provider unavailable',
    }))
    expect(outcome.status).toBe('ocr_failed')
    expect(outcome.sessionStatus).toBe('ocr_failed')
  })

  it('maps rejected with reviewer notes', () => {
    const outcome = mapSessionToVerificationOutcome(session('rejected', {
      review_notes: 'Document is illegible.',
    }))
    expect(outcome.status).toBe('rejected')
    expect(outcome.sessionStatus).toBe('rejected')
    expect(outcome.processingError).toContain('illegible')
  })

  it('maps retry_requested with retry reason', () => {
    const outcome = mapSessionToVerificationOutcome(session('retry_requested', {
      retry_reason: 'Reupload a sharper back photo.',
    }))
    expect(outcome.status).toBe('retry_requested')
    expect(outcome.sessionStatus).toBe('retry_requested')
    expect(outcome.processingError).toContain('sharper')
  })

  it('never reports verified for non-verified backend statuses', () => {
    const nonVerified: VerificationSession['status'][] = ['pending_manual_review', 'ocr_failed', 'retry_requested', 'rejected']
    for (const status of nonVerified) {
      const outcome = mapSessionToVerificationOutcome(session(status))
      expect(outcome.status).not.toBe('verified')
    }
  })
})
