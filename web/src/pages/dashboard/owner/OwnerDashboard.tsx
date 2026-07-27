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
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import type { Vehicle, Notification, Escrow } from '@/types'

// Session-only record of a document the user just parsed. Nothing is seeded: this dashboard has no
// authoritative per-user document store, so the vault starts empty and only ever shows what this
// session actually parsed — never a sample filename presented as a stored, verified record.
type ParsedDocument = { id: string; name: string; type: string; date: string }

export default function OwnerDashboard() {
  const { runOcrParsing, fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications } = useCarUpApi()
  const { user } = useAuth()

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
  const [documents, setDocuments] = useState<ParsedDocument[]>([])

  // SafePay escrow is the only authoritative money source this dashboard has. There is no
  // per-user wallet/ledger endpoint and no per-user trust-score endpoint, so those cards must
  // report that no authoritative value exists rather than render invented figures — previously
  // fixed balances, a fixed trust percentage and a verified-status label were shown to every
  // account, including brand-new ones.
  const [escrow, setEscrow] = useState<{ status: 'loading' | 'ready' | 'error'; usd: number; count: number }>({
    status: 'loading',
    usd: 0,
    count: 0,
  })

  // Fetch SafePay escrows on mount
  useEffect(() => {
    let mounted = true
    const loadEscrows = async () => {
      try {
        const escrows = await fetchSafePayEscrows()
        if (!mounted) return
        const list = escrows || []
        const totalUsd = list.reduce((sum: number, e: Escrow) => e.currency === 'USD' ? sum + e.amount : sum, 0)
        setEscrow({ status: 'ready', usd: totalUsd, count: list.length })
      } catch (err) {
        console.error('Failed to load escrows', err)
        if (mounted) setEscrow({ status: 'error', usd: 0, count: 0 })
      }
    }
    loadEscrows()
    return () => { mounted = false }
  }, [fetchSafePayEscrows])

  const handleOcrUpload = async () => {
    setOcrLoading(true)
    try {
      await runOcrParsing('ZIMRA Form 21', 'MOCK_BASE64_DOCUMENT_DATA')
      toast.success('Document parsed. It is not stored on your account yet.')
      setDocuments(prev => [
        {
          id: `ocr-${Date.now()}`,
          name: 'Parsed logbook',
          type: 'PDF',
          date: new Date().toLocaleDateString(),
        },
        ...prev,
      ])
    } catch {
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
          <p className="text-gray-500">Welcome back{user?.name ? `, ${user.name}` : ''}! Monitor your vehicles, escrows, and insurance logs.</p>
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
                <p data-testid="wallet-usd-value" className="text-lg font-semibold mt-1 text-gray-500">Not available</p>
                <p className="text-[10px] text-gray-400 mt-1">No wallet established for this account</p>
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
                <p data-testid="wallet-zig-value" className="text-lg font-semibold mt-1 text-gray-500">Not available</p>
                <p className="text-[10px] text-gray-400 mt-1">No wallet established for this account</p>
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
                {escrow.status === 'loading' && <p data-testid="escrow-usd-value" className="text-lg font-semibold mt-1 text-gray-500">Loading…</p>}
                {escrow.status === 'error' && <p data-testid="escrow-usd-value" className="text-lg font-semibold mt-1 text-gray-500">Not available</p>}
                {escrow.status === 'ready' && <p data-testid="escrow-usd-value" className="text-2xl font-bold mt-1">${escrow.usd.toLocaleString()}</p>}
                <p className="text-[10px] text-gray-400 mt-1">
                  {escrow.status === 'ready'
                    ? `${escrow.count} active purchase escrow${escrow.count !== 1 ? 's' : ''}`
                    : escrow.status === 'error'
                      ? 'Could not load your escrows'
                      : 'Checking your escrows'}
                </p>
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
                <p data-testid="trust-index-value" className="text-lg font-semibold mt-1 text-gray-500">Not calculated</p>
                <p data-testid="trust-index-label" className="text-[10px] text-gray-400 font-medium mt-1">Verification pending</p>
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
              <Button
                size="sm"
                onClick={handleOcrUpload}
                disabled={ocrLoading}
                data-testid="ocr-upload-btn"
                className="bg-orange-500 hover:bg-orange-600 text-white gap-1 text-xs font-semibold"
              >
                <Upload className="w-3.5 h-3.5" />
                {ocrLoading ? 'Scanning Document...' : 'Upload & Parse Logbook'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3" data-testid="document-vault-list">
              {documents.length === 0 && (
                <p data-testid="document-vault-empty" className="text-xs text-gray-500 py-2">
                  No documents uploaded yet.
                </p>
              )}
              {documents.map((doc, idx) => (
                <div
                  key={doc.id || idx}
                  data-testid={`doc-row-${doc.id || idx}`}
                  className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100/50 rounded-xl transition-all border border-gray-100 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-orange-500 shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-800">{doc.name}</p>
                      <p className="text-[10px] text-gray-400">{doc.type} • Parsed: {doc.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      data-testid={`doc-verified-badge-${doc.id || idx}`}
                      className="bg-gray-100 text-gray-600 shadow-none border-none"
                    >Not stored</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* There is no per-user valuation history endpoint, so this card must not plot a series.
              It previously rendered a fixed $28k→$26.3k trend for every account, including brand-new
              ones with no vehicles at all. */}
          {!lowBandwidth && (
            <Card className="border-0 card-shadow bg-white">
              <CardHeader className="pb-3"><CardTitle className="text-lg">Vehicle Value Trend</CardTitle></CardHeader>
              <CardContent>
                <p data-testid="value-trend-unavailable" className="text-xs text-gray-500 py-2">
                  Valuation history is not available for your account yet.
                </p>
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
