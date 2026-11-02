import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  formatMoney, newIdempotencyKey, STOCK_STATE_LABEL, type GaragePart, type PartUsage, type StockState,
} from '@/lib/garageBusiness'
import { dateTimeLabel, hubShowsMoney, isAllowed } from '@/lib/garageWorkspace'
import { FormError, HubSection, INPUT_CLASS, ScopedError, type HubPanelProps } from './hubUi'

/** Only a part with a known, counted quantity can be taken from the shelf. */
const USABLE: StockState[] = ['in_stock', 'low']

const WHY_NOT: Record<StockState, string> = {
  in_stock: '', low: '',
  out: 'Out of stock — it has to be received before it can be used.',
  unknown: 'The quantity is unknown — it has to be counted before it can be used.',
  uncounted: 'It has not been counted against the shelf yet — count it before using it.',
}

const partLabel = (p: GaragePart) => `${p.name} (${p.sku})`

function ReverseUsageForm({ usage, busy, run, onDone }: {
  usage: PartUsage
  busy: boolean
  run: HubPanelProps['run']
  onDone: () => void
}) {
  const { reverseGaragePartUsage } = useCarUpApi()
  // one key per time this form is opened: a retry of the same reversal cannot return the part twice
  const [key] = useState(() => newIdempotencyKey())
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-3" data-testid="reverse-usage-form">
      <label htmlFor={`reverse-reason-${usage.id}`} className="block text-sm font-medium">Why is this being reversed?</label>
      <input
        id={`reverse-reason-${usage.id}`} value={reason} className={INPUT_CLASS} data-testid="reverse-usage-reason"
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="text-xs text-gray-500">Reversing puts the quantity back in stock and keeps the original entry on record.</p>
      <FormError message={problem} testId="reverse-usage-error" />
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="submit-reverse-usage"
          onClick={async () => {
            if (!reason.trim()) { setProblem('Give a reason.'); return }
            setProblem(null)
            const ok = await run('parts', () => reverseGaragePartUsage(usage.id, { reason: reason.trim(), idempotency_key: key }), 'Reversed. The quantity is back in stock.')
            if (ok) onDone()
          }}
        >
          Reverse this usage
        </Button>
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={onDone}>Keep it</Button>
      </div>
    </div>
  )
}

function UsePartForm({ hub, busy, run, onDone }: Pick<HubPanelProps, 'hub' | 'busy' | 'run'> & { onDone: () => void }) {
  const { fetchGarageStock, useGaragePartOnJob: recordPartUsage } = useCarUpApi()
  // generated ONCE when the form opens; a retry after a failure sends the same key
  const [key] = useState(() => newIdempotencyKey())
  const [stock, setStock] = useState<{ state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; parts: GaragePart[] }>({ state: 'loading' })
  const records = hub.service_records
  const [recordId, setRecordId] = useState(records.length === 1 ? records[0].id : '')
  const [partId, setPartId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [problem, setProblem] = useState<string | null>(null)

  // Stock is fetched when the form opens, not with the page.
  useEffect(() => {
    let mounted = true
    fetchGarageStock()
      .then((res) => { if (mounted) setStock({ state: 'ready', parts: res.parts.filter((p) => p.is_active) }) })
      .catch((e: unknown) => {
        if (mounted) setStock({ state: 'error', message: e instanceof Error ? e.message : 'Stock could not be loaded.' })
      })
    return () => { mounted = false }
  }, [fetchGarageStock])

  const parts = stock.state === 'ready' ? stock.parts : []
  const usable = parts.filter((p) => USABLE.includes(p.stock_state))
  const unusable = parts.filter((p) => !USABLE.includes(p.stock_state))

  async function submit() {
    if (!recordId) { setProblem('Choose which piece of work the part was used on.'); return }
    if (!partId) { setProblem('Choose the part.'); return }
    if (!/^[1-9]\d*$/.test(quantity.trim())) { setProblem('The quantity must be a whole number, at least 1.'); return }
    setProblem(null)
    const ok = await run('parts', () => recordPartUsage(recordId, { part_id: partId, quantity: Number(quantity), idempotency_key: key }), 'Part recorded against this job.')
    if (ok) onDone()
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4" data-testid="use-part-form">
      <p className="font-medium">Use a part on this job</p>

      {stock.state === 'loading' && <p className="text-sm text-gray-600" role="status">Loading your stock…</p>}
      {stock.state === 'error' && (
        <p className="text-sm text-red-800 rounded-lg bg-red-50 p-3" role="alert" data-testid="stock-error">
          Your stock could not be loaded: {stock.message}
        </p>
      )}

      {stock.state === 'ready' && (
        <>
          <div>
            <label htmlFor="part-record" className="block text-sm font-medium mb-1">Used on</label>
            <select id="part-record" value={recordId} onChange={(e) => setRecordId(e.target.value)} className={INPUT_CLASS} data-testid="part-record">
              <option value="">Choose the piece of work</option>
              {records.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {`Work ${i + 1}: ${(r.work_performed || 'no description').slice(0, 60)}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="part-select" className="block text-sm font-medium mb-1">Part</label>
            <select id="part-select" value={partId} onChange={(e) => setPartId(e.target.value)} className={INPUT_CLASS} data-testid="part-select">
              <option value="">Choose a part</option>
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {partLabel(p)} — {STOCK_STATE_LABEL[p.stock_state]}{p.stock_level !== null ? ` (${p.stock_level} left)` : ''}
                </option>
              ))}
              {unusable.map((p) => (
                <option key={p.id} value={p.id} disabled>
                  {partLabel(p)} — {STOCK_STATE_LABEL[p.stock_state]}
                </option>
              ))}
            </select>
            {parts.length === 0 && (
              <p className="text-sm text-gray-600 mt-2" data-testid="no-stock">There are no parts in your stock list yet.</p>
            )}
            {unusable.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-gray-600" data-testid="parts-unavailable">
                {unusable.map((p) => (
                  <li key={p.id}><span className="font-medium">{partLabel(p)}</span> cannot be chosen. {WHY_NOT[p.stock_state]}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="sm:max-w-xs">
            <label htmlFor="part-quantity" className="block text-sm font-medium mb-1">Quantity</label>
            <input
              id="part-quantity" inputMode="numeric" value={quantity} className={INPUT_CLASS} data-testid="part-quantity"
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <FormError message={problem} testId="use-part-error" />

          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="submit-part" onClick={submit}>
              {busy ? 'Saving…' : 'Record the part'}
            </Button>
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={onDone}>Close</Button>
          </div>
        </>
      )}

      {stock.state !== 'ready' && (
        <Button variant="outline" className="min-h-11" onClick={onDone}>Close</Button>
      )}
    </div>
  )
}

/**
 * Parts consumed on this job. Using a part draws on the stock list and writes one movement; a part whose
 * quantity is out, unknown or never counted cannot be chosen, and the reason is shown rather than hidden.
 */
export function PartsUsedPanel({ hub, busy, run, error }: HubPanelProps) {
  const [opening, setOpening] = useState(false)
  const [reversing, setReversing] = useState<string | null>(null)
  const usage = hub.parts_used
  const showMoney = hubShowsMoney(hub)
  const canUse = isAllowed(hub, 'use_part')
  // undoing a mistaken usage has its own key: it stays available while the job is open, even if nothing else is
  const canReverse = isAllowed(hub, 'reverse_usage')
  const active = String(hub.case.status).toLowerCase() === 'active'

  if (!canUse && !canReverse && usage.length === 0 && !active) return null

  return (
    <HubSection id="parts" title="Parts used" testId="parts-panel">
      {usage.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="parts-used">
          {usage.map((u) => (
            <li key={u.id} className="p-3 text-sm" data-testid="part-usage" data-reversed={u.reversed_at ? 'true' : 'false'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={`font-medium break-words ${u.reversed_at ? 'line-through text-gray-500' : ''}`}>
                    {u.part_name_snapshot} <span className="font-normal text-gray-500">({u.part_sku_snapshot})</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    Quantity {u.quantity}
                    {showMoney && <> · price {formatMoney(u.sell_price_snapshot, u.price_currency_snapshot)}</>}
                  </p>
                  {u.reversed_at && (
                    <p className="text-xs text-amber-700" data-testid="part-usage-reversed">Reversed {dateTimeLabel(u.reversed_at)} — returned to stock</p>
                  )}
                </div>
                {canReverse && !u.reversed_at && (
                  <Button
                    variant="outline" className="min-h-11" disabled={busy} data-testid="reverse-usage"
                    onClick={() => setReversing((cur) => (cur === u.id ? null : u.id))}
                  >
                    Reverse
                  </Button>
                )}
              </div>
              {canReverse && reversing === u.id && (
                <ReverseUsageForm usage={u} busy={busy} run={run} onDone={() => setReversing(null)} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600" data-testid="no-parts-used">No parts have been recorded on this job.</p>
      )}

      <ScopedError scope="parts" error={error} />

      {canUse ? (
        opening ? (
          <UsePartForm hub={hub} busy={busy} run={run} onDone={() => setOpening(false)} />
        ) : (
          <Button variant="outline" className="min-h-11" disabled={busy} data-testid="use-part" onClick={() => setOpening(true)}>
            <Package className="w-4 h-4 mr-2" aria-hidden="true" /> Use a part
          </Button>
        )
      ) : (
        active && (
          <p className="text-sm text-gray-700 rounded-lg bg-gray-50 p-3" data-testid="use-part-blocked">
            {hub.service_records.length === 0
              ? 'Record the work first — a part is logged against a piece of recorded work.'
              : 'Parts cannot be added to this job right now.'}
          </p>
        )
      )}
    </HubSection>
  )
}
