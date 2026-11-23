import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Wrench, Search, Plus, Calendar, User, DollarSign, Clock, Loader2, Receipt } from 'lucide-react'
import { useCallback, useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { WorkOrder } from '@/types'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { CHIP, UNIFIED_PRIMARY_ACTION, recordedAmount, type ChipTone } from '@/components/workbench/institutionalRecords'

// RX06-LR07 (unified only): the recorded status in words, on an AA-contrast chip. The status itself is unchanged.
const STATUS_WORDS: Partial<Record<WorkOrder['status'], string>> = { pending: 'Pending', 'in-progress': 'In progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_TONE: Partial<Record<WorkOrder['status'], ChipTone>> = { pending: 'neutral', 'in-progress': 'pending', completed: 'positive', cancelled: 'negative' }
const FILTERS = ['all', 'pending', 'in-progress', 'completed', 'cancelled'] as const
const FILTER_WORDS: Record<(typeof FILTERS)[number], string> = { all: 'All', pending: 'Pending', 'in-progress': 'In progress', completed: 'Completed', cancelled: 'Cancelled' }

export default function WorkOrders() {
  const { fetchMechanicWorkOrders, createMechanicWorkOrder, updateMechanicWorkOrder, loading } = useCarUpApi()
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    vin: '',
    customer_name: '',
    issue_description: ''
  })

  // Per-row action state: which order is collecting a completion cost, and which is mid-request.
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [completeCost, setCompleteCost] = useState('')
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  // RX06-LR06 U06-S1 (unified only): a failed or unfinished read is never shown as "No work orders found", and
  // nothing the record does not hold (a mechanic's name, a date, a description) is invented.
  const unified = isUnifiedUiEnabled()
  const [readState, setReadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [readRefused, setReadRefused] = useState(false)

  const loadWorkOrders = useCallback(() => {
    return fetchMechanicWorkOrders().then(data => {
      const formatted = (Array.isArray(data) ? data : []).map((d: WorkOrder) => ({
        // Keep the FULL DB id — PATCH /mechanic/work-orders/:id needs it. The short display id
        // is derived at render time.
        id: d.id,
        vehicle: d.vin || d.vehicle || (unified ? 'Vehicle not recorded' : 'Unknown'),
        customer: d.customer_name || d.customer || (unified ? 'Customer not recorded' : 'Unknown'),
        // `description` is the Phase-4 column the create form's issue text is stored in.
        service: d.service || d.description || d.issue_description || (unified ? 'No description recorded' : 'General Service'),
        status: d.status?.toLowerCase().replace(' ', '-') as WorkOrder['status'] || 'pending',
        date: d.date || (unified && (!d.created_at || Number.isNaN(Date.parse(d.created_at))) ? 'Date not recorded' : new Date(d.created_at).toLocaleDateString()),
        cost: d.total_cost ?? d.cost ?? 0,
        mechanic: d.mechanic_id || d.mechanic ? (unified ? 'Assigned to a mechanic' : `Mechanic (${(d.mechanic_id || d.mechanic).substring(0,4)})`) : 'Unassigned',
        created_at: d.created_at
      }))
      setWorkOrders(formatted)
      setReadState('ready')
    }).catch(err => {
      console.error(err)
      toast.error('Failed to load Work Orders.')
      setReadState('failed')
      setReadRefused((err as { status?: unknown } | null)?.status === 403)
    })
  }, [fetchMechanicWorkOrders, unified])

  useEffect(() => {
    void loadWorkOrders()
  }, [loadWorkOrders])

  const filtered = workOrders.filter(w =>
    (!search || w.vehicle.toLowerCase().includes(search.toLowerCase()) || w.customer.toLowerCase().includes(search.toLowerCase())) &&
    (filter === 'all' || w.status === filter)
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await createMechanicWorkOrder(formData)
      if (res.success) {
        toast.success('Work Order created successfully!')
        setIsModalOpen(false)
        setFormData({ vin: '', customer_name: '', issue_description: '' })
        // Re-sync from the backend so the new row carries its real DB id (needed for actions).
        await loadWorkOrders()
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to create Work Order'
      toast.error(errMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Status transition through PATCH /mechanic/work-orders/:id — DB CHECK values only.
  const handleUpdateStatus = async (id: string, status: 'Completed' | 'Cancelled', cost?: string) => {
    const payload: { status: 'Completed' | 'Cancelled'; total_cost?: number } = { status }
    if (status === 'Completed' && cost !== undefined && cost.trim() !== '') {
      const parsed = Number(cost)
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error('Total cost must be a non-negative number')
        return
      }
      payload.total_cost = parsed
    }
    setActionBusyId(id)
    // Optimistic: reflect the transition immediately; server truth re-syncs (or rolls back) below.
    const previous = workOrders
    setWorkOrders(prev => prev.map(o => o.id === id
      ? { ...o, status: status.toLowerCase() as WorkOrder['status'], ...(payload.total_cost !== undefined ? { cost: payload.total_cost } : {}) }
      : o))
    try {
      await updateMechanicWorkOrder(id, payload)
      toast.success(status === 'Completed' ? 'Work order completed.' : 'Work order cancelled.')
      setCompletingId(null)
      setCompleteCost('')
      await loadWorkOrders()
    } catch (err: unknown) {
      // Honest failure: restore the pre-action rows, then tell the user why.
      setWorkOrders(previous)
      toast.error(err instanceof Error ? err.message : 'Failed to update work order')
    } finally {
      setActionBusyId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className={unified ? 'flex flex-wrap items-start justify-between gap-3' : 'flex items-center justify-between'}>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Work Orders
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Manage service appointments and jobs</p>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className={unified ? `${UNIFIED_PRIMARY_ACTION} h-11 gap-1 sm:h-9` : 'bg-orange-500 hover:bg-orange-600 gap-1 text-white'} data-testid="new-workorder-button">
              <Plus className="w-4 h-4" /> New Order
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="create-workorder-dialog">
            <DialogHeader>
              <DialogTitle>Create New Work Order</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Customer Name</Label>
                <Input required value={formData.customer_name} onChange={e => setFormData({...formData, customer_name: e.target.value})} placeholder="e.g. John Doe" data-testid="customer-name-input" />
              </div>
              <div className="space-y-2">
                <Label>Vehicle VIN</Label>
                <Input required value={formData.vin} onChange={e => setFormData({...formData, vin: e.target.value})} placeholder="e.g. JTD123456789" data-testid="vehicle-vin-input" />
              </div>
              <div className="space-y-2">
                <Label>Issue Description</Label>
                <Input required value={formData.issue_description} onChange={e => setFormData({...formData, issue_description: e.target.value})} placeholder="e.g. Needs new brake pads" data-testid="issue-description-input" />
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={isSubmitting} data-testid="submit-workorder-button">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Create Work Order
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search work orders..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={unified ? 'pl-10 bg-white h-11 sm:h-9' : 'pl-10 bg-white'}
            data-testid="workorders-search-input"
            aria-label="Search work orders"
          />
        </div>
        {unified ? (
          // RX06-LR07 (unified only): the filters wrap instead of scrolling sideways (two were hidden off-screen on a
          // phone), the one that is on is said so (aria-pressed), and the active colour meets AA contrast.
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter work orders by status" data-testid="workorders-filters">
            {FILTERS.map(s => (
              <Button key={s} variant={filter === s ? 'default' : 'outline'} size="sm" aria-pressed={filter === s} onClick={() => setFilter(s)} className={`h-11 sm:h-8 ${filter === s ? UNIFIED_PRIMARY_ACTION : ''}`}>
                {FILTER_WORDS[s]}
              </Button>
            ))}
          </div>
        ) : (
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
          {['all', 'pending', 'in-progress', 'completed', 'cancelled'].map(s => (
            <Button key={s} variant={filter === s ? 'default' : 'outline'} size="sm" onClick={() => setFilter(s)} className={filter === s ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
        )}
      </div>

      <div className="space-y-3" data-testid="workorders-table">
        {filtered.map((order, idx) => unified ? (
          // RX06-LR07 (unified only): one card that fits a 279 px phone. The VIN wraps instead of pushing the row to
          // 423 px; the status is a word on an AA chip; a recorded cost carries no currency the record does not hold;
          // the actions are the SAME buttons (labels, handlers, values, test ids, disabled rules), stacked full width
          // with 44 px targets on a phone.
          <Card key={order.id + idx} className="border-0 card-shadow" data-testid={`workorder-row-${order.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-100 min-[360px]:flex" aria-hidden="true">
                  <Wrench className="h-5 w-5 text-orange-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <h3 className="min-w-0 break-all text-base font-semibold text-gray-900 sm:text-lg">{order.vehicle}</h3>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[STATUS_TONE[order.status] ?? 'neutral']}`} data-testid={`workorder-status-${order.id}`}>
                      {STATUS_WORDS[order.status] ?? order.status}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-gray-600">Order {order.id.substring(0, 11).toUpperCase()}</p>
                  <p className="mt-2 break-words text-sm font-medium text-gray-700">{order.service}</p>
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-md bg-gray-50 p-2 text-xs text-gray-700 sm:grid-cols-2">
                    <div className="flex min-w-0 items-center gap-1.5"><dt><User className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Customer</span></dt><dd className="min-w-0 break-words">{order.customer}</dd></div>
                    <div className="flex min-w-0 items-center gap-1.5"><dt><Calendar className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Date</span></dt><dd>{order.date}</dd></div>
                    {order.cost > 0 && (
                      <div className="flex min-w-0 items-center gap-1.5" data-testid={`workorder-cost-${order.id}`}><dt><Receipt className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Recorded cost</span></dt><dd>{recordedAmount(order.cost)} · currency not recorded</dd></div>
                    )}
                    <div className="flex min-w-0 items-center gap-1.5"><dt><Clock className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Mechanic</span></dt><dd className="min-w-0 break-words">{order.mechanic}</dd></div>
                  </dl>
                  {(order.status === 'pending' || order.status === 'in-progress') && (
                    <div className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center" data-testid={`workorder-actions-${order.id}`}>
                      {completingId === order.id ? (
                        <>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Total cost (optional)"
                            value={completeCost}
                            onChange={e => setCompleteCost(e.target.value)}
                            className="h-11 w-full min-[360px]:col-span-2 sm:h-9 sm:w-44"
                            data-testid={`workorder-cost-input-${order.id}`}
                            aria-label="Total cost"
                          />
                          <Button
                            size="sm"
                            className="h-11 bg-green-600 text-white hover:bg-green-700 sm:h-9"
                            onClick={() => void handleUpdateStatus(order.id, 'Completed', completeCost)}
                            disabled={actionBusyId === order.id}
                            data-testid={`workorder-confirm-complete-${order.id}`}
                          >
                            {actionBusyId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                            Confirm completion
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11 sm:h-9"
                            onClick={() => { setCompletingId(null); setCompleteCost('') }}
                            disabled={actionBusyId === order.id}
                            data-testid={`workorder-complete-back-${order.id}`}
                          >
                            Back
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="h-11 bg-green-600 text-white hover:bg-green-700 sm:h-9"
                            onClick={() => { setCompletingId(order.id); setCompleteCost('') }}
                            disabled={actionBusyId !== null}
                            data-testid={`workorder-complete-${order.id}`}
                          >
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11 border-red-200 text-red-700 hover:bg-red-50 sm:h-9"
                            onClick={() => void handleUpdateStatus(order.id, 'Cancelled')}
                            disabled={actionBusyId !== null}
                            data-testid={`workorder-cancel-${order.id}`}
                          >
                            {actionBusyId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                            Cancel order
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card key={order.id + idx} className="border-0 card-shadow transition-all hover:shadow-md" data-testid={`workorder-row-${order.id}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                  <Wrench className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-lg">{order.vehicle}</h3>
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{order.id.substring(0, 11).toUpperCase()}</span>
                    </div>
                    <Badge className={order.status === 'completed' ? 'bg-green-500 hover:bg-green-600 text-white' : order.status === 'in-progress' ? 'bg-amber-500 hover:bg-amber-600 text-white' : order.status === 'cancelled' ? 'bg-gray-400 hover:bg-gray-500 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}>
                      {order.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-2 font-medium">{order.service}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500 bg-gray-50 p-2 rounded-md">
                    <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" />{order.customer}</span>
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{order.date}</span>
                    {order.cost > 0 && <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" />{order.cost}</span>}
                    <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{order.mechanic}</span>
                  </div>
                  {(order.status === 'pending' || order.status === 'in-progress') && (
                    <div className="flex flex-wrap items-center gap-2 mt-3" data-testid={`workorder-actions-${order.id}`}>
                      {completingId === order.id ? (
                        <>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Total cost (optional)"
                            value={completeCost}
                            onChange={e => setCompleteCost(e.target.value)}
                            className="h-8 w-44"
                            data-testid={`workorder-cost-input-${order.id}`}
                            aria-label="Total cost"
                          />
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => void handleUpdateStatus(order.id, 'Completed', completeCost)}
                            disabled={actionBusyId === order.id}
                            data-testid={`workorder-confirm-complete-${order.id}`}
                          >
                            {actionBusyId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                            Confirm completion
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setCompletingId(null); setCompleteCost('') }}
                            disabled={actionBusyId === order.id}
                            data-testid={`workorder-complete-back-${order.id}`}
                          >
                            Back
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => { setCompletingId(order.id); setCompleteCost('') }}
                            disabled={actionBusyId !== null}
                            data-testid={`workorder-complete-${order.id}`}
                          >
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-700 border-red-200 hover:bg-red-50"
                            onClick={() => void handleUpdateStatus(order.id, 'Cancelled')}
                            disabled={actionBusyId !== null}
                            data-testid={`workorder-cancel-${order.id}`}
                          >
                            {actionBusyId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                            Cancel order
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {unified && readState === 'failed' && (
          <div className="text-center py-12 bg-white rounded-xl border border-red-100" data-testid="workorders-read-failed" role="status">
            <Wrench className="w-12 h-12 text-gray-200 mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">{readRefused ? 'This account cannot read work orders' : 'Your work orders could not be loaded'}</h3>
            <p className="text-gray-500">{readRefused ? 'CarUp refused this account access to work orders. Nothing has changed.' : 'This is not an empty list: CarUp could not read your work orders just now. Nothing has changed.'}</p>
            {!readRefused && <Button variant="outline" className="mt-4" onClick={() => { setReadState('loading'); void loadWorkOrders() }} data-testid="workorders-retry">Try again</Button>}
          </div>
        )}
        {unified && readState === 'loading' && (
          <p className="text-center py-12 text-gray-500" data-testid="workorders-loading">Loading your work orders…</p>
        )}
        {filtered.length === 0 && (!unified || readState === 'ready') && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100" data-testid="no-workorders-state">
            <Wrench className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No work orders found</h3>
            <p className="text-gray-500">Create a new order to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}