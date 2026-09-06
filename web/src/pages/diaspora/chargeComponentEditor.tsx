/**
 * Trade OS T6 — the provider's structured cost breakdown.
 *
 * Used by BOTH quote composers (procurement and logistics). It extends the existing compose →
 * review → submit flow; it is not a second quote system, and it never redefines the provider's
 * headline total.
 *
 * The honesty this component is responsible for:
 *   · the TOTAL and the BREAKDOWN are different things, and the gap between them is shown;
 *   · a provider may declare the breakdown complete, and is refused if it does not add up;
 *   · mixed currencies are never summed to make the numbers agree;
 *   · an excluded charge is a cost the customer still meets, never a zero line.
 */
import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import { reconcileBreakdown, COST_STAGE_OPTIONS, INCLUSION_OPTIONS, BASIS_OPTIONS } from './commercialFormat'
import type { DraftComponent, BreakdownPosition } from './commercialFormat'

const label = 'block min-w-0 text-xs font-medium uppercase tracking-wide text-slate-600'
const control = 'mt-1 block w-full min-w-0 border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none'

export const emptyComponent = (): DraftComponent => ({
  cost_stage: 'MAIN_CARRIAGE', label: '', amount: '', currency: '', inclusion: 'INCLUDED',
  basis: '', quantity: '', notes: '',
})

export function BreakdownPositionNote({ position }: { position: BreakdownPosition }) {
  if (!position.computable) {
    return (
      <p className="mt-2 text-xs text-amber-900" data-testid="breakdown-not-computable">
        {position.reason}
      </p>
    )
  }
  return (
    <div className="mt-2 text-xs" data-testid="breakdown-position">
      <p className="text-slate-700">
        Offer total <span className="font-semibold">{position.currency} {position.total?.toLocaleString()}</span>
        {' · '}itemised{' '}
        <span className="font-semibold">
          {position.itemised === null || position.itemised === undefined
            ? 'nothing yet'
            : `${position.currency} ${position.itemised.toLocaleString()}`}
        </span>
      </p>
      <p className={position.complete ? 'mt-0.5 text-emerald-800' : 'mt-0.5 text-amber-900'} data-testid="breakdown-note">
        {position.note}
      </p>
    </div>
  )
}

/**
 * The editor. `total`/`currency` come from the composer's existing headline fields so the
 * reconciliation always compares against what the provider actually stated.
 */
export function ChargeComponentEditor({
  components, onChange, total, currency, breakdownComplete, onBreakdownCompleteChange,
}: {
  components: DraftComponent[]
  onChange: (next: DraftComponent[]) => void
  total: string
  currency: string
  breakdownComplete: boolean
  onBreakdownCompleteChange: (next: boolean) => void
}) {
  const position = useMemo(
    () => reconcileBreakdown({ total, currency, components }),
    [total, currency, components],
  )

  const update = (index: number, patch: Partial<DraftComponent>) =>
    onChange(components.map((c, i) => (i === index ? { ...c, ...patch } : c)))

  return (
    <div className="mt-6 border-t border-slate-200 pt-5" data-testid="charge-component-editor">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-950">Cost breakdown (optional)</h3>
        <Button variant="outline" size="sm" className="rounded-none" onClick={() => onChange([...components, emptyComponent()])} data-testid="add-charge-component">
          <Plus className="mr-1 h-3.5 w-3.5" /> Add a cost line
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Itemising helps the customer compare like with like. Leave a cost out and it simply stays
        unexplained — CarUp will not present your total as fully itemised unless you say it is.
      </p>

      {components.length === 0 ? (
        <p className="mt-3 text-xs italic text-slate-500" data-testid="no-components-yet">
          No cost lines yet. Your stated total still stands on its own.
        </p>
      ) : (
        <div className="mt-3 space-y-3" data-testid="charge-component-rows">
          {components.map((c, i) => (
            <div key={i} className="grid min-w-0 gap-2 border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="charge-component-row">
              <label className={label}>Cost type
                <select className={control} value={c.cost_stage} onChange={(e) => update(i, { cost_stage: e.target.value })} data-testid={`component-stage-${i}`}>
                  {COST_STAGE_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </label>
              <label className={`${label} lg:col-span-2`}>Describe it
                <Input className="mt-1 rounded-none" value={c.label} onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="e.g. Ocean freight, Yokohama to Beira" data-testid={`component-label-${i}`} />
              </label>
              <label className={label}>Included or not
                <select className={control} value={c.inclusion} onChange={(e) => update(i, { inclusion: e.target.value })} data-testid={`component-inclusion-${i}`}>
                  {INCLUSION_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </label>
              <label className={label}>Amount
                <Input className="mt-1 rounded-none" type="number" min="0" value={c.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                  placeholder="leave blank if unknown" data-testid={`component-amount-${i}`} />
              </label>
              <label className={label}>Currency
                <Input className="mt-1 rounded-none" value={c.currency} maxLength={3}
                  onChange={(e) => update(i, { currency: e.target.value.toUpperCase() })}
                  placeholder={currency || 'e.g. JPY'} data-testid={`component-currency-${i}`} />
              </label>
              <label className={label}>Charged per (optional)
                <select className={control} value={c.basis} onChange={(e) => update(i, { basis: e.target.value })} data-testid={`component-basis-${i}`}>
                  <option value="">Not stated</option>
                  {BASIS_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </label>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" className="rounded-none text-slate-600"
                  onClick={() => onChange(components.filter((_, x) => x !== i))} data-testid={`remove-component-${i}`}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                </Button>
              </div>
              {c.amount === '' && (
                <p className="text-[11px] text-slate-500 sm:col-span-2 lg:col-span-4" data-testid={`component-unpriced-note-${i}`}>
                  No amount — the customer will see this as not priced, never as zero.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <BreakdownPositionNote position={position} />

      {components.length > 0 && (
        <label className="mt-3 flex items-start gap-2 text-xs text-slate-700" data-testid="breakdown-complete-toggle">
          <input type="checkbox" className="mt-0.5" checked={breakdownComplete}
            onChange={(e) => onBreakdownCompleteChange(e.target.checked)} data-testid="breakdown-complete-checkbox" />
          <span>
            These lines account for my whole total.
            {breakdownComplete && !position.complete && (
              <span className="block font-semibold text-red-700" data-testid="breakdown-complete-conflict">
                They do not add up to your stated total yet, so this will be refused on submit.
              </span>
            )}
          </span>
        </label>
      )}
    </div>
  )
}

/** Read-only breakdown for the review step — exactly what the customer will later compare. */
export function ChargeComponentReview({ components, total, currency }: {
  components: DraftComponent[]; total: string; currency: string
}) {
  const position = reconcileBreakdown({ total, currency, components })
  if (!components.length) {
    return (
      <p className="mt-3 text-xs italic text-slate-500" data-testid="review-no-breakdown">
        No cost breakdown — the customer sees your total only.
      </p>
    )
  }
  return (
    <div className="mt-3" data-testid="review-breakdown">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Cost breakdown</p>
      <ul className="mt-1 space-y-1">
        {components.map((c, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-2 text-xs" data-testid="review-component">
            <span className="text-slate-800">
              {COST_STAGE_OPTIONS.find(([v]) => v === c.cost_stage)?.[1] || c.cost_stage}
              {c.label ? ` — ${c.label}` : ''}
              <span className="ml-1 text-slate-500">
                ({INCLUSION_OPTIONS.find(([v]) => v === c.inclusion)?.[1] || c.inclusion})
              </span>
            </span>
            <span className="font-medium text-slate-900">
              {c.amount === '' ? <span className="italic text-slate-500">not priced</span> : `${c.currency || currency} ${Number(c.amount).toLocaleString()}`}
            </span>
          </li>
        ))}
      </ul>
      <BreakdownPositionNote position={position} />
    </div>
  )
}
