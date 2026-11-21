/**
 * RX-06 — the import request rules shared by the legacy form and the focused flow: identical messages,
 * identical body, step-scoped errors, and a tab-only draft that is sanitised on the way back in.
 */
import { describe, expect, it } from 'vitest'
import {
  IMPORT_DRAFT_KEY,
  INITIAL_IMPORT_REQUEST,
  IMPORT_REQUEST_STEPS,
  firstStepWithError,
  importRequestErrors,
  importRequestPayload,
  readImportDraft,
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
