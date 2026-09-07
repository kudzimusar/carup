/**
 * Trade OS T11 — how movement facts are allowed to be worded on screen.
 *
 * A pure module, for the same two reasons as its T9 and T10 siblings: a component file may export
 * nothing else, and these sentences are the part of T11 a customer actually reads.
 *
 * Four distinctions the wording exists to keep visible, because collapsing any of them turns a
 * tracking page into a lie:
 *
 *     PLANNED departure   ≠ OBSERVED departure   — an intention is not a sailing
 *     ETA                 ≠ ACTUAL ARRIVAL        — an estimate is not an event
 *     a carrier reference ≠ movement              — a booking number is not a ship leaving
 *     a customs HOLD      ≠ a customs DECISION    — where the goods are, not what was decided
 */

/** The participant's own state, in their words. */
export const TRACKING_STATE_UI: Record<string, { label: string; tone: string }> = {
  NOT_LOADED: { label: 'Not loaded yet', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
  LOADED: { label: 'Loaded — not sailed', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  SHIPMENT_CREATED: { label: 'Shipment set up — nothing moving yet', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  IN_TRANSIT: { label: 'On its way', tone: 'border-sky-300 bg-sky-50 text-sky-900' },
  ARRIVED: { label: 'Arrived', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  EXCEPTION: { label: 'Something has happened', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  LEFT_BEHIND: { label: 'Not on this container', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
}

/**
 * The movement stages, in the words an operator uses.
 *
 * `CUSTOMS_HOLD` is deliberately worded as a place the goods are stuck, not as a customs process.
 * T11 records that a hold exists; what customs decided is T12's and is not knowable here.
 */
export const STAGE_UI: Record<string, string> = {
  PLANNED: 'Planned',
  BOOKED: 'Booked with the carrier',
  LOADING: 'Being loaded',
  IN_TRANSIT: 'On its way',
  ARRIVED: 'Arrived',
  CUSTOMS_HOLD: 'Held at customs',
  RELEASED: 'Released',
  COMPLETED: 'Finished',
  EXCEPTION: 'Something happened',
}

/** The sentence that keeps a set-up shipment from being read as a departure. */
export const REFERENCE_IS_NOT_MOVEMENT =
  'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.'

/** The sentence that keeps T11 out of T12's territory. */
export const CUSTOMS_IS_ELSEWHERE =
  'Customs, duties and release are recorded separately and are not shown here.'

export const shortRef = (id: string): string => String(id).replace(/-/g, '').slice(0, 8).toUpperCase()

/** A date, or the honest absence of one. `null` never becomes "—" beside a populated sibling. */
export function when(iso: string | null | undefined): string {
  if (!iso) return 'Not recorded'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** A date that is explicitly an estimate, so it can never be read as an event. */
export function estimated(iso: string | null | undefined): string {
  if (!iso) return 'No estimate given'
  return `Estimated ${new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
}

/**
 * How a departure should read, given both dates.
 *
 * The case that matters is a planned date in the past with nothing observed: the ship was *meant* to
 * have left. Saying "departed 20 September" there would be inventing the event.
 */
export function describeDeparture(dates: { planned_departure: string | null; observed_departure: string | null } | null):
{ headline: string; detail: string; observed: boolean } {
  if (!dates) return { headline: 'Not recorded', detail: '', observed: false }
  if (dates.observed_departure) {
    return { headline: `Departed ${when(dates.observed_departure)}`, detail: 'Recorded by the organiser as an actual departure.', observed: true }
  }
  if (dates.planned_departure) {
    return {
      headline: 'Not recorded as departed',
      detail: `It was planned to leave around ${new Date(dates.planned_departure).toLocaleDateString(undefined, { dateStyle: 'medium' })}. That is a plan, not a record that it left.`,
      observed: false,
    }
  }
  return { headline: 'Not recorded as departed', detail: 'No departure has been recorded.', observed: false }
}

/**
 * How an arrival should read.
 *
 * An ETA in the past is still an ETA. This is the sibling of the departure case and the more
 * tempting one to get wrong, because a customer looking at a past estimate will assume it arrived.
 */
export function describeArrival(dates: { estimated_arrival: string | null; observed_arrival: string | null } | null):
{ headline: string; detail: string; observed: boolean } {
  if (!dates) return { headline: 'Not recorded', detail: '', observed: false }
  if (dates.observed_arrival) {
    return { headline: `Arrived ${when(dates.observed_arrival)}`, detail: 'Recorded by the organiser as an actual arrival.', observed: true }
  }
  if (dates.estimated_arrival) {
    return {
      headline: 'Not recorded as arrived',
      detail: `${estimated(dates.estimated_arrival)}. An estimate can move, and it is not a record that anything arrived.`,
      observed: false,
    }
  }
  return { headline: 'Not recorded as arrived', detail: 'No arrival has been recorded.', observed: false }
}
