/**
 * RX-06 Trade — trading-desk primitives shared by the seller desk (stock, passport, command desk,
 * trade graph, workbook import) and the operator console.
 *
 * Presentation only. Pages keep their own reads, state and API calls; these components arrange what
 * a page already has. Truth rules they encode:
 *  - a failed read, a refusal (403), a feature that is not there (404), the shared rate limit (429)
 *    and an ended session each get their OWN state — none of them is ever drawn as "empty";
 *  - provenance is shown next to facts: recorded by CarUp, declared by the seller (not verified),
 *    read automatically (not verified), derived from recorded events;
 *  - the pulse is ONE compact line of figures counted from what the read returned, with its scope.
 */
import { SignInLink } from '@/components/trade/core/SignInLink'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CircleSlash, Clock3, Inbox, Loader2, LockKeyhole, LogIn, RotateCw, SearchX } from 'lucide-react'
import { useClaimBottomBar } from '@/lib/bottomBarClaim'
import { DESK_EYEBROW, DESK_PANEL, DESK_PRIMARY, DESK_SECONDARY } from './deskStyles'
import type { ReadFailure } from './deskFormat'

/* ───────────────────────── header + pulse ───────────────────────── */

/** The desk's ink header: where you are, what this desk is, one pulse line and at most two actions. */
export function DeskHeader({ eyebrow, title, description, pulse, actions, meta, testId, titleId }: {
  eyebrow: string
  title: ReactNode
  description?: ReactNode
  pulse?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  testId?: string
  titleId?: string
}) {
  return (
    <header data-testid={testId} className="relative overflow-hidden rounded-card bg-carup-raw-ink px-4 py-5 text-white sm:px-6 sm:py-6">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-carup-raw-orange-signal" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">{eyebrow}</p>
          <h1 id={titleId} className="mt-2 text-[1.625rem] font-bold leading-tight tracking-[-0.025em] sm:text-[2rem]">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
      </div>
      {pulse && <div className="mt-5 border-t border-white/15 pt-3">{pulse}</div>}
    </header>
  )
}

export interface PulseItem { label: string; value: ReactNode; testId?: string }

/**
 * One compact line of figures, each counted from the read, with the scope it was counted over.
 * `tone="ink"` sits on the desk header; `tone="light"` on a raised panel.
 */
export function DeskPulse({ scope, items, tone = 'ink', testId }: { scope: ReactNode; items: PulseItem[]; tone?: 'ink' | 'light'; testId?: string }) {
  const muted = tone === 'ink' ? 'text-white/70' : 'text-carup-text-3'
  const strong = tone === 'ink' ? 'text-white' : 'text-carup-text'
  return (
    <div data-testid={testId} className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1.5 text-sm">
      <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${muted}`}>{scope}</span>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-baseline gap-1.5" data-testid={item.testId}>
          <span className={`font-mono text-base font-semibold tabular-nums ${strong}`}>{item.value}</span>
          <span className={muted}>{item.label}</span>
        </span>
      ))}
    </div>
  )
}

/* ───────────────────────── truthful states ───────────────────────── */

export type DeskStateKind = 'loading' | 'empty' | 'failed' | 'limited' | 'denied' | 'unavailable' | 'session' | 'signin'

const STATE_ICON: Record<DeskStateKind, typeof Inbox> = {
  loading: Loader2, empty: Inbox, failed: AlertTriangle, limited: Clock3, denied: CircleSlash,
  unavailable: SearchX, session: LogIn, signin: LockKeyhole,
}
const STATE_TONE: Record<DeskStateKind, string> = {
  loading: 'bg-carup-bg-surface text-carup-text-2',
  empty: 'bg-carup-bg-surface text-carup-text-2',
  failed: 'bg-status-warning-soft text-status-warning',
  limited: 'bg-status-warning-soft text-status-warning',
  denied: 'bg-status-neutral-soft text-status-neutral',
  unavailable: 'bg-status-neutral-soft text-status-neutral',
  session: 'bg-status-info-soft text-status-info',
  signin: 'bg-status-info-soft text-status-info',
}

/**
 * One state panel. `empty` says what creates the first record; `failed`/`limited` say plainly that an
 * outage is not an empty result and offer a retry; `denied`/`unavailable` explain without retry spam.
 */
export function DeskState({ kind, title, children, action, onRetry, retryLabel = 'Try again', testId, compact = false }: {
  kind: DeskStateKind
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  testId?: string
  compact?: boolean
}) {
  const Icon = STATE_ICON[kind]
  const role = kind === 'loading' ? 'status' : kind === 'empty' ? undefined : 'alert'
  const border = kind === 'failed' || kind === 'limited' ? 'border-status-warning' : 'border-carup-line'
  return (
    <div role={role} data-testid={testId} data-state={kind}
      className={`flex items-start gap-3 rounded-card border ${border} ${compact ? 'border-dashed bg-carup-bg-raised p-4' : 'bg-carup-bg-raised p-5 sm:p-6'}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${STATE_TONE[kind]}`} aria-hidden="true">
        <Icon className={`h-4 w-4 ${kind === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-carup-text">{title}</p>
        {children && <div className="mt-1 text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]">{children}</div>}
        {(action || onRetry) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry && (
              <button type="button" className={DESK_SECONDARY} onClick={onRetry}>
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
 * The honest state for a read that did not produce data. `what` names the thing ("Your stock lines").
 * The server's own message is quoted, never paraphrased into a different claim.
 */
export function ReadFailureState({ failure, what, onRetry, testId, compact, deniedHint, unavailableHint }: {
  failure: ReadFailure
  what: string
  onRetry?: () => void
  testId?: string
  compact?: boolean
  deniedHint?: ReactNode
  unavailableHint?: ReactNode
}) {
  const said = failure.message ? <> The server said: <q className="font-medium text-carup-text">{failure.message}</q></> : null
  switch (failure.kind) {
    case 'limited':
      return (
        <DeskState kind="limited" testId={testId} compact={compact} onRetry={onRetry}
          title={`${what} could not be loaded right now`}>
          CarUp&apos;s server asked for a pause (too many requests). Nothing about your records is known from this — wait a moment and try again.{said}
        </DeskState>
      )
    case 'denied':
      return (
        <DeskState kind="denied" testId={testId} compact={compact} title={`${what}: not available to this account`}>
          {deniedHint ?? 'The server refused this read for the signed-in account.'}{said}
        </DeskState>
      )
    case 'unavailable':
      return (
        <DeskState kind="unavailable" testId={testId} compact={compact} title={`${what}: not available here`}>
          {unavailableHint ?? 'The server answered “not found” (404) for this read, so there is nothing it can show in this environment.'}{said}
        </DeskState>
      )
    case 'session':
      return (
        <DeskState kind="session" testId={testId} compact={compact} title="Your session has ended"
          action={<SignInLink className={DESK_PRIMARY}>Sign in again</SignInLink>}>
          Sign in again to see {what.toLowerCase()}. Nothing was changed.
        </DeskState>
      )
    default:
      return (
        <DeskState kind="failed" testId={testId} compact={compact} onRetry={onRetry}
          title={`${what} could not be loaded`}>
          This is not an empty result — the read itself failed.{said}
        </DeskState>
      )
  }
}

/* ───────────────────────── provenance ───────────────────────── */

export type ProvenanceKind = 'recorded' | 'seller' | 'you' | 'automated' | 'derived' | 'server' | 'sandbox'

const PROVENANCE: Record<ProvenanceKind, { label: string; unverified: boolean; tone: string }> = {
  recorded: { label: 'Recorded by CarUp', unverified: false, tone: 'bg-carup-bg-surface text-carup-text-2' },
  server: { label: 'Computed by CarUp’s server', unverified: false, tone: 'bg-carup-bg-surface text-carup-text-2' },
  derived: { label: 'Derived from recorded events', unverified: false, tone: 'bg-status-info-soft text-status-info' },
  seller: { label: 'Seller-declared · not verified', unverified: true, tone: 'bg-status-warning-soft text-status-warning' },
  you: { label: 'Entered by you · not verified', unverified: true, tone: 'bg-status-warning-soft text-status-warning' },
  automated: { label: 'Automated read · not verified', unverified: true, tone: 'bg-status-warning-soft text-status-warning' },
  sandbox: { label: 'Sandbox simulation · no real money', unverified: false, tone: 'bg-status-warning-soft text-status-warning' },
}

export function Provenance({ kind, label, testId = 'desk-provenance' }: { kind: ProvenanceKind; label?: string; testId?: string }) {
  const p = PROVENANCE[kind]
  return (
    <span data-testid={testId} data-provenance={kind} data-unverified={p.unverified ? 'true' : 'false'}
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5 [overflow-wrap:anywhere] ${p.tone}`}>
      {label ?? p.label}
    </span>
  )
}

/* ───────────────────────── panels ───────────────────────── */

export function DeskPanel({ title, eyebrow, provenance, actions, description, children, testId, id, className = '' }: {
  title: ReactNode
  eyebrow?: string
  provenance?: ReactNode
  actions?: ReactNode
  description?: ReactNode
  children?: ReactNode
  testId?: string
  id?: string
  className?: string
}) {
  return (
    <section id={id} data-testid={testId} aria-label={typeof title === 'string' ? title : undefined} className={`${DESK_PANEL} min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          {eyebrow && <p className={DESK_EYEBROW}>{eyebrow}</p>}
          <h2 className={`${eyebrow ? 'mt-1 ' : ''}text-base font-semibold tracking-[-0.01em] text-carup-text`}>{title}</h2>
        </div>
        {(provenance || actions) && <div className="flex flex-wrap items-center gap-2">{provenance}{actions}</div>}
      </div>
      {description && <div className="mt-1 text-sm leading-6 text-carup-text-2">{description}</div>}
      {children && <div className="mt-4 min-w-0">{children}</div>}
    </section>
  )
}

/** Monospace references with their labels. Missing values are said, never faked. */
export function RefList({ items, testId }: { items: Array<{ label: string; value: string | null | undefined; missing?: string }>; testId?: string }) {
  return (
    <dl data-testid={testId} className="flex flex-wrap gap-x-5 gap-y-1.5">
      {items.map((r) => (
        <div key={r.label} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{r.label}</dt>
          <dd className={r.value ? 'font-mono text-[12.5px] tracking-tight text-carup-text [overflow-wrap:anywhere]' : 'text-xs text-carup-text-3'}>
            {r.value || r.missing || 'not recorded'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ───────────────────────── next move ───────────────────────── */

/**
 * "Next move": ONE primary action, who it usually sits with, and what happens after. The page decides
 * the move from recorded fields only; the server still decides whether it succeeds.
 */
export function NextMove({ title, children, usuallyWith, after, action, testId = 'desk-next-move', id }: {
  title: ReactNode
  children?: ReactNode
  usuallyWith?: ReactNode
  after?: ReactNode
  action?: ReactNode
  testId?: string
  id?: string
}) {
  return (
    <section id={id} data-testid={testId} aria-label="Next move"
      className="rounded-card border border-carup-line-strong bg-carup-bg-raised p-4 shadow-[inset_4px_0_0_var(--carup-raw-orange-signal)] sm:p-5">
      <p className={DESK_EYEBROW}>Next move</p>
      <p className="mt-1 text-base font-semibold text-carup-text">{title}</p>
      {children && <div className="mt-1 text-sm leading-6 text-carup-text-2">{children}</div>}
      {(usuallyWith || after) && (
        <dl className="mt-3 grid gap-2 text-xs leading-5 sm:grid-cols-2">
          {usuallyWith && <div><dt className="font-semibold text-carup-text-3">Usually with</dt><dd className="text-carup-text">{usuallyWith}</dd></div>}
          {after && <div><dt className="font-semibold text-carup-text-3">What happens after</dt><dd className="text-carup-text">{after}</dd></div>}
        </dl>
      )}
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </section>
  )
}

/** Phone bottom bars a dock must never cover (legacy compact nav, public shell, workspace task nav). */
const BOTTOM_BARS = '[data-testid="compact-bottom-nav"], [data-testid="shell-public-bottom-nav"], [data-testid="shell-ws-bottom-nav"]'

/**
 * The phone dock for a desk's next move (below 1024 px). It claims the bottom of the screen through
 * the shared bottom-bar claim, so a tab bar that honours claims steps aside instead of stacking under
 * it. Then it MEASURES whatever bottom bar is still on screen and sits exactly above it — flush with
 * the screen edge when there is none (e.g. a workspace shell without a phone task bar). Reserves its
 * own height as scroll padding so focused controls are never hidden beneath it.
 */
export function PhoneDock({ active, label, children, testId = 'desk-phone-dock' }: {
  active: boolean
  label: ReactNode
  children: ReactNode
  testId?: string
}) {
  const claim = useClaimBottomBar(active)
  const ref = useRef<HTMLDivElement | null>(null)
  const [lift, setLift] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!active || !el || typeof window === 'undefined') return
    const root = document.documentElement
    const previous = root.style.scrollPaddingBottom
    const update = () => {
      let barHeight = 0
      document.querySelectorAll<HTMLElement>(BOTTOM_BARS).forEach((bar) => {
        const r = bar.getBoundingClientRect()
        if (r.height > 0 && r.top < window.innerHeight && r.bottom >= window.innerHeight - 1) barHeight = Math.max(barHeight, window.innerHeight - r.top)
      })
      setLift(Math.round(barHeight))
      const own = el.getBoundingClientRect().height
      root.style.scrollPaddingBottom = `${Math.ceil(own + barHeight) + 8}px`
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update)
      root.style.scrollPaddingBottom = previous
    }
  }, [active, claim.honoured])
  if (!active) return null
  return (
    <div ref={ref} role="region" aria-label="Next move" data-testid={testId} data-docked={lift > 0 ? 'above-bar' : 'bottom'}
      style={{ bottom: lift }}
      className="fixed inset-x-0 z-40 border-t border-carup-line bg-carup-bg-raised px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-sheet lg:hidden">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold leading-snug text-carup-text">{label}</p>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  )
}

/** A horizontally scrollable segmented control (phones) that becomes a row of tabs on wide screens. */
export function DeskSegments<T extends string>({ items, active, onChange, label, testId }: {
  items: ReadonlyArray<{ id: T; label: string; count?: number | null }>
  active: T
  onChange: (id: T) => void
  label: string
  testId?: string
}) {
  return (
    <div className="relative -mx-1 overflow-x-auto px-1 pb-1" data-testid={testId}>
      <div role="tablist" aria-label={label} className="inline-flex min-w-full gap-1 rounded-control bg-carup-bg-surface p-1">
        {items.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={active === item.id} onClick={() => onChange(item.id)}
            data-testid={testId ? `${testId}-${item.id}` : undefined}
            className={`min-h-11 shrink-0 whitespace-nowrap rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-carup-focus ${
              active === item.id ? 'bg-carup-bg-raised text-carup-text shadow-sm ring-1 ring-carup-line' : 'text-carup-text-2 hover:text-carup-text'}`}>
            {item.label}{item.count !== undefined && item.count !== null && <span className="ml-1.5 font-normal text-carup-text-3">{item.count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Action receipt or refusal. A receipt is never green: it records that the server accepted a request. */
export function DeskNotice({ tone = 'info', children, testId }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode; testId?: string }) {
  const cls = tone === 'danger' ? 'border-status-danger bg-status-danger-soft' : tone === 'warning' ? 'border-status-warning bg-status-warning-soft' : 'border-status-info bg-status-info-soft'
  return (
    <p role={tone === 'info' ? 'status' : 'alert'} data-testid={testId}
      className={`rounded-control border px-3 py-2.5 text-sm leading-6 text-carup-text [overflow-wrap:anywhere] ${cls}`}>
      {children}
    </p>
  )
}
