import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { CheckCircle, Loader2, RotateCcw, ShieldAlert, StickyNote, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  REVIEWABLE_VERIFICATION_STATUSES,
  getVerificationStatusMeta,
  type AdminVerificationSession,
  type VerificationReviewRequest,
  type VerificationSessionStatus,
  type VerificationStatusTone,
} from '@shared/types'

const toneBadgeClass: Record<VerificationStatusTone, string> = {
  positive: 'bg-green-100 text-green-700',
  pending: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  negative: 'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-700',
}

function labelize(value?: string | null) {
  return (value || '—')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function shortId(value?: string | null) {
  if (!value) return '—'
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function formatTimestamp(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

type ScalarOcrField = 'first_name' | 'last_name' | 'national_id_number' | 'date_of_birth' | 'country'

const OCR_FIELDS: Array<{ key: ScalarOcrField; label: string }> = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'national_id_number', label: 'National ID number' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'country', label: 'Country' },
]

export default function VerificationReview() {
  const { fetchVerificationReviewQueue, reviewVerificationSession } = useCarUpApi()
  const [status, setStatus] = useState<VerificationSessionStatus>('pending_manual_review')
  const [items, setItems] = useState<AdminVerificationSession[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [retryReasons, setRetryReasons] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingApproveId, setConfirmingApproveId] = useState<string | null>(null)

  const load = useCallback(
    async (nextStatus: VerificationSessionStatus) => {
      setLoading(true)
      setLoadError(null)
      try {
        const data = await fetchVerificationReviewQueue(nextStatus)
        setItems(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load the verification queue.'
        setLoadError(message)
        setItems([])
      } finally {
        setLoading(false)
      }
    },
    [fetchVerificationReviewQueue],
  )

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setLoadError(null)
    fetchVerificationReviewQueue(status)
      .then((data) => { if (mounted) setItems(data) })
      .catch((err) => {
        if (!mounted) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load the verification queue.')
        setItems([])
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [fetchVerificationReviewQueue, status])

  const counts = useMemo(() => ({
    total: items.length,
    actionable: items.filter((item) => getVerificationStatusMeta(item.status).adminActionAllowed).length,
  }), [items])

  const submitReview = async (item: AdminVerificationSession, action: VerificationReviewRequest['action']) => {
    const note = (notes[item.id] || '').trim()
    const retryReason = (retryReasons[item.id] || '').trim()

    if (action === 'reject' && !note) {
      toast.error('Rejection requires a note explaining why.')
      return
    }
    if (action === 'request_retry' && !retryReason) {
      toast.error('Request retry requires a retry reason for the user.')
      return
    }
    if (action === 'add_review_notes' && !note) {
      toast.error('Enter a note before saving.')
      return
    }

    setBusyId(item.id)
    try {
      const body: VerificationReviewRequest = { action }
      if (note) body.reviewNotes = note
      if (action === 'request_retry') body.retryReason = retryReason
      await reviewVerificationSession(item.id, body)
      toast.success(
        action === 'approve' ? 'Verification approved'
          : action === 'reject' ? 'Verification rejected'
          : action === 'request_retry' ? 'Retry requested'
          : 'Review note saved',
      )
      setConfirmingApproveId(null)
      // Status-changing actions move the row out of the current filter; a
      // refetch is always correct (the backend remains the source of truth).
      await load(status)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Review action failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-orange-500" />
            Identity Verification Review
          </h1>
          <p className="text-gray-500">
            Review submitted identity sessions. Approve, reject, request a retry, or leave notes. Document
            images are never exposed here — only uploaded-side status and sanitized OCR fields.
          </p>
        </div>
        <Tabs value={status} onValueChange={(value) => setStatus(value as VerificationSessionStatus)}>
          <TabsList>
            {REVIEWABLE_VERIFICATION_STATUSES.map((option) => (
              <TabsTrigger key={option} value={option}>{getVerificationStatusMeta(option).label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {[
          { label: 'Queue Items', value: counts.total },
          { label: 'Awaiting Decision', value: counts.actionable },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow">
            <CardContent className="p-5">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{getVerificationStatusMeta(status).label} Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="py-12 flex justify-center text-orange-500">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="py-12 text-center text-red-500 space-y-3">
              <ShieldAlert className="w-10 h-10 mx-auto opacity-40" />
              <p className="font-medium">{loadError}</p>
              <Button variant="outline" onClick={() => load(status)}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No {getVerificationStatusMeta(status).label.toLowerCase()} sessions</p>
            </div>
          ) : (
            items.map((item) => {
              const meta = getVerificationStatusMeta(item.status)
              const ocr = item.ocr_result || {}
              const ocrEntries = OCR_FIELDS.filter((field) => ocr[field.key])
              return (
                <div key={item.id} className="rounded-lg border border-gray-100 bg-white p-4 space-y-4">
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{labelize(item.document_type)}</h2>
                        <Badge className={`border-0 ${toneBadgeClass[meta.tone]}`}>{meta.label}</Badge>
                        {item.double_sided && <Badge variant="outline" className="text-[10px]">Double-sided</Badge>}
                      </div>
                      <p className="text-xs text-gray-500">
                        Session {shortId(item.id)} · User {shortId(item.user_id)} · Created {formatTimestamp(item.created_at)}
                      </p>
                      <p className="text-xs text-gray-400">{meta.description}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      {item.confidence_score != null && (
                        <div>Confidence: <span className="font-semibold">{(item.confidence_score * 100).toFixed(0)}%</span></div>
                      )}
                      <div>Submitted: {formatTimestamp(item.submitted_at)}</div>
                      <div>OCR done: {formatTimestamp(item.ocr_completed_at)}</div>
                    </div>
                  </div>

                  {/* Uploaded sides + document-preview restriction notice */}
                  <div className="grid md:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-md bg-gray-50 px-3 py-2">
                      Uploaded sides:{' '}
                      <span className="font-medium">
                        {(['front', 'back', 'selfie'] as const)
                          .filter((side) => item.uploaded_sides?.[side])
                          .map((side) => labelize(side))
                          .join(', ') || 'none'}
                      </span>
                    </div>
                    <div className="rounded-md bg-gray-50 px-3 py-2 text-gray-500 italic">
                      Document preview restricted — private images are not exposed to the console.
                    </div>
                  </div>

                  {/* Sanitized OCR fields */}
                  {ocrEntries.length > 0 && (
                    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                      {ocrEntries.map((field) => (
                        <div key={field.key} className="rounded-md border border-gray-100 px-2.5 py-1.5">
                          <span className="text-gray-500">{field.label}: </span>
                          <span className="font-medium">{ocr[field.key]}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Review history / decision metadata */}
                  {(item.failure_reason || item.review_notes || item.retry_reason || item.review_decision || item.reviewed_by) && (
                    <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 space-y-1.5 text-xs">
                      {item.failure_reason && (
                        <p><span className="font-semibold text-gray-700">Failure reason:</span> {item.failure_reason}</p>
                      )}
                      {item.review_notes && (
                        <p><span className="font-semibold text-gray-700">Review notes:</span> {item.review_notes}</p>
                      )}
                      {item.retry_reason && (
                        <p><span className="font-semibold text-gray-700">Retry reason:</span> {item.retry_reason}</p>
                      )}
                      {item.review_decision && (
                        <p>
                          <span className="font-semibold text-gray-700">Last decision:</span> {labelize(item.review_decision)}
                          {item.reviewed_by ? ` by ${shortId(item.reviewed_by)}` : ''}
                          {item.reviewed_at ? ` · ${formatTimestamp(item.reviewed_at)}` : ''}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-3 border-t border-gray-100 pt-3">
                    <Textarea
                      value={notes[item.id] || ''}
                      onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="Review notes (required to reject or add a note)"
                      className="min-h-16"
                    />
                    {meta.adminActionAllowed && (
                      <Input
                        value={retryReasons[item.id] || ''}
                        onChange={(event) => setRetryReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="Retry reason (required to request a retry)"
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {meta.adminActionAllowed && (
                        confirmingApproveId === item.id ? (
                          <>
                            <Button
                              className="bg-green-600 hover:bg-green-700 gap-2"
                              onClick={() => submitReview(item, 'approve')}
                              disabled={busyId === item.id}
                            >
                              {busyId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                              Confirm approve
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirmingApproveId(null)} disabled={busyId === item.id}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            className="bg-green-600 hover:bg-green-700 gap-2"
                            onClick={() => setConfirmingApproveId(item.id)}
                            disabled={busyId === item.id}
                          >
                            <CheckCircle className="w-4 h-4" />
                            Approve
                          </Button>
                        )
                      )}
                      {meta.adminActionAllowed && (
                        <>
                          <Button
                            variant="outline"
                            className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => submitReview(item, 'reject')}
                            disabled={busyId === item.id}
                          >
                            <XCircle className="w-4 h-4" />
                            Reject
                          </Button>
                          <Button
                            variant="outline"
                            className="gap-2 text-amber-700 border-amber-200 hover:bg-amber-50"
                            onClick={() => submitReview(item, 'request_retry')}
                            disabled={busyId === item.id}
                          >
                            <RotateCcw className="w-4 h-4" />
                            Request retry
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        className="gap-2 text-gray-600"
                        onClick={() => submitReview(item, 'add_review_notes')}
                        disabled={busyId === item.id}
                      >
                        <StickyNote className="w-4 h-4" />
                        Add note
                      </Button>
                    </div>
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
