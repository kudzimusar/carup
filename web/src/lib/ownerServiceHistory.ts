/**
 * Owner service-history presentation — the ONE place service truth is formatted.
 *
 * Owner Service History and the Vehicle Passport must not describe the same service differently.
 * They did: the Passport derived its own service list from the lifecycle timeline, filtered to
 * legacy `workorder:` events, which carry no provider, no cost and no mileage. For a service the
 * governed projection recorded as "SN Cert Garage, ZIG 250, 91,000 km observed" the Passport
 * published "Garage not recorded • Mileage not recorded • $0" — reintroducing on the buyer-facing
 * surface the exact three truth debts S6 was built to retire, and stamping a US dollar sign onto a
 * ZiG amount.
 *
 * Both surfaces now read `/api/service-history/me` — the governed owner projection — and format it
 * through this module, so parity is structural rather than a coincidence two components maintain
 * separately.
 *
 * The rules, in one place:
 *   - money is shown only when BOTH the amount and its currency are known;
 *   - an unrecorded cost is stated as unrecorded, never as zero, and never given a currency;
 *   - a total is only meaningful within a single currency;
 *   - an unknown provider is "not recorded", never the generic literal "Garage";
 *   - mileage is an OBSERVATION, never presented as the vehicle's canonical odometer.
 */

export type ServiceProvider = { known: boolean; display_name: string | null; slug: string | null }
export type ServiceCost = { recorded: boolean; amount: number | null; currency: string | null }
export type MileageObservation = { observed_mileage: number; observed_at: string; source: string } | null

export type ServiceHistoryEntry = {
  id: string
  vin: string
  status: string
  description: string | null
  issue_description: string | null
  service_category: string | null
  work_performed: string | null
  provenance: string
  provider: ServiceProvider
  cost: ServiceCost
  completed_at: string | null
  performed_at: string | null
  created_at: string
  mileage_observation: MileageObservation
}

export const PROVENANCE_LABELS: Record<string, string> = {
  owner_declared: 'Owner declared',
  garage_stated: 'Garage stated',
  mechanic_attributed: 'Mechanic attributed',
  professional_governed: 'Professionally governed',
  evidence_backed: 'Evidence backed',
  partner_record: 'Partner record',
  unknown: 'Source not recorded',
}

export function provenanceLabel(provenance: string | null | undefined): string {
  return PROVENANCE_LABELS[String(provenance ?? '')] || PROVENANCE_LABELS.unknown
}

/** Money, or an honest statement that it was not recorded. Never a currency-less number. */
export function formatCost(cost: ServiceCost | null | undefined): string {
  if (!cost || !cost.recorded || cost.amount === null || cost.amount === undefined || !cost.currency) {
    return 'Cost not recorded'
  }
  return `${cost.currency} ${cost.amount.toLocaleString()}`
}

/** The provider's name, or an honest absence. Never the generic word "Garage". */
export function providerLabel(provider: ServiceProvider | null | undefined): string {
  if (!provider || !provider.known || !provider.display_name) return 'Provider not recorded'
  return provider.display_name
}

/** The observation, explicitly labelled as observed so it cannot read as canonical odometer truth. */
export function mileageObservationLabel(observation: MileageObservation): string | null {
  if (!observation || typeof observation.observed_mileage !== 'number') return null
  return `${observation.observed_mileage.toLocaleString()} km observed`
}

export function describeService(entry: ServiceHistoryEntry): string {
  return entry.work_performed || entry.description || entry.issue_description || ''
}

export function serviceDate(entry: ServiceHistoryEntry): string {
  const raw = entry.performed_at || entry.completed_at || entry.created_at
  if (!raw) return 'Date not recorded'
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? 'Date not recorded' : parsed.toLocaleDateString()
}

export type SpendSummary = {
  /** Recorded total, only when every recorded cost shares one currency. */
  total: number | null
  currency: string | null
  /** More than one currency present — a single total would be meaningless. */
  mixedCurrency: boolean
  /** Services whose cost the platform does not know. Never folded into the total as zero. */
  unrecordedCount: number
  label: string
}

/**
 * Summarise spend without inventing a number.
 *
 * The Passport previously did `reduce((a, s) => a + (s.cost ?? 0), 0)` and printed the result with a
 * `$`, so a vehicle whose only service cost ZiG 250 was published as having cost `$0`. Unknown is
 * not zero, and a sum across currencies is not a sum.
 */
export function summariseSpend(entries: ServiceHistoryEntry[]): SpendSummary {
  const recorded = entries.filter((e) => e.cost?.recorded && e.cost.currency && e.cost.amount !== null)
  const currencies = [...new Set(recorded.map((e) => e.cost.currency as string))]
  const unrecordedCount = entries.length - recorded.length

  if (currencies.length === 1) {
    const total = recorded.reduce((a, e) => a + (e.cost.amount || 0), 0)
    return {
      total,
      currency: currencies[0],
      mixedCurrency: false,
      unrecordedCount,
      label: `${currencies[0]} ${total.toLocaleString()}`,
    }
  }
  if (currencies.length > 1) {
    return { total: null, currency: null, mixedCurrency: true, unrecordedCount, label: 'Multiple currencies' }
  }
  return { total: null, currency: null, mixedCurrency: false, unrecordedCount, label: 'Not recorded' }
}

/** Entries for one vehicle, newest first. */
export function entriesForVin(entries: ServiceHistoryEntry[], vin: string): ServiceHistoryEntry[] {
  return entries
    .filter((e) => e.vin === vin)
    .sort((a, b) => {
      const at = Date.parse(a.performed_at || a.completed_at || a.created_at || '') || 0
      const bt = Date.parse(b.performed_at || b.completed_at || b.created_at || '') || 0
      return bt - at
    })
}
