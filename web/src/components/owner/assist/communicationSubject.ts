/**
 * RX06-EXIT02-LR01 (C2.3): pure projection of server-recorded thread subject references.
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

export function resolveThreadSubject(thread: ThreadSubjectSource | null | undefined): ThreadSubjectContext | null {
  if (!thread) return null
  const listingId = thread.marketplace_listing_id?.trim()
  if (listingId) {
    return { label: `Listing ${listingId}`, href: `/marketplace/${encodeURIComponent(listingId)}`, actionLabel: 'Open listing' }
  }
  const subjectId = thread.subject_id?.trim()
  if (subjectId) {
    const rawKind = (thread.subject_type || thread.business_workflow || thread.conversation_type || thread.thread_type || '').trim()
    const kind = rawKind.toLowerCase()
    if (['import_order', 'diaspora_order', 'diaspora_import_order', 'buyer_order', 'import', 'diaspora', 'logistics'].includes(kind)) {
      return { label: `Import order ${subjectId}`, href: `/diaspora/imports/${encodeURIComponent(subjectId)}`, actionLabel: 'Open import order' }
    }
    if (['vehicle', 'marketplace_listing', 'listing'].includes(kind)) {
      return { label: `Listing ${subjectId}`, href: `/marketplace/${encodeURIComponent(subjectId)}`, actionLabel: 'Open listing' }
    }
    if (['work_order', 'service_record', 'garage_work_order', 'garage', 'maintenance'].includes(kind)) {
      return { label: `Work order ${subjectId}`, href: '/dashboard/service-history', actionLabel: 'Open service history' }
    }
    const humanKind = thread.subject_type?.trim()
      ? thread.subject_type.trim().replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase())
      : 'Reference'
    return { label: `${humanKind} ${subjectId}`, href: null, actionLabel: null }
  }
  if (thread.financing_application_id?.trim()) {
    return { label: `Finance application ${thread.financing_application_id.trim()}`, href: null, actionLabel: null }
  }
  if (thread.escrow_id?.trim()) {
    return { label: `Escrow ${thread.escrow_id.trim()}`, href: null, actionLabel: null }
  }
  return null
}
