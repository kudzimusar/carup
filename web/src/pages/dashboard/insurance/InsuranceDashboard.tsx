import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Shield, FileText, AlertTriangle, DollarSign, CheckCircle, ArrowRight, BarChart3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { dashboardStats } from '@/data/mockData'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const claimData = [
  { month: 'Jan', claims: 8, approved: 7 },
  { month: 'Feb', claims: 12, approved: 11 },
  { month: 'Mar', claims: 10, approved: 9 },
  { month: 'Apr', claims: 15, approved: 14 },
  { month: 'May', claims: 12, approved: 11 },
]

const recentClaims = [
  { id: 'CLM-2026-001', policyholder: 'Tendai Moyo', vehicle: 'Toyota Corolla', type: 'Accident', amount: 3500, status: 'approved' },
  { id: 'CLM-2026-002', policyholder: 'Sarah Chikomo', vehicle: 'Mazda CX-5', type: 'Theft', amount: 28000, status: 'under-review' },
  { id: 'CLM-2026-003', policyholder: 'James Ncube', vehicle: 'Land Rover Discovery', type: 'Fire', amount: 15000, status: 'approved' },
]

export default function InsuranceDashboard() {
  const stats = dashboardStats.insurance

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insurance Dashboard</h1>
          <p className="text-gray-500">NicozDiamond Insurance</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1" asChild>
          <Link to="/insurance-dash/claims"><FileText className="w-4 h-4" /> View Claims</Link>
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Policies', value: stats.activePolicies.toLocaleString(), icon: Shield, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Pending Claims', value: stats.pendingClaims, icon: FileText, color: 'text-amber-500', bg: 'bg-amber-50', badge: stats.pendingClaims },
          { label: 'Fraud Alerts', value: stats.fraudAlerts, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50', badge: stats.fraudAlerts },
          { label: 'Monthly Premiums', value: `$${(stats.monthlyPremiums / 1000).toFixed(0)}k`, icon: DollarSign, color: 'text-green-500', bg: 'bg-green-50' },
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
              <ResponsiveContainer width="100%" height={240}>
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
              </ResponsiveContainer>
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
              <div><div className="flex justify-between text-sm mb-1"><span>Claim Approval Rate</span><span className="font-medium">{stats.claimApproval}%</span></div><Progress value={stats.claimApproval} className="h-2" /></div>
              <div><div className="flex justify-between text-sm mb-1"><span>Risk Score</span><span className="font-medium">{stats.riskScore}/10</span></div><Progress value={stats.riskScore * 10} className="h-2" /></div>
              <div className="flex items-center gap-2 pt-2"><CheckCircle className="w-5 h-5 text-green-500" /><span className="text-sm">98.7% fraud detection accuracy</span></div>
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow bg-red-50 border-red-200">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-sm">Fraud Alerts</h3>
                  <p className="text-xs text-gray-600">{stats.fraudAlerts} potential fraud cases detected this week.</p>
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