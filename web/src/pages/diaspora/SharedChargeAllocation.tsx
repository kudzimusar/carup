/**
 * Trade OS T6.8 — splitting one shared charge across the participants on a sailing.
 *
 * The allocation engine was written, tested and routed, and nothing told an operator which charges
 * exist on a sailing they operate — so the capability was unreachable from the product. This panel
 * is that missing half.
 *
 * Two rules the screen enforces rather than mentions:
 *   · there is NO default basis. CarUp will not choose how to divide somebody else's money, so the
 *     control starts on "not chosen" and the server refuses a write without one;
 *   · only APPROVED reservations are charged — a requested booking is not committed capacity — and
 *     when there are none the panel says why rather than offering a control that will fail.
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatMoney } from './commercialFormat'
import type { Money } from './commercialFormat'

const BASIS_CHOICES: Array<[string, string]> = [
  ['CBM', 'By volume (CBM)'],
  ['WEIGHT', 'By weight'],
  ['UNIT', 'Equally, per booking'],
  ['FLAT', 'A flat amount each'],
]

export interface SharedCharge {
  id: string
  cost_stage: string
  stage_label: string
  label: string
  original: Money
  allocation: { allocated: boolean; note?: string; allocations: Array<{ reservation_id: string; allocated_amount: number; currency?: string | null }> }
}

export interface SharedChargeSet {
  charges: SharedCharge[]
  approved_reservations: number
  note: string
}

export function SharedChargeAllocationPanel({ containerId, read, allocate }: {
  containerId: string
  read: (containerId: string) => Promise<SharedChargeSet>
  allocate: (componentId: string, containerId: string, basis: string) => Promise<unknown>
}) {
  const [data, setData] = useState<SharedChargeSet | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const [basis, setBasis] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setData(await read(containerId)); setState('ready') } catch { setState('unreadable') }
  }, [read, containerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const run = async (chargeId: string) => {
    const chosen = basis[chargeId]
    if (!chosen) { setError('Choose how this charge should be divided. CarUp does not choose for you.'); return }
    setBusy(chargeId); setError('')
    try { await allocate(chargeId, containerId, chosen); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'The charge could not be allocated') }
    finally { setBusy('') }
  }

  if (state === 'loading') {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-gray-500" data-testid="shared-charges-loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the shared charges on this sailing…
      </p>
    )
  }
  if (state === 'unreadable' || !data) {
    return (
      <p className="mt-2 border-l-2 border-amber-400 pl-3 text-xs text-amber-900" data-testid="shared-charges-unreadable">
        The shared charges could not be read just now. That is not a report that there are none.
      </p>
    )
  }

  return (
    <div className="mt-8 border-t border-gray-200 pt-5" data-testid="shared-charge-allocation">
      <h3 className="text-lg font-bold text-gray-950">Shared charges</h3>
      <p className="mt-1 max-w-2xl text-sm text-gray-600" data-testid="shared-charges-note">{data.note}</p>
      {error && <p className="mt-2 text-xs font-medium text-red-700" data-testid="shared-charges-error">{error}</p>}

      {data.charges.length === 0 ? (
        <p className="mt-3 text-sm italic text-gray-500" data-testid="shared-charges-empty">
          No priced charge is recorded against an offer attached to this sailing.
        </p>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="shared-charges-list">
          {data.charges.map((c) => (
            <li key={c.id} className="border border-gray-300 bg-white p-4" data-testid="shared-charge-row">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-950">{c.stage_label}</p>
                  <p className="text-xs text-gray-600">{c.label}</p>
                </div>
                <p className="shrink-0 text-lg font-bold text-gray-950">{formatMoney(c.original)}</p>
              </div>

              {c.allocation.allocated ? (
                <div className="mt-3 border-l-2 border-emerald-500 pl-3" data-testid="shared-charge-allocated">
                  <p className="text-xs font-semibold text-emerald-800">Already divided</p>
                  <ul className="mt-1 space-y-0.5">
                    {c.allocation.allocations.map((a) => (
                      <li key={a.reservation_id} className="text-xs text-gray-700" data-testid="shared-charge-allocation-line">
                        RES-{String(a.reservation_id).replace(/-/g, '').slice(0, 8).toUpperCase()} —{' '}
                        {formatMoney({ amount: a.allocated_amount, currency: a.currency || c.original.currency })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : data.approved_reservations === 0 ? (
                <p className="mt-3 text-xs italic text-gray-500" data-testid="shared-charge-nothing-to-split">
                  Nothing to divide yet — no booking on this sailing is approved.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    className="min-w-0 border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
                    value={basis[c.id] || ''}
                    onChange={(e) => setBasis((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    data-testid={`shared-charge-basis-${c.id}`}
                  >
                    {/* No default. An unstated basis stays "not allocated yet". */}
                    <option value="">How should this be divided?</option>
                    {BASIS_CHOICES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  <Button
                    size="sm" className="bg-orange-500 text-white hover:bg-orange-600"
                    onClick={() => void run(c.id)} disabled={busy === c.id}
                    data-testid={`shared-charge-allocate-${c.id}`}
                  >
                    {busy === c.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Divide across {data.approved_reservations} approved booking{data.approved_reservations === 1 ? '' : 's'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-gray-500">
        Dividing a charge records who owes what. It is not an invoice, a payment or a settlement.
      </p>
    </div>
  )
}
