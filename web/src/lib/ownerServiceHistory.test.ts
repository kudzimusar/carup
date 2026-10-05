/**
 * OC-5D — the money rule the Service History page and the Vehicle Passport share
 * (shared/contracts/owner-service-history.v1.contract.json: money is `{recorded, amount, currency}`).
 *
 * Money is shown with its currency or stated as not recorded; a total exists only within one
 * currency; an unknown cost is counted as unknown, never folded into a total as zero. The page tests
 * exercise this through rendering; these pin the rule itself on the inputs a page never happens to
 * render — a "recorded" claim with no currency or no amount.
 */
import { describe, it, expect } from 'vitest'
import { formatCost, summariseSpend, type ServiceHistoryEntry } from './ownerServiceHistory'

const entry = (money: ServiceHistoryEntry['money'], id = 'wo'): ServiceHistoryEntry => ({
  id, vin: 'OC5DTESTVIN000001', status: null, description: null, issue_description: null,
  created_at: null, money,
})

describe('formatCost — money, or an honest statement that it was not recorded', () => {
  it('shows an amount only with its currency', () => {
    expect(formatCost({ recorded: true, amount: 1200, currency: 'ZAR' })).toMatch(/^ZAR 1[,.\s]?200$/)
  })

  it('a number without a currency is not money, even when the payload claims "recorded"', () => {
    expect(formatCost({ recorded: true, amount: 85.5, currency: null })).toBe('Cost not recorded')
    expect(formatCost({ recorded: true, amount: 85.5, currency: '' })).toBe('Cost not recorded')
  })

  it('a recorded claim with no amount is not a zero', () => {
    expect(formatCost({ recorded: true, amount: null, currency: 'USD' })).toBe('Cost not recorded')
    expect(formatCost({ recorded: false, amount: 40, currency: 'USD' })).toBe('Cost not recorded')
    expect(formatCost(null)).toBe('Cost not recorded')
  })

  it('a RECORDED zero is a fact, and is shown as one', () => {
    expect(formatCost({ recorded: true, amount: 0, currency: 'USD' })).toBe('USD 0')
  })
})

describe('summariseSpend — a total without an invented number', () => {
  it('sums within one currency and says how much is unknown', () => {
    const spend = summariseSpend([
      entry({ recorded: true, amount: 250, currency: 'ZWG' }, 'a'),
      entry({ recorded: true, amount: 100, currency: 'ZWG' }, 'b'),
      entry({ recorded: false, amount: null, currency: null }, 'c'),
    ])
    expect(spend).toMatchObject({ total: 350, currency: 'ZWG', mixedCurrency: false, unrecordedCount: 1 })
    expect(spend.label).toBe('ZWG 350')
  })

  it('never sums across currencies', () => {
    const spend = summariseSpend([
      entry({ recorded: true, amount: 250, currency: 'ZWG' }, 'a'),
      entry({ recorded: true, amount: 100, currency: 'USD' }, 'b'),
    ])
    expect(spend).toMatchObject({ total: null, currency: null, mixedCurrency: true, label: 'Multiple currencies' })
  })

  it('an entry that claims "recorded" without an amount or a currency is unknown, not zero', () => {
    const spend = summariseSpend([
      entry({ recorded: true, amount: 250, currency: 'ZWG' }, 'a'),
      entry({ recorded: true, amount: null, currency: 'ZWG' }, 'b'),
      entry({ recorded: true, amount: 75, currency: null }, 'c'),
    ])
    expect(spend.total).toBe(250)
    expect(spend.unrecordedCount, 'both are unknown, and both are counted as unknown').toBe(2)
  })

  it('nothing recorded is "Not recorded", never a currency-less 0', () => {
    const spend = summariseSpend([entry({ recorded: false, amount: null, currency: null })])
    expect(spend).toMatchObject({ total: null, label: 'Not recorded', unrecordedCount: 1 })
    expect(summariseSpend([])).toMatchObject({ total: null, label: 'Not recorded', unrecordedCount: 0 })
  })
})
