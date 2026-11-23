import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { ClipboardList } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { FinanceApplication } from '@/types'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { ReadFailedNotice } from '@/components/workbench/ReadFailedNotice'
import { isReadRefusal, recordedAmount, type RecordReadState } from '@/components/workbench/institutionalRecords'

/** What the finance-applications read actually returns: terms may be unset (null) and trust may be unevaluated. */
type RecordedApplication = Omit<FinanceApplication, 'monthly_payment' | 'apr' | 'trust_score'> & {
  monthly_payment?: number | null; apr?: number | null; trust_score?: number | null
  trust_evaluation_state?: string | null; requested_currency?: string | null; users?: { name?: string | null } | null
}

/** RX06-LR06 U10-S1 (unified only): a vehicle-trust figure is published only for a current evaluation. It is not a credit score. */
function vehicleTrustLabel(app: RecordedApplication): string {
  if (app.trust_evaluation_state === 'evaluated' && typeof app.trust_score === 'number' && Number.isFinite(app.trust_score)) return `${app.trust_score}%`
  if (app.trust_evaluation_state === 'stale') return 'Withheld (older calculation)'
  if (app.trust_evaluation_state === 'unavailable') return 'Not available'
  return 'Not evaluated'
}

/** The monthly terms only when the lender recorded them; never a 0.00 or a crash for unset terms. */
function recordedTerms(app: RecordedApplication): string {
  const monthly = typeof app.monthly_payment === 'number' && Number.isFinite(app.monthly_payment) ? app.monthly_payment : null
  const apr = typeof app.apr === 'number' && Number.isFinite(app.apr) ? app.apr : null
  if (monthly === null || apr === null) return 'Terms not set'
  return `Monthly ${monthly.toFixed(2)}${app.requested_currency ? ` ${app.requested_currency}` : ''} at ${apr}% APR`
}

/** The requested amount with the recorded currency, or said not to be recorded (one wording for the card and the row). */
function recordedRequest(app: RecordedApplication): string {
  const amount = recordedAmount(app.requested_amount)
  return amount === null ? 'Amount not recorded' : app.requested_currency ? `${amount} ${app.requested_currency}` : `${amount} · currency not recorded`
}

/** RX06-LR07 (unified only): the decision buttons at AA contrast (the legacy amber/purple/orange/indigo-500 measured 2.1–4.5:1). */
const DECISION_COLOUR = {
  review: 'bg-amber-700 hover:bg-amber-800 text-white',
  approve: 'bg-purple-700 hover:bg-purple-800 text-white',
  disburse: 'bg-orange-700 hover:bg-orange-800 text-white',
  activate: 'bg-indigo-700 hover:bg-indigo-800 text-white',
}

/**
 * RX06-LR07 (unified only) — the legacy lending decision ladder, written ONCE for the phone card and the desktop row:
 * the same labels, the same states requested through the same handler, offered for the same recorded statuses. A status
 * the ladder does not name offers nothing, exactly as before. Nothing is added or activated.
 */
function LendingDecisions({ app, onUpdate, stacked }: { app: RecordedApplication; onUpdate: (id: string, next: string) => void; stacked?: boolean }) {
  const id = String(app.id)
  const size = stacked ? 'h-11 text-sm' : 'text-xs py-1 px-2.5'
  return (
    <div className={stacked ? 'grid grid-cols-1 gap-2 min-[360px]:grid-cols-2' : 'flex items-center justify-end gap-1'}>
      {app.status === 'Pending' && (
        <>
          <Button size="sm" className={`${DECISION_COLOUR.review} ${size}`} onClick={() => onUpdate(id, 'Under Review')}>
            Review
          </Button>
          <Button size="sm" variant="destructive" className={size} onClick={() => onUpdate(id, 'Rejected')}>
            Reject
          </Button>
        </>
      )}
      {app.status === 'Under Review' && (
        <Button size="sm" className={`${DECISION_COLOUR.approve} ${size}`} onClick={() => onUpdate(id, 'Approved')}>
          Approve Loan
        </Button>
      )}
      {app.status === 'Approved' && (
        <Button size="sm" className={`${DECISION_COLOUR.disburse} ${size}`} onClick={() => onUpdate(id, 'Escrow Pending')}>
          Disburse to Escrow
        </Button>
      )}
      {app.status === 'Escrow Pending' && (
        <Button size="sm" className={`${DECISION_COLOUR.activate} ${size}`} onClick={() => onUpdate(id, 'Active Loan')}>
          Activate Asset
        </Button>
      )}
      {app.status === 'Active Loan' && (
        <Button size="sm" variant="outline" className={size} onClick={() => onUpdate(id, 'Closed')}>
          Close Loan
        </Button>
      )}
      {(app.status === 'Closed' || app.status === 'Rejected') && (
        <span className="text-xs text-gray-600 italic">No actions</span>
      )}
    </div>
  )
}

export default function LendingQueue() {
  const { fetchFinanceApplications, updateFinanceApplicationStatus } = useCarUpApi() 
  const [applications, setApplications] = useState<FinanceApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMake, setFilterMake] = useState('')
  const unified = isUnifiedUiEnabled()
  const [readState, setReadState] = useState<RecordReadState>('loading')
  const [readRefused, setReadRefused] = useState(false)

  // Fetch applications list on load
  const fetchApplications = async () => {
    try {
      setLoading(true)
      setReadState('loading')
      const data = await fetchFinanceApplications()
      setApplications(data)
      setReadState('ready')
    } catch (error) {
      console.error('Error fetching applications:', error)
      toast.error('Failed to load lending queue.')
      setReadState('failed')
      setReadRefused(isReadRefusal(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApplications()
  }, [])

  const handleUpdateStatus = async (id: string, nextStatus: string) => {
    try {
      await updateFinanceApplicationStatus(id, nextStatus)
      toast.success(`Application updated to ${nextStatus}.`)
      fetchApplications() // Refresh queue
    } catch (error) {
      toast.error('Failed to update lending state.')
    }
  }

  const makes = Array.from(new Set(applications.map((app) => app.make))).filter(Boolean)
  const filteredApps = applications.filter((app) => filterMake ? app.make === filterMake : true)

  const getStatusBadge = (status: string) => {
    const configs: Record<string, string> = {
      'Applied': 'bg-blue-100 text-blue-700',
      'Under Review': 'bg-amber-100 text-amber-700',
      'Risk Assessed': 'bg-purple-100 text-purple-700',
      'Approved': 'bg-green-100 text-green-700',
      'Escrow Pending': 'bg-orange-100 text-orange-700',
      'Active Loan': 'bg-indigo-100 text-indigo-700',
      'Closed': 'bg-gray-100 text-gray-700',
      'Rejected': 'bg-red-100 text-red-700'
    }
    return configs[status] || 'bg-gray-100 text-gray-700'
  }

  if (unified) {
    const rows = filteredApps as unknown as RecordedApplication[]
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-indigo-600" />
              Lending Applications Queue
            </h1>
            <p className="text-gray-500">Finance applications this account can see, with their recorded terms and status.</p>
          </div>
          <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={fetchApplications}>
            Refresh Queue
          </Button>
        </div>

        <Card className="border-0 card-shadow bg-white overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-lg" data-testid="lending-applications-title">
                {readState === 'ready' ? `Applications (${applications.length})` : 'Applications'}
              </CardTitle>
              <div className="flex gap-2">
                <select
                  className="h-11 text-sm bg-white border border-gray-200 rounded px-3 outline-none hover:bg-gray-50 cursor-pointer sm:h-8 sm:text-xs"
                  value={filterMake}
                  onChange={(e) => setFilterMake(e.target.value)}
                  aria-label="Filter by make"
                >
                  <option value="">All Makes</option>
                  {makes.map(make => (
                    <option key={make as string} value={make as string}>{make as string}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {readState === 'failed' ? (
              <div className="p-4">
                <ReadFailedNotice subject="finance applications" refused={readRefused} onRetry={() => void fetchApplications()} testId="lending-read-failed" />
              </div>
            ) : loading ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : applications.length === 0 ? (
              <div className="text-center py-12 text-gray-500" data-testid="lending-empty">
                No finance applications are recorded for this account.
              </div>
            ) : (
              <>
                {/* RX06-LR07 (unified only): below 1280 px each application is a card, so every field and every
                    decision is on screen without sideways scrolling (the table hid Review, Reject and Approve Loan
                    off-screen up to 768 px). The decisions are the same LendingDecisions as the table row. */}
                <ul className="divide-y divide-gray-100 xl:hidden" aria-label="Finance applications">
                  {rows.map((app) => (
                    <li key={app.id} className="space-y-3 p-4" data-testid={`lending-card-${app.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-gray-900">{app.users?.name || 'Applicant name not recorded'}</p>
                          <p className="break-all text-xs text-gray-600">ID: {app.id}</p>
                        </div>
                        <Badge className={`${getStatusBadge(app.status)} shadow-none border-none`}>
                          {app.status || 'Status not recorded'}
                        </Badge>
                      </div>
                      <dl className="grid grid-cols-1 gap-3 text-sm min-[480px]:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-xs font-medium text-gray-600">Vehicle</dt>
                          <dd className="break-words font-medium text-gray-800">{[app.year, app.make, app.model].filter(Boolean).join(' ') || 'Vehicle not recorded'}</dd>
                          <dd className="break-all text-xs text-gray-600">VIN: {app.vin}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-medium text-gray-600">Requested amount</dt>
                          <dd data-testid="lending-amount">
                            <p className="font-bold text-indigo-700">{recordedRequest(app)}</p>
                            <p className="text-xs text-gray-600" data-testid="lending-terms">{recordedTerms(app)}</p>
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-medium text-gray-600">Vehicle trust (not a credit score)</dt>
                          <dd data-testid="lending-trust">{vehicleTrustLabel(app)}</dd>
                        </div>
                      </dl>
                      <LendingDecisions app={app} onUpdate={handleUpdateStatus} stacked />
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto xl:block">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wider border-b">
                      <th className="px-6 py-4">Applicant</th>
                      <th className="px-6 py-4">Vehicle Details</th>
                      <th className="px-6 py-4">Requested amount</th>
                      <th className="px-6 py-4">Vehicle trust (not a credit score)</th>
                      <th className="px-6 py-4">Recorded status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {rows.map((app) => {
                      const applicant = app.users?.name || 'Applicant name not recorded'
                      return (
                        <tr key={app.id} className="hover:bg-gray-50/50 transition-colors" data-testid={`lending-row-${app.id}`}>
                          <td className="px-6 py-4">
                            <p className="font-semibold text-gray-900">{applicant}</p>
                            <p className="text-[10px] text-gray-500">ID: {app.id}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-medium text-gray-800">{[app.year, app.make, app.model].filter(Boolean).join(' ') || 'Vehicle not recorded'}</p>
                            <p className="text-[10px] text-gray-500">VIN: {app.vin}</p>
                          </td>
                          <td className="px-6 py-4" data-testid="lending-amount">
                            <p className="font-bold text-indigo-700">{recordedRequest(app)}</p>
                            <p className="text-[10px] text-gray-500" data-testid="lending-terms">{recordedTerms(app)}</p>
                          </td>
                          <td className="px-6 py-4" data-testid="lending-trust">{vehicleTrustLabel(app)}</td>
                          <td className="px-6 py-4">
                            <Badge className={`${getStatusBadge(app.status)} shadow-none border-none`}>
                              {app.status || 'Status not recorded'}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <LendingDecisions app={app} onUpdate={handleUpdateStatus} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
                {rows.length === 0 && (
                  <div className="text-center py-8 text-gray-500" data-testid="lending-filter-empty">No applications match this make.</div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-indigo-600" />
            Lending Applications Queue
          </h1>
          <p className="text-gray-500">Manage credit pre-approvals, asset underwriting, and disbursement status.</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchApplications}>
          Refresh Queue
        </Button>
      </div>

      <Card className="border-0 card-shadow bg-white overflow-hidden">
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-lg">Active Applications ({applications.length})</CardTitle>
            <div className="flex gap-2">
              <select 
                className="text-xs bg-white border border-gray-200 rounded px-3 py-1.5 outline-none hover:bg-gray-50 cursor-pointer"
                value={filterMake}
                onChange={(e) => setFilterMake(e.target.value)}
              >
                <option value="">All Makes</option>
                {makes.map(make => (
                  <option key={make as string} value={make as string}>{make as string}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : applications.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No lending applications found in database ledger.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wider border-b">
                    <th className="px-6 py-4">Applicant</th>
                    <th className="px-6 py-4">Vehicle Details</th>
                    <th className="px-6 py-4">Request Amount</th>
                    <th className="px-6 py-4">Risk & Trust Index</th>
                    <th className="px-6 py-4">Lending Workflow State</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {filteredApps.map((app) => (
                    <tr key={app.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-700">
                            {app.user_name[0]}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{app.user_name}</p>
                            <p className="text-[10px] text-gray-400">ID: {app.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-800">{app.year} {app.make} {app.model}</p>
                          <p className="text-[10px] text-gray-400">VIN: {app.vin}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-bold text-indigo-700">${app.requested_amount.toLocaleString()} USD</p>
                          <p className="text-[10px] text-gray-400">Monthly: ${app.monthly_payment.toFixed(2)} @ {app.apr}% APR</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="w-32">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span>Trust Score</span>
                            <span className="font-bold text-indigo-600">{app.trust_score}%</span>
                          </div>
                          <Progress value={app.trust_score} className="h-1.5 bg-gray-100" indicatorClassName="bg-indigo-600" />
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge className={`${getStatusBadge(app.status)} shadow-none border-none`}>
                          {app.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {app.status === 'Pending' && (
                            <>
                              <Button
                                size="sm"
                                className="bg-amber-500 hover:bg-amber-600 text-white text-xs py-1 px-2.5"
                                onClick={() => handleUpdateStatus(String(app.id), 'Under Review')}
                              >
                                Review
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="text-xs py-1 px-2.5"
                                onClick={() => handleUpdateStatus(String(app.id), 'Rejected')}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {app.status === 'Under Review' && (
                            <Button
                              size="sm"
                              className="bg-purple-500 hover:bg-purple-600 text-white text-xs py-1 px-2.5"
                              onClick={() => handleUpdateStatus(String(app.id), 'Approved')}
                            >
                              Approve Loan
                            </Button>
                          )}
                          {app.status === 'Approved' && (
                            <Button
                              size="sm"
                              className="bg-orange-500 hover:bg-orange-600 text-white text-xs py-1 px-2.5"
                              onClick={() => handleUpdateStatus(String(app.id), 'Escrow Pending')}
                            >
                              Disburse to Escrow
                            </Button>
                          )}
                          {app.status === 'Escrow Pending' && (
                            <Button
                              size="sm"
                              className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs py-1 px-2.5"
                              onClick={() => handleUpdateStatus(String(app.id), 'Active Loan')}
                            >
                              Activate Asset
                            </Button>
                          )}
                          {app.status === 'Active Loan' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs py-1 px-2.5"
                              onClick={() => handleUpdateStatus(String(app.id), 'Closed')}
                            >
                              Close Loan
                            </Button>
                          )}
                          {(app.status === 'Closed' || app.status === 'Rejected') && (
                            <span className="text-xs text-gray-400 italic">No actions</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
