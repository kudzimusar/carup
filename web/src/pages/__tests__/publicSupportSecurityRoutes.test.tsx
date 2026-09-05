import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import Support from '../Support'
import Security from '../Security'
import { CANONICAL_PUBLIC_ORIGIN } from '@/lib/usePageMetadata'

/**
 * G12 — /support and /security are real routes, and the test asserts that the way a BROWSER would.
 *
 * "HTTP 200 means the route exists" is the wrong model for this application. `web/vercel.json`
 * rewrites unmatched paths to `index.html`, so every path answers 200 with the SPA shell — a soft
 * 404 that no status check can detect and no 404 monitoring can ever fire on. That is precisely why
 * `canonicalEmailLinks.js` gated these two routes until now.
 *
 * So acceptance is router-and-DOM based: after hydration, the expected component is mounted, its
 * unique heading is rendered, the document title and canonical link are correct, and an unknown path
 * renders NotFound instead of quietly rendering nothing that looks like a page.
 */

/** A NotFound stand-in that is unmistakable, so "rendered nothing" cannot pass as "rendered 404". */
function NotFoundProbe() {
  return <div>G12-NOT-FOUND-PROBE</div>
}

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/support" element={<Support />} />
        <Route path="/security" element={<Security />} />
        <Route path="*" element={<NotFoundProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

function canonicalHref() {
  return document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null
}

function metaDescription() {
  return document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null
}

describe('G12 public routes', () => {
  it('A1 /support renders the Support page, not the Help Center and not nothing', () => {
    renderAt('/support')
    expect(screen.getByRole('heading', { level: 1, name: 'CarUp Support' })).toBeInTheDocument()
    expect(screen.queryByText('G12-NOT-FOUND-PROBE')).toBeNull()
    // A distinct semantic identity — not an alias to /help.
    expect(screen.getByText(/What we can help with/i)).toBeInTheDocument()
    expect(screen.getAllByText(/support@carup\.dev/).length).toBeGreaterThan(0)
  })

  it('A2 /security renders the Security page and is NOT Trust & Safety', () => {
    renderAt('/security')
    expect(screen.getByRole('heading', { level: 1, name: 'CarUp Security' })).toBeInTheDocument()
    expect(screen.queryByText('G12-NOT-FOUND-PROBE')).toBeNull()
    // Account/phishing/reporting guidance — a different question from how CarUp verifies a vehicle.
    expect(screen.getByText(/What CarUp will never ask you for/i)).toBeInTheDocument()
    expect(screen.getByText(/Recognising a suspicious message/i)).toBeInTheDocument()
    expect(screen.getAllByText(/security@carup\.dev/).length).toBeGreaterThan(0)
  })

  it('A3 NEGATIVE CONTROL: an unknown path renders NotFound, never Support or Security', () => {
    renderAt('/no-such-carup-route-g12')
    expect(screen.getByText('G12-NOT-FOUND-PROBE')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'CarUp Support' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 1, name: 'CarUp Security' })).toBeNull()
  })
})

describe('G12 page identity', () => {
  it('B1 /support sets its own title, description and canonical URL', () => {
    renderAt('/support')
    expect(document.title).toMatch(/CarUp Support/)
    expect(metaDescription()).toMatch(/CarUp account/i)
    expect(canonicalHref()).toBe(`${CANONICAL_PUBLIC_ORIGIN}/support`)
  })

  it('B2 /security sets its own title, description and canonical URL', () => {
    renderAt('/security')
    expect(document.title).toMatch(/CarUp Security/)
    expect(metaDescription()).toMatch(/phishing|security/i)
    expect(canonicalHref()).toBe(`${CANONICAL_PUBLIC_ORIGIN}/security`)
  })

  it('B3 the two pages have DIFFERENT identities — not one shared shell title', () => {
    renderAt('/support')
    const supportTitle = document.title
    const supportCanonical = canonicalHref()
    renderAt('/security')
    expect(document.title).not.toBe(supportTitle)
    expect(canonicalHref()).not.toBe(supportCanonical)
  })

  it('B4 the canonical URL is always the CarUp origin, never the deployment host', () => {
    // A preview deployment must never publish itself as the canonical address of a CarUp page.
    renderAt('/support')
    expect(canonicalHref()).toMatch(/^https:\/\/carup\.dev\//)
    expect(canonicalHref()).not.toMatch(/vercel\.app/)
    expect(canonicalHref()).not.toMatch(/carup\.app/)
    expect(canonicalHref()).not.toContain(window.location.origin)
  })
})

describe('G12 content honesty', () => {
  it('C1 Support promises no capability CarUp does not have', () => {
    const { container } = renderAt('/support')
    const text = container.textContent ?? ''
    for (const claim of [/24\/7/i, /opening hours/i, /live chat/i, /response time/i, /\bSLA\b/, /call us/i, /hotline/i]) {
      expect(text).not.toMatch(claim)
    }
    // ...and it is not empty, so this is not passing by rendering nothing.
    expect(text.length).toBeGreaterThan(600)
  })

  it('C2 Security asserts no certification, bounty or guarantee CarUp does not hold', () => {
    const { container } = renderAt('/security')
    const text = container.textContent ?? ''
    for (const claim of [/SOC ?2/i, /ISO ?27001/i, /bug bounty/i, /hotline/i, /law enforcement/i, /insured/i, /guarantee/i, /certified/i]) {
      expect(text).not.toMatch(claim)
    }
    expect(text.length).toBeGreaterThan(600)
  })

  it('C3 neither page invents an identity the owner freeze forbids', () => {
    for (const path of ['/support', '/security']) {
      const { container } = renderAt(path)
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/\bCEO\b/)
      expect(text).not.toMatch(/Tendai Moyo/i)
      expect(text).not.toMatch(/Pvt Ltd|Private Limited|\bLtd\b/)
      expect(text).not.toMatch(/facebook|twitter|linkedin|instagram/i)
    }
  })

  it('C4 questions@ is offered as the shared human channel, not as a support replacement', () => {
    const { container } = renderAt('/support')
    const text = container.textContent ?? ''
    expect(text).toContain('questions@carup.dev')
    expect(text).toMatch(/not a replacement for support@carup\.dev/i)
  })

  it('C5 Security states what CarUp will never ask for by email', () => {
    const { container } = renderAt('/security')
    const text = container.textContent ?? ''
    expect(text).toMatch(/your password/i)
    expect(text).toMatch(/one-time code or OTP/i)
    expect(text).toMatch(/password-reset link or token/i)
  })
})
