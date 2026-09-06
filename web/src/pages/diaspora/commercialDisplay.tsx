/**
 * Trade OS T6 — how commercial facts are allowed to appear on screen.
 *
 * These helpers exist so the truth rules are enforced in ONE place rather than remembered at every
 * call site. The rules they encode:
 *
 *   · the SOURCE amount is always shown; the USD figure is a reference beside it, never instead of it;
 *   · when there is no rate there is no number — "USD comparison unavailable", not 0 and not 1:1;
 *   · an unpriced component says so in words; it never renders as a currency-formatted zero;
 *   · an exclusion is a cost the customer will still meet, never a $0 line.
 */


import { formatMoney, INCLUSION_LABEL, INCLUSION_TONE } from './commercialFormat'
import type { Money, FxInfo } from './commercialFormat'

/**
 * Source money with its reference conversion underneath.
 *
 * The source line is the commercial fact and is always rendered first. The USD line is explicitly
 * labelled a reference and carries the rate, its source and its OWN date — so nobody can mistake a
 * Friday rate read on Sunday for today's.
 */
export function MoneyWithReference({ source, reference, fx, compact = false, inclusion }: {
  source: Money; reference?: Money | null; fx?: FxInfo | null; compact?: boolean; inclusion?: string
}) {
  const sourceText = formatMoney(source)
  if (!sourceText) {
    // WHY there is no figure is different in each case, and reading them as the same thing is how
    // a customer comes to expect a price for something that will never have one. "Not priced yet"
    // means a price is still owed; a charge that does not apply is never owed one, and an excluded
    // charge is one the provider is not quoting — the customer pays it to someone else.
    const [label, testId] = inclusion === 'NOT_APPLICABLE'
      ? ['Does not apply to this shipment', 'money-not-applicable']
      : inclusion === 'EXCLUDED'
        ? ['Amount not stated — you arrange this', 'money-excluded-unstated']
        : ['Not priced yet', 'money-unpriced']
    return <span className="text-slate-500 italic" data-testid={testId}>{label}</span>
  }
  const referenceText = formatMoney(reference || null)
  return (
    <span className="inline-flex flex-col" data-testid="money-with-reference">
      <span className="font-semibold text-slate-950" data-testid="money-source">{sourceText}</span>
      {referenceText ? (
        <span className="text-xs text-slate-600" data-testid="money-reference">
          ≈ {referenceText}
          {!compact && fx?.rate ? (
            <span className="block text-[11px] text-slate-500">
              Reference rate {fx.rate.toPrecision(6)} · {fx.source} · {fx.rate_date}
              {fx.status === 'STALE' ? ' · last published rate' : ''}
              {fx.triangulation ? ` · via ${fx.triangulation.via}` : ''}
            </span>
          ) : null}
        </span>
      ) : (
        // No rate means no number. Saying "USD 0" or reusing the source figure would both be lies.
        <span className="text-xs text-slate-500 italic" data-testid="money-reference-unavailable">
          USD comparison unavailable{fx?.reason ? ` — ${fx.reason}` : ''}
        </span>
      )}
    </span>
  )
}

export function InclusionBadge({ inclusion }: { inclusion: string }) {
  return (
    <span className={`text-xs font-medium ${INCLUSION_TONE[inclusion] || 'text-slate-500'}`} data-testid={`inclusion-${inclusion}`}>
      {INCLUSION_LABEL[inclusion] || inclusion}
    </span>
  )
}
