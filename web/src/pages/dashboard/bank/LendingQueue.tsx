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

export default function LendingQueue() {
  const { fetchFinanceApplications, updateFinanceApplicationStatus } = useCarUpApi() 
  const [applications, setApplications] = useState<FinanceApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMake, setFilterMake] = useState('')

  // Fetch applications list on load
  const fetchApplications = async () => {
    try {
      setLoading(true)
      const data = await fetchFinanceApplications()
      setApplications(data)
    } catch (error) {
      console.error('Error fetching applications:', error)
      toast.error('Failed to load lending queue.')
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
