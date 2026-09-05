/**
 * App route convergence — both sides of the post-#194 reconciliation must survive.
 *
 * Why this file exists
 * --------------------
 * The reconciliation resolved web/src/App.tsx by taking main's side wholesale. That silently
 * dropped the Service Network route `/garages/:slug`, leaving web/src/pages/GarageDetail.tsx on
 * disk with zero importers — a page that existed but could never be reached. Nothing failed,
 * because no test asserted the route table.
 *
 * This test renders the REAL App at each path and asks React Router what it resolved to. A path
 * with no matching Route falls through to App's catch-all NotFoundPage, so the absence of that
 * page is positive evidence the route is registered. The bogus-path case below is the control
 * that proves this detection actually works.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import App from './App'

beforeAll(() => {
  // Pages mount data effects. This test is about ROUTING, so keep the network inert and quiet
  // rather than asserting anything about page contents.
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** A path resolves when App's catch-all NotFoundPage is NOT what rendered. */
function resolves(path: string) {
  const { unmount } = renderAt(path)
  const notFound = screen.queryByTestId('not-found-page')
  const resolved = notFound === null
  unmount()
  return resolved
}

describe('App route convergence after the post-#194 reconciliation', () => {
  it('detects a missing route — control case', () => {
    // If this ever passes, every other assertion in this file is meaningless.
    expect(resolves('/this-route-does-not-exist-9f3a1c')).toBe(false)
  })

  it('registers the Service Network public garage routes', () => {
    expect(resolves('/garages')).toBe(true)
    expect(resolves('/garages/msasa-motors')).toBe(true)
  })

  it('keeps GarageDetail wired to a route rather than orphaned on disk', async () => {
    // The specific failure: the page file survived the merge, its route did not.
    const app = await import('./App?raw')
      .then((m) => (m as unknown as { default: string }).default)
      .catch(() => null)
    if (app) {
      expect(app).toMatch(/import\s+GarageDetail\s+from/)
      expect(app).toMatch(/path="\/garages\/:slug"/)
    }
    // The load-bearing assertion is the runtime one; the source check above is a readable
    // corroboration for whoever hits this failure next.
    expect(resolves('/garages/any-slug')).toBe(true)
  })

  // Each case mounts a full page, so this one needs a real budget rather than the 5s default.
  // The deadline is wall-clock only; it weakens no assertion.
  it('preserves the post-#194 surface that the other side of the merge would have dropped', () => {
    // Restoring #197's App.tsx wholesale is the converse mistake. These are main-side routes.
    for (const path of ['/', '/marketplace', '/dealers', '/insurance', '/pricing', '/about']) {
      expect(resolves(path), `post-#194 route disappeared: ${path}`).toBe(true)
    }
  }, 60000)
})
