import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Car, CheckCircle, Shield, Gauge, Fuel, Settings2, MapPin, Calendar,
  Phone, MessageSquare, Heart, Share2, ArrowLeft, AlertTriangle,
  FileCheck, Star, Loader2, Lock, CreditCard, ChevronLeft, ChevronRight
} from 'lucide-react'
import { formatPrice } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import type { Vehicle } from '@/types'

function getFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem('carup_favorites') || '[]') } catch { return [] }
}
function getReservations(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem('carup_reservations') || '{}') } catch { return {} }
}

export default function VehicleDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { reserveVehicle, createSafePayEscrow, submitFinancing, fetchVehicle } = useCarUpApi()

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)

  const [currentImageIdx, setCurrentImageIdx] = useState(0)
  const [isFav, setIsFav] = useState(() => getFavorites().includes(id || ''))
  const [isReserved, setIsReserved] = useState(false)
  const [isFinanced, setIsFinanced] = useState(false)

  const [showReserveModal, setShowReserveModal] = useState(false)
  const [reserveLoading, setReserveLoading] = useState(false)

  const [showFinanceModal, setShowFinanceModal] = useState(false)
  const [financeLoading, setFinanceLoading] = useState(false)
  const [loanAmount, setLoanAmount] = useState('')
  const [loanTerm, setLoanTerm] = useState('36')
  const [selectedBank, setSelectedBank] = useState('cbz')

  useEffect(() => {
    if (!id) return
    let mounted = true
    const loadVehicle = async () => {
      try {
        const data = await fetchVehicle(id)
        if (mounted && data) {
          setVehicle({
            ...data,
            id: data.vin,
            images: ['https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?q=80&w=1000'],
            features: ['Bluetooth', 'Backup Camera', 'Air Conditioning'], // Fallback mock until real features added
            sellerName: data.tenant?.name || 'Private Seller',
            sellerPhone: data.tenant?.phone || '+263 77 123 4567',
            sellerAvatar: data.tenant?.logo_url || null,
            sellerType: data.tenant?.name ? 'Dealership' : 'Private Owner',
            location: 'Harare',
            province: 'Harare Province',
            listingDate: data.created_at || new Date().toISOString()
          })
          setLoanAmount((data.price || 0).toString())
          const reservations = getReservations()
          if (reservations[data.vin || '']) setIsReserved(true)
        }
      } catch (err: unknown) {
        console.error(err)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    loadVehicle()
    return () => { mounted = false }
  }, [id, fetchVehicle])

  const toggleFavorite = useCallback(() => {
    if (!vehicle) return
    const current = getFavorites()
    let updated: string[]
    if (current.includes(vehicle.id || '')) {
      updated = current.filter(i => i !== vehicle.id)
      setIsFav(false)
      toast.info('Removed from saved cars')
    } else {
      updated = [...current, vehicle.id || '']
      setIsFav(true)
      toast.success(`${vehicle.make || ''} ${vehicle.model || ''} saved!`)
    }
    localStorage.setItem('carup_favorites', JSON.stringify(updated))
  }, [vehicle])

  const handleShare = useCallback(async () => {
    const url = window.location.href
    if (navigator.share) {
      try { await navigator.share({ title: `${vehicle?.year || ''} ${vehicle?.make || ''} ${vehicle?.model || ''}`, url }) } catch { }
    } else {
      await navigator.clipboard.writeText(url).catch(() => {})
      toast.success('Link copied to clipboard!')
    }
  }, [vehicle])

  const handleReserve = async () => {
    if (!vehicle) return
    setReserveLoading(true)
    try {
      // Assuming vehicle.tenant_id holds the dealer/seller id from Supabase
      const seller = vehicle.tenant_id || vehicle.sellerId || 'unknown_seller'
      await reserveVehicle(vehicle.vin || '', 'u1', 7) // 'u1' is mock, but reserveVehicle may still need backend updates. 
      await createSafePayEscrow(vehicle.vin || '', seller, 500)
      
      const reservations = getReservations()
      reservations[vehicle.vin || ''] = { vehicleId: vehicle.id || '', timestamp: new Date().toISOString() }
      localStorage.setItem('carup_reservations', JSON.stringify(reservations))
      setIsReserved(true)
      setShowReserveModal(false)
      toast.success('Vehicle reserved! SafePay escrow of $500 initiated.', { duration: 5000 })
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Failed to initiate Escrow. Make sure you are logged in.'
      toast.error(errMsg)
    } finally {
      setReserveLoading(false)
    }
  }

  const handleFinance = async () => {
    if (!vehicle) return
    setFinanceLoading(true)
    try {
      await submitFinancing(vehicle.vin || '', 'u1', selectedBank, parseFloat(loanAmount))
      setIsFinanced(true)
      setShowFinanceModal(false)
      toast.success('Financing application submitted!', { duration: 6000 })
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Failed to submit application. Make sure you are logged in.'
      toast.error(errMsg)
    } finally {
      setFinanceLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <Car className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Vehicle Not Found</h1>
          <p className="text-gray-500 mb-6">The vehicle you're looking for doesn't exist or has been removed.</p>
          <Button className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link to="/marketplace">Back to Marketplace</Link>
          </Button>
        </div>
      </div>
    )
  }

  const allImages = vehicle.images && vehicle.images.length > 0 ? vehicle.images : ['https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?q=80&w=1000']
  const trustColor = (vehicle.trustScore || 0) >= 90 ? 'bg-green-500' : (vehicle.trustScore || 0) >= 75 ? 'bg-amber-500' : 'bg-red-500'
  const trustLabel = (vehicle.trustScore || 0) >= 90 ? 'Excellent' : (vehicle.trustScore || 0) >= 75 ? 'Good' : 'Fair'
  const waLink = `https://wa.me/${(vehicle.sellerPhone || '').replace(/[^0-9]/g, '')}?text=Hi%2C%20I%20am%20interested%20in%20your%20${vehicle.year || ''}%20${vehicle.make || ''}%20${vehicle.model || ''}%20listed%20on%20CarUp.`

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link to="/" className="hover:text-orange-500">Home</Link>
            <span>/</span>
            <Link to="/marketplace" className="hover:text-orange-500">Marketplace</Link>
            <span>/</span>
            <span className="text-gray-900">{vehicle.make} {vehicle.model}</span>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        <Button variant="ghost" size="sm" className="mb-4 gap-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Image Gallery */}
            <div className="relative rounded-xl overflow-hidden bg-white card-shadow">
              <img
                src={allImages[currentImageIdx]}
                alt={`${vehicle.make} ${vehicle.model}`}
                className="w-full aspect-[16/9] object-cover"
              />
              {allImages.length > 1 && (
                <>
                  <button
                    onClick={() => setCurrentImageIdx(i => (i - 1 + allImages.length) % allImages.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setCurrentImageIdx(i => (i + 1) % allImages.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                    {currentImageIdx + 1} / {allImages.length}
                  </div>
                </>
              )}
              <div className="absolute top-4 left-4 flex gap-2">
                {vehicle.isVerified && <Badge className="bg-green-500 text-white"><CheckCircle className="w-3 h-3 mr-1" /> CarUp Verified</Badge>}
                {vehicle.isFeatured && <Badge className="bg-orange-500 text-white">Featured</Badge>}
                {isReserved && <Badge className="bg-amber-500 text-white">Reserved</Badge>}
              </div>
              <div className="absolute top-4 right-4 flex gap-2">
                <button onClick={toggleFavorite} className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Heart className={`w-5 h-5 ${isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
                </button>
                <button onClick={handleShare} className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Share2 className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            {/* Thumbnails */}
            {allImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allImages.map((img: string, i: number) => (
                  <button key={i} onClick={() => setCurrentImageIdx(i)}
                    className={`flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-colors ${i === currentImageIdx ? 'border-orange-500' : 'border-transparent'}`}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Info Card */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="text-2xl font-bold">{vehicle.year || ''} {vehicle.make || ''} {vehicle.model || ''}</h1>
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                      <MapPin className="w-4 h-4" />{vehicle.location || ''}, {vehicle.province || ''}
                      <span className="mx-1">•</span>
                      <Calendar className="w-4 h-4" />Listed {vehicle.listingDate ? new Date(vehicle.listingDate).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                  <div className={`${trustColor} text-white px-4 py-2 rounded-xl text-center`}>
                    <p className="text-2xl font-bold">{vehicle.trustScore}</p>
                    <p className="text-xs">{trustLabel}</p>
                  </div>
                </div>
                <p className="text-gray-700 mb-6 leading-relaxed">{vehicle.description}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Mileage', value: `${(vehicle.mileage || 0).toLocaleString()} km`, icon: Gauge },
                    { label: 'Transmission', value: vehicle.transmission || 'Auto', icon: Settings2 },
                    { label: 'Fuel Type', value: vehicle.fuelType || 'Petrol', icon: Fuel },
                    { label: 'Condition', value: vehicle.condition || 'Used', icon: FileCheck },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <item.icon className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className="font-semibold text-sm">{item.value}</p>
                    </div>
                  ))}
                </div>
                <Separator className="mb-6" />
                <h3 className="font-semibold mb-3">Features</h3>
                <div className="flex flex-wrap gap-2">
                  {(vehicle.features || []).map((f: string) => <Badge key={f} variant="secondary" className="bg-gray-100 text-gray-700 font-normal">{f}</Badge>)}
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <Tabs defaultValue="history">
                  <TabsList className="w-full">
                    <TabsTrigger value="history" className="flex-1">Vehicle History</TabsTrigger>
                    <TabsTrigger value="verification" className="flex-1">Verification</TabsTrigger>
                    <TabsTrigger value="market" className="flex-1">Market Analysis</TabsTrigger>
                  </TabsList>
                  <TabsContent value="history" className="mt-4 space-y-3">
                    {[
                      { icon: CheckCircle, cls: 'bg-green-50', icls: 'text-green-600', title: 'No accident history found', sub: 'Verified through CarUp registry' },
                      { icon: CheckCircle, cls: 'bg-green-50', icls: 'text-green-600', title: 'Service history available', sub: vehicle.condition === 'Certified Pre-Owned' ? 'Full dealer service records' : 'Partial service records available' },
                      { icon: AlertTriangle, cls: 'bg-amber-50', icls: 'text-amber-600', title: '1 previous owner', sub: 'Vehicle purchased new from authorized dealer' },
                    ].map((item, i) => (
                      <div key={i} className={`flex items-center gap-3 p-3 ${item.cls} rounded-lg`}>
                        <item.icon className={`w-5 h-5 ${item.icls}`} />
                        <div><p className="font-medium text-sm">{item.title}</p><p className="text-xs text-gray-500">{item.sub}</p></div>
                      </div>
                    ))}
                  </TabsContent>
                  <TabsContent value="verification" className="mt-4 space-y-3">
                    {['VIN Verification', 'Logbook Check', 'Police Clearance', 'Insurance History', 'Roadworthy Certificate'].map(label => (
                      <div key={label} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                        <Shield className="w-5 h-5 text-green-600" />
                        <div className="flex-1"><p className="font-medium text-sm">{label}</p></div>
                        <Badge className="bg-green-500 text-white text-[10px]">Verified</Badge>
                      </div>
                    ))}
                  </TabsContent>
                  <TabsContent value="market" className="mt-4">
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Market Price</p>
                        <p className="text-xl font-bold">{formatPrice(vehicle.price || 0, vehicle.currency || 'USD')}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Price vs Market</p>
                        <p className="text-xl font-bold text-green-600">-3.2%</p>
                        <p className="text-xs text-gray-500">Below average</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Depreciation</p>
                        <p className="text-xl font-bold text-amber-600">{vehicle.year && vehicle.year >= 2022 ? 'Low' : 'Moderate'}</p>
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                      <h4 className="font-medium text-sm mb-2">AI Price Insight</h4>
                      <p className="text-sm text-gray-600">Based on {vehicle.make} {vehicle.model} sales in {vehicle.location} over the last 6 months, this vehicle is priced competitively. Similar vehicles have sold between ${( (vehicle.price || 0) * 0.9).toLocaleString()} and ${( (vehicle.price || 0) * 1.1).toLocaleString()}.</p>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="border-0 card-shadow bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white sticky top-6">
              <CardContent className="p-6">
                <p className="text-sm text-gray-300 mb-1">Price</p>
                <p className="text-3xl font-bold">{formatPrice(vehicle.price || 0, vehicle.currency || 'USD')}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  <span className="text-sm text-gray-300">Fair market price</span>
                </div>

                <div className="flex gap-2 mt-6">
                  <a href={`tel:${vehicle.sellerPhone}`} onClick={() => toast.info(`Calling ${vehicle.sellerName}...`)} className="flex-1">
                    <Button className="w-full bg-orange-500 hover:bg-orange-600 gap-1"><Phone className="w-4 h-4" /> Call</Button>
                  </a>
                  <a href={waLink} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button variant="outline" className="w-full border-white/30 text-white hover:bg-white/10 gap-1"><MessageSquare className="w-4 h-4" /> WhatsApp</Button>
                  </a>
                </div>

                <Separator className="my-4 border-white/20" />

                {isReserved ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-green-600/20 border border-green-500/40 rounded-lg py-3 text-green-400 font-semibold text-sm">
                    <CheckCircle className="w-4 h-4" /> Vehicle Reserved — SafePay Active
                  </div>
                ) : (
                  <Button className="w-full bg-white text-gray-900 hover:bg-gray-100 font-semibold gap-2" onClick={() => setShowReserveModal(true)}>
                    <Lock className="w-4 h-4" /> Reserve Vehicle
                  </Button>
                )}

                {isFinanced ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-lg py-3 text-blue-400 font-semibold text-sm mt-3">
                    <CheckCircle className="w-4 h-4" /> Financing Applied ✓
                  </div>
                ) : (
                  <Button variant="outline" className="w-full mt-3 border-white/20 text-white hover:bg-white/10 gap-2" onClick={() => setShowFinanceModal(true)}>
                    <CreditCard className="w-4 h-4" /> Apply for Financing
                  </Button>
                )}

                <p className="text-xs text-gray-400 text-center mt-3">🔒 Protected by CarUp SafePay Escrow</p>
              </CardContent>
            </Card>

            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Seller Information</h3>
                <div className="flex items-center gap-3 mb-4">
                  {vehicle.sellerAvatar && <img src={vehicle.sellerAvatar} alt="" className="w-12 h-12 rounded-full object-cover" />}
                  <div>
                    <p className="font-medium">{vehicle.sellerName}</p>
                    <Badge variant="outline" className="text-[10px] mt-0.5">{vehicle.sellerType}</Badge>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <a href={`tel:${vehicle.sellerPhone}`} className="hover:text-orange-500">{vehicle.sellerPhone}</a>
                  </div>
                </div>
                <Button variant="outline" className="w-full mt-4" asChild>
                  <Link to="/dealers">View All Listings</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Vehicle Identity</h3>
                <div className="space-y-3 text-sm">
                  {[['VIN', vehicle.vin || ''], ['Engine No.', vehicle.engineNumber || ''], ['Category', vehicle.category || ''], ['Color', vehicle.color || '']].map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-mono text-xs">{value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Trust Score Breakdown</h3>
                <div className="space-y-3">
                  {[['Documentation', 95], ['Service History', (vehicle.trustScore || 0) >= 90 ? 90 : 75], ['Ownership Clarity', 92], ['Price Fairness', 88], ['Seller Reputation', (vehicle.trustScore || 0) >= 90 ? 95 : 80]].map(([label, score]) => (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{label}</span>
                        <span className="font-medium">{score}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${Number(score) >= 90 ? 'bg-green-500' : Number(score) >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${score}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Reserve Modal */}
      <Dialog open={showReserveModal} onOpenChange={setShowReserveModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-orange-500" /> Reserve this Vehicle</DialogTitle>
            <DialogDescription>Secure your interest with a CarUp SafePay reservation</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-semibold">{vehicle.year || ''} {vehicle.make || ''} {vehicle.model || ''}</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">{formatPrice(vehicle.price || 0, vehicle.currency || 'USD')}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-1">
              <p className="font-semibold">What happens next:</p>
              <p>✓ Vehicle held exclusively for you for 7 days</p>
              <p>✓ Refundable deposit of <strong>$500</strong> held in SafePay escrow</p>
              <p>✓ Seller notified immediately via WhatsApp</p>
              <p>✓ Funds released only on successful transfer</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowReserveModal(false)} disabled={reserveLoading}>Cancel</Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600" onClick={handleReserve} disabled={reserveLoading}>
                {reserveLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</> : 'Confirm Reservation'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Finance Modal */}
      <Dialog open={showFinanceModal} onOpenChange={setShowFinanceModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-blue-500" /> Apply for Financing</DialogTitle>
            <DialogDescription>Get pre-approved through CarUp's banking partners</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-500">Vehicle</p>
              <p className="font-semibold">{vehicle.year || ''} {vehicle.make || ''} {vehicle.model || ''} — {formatPrice(vehicle.price || 0, vehicle.currency || 'USD')}</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Loan Amount (USD)</label>
              <Input type="number" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} min={1000} max={vehicle.price || 0} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Loan Term</label>
              <Select value={loanTerm} onValueChange={setLoanTerm}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['12', '24', '36', '48', '60'].map(m => <SelectItem key={m} value={m}>{m} months</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Preferred Bank</label>
              <Select value={selectedBank} onValueChange={setSelectedBank}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cbz">CBZ Bank</SelectItem>
                  <SelectItem value="stanbic">Stanbic Zimbabwe</SelectItem>
                  <SelectItem value="cabs">CABS Bank</SelectItem>
                  <SelectItem value="fbc">FBC Bank</SelectItem>
                  <SelectItem value="zb">ZB Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowFinanceModal(false)} disabled={financeLoading}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={handleFinance} disabled={financeLoading || !loanAmount}>
                {financeLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Submit Application'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}