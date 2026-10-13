/**
 * CA-K3-01 — reusable truth-state primitives. Every state carries text and an icon; colour is never
 * the only cue, and no tone implies good/bad business performance (CA-UX-01 §4.4, §9).
 */
import { Ban, CircleDot, Cpu, Lightbulb, Lock, MinusCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TRUTH_STATES, presentSlot, type MetricSlot, type TruthState, type TruthTone } from '@/lib/corporate/truthState'

const TONE_ICON: Record<TruthTone, LucideIcon> = {
  governed: CircleDot,
  advisory: Lightbulb,
  technical: Cpu,
  blocked: Ban,
  neutral: MinusCircle,
  degraded: TriangleAlert,
  restricted: Lock,
}

const TONE_BADGE: Record<TruthTone, string> = {
  governed: 'border-slate-300 bg-white text-slate-800',
  advisory: 'border-dashed border-violet-300 bg-violet-50 text-violet-800',
  technical: 'border-sky-300 bg-sky-50 text-sky-900 font-mono',
  blocked: 'border-slate-300 bg-slate-100 text-slate-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  degraded: 'border-amber-300 bg-amber-50 text-amber-900',
  restricted: 'border-slate-700 bg-slate-800 text-white',
}

/** Hatched background marks a blocked value area as a pattern, not only a colour. */
const BLOCKED_PATTERN = 'bg-[repeating-linear-gradient(135deg,theme(colors.slate.100)_0,theme(colors.slate.100)_6px,theme(colors.white)_6px,theme(colors.white)_12px)]'

export function TruthStateBadge({ state, badge, className }: { state: TruthState; badge?: string; className?: string }) {
  const spec = TRUTH_STATES[state]
  const Icon = TONE_ICON[spec.tone]
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none', TONE_BADGE[spec.tone], className)}
      data-truth-state={state}
      data-testid="truth-state-badge"
      title={spec.meaning}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {badge ?? spec.badge}
    </span>
  )
}

export interface MetricSlotViewProps {
  label: string
  slot: MetricSlot
  /** Period / window the slot describes, when it has one. */
  period?: string
  /** Why the slot is in this state (owner decision, missing authority, …). */
  reason?: string
  /** Metadata / source affordance. */
  meta?: React.ReactNode
  size?: 'lg' | 'md' | 'sm'
  className?: string
}

/**
 * One metric slot: label, value-or-statement, truth badge, optional reason and metadata. The value
 * position shows a number ONLY for a governed value-bearing state (see presentSlot).
 */
export function MetricSlotView({ label, slot, period, reason, meta, size = 'md', className }: MetricSlotViewProps) {
  const p = presentSlot(slot, label)
  const blocked = !p.isValue
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-md border px-3 py-2.5',
        p.tone === 'advisory' ? 'border-dashed border-violet-200 bg-violet-50/40' : 'border-slate-200 bg-white',
        className,
      )}
      data-testid="metric-slot"
      data-truth-state={p.state}
      data-is-value={p.isValue ? 'true' : 'false'}
      role="group"
      aria-label={p.accessibleText}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <TruthStateBadge state={p.state} badge={p.badge} />
      </div>
      <div
        className={cn(
          'rounded-sm',
          blocked ? cn(BLOCKED_PATTERN, 'px-2 py-1.5 text-sm text-slate-700') : 'tabular-nums text-slate-900',
          !blocked && size === 'lg' && 'text-3xl font-semibold tracking-tight',
          !blocked && size === 'md' && 'text-2xl font-semibold tracking-tight',
          !blocked && size === 'sm' && 'text-lg font-semibold',
        )}
        data-testid="metric-slot-primary"
      >
        {p.primary}
      </div>
      {(p.detail || period) && (
        <p className="text-[11px] text-slate-500" data-testid="metric-slot-detail">
          {[p.detail, period].filter(Boolean).join(' · ')}
        </p>
      )}
      {reason && <p className="text-[11px] leading-snug text-slate-500" data-testid="metric-slot-reason">{reason}</p>}
      {meta}
    </div>
  )
}

/** A dense list of blocked strategic slots (e.g. Finance) — rows, not a wall of equal cards. */
export function BlockedSlotList({
  items,
  caption,
}: {
  items: Array<{ label: string; slot: MetricSlot; reason?: string }>
  caption: string
}) {
  return (
    <div>
    <table className="w-full border-collapse text-sm" data-testid="blocked-slot-list">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <th scope="col" className="py-2 pr-3 font-medium">Measure</th>
          <th scope="col" className="py-2 pr-3 font-medium">State</th>
          <th scope="col" className="hidden py-2 font-medium md:table-cell">Reason</th>
        </tr>
      </thead>
      <tbody>
        {items.map(({ label, slot, reason }) => {
          const p = presentSlot(slot, label)
          return (
            <tr key={label} className="border-b border-slate-100 align-top" data-testid="blocked-slot-row" data-truth-state={p.state}>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-800">{label}</th>
              <td className="py-2 pr-3" aria-label={p.accessibleText}>
                <div className="flex flex-col gap-1">
                  {p.isValue && <span className="tabular-nums text-sm font-semibold text-slate-900">{p.primary}</span>}
                  <TruthStateBadge state={p.state} badge={p.badge} className="self-start" />
                  {reason && <span className="text-[11px] text-slate-500 md:hidden">{reason}</span>}
                </div>
              </td>
              <td className="hidden py-2 text-xs text-slate-500 md:table-cell">{reason}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
    <StateFootnotes states={Array.from(new Set(items.map((i) => i.slot.state)))} />
    </div>
  )
}

/**
 * A compact list of slots — label and truth badge per row — for sections where many slots share a
 * state. The full statement stays available to assistive technology on every row, and each state
 * used is explained once in the footnote, so blocked sections stay readable instead of repeating
 * the same sentence (CA-UX-01 §4.3 density; never a wall of equal cards).
 */
export function CompactSlotList({ items, caption, className }: { items: Array<{ label: string; slot: MetricSlot }>; caption: string; className?: string }) {
  const presented = items.map(({ label, slot }) => ({ label, p: presentSlot(slot, label) }))
  const states = Array.from(new Set(presented.map(({ p }) => p.state)))
  return (
    <div className={cn('rounded-md border border-slate-200 bg-white', className)} data-testid="compact-slot-list">
      <ul aria-label={caption} className="divide-y divide-slate-100">
        {presented.map(({ label, p }) => (
          <li
            key={label}
            className="flex min-h-[40px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
            data-testid="metric-slot"
            data-truth-state={p.state}
            data-is-value={p.isValue ? 'true' : 'false'}
            aria-label={p.accessibleText}
          >
            <span className="text-sm text-slate-800">{label}</span>
            {p.isValue
              ? <span className="flex items-center gap-2"><span className="tabular-nums text-sm font-semibold text-slate-900" data-testid="metric-slot-primary">{p.primary}</span><TruthStateBadge state={p.state} badge={p.badge} /></span>
              : <TruthStateBadge state={p.state} badge={p.badge} />}
          </li>
        ))}
      </ul>
      <StateFootnotes states={states} />
    </div>
  )
}

/** Each state's statement, once — the legend for a compact block. */
export function StateFootnotes({ states }: { states: TruthState[] }) {
  const withStatement = states.filter((s) => TRUTH_STATES[s].statement)
  if (withStatement.length === 0) return null
  return (
    <dl className="space-y-1 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-600" data-testid="state-footnotes">
      {withStatement.map((s) => (
        <div key={s} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="font-medium text-slate-700">{TRUTH_STATES[s].badge}:</dt>
          <dd>{String(TRUTH_STATES[s].statement).replace(/\.$/, '')}.</dd>
        </div>
      ))}
    </dl>
  )
}
