/**
 * RX-02A S1-4B — WorkspaceShell (production-intent, default-OFF candidate).
 *
 * Ink-chrome workspace: manifest-driven navigation, compact global masthead with role/tenant
 * context, optional object identity with ONE prioritized primary action, contextual status panel,
 * and a slim utility footer. NO public marketing footer. Navigation is PROJECTED from the feature
 * registry for the active family — no cross-family leakage. Security model note: server
 * authorization remains authoritative; this chrome implies no access decision and the surrounding
 * route guard still runs.
 *
 * RX03-P2-R4 (Owner UX reference closure):
 *  - ONE brand owner: the official horizontal logo renders once, in the full-width masthead.
 *    The rail and the phone drawer carry the workspace/tenant NAMES as text, never a second logo.
 *  - ONE home: the hard-coded "Overview" link is gone; the family home is added only when the
 *    projection does not already contain it (`withFamilyHome`).
 *  - ONE current page: the most specific matching destination carries aria-current="page".
 *  - Purpose-specific navigation: `navStyle="rail"` (many destinations, collapsible, desktop) or
 *    `navStyle="tabs"` (few, grouped destinations in a compact bar under the masthead). Phones get
 *    neither permanently — a menu opens the same destinations in a drawer.
 *  - Object-scoped tabs (`objectTabs`) for workbenches whose pages share one object (an order).
 *  - The two-column content grid only exists when a status panel does, so no empty column eats
 *    working space; `object` is optional so pages that own their heading are not titled twice.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  ChevronRight,
  CircleUserRound,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from 'lucide-react'
import type {
  ShellBreadcrumbStep,
  ShellIdentity,
  ShellNavItem,
  ShellNavSection,
  ShellObjectIdentity,
  ShellPrimaryAction,
  WorkspaceFamily,
} from './contracts'
import { projectWorkspaceRail } from './navProjection'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { resolveFeatureIcon } from '@/config/featureIcons'
import type { UserRole } from '@shared/types'
import { BrandMark } from './BrandMark'
import { navigableHrefs, pickActiveHref, withFamilyHome } from './activeNav'
import { PUBLIC_IDENTITY } from '@/config/publicIdentity'

const FAMILY_LABELS: Record<string, string> = {
  personal: 'My CarUp',
  dealer: 'Dealer OS',
  garage: 'Garage OS',
  trade: 'Trade',
  institutional: 'Institutional',
  admin: 'Administration',
  review: 'Independent review',
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus'
// Literal class strings (Tailwind only generates classes it can read in the source).
const PAPER_TEXT = {
  45: 'text-[color-mix(in_srgb,var(--carup-raw-paper)_45%,transparent)]',
  55: 'text-[color-mix(in_srgb,var(--carup-raw-paper)_55%,transparent)]',
  68: 'text-[color-mix(in_srgb,var(--carup-raw-paper)_68%,transparent)]',
  78: 'text-[color-mix(in_srgb,var(--carup-raw-paper)_78%,transparent)]',
  85: 'text-[color-mix(in_srgb,var(--carup-raw-paper)_85%,transparent)]',
} as const
const PAPER = (pct: keyof typeof PAPER_TEXT) => PAPER_TEXT[pct]

type Current = 'page' | 'true' | undefined

function RailContent({
  sections,
  activeHref,
  activeKind,
  collapsed,
  onNavigate,
}: {
  sections: ShellNavSection[]
  activeHref: string | null
  activeKind: Current
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Workspace" className="flex-1 overflow-y-auto px-2 py-3">
      {sections.map((section, sectionIndex) => (
        <div key={`${section.title}-${sectionIndex}`} className={sectionIndex > 0 ? 'mt-3' : ''}>
          {!collapsed && section.title && (
            <p className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider ${PAPER(55)}`}>
              {section.title}
            </p>
          )}
          <ul className={collapsed ? 'flex flex-col items-center gap-1' : 'space-y-0.5'}>
            {section.items.map(item => {
              // R4-3 — resolve the item's OWN registry icon; the FileText
              // fallback applies only where metadata is genuinely absent.
              const Icon = resolveFeatureIcon(item.icon ?? null)
              if (item.planned) {
                // C4 — a planned feature is never an active navigable action:
                // it renders as an honest non-navigating "Soon" entry.
                return (
                  <li key={item.id} className={collapsed ? 'w-full' : ''}>
                    <span
                      aria-disabled="true"
                      title={item.description ?? 'Coming soon'}
                      className={`flex min-h-11 cursor-not-allowed items-center gap-2 rounded-control px-3 text-sm ${PAPER(45)} ${
                        collapsed ? 'justify-center px-0' : ''
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {!collapsed && (
                        <>
                          <span className="truncate">{item.label}</span>
                          <span className="ml-auto rounded-chrome border border-carup-raw-ink-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                            Soon
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                )
              }
              const active = activeHref === item.href
              return (
                <li key={item.id} className={collapsed ? 'w-full' : ''}>
                  <Link
                    to={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? activeKind : undefined}
                    className={`relative flex min-h-11 items-center gap-2 rounded-control px-3 text-sm transition-colors hover:bg-carup-raw-ink-2 ${FOCUS_RING} ${
                      collapsed ? 'justify-center px-0' : ''
                    } ${active ? 'bg-carup-raw-ink-2 font-medium text-carup-raw-paper' : PAPER(78)}`}
                  >
                    {active && (
                      <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-carup-raw-orange-signal" />
                    )}
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** Compact grouped destinations under the masthead (desktop/tablet); phones use the drawer. */
// Families with many destinations only get the tab bar where it fits without scrolling;
// below that breakpoint the same destinations live in the drawer.
const TABS_VISIBLE = { md: 'hidden md:block', xl: 'hidden xl:block' } as const
const MENU_HIDDEN_TABS = { md: 'md:hidden', xl: 'xl:hidden' } as const

function TabBar({
  label,
  sections,
  activeHref,
  activeKind,
  from,
}: {
  label: string
  sections: ShellNavSection[]
  activeHref: string | null
  activeKind: Current
  from: keyof typeof TABS_VISIBLE
}) {
  return (
    <nav aria-label={label} data-testid="shell-ws-tabs" className={`${TABS_VISIBLE[from]} border-b border-carup-line bg-carup-bg-raised`}>
      <div className="mx-auto flex max-w-[1560px] items-stretch gap-3 overflow-x-auto px-3 [scrollbar-width:none] lg:px-5 [&::-webkit-scrollbar]:hidden">
        {sections.map((section, i) => (
          <div key={`${section.title}-${i}`} role="group" aria-label={section.title || label} className="flex shrink-0 items-stretch gap-0.5">
            {i > 0 && <span aria-hidden="true" className="my-3 mr-2 w-px bg-carup-line 2xl:hidden" />}
            {section.title && (
              <span className="hidden items-center pr-2 text-[10px] font-semibold uppercase tracking-wider text-carup-text-3 2xl:flex" aria-hidden="true">
                {section.title}
              </span>
            )}
            {section.items.map(item => {
              if (item.planned) {
                return (
                  <span
                    key={item.id}
                    aria-disabled="true"
                    title={item.description ?? 'Coming soon'}
                    className="flex min-h-11 cursor-not-allowed items-center gap-1.5 whitespace-nowrap px-3 text-sm text-carup-text-3"
                  >
                    {item.label}
                    <span className="rounded-chrome border border-carup-line px-1 py-px text-[9px] font-medium uppercase tracking-wide">Soon</span>
                  </span>
                )
              }
              const active = activeHref === item.href
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  aria-current={active ? activeKind : undefined}
                  className={`flex min-h-11 items-center whitespace-nowrap border-b-2 px-2.5 text-sm transition-colors ${FOCUS_RING} focus-visible:ring-inset ${
                    active ? 'border-carup-action font-semibold text-carup-text' : 'border-transparent text-carup-text-2 hover:text-carup-text'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}

export function WorkspaceShell({
  family,
  identity,
  currentPath = '/dashboard',
  breadcrumbs = [],
  object,
  objectTabs,
  primaryAction,
  statusPanel,
  bottomNav,
  railSections,
  navStyle = 'rail',
  overviewHref = '/dashboard',
  homeLabel = 'Overview',
  accountLinks,
  onSignOut,
  children,
}: {
  family: WorkspaceFamily
  identity: ShellIdentity
  currentPath?: string
  breadcrumbs?: ShellBreadcrumbStep[]
  /** Object identity. OMIT it when the page owns its own heading — the shell never titles a view twice. */
  object?: ShellObjectIdentity
  /** Sections of the CURRENT object (e.g. an order's overview/documents/shipment); server-confirmed only. */
  objectTabs?: ShellNavItem[]
  /** ONE prioritized action. OMITTED entirely when no real authorized action
   * exists for the current context — the shell never renders an inert button. */
  primaryAction?: ShellPrimaryAction
  statusPanel?: ReactNode
  bottomNav?: Array<{ label: string; href: string; active?: boolean }>
  /** Explicit navigation sections; defaults to the registry projection for the family. */
  railSections?: ShellNavSection[]
  /** `rail` for many destinations (collapsible desktop rail); `tabs` for a few grouped ones. */
  navStyle?: 'rail' | 'tabs'
  /** The family home; added to the navigation only if the projection lacks it. */
  overviewHref?: string
  homeLabel?: string
  /** Links in the account menu. Defaults to My CarUp; a reviewer passes none. */
  accountLinks?: Array<{ label: string; href: string }>
  /**
   * Sign-out handler wired by the route shell to the EXISTING safe session
   * mechanism (AuthContext logout). When omitted, no Sign Out item renders —
   * the shell never ships an inert sign-out button.
   */
  onSignOut?: () => void
  children?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null)
  const accountRootRef = useRef<HTMLDivElement | null>(null)
  const drawerRef = useRef<HTMLDivElement | null>(null)
  // Canonical backend/loaded feature effective states, so the rail never
  // presents a disabled/planned feature as an active action (C4).
  const effectiveStates = useFeatureEffectiveStates()

  const familyLabel = FAMILY_LABELS[family] ?? 'Workspace'
  // Family → registry role mapping (presentation-only; authorization is NOT
  // derived from this — the route guard decides access). The garage family
  // uses the mechanic role's registry items.
  const familyRole: UserRole =
    family === 'personal' ? 'owner'
    : family === 'garage' ? 'mechanic'
    : family === 'institutional' ? 'bank'
    : family === 'admin' ? 'admin'
    : 'dealer'
  // A review workbench never inherits a role projection: its navigation is explicit
  // (the eight reviewer workbenches) or empty — never another role's menu.
  const projected = railSections ?? (family === 'review' ? [] : projectWorkspaceRail(familyRole, { effectiveStates }))
  const navSections = projected.length ? withFamilyHome(projected, { href: overviewHref, label: homeLabel }) : []
  const hasNav = navSections.some(s => s.items.length > 0)

  // Exactly ONE current page: object tabs (the most specific level) win; the family
  // destination that contains them is marked as the current SECTION, not a second page.
  const tabActive = objectTabs?.length ? pickActiveHref(currentPath, objectTabs.filter(t => !t.planned).map(t => t.href)) : null
  const navActive = pickActiveHref(currentPath, navigableHrefs(navSections))
  const navActiveKind: Current = tabActive ? 'true' : 'page'
  const links = accountLinks ?? [{ label: 'My CarUp', href: '/dashboard' }]

  const statusToneClasses: Record<ShellObjectIdentity['statusTone'], string> = {
    success: 'border-status-success bg-status-success-soft text-status-success',
    warning: 'border-status-warning bg-status-warning-soft text-status-warning',
    danger: 'border-status-danger bg-status-danger-soft text-status-danger',
    info: 'border-status-info bg-status-info-soft text-status-info',
    neutral: 'border-status-neutral bg-status-neutral-soft text-status-neutral',
  }

  // C1 — mobile drawer keyboard contract (same proven pattern as the public
  // shell drawer): on open, initial focus transfers into the dialog; Tab /
  // Shift+Tab are contained; Escape / close / backdrop close and restore
  // focus to the trigger while it stays mounted; the listener is removed on
  // unmount so no trap can outlive the drawer (e.g. route navigation).
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    const trigger = drawerTriggerRef.current
    if (trigger && document.contains(trigger)) trigger.focus()
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    const panel = drawerRef.current
    panel?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDrawer()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      )
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
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, closeDrawer])

  // C2 — account disclosure: Escape closes and returns focus to the trigger;
  // click-outside closes. Standard disclosure semantics (no role=menu).
  useEffect(() => {
    if (!accountOpen) return
    const onDoc = (e: MouseEvent) => {
      if (accountRootRef.current && !accountRootRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAccountOpen(false)
        accountTriggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [accountOpen])

  const navItemCount = navSections.reduce((n, s) => n + s.items.length, 0)
  const tabsFrom: keyof typeof TABS_VISIBLE = navItemCount > 5 ? 'xl' : 'md'
  const menuBreakpoint = navStyle === 'tabs' ? MENU_HIDDEN_TABS[tabsFrom] : 'lg:hidden'

  return (
    <div className="flex min-h-screen flex-col bg-carup-bg text-carup-text" data-shell-family={family}>
      <a
        href="#shell-ws-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-carup-action focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-carup-action-on"
      >
        Skip to content
      </a>

      {/* Masthead — the ONE brand owner of the view, full width, ink chrome. */}
      <header className="sticky top-0 z-40 border-b border-carup-raw-ink-2 bg-carup-raw-ink text-carup-raw-paper">
        <div className="flex h-14 items-center gap-1.5 pl-2 pr-2 sm:gap-2 sm:pl-3 lg:pl-4 lg:pr-4">
          {hasNav && (
            <button
              ref={drawerTriggerRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open workspace menu"
              aria-expanded={drawerOpen}
              data-testid="shell-ws-mobile-menu"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control transition-colors hover:bg-carup-raw-ink-2 ${FOCUS_RING} ${menuBreakpoint}`}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {hasNav && navStyle === 'rail' && (
            <button
              type="button"
              onClick={() => setCollapsed(c => !c)}
              aria-expanded={!collapsed}
              aria-controls="shell-ws-rail"
              aria-label={collapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
              data-testid="shell-ws-collapse"
              className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-control transition-colors hover:bg-carup-raw-ink-2 lg:flex ${FOCUS_RING}`}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
            </button>
          )}
          <Link to="/" aria-label="CarUp home" className={`flex shrink-0 items-center rounded-control px-1 py-1 ${FOCUS_RING}`} data-testid="shell-ws-brand">
            <BrandMark slot="workspace-masthead" tone="ink" variant="horizontal" compact decorative />
          </Link>
          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-carup-raw-ink-2 sm:mx-2" />
          <div className="flex min-w-0 flex-col leading-tight" data-testid="shell-ws-context">
            <span className="truncate text-[13px] font-semibold">{familyLabel}</span>
            {identity.tenantLabel && (
              <span className={`truncate text-[11px] ${PAPER(68)}`} data-testid="shell-ws-tenant">
                {identity.tenantLabel}
              </span>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {/*
              C2 — header utilities are truthful:
              · Search links to the REAL global search page (/search).
              · Notifications has no standalone workspace surface yet, so it is HONESTLY
                disabled with an accessible explanation (hidden on phones to save room).
              · Account is a working disclosure menu (family home + safe Sign Out).
            */}
            <Link
              to="/search"
              aria-label="Search CarUp"
              data-testid="shell-ws-search"
              className={`flex h-11 w-11 items-center justify-center rounded-control transition-colors hover:bg-carup-raw-ink-2 ${FOCUS_RING}`}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Notifications centre is not part of the unified workspace shell yet"
              aria-label="Notifications — not available in the unified workspace shell yet"
              data-testid="shell-ws-notifications"
              className={`hidden h-11 w-11 cursor-not-allowed items-center justify-center rounded-control ${PAPER(45)} transition-colors disabled:opacity-60 sm:flex ${FOCUS_RING}`}
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
            </button>
            <div ref={accountRootRef} className="relative">
              <button
                ref={accountTriggerRef}
                type="button"
                onClick={() => setAccountOpen(o => !o)}
                aria-expanded={accountOpen}
                aria-controls="shell-ws-account-menu"
                aria-label={`Account — ${identity.displayName}`}
                data-testid="shell-ws-account"
                className={`flex h-11 min-w-11 items-center justify-center gap-2 rounded-control px-2 transition-colors hover:bg-carup-raw-ink-2 ${FOCUS_RING}`}
              >
                <CircleUserRound className="h-5 w-5" aria-hidden="true" />
                <span className="hidden max-w-[10rem] truncate text-xs md:inline">{identity.displayName}</span>
              </button>
              {accountOpen && (
                <div
                  id="shell-ws-account-menu"
                  data-testid="shell-ws-account-menu"
                  className="absolute right-0 top-full z-50 mt-1 w-56 rounded-card border border-carup-raw-ink-2 bg-carup-raw-ink p-2 text-carup-raw-paper shadow-sheet"
                >
                  <p className={`px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider ${PAPER(55)}`}>
                    {identity.roleTitle ?? 'Account'}
                  </p>
                  <nav aria-label="Account">
                    <ul className="space-y-0.5">
                      {links.map(link => (
                        <li key={link.href}>
                          <Link
                            to={link.href}
                            onClick={() => setAccountOpen(false)}
                            className={`flex min-h-11 items-center gap-2 rounded-control px-2 text-sm transition-colors hover:bg-carup-raw-ink-2 ${FOCUS_RING}`}
                          >
                            <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {link.label}
                          </Link>
                        </li>
                      ))}
                      {onSignOut && (
                        <li>
                          <button
                            type="button"
                            onClick={onSignOut}
                            data-testid="shell-ws-sign-out"
                            className={`flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-sm ${PAPER(85)} transition-colors hover:bg-carup-raw-ink-2 ${FOCUS_RING}`}
                          >
                            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Sign Out
                          </button>
                        </li>
                      )}
                    </ul>
                  </nav>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {hasNav && navStyle === 'tabs' && (
        <TabBar label={`${familyLabel} navigation`} sections={navSections} activeHref={navActive} activeKind={navActiveKind} from={tabsFrom} />
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50" data-testid="shell-ws-drawer">
          <button
            type="button"
            aria-label="Close workspace menu"
            onClick={closeDrawer}
            className="absolute inset-0 h-full w-full cursor-default bg-[color-mix(in_srgb,var(--carup-raw-ink)_50%,transparent)]"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col bg-carup-raw-ink pb-[env(safe-area-inset-bottom)] text-carup-raw-paper"
          >
            <div className="flex h-14 items-center justify-between gap-2 border-b border-carup-raw-ink-2 pl-4 pr-2">
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[13px] font-semibold">{familyLabel}</p>
                {identity.tenantLabel && <p className={`truncate text-[11px] ${PAPER(68)}`}>{identity.tenantLabel}</p>}
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close workspace menu"
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control ${PAPER(85)} hover:bg-carup-raw-ink-2 ${FOCUS_RING}`}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <RailContent
              sections={navSections}
              activeHref={navActive}
              activeKind={navActiveKind}
              collapsed={false}
              onNavigate={closeDrawer}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Rail — desktop only, under the masthead; no logo (the masthead owns the brand). */}
        {hasNav && navStyle === 'rail' && (
          <aside
            id="shell-ws-rail"
            aria-label="Workspace navigation"
            data-testid="shell-ws-rail"
            className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r border-carup-raw-ink-2 bg-carup-raw-ink text-carup-raw-paper transition-[width] duration-200 motion-reduce:transition-none lg:flex ${
              collapsed ? 'w-16' : 'w-60'
            }`}
          >
            <RailContent sections={navSections} activeHref={navActive} activeKind={navActiveKind} collapsed={collapsed} />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {(object || breadcrumbs.length > 0 || (objectTabs && objectTabs.length > 0)) && (
            <div role="region" aria-label="Object context" className="border-b border-carup-line bg-carup-bg-raised">
              <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-6">
                {breadcrumbs.length > 0 && (
                  <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-carup-text-3">
                    {breadcrumbs.map((step, i) => (
                      <span key={`${step.label}-${i}`} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                        {step.href ? (
                          <Link to={step.href} className={`rounded-control hover:text-carup-text ${FOCUS_RING}`}>
                            {step.label}
                          </Link>
                        ) : (
                          <span aria-current="page" className="font-medium text-carup-text">{step.label}</span>
                        )}
                      </span>
                    ))}
                  </nav>
                )}
                {object && (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="min-w-0 truncate text-base font-semibold sm:text-lg" data-testid="shell-ws-object-title">
                      {object.title}
                    </h2>
                    {object.reference && (
                      <span className="font-mono text-xs tabular-nums text-carup-text-3" data-testid="shell-ws-object-reference">{object.reference}</span>
                    )}
                    <span className={`rounded-control border px-2 py-0.5 text-xs font-medium ${statusToneClasses[object.statusTone]}`} data-testid="shell-ws-object-status">
                      {object.statusLabel}
                    </span>
                    {object.meta?.map(m => (
                      <span key={m} className="hidden text-xs text-carup-text-3 md:inline">{m}</span>
                    ))}
                  </div>
                )}
                {primaryAction && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={primaryAction.onSelect}
                      disabled={primaryAction.disabled}
                      data-testid="shell-ws-primary-action"
                      title={primaryAction.disabled ? (primaryAction.disabledReason ?? 'Unavailable') : undefined}
                      className={`flex min-h-11 items-center rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
                    >
                      {primaryAction.label}
                    </button>
                  </div>
                )}
              </div>
              {objectTabs && objectTabs.length > 0 && (
                <nav aria-label={`${object?.title ?? 'Object'} sections`} data-testid="shell-ws-object-tabs" className="mx-auto max-w-[1560px] px-2 lg:px-4">
                  <ul className="-mb-px flex gap-1 overflow-x-auto">
                    {objectTabs.map(tab => {
                      if (tab.planned) return null
                      const active = tabActive === tab.href
                      return (
                        <li key={tab.id} className="shrink-0">
                          <Link
                            to={tab.href}
                            aria-current={active ? 'page' : undefined}
                            className={`flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${FOCUS_RING} focus-visible:ring-inset ${
                              active ? 'border-carup-action font-semibold text-carup-text' : 'border-transparent text-carup-text-2 hover:text-carup-text'
                            }`}
                          >
                            {tab.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </nav>
              )}
            </div>
          )}

          {/* Content — a second column exists only when there is a status panel to put in it. */}
          <div
            className={`mx-auto grid w-full max-w-[1560px] flex-1 content-start gap-6 px-4 py-5 sm:py-6 lg:px-6 ${statusPanel ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}
          >
            <main id="shell-ws-main" tabIndex={-1} className="min-w-0 outline-none">
              {children}
            </main>
            {statusPanel && (
              <aside aria-label="Status and evidence" className="min-w-0">
                {statusPanel}
              </aside>
            )}
          </div>

          {/* Slim utility footer — NO public marketing footer */}
          <footer
            className="border-t border-carup-line bg-carup-bg-raised px-4 py-3 lg:px-6"
            data-testid="shell-ws-footer"
          >
            <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-2 text-xs text-carup-text-3">
              <p>© {new Date().getFullYear()} {PUBLIC_IDENTITY.legalEntity} · {familyLabel}</p>
              {/* RX03-P1b footer identity: a utility footer — help and legal only, never a marketing sitemap. */}
              <ul className="flex flex-wrap items-center gap-x-1" aria-label="Help and legal">
                {[['/help', 'Help'], ['/contact', 'Contact'], ['/privacy', 'Privacy'], ['/terms', 'Terms']].map(([href, label]) => (
                  <li key={href}>
                    <Link to={href} className={`inline-flex min-h-11 items-center px-2 hover:text-carup-text ${FOCUS_RING}`}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </footer>

          {/* Mobile bottom task nav */}
          {bottomNav && bottomNav.length > 0 && (
            <nav
              aria-label={`${familyLabel} tasks`}
              data-testid="shell-ws-bottom-nav"
              className="sticky bottom-0 z-30 border-t border-carup-line bg-carup-bg-raised pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 lg:hidden"
            >
              <div
                className="mx-auto grid max-w-xl"
                style={{ gridTemplateColumns: `repeat(${bottomNav.length}, minmax(0, 1fr))` }}
              >
                {bottomNav.map(item => (
                  <Link
                    key={item.label}
                    to={item.href}
                    aria-current={item.active ? 'page' : undefined}
                    className={`flex min-h-12 flex-col items-center justify-center rounded-control px-1 text-[11px] font-medium transition-colors ${FOCUS_RING} focus-visible:ring-inset ${
                      item.active ? 'font-semibold text-carup-action-hover' : 'text-carup-text-2 hover:bg-carup-bg-surface hover:text-carup-text'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}
