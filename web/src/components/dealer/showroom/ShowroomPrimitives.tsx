/**
 * RX05-A — shared visual primitives for the unified dealership pages. Tokens only (carup-* and
 * status-*), no data, no decisions.
 */
import { useState, type ReactNode } from 'react'
import { AlertTriangle, BadgeCheck, CircleDashed, Clock3, Info, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dealerMonogram, type StatusTone } from './dealerShowroomModel'
import { TONE_PANEL, TONE_TEXT } from './showroomTones'

export const ACTION_PRIMARY =
  'inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full bg-carup-action px-5 text-center text-sm font-semibold leading-snug text-carup-action-on transition-colors hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
export const ACTION_SECONDARY =
  'inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full bg-carup-bg-raised px-5 text-center text-sm font-semibold leading-snug text-carup-text ring-1 ring-carup-line-strong transition-colors hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:cursor-not-allowed disabled:opacity-60'
/** Primary action on a dark ink band. */
export const ACTION_ON_INK =
  'inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full bg-carup-raw-paper px-5 text-center text-sm font-semibold leading-snug text-carup-raw-ink transition-colors hover:bg-carup-raw-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-raw-orange-signal focus-visible:ring-offset-2 focus-visible:ring-offset-carup-raw-ink'
export const ACTION_GHOST_ON_INK =
  'inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full px-5 text-center text-sm font-semibold leading-snug text-carup-raw-paper ring-1 ring-white/25 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-raw-orange-signal'
export const TEXT_LINK =
  'rounded-control font-semibold text-carup-action underline decoration-1 underline-offset-4 hover:text-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus'
export const FIELD =
  'block w-full min-h-11 rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 text-[15px] text-carup-text placeholder:text-carup-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:cursor-not-allowed disabled:opacity-60'
export const TEXTAREA =
  'block w-full min-h-32 rounded-control border border-carup-line-strong bg-carup-bg-raised p-3 text-[15px] leading-6 text-carup-text placeholder:text-carup-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus'
export const LABEL = 'mb-1.5 block text-sm font-semibold text-carup-text'
export const HINT = 'mt-1.5 text-[13px] leading-5 text-carup-text-2'
export const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-text-3'
export const EYEBROW_ON_INK = 'text-[11px] font-semibold uppercase tracking-[0.2em] text-carup-raw-orange-signal'
export const CARD = 'rounded-card bg-carup-bg-raised ring-1 ring-carup-line'
export const PAGE_WIDTH = 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10'

const TONE_CHIP: Record<StatusTone, string> = {
  success: 'bg-status-success-soft text-status-success',
  warning: 'bg-status-warning-soft text-status-warning',
  danger: 'bg-status-danger-soft text-status-danger',
  info: 'bg-status-info-soft text-status-info',
  neutral: 'bg-status-neutral-soft text-status-neutral',
}

const TONE_ICON: Record<StatusTone, typeof Info> = {
  success: BadgeCheck,
  warning: ShieldAlert,
  danger: AlertTriangle,
  info: Clock3,
  neutral: CircleDashed,
}

export function StatusChip({ tone, children, className, testId }: { tone: StatusTone; children: ReactNode; className?: string; testId?: string }) {
  const Icon = TONE_ICON[tone]
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-tight', TONE_CHIP[tone], className)}
      data-tone={tone}
      data-testid={testId}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  )
}

/** A calm, bordered notice; the tone colours the left rule and the icon. */
export function Notice({ tone, title, children, role, testId, className }: {
  tone: StatusTone
  title?: ReactNode
  children?: ReactNode
  role?: 'status' | 'alert'
  testId?: string
  className?: string
}) {
  const Icon = TONE_ICON[tone]
  return (
    <div role={role} data-testid={testId} className={cn('flex items-start gap-3 rounded-card border-l-4 p-4 text-sm leading-6 text-carup-text', TONE_PANEL[tone], className)}>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', TONE_TEXT[tone])} aria-hidden="true" />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        {title && <p className="font-semibold text-carup-text">{title}</p>}
        {children && <div className={title ? 'mt-1 text-carup-text-2' : 'text-carup-text'}>{children}</div>}
      </div>
    </div>
  )
}

const MARK_SIZE = {
  sm: 'h-12 w-12 text-base',
  md: 'h-16 w-16 text-xl',
  lg: 'h-20 w-20 text-2xl sm:h-24 sm:w-24 sm:text-3xl',
} as const

/**
 * The dealership's mark: an approved public avatar when the caller has one, otherwise a monogram
 * plate. There is never an external, OEM or stock fallback; a failed image degrades to the plate.
 */
export function DealerMark({ name, src, alt, size = 'md', onInk = false, className }: {
  name: string
  src?: string | null
  alt?: string | null
  size?: keyof typeof MARK_SIZE
  onInk?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = Boolean(src) && failed !== src
  const initials = dealerMonogram(name)
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-card font-semibold tracking-[-0.02em]',
        onInk ? 'bg-carup-raw-paper text-carup-raw-ink' : 'bg-carup-raw-ink text-carup-raw-paper',
        MARK_SIZE[size],
        className,
      )}
      data-testid="dealer-showroom-mark"
      data-variant={showImage ? 'image' : 'monogram'}
    >
      {showImage ? (
        <img src={src ?? undefined} alt={alt || ''} className="h-full w-full object-cover" onError={() => setFailed(src ?? null)} />
      ) : (
        <>
          <span aria-hidden="true">{initials || '·'}</span>
          <span className="absolute inset-x-0 bottom-0 h-1 bg-carup-raw-orange-signal" aria-hidden="true" />
        </>
      )}
    </div>
  )
}

export function SectionHeading({ id, eyebrow, title, lead, action }: {
  id: string
  eyebrow?: string
  title: string
  lead?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className={EYEBROW}>{eyebrow}</p>}
        <h2 id={id} className="mt-1.5 text-[clamp(1.375rem,2.2vw,1.875rem)] font-bold leading-[1.1] tracking-[-0.025em] text-carup-text">
          {title}
        </h2>
        {lead && <p className="mt-2 text-[15px] leading-6 text-carup-text-2">{lead}</p>}
      </div>
      {action}
    </div>
  )
}

/** Pulse blocks for a loading read. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-card bg-carup-bg-surface-2 motion-reduce:animate-none', className)} aria-hidden="true" />
}
