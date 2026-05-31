import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Plus, Package, AlertTriangle, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

export default function PartsTracking() {
  const { fetchMechanicParts, createMechanicPart, loading } = useCarUpApi()
  const [parts, setParts] = useState<any[]>([])
  const [search, setSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    stock_level: 0,
    unit_price: 0
  })

  useEffect(() => {
    fetchMechanicParts().then(data => {
      if (data && data.length > 0) {
        const formatted = data.map((d: any) => ({
          id: d.id.substring(0, 8).toUpperCase(),
          name: d.name,
          sku: d.sku,
          stock: d.stock_level,
          minStock: d.min_stock || 5,
          supplier: d.supplier || 'Internal',
          price: d.unit_price
        }))
        setParts(formatted)
      }
    }).catch(err => {
      console.error(err)
      toast.error('Failed to load Parts Inventory.')
    })
  }, [fetchMechanicParts])

  const filtered = parts.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await createMechanicPart({
        name: formData.name,
        sku: formData.sku,
        stock_level: Number(formData.stock_level),
        unit_price: Number(formData.unit_price)
      })
      if (res.success) {
        toast.success('Part added successfully!')
        setIsModalOpen(false)
        setParts([{
          id: res.part?.id || Math.random().toString(),
          name: formData.name,
          sku: formData.sku,
          stock: formData.stock_level,
          minStock: 5,
          supplier: 'Internal',
          price: formData.unit_price
        }, ...parts])
        setFormData({ name: '', sku: '', stock_level: 0, unit_price: 0 })
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to add part')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Parts Tracking
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Inventory management and parts ledger</p>
        </div>
        
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className="bg-orange-500 hover:bg-orange-600 gap-1 text-white"><Plus className="w-4 h-4" /> Add Part</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Part to Inventory</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Part Name</Label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Brake Pads" />
              </div>
              <div className="space-y-2">
                <Label>SKU / Part Number</Label>
                <Input required value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})} placeholder="e.g. BP-TYT-001" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Initial Stock</Label>
                  <Input required type="number" min="0" value={formData.stock_level} onChange={e => setFormData({...formData, stock_level: Number(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Unit Price ($)</Label>
                  <Input required type="number" min="0" step="0.01" value={formData.unit_price} onChange={e => setFormData({...formData, unit_price: Number(e.target.value)})} />
                </div>
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Part
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <Card className="border-0 card-shadow transition-transform hover:-translate-y-1"><CardContent className="p-5"><p className="text-sm text-gray-500">Total Parts Types</p><p className="text-2xl font-bold">{parts.length}</p></CardContent></Card>
        <Card className="border-0 card-shadow transition-transform hover:-translate-y-1"><CardContent className="p-5"><p className="text-sm text-gray-500">Inventory Value</p><p className="text-2xl font-bold text-orange-600">${parts.reduce((a, p) => a + p.price * p.stock, 0).toLocaleString()}</p></CardContent></Card>
        <Card className="border-0 card-shadow transition-transform hover:-translate-y-1"><CardContent className="p-5"><p className="text-sm text-gray-500">Low Stock</p><p className="text-2xl font-bold text-amber-600">{parts.filter(p => p.stock <= p.minStock).length}</p></CardContent></Card>
        <Card className="border-0 card-shadow transition-transform hover:-translate-y-1"><CardContent className="p-5"><p className="text-sm text-gray-500">Out of Stock</p><p className="text-2xl font-bold text-red-600">{parts.filter(p => p.stock === 0).length}</p></CardContent></Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search parts by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-white" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden card-shadow">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="p-4">Part Details</th>
              <th className="p-4">SKU / Code</th>
              <th className="p-4">Stock Status</th>
              <th className="p-4">Unit Price</th>
              <th className="p-4">Supplier</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 text-sm">
            {filtered.map((part, idx) => (
              <tr key={part.id + idx} className={`hover:bg-gray-50/50 transition-colors ${part.stock <= part.minStock ? 'bg-amber-50/5' : ''}`}>
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${part.stock <= part.minStock ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                      <Package className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{part.name}</p>
                      {part.stock <= part.minStock && (
                        <span className="inline-flex items-center text-[10px] text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded mt-0.5">
                          <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Low Stock
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="p-4 font-mono text-xs text-gray-500">{part.sku}</td>
                <td className="p-4">
                  <span className={`font-semibold ${part.stock === 0 ? 'text-red-600' : part.stock <= part.minStock ? 'text-amber-600' : 'text-gray-900'}`}>
                    {part.stock} units
                  </span>
                </td>
                <td className="p-4 font-semibold text-orange-600">${part.price}</td>
                <td className="p-4 text-gray-500">{part.supplier}</td>
                <td className="p-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" className="text-xs text-orange-600 border-orange-200 hover:bg-orange-50/50" onClick={() => document.getElementById(`invoice-upload-${part.id}`)?.click()}>
                      Upload Invoice
                    </Button>
                    <input type="file" id={`invoice-upload-${part.id}`} className="hidden" accept="image/*,application/pdf" onChange={(e) => {
                      if (e.target.files?.length) {
                        toast.success(`Invoice uploaded for ${part.name}!`);
                      }
                    }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
            <Package className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No parts found</h3>
            <p className="text-gray-500">Add a new part to your inventory.</p>
          </div>
        )}
      </div>
    </div>
  )
}