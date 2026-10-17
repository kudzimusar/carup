/**
 * Trade OS T12 — the sentences a person reads about customs and their cargo's arrival.
 *
 * This file is where the phase is won or lost in front of a human. The backend can attribute every
 * claim perfectly and it still fails if a screen renders "Agent reported the goods were released" as
 * a green tick labelled **Cleared**.
 *
 * Three rules run through all of it:
 *
 *   1. **A claim never reads stronger than its source.** An amount from an assessment document and
 *      the same amount typed by an agent get DIFFERENT WORDS, not the same words with a badge.
 *   2. **Unknown is unknown.** Nothing not recorded becomes "no", "nil", "0" or "complete".
 *   3. **Government terminology never leads.** A person reads "Waiting for the assessment", not
 *      "ASSESSMENT_EVIDENCE_RECEIVED: NOT_RECORDED".
 */

export type SourceStrength = 'OBSERVED' | 'AUTHORITY_EVIDENCE' | 'REPORTED' | 'SUPPLIED'
export type StepState = 'EVIDENCED' | 'REPORTED' | 'NOT_RECORDED'

export interface CustomsStep {
  key: string
  label: string
  state: StepState
  at: string | null
  needed?: string | null
  source_strength?: SourceStrength | null
}

export interface CustomsAssessment {
  assessed: boolean
  amount: number | null
  currency: string | null
  headline: string
  detail: string
  source: string | null
  source_strength: SourceStrength | null
  assessment_date: string | null
  customs_rate: {
    value: number; basis: string | null; source: string
    effective_from: string; effective_to: string | null; note: string
  } | null
}

export interface CustomsEventLine {
  id?: string
  event_type: string
  sentence: string
  strength: SourceStrength
  provenance?: string
  attributed_to?: string
  has_document?: boolean
  event_time: string
  location: string | null
  notes?: string | null
  recorded_by?: string
  recorded_at?: string
}

export interface CustomsHandoffs {
  gateway: { port: string | null; country: string | null; arrived_at: string | null; observed: boolean }
  transit_started_at: string | null
  destination: { country: string | null; city: string | null; final_destination: string | null; arrived_at: string | null; observed: boolean }
  collected_at: string | null
  delivered_at: string | null
  note: string
}

export interface CustomsCaseWorkspace {
  case: { id: string; reference: string; status: string; cargo_kind: string; subject: { type: string; id: string }; shipment_id: string | null; import_order_id: string | null }
  viewer_relationship: string
  agent: { id: string; display_name: string; scope: string; appointed_at: string; licence_reference_claimed: string | null; licence_note: string } | null
  agent_note: string | null
  handoffs: CustomsHandoffs
  checklist: CustomsStep[]
  assessment: CustomsAssessment
  payment: { evidence_received: boolean; headline: string; detail: string; amount: number | null; currency: string | null; source_strength: SourceStrength | null; received_at?: string }
  release: { evidence_received: boolean; headline: string; detail: string; source_strength: SourceStrength | null; received_at?: string }
  open_actions: Array<{ key: string; label: string; needed: string | null }>
  timeline: CustomsEventLine[]
  vehicle: { note: string; evidence_available: string[] } | null
  note: string
  unknown_note: string
}

export interface MyCustomsStatus {
  subject: { type: string; id: string }
  state: string
  reference?: string
  sentence: string
  agent: { display_name: string; note: string } | null
  agent_note: string | null
  checklist: CustomsStep[] | null
  assessment: CustomsAssessment | null
  payment: CustomsCaseWorkspace['payment'] | null
  release: CustomsCaseWorkspace['release'] | null
  handoffs: CustomsHandoffs | null
  timeline: Array<{ event_type: string; sentence: string; strength: SourceStrength; event_time: string; location: string | null }>
  next_action: string
  note: string
  unknown_note: string
}

/** Unknown is never a date, and never a dash sitting where a date would be. */
export function when(value?: string | null): string {
  if (!value) return 'Not recorded'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Not recorded'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function day(value?: string | null): string {
  if (!value) return 'Not recorded'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Not recorded'
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/**
 * A step, in the words a person uses.
 *
 * Three states, never two. "Not recorded" is not "no": a checkbox with two states turns an absence
 * of evidence into a finding, which is the same mistake as an unassessed duty rendering as zero.
 */
export const STEP_STATE_UI: Record<StepState, { label: string; tone: 'done' | 'partial' | 'waiting' }> = {
  EVIDENCED: { label: 'Evidenced', tone: 'done' },
  REPORTED: { label: 'Reported, no document', tone: 'partial' },
  NOT_RECORDED: { label: 'Not recorded yet', tone: 'waiting' },
}

/**
 * How strong the claim behind a line is.
 *
 * `REPORTED` deliberately reads as a caveat rather than a rank, because a customer skimming a list
 * of ticks will not read a number.
 */
export const STRENGTH_UI: Record<SourceStrength, { label: string; explains: string }> = {
  OBSERVED: { label: 'Seen by the handler', explains: 'Recorded by the person who physically handled the cargo.' },
  AUTHORITY_EVIDENCE: { label: 'Authority document', explains: 'Taken from a document issued by the authority and attached to this case.' },
  REPORTED: { label: 'Reported — no document', explains: 'Told to us by the clearing agent. Nothing has been attached to support it.' },
  SUPPLIED: { label: 'Document supplied', explains: 'A document supplied by the importer or a third party. Not confirmed by the authority.' },
}

/**
 * The line a person reads about the assessed amount.
 *
 * The case that carries this file: an amount exists, and the question is whether the product is
 * entitled to call it the authority's. `projectAssessment` on the server already decides; this
 * refuses to flatten the two answers back together.
 */
export function describeAssessment(assessment?: CustomsAssessment | null): {
  headline: string; amount: string; detail: string; authoritative: boolean
} {
  if (!assessment || !assessment.assessed) {
    return {
      headline: 'Duty and tax',
      // Never "0", never "—". An unassessed consignment has no amount, and saying so is the answer.
      amount: 'Not yet assessed',
      detail: assessment?.detail || 'No assessment has been received. CarUp does not calculate duty or tax.',
      authoritative: false,
    }
  }
  const authoritative = assessment.source_strength === 'AUTHORITY_EVIDENCE'
  return {
    headline: assessment.headline,
    amount: `${assessment.currency} ${Number(assessment.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    detail: assessment.detail,
    authoritative,
  }
}

/** The customs rate line. It travels with its source and its period, or it does not travel. */
export function describeCustomsRate(assessment?: CustomsAssessment | null): { known: boolean; headline: string; detail: string } {
  const rate = assessment?.customs_rate
  if (!rate) {
    return {
      known: false,
      headline: 'Customs exchange rate: not recorded',
      // The removed forgery hardcoded 13.5 with no date and no source. The honest alternative to an
      // unsourced rate is no rate.
      detail: 'No customs exchange rate has been supplied with an assessment. A rate is only shown when its source and effective date come with it.',
    }
  }
  const period = rate.effective_to ? `${day(rate.effective_from)} to ${day(rate.effective_to)}` : `from ${day(rate.effective_from)}`
  return {
    known: true,
    headline: `Customs exchange rate ${rate.value}${rate.basis ? ` (${rate.basis})` : ''}`,
    detail: `${rate.source} · effective ${period}. ${rate.note}`,
  }
}

/**
 * §L — a gateway is not a destination.
 *
 * Each handoff gets its own sentence. Collapsing them is the single easiest way for this screen to
 * tell somebody their car is in Harare when it is on a quay in Beira.
 */
export function describeHandoffs(h?: CustomsHandoffs | null): Array<{ key: string; label: string; value: string; observed: boolean }> {
  if (!h) return []
  return [
    { key: 'gateway', label: `Arrived at the gateway port${h.gateway.port ? ` (${h.gateway.port})` : ''}`, value: when(h.gateway.arrived_at), observed: h.gateway.observed },
    { key: 'transit', label: 'Left the gateway for the destination', value: when(h.transit_started_at), observed: Boolean(h.transit_started_at) },
    { key: 'destination', label: `Arrived at the destination${h.destination.city ? ` (${h.destination.city})` : ''}`, value: when(h.destination.arrived_at), observed: h.destination.observed },
    { key: 'collected', label: 'Collected', value: when(h.collected_at), observed: Boolean(h.collected_at) },
    { key: 'delivered', label: 'Delivered', value: when(h.delivered_at), observed: Boolean(h.delivered_at) },
  ]
}

/** Plain-language step labels. Never the event-type constant, never a table name. */
export const STEP_LABEL: Record<string, string> = {
  DOCUMENTS: 'Documents',
  LODGEMENT: 'Declaration lodged',
  ASSESSMENT: 'Assessment',
  PAYMENT: 'Payment',
  RELEASE: 'Release',
  PORT_RELEASE: 'Left the port',
  COLLECTION: 'Collected',
  DELIVERY: 'Delivered',
}

/**
 * What the operator may record, and what each one WRITES.
 *
 * Every hint names the fact, so nobody picks an entry believing it does something else. There is no
 * entry that asserts a customs decision on the authority's behalf, and there is deliberately none
 * for vehicle registration.
 */
export const RECORDABLE_CUSTOMS_EVENTS: Array<{ value: string; label: string; hint: string; needsSource: boolean }> = [
  { value: 'DOCUMENT_REQUESTED', label: 'Ask for a document', hint: 'Records that you asked. Nothing has been supplied.', needsSource: true },
  { value: 'DOCUMENT_PROVIDED', label: 'A document was provided', hint: 'Records that a document exists. Presence is presence — nobody has accepted it.', needsSource: true },
  { value: 'LODGEMENT_REPORTED', label: 'Agent reported the declaration lodged', hint: 'Records what the agent told you. CarUp did not lodge it and cannot confirm it.', needsSource: true },
  { value: 'QUERY_RAISED', label: 'A query was raised', hint: 'Records a query or action request against the consignment.', needsSource: true },
  { value: 'INSPECTION_EVIDENCE_RECEIVED', label: 'Inspection evidence received', hint: 'Records evidence of an inspection.', needsSource: true },
  { value: 'ASSESSMENT_EVIDENCE_RECEIVED', label: 'Assessment evidence received', hint: 'Records the amount FROM the evidence. CarUp calculates nothing. Attach the document to record it as the authority\'s figure.', needsSource: true },
  { value: 'PAYMENT_EVIDENCE_RECEIVED', label: 'Payment evidence received', hint: 'Records that proof of payment exists. That is not the authority confirming the account is settled.', needsSource: true },
  { value: 'RELEASE_EVIDENCE_RECEIVED', label: 'Release evidence received', hint: 'Records that a release document was received. CarUp does not release goods.', needsSource: true },
  { value: 'GATEWAY_ARRIVAL_OBSERVED', label: 'Seen at the gateway port', hint: 'A physical observation. The gateway is not the destination.', needsSource: false },
  { value: 'TRANSIT_TO_DESTINATION_STARTED', label: 'Left the gateway for the destination', hint: 'A physical observation.', needsSource: false },
  { value: 'DESTINATION_ARRIVAL_OBSERVED', label: 'Seen at the destination', hint: 'A physical observation. Arriving is not being released.', needsSource: false },
  { value: 'PORT_RELEASE_OBSERVED', label: 'Left the port or depot', hint: 'A physical movement, not a customs decision.', needsSource: false },
  { value: 'COLLECTION_OBSERVED', label: 'Collected', hint: 'Records who collected the goods, and when.', needsSource: false },
  { value: 'DELIVERY_OBSERVED', label: 'Delivered', hint: 'Records delivery to a receiver who acknowledged it. For a vehicle, delivery is not registration.', needsSource: false },
]

export const SOURCE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'AUTHORITY_DOCUMENT', label: 'A document from the authority', hint: 'Requires the document to be attached. Only this reads as the authority\'s own figure.' },
  { value: 'AGENT_REPORT', label: 'The clearing agent told me', hint: 'Recorded and shown as the agent\'s report, not the authority\'s.' },
  { value: 'IMPORTER_DOCUMENT', label: 'A document from the importer', hint: 'Shown as supplied by the importer and not confirmed by the authority.' },
  { value: 'THIRD_PARTY_DOCUMENT', label: 'A document from someone else', hint: 'Shown as supplied by a third party.' },
]

export const CARUP_IS_NOT_ZIMRA =
  'CarUp coordinates customs. It does not assess duty, does not clear goods, and is not ZIMRA. Every line says who told us and what it rests on.'

export const GATEWAY_IS_NOT_DESTINATION =
  'Arriving at the gateway port is not arriving in the destination country, and neither is being released, collected or delivered. Each is recorded separately.'

export const NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED =
  'Anything not shown here has not been recorded. That is not the same as it being nil, refused, or complete.'

export const LICENCE_UNVERIFIED =
  'CarUp has not verified this licence reference with the authority. It is what the appointing party supplied.'
