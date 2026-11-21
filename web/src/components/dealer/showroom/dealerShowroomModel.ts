/**
 * RX05-A — presentation-only helpers for the unified public dealership pages (directory, profile,
 * claim workspace). Nothing here fetches, decides authority or invents a fact: each function turns
 * fields the APIs already returned into the words and tones the showroom views use.
 *
 * Fail-closed rules:
 *  - A dealership reads as approved ONLY when the server says `business_verified` AND its tier (if
 *    returned) is FULL_DEALER_APPROVED. Anything contradictory falls back to the weaker standing.
 *  - A claim journey stage is "done" only for a status the server actually recorded. Submitted
 *    material is "waiting", never "done"; nothing is shown as approved before a decision exists.
 */
import { dealerInitials } from '@/components/dealer/profile/dealerProfileLabels'

export type ResearchTier = 'PRELISTED_UNCLAIMED' | 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED' | 'FULL_DEALER_APPROVED'
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** The public research projection, as returned by /dealership/research and /dealership/research/:id. */
export interface ShowroomDealer {
  seed_dealer_id: string
  slug: string
  name: string
  city: string
  category: string
  source_attribution: string
  reviewed_at: string
  label: string
  claimed: boolean
  business_verified: boolean
  tier?: string
  /** Returned by the API; older payloads may omit it. */
  revision?: number
  information_notice?: string
}

export type DealerStandingKey = 'approved' | 'claimed' | 'unclaimed'

export interface DealerStanding {
  key: DealerStandingKey
  /** Short chip text. */
  chip: string
  tone: StatusTone
  /** One plain sentence: what this standing means for a buyer. */
  meaning: string
}

const STANDINGS: Record<DealerStandingKey, DealerStanding> = {
  approved: {
    key: 'approved',
    chip: 'Independently reviewed dealership',
    tone: 'success',
    meaning: 'CarUp independently reviewed this dealership’s legal registration and current operating authority. Individual cars, franchises, lenders and warranties are not verified by that review.',
  },
  claimed: {
    key: 'claimed',
    chip: 'Claimed · public display not yet approved',
    tone: 'warning',
    meaning: 'A claim has been recorded for this business, but CarUp has not approved a public storefront. Current legal or operating approval cannot be inferred.',
  },
  unclaimed: {
    key: 'unclaimed',
    chip: 'Listed from public sources · not claimed',
    tone: 'neutral',
    meaning: 'CarUp published this entry from public research. The business has not claimed it, and its ownership, operation and stock are not verified.',
  },
}

export function dealerStanding(dealer: Pick<ShowroomDealer, 'claimed' | 'business_verified' | 'tier'>): DealerStanding {
  const tierAllowsApproval = dealer.tier === undefined || dealer.tier === null || dealer.tier === 'FULL_DEALER_APPROVED'
  if (dealer.business_verified === true && tierAllowsApproval) return STANDINGS.approved
  if (dealer.claimed === true || dealer.tier === 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED') return STANDINGS.claimed
  return STANDINGS.unclaimed
}

/** Filter-option wording for a tier the API lists in `available_tiers`. */
export function tierOptionLabel(tier: string): string {
  if (tier === 'FULL_DEALER_APPROVED') return STANDINGS.approved.chip
  if (tier === 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED') return STANDINGS.claimed.chip
  if (tier === 'PRELISTED_UNCLAIMED') return STANDINGS.unclaimed.chip
  return humanizeStatus(tier)
}

export function standingForTier(tier: string): DealerStanding | null {
  if (tier === 'FULL_DEALER_APPROVED') return STANDINGS.approved
  if (tier === 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED') return STANDINGS.claimed
  if (tier === 'PRELISTED_UNCLAIMED') return STANDINGS.unclaimed
  return null
}

export function dealerMonogram(name: string | null | undefined): string {
  return dealerInitials(name)
}

/** "CLAIM_APPROVED" → "Claim approved"; the country code ZW stays upper case. */
export function humanizeStatus(value: string | null | undefined): string {
  const words = String(value ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase().replace(/\bzw\b/g, 'ZW')
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Not recorded'
}

/** Cities the API has returned so far, de-duplicated and sorted, merged with what was already known. */
export function mergeCities(known: readonly string[], entries: ReadonlyArray<{ city?: string | null }>): string[] {
  const set = new Set(known)
  for (const entry of entries) {
    const city = typeof entry.city === 'string' ? entry.city.trim() : ''
    if (city) set.add(city)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/* ── Claim → compliance → legal → activation journey ─────────────────────── */

/** `unconfirmed` (F-03): the stage's outcome is not shown to this account, so it is neither done nor pending. */
export type JourneyState = 'done' | 'current' | 'waiting' | 'attention' | 'blocked' | 'upcoming' | 'unknown' | 'unconfirmed'
export type JourneyStageKey = 'claim' | 'application' | 'legal' | 'activation'

export interface JourneyStage {
  key: JourneyStageKey
  title: string
  state: JourneyState
  /** The real status, in words. */
  status: string
  detail?: string
}

export interface JourneyNextStep {
  stage: JourneyStageKey
  title: string
  body: string
  /** In-page section to jump to. */
  target?: string
  /** A route to open instead. */
  href?: string
  tone: StatusTone
}

export interface ClaimJourneyInput {
  claimStatus: string
  evidence: ReadonlyArray<{ quarantined?: boolean }>
  draft: { submission_version: number } | null
  submissions: ReadonlyArray<{ intake_version: number; preliminary_status: string; correction_reason: string | null }>
  authority: {
    state: string
    operational: boolean
    blocking_reasons?: string[]
    public_storefront_approved?: boolean
    vehicle_listing_authority_granted?: boolean
    attach_status?: string
  } | null
  /** False until the per-claim reads have settled at least once. */
  detailsLoaded: boolean
}

export interface ClaimJourney {
  stages: JourneyStage[]
  next: JourneyNextStep
}

const LEGAL_RECORDED_STATES = new Set([
  'CANONICAL_DEALER_ACTIVE', 'ATTACHED_TO_EXISTING_DEALERSHIP', 'DEALER_OPERATIONS_SUSPENDED', 'DEALER_OPERATIONS_WITHDRAWN',
])

export const CLAIM_SECTION_IDS = {
  evidence: 'claim-evidence',
  application: 'claim-application',
  submit: 'claim-submit',
  history: 'claim-history',
  authority: 'claim-authority',
  appeal: 'claim-appeal',
} as const

function plural(count: number, one: string, many = one + 's') {
  return count === 1 ? one : many
}

export function claimStatusTone(status: string): StatusTone {
  if (status === 'CLAIM_APPROVED') return 'success'
  if (status === 'CLAIM_REJECTED' || status === 'CLAIM_REVOKED') return 'danger'
  if (status === 'CLAIM_DISPUTED' || status === 'CLAIM_APPEALED') return 'info'
  return 'warning'
}

export function deriveClaimJourney(input: ClaimJourneyInput): ClaimJourney {
  const { claimStatus, evidence, draft, submissions, authority, detailsLoaded } = input
  const approved = claimStatus === 'CLAIM_APPROVED'
  const activeEvidence = evidence.filter(item => !item.quarantined).length

  // 1 — Ownership claim
  let claim: JourneyStage
  switch (claimStatus) {
    case 'AWAITING_DOCUMENTARY_EVIDENCE':
      claim = activeEvidence === 0
        ? { key: 'claim', title: 'Ownership claim', state: 'current', status: 'Awaiting your business-authority documents', detail: 'Nothing has been reviewed yet.' }
        : { key: 'claim', title: 'Ownership claim', state: 'waiting', status: `${activeEvidence} ${plural(activeEvidence, 'document')} submitted · awaiting independent review`, detail: 'Submitted documents are private and not yet reviewed.' }
      break
    case 'CLAIM_APPROVED':
      claim = { key: 'claim', title: 'Ownership claim', state: 'done', status: 'Claim approved', detail: 'Approval of the claim alone grants no dealer operations.' }
      break
    case 'CLAIM_DISPUTED':
      claim = { key: 'claim', title: 'Ownership claim', state: 'attention', status: 'Claim disputed', detail: 'You can add evidence or appeal.' }
      break
    case 'CLAIM_APPEALED':
      claim = { key: 'claim', title: 'Ownership claim', state: 'waiting', status: 'Appeal under independent review' }
      break
    case 'CLAIM_REJECTED':
      claim = { key: 'claim', title: 'Ownership claim', state: 'blocked', status: 'Claim rejected', detail: 'You may appeal with new evidence.' }
      break
    case 'CLAIM_REVOKED':
      claim = { key: 'claim', title: 'Ownership claim', state: 'blocked', status: 'Claim revoked', detail: 'You may appeal with new evidence.' }
      break
    default:
      claim = { key: 'claim', title: 'Ownership claim', state: 'unknown', status: humanizeStatus(claimStatus) }
  }

  // 2 — Compliance application (exists only after an approved claim)
  const latest = [...submissions].sort((a, b) => b.intake_version - a.intake_version)[0] ?? null
  let application: JourneyStage
  if (!approved) {
    application = { key: 'application', title: 'Dealer application', state: 'upcoming', status: 'Opens after your claim is approved' }
  } else if (!detailsLoaded) {
    application = { key: 'application', title: 'Dealer application', state: 'unknown', status: 'Checking…' }
  } else if (draft && (!latest || draft.submission_version > latest.intake_version)) {
    application = { key: 'application', title: 'Dealer application', state: 'current', status: `Version ${draft.submission_version} saved · not yet submitted` }
  } else if (!latest) {
    application = { key: 'application', title: 'Dealer application', state: 'current', status: 'Not started', detail: 'Use your prefilled workbook, a CSV, or enter it manually.' }
  } else if (latest.preliminary_status === 'NEEDS_CORRECTIONS' || latest.preliminary_status === 'EVIDENCE_REQUIRED' || latest.correction_reason) {
    application = {
      key: 'application', title: 'Dealer application', state: 'attention',
      status: `Version ${latest.intake_version} · ${latest.preliminary_status === 'EVIDENCE_REQUIRED' ? 'more evidence requested' : 'corrections requested'}`,
      detail: latest.correction_reason ? `Required action: ${latest.correction_reason}` : undefined,
    }
  } else if (latest.preliminary_status === 'READY_FOR_REGULATORY_REVIEW') {
    application = { key: 'application', title: 'Dealer application', state: 'done', status: `Version ${latest.intake_version} · preliminary review complete`, detail: 'Preliminary review only — not legal approval.' }
  } else if (latest.preliminary_status === 'AWAITING_PRELIMINARY_REVIEW') {
    application = { key: 'application', title: 'Dealer application', state: 'waiting', status: `Version ${latest.intake_version} submitted · awaiting preliminary review` }
  } else {
    application = { key: 'application', title: 'Dealer application', state: 'waiting', status: `Version ${latest.intake_version} · ${humanizeStatus(latest.preliminary_status).toLowerCase()}` }
  }

  // 3 — Independent legal review (the claimant sees it only through the operational authority read)
  const reasons = authority?.blocking_reasons ?? []
  let legal: JourneyStage
  if (!approved) {
    legal = { key: 'legal', title: 'Legal review', state: 'upcoming', status: 'After preliminary review' }
  } else if (!detailsLoaded) {
    legal = { key: 'legal', title: 'Legal review', state: 'unknown', status: 'Checking…' }
  } else if (!authority) {
    legal = { key: 'legal', title: 'Legal review', state: 'unknown', status: 'Status unavailable right now' }
  } else if (authority.state === 'DEALER_AUTHORITY_BLOCKED' && reasons.includes('LEGAL_REVIEW_EXPIRED')) {
    legal = { key: 'legal', title: 'Legal review', state: 'attention', status: 'Legal review expired' }
  } else if (authority.state === 'DEALER_AUTHORITY_BLOCKED' && reasons.includes('COUNTRY_POLICY_NOT_CURRENT')) {
    legal = { key: 'legal', title: 'Legal review', state: 'attention', status: 'Country policy no longer current' }
  } else if (LEGAL_RECORDED_STATES.has(authority.state) || authority.state === 'DEALER_AUTHORITY_BLOCKED') {
    // F-03 (Owner-approved wording, 2026-11-21; provisional pending Product/Legal): the claimant API carries
    // no legal-review record, so a legal review is never inferred from operating authority. Operating
    // authority stays in Stage 04 and the authority panel, from its own read.
    legal = {
      key: 'legal', title: 'Legal review', state: 'unconfirmed', status: 'Legal review not confirmed here',
      detail: 'CarUp does not show legal-review decisions to claimants. Operating authority is shown separately below.',
    }
  } else if (application.state === 'done') {
    legal = { key: 'legal', title: 'Legal review', state: 'waiting', status: 'Awaiting independent legal review' }
  } else {
    legal = { key: 'legal', title: 'Legal review', state: 'upcoming', status: 'After preliminary review' }
  }

  // 4 — Dealer activation
  let activation: JourneyStage
  if (!approved) {
    activation = { key: 'activation', title: 'Dealer activation', state: 'upcoming', status: 'Not activated' }
  } else if (!detailsLoaded) {
    activation = { key: 'activation', title: 'Dealer activation', state: 'unknown', status: 'Checking…' }
  } else if (!authority) {
    activation = { key: 'activation', title: 'Dealer activation', state: 'unknown', status: 'Status unavailable right now' }
  } else if (authority.state === 'CANONICAL_DEALER_ACTIVE' && authority.operational === true) {
    const notes: string[] = []
    if (authority.public_storefront_approved === false) notes.push('Public storefront not approved')
    if (authority.public_storefront_approved === true) notes.push('Public storefront approved')
    if (authority.vehicle_listing_authority_granted === false) notes.push('vehicle listing authority not granted')
    if (authority.vehicle_listing_authority_granted === true) notes.push('vehicle listing authority granted')
    activation = { key: 'activation', title: 'Dealer activation', state: 'done', status: 'Dealer workspace active', detail: notes.length ? notes.join(' · ').replace(/^./, c => c.toUpperCase()) : undefined }
  } else if (authority.state === 'ATTACHED_TO_EXISTING_DEALERSHIP') {
    const pending = authority.attach_status && authority.attach_status !== 'ACTIVE'
    activation = pending
      ? { key: 'activation', title: 'Dealer activation', state: 'waiting', status: `Attachment ${authority.attach_status!.toLowerCase().replace(/_/g, ' ')}` }
      : { key: 'activation', title: 'Dealer activation', state: 'done', status: 'Attached to your existing dealership' }
  } else if (authority.state === 'DEALER_OPERATIONS_SUSPENDED') {
    activation = { key: 'activation', title: 'Dealer activation', state: 'blocked', status: 'Operations suspended' }
  } else if (authority.state === 'DEALER_OPERATIONS_WITHDRAWN') {
    activation = { key: 'activation', title: 'Dealer activation', state: 'blocked', status: 'Operations withdrawn' }
  } else if (authority.state === 'DEALER_AUTHORITY_BLOCKED') {
    activation = { key: 'activation', title: 'Dealer activation', state: 'blocked', status: 'Operations paused' }
  } else {
    activation = { key: 'activation', title: 'Dealer activation', state: 'upcoming', status: 'Not activated' }
  }

  const stages = [claim, application, legal, activation]
  return { stages, next: nextStep(stages, latest) }
}

function nextStep(stages: JourneyStage[], latest: ClaimJourneyInput['submissions'][number] | null): JourneyNextStep {
  const [claim, application, legal, activation] = stages
  if (claim.state === 'current') return { stage: 'claim', tone: 'warning', title: 'Upload your business-authority evidence', body: 'Add original documents that show you can act for this business. A CarUp reviewer inspects them before anything else can happen.', target: CLAIM_SECTION_IDS.evidence }
  if (claim.state === 'waiting') return { stage: 'claim', tone: 'info', title: 'Wait for the independent claim review', body: 'A CarUp reviewer inspects your original documents. You can still add a missing document while you wait. Nothing is approved yet.', target: CLAIM_SECTION_IDS.evidence }
  if (claim.state === 'attention') return { stage: 'claim', tone: 'warning', title: 'Respond to the dispute', body: 'Add stronger original evidence, or explain your position in an appeal for a separate independent review.', target: CLAIM_SECTION_IDS.appeal }
  if (claim.state === 'blocked') return { stage: 'claim', tone: 'danger', title: 'Appeal the claim decision', body: 'If you have new evidence, an appeal is reviewed separately and independently. No authority changes until then.', target: CLAIM_SECTION_IDS.appeal }
  if (claim.state === 'unknown') return { stage: 'claim', tone: 'neutral', title: 'Claim status not recognised', body: 'Contact CarUp compliance if this status does not change.' }
  if (application.state === 'unknown') return { stage: 'application', tone: 'neutral', title: 'Checking your application', body: 'Your application, legal and activation status are loading.' }
  if (application.state === 'current' && application.status === 'Not started') return { stage: 'application', tone: 'warning', title: 'Start your dealer application', body: 'Download your prefilled workbook, complete the missing details and upload it — or enter the application manually.', target: CLAIM_SECTION_IDS.application }
  if (application.state === 'current') return { stage: 'application', tone: 'warning', title: 'Submit your saved application', body: 'Your saved version is not with CarUp yet. Review it, confirm the declaration and submit it for independent preliminary review.', target: CLAIM_SECTION_IDS.submit }
  if (application.state === 'attention') return { stage: 'application', tone: 'warning', title: 'Correct your application and submit again', body: latest?.correction_reason ? `Required action: ${latest.correction_reason}` : 'The preliminary reviewer asked for changes. Update your application and submit a new version.', target: CLAIM_SECTION_IDS.application }
  if (application.state === 'waiting') return { stage: 'application', tone: 'info', title: 'Wait for preliminary review', body: 'An independent CarUp reviewer checks your submitted version. No legal approval or operating rights are granted at this step.', target: CLAIM_SECTION_IDS.history }
  if (legal.state === 'attention' || activation.state === 'blocked') return { stage: activation.state === 'blocked' ? 'activation' : 'legal', tone: 'danger', title: 'Your dealership cannot operate right now', body: 'See why below, and the governed path back.', target: CLAIM_SECTION_IDS.authority }
  if (legal.state === 'waiting') return { stage: 'legal', tone: 'info', title: 'Wait for the independent legal review', body: 'A separate legal reviewer decides whether your dealership can be activated. Nothing is active until that decision is recorded.' }
  if (legal.state === 'unknown' || activation.state === 'unknown') return { stage: 'activation', tone: 'neutral', title: 'Authority status unavailable', body: 'Your operating status could not be read right now. Reload the page to try again.' }
  if (activation.state === 'waiting') return { stage: 'activation', tone: 'info', title: 'Attachment in progress', body: 'An independent reviewer is attaching this claim to your existing dealership.', target: CLAIM_SECTION_IDS.authority }
  if (activation.state === 'done') return { stage: 'activation', tone: 'success', title: 'Open your dealer workspace', body: activation.detail ? `${activation.detail}.` : 'Manage your dealership from the workspace.', href: '/dealer/dashboard' }
  return { stage: 'activation', tone: 'neutral', title: 'Not activated yet', body: 'Activation follows the independent legal review.' }
}
