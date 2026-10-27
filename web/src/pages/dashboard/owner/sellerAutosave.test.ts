/**
 * T11-CAP-LR01-R3 (Moderator D-1) — the policy that makes opening the Seller Studio a read.
 *
 * The component tests prove the Studio obeys it; these prove the policy itself: what an autosave says, when two payloads are the
 * same payload, and what the server is known to hold. The properties that matter most are the two that look like opposites —
 * an UNCHANGED form is never written (so viewing a vehicle cannot create Seller state), and a CHANGED form always is (so
 * the guard can never swallow an edit, including the edit that merely undoes another).
 */
import { describe, it, expect } from 'vitest'
import { autosavePayloadKey, buildAutosavePayload, createAutosaveLedger, type SellerAutosaveFields } from './sellerAutosave'

const fields = (over: Partial<SellerAutosaveFields> = {}): SellerAutosaveFields => ({
  description: 'A clean, well kept minivan.', features: ['Clean', 'Hybrid'], category: 'Minivan', condition: 'Used',
  price: '12800', currency: 'USD', location: 'Harare', province: 'Harare', locationVisibility: 'public', publicSellerDisplay: true,
  accidentDisclosure: null, insuranceDisclosure: null, financeDisclosure: null, ...over,
})
const ACCIDENT = { status: 'none_known', details: '' } as unknown as NonNullable<SellerAutosaveFields['accidentDisclosure']>

describe('buildAutosavePayload — what an autosave says', () => {
  it('always states the seller-controlled text, condition, location and the two consent flags', () => {
    expect(buildAutosavePayload(fields())).toEqual({
      description: 'A clean, well kept minivan.', features: ['Clean', 'Hybrid'], body_style: 'Minivan', seller_stated_condition: 'Used',
      price: 12800, currency: 'USD', location: 'Harare', province: 'Harare', location_visibility: 'public', public_seller_display_enabled: true,
    })
  })

  it.each([['', 'empty'], ['0', 'zero'], ['-5', 'negative'], ['abc', 'not a number'], ['NaN', 'NaN']])('does not state a price of %j (%s): an unstated price is not a price', (price) => {
    expect(buildAutosavePayload(fields({ price }))).not.toHaveProperty('price')
  })

  it('states a currency only when the seller chose one', () => {
    expect(buildAutosavePayload(fields({ currency: '' }))).not.toHaveProperty('currency')
    expect(buildAutosavePayload(fields({ currency: 'ZiG' }))).toHaveProperty('currency', 'ZiG')
  })

  it('sends only ANSWERED disclosures, so an autosave can never retract an answer the seller did not change', () => {
    const none = buildAutosavePayload(fields())
    expect(none).not.toHaveProperty('accident_disclosure')
    expect(none).not.toHaveProperty('insurance_disclosure')
    expect(none).not.toHaveProperty('finance_disclosure')
    expect(buildAutosavePayload(fields({ accidentDisclosure: ACCIDENT }))).toHaveProperty('accident_disclosure', ACCIDENT)
  })

  it('never reads anything the Studio does not let an autosave write (no identity, no publication state)', () => {
    const keys = Object.keys(buildAutosavePayload(fields({ accidentDisclosure: ACCIDENT })))
    for (const forbidden of ['vin', 'make', 'model', 'year', 'owner_id', 'publication_status', 'status', 'import_source']) expect(keys).not.toContain(forbidden)
  })
})

describe('autosavePayloadKey — when two payloads are the same payload', () => {
  it('ignores key order, at every depth', () => {
    const a = { description: 'x', accident_disclosure: { status: 'a', details: 'b' } } as never
    const b = { accident_disclosure: { details: 'b', status: 'a' }, description: 'x' } as never
    expect(autosavePayloadKey(a)).toBe(autosavePayloadKey(b))
  })

  it('keeps array order: the order of a seller’s features is part of what they wrote', () => {
    expect(autosavePayloadKey({ features: ['A', 'B'] })).not.toBe(autosavePayloadKey({ features: ['B', 'A'] }))
  })

  it('ignores undefined keys, and nothing else', () => {
    expect(autosavePayloadKey({ description: 'x', price: undefined })).toBe(autosavePayloadKey({ description: 'x' }))
    expect(autosavePayloadKey({ description: 'x' })).not.toBe(autosavePayloadKey({ description: 'x ' }))
    expect(autosavePayloadKey({ description: '' })).not.toBe(autosavePayloadKey({}))
  })

  it('tells 12800 from 12800.5 and "" from absent', () => {
    expect(autosavePayloadKey({ price: 12800 })).not.toBe(autosavePayloadKey({ price: 12800.5 }))
    expect(autosavePayloadKey({ location: '' })).not.toBe(autosavePayloadKey({}))
  })
})

describe('the ledger — what the server is known to hold', () => {
  const original = buildAutosavePayload(fields())
  const edited = buildAutosavePayload(fields({ publicSellerDisplay: false }))

  it('knows nothing until the draft is loaded: nothing is clean, so a new listing is never held back', () => {
    const ledger = createAutosaveLedger()
    expect(ledger.isClean(original)).toBe(false)
  })

  it('after the draft is loaded, an unchanged form is clean — however its keys happen to be ordered', () => {
    const ledger = createAutosaveLedger()
    ledger.seed(original)
    expect(ledger.isClean(original)).toBe(true)
    expect(ledger.isClean(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(original).reverse()))))).toBe(true)
  })

  it('a changed form is never clean', () => {
    const ledger = createAutosaveLedger()
    ledger.seed(original)
    expect(ledger.isClean(edited)).toBe(false)
  })

  it('once the server acknowledges a save, THAT is what it holds — the old baseline is gone', () => {
    const ledger = createAutosaveLedger()
    ledger.seed(original)
    ledger.issue()
    ledger.confirm(edited)
    expect(ledger.isClean(edited)).toBe(true)
    expect(ledger.isClean(original)).toBe(false)
  })

  it('while a save is in flight NOTHING is clean — not even the original — so undoing an edit is itself saved', () => {
    const ledger = createAutosaveLedger()
    ledger.seed(original)
    ledger.issue()
    expect(ledger.isClean(original)).toBe(false)
    expect(ledger.isClean(edited)).toBe(false)
  })

  it('a save that was never acknowledged leaves nothing clean (the outcome is unknown, so the next change is written)', () => {
    const ledger = createAutosaveLedger()
    ledger.seed(original)
    ledger.issue()
    // …the response never confirms (failed, or superseded by a newer edit)…
    expect(ledger.isClean(original)).toBe(false)
  })

  it('loading a draft again starts from what was just read, whatever was in flight before', () => {
    const ledger = createAutosaveLedger()
    ledger.seed(original)
    ledger.issue()
    ledger.seed(edited)
    expect(ledger.isClean(edited)).toBe(true)
  })

  it('is independent per instance', () => {
    const a = createAutosaveLedger()
    const b = createAutosaveLedger()
    a.seed(original)
    expect(b.isClean(original)).toBe(false)
  })
})
