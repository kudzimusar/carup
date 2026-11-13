/**
 * RX-02A S1-4B — WorkspaceShell (production-intent, default-OFF candidate).
 *
 * Ink-chrome workspace: collapsible manifest-driven rail, compact global
 * header with role/org-tenant context, breadcrumb + object identity, exactly
 * ONE prioritized primary action, contextual status panel, and a slim utility
 * footer. NO public marketing footer. The rail is PROJECTED from the feature
 * registry for the active family — no cross-family leakage. Security model
 * note: server authorization remains authoritative; this chrome implies no
 * access decision and the surrounding route guard still runs.
 *
 * Derived from the independently approved S1-4A prototype (pull request 266) with all
 * fictional fixtures and prototype labelling removed. The identity/tenant
 * shown is the REAL session / server-authorized workspace, never a fixture.
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
import { isActivePath } from './pathUtils'

const FAMILY_LABELS: Record<string, string> = {
  personal: 'My CarUp',
  dealer: 'Dealer OS',
  garage: 'Garage OS',
  trade: 'Trade',
  institutional: 'Institutional',
  admin: 'Administration',
}

function RailContent({
  sections,
  currentPath,
  collapsed,
  overviewHref,
  onNavigate,
}: {
  sections: ShellNavSection[]
  currentPath: string
  collapsed: boolean
  overviewHref: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Workspace" className="flex-1 overflow-y-auto px-2 py-3">
      <Link
        to={overviewHref}
        onClick={onNavigate}
        aria-current={isActivePath(currentPath, overviewHref) ? 'page' : undefined}
        title="Overview"
        className={`flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
          collapsed ? 'justify-center px-0' : ''
        } ${isActivePath(currentPath, overviewHref) ? 'bg-carup-raw-ink-2 text-carup-raw-paper' : 'text-[color-mix(in_srgb,var(--carup-raw-paper)_80%,transparent)]'}`}
      >
        <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">Overview</span>}
      </Link>
      {sections.map(section => (
        <div key={section.title} className="mt-3">
          {!collapsed && (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[color-mix(in_srgb,var(--carup-raw-paper)_50%,transparent)]">
              {section.title}
            </p>
          )}
          <ul className={collapsed ? 'flex flex-col items-center gap-1' : 'space-y-0.5'}>
            {section.items.map(item => {
              const Icon = resolveFeatureIcon(null)
              if (item.planned) {
                // C4 — a planned feature is never an active navigable action:
                // it renders as an honest non-navigating "Soon" entry.
                return (
                  <li key={item.id} className={collapsed ? 'w-full' : ''}>
                    <span
                      aria-disabled="true"
                      title={item.description ?? 'Coming soon'}
                      className={`flex min-h-11 cursor-not-allowed items-center gap-2 rounded-control px-3 text-sm text-[color-mix(in_srgb,var(--carup-raw-paper)_40%,transparent)] ${
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
              const active = isActivePath(currentPath, item.href)
              return (
                <li key={item.id} className={collapsed ? 'w-full' : ''}>
                  <Link
                    to={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex min-h-11 items-center gap-2 rounded-control px-3 text-sm transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                      collapsed ? 'justify-center px-0' : ''
                    } ${active ? 'bg-carup-raw-ink-2 font-medium text-carup-raw-paper' : 'text-[color-mix(in_srgb,var(--carup-raw-paper)_70%,transparent)]'}`}
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

export function WorkspaceShell({
  family,
  identity,
  currentPath = '/dashboard',
  breadcrumbs = [],
  object,
  primaryAction,
  statusPanel,
  bottomNav,
  railSections,
  overviewHref = '/dashboard',
  onSignOut,
  children,
}: {
  family: WorkspaceFamily
  identity: ShellIdentity
  currentPath?: string
  breadcrumbs?: ShellBreadcrumbStep[]
  object: ShellObjectIdentity
  /** ONE prioritized action. OMITTED entirely when no real authorized action
   * exists for the current context — the shell never renders an inert button. */
  primaryAction?: ShellPrimaryAction
  statusPanel?: ReactNode
  bottomNav?: Array<{ label: string; href: string; active?: boolean }>
  /** Explicit rail sections; defaults to the registry projection for the family. */
  railSections?: ShellNavSection[]
  overviewHref?: string
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
  const navSections = railSections ?? projectWorkspaceRail(familyRole, { effectiveStates })

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

  return (
    <div className="flex min-h-screen bg-carup-bg text-carup-text">
      <a
        href="#shell-ws-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-carup-action focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-carup-action-on"
      >
        Skip to content
      </a>

      {/* Rail — ink chrome, collapsible (desktop) / overlay drawer (mobile) */}
      <aside
        id="shell-ws-rail"
        aria-label="Workspace navigation"
        data-testid="shell-ws-rail"
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-carup-raw-ink-2 bg-carup-raw-ink text-carup-raw-paper transition-[width] duration-200 lg:flex ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className={`flex h-14 items-center gap-2 border-b border-carup-raw-ink-2 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
          {!collapsed && <BrandMark slot="workspace-rail" tone="ink" compact />}
          {collapsed && (
            <span data-brand-slot="workspace-rail" className="inline-flex h-7 w-7 items-center justify-center rounded-control border border-dashed border-carup-raw-ink-2" title="Workspace rail logo location — text fallback">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-chrome bg-carup-raw-orange-signal" />
              <span className="sr-only">CarUp — workspace rail logo location, text fallback</span>
            </span>
          )}
        </div>
        <RailContent sections={navSections} currentPath={currentPath} collapsed={collapsed} overviewHref={overviewHref} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" data-testid="shell-ws-drawer">
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
            className="absolute left-0 top-0 flex h-full w-64 flex-col bg-carup-raw-ink text-carup-raw-paper"
          >
            <div className="flex h-14 items-center justify-between border-b border-carup-raw-ink-2 px-4">
              <BrandMark slot="workspace-rail" tone="ink" compact />
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close workspace menu"
                className="flex h-11 w-11 items-center justify-center rounded-control text-[color-mix(in_srgb,var(--carup-raw-paper)_80%,transparent)] hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <RailContent
              sections={navSections}
              currentPath={currentPath}
              collapsed={false}
              overviewHref={overviewHref}
              onNavigate={closeDrawer}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact global header — ink chrome */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-carup-raw-ink-2 bg-carup-raw-ink px-4 text-carup-raw-paper lg:px-6">
          <button
            ref={drawerTriggerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open workspace menu"
            aria-expanded={drawerOpen}
            data-testid="shell-ws-mobile-menu"
            className="flex h-11 w-11 items-center justify-center rounded-control transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            aria-expanded={!collapsed}
            aria-controls="shell-ws-rail"
            aria-label={collapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
            data-testid="shell-ws-collapse"
            className="hidden h-11 w-11 items-center justify-center rounded-control transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus lg:flex"
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark slot="workspace-masthead" tone="ink" compact />
            <div className="hidden min-w-0 flex-col sm:flex">
              <span className="truncate text-xs font-semibold">{familyLabel}</span>
              {identity.tenantLabel && (
                <span className="truncate text-[10px] text-[color-mix(in_srgb,var(--carup-raw-paper)_50%,transparent)]" data-testid="shell-ws-tenant">
                  {identity.tenantLabel}
                </span>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {/*
              C2 — header utilities are truthful:
              · Search links to the REAL global search page (/search, registry
                feature product.verify) — an actual capability, not a placeholder.
              · Notifications has no standalone workspace surface in the current
                slice, so it is HONESTLY disabled with an accessible explanation
                instead of an inert enabled button.
              · Account is a working disclosure menu (My CarUp + safe Sign Out).
            */}
            <Link
              to="/search"
              aria-label="Search workspace"
              data-testid="shell-ws-search"
              className="flex h-11 w-11 items-center justify-center rounded-control transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
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
              className="flex h-11 w-11 cursor-not-allowed items-center justify-center rounded-control text-[color-mix(in_srgb,var(--carup-raw-paper)_40%,transparent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:opacity-60"
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
                className="flex h-11 items-center gap-2 rounded-control px-2 transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
              >
                <CircleUserRound className="h-5 w-5" aria-hidden="true" />
                <span className="hidden text-xs md:inline">{identity.displayName}</span>
              </button>
              {accountOpen && (
                <div
                  id="shell-ws-account-menu"
                  data-testid="shell-ws-account-menu"
                  className="absolute right-0 top-full z-50 mt-1 w-52 rounded-card border border-carup-raw-ink-2 bg-carup-raw-ink p-2 text-carup-raw-paper shadow-sheet"
                >
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color-mix(in_srgb,var(--carup-raw-paper)_50%,transparent)]">
                    {identity.roleTitle ?? 'Account'}
                  </p>
                  <nav aria-label="Account">
                    <ul className="space-y-0.5">
                      <li>
                        <Link
                          to={overviewHref}
                          onClick={() => setAccountOpen(false)}
                          className="flex min-h-11 items-center gap-2 rounded-control px-2 text-sm transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                        >
                          <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
                          My CarUp
                        </Link>
                      </li>
                      {onSignOut && (
                        <li>
                          <button
                            type="button"
                            onClick={onSignOut}
                            data-testid="shell-ws-sign-out"
                            className="flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-[color-mix(in_srgb,var(--carup-raw-paper)_80%,transparent)] transition-colors hover:bg-carup-raw-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
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
        </header>

        {/* Breadcrumb + object identity + ONE primary action */}
        <div role="region" aria-label="Object context" className="border-b border-carup-line bg-carup-bg-raised px-4 py-3 lg:px-6">
          <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-4 gap-y-2">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-carup-text-3">
              {breadcrumbs.map((step, i) => (
                <span key={`${step.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                  {step.href ? (
                    <Link to={step.href} className="rounded-control hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                      {step.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="font-medium text-carup-text">{step.label}</span>
                  )}
                </span>
              ))}
            </nav>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <h2 className="truncate text-base font-semibold" data-testid="shell-ws-object-title">
                {object.title}
              </h2>
              <span className="hidden font-mono text-xs tabular-nums text-carup-text-3 sm:inline">{object.reference}</span>
              <span className={`rounded-control border px-2 py-0.5 text-xs font-medium ${statusToneClasses[object.statusTone]}`}>
                {object.statusLabel}
              </span>
              {object.meta?.map(m => (
                <span key={m} className="hidden text-xs text-carup-text-3 lg:inline">{m}</span>
              ))}
            </div>
            {primaryAction && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={primaryAction.onSelect}
                disabled={primaryAction.disabled}
                data-testid="shell-ws-primary-action"
                title={primaryAction.disabled ? (primaryAction.disabledReason ?? 'Unavailable') : undefined}
                className="flex min-h-11 items-center rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:cursor-not-allowed disabled:opacity-60"
              >
                {primaryAction.label}
              </button>
            </div>
            )}
          </div>
        </div>

        {/* Content grid + contextual status panel */}
        <div className="mx-auto grid w-full max-w-[1560px] flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_320px] lg:px-6">
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
            <p>CarUp · {familyLabel}</p>
            <p>Server authorization remains authoritative · session and step-up checks stay server-side</p>
          </div>
        </footer>

        {/* Mobile bottom task nav */}
        {bottomNav && bottomNav.length > 0 && (
          <nav
            aria-label="Workspace tasks"
            data-testid="shell-ws-bottom-nav"
            className="sticky bottom-0 z-40 border-t border-carup-line bg-carup-bg-raised pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 lg:hidden"
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
                  className={`flex min-h-12 flex-col items-center justify-center rounded-control px-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-inset ${
                    item.active ? 'font-semibold text-carup-action-hover' : 'text-carup-text-3 hover:bg-carup-bg-surface hover:text-carup-text'
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
  )
}
