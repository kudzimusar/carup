import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Shield, FileText, AlertTriangle, DollarSign, ArrowRight, BarChart3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// No claims read model backs this dashboard yet. The previous chart series and "recent claims" rows
// were invented (fabricated policyholder names, vehicles and settlement amounts), so both render as
// explicit empty states instead of fictional claim activity.
const claimData: Array<{ month: string; claims: number; approved: number }> = []

const recentClaims: Array<{ id: string; policyholder: string; vehicle: string; type: string; amount: number; status: string }> = []

export default function InsuranceDashboard() {

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insurance Dashboard</h1>
          <p className="text-gray-500">Insurer workspace</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1" asChild>
          <Link to="/insurance-dash/claims"><FileText className="w-4 h-4" /> View Claims</Link>
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          // No policy/claims/premium read model backs this dashboard; the previous figures came from a
          // fabricated `dashboardStats.insurance` block. They say "Not available" rather than invent
          // portfolio performance or fraud counts.
          { label: 'Active Policies', value: 'Not available', icon: Shield, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Pending Claims', value: 'Not available', icon: FileText, color: 'text-amber-500', bg: 'bg-amber-50' },
          { label: 'Fraud Alerts', value: 'Not available', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
          { label: 'Monthly Premiums', value: 'Not available', icon: DollarSign, color: 'text-green-500', bg: 'bg-green-50' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg ${stat.bg} ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Claims Overview</CardTitle></CardHeader>
            <CardContent>
              {claimData.length === 0 && (
                <p className="text-sm text-gray-500" data-testid="insurance-claimchart-empty">Claims history is not available yet.</p>
              )}
              {claimData.length > 0 && <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={claimData}>
                  <defs>
                    <linearGradient id="claimsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="claims" stroke="#f97316" fill="url(#claimsGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>}
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Recent Claims</CardTitle>
                <Button variant="ghost" size="sm" asChild><Link to="/insurance-dash/claims">View All</Link></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentClaims.length === 0 && (
                <p className="text-sm text-gray-500" data-testid="insurance-claims-empty">No claims recorded yet.</p>
              )}
              {recentClaims.map((claim) => (
                <div key={claim.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-sm font-medium">{claim.policyholder}</p>
                      <span className="font-medium text-sm">${claim.amount.toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-gray-500">{claim.vehicle} • {claim.type}</p>
                  </div>
                  <Badge className={claim.status === 'approved' ? 'bg-green-500' : claim.status === 'rejected' ? 'bg-red-500' : 'bg-amber-500'}>{claim.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Key Metrics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Claim approval, risk score and detection accuracy had no data source — the figures
                  (incl. a hardcoded "98.7% fraud detection accuracy") were fabricated. A metric with
                  no measurement is named as unavailable, never drawn as a filled bar. */}
              <div className="flex justify-between text-sm"><span>Claim Approval Rate</span><span className="font-medium text-gray-500">Not available</span></div>
              <div className="flex justify-between text-sm"><span>Risk Score</span><span className="font-medium text-gray-500">Not available</span></div>
              <div className="flex justify-between text-sm"><span>Fraud Detection Accuracy</span><span className="font-medium text-gray-500">Not available</span></div>
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow bg-red-50 border-red-200">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-sm">Fraud Alerts</h3>
                  <p className="text-xs text-gray-600">Fraud case counts are not available for this workspace yet.</p>
                  <Button size="sm" variant="outline" className="mt-2 text-xs" asChild><Link to="/insurance-dash/fraud">Investigate</Link></Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Links</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Claims', href: '/insurance-dash/claims', icon: FileText },
                { label: 'Risk Analysis', href: '/insurance-dash/risk', icon: BarChart3 },
                { label: 'Fraud Alerts', href: '/insurance-dash/fraud', icon: AlertTriangle },
              ].map((link) => (
                <Link key={link.label} to={link.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <link.icon className="w-4 h-4 text-orange-500" />
                  <span className="flex-1">{link.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}