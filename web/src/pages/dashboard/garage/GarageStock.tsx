import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Package, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  STOCK_STATE_LABEL,
  type CreatePartInput,
  type GaragePart,
  type StockListResponse,
  type StockPartResponse,
  type StockState,
} from '@/lib/garageBusiness'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'
import { PartFacts } from '@/components/garage/stock/PartFacts'
import { StockLedger } from '@/components/garage/stock/StockLedger'
import { CountStockForm, CreatePartForm, EditPartForm, ReceiveStockForm } from '@/components/garage/stock/StockForms'
import { STATE_FILTER_OPTIONS, STATE_TONE } from '@/components/garage/stock/stockPresentation'

const CHIPS: Array<{ key: 'out' | 'low' | 'uncounted' | 'unknown'; label: string }> = [
  { key: 'out', label: STOCK_STATE_LABEL.out },
  { key: 'low', label: STOCK_STATE_LABEL.low },
  { key: 'uncounted', label: STOCK_STATE_LABEL.uncounted },
  { key: 'unknown', label: STOCK_STATE_LABEL.unknown },
]

type StateFilter = 'all' | StockState
type PartAction = null | 'receive' | 'count' | 'edit'

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

/**
 * The garage's parts and stock, over the single parts master (GARAGE-1.0).
 *
 * Reading is for the whole workspace (garage admin and mechanic). Managing stock — adding a part,
 * receiving, counting, editing — is the garage ADMIN's, and the server enforces it: if a refusal comes
 * back its own message is shown. Every state word on this page is the server's `stock_state`; the page
 * never works out "low" or "out" from the numbers, and a quantity that is not on record is never a 0.
 */
export default function GarageStock() {
  const { fetchGarageStock, fetchGaragePart, createGaragePart, updateGaragePart, receiveGarageStock, countGarageStock } = useCarUpApi()
  const { user } = useAuth()
  const isAdmin = user?.active_tenant?.role === 'admin'

  const [stock, setStock] = useState<StockListResponse | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [notice, setNotice] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StockPartResponse | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [action, setAction] = useState<PartAction>(null)
  const selectedRef = useRef<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async (inactive: boolean, quiet = false): Promise<boolean> => {
    const seq = ++loadSeq.current
    if (!quiet) setState('loading')
    try {
      const res = await fetchGarageStock(inactive)
      if (!res || !Array.isArray(res.parts)) throw new Error('The stock response is incomplete')
      if (seq !== loadSeq.current) return true
      setStock(res); setLoadError(null); setState('ready')
      return true
    } catch (e) {
      if (seq === loadSeq.current && !quiet) { setState('error'); setLoadError(messageOf(e, 'Parts and stock could not be loaded')) }
      return false
    }
  }, [fetchGarageStock])

  useEffect(() => { void load(includeInactive) }, [load, includeInactive])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (stock?.parts || []).filter((p) => {
      if (stateFilter !== 'all' && p.stock_state !== stateFilter) return false
      if (term && !p.name.toLowerCase().includes(term) && !p.sku.toLowerCase().includes(term)) return false
      return true
    })
  }, [stock, search, stateFilter])

  const openPart = useCallback(async (id: string) => {
    setNotice(null)
    if (selectedRef.current === id) {
      selectedRef.current = null
      setSelectedId(null); setDetail(null); setAction(null); setDetailState('idle'); setDetailError(null)
      return
    }
    selectedRef.current = id
    setSelectedId(id); setDetail(null); setAction(null); setDetailState('loading'); setDetailError(null)
    try {
      const res = await fetchGaragePart(id)
      if (selectedRef.current !== id) return
      setDetail(res); setDetailState('idle')
    } catch (e) {
      if (selectedRef.current !== id) return
      setDetailState('error'); setDetailError(messageOf(e, 'The stock history could not be loaded'))
    }
  }, [fetchGaragePart])

  /** A stock change succeeded: show the part as the server now states it, then refresh the totals. */
  async function afterChange(res: StockPartResponse, message: string) {
    selectedRef.current = res.part.id
    setSelectedId(res.part.id); setDetail(res); setDetailState('idle'); setDetailError(null)
    setAction(null); setCreating(false)
    setNotice(message)
    const refreshed = await load(includeInactive, true)
    if (!refreshed) setNotice(`${message} The list could not be refreshed, so reload the page to see current totals.`)
  }

  async function createPart(input: CreatePartInput) {
    await afterChange(await createGaragePart(input), 'The part was added.')
  }
  async function receive(partId: string, body: { quantity: number; reason?: string; note?: string; idempotency_key: string }) {
    await afterChange(await receiveGarageStock(partId, body), 'The stock was recorded as received.')
  }
  async function count(partId: string, body: { counted_quantity: number; reason?: string; note?: string; idempotency_key: string }) {
    await afterChange(await countGarageStock(partId, body), 'The count was recorded.')
  }
  async function edit(partId: string, patch: Record<string, unknown>) {
    await afterChange(await updateGaragePart(partId, patch), 'The part was updated.')
  }

  function renderDetail(p: GaragePart) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4" data-testid="part-detail">
        <h3 className="font-semibold">Stock history</h3>
        <p className="text-sm text-gray-600">Every change to this quantity, newest first. History is a record and cannot be edited.</p>
        {detailState === 'loading' && (
          <div className="mt-3 flex items-center gap-2 text-sm" role="status">
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
            Loading the stock history…
          </div>
        )}
        {detailState === 'error' && (
          <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="part-detail-error">
            <p>{detailError}</p>
            <p className="mt-1">This is a loading problem, not a statement that the part has no history.</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => { selectedRef.current = null; void openPart(p.id) }}>Try again</Button>
          </div>
        )}
        {detail && detail.part.id === p.id && (
          <>
            <StockLedger movements={detail.movements} />
            {isAdmin && (
              <div className="mt-4" data-testid="part-admin-controls">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="min-h-11" aria-pressed={action === 'receive'} onClick={() => setAction(action === 'receive' ? null : 'receive')}>Receive stock</Button>
                  <Button variant="outline" className="min-h-11" aria-pressed={action === 'count'} onClick={() => setAction(action === 'count' ? null : 'count')}>Count stock</Button>
                  <Button variant="outline" className="min-h-11" aria-pressed={action === 'edit'} onClick={() => setAction(action === 'edit' ? null : 'edit')}>Edit part</Button>
                </div>
                {action === 'receive' && (
                  <ReceiveStockForm part={detail.part} onSubmit={(body) => receive(detail.part.id, body)} onCancel={() => setAction(null)} />
                )}
                {action === 'count' && (
                  <CountStockForm part={detail.part} onSubmit={(body) => count(detail.part.id, body)} onCancel={() => setAction(null)} />
                )}
                {action === 'edit' && (
                  <EditPartForm part={detail.part} onSubmit={(patch) => edit(detail.part.id, patch)} onCancel={() => setAction(null)} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className={SN_PAGE}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Parts and stock</h1>
          <p className="text-gray-500">What your garage has on the shelf, from its own counts</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button className="min-h-11" aria-expanded={creating} onClick={() => { setNotice(null); setCreating(!creating) }}>
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Add a part
            </Button>
          )}
          <Link to="/garage">
            <Button variant="outline" className="min-h-11"><ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />Workshop</Button>
          </Link>
        </div>
      </div>

      {!isAdmin && (
        <p className="text-sm text-gray-600" data-testid="stock-read-only-note">
          You can see the garage&apos;s parts and stock. Adding, receiving, counting and editing parts is done by the garage administrator.
        </p>
      )}

      {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800" data-testid="stock-notice">{notice}</div>}

      {isAdmin && creating && (
        <CreatePartForm onSubmit={createPart} onCancel={() => setCreating(false)} />
      )}

      {state === 'loading' && (
        <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span>Loading parts and stock…</span>
        </div>
      )}

      {state === 'error' && (
        <Card data-testid="stock-load-error"><CardContent className="p-6 text-center">
          <p className="font-semibold">Parts and stock could not be loaded</p>
          {loadError && <p className="text-sm text-gray-700 mt-1">{loadError}</p>}
          <p className="text-sm text-gray-500 mt-1">This is a loading problem, not a statement that you have no parts.</p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => { void load(includeInactive) }}>Try again</Button>
        </CardContent></Card>
      )}

      {state === 'ready' && stock && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Parts that need attention" data-testid="stock-summary">
            {CHIPS.map((chip) => {
              const value = stock.summary?.[chip.key]
              return (
                <Button
                  key={chip.key} variant={stateFilter === chip.key ? 'default' : 'outline'} className="min-h-11"
                  aria-pressed={stateFilter === chip.key} data-testid={`stock-chip-${chip.key}`}
                  onClick={() => setStateFilter(stateFilter === chip.key ? 'all' : chip.key)}
                >
                  <span>{chip.label}</span>
                  <span className="ml-2 font-semibold tabular-nums">{typeof value === 'number' ? value : 'Not available'}</span>
                </Button>
              )
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="stock-search" className="block text-sm font-medium mb-1">Search by name or SKU</label>
              <Input id="stock-search" placeholder="Name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="stock-state-filter" className="block text-sm font-medium mb-1">Stock state</label>
              <select id="stock-state-filter" className="w-full min-h-11 rounded-md border px-3" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
                {STATE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-3 min-h-11">
                <input id="stock-include-inactive" type="checkbox" className="h-5 w-5" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                <label htmlFor="stock-include-inactive" className="text-sm font-medium">Show inactive parts</label>
              </div>
            </div>
          </div>

          <section aria-labelledby="stock-list-heading">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 id="stock-list-heading" className="text-lg font-semibold">Parts</h2>
              <span className="text-sm text-gray-500" data-testid="stock-shown">{visible.length} of {stock.parts.length} shown</span>
            </div>

            {stock.parts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center" data-testid="stock-empty">
                <Package className="w-7 h-7 text-gray-300 mx-auto mb-2" aria-hidden="true" />
                <p className="font-medium">No parts are recorded yet</p>
                <p className="text-sm text-gray-500">{isAdmin ? 'Add a part with its opening quantity to start.' : 'The garage administrator adds parts.'}</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center" data-testid="stock-no-match">
                <p className="font-medium">No parts match these filters</p>
                <p className="text-sm text-gray-500">This reflects the stock that loaded, filtered by what you chose.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 border-y border-gray-200">
                {visible.map((p) => {
                  const open = selectedId === p.id
                  return (
                    <li key={p.id} className="py-4" data-testid="stock-part">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold break-words">{p.name}</h3>
                          <p className="text-xs text-gray-500 break-all">SKU {p.sku}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {!p.is_active && <Badge variant="outline">Inactive</Badge>}
                          <Badge className={STATE_TONE[p.stock_state]} data-testid={`stock-state-${p.id}`}>
                            {STOCK_STATE_LABEL[p.stock_state] ?? p.stock_state}
                          </Badge>
                        </div>
                      </div>
                      <PartFacts part={p} moneyVisible={stock.money_visible === true && p.money_visible !== false} />
                      <Button
                        variant="outline" className="mt-3 min-h-11" aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} stock history for ${p.name}`}
                        onClick={() => { void openPart(p.id) }}
                      >
                        {open ? 'Hide stock history' : 'Stock history'}
                      </Button>
                      {open && renderDetail(p)}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
