/**
 * Lending portal — CarUp Intelligence I11.
 *
 * What this page used to assert, none of which had a source:
 *
 *   - four headline tiles — an active financed-asset value, a pending-application
 *     count, an average APR and a collateral default risk — all string literals;
 *   - a static Jan–May loan-disbursement chart, identical for every viewer;
 *   - a named bank in the page title, presented as a live partner portal;
 *   - an "AI Credit Scoring Copilot" claiming to be actively scanning
 *     pre-approvals, comparing Harare market prices and checking the audit ledger
 *     for odometer tampering, with a fixed confidence threshold;
 *   - three portfolio risk-tier bars for a tiering CarUp does not compute;
 *   - and, in the queue itself, a CarUp Trust score rendered as a borrower credit
 *     verdict ("Low Risk" / "Medium Risk").
 *
 * CarUp records no disbursement, no repayment and no lender decision, and no
 * lender is onboarded. So the tiles are replaced by the governed commercial
 * projection, which names each absence, and the credit verdict is removed
 * outright: Trust states confidence in evidence about a VEHICLE and says nothing
 * about a borrower's ability to repay.
 *
 * The application queue is real and is preserved, with a failed read now
 * distinguishable from an empty one.
 */
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Landmark, ArrowRight, ClipboardList, MapPin, BarChart3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import FinanceIntelligence from '@/components/intelligence/FinanceIntelligence'
import type { FinanceApplication } from '@/types'

const QUICK_LINKS = [
  { label: 'Applications', to: '/bank/applications', icon: ClipboardList },
  { label: 'Collateral', to: '/bank/collateral', icon: MapPin },
  { label: 'Credit risk', to: '/bank/risk', icon: BarChart3 },
]

export default function BankDashboard() {
  const { fetchFinanceApplications } = useCarUpApi()
  const [applications, setApplications] = useState<FinanceApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const loadApps = async () => {
      try {
        setLoading(true)
        setLoadFailed(false)
        const data = await fetchFinanceApplications()
        setApplications(Array.isArray(data) ? data.slice(0, 3) : [])
      } catch (err) {
        // A failed read is not an empty queue. Without this the surface rendered
        // "No lending applications pending" during an outage.
        console.error(err)
        setLoadFailed(true)
        toast.error('Failed to load recent applications')
      } finally {
        setLoading(false)
      }
    }
    loadApps()
  }, [fetchFinanceApplications])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Landmark className="w-6 h-6 text-indigo-600" />
          Lending portal
        </h1>
        <p className="text-gray-500">
          Applications CarUp has received. Credit risk and collateral are governed separately.
        </p>
      </div>

      {/* Governed commercial demand, replacing four literal tiles. */}
      <FinanceIntelligence windowDays={30} />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Recent applications</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/bank/applications">View all <ArrowRight className="w-4 h-4 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </div>
              ) : loadFailed ? (
                <div className="text-center py-6 text-gray-600" data-testid="bank-applications-failed">
                  Applications could not be loaded. This is not an empty queue.
                </div>
              ) : applications.length === 0 ? (
                <div className="text-center py-6 text-gray-500" data-testid="bank-applications-empty">
                  No lending applications received.
                </div>
              ) : applications.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100"
                  data-testid={`bank-application-${app.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                      <Landmark className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{app.user_name || 'Applicant not recorded'}</span>
                        <Badge variant="outline" className="text-[10px]">{app.id}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {[app.year, app.make, app.model].filter(Boolean).join(' ') || 'Vehicle not recorded'}
                        {typeof app.requested_amount === 'number' && (
                          <> • Requested: <b className="text-gray-800">${app.requested_amount.toLocaleString()}</b></>
                        )}
                      </p>
                    </div>
                  </div>
                  {/* The Trust score was rendered here as "Low Risk"/"Medium Risk".
                      Trust is confidence in evidence about a vehicle, not a credit
                      verdict about a person, so only the application's own status
                      is shown. */}
                  <Badge className="bg-indigo-600 text-white text-xs shrink-0">
                    {app.status || 'Status not recorded'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {QUICK_LINKS.map((link) => (
                <Button key={link.to} variant="outline" className="w-full justify-start gap-2" asChild>
                  <Link to={link.to}><link.icon className="w-4 h-4" /> {link.label}</Link>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
