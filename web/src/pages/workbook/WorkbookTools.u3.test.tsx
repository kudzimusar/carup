/**
 * O2 · U3 — THE WORKBOOK IS A CARUP PAGE, NOT A DEMO PARKED AT A URL.
 *
 * Owner UAT passed the workbook's FUNCTION and failed its PLACE. Three separate
 * things were wrong and each is pinned here:
 *
 *   1. THE SHELL. `/workbook-tools` was declared in App.tsx's auth group, under
 *      `MainLayout hideNav`, beside /login and /register. A signed-in product
 *      surface rendered with no global nav, no footer and no sign of who was
 *      signed in — the user could not get anywhere else from it.
 *   2. THE REGISTRY. There was no entry for the route at all, so every
 *      registry-derived decision was taken about a page the registry could not
 *      see. Silence is not neutrality.
 *   3. THE PALETTE. The page and its workspace hardcoded `bg-gray-950`,
 *      `bg-gray-900`, `text-gray-100` and a violet AI treatment, overriding the
 *      CarUp theme instead of following it.
 *
 * These are asserted against the SHIPPED SOURCE rather than a render, because
 * what failed UAT was structural: which route group a line sits in, and which
 * class names are written down. A render can be made to look right in a test
 * while the shipped route declaration stays in the wrong group.
 *
 * ANTI-VACUITY. Every scan is proven non-empty: the route-group parser must
 * actually find both groups and place known members correctly, and the palette
 * scanner must flag a planted violation.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getFeatureByRoute } from '@/config/featureRegistry'

const root = path.resolve(__dirname, '../../..')
const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf-8')
const pageSrc = fs.readFileSync(path.join(root, 'src/pages/workbook/WorkbookTools.tsx'), 'utf-8')
const workspaceSrc = fs.readFileSync(path.join(root, 'src/components/workbook/WorkbookWorkspace.tsx'), 'utf-8')

/** Strip block and line comments so a class name discussed in prose is never read as shipped code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The routes declared inside `<Route element={<MainLayout hideNav />}>`. Parsed by walking from
 * that element to its closing `</Route>` at the same depth, so a route added anywhere in the group
 * is seen regardless of order.
 */
function hideNavRoutes(): string[] {
  const open = appSrc.indexOf('<Route element={<MainLayout hideNav />}>')
  expect(open).toBeGreaterThan(-1)
  const close = appSrc.indexOf('</Route>', open)
  expect(close).toBeGreaterThan(open)
  const body = appSrc.slice(open, close)
  return [...body.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1])
}

/** The routes declared inside the canonical `<Route element={<MainLayout />}>` shell. */
function shellRoutes(): string[] {
  const open = appSrc.indexOf('<Route element={<MainLayout />}>')
  expect(open).toBeGreaterThan(-1)
  const close = appSrc.indexOf('\n        </Route>', open)
  expect(close).toBeGreaterThan(open)
  const body = appSrc.slice(open, close)
  return [...body.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1])
}

/** Hardcoded palette that overrides the theme rather than following it. */
const FORBIDDEN_PALETTE = /\b(?:bg|text|border|from|to|via)-(?:gray|slate|zinc|neutral|violet|purple|indigo)-\d{2,3}\b/g

describe('U3 — the workbook renders inside the canonical CarUp shell', () => {

  it('ANTI-VACUITY — the route-group parser actually resolves both groups', () => {
    const hidden = hideNavRoutes()
    const shell = shellRoutes()
    expect(hidden.length).toBeGreaterThan(3)
    expect(shell.length).toBeGreaterThan(10)
    // Known members, so a parser that silently returned [] cannot pass anything below.
    expect(hidden).toContain('/login')
    expect(hidden).toContain('/register')
    expect(shell).toContain('/marketplace')
  })

  it('/workbook-tools is NOT in the chromeless auth group', () => {
    expect(hideNavRoutes()).not.toContain('/workbook-tools')
  })

  it('/workbook-tools IS in the canonical shell, so it gets the global nav and footer', () => {
    expect(shellRoutes()).toContain('/workbook-tools')
  })

  it('the shell does not treat it as an auth page — nav is rendered, not suppressed', () => {
    // MainLayout hides the navbar when the route's feature id starts with `auth.`. A workbook
    // registered under an auth id would be chromeless again through a different door.
    const feature = getFeatureByRoute('/workbook-tools')
    expect(feature).toBeTruthy()
    expect(feature?.id.startsWith('auth.')).toBe(false)
  })
})

describe('U3 — the registry knows the route exists', () => {

  it('has an entry, and it is truthful about being unadvertised', () => {
    const feature = getFeatureByRoute('/workbook-tools')
    expect(feature).toBeTruthy()
    expect(feature?.route).toBe('/workbook-tools')
    expect(feature?.requiresAuth).toBe(true)
    // `hidden` means: directly accessible to a role-eligible signed-in account, advertised
    // nowhere. Nothing in the app links to this page, so any other lifecycle would be a claim
    // the product does not honour.
    expect(feature?.lifecycle).toBe('hidden')
    expect(feature?.placements).toEqual([])
  })

  it('does not restate the backend catalogue gate in the frontend', () => {
    // WHAT the workbook grants is decided per account by the server-derived catalogue and
    // re-verified on every call. If the registry narrowed the roles it would become a second,
    // drifting copy of an authorization rule.
    const feature = getFeatureByRoute('/workbook-tools')
    expect(feature?.roles).toEqual(
      expect.arrayContaining(['owner', 'dealer', 'mechanic', 'insurance', 'government', 'admin', 'bank']),
    )
  })
})

describe('U3 — the workbook follows the CarUp theme instead of overriding it', () => {

  it('ANTI-VACUITY — the palette scanner flags a planted violation', () => {
    const planted = 'return <div className="bg-gray-950 text-violet-200" />'
    expect(planted.match(FORBIDDEN_PALETTE)).not.toBeNull()
    expect(planted.match(FORBIDDEN_PALETTE)).toEqual(
      expect.arrayContaining(['bg-gray-950', 'text-violet-200']),
    )
  })

  it('the page hardcodes no palette', () => {
    expect(stripComments(pageSrc).match(FORBIDDEN_PALETTE)).toBeNull()
  })

  it('the workspace hardcodes no palette', () => {
    expect(stripComments(workspaceSrc).match(FORBIDDEN_PALETTE)).toBeNull()
  })

  it('the page no longer claims the whole viewport — the shell owns the background', () => {
    expect(stripComments(pageSrc)).not.toMatch(/min-h-screen/)
  })

  it('the three provenance badges stay distinguishable from one another', () => {
    // This distinction is a rendering law, not decoration: a deterministic match, an AI PROPOSAL
    // and an unmapped column must never be mistakable. Converting to shared tokens must not
    // collapse them into one look.
    const clean = stripComments(workspaceSrc)
    const badges = ['provider-deterministic', 'provider-ai', 'provider-unmapped']
    const treatments = badges.map((id) => {
      const idx = clean.indexOf(id)
      expect(idx).toBeGreaterThan(-1)
      return clean.slice(idx, clean.indexOf('>', idx))
    })
    expect(new Set(treatments).size).toBe(3)
    // And the AI proposal is still labelled as a proposal, in words.
    expect(clean).toMatch(/AI PROPOSAL/)
  })

  it('wide content scrolls inside its own container — the page must not scroll sideways', () => {
    // At 393px the mapping, attention and recent-imports tables are all wider than the viewport.
    const clean = stripComments(workspaceSrc)
    const tables = [...clean.matchAll(/<table\b/g)].length
    expect(tables).toBeGreaterThan(0)
    const wrapped = [...clean.matchAll(/overflow-x-auto/g)].length
    expect(wrapped).toBeGreaterThanOrEqual(tables)
  })
})
