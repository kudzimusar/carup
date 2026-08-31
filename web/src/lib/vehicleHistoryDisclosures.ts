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
