import { beforeEach, describe, expect, it } from 'vitest'
import { clearGuestSellDraft, readGuestSellDraft, saveGuestSellDraft } from '@/lib/guestSellDraft'

const DRAFT = {
  submissionId: '123e4567-e89b-42d3-a456-426614174000',
  make: 'Toyota',
  model: 'Hilux',
  year: '2021',
  vin: 'JTDKARFP0H3000731',
  color: 'White',
  mileage: '45000',
  condition: 'Used',
  category: 'Pickup',
  fuelType: 'Diesel',
  transmission: 'Automatic',
  drivetrain: '4WD',
  location: 'Harare',
  province: 'Harare',
  price: '28500',
  currency: 'USD',
  description: 'Synthetic seller UAT draft with enough description for the journey.',
  engineNumber: '',
  chassisNumber: '',
  plateNumber: '',
  tempPlateId: '',
  importStatus: '',
  features: ['Reverse camera'],
  images: ['data:image/png;base64,front', 'data:image/png;base64,rear'],
  imageLabels: ['Front three-quarter', 'Rear'],
  coverImageIndex: 0,
  historyPlan: {
    import: 'now' as const,
    repair: 'later' as const,
  },
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('guest Seller continuity metadata', () => {
  it('carries photo angle labels, cover choice and evidence preparation through account handoff', async () => {
    expect((await saveGuestSellDraft(DRAFT)).ok).toBe(true)
    const restored = readGuestSellDraft()
    expect(restored?.imageLabels).toEqual(DRAFT.imageLabels)
    expect(restored?.coverImageIndex).toBe(0)
    expect(restored?.historyPlan).toEqual(DRAFT.historyPlan)
    expect(restored?.submissionId).toBe(DRAFT.submissionId)
  })

  it('keeps older v1 drafts compatible when the new workflow metadata is absent', () => {
    sessionStorage.setItem('carup_guest_sell_draft_v1', JSON.stringify({
      version: 1,
      saved_at: new Date().toISOString(),
      ...DRAFT,
      imageLabels: undefined,
      coverImageIndex: undefined,
      historyPlan: undefined,
    }))
    const restored = readGuestSellDraft()
    expect(restored?.imageLabels).toEqual([])
    expect(restored?.coverImageIndex).toBeNull()
    expect(restored?.historyPlan).toEqual({})
    expect(restored?.submissionId).toBe(DRAFT.submissionId)
  })

  it('clears the enriched draft with the same canonical key', async () => {
    await saveGuestSellDraft(DRAFT)
    clearGuestSellDraft()
    expect(readGuestSellDraft()).toBeNull()
  })
})
