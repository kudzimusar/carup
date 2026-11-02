/**
 * CA-K3-01 — global Corporate context container (CA-UX-01 §7.4–7.7, §8).
 *
 * Holds scope, reporting period, comparison and freshness so later pages can consume them. In this
 * slice no page consumes a period or a comparison, and no organisational scope plumbing exists, so:
 *   - scope is "Corporate" only (the conceptual management root — not a legal entity);
 *   - the period control is shown as not applicable rather than pretending to filter;
 *   - comparison is off (no certified comparable metrics; no percentage deltas);
 *   - freshness reports that no governed source is connected.
 * A page declares which dimensions it consumes; the bar never offers a control a page cannot honour.
 */
import { useMemo, useState } from 'react'
import { CorporateContextState, NO_CONTEXT_SUPPORT, useCorporateContext, type CorporateContextValue, type PageContextSupport } from '@/lib/corporate/corporateContextState'

export function CorporateContextProvider({ children }: { children: React.ReactNode }) {
  const [pageSupport, setPageSupport] = useState<PageContextSupport>(NO_CONTEXT_SUPPORT)
  const value = useMemo<CorporateContextValue>(() => ({
    scope: { kind: 'corporate', label: 'CarUp Corporate' },
    // Default only when a page consumes a period (OD-CAUX-003). Nothing does in this slice.
    period: pageSupport.period ? 'trailing_30d' : null,
    comparison: 'off',
    pageSupport,
    setPageSupport,
  }), [pageSupport])
  return <CorporateContextState.Provider value={value}>{children}</CorporateContextState.Provider>
}

/** The global context strip: scope, period, comparison — each truthful about what it does. */
export function CorporateContextBar() {
  const { scope, period, pageSupport } = useCorporateContext()
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="corporate-context-bar" aria-label="Reporting context">
      <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700" data-testid="context-scope">
        <span className="text-slate-500">Scope:</span> {scope.label}
        <span className="sr-only">(conceptual management root; business-unit scope is not yet available)</span>
      </span>
      <span
        className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-1 text-slate-500"
        data-testid="context-period"
        aria-disabled={!pageSupport.period}
        title={pageSupport.period ? undefined : 'No metric on this page consumes a reporting period.'}
      >
        <span>Period:</span> {period ? 'Trailing 30 days' : 'Not applicable on this page'}
      </span>
      <span
        className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-1 text-slate-500"
        data-testid="context-comparison"
        aria-disabled="true"
        title="Comparison is off until comparable metric versions are certified."
      >
        <span>Comparison:</span> Off
      </span>
    </div>
  )
}
