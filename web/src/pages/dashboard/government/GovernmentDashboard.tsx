// @ts-nocheck
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Shield, Search, CheckCircle, FileText, Car, Users, AlertTriangle, ArrowRight, Key, Landmark, Calculator } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useCarUpApi } from '@/hooks/useCarUpApi'

const registrationData = [
  { month: 'Jan', registrations: 1200 },
  { month: 'Feb', registrations: 1350 },
  { month: 'Mar', registrations: 1100 },
  { month: 'Apr', registrations: 1450 },
  { month: 'May', registrations: 1380 },
]

export default function GovernmentDashboard() {
  const { fetchZimraDuty } = useCarUpApi()

  // ZIMRA Estimator states
  const [vehicleValue, setVehicleValue] = useState(10000)
  const [vehicleYear, setVehicleYear] = useState(2017)
  const [engineSize, setEngineSize] = useState(1800)
  const [dutyLoading, setDutyLoading] = useState(false)
  const [dutyResult, setDutyResult] = useState({
    totalDuty: 10125.00,
    percentageOfValue: 101.25,
    vat: 1500,
    surtax: 3500
  })

  // MFA logs state
  const [mfaLogs, setMfaLogs] = useState([
    { officer: 'Inspector T. Chihuri', event: 'Hardware FIDO Session Validated', ip: '10.20.45.10', time: '16:42:01' },
    { officer: 'ZIMRA Desk Officer Moyo', event: 'MFA Handshake Handled', ip: '10.20.12.88', time: '16:30:15' }
  ])

  const handleCalculateDuty = async () => {
    setDutyLoading(true)
    try {
      const data = await fetchZimraDuty(Number(vehicleValue), Number(vehicleYear), Number(engineSize))
      setDutyResult(data)
      toast.success('ZIMRA Custom Duty Estimator recalculated.')
    } catch (err) {
      toast.error('Failed to calculate customs duty.')
    } finally {
      setDutyLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Government Regulatory Portal
        </h1>
        <p className="text-gray-500">ZIMRA & CVR National Vehicle Ledger and Security Audit Systems</p>
      </div>

      {/* Segmented Access Guard Alert */}
      <Card className="border-0 bg-indigo-50 border-l-4 border-indigo-600 text-indigo-800 p-4">
        <div className="flex items-start gap-2.5">
          <Key className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-xs text-indigo-900">Segmented Access Protocol Active</p>
            <p className="text-[11px] text-indigo-700 leading-relaxed mt-0.5">
              Secure RBAC isolation is fully enforced. CVR & ZIMRA desk officers cannot query private automotive banking ledgers, and CBZ Bank representatives are restricted from accessing law enforcement records or VIN cloning reports.
            </p>
          </div>
        </div>
      </Card>

      {/* Grid Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Registered Vehicles', value: '1.2M', icon: Car, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Pending Verifications', value: '234', icon: FileText, color: 'text-amber-500', bg: 'bg-amber-50' },
          { label: 'Verified Today', value: '89', icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
          { label: 'Security Alerts Flagged', value: '3 Active', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow hover-scale">
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
          {/* ZIMRA duty estimator */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-1.5">
                <Calculator className="w-5 h-5 text-indigo-600" />
                ZIMRA Dynamic Custom Duty Estimator
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">FOB Value (USD)</label>
                  <Input type="number" value={vehicleValue} onChange={e => setVehicleValue(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Manufacture Year</label>
                  <Input type="number" value={vehicleYear} onChange={e => setVehicleYear(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Engine size (cc)</label>
                  <Input type="number" value={engineSize} onChange={e => setEngineSize(e.target.value)} />
                </div>
              </div>
              <Button onClick={handleCalculateDuty} disabled={dutyLoading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                {dutyLoading ? 'Calculating Duty...' : 'Calculate ZIMRA Duty'}
              </Button>
              <div className="bg-gray-50 rounded-xl p-4 mt-2 border border-gray-100 grid sm:grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-[10px] text-gray-400">Total Calculated Duty</p>
                  <p className="text-lg font-bold text-indigo-700">${dutyResult.totalDuty.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">VAT (15%)</p>
                  <p className="text-lg font-bold text-gray-700">${dutyResult.vat.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">Duty Percentage</p>
                  <p className="text-lg font-bold text-gray-700">{dutyResult.percentageOfValue.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* MFA Sessions logs */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Secure Hardware Session Audits (MFA)</CardTitle>
              <Badge className="bg-green-100 text-green-700">Protected</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {mfaLogs.map((log, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100/50 rounded-xl border border-gray-100 text-xs">
                  <div>
                    <p className="font-semibold text-gray-800">{log.officer}</p>
                    <p className="text-[10px] text-gray-400">{log.event} • IP: {log.ip}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {log.time}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Monthly Registrations</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={registrationData}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="registrations" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={25} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Registry Verification', href: '/government/registry', icon: Search },
                { label: 'Compliance Reports', href: '/government/compliance', icon: FileText },
              ].map((link) => (
                <Link key={link.label} to={link.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <link.icon className="w-4 h-4 text-indigo-600" />
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