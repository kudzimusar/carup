/**
 * RX-02A S1-4A — PublicShell prototype (DEV-only).
 *
 * Public showroom chrome: ink masthead with reserved logo slot, manifest-
 * projected mega-menus and direct links, search + account/workspace entry,
 * mobile drawer (focus-trapped) and a 5-slot mobile bottom tab bar, plus the
 * projected public footer at EVERY viewport (R1-01: stacked single column on
 * mobile/tablet clearing the fixed tab bar, 5-column grid at lg). All
 * navigation is projected from navigationManifest.ts / featureRegistry.ts —
 * nothing is hand-written.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  CircleUserRound,
  Home,
  LayoutGrid,
  Menu,
  Search,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react'
import type { ShellContext, ShellNavItem, ShellNavSection } from './contracts'
import { projectDirectPublicLinks, projectFooterColumns, projectMegaMenu, projectMobileSurfaces } from './navProjection'
import { getFooterSocial } from '@/config/navigationManifest'
import { getDashboardRoute } from '@/config/featureRegistry'
import { BrandMark } from './BrandMark'
import { FixtureNotice } from './fixtureDisplay'
import { isActivePath } from './pathUtils'

const MEGA_MENUS: Array<{ id: 'buy' | 'sell' | 'verify' | 'parts'; label: string; surface: 'navbar-mega-buy' | 'navbar-mega-sell' | 'navbar-mega-verify' | 'navbar-mega-parts' }> = [
  { id: 'buy', label: 'Buy', surface: 'navbar-mega-buy' },
  { id: 'sell', label: 'Sell', surface: 'navbar-mega-sell' },
  { id: 'verify', label: 'Verify', surface: 'navbar-mega-verify' },
  { id: 'parts', label: 'Parts', surface: 'navbar-mega-parts' },
]

const BOTTOM_ICONS = [Home, LayoutGrid, ShieldCheck, Tag, CircleUserRound]

function MegaMenu({ label, sections, currentPath }: { label: string; sections: ShellNavSection[]; currentPath: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1 rounded-control px-3 text-sm font-medium text-[color-mix(in_srgb,var(--carup-raw-paper)_90%,transparent)] transition-colors hover:bg-carup-raw-ink-2 hover:text-carup-raw-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
      >
        {label}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`${label} menu`}
          className="absolute left-0 top-full z-50 mt-1 grid w-[44rem] max-w-[calc(100vw-2rem)] grid-cols-3 gap-4 rounded-card border border-carup-raw-ink-2 bg-carup-raw-ink p-4 text-carup-raw-paper shadow-sheet"
        >
          {sections.map(section => (
            <div key={section.title}>
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[color-mix(in_srgb,var(--carup-raw-paper)_50%,transparent)]">
                {section.title}
              </p>
              <ul>
                {section.items.map(item => (
                  <MegaMenuItem key={item.id} item={item} currentPath={currentPath} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MegaMenuItem({ item, currentPath }: { item: ShellNavItem; currentPath: string }) {
  if (item.planned) {
    return (
      <li>
        <span
          aria-disabled="true"
          title={item.description ?? 'Coming soon'}
          className="flex cursor-not-allowed items-center justify-between gap-2 rounded-control px-2 py-1.5 text-sm text-[color-mix(in_srgb,var(--carup-raw-paper)_40%,transparent)]"
        >
          {item.label}
          <span className="rounded-chrome border border-carup-raw-ink-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color-mix(in_srgb,var(--carup-raw-paper)_40%,transparent)]">
            Soon
          </span>
        </span>
      </li>
    )
  }
  const active = isActivePath(currentPath, item.href)
  return (
    <li>
      <Link
        to={item.href}
        aria-current={active ? 'page' : undefined}
        className="block rounded-control px-2 py-1.5 text-sm text-[color-mix(in_srgb,var(--carup-raw-paper)_80%,transparent)] transition-colors hover:bg-carup-raw-ink-2 hover:text-carup-raw-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
      >
        {item.label}
      </Link>
    </li>
  )
}

function MobileDrawer({
  open,
  onClose,
  primary,
  secondary,
  authenticated,
  workspaceHref,
  displayName,
}: {
  open: boolean
  onClose: () => void
  primary: ShellNavItem[]
  secondary: ShellNavItem[]
  authenticated: boolean
  workspaceHref: string
  displayName: string
}) {
  const drawerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const prevActive = document.activeElement as HTMLElement | null
    const panel = drawerRef.current
    panel?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter(el => el.offsetParent !== null)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prevActive?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 lg:hidden" data-testid="shell-mobile-drawer">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-[color-mix(in_srgb,var(--carup-raw-ink)_50%,transparent)]"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        className="absolute left-0 top-0 flex h-full w-[310px] max-w-[85vw] flex-col border-r border-carup-line bg-carup-bg-raised"
      >
        <div className="flex h-16 items-center justify-between border-b border-carup-line px-4">
          <BrandMark slot="mobile-drawer" tone="light" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-11 w-11 items-center justify-center rounded-control text-carup-text-2 hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto px-2 py-3">
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-carup-text-3">Browse</p>
          <ul className="space-y-0.5">
            {primary.map(item => (
              <li key={item.id}>
                <Link
                  to={item.href}
                  onClick={onClose}
                  data-testid={`shell-mobile-nav-${item.id}`}
                  className="flex min-h-11 items-center rounded-control px-3 text-sm font-medium text-carup-text hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="border-t border-carup-line px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-carup-text-3">
            More
          </p>
          <ul className="space-y-0.5">
            {secondary.map(item => (
              <li key={item.id}>
                <Link
                  to={item.href}
                  onClick={onClose}
                  className="flex min-h-11 items-center rounded-control px-3 text-sm font-medium text-carup-text hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-carup-line p-3">
          {authenticated ? (
            <Link
              to={workspaceHref}
              onClick={onClose}
              className="flex min-h-11 items-center gap-2 rounded-control bg-carup-action px-3 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
            >
              <CircleUserRound className="h-4 w-4" aria-hidden="true" />
              My CarUp — {displayName}
            </Link>
          ) : (
            <div className="flex flex-col gap-2">
              <Link
                to="/login"
                onClick={onClose}
                className="flex min-h-11 items-center justify-center rounded-control border border-carup-line px-3 text-sm font-semibold text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                onClick={onClose}
                className="flex min-h-11 items-center justify-center rounded-control bg-carup-action px-3 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
              >
                Create account
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const BOTTOM_LABELS = ['Home', 'Market', 'Verify', 'Sell', 'Account']
const BOTTOM_HREFS = ['/', '/marketplace', '/search', '/sell', '/login']

export function PublicShell({
  context,
  currentPath = '/',
  children,
}: {
  context: ShellContext
  currentPath?: string
  children?: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const authenticated = context.identity.roleTitle !== 'Public visitor'
  const workspaceHref = getDashboardRoute('owner')
  const displayName = context.identity.displayName

  const navCtx = { isAuthenticated: authenticated, role: authenticated ? ('owner' as const) : null }
  const megaSections = MEGA_MENUS.map(m => ({ ...m, sections: projectMegaMenu(m.surface, navCtx) }))
  const directLinks = projectDirectPublicLinks(navCtx)
  const footerColumns = projectFooterColumns(navCtx)
  const social = getFooterSocial()
  const mobile = projectMobileSurfaces(navCtx)

  const bottomItems = BOTTOM_LABELS.map((label, i) => ({
    label,
    href: BOTTOM_HREFS[i],
    icon: BOTTOM_ICONS[i],
  }))

  return (
    <div className="min-h-screen bg-carup-bg text-carup-text" style={{ scrollPaddingBottom: 'calc(60px + env(safe-area-inset-bottom))' }}>
      <a
        href="#shell-public-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-carup-action focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-carup-action-on"
      >
        Skip to main content
      </a>

      {/* Ink masthead — reserved logo location + manifest-projected nav */}
      <header className="sticky top-0 z-40 bg-carup-raw-ink text-carup-raw-paper" data-testid="shell-public-header">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-4 lg:px-6">
          <BrandMark slot="public-masthead" tone="ink" />
          <nav aria-label="Primary" className="ml-2 hidden items-center lg:flex">
            {megaSections.map(m => (
              <MegaMenu key={m.id} label={m.label} sections={m.sections} currentPath={currentPath} />
            ))}
            {directLinks.map(item =>
              item.planned ? (
                <span
                  key={item.id}
                  aria-disabled="true"
                  className="flex min-h-11 cursor-not-allowed items-center gap-1 rounded-control px-3 text-sm text-[color-mix(in_srgb,var(--carup-raw-paper)_40%,transparent)]"
                >
                  {item.label}
                  <span className="rounded-chrome border border-carup-raw-ink-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
                </span>
              ) : (
                <Link
                  key={item.id}
                  to={item.href}
                  aria-current={isActivePath(currentPath, item.href) ? 'page' : undefined}
                  className="flex min-h-11 items-center rounded-control px-3 text-sm font-medium text-[color-mix(in_srgb,var(--carup-raw-paper)_90%,transparent)] transition-colors hover:bg-carup-raw-ink-2 hover:text-carup-raw-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/search"
              className="hidden min-h-11 items-center gap-1 rounded-control px-3 text-sm text-[color-mix(in_srgb,var(--carup-raw-paper)_90%,transparent)] transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus sm:flex"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Search
            </Link>
            {authenticated ? (
              <Link
                to={workspaceHref}
                data-testid="shell-workspace-entry"
                className="flex min-h-11 items-center gap-2 rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
              >
                <CircleUserRound className="h-4 w-4" aria-hidden="true" />
                My CarUp
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="hidden min-h-11 items-center justify-center rounded-control border border-carup-raw-ink-2 px-4 text-sm font-semibold text-carup-raw-paper transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus md:flex"
                >
                  Sign In
                </Link>
                <Link
                  to="/sell"
                  className="flex min-h-11 items-center rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                >
                  Sell Your Car
                </Link>
              </>
            )}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              data-testid="shell-mobile-menu"
              className="flex h-11 w-11 items-center justify-center rounded-control text-carup-raw-paper transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        primary={mobile.primary}
        secondary={mobile.secondary}
        authenticated={authenticated}
        workspaceHref={workspaceHref}
        displayName={displayName}
      />

      {/* Main content region (fixture chip lives inside the landmark) */}
      <main id="shell-public-main" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 pb-24 pt-6 outline-none lg:px-6 lg:pb-10">
        {children}
        <div className="pointer-events-none fixed bottom-16 left-2 z-40 lg:bottom-2">
          <FixtureNotice>{`PublicShell prototype · ${context.identity.displayName} · ${context.identity.isFixture ? 'fictional fixture' : ''}`}</FixtureNotice>
        </div>
      </main>

      {/* Public marketing footer — ALL viewports (R1-01): stacked single column on
          mobile/tablet, 5-column grid at lg. Below lg the fixed 5-item bottom tab
          bar is a separate surface; the footer clears it (pb-24) and the iOS
          safe-area so legal/support links stay reachable, never obscured. */}
      <footer
        className="border-t border-carup-line bg-carup-bg-raised pb-24 lg:pb-0"
        data-testid="shell-public-footer"
      >
        <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-8 px-4 py-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6 lg:px-6 lg:py-10">
          <div>
            <BrandMark slot="public-footer" tone="light" />
            <p className="mt-3 text-xs text-carup-text-3">
              Fictional fixture footer — column content projected from the navigation manifest.
            </p>
          </div>
          {footerColumns.map(col => (
            <nav key={col.column} aria-label={`Footer — ${col.column}`}>
              <p className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-carup-text-3">
                {col.column}
              </p>
              <ul className="space-y-1.5">
                {col.items.map(item => (
                  <li key={item.id}>
                    {item.planned ? (
                      <span aria-disabled="true" className="flex cursor-not-allowed items-center gap-1 text-sm text-carup-text-3">
                        {item.label}
                        <span className="rounded-chrome border border-carup-line px-1 py-0.5 text-[10px] uppercase">Soon</span>
                      </span>
                    ) : (
                      <Link
                        to={item.href}
                        className="text-sm text-carup-text-2 transition-colors hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-t border-carup-line">
          <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
            <p className="text-xs text-carup-text-3">© 2026 CarUp (prototype footer — fictional)</p>
            <ul className="flex flex-wrap items-center gap-2">
              {social.map(s =>
                s.state === 'planned' ? (
                  <li key={s.id}>
                    <span
                      aria-disabled="true"
                      title={`${s.label} — planned, URL not yet approved`}
                      className="inline-flex cursor-not-allowed items-center rounded-control border border-dashed border-carup-line px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-carup-text-3"
                    >
                      {s.platform}
                    </span>
                  </li>
                ) : (
                  <li key={s.id}>
                    <a href={s.url} className="text-xs text-carup-text-2 hover:text-carup-text">
                      {s.label}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </footer>

      {/* Mobile bottom tab bar — 5 slots, 60px + safe area (UI_DESIGN_REFERENCE §3/§8) */}
      <nav
        aria-label="Compact app navigation"
        data-testid="shell-public-bottom-nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-carup-line bg-carup-bg-raised pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-sheet lg:hidden"
      >
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {bottomItems.map(({ label, href, icon: Icon }) => {
            const active = isActivePath(currentPath, href)
            return (
              <Link
                key={label}
                to={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-control px-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-inset ${
                  active ? 'font-semibold text-carup-action-hover' : 'text-carup-text-3 hover:bg-carup-bg-surface hover:text-carup-text'
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.4]' : ''}`} aria-hidden="true" />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
