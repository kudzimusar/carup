/**
 * RX03-P1b footer identity — /contact offers only what exists (PR #222 edd6b745 + be2a779a).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Contact from './Contact'
import { CONTACT_PURPOSES, PUBLIC_CONTACTS, PUBLIC_LOCATION_LINE } from '@/config/publicIdentity'

describe('Contact page (frozen identity)', () => {
  it('lists every certified purpose as a real mailto link, and the approved location — never a street', () => {
    const { container } = render(<MemoryRouter><Contact /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Contact CarUp' })).toBeInTheDocument()
    for (const { purpose } of CONTACT_PURPOSES) {
      const card = screen.getByTestId(`contact-purpose-${purpose}`)
      expect(within(card).getByRole('link', { name: PUBLIC_CONTACTS[purpose] })).toHaveAttribute('href', `mailto:${PUBLIC_CONTACTS[purpose]}`)
    }
    expect(screen.getByTestId('contact-location')).toHaveTextContent(PUBLIC_LOCATION_LINE)
    expect(screen.getByTestId('contact-location')).toHaveTextContent('has no public office or street address to visit')
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/carup\.co\.zw|\+263|CarUp Zimbabwe/)
  })

  it('offers no contact form, phone, chat or hours — and says so', () => {
    const { container } = render(<MemoryRouter><Contact /></MemoryRouter>)
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('a[href^="tel:"]')).toBeNull()
    const unavailable = screen.getByTestId('contact-unavailable-channels')
    expect(unavailable).toHaveTextContent('CarUp has no public phone number.')
    expect(unavailable).toHaveTextContent('Not connected')
  })

  it('describes listing enquiries as they actually work (guest inquiry where offered; account messaging needs sign-in)', () => {
    render(<MemoryRouter><Contact /></MemoryRouter>)
    expect(screen.getByTestId('contact-listing-conversations')).toHaveTextContent('Where a guest inquiry is offered, you provide your contact details.')
  })
})
