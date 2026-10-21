/**
 * Customer-facing wording for CarUp's public Trust record (`MarketplacePublicTrust`).
 *
 * The backend Trust record is the only authority. This module words that record for a buyer and does
 * nothing else: it never raises, lowers or infers a score, band, confidence or fact, and it never shows
 * an internal reason code, column name or implementation term. Score, confidence, evidence support and
 * listing completeness are separate things and are presented separately.
 *
 * Shared by web and Native so both surfaces say the same thing about the same record.
 */

export type TrustEvidenceBasisLike = {
  governed_facts_total?: number | null
  governed_facts_substantiated?: number | null
  governed_facts_adverse?: number | null
  connected_sources?: number | null
  unbacked_legacy_claims?: number | null
} | null | undefined

export type PublicTrustLike = {
  score?: number | null
  band?: string | null
  evaluation_state?: string | null
  confidence?: string | null
  evidence_basis?: TrustEvidenceBasisLike
  known_limitations?: readonly string[] | null
} | null | undefined

export type TrustConfidenceLevel = 'high' | 'medium' | 'low' | 'not_evaluated' | 'not_recorded'

export interface CustomerTrustRow {
  key: 'confidence' | 'evidence_support' | 'connected_sources'
  label: string
  value: string
}

export interface CustomerTrustPresentation {
  /** True only when the record is evaluated and carries a numeric score. */
  evaluated: boolean
  confidenceLevel: TrustConfidenceLevel
  /** e.g. "Low" */
  confidenceValue: string
  /** e.g. "0 of 7 vehicle facts independently confirmed" */
  evidenceSupportValue: string
  substantiatedFacts: number | null
  governedFactsTotal: number | null
  /** e.g. "0" */
  connectedSourcesValue: string
  connectedSources: number | null
  /** Label/value rows to show beside a score: confidence, evidence support, connected sources. */
  rows: CustomerTrustRow[]
  /** Customer-facing limitation sentences, de-duplicated, in the record's order. */
  limitations: string[]
  /** How many limitation lines the Trust record carried (before wording and de-duplication). */
  limitationCount: number
}

const CONFIDENCE_VALUE: Record<TrustConfidenceLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  not_evaluated: 'Not evaluated',
  not_recorded: 'Not recorded',
}

const EXACT: Record<string, string> = {
  'No live government/partner source is connected for this vehicle yet.':
    'No government or partner record is connected for this vehicle yet.',
  'Some source results are SANDBOX demonstrations, not live government confirmations.':
    'Some results come from test demonstrations, not live government records.',
  'Some source results come from a partner-file import or a CarUp manual review. They are recorded with their provenance, but they are not connected authoritative sources and do not raise the score.':
    'Some results come from a partner file or a CarUp review. They are recorded, but they are not live official sources and do not raise the score.',
  'Zimbabwe registration stage has not been established from a recorded claim.':
    'Zimbabwe registration status has not been recorded for this vehicle.',
  'Zimbabwe local registration is still in progress; this is a readiness limitation, not an adverse Trust finding.':
    'Zimbabwe registration is still in progress. This is not held against the vehicle.',
  'This is recorded as a temporary foreign vehicle under TIP; ordinary sale eligibility requires review.':
    'This vehicle is recorded as temporarily imported (TIP). CarUp must review it before an ordinary sale.',
  'No canonical trust evaluation exists for this vehicle.':
    'CarUp has not evaluated Trust for this vehicle yet.',
  'A trust score is stored for this vehicle but carries no calculation version — it predates the canonical trust authority and is not published.':
    'An older Trust score exists for this vehicle, but it came from a retired method, so CarUp does not show it.',
  'The canonical trust evaluation could not be produced for this vehicle, so no score is reported.':
    'CarUp could not produce a Trust result for this vehicle right now.',
  'Governed fact provenance was not resolved for this evaluation.':
    "CarUp could not confirm where this vehicle's records came from for this result.",
  'No governed vehicle fact is backed by an authoritative record.':
    "None of this vehicle's facts has been confirmed against an official record yet.",
  'The trust decision carries no evaluation timestamp, so it cannot be shown to be current.':
    'CarUp cannot show when this Trust result was produced, so it may not be current.',
  'The trust decision did not produce a usable score and band, so none is published.':
    'CarUp could not produce a usable Trust result for this vehicle.',
  'The cached trust evaluation is incomplete and is not published as canonical.':
    "This vehicle's Trust result is incomplete, so CarUp does not show it.",
  'The canonical trust projection failed its own contract check, so no trust score is published for this vehicle.':
    'CarUp could not produce a reliable Trust result for this vehicle, so no score is shown.',
}

const NOT_EVALUATED_CHECK = /^(dealer compliance|insurance eligibility|finance eligibility|escrow eligibility) has not been evaluated for this vehicle\.$/i
const CHECK_NAME: Record<string, string> = {
  'dealer compliance': 'dealer',
  'insurance eligibility': 'insurance',
  'finance eligibility': 'finance',
  'escrow eligibility': 'SafePay',
}
const UNBACKED_STORED_FLAG = /^The stored '[^']+' flag on this vehicle is not supported by any authoritative record and is not published\.$/
const STALE_VERSION = /^The stored trust score was produced by calculation version .+; the current version is .+\. It is not published as canonical\.$/
const REASON_CODE = /^reason:/

const UNBACKED_STORED_FLAG_SENTENCE = 'A stored vehicle check is not backed by an official record, so CarUp does not show it.'
const STALE_SENTENCE = "This vehicle's Trust result is out of date and is waiting to be refreshed."
const UNRECOGNISED_SENTENCE = 'Some checks for this vehicle are not complete yet.'

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function capitalise(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text
}

/**
 * The Trust rules a published score was calculated under, worded for a customer. The version stays visible
 * (a number without the rules it came from has no provenance), but the internal identifier format does not:
 * `trust-decision-1.1.0` reads "Trust rules version 1.1.0". Anything else is stated as received.
 */
export function customerTrustRulesVersion(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim()
  const semver = value.match(/^trust-decision-v?(\d+(?:\.\d+){0,2})$/i)
  if (semver) return `Trust rules version ${semver[1]}`
  return value ? `Trust rules version ${value}` : 'Trust rules version not recorded'
}

/** Customer-facing wording for one limitation line, or null when the line must never be shown (reason codes). */
export function customerTrustLimitation(raw: string): string | null {
  const line = String(raw ?? '').trim()
  if (!line || REASON_CODE.test(line)) return null
  if (EXACT[line]) return EXACT[line]
  if (UNBACKED_STORED_FLAG.test(line)) return UNBACKED_STORED_FLAG_SENTENCE
  if (STALE_VERSION.test(line)) return STALE_SENTENCE
  const check = line.match(NOT_EVALUATED_CHECK)
  if (check) return `${capitalise(CHECK_NAME[check[1].toLowerCase()])} checks have not been done for this vehicle yet.`
  return UNRECOGNISED_SENTENCE
}

/** All limitation lines worded for a customer: reason codes dropped, the four "not evaluated" checks grouped, duplicates removed. */
export function customerTrustLimitations(raw: readonly string[] | null | undefined): string[] {
  const lines = Array.isArray(raw) ? raw : []
  const out: string[] = []
  const pendingChecks: string[] = []
  let checksSlot = -1
  for (const item of lines) {
    const check = String(item ?? '').trim().match(NOT_EVALUATED_CHECK)
    if (check) {
      const name = CHECK_NAME[check[1].toLowerCase()]
      if (!pendingChecks.includes(name)) pendingChecks.push(name)
      if (checksSlot === -1) {
        checksSlot = out.length
        out.push('')
      }
      continue
    }
    const worded = customerTrustLimitation(String(item ?? ''))
    if (worded && !out.includes(worded)) out.push(worded)
  }
  if (checksSlot !== -1) {
    out[checksSlot] = `${capitalise(joinNatural(pendingChecks))} checks have not been done for this vehicle yet.`
  }
  return out.filter(Boolean)
}

function confidenceLevel(value: unknown): TrustConfidenceLevel {
  const key = String(value ?? '').toLowerCase()
  return key === 'high' || key === 'medium' || key === 'low' || key === 'not_evaluated'
    ? key
    : 'not_recorded'
}

export function presentTrustForCustomer(trust: PublicTrustLike): CustomerTrustPresentation {
  const basis = trust?.evidence_basis ?? null
  const substantiated = count(basis?.governed_facts_substantiated)
  const total = count(basis?.governed_facts_total)
  const connected = count(basis?.connected_sources)
  const level = confidenceLevel(trust?.confidence)
  const evidenceSupportValue = substantiated !== null && total !== null
    ? `${substantiated} of ${total} vehicle facts independently confirmed`
    : 'Not recorded'
  const connectedSourcesValue = connected === null ? 'Not recorded' : String(connected)
  const rawLimitations = Array.isArray(trust?.known_limitations) ? trust!.known_limitations! : []
  return {
    evaluated: trust?.evaluation_state === 'evaluated' && typeof trust?.score === 'number',
    confidenceLevel: level,
    confidenceValue: CONFIDENCE_VALUE[level],
    evidenceSupportValue,
    substantiatedFacts: substantiated,
    governedFactsTotal: total,
    connectedSourcesValue,
    connectedSources: connected,
    rows: [
      { key: 'confidence', label: 'Confidence', value: CONFIDENCE_VALUE[level] },
      { key: 'evidence_support', label: 'Evidence support', value: evidenceSupportValue },
      { key: 'connected_sources', label: 'Connected official sources', value: connectedSourcesValue },
    ],
    limitations: customerTrustLimitations(rawLimitations),
    limitationCount: rawLimitations.filter(line => !REASON_CODE.test(String(line ?? '').trim())).length,
  }
}
