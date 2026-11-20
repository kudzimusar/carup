/**
 * RX05-A — the presentation helpers fail closed: a listing reads as approved only on the server's
 * verified flag with a matching tier, and a claim journey stage is "done" only for a recorded decision.
 */
import { describe, expect, it } from 'vitest'
import { deriveClaimJourney, dealerStanding, humanizeStatus, mergeCities, tierOptionLabel, type ClaimJourneyInput } from './dealerShowroomModel'

describe('dealerStanding', () => {
  it('reads an unclaimed research entry as "Listed from public sources · not claimed", never approved', () => {
    const standing = dealerStanding({ claimed: false, business_verified: false, tier: 'PRELISTED_UNCLAIMED' })
    expect(standing.key).toBe('unclaimed')
    expect(standing.chip).toBe('Listed from public sources · not claimed')
    expect(standing.tone).toBe('neutral')
  })

  it('reads an existing claim without public approval as claimed, with a warning tone', () => {
    const standing = dealerStanding({ claimed: true, business_verified: false, tier: 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED' })
    expect(standing.key).toBe('claimed')
    expect(standing.chip).toBe('Claimed · public display not yet approved')
    expect(standing.tone).toBe('warning')
  })

  it('needs BOTH business_verified and an approved (or absent) tier before showing approval', () => {
    expect(dealerStanding({ claimed: true, business_verified: true, tier: 'FULL_DEALER_APPROVED' }).key).toBe('approved')
    expect(dealerStanding({ claimed: true, business_verified: true }).key).toBe('approved')
    // Contradictory payloads fall back to the weaker standing.
    expect(dealerStanding({ claimed: false, business_verified: true, tier: 'PRELISTED_UNCLAIMED' }).key).toBe('unclaimed')
    expect(dealerStanding({ claimed: true, business_verified: true, tier: 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED' }).key).toBe('claimed')
    expect(dealerStanding({ claimed: false, business_verified: false, tier: 'FULL_DEALER_APPROVED' }).key).toBe('unclaimed')
  })

  it('labels tier filter options with the same honest wording', () => {
    expect(tierOptionLabel('PRELISTED_UNCLAIMED')).toBe('Listed from public sources · not claimed')
    expect(tierOptionLabel('CLAIMED_PUBLIC_DISPLAY_UNAPPROVED')).toBe('Claimed · public display not yet approved')
  })
})

describe('humanizeStatus', () => {
  it('turns status codes into words and keeps the country code', () => {
    expect(humanizeStatus('CLAIM_APPROVED')).toBe('Claim approved')
    expect(humanizeStatus('DRAFT_REQUIRES_ZW_LEGAL_SIGNOFF')).toBe('Draft requires ZW legal signoff')
    expect(humanizeStatus(null)).toBe('Not recorded')
  })
})

describe('mergeCities', () => {
  it('keeps only cities the API returned, de-duplicated and sorted', () => {
    expect(mergeCities(['Harare'], [{ city: 'Bulawayo' }, { city: 'Harare' }, { city: ' ' }, { city: null }])).toEqual(['Bulawayo', 'Harare'])
  })
})

const base: ClaimJourneyInput = {
  claimStatus: 'AWAITING_DOCUMENTARY_EVIDENCE',
  evidence: [],
  draft: null,
  submissions: [],
  authority: null,
  detailsLoaded: true,
}
const states = (input: ClaimJourneyInput) => deriveClaimJourney(input).stages.map(stage => stage.state)

describe('deriveClaimJourney', () => {
  it('asks for evidence first, and nothing after the claim is reachable yet', () => {
    const journey = deriveClaimJourney(base)
    expect(journey.stages.map(stage => stage.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming'])
    expect(journey.next.target).toBe('claim-evidence')
  })

  it('treats uploaded evidence as waiting for review — never as done', () => {
    const journey = deriveClaimJourney({ ...base, evidence: [{ quarantined: false }, { quarantined: true }] })
    expect(journey.stages[0].state).toBe('waiting')
    expect(journey.stages[0].status).toContain('1 document submitted')
    expect(journey.stages.some(stage => stage.state === 'done')).toBe(false)
  })

  it('says "checking" rather than inventing status while the per-claim reads are in flight', () => {
    const journey = deriveClaimJourney({ ...base, claimStatus: 'CLAIM_APPROVED', detailsLoaded: false })
    expect(journey.stages.map(stage => stage.state)).toEqual(['done', 'unknown', 'unknown', 'unknown'])
  })

  it('walks an approved claim through application states from the real submission status', () => {
    const approved = { ...base, claimStatus: 'CLAIM_APPROVED', authority: { state: 'NOT_YET_ACTIVATED', operational: false } }
    expect(deriveClaimJourney(approved).stages[1]).toMatchObject({ state: 'current', status: 'Not started' })
    expect(deriveClaimJourney({ ...approved, draft: { submission_version: 2 } }).next.target).toBe('claim-submit')
    const waiting = { ...approved, draft: { submission_version: 1 }, submissions: [{ intake_version: 1, preliminary_status: 'AWAITING_PRELIMINARY_REVIEW', correction_reason: null }] }
    expect(states(waiting)).toEqual(['done', 'waiting', 'upcoming', 'upcoming'])
    const corrections = { ...waiting, submissions: [{ intake_version: 1, preliminary_status: 'NEEDS_CORRECTIONS', correction_reason: 'Upload the registration certificate' }] }
    const journey = deriveClaimJourney(corrections)
    expect(journey.stages[1].state).toBe('attention')
    expect(journey.next.body).toContain('Upload the registration certificate')
    const ready = { ...waiting, submissions: [{ intake_version: 1, preliminary_status: 'READY_FOR_REGULATORY_REVIEW', correction_reason: null }] }
    expect(states(ready)).toEqual(['done', 'done', 'waiting', 'upcoming'])
  })

  it('shows activation as done only for the server’s active authority, and carries its limits', () => {
    const journey = deriveClaimJourney({
      ...base,
      claimStatus: 'CLAIM_APPROVED',
      draft: { submission_version: 1 },
      submissions: [{ intake_version: 1, preliminary_status: 'READY_FOR_REGULATORY_REVIEW', correction_reason: null }],
      authority: { state: 'CANONICAL_DEALER_ACTIVE', operational: true, public_storefront_approved: false, vehicle_listing_authority_granted: false },
    })
    expect(journey.stages.map(stage => stage.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(journey.stages[3].detail).toBe('Public storefront not approved · vehicle listing authority not granted')
    expect(journey.next.href).toBe('/dealer/dashboard')
  })

  it('blocks activation and flags an expired legal review', () => {
    const journey = deriveClaimJourney({
      ...base,
      claimStatus: 'CLAIM_APPROVED',
      submissions: [{ intake_version: 1, preliminary_status: 'READY_FOR_REGULATORY_REVIEW', correction_reason: null }],
      authority: { state: 'DEALER_AUTHORITY_BLOCKED', operational: false, blocking_reasons: ['LEGAL_REVIEW_EXPIRED'] },
    })
    expect(journey.stages[2].state).toBe('attention')
    expect(journey.stages[3].state).toBe('blocked')
    expect(journey.next.target).toBe('claim-authority')
  })

  it('points a rejected claim to the appeal and never past it', () => {
    const journey = deriveClaimJourney({ ...base, claimStatus: 'CLAIM_REJECTED' })
    expect(journey.stages.map(stage => stage.state)).toEqual(['blocked', 'upcoming', 'upcoming', 'upcoming'])
    expect(journey.next.target).toBe('claim-appeal')
  })

  it('never reads an unavailable authority as active', () => {
    const journey = deriveClaimJourney({ ...base, claimStatus: 'CLAIM_APPROVED', authority: null })
    expect(journey.stages[2].state).toBe('unknown')
    expect(journey.stages[3].state).toBe('unknown')
  })
})
