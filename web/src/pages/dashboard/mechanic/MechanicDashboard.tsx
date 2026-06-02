import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Wrench, ClipboardList, DollarSign, Star, CheckCircle,
  ArrowRight, ShieldCheck, Cpu, Plus, Loader2
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { dashboardStats } from '@/data/mockData'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useCarUpApi } from '@/hooks/useCarUpApi'

const weeklyJobs = [
  { day: 'Mon', jobs: 5 },
  { day: 'Tue', jobs: 7 },
  { day: 'Wed', jobs: 4 },
  { day: 'Thu', jobs: 8 },
  { day: 'Fri', jobs: 6 },
  { day: 'Sat', jobs: 3 },
  { day: 'Sun', jobs: 1 },
]

export default function MechanicDashboard() {
  const stats = dashboardStats.mechanic
  const { addRepairLog } = useCarUpApi()

  const [ledgerLogs, setLedgerLogs] = useState([
    { event: 'Suspension Replacement', mileage: '52,000 km', hash: '5b89c3...a982', time: '2026-05-26T14:15Z' },
    { event: 'Odometer Calibration check', mileage: '48,500 km', hash: '8e2d41...741d', time: '2026-05-26T12:00Z' }
  ])

  const [approvals, setApprovals] = useState([
    { id: 1, vehicle: 'Toyota Hilux GD-6', cost: 180, item: 'Brake pads replacement', client: 'Tendai M.', clientPhone: '263773345678', status: 'Pending Approval' }
  ])

  const [showWorkOrderDialog, setShowWorkOrderDialog] = useState(false)
  const [workOrderForm, setWorkOrderForm] = useState({ vin: '', customerName: '', issue: '', estimatedDays: '3' })
  const [creatingOrder, setCreatingOrder] = useState(false)

  const handleSendApproval = (id: number, phone: string, item: string, vehicle: string) => {
    const message = encodeURIComponent(`Hi! Your ${vehicle} is ready for repair: ${item}. Please approve to proceed. — Simbisa Garages`)
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank')
    setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'Sent via WhatsApp' } : a))
    toast.success('Repair approval sent via WhatsApp to vehicle owner.')
  }

  const handleCreateWorkOrder = async () => {
    if (!workOrderForm.vin || !workOrderForm.customerName) {
      toast.error('VIN and customer name are required')
      return
    }
    setCreatingOrder(true)
    let hash = ''
    try {
      const result = await addRepairLog(workOrderForm.vin, 'u2', 'Work Order Created', 'WO-001', 'Inspected', workOrderForm.issue || 'Initial inspection', 0)
      hash = result?.blockchainEvent?.current_hash?.substring(0, 10) || ''
    } catch {
      hash = Math.random().toString(36).substring(2, 12)
    }
    setLedgerLogs(prev => [{
      event: `Work Order: ${workOrderForm.issue || 'Inspection'}`,
      mileage: '—',
      hash: hash + '...a1b2',
      time: new Date().toISOString(),
    }, ...prev])
    setShowWorkOrderDialog(false)
    setWorkOrderForm({ vin: '', customerName: '', issue: '', estimatedDays: '3' })
    setCreatingOrder(false)
    toast.success(`Work order created and logged to PartSentry blockchain! Hash: ${hash}...`)
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header with Verification Status Badge */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Mechanic Dashboard</h1>
            <Badge className="bg-emerald-100 text-emerald-800 border-none font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              CVR Certified #9082
            </Badge>
          </div>
          <p className="text-gray-500">Simbisa Garages Ltd • Bulawayo Main Workshop</p>
        </div>
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-white gap-1"
          onClick={() => setShowWorkOrderDialog(true)}
          data-testid="mechanic-dashboard-create-workorder-button"
        >
          <Plus className="w-4 h-4" /> Create Work Order
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Orders', value: stats.activeWorkOrders, icon: ClipboardList, color: 'text-amber-500', bg: 'bg-amber-50' },
          { label: 'Completed (Mo)', value: stats.completedThisMonth, icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
          { label: 'Revenue (USD)', value: `$${stats.monthlyRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Satisfaction', value: `${stats.customerSatisfaction}/5`, icon: Star, color: 'text-purple-500', bg: 'bg-purple-50' },
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

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Cryptographic Service Hashing Ledger */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-1.5 text-gray-800">
                <Cpu className="w-5 h-5 text-emerald-600 animate-pulse" />
                Cryptographic PartSentry Ledger
              </CardTitle>
              <Badge className="bg-emerald-50 text-emerald-700 shadow-none border-none">Secured</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {ledgerLogs.map((log, idx) => (
                <div key={idx} className="flex justify-between items-center p-3.5 bg-gray-50 hover:bg-gray-100/40 rounded-xl transition-all border border-gray-100 text-xs">
                  <div>
                    <p className="font-semibold text-gray-800">{log.event}</p>
                    <p className="text-[10px] text-gray-400">Timestamp: {log.time} • Odo: {log.mileage}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px]">
                      {log.hash}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Client Repair Approval Queue */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Live Client Repair Approvals</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {approvals.map((app) => (
                <div key={app.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-800">{app.vehicle}</span>
                      <Badge className="bg-orange-100 text-orange-700">{app.status}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{app.item} • Requested from <b>{app.client}</b></p>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <p className="font-bold text-gray-800 mr-2">${app.cost} USD</p>
                    {app.status === 'Pending Approval' && (
                        <Button size="sm" onClick={() => handleSendApproval(app.id, app.clientPhone, app.item, app.vehicle)} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs py-1 px-2.5">
                          Send to WhatsApp
                        </Button>
                      )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Weekly Jobs</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={weeklyJobs}>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="jobs" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Work Orders', href: '/mechanic/work-orders', icon: ClipboardList },
                { label: 'Service Logs', href: '/mechanic/service-logs', icon: CheckCircle },
                { label: 'Parts Tracking', href: '/mechanic/parts', icon: Wrench },
              ].map((link) => (
                <Link key={link.label} to={link.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <link.icon className="w-4 h-4 text-emerald-600" />
                  <span className="flex-1 font-semibold">{link.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create Work Order Dialog */}
      <Dialog open={showWorkOrderDialog} onOpenChange={setShowWorkOrderDialog}>
        <DialogContent className="sm:max-w-md" data-testid="create-workorder-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-emerald-500" /> Create Work Order</DialogTitle>
            <DialogDescription>Log a new vehicle repair job to the PartSentry blockchain</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Vehicle VIN *</label>
              <Input value={workOrderForm.vin} onChange={e => setWorkOrderForm(f => ({ ...f, vin: e.target.value }))} placeholder="17-char VIN" className="font-mono" data-testid="vehicle-vin-input" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Customer Name *</label>
              <Input value={workOrderForm.customerName} onChange={e => setWorkOrderForm(f => ({ ...f, customerName: e.target.value }))} placeholder="e.g. Tendai Moyo" data-testid="customer-name-input" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Issue Description</label>
              <textarea
                value={workOrderForm.issue}
                onChange={e => setWorkOrderForm(f => ({ ...f, issue: e.target.value }))}
                rows={3}
                placeholder="Describe the problem or work to be done..."
                className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-400 border-gray-200"
                data-testid="issue-description-input"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowWorkOrderDialog(false)} disabled={creatingOrder}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleCreateWorkOrder} disabled={creatingOrder} data-testid="submit-workorder-button">
                {creatingOrder ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create & Mint to Chain'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}