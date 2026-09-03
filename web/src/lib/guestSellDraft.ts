import {
  parseAccidentDisclosure,
  parseFinanceDisclosure,
  parseInsuranceDisclosure,
  type AccidentDisclosure,
  type FinanceDisclosure,
  type InsuranceDisclosure,
} from './vehicleHistoryDisclosures'

export const GUEST_SELL_DRAFT_KEY = 'carup_guest_sell_draft_v1'
export const GUEST_SELL_STEP_KEY = 'carup_guest_sell_step_v1'
// Durable browser checkpoint for owner UAT and real Sellers. Session storage remains the fast
// same-tab copy, while localStorage preserves typed business fields across refresh/logout/relogin
// and browser restarts on the same device. Media bytes remain in IndexedDB.
export const GUEST_SELL_DURABLE_DRAFT_KEY = 'carup_guest_sell_draft_durable_v1'
export const GUEST_SELL_DURABLE_STEP_KEY = 'carup_guest_sell_step_durable_v1'

export function createSellerSubmissionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const GUEST_SELL_MEDIA_DB = 'carup_guest_sell_draft_media_v1'
const GUEST_SELL_MEDIA_STORE = 'draft_media'
const GUEST_SELL_MEDIA_KEY = 'active'

export interface GuestSellDraft {
  version: 1
  saved_at: string
  submissionId: string
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
  drivetrain: string
  location: string
  province: string
  price: string
  currency: string
  description: string
  engineNumber: string
  chassisNumber: string
  plateNumber: string
  tempPlateId: string
  /** Canonical Zimbabwe registration lifecycle. importStatus remains compatibility-only. */
  registrationStatus: string
  importStatus?: string
  features: string[]
  images: string[]
  imageLabels: string[]
  coverImageIndex: number | null
  historyPlan: Record<string, 'now' | 'later'>
  existingPassportConfirmed: boolean
  mediaExternalized: boolean
  locationVisibility?: 'withheld' | 'province_only' | 'public'
  publicSellerDisplay?: boolean
  // Vehicle History & Obligations (F18–F20). null = the Seller has not answered — the parser must
  // never turn an absent or invalid answer into a legitimate-looking one.
  accidentDisclosure: AccidentDisclosure | null
  insuranceDisclosure: InsuranceDisclosure | null
  financeDisclosure: FinanceDisclosure | null
}

// Same-tab continuity should never depend on a browser quota write. This cache survives React Router
// navigation through register/login and is cleared with the canonical draft. IndexedDB below is the
// durable browser fallback for hard reloads and for large camera files that exceed sessionStorage.
let volatileMedia: string[] | null = null

function openMediaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GUEST_SELL_MEDIA_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GUEST_SELL_MEDIA_STORE)) {
        request.result.createObjectStore(GUEST_SELL_MEDIA_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open guest Seller media store'))
  })
}

async function writeGuestSellMedia(images: string[]) {
  const db = await openMediaDb()
  if (!db) return false
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(GUEST_SELL_MEDIA_STORE, 'readwrite')
      tx.objectStore(GUEST_SELL_MEDIA_STORE).put(images, GUEST_SELL_MEDIA_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('Could not persist guest Seller media'))
      tx.onabort = () => reject(tx.error || new Error('Guest Seller media persistence aborted'))
    })
    return true
  } finally {
    db.close()
  }
}

async function readGuestSellMedia() {
  if (volatileMedia) return [...volatileMedia]
  const db = await openMediaDb()
  if (!db) return []
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(GUEST_SELL_MEDIA_STORE, 'readonly')
      const request = tx.objectStore(GUEST_SELL_MEDIA_STORE).get(GUEST_SELL_MEDIA_KEY)
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result.map(String) : [])
      request.onerror = () => reject(request.error || new Error('Could not restore guest Seller media'))
    })
  } finally {
    db.close()
  }
}

async function clearGuestSellMedia() {
  volatileMedia = null
  const db = await openMediaDb().catch(() => null)
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      // `db.transaction()` THROWS synchronously — InvalidStateError on a closing connection,
      // NotFoundError when another tab's version upgrade removed the store. Every other path here
      // resolves rather than rejects, and this one did not: it was the single unguarded await in an
      // otherwise fail-soft writer, and it reached `handleSubmit` as a rejected save. Clearing a
      // crash-recovery copy failing is never a reason to fail the save it was protecting.
      try {
        const tx = db.transaction(GUEST_SELL_MEDIA_STORE, 'readwrite')
        tx.objectStore(GUEST_SELL_MEDIA_STORE).delete(GUEST_SELL_MEDIA_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  } finally {
    db.close()
  }
}

export async function saveGuestSellDraft(
  draft: Omit<GuestSellDraft, 'version' | 'saved_at' | 'mediaExternalized' | 'existingPassportConfirmed'>
    & { existingPassportConfirmed?: boolean },
) {
  const payload: GuestSellDraft = {
    ...draft,
    version: 1,
    saved_at: new Date().toISOString(),
    existingPassportConfirmed: draft.existingPassportConfirmed === true,
    mediaExternalized: false,
  }

  volatileMedia = [...payload.images]

  // Write the lightweight checkpoint synchronously BEFORE any await. This is the "never start
  // again" guarantee for typed fields: even if navigation/deploy/logout interrupts the async media
  // write, all non-media Seller answers and media annotations survive on this browser.
  const durablePayload: GuestSellDraft = {
    ...payload,
    images: [],
    mediaExternalized: payload.images.length > 0,
  }
  try {
    localStorage.setItem(GUEST_SELL_DURABLE_DRAFT_KEY, JSON.stringify(durablePayload))
  } catch { /* sessionStorage/IndexedDB still provide best-effort recovery */ }

  // Keep media outside Web Storage so large camera galleries survive a browser restart without
  // repeatedly exhausting the 5–10 MB local/session quota.
  if (payload.images.length > 0) {
    try { await writeGuestSellMedia(payload.images) } catch { /* session copy may still hold them */ }
  } else {
    await clearGuestSellMedia()
    volatileMedia = []
  }

  try {
    // Small drafts stay self-contained and synchronous to read.
    sessionStorage.setItem(GUEST_SELL_DRAFT_KEY, JSON.stringify(payload))
    volatileMedia = [...payload.images]
    return { ok: true as const, media_externalized: payload.images.length > 0 }
  } catch {
    // Camera images routinely exceed the ~5–10 MB Web Storage budget. Preserve every business
    // field plus media annotations in sessionStorage, and move only the heavy image payload into
    // IndexedDB. Never silently convert "7 photos" into "0 photos" at the auth boundary.
    const metadataPayload = {
      ...payload,
      images: [] as string[],
      mediaExternalized: payload.images.length > 0,
    }
    try {
      sessionStorage.setItem(GUEST_SELL_DRAFT_KEY, JSON.stringify(metadataPayload))
    } catch {
      volatileMedia = null
      return { ok: false as const }
    }

    try {
      const persisted = await writeGuestSellMedia(payload.images)
      if (payload.images.length > 0 && !persisted) {
        sessionStorage.removeItem(GUEST_SELL_DRAFT_KEY)
        volatileMedia = null
        return { ok: false as const }
      }
      return { ok: true as const, media_externalized: payload.images.length > 0 }
    } catch {
      sessionStorage.removeItem(GUEST_SELL_DRAFT_KEY)
      volatileMedia = null
      return { ok: false as const }
    }
  }
}

function parseGuestSellDraft(raw: string): GuestSellDraft | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GuestSellDraft>
    if (parsed.version !== 1 || typeof parsed.vin !== 'string') return null
    const storedImages = Array.isArray(parsed.images) ? parsed.images : []
    const images = storedImages.length > 0 ? storedImages : (volatileMedia ? [...volatileMedia] : [])
    return {
      version: 1,
      saved_at: typeof parsed.saved_at === 'string' ? parsed.saved_at : '',
      submissionId: typeof parsed.submissionId === 'string' && parsed.submissionId ? parsed.submissionId : createSellerSubmissionId(),
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
      drivetrain: parsed.drivetrain || '',
      location: parsed.location || '',
      province: parsed.province || '',
      price: parsed.price || '',
      currency: parsed.currency || '',
      description: parsed.description || '',
      engineNumber: parsed.engineNumber || '',
      chassisNumber: parsed.chassisNumber || '',
      plateNumber: parsed.plateNumber || '',
      tempPlateId: parsed.tempPlateId || '',
      registrationStatus: parsed.registrationStatus || parsed.importStatus || '',
      importStatus: parsed.importStatus || '',
      features: Array.isArray(parsed.features) ? parsed.features : [],
      images,
      imageLabels: Array.isArray(parsed.imageLabels) ? parsed.imageLabels.map(value => String(value || '')) : [],
      coverImageIndex: typeof parsed.coverImageIndex === 'number' && Number.isInteger(parsed.coverImageIndex)
        ? parsed.coverImageIndex
        : null,
      historyPlan: parsed.historyPlan && typeof parsed.historyPlan === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.historyPlan)
              .filter(([, value]) => value === 'now' || value === 'later')
          ) as Record<string, 'now' | 'later'>
        : {},
      existingPassportConfirmed: parsed.existingPassportConfirmed === true,
      mediaExternalized: parsed.mediaExternalized === true,
      locationVisibility:
        parsed.locationVisibility === 'public' || parsed.locationVisibility === 'province_only'
          ? parsed.locationVisibility
          : 'withheld',
      publicSellerDisplay: parsed.publicSellerDisplay === true,
      accidentDisclosure: parseAccidentDisclosure(parsed.accidentDisclosure),
      insuranceDisclosure: parseInsuranceDisclosure(parsed.insuranceDisclosure),
      financeDisclosure: parseFinanceDisclosure(parsed.financeDisclosure),
    }
  } catch {
    return null
  }
}

export function readGuestSellDraft(): GuestSellDraft | null {
  const candidates: GuestSellDraft[] = []
  try {
    const sessionRaw = sessionStorage.getItem(GUEST_SELL_DRAFT_KEY)
    const sessionDraft = sessionRaw ? parseGuestSellDraft(sessionRaw) : null
    if (sessionDraft) candidates.push(sessionDraft)
  } catch { /* continue to durable browser copy */ }
  try {
    const durableRaw = localStorage.getItem(GUEST_SELL_DURABLE_DRAFT_KEY)
    const durableDraft = durableRaw ? parseGuestSellDraft(durableRaw) : null
    if (durableDraft) candidates.push(durableDraft)
  } catch { /* no durable storage available */ }
  if (candidates.length === 0) return null
  return candidates.sort((a, b) =>
    Date.parse(b.saved_at || '') - Date.parse(a.saved_at || '')
  )[0]
}

export async function readGuestSellDraftWithMedia(): Promise<GuestSellDraft | null> {
  const draft = readGuestSellDraft()
  if (!draft || draft.images.length > 0 || !draft.mediaExternalized) return draft

  try {
    const images = await readGuestSellMedia()
    if (images.length === 0) return draft
    volatileMedia = [...images]
    return { ...draft, images }
  } catch {
    return draft
  }
}

export function readGuestSellStep() {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const raw = storage.getItem(storage === sessionStorage ? GUEST_SELL_STEP_KEY : GUEST_SELL_DURABLE_STEP_KEY)
      const parsed = Number(raw)
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 3) return parsed
    } catch { /* try the next browser store */ }
  }
  return 0
}

export function saveGuestSellStep(step: number) {
  const normalized = Math.max(0, Math.min(3, Math.trunc(Number(step) || 0)))
  try { sessionStorage.setItem(GUEST_SELL_STEP_KEY, String(normalized)) } catch { /* best effort */ }
  try { localStorage.setItem(GUEST_SELL_DURABLE_STEP_KEY, String(normalized)) } catch { /* best effort */ }
}

export function clearGuestSellDraft() {
  try {
    sessionStorage.removeItem(GUEST_SELL_DRAFT_KEY)
    sessionStorage.removeItem(GUEST_SELL_STEP_KEY)
  } catch { /* best effort */ }
  try {
    localStorage.removeItem(GUEST_SELL_DURABLE_DRAFT_KEY)
    localStorage.removeItem(GUEST_SELL_DURABLE_STEP_KEY)
  } catch { /* best effort */ }
  volatileMedia = null
  void clearGuestSellMedia()
}
