/** Seller-facing presentation of the vehicle publication lifecycle
 *  (database CHECK on vehicles.publication_status, 20260624140000). */
export const PUBLICATION_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft — not publicly visible', className: 'bg-slate-100 text-slate-600' },
  identity_complete: { label: 'Draft — not publicly visible', className: 'bg-slate-100 text-slate-600' },
  documents_submitted: { label: 'In review — not publicly visible', className: 'bg-blue-100 text-blue-700' },
  review_pending: { label: 'In review — not publicly visible', className: 'bg-blue-100 text-blue-700' },
  // `publishable` is NOT live: the public Marketplace shows `published` and nothing else
  // (backend/utils/vehicleStatus.js). "Ready to publish" alone read as a status a seller could stop
  // at, so the label states the consequence the same way every other non-live state does.
  publishable: { label: 'Ready to publish — not on the public Marketplace yet', className: 'bg-amber-100 text-amber-700' },
  published: { label: 'Published', className: 'bg-green-100 text-green-700' },
}

/**
 * Who last moved a listing on or off the public Marketplace, as `/api/vehicles/me` publishes it
 * (backend/services/marketplace/publicationLastChange.js). `not_read` is a failed read — never
 * "nobody changed it" — so it adds nothing to the explanation rather than implying an absence.
 */
export interface PublicationLastChange {
  state: 'recorded' | 'none' | 'not_read'
  change?: 'published' | 'unpublished'
  at?: string
  by?: 'you' | 'carup' | 'another_account'
}

function formatChangeDate(iso: string): string | null {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The plain-language answer to "why is my listing not on the Marketplace?" for a `publishable`
 * listing. It says what the state means for buyers, what the seller can do, and — only when the
 * audit trail recorded it — who took the listing down. The real UAT vehicle GFC27-027051 was last
 * PUBLISHED by its owner and then returned to `publishable` by a CarUp staging reconciliation; a
 * bare "Ready to publish" left its owner looking at a listing they had published with no reason.
 *
 * Publishing re-runs CarUp's publication gate (POST /api/vehicles/:vin/publish), so the copy never
 * promises the listing will go straight live — only that anything missing will be named.
 */
export function describeReadyToPublish(last?: PublicationLastChange | null): string {
  const meaning = 'Buyers cannot see this listing — it is not on the public Marketplace. Choose “Publish to Marketplace” when you are ready: CarUp re-checks its publication requirements first and names anything still missing.'
  if (last?.state !== 'recorded' || last.change !== 'unpublished' || !last.at) return meaning
  const when = formatChangeDate(last.at)
  if (!when) return meaning
  if (last.by === 'carup') return `CarUp took this listing off the public Marketplace on ${when}. This was not your action. ${meaning}`
  if (last.by === 'you') return `You took this listing off the public Marketplace on ${when}. ${meaning}`
  if (last.by === 'another_account') return `Another account with selling rights took this listing off the public Marketplace on ${when}. ${meaning}`
  return meaning
}
