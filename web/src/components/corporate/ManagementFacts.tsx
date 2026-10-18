/**
 * CA-OWNER-02 — how a server-decided management fact reads on a Corporate page.
 *
 * A fact always shows its truth state, and — when it carries a value — where the value came from, when it was read, what it
 * covers and how the operational-provenance authority (K2B) filtered it. Nothing here computes a figure: counts, breakdowns
 * and provenance numbers are printed exactly as the server stated them, and a statement state never shows a number.
 */
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowUpRight, Clock, Lock, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MetricSlotView, TruthStateBadge } from '@/components/corporate/TruthState'
import { withCorporateArrival } from '@/components/admin/adminArrival'
import { factToSlot, type AttentionItem, type ManagementFact, type ManagementResult, type QueueView } from '@/lib/corporate/management'
import { ageText, formatAsOf, formatDay, windowText } from '@/lib/corporate/factFormat'
import { presentSlot } from '@/lib/corporate/truthState'

const day = formatDay
const number = (n: number) => n.toLocaleString('en-US')

// ── one fact ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Source, as-of, scope, K2B provenance, extent and breakdown — exactly as the server stated them. */
export function FactMeta({ fact, className }: { fact: ManagementFact; className?: string }) {
  const asOf = formatAsOf(fact.asOf)
  const p = fact.provenance
  const oldest = fact.extent?.oldestAt
  return (
    <div className={cn('space-y-1 text-[11px] leading-snug text-slate-600', className)} data-testid="fact-meta">
      {(asOf || fact.scope) && (
        <p>
          {asOf && <span data-testid="fact-as-of">As of {asOf}</span>}
          {asOf && fact.scope && <span aria-hidden="true"> · </span>}
          {fact.scope && <span data-testid="fact-scope">{fact.scope}</span>}
        </p>
      )}
      {fact.source && <p><span className="text-slate-500">Source: </span><span data-testid="fact-source">{fact.source.authority}</span></p>}
      {p && (
        <p data-testid="fact-provenance">
          <span className="text-slate-500">Provenance (K2B): </span>
          {number(p.operational)} operational of {number(p.raw)} records · {number(p.excludedNonOperational)} excluded (non-operational) · {number(p.unknownRequiresReview)} need review (not counted)
        </p>
      )}
      {oldest && <p data-testid="fact-extent"><span className="text-slate-500">Oldest record: </span>{day(oldest)} · {ageText(oldest, fact.asOf)}</p>}
      {fact.breakdown && fact.breakdown.length > 0 && (
        <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded border border-slate-100 bg-slate-50/60 px-2 py-1" data-testid="fact-breakdown">
          {fact.breakdown.map((b) => (
            <div key={b.key} className="contents">
              <dt className="min-w-0 break-words text-slate-600">{b.label}</dt>
              <dd className="text-right tabular-nums font-medium text-slate-800">{b.currency ? `${b.currency} ${number(b.value)}` : number(b.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** A fact as a card: the truth-state slot plus its metadata. */
export function FactCard({ fact, size = 'md', className }: { fact: ManagementFact; size?: 'lg' | 'md' | 'sm'; className?: string }) {
  const live = fact.state === 'GOVERNED_ACTUAL' || fact.state === 'TECHNICAL_OPERATIONAL'
  return (
    <div className={cn('min-w-0', className)} data-testid="management-fact" data-fact-id={fact.id}>
      <MetricSlotView
        label={fact.label}
        slot={factToSlot(fact)}
        size={size}
        period={windowText(fact.window) ?? undefined}
        reason={(live ? fact.detail : fact.reason ?? fact.detail) ?? undefined}
        meta={live || fact.state === 'DEGRADED' ? <FactMeta fact={fact} className="border-t border-slate-100 pt-1.5" /> : null}
        className="h-full"
      />
    </div>
  )
}

/** A dense row: label and metadata on the left, value and truth state on the right. */
export function FactRow({ fact }: { fact: ManagementFact }) {
  const p = presentSlot(factToSlot(fact), fact.label)
  const live = fact.state === 'GOVERNED_ACTUAL' || fact.state === 'TECHNICAL_OPERATIONAL'
  const note = live ? fact.detail : fact.reason ?? fact.detail
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-testid="management-fact" data-fact-id={fact.id}>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-slate-900">{fact.label}</p>
        {windowText(fact.window) && <p className="text-[11px] text-slate-500">{windowText(fact.window)}</p>}
        {note && <p className="text-[11px] leading-snug text-slate-600" data-testid="metric-slot-reason">{note}</p>}
        {(live || fact.state === 'DEGRADED') && <FactMeta fact={fact} />}
      </div>
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 sm:max-w-[45%] sm:justify-end"
        data-testid="metric-slot"
        data-truth-state={p.state}
        data-is-value={p.isValue ? 'true' : 'false'}
        aria-label={p.accessibleText}
        role="group"
      >
        <span className={cn(p.isValue ? 'tabular-nums text-base font-semibold text-slate-900' : 'text-xs text-slate-700')} data-testid="metric-slot-primary">{p.primary}</span>
        <TruthStateBadge state={p.state} badge={p.badge} />
      </div>
    </li>
  )
}

export function FactRows({ facts, caption, className, testId }: { facts: readonly ManagementFact[]; caption: string; className?: string; testId?: string }) {
  if (facts.length === 0) return null
  return (
    <ul aria-label={caption} className={cn('divide-y divide-slate-100 rounded-md border border-slate-200 bg-white', className)} data-testid={testId}>
      {facts.map((f) => <FactRow key={f.id} fact={f} />)}
    </ul>
  )
}

export function FactGrid({ facts, size = 'md', className, testId }: { facts: readonly ManagementFact[]; size?: 'lg' | 'md' | 'sm'; className?: string; testId?: string }) {
  if (facts.length === 0) return null
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3', className)} data-testid={testId}>
      {facts.map((f) => <FactCard key={f.id} fact={f} size={size} />)}
    </div>
  )
}

// ── attention ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<AttentionItem['category'], string> = {
  platform: 'Platform',
  data_source: 'Data source',
  communications: 'Communications',
  queue: 'Queue',
  provenance_review: 'Provenance review',
  delivery: 'Delivery',
}

const operateClass = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500'

/** A jump into the operational Admin, carrying the "came from Corporate Admin" marker (adminArrival). */
export function OperateButton({ to, label }: { to: string; label: string }) {
  return (
    <Link to={withCorporateArrival(to)} className={operateClass} data-testid="operate-action">
      {label} <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </Link>
  )
}

/** The Overview's first section: what needs a decision, why, since when, and where to work it. */
export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" data-testid="attention-empty">
        Nothing is flagged on this read. Each queue and source below states its own truth.
      </p>
    )
  }
  return (
    <ol className="space-y-2" aria-label="Needs attention, in order">
      {items.map((item) => {
        const asOf = formatAsOf(item.asOf)
        return (
          <li
            key={item.id}
            className="flex flex-col gap-3 rounded-md border border-l-4 border-slate-200 border-l-orange-500 bg-white px-4 py-3 md:flex-row md:items-start md:justify-between"
            data-testid="attention-item"
            data-category={item.category}
          >
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{CATEGORY_LABEL[item.category]}</p>
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              {item.ageSince && (
                <p className="inline-flex items-center gap-1 text-xs text-slate-700" data-testid="attention-age">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Waiting since {day(item.ageSince)} · {ageText(item.ageSince, item.asOf)}
                </p>
              )}
              <p className="text-xs text-slate-600" data-testid="attention-rule">{item.ruleSource}</p>
              {item.reason && <p className="text-xs text-slate-600">{item.reason}</p>}
              <p className="text-[11px] text-slate-500" data-testid="attention-meta">
                {[item.source && `Source: ${item.source}`, asOf && `As of ${asOf}`, item.scope].filter(Boolean).join(' · ')}
              </p>
            </div>
            {item.operate && <div className="shrink-0"><OperateButton to={item.operate.route} label={item.operate.label} /></div>}
          </li>
        )
      })}
    </ol>
  )
}

// ── named queues ──────────────────────────────────────────────────────────────────────────────────────────────────────

function QueueValue({ queue }: { queue: QueueView }) {
  const p = presentSlot(factToSlot(queue.fact), queue.label)
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="metric-slot" data-truth-state={p.state} data-is-value={p.isValue ? 'true' : 'false'} aria-label={p.accessibleText} role="group">
      <span className={cn(p.isValue ? 'tabular-nums text-lg font-semibold text-slate-900' : 'text-xs text-slate-700')} data-testid="metric-slot-primary">{p.primary}</span>
      <TruthStateBadge state={p.state} badge={p.badge} />
    </div>
  )
}

const waitingSince = (q: QueueView) => (q.fact.extent?.oldestAt ? `Waiting since ${day(q.fact.extent.oldestAt)} · ${ageText(q.fact.extent.oldestAt, q.fact.asOf)}` : null)

/**
 * Named queues — a labelled, keyboard-reachable table on wider screens and one card per queue at phone width. Queues are never
 * summed into one number.
 */
export function QueueBoard({ queues, regionLabel }: { queues: readonly QueueView[]; regionLabel: string }) {
  return (
    <>
      <div
        className="hidden overflow-x-auto rounded-md border border-slate-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 md:block"
        tabIndex={0}
        role="region"
        aria-label={regionLabel}
        data-testid="queue-board"
      >
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <caption className="sr-only">{regionLabel}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-3 py-2 font-medium">Queue</th>
              <th scope="col" className="px-3 py-2 font-medium">Waiting now</th>
              <th scope="col" className="px-3 py-2 font-medium">Attention rule</th>
              <th scope="col" className="px-3 py-2 font-medium">Owner · source</th>
              <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Operate</span></th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => (
              <tr key={q.id} className="border-b border-slate-100 align-top last:border-b-0" data-testid="queue-row" data-queue-id={q.id} data-attention={q.attention.state}>
                <th scope="row" className="px-3 py-2.5 text-left font-medium text-slate-900">
                  {q.label}
                  {waitingSince(q) && <span className="mt-0.5 block text-[11px] font-normal text-slate-600">{waitingSince(q)}</span>}
                </th>
                <td className="px-3 py-2.5"><QueueValue queue={q} /></td>
                <td className="max-w-[260px] px-3 py-2.5 text-xs text-slate-600">{q.attention.rule}{q.fact.reason && q.fact.state !== 'TECHNICAL_OPERATIONAL' ? <span className="mt-1 block">{q.fact.reason}</span> : null}</td>
                <td className="max-w-[240px] px-3 py-2.5 text-xs text-slate-600">
                  <span className="block font-medium text-slate-800">{q.owner}</span>
                  {q.fact.source && <span className="block">{q.fact.source.authority}</span>}
                  {formatAsOf(q.fact.asOf) && <span className="block">As of {formatAsOf(q.fact.asOf)}</span>}
                </td>
                <td className="px-3 py-2.5 text-right">{q.operate && <OperateButton to={q.operate.route} label={q.operate.label} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden" aria-label={regionLabel} data-testid="queue-cards">
        {queues.map((q) => <QueueCard key={q.id} queue={q} />)}
      </ul>
    </>
  )
}

/** One queue as a card (the phone layout, and the Overview's compact queue list). */
export function QueueCard({ queue: q }: { queue: QueueView }) {
  return (
    <li className="space-y-2 rounded-md border border-slate-200 bg-white px-3 py-2.5" data-testid="management-fact" data-fact-id={q.id} data-attention={q.attention.state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-slate-900">{q.label}</p>
        <QueueValue queue={q} />
      </div>
      {waitingSince(q) && <p className="text-xs text-slate-700">{waitingSince(q)}</p>}
      <p className="text-[11px] leading-snug text-slate-600">{q.attention.rule}</p>
      {q.fact.state !== 'TECHNICAL_OPERATIONAL' && q.fact.reason && <p className="text-[11px] text-slate-600">{q.fact.reason}</p>}
      <p className="text-[11px] text-slate-500">Owner: {q.owner}</p>
      <FactMeta fact={{ ...q.fact, extent: null }} />
      {q.operate && <OperateButton to={q.operate.route} label={q.operate.label} />}
    </li>
  )
}

// ── read-model state ──────────────────────────────────────────────────────────────────────────────────────────────────

/** What a page shows while its read model is not an answer: never a number, never "0". */
export function ManagementStatus({ result, onRetry }: { result: ManagementResult; onRetry: () => void }) {
  switch (result.status) {
    case 'ok':
      return null
    case 'pending':
      return <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600" role="status" data-testid="management-pending">Reading live figures…</p>
    case 'denied':
      return (
        <p className="flex items-start gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white" data-testid="management-denied">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>You do not have access to this data. Your Corporate access does not include the capability this area needs.</span>
        </p>
      )
    case 'unauthenticated':
      return <p className="rounded-md border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-800" data-testid="management-unauthenticated">Your session has ended. Sign in again to see live figures.</p>
    default:
      return (
        <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="management-unavailable">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Live figures could not be read right now. Nothing is shown, and no figure is assumed zero.</span>
          </p>
          <button type="button" onClick={onRetry} className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 font-medium text-amber-950 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
          </button>
        </div>
      )
  }
}

/** Where these figures come from: the environment, the read time, and what they are not. */
export function EnvironmentNote({ environment, generatedAt }: { environment: string | null; generatedAt: string }) {
  const where = environment === 'staging' ? 'Staging' : environment === 'local' ? 'Local development' : `Unrecognised environment (${environment ?? 'unknown'})`
  return (
    <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950" data-testid="management-environment">
      <span className="font-semibold">{where}</span> · live figures read {formatAsOf(generatedAt)} — operational and technical facts, not certified Corporate results.
      Only governance records read as Actual; everything else says Live read or Technical (OD-CAMETRIC-022).
    </p>
  )
}

/** Measures that cannot be shown, each with its reason — kept visible, never as zero. */
export function UnavailableMeasures({ items }: { items: ReadonlyArray<{ id: string; label: string; reason: string }> }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white" aria-label="Measures that cannot be shown yet">
      {items.map((u) => (
        <li key={u.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-testid="unavailable-measure" data-measure-id={u.id}>
          <span className="text-sm font-medium text-slate-800">{u.label}</span>
          <span className="text-xs text-slate-600 sm:max-w-[60%] sm:text-right">{u.reason}</span>
        </li>
      ))}
    </ul>
  )
}
