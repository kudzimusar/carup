/**
 * T11-CAP-LR01-R3 — a cargo booking's own tracking and customs pages hang off that booking's import journey.
 * They do not know the order and must not go and find it; the journey is addressable from the booking itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ role: 'owner' as string }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Kingston Musarurwa', role: auth.role }, isAuthenticated: true }),
}))

import { TradeCargoChrome } from './TradeCargoChrome'

const BOOKING = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const show = (props: Partial<React.ComponentProps<typeof TradeCargoChrome>> = {}) =>
  render(
    <MemoryRouter>
      <TradeCargoChrome subjectType="cargo_reservation" subjectId={BOOKING} page="Where your cargo is" {...props} />
    </MemoryRouter>,
  )
const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const hrefs = () => within(trail()).queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])

beforeEach(() => { auth.role = 'owner' })
afterEach(cleanup)

describe('a cargo booking’s page', () => {
  it('shows Trade & Imports, then the booking’s journey, then itself — and goes up to the journey', () => {
    show()
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
    expect(hrefs()).toEqual([
      ['Trade & Imports', '/diaspora/imports'],
      ['Journey & arrival', `/diaspora/journey/cargo_reservation/${BOOKING}`],
    ])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Where your cargo is')
    expect(screen.getByRole('link', { name: 'Back to journey & arrival' })).toHaveAttribute('href', `/diaspora/journey/cargo_reservation/${BOOKING}`)
  })

  it('works for the other subjects the journey takes, and encodes the id', () => {
    show({ subjectType: 'shipment', subjectId: 'a b/1' })
    expect(screen.getByRole('link', { name: 'Back to journey & arrival' })).toHaveAttribute('href', '/diaspora/journey/shipment/a%20b%2F1')
  })

  it('names no order, and builds no address from the booking that is not the journey’s', () => {
    show()
    expect(screen.getByTestId('workspace-chrome').innerHTML).not.toContain('/diaspora/imports/')
  })
})

describe('a subject the journey does not take, or no subject yet', () => {
  it.each([['logistics_request', BOOKING], ['cargo_reservation', ''], ['', '']])('has no journey to go up to (%s, %s): the trail is Trade & Imports and itself, and the way up is the order list', (subjectType, subjectId) => {
    show({ subjectType, subjectId })
    expect(hrefs()).toEqual([['Trade & Imports', '/diaspora/imports']])
    expect(screen.queryByText('Journey & arrival')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
  })
})

describe('a role that cannot open the owner pages', () => {
  it('may open the journey, so it goes up there; the owner-only workspace stays text', () => {
    auth.role = 'dealer'
    show()
    expect(hrefs()).toEqual([['Journey & arrival', `/diaspora/journey/cargo_reservation/${BOOKING}`]])
    expect(within(trail()).getByText('Trade & Imports').closest('a')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to journey & arrival' })).toBeInTheDocument()
  })

  it('a role that can open neither is handed no link at all', () => {
    auth.role = 'mechanic'
    show()
    expect(hrefs()).toEqual([])
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
  })
})
