import { describe, it, expect, beforeEach } from 'vitest'
import { captureReferralFromUrl, getStoredAttribution, inquiryAttributionFields } from './marketplaceReferral'

/**
 * Referral V1 Stage-4 remediation A (frontend side): an invitee arriving via an attributed marketplace
 * link must have the referral code captured and then attached to the marketplace inquiry submission —
 * which the backend bridges into the qualifiable local-marketplace lead.
 */
describe('marketplace referral attribution', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('captures the referral code from ?ref= and persists it', () => {
    captureReferralFromUrl('?ref=LOCAL-BUYER-REFV1-OWNE-ABC123&utm_source=web&utm_medium=referral')
    expect(getStoredAttribution().referral_code).toBe('LOCAL-BUYER-REFV1-OWNE-ABC123')
  })

  it('also accepts the referral_code param name', () => {
    captureReferralFromUrl('?referral_code=CODE-XYZ')
    expect(getStoredAttribution().referral_code).toBe('CODE-XYZ')
  })

  it('survives a later navigation with no ref param (attribution is not erased)', () => {
    captureReferralFromUrl('?ref=STICKY-CODE-1')
    // Simulate navigating to an unrelated page (empty query string).
    const after = captureReferralFromUrl('')
    expect(after.referral_code).toBe('STICKY-CODE-1')
    expect(getStoredAttribution().referral_code).toBe('STICKY-CODE-1')
  })

  it('attaches the stored referral code to an inquiry payload', () => {
    captureReferralFromUrl('?ref=INQUIRY-CODE-9&campaign=spring')
    const fields = inquiryAttributionFields('web')
    expect(fields.referral_code).toBe('INQUIRY-CODE-9')
    expect(fields.campaign_code).toBe('spring')
    expect(fields.source_channel).toBe('web')
  })

  it('sends no referral code when none was captured', () => {
    const fields = inquiryAttributionFields('web')
    expect(fields.referral_code).toBeUndefined()
  })
})
