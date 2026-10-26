import type { JourneyDocuments } from '@/hooks/useTradeLogisticsApi'
import { documentProvenance, documentState } from '../journeyDisplay'
import { DocumentAccessButtons } from './DocumentAccessButtons'

/**
 * The shipping documents as T8 states them, with — for the people the server admits — the means to open the FILE.
 *
 * The state, the note and the provenance are T8's own words. A "View" / "Download" pair appears only where the projection forwarded the document's id
 * (private access); a viewer who was not given one sees the state and nothing to press. Opening a file never changes how it is described.
 */
export function DocumentsList({ documents }: { documents: Extract<JourneyDocuments, { availability: 'composed' }> }) {
  if (!documents.items.length) {
    return <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="journey-documents-none-listed">No shipping documents are listed in this view.</p>
  }
  return (
    <ul className="mt-3 space-y-3" data-testid="journey-documents-list">
      {documents.items.map((item) => {
        const st = documentState(item.state)
        const provenance = documentProvenance(item.document)
        const openable = item.document?.can_open === true && typeof item.document.id === 'string' && item.document.id !== ''
        return (
          <li key={item.document_type} className="min-w-0 rounded-lg border border-slate-200 p-3" data-testid={`journey-document-${item.document_type}`}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{item.display_name}</p>
              <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${st.tone}`} data-testid={`journey-document-state-${item.document_type}`}>{st.label}</span>
            </div>
            <p className="mt-1 min-w-0 break-words text-xs text-slate-600">{item.note}</p>
            {provenance ? <p className="mt-1 min-w-0 break-words text-xs text-slate-500" data-testid={`journey-document-provenance-${item.document_type}`}>{provenance}</p> : null}
            {openable ? <DocumentAccessButtons documentId={item.document!.id as string} displayName={item.display_name} /> : null}
          </li>
        )
      })}
    </ul>
  )
}
