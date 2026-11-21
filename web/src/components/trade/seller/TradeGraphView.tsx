/**
 * RX-06 Trade — the trade graph desk (unified presentation of /diaspora/trade-graph).
 *
 *   ink desk header: staleness FIRST, then one pulse line (health · entities · relationships · lag ·
 *   unprocessed events) → the relationship view (an order-centred map of the returned counts) →
 *   on-demand insight lenses → projection + last rebuild → operator tools → AI honesty notices.
 *
 * Fed by DiasporaTradeGraph's own state and handlers. Every figure is a count the summary returned;
 * the graph is derived, never authored, so there is no edit affordance anywhere.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowRight, Info, RefreshCw, Share2, Wrench } from 'lucide-react'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import {
  TRADE_GRAPH_AI_REDACTION_NOTICE, TRADE_GRAPH_DERIVED_NOTICE, TRADE_GRAPH_HEALTH_PRESENTATION, TRADE_GRAPH_STALE_NOTICE,
  formatLag, humanizeGraphType,
} from '@/config/tradeGraphFlag'
import type { TradeGraphSummary } from '@/types'
import { DeskHeader, DeskNotice, DeskPanel, DeskPulse, DeskState, Provenance, ReadFailureState } from './DeskPrimitives'
import { DESK_EYEBROW, DESK_INK_SECONDARY, DESK_PRIMARY, DESK_SECONDARY } from './deskStyles'
import { humanize, plural, when, type ReadFailure } from './deskFormat'
import { TradeGraphLenses } from './TradeGraphLenses'
import { relationshipView, type RelationshipLane, type TradeGraphModel } from './tradeGraphModel'

const PAGE = 'mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8'

function healthTone(health: string): StatusTone {
  if (health === 'HEALTHY') return 'info'
  if (health === 'DEGRADED') return 'warning'
  if (health === 'STALLED') return 'danger'
  return 'neutral'
}

export function TradeGraphView({ model }: { model: TradeGraphModel }) {
  if (model.authLoading) {
    return <div className={PAGE}><DeskState kind="loading" title="Opening your trade graph…" testId="tg-loading" /></div>
  }
  if (!model.flagEnabled) {
    return (
      <div className={PAGE}>
        <DeskState kind="unavailable" title="Trade Graph is not available in this environment" testId="tg-unavailable">
          The Trade Graph dashboard is switched off here, so nothing was fetched. It can be enabled by an administrator.
        </DeskState>
      </div>
    )
  }
  if (!model.isAuthenticated) {
    return (
      <div className={PAGE}>
        <DeskState kind="signin" title="Sign in to see your organisation’s trade graph" testId="tg-signin"
          action={<Link to="/login" className={DESK_PRIMARY}>Sign in</Link>}>
          The graph is scoped to the organisation you trade for.
        </DeskState>
      </div>
    )
  }

  const { summary } = model
  const health = summary?.health ?? 'UNKNOWN'
  const presentation = TRADE_GRAPH_HEALTH_PRESENTATION[health] ?? TRADE_GRAPH_HEALTH_PRESENTATION.UNKNOWN

  return (
    <div className={PAGE} data-testid="tg-desk">
      <div role="status" aria-live="polite" className="sr-only" data-testid="tg-announcer">
        {model.loading ? 'Loading trade graph' : `Trade graph ${presentation.label}`}
      </div>

      <DeskHeader
        testId="tg-header"
        eyebrow="Trade · Trade graph"
        title="Trade graph"
        description="How your orders, stock, containers, shipments and SafeTrade cases connect — derived by CarUp from recorded events, never drawn by hand."
        meta={summary?.stale ? <StaleNotice summary={summary} label={presentation.label} /> : undefined}
        actions={(
          <button type="button" className={DESK_INK_SECONDARY} onClick={model.onRefresh} disabled={model.loading} data-testid="tg-refresh">
            <RefreshCw className={`h-4 w-4 ${model.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /> {model.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        pulse={summary ? (
          <DeskPulse testId="tg-pulse" scope="Your organisation · derived graph" items={[
            { label: 'projection', value: presentation.label, testId: 'tg-pulse-health' },
            { label: summary.counts.totalNodes === 1 ? 'entity' : 'entities', value: summary.counts.totalNodes.toLocaleString('en-GB'), testId: 'tg-pulse-nodes' },
            { label: summary.counts.totalEdges === 1 ? 'relationship' : 'relationships', value: summary.counts.totalEdges.toLocaleString('en-GB'), testId: 'tg-pulse-edges' },
            { label: 'projection lag', value: summary.projection.lagSeconds == null ? 'not known' : formatLag(summary.projection.lagSeconds), testId: 'tg-pulse-lag' },
            { label: 'unprocessed events', value: summary.projection.deadLetterCount.toLocaleString('en-GB'), testId: 'tg-pulse-dead' },
          ]} />
        ) : undefined}
      />

      <div className="mt-6 space-y-6">
        {!summary && model.failure && <SummaryFailure failure={model.failure} onRetry={model.onRefresh} />}
        {!summary && !model.failure && <DeskState kind="loading" title="Loading your trade graph…" testId="tg-summary-loading" />}

        {summary && model.failure && (
          <DeskNotice tone="warning" testId="tg-refresh-failed">
            The latest refresh did not complete, so this is the summary CarUp returned before.{model.failure.message ? ` The server said: “${model.failure.message}”` : ''}
          </DeskNotice>
        )}

        {summary && (
          <>
            {summary.counts.totalNodes === 0 ? <EmptyGraph summary={summary} role={model.role} /> : <RelationshipMap summary={summary} />}
            <TradeGraphLenses lenses={model.lenses} />
            <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
              <ProjectionPanel summary={summary} />
              {model.isOperator && <OperatorPanel model={model} />}
            </div>
            <DeskPanel testId="tg-ai" eyebrow="Separately switched" title="AI insights">
              <p className="text-sm text-carup-text" data-testid={model.aiEnabled ? 'tg-ai-enabled' : 'tg-ai-disabled'}>
                {model.aiEnabled ? 'AI insights are available for this organisation.' : 'AI insights are not enabled in this environment.'}
              </p>
              <p className="mt-2 text-xs leading-5 text-carup-text-2" data-testid="tg-ai-notice">{TRADE_GRAPH_AI_REDACTION_NOTICE}</p>
            </DeskPanel>
            <p className="flex items-start gap-2 text-xs leading-5 text-carup-text-2" data-testid="tg-derived-notice">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-carup-text-3" aria-hidden="true" />{TRADE_GRAPH_DERIVED_NOTICE}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function StaleNotice({ summary, label }: { summary: TradeGraphSummary; label: string }) {
  return (
    <div role="alert" data-testid="tg-stale" className="flex max-w-2xl items-start gap-2 rounded-control border border-white/25 bg-white/10 px-3 py-2.5 text-sm leading-6 text-white">
      <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-carup-raw-orange-signal" aria-hidden="true" />
      <span>
        <strong className="font-semibold">{label} — figures may be out of date.</strong> {TRADE_GRAPH_STALE_NOTICE}
        {summary.projection.lagSeconds != null && <> The last event was processed {formatLag(summary.projection.lagSeconds)} ago.</>}
      </span>
    </div>
  )
}

function SummaryFailure({ failure, onRetry }: { failure: ReadFailure; onRetry: () => void }) {
  if (failure.kind === 'denied' && /tenant context/i.test(failure.message)) {
    return (
      <DeskState kind="denied" testId="tg-no-organisation" title="Your trade graph needs an organisation">
        The trade graph is drawn for one organisation (a CarUp tenant) at a time. This account is signed in without an organisation selected, so there is no graph to scope — nothing is wrong with your records and nothing was hidden. If you trade for a business on CarUp, ask its administrator to add you to that organisation.
        <span className="mt-2 block text-xs text-carup-text-3">The server said: <q>{failure.message}</q></span>
      </DeskState>
    )
  }
  return (
    <ReadFailureState failure={failure} what="Your trade graph" onRetry={onRetry} testId="tg-failure"
      deniedHint="You do not have access to a trade graph for this organisation. If you believe this is wrong, ask an administrator to check your organisation membership."
      unavailableHint="The Trade Graph service is not enabled in this environment." />
  )
}

function EmptyGraph({ summary, role }: { summary: TradeGraphSummary; role: string }) {
  const r = role.toLowerCase()
  return (
    <DeskState kind="empty" testId="tg-empty" title="No trade activity yet"
      action={(
        <>
          {(r === 'dealer' || r === 'admin') && <Link to="/diaspora/stock" className={DESK_SECONDARY}>Open your stock desk</Link>}
          {(r === 'owner' || r === 'admin') && <Link to="/diaspora/imports/new" className={DESK_SECONDARY}>Start an import</Link>}
        </>
      )}>
      {summary.projection.hasCheckpoint
        ? 'Your graph is up to date and nothing is recorded yet. It fills in as orders, stock, quotes, shipments and SafeTrade cases are created.'
        : 'The projection has not run for your organisation yet. Once it does, your graph will appear here.'}
    </DeskState>
  )
}

/* ───────────────────────── relationship view ───────────────────────── */

function NodeChip({ type, count }: { type: string; count: number | null }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-2 rounded-control border border-carup-line bg-carup-bg-surface px-3 py-2">
      <span className="min-w-0 text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{type.split(' / ').map(humanizeGraphType).join(' / ')}</span>
      <span className="shrink-0 font-mono text-sm tabular-nums text-carup-text-2">{count === null ? <span className="font-sans text-xs text-carup-text-3">count not returned</span> : count.toLocaleString('en-GB')}</span>
    </span>
  )
}

function Connector({ lane }: { lane: RelationshipLane }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-carup-text-2 lg:flex-1">
      <span aria-hidden="true" className="hidden h-px min-w-4 flex-1 bg-carup-line-strong lg:block" />
      <span className="rounded-full bg-carup-bg-raised px-2 py-0.5 font-semibold text-carup-text ring-1 ring-carup-line">
        {humanize(lane.edgeType)} <span className="font-mono tabular-nums text-carup-text-2">{lane.count.toLocaleString('en-GB')}</span>
      </span>
      <ArrowRight aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-carup-text-3 lg:block" />
      <ArrowDown aria-hidden="true" className="h-4 w-4 shrink-0 text-carup-text-3 lg:hidden" />
    </span>
  )
}

const laneText = (l: RelationshipLane) =>
  `${l.from.split(' / ').map(humanizeGraphType).join(' / ')} → ${humanizeGraphType(l.to)}: ${l.count.toLocaleString('en-GB')} (${humanize(l.edgeType)})`

function RelationshipMap({ summary }: { summary: TradeGraphSummary }) {
  const view = relationshipView(summary.counts)
  const lanes = [...view.into, ...view.outOf, ...view.other]
  return (
    <DeskPanel testId="tg-relationships" eyebrow="Counts as returned · edge meaning from CarUp’s graph rules"
      title={<span className="inline-flex items-center gap-2"><Share2 className="h-4 w-4 text-carup-text-3" aria-hidden="true" />How your trade connects</span>}
      provenance={<Provenance kind="derived" />}
      description="Each line is a kind of relationship the projection derived, with how many it holds. Types with nothing recorded are left out rather than drawn as zero.">
      {view.hub && (
        <div className="grid min-w-0 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(9rem,11rem)_minmax(0,1fr)] lg:gap-4" data-testid="tg-hub-map">
          <ul aria-label="Relationships into buyer orders" className="min-w-0 space-y-3">
            {view.into.map((l) => (
              <li key={l.edgeType} data-testid={`tg-lane-${l.edgeType}`} aria-label={laneText(l)} className="flex min-w-0 flex-col items-start gap-1.5 lg:flex-row lg:items-center lg:gap-2">
                <NodeChip type={l.from} count={l.fromCount} />
                <Connector lane={l} />
              </li>
            ))}
          </ul>
          <div data-testid="tg-hub" className="rounded-card bg-carup-raw-ink px-4 py-5 text-center text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Every trade runs through</p>
            <p className="mt-1 text-base font-semibold">{humanizeGraphType(view.hub.type)}</p>
            <p className="mt-1 font-mono text-3xl font-bold tabular-nums">{view.hub.count === null ? '—' : view.hub.count.toLocaleString('en-GB')}</p>
            {view.hub.count === null && <p className="mt-1 text-xs text-white/70">count not returned</p>}
          </div>
          <ul aria-label="Relationships out of buyer orders" className="min-w-0 space-y-3">
            {view.outOf.map((l) => (
              <li key={l.edgeType} data-testid={`tg-lane-${l.edgeType}`} aria-label={laneText(l)} className="flex min-w-0 flex-col items-start gap-1.5 lg:flex-row lg:items-center lg:gap-2">
                <Connector lane={l} />
                <NodeChip type={l.to} count={l.toCount} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.other.length > 0 && (
        <div className={view.hub ? 'mt-6 border-t border-carup-line pt-4' : ''}>
          <p className={DESK_EYEBROW}>{view.hub ? 'Other relationships' : 'Relationships'}</p>
          <ul className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
            {view.other.map((l) => (
              <li key={l.edgeType} data-testid={`tg-lane-${l.edgeType}`} aria-label={laneText(l)} className="flex min-w-0 flex-col items-start gap-1.5 rounded-control bg-carup-bg-surface p-3">
                <NodeChip type={l.from} count={l.fromCount} />
                <Connector lane={l} />
                <NodeChip type={l.to} count={l.toCount} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {lanes.length === 0 && (
        <p className="mt-4 text-sm text-carup-text-2" data-testid="tg-no-relationships">Entities are recorded, but no relationships between them are derived yet.</p>
      )}

      {view.unlinked.length > 0 && (
        <div className="mt-5" data-testid="tg-unlinked">
          <p className="text-xs font-semibold text-carup-text-2">Recorded, with no relationship in this read</p>
          <div className="mt-2 flex flex-wrap gap-2">{view.unlinked.map((n) => <NodeChip key={n.type} type={n.type} count={n.count} />)}</div>
        </div>
      )}

      <div className="mt-5 space-y-1.5 text-xs leading-5 text-carup-text-2">
        {view.ownership !== null && (
          <p data-testid="tg-ownership">
            <span className="font-semibold text-carup-text">Ownership links (belongs to tenant): <span className="font-mono">{view.ownership.toLocaleString('en-GB')}</span></span> — each ties a record to your organisation{view.tenantNodes !== null ? ` (${plural(view.tenantNodes, 'organisation record')})` : ''}. Not drawn, so the map stays readable.
          </p>
        )}
        {view.unmapped.length > 0 && (
          <ul data-testid="tg-unmapped">
            {view.unmapped.map((e) => (
              <li key={e.type}><span className="font-mono">{e.type}</span>: <span className="font-mono">{e.count.toLocaleString('en-GB')}</span> — meaning not mapped in this view (counted by the server, shown as returned).</li>
            ))}
          </ul>
        )}
      </div>

      <details className="mt-4 rounded-control bg-carup-bg-surface p-3 text-sm" data-testid="tg-edges-text">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">Every count as text</summary>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-carup-text-2">Relationships</p>
            <ul className="mt-1 space-y-1 text-carup-text">
              {lanes.map((l) => <li key={l.edgeType}>{laneText(l)}</li>)}
              {view.ownership !== null && <li>Records → organisation: {view.ownership.toLocaleString('en-GB')} (Belongs to tenant)</li>}
              {view.unmapped.map((e) => <li key={e.type}>{e.type}: {e.count.toLocaleString('en-GB')} (meaning not mapped)</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-carup-text-2">Entities by type</p>
            <ul className="mt-1 space-y-1 text-carup-text" data-testid="tg-node-counts">
              {summary.counts.nodes.filter((n) => Number(n.count) > 0).map((n) => (
                <li key={n.type}>{humanizeGraphType(n.type)}: {Number(n.count).toLocaleString('en-GB')}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </DeskPanel>
  )
}

/* ───────────────────────── projection + operator ───────────────────────── */

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-carup-text-3">{label}</dt>
          <dd className="mt-0.5 font-medium text-carup-text [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ProjectionPanel({ summary }: { summary: TradeGraphSummary }) {
  const p = summary.projection
  const presentation = TRADE_GRAPH_HEALTH_PRESENTATION[summary.health] ?? TRADE_GRAPH_HEALTH_PRESENTATION.UNKNOWN
  const r = summary.lastRebuild
  return (
    <DeskPanel testId="tg-projection" eyebrow="How fresh this is" title="Projection"
      provenance={<StatusChip tone={healthTone(summary.health)}>{presentation.label}</StatusChip>}
      description={presentation.description}>
      <Facts items={[
        ['Last processed event', when(p.lastEventAt) ?? 'None yet'],
        ['Projection lag', p.lagSeconds == null ? 'Not known' : formatLag(p.lagSeconds)],
        ['Unprocessed events', p.deadLetterCount.toLocaleString('en-GB')],
        ['Checkpoint', p.hasCheckpoint ? 'Recorded' : 'Not yet — the projection has not run'],
        ['Replays run', p.replayCount.toLocaleString('en-GB')],
        ['Replay required', p.replayRequired ? 'Yes' : 'No'],
        ['Projection version', p.projectionVersion ? <span className="font-mono text-[12.5px]">{p.projectionVersion}</span> : 'Not recorded'],
        ['Status updated', when(p.updatedAt) ?? 'Not recorded'],
      ]} />
      <div className="mt-4 border-t border-carup-line pt-4" data-testid="tg-last-rebuild">
        <p className="text-xs font-semibold text-carup-text-2">Last rebuild</p>
        {!r ? (
          <p className="mt-1 text-sm text-carup-text-2">No rebuild is recorded for your organisation.</p>
        ) : (
          <div className="mt-2 space-y-3">
            <StatusChip tone={/FAIL/i.test(r.status) ? 'warning' : 'neutral'}>{humanize(r.status)}</StatusChip>
            <Facts items={[
              ['Requested', when(r.requested_at) ?? 'Not recorded'],
              ['Completed', when(r.completed_at) ?? 'Not recorded'],
              ['Events processed', r.events_processed ?? 'Not recorded'],
              ['Events failed', r.events_failed ?? 'Not recorded'],
              ['Entities rebuilt', r.nodes_rebuilt ?? 'Not recorded'],
              ['Relationships rebuilt', r.edges_rebuilt ?? 'Not recorded'],
              ['Reason', r.reason ? humanize(r.reason) : 'Not recorded'],
            ]} />
          </div>
        )}
      </div>
    </DeskPanel>
  )
}

function OperatorPanel({ model }: { model: TradeGraphModel }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <DeskPanel testId="tg-operator" eyebrow="Platform operators" title={<span className="inline-flex items-center gap-2"><Wrench className="h-4 w-4 text-carup-text-3" aria-hidden="true" />Operator tools</span>}
      provenance={<Provenance kind="recorded" label="The server re-checks both" />}>
      <div className="rounded-control bg-carup-bg-surface p-3">
        <p className="text-sm font-semibold text-carup-text">Rebuild the graph</p>
        <p className="mt-1 text-xs leading-5 text-carup-text-2">Re-derives this organisation’s graph from the recorded event outbox. It is rate-limited and audited; it never edits a record.</p>
        {!confirming ? (
          <button type="button" className={`${DESK_SECONDARY} mt-3`} onClick={() => setConfirming(true)} disabled={model.rebuilding} data-testid="tg-rebuild">
            {model.rebuilding ? 'Rebuilding…' : 'Rebuild graph…'}
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="tg-rebuild-confirm">
            <button type="button" className={DESK_PRIMARY} data-testid="tg-rebuild-now" onClick={() => { setConfirming(false); model.onRebuild() }}>Rebuild now</button>
            <button type="button" className={DESK_SECONDARY} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
        {model.rebuildNotice && <div className="mt-3"><DeskNotice testId="tg-rebuild-notice">{model.rebuildNotice}</DeskNotice></div>}
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-carup-text-2">Events that could not be processed</p>
        <div className="mt-2">
          {model.deadLettersUnreadable ? (
            <DeskState kind="failed" compact testId="tg-dead-letters-unavailable" title="The unprocessed-event check could not be run" onRetry={model.onRefresh}>
              This is not confirmation that the pipeline is clear.
            </DeskState>
          ) : model.deadLetters.length === 0 ? (
            <p className="text-sm text-carup-text-2" data-testid="tg-dead-letters-empty">No unprocessed events.</p>
          ) : (
            <ul className="space-y-2" data-testid="tg-dead-letters">
              {model.deadLetters.map((dl) => (
                <li key={dl.id} className="rounded-control border border-carup-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-carup-text">{dl.eventType}</span>
                    <span className="text-xs text-carup-text-3">{plural(dl.retryCount, 'retry', 'retries')}</span>
                    {when(dl.createdAt) && <span className="text-xs text-carup-text-3">first seen {when(dl.createdAt)}</span>}
                    {when(dl.lastRetryAt) && <span className="text-xs text-carup-text-3">last retried {when(dl.lastRetryAt)}</span>}
                  </div>
                  {dl.errorMessage && <p className="mt-1 font-mono text-xs text-carup-text-2 [overflow-wrap:anywhere]">{dl.errorMessage}</p>}
                  <p className="mt-1 text-xs text-carup-text-3">{dl.payloadWithheldReason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DeskPanel>
  )
}
