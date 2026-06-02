import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Wrench, Search, Plus, Calendar, FileText, Loader2, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { WorkOrder } from '@/types'

const mockLogs = [
  { id: '1', vehicle: 'Toyota Corolla', service: 'Full Service', date: '2026-04-20', mileage: 67000, cost: 280, parts: 3, notes: 'Oil change, filters, brake inspection' },
  { id: '2', vehicle: 'BMW X5', service: 'Brake Service', date: '2026-01-15', mileage: 45000, cost: 450, parts: 2, notes: 'Front and rear brake replacement' },
  { id: '3', vehicle: 'Nissan NP300', service: 'Timing Belt', date: '2026-03-10', mileage: 44000, cost: 380, parts: 1, notes: 'Timing belt and water pump replacement' },
]

export default function ServiceLogs() {
  const { addRepairLog, loading } = useCarUpApi()
  const [logs, setLogs] = useState<WorkOrder[]>(mockLogs as WorkOrder[])
  const [search, setSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    vin: '',
    partName: '',
    partOem: '',
    actionType: 'replaced',
    description: '',
    mileage: 0
  })

  // To fetch history, we normally need a specific VIN. 
  // For the dashboard, we would ideally fetch all logs for the mechanic's org.
  // Since the existing API is `/partsentry/:vin`, we'll just show the mock + any newly added.
  // If we wanted to fetch all, we would need a new endpoint, but this satisfies the demo.

  const filtered = logs.filter(l => !search || l.vehicle.toLowerCase().includes(search.toLowerCase()))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await addRepairLog(
        formData.vin, 
        'mech_1', // mechanicId
        formData.partName, 
        formData.partOem, 
        formData.actionType, 
        formData.description, 
        Number(formData.mileage)
      )
      if (res.success) {
        toast.success('Service log recorded securely to PartSentry!')
        setIsModalOpen(false)
        setLogs([{
          id: Math.random().toString(),
          vehicle: formData.vin,
          service: `${formData.actionType} ${formData.partName}`,
          date: new Date().toLocaleDateString(),
          mileage: formData.mileage,
          cost: 0,
          parts: 1,
          notes: formData.description
        } as unknown as WorkOrder, ...logs])
        setFormData({ vin: '', partName: '', partOem: '', actionType: 'replaced', description: '', mileage: 0 })
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add log')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Service Logs
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Complete service history records</p>
        </div>
        
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className="bg-orange-500 hover:bg-orange-600 gap-1 text-white"><Plus className="w-4 h-4" /> Add Log</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-orange-500" />
                Record Service Log (PartSentry)
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-md flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Logs submitted here are cryptographically signed and permanently stored on the PartSentry blockchain. This cannot be undone.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vehicle VIN</Label>
                  <Input required value={formData.vin} onChange={e => setFormData({...formData, vin: e.target.value})} placeholder="e.g. JTD12345..." />
                </div>
                <div className="space-y-2">
                  <Label>Mileage (km)</Label>
                  <Input required type="number" min="0" value={formData.mileage} onChange={e => setFormData({...formData, mileage: Number(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Part Name</Label>
                  <Input required value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} placeholder="e.g. Brake Pads" />
                </div>
                <div className="space-y-2">
                  <Label>OEM Part Number</Label>
                  <Input required value={formData.partOem} onChange={e => setFormData({...formData, partOem: e.target.value})} placeholder="e.g. BP-TYT-001" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <select 
                  className="w-full flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.actionType}
                  onChange={e => setFormData({...formData, actionType: e.target.value})}
                >
                  <option value="replaced">Replaced</option>
                  <option value="repaired">Repaired</option>
                  <option value="inspected">Inspected</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Description / Notes</Label>
                <Input required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Details of the service performed" />
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Submit to PartSentry
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search service logs by vehicle..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-white" />
      </div>

      <div className="space-y-4">
        {filtered.map((log) => (
          <Card key={log.id} className="border-0 card-shadow transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-medium text-lg">{log.vehicle} - {log.service}</h3>
                    {log.cost > 0 && <span className="text-sm font-medium bg-green-50 text-green-700 px-2 py-1 rounded-md">${log.cost}</span>}
                  </div>
                  <p className="text-sm text-gray-600 mb-3 italic">"{log.notes}"</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500 bg-gray-50 p-2 rounded-md">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{log.date}</span>
                    <span className="font-medium text-gray-800">{log.mileage?.toLocaleString()} km</span>
                    {log.parts > 0 && <span>{log.parts} parts replaced</span>}
                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Verified by PartSentry</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
            <FileText className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No service logs found</h3>
            <p className="text-gray-500">Record a new service log to add history.</p>
          </div>
        )}
      </div>
    </div>
  )
}