/**
 * TI-10 / TI-24 — signing out must not cost a guest their Sell draft, INCLUDING its photos.
 *
 * The guest Sell draft lives in two browser stores (lib/guestSellDraft.ts):
 *   - localStorage `carup_guest_sell_draft_durable_v1` — every typed answer plus media annotations;
 *   - IndexedDB `carup_guest_sell_draft_media_v1` / `draft_media` / `active` — the photos themselves,
 *     kept out of Web Storage because camera images exceed its quota.
 * AuthContext.test.tsx already proves the localStorage key survives logout(). This file proves the
 * IndexedDB media survives too, end to end: save a draft with photos → sign in → `await logout()`
 * (server revocation confirmed) → simulate a reload (fresh module, empty sessionStorage) → the draft
 * is restored WITH its photos from IndexedDB.
 *
 * jsdom ships no IndexedDB, so a small in-memory implementation of the subset guestSellDraft.ts uses
 * (open/upgrade, readwrite put/delete, readonly get, deleteDatabase) stands in for the browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

const apiRequestMock = vi.fn()
vi.mock('@/lib/apiClient', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/apiClient')>()
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) }
})
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const MEDIA_DB = 'carup_guest_sell_draft_media_v1'
const MEDIA_STORE = 'draft_media'
const MEDIA_KEY = 'active'
const DURABLE_DRAFT_KEY = 'carup_guest_sell_draft_durable_v1'

/* ── Minimal in-memory IndexedDB (only what guestSellDraft.ts calls) ─────────────────────────── */

type Stores = Map<string, Map<string, unknown>>
function createMemoryIndexedDb() {
  const databases = new Map<string, Stores>()
  const deleted: string[] = []
  const later = (fn: () => void) => setTimeout(fn, 0)
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  function connection(stores: Stores) {
    return {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => { stores.set(name, new Map()) },
      close: () => {},
      transaction: (name: string) => {
        if (!stores.has(name)) throw new DOMException(`No object store ${name}`, 'NotFoundError')
        const tx: Record<string, unknown> = { error: null }
        const done = () => later(() => (tx.oncomplete as (() => void) | undefined)?.())
        tx.objectStore = () => ({
          put: (value: unknown, key: string) => { stores.get(name)!.set(key, clone(value)); done() },
          delete: (key: string) => { stores.get(name)!.delete(key); done() },
          get: (key: string) => {
            const request: Record<string, unknown> = { error: null }
            later(() => {
              const value = stores.get(name)!.get(key)
              request.result = value === undefined ? undefined : clone(value)
              ;(request.onsuccess as (() => void) | undefined)?.()
              done()
            })
            return request
          },
        })
        return tx
      },
    }
  }

  const factory = {
    open: (name: string) => {
      const request: Record<string, unknown> = { error: null }
      later(() => {
        const isNew = !databases.has(name)
        if (isNew) databases.set(name, new Map())
        request.result = connection(databases.get(name)!)
        if (isNew) (request.onupgradeneeded as (() => void) | undefined)?.()
        ;(request.onsuccess as (() => void) | undefined)?.()
      })
      return request
    },
    deleteDatabase: (name: string) => {
      deleted.push(name)
      databases.delete(name)
      return {}
    },
  }
  return {
    factory,
    deleted,
    media: () => databases.get(MEDIA_DB)?.get(MEDIA_STORE)?.get(MEDIA_KEY),
  }
}

/* ── Fixtures ────────────────────────────────────────────────────────────────────────────────── */

// Fictional vehicle; the "photos" are tiny placeholder data URLs.
const PHOTOS = ['data:image/jpeg;base64,VEkxMC1QSE9UTy0x', 'data:image/jpeg;base64,VEkxMC1QSE9UTy0y']
const DRAFT = {
  submissionId: 'ti10-draft-submission',
  make: 'Toyota', model: 'Aqua', year: '2017', vin: 'TI10DRAFTVIN00001', color: 'Silver',
  mileage: '80000', condition: 'Good', category: 'Hatchback', fuelType: 'Hybrid',
  transmission: 'Automatic', drivetrain: 'FWD', location: 'Harare', province: 'Harare',
  price: '9500', currency: 'USD', description: 'Fictional draft for the TI-10 sign-out test.',
  engineNumber: 'ENG-TI10', chassisNumber: 'CHS-TI10', plateNumber: '', tempPlateId: '',
  registrationStatus: 'imported', importStatus: 'imported', features: [] as string[],
  images: PHOTOS, imageLabels: ['Front', 'Rear'], coverImageIndex: 0, historyPlan: {},
  locationVisibility: 'withheld' as const, publicSellerDisplay: false,
  accidentDisclosure: null, insuranceDisclosure: null, financeDisclosure: null,
}

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useAuth>) => void }) {
  onReady(useAuth())
  return null
}

/** Let every queued fake-IndexedDB callback (setTimeout 0 chains) run. */
const settleBrowserStores = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

const originalIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB
let idb: ReturnType<typeof createMemoryIndexedDb>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  apiRequestMock.mockReset()
  idb = createMemoryIndexedDb()
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: idb.factory })
})
afterEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDB })
  localStorage.clear()
  sessionStorage.clear()
})

describe('TI-10 — sign-out preserves the guest Sell draft and its IndexedDB photos', () => {
  it('after `await logout()` and a reload, the draft is restored WITH its photos from IndexedDB', async () => {
    // 1. A guest saves a draft with photos: typed answers → localStorage, photos → IndexedDB.
    vi.resetModules()
    const before = await import('@/lib/guestSellDraft')
    const saved = await before.saveGuestSellDraft(DRAFT)
    await settleBrowserStores()
    expect(saved.ok).toBe(true)
    expect(idb.media(), 'precondition: the photos are in IndexedDB').toEqual(PHOTOS)
    const durableBefore = localStorage.getItem(DURABLE_DRAFT_KEY)
    expect(durableBefore, 'precondition: the durable typed-answer copy exists').not.toBeNull()
    expect(JSON.parse(durableBefore!).mediaExternalized).toBe(true)

    // 2. They sign in, then sign out; the server confirms revocation.
    let api!: ReturnType<typeof useAuth>
    render(<AuthProvider><Probe onReady={a => { api = a }} /></AuthProvider>)
    act(() => {
      api.login({ id: 'u-ti10', name: 'Fictional Seller', email: 'seller@example.invalid', role: 'owner' } as never, 'ti10-presenting-token')
    })
    apiRequestMock.mockResolvedValueOnce({ success: true })
    let outcome: string | undefined
    await act(async () => { outcome = await api.logout() })
    await settleBrowserStores()
    expect(outcome).toBe('revoked')
    expect(api.isAuthenticated).toBe(false)

    // 3. Both stores are untouched by sign-out.
    expect(localStorage.getItem(DURABLE_DRAFT_KEY), 'the durable draft copy survives sign-out').toBe(durableBefore)
    expect(idb.deleted, 'sign-out never deletes the draft-media database').not.toContain(MEDIA_DB)
    expect(idb.media(), 'the photos are still in IndexedDB after sign-out').toEqual(PHOTOS)

    // 4. Reload: a fresh module (no in-memory media cache) and an empty sessionStorage, so the
    //    photos can ONLY come back from IndexedDB.
    sessionStorage.clear()
    vi.resetModules()
    const after = await import('@/lib/guestSellDraft')
    const restored = await after.readGuestSellDraftWithMedia()
    expect(restored?.vin).toBe(DRAFT.vin)
    expect(restored?.price).toBe(DRAFT.price)
    expect(restored?.imageLabels).toEqual(['Front', 'Rear'])
    expect(restored?.images, 'the photos are restored from IndexedDB after sign-out').toEqual(PHOTOS)
  })
})
