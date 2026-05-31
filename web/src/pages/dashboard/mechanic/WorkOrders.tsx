import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Wrench, Search, Plus, Calendar, User, DollarSign, Clock, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

export default function WorkOrders() {
  const { fetchMechanicWorkOrders, createMechanicWorkOrder, loading } = useCarUpApi()
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    vin: '',
    customer_name: '',
    issue_description: ''
  })

  useEffect(() => {
    fetchMechanicWorkOrders().then(data => {
      if (data && data.length > 0) {
        const formatted = data.map((d: any) => ({
          id: d.id.substring(0, 11).toUpperCase(),
          vehicle: d.vin,
          customer: d.customer_name || 'Unknown',
          service: d.description || d.issue_description || 'General Service',
          status: d.status?.toLowerCase().replace(' ', '-') || 'pending',
          date: new Date(d.created_at).toLocaleDateString(),
          cost: d.total_cost || 0,
          mechanic: d.mechanic_id ? `Mechanic (${d.mechanic_id.substring(0,4)})` : 'Unassigned'
        }))
        setWorkOrders(formatted)
      }
    }).catch(err => {
      console.error(err)
      toast.error('Failed to load Work Orders.')
    })
  }, [fetchMechanicWorkOrders])

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
        setWorkOrders([{
          id: `WO-${new Date().getFullYear()}-NEW`,
          vehicle: formData.vin,
          customer: formData.customer_name,
          service: formData.issue_description,
          status: 'pending',
          date: new Date().toLocaleDateString(),
          cost: 0,
          mechanic: 'Unassigned'
        }, ...workOrders])
        setFormData({ vin: '', customer_name: '', issue_description: '' })
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create Work Order')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Work Orders
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Manage service appointments and jobs</p>
        </div>
        
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className="bg-orange-500 hover:bg-orange-600 gap-1 text-white"><Plus className="w-4 h-4" /> New Order</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Work Order</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Customer Name</Label>
                <Input required value={formData.customer_name} onChange={e => setFormData({...formData, customer_name: e.target.value})} placeholder="e.g. John Doe" />
              </div>
              <div className="space-y-2">
                <Label>Vehicle VIN</Label>
                <Input required value={formData.vin} onChange={e => setFormData({...formData, vin: e.target.value})} placeholder="e.g. JTD123456789" />
              </div>
              <div className="space-y-2">
                <Label>Issue Description</Label>
                <Input required value={formData.issue_description} onChange={e => setFormData({...formData, issue_description: e.target.value})} placeholder="e.g. Needs new brake pads" />
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={isSubmitting}>
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
          <Input placeholder="Search work orders..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-white" />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
          {['all', 'pending', 'in-progress', 'completed'].map(s => (
            <Button key={s} variant={filter === s ? 'default' : 'outline'} size="sm" onClick={() => setFilter(s)} className={filter === s ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((order, idx) => (
          <Card key={order.id + idx} className="border-0 card-shadow transition-all hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                  <Wrench className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-lg">{order.vehicle}</h3>
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{order.id}</span>
                    </div>
                    <Badge className={order.status === 'completed' ? 'bg-green-500 hover:bg-green-600 text-white' : order.status === 'in-progress' ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}>
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
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
            <Wrench className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No work orders found</h3>
            <p className="text-gray-500">Create a new order to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}