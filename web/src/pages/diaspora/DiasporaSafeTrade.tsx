/**
 * DiasporaSafeTrade — Phase 9 SafeTrade case LIST page (flag-gated, fail closed).
 *
 * When VITE_DIASPORA_SAFETRADE_UI_ENABLED !== 'true' it renders an explicit unavailable state and
 * fetches nothing. When ON it lists the viewer's SafeTrade cases (participant/tenant scoped server
 * side) with status/total/assurance-stage/dispute indicators and filters. SafeTrade is non-custodial,
 * sandbox-only — the assurance notice makes that explicit. Reuses existing layout/UI primitives.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { safeTradeUiEnabled } from '@/config/safeTradeFlag'
import { SafeTradeAssuranceNotice } from '@/components/diaspora/safetrade/SafeTradeAssuranceNotice'
import { designStateOf, formatMoney, isEscapeHatchState, stateLabel } from '@/components/diaspora/safetrade/safeTradeHelpers'
import type { SafeTradeTransaction } from '@/types'

function relationshipOf(txn: SafeTradeTransaction, viewerId: string | null): 'buyer' | 'seller' | 'other' {
  const v = (viewerId || '').toLowerCase()
  if (v && String(txn.buyer_id || '').toLowerCase() === v) return 'buyer'
  if (v && String(txn.seller_id || '').toLowerCase() === v) return 'seller'
  return 'other'
}

export default function DiasporaSafeTrade() {
  const flagEnabled = safeTradeUiEnabled()
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()
  const viewerId = user?.id || null

  const [cases, setCases] = useState<SafeTradeTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [relFilter, setRelFilter] = useState<'all' | 'buyer' | 'seller'>('all')
  const [disputedOnly, setDisputedOnly] = useState(false)
  const [orderFilter, setOrderFilter] = useState('')

  const canView = flagEnabled && isAuthenticated

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true); setError(null)
    try {
      const res = await api.getSafeTradeCases(statusFilter ? { status: statusFilter } : undefined)
      setCases(res?.data || [])
    } catch (err) {
      const code = (err as { code?: string })?.code
      setError(code === 'VALIDATION_FAILED' ? 'A tenant context is required to view SafeTrade cases.' : 'Could not load SafeTrade cases. Please retry.')
    } finally { setLoading(false) }
  }, [api, canView, statusFilter])

  // Depend on stable primitives (not `load`): useCarUpApi() returns a fresh object each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, statusFilter])

  const filtered = useMemo(() => cases.filter((c) => {
    const rel = relationshipOf(c, viewerId)
    if (relFilter !== 'all' && rel !== relFilter) return false
    if (disputedOnly && String(c.status).toUpperCase() !== 'DISPUTED') return false
    if (orderFilter && !String(c.import_order_id || '').toLowerCase().includes(orderFilter.toLowerCase())) return false
    return true
  }), [cases, viewerId, relFilter, disputedOnly, orderFilter])

  if (!flagEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="safetrade-unavailable">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>SafeTrade is not available</AlertTitle>
          <AlertDescription>SafeTrade is not available in this environment. It can be enabled by an administrator.</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (authLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-orange-600" data-testid="safetrade-auth-loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /></div>
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8" data-testid="safetrade-list-page">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck className="h-6 w-6 text-emerald-600" aria-hidden="true" /> SafeTrade</h1>
      </header>
      <div className="mb-4"><SafeTradeAssuranceNotice /></div>

      <section aria-label="Filters" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="st-status">Status</Label>
          <input id="st-status" className="w-full rounded border border-slate-300 p-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} placeholder="e.g. PAYMENT_HELD" data-testid="safetrade-filter-status" />
        </div>
        <div>
          <Label htmlFor="st-rel">Your role</Label>
          <select id="st-rel" className="w-full rounded border border-slate-300 p-2 text-sm" value={relFilter} onChange={(e) => setRelFilter(e.target.value as 'all' | 'buyer' | 'seller')} data-testid="safetrade-filter-rel">
            <option value="all">All</option><option value="buyer">As buyer</option><option value="seller">As seller</option>
          </select>
        </div>
        <div>
          <Label htmlFor="st-order">Linked import order</Label>
          <input id="st-order" className="w-full rounded border border-slate-300 p-2 text-sm" value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)} data-testid="safetrade-filter-order" />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm" htmlFor="st-disputed">
            <input id="st-disputed" type="checkbox" checked={disputedOnly} onChange={(e) => setDisputedOnly(e.target.checked)} data-testid="safetrade-filter-disputed" /> Disputed only
          </label>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive" data-testid="safetrade-list-error">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Unable to load</AlertTitle>
          <AlertDescription>{error} <Button size="sm" variant="outline" className="ml-2" onClick={() => void load()} data-testid="safetrade-list-retry">Retry</Button></AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="flex items-center gap-2 py-8 text-slate-600" data-testid="safetrade-list-loading"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading cases…</div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-slate-600" data-testid="safetrade-list-empty">No SafeTrade cases match your filters.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200" data-testid="safetrade-list">
          {filtered.map((c) => {
            const state = designStateOf(c)
            const disputed = String(c.status).toUpperCase() === 'DISPUTED'
            const rel = relationshipOf(c, viewerId)
            return (
              <li key={c.id} className="p-3" data-testid={`safetrade-row-${c.id}`}>
                <Link to={`/diaspora/safetrade/${encodeURIComponent(c.id)}`} className="block hover:bg-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Case {c.id.slice(0, 8)}</span>
                    <div className="flex items-center gap-2">
                      {disputed && <Badge variant="destructive" data-testid={`safetrade-row-${c.id}-disputed`}>Disputed</Badge>}
                      <Badge variant={isEscapeHatchState(state) ? 'destructive' : 'secondary'} data-testid={`safetrade-row-${c.id}-status`}>{stateLabel(state)}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span>Order {String(c.import_order_id).slice(0, 8)}</span>
                    <span>{formatMoney(c.total_amount, c.currency)}</span>
                    <span className="capitalize">You: {rel}</span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
