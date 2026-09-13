/**
 * Trade OS T6 — the customer-facing commercial section.
 *
 * The T6 breakdown, landed estimate and comparability verdict were built and unit-tested before
 * anything rendered them, which meant a provider could record a complete component breakdown and
 * their customer would still only see the five legacy columns. This module is the wiring: the same
 * section is mounted on BOTH customer surfaces (procurement offers and logistics offers) so the two
 * domains cannot drift into telling customers different truths about the same kind of money.
 *
 * Every state here is honest by construction: unreadable is not "none", no breakdown is not "zero",
 * and an incomparable set gets reasons instead of a winner.
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BreakdownPositionNote } from './chargeComponentEditor'
import { QuoteBreakdown, ComparisonVerdict, AdvicePanel, LandedEstimatePanel } from './TradeQuoteComparison'
import type { QuoteCommercials, ComparisonResult, ComparableQuote, AdviceResult } from './TradeQuoteComparison'
import type { BreakdownPosition } from './commercialFormat'

export type QuoteKind = 'import-quotes' | 'logistics-quotes'
export interface OfferRef { id: string; kind: QuoteKind; label: string }

type ReadFn = (kind: QuoteKind, quoteId: string) => Promise<QuoteCommercials>
type CompareFn = (
  targets: Array<{ id: string; kind: 'import' | 'logistics'; label: string }>,
  context?: { cargo?: Record<string, unknown>; objective?: string | null },
) => Promise<{ quotes: ComparableQuote[]; comparison: ComparisonResult; advice: AdviceResult }>

/** One offer's recorded cost breakdown, as the customer reads it. */
export function OfferCommercials({ read, offer }: { read: ReadFn; offer: OfferRef }) {
  const [data, setData] = useState<QuoteCommercials | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')

  const load = useCallback(async () => {
    try {
      const next = await read(offer.kind, offer.id)
      // Same rule as the allocation panel: an unexpected shape is unreadable, never empty.
      if (!next || !Array.isArray(next.components)) { setState('unreadable'); return }
      setData(next)
      setState('ready')
    } catch {
      // Deliberately NOT "no breakdown recorded" — a failed read is not evidence of absence.
      setState('unreadable')
    }
  }, [read, offer.kind, offer.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  if (state === 'loading') {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500" data-testid="offer-commercials-loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the cost breakdown…
      </p>
    )
  }
  if (state === 'unreadable' || !data) {
    return (
      <p className="mt-4 border-l-2 border-amber-400 pl-3 text-xs text-amber-900" data-testid="offer-commercials-unreadable">
        This offer’s cost breakdown could not be read just now. That is not a report that the
        provider gave none — try again shortly.
      </p>
    )
  }
  if (data.components.length === 0) {
    return (
      <p className="mt-4 border-l-2 border-slate-300 pl-3 text-xs text-slate-600" data-testid="offer-commercials-none">
        This provider has not broken their price down into separate charges, so CarUp cannot show
        you what it does and does not cover. Ask them before comparing it with another offer.
      </p>
    )
  }

  return (
    <div className="mt-4" data-testid="offer-commercials">
      <QuoteBreakdown quote={{ id: offer.id, label: offer.label, components: data.components, estimate: data.estimate }} />
      <BreakdownPositionNote position={data.breakdown as BreakdownPosition} />
    </div>
  )
}

/**
 * The cross-offer verdict. Rendered only when there are at least two offers, because "comparable"
 * is a statement about a set — and CarUp names a cheapest only when the set genuinely is one.
 */
export function OfferComparison({ compare, offers, cargo, objective }: {
  compare: CompareFn; offers: OfferRef[]; cargo?: Record<string, unknown>; objective?: string | null
}) {
  // The guard is OUTSIDE the component that loads, not inside it: comparison needs two offers, and
  // asking the server to compare one produced a 400 on every single-offer request detail.
  if (offers.length < 2) return null
  return <OfferComparisonPanel compare={compare} offers={offers} cargo={cargo} objective={objective} />
}

function OfferComparisonPanel({ compare, offers, cargo, objective }: {
  compare: CompareFn; offers: OfferRef[]; cargo?: Record<string, unknown>; objective?: string | null
}) {
  const [result, setResult] = useState<{ quotes: ComparableQuote[]; comparison: ComparisonResult; advice: AdviceResult } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const key = offers.map((o) => o.id).join('|')

  const load = useCallback(async () => {
    try {
      const next = await compare(offers.map((o) => ({
        id: o.id, kind: o.kind === 'import-quotes' ? 'import' : 'logistics', label: o.label,
      })), { cargo, objective })
      if (!next || !next.comparison) { setState('unreadable'); return }
      setResult(next)
      setState('ready')
    } catch {
      setState('unreadable')
    }
    // `key` stands in for the offer identities: re-comparing on every array identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare, key, objective])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  if (state === 'loading') {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500" data-testid="offer-comparison-loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comparing what each offer covers…
      </p>
    )
  }
  if (state === 'unreadable' || !result) {
    return (
      <p className="mt-4 border-l-2 border-amber-400 pl-3 text-xs text-amber-900" data-testid="offer-comparison-unreadable">
        These offers could not be compared just now. Nothing about them has changed — try again shortly.
      </p>
    )
  }
  return (
    <div className="mt-4" data-testid="offer-comparison">
      <ComparisonVerdict result={result.comparison} quotes={result.quotes} />
      <AdvicePanel advice={result.advice} quotes={result.quotes || []} />
    </div>
  )
}

export { LandedEstimatePanel }
