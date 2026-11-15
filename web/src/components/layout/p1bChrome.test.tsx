import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompactBottomNav from './CompactBottomNav'
import Footer from './Footer'
import { BrandMark } from '@/components/shell/BrandMark'
import { useClaimBottomBar } from '@/lib/bottomBarClaim'

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }))

function ContactBar({ active }: { active: boolean }) {
  const { honoured } = useClaimBottomBar(active)
  return active ? <div data-testid="contact-bar" data-docked={honoured ? 'bottom' : 'above-nav'} /> : null
}

const chromeOn = () => { (globalThis as Record<string, unknown>).__CARUP_SHOWROOM_CHROME__ = true }
beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__CARUP_SHOWROOM_CHROME__
  delete (globalThis as Record<string, unknown>).__CARUP_SHOWROOM_PAGES__
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('RX03-P1b — one bottom bar at a time (chrome presentation on)', () => {
  beforeEach(chromeOn)
  it('the legacy phone nav steps aside while a page claims the bottom, and returns after', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/marketplace/X']}>
        <CompactBottomNav />
        <ContactBar active />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('compact-bottom-nav')).toBeNull()
    expect(screen.getByTestId('contact-bar')).toHaveAttribute('data-docked', 'bottom')

    rerender(
      <MemoryRouter initialEntries={['/marketplace/X']}>
        <CompactBottomNav />
        <ContactBar active={false} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('compact-bottom-nav')).toBeInTheDocument()
  })

  it('a claim without an honouring nav docks above the nav instead of overlapping it', () => {
    render(<ContactBar active />)
    expect(screen.getByTestId('contact-bar')).toHaveAttribute('data-docked', 'above-nav')
  })

  it('the active tab is Option 5 navy (well above AA at 11px), never the low-contrast orange-600', () => {
    render(<MemoryRouter initialEntries={['/marketplace']}><CompactBottomNav /></MemoryRouter>)
    const active = screen.getByRole('link', { current: 'page' })
    expect(active.className).toContain('text-[#09122A]')
    expect(active.className).not.toContain('text-orange-600')
    expect(active.querySelector('span.bg-\\[\\#09122A\\]')).not.toBeNull()
    expect(screen.getByTestId('compact-bottom-nav')).toHaveAttribute('data-chrome', 'showroom')
  })
})

describe('RX03-P1b — brand slots carry the official Option 5 artwork', () => {
  // R3: every slot shows the stacked lockup (roofline above the wordmark); reversed on ink.
  it.each([
    ['public-masthead', 'light', false, ['carup-logo-stacked-on-light.svg'], 42],
    ['public-footer', 'light', false, ['carup-logo-stacked-on-light.svg'], 42],
    ['workspace-rail', 'ink', true, ['carup-logo-stacked-on-dark.svg'], 32],
  ] as const)('%s (%s) uses %j', (slot, tone, compact, files, height) => {
    const { container } = render(<BrandMark slot={slot} tone={tone} compact={compact} />)
    const images = Array.from(container.querySelectorAll('img'))
    expect(images.map(img => img.getAttribute('data-brand-file'))).toEqual(files)
    expect(images[0]).toHaveAttribute('height', String(height))
    expect(container.querySelector('[data-brand-fallback]')).toBeNull()
    expect(container.querySelector('[data-brand-source="option5"]')).not.toBeNull()
  })
})

describe('RX03-P1b — the chrome is independently controlled (R3)', () => {
  it('with the chrome presentation off, the phone nav is unchanged: it never yields and keeps its colours', () => {
    render(
      <MemoryRouter initialEntries={['/marketplace/X']}>
        <CompactBottomNav />
        <ContactBar active />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('compact-bottom-nav')).toBeInTheDocument()
    // The page's contact bar therefore docks above the nav instead of covering it.
    expect(screen.getByTestId('contact-bar')).toHaveAttribute('data-docked', 'above-nav')
    expect(screen.getByRole('link', { current: 'page' }).className).toContain('text-orange-600')
  })

  it('the showroom PAGES switch does not turn on the chrome', () => {
    ;(globalThis as Record<string, unknown>).__CARUP_SHOWROOM_PAGES__ = true
    render(<MemoryRouter initialEntries={['/marketplace/X']}><CompactBottomNav /><ContactBar active /></MemoryRouter>)
    expect(screen.getByTestId('compact-bottom-nav')).toBeInTheDocument()
  })

  it('in a production-mode build, visitor opt-ins cannot turn the chrome on', () => {
    vi.stubEnv('PROD', true)
    chromeOn()
    window.sessionStorage.setItem('carup-showroom-chrome', '1')
    render(<MemoryRouter initialEntries={['/marketplace/X']}><CompactBottomNav /><ContactBar active /></MemoryRouter>)
    expect(screen.getByTestId('compact-bottom-nav')).toBeInTheDocument()
  })

  it('in a production-mode build, the release setting turns it on', () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_CARUP_SHOWROOM_CHROME', 'on')
    render(<MemoryRouter initialEntries={['/marketplace/X']}><CompactBottomNav /><ContactBar active /></MemoryRouter>)
    expect(screen.queryByTestId('compact-bottom-nav')).toBeNull()
  })

  it('the footer keeps the accepted logo when off and shows the Option 5 logo when on', () => {
    const { unmount } = render(<MemoryRouter><Footer /></MemoryRouter>)
    expect(screen.queryByTestId('footer-brand')).toBeNull()
    expect(document.querySelector('footer [data-brand-file]')).toBeNull()
    unmount()
    chromeOn()
    render(<MemoryRouter><Footer /></MemoryRouter>)
    expect(screen.getByTestId('footer-brand').querySelector('img')).toHaveAttribute('data-brand-file', 'carup-logo-stacked-on-dark.svg')
  })
})

describe('RX03 R3 — mobile-web navigation follows the binding native IA (13 Oct 2026)', () => {
  const labels = () => Array.from(screen.getByTestId('compact-bottom-nav').querySelectorAll('a')).map(a => [a.textContent, a.getAttribute('href')])

  it('showroom chrome: Home | Buy | Verify | Sell | Trade; Account is not a tab; Trade is the governed gateway', () => {
    chromeOn()
    render(<MemoryRouter initialEntries={['/']}><CompactBottomNav /></MemoryRouter>)
    expect(labels()).toEqual([['Home', '/'], ['Buy', '/marketplace'], ['Verify', '/search'], ['Sell', '/sell'], ['Trade', '/diaspora']])
  })

  it('accepted chrome (switch off) is unchanged', () => {
    render(<MemoryRouter initialEntries={['/']}><CompactBottomNav /></MemoryRouter>)
    expect(labels().map(([label]) => label)).toEqual(['Home', 'Market', 'Verify', 'Sell', 'Account'])
  })
})
