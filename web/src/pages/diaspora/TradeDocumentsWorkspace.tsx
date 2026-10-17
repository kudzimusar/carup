/**
 * Trade OS T8.3 — the Documents & Evidence workspace.
 *
 * One surface for one transaction, whichever kind it is. Before this, documents lived on a
 * procurement-only page, so a logistics request or a container booking could own a document that no
 * screen could show.
 *
 * The whole design problem here is refusing to collapse seven different truths into one green tick.
 * A file arriving is not a document being checked, and a document being checked is not the thing it
 * describes being true — so every row says which of those has actually happened, and the page says
 * it again in words at the bottom rather than relying on the reader to infer it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, Check, Clock, FileText, Loader2, Minus, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'

export interface WorkspaceItem {
  document_type: string
  display_name: string
  verification_required: boolean
  state: string
  note: string
  document: {
    id: string
    version: number
    supplied_by: string | null
    supplied_at: string | null
    reviewed_by: string | null
    reviewed_at: string | null
    has_extraction: boolean
    has_earlier_versions: boolean
  } | null
}

export interface DocumentWorkspace {
  subject: { type: string; id: string }
  viewer_role: string
  items: WorkspaceItem[]
  summary: { total: number; supplied: number; verified: number; awaiting_review: number; rejected: number; requested_outstanding: number }
  disclaimer: string
}

/**
 * How each state looks and, more importantly, what it is allowed to CLAIM.
 *
 * "Supplied" and "Checked and verified" are deliberately different words with deliberately
 * different colours: a customer skimming this page must not read a green tick beside a document
 * nobody has looked at.
 */
const STATE_UI: Record<string, { label: string; tone: string; Icon: typeof Check }> = {
  VERIFIED: { label: 'Verified', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900', Icon: Check },
  AWAITING_REVIEW: { label: 'Supplied — awaiting review', tone: 'border-amber-300 bg-amber-50 text-amber-900', Icon: Clock },
  PRESENT: { label: 'Supplied', tone: 'border-slate-300 bg-slate-50 text-slate-800', Icon: FileText },
  REJECTED: { label: 'Rejected', tone: 'border-red-300 bg-red-50 text-red-900', Icon: X },
  REQUESTED: { label: 'Requested', tone: 'border-orange-300 bg-orange-50 text-orange-900', Icon: AlertTriangle },
  MISSING: { label: 'Not supplied', tone: 'border-slate-200 bg-white text-slate-600', Icon: Minus },
  NOT_APPLICABLE: { label: 'Does not apply', tone: 'border-slate-200 bg-white text-slate-500', Icon: Minus },
}

const SUBJECT_LABEL: Record<string, string> = {
  import_order: 'purchase',
  trade_order: 'order',
  logistics_request: 'shipping request',
  container_booking: 'sailing',
}

const shortRef = (id: string) => String(id).replace(/-/g, '').slice(0, 8).toUpperCase()
const when = (iso: string | null) => (iso ? String(iso).slice(0, 10) : null)

export default function TradeDocumentsWorkspace() {
  const { subjectType = '', subjectId = '' } = useParams()
  const { loading: authLoading } = useAuth()
  const { fetchDocumentWorkspace } = useCarUpApi()
  const [data, setData] = useState<DocumentWorkspace | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await fetchDocumentWorkspace(subjectType, subjectId))
      setState('ready')
    } catch (err) {
      // A failed read is not "no documents". Saying "nothing here" about a workspace we could not
      // open would be the most reassuring possible lie.
      setError(err instanceof Error ? err.message : 'These documents could not be read')
      setState('unreadable')
    }
  }, [fetchDocumentWorkspace, subjectType, subjectId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && subjectType && subjectId) void load() }, [authLoading, subjectType, subjectId, load])

  const grouped = useMemo(() => {
    if (!data) return { outstanding: [], supplied: [], notApplicable: [] }
    return {
      outstanding: data.items.filter((i) => ['REQUESTED', 'MISSING'].includes(i.state)),
      supplied: data.items.filter((i) => ['PRESENT', 'AWAITING_REVIEW', 'VERIFIED', 'REJECTED'].includes(i.state)),
      notApplicable: data.items.filter((i) => i.state === 'NOT_APPLICABLE'),
    }
  }, [data])

  if (authLoading || state === 'loading') {
    return <div className="flex min-h-48 items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (state === 'unreadable' || !data) {
    return (
      <section className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="documents-unreadable">
        <h1 className="text-2xl font-bold text-slate-950">Documents &amp; evidence</h1>
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <AlertDescription>
            {error || 'These documents could not be read.'} That is not a report that there are none.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const noun = SUBJECT_LABEL[data.subject.type] || 'transaction'

  return (
    <section className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="documents-workspace">
      <div className="border-b-2 border-slate-950 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Documents &amp; evidence</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">
          Paperwork for this {noun}
        </h1>
        <p className="mt-1 font-mono text-xs text-slate-500" data-testid="documents-subject-ref">
          {noun.toUpperCase()} {shortRef(data.subject.id)}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-4 text-sm" data-testid="documents-summary">
        <span className="text-slate-700">{data.summary.supplied} of {data.summary.total} supplied</span>
        {data.summary.awaiting_review > 0 && (
          <span className="font-medium text-amber-900" data-testid="documents-awaiting">{data.summary.awaiting_review} awaiting review</span>
        )}
        {data.summary.verified > 0 && (
          <span className="font-medium text-emerald-800" data-testid="documents-verified">{data.summary.verified} verified</span>
        )}
        {data.summary.rejected > 0 && (
          <span className="font-medium text-red-800" data-testid="documents-rejected">{data.summary.rejected} rejected</span>
        )}
      </div>

      {grouped.outstanding.length > 0 && (
        <div className="mt-7" data-testid="documents-outstanding">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Still needed</h2>
          <ul className="mt-3 space-y-2">
            {grouped.outstanding.map((item) => <Row key={item.document_type} item={item} />)}
          </ul>
        </div>
      )}

      {grouped.supplied.length > 0 && (
        <div className="mt-7" data-testid="documents-supplied">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Supplied</h2>
          <ul className="mt-3 space-y-2">
            {grouped.supplied.map((item) => <Row key={item.document_type} item={item} />)}
          </ul>
        </div>
      )}

      {grouped.notApplicable.length > 0 && (
        <div className="mt-7" data-testid="documents-not-applicable">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Does not apply</h2>
          <ul className="mt-3 space-y-2">
            {grouped.notApplicable.map((item) => <Row key={item.document_type} item={item} />)}
          </ul>
        </div>
      )}

      {/* The contract, in the customer's own reading, rather than left to be inferred from colour. */}
      <p className="mt-8 border-l-2 border-slate-300 pl-3 text-xs leading-relaxed text-slate-600" data-testid="documents-disclaimer">
        {data.disclaimer}
      </p>
      <p className="mt-2 text-[11px] text-slate-500">
        CarUp does not decide duty, tax or customs outcomes from these documents.
      </p>
    </section>
  )
}

function Row({ item }: { item: WorkspaceItem }) {
  const ui = STATE_UI[item.state] || STATE_UI.MISSING
  const { Icon } = ui
  return (
    <li className="min-w-0 border border-slate-200 bg-white p-4" data-testid="documents-row" data-state={item.state}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-950">{item.display_name}</p>
          <p className="mt-0.5 text-xs text-slate-600">{item.note}</p>
          {item.document && (
            <p className="mt-1 text-[11px] text-slate-500" data-testid="documents-provenance">
              {item.document.supplied_by ? `Supplied by ${item.document.supplied_by}` : 'Supplier not recorded'}
              {when(item.document.supplied_at) ? ` on ${when(item.document.supplied_at)}` : ''}
              {item.document.version > 1 ? ` · version ${item.document.version}` : ''}
              {item.document.has_earlier_versions ? ' · an earlier version is kept' : ''}
              {/* Stated, never used as a status: extraction having run says nothing about truth. */}
              {item.document.has_extraction ? ' · text was read automatically' : ''}
            </p>
          )}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${ui.tone}`} data-testid="documents-state">
          <Icon className="h-3 w-3" aria-hidden="true" /> {ui.label}
        </span>
      </div>
    </li>
  )
}

export { Row as DocumentChecklistRow }
