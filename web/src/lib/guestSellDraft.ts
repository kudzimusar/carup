export const GUEST_SELL_DRAFT_KEY = 'carup_guest_sell_draft_v1'

export interface GuestSellDraft {
  version: 1
  saved_at: string
  make: string
  model: string
  year: string
  vin: string
  color: string
  mileage: string
  condition: string
  category: string
  fuelType: string
  transmission: string
  location: string
  province: string
  price: string
  currency: string
  description: string
  engineNumber: string
  chassisNumber: string
  plateNumber: string
  tempPlateId: string
  importStatus: string
  features: string[]
  images: string[]
}

export function saveGuestSellDraft(draft: Omit<GuestSellDraft, 'version' | 'saved_at'>) {
  const payload: GuestSellDraft = {
    ...draft,
    version: 1,
    saved_at: new Date().toISOString(),
  }
  try {
    sessionStorage.setItem(GUEST_SELL_DRAFT_KEY, JSON.stringify(payload))
    return { ok: true as const }
  } catch {
    // Large camera files can exceed sessionStorage. Keep the business fields and ask the newly
    // authenticated seller to re-attach the images rather than silently dropping the whole draft.
    try {
      sessionStorage.setItem(GUEST_SELL_DRAFT_KEY, JSON.stringify({ ...payload, images: [] }))
      return { ok: true as const, images_omitted: true as const }
    } catch {
      return { ok: false as const }
    }
  }
}

export function readGuestSellDraft(): GuestSellDraft | null {
  try {
    const raw = sessionStorage.getItem(GUEST_SELL_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GuestSellDraft>
    if (parsed.version !== 1 || typeof parsed.vin !== 'string') return null
    return {
      version: 1,
      saved_at: typeof parsed.saved_at === 'string' ? parsed.saved_at : '',
      make: parsed.make || '',
      model: parsed.model || '',
      year: parsed.year || '',
      vin: parsed.vin || '',
      color: parsed.color || '',
      mileage: parsed.mileage || '',
      condition: parsed.condition || '',
      category: parsed.category || '',
      fuelType: parsed.fuelType || '',
      transmission: parsed.transmission || '',
      location: parsed.location || '',
      province: parsed.province || '',
      price: parsed.price || '',
      currency: parsed.currency || '',
      description: parsed.description || '',
      engineNumber: parsed.engineNumber || '',
      chassisNumber: parsed.chassisNumber || '',
      plateNumber: parsed.plateNumber || '',
      tempPlateId: parsed.tempPlateId || '',
      importStatus: parsed.importStatus || '',
      features: Array.isArray(parsed.features) ? parsed.features : [],
      images: Array.isArray(parsed.images) ? parsed.images : [],
    }
  } catch {
    return null
  }
}

export function clearGuestSellDraft() {
  try { sessionStorage.removeItem(GUEST_SELL_DRAFT_KEY) } catch { /* best effort */ }
}
