/**
 * Trade OS T6 — pure commercial formatting and types.
 *
 * Separate from the components file because these are data helpers, not components, and mixing
 * the two breaks fast refresh (react-refresh/only-export-components). The rules live here:
 *
 *   · money with no amount, or no currency, formats to NULL — the caller then says why in words
 *     rather than rendering a currency-formatted zero;
 *   · a REAL zero still formats as a zero, because a measured zero is a fact.
 */
export interface Money { amount: number | null; currency: string | null }

export interface FxInfo {
  status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE'
  rate?: number
  rate_date?: string
  source?: string
  reason?: string | null
  triangulation?: { via: string; legs: Array<{ pair: string; rate: number }> } | null
}

/** Returns null when there is no amount to show — never a fabricated zero. */
export function formatMoney(money: Money | null | undefined): string | null {
  if (!money || money.amount === null || money.amount === undefined || !money.currency) return null
  return `${money.currency} ${Number(money.amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export const INCLUSION_LABEL: Record<string, string> = {
  INCLUDED: 'Included',
  EXCLUDED: 'Excluded — you arrange this separately',
  CONTINGENT: 'Only if it applies',
  NOT_APPLICABLE: 'Not applicable',
  UNKNOWN: 'Not stated',
}

export const INCLUSION_TONE: Record<string, string> = {
  INCLUDED: 'text-emerald-800',
  EXCLUDED: 'text-amber-900',
  CONTINGENT: 'text-amber-900',
  NOT_APPLICABLE: 'text-slate-500',
  UNKNOWN: 'text-slate-500',
}

const PROVENANCE_LABEL: Record<string, string> = {
  PROVIDER_STATED: 'Provider-stated, not verified by CarUp',
  CUSTOMER_ESTIMATED: 'Your estimate',
  CARUP_CALCULATED: 'Calculated by CarUp',
  DOCUMENT_DERIVED: 'Read from a document',
  VERIFIED: 'Verified',
  HISTORICAL_ACTUAL: 'What a past journey actually cost',
}
export const provenanceLabel = (p: string) => PROVENANCE_LABEL[p] || p
