/**
 * RX06-EXIT02-LR01 (C2.3) + RX06-EXIT02-F01-LR01: pure projection of server-recorded thread subject references.
 * Explicit typed subjects (subject_type + subject_id) always take precedence over optional marketplace_listing_id
 * metadata so unsupported institutional or conflicting subjects never turn into unrelated marketplace links.
 * Never invents an order, vehicle or work-order link when no identifier was returned, and never invents a route
 * for institutional/escrow subjects that have no owner page.
 */
export interface ThreadSubjectSource {
  marketplace_listing_id?: string | null
  subject_type?: string | null
  subject_id?: string | null
  business_workflow?: string | null
  conversation_type?: string | null
  thread_type?: string | null
  financing_application_id?: string | null
  escrow_id?: string | null
}

export interface ThreadSubjectContext {
  label: string
  href: string | null
  actionLabel: string | null
}

const IMPORT_ORDER_SUBJECT_TYPES = new Set([
  'import_order',
  'diaspora_order',
  'diaspora_import_order',
  'buyer_order',
  'import',
  'diaspora',
  'logistics',
])

const MARKETPLACE_LISTING_SUBJECT_TYPES = new Set([
  'vehicle',
  'marketplace_listing',
  'listing',
])

const WORK_ORDER_SUBJECT_TYPES = new Set([
  'work_order',
  'service_record',
  'garage_work_order',
  'garage',
  'maintenance',
])

function formatSubjectKind(rawKind: string): string {
  const cleaned = rawKind.trim().replaceAll('_', ' ')
  return cleaned ? cleaned.replace(/^\w/, (c) => c.toUpperCase()) : 'Reference'
}

export function resolveThreadSubject(thread: ThreadSubjectSource | null | undefined): ThreadSubjectContext | null {
  if (!thread) return null

  const subjectType = thread.subject_type?.trim() || ''
  const subjectId = thread.subject_id?.trim() || ''
  const listingId = thread.marketplace_listing_id?.trim() || ''
  const financingId = thread.financing_application_id?.trim() || ''
  const escrowId = thread.escrow_id?.trim() || ''

  // Authoritative subject_id (with explicit subject_type, or non-navigable if ambiguous) precedes listing fallback.
  if (subjectId) {
    const kind = subjectType.toLowerCase()
    if (subjectType && IMPORT_ORDER_SUBJECT_TYPES.has(kind)) {
      return { label: `Import order ${subjectId}`, href: `/diaspora/imports/${encodeURIComponent(subjectId)}`, actionLabel: 'Open import order' }
    }
    if (subjectType && MARKETPLACE_LISTING_SUBJECT_TYPES.has(kind)) {
      return { label: `Listing ${subjectId}`, href: `/marketplace/${encodeURIComponent(subjectId)}`, actionLabel: 'Open listing' }
    }
    if (subjectType && WORK_ORDER_SUBJECT_TYPES.has(kind)) {
      return { label: `Work order ${subjectId}`, href: '/dashboard/service-history', actionLabel: 'Open service history' }
    }
    return { label: `${formatSubjectKind(subjectType)} ${subjectId}`, href: null, actionLabel: null }
  }

  // Non-navigable institutional references stay non-linked even when optional listing metadata co-occurs.
  if (financingId) {
    return { label: `Finance application ${financingId}`, href: null, actionLabel: null }
  }
  if (escrowId) {
    return { label: `Escrow ${escrowId}`, href: null, actionLabel: null }
  }

  // Standalone marketplace_listing_id when no conflicting explicit subject type/identity exists.
  if (listingId && (!subjectType || MARKETPLACE_LISTING_SUBJECT_TYPES.has(subjectType.toLowerCase()))) {
    return { label: `Listing ${listingId}`, href: `/marketplace/${encodeURIComponent(listingId)}`, actionLabel: 'Open listing' }
  }

  return null
}
