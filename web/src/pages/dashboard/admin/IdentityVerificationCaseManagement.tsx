import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertCircle,
  CheckCircle2,
  FileSearch,
  ImageIcon,
  Loader2,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  DecisionAction,
  DecisionResponse,
  EvidencePreview,
  ExtendedAdminVerificationSession,
} from '@shared/types'
import {
  EVIDENCE_CLASSIFICATION_LABELS,
  EXTRACTION_TRUST_LABELS,
  REASON_CODE_LABELS,
  WORKFLOW_PHASE_META,
} from '@shared/types'

const API_BASE = '/api'
const ADMIN_BASE = '/api/admin/identity/verification-sessions'

const OPERATIONAL_TABS: { id: string; label: string; phase?: string; status?: string }[] = [
  { id: 'reviewer_action_required', label: 'Reviewer Action Required', phase: 'reviewer_action_required' },
  { id: 'applicant_action_required', label: 'Waiting for Applicant', phase: 'applicant_action_required' },
  { id: 'escalated', label: 'Escalated Cases', phase: 'escalated' },
  { id: 'resolved_approved', label: 'Approved', phase: 'resolved_approved' },
  { id: 'resolved_rejected', label: 'Rejected / Closed', phase: 'resolved_rejected' },
  { id: 'all', label: 'All Cases' },
]

type DispositionOption = 'approve' | 'request_resubmission' | 'reject' | 'escalate' | 'add_internal_note'

const DISPOSITION_OPTIONS: { value: DispositionOption; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'approve', label: 'Approve identity', description: 'Confirm the submitted evidence establishes this account holder identity.', icon: <ShieldCheck className="w-4 h-4" /> },
  { value: 'request_resubmission', label: 'Request a new submission', description: 'Ask the applicant to resubmit corrected evidence.', icon: <FileSearch className="w-4 h-4" /> },
  { value: 'reject', label: 'Reject verification', description: 'Terminally close the verification case.', icon: <XCircle className="w-4 h-4" /> },
  { value: 'escalate', label: 'Escalate for specialist review', description: 'Send to a specialist or higher review tier.', icon: <AlertCircle className="w-4 h-4" /> },
  { value: 'add_internal_note', label: 'Continue investigation / save internal note', description: 'Add an internal note without changing case status. The applicant is not notified.', icon: <MessageSquare className="w-4 h-4" /> },
]

const REASON_CODE_OPTIONS: { value: string; label: string; disposition: DispositionOption[] }[] = [
  { value: 'NON_DOCUMENT', label: 'Not an identity document', disposition: ['request_resubmission', 'reject', 'escalate'] },
  { value: 'DOCUMENT_NOT_VISIBLE', label: 'Document not visible', disposition: ['request_resubmission'] },
  { value: 'FRONT_BACK_DUPLICATE', label: 'Duplicate front/back images', disposition: ['request_resubmission'] },
  { value: 'SELFIE_DOCUMENT_DUPLICATE', label: 'Selfie same as document', disposition: ['request_resubmission'] },
  { value: 'BLURRY', label: 'Blurry images', disposition: ['request_resubmission'] },
  { value: 'GLARE', label: 'Glare obstructs document', disposition: ['request_resubmission'] },
  { value: 'UNREADABLE_DOCUMENT', label: 'Unreadable document', disposition: ['request_resubmission'] },
  { value: 'UNSUPPORTED_DOCUMENT_TYPE', label: 'Unsupported document', disposition: ['request_resubmission', 'reject'] },
  { value: 'ACCOUNT_DOCUMENT_MISMATCH', label: 'Identity mismatch', disposition: ['request_resubmission', 'reject', 'escalate'] },
  { value: 'SUSPECTED_TAMPERING', label: 'Suspected tampering', disposition: ['reject', 'escalate'] },
  { value: 'SUSPECTED_FRAUD', label: 'Suspected fraud', disposition: ['reject', 'escalate'] },
  { value: 'TECHNICAL_ERROR', label: 'Technical error', disposition: ['request_resubmission', 'escalate'] },
  { value: 'OTHER', label: 'Other reason', disposition: ['request_resubmission', 'reject', 'escalate'] },
]

function humanize(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function workflowPhaseColor(phase?: string | null): string {
  if (!phase) return 'bg-gray-100 text-gray-800'
  const meta = WORKFLOW_PHASE_META[phase]
  if (!meta) return 'bg-gray-100 text-gray-800'
  switch (meta.tone) {
    case 'positive': return 'bg-green-100 text-green-800'
    case 'warning': return 'bg-amber-100 text-amber-800'
    case 'error': return 'bg-red-100 text-red-800'
    case 'negative': return 'bg-red-100 text-red-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

function evidenceClassColor(ec?: string | null): string {
  if (!ec) return 'bg-gray-100 text-gray-800'
  if (['valid_identity_document', 'likely_identity_document'].includes(ec)) return 'bg-green-100 text-green-800'
  if (['non_document', 'unsupported_document'].includes(ec)) return 'bg-red-100 text-red-800'
  if (['unreadable', 'uncertain'].includes(ec)) return 'bg-amber-100 text-amber-800'
  return 'bg-gray-100 text-gray-800'
}

function trustColor(trust?: string | null): string {
  if (!trust) return 'text-gray-500'
  if (trust === 'trusted') return 'text-green-600'
  if (trust === 'partially_trusted') return 'text-amber-600'
  if (trust === 'untrusted') return 'text-red-600'
  return 'text-gray-500'
}

function bindingIcon(status?: string | null): React.ReactNode {
  if (status === 'match') return <UserCheck className="w-4 h-4 text-green-600" />
  if (status === 'mismatch') return <UserX className="w-4 h-4 text-red-600" />
  return <ShieldAlert className="w-4 h-4 text-amber-600" />
}

function bindingColor(status?: string | null): string {
  if (status === 'match') return 'text-green-600'
  if (status === 'mismatch') return 'text-red-600'
  return 'text-amber-600'
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `API error: ${res.status}`)
  return data
}

export default function IdentityVerificationCaseManagement() {
  const [activeTab, setActiveTab] = useState('reviewer_action_required')
  const [sessions, setSessions] = useState<ExtendedAdminVerificationSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<ExtendedAdminVerificationSession | null>(null)
  const [sessionDetail, setSessionDetail] = useState<ExtendedAdminVerificationSession | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [previews, setPreviews] = useState<Record<string, EvidencePreview>>({})
  const [previewsLoading, setPreviewsLoading] = useState<Record<string, boolean>>({})

  // Decision form
  const [disposition, setDisposition] = useState<DispositionOption | null>(null)
  const [reasonCode, setReasonCode] = useState<string>('')
  const [internalNote, setInternalNote] = useState('')
  const [applicantMessage, setApplicantMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [successPanel, setSuccessPanel] = useState<DecisionResponse | null>(null)

  const fetchedRef = useRef(false)

  const fetchSessions = useCallback(async (tabId: string) => {
    setLoading(true)
    try {
      const tab = OPERATIONAL_TABS.find(t => t.id === tabId)
      let query = ''
      if (tab?.phase) query = `?workflow_phase=${encodeURIComponent(tab.phase)}`
      else if (tab?.status) query = `?status=${encodeURIComponent(tab.status)}`
      const data = await apiGet<{ success: boolean; sessions: ExtendedAdminVerificationSession[] }>(
        `${ADMIN_BASE}${query}`
      )
      setSessions(data.sessions || [])
    } catch {
      toast.error('Failed to load verification sessions')
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true
      fetchSessions(activeTab)
    }
  }, [activeTab, fetchSessions])

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId)
    fetchedRef.current = false
  }

  const openSession = async (session: ExtendedAdminVerificationSession) => {
    setSelectedSession(session)
    setDetailLoading(true)
    setSessionDetail(null)
    setPreviews({})
    setDisposition(null)
    setReasonCode('')
    setInternalNote('')
    setApplicantMessage('')
    setSuccessPanel(null)

    try {
      const detail = await apiGet<{ success: boolean; session: ExtendedAdminVerificationSession }>(
        `${ADMIN_BASE}/${session.id}`
      )
      setSessionDetail(detail.session)
    } catch {
      toast.error('Failed to load session detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const loadPreview = async (side: 'front' | 'back' | 'selfie') => {
    if (!selectedSession) return
    if (previews[side]) return
    setPreviewsLoading(prev => ({ ...prev, [side]: true }))
    try {
      const data = await apiGet<{ success: boolean; preview: EvidencePreview }>(
        `${ADMIN_BASE}/${selectedSession.id}/evidence/${side}/preview`
      )
      setPreviews(prev => ({ ...prev, [side]: data.preview }))
    } catch {
      toast.error(`Failed to load ${side} preview`)
    } finally {
      setPreviewsLoading(prev => ({ ...prev, [side]: false }))
    }
  }

  const confirmDecision = () => {
    if (!disposition) return
    if (disposition === 'request_resubmission' && !applicantMessage) {
      toast.error('An applicant message is required when requesting resubmission.')
      return
    }
    if ((disposition === 'request_resubmission' || disposition === 'reject' || disposition === 'escalate') && !reasonCode) {
      toast.error('A reason code is required for this action.')
      return
    }
    setShowConfirm(true)
  }

  const submitDecision = async () => {
    if (!selectedSession || !disposition) return
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        action: disposition,
        reasonCode: reasonCode || null,
        internalNote: internalNote || null,
        applicantMessage: applicantMessage || null,
      }
      const result = await apiPost<DecisionResponse>(
        `${ADMIN_BASE}/${selectedSession.id}/review`,
        body
      )
      setSuccessPanel(result)
      setShowConfirm(false)
      toast.success('Decision saved')
      // Refetch sessions list
      fetchSessions(activeTab)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit decision'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const closeDetail = () => {
    setSelectedSession(null)
    setSessionDetail(null)
    setSuccessPanel(null)
  }

  const filteredReasonCodes = disposition
    ? REASON_CODE_OPTIONS.filter(rc => rc.disposition.includes(disposition))
    : []

  const sessionsByTab = useMemo(() => {
    if (activeTab === 'all') return sessions
    return sessions
  }, [sessions, activeTab])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Identity Verification</h1>
        <p className="text-gray-500">Case management and review queue</p>
      </div>

      {/* Operational Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full flex-wrap">
          {OPERATIONAL_TABS.map(tab => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
              {tab.label}
              {!loading && tab.id !== 'all' && (
                <span className="ml-1.5 text-gray-400">
                  ({sessions.filter(s => {
                    if (tab.phase) return s.workflow_phase === tab.phase
                    if (tab.status) return s.status === tab.status
                    return true
                  }).length})
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {/* Session List */}
          <div className="space-y-3">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            ) : sessionsByTab.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-gray-500">
                  No cases in this queue.
                </CardContent>
              </Card>
            ) : (
              sessionsByTab.map(session => (
                <Card
                  key={session.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => openSession(session)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm text-gray-500 font-mono">{session.id.slice(0, 12)}...</span>
                          <Badge className={workflowPhaseColor(session.workflow_phase)}>
                            {WORKFLOW_PHASE_META[session.workflow_phase || '']?.label || humanize(session.workflow_phase || session.status)}
                          </Badge>
                          {session.primary_reason_code && (
                            <Badge variant="outline" className="text-xs">
                              {REASON_CODE_LABELS[session.primary_reason_code] || session.primary_reason_code}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                          <span>User: {session.user_id.slice(0, 8)}...</span>
                          <span>Type: {humanize(session.document_type)}</span>
                          {session.submitted_at && (
                            <span>Submitted: {new Date(session.submitted_at).toLocaleString()}</span>
                          )}
                        </div>
                        {session.evidence_classification && (
                          <div className="flex items-center gap-1 mt-1">
                            <Badge className={evidenceClassColor(session.evidence_classification)}>
                              {EVIDENCE_CLASSIFICATION_LABELS[session.evidence_classification]}
                            </Badge>
                            {session.extraction_trust_status && (
                              <span className={`text-xs ${trustColor(session.extraction_trust_status)}`}>
                                {EXTRACTION_TRUST_LABELS[session.extraction_trust_status]}
                              </span>
                            )}
                          </div>
                        )}
                        {session.identity_binding && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                            {bindingIcon(session.identity_binding.status)}
                            <span>
                              Identity binding: {session.identity_binding.status}
                              {session.identity_binding.status === 'mismatch' && ' — Document holder differs'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {session.uploaded_sides.front && <ImageIcon className="w-4 h-4 text-gray-400" />}
                        {session.uploaded_sides.back && <ImageIcon className="w-4 h-4 text-gray-400" />}
                        {session.uploaded_sides.selfie && <ImageIcon className="w-4 h-4 text-gray-400" />}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Session Detail Dialog */}
      <Dialog open={!!selectedSession} onOpenChange={(open) => { if (!open) closeDetail() }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {detailLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : sessionDetail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Case {sessionDetail.id.slice(0, 12)}...
                  {sessionDetail.workflow_phase && (
                    <Badge className={workflowPhaseColor(sessionDetail.workflow_phase)}>
                      {WORKFLOW_PHASE_META[sessionDetail.workflow_phase]?.label}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {sessionDetail.submitted_at
                    ? `Submitted ${new Date(sessionDetail.submitted_at).toLocaleString()}`
                    : `Created ${new Date(sessionDetail.created_at).toLocaleString()}`
                  }
                </DialogDescription>
              </DialogHeader>

              {/* Success Panel */}
              {successPanel && (
                <Card className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                      <div className="text-sm text-green-800">
                        <p className="font-semibold mb-1">
                          Decision saved: {humanize(successPanel.decision.action)}
                        </p>
                        <p>Resulting status: {successPanel.decision.resulting_phase
                          ? WORKFLOW_PHASE_META[successPanel.decision.resulting_phase]?.label || successPanel.decision.resulting_phase
                          : 'No change'}
                        </p>
                        {successPanel.decision.applicant_message && (
                          <p>Applicant notified: Yes (message queued)</p>
                        )}
                        <p className="text-xs text-green-600 mt-1 font-mono">
                          Decision ID: {successPanel.decision.id} |
                          Audit: {successPanel.decision.audit_event_type} |
                          Reviewer: {successPanel.decision.reviewer_id.slice(0, 8)}... |
                          {new Date(successPanel.decision.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Section 1 — Decision Summary */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Decision Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500 block text-xs">Workflow Phase</span>
                      <span className="font-medium">
                        {WORKFLOW_PHASE_META[sessionDetail.workflow_phase || '']?.label || humanize(sessionDetail.workflow_phase || sessionDetail.status)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Primary Reason</span>
                      <span className="font-medium">
                        {sessionDetail.primary_reason_code
                          ? REASON_CODE_LABELS[sessionDetail.primary_reason_code] || sessionDetail.primary_reason_code
                          : 'None'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Risk Level</span>
                      <span className="font-medium">{sessionDetail.assessment?.risk_level || 'info'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Recommended Action</span>
                      <span className="font-medium">
                        {sessionDetail.assessment?.recommended_action
                          ? humanize(sessionDetail.assessment.recommended_action)
                          : 'None'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section 2 — Evidence */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Evidence</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(['front', 'back', 'selfie'] as const).map(side => (
                      <div key={side}>
                        <div className="text-xs text-gray-500 uppercase mb-1">{side}</div>
                        {sessionDetail.uploaded_sides[side] ? (
                          <div>
                            {previews[side] ? (
                              <div className="space-y-1">
                                <img
                                  src={previews[side].url}
                                  alt={`${side} evidence`}
                                  className="w-full h-40 object-contain bg-gray-100 rounded border"
                                />
                                <p className="text-[10px] text-gray-400">
                                  Expires in {previews[side].expiresInSeconds}s | Cache: no-store
                                </p>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => loadPreview(side)}
                                disabled={previewsLoading[side]}
                                className="w-full"
                              >
                                {previewsLoading[side] ? (
                                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                                ) : (
                                  <ImageIcon className="w-4 h-4 mr-1" />
                                )}
                                Show {side}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 italic">Not uploaded</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Section 3 — Automated Assessment */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Automated Assessment</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-44">Evidence Classification:</span>
                      <Badge className={evidenceClassColor(sessionDetail.evidence_classification || sessionDetail.assessment?.evidence_classification)}>
                        {EVIDENCE_CLASSIFICATION_LABELS[sessionDetail.evidence_classification || sessionDetail.assessment?.evidence_classification || 'not_run']}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-44">Document Type Detected:</span>
                      <span>{humanize(sessionDetail.document_type)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-44">OCR Execution:</span>
                      <span className={trustColor(sessionDetail.extraction_trust_status || sessionDetail.assessment?.extraction_trust_status)}>
                        {humanize(sessionDetail.ocr_execution_status || sessionDetail.assessment?.ocr_execution_status || 'not_run')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-44">Extraction Trust:</span>
                      <span className={trustColor(sessionDetail.extraction_trust_status || sessionDetail.assessment?.extraction_trust_status)}>
                        {EXTRACTION_TRUST_LABELS[sessionDetail.extraction_trust_status || sessionDetail.assessment?.extraction_trust_status || 'not_run']}
                      </span>
                    </div>
                    {sessionDetail.ocr_result && (
                      <div className="mt-2">
                        <span className="text-gray-500 block text-xs mb-1">Field-Level Extraction:</span>
                        <div className="bg-gray-50 rounded p-2 text-xs font-mono space-y-0.5">
                          {Object.entries(sessionDetail.ocr_result).map(([key, value]) => (
                            <div key={key}>
                              <span className="text-gray-400">{key}:</span>{' '}
                              <span className={sessionDetail.extraction_trust_status === 'untrusted' ? 'text-red-500 line-through' : ''}>
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </span>
                              {sessionDetail.extraction_trust_status === 'untrusted' && (
                                <span className="text-red-500 ml-1 text-[10px]">(untrusted)</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {sessionDetail.extraction_trust_status === 'untrusted' && (
                          <p className="text-red-600 text-xs mt-1">
                            ⚠ These values were generated by an automated system and have not been confirmed.
                            They should be disregarded for non-document evidence.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Section 4 — Identity Comparison */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Identity Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  {sessionDetail.identity_binding ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 w-44">Account Holder:</span>
                        <span className="font-medium">{sessionDetail.identity_binding.account_holder_name || 'Unknown'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 w-44">Claimed Document Holder:</span>
                        <span className="font-medium">{sessionDetail.identity_binding.document_holder_name || 'Unknown'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 w-44">Match Verdict:</span>
                        <span className={`flex items-center gap-1 ${bindingColor(sessionDetail.identity_binding.status)}`}>
                          {bindingIcon(sessionDetail.identity_binding.status)}
                          {humanize(sessionDetail.identity_binding.status)}
                        </span>
                      </div>
                      {sessionDetail.identity_binding.reason && (
                        <p className="text-xs text-gray-500 mt-1">{sessionDetail.identity_binding.reason}</p>
                      )}
                      {sessionDetail.evidence_classification === 'non_document' && (
                        <p className="text-amber-600 text-xs mt-1">
                          ⚠ Primary issue: No valid identity document detected. OCR generated untrusted text that must be disregarded.
                          Identity binding is not assessable from valid document evidence.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Not available</p>
                  )}
                </CardContent>
              </Card>

              {/* Section 5 — Case Timeline */}
              {sessionDetail.decisions && sessionDetail.decisions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Case Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {sessionDetail.decisions.map((d) => (
                        <div key={d.id} className="flex gap-3 text-sm">
                          <div className="mt-1 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                          <div>
                            <p className="font-medium">{humanize(d.decision)}</p>
                            <p className="text-xs text-gray-500">
                              {d.reason_code && <span>Reason: {REASON_CODE_LABELS[d.reason_code] || d.reason_code} | </span>}
                              {new Date(d.created_at).toLocaleString()}
                              {d.reviewer_id && ` | By: ${d.reviewer_id.slice(0, 8)}...`}
                            </p>
                            {d.internal_note && <p className="text-xs text-gray-500 mt-0.5">Note: {d.internal_note}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Decision Form */}
              {!successPanel && (
                <Card className="border-amber-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Case Disposition</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Disposition Selection */}
                    <div className="space-y-2">
                      <Label>Choose case disposition</Label>
                      {DISPOSITION_OPTIONS.map(opt => {
                        const isAllowed = sessionDetail.assessment?.allowed_actions?.includes(opt.value as DecisionAction)
                        return (
                          <label
                            key={opt.value}
                            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                              disposition === opt.value
                                ? 'border-blue-500 bg-blue-50'
                                : isAllowed !== false
                                  ? 'border-gray-200 hover:border-gray-300'
                                  : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                            }`}
                          >
                            <input
                              type="radio"
                              name="disposition"
                              value={opt.value}
                              checked={disposition === opt.value}
                              onChange={() => {
                                if (isAllowed !== false) {
                                  setDisposition(opt.value)
                                  setReasonCode('')
                                }
                              }}
                              disabled={isAllowed === false}
                              className="mt-0.5"
                            />
                            <div>
                              <div className="flex items-center gap-2 font-medium text-sm">
                                {opt.icon}
                                {opt.label}
                                {isAllowed === false && (
                                  <Badge variant="outline" className="text-[10px] text-gray-400">Not allowed</Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">{opt.description}</p>
                            </div>
                          </label>
                        )
                      })}
                    </div>

                    {/* Reason Code */}
                    {disposition && filteredReasonCodes.length > 0 && (
                      <div>
                        <Label htmlFor="reasonCode">Reason code</Label>
                        <Select value={reasonCode} onValueChange={setReasonCode}>
                          <SelectTrigger id="reasonCode">
                            <SelectValue placeholder="Select a reason code" />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredReasonCodes.map(rc => (
                              <SelectItem key={rc.value} value={rc.value}>{rc.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Internal Reviewer Note */}
                    <div>
                      <Label htmlFor="internalNote">Internal reviewer note</Label>
                      <p className="text-xs text-gray-400 mb-1">
                        Visible only to authorised CarUp reviewers. This does not notify the applicant
                        and does not change the case status unless submitted with a decision.
                      </p>
                      <Textarea
                        id="internalNote"
                        value={internalNote}
                        onChange={e => setInternalNote(e.target.value)}
                        placeholder="Add an internal note..."
                        rows={2}
                      />
                    </div>

                    {/* Applicant Message */}
                    {(disposition === 'request_resubmission' || disposition === 'reject') && (
                      <div>
                        <Label htmlFor="applicantMessage">
                          {disposition === 'request_resubmission' ? 'Message to applicant (required)' : 'Message to applicant'}
                        </Label>
                        <p className="text-xs text-gray-400 mb-1">
                          {disposition === 'request_resubmission'
                            ? 'Explain exactly what must be corrected. The applicant will see this message.'
                            : 'Shown to the applicant. Do not expose internal fraud rules or sensitive risk signals.'
                          }
                        </p>
                        <Textarea
                          id="applicantMessage"
                          value={applicantMessage}
                          onChange={e => setApplicantMessage(e.target.value)}
                          placeholder={disposition === 'request_resubmission' ? 'Please submit a clear photo of your identity document...' : 'Verification could not be completed because...'}
                          rows={3}
                        />
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <p className="text-xs text-gray-400">
                        {disposition === 'add_internal_note'
                          ? 'Internal note will be saved. Case status did not change.'
                          : disposition
                            ? 'Confirm will record the decision and update the case.'
                            : 'Select a disposition above to proceed.'
                        }
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={closeDetail}>
                          Cancel
                        </Button>
                        <Button
                          onClick={confirmDecision}
                          disabled={!disposition || submitting}
                        >
                          {submitting ? (
                            <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Saving...</>
                          ) : (
                            disposition === 'add_internal_note' ? 'Save Note' : 'Confirm Decision'
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Success panel actions */}
              {successPanel && (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={closeDetail}>Close Case</Button>
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-gray-500">Session not found.</div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {humanize(disposition || '')}</DialogTitle>
            <DialogDescription>
              {disposition === 'approve' && (
                'You are confirming that the submitted evidence establishes this account holder identity. This creates an approved identity decision and audit event.'
              )}
              {disposition === 'request_resubmission' && (
                'This will invalidate the current evidence and ask the applicant to submit new evidence. The applicant will see the message below.'
              )}
              {disposition === 'reject' && (
                'This will terminally close the verification case. The applicant will see the rejection message.'
              )}
              {disposition === 'escalate' && (
                'This will send the case to a specialist review queue.'
              )}
              {disposition === 'add_internal_note' && (
                'This will save an internal note. Case status will not change. The applicant will not be notified.'
              )}
            </DialogDescription>
          </DialogHeader>
          {applicantMessage && (
            <div className="bg-gray-50 rounded p-3 text-sm">
              <p className="font-medium text-xs text-gray-500 mb-1">Message to applicant:</p>
              <p>{applicantMessage}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={submitDecision} disabled={submitting}>
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Confirming...</> : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
