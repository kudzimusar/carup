/**
 * RX-06 Trade — insight lenses on the trade graph desk.
 *
 * The three intelligence reads already existed in the API client but were never surfaced. They run
 * ON DEMAND only: choosing a lens fetches nothing; pressing its button asks CarUp's server once. Each
 * lens has its own loading, failed, refused and empty state, and renders exactly what came back —
 * redaction tokens are said in words, ids are monospace, confidence is the server's own figure.
 */
import { useState, type ReactNode } from 'react'
import { RotateCw, Sparkles } from 'lucide-react'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import { DeskPanel, DeskSegments, DeskState, Provenance, ReadFailureState } from './DeskPrimitives'
import { DESK_PRIMARY, DESK_SECONDARY } from './deskStyles'
import { humanize, plural, readFailureOf, shortRef, when, type ReadFailure } from './deskFormat'
import {
  LENS_COPY, confidencePct, parseLens, tokenText,
  type ContainerOpportunity, type DemandSignal, type LensResult, type RiskRow, type TradeGraphLensId, type TradeGraphModel,
} from './tradeGraphModel'

type LensState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: LensResult }
  | { status: 'shape' }
  | { status: 'failed'; failure: ReadFailure }

const IDLE: Record<TradeGraphLensId, LensState> = { demand: { status: 'idle' }, containers: { status: 'idle' }, risk: { status: 'idle' } }
const LENSES: ReadonlyArray<{ id: TradeGraphLensId; label: string }> = [
  { id: 'demand', label: LENS_COPY.demand.label },
  { id: 'containers', label: LENS_COPY.containers.label },
  { id: 'risk', label: LENS_COPY.risk.label },
]

export function TradeGraphLenses({ lenses }: { lenses: TradeGraphModel['lenses'] }) {
  const [active, setActive] = useState<TradeGraphLensId>('demand')
  const [state, setState] = useState<Record<TradeGraphLensId, LensState>>(IDLE)
  const current = state[active]

  const run = async (id: TradeGraphLensId) => {
    setState((s) => ({ ...s, [id]: { status: 'loading' } }))
    try {
      const parsed = parseLens(id, await lenses[id]())
      setState((s) => ({ ...s, [id]: parsed ? { status: 'ready', result: parsed } : { status: 'shape' } }))
    } catch (err) {
      setState((s) => ({ ...s, [id]: { status: 'failed', failure: readFailureOf(err) } }))
    }
  }

  return (
    <DeskPanel testId="tg-lenses" eyebrow="On demand" title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-carup-text-3" aria-hidden="true" />Insight lenses</span>}
      provenance={<Provenance kind="server" />}
      description="Each lens is computed by CarUp’s server from your organisation’s derived graph, only when you ask. Choosing a lens fetches nothing.">
      <DeskSegments testId="tg-lens-tab" label="Insight lens" items={LENSES} active={active} onChange={setActive} />
      <div className="mt-4 min-w-0" data-testid={`tg-lens-${active}`} data-lens-state={current.status}>
        <p className="text-sm leading-6 text-carup-text-2">{LENS_COPY[active].what}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={current.status === 'ready' ? DESK_SECONDARY : DESK_PRIMARY} onClick={() => { void run(active) }}
            disabled={current.status === 'loading'} data-testid="tg-lens-run">
            {current.status === 'ready' ? <><RotateCw className="h-4 w-4" aria-hidden="true" /> Ask again</> : current.status === 'loading' ? 'Asking CarUp’s server…' : `Compute ${LENS_COPY[active].label.toLowerCase()}`}
          </button>
        </div>
        <div className="mt-4 min-w-0">
          {current.status === 'loading' && <DeskState kind="loading" compact title={`Computing ${LENS_COPY[active].label.toLowerCase()}…`} />}
          {current.status === 'failed' && (
            <ReadFailureState failure={current.failure} what={LENS_COPY[active].label} onRetry={() => { void run(active) }} compact testId="tg-lens-failed"
              unavailableHint="The server answered “not found” (404): this lens is not enabled for this account in this environment." />
          )}
          {current.status === 'shape' && (
            <DeskState kind="failed" compact title="The answer had a shape this view does not recognise" testId="tg-lens-shape">
              Nothing is shown rather than guessing at what the server meant.
            </DeskState>
          )}
          {current.status === 'ready' && <LensBody result={current.result} />}
        </div>
      </div>
    </DeskPanel>
  )
}

function LensBody({ result }: { result: LensResult }) {
  const computed = when(result.freshness.computedAt)
  const header = (
    <div className="flex flex-wrap items-center gap-2" data-testid="tg-lens-freshness">
      <Provenance kind="server" label={`Computed by CarUp’s server · ${computed ?? 'time not returned'}`} />
      <span className="text-xs text-carup-text-3">{result.count !== null ? `${plural(result.count, 'result')} returned` : `${plural(result.rows.length, 'row')} in this answer`}</span>
    </div>
  )
  if (result.rows.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <DeskState kind="empty" compact title="Nothing to show for this lens" testId="tg-lens-empty">{LENS_COPY[result.lens].empty}</DeskState>
      </div>
    )
  }
  return (
    <div className="space-y-3" data-testid={`tg-lens-result-${result.lens}`}>
      {header}
      <ul className="divide-y divide-carup-line rounded-card border border-carup-line">
        {result.lens === 'demand' && result.rows.map((r, i) => <DemandRow key={i} row={r} />)}
        {result.lens === 'containers' && result.rows.map((r, i) => <ContainerRow key={r.containerId ?? i} row={r} />)}
        {result.lens === 'risk' && result.rows.map((r, i) => <RiskRowView key={r.orderId ?? i} row={r} />)}
      </ul>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-carup-text [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function Token({ value, fallback = 'Not returned' }: { value: string | null; fallback?: string }) {
  const t = tokenText(value)
  if (!t) return <span className="text-carup-text-3">{fallback}</span>
  return t.redacted
    ? <span className="text-carup-text-2" data-redacted="true">{t.text}</span>
    : <span className="font-mono text-[12.5px]">{t.text}</span>
}

function DemandRow({ row }: { row: DemandSignal }) {
  return (
    <li className="p-3 sm:p-4">
      <p className="text-sm font-semibold text-carup-text">
        {row.unmatchedCount !== null ? plural(row.unmatchedCount, 'unmatched order') : 'Unmatched orders (count not returned)'}
      </p>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Origin country">{row.country ?? <span className="text-carup-text-3">Not recorded</span>}</Fact>
        <Fact label="Product type">{row.productType ? humanize(row.productType) : <span className="text-carup-text-3">Not recorded</span>}</Fact>
        <Fact label="Latest order">{when(row.latestOrderAt) ?? <span className="text-carup-text-3">Not returned</span>}</Fact>
        <Fact label="Average confidence">{confidencePct(row.avgConfidence) ?? <span className="text-carup-text-3">Not returned</span>}</Fact>
      </dl>
      {(row.evidenceCount !== null || row.sourceReferenceCount !== null) && (
        <p className="mt-2 text-xs text-carup-text-3">
          Evidence: {row.evidenceCount !== null ? plural(row.evidenceCount, 'graph record') : 'not returned'}
          {row.sourceReferenceCount !== null ? ` · ${plural(row.sourceReferenceCount, 'source event')}` : ''}
        </p>
      )}
    </li>
  )
}

function ContainerRow({ row }: { row: ContainerOpportunity }) {
  return (
    <li className="p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-carup-text">Container <span className="font-mono text-[12.5px]">{shortRef(row.containerId, 12) ?? 'id not returned'}</span></p>
        <StatusChip tone="neutral">{humanize(row.status, 'Status not returned')}</StatusChip>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="From"><Token value={row.origin} /></Fact>
        <Fact label="To"><Token value={row.destination} /></Fact>
        <Fact label="Type">{row.containerType ? humanize(row.containerType) : <span className="text-carup-text-3">Not recorded</span>}</Fact>
        <Fact label="Available capacity">{row.availableCapacity !== null ? <span className="font-mono tabular-nums">{row.availableCapacity}</span> : <span className="text-carup-text-3">Not returned</span>} <span className="text-xs text-carup-text-3">(as recorded; unit not stated)</span></Fact>
        <Fact label="Coordinator"><Token value={row.coordinatorId} /></Fact>
        <Fact label="Confidence">{confidencePct(row.confidence) ?? <span className="text-carup-text-3">Not returned</span>}</Fact>
      </dl>
      <p className="mt-2 text-xs leading-5 text-carup-text-2">
        {row.matchedOrderCount !== null ? `${plural(row.matchedOrderCount, 'order')} on the same route that fit` : 'Matched orders not returned'}
        {row.matchedOrderIds.length > 0 && (
          <>: {row.matchedOrderIds.map((id, i) => <span key={id} className="font-mono text-[12px] text-carup-text">{i > 0 ? ', ' : ''}{shortRef(id, 10)}</span>)}</>
        )}
      </p>
    </li>
  )
}

function riskTone(level: string | null): StatusTone {
  const s = String(level || '').toUpperCase()
  if (s === 'CRITICAL' || s === 'HIGH') return 'danger'
  if (s === 'MEDIUM') return 'warning'
  return 'neutral'
}

function RiskRowView({ row }: { row: RiskRow }) {
  return (
    <li className="p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-carup-text">Order <span className="font-mono text-[12.5px]">{shortRef(row.orderId, 12) ?? 'id not returned'}</span>
          <span className="ml-2 font-normal text-carup-text-2">{humanize(row.status, 'status not returned')}</span></p>
        <StatusChip tone={riskTone(row.riskLevel)}>Risk: {humanize(row.riskLevel, 'not returned')}</StatusChip>
      </div>
      {row.blockers.length === 0
        ? <p className="mt-2 text-xs text-carup-text-2">No blockers are recorded next to this order.</p>
        : (
          <ul className="mt-2 space-y-1.5">
            {row.blockers.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs leading-5 text-carup-text-2">
                <StatusChip tone={riskTone(b.severity)}>{humanize(b.severity, 'Severity not returned')}</StatusChip>
                <span className="font-semibold text-carup-text">{humanize(b.type, 'Blocker')}</span>
                <span>{humanize(b.detail, '')}</span>
                <span className="text-carup-text-3">· from {humanize(b.sourceEntityType, 'a record')} <Token value={b.sourceEntityId} fallback="(id not returned)" /></span>
              </li>
            ))}
          </ul>
        )}
      {confidencePct(row.confidence) && <p className="mt-2 text-xs text-carup-text-3">Confidence as returned: {confidencePct(row.confidence)}</p>}
    </li>
  )
}
