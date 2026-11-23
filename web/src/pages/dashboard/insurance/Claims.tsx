import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { FileText, Search, Eye, CheckCircle, XCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Claim } from '@/types'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { ReadFailedNotice } from '@/components/workbench/ReadFailedNotice'
import { CHIP, isReadRefusal, normalizedStatus, recordedAmount, recordedDate, type RecordReadState } from '@/components/workbench/institutionalRecords'

/** The columns the claims read actually returns (insurance_claims). The legacy Claim type names fields it never sends. */
type RecordedClaim = Claim & { description?: string | null; incident_date?: string | null; created_at?: string | null; policy_id?: string | null }

/** RX06-LR06 U10-S1 (unified only): recorded statuses are "Pending Review" / "Approved" / "Rejected"; compare without case. */
const UNIFIED_CLAIM_FILTERS: Array<[string, string]> = [['all', 'All'], ['awaiting', 'Awaiting decision'], ['approved', 'Approved'], ['rejected', 'Rejected']]
function claimStage(status: unknown): string {
  const key = normalizedStatus(status)
  if (!key) return 'unrecorded'
  return key === 'approved' || key === 'rejected' ? key : 'awaiting'
}

export default function Claims() {
  const { fetchClaims, updateClaimStatus } = useCarUpApi()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const unified = isUnifiedUiEnabled()
  const [readState, setReadState] = useState<RecordReadState>('loading')
  const [readRefused, setReadRefused] = useState(false)

  useEffect(() => {
    loadClaims()
  }, [])

  const loadClaims = async () => {
    try {
      setLoading(true)
      setReadState('loading')
      const data = await fetchClaims()
      setClaims(data || [])
      setReadState('ready')
    } catch (error) {
      toast.error('Failed to load claims')
      setReadState('failed')
      setReadRefused(isReadRefusal(error))
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateStatus = async (id: string, status: Claim['status']) => {
    try {
      await updateClaimStatus(id, status)
      toast.success(`Claim ${status} successfully`)
      setClaims(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    } catch (error) {
      toast.error('Failed to update claim status')
    }
  }

  const filtered = unified
    ? (claims as RecordedClaim[]).filter(c =>
      (!search || [c.id, c.description, c.policy_id].some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))) &&
      (statusFilter === 'all' || claimStage(c.status) === statusFilter))
    : claims.filter(c =>
    (!search || c.policyholder?.toLowerCase().includes(search.toLowerCase()) || c.id?.toLowerCase().includes(search.toLowerCase())) &&
    (statusFilter === 'all' || c.status === statusFilter)
  )
  const readFailed = unified && readState === 'failed'

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* RX06-LR06 U10-S1 (unified only): the header and the status filters wrap on a phone (the row measured 555 px). */}
      <div className={unified ? 'flex flex-wrap items-start justify-between gap-3' : 'flex items-center justify-between'}>
        <div>
          <h1 className="text-2xl font-bold">Claims Management</h1>
          <p className="text-gray-500">Process and track insurance claims</p>
        </div>
        <div className={unified ? 'flex flex-wrap gap-2' : 'flex gap-2'} data-testid={unified ? 'claims-filters' : undefined}>
          {unified ? UNIFIED_CLAIM_FILTERS.map(([s, label]) => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)} className={statusFilter === s ? 'bg-orange-700 hover:bg-orange-800 text-white' : ''} data-testid={`claims-filter-${s}`}>
              {label}
            </Button>
          )) : ['all', 'pending', 'under-review', 'approved', 'rejected'].map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)} className={statusFilter === s ? 'bg-orange-500 hover:bg-orange-600' : ''}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ')}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder={unified ? 'Search by claim reference, policy or description' : 'Search claims...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
          data-testid="claims-search-input"
          aria-label="Search claims"
        />
      </div>

      <div className="space-y-3" data-testid="claims-table">
        {readFailed ? (
          <ReadFailedNotice subject="claims" refused={readRefused} onRetry={() => void loadClaims()} testId="claims-read-failed" />
        ) : loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-0 card-shadow">
              <CardContent className="p-4 flex gap-4">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="w-20 h-8" />
              </CardContent>
            </Card>
          ))
        ) : (
          filtered.map((claim) => unified ? (
            <UnifiedClaimRow key={claim.id} claim={claim as RecordedClaim} onDecide={handleUpdateStatus} />
          ) : (
            <Card key={claim.id} className="border-0 card-shadow" data-testid={`claim-row-${claim.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{claim.id}</h3>
                        <span className="text-sm text-gray-500">{claim.policyholder}</span>
                      </div>
                      <span className="font-medium">${claim.amount?.toLocaleString() ?? 0}</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-1">{claim.vehicle} • {claim.type}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>Policy: {claim.policy}</span>
                      <span>Date: {claim.date || new Date().toLocaleDateString()}</span>
                      <span>Assigned: {claim.assigned || 'Unassigned'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={claim.status === 'approved' ? 'bg-green-500' : claim.status === 'rejected' ? 'bg-red-500' : claim.status === 'under-review' ? 'bg-amber-500' : 'bg-blue-500'}>
                      {claim.status}
                    </Badge>
                    <Button variant="ghost" size="icon" title="View Details" aria-label="View Details"><Eye className="w-4 h-4" /></Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Approve Claim"
                      className="text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={() => handleUpdateStatus(claim.id, 'approved')}
                      data-testid="approve-claim-button"
                      aria-label="Approve Claim"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Reject Claim"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleUpdateStatus(claim.id, 'rejected')}
                      data-testid="reject-claim-button"
                      aria-label="Reject Claim"
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {!loading && filtered.length === 0 && !readFailed && (
          <div className="text-center py-10 text-gray-500" data-testid="no-claims-state">
            {unified ? (claims.length === 0 ? 'No claims are recorded for this account.' : 'No claims match this search or filter.') : 'No claims found.'}
          </div>
        )}
      </div>
    </div>
  )
}
/**
 * RX06-LR06 U10-S1 — a claim row that shows only what the claim records (unified presentation only). It invents no
 * policyholder, assignee, currency or date, and does not show the vehicle identifier (VIN visibility is on hold, D6).
 * The approve / reject controls are the legacy ones, unchanged: same labels, same handler, same values.
 */
function UnifiedClaimRow({ claim, onDecide }: { claim: RecordedClaim; onDecide: (id: string, status: Claim['status']) => void }) {
  const stage = claimStage(claim.status)
  const amount = recordedAmount(claim.amount)
  return (
    <Card className="border-0 card-shadow" data-testid={`claim-row-${claim.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="font-medium break-all">{claim.id}</h3>
              <span className="font-medium text-right" data-testid="claim-amount">
                {amount === null ? 'Amount not recorded' : `${amount} · currency not recorded`}
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-1" data-testid="claim-description">{claim.description || 'No description recorded'}</p>
            <div className="flex flex-wrap gap-3 text-xs text-gray-500" data-testid="claim-recorded-fields">
              <span>Policy: {claim.policy_id || 'Not recorded'}</span>
              <span>Incident date: {recordedDate(claim.incident_date) ?? 'Not recorded'}</span>
              <span>Filed: {recordedDate(claim.created_at) ?? 'Not recorded'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={CHIP[stage === 'approved' ? 'positive' : stage === 'rejected' ? 'negative' : stage === 'awaiting' ? 'pending' : 'neutral']} data-testid="claim-status">
              {claim.status || 'Status not recorded'}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              title="Approve Claim"
              className="text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={() => onDecide(claim.id, 'approved')}
              data-testid="approve-claim-button"
              aria-label="Approve Claim"
            >
              <CheckCircle className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Reject Claim"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => onDecide(claim.id, 'rejected')}
              data-testid="reject-claim-button"
              aria-label="Reject Claim"
            >
              <XCircle className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
