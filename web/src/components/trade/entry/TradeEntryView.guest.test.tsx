/**
 * LR02 — the Trade entry for a signed-out visitor (/diaspora, showroom presentation).
 *  - the four intentions, each with its exact status label;
 *  - every action is public, except the two sign-in links the guest sections may carry (sign in as a seller,
 *    sign in to see your requests) and the hero's existing one — each a safe login redirect;
 *  - the status board replaces the tool list, with the truthful groups;
 *  - signed in (and while a stored session is still being checked) the LR01 view is unchanged;
 *  - the below-the-fold stills mount only when their section nears the viewport (300 px margin).
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildLoginRedirect, isSafeReturnTo } from '@/lib/returnTo'
import { TradeEntryView } from './TradeEntryView'
import { offeredCapabilities } from './entryModel'

const session = vi.hoisted(() => ({ loading: false }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null, isAuthenticated: false, loading: session.loading }) }))

function renderEntry(signedIn: boolean) {
  return render(
    <MemoryRouter>
      <TradeEntryView
        signedIn={signedIn}
        orders={signedIn ? { state: 'ready', data: [] } : undefined}
        capabilities={offeredCapabilities({ isAuthenticated: signedIn, role: signedIn ? 'owner' : null })}
        loginHref={buildLoginRedirect('/diaspora/imports')}
      />
    </MemoryRouter>,
  )
}

const hrefsIn = (el: HTMLElement) => within(el).queryAllByRole('link').map(a => a.getAttribute('href') ?? '')
const isPublicTrade = (href: string) => href === '/diaspora/imports/new' || href === '/diaspora/rfq' || /^\/diaspora\/sample(\?|$)/.test(href)

beforeEach(() => { session.loading = false })
afterEach(() => cleanup())

describe('guest: what do you want to do?', () => {
  it('shows the four intentions with their exact status labels', () => {
    renderEntry(false)
    const expected: Array<[string, string, string]> = [
      ['source', 'Source a vehicle for me', 'Available · sign in to send'],
      ['move', 'I already own a vehicle — help me move it', 'Built · awaiting approval to join'],
      ['learn', 'Understand the import process', 'Available now · no account needed'],
      ['sell', 'I sell or export vehicles or parts', 'For approved seller accounts'],
    ]
    const section = screen.getByTestId('trade-entry-intentions')
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('What do you want to do?')
    expect(within(section).getAllByRole('article')).toHaveLength(4)
    for (const [key, title, status] of expected) {
      const card = screen.getByTestId(`trade-intent-${key}`)
      expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent(title)
      expect(within(card).getByTestId(`trade-intent-${key}-status`)).toHaveTextContent(new RegExp(`^${status}$`))
    }
  })

  it('A prepares a request without an account and explains quotes in the sample; it promises no quote', () => {
    renderEntry(false)
    const card = screen.getByTestId('trade-intent-source')
    expect(screen.getByTestId('trade-intent-source-start')).toHaveAttribute('href', '/diaspora/imports/new')
    expect(screen.getByTestId('trade-intent-source-start')).toHaveTextContent('Prepare a request — no account needed to start')
    expect(screen.getByTestId('trade-intent-source-quotes')).toHaveAttribute('href', '/diaspora/sample?order=request&mode=quotes')
    expect(card).toHaveTextContent('Sellers cannot see your request until you publish it')
    expect(card).toHaveTextContent('No quote, seller or supplier commitment exists until CarUp’s server records one')
  })

  it('B (built elsewhere, awaiting approval to join — E-4) offers no form and no action, only the sample’s Shipping & CAP and a mention of shared containers', () => {
    renderEntry(false)
    const card = screen.getByTestId('trade-intent-move')
    expect(card.querySelectorAll('form, input, select, textarea, button')).toHaveLength(0)
    expect(hrefsIn(card)).toEqual(['/diaspora/sample?order=sea&mode=shipping'])
    expect(card).toHaveTextContent('Shared containers (co-loading) already exist for signed-in importers')
    // RX06-LR04: T3 was built and Owner-accepted on the unmerged Trade OS line — never called "planned".
    expect(card).not.toHaveTextContent(/\bplanned\b/i)
    expect(card).toHaveTextContent('built and tested separately')
  })

  it('C walks the sample; D is a quiet seller sign-in, never dealer onboarding', () => {
    renderEntry(false)
    expect(screen.getByTestId('trade-intent-learn-sample')).toHaveAttribute('href', '/diaspora/sample')
    const sell = screen.getByTestId('trade-intent-sell')
    expect(hrefsIn(sell)).toEqual([buildLoginRedirect('/diaspora/rfq')])
    expect(hrefsIn(sell).some(h => h.startsWith('/dealers'))).toBe(false)
    expect(sell).toHaveTextContent('Workbook import: bulk stock from a reviewed workbook — built, not yet released.')
  })

  it('every guest action is public except the sign-in links, and each sign-in link is a safe login redirect', () => {
    renderEntry(false)
    const page = screen.getByTestId('trade-entry')
    const hrefs = hrefsIn(page)
    const logins = hrefs.filter(h => h.startsWith('/login'))
    // The hero's existing "Sign in to see your orders", "Sign in as a seller" and "Sign in to see your requests".
    expect(logins.sort()).toEqual([buildLoginRedirect('/diaspora/imports'), buildLoginRedirect('/diaspora/rfq'), buildLoginRedirect('/diaspora/rfq')].sort())
    for (const login of logins) {
      const returnTo = new URL(login, 'http://carup.invalid').searchParams.get('returnTo')
      expect(isSafeReturnTo(returnTo), login).toBe(true)
      expect(login).toBe(buildLoginRedirect(returnTo as string))
    }
    expect(screen.getByTestId('trade-intent-sell-signin')).toHaveAttribute('href', '/login?returnTo=%2Fdiaspora%2Frfq')
    expect(screen.getByTestId('trade-services-signin')).toHaveAttribute('href', '/login?returnTo=%2Fdiaspora%2Frfq')
    expect(screen.getByTestId('trade-services-signin')).toHaveTextContent('Sign in to see your requests')
    // Everything else stays on public Trade pages.
    expect(hrefs.filter(h => !h.startsWith('/login') && !isPublicTrade(h))).toEqual([])
    // The guest sections carry exactly the two sign-in links: the seller's and "see your requests".
    const guestLogins = ['trade-entry-intentions', 'trade-entry-involves', 'trade-entry-services']
      .flatMap(id => hrefsIn(screen.getByTestId(id)))
      .filter(h => h.startsWith('/login'))
    expect(guestLogins).toHaveLength(2)
    // No per-tool "Sign in to open" list for guests.
    expect(screen.queryByTestId('trade-entry-tools')).toBeNull()
  })
})

describe('guest: services at a glance and what an import involves', () => {
  it('a truthful status board: four groups with their exact labels; unreleased and planned services are not links', () => {
    renderEntry(false)
    expect(screen.getByTestId('trade-services-public-status')).toHaveTextContent(/^Available to explore now$/)
    expect(screen.getByTestId('trade-services-account-status')).toHaveTextContent(/^Available after sign-in$/)
    expect(screen.getByTestId('trade-services-unreleased-status')).toHaveTextContent(/^Built · not yet released$/)
    expect(screen.getByTestId('trade-services-planned-status')).toHaveTextContent(/^Built · awaiting approval to join$/)
    const account = screen.getByTestId('trade-services-account')
    for (const name of ['Your import orders', 'Your requests and quotes', 'Documents on your orders', 'Shared containers (co-loading)', 'Your trade profile']) {
      expect(account).toHaveTextContent(name)
    }
    const unreleased = screen.getByTestId('trade-services-unreleased')
    for (const name of ['SafeTrade', 'Plan & entitlements', 'Trade graph', 'Workbook import']) expect(unreleased).toHaveTextContent(name)
    expect(hrefsIn(unreleased)).toEqual([])
    const planned = screen.getByTestId('trade-services-planned')
    expect(hrefsIn(planned)).toEqual([])
    expect([...planned.querySelectorAll('[data-extraction]')].map(e => e.getAttribute('data-extraction'))).toEqual(['E-4', 'E-1', 'E-3'])
    // RX06-LR04: E-4, E-1 and E-3 were built and tested; the board never calls them planned.
    expect(planned).not.toHaveTextContent(/\bplanned\b/i)
    expect(hrefsIn(screen.getByTestId('trade-services-public')).every(isPublicTrade)).toBe(true)
  })

  it('quotations, documents, shipping and delivery, with the three principles', () => {
    renderEntry(false)
    for (const key of ['quotes', 'documents', 'shipping', 'delivery']) expect(screen.getByTestId(`trade-involves-${key}`)).toBeInTheDocument()
    expect(screen.getByTestId('trade-involves-documents')).toHaveTextContent('Uploading one is not the same as it being verified')
    const principles = screen.getByTestId('trade-involves-principles')
    expect(principles).toHaveTextContent('Uploaded is not verified.')
    expect(principles).toHaveTextContent('Nothing is estimated: no prices, dates or duty.')
    expect(principles).toHaveTextContent('CarUp does not hold money.')
  })
})

describe('signed in: the LR01 view is unchanged', () => {
  it('the desk and the tool list; no guest section', () => {
    renderEntry(true)
    expect(screen.getByTestId('trade-entry-desk')).toBeInTheDocument()
    expect(screen.getByTestId('trade-entry-tools')).toBeInTheDocument()
    for (const id of ['trade-entry-intentions', 'trade-entry-involves', 'trade-entry-services']) expect(screen.queryByTestId(id)).toBeNull()
  })

  it('while a stored session is still being checked, no guest section flashes (the page passes signedIn=false then)', () => {
    session.loading = true
    renderEntry(false)
    for (const id of ['trade-entry-intentions', 'trade-entry-involves', 'trade-entry-services']) expect(screen.queryByTestId(id)).toBeNull()
    expect(screen.getByTestId('trade-entry-tools')).toBeInTheDocument()
  })
})

/** A controllable IntersectionObserver (jsdom has none). */
class FakeObserver {
  static instances: FakeObserver[] = []
  observed: Element[] = []
  disconnected = false
  constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) { FakeObserver.instances.push(this) }
  observe(el: Element) { this.observed.push(el) }
  unobserve() {}
  disconnect() { this.disconnected = true }
  takeRecords() { return [] }
  report(target: Element, isIntersecting: boolean) {
    act(() => this.callback([{ target, isIntersecting } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver))
  }
}

describe('below-the-fold stills (RX-07 phone LCP)', () => {
  beforeEach(() => { FakeObserver.instances = []; vi.stubGlobal('IntersectionObserver', FakeObserver) })
  afterEach(() => vi.unstubAllGlobals())

  const stillsIn = (el: HTMLElement) => el.querySelectorAll('figure[data-testid^="trade-still-"]')

  it('the seven phase stills are not mounted until their section nears the viewport; their boxes are reserved', () => {
    renderEntry(false)
    const journey = screen.getByTestId('trade-entry-journey')
    expect(stillsIn(journey)).toHaveLength(0)
    const slots = within(journey).getAllByTestId('trade-entry-still-slot')
    expect(slots).toHaveLength(7)
    for (const slot of slots) expect(slot.className).toContain('aspect-[4/3]')

    const observer = FakeObserver.instances.find(o => o.observed.includes(journey))
    expect(observer, 'the phase section is observed').toBeTruthy()
    expect(observer!.options?.rootMargin).toMatch(/^300px\b/)

    observer!.report(journey, false) // still far away: nothing mounts
    expect(stillsIn(journey)).toHaveLength(0)
    observer!.report(journey, true) // within 300 px: all seven mount, once
    expect(stillsIn(journey)).toHaveLength(7)
    expect(within(journey).queryAllByTestId('trade-entry-still-slot')).toHaveLength(0)
    expect(observer!.disconnected).toBe(true)
  })

  it('the "one record" still waits for its own section too', () => {
    renderEntry(false)
    const record = screen.getByTestId('trade-entry-one-record')
    expect(stillsIn(record)).toHaveLength(0)
    expect(within(record).getByTestId('trade-entry-still-slot')).toHaveAttribute('data-still', 'portDawn')
    FakeObserver.instances.find(o => o.observed.includes(record))!.report(record, true)
    expect(record.querySelector('figure[data-testid="trade-still-portDawn"]')).not.toBeNull()
  })
})
