/**
 * CA-K3-01 — state, types and hook for the global Corporate context container (see
 * components/corporate/CorporateContext.tsx). Kept apart from the components for fast refresh.
 */
import { createContext, useContext } from 'react'

export type CorporateScope = { kind: 'corporate'; label: 'CarUp Corporate' }
export type ReportingPeriod = 'trailing_7d' | 'trailing_30d' | 'trailing_90d'

export interface PageContextSupport {
  /** Whether any governed metric on the page consumes a reporting period. */
  period: boolean
  /** Whether a certified comparison exists for the page. */
  comparison: boolean
}

export const NO_CONTEXT_SUPPORT: PageContextSupport = Object.freeze({ period: false, comparison: false })

export interface CorporateContextValue {
  scope: CorporateScope
  /** null = no page on screen consumes a period. */
  period: ReportingPeriod | null
  comparison: 'off'
  pageSupport: PageContextSupport
  setPageSupport: (s: PageContextSupport) => void
}

export const CorporateContextState = createContext<CorporateContextValue | null>(null)

export function useCorporateContext(): CorporateContextValue {
  const v = useContext(CorporateContextState)
  if (!v) throw new Error('useCorporateContext must be used inside CorporateContextProvider')
  return v
}
