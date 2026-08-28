import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Wrench, ClipboardList, DollarSign, CheckCircle,
  ArrowRight, Cpu, Plus, Loader2
} from 'lucide-react'
import { Link } from 'react-router-dom'
import ServiceIntelligence from '@/components/intelligence/ServiceIntelligence'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { WorkOrder } from '@/types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Real jobs-per-weekday counts for the trailing 7 days, Monday-first.
function weeklyJobsFrom(workOrders: WorkOrder[]) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const counts = new Map<string, number>(WEEKDAYS.map(d => [d, 0]))
  for (const order of workOrders) {
    const created = new Date(order.created_at || order.date || '')
    if (Number.isNaN(created.getTime()) || created.getTime() < sevenDaysAgo) continue
    const day = WEEKDAYS[created.getDay()]
    counts.set(day, (counts.get(day) || 0) + 1)
  }
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => ({ day, jobs: counts.get(day) || 0 }))
}

export default function MechanicDashboard() {
  const { fetchMechanicWorkOrders, createMechanicWorkOrder } = useCarUpApi()

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [ordersError, setOrdersError] = useState<string | null>(null)

  const [showWorkOrderDialog, setShowWorkOrderDialog] = useState(false)
  const [workOrderForm, setWorkOrderForm] = useState({ vin: '', customerName: '', issue: '' })
  const [creatingOrder, setCreatingOrder] = useState(false)

  // Promise-chain form: every setState lives in a .then/.catch callback so the
  // effect that invokes this never sets state synchronously.
  const loadWorkOrders = useCallback(() => {
    return fetchMechanicWorkOrders()
      .then(orders => {
        setWorkOrders(Array.isArray(orders) ? orders : [])
        setOrdersError(null)
      })
      .catch((err: unknown) => {
        setWorkOrders([])
        setOrdersError(err instanceof Error ? err.message : 'Failed to load work orders')
      })
  }, [fetchMechanicWorkOrders])

  useEffect(() => {
    loadWorkOrders()
  }, [loadWorkOrders])

  // Stats derived from the real work order rows only.
  const now = new Date()
  const isThisMonth = (iso?: string) => {
    if (!iso) return false
    const d = new Date(iso)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }
  const activeOrders = workOrders.filter(o => o.status === 'In Progress' || o.status === 'pending' || o.status === 'in-progress')
  const completedThisMonth = workOrders.filter(o => String(o.status).toLowerCase() === 'completed' && isThisMonth(o.created_at || o.date))
  const monthlyRevenue = completedThisMonth.reduce((sum, o) => sum + (o.total_cost || o.cost || 0), 0)
  const weeklyJobs = weeklyJobsFrom(workOrders)

  const handleCreateWorkOrder = async () => {
    if (!workOrderForm.vin || !workOrderForm.customerName) {
      toast.error('VIN and customer name are required')
      return
    }
    setCreatingOrder(true)
    try {
      const res = await createMechanicWorkOrder({
        vin: workOrderForm.vin,
        customer_name: workOrderForm.customerName,
        issue_description: workOrderForm.issue,
      })
      if (!res?.workOrder?.id) {
        toast.error('The server did not confirm the work order was created')
        return
      }
      toast.success(`Work order created for ${workOrderForm.vin}`)
      setShowWorkOrderDialog(false)
      setWorkOrderForm({ vin: '', customerName: '', issue: '' })
      await loadWorkOrders()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create work order')
    } finally {
      setCreatingOrder(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Mechanic Dashboard</h1>
          <p className="text-gray-500">Workshop overview from your recorded work orders</p>
        </div>
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-white gap-1"
          onClick={() => setShowWorkOrderDialog(true)}
          data-testid="mechanic-dashboard-create-workorder-button"
        >
          <Plus className="w-4 h-4" /> Create Work Order
        </Button>
      </div>

      {/* Governed practitioner intelligence (I9). PERSON scope: this mechanic's
          own work, never the garage's — the component states which on screen. */}
      <ServiceIntelligence scope="mechanic" />

      {/* Stats Grid — real counts from fetched work orders */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Orders', value: String(activeOrders.length), icon: ClipboardList, color: 'text-amber-500', bg: 'bg-amber-50' },
          { label: 'Completed (Mo)', value: String(completedThisMonth.length), icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
          { label: 'Revenue (USD)', value: `$${monthlyRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Total Orders', value: String(workOrders.length), icon: Wrench, color: 'text-purple-500', bg: 'bg-purple-50' },
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
          {/* Open Work Orders */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-1.5 text-gray-800">
                <Cpu className="w-5 h-5 text-emerald-600" />
                Recent Work Orders
              </CardTitle>
              <Badge className="bg-emerald-50 text-emerald-700 shadow-none border-none">Live</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {ordersError && (
                <div className="p-3.5 bg-red-50 rounded-xl border border-red-100 text-xs text-red-700" data-testid="work-orders-error">
                  Could not load work orders: {ordersError}
                </div>
              )}
              {!ordersError && workOrders.length === 0 && (
                <div className="text-center py-8" data-testid="work-orders-empty">
                  <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No work orders recorded yet.</p>
                  <p className="text-xs text-gray-400 mt-1">Create a work order to start building your workshop history.</p>
                </div>
              )}
              {workOrders.slice(0, 5).map((order) => (
                <div key={order.id} className="flex justify-between items-center p-3.5 bg-gray-50 hover:bg-gray-100/40 rounded-xl transition-all border border-gray-100 text-xs">
                  <div>
                    <p className="font-semibold text-gray-800">{order.description || order.issue_description || order.service || 'Work order'}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{order.vin || order.vehicle} • {order.created_at ? new Date(order.created_at).toLocaleDateString() : ''}</p>
                  </div>
                  <div className="text-right">
                    <Badge className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] shadow-none border-none">
                      {order.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* PartSentry pointer — VIN-scoped service logs live on the Service Logs page */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Cryptographic PartSentry Ledger</CardTitle></CardHeader>
            <CardContent>
              <div className="text-center py-6" data-testid="partsentry-ledger-pointer">
                <Cpu className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Signed service logs are recorded per vehicle.</p>
                <Link to="/mechanic/service-logs" className="text-xs font-semibold text-emerald-600 hover:underline mt-1 inline-flex items-center gap-1">
                  Open Service Logs to load a vehicle's ledger <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Jobs This Week</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={weeklyJobs}>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} allowDecimals={false} />
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
            <DialogDescription>Record a new vehicle repair job for your workshop</DialogDescription>
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
                {creatingOrder ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Work Order'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
