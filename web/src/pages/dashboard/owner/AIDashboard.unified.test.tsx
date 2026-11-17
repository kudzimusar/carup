/**
 * RX04-C2 — Gutu AI, unified presentation (flag ON). Same truth rules as the accepted view:
 * only the reader's own facts carry values, what CarUp does not hold is equally visible, and a
 * failed read is never an empty record set — it says so and offers the owner's records directly.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchAssistantContext = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchAssistantContext }) }))

const base = {
  ok: true,
  availability: 'value',
  facts: [
    { key: 'vehicles_owned', label: 'Vehicles on your account', value: 2, unit: 'count', available: true, reason: null, source: 'vehicles' },
    { key: 'enquiries_awaiting_reply', label: 'Enquiries awaiting your reply', value: 3, unit: 'count', available: true, reason: null, source: 'marketplace_inquiries.status' },
    { key: 'service_due', label: 'When your next service is due', value: null, unit: null, available: false, reason: 'CarUp holds no service schedule for your vehicle and cannot predict a due date or mileage.', source: 'none' },
    { key: 'fraud_detection_rate', label: "CarUp's fraud detection rate", value: null, unit: null, available: false, reason: 'No fraud interception rate is computed anywhere in CarUp.', source: 'none' },
  ],
  boundaries: ['Answer only from the facts above. A fact marked unavailable must be reported as unavailable, never estimated.'],
}

async function renderPage() {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  const AIDashboard = (await import('./AIDashboard')).default
  return render(<MemoryRouter><AIDashboard /></MemoryRouter>)
}

beforeEach(() => { fetchAssistantContext.mockReset() })
afterAll(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Gutu AI — unified presentation', () => {
  it('renders the new presentation with the owner\'s own facts and a door to where each lives', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    await renderPage()
    expect(await screen.findByTestId('gutu-unified')).toHaveAttribute('data-presentation', 'rx04')
    expect(screen.getByRole('heading', { level: 1, name: 'Gutu AI' })).toBeInTheDocument()
    expect(screen.getByTestId('assistant-fact-vehicles_owned-value')).toHaveTextContent('2')
    expect(screen.getByTestId('assistant-fact-enquiries_awaiting_reply-value')).toHaveTextContent('3')
    expect(screen.getByTestId('assistant-known')).toHaveTextContent(/from your own records/i)
    expect(screen.getByRole('link', { name: /Open my garage/ })).toHaveAttribute('href', '/dashboard/garage')
  })

  it('keeps what CarUp does not hold visible, with no value and an honest place to look instead', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    await renderPage()
    expect(await screen.findByTestId('assistant-missing-service_due')).toHaveTextContent(/cannot predict a due date/i)
    expect(screen.queryByTestId('assistant-fact-service_due-value')).toBeNull()
    expect(screen.getByRole('link', { name: /services recorded on your cars/ })).toHaveAttribute('href', '/dashboard/service-history')
    // A fact with no honest destination gets no link.
    expect(screen.getByTestId('assistant-missing-fraud_detection_rate').querySelector('a')).toBeNull()
    expect(screen.getByTestId('assistant-boundaries')).toHaveTextContent(/never estimated/i)
  })

  it('never imitates a conversation: no prompt box and no answer text', async () => {
    fetchAssistantContext.mockResolvedValue(base)
    await renderPage()
    await screen.findByTestId('assistant-known')
    expect(screen.queryByRole('textbox')).toBeNull()
    const page = document.body.textContent || ''
    for (const claim of ['11,800', '3.2%', 'NDI-MOT', 'AutoTech', 'QuickFix', '98.7%']) expect(page).not.toContain(claim)
  })

  it('shows a loading state, not an empty record set, while the read is in flight', async () => {
    fetchAssistantContext.mockReturnValue(new Promise(() => {}))
    await renderPage()
    expect(screen.getByTestId('assistant-context-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-known')).toBeNull()
  })

  it('a failed read says Gutu cannot read the records, offers the records directly, and can retry', async () => {
    fetchAssistantContext.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(base)
    await renderPage()
    expect(await screen.findByTestId('assistant-context-message')).toHaveTextContent(/not a report that you have none/i)
    expect(screen.queryByTestId('assistant-known')).toBeNull()
    expect(screen.getByTestId('gutu-record-doors')).toHaveTextContent(/Service history/)
    expect(screen.getByRole('link', { name: /Verify a VIN/ })).toHaveAttribute('href', '/search')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fetchAssistantContext).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('assistant-known')).toBeInTheDocument()
  })

  it('carries the server\'s own message when the context is unavailable', async () => {
    fetchAssistantContext.mockResolvedValue({ ok: true, availability: 'unavailable', message: 'Your CarUp records could not be read, so no answer can be grounded in them.', facts: [] })
    await renderPage()
    expect(await screen.findByTestId('assistant-context-message')).toHaveTextContent(/grounded in them/i)
    expect(screen.getByTestId('assistant-context-unavailable')).toHaveAttribute('role', 'alert')
  })
})
