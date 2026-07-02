import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Users, Brain, ShieldAlert, ArrowRight, Landmark, Building2, FileCheck2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const userGrowth = [
  { month: 'Jan', users: 4500 },
  { month: 'Feb', users: 5200 },
  { month: 'Mar', users: 6100 },
  { month: 'Apr', users: 7800 },
  { month: 'May', users: 9200 },
]

export default function AdminDashboard() {
  const { fetchAdminTelemetry } = useCarUpApi()
  const [stats, setStats] = useState({
    totalUsers: 9200,
    totalVehicles: 5,
    totalEscrows: 1,
    totalClaims: 2,
    systemHealth: 'Optimal',
    aiConfidence: '98.5%'
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    fetchAdminTelemetry().then(data => {
      if (mounted && data) {
        setStats(prev => ({
          ...prev,
          totalUsers: data.totalUsers || prev.totalUsers,
          totalVehicles: data.totalVehicles || prev.totalVehicles,
          totalEscrows: data.totalEscrows || prev.totalEscrows,
          totalClaims: data.totalClaims || prev.totalClaims,
          systemHealth: data.systemHealth || prev.systemHealth,
          aiConfidence: data.aiConfidence || prev.aiConfidence
        }))
      }
    }).catch(err => {
      console.error(err)
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [fetchAdminTelemetry])

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto animate-pulse">
        <div>
          <div className="h-8 w-64 bg-gray-200 rounded-lg"></div>
          <div className="h-4 w-96 bg-gray-150 rounded mt-2"></div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-24 bg-gray-200 rounded-xl"></div>
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 h-96 bg-gray-200 rounded-xl"></div>
          <div className="h-96 bg-gray-250 rounded-xl"></div>
        </div>
      </div>
    )
  }

  const organizations = [
    { name: 'Croco Motors Group', type: 'Dealer', location: 'Harare', trust: 98.2, status: 'Active' },
    { name: 'Simbisa Garages Ltd', type: 'Garage', location: 'Bulawayo', trust: 95.0, status: 'Active' },
    { name: 'Old Mutual Zimbabwe', type: 'Insurance', location: 'Harare', trust: 99.0, status: 'Active' },
    { name: 'CBZ Bank Limited', type: 'Bank', location: 'Harare', trust: 97.5, status: 'Active' },
    { name: 'Zimbabwe Revenue Authority', type: 'Government', location: 'Harare', trust: 100.0, status: 'Active' }
  ]

  const fraudAlerts = [
    { vin: 'VIN74329849204928', risk: 'Low', status: 'Verified', reason: 'Legitimate import clearance' },
    { vin: 'VIN89230489201948', risk: 'Low', status: 'Verified', reason: 'Tamper-free odometer history' },
    { vin: 'VIN_SUSPECT_9921', risk: 'High', status: 'Intercepted', reason: 'Cloned registration books detected' }
  ]

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Ecosystem Governance Command Center
        </h1>
        <p className="text-gray-500">System metrics, stakeholder organizations, fraud interception status, and ledger audits.</p>
      </div>

      {/* Grid Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Ecosystem Users', value: stats.totalUsers.toLocaleString(), change: '+18%', icon: Users, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Supervised Organizations', value: `${stats.totalVehicles} Active`, change: '+20%', icon: Building2, color: 'text-indigo-500', bg: 'bg-indigo-50' },
          { label: 'SafePay Escrow Volume', value: stats.totalEscrows > 0 ? `${stats.totalEscrows} Locks` : '$145,000', change: '+32%', icon: Landmark, color: 'text-green-500', bg: 'bg-green-50' },
          { label: 'Fraud Intercept Rate', value: stats.aiConfidence, change: '+0.4%', icon: ShieldAlert, color: 'text-red-500', bg: 'bg-red-50' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow hover-scale">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  <p className={`text-xs ${stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>{stat.change}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg ${stat.bg} ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Sections */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Organizations List */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Supervised Stakeholder Organizations</CardTitle>
              <Badge className="bg-indigo-100 text-indigo-700 font-semibold">Registered</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wider border-b">
                      <th className="px-6 py-3">Organization</th>
                      <th className="px-6 py-3">Segment Type</th>
                      <th className="px-6 py-3">Trust Index</th>
                      <th className="px-6 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {organizations.map((org, index) => (
                      <tr key={index} className="hover:bg-gray-50/50">
                        <td className="px-6 py-3 font-semibold text-gray-800">{org.name}</td>
                        <td className="px-6 py-3 text-gray-500">{org.type} ({org.location})</td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-indigo-600">{org.trust}%</span>
                            <Progress value={org.trust} className="w-16 h-1 bg-gray-100" indicatorClassName="bg-indigo-600" />
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <Badge className="bg-green-100 text-green-700 shadow-none border-none">{org.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Fraud Interception Ledger */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Ecosystem Fraud & VIN Cloning Audits</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {fraudAlerts.map((f, i) => (
                <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100/40 transition-all border border-gray-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-800">{f.vin}</span>
                      <Badge className={f.risk === 'High' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>{f.risk} Risk</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{f.reason}</p>
                  </div>
                  <Badge className={f.status === 'Intercepted' ? 'bg-red-500 text-white' : 'bg-indigo-600 text-white'}>
                    {f.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">User Growth</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={userGrowth}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="users" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316' }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Active AI Copilots */}
          <Card className="border-0 card-shadow bg-gradient-to-br from-indigo-900 to-indigo-950 text-white">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-orange-400 shrink-0" />
                <h3 className="font-semibold text-sm">Active AI Copilots</h3>
              </div>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between border-b border-indigo-800/40 pb-2">
                  <span>Dealer Pricing Copilot</span>
                  <span className="text-green-400">Online</span>
                </div>
                <div className="flex justify-between border-b border-indigo-800/40 pb-2">
                  <span>Simbisa Diagnostics AI</span>
                  <span className="text-green-400">Online</span>
                </div>
                <div className="flex justify-between">
                  <span>Old Mutual Underwriter Copilot</span>
                  <span className="text-green-400">Online</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'User Management', href: '/admin/users', icon: Users },
                { label: 'AI Monitoring', href: '/admin/ai', icon: Brain },
                { label: 'Moderation', href: '/admin/moderation', icon: ShieldAlert },
                { label: 'Fraud Queue', href: '/admin/fraud-queue', icon: ShieldAlert },
                { label: 'Dealer Compliance', href: '/admin/dealer-compliance', icon: Building2 },
                { label: 'Evidence Review', href: '/admin/evidence', icon: FileCheck2 },
              ].map((link) => (
                <Link key={link.label} to={link.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <link.icon className="w-4 h-4 text-orange-500" />
                  <span className="flex-1 font-semibold">{link.label}</span>
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