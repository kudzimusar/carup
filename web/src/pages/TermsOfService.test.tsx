import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TermsOfService from './TermsOfService'

// CARUP-PAY-03B: the dealer and garage subscriptions have no approved commercial price (pay03b_subscription_plans:
// unpriced, commercially blocked). A customer-facing page must never present a mock monthly price as a term.
//
// PAY-04 integration: the One CarUp line (OC5R `2681f14c`) removed every fabricated commercial and legal term from this
// page, including the plan table whose cells PAY-03B had changed to "Price not yet approved". The guarantee stands
// without the table: no monthly price, and the page says terms are withheld until they are approved.
describe('Terms of Service — subscription pricing', () => {
  it('never states an unapproved monthly subscription price', () => {
    const { container } = render(<MemoryRouter><TermsOfService /></MemoryRouter>)
    expect(screen.queryByText('$99/month')).toBeNull()
    expect(screen.queryByText('$49/month')).toBeNull()
    expect(container.textContent).not.toMatch(/[$¥€£]\s?\d[\d,.]*\s*\/\s*(mo|month)/i)
    expect(container.textContent).not.toMatch(/\b(USD|JPY|ZWG)\s?\d[\d,.]*\s*\/\s*(mo|month)/i)
  })

  it('says commercial terms are withheld until they are approved, rather than stating placeholder terms', () => {
    const { container } = render(<MemoryRouter><TermsOfService /></MemoryRouter>)
    expect(container.textContent).toContain('withholds placeholder fees')
    expect(container.textContent).toContain('until they are approved')
  })
})
