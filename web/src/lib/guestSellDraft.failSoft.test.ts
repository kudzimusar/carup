/**
 * PR #194 hardening — persisting the browser crash-recovery copy can FAIL, and failing must never
 * cost the seller the save it exists to protect.
 *
 * `saveGuestSellDraft` guards every storage path it touches and returns `{ ok: false }` rather than
 * throwing — with one exception. Its no-media branch awaited `clearGuestSellMedia()` unguarded, and
 * `IDBDatabase.transaction()` throws SYNCHRONOUSLY: InvalidStateError on a closing connection,
 * NotFoundError when another tab's version upgrade has removed the object store. That rejection
 * propagated into `handleSubmit` ahead of `setSubmitting(true)`, so a seller pressing "Save as
 * Draft" on a listing with no photos got nothing at all — no spinner, no toast, no listing, no
 * error. A dead button is the worst possible reading of "your work is protected".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { saveGuestSellDraft } from './guestSellDraft'

const DRAFT = {
  submissionId: 'sub-1',
  make: 'Toyota',
  model: 'Aqua',
  year: '2017',
  vin: 'JTDKARFP0H3000731',
  color: 'Silver',
  mileage: '80000',
  condition: 'Good',
  category: 'Hatchback',
  fuelType: 'Hybrid',
  transmission: 'Automatic',
  drivetrain: 'FWD',
  location: 'Harare',
  province: 'Harare',
  price: '9500',
  currency: 'USD',
  description: 'A car.',
  engineNumber: 'ENG-1',
  chassisNumber: 'CHS-1',
  plateNumber: 'ABC1234',
  tempPlateId: '',
  importStatus: 'imported',
  features: [] as string[],
  // The failing branch is specifically the one taken when there is NO media to externalise.
  images: [] as string[],
  imageLabels: [] as string[],
  coverImageIndex: null as number | null,
  historyPlan: {},
  locationVisibility: 'withheld' as const,
  publicSellerDisplay: false,
  accidentDisclosure: null,
  insuranceDisclosure: null,
  financeDisclosure: null,
}

const originalIndexedDB = globalThis.indexedDB

/** An IndexedDB whose connection opens and then refuses to start a transaction. */
const stubBrokenIndexedDb = (close: () => void) => {
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => { throw new DOMException('The database connection is closing.', 'InvalidStateError') },
    close,
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open: () => {
        const request: Record<string, unknown> = { result: db, error: null }
        // The real API fires this asynchronously, after the caller has attached its handlers.
        queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.())
        return request
      },
    },
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDB })
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('saveGuestSellDraft is fail-soft on every path', () => {
  it('resolves rather than rejecting when the media store cannot start a transaction', async () => {
    const close = vi.fn()
    stubBrokenIndexedDb(close)

    // The assertion is simply that this does not reject. Before the fix it did.
    const result = await saveGuestSellDraft(DRAFT)

    expect(result.ok).toBe(true)
    expect(close, 'the connection must still be released').toHaveBeenCalled()
  })

  it('still persists every typed answer when the media store is broken', async () => {
    stubBrokenIndexedDb(vi.fn())

    await saveGuestSellDraft(DRAFT)

    // The durable checkpoint is written synchronously, BEFORE any IndexedDB await, precisely so a
    // media-store failure cannot cost the seller their typed answers.
    const durable = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key))
      .filter((raw): raw is string => typeof raw === 'string' && raw.includes('JTDKARFP0H3000731'))
    expect(durable.length, 'a recovery copy must survive the media-store failure').toBeGreaterThan(0)
    expect(JSON.parse(durable[0]).price).toBe('9500')
  })
})
