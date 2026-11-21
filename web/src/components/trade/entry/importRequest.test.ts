/**
 * RX-06 — the import request rules shared by the legacy form and the focused flow: identical messages,
 * identical body, step-scoped errors, and a tab-only draft that is sanitised on the way back in.
 */
import { describe, expect, it } from 'vitest'
import {
  GUEST_DRAFT_OWNER,
  IMPORT_DRAFT_KEY,
  IMPORT_DRAFT_TTL_MS,
  INITIAL_IMPORT_REQUEST,
  IMPORT_REQUEST_STEPS,
  firstStepWithError,
  importDraftOwner,
  importRequestErrors,
  importRequestPayload,
  isImportDraftLive,
  readImportDraft,
  restoreImportDraft,
  restoredDraftStep,
  stepErrors,
  writeImportDraft,
} from './importRequest'

const FILLED = {
  ...INITIAL_IMPORT_REQUEST,
  origin_country: 'Japan', origin_city: 'Yokohama', destination_city: 'Harare',
  requested_make: 'Toyota', requested_model: 'Aqua', requested_year_min: 2018, budget_amount: 9000,
}

describe('legacy rules, unchanged', () => {
  it('names every missing field with the legacy message', () => {
    expect(importRequestErrors({ ...INITIAL_IMPORT_REQUEST, requested_year_min: undefined })).toEqual({
      origin_country: 'Origin country is required.',
      origin_city: 'Origin city is required.',
      destination_city: 'Destination city is required.',
      requested_make: 'Make is required.',
      requested_model: 'Model is required.',
      requested_year_min: 'Enter a valid vehicle year.',
      budget_amount: 'Budget is required.',
    })
    expect(importRequestErrors(FILLED)).toEqual({})
  })
  it('sends one model year and a numeric budget, nothing else changed', () => {
    expect(importRequestPayload({ ...FILLED, requested_year_max: 2024, budget_amount: '9000' as unknown as number })).toEqual({
      ...FILLED, requested_year_max: 2018, budget_amount: 9000,
    })
  })
})

describe('steps', () => {
  it('each field belongs to exactly one step and errors are scoped to it', () => {
    const fields = IMPORT_REQUEST_STEPS.flatMap(s => s.fields)
    expect(new Set(fields).size).toBe(fields.length)
    expect(Object.keys(stepErrors(INITIAL_IMPORT_REQUEST, 2)).sort()).toEqual(['destination_city', 'origin_city', 'origin_country'])
    expect(stepErrors(INITIAL_IMPORT_REQUEST, 0)).toEqual({})
    expect(firstStepWithError(importRequestErrors({ ...FILLED, budget_amount: undefined }))).toBe(3)
  })
})

describe('tab-only draft', () => {
  it('round-trips through sessionStorage and drops anything unexpected', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    writeImportDraft(FILLED, 2, storage)
    expect(readImportDraft(storage)).toMatchObject({ form: FILLED, step: 2 })
    store.set(IMPORT_DRAFT_KEY, JSON.stringify({ form: { ...FILLED, order_type: 'spaceship', budget_amount: 'lots', injected: '<b>x</b>' }, step: 99 }))
    const back = readImportDraft(storage)!
    expect(back.form.order_type).toBe('vehicle')
    expect(back.form.budget_amount).toBeUndefined()
    expect(back.form).not.toHaveProperty('injected')
    expect(back.step).toBe(0)
    store.set(IMPORT_DRAFT_KEY, '{not json')
    expect(readImportDraft(storage)).toBeNull()
  })
})

/* ── LR02: the draft names its owner and expires; only its owner (or, for a guest's draft, the account
      that signs in from the same tab) gets it back, and only before it expires. ── */

const NOW = Date.parse('2026-11-21T09:00:00Z')
const HOUR = 60 * 60 * 1000
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
}
const stored = (s: ReturnType<typeof memoryStorage>) => JSON.parse(s.store.get(IMPORT_DRAFT_KEY) ?? 'null')

describe('LR02 draft owner and expiry', () => {
  it('writes the owner, a 12-hour expiry and the whitelisted answers only (never metadata)', () => {
    const s = memoryStorage()
    writeImportDraft({ ...FILLED, metadata: { injected: 'x' }, budget_currency: 'ZWG' }, 4, s, GUEST_DRAFT_OWNER, NOW)
    const raw = stored(s)
    expect(raw.owner).toBe('guest')
    expect(Date.parse(raw.expiresAt) - NOW).toBe(IMPORT_DRAFT_TTL_MS)
    expect(IMPORT_DRAFT_TTL_MS).toBe(12 * HOUR)
    expect(Object.keys(raw.form).sort()).toEqual(['budget_amount', 'destination_city', 'order_type', 'origin_city', 'origin_country', 'requested_make', 'requested_model', 'requested_year_min'])
    // A stored draft that carries metadata anyway never gives it back.
    s.store.set(IMPORT_DRAFT_KEY, JSON.stringify({ ...raw, form: { ...raw.form, metadata: { injected: 'x' }, budget_currency: 'ZWG' } }))
    const back = restoreImportDraft('guest', s, NOW)
    expect(back.kind).toBe('own')
    if (back.kind !== 'own') return
    expect(back.draft.form).not.toHaveProperty('metadata')
    expect(back.draft.form.budget_currency).toBe('USD')
  })

  it('a guest draft comes back to the guest as their own, and to an account that signs in as "from-guest"', () => {
    const s = memoryStorage()
    writeImportDraft(FILLED, 4, s, GUEST_DRAFT_OWNER, NOW)
    expect(restoreImportDraft('guest', s, NOW + HOUR)).toMatchObject({ kind: 'own', draft: { owner: 'guest', step: 4, form: FILLED } })
    expect(restoreImportDraft('fx-account-a', s, NOW + HOUR)).toMatchObject({ kind: 'from-guest', draft: { owner: 'guest', form: FILLED } })
    expect(s.store.has(IMPORT_DRAFT_KEY)).toBe(true)
  })

  it('an account’s own draft comes back to that account', () => {
    const s = memoryStorage()
    writeImportDraft(FILLED, 2, s, 'fx-account-a', NOW)
    expect(restoreImportDraft('fx-account-a', s, NOW)).toMatchObject({ kind: 'own', draft: { owner: 'fx-account-a', step: 2 } })
  })

  it('a draft owned by a different account is discarded — for another account and for a guest alike', () => {
    for (const opener of ['fx-account-b', GUEST_DRAFT_OWNER]) {
      const s = memoryStorage()
      writeImportDraft(FILLED, 4, s, 'fx-account-a', NOW)
      expect(restoreImportDraft(opener, s, NOW)).toEqual({ kind: 'none', discarded: 'other-owner' })
      expect(s.store.has(IMPORT_DRAFT_KEY)).toBe(false)
    }
  })

  it('a draft that names no owner (written before LR02, or without one) is discarded', () => {
    const s = memoryStorage()
    writeImportDraft(FILLED, 4, s, undefined, NOW)
    expect(restoreImportDraft('guest', s, NOW)).toEqual({ kind: 'none', discarded: 'other-owner' })
    expect(s.store.has(IMPORT_DRAFT_KEY)).toBe(false)
    s.store.set(IMPORT_DRAFT_KEY, JSON.stringify({ form: FILLED, step: 4, savedAt: new Date(NOW).toISOString() }))
    expect(restoreImportDraft('guest', s, NOW)).toMatchObject({ kind: 'none' })
    expect(s.store.has(IMPORT_DRAFT_KEY)).toBe(false)
  })

  it('expires 12 hours after the last change and is then discarded; an expiry further out than that is not trusted', () => {
    const s = memoryStorage()
    writeImportDraft(FILLED, 4, s, GUEST_DRAFT_OWNER, NOW)
    expect(restoreImportDraft('guest', s, NOW + 12 * HOUR - 1).kind).toBe('own')
    expect(restoreImportDraft('guest', s, NOW + 12 * HOUR)).toEqual({ kind: 'none', discarded: 'expired' })
    expect(s.store.has(IMPORT_DRAFT_KEY)).toBe(false)
    expect(isImportDraftLive({ expiresAt: new Date(NOW + 13 * HOUR).toISOString() }, NOW)).toBe(false)
    expect(isImportDraftLive({ expiresAt: null }, NOW)).toBe(false)
    expect(isImportDraftLive({ expiresAt: 'not a date' }, NOW)).toBe(false)
  })

  it('an unreadable draft is discarded; no draft is simply nothing', () => {
    const s = memoryStorage()
    expect(restoreImportDraft('guest', s, NOW)).toEqual({ kind: 'none', discarded: null })
    s.store.set(IMPORT_DRAFT_KEY, '{not json')
    expect(restoreImportDraft('guest', s, NOW)).toEqual({ kind: 'none', discarded: 'unreadable' })
    expect(s.store.has(IMPORT_DRAFT_KEY)).toBe(false)
  })

  it('the owner of a page: guest when signed out, the account id when signed in, nobody when the id is unusable', () => {
    expect(importDraftOwner(false, 'fx-account-a')).toBe('guest')
    expect(importDraftOwner(true, 'fx-account-a')).toBe('fx-account-a')
    expect(importDraftOwner(true, undefined)).toBeNull()
    expect(importDraftOwner(true, '  ')).toBeNull()
    expect(importDraftOwner(true, 'guest')).toBeNull()
  })

  it('a draft restored after sign-in opens on the review when complete, else on the first step still needing an answer', () => {
    expect(restoredDraftStep(FILLED)).toBe(IMPORT_REQUEST_STEPS.length - 1)
    expect(restoredDraftStep({ ...FILLED, origin_city: '' })).toBe(2)
  })
})
