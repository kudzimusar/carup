import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Shield,
  TrendingUp,
  ArrowRight,
  ClipboardList,
  AlertTriangle,
  MapPin,
  Landmark
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { FinanceApplication } from '@/types'

const loanTrend = [
  { month: 'Jan', volume: 150000 },
  { month: 'Feb', volume: 220000 },
  { month: 'Mar', volume: 190000 },
  { month: 'Apr', volume: 310000 },
  { month: 'May', volume: 450000 },
]

export default function BankDashboard() {
  const { fetchFinanceApplications } = useCarUpApi()
  const [applications, setApplications] = useState<FinanceApplication[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadApps = async () => {
      try {
        setLoading(true)
        const data = await fetchFinanceApplications()
        setApplications(data.slice(0, 3))
      } catch (err) {
        console.error(err)
        toast.error('Failed to load recent applications')
      } finally {
        setLoading(false)
      }
    }
    loadApps()
  }, [fetchFinanceApplications])
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Landmark className="w-6 h-6 text-indigo-600 animate-pulse" />
            CBZ Bank Partner Portal
          </h1>
          <p className="text-gray-500">Automotive Loan Management & Real-time Collateral Risk Analytics</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white" asChild>
            <Link to="/bank/applications">
              <ClipboardList className="w-4 h-4 mr-1" /> View Lending Queue
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Financed Assets', value: '$1,245,000', icon: Shield, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Pending Applications', value: '4', icon: ClipboardList, color: 'text-amber-500', bg: 'bg-amber-50', badge: 'New' },
          { label: 'Average APR (USD)', value: '7.5%', icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-50' },
          { label: 'Collateral Default Risk', value: '1.2%', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow hover-scale">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-2xl font-bold">{stat.value}</span>
                    {stat.badge && (
                      <Badge className="bg-orange-500 hover:bg-orange-600 text-white text-[9px] h-4">
                        {stat.badge}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className={`w-10 h-10 rounded-lg ${stat.bg} ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Chart */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Loan Disbursement Volume (USD)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={loanTrend}>
                  <defs>
                    <linearGradient id="loanGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} tickFormatter={v => `$${v/1000}k`} />
                  <Tooltip formatter={(v) => [`$${v.toLocaleString()}`, 'Volume']} />
                  <Area type="monotone" dataKey="volume" stroke="#4f46e5" fill="url(#loanGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Pending Reviews */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Lending Applications Queue</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/bank/applications">View All <ArrowRight className="w-4 h-4 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </div>
              ) : applications.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  No lending applications pending.
                </div>
              ) : applications.map((app) => (
                <div key={app.id} className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100/50 rounded-xl transition-all border border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                      <Landmark className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{app.user_name}</span>
                        <Badge variant="outline" className="text-[10px]">{app.id}</Badge>
                      </div>
                      <p className="text-xs text-gray-500">{app.year} {app.make} {app.model} • Requested: <b className="text-gray-800">${app.requested_amount?.toLocaleString() || 0}</b></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                      <p className={`text-xs font-semibold ${app.trust_score > 90 ? 'text-green-600' : 'text-amber-600'}`}>
                        {app.trust_score > 90 ? 'Low Risk' : 'Medium Risk'}
                      </p>
                      <p className="text-[10px] text-gray-400">Trust Index: {app.trust_score}%</p>
                    </div>
                    <Badge className="bg-indigo-600 text-white text-xs">{app.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* CBZ Credit AI copilot */}
          <Card className="border-0 card-shadow bg-gradient-to-br from-indigo-900 to-indigo-950 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-xl -mr-6 -mt-6" />
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-orange-400" />
                </div>
                <h3 className="font-semibold text-sm">AI Credit Scoring Copilot</h3>
              </div>
              <p className="text-xs text-indigo-200 leading-relaxed">
                "Active and monitoring. AI is currently scanning pre-approvals, comparing current market price dynamics in Harare, and checking blockchain mileage ledgers for odometer tampering risk."
              </p>
              <div className="border-t border-indigo-800/60 pt-3 flex items-center justify-between text-xs">
                <span className="text-indigo-300">Confidence Threshold:</span>
                <span className="font-semibold text-green-400">98.4% Passed</span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Lending Applications', icon: ClipboardList, href: '/bank/applications' },
                { label: 'Collateral Tracking', icon: MapPin, href: '/bank/collateral' },
                { label: 'Credit Risk Analysis', icon: TrendingUp, href: '/bank/risk' },
              ].map((item) => (
                <Link key={item.label} to={item.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <item.icon className="w-4 h-4 text-indigo-600" />
                  <span className="flex-1 font-medium">{item.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Verification Stats */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Portfolio Risk Tier</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1"><span>Low Risk Tier</span><span>84%</span></div>
                <Progress value={84} className="h-1.5 bg-gray-100" indicatorClassName="bg-green-500" />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1"><span>Medium Risk Tier</span><span>12%</span></div>
                <Progress value={12} className="h-1.5 bg-gray-100" indicatorClassName="bg-yellow-500" />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1"><span>High Risk Tier</span><span>4%</span></div>
                <Progress value={4} className="h-1.5 bg-gray-100" indicatorClassName="bg-red-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
