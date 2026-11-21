/**
 * RX-06 — Import Order › Documents: a task list, not a file dump.
 *
 *  - The required set: for each requirement, UPLOADED and VERIFIED are separate facts (documentState),
 *    with when and by whom from the latest live submission; rejected / flagged / disagreeing rows lead.
 *  - Every submission, newest first, with an automated read (OCR) shown as a CANDIDATE, never as
 *    verification. Originals are stored privately; this page neither opens nor downloads them (as before).
 *  - The upload form (same rules, same two calls, same messages as the legacy page).
 *  - CarUp reviewers additionally review in place: run OCR, verify with notes, reject with a reason.
 */
import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, FileText, Loader2, Upload, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { documentState } from '@/components/trade/core/importOrderLifecycle'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { WS_DANGER, WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_SECONDARY, WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import type { DiasporaTradeDocument } from '@/types'
import {
  DOCUMENT_TYPE_OPTIONS,
  REQUIRED_DOCUMENTS,
  REQUIRED_DOCUMENT_TYPES,
  REQUIRED_STATE_TONE,
  actorLabel,
  documentFileProblem,
  documentTypeLabel,
  formatWhen,
  isTradeOperator,
  latestSubmissionFor,
  requiredDocumentState,
  requirementFor,
  requiredDocumentTally,
  timeOf,
  truncateMessage,
  type Read,
  type Tone,
  type TradeOrder,
} from './orderModel'
import type { ImportOrderActions, OcrRunResult, TradeViewer } from './orderViewTypes'
import { NotRecorded, Panel, Provenance, ReadGate } from './TradeKit'

const TRUTH_TONE: Record<string, Tone> = {
  missing: 'neutral', uploaded: 'info', in_review: 'info', verified: 'success', rejected: 'danger', flagged: 'warning', unknown: 'neutral',
}

export function OrderDocumentsPanel({ order, viewer, documents, actions }: {
  order: TradeOrder
  viewer: TradeViewer
  documents: Read<DiasporaTradeDocument[]>
  actions?: ImportOrderActions
}) {
  const [documentType, setDocumentType] = useState('')
  const formRef = useRef<HTMLFormElement | null>(null)
  const startUpload = (type: string) => {
    setDocumentType(type)
    formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    formRef.current?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true })
  }
  return (
    <div className="space-y-5" data-testid="trade-documents">
      <p className="flex items-start gap-2 rounded-control bg-carup-bg-surface px-3 py-2.5 text-sm leading-6 text-carup-text-2" data-testid="trade-documents-principle">
        <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
        <span><strong className="font-semibold text-carup-text">Uploaded is not verified.</strong> A CarUp reviewer checks each original. An automated read (OCR) only suggests fields — it never verifies a document. Only documents for this order are shown.</span>
      </p>
      <ReadGate read={documents} label="the order’s documents" testId="trade-documents-read">
        {docs => (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            {/* The task comes first on phones; on desktop it sits beside the lists and stays in view. */}
            <div className="min-w-0 xl:sticky xl:top-36 xl:col-start-2 xl:row-start-1 xl:self-start">
              {actions?.uploadDocument ? (
                <UploadForm order={order} formRef={formRef} documentType={documentType} setDocumentType={setDocumentType} actions={actions} />
              ) : (
                <Panel title="Upload a document" testId="trade-upload-unavailable">
                  <p className="text-sm text-carup-text-2">Uploading is not available in this view.</p>
                </Panel>
              )}
            </div>
            <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-1">
              <RequiredSet docs={docs} viewer={viewer} onUpload={actions?.uploadDocument ? startUpload : undefined} />
              <Submissions docs={docs} viewer={viewer} actions={actions} />
            </div>
          </div>
        )}
      </ReadGate>
    </div>
  )
}

/* ── The required set ─────────────────────────────────────────────────────────────────────────── */

function RequiredSet({ docs, viewer, onUpload }: { docs: DiasporaTradeDocument[]; viewer: TradeViewer; onUpload?: (type: string) => void }) {
  const tally = requiredDocumentTally(docs)
  return (
    <Panel title="Required for this import" eyebrow={`${tally.uploaded} of ${tally.total} uploaded · ${tally.verified} verified`} testId="trade-required-set">
      <ul className="divide-y divide-carup-line">
        {REQUIRED_DOCUMENTS.map((name, i) => {
          const state = requiredDocumentState(name, docs)
          const latest = latestSubmissionFor(name, docs)
          const latestTruth = latest ? documentState(latest.verification_status || 'UPLOADED') : null
          const verified = state === 'Verified'
          const types = REQUIRED_DOCUMENT_TYPES[name] ?? []
          return (
            <li key={name} className="grid gap-3 py-3.5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-start" data-testid="trade-required-row" data-state={state}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-carup-text">{name}</p>
                <p className="text-xs text-carup-text-3">Required · accepted as {types.map(documentTypeLabel).join(', ')}</p>
                <div className="mt-1.5"><StatusChip tone={REQUIRED_STATE_TONE[state]} testId={`trade-required-status-${i}`}>{state}</StatusChip></div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="min-w-0">
                  <dt className="text-carup-text-3">Uploaded</dt>
                  <dd className="font-semibold text-carup-text" data-testid={`trade-required-uploaded-${i}`}>
                    {latest ? `Yes · ${formatWhen(latest.created_at) ?? 'time not recorded'}` : 'No'}
                  </dd>
                  {latest && <dd className="text-carup-text-3">by {actorLabel(latest.uploaded_by, viewer.id)}</dd>}
                </div>
                <div className="min-w-0">
                  <dt className="text-carup-text-3">Verified</dt>
                  <dd className="font-semibold text-carup-text" data-testid={`trade-required-verified-${i}`}>
                    {verified ? `Yes${latest?.reviewed_at ? ` · ${formatWhen(latest.reviewed_at)}` : ''}` : 'No'}
                  </dd>
                  {verified && latest?.reviewed_by && <dd className="text-carup-text-3">by {actorLabel(latest.reviewed_by, viewer.id)}</dd>}
                  {!verified && latestTruth && <dd className="text-carup-text-3">{latestTruth.label}</dd>}
                  {state === 'Review needed' && <dd className="text-carup-text-3">Submissions disagree — CarUp confirms which stands</dd>}
                </div>
              </dl>
              {onUpload && (state === 'Pending' || state === 'Rejected' || state === 'Flagged') && (
                <button type="button" className={WS_SECONDARY} onClick={() => onUpload(types[0] ?? '')} data-testid={`trade-required-upload-${i}`}>
                  <Upload className="h-4 w-4" aria-hidden="true" /> {state === 'Pending' ? 'Upload' : 'Replace'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/* ── Every submission ─────────────────────────────────────────────────────────────────────────── */

function Submissions({ docs, viewer, actions }: { docs: DiasporaTradeDocument[]; viewer: TradeViewer; actions?: ImportOrderActions }) {
  const sorted = [...docs].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0))
  const operator = isTradeOperator(viewer.role)
  const canReview = operator && Boolean(actions?.verifyDocument || actions?.rejectDocument || actions?.runOcr)
  return (
    <Panel title="Every submission" eyebrow={`${docs.length} on record`} testId="trade-submissions">
      {sorted.length === 0 ? (
        <p className="text-sm leading-6 text-carup-text-2" data-testid="trade-submissions-empty">
          No documents uploaded yet. Upload the first one with the form — each one is reviewed by CarUp before it counts as verified.
        </p>
      ) : (
        <ul className="divide-y divide-carup-line">
          {sorted.map(doc => <SubmissionRow key={doc.id} doc={doc} viewer={viewer} actions={canReview ? actions : undefined} />)}
        </ul>
      )}
      <p className="mt-3 text-xs leading-5 text-carup-text-3">Originals are stored privately with this order. This page does not open or download them.</p>
    </Panel>
  )
}

function SubmissionRow({ doc, viewer, actions }: { doc: DiasporaTradeDocument; viewer: TradeViewer; actions?: ImportOrderActions }) {
  const truth = documentState(doc.verification_status || 'UPLOADED')
  const extractions = doc.extractions ?? []
  return (
    <li className="py-3.5 first:pt-0 last:pb-0" data-testid="trade-submission-row" data-truth={truth.truth}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-carup-text">{documentTypeLabel(doc.document_type)}</p>
            <p className="text-xs text-carup-text-3" data-testid="trade-submission-requirement">
              {requirementFor(doc.document_type) ? `Required · counts toward “${requirementFor(doc.document_type)}”` : 'Supporting document · not one of the five required'}
            </p>
            {doc.file_name && <p className="text-xs text-carup-text-3 [overflow-wrap:anywhere]">{doc.file_name}</p>}
          </div>
        </div>
        <StatusChip tone={TRUTH_TONE[truth.truth] ?? 'neutral'} testId="trade-submission-status">{truth.label}</StatusChip>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-6 text-xs">
        <div><dt className="text-carup-text-3">Uploaded</dt><dd className="font-semibold text-carup-text">{truth.uploaded ? `${formatWhen(doc.created_at) ?? 'time not recorded'} · ${actorLabel(doc.uploaded_by, viewer.id)}` : 'No'}</dd></div>
        <div><dt className="text-carup-text-3">Verified</dt><dd className="font-semibold text-carup-text" data-testid="trade-submission-verified">{truth.verified ? `Yes${doc.reviewed_at ? ` · ${formatWhen(doc.reviewed_at)}` : ''}${doc.reviewed_by ? ` · ${actorLabel(doc.reviewed_by, viewer.id)}` : ''}` : 'No'}</dd></div>
      </dl>
      {extractions.length > 0 && (
        <details className="group mt-2 pl-6" data-testid="trade-submission-ocr">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-carup-text [&::-webkit-details-marker]:hidden">
            <Provenance kind="automated">Automated read · not verified</Provenance>
            <span>{extractions.length} extraction{extractions.length === 1 ? '' : 's'}</span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="mt-1 space-y-2">
            {extractions.map(x => (
              <div key={x.id} className="rounded-control bg-carup-bg-surface p-3 text-xs text-carup-text-2">
                <p>Provider: <span className="font-semibold text-carup-text">{x.extraction_provider || 'carup_ocr'}</span> · Confidence: <span className="font-semibold text-carup-text">{typeof x.confidence_score === 'number' ? `${(x.confidence_score * 100).toFixed(1)}%` : 'not reported'}</span></p>
                {x.extracted_fields && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-carup-text">{JSON.stringify(x.extracted_fields, null, 2)}</pre>}
              </div>
            ))}
          </div>
        </details>
      )}
      {actions && <ReviewControls doc={doc} actions={actions} />}
    </li>
  )
}

/* ── Reviewer controls (CarUp review roles only; the backend enforces) ────────────────────────── */

function ReviewControls({ doc, actions }: { doc: DiasporaTradeDocument; actions: ImportOrderActions }) {
  const status = String(doc.verification_status || 'UPLOADED').toUpperCase()
  const terminal = status === 'VERIFIED' || status === 'REJECTED'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'verify' | 'reject' | 'ocr' | null>(null)
  const [error, setError] = useState('')
  const [verifyNotes, setVerifyNotes] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectNotes, setRejectNotes] = useState('')
  const [ocr, setOcr] = useState<OcrRunResult | null>(null)
  if (terminal) return null

  const act = async (kind: 'verify' | 'reject' | 'ocr', fn: () => Promise<unknown>, fallback: string) => {
    setBusy(kind)
    setError('')
    try {
      const out = await fn()
      if (kind === 'ocr') setOcr((out as OcrRunResult | null) ?? null)
      if (kind === 'reject') { setRejecting(false); setRejectReason(''); setRejectNotes('') }
      actions.onDocumentsChanged?.()
    } catch (err) {
      setError(truncateMessage(err, fallback))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-2 pl-6" data-testid={`diaspora-document-review-${doc.id}`}>
      <button type="button" className={WS_TEXT_ACTION} aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid="trade-review-toggle">
        Review this document <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-card border border-carup-line bg-carup-bg-surface p-3">
          {error && <WorkspaceNotice tone="danger" testId="diaspora-review-error">{error}</WorkspaceNotice>}
          {ocr && (
            <div className="rounded-control bg-carup-bg-raised p-3 text-xs text-carup-text-2" data-testid="trade-review-ocr-result">
              <p className="mb-1"><Provenance kind="automated">OCR result · a candidate, not a verification</Provenance></p>
              <p>Document id: <code className="font-mono">{ocr.ocrDocumentId}</code> · Success: {ocr.success ? 'Yes' : 'No'}</p>
              {ocr.qualityMetrics && (
                <p>Quality passed: {(ocr.qualityMetrics as Record<string, unknown>).qualityPassed ? 'Yes' : 'No'} · Blur score: {typeof (ocr.qualityMetrics as Record<string, unknown>).blurScore === 'number' ? ((ocr.qualityMetrics as Record<string, number>).blurScore).toFixed(2) : 'not reported'}</p>
              )}
            </div>
          )}
          {!rejecting && status === 'UPLOADED' && actions.runOcr && (
            <button type="button" className={WS_SECONDARY} disabled={busy !== null} onClick={() => act('ocr', () => actions.runOcr!(doc.id), 'OCR extraction failed')} data-testid="diaspora-run-ocr-button">
              {busy === 'ocr' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Bot className="h-4 w-4" aria-hidden="true" />} Run OCR extraction
            </button>
          )}
          {!rejecting && actions.verifyDocument && (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="min-w-0"><span className={WS_LABEL}>Verification notes (optional)</span>
                <input value={verifyNotes} onChange={e => setVerifyNotes(e.target.value)} className={WS_FIELD} data-testid="diaspora-verify-notes-input" />
              </label>
              <button type="button" className={WS_PRIMARY} disabled={busy !== null} onClick={() => act('verify', () => actions.verifyDocument!(doc.id, { notes: verifyNotes || undefined }), 'Verification failed')} data-testid="diaspora-verify-button">
                {busy === 'verify' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />} Verify document
              </button>
            </div>
          )}
          {actions.rejectDocument && (rejecting ? (
            <div className="space-y-2 border-t border-carup-line pt-3">
              <label className="block"><span className={WS_LABEL}>Rejection reason (required)</span>
                <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} className={WS_FIELD} data-testid="diaspora-reject-reason-input" />
              </label>
              <label className="block"><span className={WS_LABEL}>Additional notes (optional)</span>
                <input value={rejectNotes} onChange={e => setRejectNotes(e.target.value)} className={WS_FIELD} data-testid="diaspora-reject-notes-input" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={WS_DANGER} disabled={busy !== null || !rejectReason.trim()} data-testid="diaspora-confirm-reject-button"
                  onClick={() => act('reject', () => actions.rejectDocument!(doc.id, { reason: rejectReason, notes: rejectNotes || undefined }), 'Rejection failed')}>
                  {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />} Confirm rejection
                </button>
                <button type="button" className={WS_SECONDARY} onClick={() => { setRejecting(false); setRejectReason(''); setRejectNotes(''); setError('') }} data-testid="diaspora-cancel-reject-button">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className={WS_DANGER} onClick={() => setRejecting(true)} data-testid="diaspora-reject-button"><XCircle className="h-4 w-4" aria-hidden="true" /> Reject…</button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Upload ───────────────────────────────────────────────────────────────────────────────────── */

function UploadForm({ order, formRef, documentType, setDocumentType, actions }: {
  order: TradeOrder
  formRef: RefObject<HTMLFormElement | null>
  documentType: string
  setDocumentType: (value: string) => void
  actions: ImportOrderActions
}) {
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onFile = (selected: File | undefined | null) => {
    setReceipt('')
    if (!selected) { setFile(null); return }
    const problem = documentFileProblem(selected)
    if (problem) { setError(problem); setFile(null); return }
    setError('')
    setFile(selected)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!documentType) { setError('Please select a document type.'); return }
    if (!file) { setError('Please select a file to upload.'); return }
    setSubmitting(true)
    setError('')
    setReceipt('')
    setProgress('Uploading file...')
    try {
      const created = await actions.uploadDocument!(file, documentType, setProgress)
      actions.onDocumentUploaded?.(created)
      setReceipt(`${documentTypeLabel(documentType)} uploaded — it now waits for a CarUp reviewer. It is not verified yet.`)
      setDocumentType('')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setProgress('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload document.')
      setProgress('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form ref={formRef} id="trade-upload-form" onSubmit={submit} className="scroll-mt-32 rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5" data-testid="diaspora-document-upload-form" aria-labelledby="trade-upload-title">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-carup-text-2" aria-hidden="true" />
        <h2 id="trade-upload-title" className="text-base font-semibold text-carup-text">Upload a document</h2>
      </div>
      <p className="mt-1 text-xs leading-5 text-carup-text-2">For import order <code className="font-mono">{order.id.slice(0, 8)}</code>. PDF or image; stored privately and may be read automatically for a reviewer. Uploading does not verify it.</p>
      <div className="mt-4 space-y-4">
        <div>
          <label className={WS_LABEL} htmlFor="trade-document-type">Document type</label>
          <select id="trade-document-type" value={documentType} onChange={e => { setDocumentType(e.target.value); setReceipt('') }} className={WS_FIELD} data-testid="diaspora-document-type-select">
            <option value="">Select document type</option>
            {DOCUMENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={WS_LABEL} htmlFor="trade-document-file">File</label>
          <input ref={fileInputRef} id="trade-document-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => onFile(e.target.files?.[0])}
            className={cn(WS_FIELD, 'py-2.5 file:mr-3 file:rounded-control file:border-0 file:bg-carup-bg-surface file:px-3 file:py-1 file:text-sm file:font-semibold file:text-carup-text')}
            data-testid="diaspora-document-file-input" aria-describedby="trade-document-file-hint" />
          <p id="trade-document-file-hint" className={WS_HINT}>PDF, JPEG, PNG or WebP · up to 10 MB.</p>
          {file && <p className="mt-1 text-xs text-carup-text-2" data-testid="diaspora-document-file-selected">Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</p>}
        </div>
        <div aria-live="polite" className="space-y-2">
          {progress && <WorkspaceNotice testId="diaspora-document-upload-progress">{progress}</WorkspaceNotice>}
          {error && <WorkspaceNotice tone="danger" testId="diaspora-document-upload-error"><strong className="font-semibold">Upload failed.</strong> {error}</WorkspaceNotice>}
          {receipt && <WorkspaceNotice testId="trade-document-upload-receipt">{receipt}</WorkspaceNotice>}
        </div>
        <button type="submit" className={cn(WS_PRIMARY, 'w-full')} disabled={submitting || !documentType || !file} data-testid="diaspora-document-upload-submit">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
          Upload document
        </button>
      </div>
      {!documentType && !file && <p className="mt-3 text-xs text-carup-text-3"><NotRecorded>Choose a type, then a file.</NotRecorded></p>}
    </form>
  )
}
