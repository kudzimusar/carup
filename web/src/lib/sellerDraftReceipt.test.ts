/**
 * CARUP-MVP-STAB-01 F-009 — Seller Studio may say "saved" when the account holds the same
 * STATEMENT the seller made, and must still refuse to when it does not.
 *
 * The receipt comparison used exact string equality and JSON.stringify. Every one of these cases
 * produced "Account autosave is unavailable right now" on a save that had in fact succeeded:
 *   · the server trims text, so a trailing space or newline never comes back;
 *   · the server trims, de-duplicates and drops blank features (legacy rows carry all three);
 *   · Postgres JSONB reorders object keys (finance comes back {state, lender_name, finance_type});
 *   · the server drops blank disclosure details and empty accident events.
 */
import { describe, expect, it } from 'vitest'
import {
  canonicalDisclosureJson,
  normalizeDraftFeatures,
  normalizeDraftText,
  sellerDraftReceiptMatches,
  type SellerDraftPayload,
  type SellerDraftReceipt,
} from './sellerDraftReceipt'

const RECEIPT: SellerDraftReceipt = {
  description: 'Family minivan, one careful owner, full service history.',
  features: ['Air conditioning', 'Reverse camera'],
  body_style: 'Minivan',
  seller_stated_condition: 'Good',
  price: 12800,
  currency: 'USD',
  location: 'Harare',
  province: 'Harare',
  listing_country: '',
  location_visibility: 'province_only',
  public_seller_display_enabled: false,
}

const PAYLOAD: SellerDraftPayload = {
  description: 'Family minivan, one careful owner, full service history.',
  features: ['Air conditioning', 'Reverse camera'],
  body_style: 'Minivan',
  seller_stated_condition: 'Good',
  price: 12800,
  currency: 'USD',
  location: 'Harare',
  province: 'Harare',
  location_visibility: 'province_only',
  public_seller_display_enabled: false,
}

describe('normalisers mirror what the server stores', () => {
  it('text: trimmed, and blank is the same as absent', () => {
    expect(normalizeDraftText('  Clean car.\n')).toBe('Clean car.')
    expect(normalizeDraftText('   ')).toBeNull()
    expect(normalizeDraftText('')).toBeNull()
    expect(normalizeDraftText(null)).toBeNull()
    expect(normalizeDraftText(undefined)).toBeNull()
  })

  it('features: trimmed, blanks dropped, first occurrence kept, order preserved, capped at 50', () => {
    expect(normalizeDraftFeatures([' Sunroof ', 'Sunroof', '', '  ', 'Leather', 'Sunroof'])).toEqual(['Sunroof', 'Leather'])
    expect(normalizeDraftFeatures(Array.from({ length: 60 }, (_, i) => `F${i}`))).toHaveLength(50)
    expect(normalizeDraftFeatures(null)).toEqual([])
  })

  it('disclosures: canonical JSON is independent of key order, at every depth', () => {
    expect(canonicalDisclosureJson('finance_disclosure', { state: 'active', finance_type: 'bank_loan', lender_name: 'CBZ Bank' }))
      .toBe(canonicalDisclosureJson('finance_disclosure', { state: 'active', lender_name: 'CBZ Bank', finance_type: 'bank_loan' }))
    expect(canonicalDisclosureJson('accident_disclosure', { state: 'yes', events: [{ approx_date: '2024-03', damage_area: 'front-left' }] }))
      .toBe(canonicalDisclosureJson('accident_disclosure', { events: [{ damage_area: 'front-left', approx_date: '2024-03' }], state: 'yes' }))
  })
})

describe('sellerDraftReceiptMatches — persisted meaning, not bytes', () => {
  it('accepts an exact echo', () => {
    expect(sellerDraftReceiptMatches(PAYLOAD, RECEIPT)).toBe(true)
  })

  it('accepts text the server trimmed, and blank text the server stored as nothing', () => {
    expect(sellerDraftReceiptMatches(
      { ...PAYLOAD, description: `${PAYLOAD.description}  \n`, location: ' Harare ', province: '' },
      { ...RECEIPT, province: '' },
    )).toBe(true)
  })

  it('accepts features the server trimmed and de-duplicated (legacy feature rows)', () => {
    expect(sellerDraftReceiptMatches(
      { ...PAYLOAD, features: [' Air conditioning', 'Air conditioning', '', 'Reverse camera '] },
      RECEIPT,
    )).toBe(true)
  })

  it('accepts a disclosure whose keys Postgres JSONB reordered', () => {
    expect(sellerDraftReceiptMatches(
      { ...PAYLOAD, finance_disclosure: { state: 'active', finance_type: 'bank_loan', lender_name: 'CBZ Bank' } },
      {
        ...RECEIPT,
        accident_disclosure: null,
        insurance_disclosure: null,
        finance_disclosure: { state: 'active', lender_name: 'CBZ Bank', finance_type: 'bank_loan' } as never,
      },
    )).toBe(true)
  })

  it('accepts disclosure details the server dropped because they were blank or not applicable', () => {
    expect(sellerDraftReceiptMatches(
      {
        ...PAYLOAD,
        accident_disclosure: {
          state: 'yes',
          events: [{ approx_date: '2024-03', damage_area: '', severity: '   ' }, { repairer: '' }],
        },
        insurance_disclosure: { state: 'not_insured', insurer_name: 'Old Mutual' },
        finance_disclosure: { state: 'none_known', lender_name: '  ' },
      },
      {
        ...RECEIPT,
        accident_disclosure: { state: 'yes', events: [{ approx_date: '2024-03' }] },
        insurance_disclosure: { state: 'not_insured' },
        finance_disclosure: { state: 'none_known' },
      },
    )).toBe(true)
  })

  it('compares only what was sent: a key the request left out cannot fail the receipt', () => {
    const { currency: _currency, price: _price, ...withoutPrice } = PAYLOAD
    void _currency; void _price
    expect(sellerDraftReceiptMatches(withoutPrice, { ...RECEIPT, currency: 'ZiG', price: 99999 })).toBe(true)
  })

  it('still refuses "saved" for every genuine mismatch', () => {
    const cases: Array<[string, SellerDraftPayload, SellerDraftReceipt | null | undefined]> = [
      ['no receipt at all', PAYLOAD, null],
      ['missing receipt', PAYLOAD, undefined],
      ['different description', PAYLOAD, { ...RECEIPT, description: 'Something else entirely.' }],
      ['a feature was lost', PAYLOAD, { ...RECEIPT, features: ['Air conditioning'] }],
      ['feature order changed', PAYLOAD, { ...RECEIPT, features: ['Reverse camera', 'Air conditioning'] }],
      ['different price', PAYLOAD, { ...RECEIPT, price: 12000 }],
      ['different currency', PAYLOAD, { ...RECEIPT, currency: 'ZiG' }],
      ['location shown publicly instead', PAYLOAD, { ...RECEIPT, location_visibility: 'public' }],
      ['seller identity published instead', PAYLOAD, { ...RECEIPT, public_seller_display_enabled: true }],
      ['different body style', PAYLOAD, { ...RECEIPT, body_style: 'Sedan' }],
      ['different condition', PAYLOAD, { ...RECEIPT, seller_stated_condition: 'Fair' }],
      ['different province', PAYLOAD, { ...RECEIPT, province: 'Bulawayo' }],
      ['answered disclosure not stored',
        { ...PAYLOAD, finance_disclosure: { state: 'active' } },
        { ...RECEIPT, finance_disclosure: null }],
      ['different finance state',
        { ...PAYLOAD, finance_disclosure: { state: 'active', lender_name: 'CBZ Bank' } },
        { ...RECEIPT, finance_disclosure: { state: 'cleared', lender_name: 'CBZ Bank' } as never }],
      ['different lender',
        { ...PAYLOAD, finance_disclosure: { state: 'active', lender_name: 'CBZ Bank' } },
        { ...RECEIPT, finance_disclosure: { lender_name: 'Stanbic', state: 'active' } as never }],
      ['different accident detail',
        { ...PAYLOAD, accident_disclosure: { state: 'yes', events: [{ damage_area: 'front-left' }] } },
        { ...RECEIPT, accident_disclosure: { state: 'yes', events: [{ damage_area: 'rear' }] } as never }],
      ['insurer dropped from an insured answer',
        { ...PAYLOAD, insurance_disclosure: { state: 'insured', insurer_name: 'Old Mutual' } },
        { ...RECEIPT, insurance_disclosure: { state: 'insured' } }],
    ]
    for (const [label, payload, receipt] of cases) {
      expect(sellerDraftReceiptMatches(payload, receipt), label).toBe(false)
    }
  })
})
