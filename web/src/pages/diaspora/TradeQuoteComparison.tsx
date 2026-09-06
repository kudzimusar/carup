/**
 * Trade OS T6 — what the customer sees when two prices differ.
 *
 * The design question this answers is not "which is cheaper" but "why do these differ, and what
 * am I not being told". So the panel leads with scope, shows every exclusion and unpriced stage at
 * the same visual weight as the money, and simply refuses to nominate a winner when the offers are
 * not the same purchase — no green/red styling on incomparable options (root DESIGN.md §7, §8).
 */
import { MoneyWithReference, InclusionBadge } from './commercialDisplay'
import { provenanceLabel, formatMoney } from './commercialFormat'
import type { Money, FxInfo } from './commercialFormat'

export interface ChargeComponent {
  id: string
  cost_stage: string
  stage_label: string
  label: string
  original: Money
  reference_usd: Money | null
  fx: FxInfo
  inclusion: string
  commercial_status: string
  provenance: string
  revenue_class: string
  is_carup_revenue: boolean
  service_scope?: string | null
}

export interface LandedEstimate {
  known_included_by_currency: Record<string, number>
  known_included_reference_usd: number | null
  reference_usd_incomplete: boolean
  excluded: Array<{ stage: string; stage_label: string; label: string; original: Money }>
  contingent: Array<{ stage: string; stage_label: string; label: string; original: Money }>
  unpriced: Array<{ stage: string; stage_label: string; label: string }>
  missing_material_stages: Array<{ stage: string; stage_label: string }>
  is_complete: boolean
  carup_charges: Array<{ label: string; original: Money; revenue_class: string }>
  customs_note: string
}

export interface ComparableQuote {
  id: string
  label: string | null
  components: ChargeComponent[]
  estimate: LandedEstimate
}

export interface ComparisonResult {
  comparable: boolean
  verdict: string
  cheapest: string | null
  reasons: string[]
  totals?: Array<{ id: string; label: string | null; reference_usd: number | null; complete: boolean }>
  pairs?: Array<{ a: string; b: string; verdict: string; reasons: string[] }>
}

/**
 * The estimate panel. Its whole job is to never print a single confident "landed cost" while
 * material stages are unknown.
 */
export function LandedEstimatePanel({ estimate }: { estimate: LandedEstimate }) {
  const currencies = Object.entries(estimate.known_included_by_currency)
  return (
    <div className="border border-slate-300 bg-white p-4" data-testid="landed-estimate">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-950">
          {/* The wording IS the contract: only a fully priced journey may be called a landed cost. */}
          {estimate.is_complete ? 'Estimated landed cost' : 'Known estimated costs so far'}
        </h3>
        {!estimate.is_complete && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-900" data-testid="estimate-incomplete">
            Not a full landed cost
          </span>
        )}
      </div>

      {currencies.length === 0 ? (
        <p className="mt-2 text-sm italic text-slate-500" data-testid="estimate-nothing-priced">
          Nothing is priced yet, so there is no figure to show.
        </p>
      ) : (
        <div className="mt-2 space-y-1" data-testid="estimate-totals">
          {currencies.map(([currency, amount]) => (
            <p key={currency} className="text-lg font-bold text-slate-950">{formatMoney({ amount, currency })}</p>
          ))}
          {estimate.known_included_reference_usd !== null ? (
            <p className="text-xs text-slate-600" data-testid="estimate-reference-usd">
              ≈ USD {estimate.known_included_reference_usd.toLocaleString()} for comparison
            </p>
          ) : estimate.reference_usd_incomplete ? (
            <p className="text-xs italic text-slate-500" data-testid="estimate-reference-incomplete">
              No single USD comparison — at least one amount has no reference rate.
            </p>
          ) : null}
        </div>
      )}

      {estimate.missing_material_stages.length > 0 && (
        <div className="mt-3 border-l-2 border-amber-400 pl-3" data-testid="estimate-missing-stages">
          <p className="text-xs font-semibold text-amber-900">Still unpriced</p>
          <ul className="mt-1 space-y-0.5">
            {estimate.missing_material_stages.map((s) => (
              <li key={s.stage} className="text-xs text-amber-900">{s.stage_label}</li>
            ))}
          </ul>
        </div>
      )}

      {estimate.excluded.length > 0 && (
        <div className="mt-3 border-l-2 border-slate-400 pl-3" data-testid="estimate-excluded">
          <p className="text-xs font-semibold text-slate-700">Excluded — you arrange these separately</p>
          <ul className="mt-1 space-y-0.5">
            {estimate.excluded.map((e, i) => (
              <li key={`${e.stage}-${i}`} className="text-xs text-slate-700">
                {e.stage_label}: {e.label}
                {/* An exclusion with a known figure shows it; an exclusion without one says so.
                    Neither ever renders as a zero. */}
                {formatMoney(e.original) ? ` — about ${formatMoney(e.original)}` : ' — amount not stated'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {estimate.contingent.length > 0 && (
        <div className="mt-3 border-l-2 border-amber-300 pl-3" data-testid="estimate-contingent">
          <p className="text-xs font-semibold text-amber-900">Only if it applies</p>
          <ul className="mt-1 space-y-0.5">
            {estimate.contingent.map((c, i) => (
              <li key={`${c.stage}-${i}`} className="text-xs text-amber-900">{c.stage_label}: {c.label}</li>
            ))}
          </ul>
        </div>
      )}

      {estimate.carup_charges.length > 0 && (
        <div className="mt-3 border-l-2 border-orange-500 pl-3" data-testid="estimate-carup-charges">
          <p className="text-xs font-semibold text-orange-800">CarUp charges</p>
          {estimate.carup_charges.map((c, i) => (
            <p key={i} className="text-xs text-slate-800">{c.label} — {formatMoney(c.original) || 'not stated'}</p>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500" data-testid="estimate-customs-note">{estimate.customs_note}</p>
      <p className="mt-1 text-[11px] text-slate-500">This is an estimate, not an invoice.</p>
    </div>
  )
}

/** One offer's component breakdown — scope first, money second. */
export function QuoteBreakdown({ quote }: { quote: ComparableQuote }) {
  return (
    <div className="border border-slate-300 bg-white p-4" data-testid="quote-breakdown">
      <h3 className="text-sm font-bold text-slate-950">{quote.label || 'Offer'}</h3>
      {quote.components.length === 0 ? (
        <p className="mt-2 text-sm italic text-slate-500">No cost breakdown was recorded for this offer.</p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="quote-components">
          {quote.components.map((c) => (
            <li key={c.id} className="border-b border-slate-100 pb-2 last:border-0" data-testid="quote-component">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{c.stage_label}</p>
                  <p className="text-xs text-slate-600">{c.label}</p>
                  <InclusionBadge inclusion={c.inclusion} />
                  {c.is_carup_revenue && (
                    <span className="ml-2 text-xs font-semibold text-orange-800" data-testid="component-carup-revenue">CarUp charge</span>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <MoneyWithReference source={c.original} reference={c.reference_usd} fx={c.fx} compact />
                  <p className="mt-0.5 text-[11px] text-slate-500">{provenanceLabel(c.provenance)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4"><LandedEstimatePanel estimate={quote.estimate} /></div>
    </div>
  )
}

/**
 * The comparison verdict.
 *
 * When the offers are not commercially comparable this renders the REASONS and no winner at all —
 * deliberately no green "best value" chrome, because styling one option as the winner is itself a
 * claim CarUp has not earned.
 */
export function ComparisonVerdict({ result, quotes }: { result: ComparisonResult; quotes: ComparableQuote[] }) {
  const labelOf = (id: string) => quotes.find((q) => q.id === id)?.label || 'this offer'
  return (
    <div className="border border-slate-300 bg-slate-50 p-4" data-testid="comparison-verdict">
      {result.comparable && result.cheapest ? (
        <>
          <p className="text-sm font-bold text-slate-950" data-testid="comparison-comparable">
            These offers cover the same scope, so the totals compare directly.
          </p>
          <p className="mt-1 text-sm text-slate-800" data-testid="comparison-lowest">
            Lowest recorded total: <span className="font-semibold">{labelOf(result.cheapest)}</span>
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-bold text-slate-950" data-testid="comparison-not-comparable">
            CarUp is not calling one of these cheaper.
          </p>
          <ul className="mt-2 space-y-1" data-testid="comparison-reasons">
            {result.reasons.map((r, i) => <li key={i} className="text-xs text-slate-700">{r}</li>)}
            {(result.pairs || []).flatMap((p) => p.reasons).slice(0, 5).map((r, i) => (
              <li key={`p-${i}`} className="text-xs text-slate-700">{r}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
