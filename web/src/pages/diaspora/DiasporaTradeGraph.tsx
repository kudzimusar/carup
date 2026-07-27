/**
 * UI-10 — Diaspora Trade Graph dashboard (Issue #127).
 *
 * Turns the Phase 10 backend into a tenant-scoped product surface. Design constraints that shaped
 * this page, in order of importance:
 *
 *  1. Staleness is never hidden. The projection is a background process; if it is behind, a confident
 *     set of numbers is worse than no numbers. Every figure on the page is rendered underneath an
 *     explicit freshness statement, and the page says so in words, not just colour.
 *  2. Nothing here can leak participant data, because nothing here RECEIVES it. The three reads this
 *     page uses return counts, health and sanitized error strings only — no entity ids, no node
 *     payloads, no raw event bodies. That is a shape guarantee, not a redaction pass.
 *  3. The graph is derived, never authored. There is no edit affordance anywhere, and no client API
 *     method exists that could create one.
 *  4. The UI filter is not the security boundary. Every read is tenant-scoped server-side with RLS
 *     behind it; the page simply shows what the server was willing to return.
 *
 * Fail-closed: with VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED off (the default) this renders an explicit
 * unavailable state and fetches nothing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Activity, Boxes, Loader2, Lock, RefreshCw, ShieldAlert, Share2, Info,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  tradeGraphUiEnabled,
  tradeGraphAiInsightsEnabled,
  TRADE_GRAPH_AI_REDACTION_NOTICE,
  TRADE_GRAPH_STALE_NOTICE,
  TRADE_GRAPH_DERIVED_NOTICE,
  TRADE_GRAPH_HEALTH_PRESENTATION,
  formatLag,
  humanizeGraphType,
} from '@/config/tradeGraphFlag'
import type {
  TradeGraphSummary, TradeGraphDeadLetter, TradeGraphHealthState,
} from '@/types'

/** Tone → classes. Every tone also carries a distinct text label, so colour is never the only cue. */
const TONE_CLASSES: Record<'ok' | 'warn' | 'error' | 'neutral', string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
}

function HealthBadge({ health }: { health: TradeGraphHealthState }) {
  const presentation = TRADE_GRAPH_HEALTH_PRESENTATION[health] ?? TRADE_GRAPH_HEALTH_PRESENTATION.UNKNOWN
  return (
    <span
      data-testid="trade-graph-health-badge"
      data-health={health}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${TONE_CLASSES[presentation.tone]}`}
    >
      {/* Decorative: the accessible name is the visible label text beside it. */}
      <Activity className="h-3.5 w-3.5" aria-hidden="true" />
      {presentation.label}
    </span>
  )
}

function CountList({ title, items, testId, emptyLabel }: {
  title: string
  items: { type: string; count: number }[]
  testId: string
  emptyLabel: string
}) {
  return (
    <section aria-labelledby={`${testId}-heading`} className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 id={`${testId}-heading`} className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid={`${testId}-empty`}>{emptyLabel}</p>
      ) : (
        <ul className="space-y-1" data-testid={testId}>
          {items.map((item) => (
            <li key={item.type} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-700">{humanizeGraphType(item.type)}</span>
              <span className="font-mono font-medium text-slate-900 tabular-nums">{item.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function DiasporaTradeGraph() {
  const flagEnabled = tradeGraphUiEnabled()
  const aiEnabled = tradeGraphAiInsightsEnabled()
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()

  const [summary, setSummary] = useState<TradeGraphSummary | null>(null)
  const [deadLetters, setDeadLetters] = useState<TradeGraphDeadLetter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildNotice, setRebuildNotice] = useState<string | null>(null)

  // The rebuild control and the dead-letter panel are for platform operators. This is a display
  // decision only — the backend independently refuses both for anyone else, so hiding them here can
  // never be the thing that keeps them safe.
  const role = String(user?.role || '').toLowerCase()
  const isOperator = ['admin', 'platform_admin', 'super_admin'].includes(role)

  const canView = flagEnabled && isAuthenticated

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true); setError(null); setForbidden(false)
    try {
      const result = await api.getTradeGraphSummary()
      setSummary(result)
      if (isOperator) {
        try {
          setDeadLetters(await api.getTradeGraphDeadLetters(25))
        } catch {
          // A dead-letter read failing must not blank the whole dashboard — the summary is still
          // useful and still true. The panel shows its own error instead.
          setDeadLetters([])
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/forbidden|403|tenant context/i.test(message)) {
        setForbidden(true)
      } else if (/404|not enabled/i.test(message)) {
        setError('The Trade Graph service is not enabled in this environment.')
      } else {
        setError('Could not load the trade graph. Please retry.')
      }
    } finally {
      setLoading(false)
    }
  }, [api, canView, isOperator])

  // Depend on stable primitives: useCarUpApi() returns a fresh object every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, isOperator])

  const onRebuild = useCallback(async () => {
    setRebuilding(true); setRebuildNotice(null)
    try {
      const result = await api.rebuildTradeGraph({
        reason: 'operator_dashboard_rebuild',
        // Bind the request to the state the operator was looking at, so a double-click is one rebuild.
        idempotencyKey: `rebuild-${summary?.projection?.lastEventId ?? 'none'}-${summary?.counts?.totalNodes ?? 0}`,
      })
      setRebuildNotice(
        result?.status === 'RATE_LIMITED'
          ? 'A rebuild ran very recently. Please wait before requesting another.'
          : 'Rebuild requested. The projection will re-derive the graph from recorded events.',
      )
      await load()
    } catch {
      setRebuildNotice('The rebuild could not be started. It may already be running, or you may not be authorized.')
    } finally {
      setRebuilding(false)
    }
  }, [api, summary, load])

  const nodeItems = useMemo(() => summary?.counts?.nodes ?? [], [summary])
  const edgeItems = useMemo(() => summary?.counts?.edges ?? [], [summary])

  // ── Fail-closed: flag off ──────────────────────────────────────────────────
  if (!flagEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="trade-graph-unavailable">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>Trade Graph is not available</AlertTitle>
          <AlertDescription>
            The Trade Graph dashboard is not available in this environment. It can be enabled by an administrator.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!authLoading && !isAuthenticated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="trade-graph-signin">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription>Sign in to view your organisation&apos;s trade graph.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const health = summary?.health ?? 'UNKNOWN'
  const presentation = TRADE_GRAPH_HEALTH_PRESENTATION[health] ?? TRADE_GRAPH_HEALTH_PRESENTATION.UNKNOWN

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8" data-testid="trade-graph-page">
      <header className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
              <Share2 className="h-6 w-6 text-slate-700" aria-hidden="true" />
              Trade Graph
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              How your orders, stock, containers, shipments and SafeTrade cases connect to each other.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <HealthBadge health={health} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              data-testid="trade-graph-refresh"
            >
              {loading
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {/* Status is announced to assistive technology as it changes, not just rendered. */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="trade-graph-status-announcer">
        {loading ? 'Loading trade graph' : `Trade graph ${presentation.label}`}
      </div>

      {forbidden && (
        <Alert className="mb-6 border-amber-200 bg-amber-50" data-testid="trade-graph-forbidden">
          <ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden="true" />
          <AlertTitle>Not available for this account</AlertTitle>
          <AlertDescription>
            You do not have access to a trade graph for this organisation. If you believe this is wrong,
            ask an administrator to check your organisation membership.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="mb-6 border-red-200 bg-red-50" data-testid="trade-graph-error">
          <AlertTriangle className="h-4 w-4 text-red-700" aria-hidden="true" />
          <AlertTitle>Could not load the trade graph</AlertTitle>
          <AlertDescription>
            {error}{' '}
            <button type="button" className="underline" onClick={() => void load()}>Try again</button>
          </AlertDescription>
        </Alert>
      )}

      {/* Staleness is stated before any figure is shown, so numbers are never read as current by
          default. */}
      {summary?.stale && (
        <Alert className="mb-6 border-amber-200 bg-amber-50" data-testid="trade-graph-stale">
          <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
          <AlertTitle>{presentation.label} — figures may be out of date</AlertTitle>
          <AlertDescription>
            {TRADE_GRAPH_STALE_NOTICE}{' '}
            {summary.projection.lagSeconds != null && (
              <>The last event was processed {formatLag(summary.projection.lagSeconds)} ago.</>
            )}
          </AlertDescription>
        </Alert>
      )}

      {loading && !summary && (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-8 text-slate-600" data-testid="trade-graph-loading">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>Loading your trade graph…</span>
        </div>
      )}

      {summary && (
        <>
          {/* Totals */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="trade-graph-totals">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Entities</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900" data-testid="total-nodes">
                {summary.counts.totalNodes.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Relationships</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900" data-testid="total-edges">
                {summary.counts.totalEdges.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Projection lag</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900" data-testid="projection-lag">
                {formatLag(summary.projection.lagSeconds)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Unprocessed events</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900" data-testid="dead-letter-count">
                {summary.projection.deadLetterCount.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Empty state — distinct from "we could not load it", which is a different problem. */}
          {summary.counts.totalNodes === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center" data-testid="trade-graph-empty">
              <Boxes className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-medium text-slate-900">No trade activity yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                {summary.projection.hasCheckpoint
                  ? 'Your graph is up to date and there is nothing recorded yet. It will fill in as orders, stock and shipments are created.'
                  : 'The projection has not run for your organisation yet. Once it does, your graph will appear here.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CountList
                title="Entities by type"
                items={nodeItems}
                testId="node-counts"
                emptyLabel="No entities recorded yet."
              />
              <CountList
                title="Relationships by type"
                items={edgeItems}
                testId="edge-counts"
                emptyLabel="No relationships recorded yet."
              />
            </div>
          )}

          {/* Projection detail */}
          <section aria-labelledby="projection-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
            <h2 id="projection-heading" className="mb-3 text-sm font-semibold text-slate-900">Projection status</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="projection-status">
              <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
                <dt className="text-slate-600">Freshness</dt>
                <dd className="font-medium text-slate-900">{presentation.label}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
                <dt className="text-slate-600">Last processed event</dt>
                <dd className="font-medium text-slate-900">
                  {summary.projection.lastEventAt
                    ? new Date(summary.projection.lastEventAt).toLocaleString()
                    : 'None yet'}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
                <dt className="text-slate-600">Replays run</dt>
                <dd className="font-medium tabular-nums text-slate-900">{summary.projection.replayCount}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
                <dt className="text-slate-600">Replay required</dt>
                <dd className="font-medium text-slate-900">{summary.projection.replayRequired ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">{presentation.description}</p>
          </section>

          {/* Operator-only: dead letters + rebuild. Both are re-checked server-side. */}
          {isOperator && (
            <section aria-labelledby="operator-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="trade-graph-operator">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 id="operator-heading" className="text-sm font-semibold text-slate-900">Operator tools</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onRebuild()}
                  disabled={rebuilding}
                  data-testid="trade-graph-rebuild"
                >
                  {rebuilding
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Rebuild graph
                </Button>
              </div>

              {rebuildNotice && (
                <Alert className="mb-3 border-slate-200 bg-slate-50" data-testid="trade-graph-rebuild-notice">
                  <Info className="h-4 w-4 text-slate-700" aria-hidden="true" />
                  <AlertDescription>{rebuildNotice}</AlertDescription>
                </Alert>
              )}

              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Events that could not be processed
              </h3>
              {deadLetters.length === 0 ? (
                <p className="text-sm text-slate-600" data-testid="dead-letters-empty">
                  No unprocessed events.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="dead-letters">
                  {deadLetters.map((dl) => (
                    <li key={dl.id} className="rounded border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{dl.eventType}</Badge>
                        <span className="text-xs text-slate-500">
                          {dl.retryCount} retr{dl.retryCount === 1 ? 'y' : 'ies'}
                        </span>
                        {dl.createdAt && (
                          <span className="text-xs text-slate-500">{new Date(dl.createdAt).toLocaleString()}</span>
                        )}
                      </div>
                      {dl.errorMessage && (
                        <p className="mt-1 font-mono text-xs text-slate-700">{dl.errorMessage}</p>
                      )}
                      {/* Say WHY there is no payload, so an empty detail does not read as a bug. */}
                      <p className="mt-1 text-xs text-slate-500">{dl.payloadWithheldReason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* AI insight — separately flagged, and honest about what is sent. */}
          <section aria-labelledby="ai-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="trade-graph-ai">
            <h2 id="ai-heading" className="mb-2 text-sm font-semibold text-slate-900">AI insights</h2>
            {aiEnabled ? (
              <p className="text-sm text-slate-700" data-testid="trade-graph-ai-enabled">
                AI insights are available for this organisation.
              </p>
            ) : (
              <p className="text-sm text-slate-600" data-testid="trade-graph-ai-disabled">
                AI insights are not enabled in this environment.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500" data-testid="trade-graph-ai-notice">
              {TRADE_GRAPH_AI_REDACTION_NOTICE}
            </p>
          </section>

          <p className="mt-6 text-xs text-slate-500" data-testid="trade-graph-derived-notice">
            {TRADE_GRAPH_DERIVED_NOTICE}
          </p>
        </>
      )}
    </div>
  )
}
