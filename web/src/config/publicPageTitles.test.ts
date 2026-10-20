import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pageMetadata } from './publicPageMetadata'

/**
 * OC-NATIVE-FINAL-02-R1 P2-C — a guest on /sell saw the browser title "Page not found | CarUp" over a
 * working page. Every document request is served by api/public-page, whose <title> and HTTP status
 * come from pageMetadata; a real route that is in neither DISCOVERY nor the feature registry fell
 * through to the not-found title.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const app = readFileSync(path.resolve(here, '../App.tsx'), 'utf8')

const NOT_FOUND_TITLE = 'Page not found | CarUp'

// Every static page route the SPA renders. Redirects (<Navigate>) and the catch-all are not pages.
const STATIC_ROUTES = [...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{\s*<([A-Za-z]+)/g)]
  .filter(([, route, element]) => element !== 'Navigate' && route !== '*' && !route.includes(':'))
  .map(([, route]) => route)

describe('every real page is served with its own title (OC-NATIVE-FINAL-02-R1 P2-C)', () => {
  it('reads the route table it checks', () => {
    expect(STATIC_ROUTES.length).toBeGreaterThan(100)
    expect(STATIC_ROUTES).toContain('/sell')
  })

  it('the guest Sell page is titled as the Sell page', () => {
    const meta = pageMetadata('/sell')
    expect(meta.title).toBe('Sell your car | CarUp')
    expect(meta.status).toBe(200)
  })

  it.each(STATIC_ROUTES)('%s is not served as "Page not found"', (route) => {
    const meta = pageMetadata(route)
    expect(meta.title).not.toBe(NOT_FOUND_TITLE)
    expect(meta.status).toBe(200)
  })

  it('account-flow pages are real pages but are never indexed, even in production', () => {
    for (const route of ['/sell', '/onboarding', '/dealer/onboarding', '/join-garage', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email']) {
      const meta = pageMetadata(route, false)
      expect(meta.status, route).toBe(200)
      expect(meta.robots, route).toBe('noindex, nofollow')
    }
    expect(pageMetadata('/auth/reset-password').title).toBe('Choose a new password | CarUp')
    expect(pageMetadata('/auth/verify-email').title).toBe('Verify your email | CarUp')
  })

  it('an unknown path is still not found', () => {
    expect(pageMetadata('/no-such-page').title).toBe(NOT_FOUND_TITLE)
    expect(pageMetadata('/no-such-page').status).toBe(404)
  })
})
