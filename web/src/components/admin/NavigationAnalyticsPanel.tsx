/**
 * Admin Navigation Analytics panel (Milestone F).
 *
 * Renders privacy-minimized navigation discovery / funnel aggregates from the
 * admin-only `GET /api/admin/analytics/navigation` endpoint (behind the existing
 * authorizeRole(['admin']) guard — this component only attaches the caller's
 * server-issued session; server authority enforces access). Every chart-like
 * metric is presented as an ACCESSIBLE TABLE (textual equivalent) — there are no
 * canvas/SVG-only charts. Truthful empty + error states are shown.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

interface Aggregates {
  ok: boolean
  range: { from: string; to: string }
  featureId: string | null
  totals: {
    events: number
    impressions: number
    selections: number
    destinationRenders: number
    blocked: number
    errors: number
  }
  selectionThroughRate: number
  platformSplit: Record<string, number>
  roleCategorySplit: Record<string, number>
  eventTypeSplit: Record<string, number>
  topSurfaces: Array<{ key: string; count: number }>
  zeroSelectionItems: string[]
}

function defaultFrom(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
}
function defaultTo(): string {
  return new Date().toISOString().slice(0, 10)
}

function SplitTable({ title, caption, data }: { title: string; caption: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1])
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">No data in range.</p>
      ) : (
        <table className="w-full text-sm border rounded-md" data-testid={`nav-analytics-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th scope="col" className="px-2 py-1">Category</th>
              <th scope="col" className="px-2 py-1 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t">
                <td className="px-2 py-1">{k}</td>
                <td className="px-2 py-1 text-right tabular-nums">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function NavigationAnalyticsPanel() {
  const { user, token } = useAuth()
  const authHeaders = useMemo<AuthHeaders>(() => {
    const h: AuthHeaders = {}
    if (token) h['x-session-token'] = token
    if (user?.id) h['x-user-id'] = user.id
    if (user?.role) h['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) h['x-tenant-id'] = user.active_tenant_id
    return h
  }, [user, token])

  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(defaultTo())
  const [feature, setFeature] = useState('')
  const [data, setData] = useState<Aggregates | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null); setPermissionDenied(false)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', new Date(`${from}T00:00:00Z`).toISOString())
      if (to) params.set('to', new Date(`${to}T23:59:59Z`).toISOString())
      if (feature.trim()) params.set('feature', feature.trim())
      const res = await apiRequest<Aggregates>({
        baseUrl: BASE_URL,
        path: `/admin/analytics/navigation?${params.toString()}`,
        authHeaders,
      })
      setData(res)
    } catch (err) {
      const msg = String((err as { message?: string })?.message || '')
      if (/forbidden|unauthorized|403|401/i.test(msg)) setPermissionDenied(true)
      else setError(msg || 'Failed to load navigation analytics')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [authHeaders, from, to, feature])

  // Defer the fetch to a microtask so `load()`'s initial setState runs just
  // AFTER the effect commits rather than synchronously within it (avoids the
  // cascading-render pattern flagged by react-hooks/set-state-in-effect).
  // Behaviour is unchanged: the fetch still starts on mount and whenever `load`
  // changes, and `loading` already defaults to true so first paint is identical.
  useEffect(() => { queueMicrotask(load) }, [load])

  const totals = data?.totals
  const noData = !!data && (totals?.events ?? 0) === 0

  return (
    <div data-testid="nav-analytics-panel" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
        <div>
          <Label htmlFor="nav-an-from" className="text-xs text-gray-500">From</Label>
          <Input id="nav-an-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label htmlFor="nav-an-to" className="text-xs text-gray-500">To</Label>
          <Input id="nav-an-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label htmlFor="nav-an-feature" className="text-xs text-gray-500">Feature id (optional)</Label>
          <Input id="nav-an-feature" value={feature} onChange={e => setFeature(e.target.value)} placeholder="e.g. product.marketplace" className="w-56" />
        </div>
        <Button variant="outline" size="sm" onClick={load} data-testid="nav-analytics-refresh">Apply</Button>
      </div>

      {loading && <div data-testid="nav-analytics-loading" className="flex items-center gap-2 text-gray-500 py-10 justify-center"><Spinner className="size-5" /> Loading analytics…</div>}
      {permissionDenied && <div data-testid="nav-analytics-denied" role="alert" className="text-red-700 bg-red-50 border border-red-100 rounded-md p-4">You do not have permission to view navigation analytics.</div>}
      {error && !permissionDenied && <div data-testid="nav-analytics-error" role="alert" className="text-red-700 bg-red-50 border border-red-100 rounded-md p-4">{error}</div>}
      {!loading && !error && !permissionDenied && noData && <div data-testid="nav-analytics-empty" className="text-gray-500 text-center py-10">No navigation analytics recorded for this range.</div>}

      {!loading && !error && !permissionDenied && data && !noData && totals && (
        <div className="space-y-5">
          {/* Funnel totals — accessible table */}
          <table className="w-full text-sm border rounded-md" data-testid="nav-analytics-totals">
            <caption className="sr-only">Navigation funnel totals for the selected range.</caption>
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th scope="col" className="px-2 py-1">Metric</th>
                <th scope="col" className="px-2 py-1 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t"><td className="px-2 py-1">Total events</td><td className="px-2 py-1 text-right tabular-nums">{totals.events}</td></tr>
              <tr className="border-t"><td className="px-2 py-1">Impressions</td><td className="px-2 py-1 text-right tabular-nums">{totals.impressions}</td></tr>
              <tr className="border-t"><td className="px-2 py-1">Selections</td><td className="px-2 py-1 text-right tabular-nums">{totals.selections}</td></tr>
              <tr className="border-t"><td className="px-2 py-1">Selection-through rate</td><td className="px-2 py-1 text-right tabular-nums">{(data.selectionThroughRate * 100).toFixed(1)}%</td></tr>
              <tr className="border-t"><td className="px-2 py-1">Destination renders</td><td className="px-2 py-1 text-right tabular-nums">{totals.destinationRenders}</td></tr>
              <tr className="border-t"><td className="px-2 py-1">Blocked attempts</td><td className="px-2 py-1 text-right tabular-nums">{totals.blocked}</td></tr>
              <tr className="border-t"><td className="px-2 py-1">Errors</td><td className="px-2 py-1 text-right tabular-nums">{totals.errors}</td></tr>
            </tbody>
          </table>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <SplitTable title="Platform split" caption="Event counts by platform." data={data.platformSplit} />
            <SplitTable title="Role split" caption="Event counts by coarse role category." data={data.roleCategorySplit} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Top surfaces</h3>
            {data.topSurfaces.length === 0 ? (
              <p className="text-xs text-gray-400">No surfaces in range.</p>
            ) : (
              <table className="w-full text-sm border rounded-md" data-testid="nav-analytics-top-surfaces">
                <caption className="sr-only">Most-used navigation surfaces.</caption>
                <thead><tr className="text-left text-xs text-gray-500"><th scope="col" className="px-2 py-1">Surface</th><th scope="col" className="px-2 py-1 text-right">Count</th></tr></thead>
                <tbody>
                  {data.topSurfaces.map(s => (
                    <tr key={s.key} className="border-t"><td className="px-2 py-1">{s.key}</td><td className="px-2 py-1 text-right tabular-nums">{s.count}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Low discovery — impressed but never selected</h3>
            {data.zeroSelectionItems.length === 0 ? (
              <p className="text-xs text-gray-400" data-testid="nav-analytics-zero-selection-empty">Every impressed item was selected at least once.</p>
            ) : (
              <ul className="text-sm list-disc pl-5 space-y-0.5" data-testid="nav-analytics-zero-selection">
                {data.zeroSelectionItems.map(id => <li key={id} className="text-gray-700">{id}</li>)}
              </ul>
            )}
          </div>

          <p className="text-xs text-gray-400">Range {data.range.from.slice(0, 10)} → {data.range.to.slice(0, 10)}. No personal data is collected; all metrics are aggregate counts over an enum-bounded taxonomy.</p>
        </div>
      )}
    </div>
  )
}
