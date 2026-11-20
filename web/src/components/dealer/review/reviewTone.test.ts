/**
 * RX05-D — a status that nobody has decided on yet is never toned like a verified/approved one.
 */
import { describe, expect, it } from 'vitest'
import { humanizeStatus, reviewAge, reviewStatusTone } from './reviewTone'

describe('reviewStatusTone', () => {
  it.each([
    'AWAITING_DOCUMENTARY_EVIDENCE', 'PENDING_HUMAN_SOURCE_ELIGIBILITY', 'PENDING_INDEPENDENT_REVIEW', 'pending',
    'AWAITING_INDEPENDENT_ACTIVATION', 'PENDING_HUMAN_REVIEW', 'UNVERIFIED', 'NOT_APPROVED', 'UNAPPROVED',
    'PENDING_APPROVAL', 'AWAITING_APPROVAL', 'SUBMITTED', 'UNREVIEWED_PARENT_BRANCH_MATCH',
  ])('%s is pending, never positive', status => {
    expect(reviewStatusTone(status)).toBe('pending')
  })

  it.each([
    'PRELISTED_UNCLAIMED', 'WITHHELD', 'READY_FOR_REGULATORY_REVIEW', 'NOT_ELIGIBLE_FOR_PUBLIC_REVIEW', 'superseded', '', null, undefined,
  ])('%s is neutral (decided, but not a verification)', status => {
    expect(reviewStatusTone(status)).toBe('neutral')
  })

  it.each([
    'CLAIM_APPROVED', 'APPROVED_PUBLIC_DISPLAY', 'ACTIVATED', 'ATTACHED_TO_EXISTING_DEALERSHIP', 'PUBLISHED_FULL', 'OPERATIONAL', 'verified',
  ])('%s is a recorded positive decision', status => {
    expect(reviewStatusTone(status)).toBe('positive')
  })

  it.each([
    'CLAIM_REJECTED', 'CLAIM_REVOKED', 'SUSPENDED', 'WITHDRAWN', 'SUPPRESSED', 'QUARANTINED', 'LEGAL_REVIEW_EXPIRED', 'RETRACTED',
    'rejected', 'DEACTIVATED', 'RESOLVED_SUPPRESSED',
  ])('%s is negative', status => {
    expect(reviewStatusTone(status)).toBe('negative')
  })

  it.each(['CLAIM_DISPUTED', 'UNDER_DISPUTE', 'UNDER_INVESTIGATION', 'NEEDS_CORRECTIONS', 'EVIDENCE_REQUIRED', 'POTENTIAL_DUPLICATE', 'disputed'])(
    '%s needs attention', status => {
      expect(reviewStatusTone(status)).toBe('attention')
    })
})

describe('helpers', () => {
  it('humanizes a status', () => {
    expect(humanizeStatus('AWAITING_DOCUMENTARY_EVIDENCE')).toBe('Awaiting documentary evidence')
    expect(humanizeStatus(null)).toBe('Not recorded')
  })
  it('says how long something has waited, from the server timestamp only', () => {
    const now = Date.parse('2026-11-18T12:00:00Z')
    expect(reviewAge('2026-11-18T08:00:00Z', now)).toBe('today')
    expect(reviewAge('2026-11-17T08:00:00Z', now)).toBe('1 day ago')
    expect(reviewAge('2026-11-10T08:00:00Z', now)).toBe('8 days ago')
    expect(reviewAge('not a date', now)).toBeNull()
  })
})
