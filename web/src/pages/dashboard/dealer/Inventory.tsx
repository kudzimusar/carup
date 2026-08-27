import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, Plus, Eye, Loader2, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { PUBLICATION_BADGE } from '@/lib/publicationStatus'
import { describePublicationRefusal } from '@/lib/publicationRefusal'
import type { Vehicle } from '@/types'

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  Available: 'bg-green-100 text-green-700',
  reserved: 'bg-amber-100 text-amber-700',
  Reserved: 'bg-amber-100 text-amber-700',
  sold: 'bg-gray-100 text-gray-600',
  Sold: 'bg-gray-100 text-gray-600',
}

export default function Inventory() {
  const { fetchDealerInventory, updateVehicleStatus, publishVehicleListing, unpublishVehicleListing } = useCarUpApi()
  const [publishingVin, setPublishingVin] = useState<string | null>(null)
  const [inventory, setInventory] = useState<Vehicle[]>([])

  const handlePublishToggle = async (vin: string, currentlyPublished: boolean) => {
    if (publishingVin) return
    setPublishingVin(vin)
    try {
      const result = currentlyPublished ? await unpublishVehicleListing(vin) : await publishVehicleListing(vin)
      setInventory(prev => prev.map(v => v.vin === vin ? { ...v, publication_status: result.publication_status } : v))
      toast.success(currentlyPublished ? 'Listing unpublished.' : 'Listing published to the marketplace.')
    } catch (e: unknown) {
      toast.error(describePublicationRefusal(e))
    } finally {
      setPublishingVin(null)
    }
  }
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const loadInventory = async () => {
    setLoading(true)
    try {
      setLoadFailed(false)
      const data = await fetchDealerInventory()
      if (Array.isArray(data)) {
        setInventory(data)
      }
    } catch (err) {
      // An error is not an empty inventory. Without this the page rendered its
      // "No inventory found" empty state for a failed read.
      console.error('Failed to load inventory', err)
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInventory()
  }, [fetchDealerInventory])

  const filtered = inventory.filter((v: Vehicle) => {
    const matchSearch = !search || `${v.make} ${v.model}`.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all'
      || String(v.status || '').toLowerCase() === statusFilter.toLowerCase()
    return matchSearch && matchStatus
  })

  const handleMarkSold = async (vehicleId: string, vin: string) => {
    setMarkingId(vehicleId)
    try {
      await updateVehicleStatus(vin, 'sold')
      toast.success('Vehicle marked as sold!')
      // Optimistically update UI
      setInventory(prev => prev.map(v => v.vin === vin ? { ...v, status: 'Sold' } : v))
    } catch {
      toast.error('Failed to mark vehicle as sold')
    }
    setMarkingId(null)
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-gray-500">Manage your vehicle listings ({inventory.length} total)</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1" asChild data-testid="create-vehicle-button">
          <Link to="/dashboard/sell-vehicle"><Plus className="w-4 h-4" /> Add Vehicle</Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search inventory..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
            data-testid="vehicle-search-input"
            aria-label="Search inventory"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="reserved">Reserved</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 card-shadow" data-testid="empty-inventory-state">
          <CardContent className="p-12 text-center">
            <Plus className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2" data-testid="inventory-empty-heading">
              {loadFailed ? 'Inventory could not be loaded' : 'No inventory found'}
            </h3>
            <p className="text-gray-500 mb-4">
              {loadFailed
                ? 'This is not an empty inventory — the list could not be read.'
                : 'Add your first vehicle to start selling on CarUp.'}
            </p>
            <Button className="bg-orange-500 hover:bg-orange-600" asChild data-testid="create-vehicle-button">
              <Link to="/dashboard/sell-vehicle">Add Vehicle</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4" data-testid="dealer-vehicles-table">
          {filtered.map((vehicle: Vehicle) => {
            // A vehicle with no recorded status is not 'Available' — it is unrecorded.
            const effectiveStatus = vehicle.status || null
            const isSold = String(effectiveStatus || '').toLowerCase() === 'sold'
            // A stock photograph of somebody else's car is not this listing's
            // media. When there is no image, say so rather than showing one.
            const primaryImage = vehicle.images?.[0] || null
            return (
              <Card key={vehicle.vin} className="border-0 card-shadow" data-testid={`vehicle-row-${vehicle.id || vehicle.vin}`}>
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    {primaryImage ? (
                      <img src={primaryImage} alt="" className="w-36 h-24 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div
                        className="w-36 h-24 rounded-lg bg-gray-100 flex items-center justify-center text-[11px] text-gray-400 flex-shrink-0"
                        data-testid={`no-image-${vehicle.vin}`}
                      >
                        No photo
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <h3 className="font-semibold">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">VIN: {vehicle.vin.substring(0, 10)}...</p>
                          <p className="text-lg font-bold text-orange-600 mt-1">${vehicle.price.toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                          <Badge className={`text-xs font-medium ${(effectiveStatus && STATUS_COLORS[effectiveStatus]) || 'bg-gray-100 text-gray-600'}`}>
                            {effectiveStatus || 'Status not recorded'}
                          </Badge>
                          {vehicle.publication_status && PUBLICATION_BADGE[vehicle.publication_status] && (
                            <Badge data-testid={`publication-badge-${vehicle.vin}`} className={`text-xs font-medium ${PUBLICATION_BADGE[vehicle.publication_status].className}`}>
                              {PUBLICATION_BADGE[vehicle.publication_status].label}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500">
                        {/* `condition`, `viewCount`, `trustScore` and `isVerified` are
                            not columns this endpoint returns, so each rendered as a
                            blank fragment — "Trust: " with nothing after it. Trust in
                            particular must come from the canonical projection, never
                            from a camelCase field on a raw row. */}
                        <span className="flex items-center gap-1 text-xs italic text-gray-400">
                          <Eye className="w-3 h-3" />Views shown in full insights
                        </span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="text-xs gap-1" asChild>
                          <Link to={`/marketplace/${vehicle.vin}`}><Eye className="w-3 h-3" /> View</Link>
                        </Button>
                        {!isSold && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1 border-gray-400"
                            disabled={markingId === vehicle.vin}
                            onClick={() => handleMarkSold(vehicle.vin, vehicle.vin)}
                          >
                            {markingId === vehicle.vin ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
                            Mark Sold
                          </Button>
                        )}
                        {!isSold && vehicle.publication_status && (
                          <Button
                            size="sm"
                            variant={vehicle.publication_status === 'published' ? 'outline' : 'default'}
                            className={`text-xs gap-1 ${vehicle.publication_status === 'published' ? '' : 'bg-green-600 hover:bg-green-700'}`}
                            data-testid={`publish-toggle-${vehicle.vin}`}
                            disabled={publishingVin === vehicle.vin}
                            onClick={() => handlePublishToggle(vehicle.vin, vehicle.publication_status === 'published')}
                          >
                            {publishingVin === vehicle.vin
                              ? <><Loader2 className="w-3 h-3 animate-spin" /> Updating...</>
                              : (vehicle.publication_status === 'published' ? 'Unpublish' : 'Publish')
                            }
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}