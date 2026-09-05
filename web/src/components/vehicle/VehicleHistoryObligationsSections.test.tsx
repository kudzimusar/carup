/**
 * Vehicle Detail §14 items 9–11 — buyer-facing Vehicle History & Obligations (K17–K20, L27).
 *
 * The rule under test: absence is rendered as "Not recorded", never as a clean-history claim, and
 * the seller's statement is always visibly attributed and never dressed as governed evidence.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { VehicleHistoryObligationsSections } from './VehicleHistoryObligationsSections'

afterEach(cleanup)

/**
 * Affirmative absence-claims only. The component legitimately uses "clean history" inside its own
 * DISCLAIMERS ("not a clean-history claim", "not proof of a clean history"); those sentences are
 * the protection, so the patterns below match the claim WITHOUT a preceding negation.
 */
const FORBIDDEN_CLEAN_CLAIMS = [
  /(?<!not a )(?<!not )\bno accident\b/i,
  /\bnot financed\b/i,
  /\bfinance clear\b/i,
  /\buninsured\b/i,
  /(?<!not proof of a )(?<!not a )\bclean[- ]history\b/i,
]

describe('VehicleHistoryObligationsSections', () => {
  it('renders all three §14 sections even when nothing is recorded', () => {
    render(<VehicleHistoryObligationsSections disclosures={null} />)
    expect(screen.getByTestId('detail-accident-history-section')).toBeTruthy()
    expect(screen.getByTestId('detail-insurance-section')).toBeTruthy()
    expect(screen.getByTestId('detail-finance-obligations-section')).toBeTruthy()
  })

  it('states "Not recorded" for a topic the seller left unanswered, and never a clean-history claim', () => {
    // The block WAS read; it simply carries no answer for any topic. That is a fact about the
    // seller's declaration, so "Not recorded — the seller has not answered" is correct here.
    const { container } = render(<VehicleHistoryObligationsSections disclosures={{
      authority: 'seller_stated', accident: null, insurance: null, finance: null,
    }} />)
    for (const topic of ['accident', 'insurance', 'finance']) {
      const node = screen.getByTestId(`history-${topic}-not-recorded`)
      expect(node.textContent).toMatch(/Not recorded/)
      expect(node.textContent).toMatch(/not a\s+clean-history claim/)
    }
    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_CLEAN_CLAIMS) {
      expect(text).not.toMatch(forbidden)
    }
  })

  it('an UNREAD block is never attributed to the seller', () => {
    // VehicleDetail passes `passport?.history_disclosures ?? null`, and `passport` is null both
    // before the read settles and after it FAILS. Routing that through the same copy told the buyer
    // "the seller has not answered this question" — a statement about the seller's conduct derived
    // from a fault on CarUp's side. Unread, unanswered and answered are three states, not two.
    const { container } = render(<VehicleHistoryObligationsSections disclosures={null} />)
    for (const topic of ['accident', 'insurance', 'finance']) {
      const node = screen.getByTestId(`history-${topic}-not-read`)
      expect(node.textContent).toMatch(/has not read/i)
      expect(node.textContent).not.toMatch(/seller has not answered/i)
      // And still refuses a clean-history claim, which was already right and must stay right.
      expect(node.textContent).toMatch(/this is not a clean-history claim/i)
      expect(screen.queryByTestId(`history-${topic}-not-recorded`)).toBeNull()
    }
    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_CLEAN_CLAIMS) {
      expect(text).not.toMatch(forbidden)
    }
  })

  it('attributes the seller statement and keeps governed state separate', () => {
    render(<VehicleHistoryObligationsSections disclosures={{
      authority: 'seller_stated',
      accident: { state: 'no_known_accident_history' },
      insurance: { state: 'insured', insurer_name: 'Old Mutual' },
      finance: { state: 'cleared', finance_type: 'bank_loan' },
    }} />)
    // Every rendered statement carries the seller-stated badge…
    expect(screen.getAllByText('Seller-stated').length).toBe(3)
    expect(screen.getByTestId('history-accident-statement').textContent).toMatch(/No known accident history/)
    expect(screen.getByTestId('history-insurance-statement').textContent).toMatch(/Old Mutual \(seller-stated\)/)
    // …and each section states the GOVERNED side's own honest state rather than echoing the seller.
    expect(screen.getByTestId('history-insurance-governed-state').textContent).toMatch(/no connected insurer source/i)
    expect(screen.getByTestId('history-finance-governed-state').textContent).toMatch(/no connected lender source/i)
    expect(screen.getByTestId('history-accident-governed-state').textContent).toMatch(/never converted into\s+verified evidence/i)
  })

  it('renders structured accident events only for an explicit "yes"', () => {
    render(<VehicleHistoryObligationsSections disclosures={{
      authority: 'seller_stated',
      accident: { state: 'yes', events: [{ damage_area: 'front-left wing', repair_state: 'fully repaired' }] },
      insurance: null,
      finance: null,
    }} />)
    const event = screen.getByTestId('history-accident-event-0')
    expect(event.textContent).toMatch(/Damaged area/)
    expect(event.textContent).toMatch(/front-left wing/)
    expect(event.textContent).toMatch(/fully repaired/)
  })

  it('presents active finance as a transfer condition, not a hidden or blocked listing (R23)', () => {
    render(<VehicleHistoryObligationsSections disclosures={{
      authority: 'seller_stated',
      accident: null,
      insurance: null,
      finance: { state: 'active', finance_type: 'hire_purchase', lender_name: 'CABS' },
    }} />)
    const condition = screen.getByTestId('history-finance-transfer-condition')
    expect(condition.textContent).toMatch(/does not prevent viewing or inquiring/i)
    expect(condition.textContent).toMatch(/before ownership transfer/i)
  })

  it('never renders a private banking term even if one reached the props', () => {
    const { container } = render(<VehicleHistoryObligationsSections disclosures={{
      authority: 'seller_stated',
      accident: null,
      insurance: null,
      // Deliberately malformed: the projection would have stripped these, and the component must
      // not render them either.
      finance: { state: 'active', outstanding_balance: 12000, apr: 21.5 } as never,
    }} />)
    const text = container.textContent || ''
    expect(text).not.toMatch(/12000/)
    expect(text).not.toMatch(/21\.5/)
    expect(screen.getByTestId('history-finance-governed-state').textContent)
      .toMatch(/balances, repayment amounts, rates and account identifiers are private/i)
  })
})

/**
 * GOVERNED finance obligation / encumbrance (Track 1). The rules under test are the ones the
 * adversarial design review insisted on: the governed half is THREE-STATE (no connected source /
 * connected but holding nothing / a real record), a superseded row stops speaking, the seller's
 * statement and the governed record never merge, and no private banking term can render.
 */
describe('VehicleHistoryObligationsSections — governed finance obligation', () => {
  const NO_DISCLOSURES = { authority: 'seller_stated', accident: null, insurance: null, finance: null } as const

  it('keeps the honest "no connected lender source" line when the source is unavailable', () => {
    render(<VehicleHistoryObligationsSections
      disclosures={NO_DISCLOSURES}
      financeObligation={{ authority: 'governed', source_state: 'unavailable', obligations: [] }}
    />)
    expect(screen.getByTestId('history-finance-governed-state').textContent)
      .toMatch(/no connected lender source/i)
    expect(screen.queryByTestId('history-finance-governed-record')).toBeNull()
  })

  it('treats an ABSENT block exactly like an unavailable one — never as "no finance"', () => {
    const { container } = render(<VehicleHistoryObligationsSections disclosures={NO_DISCLOSURES} />)
    expect(screen.getByTestId('history-finance-governed-state').textContent)
      .toMatch(/no connected lender source/i)
    for (const pattern of FORBIDDEN_CLEAN_CLAIMS) {
      expect(container.textContent || '').not.toMatch(pattern)
    }
  })

  it('distinguishes "connected but holding nothing" from "no connected source" — and still claims nothing', () => {
    const { container } = render(<VehicleHistoryObligationsSections
      disclosures={NO_DISCLOSURES}
      financeObligation={{ authority: 'governed', source_state: 'available', obligations: [] }}
    />)
    const governed = screen.getByTestId('history-finance-governed-state').textContent || ''
    expect(governed).toMatch(/no lender record is held/i)
    // The distinction is the whole point of the three-state contract.
    expect(governed).not.toMatch(/no connected lender source/i)
    // …and an empty governed result is still not a clean-finance claim.
    expect(governed).toMatch(/not a guarantee that none exists/i)
    for (const pattern of FORBIDDEN_CLEAN_CLAIMS) {
      expect(container.textContent || '').not.toMatch(pattern)
    }
  })

  it('renders a real governed obligation under its OWN authority label, separate from the seller statement', () => {
    render(<VehicleHistoryObligationsSections
      disclosures={{
        authority: 'seller_stated', accident: null, insurance: null,
        finance: { state: 'none_known' },
      }}
      financeObligation={{
        authority: 'governed', source_state: 'available',
        obligations: [{
          id: 'o1', state: 'active', obligation_kind: 'hire_purchase',
          transfer_condition: 'settlement_required', superseded: false,
        }],
      }}
    />)
    // Both authorities are on the page, and they are DIFFERENT elements — the seller said
    // "none known" while the lender record says an interest is active. Neither overwrites the other.
    expect(screen.getByTestId('history-finance-statement').textContent).toMatch(/no finance|none/i)
    const governed = screen.getByTestId('history-finance-governed-record')
    expect(governed.textContent).toMatch(/Governed record/i)
    expect(governed.textContent).toMatch(/settlement required before transfer/i)
  })

  it('a SUPERSEDED obligation stops speaking — a correction actually takes effect', () => {
    render(<VehicleHistoryObligationsSections
      disclosures={NO_DISCLOSURES}
      financeObligation={{
        authority: 'governed', source_state: 'available',
        obligations: [{
          id: 'o1', state: 'active', obligation_kind: 'bank_loan',
          transfer_condition: 'settlement_required', superseded: true,
        }],
      }}
    />)
    expect(screen.queryByTestId('history-finance-governed-record')).toBeNull()
    expect(screen.getByTestId('history-finance-governed-state').textContent)
      .toMatch(/no lender record is held/i)
  })

  it('does not tell a seller who has already settled to pay twice (settled_pending_release)', () => {
    render(<VehicleHistoryObligationsSections
      disclosures={NO_DISCLOSURES}
      financeObligation={{
        authority: 'governed', source_state: 'available',
        obligations: [{
          id: 'o1', state: 'settled_pending_release', obligation_kind: 'bank_loan',
          transfer_condition: 'release_confirmation_outstanding', superseded: false,
        }],
      }}
    />)
    const condition = screen.getByTestId('history-finance-governed-transfer-condition').textContent || ''
    expect(condition).toMatch(/release confirmation is outstanding/i)
    expect(condition).toMatch(/No further payment is implied/i)
    expect(condition).not.toMatch(/settlement.*required/i)
  })

  it('renders valuation-at-origination with its own date and source, never as a current price (R26)', () => {
    render(<VehicleHistoryObligationsSections
      disclosures={NO_DISCLOSURES}
      financeObligation={{
        authority: 'governed', source_state: 'available',
        obligations: [{
          id: 'o1', state: 'active', obligation_kind: 'bank_loan',
          transfer_condition: 'settlement_required', superseded: false,
          valuation_at_origination: { amount: 12000, currency: 'USD', date: '2022-01-01', source: 'lender_valuation' },
        }],
      }}
    />)
    const valuation = screen.getByTestId('history-finance-origination-valuation').textContent || ''
    expect(valuation).toMatch(/2022-01-01/)
    expect(valuation).toMatch(/Lender valuation/i)
    expect(valuation).toMatch(/not a current valuation/i)
    expect(valuation).toMatch(/not this listing’s asking price/i)
  })

  it('never renders a private banking term that reached the governed props', () => {
    const { container } = render(<VehicleHistoryObligationsSections
      disclosures={NO_DISCLOSURES}
      financeObligation={{
        authority: 'governed', source_state: 'available',
        obligations: [{
          id: 'o1', state: 'active', obligation_kind: 'bank_loan',
          transfer_condition: 'settlement_required', superseded: false,
          // Deliberately malformed: both upstream bans would have stripped these.
          outstanding_balance: 9999, apr: 17.25, account_number: 'ACC-777',
        } as never],
      }}
    />)
    const text = container.textContent || ''
    expect(text).not.toMatch(/9999/)
    expect(text).not.toMatch(/17\.25/)
    expect(text).not.toMatch(/ACC-777/)
  })
})
