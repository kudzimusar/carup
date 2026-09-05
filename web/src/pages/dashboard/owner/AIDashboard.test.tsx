/**
 * Gutu AI — CarUp Intelligence I18.
 *
 * The surface must show what CarUp cannot answer as prominently as what it can.
 * A question that cannot be answered has to be visibly unanswerable, because the
 * previous version answered every one of them with a figure that came from
 * nowhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AIDashboard from './AIDashboard'

const fetchAssistantContext = vi.fn()
let hookValue: Record<string, unknown> = { fetchAssistantContext }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const base = {
  ok: true,
  availability: 'value',
  facts: [
    { key: 'vehicles_owned', label: 'Vehicles on your account', value: 2, unit: 'count', available: true, reason: null, source: 'vehicles' },
    { key: 'enquiries_awaiting_reply', label: 'Enquiries awaiting your reply', value: 3, unit: 'count', available: true, reason: null, source: 'marketplace_inquiries.status' },
    { key: 'market_valuation', label: 'What your vehicle is worth', value: null, unit: null, available: false, reason: 'CarUp does not compute a market valuation for a vehicle you own, and no valuation model is connected.', source: 'none' },
    { key: 'insurance_policy', label: 'Your insurance policy, premium and expiry', value: null, unit: null, available: false, reason: 'CarUp holds no policy record for you. A policy number, premium or expiry date would be invented.', source: 'none' },
  ],
  boundaries: [
    'Answer only from the facts above. A fact marked unavailable must be reported as unavailable, never estimated.',
  ],
}

beforeEach(() => {
  fetchAssistantContext.mockReset()
  hookValue = { fetchAssistantContext }
})

describe('what CarUp holds is grounded', () => {
  it('shows only figures from the reader\'s own records', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    render(<AIDashboard />)
    expect(await screen.findByTestId('assistant-fact-vehicles_owned-value')).toHaveTextContent('2')
    expect(screen.getByTestId('assistant-fact-enquiries_awaiting_reply-value')).toHaveTextContent('3')
    expect(screen.getByTestId('assistant-known')).toHaveTextContent(/from your own records/i)
  })
})

describe('what CarUp does not hold is equally visible', () => {
  it('names each unanswerable question and why', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    render(<AIDashboard />)
    expect(await screen.findByTestId('assistant-missing-market_valuation'))
      .toHaveTextContent(/no valuation model is connected/i)
    expect(screen.getByTestId('assistant-missing-insurance_policy'))
      .toHaveTextContent(/would be invented/i)
  })

  it('never renders a value for an unavailable fact', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    render(<AIDashboard />)
    await screen.findByTestId('assistant-not-held')
    expect(screen.queryByTestId('assistant-fact-market_valuation-value')).toBeNull()
    expect(screen.queryByTestId('assistant-fact-insurance_policy-value')).toBeNull()
  })

  it('states the rules the assistant works under', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    render(<AIDashboard />)
    expect(await screen.findByTestId('assistant-boundaries')).toHaveTextContent(/never estimated/i)
  })
})

describe('none of the old fabrications survive', () => {
  it('renders no valuation, policy, garage list or fraud rate', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    render(<AIDashboard />)
    await screen.findByTestId('assistant-known')
    const page = document.body.textContent || ''
    for (const claim of ['11,800', '3.2%', 'NDI-MOT', '680', 'AutoTech', 'QuickFix', '98.7%', 'NicozDiamond']) {
      expect(page).not.toContain(claim)
    }
  })
})

describe('a failed read is never an empty record set', () => {
  it('says the records could not be read', async () => {
    fetchAssistantContext.mockRejectedValue(new Error('down'))
    render(<AIDashboard />)
    expect(await screen.findByTestId('assistant-context-message'))
      .toHaveTextContent(/not a report that you have none/i)
    expect(screen.queryByTestId('assistant-known')).toBeNull()
  })

  it('carries the server\'s own message when the context is unavailable', async () => {
    fetchAssistantContext.mockResolvedValue({
      ok: true, availability: 'unavailable',
      message: 'Your CarUp records could not be read, so no answer can be grounded in them.',
      facts: [],
    })
    render(<AIDashboard />)
    expect(await screen.findByTestId('assistant-context-message')).toHaveTextContent(/grounded in them/i)
  })

  it('a hook that never exposes the fetcher reads as unavailable', async () => {
    hookValue = {}
    render(<AIDashboard />)
    expect(await screen.findByTestId('assistant-context-message')).toBeInTheDocument()
  })
})
