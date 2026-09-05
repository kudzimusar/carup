/**
 * Parts tracking — CarUp Intelligence I12.
 *
 * Four things on this page asserted facts nobody recorded:
 *
 *   - a failed fetch only raised a toast, leaving `parts` empty, so all four
 *     tiles read 0 and the table said "No parts found. Add a new part to your
 *     inventory." An outage was indistinguishable from an empty shelf;
 *   - a part with no supplier recorded was labelled "Internal", asserting a
 *     sourcing fact from a missing value;
 *   - a part with no reorder threshold was given one of 5, which then drove the
 *     Low Stock tile and the amber row badge. A garage that never set a threshold
 *     was being alerted against a number CarUp invented;
 *   - an unrecorded stock level or price became 0, which fed the Out of Stock
 *     count and silently understated the inventory value.
 *
 * The "Upload Invoice" control was worse than any of them: its handler only
 * raised `toast.success('Invoice uploaded')`. No request was made and no file was
 * stored — there is no parts-invoice endpoint. It told a garage its document was
 * filed while discarding it, so it is removed rather than relabelled.
 */
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Plus, Package, AlertTriangle, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { Part } from '@/types'
import PartsIntelligence from '@/components/intelligence/PartsIntelligence'

/** A part as recorded — a missing number stays missing rather than becoming 0. */
interface TrackedPart {
  id: string
  name: string
  sku: string
  stock: number | null
  minStock: number | null
  supplier: string | null
  price: number | null
}

const asNumber = (value: unknown): number | null => (
  Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null
)

const toTracked = (d: Part): TrackedPart => ({
  id: String(d.id),
  name: d.name,
  sku: d.sku,
  stock: asNumber(d.stock_level ?? d.stock),
  minStock: asNumber(d.min_stock ?? d.minStock),
  supplier: d.supplier || null,
  price: asNumber(d.unit_price ?? d.price),
})

const isBelowThreshold = (part: TrackedPart): boolean => (
  part.stock !== null && part.minStock !== null && part.stock <= part.minStock
)

export default function PartsTracking() {
  const { fetchMechanicParts, createMechanicPart, loading } = useCarUpApi()
  const [parts, setParts] = useState<TrackedPart[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  // An unread inventory is not an empty one either. Until the read settles this page has
  // counted nothing, so it must not render tiles whose values would be indistinguishable
  // from a measured zero — the same rule that makes a FAILED read refuse to show figures.
  const [readSettled, setReadSettled] = useState(false)
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
      setLoadFailed(false)
      setParts(Array.isArray(data) ? data.map(toTracked) : [])
    }).catch(err => {
      // An unreadable inventory is not an empty one.
      console.error(err)
      setLoadFailed(true)
      toast.error('Failed to load Parts Inventory.')
    }).finally(() => {
      setReadSettled(true)
    })
  }, [fetchMechanicParts])

  const filtered = parts.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()))

  const priced = parts.filter(p => p.price !== null && p.stock !== null)
  const inventoryValue = priced.reduce((a, p) => a + (p.price as number) * (p.stock as number), 0)
  const withThreshold = parts.filter(p => p.minStock !== null)
  const stockRecorded = parts.filter(p => p.stock !== null)

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
        // Only what was actually submitted. No supplier and no reorder threshold
        // were given, so neither is invented here.
        setParts([{
          id: String(res.part?.id ?? formData.sku),
          name: formData.name,
          sku: formData.sku,
          stock: Number(formData.stock_level),
          minStock: null,
          supplier: null,
          price: Number(formData.unit_price)
        }, ...parts])
        setFormData({ name: '', sku: '', stock_level: 0, unit_price: 0 })
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to add part'
      toast.error(errMsg)
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
            <Button className="bg-orange-500 hover:bg-orange-600 gap-1 text-white" data-testid="add-part-button">
              <Plus className="w-4 h-4" /> Add Part
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="add-part-dialog">
            <DialogHeader>
              <DialogTitle>Add New Part to Inventory</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Part Name</Label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Brake Pads" data-testid="part-name-input" />
              </div>
              <div className="space-y-2">
                <Label>SKU / Part Number</Label>
                <Input required value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})} placeholder="e.g. BP-TYT-001" data-testid="part-sku-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Initial Stock</Label>
                  <Input required type="number" min="0" value={formData.stock_level} onChange={e => setFormData({...formData, stock_level: Number(e.target.value)})} data-testid="stock-level-input" />
                </div>
                <div className="space-y-2">
                  <Label>Unit Price ($)</Label>
                  <Input required type="number" min="0" step="0.01" value={formData.unit_price} onChange={e => setFormData({...formData, unit_price: Number(e.target.value)})} data-testid="unit-price-input" />
                </div>
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={isSubmitting} data-testid="submit-part-button">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Part
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* The governed projection: PartSentry provenance for this practitioner,
          and the list of what CarUp cannot measure about parts at all. */}
      <PartsIntelligence scope="mechanic" windowDays={30} />

      {!readSettled ? (
        <Card className="border-0 card-shadow" data-testid="parts-not-yet-counted">
          <CardContent className="p-5 text-sm text-gray-600">
            Your parts inventory has not been read yet. No figures are shown below, because
            none have been counted.
          </CardContent>
        </Card>
      ) : loadFailed ? (
        <Card className="border-0 card-shadow" data-testid="parts-load-failed">
          <CardContent className="p-5 text-sm text-gray-600">
            Your parts inventory could not be loaded. These figures are NOT zero — nothing below
            has been counted.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-4 gap-4">
            <Card className="border-0 card-shadow transition-transform hover:-translate-y-1"><CardContent className="p-5"><p className="text-sm text-gray-500">Total Parts Types</p><p className="text-2xl font-bold" data-testid="parts-total">{parts.length}</p></CardContent></Card>
            <Card className="border-0 card-shadow transition-transform hover:-translate-y-1">
              <CardContent className="p-5">
                <p className="text-sm text-gray-500">Inventory Value</p>
                <p className="text-2xl font-bold text-orange-600" data-testid="parts-value">${inventoryValue.toLocaleString()}</p>
                {/* Parts with no recorded price or stock are excluded rather than
                    counted as zero, so the shortfall is stated. */}
                {priced.length !== parts.length && (
                  <p className="mt-1 text-[11px] text-gray-500" data-testid="parts-value-coverage">
                    Covers {priced.length} of {parts.length} parts. The true total is higher.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="border-0 card-shadow transition-transform hover:-translate-y-1">
              <CardContent className="p-5">
                <p className="text-sm text-gray-500">Low Stock</p>
                {withThreshold.length === 0 ? (
                  <p className="text-sm italic text-gray-500" data-testid="parts-low-stock">No reorder level set</p>
                ) : (
                  <p className="text-2xl font-bold text-amber-600" data-testid="parts-low-stock">{withThreshold.filter(isBelowThreshold).length}</p>
                )}
              </CardContent>
            </Card>
            <Card className="border-0 card-shadow transition-transform hover:-translate-y-1">
              <CardContent className="p-5">
                <p className="text-sm text-gray-500">Out of Stock</p>
                <p className="text-2xl font-bold text-red-600" data-testid="parts-out-of-stock">{stockRecorded.filter(p => p.stock === 0).length}</p>
              </CardContent>
            </Card>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search parts by name or SKU..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white"
              data-testid="parts-search-input"
              aria-label="Search parts"
            />
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden card-shadow">
            <table className="w-full text-left border-collapse" data-testid="mechanic-parts-table">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="p-4">Part Details</th>
                  <th className="p-4">SKU / Code</th>
                  <th className="p-4">Stock Status</th>
                  <th className="p-4">Unit Price</th>
                  <th className="p-4">Supplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
                {filtered.map((part, idx) => {
                  const low = isBelowThreshold(part)
                  return (
                    <tr key={part.id + idx} className={`hover:bg-gray-50/50 transition-colors ${low ? 'bg-amber-50/5' : ''}`} data-testid={`part-row-${part.id}`}>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${low ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                            <Package className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{part.name}</p>
                            {/* Only where the garage set a reorder level itself. */}
                            {low && (
                              <span className="inline-flex items-center text-[10px] text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded mt-0.5">
                                <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Low Stock
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 font-mono text-xs text-gray-500">{part.sku}</td>
                      <td className="p-4">
                        {part.stock === null ? (
                          <span className="text-sm italic text-gray-500">Not recorded</span>
                        ) : (
                          <span className={`font-semibold ${part.stock === 0 ? 'text-red-600' : low ? 'text-amber-600' : 'text-gray-900'}`}>
                            {part.stock} units
                          </span>
                        )}
                      </td>
                      <td className="p-4 font-semibold text-orange-600">
                        {part.price === null ? <span className="text-sm italic font-normal text-gray-500">Not recorded</span> : `$${part.price}`}
                      </td>
                      <td className="p-4 text-gray-500">
                        {part.supplier ?? <span className="italic">Not recorded</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-100" data-testid="no-parts-state">
                <Package className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">No parts found</h3>
                <p className="text-gray-500">Add a new part to your inventory.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
