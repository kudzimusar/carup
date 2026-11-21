/**
 * RX-06 Account — pure helpers for the trade profile desk (/diaspora/trade-profile). No React.
 *
 * Verification statuses are the backend's (diaspora_trade_profiles CHECK: PENDING_REVIEW, VERIFIED,
 * REJECTED, SUSPENDED, FLAGGED). Submitted is never verified: only a CarUp reviewer's recorded
 * decision reads as verified, and only VERIFIED is green.
 *
 * "What it allows" states only what the code enforces: SafeTrade's eligibility check accepts a VERIFIED
 * trade profile as verified identity for a case's buyer and seller (policy §40.identity); a SUSPENDED
 * profile cannot be resubmitted by its owner; a VERIFIED one has nothing to resubmit.
 */
import type { DiasporaTradeProfile } from '@/types'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import { humanizeCode, type ReadState } from '@/components/trade/sourcing/deskKit'

export type ProfileStatusKey = 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED' | 'FLAGGED'

export interface ProfileStatusGuide {
  key: string
  label: string
  tone: StatusTone
  meaning: string
  allows: string
  /** Position on the Submitted → CarUp review → Verified path, or null when it cannot be placed. */
  step: { at: 0 | 1 | 2; blocked: boolean } | null
}

const GUIDE: Record<ProfileStatusKey, Omit<ProfileStatusGuide, 'key'>> = {
  PENDING_REVIEW: {
    label: 'Submitted · awaiting CarUp review',
    tone: 'info',
    meaning: 'Recorded and waiting for a CarUp reviewer. Submitted is not verified.',
    allows: 'You can edit the location and organisation; editing never changes the verification status. SafeTrade’s eligibility check does not yet count it as verified identity.',
    step: { at: 1, blocked: false },
  },
  VERIFIED: {
    label: 'Verified by a CarUp reviewer',
    tone: 'success',
    meaning: 'A CarUp reviewer recorded this profile as verified.',
    allows: 'SafeTrade’s eligibility check accepts a verified trade profile as verified identity for a case’s buyer and seller. There is nothing to resubmit.',
    step: { at: 2, blocked: false },
  },
  REJECTED: {
    label: 'Not approved',
    tone: 'danger',
    meaning: 'A CarUp reviewer did not approve this profile.',
    allows: 'Correct the details if needed, then resubmit it for review. Until then it is not verified.',
    step: { at: 1, blocked: true },
  },
  FLAGGED: {
    label: 'Flagged for review',
    tone: 'warning',
    meaning: 'This profile is flagged for a closer CarUp review.',
    allows: 'It is not verified. Wait for a CarUp reviewer’s decision.',
    step: { at: 1, blocked: true },
  },
  SUSPENDED: {
    label: 'Suspended',
    tone: 'danger',
    meaning: 'A CarUp reviewer suspended this profile.',
    allows: 'It cannot be resubmitted from here — lifting a suspension is a reviewer decision. Contact CarUp support.',
    step: null,
  },
}

export function profileStatus(status: string | null | undefined): ProfileStatusGuide {
  const key = String(status || 'PENDING_REVIEW').toUpperCase()
  const known = (GUIDE as Record<string, Omit<ProfileStatusGuide, 'key'>>)[key]
  if (known) return { key, ...known }
  return {
    key,
    label: humanizeCode(key, 'Status not recorded'),
    tone: 'neutral',
    meaning: 'This status is not one CarUp recognises, so it is shown exactly as recorded.',
    allows: 'It is not verified.',
    step: null,
  }
}

/** The legacy page's role choices (the server has no "supplier" role: it is recorded as seller). */
export const ROLE_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'seller', label: 'Seller' },
  { value: 'supplier', label: 'Supplier (recorded as Seller)' },
  { value: 'exporter', label: 'Exporter' },
  { value: 'agent', label: 'Agent' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'company', label: 'Company' },
  { value: 'coordinator', label: 'Coordinator' },
]

export function roleTypeLabel(role: string | null | undefined): string {
  const v = String(role || 'buyer').toLowerCase()
  return ROLE_TYPE_OPTIONS.find((o) => o.value === v)?.label.replace(' (recorded as Seller)', '') ?? humanizeCode(v)
}

/** The one thing the trader can usefully do next, across their profiles. */
export interface ProfileMove { title: string; usuallyWith: string; after: string; resubmitId?: string; create?: boolean }

export function profileNextMove(profiles: ReadonlyArray<Pick<DiasporaTradeProfile, 'id' | 'verification_status' | 'role_type'>>): ProfileMove {
  const by = (key: ProfileStatusKey) => profiles.find((p) => String(p.verification_status || 'PENDING_REVIEW').toUpperCase() === key)
  const rejected = by('REJECTED')
  if (rejected) {
    return {
      title: `Resubmit your ${roleTypeLabel(rejected.role_type).toLowerCase()} profile for review`,
      usuallyWith: 'You',
      after: 'It returns to “Submitted · awaiting CarUp review”. A reviewer then verifies it or not.',
      resubmitId: rejected.id,
    }
  }
  if (profiles.length === 0) {
    return {
      title: 'Create your trade profile',
      usuallyWith: 'You',
      after: 'It is recorded as submitted and waits for a CarUp reviewer. You cannot verify it yourself.',
      create: true,
    }
  }
  if (by('PENDING_REVIEW') || by('FLAGGED')) {
    return {
      title: 'Your profile is with CarUp for review',
      usuallyWith: 'A CarUp reviewer',
      after: 'The reviewer records it as verified or not approved. Nothing is needed from you unless it comes back not approved.',
    }
  }
  if (by('SUSPENDED')) {
    return {
      title: 'A profile is suspended',
      usuallyWith: 'A CarUp reviewer',
      after: 'Only a reviewer can lift a suspension. It cannot be resubmitted from this page.',
    }
  }
  return {
    title: 'Your trade profile is verified',
    usuallyWith: 'Nobody — nothing is waiting',
    after: 'Keep your location details current. Editing them never changes the verification status.',
  }
}

/* ── View model ────────────────────────────────────────────────────────────────────────────── */

export interface TradeProfileModel {
  authLoading: boolean
  role: string
  isReviewer: boolean
  own: DiasporaTradeProfile[]
  ownRead: ReadState
  loading: boolean
  loadError: string
  rateLimited: boolean
  onRetry: () => void
  onEdit: (profile: DiasporaTradeProfile) => void
  onResubmit: (id: string) => void | Promise<void>
  submittingReviewId: string | null
  form: {
    editingId: string | null
    roleType: string
    setRoleType: (v: string) => void
    country: string
    setCountry: (v: string) => void
    city: string
    setCity: (v: string) => void
    org: string
    setOrg: (v: string) => void
    saving: boolean
    onSubmit: () => void | Promise<void>
    onCancel: () => void
    result: string
    error: string
  }
  queue: {
    items: DiasporaTradeProfile[]
    read: ReadState
    loading: boolean
    error: string
    rateLimited: boolean
    onRetry: () => void
    busyId: string | null
    onVerify: (id: string) => void | Promise<void>
    onSuspend: (id: string) => void | Promise<void>
    message: string
  }
}
