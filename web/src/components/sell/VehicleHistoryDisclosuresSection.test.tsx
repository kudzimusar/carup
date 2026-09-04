/**
 * Vehicle History & Obligations — F18–F20 / T21 UI contract.
 *
 * The rule this file protects: an unanswered question IS an answer state ("not recorded") and the
 * UI must never manufacture one. Nothing is preselected, the options are exactly the closed
 * vocabulary the backend accepts, and no control exists that could collect a private banking term.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { VehicleHistoryDisclosuresSection } from './VehicleHistoryDisclosuresSection'
import {
  ACCIDENT_DISCLOSURE_STATES,
  FINANCE_DISCLOSURE_STATES,
  INSURANCE_DISCLOSURE_STATES,
  parseAccidentDisclosure,
  parseFinanceDisclosure,
  parseInsuranceDisclosure,
} from '@/lib/vehicleHistoryDisclosures'

afterEach(cleanup)

function renderSection(overrides: Partial<Parameters<typeof VehicleHistoryDisclosuresSection>[0]> = {}) {
  const handlers = {
    onAccidentChange: vi.fn(),
    onInsuranceChange: vi.fn(),
    onFinanceChange: vi.fn(),
  }
  render(
    <VehicleHistoryDisclosuresSection
      accident={null}
      insurance={null}
      finance={null}
      idPrefix="test"
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('VehicleHistoryDisclosuresSection', () => {
  it('preselects nothing: every radio in all three groups starts unchecked', () => {
    renderSection()
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBe(
      ACCIDENT_DISCLOSURE_STATES.length + INSURANCE_DISCLOSURE_STATES.length + FINANCE_DISCLOSURE_STATES.length,
    )
    for (const radio of radios) expect((radio as HTMLInputElement).checked).toBe(false)
  })

  it('offers exactly the closed vocabularies and no bare "No" option', () => {
    renderSection()
    for (const state of ACCIDENT_DISCLOSURE_STATES) expect(screen.getByTestId(`history-accident-state-${state}`)).toBeTruthy()
    for (const state of INSURANCE_DISCLOSURE_STATES) expect(screen.getByTestId(`history-insurance-state-${state}`)).toBeTruthy()
    for (const state of FINANCE_DISCLOSURE_STATES) expect(screen.getByTestId(`history-finance-state-${state}`)).toBeTruthy()
    // The honest negatives are explicit phrases, never an ambiguous bare "No".
    expect(screen.queryByLabelText(/^No$/)).toBeNull()
  })

  it('reports the chosen state through the change handlers without inventing details', () => {
    const handlers = renderSection()
    fireEvent.click(screen.getByTestId('history-accident-state-unknown'))
    expect(handlers.onAccidentChange).toHaveBeenCalledWith({ state: 'unknown' })
    fireEvent.click(screen.getByTestId('history-insurance-state-not_insured'))
    expect(handlers.onInsuranceChange).toHaveBeenCalledWith({ state: 'not_insured' })
    fireEvent.click(screen.getByTestId('history-finance-state-none_known'))
    expect(handlers.onFinanceChange).toHaveBeenCalledWith({ state: 'none_known' })
  })

  it('shows the structured accident-event editor only after an explicit "yes"', () => {
    renderSection()
    expect(screen.queryByTestId('history-accident-events')).toBeNull()
    cleanup()
    renderSection({ accident: { state: 'yes' } })
    expect(screen.getByTestId('history-accident-events')).toBeTruthy()
    expect(screen.getByTestId('history-accident-add-event')).toBeTruthy()
  })

  it('collects no private banking terms anywhere in the finance block', () => {
    renderSection({ finance: { state: 'active' } })
    // The only finance inputs are the coarse type select and the optional lender name.
    expect(screen.getByTestId('history-finance-type')).toBeTruthy()
    expect(screen.getByTestId('history-finance-lender-name')).toBeTruthy()
    for (const forbidden of [/balance/i, /repayment/i, /account number/i, /interest rate/i, /APR/]) {
      expect(screen.queryByLabelText(forbidden)).toBeNull()
    }
    expect(screen.getByTestId('history-finance-privacy-note').textContent).toMatch(/never asks for balances/)
  })

  it('labels every control accessibly (fieldset+legend, labelled radios and inputs)', () => {
    renderSection({ accident: { state: 'yes', events: [{}] }, insurance: { state: 'insured' }, finance: { state: 'active' } })
    expect(screen.getByRole('group', { name: /accident or collision/i })).toBeTruthy()
    expect(screen.getByRole('group', { name: /currently insured/i })).toBeTruthy()
    expect(screen.getByRole('group', { name: /finance, a lease or another lender interest/i })).toBeTruthy()
    expect(screen.getByLabelText(/Approximate date/i)).toBeTruthy()
    expect(screen.getByLabelText(/Insurer \(optional\)/i)).toBeTruthy()
    expect(screen.getByLabelText(/Lender \/ provider \(optional\)/i)).toBeTruthy()
  })
})

describe('disclosure draft parsers', () => {
  it('hydrate invalid stored values as unanswered, never as a repaired answer', () => {
    for (const parse of [parseAccidentDisclosure, parseInsuranceDisclosure, parseFinanceDisclosure]) {
      expect(parse(null)).toBeNull()
      expect(parse(undefined)).toBeNull()
      expect(parse('yes')).toBeNull()
      expect(parse({ state: 'no' })).toBeNull()
      expect(parse({ state: 'clean' })).toBeNull()
      expect(parse([])).toBeNull()
    }
  })

  it('round-trip every declared state and drop unknown keys', () => {
    expect(parseAccidentDisclosure({ state: 'yes', events: [{ damage_area: 'front', smuggled: 'x' }] }))
      .toEqual({ state: 'yes', events: [{ damage_area: 'front' }] })
    expect(parseInsuranceDisclosure({ state: 'insured', insurer_name: 'Old Mutual', policy_number: 'P1' }))
      .toEqual({ state: 'insured', insurer_name: 'Old Mutual' })
    expect(parseFinanceDisclosure({ state: 'active', finance_type: 'hire_purchase', apr: 21 }))
      .toEqual({ state: 'active', finance_type: 'hire_purchase' })
    expect(parseFinanceDisclosure({ state: 'active', finance_type: 'payday_loan' }))
      .toEqual({ state: 'active' })
  })
})
