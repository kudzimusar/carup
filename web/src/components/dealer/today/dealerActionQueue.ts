/**
 * RX05-B — the Dealer Action Queue: "What needs this dealership's attention today?"
 *
 * A PURE projection of reads the dealer workspace already makes (operational workspace, activation
 * carry-over, tenant inventory, enquiries, owner media list, staff). Nothing is invented: every item
 * names its source, and a read that failed becomes an explicit "could not check" item — never an
 * all-clear. No item grants or implies authority; every CTA is a deep link to the page that already
 * owns that work (and keeps its own server-side guard).
 */

export type QueueTone = 'urgent' | 'action' | 'unknown' | 'waiting' | 'suggestion'
export type QueueArea = 'compliance' | 'enquiries' | 'inventory' | 'media' | 'branches' | 'staff'
export type ReadStatus = 'loading' | 'ready' | 'unavailable'

export interface QueueItem {
  id: string
  area: QueueArea
  tone: QueueTone
  title: string
  detail: string
  cta?: { label: string; href: string }
  /** Branch items open the private branch editor in place instead of navigating. */
  editBranchId?: string
  addBranch?: boolean
}

export interface AreaCheck {
  area: QueueArea
  label: string
  state: 'clear' | 'attention' | 'waiting' | 'unavailable' | 'loading'
  count: number
}

export interface DealerQueueInput {
  now: Date
  profile: {
    identity_status: string
    compliance_review_state: string
    active_state: string
    restriction_state: string
    suspension_state: string
    investigation_state: string
    expiry_date: string | null
  }
  attachedClaims: ReadonlyArray<{
    attachment_id: string
    seed_dealer_id: string
    effective_status: string
    legal_expires_at: string | null
  }> | null
  branches: ReadonlyArray<{
    id: string
    name: string | null
    latitude: number | null
    longitude: number | null
    opening_hours_text: string | null
  }>
  /** null = carry-over not read (older API / failed read): then no carry-over item is claimed. */
  carryoverNeedsAttention: number | null
  inventory: {
    status: ReadStatus
    entries: ReadonlyArray<{
      vin: string
      make: string | null
      model: string | null
      year: number | null
      recorded_marketplace_publication_state: string | null
      listing_structural_precheck?: { result?: string | null; blocking_reason_codes?: string[] | null } | null
    }>
  }
  enquiries: {
    status: ReadStatus
    entries: ReadonlyArray<{ inquiry_id: string; status: string; created_at: string; allowed_followup_status: string | null }>
  }
  media: {
    status: ReadStatus
    items: ReadonlyArray<{ media_category: string; review_status: string; created_at: string | null }>
  }
  staff: {
    status: ReadStatus
    invitations: ReadonlyArray<{ invite_id: string; status: string; expires_at: string }>
  }
}

export const AREA_LABELS: Record<QueueArea, string> = {
  compliance: 'Legal & compliance',
  enquiries: 'Enquiries',
  inventory: 'Inventory',
  media: 'Images',
  branches: 'Branches',
  staff: 'Staff',
}

export const TONE_LABELS: Record<QueueTone, string> = {
  urgent: 'Urgent',
  action: 'To do',
  unknown: 'Could not check',
  waiting: 'Waiting on review',
  suggestion: 'Suggested',
}

const TONE_ORDER: Record<QueueTone, number> = { urgent: 0, action: 1, unknown: 2, waiting: 3, suggestion: 4 }
const DAY = 24 * 60 * 60 * 1000
const COVER = 'COMPANY_COVER_IMAGE'
const PROFILE = 'COMPANY_PROFILE_IMAGE'
const PENDING = 'PENDING_INDEPENDENT_REVIEW'
const APPROVED = 'APPROVED_PUBLIC_DISPLAY'

function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

function words(key: string | null | undefined): string {
  const normalized = String(key ?? '').replace(/_/g, ' ').trim().toLowerCase()
  return normalized || 'not recorded'
}

/**
 * Calendar days (viewer's local dates) from today until the instant: 0 = later today. An instant that
 * has already passed is always negative, even when it fell earlier today.
 */
export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
  const calendar = Math.round((midnight(at) - midnight(now.getTime())) / DAY)
  return at < now.getTime() ? Math.min(calendar, -1) : calendar
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : iso
}

function vehicleName(v: DealerQueueInput['inventory']['entries'][number]): string {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || `VIN ${v.vin}`
}

const CLAIMS = '/dealers/claims'
const STOCK = '/dealers/stock'
const IMAGES = '/dealers/operating-details#dealer-profile-images'

export function buildDealerActionQueue(input: DealerQueueInput): { items: QueueItem[]; areas: AreaCheck[] } {
  const items: QueueItem[] = []
  const unavailable = new Set<QueueArea>()
  const loading = new Set<QueueArea>()
  const p = input.profile

  // ── Legal & compliance (from the server-verified workspace) ──
  if (p.active_state !== 'active') {
    items.push({ id: 'tenant-inactive', area: 'compliance', tone: 'urgent', title: `Dealership tenant is ${words(p.active_state)}`,
      detail: 'Operating features may be limited until CarUp restores the tenant.', cta: { label: 'View status', href: CLAIMS } })
  }
  if (p.suspension_state && p.suspension_state !== 'none') {
    items.push({ id: 'suspension', area: 'compliance', tone: 'urgent', title: `Suspension: ${words(p.suspension_state)}`,
      detail: 'A suspension was recorded against this dealership.', cta: { label: 'View status', href: CLAIMS } })
  }
  if (p.investigation_state && p.investigation_state !== 'none') {
    items.push({ id: 'investigation', area: 'compliance', tone: 'action', title: `Investigation: ${words(p.investigation_state)}`,
      detail: 'CarUp has an open investigation record for this dealership.', cta: { label: 'View status', href: CLAIMS } })
  }
  if (p.restriction_state && p.restriction_state !== 'none') {
    items.push({ id: 'restriction', area: 'compliance', tone: 'action', title: `Restrictions: ${words(p.restriction_state)}`,
      detail: 'Some operations are restricted for this dealership.', cta: { label: 'View status', href: CLAIMS } })
  }
  if (p.identity_status !== 'verified') {
    items.push({ id: 'identity', area: 'compliance', tone: 'action', title: `Legal identity ${words(p.identity_status)}`,
      detail: 'Legal identity is not recorded as verified.', cta: { label: 'Open claim & compliance', href: CLAIMS } })
  }
  if (p.compliance_review_state !== 'passed') {
    items.push({ id: 'compliance', area: 'compliance', tone: 'action', title: `Compliance ${words(p.compliance_review_state)}`,
      detail: 'Compliance review is not recorded as passed.', cta: { label: 'Open claim & compliance', href: CLAIMS } })
  }
  const legalDays = daysUntil(p.expiry_date, input.now)
  if (legalDays !== null && p.expiry_date) {
    if (legalDays < 0) {
      items.push({ id: 'legal-expired', area: 'compliance', tone: 'urgent', title: 'Legal review has expired',
        detail: `The dealership’s legal review expired on ${shortDate(p.expiry_date)}.`, cta: { label: 'Open claim & compliance', href: CLAIMS } })
    } else if (legalDays <= 30) {
      items.push({ id: 'legal-expiry', area: 'compliance', tone: legalDays <= 14 ? 'urgent' : 'action',
        title: legalDays === 0 ? 'Legal review expires today' : `Legal review expires in ${plural(legalDays, 'day')}`,
        detail: `Recorded legal review expiry: ${shortDate(p.expiry_date)}.`, cta: { label: 'Open claim & compliance', href: CLAIMS } })
    }
  }
  for (const claim of input.attachedClaims ?? []) {
    const s = claim.effective_status
    if (s === 'ACTIVE') {
      const d = daysUntil(claim.legal_expires_at, input.now)
      if (d !== null && d >= 0 && d <= 30 && claim.legal_expires_at) {
        items.push({ id: `attached-expiry-${claim.attachment_id}`, area: 'compliance', tone: d <= 14 ? 'urgent' : 'action',
          title: `Attached claim ${claim.seed_dealer_id}: legal review expires in ${plural(d, 'day')}`,
          detail: `Recorded expiry: ${shortDate(claim.legal_expires_at)}.`, cta: { label: 'Open claim & compliance', href: CLAIMS } })
      }
      continue
    }
    const severe = s === 'REVOKED' || s === 'LEGAL_REVIEW_EXPIRED'
    items.push({ id: `attached-${claim.attachment_id}`, area: 'compliance', tone: severe ? 'urgent' : 'action',
      title: `Attached claim ${claim.seed_dealer_id}: ${words(s)}`,
      detail: 'Branches added through this claim follow its status.', cta: { label: 'Open claim & compliance', href: CLAIMS } })
  }
  if (input.carryoverNeedsAttention && input.carryoverNeedsAttention > 0) {
    items.push({ id: 'carryover', area: 'compliance', tone: 'action',
      title: `${plural(input.carryoverNeedsAttention, 'detail')} from your application could not be carried`,
      detail: 'Re-enter them in operating details; nothing was published.', cta: { label: 'Open operating details', href: '/dealers/operating-details' } })
  }

  // ── Enquiries (seller-safe inbox, first 100) ──
  if (input.enquiries.status === 'unavailable') {
    unavailable.add('enquiries')
    items.push({ id: 'enquiries-unread', area: 'enquiries', tone: 'unknown', title: 'Enquiries could not be checked',
      detail: 'The enquiry inbox did not load. This is not proof that there are none.', cta: { label: 'Open enquiries', href: '/dealers/inquiries' } })
  } else if (input.enquiries.status === 'loading') loading.add('enquiries')
  else {
    const waiting = input.enquiries.entries.filter(e => e.status === 'new')
    if (waiting.length) {
      const oldest = waiting.map(e => e.created_at).sort()[0]
      items.push({ id: 'enquiries-new', area: 'enquiries', tone: 'action',
        title: `${plural(waiting.length, 'new enquiry', 'new enquiries')} waiting for first contact`,
        detail: `Oldest received ${shortDate(oldest)}. Contact is recorded by you; CarUp does not verify it.`,
        cta: { label: 'Reply to enquiries', href: '/dealers/inquiries' } })
    }
  }

  // ── Inventory (tenant-scoped first-100 VIN read) ──
  if (input.inventory.status === 'unavailable') {
    unavailable.add('inventory')
    items.push({ id: 'inventory-unread', area: 'inventory', tone: 'unknown', title: 'Inventory could not be checked',
      detail: 'Scoped inventory did not load. This is not proof of zero vehicles.', cta: { label: 'Open inventory', href: STOCK } })
  } else if (input.inventory.status === 'loading') loading.add('inventory')
  else {
    const entries = input.inventory.entries
    if (entries.length === 0) {
      items.push({ id: 'inventory-empty', area: 'inventory', tone: 'suggestion', title: 'No vehicles recorded yet',
        detail: 'Record a vehicle by VIN to prepare it for listing.', cta: { label: 'Add a vehicle', href: STOCK } })
    } else {
      const blocked = entries.filter(v => v.listing_structural_precheck?.result === 'REQUIRES_DATA_CORRECTION')
      if (blocked.length) {
        const codes = [...new Set(blocked.flatMap(v => v.listing_structural_precheck?.blocking_reason_codes ?? []))].map(words)
        items.push({ id: 'inventory-correction', area: 'inventory', tone: 'action',
          title: blocked.length === 1 ? `${vehicleName(blocked[0])} needs data corrections before listing`
            : `${plural(blocked.length, 'vehicle')} need data corrections before listing`,
          detail: codes.length ? `Listing checks flagged: ${codes.slice(0, 4).join(', ')}${codes.length > 4 ? '…' : ''}.` : 'Listing checks flagged this record.',
          cta: { label: 'Fix in inventory', href: STOCK } })
      }
      const blockedVins = new Set(blocked.map(v => v.vin))
      const drafts = entries.filter(v => !blockedVins.has(v.vin) && v.recorded_marketplace_publication_state !== 'published')
      if (drafts.length) {
        items.push({ id: 'inventory-drafts', area: 'inventory', tone: 'suggestion',
          title: `${plural(drafts.length, 'vehicle')} not yet published`,
          detail: 'Publishing still requires seller authority and independent review.', cta: { label: 'Open inventory', href: STOCK } })
      }
    }
  }

  // ── Images (owner's own media list: review state per category) ──
  if (input.media.status === 'unavailable') {
    unavailable.add('media')
    items.push({ id: 'media-unread', area: 'media', tone: 'unknown', title: 'Image review status could not be checked',
      detail: 'Your image list did not load.', cta: { label: 'Open images', href: IMAGES } })
  } else if (input.media.status === 'loading') loading.add('media')
  else {
    const newest = (category: string) => input.media.items
      .filter(i => i.media_category === category)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]
    const missing = [COVER, PROFILE].filter(c => {
      const n = newest(c)
      return !n || (n.review_status !== PENDING && n.review_status !== APPROVED)
    })
    if (missing.length) {
      items.push({ id: 'media-missing', area: 'media', tone: 'action',
        title: missing.length === 2 ? 'Add your cover and profile images' : missing[0] === COVER ? 'Add a cover image' : 'Add a profile image',
        detail: 'Buyers see your own photographs only after independent review approves them.', cta: { label: 'Upload images', href: IMAGES } })
    }
    const rejected = input.media.items.filter(i => i.review_status === 'REJECTED')
    if (rejected.length) {
      items.push({ id: 'media-rejected', area: 'media', tone: 'action', title: `${plural(rejected.length, 'image')} not approved`,
        detail: 'Replace them with photographs you own (no OEM or third-party logos).', cta: { label: 'Replace images', href: IMAGES } })
    }
    const pending = input.media.items.filter(i => i.review_status === PENDING)
    if (pending.length) {
      items.push({ id: 'media-pending', area: 'media', tone: 'waiting', title: `${plural(pending.length, 'image')} awaiting independent review`,
        detail: 'Only you can see them until a reviewer approves public display.' })
    }
  }

  // ── Branches (server-verified workspace branches) ──
  if (input.branches.length === 0) {
    items.push({ id: 'branches-none', area: 'branches', tone: 'action', title: 'No branches recorded',
      detail: 'Add where buyers can find you. Branch details stay private until approved for display.', addBranch: true })
  } else {
    for (const b of input.branches) {
      const noHours = !b.opening_hours_text
      const noGps = b.latitude === null || b.longitude === null
      if (!noHours && !noGps) continue
      const missing = [noHours && 'opening hours', noGps && 'map location'].filter(Boolean).join(' and ')
      items.push({ id: `branch-${b.id}`, area: 'branches', tone: 'suggestion', title: `Add ${missing} for ${b.name || 'an unnamed branch'}`,
        detail: 'Declared details are private and unverified until reviewed.', editBranchId: b.id })
    }
  }

  // ── Staff (owner's staff and invitations) ──
  if (input.staff.status === 'unavailable') {
    unavailable.add('staff')
    items.push({ id: 'staff-unread', area: 'staff', tone: 'unknown', title: 'Staff could not be checked',
      detail: 'The staff list did not load.', cta: { label: 'Open staff', href: '/dealers/staff' } })
  } else if (input.staff.status === 'loading') loading.add('staff')
  else {
    const pending = input.staff.invitations.filter(i => i.status === 'PENDING')
    const expiring = pending.filter(i => { const d = daysUntil(i.expires_at, input.now); return d !== null && d <= 2 })
    if (expiring.length) {
      items.push({ id: 'staff-expiring', area: 'staff', tone: 'action', title: `${plural(expiring.length, 'staff invitation')} about to expire`,
        detail: 'The recipient has not accepted yet.', cta: { label: 'Open staff', href: '/dealers/staff' } })
    }
    const waiting = pending.length - expiring.length
    if (waiting > 0) {
      items.push({ id: 'staff-pending', area: 'staff', tone: 'waiting', title: `${plural(waiting, 'staff invitation')} awaiting acceptance`,
        detail: 'Nobody gets access until they accept through their own CarUp account.' })
    }
  }

  items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])

  const areas: AreaCheck[] = (Object.keys(AREA_LABELS) as QueueArea[]).map(area => {
    const mine = items.filter(i => i.area === area)
    const state: AreaCheck['state'] = loading.has(area) ? 'loading'
      : unavailable.has(area) ? 'unavailable'
      : mine.some(i => i.tone === 'urgent' || i.tone === 'action') ? 'attention'
      : mine.some(i => i.tone === 'waiting') ? 'waiting'
      : 'clear'
    return { area, label: AREA_LABELS[area], state, count: mine.filter(i => i.tone !== 'suggestion').length }
  })
  return { items, areas }
}
