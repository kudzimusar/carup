/**
 * RX-06 — small Trade primitives (tokens only): provenance chips, monospace references, the route
 * glyph, a section panel, a fact list and the read gate that keeps loading / failed / denied /
 * unavailable distinct from "empty". No data, no decisions.
 */
import { useId, type ReactNode } from 'react'
import { ArrowRight, Bot, ClipboardCheck, FileClock, MapPin, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/dealer/workspace/EmptyState'
import type { Read } from './orderModel'

type ProvenanceKind = 'stated' | 'record' | 'automated' | 'unverified' | 'carup'

const PROVENANCE_ICON: Record<ProvenanceKind, typeof UserRound> = {
  stated: UserRound,
  record: FileClock,
  automated: Bot,
  unverified: FileClock,
  carup: ClipboardCheck,
}

const PROVENANCE_TONE: Record<ProvenanceKind, string> = {
  stated: 'bg-carup-bg-surface text-carup-text-2 ring-carup-line',
  record: 'bg-carup-bg-surface text-carup-text-2 ring-carup-line',
  automated: 'bg-status-info-soft text-status-info ring-status-info',
  unverified: 'bg-status-warning-soft text-status-warning ring-status-warning',
  carup: 'bg-carup-bg-surface text-carup-text-2 ring-carup-line',
}

/** Where a fact comes from: "Stated by you", "Order record · 17 Nov 2026", "Automated read · not verified". */
export function Provenance({ kind = 'record', children, testId }: { kind?: ProvenanceKind; children: ReactNode; testId?: string }) {
  const Icon = PROVENANCE_ICON[kind]
  return (
    <span
      data-testid={testId}
      data-provenance={kind}
      className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ring-1', PROVENANCE_TONE[kind])}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  )
}

/** A reference (order id, VIN, chassis, container) in monospace; the full value stays available. */
export function RefCode({ value, full, label, testId }: { value: string; full?: string; label?: string; testId?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1" data-testid={testId}>
      {label && <span className="text-xs font-medium text-carup-text-3">{label}</span>}
      <code
        title={full}
        className="max-w-full rounded-control bg-carup-bg-surface px-1.5 py-0.5 font-mono text-xs tabular-nums text-carup-text ring-1 ring-carup-line [overflow-wrap:anywhere]"
      >
        {value}
      </code>
    </span>
  )
}

/** Origin → destination as one glyph line; absent places say so. */
export function RouteGlyph({ origin, destination, className, testId = 'trade-route' }: {
  origin: string | null
  destination: string | null
  className?: string
  testId?: string
}) {
  return (
    <p className={cn('relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm', className)} data-testid={testId}>
      <span className="sr-only">Route: from {origin ?? 'an origin that is not recorded'} to {destination ?? 'a destination that is not recorded'}.</span>
      <span aria-hidden="true" className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-carup-text">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-carup-text" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{origin ?? 'Origin not recorded'}</span>
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center text-carup-text-3">
        <span className="w-6 border-t-2 border-dotted border-carup-line-strong sm:w-10" />
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
      <span aria-hidden="true" className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-carup-text">
        <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--carup-raw-orange-signal)' }} />
        <span className="min-w-0 [overflow-wrap:anywhere]">{destination ?? 'Destination not recorded'}</span>
      </span>
    </p>
  )
}

/** A raised section with ONE heading (h2 by default) and an optional quiet action. */
export function Panel({ title, eyebrow, action, children, testId, className, bodyClassName, id, level = 2 }: {
  title: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
  children: ReactNode
  testId?: string
  className?: string
  bodyClassName?: string
  id?: string
  level?: 2 | 3
}) {
  const autoId = useId()
  const headingId = `${id ?? autoId}-title`
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <section id={id} aria-labelledby={headingId} data-testid={testId} className={cn('min-w-0 rounded-card border border-carup-line bg-carup-bg-raised', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-carup-line px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">{eyebrow}</p>}
          <Heading id={headingId} className="text-base font-semibold tracking-[-0.01em] text-carup-text">{title}</Heading>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className={cn('px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** One fact: label, value and (optionally) where it came from. */
export function Fact({ label, children, provenance, testId, className }: {
  label: ReactNode
  children: ReactNode
  provenance?: ReactNode
  testId?: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)} data-testid={testId}>
      <dt className="text-xs font-medium text-carup-text-3">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{children}</dd>
      {provenance && <dd className="mt-1">{provenance}</dd>}
    </div>
  )
}

/** A value that was not recorded is said plainly, in a quieter tone. */
export function NotRecorded({ children = 'Not recorded' }: { children?: ReactNode }) {
  return <span className="font-normal text-carup-text-3">{children}</span>
}

/**
 * The five states of a read. Only `ready` renders the children; everything else is said honestly:
 * a failure is not an empty list, a refusal is not a failure, and a switched-off feature is neither.
 */
export function ReadGate<T>({ read, label, children, testId, compact = true }: {
  read: Read<T>
  /** What is being read, in plain words ("the order's documents"). */
  label: string
  children: (data: T) => ReactNode
  testId: string
  compact?: boolean
}) {
  if (read.state === 'ready') return <>{children(read.data)}</>
  if (read.state === 'loading') {
    return <EmptyState kind="loading" compact={compact} title={`Loading ${label}…`} testId={`${testId}-loading`} />
  }
  if (read.state === 'failed') {
    return (
      <EmptyState kind="error" compact={compact} title={`${label.charAt(0).toUpperCase()}${label.slice(1)} could not be loaded`} onRetry={read.onRetry} testId={`${testId}-failed`}>
        {read.message ? <span className="[overflow-wrap:anywhere]">{read.message} </span> : null}
        This is a failed read, not an empty record — nothing about the order has changed.
      </EmptyState>
    )
  }
  if (read.state === 'denied') {
    return (
      <EmptyState kind="denied" compact={compact} title={`This account cannot see ${label}`} testId={`${testId}-denied`}>
        CarUp refused this read for the signed-in account. Only the order’s buyer, its assigned participants and CarUp operations can see it.
      </EmptyState>
    )
  }
  return (
    <EmptyState kind="denied" compact={compact} title={`${label.charAt(0).toUpperCase()}${label.slice(1)} is not available`} testId={`${testId}-unavailable`}>
      {read.message ? <span className="[overflow-wrap:anywhere]">{read.message} </span> : null}
      This part of Trade is switched off or was not found for this account.
    </EmptyState>
  )
}
