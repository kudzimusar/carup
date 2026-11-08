import { describe, expect, it } from 'vitest'
import { DEALER_REVIEWER_MESSAGES, dealerReviewerErrorMessage } from './dealerReviewerErrors'

describe('dealerReviewerErrorMessage (Owner UAT-R1)', () => {
  it('explains a wrong password and the lockout instead of showing a bare code', () => {
    const problem = Object.assign(new Error('REAUTHENTICATION_FAILED'), { data: { code: 'REAUTHENTICATION_FAILED' } })
    expect(dealerReviewerErrorMessage(problem, 'x')).toMatch(/not correct.*5 incorrect attempts.*15 minutes/)
    expect(dealerReviewerErrorMessage(new Error('REVIEWER_STEP_UP_LOCKED'), 'x')).toMatch(/locked/)
  })
  it('explains the separate-company reconciliation blocker with a next step', () => {
    const text = dealerReviewerErrorMessage({ data: { code: 'SEPARATE_LEGAL_ORGANIZATION_REQUIRES_GOVERNED_ONBOARDING' } }, 'x')
    expect(text).toMatch(/different registered companies/)
    expect(text).toMatch(/resubmit/)
  })
  it('names an autofilled e-mail in the registration number', () => {
    expect(dealerReviewerErrorMessage(new Error('REGISTRATION_NUMBER_FORMAT_INVALID'), 'x')).toMatch(/e-mail/)
  })
  it('explains a spent or expired storefront media review ticket and says to refresh the queue', () => {
    const problem = Object.assign(new Error('STOREFRONT_MEDIA_REVIEW_TICKET_INVALID'), {
      status: 403, data: { error: 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID', code: 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID' },
    })
    expect(dealerReviewerErrorMessage(problem, 'x'))
      .toBe('This review session has expired or is no longer valid. Refresh the review queue and try again.')
  })
  it('shows an unknown code verbatim and falls back for non-errors', () => {
    expect(dealerReviewerErrorMessage(new Error('SOMETHING_NEW_HAPPENED'), 'x')).toBe('SOMETHING_NEW_HAPPENED')
    expect(dealerReviewerErrorMessage(null, 'Fallback text')).toBe('Fallback text')
  })
  it('every message is a complete sentence', () => {
    for (const text of Object.values(DEALER_REVIEWER_MESSAGES)) expect(text).toMatch(/[.!]$/)
  })
})
