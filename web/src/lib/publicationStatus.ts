/** Seller-facing presentation of the vehicle publication lifecycle
 *  (database CHECK on vehicles.publication_status, 20260624140000). */
export const PUBLICATION_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft — not publicly visible', className: 'bg-slate-100 text-slate-600' },
  identity_complete: { label: 'Draft — not publicly visible', className: 'bg-slate-100 text-slate-600' },
  documents_submitted: { label: 'In review — not publicly visible', className: 'bg-blue-100 text-blue-700' },
  review_pending: { label: 'In review — not publicly visible', className: 'bg-blue-100 text-blue-700' },
  publishable: { label: 'Ready to publish', className: 'bg-amber-100 text-amber-700' },
  published: { label: 'Published', className: 'bg-green-100 text-green-700' },
}
