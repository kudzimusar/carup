import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TermsOfService from './TermsOfService'

// CARUP-PAY-03B: the dealer and garage subscriptions have no approved commercial price (pay03b_subscription_plans:
// unpriced, commercially blocked). A customer-facing page must never present a mock monthly price as a term.
describe('Terms of Service — subscription pricing', () => {
  it('never states an unapproved monthly subscription price', () => {
    render(<MemoryRouter><TermsOfService /></MemoryRouter>)
    expect(screen.queryByText('$99/month')).toBeNull()
    expect(screen.queryByText('$49/month')).toBeNull()
    expect(screen.getAllByText('Price not yet approved')).toHaveLength(2)
  })
})
