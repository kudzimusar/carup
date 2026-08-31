/**
 * Vehicle History & Obligations — Seller disclosure types and closed vocabularies (DESIGN.md §11.7,
 * master plan F18–F20). Mirrors backend/services/seller/vehicleHistoryDisclosures.js: the backend
 * refuses anything outside these vocabularies, so the UI offers exactly these choices and nothing
 * is ever preselected — an unanswered question stays null and renders as "not recorded", never "No".
 */

export const ACCIDENT_DISCLOSURE_STATES = ['yes', 'no_known_accident_history', 'unknown'] as const
export const INSURANCE_DISCLOSURE_STATES = ['insured', 'not_insured', 'unknown'] as const
export const FINANCE_DISCLOSURE_STATES = ['none_known', 'active', 'settlement_pending', 'cleared', 'unknown'] as const
export const FINANCE_TYPES = ['bank_loan', 'vehicle_finance', 'lease', 'hire_purchase', 'secured_lien', 'other'] as const

export type AccidentDisclosureState = typeof ACCIDENT_DISCLOSURE_STATES[number]
export type InsuranceDisclosureState = typeof INSURANCE_DISCLOSURE_STATES[number]
export type FinanceDisclosureState = typeof FINANCE_DISCLOSURE_STATES[number]
export type FinanceType = typeof FINANCE_TYPES[number]

export interface AccidentEvent {
  approx_date?: string
  mileage?: string
  damage_area?: string
  severity?: string
  insurer_involved?: string
  police_report_state?: string
  repair_state?: string
  repairer?: string
}

export interface AccidentDisclosure {
  state: AccidentDisclosureState
  events?: AccidentEvent[]
}

export interface InsuranceDisclosure {
  state: InsuranceDisclosureState
  insurer_name?: string
}

export interface FinanceDisclosure {
  state: FinanceDisclosureState
  finance_type?: FinanceType
  lender_name?: string
}

/**
 * The buyer-facing projection block published by the backend (passport + marketplace detail).
 * Block-level `authority` is the attribution every surface must keep visibly separate from
 * governed evidence/insurer/lender truth; null per topic = "not recorded".
 */
export interface VehicleHistoryDisclosuresBlock {
  authority: 'seller_stated'
  accident: AccidentDisclosure | null
  insurance: InsuranceDisclosure | null
  finance: FinanceDisclosure | null
}

/** Seller-facing copy. The honest options are explicit; there is deliberately no bare "No". */
export const ACCIDENT_STATE_LABELS: Record<AccidentDisclosureState, string> = {
  yes: 'Yes — it has been in an accident',
  no_known_accident_history: 'No known accident history',
  unknown: 'I don’t know',
}

export const INSURANCE_STATE_LABELS: Record<InsuranceDisclosureState, string> = {
  insured: 'Currently insured',
  not_insured: 'Not currently insured',
  unknown: 'I don’t know',
}

export const FINANCE_STATE_LABELS: Record<FinanceDisclosureState, string> = {
  none_known: 'No finance or lender interest that I know of',
  active: 'Active finance / lease / lender interest',
  settlement_pending: 'Settlement in progress',
  cleared: 'Finance previously held, now cleared',
  unknown: 'I don’t know',
}

export const FINANCE_TYPE_LABELS: Record<FinanceType, string> = {
  bank_loan: 'Bank loan',
  vehicle_finance: 'Vehicle finance',
  lease: 'Lease',
  hire_purchase: 'Hire purchase',
  secured_lien: 'Secured lending / lien',
  other: 'Other',
}

const ACCIDENT_EVENT_FIELDS: (keyof AccidentEvent)[] = [
  'approx_date', 'mileage', 'damage_area', 'severity',
  'insurer_involved', 'police_report_state', 'repair_state', 'repairer',
]

function cleanString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text.slice(0, 200)
}

/**
 * Draft-parser normalization: anything that is not a valid disclosure becomes null (unanswered).
 * The parser must never "repair" an invalid stored value into a legitimate-looking answer.
 */
export function parseAccidentDisclosure(raw: unknown): AccidentDisclosure | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const state = candidate.state
  if (!ACCIDENT_DISCLOSURE_STATES.includes(state as AccidentDisclosureState)) return null
  const value: AccidentDisclosure = { state: state as AccidentDisclosureState }
  if (value.state === 'yes' && Array.isArray(candidate.events)) {
    const events = candidate.events
      .slice(0, 10)
      .map((entry): AccidentEvent | null => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const event: AccidentEvent = {}
        for (const field of ACCIDENT_EVENT_FIELDS) {
          const cleaned = cleanString((entry as Record<string, unknown>)[field])
          if (cleaned !== undefined) event[field] = cleaned
        }
        return Object.keys(event).length > 0 ? event : null
      })
      .filter((event): event is AccidentEvent => event !== null)
    if (events.length > 0) value.events = events
  }
  return value
}

export function parseInsuranceDisclosure(raw: unknown): InsuranceDisclosure | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const state = candidate.state
  if (!INSURANCE_DISCLOSURE_STATES.includes(state as InsuranceDisclosureState)) return null
  const value: InsuranceDisclosure = { state: state as InsuranceDisclosureState }
  if (value.state === 'insured') {
    const insurerName = cleanString(candidate.insurer_name)
    if (insurerName !== undefined) value.insurer_name = insurerName
  }
  return value
}

export function parseFinanceDisclosure(raw: unknown): FinanceDisclosure | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const state = candidate.state
  if (!FINANCE_DISCLOSURE_STATES.includes(state as FinanceDisclosureState)) return null
  const value: FinanceDisclosure = { state: state as FinanceDisclosureState }
  const financeType = candidate.finance_type
  if (FINANCE_TYPES.includes(financeType as FinanceType)) value.finance_type = financeType as FinanceType
  const lenderName = cleanString(candidate.lender_name)
  if (lenderName !== undefined) value.lender_name = lenderName
  return value
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// GOVERNED finance obligation / encumbrance (Track 1). The counterpart to the SELLER-STATED
// block above, and deliberately a separate type: the payload attributes them differently
// (`authority: 'governed'` vs `'seller_stated'`) and the UI must never let one stand in for the
// other. Mirrors backend/utils/publicVehicleProjection.js — private banking terms have no field
// to travel in here, so a leak upstream still cannot render.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const OBLIGATION_STATES = ['active', 'settlement_pending', 'settled_pending_release', 'released', 'disputed'] as const
export const OBLIGATION_SOURCE_STATES = ['available', 'unavailable'] as const

export type ObligationState = typeof OBLIGATION_STATES[number]
export type ObligationSourceState = typeof OBLIGATION_SOURCE_STATES[number]

/** Neutral by construction: no word here accuses anyone of anything. */
export const OBLIGATION_STATE_LABELS: Record<ObligationState, string> = {
  active: 'Lender interest recorded — settlement required before transfer',
  settlement_pending: 'Settlement in progress',
  settled_pending_release: 'Settlement recorded — lender release confirmation outstanding',
  released: 'Lender interest released',
  disputed: 'Recorded obligation is under review',
}

export const VALUATION_SOURCE_LABELS: Record<string, string> = {
  lender_valuation: 'Lender valuation',
  independent_valuer: 'Independent valuer',
  insurer_valuation: 'Insurer valuation',
  auction_result: 'Auction result',
  customs_declared_value: 'Customs declared value',
}

export interface FinanceObligationValuation {
  amount: number
  currency: string
  date: string
  source: string
}

export interface FinanceObligation {
  id: string | null
  state: ObligationState
  obligation_kind: FinanceType
  transfer_condition: string | null
  superseded: boolean
  lender_name?: string
  valuation_at_origination?: FinanceObligationValuation
  cleared_on?: string
  released_on?: string
  recorded_on?: string
}

export interface FinanceObligationBlock {
  authority: 'governed'
  source_state: ObligationSourceState
  obligations: FinanceObligation[]
}

/**
 * Never-repair parser. Anything outside the closed vocabularies is dropped rather than coerced,
 * and an unreadable/absent block resolves to `source_state: 'unavailable'` — never to an empty
 * "available" result, which a reader would render as "no finance", i.e. absence-as-fact.
 */
export function parseFinanceObligationBlock(raw: unknown): FinanceObligationBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.authority !== 'governed') return null
  const sourceState = candidate.source_state
  if (!OBLIGATION_SOURCE_STATES.includes(sourceState as ObligationSourceState)) return null

  const rows = Array.isArray(candidate.obligations) ? candidate.obligations : []
  const obligations: FinanceObligation[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const entry = row as Record<string, unknown>
    if (!OBLIGATION_STATES.includes(entry.state as ObligationState)) continue
    if (!FINANCE_TYPES.includes(entry.obligation_kind as FinanceType)) continue
    const value: FinanceObligation = {
      id: typeof entry.id === 'string' ? entry.id : null,
      state: entry.state as ObligationState,
      obligation_kind: entry.obligation_kind as FinanceType,
      transfer_condition: typeof entry.transfer_condition === 'string' ? entry.transfer_condition : null,
      superseded: entry.superseded === true,
    }
    const lenderName = cleanString(entry.lender_name)
    if (lenderName !== undefined) value.lender_name = lenderName
    const valuation = entry.valuation_at_origination as Record<string, unknown> | undefined
    if (valuation && typeof valuation === 'object' && typeof valuation.amount === 'number'
        && typeof valuation.currency === 'string' && typeof valuation.date === 'string'
        && typeof valuation.source === 'string') {
      value.valuation_at_origination = {
        amount: valuation.amount, currency: valuation.currency,
        date: valuation.date, source: valuation.source,
      }
    }
    const clearedOn = cleanString(entry.cleared_on)
    if (clearedOn !== undefined) value.cleared_on = clearedOn
    const releasedOn = cleanString(entry.released_on)
    if (releasedOn !== undefined) value.released_on = releasedOn
    const recordedOn = cleanString(entry.recorded_on)
    if (recordedOn !== undefined) value.recorded_on = recordedOn
    obligations.push(value)
  }
  return { authority: 'governed', source_state: sourceState as ObligationSourceState, obligations }
}
