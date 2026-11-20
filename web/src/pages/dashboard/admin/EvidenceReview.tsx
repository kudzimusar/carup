import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import ExtractionReviewPanel from '@/components/ExtractionReviewPanel'
import { CheckCircle, FileText, Image as ImageIcon, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { EvidenceVerificationStatus, VehicleEvidence } from '@/types'
import { useInReviewWorkbench } from '@/components/dealer/reviewWorkbenchContext'
import { dealerDateTime } from '@/lib/dealerDates'
import {
  REVIEW_PRIMARY, ReviewAudienceSplit, ReviewAuditTrail, ReviewCaseBody, ReviewCaseHeader, ReviewDecisionPanel, ReviewFacts, ReviewNoCase, ReviewQueueItem, ReviewQueuePanel, ReviewQueueTabs, ReviewReasonField, ReviewSection, ReviewChoice, ReviewStatusChip, ReviewWorkbenchGrid, ReviewWorkbenchHeader, type ReviewQueueState,
} from '@/components/dealer/review/ReviewCaseFile'
import { noCaseTitle } from '@/components/dealer/review/reviewTone'

const statuses: EvidenceVerificationStatus[] = ['pending', 'verified', 'rejected']

function labelize(value?: string) {
  return (value || 'evidence')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Canonical classification is the semantic authority (Operations M1): a row
 * canonically classed import/commercial_invoice must never be presented to a
 * reviewer as a "Registration Document" because of its legacy compatibility
 * field. Legacy-only historical rows keep their historical label.
 */
function classificationLabel(item: VehicleEvidence) {
  if (item.evidence_class) {
    const subtype = item.evidence_subtype ? labelize(item.evidence_subtype) : null
    return subtype ? `${labelize(item.evidence_class)} — ${subtype}` : labelize(item.evidence_class)
  }
  return labelize(item.evidence_type)
}

export default function EvidenceReview() {
  const { fetchEvidenceReviewQueue, approveEvidence, rejectEvidence } = useCarUpApi()
  const [status, setStatus] = useState<EvidenceVerificationStatus>('pending')
  const [items, setItems] = useState<VehicleEvidence[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  // RX03-P2: a refused or failed queue read is NOT an empty queue (TI-13; MP01 §22.8).
  const [loadError, setLoadError] = useState<null | 'forbidden' | 'failed'>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // RX05-D: the unified queue offers a retry after a failed read (the legacy view has none and is unchanged).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setLoadError(null)
    fetchEvidenceReviewQueue(status)
      .then(data => {
        if (mounted) setItems(data)
      })
      .catch(err => {
        if (!mounted) return
        setItems([])
        const code = (err as { status?: number } | null)?.status
        setLoadError(code === 401 || code === 403 ? 'forbidden' : 'failed')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => { mounted = false }
  }, [fetchEvidenceReviewQueue, status, reloadKey])

  const counts = useMemo(() => ({
    total: items.length,
    photos: items.filter(item => item.evidence_type.includes('photo')).length,
    documents: items.filter(item => item.evidence_type.includes('document')).length
  }), [items])

  const review = async (item: VehicleEvidence, action: 'approve' | 'reject') => {
    setBusyId(item.id)
    try {
      const note = notes[item.id] || (action === 'approve' ? 'Evidence matches vehicle registry event.' : 'Evidence rejected during review.')
      if (action === 'approve') {
        await approveEvidence(item.vin, item.id, note, 3)
        toast.success('Evidence approved')
      } else {
        await rejectEvidence(item.vin, item.id, note, -5)
        toast.success('Evidence rejected')
      }
      setItems(current => current.filter(row => row.id !== item.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Evidence review failed')
    } finally {
      setBusyId(null)
    }
  }

  // RX05-D — unified ReviewWorkbench composition (presentation only; same reads and the same
  // approve/reject calls). Inside the independent reviewer workbench only; the admin, dealer and
  // government routes that also render this page keep the composition below.
  const inWorkbench = useInReviewWorkbench()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (inWorkbench) {
    const qs: ReviewQueueState = loading ? 'loading' : loadError ? 'unavailable' : items.length ? 'ready' : 'empty'
    const current = qs === 'ready' ? (items.find(i => i.id === selectedId) ?? items[0]) : undefined
    const ai = current?.metadata?.ai_analysis
    return (
      <div className="min-w-0 pb-8" data-testid="vehicle-evidence-review-workbench">
        <ReviewWorkbenchHeader eyebrow="Vehicle documents workbench" title="Vehicle Evidence Review"
          summaryLabel="What a document decision does — and does not do">
          <p>Approve, reject, and inspect visual proof linked to vehicle registry events.</p>
          <p>CarUp lets only administrators and government reviewers verify or reject vehicle evidence; the server checks
            your role on every decision.</p>
        </ReviewWorkbenchHeader>
        <ReviewWorkbenchGrid testId="vehicle-evidence-review-grid" caseLabel="Selected vehicle document"
          queue={<ReviewQueuePanel testId="vehicle-evidence-queue" title="Queue" listLabel="Evidence Queue"
            count={qs === 'ready' || qs === 'empty' ? counts.total : null}
            onRefresh={() => setReloadKey(k => k + 1)} state={qs} loadingText="Loading the evidence queue…"
            unavailableTestId={loadError === 'forbidden' ? 'evidence-review-forbidden' : 'evidence-review-load-failed'}
            unavailableMessage={loadError === 'forbidden'
              ? <>This vehicle document queue is not open to your session. CarUp lets only administrators and government reviewers verify or reject vehicle evidence. Nothing has been hidden from you as “empty”.</>
              : <>The evidence queue could not be loaded. The counts are unknown, not zero.</>}
            toolbar={<ReviewQueueTabs label="Evidence review status" active={status} onChange={id => { setStatus(id); setSelectedId(null) }}
              tabs={statuses.map(option => ({ id: option, label: labelize(option) }))} />}
            intro={loadError ? 'Counts unknown.' : loading ? undefined : `${counts.total} item(s) · ${counts.photos} photo(s) · ${counts.documents} document(s)`}
            emptyTitle={`No ${status} evidence items`}
            emptyBody={status === 'pending' ? 'A document appears here when it is uploaded to a vehicle file. Nothing is verified automatically.' : undefined}>
            {items.map(item => (
              <ReviewQueueItem key={item.id} testId={`vehicle-evidence-item-${item.id}`} selected={current?.id === item.id}
                title={classificationLabel(item)} status={item.verification_status}
                meta={[item.vin, `Uploaded by ${labelize(item.uploader_role).toLowerCase()}`]}
                since={item.uploaded_at} sinceLabel="Uploaded" onSelect={() => setSelectedId(item.id)} />
            ))}
          </ReviewQueuePanel>}>
          {!current && <ReviewNoCase title={noCaseTitle(qs, 'Select a vehicle document.', 'There is no document to review.')}
            body={qs==='ready'?"A document opens here from the queue: the file, any automated scan, extracted fields and the decision.":undefined} />}
          {current && <>
            <ReviewCaseHeader testId="vehicle-evidence-case-identity" eyebrow="Vehicle document" title={classificationLabel(current)}
              status={current.verification_status}
              facts={[
                { label: 'VIN', value: current.vin, mono: true },
                { label: 'Uploaded by', value: labelize(current.uploader_role) },
                { label: 'Uploaded', value: dealerDateTime(current.uploaded_at) },
                { label: 'Event', value: labelize(current.event_type) },
                { label: 'Registry event', value: current.linked_registry_event_id || 'Unlinked', mono: Boolean(current.linked_registry_event_id) },
              ]}>
              <Link to={`/admin/vehicles/${current.vin}/review`} data-testid="open-vehicle-operations"
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-carup-action-hover underline">
                Open Vehicle Operations
              </Link>
            </ReviewCaseHeader>
            <ReviewAudienceSplit audience="uploader"
              facingNote="What the vehicle file records about this document: its review status. Nothing counts toward the vehicle's trust until a reviewer decides."
              facing={<ReviewFacts items={[
                { label: 'Status on the vehicle file', value: <ReviewStatusChip status={current.verification_status} /> },
                { label: 'File', value: current.file_url ? 'Viewable in this workbench' : 'Withheld here' },
              ]} />}
              internal={<ReviewFacts items={[
                { label: 'Checksum', value: (current.checksum || current.image_hash || '').slice(0, 12) || 'missing', mono: true },
                { label: 'Trust impact on decision', value: String(current.trust_score_impact) },
                ...(current.verification_notes ? [{ label: 'Earlier reviewer note', value: current.verification_notes }] : []),
              ]} />} />
            <ReviewCaseBody
              evidence={<>
                <ReviewSection testId="vehicle-evidence-file" title="Uploaded document"
                  provenance={current.verification_status === 'pending' ? 'uploader' : 'server'}
                  provenanceLabel={current.verification_status === 'pending' ? undefined : `Reviewer decision on record: ${labelize(current.verification_status).toLowerCase()}`}>
                  {current.file_url ? (
                    <a href={current.file_url} target="_blank" rel="noopener noreferrer"
                      className="block rounded-card bg-carup-bg-surface p-3 ring-1 ring-carup-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                      {current.evidence_type.includes('document') ? (
                        <span className="flex min-h-36 flex-col items-center justify-center gap-2 text-carup-text-2">
                          <FileText className="h-8 w-8 text-carup-text-3" aria-hidden="true" />
                          <span className="text-sm font-semibold">Open document</span>
                        </span>
                      ) : (
                        <img src={current.file_url} alt={classificationLabel(current)} className="mx-auto max-h-80 w-auto max-w-full rounded-control object-contain" />
                      )}
                    </a>
                  ) : (
                    <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-carup-line-strong bg-carup-bg-surface p-3 text-carup-text-2"
                      data-testid="evidence-review-file-unavailable">
                      <FileText className="h-8 w-8 text-carup-text-3" aria-hidden="true" />
                      <span className="px-2 text-center text-sm font-semibold">File not available here</span>
                    </div>
                  )}
                </ReviewSection>
                {ai && (
                  <ReviewSection testId="vehicle-evidence-automated-scan" title="Automated scan" provenance="server"
                    provenanceLabel="Advisory only · not a decision"
                    description="Machine output. It never verifies or rejects a document; only your decision does.">
                    <ReviewFacts items={[
                      { label: 'Scan result', value: labelize(ai.ai_status) },
                      { label: 'Confidence', value: `${Math.round(ai.confidence * 100)}%` },
                      { label: 'Scan suggestion (not a decision)', value: ai.recommended_action || 'None' },
                    ]} />
                    {ai.reviewer_summary && <p className="text-sm leading-6 text-carup-text-2">{ai.reviewer_summary}</p>}
                    {(ai.visible_vin || ai.visible_plate || ai.visible_odometer) && (
                      <ul className="grid gap-2 text-sm sm:grid-cols-2">
                        {ai.visible_vin && (
                          <li className={`rounded-control p-2.5 ${ai.visible_vin !== current.vin ? 'bg-status-warning-soft text-status-warning' : 'bg-carup-bg-surface text-carup-text'}`}>
                            Visible VIN: <span className="font-mono font-semibold">{ai.visible_vin}</span>
                            <span className="block text-xs">{ai.visible_vin !== current.vin ? 'Does not match the vehicle VIN' : 'Same characters as the vehicle VIN (read by the scan)'}</span>
                          </li>
                        )}
                        {ai.visible_plate && <li className="rounded-control bg-carup-bg-surface p-2.5 text-carup-text">Visible plate: <span className="font-semibold">{ai.visible_plate}</span></li>}
                        {ai.visible_odometer && <li className="rounded-control bg-carup-bg-surface p-2.5 text-carup-text">Odometer: <span className="font-semibold">{Number(ai.visible_odometer).toLocaleString()} km</span></li>}
                      </ul>
                    )}
                    {ai.damage_indicators && ai.damage_indicators.length > 0 && (
                      <p className="text-sm text-carup-text"><span className="font-semibold">Damage indicators: </span>
                        {ai.damage_indicators.map(d => `${d.type} (${d.severity})${d.location ? ` @ ${d.location}` : ''}`).join(' · ')}</p>
                    )}
                    {ai.manipulation_indicators && ai.manipulation_indicators.length > 0 && (
                      <p className="rounded-control bg-status-warning-soft p-2.5 text-sm text-status-warning"><span className="font-semibold">Manipulation indicators: </span>
                        {ai.manipulation_indicators.map(m => `${m.type} (${m.severity})`).join(' · ')}</p>
                    )}
                  </ReviewSection>
                )}
                <ReviewSection testId="vehicle-evidence-extractions" title="Extracted fields" provenance="server"
                  provenanceLabel="Read from the document · confirm each field">
                  <ExtractionReviewPanel vin={current.vin} evidenceId={current.id} />
                </ReviewSection>
              </>}
              decision={<div className="min-w-0 space-y-4" data-testid="vehicle-evidence-decision">
                {current.verification_status === 'pending'
                  ? <VehicleEvidenceDecision key={current.id} note={notes[current.id] || ''} busy={busyId === current.id}
                      onNote={value => setNotes(prev => ({ ...prev, [current.id]: value }))}
                      onDecide={action => { void review(current, action) }} />
                  : <ReviewNoCase title={`Decision on record: ${labelize(current.verification_status).toLowerCase()}`}
                      body="This document is no longer waiting for a decision. Switch to Pending to review waiting documents." />}
              </div>}
              audit={<ReviewAuditTrail testId="vehicle-evidence-audit-trail"
                entries={[
                  { id: 'uploaded', title: `Uploaded by ${labelize(current.uploader_role).toLowerCase()}`, at: current.uploaded_at },
                  ...(current.captured_at ? [{ id: 'captured', title: 'Captured', at: current.captured_at }] : []),
                  ...(current.verification_status !== 'pending' ? [{ id: 'decision', title: 'Reviewer decision recorded', status: current.verification_status,
                    detail: current.verification_notes || undefined }] : []),
                ]}
                empty="Nothing recorded yet."
                note="The queue returns upload and capture times; a decision's time is not returned here." />} />
          </>}
        </ReviewWorkbenchGrid>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Vehicle Evidence Review</h1>
          <p className="text-gray-500">Approve, reject, and inspect visual proof linked to vehicle registry events.</p>
        </div>
        <Tabs value={status} onValueChange={(value) => setStatus(value as EvidenceVerificationStatus)}>
          <TabsList>
            {statuses.map(option => (
              <TabsTrigger key={option} value={option}>{labelize(option)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {loadError === 'forbidden' && (
        <div role="alert" data-testid="evidence-review-forbidden"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">This vehicle document queue is not open to your session.</p>
          <p className="mt-1">
            CarUp lets only administrators and government reviewers verify or reject vehicle evidence.
            Nothing has been hidden from you as "empty": the queue simply was not shared with this role.
          </p>
        </div>
      )}
      {loadError === 'failed' && (
        <div role="alert" data-testid="evidence-review-load-failed"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          <p className="font-semibold">The evidence queue could not be loaded.</p>
          <p className="mt-1">The counts below are unknown, not zero. Try again shortly.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: 'Queue Items', value: counts.total },
          { label: 'Photos', value: counts.photos },
          { label: 'Documents', value: counts.documents },
        ].map(stat => (
          <Card key={stat.label} className="border-0 card-shadow">
            <CardContent className="p-5">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{loadError ? 'Unknown' : stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Evidence Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="py-12 flex justify-center text-orange-500">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-gray-600" data-testid="evidence-review-queue-unknown">
              Queue not shown — see the notice above.
            </p>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No {status} evidence items</p>
            </div>
          ) : (
            items.map(item => {
              const isDocument = item.evidence_type.includes('document')
              return (
                <div key={item.id} className="grid lg:grid-cols-[180px_1fr] gap-4 rounded-lg border border-gray-100 bg-white p-4">
                  {/* A reviewer surface, but the artifact can still be absent: the row is real and
                      the FILE may be withheld. A null href navigates to the current page and reads
                      as a fault, so the link is only rendered when there is something to open. */}
                  {item.file_url ? (
                    <a href={item.file_url} target="_blank" rel="noopener noreferrer" className="block">
                      {isDocument ? (
                        <div className="h-36 rounded-md bg-gray-50 flex flex-col items-center justify-center text-gray-500 gap-2">
                          <FileText className="w-8 h-8 text-orange-500" />
                          <span className="text-xs font-medium">Open document</span>
                        </div>
                      ) : (
                        <img src={item.file_url} alt={classificationLabel(item)} className="h-36 w-full rounded-md object-cover bg-gray-100" />
                      )}
                    </a>
                  ) : (
                    <div
                      className="h-36 rounded-md bg-gray-50 flex flex-col items-center justify-center text-gray-500 gap-2"
                      data-testid="evidence-review-file-unavailable"
                    >
                      <FileText className="w-8 h-8 text-gray-300" />
                      <span className="text-xs font-medium text-center px-2">File not available here</span>
                    </div>
                  )}

                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isDocument ? <FileText className="w-4 h-4 text-orange-500" /> : <ImageIcon className="w-4 h-4 text-orange-500" />}
                          <h2 className="font-semibold">{classificationLabel(item)}</h2>
                          <Badge variant="outline" className="text-[10px]">{labelize(item.verification_status)}</Badge>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {item.vin} · {labelize(item.uploader_role)} · {new Date(item.uploaded_at).toLocaleString()}
                          {' · '}
                          <Link
                            to={`/admin/vehicles/${item.vin}/review`}
                            className="text-orange-600 hover:underline"
                            data-testid="open-vehicle-operations"
                          >
                            Open Vehicle Operations
                          </Link>
                        </p>
                      </div>
                      <Badge className="bg-gray-100 text-gray-700 border-0 shadow-none w-fit">
                        {item.linked_registry_event_id || 'Unlinked'}
                      </Badge>
                    </div>

                    <div className="grid md:grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-gray-50 px-3 py-2">
                        Event: <span className="font-medium">{labelize(item.event_type)}</span>
                      </div>
                      <div className="rounded-md bg-gray-50 px-3 py-2">
                        Checksum: <span className="font-mono">{(item.checksum || item.image_hash || '').slice(0, 12) || 'missing'}</span>
                      </div>
                      <div className="rounded-md bg-gray-50 px-3 py-2">
                        Trust impact: <span className="font-medium">{item.trust_score_impact}</span>
                      </div>
                    </div>

                    {/* AI Assisted Analysis Section */}
                    {item.metadata?.ai_analysis && (
                      <div className="rounded-lg border border-orange-100 bg-orange-50/20 p-3.5 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-100/50 pb-2">
                          <div className="flex items-center gap-1.5 font-semibold text-orange-950">
                            <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                            AI Copilot Fraud Scan
                          </div>
                          <div className="flex gap-2">
                            <Badge className={`border-0 ${
                              item.metadata.ai_analysis.ai_status === 'ai_passed' ? 'bg-green-100 text-green-700 hover:bg-green-100' :
                              item.metadata.ai_analysis.ai_status === 'ai_flagged' ? 'bg-red-100 text-red-700 font-bold hover:bg-red-100' :
                              item.metadata.ai_analysis.ai_status === 'ai_low_confidence' ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' :
                              'bg-gray-100 text-gray-700 hover:bg-gray-100'
                            }`}>
                              {labelize(item.metadata.ai_analysis.ai_status)}
                            </Badge>
                            <Badge className="bg-orange-100 text-orange-850 hover:bg-orange-100 border-0 font-normal">
                              Confidence: {Math.round(item.metadata.ai_analysis.confidence * 100)}%
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-gray-700">
                            <strong className="text-gray-900 font-medium font-sans">Summary:</strong>
                            {" "}{item.metadata.ai_analysis.reviewer_summary}
                          </p>

                          {/* Data Extraction & Mismatch Alert */}
                          {(item.metadata.ai_analysis.visible_vin || item.metadata.ai_analysis.visible_plate || item.metadata.ai_analysis.visible_odometer) && (
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                              {item.metadata.ai_analysis.visible_vin && (
                                <div className={`px-2.5 py-1.5 rounded border ${
                                  item.metadata.ai_analysis.visible_vin !== item.vin
                                    ? 'bg-red-50/50 border-red-200 text-red-800'
                                    : 'bg-green-50/30 border-green-200 text-green-800'
                                }`}>
                                  Visible VIN: <span className="font-mono font-bold">{item.metadata.ai_analysis.visible_vin}</span>
                                  {item.metadata.ai_analysis.visible_vin !== item.vin && (
                                    <span className="block text-[10px] text-red-500 font-medium mt-0.5">⚠️ Mismatch with vehicle VIN</span>
                                  )}
                                </div>
                              )}
                              {item.metadata.ai_analysis.visible_plate && (
                                <div className="px-2.5 py-1.5 rounded border bg-gray-50 border-gray-200 text-gray-800">
                                  Visible Plate: <span className="font-bold">{item.metadata.ai_analysis.visible_plate}</span>
                                </div>
                              )}
                              {item.metadata.ai_analysis.visible_odometer && (
                                <div className="px-2.5 py-1.5 rounded border bg-gray-50 border-gray-200 text-gray-800">
                                  Odometer: <span className="font-bold">{Number(item.metadata.ai_analysis.visible_odometer).toLocaleString()} km</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Indicators */}
                          {item.metadata.ai_analysis.damage_indicators && item.metadata.ai_analysis.damage_indicators.length > 0 && (
                            <div className="pt-1">
                              <span className="font-semibold text-gray-900">Damage Indicators: </span>
                              {item.metadata.ai_analysis.damage_indicators.map((d: any, idx: number) => (
                                <span key={idx} className="inline-block bg-orange-100/50 text-orange-900 px-2 py-0.5 rounded mr-1">
                                  {d.type} ({d.severity}) {d.location && `@ ${d.location}`}
                                </span>
                              ))}
                            </div>
                          )}

                          {item.metadata.ai_analysis.manipulation_indicators && item.metadata.ai_analysis.manipulation_indicators.length > 0 && (
                            <div className="pt-1 text-red-800">
                              <span className="font-semibold">Manipulation Indicators: </span>
                              {item.metadata.ai_analysis.manipulation_indicators.map((m: any, idx: number) => (
                                <span key={idx} className="inline-block bg-red-100/50 px-2 py-0.5 rounded mr-1 font-medium">
                                  {m.type} ({m.severity})
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Recommended Action */}
                          <div className="pt-1 flex items-center gap-1.5">
                            <span className="font-semibold text-gray-900">Recommended Action: </span>
                            <span className={`font-bold capitalize ${
                              item.metadata.ai_analysis.recommended_action === 'approve' ? 'text-green-700' :
                              item.metadata.ai_analysis.recommended_action === 'reject' ? 'text-red-700' :
                              'text-amber-700'
                            }`}>
                              {item.metadata.ai_analysis.recommended_action}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {item.verification_notes && (
                      <p className="text-xs text-gray-700 bg-gray-50 p-2.5 rounded-md italic border border-gray-100">
                        "{item.verification_notes}"
                      </p>
                    )}

                    {/* Phase 12: OCR field-level extractions for this evidence (states, confidence,
                        identity match) with reviewer confirm/reject/amend/waive. */}
                    <div className="rounded-md border border-gray-100 bg-gray-50/50 p-2.5">
                      <ExtractionReviewPanel vin={item.vin} evidenceId={item.id} />
                    </div>

                    {status === 'pending' && (
                      <div className="space-y-3">
                        <Textarea
                          value={notes[item.id] || ''}
                          onChange={(event) => setNotes(current => ({ ...current, [item.id]: event.target.value }))}
                          placeholder="Review notes"
                          className="min-h-20"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            className="bg-green-600 hover:bg-green-700 gap-2"
                            onClick={() => review(item, 'approve')}
                            disabled={busyId === item.id}
                          >
                            {busyId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => review(item, 'reject')}
                            disabled={busyId === item.id}
                          >
                            <XCircle className="w-4 h-4" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** RX05-D — a vehicle-document reviewer note is required before either decision (UI-only minimum). */
const VEHICLE_EVIDENCE_NOTE_MIN = 20

/**
 * RX05-D — one decision for one document: choose approve or reject, write the REQUIRED note, then one
 * submit. Keyed by evidence id, so a choice never carries over to the next document in the queue.
 * The page's own `review()` makes the call; nothing here decides on its own.
 */
function VehicleEvidenceDecision({ note, busy, onNote, onDecide }: {
  note: string; busy: boolean; onNote: (value: string) => void; onDecide: (action: 'approve' | 'reject') => void
}) {
  const [action, setAction] = useState<'approve' | 'reject' | ''>('')
  const noteOk = note.trim().length >= VEHICLE_EVIDENCE_NOTE_MIN
  return (
    <ReviewDecisionPanel title="Review this document"
      description="There is no password step-up for this decision; the server accepts it only from administrators and government reviewers."
      requirements={[
        { label: 'Approve or reject chosen', met: Boolean(action) },
        { label: `Reviewer note written (at least ${VEHICLE_EVIDENCE_NOTE_MIN} characters)`, met: noteOk },
      ]}
      footnote="There is no undo in this workbench."
      submit={<button type="button" className={REVIEW_PRIMARY} disabled={busy || !action || !noteOk}
        onClick={() => { if (action && noteOk) onDecide(action) }}>{busy ? 'Recording…' : 'Record decision'}</button>}>
      <ReviewChoice<'approve' | 'reject'> id="vehicle-evidence-decision" legend="Decision" value={action} onChange={setAction} options={[
        ['approve', 'Approve — it supports the linked registry event'],
        ['reject', 'Reject — it does not support the event'],
      ]} />
      <ReviewReasonField id="vehicle-evidence-note" label="Reviewer note" value={note} onChange={onNote}
        min={VEHICLE_EVIDENCE_NOTE_MIN} minHeight="min-h-24"
        audience="Recorded with your decision as this document's verification note." />
    </ReviewDecisionPanel>
  )
}
