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

  it('states "Not recorded" for every unanswered topic and never a clean-history claim', () => {
    const { container } = render(<VehicleHistoryObligationsSections disclosures={null} />)
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
