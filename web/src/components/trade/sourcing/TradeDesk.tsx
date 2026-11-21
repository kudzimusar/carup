/**
 * RX-06 Trade desk kit — the small presentation vocabulary shared by the Sourcing (Reverse RFQ,
 * shared containers), Account (trade profile, plan, Drive) and Protection (SafeTrade) views.
 *
 * Tokens only (carup-* / status-*), no raw palette, no glass. Every interactive element is at least
 * 44 px tall. Nothing here fetches or decides: each component renders what its caller passes in.
 */
import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowRight, Building2, Inbox, Loader2, Lock, LogIn, PowerOff, RotateCw, Timer, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useClaimBottomBar } from '@/lib/bottomBarClaim'
import { WS_EYEBROW, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { TradeStill } from '@/components/media/rx06/TradeStill'
import { usableTradeStill } from '@/content/media/tradeStills'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'

/* ── Header ─────────────────────────────────────────────────────────────────────────────────── */

/** The top of a Trade desk page: where you are, what this is, recorded chips, at most one action. */
export function DeskHeader({ eyebrow, title, description, meta, actions, route, testId, titleId }: {
  eyebrow: string
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  route?: ReactNode
  testId?: string
  titleId?: string
}) {
  return (
    <header data-testid={testId} className="flex flex-col gap-4 border-b border-carup-line pb-5 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0">
        <p className={cn('flex items-center gap-2', WS_EYEBROW)}>
          <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-carup-raw-orange-signal" />
          {eyebrow}
        </p>
        <h1 id={titleId} className="mt-2 text-[1.625rem] font-bold leading-tight tracking-[-0.025em] text-carup-text [overflow-wrap:anywhere] sm:text-[2rem]">
          {title}
        </h1>
        {route && <div className="mt-2">{route}</div>}
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-carup-text-2">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </header>
  )
}

/* ── Route glyph ────────────────────────────────────────────────────────────────────────────── */

/** Origin ●┄┄▸ destination. Only recorded places; an absent end says "not recorded". Valid inside buttons. */
export function RouteGlyph({ from, to, size = 'md', testId }: {
  from: string | null | undefined
  to: string | null | undefined
  size?: 'sm' | 'md'
  testId?: string
}) {
  const origin = from?.trim() || null
  const destination = to?.trim() || null
  const text = size === 'sm' ? 'text-xs' : 'text-sm'
  return (
    <span className={cn('relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', text)} data-testid={testId}>
      <span className="sr-only">Route: </span>
      <span className={cn('inline-flex min-w-0 items-center gap-1.5 font-semibold', origin ? 'text-carup-text' : 'text-carup-text-3')}>
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border-2 border-carup-text" />
        <span className="[overflow-wrap:anywhere]">{origin ?? 'Origin not recorded'}</span>
      </span>
      <span aria-hidden="true" className="flex w-10 shrink-0 items-center sm:w-14">
        <span className="h-px flex-1 border-t-2 border-dashed border-carup-line-strong" />
        <ArrowRight className="-ml-1 h-3.5 w-3.5 text-carup-text-3" />
      </span>
      <span className="sr-only"> to </span>
      <span className={cn('inline-flex min-w-0 items-center gap-1.5 font-semibold', destination ? 'text-carup-text' : 'text-carup-text-3')}>
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--carup-raw-orange-signal)' }} />
        <span className="[overflow-wrap:anywhere]">{destination ?? 'Destination not recorded'}</span>
      </span>
    </span>
  )
}

/* ── References and provenance ──────────────────────────────────────────────────────────────── */

/** A reference in monospace; the full value is always available to hover and to assistive tech. */
export function RefCode({ value, label, className, testId }: {
  value: string | null | undefined
  label?: string
  className?: string
  testId?: string
}) {
  if (!value) return <span className={cn('text-xs text-carup-text-3', className)}>Not recorded</span>
  const short = String(value).slice(0, 8)
  return (
    <span
      className={cn('font-mono text-xs tabular-nums text-carup-text-2', className)}
      title={String(value)}
      aria-label={`${label ? `${label} ` : ''}${String(value)}`}
      data-testid={testId}
    >
      {short}
    </span>
  )
}

/** Where a fact came from: "Recorded by CarUp", "Seller-declared", "Server decision", … */
export function SourceChip({ children, testId, className }: { children: ReactNode; testId?: string; className?: string }) {
  return (
    <span
      data-testid={testId}
      className={cn('inline-flex max-w-full items-center gap-1 rounded-full border border-carup-line bg-carup-bg-surface px-2 py-0.5 text-[11px] font-medium leading-4 text-carup-text-2 [overflow-wrap:anywhere]', className)}
    >
      <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-carup-text-3" />
      {children}
    </span>
  )
}

/* ── Honest states ──────────────────────────────────────────────────────────────────────────── */

export type DeskStateKind = 'loading' | 'empty' | 'failed' | 'denied' | 'unavailable' | 'limited' | 'signin' | 'tenant'

const STATE_ICON: Record<DeskStateKind, LucideIcon> = {
  loading: Loader2, empty: Inbox, failed: AlertTriangle, denied: Lock, unavailable: PowerOff, limited: Timer, signin: LogIn, tenant: Building2,
}
const STATE_TONE: Record<DeskStateKind, string> = {
  loading: 'bg-carup-bg-surface text-carup-text-2',
  empty: 'bg-carup-bg-surface text-carup-text-2',
  failed: 'bg-status-warning-soft text-status-warning',
  denied: 'bg-status-neutral-soft text-status-neutral',
  unavailable: 'bg-status-neutral-soft text-status-neutral',
  limited: 'bg-status-info-soft text-status-info',
  signin: 'bg-status-info-soft text-status-info',
  tenant: 'bg-status-neutral-soft text-status-neutral',
}
const STATE_BORDER: Record<DeskStateKind, string> = {
  loading: 'border-carup-line',
  empty: 'border-carup-line',
  failed: 'border-status-warning',
  denied: 'border-carup-line-strong',
  unavailable: 'border-dashed border-carup-line-strong',
  limited: 'border-status-info',
  signin: 'border-carup-line-strong',
  tenant: 'border-carup-line-strong',
}

/**
 * One honest state. The kinds are different statements and must never stand in for each other:
 * an empty list is a fact about the business; a failed, denied, rate-limited or switched-off read is a
 * fact about the request.
 */
export function DeskState({ kind, title, children, onRetry, retryLabel = 'Try again', action, testId, compact = false, bare = false }: {
  kind: DeskStateKind
  title: ReactNode
  children?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  action?: ReactNode
  testId?: string
  compact?: boolean
  /** No frame of its own (it sits inside an editorial empty state). */
  bare?: boolean
}) {
  const Icon = STATE_ICON[kind]
  const role = kind === 'loading' ? 'status' : kind === 'failed' || kind === 'denied' || kind === 'limited' ? 'alert' : undefined
  return (
    <div
      role={role}
      data-testid={testId}
      data-state={kind}
      className={cn('flex items-start gap-3', bare ? 'p-5 sm:p-6' : cn('rounded-card border', STATE_BORDER[kind], compact ? 'p-4' : 'bg-carup-bg-raised p-5 sm:p-6'))}
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', STATE_TONE[kind])} aria-hidden="true">
        <Icon className={cn('h-4 w-4', kind === 'loading' && 'animate-spin motion-reduce:animate-none')} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-carup-text">{title}</p>
        {children && <div className="mt-1 text-sm leading-6 text-carup-text-2">{children}</div>}
        {(action || onRetry) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry && (
              <button type="button" className={WS_SECONDARY} onClick={onRetry}>
                <RotateCw className="h-4 w-4" aria-hidden="true" /> {retryLabel}
              </button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * An empty state with an Owner-authorised editorial still beside it. Empty states only — never behind
 * order, container, reservation, quote or payment data. When the still is not usable in this build (an
 * unapproved still in production) the plain state renders on its own.
 */
export function EditorialEmpty({ still, layout = 'side', children, testId }: {
  still: string
  layout?: 'side' | 'stack'
  children: ReactNode
  testId?: string
}) {
  if (!usableTradeStill(still)) return <div data-testid={testId}>{children}</div>
  return (
    <div
      data-testid={testId}
      className={cn('grid overflow-hidden rounded-card border border-carup-line bg-carup-bg-raised', layout === 'side' && 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-stretch')}
    >
      <TradeStill
        still={still}
        className={cn('aspect-[16/9]', layout === 'side' && 'md:aspect-auto md:min-h-[14rem]')}
        sizes={layout === 'side' ? '(min-width: 768px) 45vw, 100vw' : '(min-width: 1024px) 35vw, 100vw'}
      />
      <div className="min-w-0 self-center">{children}</div>
    </div>
  )
}

/* ── Next move ──────────────────────────────────────────────────────────────────────────────── */

/** One next move: what it is, who it usually waits on, what happens after, and at most one action. */
export function NextMove({ title, detail, usuallyWith, after, action, testId, headingId }: {
  title: ReactNode
  detail?: ReactNode
  usuallyWith?: ReactNode
  after?: ReactNode
  action?: ReactNode
  testId?: string
  headingId?: string
}) {
  const generated = useId()
  const id = headingId ?? `${generated}-next`
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className="rounded-card border border-carup-line-strong bg-carup-bg-raised p-4 sm:p-5"
      style={{ boxShadow: 'inset 4px 0 0 var(--carup-raw-orange-signal)' }}
    >
      <h2 id={id} className={WS_EYEBROW}>Next move</h2>
      <p className="mt-1.5 text-base font-semibold leading-6 text-carup-text [overflow-wrap:anywhere]">{title}</p>
      {detail && <p className="mt-1 text-sm leading-6 text-carup-text-2">{detail}</p>}
      {(usuallyWith || after) && (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {usuallyWith && (
            <div className="min-w-0">
              <dt className="text-xs font-medium text-carup-text-3">Usually with</dt>
              <dd className="mt-0.5 font-semibold text-carup-text" data-testid={testId ? `${testId}-with` : undefined}>{usuallyWith}</dd>
            </div>
          )}
          {after && (
            <div className="min-w-0">
              <dt className="text-xs font-medium text-carup-text-3">What happens after</dt>
              <dd className="mt-0.5 text-carup-text-2">{after}</dd>
            </div>
          )}
        </dl>
      )}
      {action && <div className="mt-4 flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{action}</div>}
    </section>
  )
}

/* ── Pulse line ─────────────────────────────────────────────────────────────────────────────── */

/** One compact line of recorded counts — never a wall of big-number cards. */
export function PulseLine({ items, label, testId }: {
  items: Array<{ label: string; value: ReactNode; key?: string }>
  label: string
  testId?: string
}) {
  if (items.length === 0) return null
  return (
    <ul aria-label={label} data-testid={testId} className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-carup-text-2">
      {items.map((item) => (
        <li key={item.key ?? item.label} className="flex items-baseline gap-1">
          <span className="font-semibold tabular-nums text-carup-text">{item.value}</span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

/* ── Panels and facts ───────────────────────────────────────────────────────────────────────── */

export function DeskPanel({ title, eyebrow, actions, children, testId, className, headingLevel = 2, titleId }: {
  title?: ReactNode
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  testId?: string
  className?: string
  headingLevel?: 2 | 3
  titleId?: string
}) {
  const generated = useId()
  const id = titleId ?? `${generated}-title`
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <section
      aria-labelledby={title ? id : undefined}
      data-testid={testId}
      className={cn('min-w-0 rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5', className)}
    >
      {(title || actions || eyebrow) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {eyebrow && <p className={WS_EYEBROW}>{eyebrow}</p>}
            {title && <Heading id={id} className="text-base font-semibold tracking-[-0.01em] text-carup-text">{title}</Heading>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** A recorded fact. `value` null → "Not recorded" (never a placeholder that looks like data). */
export function Fact({ label, value, source, mono = false, testId }: {
  label: string
  value: ReactNode | null | undefined
  source?: ReactNode
  mono?: boolean
  testId?: string
}) {
  const absent = value === null || value === undefined || value === ''
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-carup-text-3">{label}</dt>
      <dd
        data-testid={testId}
        className={cn('mt-0.5 text-sm [overflow-wrap:anywhere]', absent ? 'text-carup-text-3' : 'font-semibold text-carup-text', mono && !absent && 'font-mono text-[13px] font-medium')}
      >
        {absent ? 'Not recorded' : value}
      </dd>
      {source && !absent && <dd className="mt-1">{source}</dd>}
    </div>
  )
}

/* ── Segmented tabs ─────────────────────────────────────────────────────────────────────────── */

export interface DeskTab<K extends string> { key: K; label: string; count?: number | null }

/**
 * Horizontally scrollable segmented control with the WAI-ARIA tabs pattern (roving focus, arrow keys).
 * The scroller is `relative` so nothing visually hidden inside it can escape and widen the page.
 */
export function SegmentedTabs<K extends string>({ tabs, value, onChange, label, idBase, testId }: {
  tabs: ReadonlyArray<DeskTab<K>>
  value: K
  onChange: (key: K) => void
  label: string
  idBase: string
  testId?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(tabs[next].key)
    refs.current[next]?.focus()
  }
  return (
    <div className="relative -mx-1 overflow-x-auto px-1 pb-1" data-testid={testId}>
      <div role="tablist" aria-label={label} className="inline-flex min-w-max gap-1 rounded-control border border-carup-line bg-carup-bg-surface p-1">
        {tabs.map((tab, i) => {
          const selected = tab.key === value
          return (
            <button
              key={tab.key}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${idBase}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-control px-3.5 text-sm font-semibold transition-colors',
                FOCUS, 'focus-visible:ring-offset-0',
                selected ? 'border border-carup-line-strong bg-carup-bg-raised text-carup-text' : 'border border-transparent text-carup-text-2 hover:text-carup-text',
              )}
            >
              {tab.label}
              {typeof tab.count === 'number' && (
                <span className={cn('rounded-full px-1.5 text-xs tabular-nums', selected ? 'bg-carup-bg-surface-2 text-carup-text' : 'bg-carup-bg-raised text-carup-text-2')}>
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The panel a SegmentedTabs tab controls. */
export function TabPanel({ idBase, tabKey, children, testId }: { idBase: string; tabKey: string; children: ReactNode; testId?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${tabKey}`} aria-labelledby={`${idBase}-tab-${tabKey}`} tabIndex={0} data-testid={testId} className="min-w-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
      {children}
    </div>
  )
}

/* ── Inline confirmation ────────────────────────────────────────────────────────────────────── */

/** A consequential action asks once, in place, saying exactly what will happen. */
export function InlineConfirm({ title, children, confirm, cancel, tone = 'neutral', testId }: {
  title: ReactNode
  children?: ReactNode
  confirm: ReactNode
  cancel: ReactNode
  tone?: 'neutral' | 'danger'
  testId?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Confirm action"
      data-testid={testId}
      className={cn('rounded-control border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus', tone === 'danger' ? 'border-status-danger bg-status-danger-soft' : 'border-carup-line-strong bg-carup-bg-surface')}
    >
      <p className="text-sm font-semibold text-carup-text">{title}</p>
      {children && <div className="mt-1 text-sm leading-6 text-carup-text-2">{children}</div>}
      <div className="mt-3 flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{confirm}{cancel}</div>
    </div>
  )
}

/* ── Phone next-move bar ────────────────────────────────────────────────────────────────────── */

const BOTTOM_NAV_SELECTOR = '[data-testid="compact-bottom-nav"], [data-testid="shell-ws-bottom-nav"]'

function subscribeBottomNav(onChange: () => void) {
  window.addEventListener('resize', onChange)
  // Re-check once after the commit that mounted the bar: the shell's nav (if any) is in the DOM by then.
  const frame = window.requestAnimationFrame(onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    window.cancelAnimationFrame(frame)
  }
}
function bottomNavShown(): boolean {
  if (typeof document === 'undefined') return false
  const nav = document.querySelector<HTMLElement>(BOTTOM_NAV_SELECTOR)
  return Boolean(nav && nav.getClientRects().length > 0)
}
const noBottomNavOnServer = () => false

/**
 * The next move, reachable by one thumb on phones (below 1024 px). It claims the bottom of the screen
 * (lib/bottomBarClaim): flush with the edge when the shell's bottom navigation steps aside — or when
 * the shell shows none (the Trade workspace) — otherwise directly above that navigation so the two
 * never overlap. Its height is reserved as scroll padding so a focused control is never hidden under it.
 */
export function StickyMove({ active, label, children, testId }: { active: boolean; label: string; children: ReactNode; testId?: string }) {
  const claim = useClaimBottomBar(active)
  const navShown = useSyncExternalStore(subscribeBottomNav, bottomNavShown, noBottomNavOnServer)
  const flush = claim.honoured || !navShown
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!active || !el || typeof window === 'undefined') return
    const root = document.documentElement
    const previous = root.style.scrollPaddingBottom
    const update = () => {
      const r = el.getBoundingClientRect()
      const covered = r.height > 0 ? Math.max(0, window.innerHeight - r.top) : 0
      root.style.scrollPaddingBottom = covered ? `${Math.ceil(covered) + 8}px` : previous
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      root.style.scrollPaddingBottom = previous
    }
  }, [active, flush])
  if (!active) return null
  return (
    <>
      <div aria-hidden="true" className="h-24 lg:hidden" />
      <div
        ref={ref}
        role="region"
        aria-label={label}
        data-testid={testId}
        data-docked={flush ? 'bottom' : 'above-nav'}
        className={cn(
          'fixed inset-x-0 z-40 border-t border-carup-line-strong bg-carup-bg-raised px-4 pt-3 lg:hidden',
          flush ? 'bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))] pb-3',
        )}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">{children}</div>
      </div>
    </>
  )
}
