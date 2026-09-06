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

// ── T6 provider-entry vocabulary and the total-vs-breakdown rule ─────────
//
// The reconcile function mirrors reconcileBreakdown() in the backend commercial contract. The
// server is the authority — it REFUSES a "complete" declaration that does not add up — and this
// copy exists so the provider sees the position while typing rather than only on submit. A test
// pins the two to the same answers.

export interface DraftComponent {
  cost_stage: string
  label: string
  amount: string
  currency: string
  inclusion: string
  basis: string
  quantity: string
  notes: string
}

export interface BreakdownPosition {
  computable: boolean
  mixed_currency?: boolean
  total?: number | null
  currency?: string | null
  itemised?: number | null
  not_itemised?: number
  complete?: boolean
  note?: string
  reason?: string
  itemised_by_currency?: Record<string, number>
  foreign_currencies?: string[]
}

export const COST_STAGE_OPTIONS: Array<[string, string]> = [
  ['GOODS', 'The goods themselves'],
  ['ORIGIN', 'Collection at origin'],
  ['EXPORT', 'Export processing'],
  ['ORIGIN_TERMINAL', 'Origin port / terminal'],
  ['MAIN_CARRIAGE', 'Main transport'],
  ['INSURANCE', 'Insurance'],
  ['TRANSSHIPMENT', 'Transshipment'],
  ['DESTINATION_PORT', 'Destination port'],
  ['TRANSIT', 'Cross-border transit'],
  ['IMPORT_CUSTOMS', 'Import duty and taxes'],
  ['REGULATORY', 'Regulatory and inspection'],
  ['CLEARING', 'Customs clearing'],
  ['INLAND', 'Inland transport'],
  ['FINAL_DELIVERY', 'Final delivery'],
  ['FINANCE', 'Finance charges'],
  ['EXCEPTIONS', 'Exceptions and extras'],
]

export const INCLUSION_OPTIONS: Array<[string, string]> = [
  ['INCLUDED', 'Included in my price'],
  ['EXCLUDED', 'Excluded — customer arranges'],
  ['CONTINGENT', 'Only if it applies'],
  ['NOT_APPLICABLE', 'Not applicable'],
  ['UNKNOWN', 'Not known yet'],
]

export const BASIS_OPTIONS: Array<[string, string]> = [
  ['FLAT', 'Flat charge'],
  ['PER_CBM', 'Per CBM'],
  ['PER_KG', 'Per kg'],
  ['PER_VEHICLE', 'Per vehicle'],
  ['PER_UNIT', 'Per unit'],
  ['PER_CONTAINER', 'Per container'],
  ['PERCENTAGE', 'Percentage'],
]

/** Mirrors the server rule. Never sums across currencies to force agreement. */
export function reconcileBreakdown({ total, currency, components }: {
  total: string | number | null; currency: string | null; components: DraftComponent[]
}): BreakdownPosition {
  const totalAmount = total === null || total === undefined || total === '' ? null : Number(total)
  const priced = components.filter((c) => c.amount !== '' && c.amount !== null && c.inclusion === 'INCLUDED')
  const byCurrency: Record<string, number> = {}
  for (const c of priced) {
    const cur = (c.currency || currency || '').toUpperCase()
    if (!cur) continue
    byCurrency[cur] = Number(((byCurrency[cur] || 0) + Number(c.amount)).toFixed(2))
  }
  const cur = (currency || '').toUpperCase()
  const foreign = Object.keys(byCurrency).filter((c) => c !== cur)

  if (totalAmount === null || !cur) {
    return { computable: false, reason: 'The offer total or its currency is not recorded.', itemised_by_currency: byCurrency }
  }
  if (!priced.length) {
    return {
      computable: true, total: totalAmount, currency: cur, itemised: null,
      not_itemised: totalAmount, complete: false, mixed_currency: false, itemised_by_currency: byCurrency,
      note: 'No components are itemised yet, so none of this total is explained.',
    }
  }
  if (foreign.length) {
    return {
      computable: false, mixed_currency: true, total: totalAmount, currency: cur,
      itemised_by_currency: byCurrency, foreign_currencies: foreign,
      reason: `Components are quoted in ${foreign.join(', ')} as well as ${cur}, so they cannot be reconciled against a single total without a conversion nobody has authorised.`,
    }
  }
  const itemised = byCurrency[cur] || 0
  const difference = Number((totalAmount - itemised).toFixed(2))
  return {
    computable: true, mixed_currency: false, total: totalAmount, currency: cur, itemised,
    not_itemised: difference, complete: Math.abs(difference) < 0.005, itemised_by_currency: byCurrency,
    note: Math.abs(difference) < 0.005
      ? 'Every part of this total is itemised.'
      : difference > 0
        ? `${difference} ${cur} of this total is not itemised.`
        : `The itemised components exceed the stated total by ${Math.abs(difference)} ${cur}.`,
  }
}

/**
 * Draft rows → the server's component payload.
 *
 * Shared by both quote domains' API hooks so the mapping cannot drift. The critical line is the
 * amount: an empty field means UNPRICED and must reach the server as null, never as 0.
 */
export function toComponentPayload(components: DraftComponent[]) {
  return components.map((c) => ({
    cost_stage: c.cost_stage,
    label: c.label || c.cost_stage,
    original_amount: c.amount === '' ? null : Number(c.amount),
    original_currency: c.amount === '' ? null : (c.currency || null),
    inclusion: c.inclusion,
    basis: c.basis || undefined,
    quantity: c.quantity === '' ? undefined : Number(c.quantity),
    notes: c.notes || undefined,
  }))
}
