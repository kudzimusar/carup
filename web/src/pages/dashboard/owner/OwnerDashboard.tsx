import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
  Car,
  Wrench,
  Shield,
  FileText,
  ArrowRight,
  Plus,
  Gauge,
  CheckCircle,
  MessageSquare,
  WifiOff,
  Smartphone,
  Wallet,
  Upload
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle, Notification, Escrow } from '@/types'

const valueData = [
  { month: 'Jan', value: 28000 },
  { month: 'Feb', value: 27500 },
  { month: 'Mar', value: 27200 },
  { month: 'Apr', value: 26800 },
  { month: 'May', value: 26300 },
]

export default function OwnerDashboard() {
  const { runOcrParsing, fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications } = useCarUpApi()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [liveNotifications, setLiveNotifications] = useState<Notification[]>([])

  useEffect(() => {
    let mounted = true
    fetchOwnedVehicles().then(data => { if (mounted) setVehicles(data) })
    fetchNotifications().then(data => { if (mounted) setLiveNotifications(data) })
    return () => { mounted = false }
  }, [fetchOwnedVehicles, fetchNotifications])

  const recentNotifications = liveNotifications.slice(0, 3)

  // Onboarding & settings states
  const [lowBandwidth, setLowBandwidth] = useState(false)
  const [whatsappLinked, setWhatsappLinked] = useState(true)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [documents, setDocuments] = useState([
    { id: 'zimra-form-21', name: 'ZIMRA Customs Cleared Form 21.pdf', type: 'ZIMRA Form 21', date: '2026-05-10', verified: true },
    { id: 'insurance-policy', name: 'NicozDiamond Policy.pdf', type: 'Insurance policy', date: '2026-05-15', verified: true }
  ])

  // Multi-currency balances
  const [wallet, setWallet] = useState({
    usd: 350.00,
    zig: 4800.00,
    escrowUsd: 0,
    escrowLockedCount: 0
  })

  // Fetch SafePay escrows on mount
  useEffect(() => {
    let mounted = true
    const loadEscrows = async () => {
      try {
        const escrows = await fetchSafePayEscrows()
        if (mounted && escrows) {
          const totalUsd = escrows.reduce((sum: number, e: Escrow) => e.currency === 'USD' ? sum + e.amount : sum, 0)
          setWallet(w => ({ ...w, escrowUsd: totalUsd, escrowLockedCount: escrows.length }))
        }
      } catch (err) {
        console.error('Failed to load escrows', err)
      }
    }
    loadEscrows()
    return () => { mounted = false }
  }, [fetchSafePayEscrows])

  // Simulated AI OCR upload handler
  const handleOcrUpload = async () => {
    setOcrLoading(true)
    try {
      const data = await runOcrParsing('ZIMRA Form 21', 'MOCK_BASE64_DOCUMENT_DATA')
      toast.success('Document uploaded and AI OCR parsed successfully.')
      setDocuments(prev => [
        {
          name: `Parsed_${data.make}_${data.model}_Logbook.pdf`,
          type: 'Logbook (CVR Registration)',
          date: new Date().toISOString().split('T')[0],
          verified: true
        },
        ...prev
      ])
    } catch (err) {
      toast.error('Failed to parse document.')
    } finally {
      setOcrLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Owner Dashboard</h1>
          <p className="text-gray-500">Welcome back, Tendai Moyo! Monitor your vehicles, escrows, and insurance logs.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Low Bandwidth mode toggle */}
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border text-xs text-gray-600">
            <WifiOff className={`w-4 h-4 ${lowBandwidth ? 'text-orange-500 animate-pulse' : 'text-gray-400'}`} />
            <span>Low-Bandwidth Mode</span>
            <input 
              type="checkbox" 
              checked={lowBandwidth} 
              onChange={() => {
                setLowBandwidth(!lowBandwidth);
                toast.success(lowBandwidth ? 'High-quality graphics restored.' : 'Low-bandwidth mode enabled. Images compressed.');
              }}
              className="rounded text-orange-500 focus:ring-orange-400 cursor-pointer h-4 w-4"
            />
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/garage"><Car className="w-4 h-4 mr-1" /> My Garage</Link>
          </Button>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" asChild>
            <Link to="/dashboard/ai"><MessageSquare className="w-4 h-4 mr-1" /> Ask Gutu AI</Link>
          </Button>
        </div>
      </div>

      {/* WhatsApp verification status alert */}
      {!whatsappLinked && (
        <Card className="border-0 bg-orange-50 border-l-4 border-orange-500 text-orange-800 p-4">
          <div className="flex items-start gap-3 justify-between">
            <div className="flex gap-2">
              <Smartphone className="w-5 h-5 text-orange-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Verify WhatsApp Communications</p>
                <p className="text-xs text-orange-600">Connect your account with Gutu AI WhatsApp bot (+263 773 345 678) to get instant alerts on ZIMRA clearance, mileage milestones, and escrow releases.</p>
              </div>
            </div>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => {
              setWhatsappLinked(true);
              toast.success('WhatsApp communication verified successfully.');
            }}>Verify Now</Button>
          </div>
        </Card>
      )}

      {/* Multi-currency Wallet Card */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Automotive Wallet (USD)</p>
                <p className="text-2xl font-bold mt-1">${wallet.usd.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-1">Direct EcoCash / ZIPIT settlements</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-50 text-green-500 flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Automotive Wallet (ZiG)</p>
                <p className="text-2xl font-bold mt-1">{wallet.zig.toLocaleString()} ZiG</p>
                <p className="text-[10px] text-gray-400 mt-1">Settled on EcoCash channel</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Locked SafePay Escrows</p>
                <p className="text-2xl font-bold mt-1">${wallet.escrowUsd.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-1">{wallet.escrowLockedCount} active purchase escrow{wallet.escrowLockedCount !== 1 ? 's' : ''}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center">
                <Shield className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Auto-calculated Trust Index</p>
                <p className="text-2xl font-bold mt-1">92.5%</p>
                <p className="text-[10px] text-green-600 font-medium mt-1">Verified Buyer & Seller</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center">
                <CheckCircle className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* My Garage */}
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">My Vehicles</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard/garage" className="gap-1">View All <ArrowRight className="w-4 h-4" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {vehicles.slice(0, 3).map((vehicle) => (
                <Link key={vehicle.vin} to={`/dashboard/garage/${vehicle.vin}`} className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
                  {!lowBandwidth && <img src={vehicle.image_url || 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&q=80'} alt="" className="w-20 h-14 rounded-lg object-cover" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-gray-800">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      <Badge variant="outline" className="text-[10px]">{vehicle.vin}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{vehicle.mileage?.toLocaleString()} km</span>
                      <span>Trust Index: <b>{vehicle.trust_score}%</b></span>
                    </div>
                    <div className="mt-2">
                      <Progress value={vehicle.trust_score} className="h-1" indicatorClassName="bg-orange-500" />
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-orange-500 transition-colors" />
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* AI OCR Digital Document Vault */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Digital Document Vault</CardTitle>
              <Button size="sm" onClick={handleOcrUpload} disabled={ocrLoading} className="bg-orange-500 hover:bg-orange-600 text-white gap-1 text-xs font-semibold">
                <Upload className="w-3.5 h-3.5" />
                {ocrLoading ? 'Scanning Document...' : 'Upload & Parse Logbook'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {documents.map((doc, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100/50 rounded-xl transition-all border border-gray-100 text-xs">
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-orange-500 shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-800">{doc.name}</p>
                      <p className="text-[10px] text-gray-400">{doc.type} • Uploaded: {doc.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-green-100 text-green-700 shadow-none border-none">AI Verified</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {!lowBandwidth && (
            <Card className="border-0 card-shadow bg-white">
              <CardHeader className="pb-3"><CardTitle className="text-lg">Vehicle Value Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={valueData}>
                    <defs>
                      <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} tickFormatter={v => `$${v/1000}k`} />
                    <Tooltip formatter={(v) => `$${v.toLocaleString()}`} />
                    <Area type="monotone" dataKey="value" stroke="#f97316" fill="url(#valueGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Add Vehicle', icon: Plus, href: '/dashboard/garage' },
                { label: 'Service History', icon: Wrench, href: '/dashboard/service-history' },
                { label: 'Insurance Records', icon: Shield, href: '/dashboard/insurance' },
                { label: 'PartSentry', icon: FileText, href: '/dashboard/partsentry' },
                { label: 'Gutu AI Assistant', icon: MessageSquare, href: '/dashboard/ai' },
              ].map((action) => (
                <Link
                  key={action.label}
                  to={action.href}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  <action.icon className="w-4 h-4 text-orange-500" />
                  <span className="flex-1 font-semibold">{action.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Notifications</CardTitle>
                <Badge className="bg-orange-100 text-orange-700 text-[10px]">{recentNotifications.filter(n => !n.read).length} new</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentNotifications.map((n) => (
                <div key={n.id} className={`p-3 rounded-lg ${n.read ? 'bg-gray-50' : 'bg-orange-50 border border-orange-100 text-xs'}`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.type === 'warning' ? 'bg-amber-500' : n.type === 'success' ? 'bg-green-500' : 'bg-blue-500'}`} />
                    <div>
                      <p className="font-semibold text-gray-800">{n.title}</p>
                      <p className="text-gray-500 mt-0.5">{n.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}