import { describe, expect, it } from 'vitest'
import { draftReviewGroups } from './dealerDraftReview'

const preview = {
  research_candidates: {
    BUSINESS: { research_display_name: 'FIXTURE MOTORS' },
    BRANCHES: { branch_name: 'FIXTURE MOTORS', physical_address: '1 Fixture Road', suburb: '', city: 'Harare', business_contact_phone: '+263 1' },
  },
  field_labels: {
    BUSINESS: { claim_reference: 'Claim reference — server-validated', research_display_name: 'Researched display name (candidate)',
      legal_name: 'Registered legal name', trading_name: 'Confirmed trading name' },
    BRANCHES: { branch_ref: 'Branch reference — stable key', branch_name: 'Branch/trading location name',
      physical_address: 'Branch physical address', city: 'City/town', gps_latitude: 'Latitude -90 to 90',
      business_contact_phone: 'Public business phone proposed' },
  },
}

describe('Owner UAT D4 — review what CarUp read from the workbook', () => {
  it('lists the typed values in contract order with the workbook labels, without server references', () => {
    const { groups } = draftReviewGroups({ BUSINESS: [{ claim_reference: 'c-1', legal_name: 'Fixture Ltd', research_display_name: 'FIXTURE MOTORS' }] }, preview)
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('BUSINESS')
    expect(groups[0].lines.map((l) => l.label)).toEqual(['Researched display name (candidate)', 'Registered legal name'])
  })

  it('marks a corrected researched value and counts it, ignoring case and spaces', () => {
    const { groups, changedCount } = draftReviewGroups({
      BRANCHES: [
        { branch_ref: 'BR-1', branch_name: ' fixture motors ', physical_address: '1 Fixture Road', city: 'Harare North',
          gps_latitude: '-17.8', business_contact_phone: '' },
        { branch_ref: 'BR-2', branch_name: 'Second Yard', city: 'Harare' },
      ],
    }, preview)
    const first = groups.find((g) => g.row === 1)!
    expect(first.title).toBe('BRANCHES · row 1')
    const city = first.lines.find((l) => l.key === 'city')!
    expect(city).toMatchObject({ value: 'Harare North', research: 'Harare', changed: true })
    expect(first.lines.find((l) => l.key === 'branch_name')!.changed).toBe(false)
    const phone = first.lines.find((l) => l.key === 'business_contact_phone')!
    expect(phone).toMatchObject({ value: '', research: '+263 1', changed: true })
    expect(changedCount).toBe(2)
    // only the researched (first) branch is compared; a new branch is never "changed from research"
    expect(groups.find((g) => g.row === 2)!.lines.every((l) => !l.changed)).toBe(true)
  })

  it('lists tabs in workbook order, whatever order the draft was stored in', () => {
    const { groups } = draftReviewGroups({ BRANCHES: [{ city: 'Harare' }], BUSINESS: [{ legal_name: 'Fixture Ltd' }] }, preview)
    expect(groups.map((g) => g.tab)).toEqual(['BUSINESS', 'BRANCHES'])
  })

  it('works without a comparison (research read unavailable) and with an empty draft', () => {
    const { groups, changedCount } = draftReviewGroups({ BUSINESS: [{ legal_name: 'Fixture Ltd' }] }, { ...preview, research_candidates: null })
    expect(changedCount).toBe(0)
    expect(groups[0].lines).toEqual([{ key: 'legal_name', label: 'Registered legal name', value: 'Fixture Ltd', changed: false }])
    expect(draftReviewGroups(undefined, null)).toEqual({ groups: [], changedCount: 0 })
    expect(draftReviewGroups({ 'README - Instructions': [{ topic: 'x' }], BUSINESS: [{}] }, preview).groups.map((g) => g.tab))
      .toEqual(['BUSINESS'])
  })
})
