import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  CheckCircle,
  ExternalLink,
  FileSearch,
  History,
  Loader2,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  TrustAuditTrailEvent,
  TrustFactName,
  TrustFactRequest,
  TrustFactReviewStatus,
  VehicleEvidenceSummary,
} from '@/types'

const statuses: TrustFactReviewStatus[] = ['pending', 'approved', 'rejected', 'revoked', 'superseded']
const adminFacts: TrustFactName[] = ['vehicle_condition_category', 'passport_verified', 'inspection_ready']
const governmentFacts: TrustFactName[] = ['passport_verified', 'inspection_ready']

const factLabels: Record<TrustFactName, string> = {
  vehicle_condition_category: 'Vehicle condition category',
  passport_verified: 'Passport verified',
  inspection_ready: 'Inspection ready',
}

const statusTone: Record<TrustFactReviewStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  revoked: 'bg-gray-100 text-gray-800 border-gray-200',
  superseded: 'bg-blue-100 text-blue-800 border-blue-200',
}

type ReviewAction = 'approve' | 'reject' | 'revoke'

function labelize(value?: string | null) {
  return String(value || 'unknown')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function redactText(value: unknown) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted phone]')
    .replace(/((?:national\s*id|address|phone|email|owner\s*name|seller\s*name)\s*[:=]\s*)[^,;}\n]+/gi, '$1[redacted]')
}

function redactValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redactText(value) : value
  if (Array.isArray(value)) return value.map(redactValue)

  const safe: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    const normalized = key.toLowerCase()
    if (
      normalized.includes('phone') ||
      normalized.includes('email') ||
      normalized.includes('address') ||
      normalized.includes('national_id') ||
      normalized.includes('nationalid') ||
      normalized.includes('owner_name') ||
      normalized.includes('seller_name') ||
      normalized === 'metadata' ||
      normalized === 'raw_metadata' ||
      normalized === 'actor_user_id'
    ) {
      safe[key] = '[redacted]'
    } else {
      safe[key] = redactValue(raw)
    }
  }
  return safe
}

function formatValue(value?: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) return 'None'
  const safeValue = redactValue(value)
  return JSON.stringify(safeValue)
    .replace(/[{}"]/g, '')
    .replace(/:/g, ': ')
    .replace(/,/g, ', ')
}

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  return date.toLocaleString()
}

function isFact(value: string): value is TrustFactName {
  return adminFacts.includes(value as TrustFactName)
}

export default function TrustReviewQueue() {
  const { user, loading: authLoading } = useAuth()
  const {
    fetchTrustReviewQueue,
    approveTrustFactRequest,
    rejectTrustFactRequest,
    revokeTrustFactRequest,
    fetchTrustAuditTrail,
    fetchVehicleEvidence,
  } = useCarUpApi()

  const role = user?.role
  const isAdmin = role === 'admin'
  const isGovernment = role === 'government'
  const isReviewer = isAdmin || isGovernment
  const allowedFacts = useMemo(() => (isGovernment ? governmentFacts : adminFacts), [isGovernment])

  const [status, setStatus] = useState<TrustFactReviewStatus>('pending')
  const [factFilter, setFactFilter] = useState<TrustFactName | 'all'>('all')
  const [vinFilter, setVinFilter] = useState('')
  const [requests, setRequests] = useState<TrustFactRequest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [evidenceRequest, setEvidenceRequest] = useState<TrustFactRequest | null>(null)
  const [evidenceRows, setEvidenceRows] = useState<VehicleEvidenceSummary[]>([])
  const [evidenceLoading, setEvidenceLoading] = useState(false)

  const [auditRequest, setAuditRequest] = useState<TrustFactRequest | null>(null)
  const [auditRows, setAuditRows] = useState<TrustAuditTrailEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const [actionState, setActionState] = useState<{ action: ReviewAction; request: TrustFactRequest } | null>(null)
  const [decisionNotes, setDecisionNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (factFilter !== 'all' && !allowedFacts.includes(factFilter)) {
      setFactFilter('all')
    }
  }, [allowedFacts, factFilter])

  const loadQueue = async () => {
    if (!isReviewer) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetchTrustReviewQueue({
        status,
        trust_fact: factFilter,
        vin: vinFilter.trim() || undefined,
      })
      setRequests(response.requests || [])
      setTotal(response.total || 0)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load trust review queue'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && isReviewer) {
      loadQueue()
    }
  }, [authLoading, isReviewer, status, factFilter])

  const visibleRequests = useMemo(() => {
    const vin = vinFilter.trim().toLowerCase()
    return requests.filter(request => !vin || request.vin.toLowerCase().includes(vin))
  }, [requests, vinFilter])

  const openEvidence = async (request: TrustFactRequest) => {
    setEvidenceRequest(request)
    setEvidenceRows([])
    setEvidenceLoading(true)
    try {
      const evidence = await fetchVehicleEvidence(request.vin)
      const ids = new Set((request.evidence_ids || []).map(String))
      setEvidenceRows((evidence || []).filter(row => ids.has(String(row.id))))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load evidence')
    } finally {
      setEvidenceLoading(false)
    }
  }

  const openAuditTrail = async (request: TrustFactRequest) => {
    setAuditRequest(request)
    setAuditRows([])
    setAuditLoading(true)
    try {
      const trail = await fetchTrustAuditTrail(request.vin)
      setAuditRows(trail.events || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load audit trail')
    } finally {
      setAuditLoading(false)
    }
  }

  const startAction = (action: ReviewAction, request: TrustFactRequest) => {
    setActionState({ action, request })
    setDecisionNotes('')
  }

  const submitDecision = async () => {
    if (!actionState || !decisionNotes.trim()) return
    setSubmitting(true)
    try {
      const payload = { decision_notes: decisionNotes.trim() }
      if (actionState.action === 'approve') {
        await approveTrustFactRequest(actionState.request.id, payload)
        toast.success('Trust fact approved')
      } else if (actionState.action === 'reject') {
        await rejectTrustFactRequest(actionState.request.id, payload)
        toast.success('Trust fact rejected')
      } else {
        await revokeTrustFactRequest(actionState.request.id, payload)
        toast.success('Trust fact revoked')
      }
      setActionState(null)
      setDecisionNotes('')
      await loadQueue()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Trust fact review failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return (
      <div className="py-16 flex justify-center text-orange-500" data-testid="trust-review-loading">
        <Loader2 className="w-7 h-7 animate-spin" />
      </div>
    )
  }

  if (!isReviewer) {
    return (
      <div className="max-w-3xl mx-auto py-16" data-testid="trust-review-unauthorized">
        <Card className="border-0 card-shadow">
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto text-red-500 mb-3" />
            <h1 className="text-xl font-bold">Unauthorized</h1>
            <p className="text-sm text-gray-500 mt-2">
              Trust Review is available only to admin and government reviewers.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const actionTitle = actionState ? labelize(actionState.action) : ''
  const actionFact = actionState?.request.trust_fact ? factLabels[actionState.request.trust_fact] : ''

  return (
    <div className="space-y-6 max-w-7xl mx-auto" data-testid="trust-review-page">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Trust Review</h1>
          <p className="text-gray-500">
            Review governed trust-fact requests before they affect marketplace trust signals.
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          {labelize(role)} reviewer
        </Badge>
      </div>

      <Card className="border-0 card-shadow">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <Tabs value={status} onValueChange={(value) => setStatus(value as TrustFactReviewStatus)}>
              <TabsList data-testid="trust-review-status-tabs">
                {statuses.map(option => (
                  <TabsTrigger key={option} value={option}>
                    {labelize(option)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-col sm:flex-row gap-3 xl:ml-auto">
              <select
                value={factFilter}
                onChange={(event) => setFactFilter(event.target.value as TrustFactName | 'all')}
                className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm"
                data-testid="trust-fact-filter"
                aria-label="Trust fact filter"
              >
                <option value="all">All trust facts</option>
                {allowedFacts.map(fact => (
                  <option key={fact} value={fact}>{factLabels[fact]}</option>
                ))}
              </select>

              <div className="relative min-w-[240px]">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <Input
                  value={vinFilter}
                  onChange={(event) => setVinFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') loadQueue()
                  }}
                  placeholder="Search VIN"
                  className="pl-9"
                  data-testid="trust-review-vin-search"
                />
              </div>
              <Button variant="outline" onClick={loadQueue} disabled={loading} data-testid="trust-review-refresh">
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center justify-between gap-3">
            <span>Review Queue</span>
            <span className="text-sm font-normal text-gray-500">{total} request(s)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center text-orange-500" data-testid="trust-review-table-loading">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          ) : error ? (
            <div className="py-12 text-center text-red-600" data-testid="trust-review-error">{error}</div>
          ) : visibleRequests.length === 0 ? (
            <div className="py-12 text-center text-gray-400" data-testid="trust-review-empty">
              <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No trust fact requests found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VIN</TableHead>
                  <TableHead>Trust fact</TableHead>
                  <TableHead>Current value</TableHead>
                  <TableHead>Requested value</TableHead>
                  <TableHead>Requester role</TableHead>
                  <TableHead>Evidence count</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody data-testid="trust-review-table">
                {visibleRequests.map(request => {
                  const isAllowedFact = allowedFacts.includes(request.trust_fact)
                  const canApproveOrReject = request.status === 'pending' && isAllowedFact
                  const canRevoke = request.status === 'approved' && isAllowedFact
                  return (
                    <TableRow key={request.id} data-testid="trust-review-row">
                      <TableCell className="font-mono text-xs">{request.vin}</TableCell>
                      <TableCell>{factLabels[request.trust_fact] || labelize(request.trust_fact)}</TableCell>
                      <TableCell className="max-w-[180px] truncate" title={formatValue(request.current_value)}>
                        {formatValue(request.current_value)}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={formatValue(request.requested_value)}>
                        {formatValue(request.requested_value)}
                      </TableCell>
                      <TableCell>{labelize(request.requested_by_role)}</TableCell>
                      <TableCell>{request.evidence_ids?.length || 0}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusTone[request.status]}>
                          {labelize(request.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(request.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEvidence(request)} data-testid="trust-review-open-evidence">
                            <FileSearch className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openAuditTrail(request)} data-testid="trust-review-open-audit">
                            <History className="w-4 h-4" />
                          </Button>
                          {canApproveOrReject && (
                            <>
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => startAction('approve', request)} data-testid="trust-review-approve">
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => startAction('reject', request)} data-testid="trust-review-reject">
                                Reject
                              </Button>
                            </>
                          )}
                          {canRevoke && (
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => startAction('revoke', request)} data-testid="trust-review-revoke">
                              Revoke
                            </Button>
                          )}
                          {!isAllowedFact && (
                            <Badge variant="outline" className="text-gray-500">Read-only</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(actionState)} onOpenChange={(open) => !open && setActionState(null)}>
        <DialogContent data-testid="trust-review-decision-modal">
          <DialogHeader>
            <DialogTitle>{actionTitle} trust fact</DialogTitle>
            <DialogDescription>
              {actionFact} for {actionState?.request.vin}. Decision notes are required and will be audited.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={decisionNotes}
            onChange={(event) => setDecisionNotes(event.target.value)}
            placeholder="Decision notes"
            className="min-h-28"
            data-testid="trust-review-decision-notes"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionState(null)} disabled={submitting}>Cancel</Button>
            <Button
              onClick={submitDecision}
              disabled={!decisionNotes.trim() || submitting}
              data-testid="trust-review-submit-decision"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : actionTitle}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(evidenceRequest)} onOpenChange={(open) => !open && setEvidenceRequest(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto" data-testid="trust-review-evidence-drawer">
          <SheetHeader>
            <SheetTitle>Evidence Summary</SheetTitle>
            <SheetDescription>
              Safe evidence fields for {evidenceRequest?.vin}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6 space-y-3">
            {evidenceLoading ? (
              <div className="py-10 flex justify-center text-orange-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : evidenceRows.length === 0 ? (
              <p className="text-sm text-gray-500">No matching evidence records found.</p>
            ) : evidenceRows.map(row => (
              <div key={row.id} className="rounded-lg border border-gray-100 p-4 space-y-2" data-testid="trust-review-evidence-item">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{labelize(row.evidence_type)}</h3>
                  <Badge variant="outline">{labelize(row.verification_status)}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <span>Visibility: {labelize(row.visibility_level)}</span>
                  <span>Captured: {formatDate(row.captured_at)}</span>
                  <span>Uploaded: {formatDate(row.uploaded_at)}</span>
                  <span>Registry event: {row.linked_registry_event_id || 'None'}</span>
                  <span className="col-span-2 font-mono">Checksum: {(row.checksum || row.image_hash || 'missing').slice(0, 12)}</span>
                </div>
                {row.file_url && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={row.file_url} target="_blank" rel="noopener noreferrer" data-testid="trust-review-open-evidence-link">
                      <ExternalLink className="w-4 h-4" />
                      Open evidence
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(auditRequest)} onOpenChange={(open) => !open && setAuditRequest(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto" data-testid="trust-review-audit-drawer">
          <SheetHeader>
            <SheetTitle>Audit Trail</SheetTitle>
            <SheetDescription>
              Governed trust events for {auditRequest?.vin}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6 space-y-3">
            {auditLoading ? (
              <div className="py-10 flex justify-center text-orange-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : auditRows.length === 0 ? (
              <p className="text-sm text-gray-500">No audit events found.</p>
            ) : auditRows.map(event => (
              <div key={event.id} className="rounded-lg border border-gray-100 p-4 space-y-2" data-testid="trust-review-audit-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{labelize(event.event_type)}</h3>
                  <Badge variant="outline">{labelize(event.actor_role)}</Badge>
                </div>
                <div className="grid gap-1 text-xs text-gray-600">
                  <span>Trust fact: {event.trust_fact && isFact(event.trust_fact) ? factLabels[event.trust_fact] : labelize(event.trust_fact)}</span>
                  <span>Previous value: {formatValue(event.previous_value)}</span>
                  <span>New value: {formatValue(event.new_value)}</span>
                  <span>Source route: {redactText(event.source_route || 'Not recorded')}</span>
                  <span>Evidence IDs: {(event.evidence_ids || []).join(', ') || 'None'}</span>
                  <span>Reason: {redactText(event.reason || 'None')}</span>
                  <span>Decision notes: {redactText(event.decision_notes || 'None')}</span>
                  <span>Timestamp: {formatDate(event.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
