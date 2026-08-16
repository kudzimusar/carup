import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Car,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Gauge,
  Heart,
  MessageSquare,
  PackageSearch,
  Plus,
  Shield,
  Sparkles,
  Store,
  Tag,
  Upload,
  Wallet,
  WifiOff,
  Wrench,
} from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import type { Escrow, MarketplaceListingSummary, Vehicle } from '@/types'

type DashboardThread = {
  id: string
  status?: string
  unread_count?: number
  identity_display_name?: string | null
  latest_message_text?: string | null
  updated_at?: string | null
}

type DashboardNotification = {
  id: string
  read?: boolean
  title?: string
  message?: string
  type?: string
  notification_type?: string
  created_at?: string | null
}

type AttentionItem = {
  title: string
  detail: string
  action: string
  href: string
  icon: typeof Car
}

type NextStep = {
  eyebrow: string
  title: string
  detail: string
  href: string
  action: string
  icon: typeof Car
}

const cardClass = 'border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)]'

function statusLabel(value?: string | null) {
  if (!value) return 'Private vehicle'
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function notificationDot(type?: string) {
  if (type === 'warning') return 'bg-amber-500'
  if (type === 'success') return 'bg-emerald-500'
  if (type === 'error') return 'bg-red-500'
  return 'bg-blue-500'
}

export default function OwnerDashboard() {
  const {
    fetchCommunicationNotifications,
    fetchCommunicationThreads,
    fetchOwnedVehicles,
    fetchSafePayEscrows,
    fetchSavedMarketplaceListings,
  } = useCarUpApi()
  const { user } = useAuth()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [savedCars, setSavedCars] = useState<MarketplaceListingSummary[]>([])
  const [liveNotifications, setLiveNotifications] = useState<DashboardNotification[]>([])
  const [threads, setThreads] = useState<DashboardThread[]>([])
  const [lowBandwidth, setLowBandwidth] = useState(false)
  const [readWarning, setReadWarning] = useState(false)

  // SafePay escrow remains the only authoritative money value rendered on this dashboard.
  // There is still no per-user wallet/ledger endpoint, so wallet balances remain explicitly
  // unavailable rather than inferred or fabricated.
  const [escrow, setEscrow] = useState<{ status: 'loading' | 'ready' | 'error'; usd: number; count: number }>({
    status: 'loading',
    usd: 0,
    count: 0,
  })

  useEffect(() => {
    let mounted = true

    fetchOwnedVehicles()
      .then((data) => { if (mounted) setVehicles(data || []) })
      .catch(() => { if (mounted) setReadWarning(true) })

    // Communications 2.0 owns the canonical notification/read-state contract. Keep the dashboard
    // on that same surface so its count/activity can never drift from the notification center.
    fetchCommunicationNotifications()
      .then((data) => { if (mounted) setLiveNotifications((data?.notifications || []) as DashboardNotification[]) })
      .catch(() => { if (mounted) setReadWarning(true) })

    fetchSavedMarketplaceListings()
      .then((data) => { if (mounted) setSavedCars(data?.listings || []) })
      .catch(() => { if (mounted) setReadWarning(true) })

    fetchCommunicationThreads()
      .then((data) => { if (mounted) setThreads((data?.threads || []) as DashboardThread[]) })
      .catch(() => {
        // Communications may be externally gated in some environments. The dashboard remains
        // usable and truthful; it simply does not invent an open-thread count.
        if (mounted) setReadWarning(true)
      })

    return () => { mounted = false }
  }, [fetchCommunicationNotifications, fetchCommunicationThreads, fetchOwnedVehicles, fetchSavedMarketplaceListings])

  useEffect(() => {
    let mounted = true
    const loadEscrows = async () => {
      try {
        const escrows = await fetchSafePayEscrows()
        if (!mounted) return
        const list = escrows || []
        const totalUsd = list.reduce(
          (sum: number, item: Escrow) => item.currency === 'USD' ? sum + item.amount : sum,
          0,
        )
        setEscrow({ status: 'ready', usd: totalUsd, count: list.length })
      } catch (error) {
        console.error('Failed to load escrows', error)
        if (mounted) setEscrow({ status: 'error', usd: 0, count: 0 })
      }
    }
    loadEscrows()
    return () => { mounted = false }
  }, [fetchSafePayEscrows])

  const activeListings = useMemo(
    () => vehicles.filter((vehicle) => String(vehicle.publication_status || '').toLowerCase() === 'published'),
    [vehicles],
  )

  const openThreads = useMemo(
    () => threads.filter((thread) => !['resolved', 'closed'].includes(String(thread.status || '').toLowerCase())),
    [threads],
  )

  const unreadNotifications = useMemo(
    () => liveNotifications.filter((notification) => !notification.read),
    [liveNotifications],
  )

  const vehicleTrustScores = useMemo(
    () => vehicles
      .map((vehicle) => Number(vehicle.trust_score))
      .filter((score) => Number.isFinite(score) && score >= 0),
    [vehicles],
  )

  const averageVehicleTrust = vehicleTrustScores.length
    ? Math.round(vehicleTrustScores.reduce((sum, score) => sum + score, 0) / vehicleTrustScores.length)
    : null

  const leadVehicle = vehicles[0]
  const leadVehicleImage = leadVehicle?.image_url || leadVehicle?.primary_image_url || null
  const recentNotifications = liveNotifications.slice(0, 4)
  const savedPreview = savedCars.slice(0, 3)

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []

    if (vehicles.length === 0) {
      items.push({
        title: 'Add your first vehicle',
        detail: 'Build your Garage, Passport and ownership history.',
        action: 'Add',
        href: '/dashboard/garage',
        icon: Car,
      })
    }

    if (vehicles.length > 0 && activeListings.length === 0) {
      items.push({
        title: 'Prepare a vehicle for sale',
        detail: 'Turn an owned vehicle into a governed Marketplace listing.',
        action: 'Sell',
        href: '/dashboard/sell-vehicle',
        icon: Tag,
      })
    }

    const passportGap = vehicles.find((vehicle) => !vehicle.passport_verified)
    if (passportGap) {
      items.push({
        title: 'Strengthen a Vehicle Passport',
        detail: 'Review the evidence and trust state for an owned vehicle.',
        action: 'Review',
        href: `/dashboard/garage/${passportGap.vin}`,
        icon: Shield,
      })
    }

    if (unreadNotifications.length > 0) {
      items.push({
        title: 'Review new activity',
        detail: `${unreadNotifications.length} unread account alert${unreadNotifications.length === 1 ? '' : 's'} need your attention.`,
        action: 'Review',
        href: '/dashboard/communications',
        icon: Bell,
      })
    }

    if (openThreads.length > 0) {
      items.push({
        title: 'Continue your conversations',
        detail: `${openThreads.length} open conversation${openThreads.length === 1 ? '' : 's'} in CarUp Communications.`,
        action: 'Open',
        href: '/dashboard/communications',
        icon: MessageSquare,
      })
    }

    if (savedCars.length === 0) {
      items.push({
        title: 'Save a Marketplace vehicle',
        detail: 'Build a shortlist you can compare and revisit.',
        action: 'Browse',
        href: '/marketplace',
        icon: Heart,
      })
    }

    if (items.length === 0) {
      items.push({
        title: 'Your account is in good shape',
        detail: 'Explore Marketplace opportunities or review your Garage.',
        action: 'Explore',
        href: '/marketplace',
        icon: CheckCircle2,
      })
    }

    return items.slice(0, 4)
  }, [activeListings.length, openThreads.length, savedCars.length, unreadNotifications.length, vehicles])

  const nextStep = useMemo<NextStep>(() => {
    if (vehicles.length === 0) {
      return {
        eyebrow: 'Start your CarUp journey',
        title: 'Add your first vehicle and build its trusted digital history.',
        detail: 'Your Garage becomes the control center for Passport, service, insurance and future resale.',
        href: '/dashboard/garage',
        action: 'Add Vehicle',
        icon: Car,
      }
    }

    if (activeListings.length === 0) {
      return {
        eyebrow: 'Next best step',
        title: 'Ready to sell? Turn an owned vehicle into a trusted listing.',
        detail: 'CarUp keeps the vehicle identity and history connected instead of creating a disconnected advert.',
        href: '/dashboard/sell-vehicle',
        action: 'Start Listing',
        icon: Tag,
      }
    }

    if (openThreads.length > 0) {
      return {
        eyebrow: 'Conversation waiting',
        title: 'Continue your active buyer or seller conversation.',
        detail: 'Keep the transaction journey inside the canonical CarUp conversation.',
        href: '/dashboard/communications',
        action: 'Open Messages',
        icon: MessageSquare,
      }
    }

    if (savedCars.length > 0) {
      return {
        eyebrow: 'Shortlist ready',
        title: 'Review the vehicles you saved and decide what to explore next.',
        detail: 'Compare trust signals, price and vehicle history before you contact a seller.',
        href: '/dashboard/saved',
        action: 'Review Saved Cars',
        icon: Heart,
      }
    }

    return {
      eyebrow: 'Discover what is next',
      title: 'Explore trusted vehicles across the CarUp Marketplace.',
      detail: 'Save a vehicle, review its Passport and start a governed conversation when you are ready.',
      href: '/marketplace',
      action: 'Browse Marketplace',
      icon: Store,
    }
  }, [activeListings.length, openThreads.length, savedCars.length, vehicles.length])

  const statCards = [
    {
      label: 'My Vehicles',
      value: vehicles.length,
      helper: 'View garage',
      href: '/dashboard/garage',
      icon: Car,
      tone: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Active Listings',
      value: activeListings.length,
      helper: 'View listings',
      href: '/dashboard/listings',
      icon: Tag,
      tone: 'bg-orange-50 text-orange-600',
    },
    {
      label: 'Saved Cars',
      value: savedCars.length,
      helper: 'View saved',
      href: '/dashboard/saved',
      icon: Heart,
      tone: 'bg-purple-50 text-purple-600',
    },
    {
      label: 'Open Conversations',
      value: openThreads.length,
      helper: 'View messages',
      href: '/dashboard/communications',
      icon: MessageSquare,
      tone: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Vehicle Trust',
      value: averageVehicleTrust === null ? 'Start' : `${averageVehicleTrust}%`,
      helper: averageVehicleTrust === null ? 'Add vehicle' : 'Vehicle average',
      href: '/dashboard/garage',
      icon: Shield,
      tone: 'bg-sky-50 text-sky-600',
    },
  ]

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-8">
      {/* Electric hero */}
      <section className="relative overflow-hidden rounded-[28px] border border-orange-100 bg-white shadow-[0_24px_70px_rgba(249,115,22,0.10)]">
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white to-orange-50" aria-hidden="true" />
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-orange-300/25 blur-3xl" aria-hidden="true" />
        <div className="absolute right-12 top-8 hidden h-32 w-64 -skew-x-12 bg-gradient-to-r from-transparent via-orange-200/30 to-orange-500/10 blur-xl xl:block" aria-hidden="true" />

        <div className="relative grid gap-6 p-6 md:p-8 xl:grid-cols-[1.25fr_0.75fr] xl:items-center">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge className="border-0 bg-orange-100 text-orange-700 hover:bg-orange-100">Car Owner</Badge>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                Your automotive trust control center
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
              Welcome back{user?.name ? `, ${user.name}` : ''}
              <span className="ml-2 text-orange-500">⚡</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 md:text-base">
              Here&apos;s what&apos;s happening with your vehicles and account today. See what you own, what needs attention, and what to do next.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button className="rounded-xl bg-orange-500 px-5 text-white shadow-lg shadow-orange-500/20 hover:bg-orange-600" asChild>
                <Link to="/dashboard/garage"><Plus className="mr-2 h-4 w-4" /> Add Vehicle</Link>
              </Button>
              <Button variant="outline" className="rounded-xl border-slate-200 bg-white/90" asChild>
                <Link to="/marketplace"><Store className="mr-2 h-4 w-4" /> Browse Marketplace</Link>
              </Button>
              <Button variant="outline" className="rounded-xl border-slate-200 bg-white/90" asChild>
                <Link to="/dashboard/ai"><Bot className="mr-2 h-4 w-4" /> Ask Gutu AI</Link>
              </Button>
            </div>
          </div>

          <div className="relative hidden min-h-40 overflow-hidden rounded-3xl xl:block">
            {leadVehicleImage && !lowBandwidth ? (
              <img
                src={leadVehicleImage}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-orange-950">
                <Car className="h-28 w-28 text-orange-400" strokeWidth={1.1} aria-hidden="true" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/55 via-transparent to-orange-500/20" aria-hidden="true" />
            <div className="absolute bottom-4 left-4 rounded-2xl border border-white/20 bg-slate-950/70 px-4 py-3 text-white backdrop-blur">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-300">Live account view</p>
              <p className="mt-1 text-sm font-semibold">
                {vehicles.length === 0
                  ? 'Your Garage is ready for its first vehicle.'
                  : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} connected to your account.`}
              </p>
            </div>
          </div>
        </div>
      </section>

      {readWarning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          Some live dashboard activity could not be loaded. Core navigation remains available; no fallback demo data has been substituted.
        </div>
      )}

      {/* Live quick stats */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Owner dashboard summary">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            to={stat.href}
            className="group rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_12px_35px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_18px_45px_rgba(249,115,22,0.10)] focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${stat.tone}`}>
                <stat.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-black leading-none text-slate-950">{stat.value}</p>
                <p className="mt-1 truncate text-xs font-bold text-slate-700">{stat.label}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 group-hover:text-orange-600">
                  {stat.helper} <ArrowRight className="h-3 w-3" />
                </p>
              </div>
            </div>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* Garage + Saved */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className={cardClass}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg text-slate-950">My Garage</CardTitle>
                  <p className="mt-1 text-xs text-slate-400">Owned vehicles and their trust state</p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/dashboard/garage" className="gap-1 text-xs">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
                </Button>
              </CardHeader>
              <CardContent>
                {leadVehicle ? (
                  <Link
                    to={`/dashboard/garage/${leadVehicle.vin}`}
                    className="group block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 transition hover:border-orange-200 hover:bg-white"
                  >
                    <div className="grid sm:grid-cols-[170px_1fr]">
                      {!lowBandwidth && (
                        <div className="min-h-40 bg-slate-100">
                          {leadVehicleImage ? (
                            <img src={leadVehicleImage} alt="" className="h-full min-h-40 w-full object-cover" />
                          ) : (
                            <div className="flex h-full min-h-40 items-center justify-center text-slate-300">
                              <Car className="h-12 w-12" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <Badge className="mb-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                              {statusLabel(leadVehicle.publication_status || leadVehicle.status)}
                            </Badge>
                            <h3 className="font-bold text-slate-950">
                              {leadVehicle.year} {leadVehicle.make} {leadVehicle.model}
                            </h3>
                            <p className="mt-1 break-all text-[11px] text-slate-400">{leadVehicle.vin}</p>
                          </div>
                          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-orange-500" />
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
                            <Gauge className="h-3 w-3" /> {leadVehicle.mileage?.toLocaleString() || 0} km
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
                            <Shield className="h-3 w-3" /> Vehicle trust {Number.isFinite(Number(leadVehicle.trust_score)) ? `${leadVehicle.trust_score}%` : 'not calculated'}
                          </span>
                        </div>
                        {Number.isFinite(Number(leadVehicle.trust_score)) && (
                          <div className="mt-4">
                            <div className="mb-1 flex justify-between text-[10px] font-semibold text-slate-500">
                              <span>Vehicle Trust</span>
                              <span>{leadVehicle.trust_score}%</span>
                            </div>
                            <Progress value={Number(leadVehicle.trust_score)} className="h-1.5" indicatorClassName="bg-emerald-500" />
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div className="rounded-2xl border border-dashed border-orange-200 bg-gradient-to-br from-orange-50/80 to-white p-6 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
                      <Car className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 font-bold text-slate-900">Your Garage is ready</h3>
                    <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-500">
                      Add a vehicle to connect ownership, Passport evidence, service records and your future resale journey.
                    </p>
                    <Button size="sm" className="mt-4 rounded-xl bg-orange-500 hover:bg-orange-600" asChild>
                      <Link to="/dashboard/garage"><Plus className="mr-1.5 h-4 w-4" /> Add First Vehicle</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={cardClass}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg text-slate-950">Saved Cars</CardTitle>
                  <p className="mt-1 text-xs text-slate-400">Your Marketplace shortlist</p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/dashboard/saved" className="gap-1 text-xs">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
                </Button>
              </CardHeader>
              <CardContent>
                {savedPreview.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {savedPreview.map((vehicle) => (
                      <Link
                        key={vehicle.vin}
                        to={`/marketplace/${vehicle.vin}`}
                        className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-orange-200 hover:shadow-lg"
                      >
                        <div className="relative aspect-[4/3] bg-slate-100">
                          {!lowBandwidth && vehicle.primary_image_url ? (
                            <img src={vehicle.primary_image_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-300">
                              <Car className="h-8 w-8" aria-hidden="true" />
                            </div>
                          )}
                          <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-purple-600 shadow">
                            <Heart className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                          </div>
                        </div>
                        <div className="p-3">
                          <p className="font-black text-slate-950">${vehicle.price?.toLocaleString()}</p>
                          <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-700">
                            {vehicle.year} {vehicle.make} {vehicle.model}
                          </p>
                          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                            <span>{vehicle.location || 'Zimbabwe'}</span>
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <Shield className="h-3 w-3" /> {vehicle.trust_score}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-purple-200 bg-purple-50/40 p-6 text-center">
                    <Heart className="mx-auto h-10 w-10 text-purple-300" aria-hidden="true" />
                    <h3 className="mt-3 font-bold text-slate-900">Build your shortlist</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      Save vehicles from Marketplace so you can compare trust signals and return to them later.
                    </p>
                    <Button size="sm" variant="outline" className="mt-4 rounded-xl border-purple-200 text-purple-700" asChild>
                      <Link to="/marketplace">Explore Marketplace</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Activity + trust/value */}
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <Card className={cardClass}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg text-slate-950">Recent Activity</CardTitle>
                  <p className="mt-1 text-xs text-slate-400">Account alerts and trust events</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{unreadNotifications.length} new</Badge>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/dashboard/communications" className="gap-1 text-xs">Center <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {recentNotifications.length > 0 ? recentNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`rounded-xl border p-3 ${notification.read ? 'border-slate-100 bg-slate-50/70' : 'border-orange-100 bg-orange-50/70'}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notificationDot(notification.notification_type || notification.type)}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800">{notification.title || notification.notification_type || 'CarUp update'}</p>
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">{notification.message || 'Open Communications for details.'}</p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl bg-slate-50 p-6 text-center">
                    <Activity className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" />
                    <p className="mt-3 text-sm font-bold text-slate-800">No recent activity yet</p>
                    <p className="mt-1 text-xs text-slate-500">Vehicle alerts, inquiries and trust updates will appear here.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={cardClass}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-slate-950">Trust &amp; Value Snapshot</CardTitle>
                <p className="mt-1 text-xs text-slate-400">Truthful vehicle-level signals from your current account data</p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-5 md:grid-cols-[160px_1fr]">
                  <div className="flex flex-col items-center justify-center rounded-2xl bg-slate-50 p-4 text-center">
                    <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white shadow-inner ring-8 ring-slate-100">
                      <div>
                        <p data-testid="trust-index-value" className={`font-black ${averageVehicleTrust === null ? 'text-sm text-slate-500' : 'text-3xl text-slate-950'}`}>
                          {averageVehicleTrust === null ? 'Not calculated' : averageVehicleTrust}
                        </p>
                        {averageVehicleTrust !== null && <p className="text-[10px] text-slate-400">/100 vehicle avg.</p>}
                      </div>
                    </div>
                    <p className="mt-3 text-xs font-bold text-slate-700">Vehicle Trust Average</p>
                    <p data-testid="trust-index-label" className="mt-1 text-[10px] text-slate-400">
                      {averageVehicleTrust === null ? 'Verification pending' : `${vehicleTrustScores.length} vehicle score${vehicleTrustScores.length === 1 ? '' : 's'} included`}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-100 bg-white p-3">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Owned vehicles</p>
                        <p className="mt-1 text-xl font-black text-slate-900">{vehicles.length}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white p-3">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Published listings</p>
                        <p className="mt-1 text-xl font-black text-slate-900">{activeListings.length}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-slate-800">Market Value Trend</p>
                          <p data-testid="value-trend-unavailable" className="mt-1 text-[11px] leading-4 text-slate-500">
                            Valuation history is not available for your account yet.
                          </p>
                        </div>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                          <Gauge className="h-4 w-4" aria-hidden="true" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Secondary tools */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Owner tools">
            <Card className={cardClass}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Wallet className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">Wallets &amp; SafePay</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">Wallet balances appear when an authoritative wallet service is available.</p>
                    <div className="mt-3 space-y-1 text-[10px]">
                      <div className="flex justify-between gap-3"><span className="text-slate-400">USD wallet</span><span data-testid="wallet-usd-value" className="font-semibold text-slate-500">Not available</span></div>
                      <div className="flex justify-between gap-3"><span className="text-slate-400">ZiG wallet</span><span data-testid="wallet-zig-value" className="font-semibold text-slate-500">Not available</span></div>
                      <div className="flex justify-between gap-3 border-t border-slate-100 pt-1.5">
                        <span className="text-slate-400">SafePay locked</span>
                        {escrow.status === 'loading' && <span data-testid="escrow-usd-value" className="font-semibold text-slate-500">Loading…</span>}
                        {escrow.status === 'error' && <span data-testid="escrow-usd-value" className="font-semibold text-slate-500">Not available</span>}
                        {escrow.status === 'ready' && <span data-testid="escrow-usd-value" className="font-bold text-slate-900">${escrow.usd.toLocaleString()}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {[
              { label: 'Insurance', detail: 'View insurance records', href: '/dashboard/insurance', icon: Shield, tone: 'bg-blue-50 text-blue-600' },
              { label: 'PartSentry', detail: 'Verify parts & history', href: '/dashboard/partsentry', icon: PackageSearch, tone: 'bg-orange-50 text-orange-600' },
              { label: 'Import Orders', detail: 'Track your import journey', href: '/diaspora/imports', icon: FileText, tone: 'bg-purple-50 text-purple-600' },
            ].map((tool) => (
              <Link key={tool.label} to={tool.href} className="group">
                <Card className={`${cardClass} h-full transition group-hover:-translate-y-0.5 group-hover:border-orange-200`}>
                  <CardContent className="flex h-full items-start gap-3 p-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tool.tone}`}>
                      <tool.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{tool.label}</p>
                      <p className="mt-1 text-[11px] text-slate-500">{tool.detail}</p>
                      <p className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-orange-600">Open <ArrowRight className="h-3 w-3" /></p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </section>

          {/* Evidence Vault truthfulness control remains intact. */}
          <Card className={cardClass}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-lg text-slate-950">Digital Document Vault</CardTitle>
                <p className="mt-1 text-xs text-slate-400">Evidence and document context for your CarUp journey</p>
              </div>
              <Button
                size="sm"
                disabled
                data-testid="ocr-upload-btn"
                title="Document upload is not available from this dashboard yet"
                className="gap-1 text-xs font-semibold"
              >
                <Upload className="h-3.5 w-3.5" /> Upload unavailable
              </Button>
            </CardHeader>
            <CardContent data-testid="document-vault-list">
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5">
                <p data-testid="document-vault-empty" className="text-xs font-semibold text-slate-600">No documents uploaded yet.</p>
                <p data-testid="document-vault-unavailable" className="mt-1 text-[11px] leading-4 text-slate-400">
                  Document upload is not available from this dashboard yet.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action rail */}
        <aside className="space-y-6">
          <Card className={cardClass}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-lg text-slate-950">Needs Your Attention</CardTitle>
                <p className="mt-1 text-xs text-slate-400">Highest-value actions right now</p>
              </div>
              <Badge className="rounded-full bg-orange-100 text-orange-700 hover:bg-orange-100">{attentionItems.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-1">
              {attentionItems.map((item) => (
                <Link
                  key={`${item.title}-${item.href}`}
                  to={item.href}
                  className="group flex items-start gap-3 rounded-xl p-3 transition hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800">{item.title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">{item.detail}</p>
                  </div>
                  <span className="mt-1 text-[10px] font-bold text-orange-600">{item.action}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-0 bg-gradient-to-br from-orange-500 via-orange-500 to-amber-400 text-white shadow-[0_24px_60px_rgba(249,115,22,0.28)]">
            <CardContent className="relative p-6">
              <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full border border-white/20" aria-hidden="true" />
              <div className="absolute -right-2 top-8 h-20 w-20 rotate-12 rounded-3xl bg-white/10 blur-sm" aria-hidden="true" />
              <div className="relative">
                <p className="flex items-center gap-1 text-xs font-black uppercase tracking-[0.16em] text-orange-50">
                  {nextStep.eyebrow} <Sparkles className="h-3.5 w-3.5" />
                </p>
                <h2 className="mt-3 text-xl font-black leading-7">{nextStep.title}</h2>
                <p className="mt-2 text-xs leading-5 text-orange-50/90">{nextStep.detail}</p>
                <Button className="mt-5 rounded-xl bg-white text-orange-600 hover:bg-orange-50" asChild>
                  <Link to={nextStep.href}><nextStep.icon className="mr-2 h-4 w-4" /> {nextStep.action}</Link>
                </Button>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold">
                  <Link to="/marketplace" className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25">Browse Market</Link>
                  <Link to="/dashboard/garage" className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25">My Garage</Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-[0_24px_60px_rgba(15,23,42,0.20)]">
            <CardContent className="relative p-6">
              <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-orange-500/15 blur-2xl" aria-hidden="true" />
              <div className="relative flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-orange-400/30 bg-orange-500/10 text-orange-400">
                  <Bot className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-black">Gutu AI Assistant</h2>
                    <Badge className="border border-purple-400/30 bg-purple-500/20 text-[9px] text-purple-200 hover:bg-purple-500/20">BETA</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-300">
                    Ask about vehicles, pricing, documents, ownership context and what to do next.
                  </p>
                </div>
              </div>
              <Button className="mt-5 w-full rounded-xl bg-orange-500 text-white hover:bg-orange-600" asChild>
                <Link to="/dashboard/ai"><MessageSquare className="mr-2 h-4 w-4" /> Ask Gutu AI</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className={cardClass}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-slate-950">Quick Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <span className="flex items-center gap-2"><WifiOff className={`h-4 w-4 ${lowBandwidth ? 'text-orange-500' : 'text-slate-400'}`} /> Low-Bandwidth Mode</span>
                <input
                  type="checkbox"
                  checked={lowBandwidth}
                  onChange={() => {
                    setLowBandwidth((current) => !current)
                    toast.success(lowBandwidth ? 'High-quality graphics restored.' : 'Low-bandwidth mode enabled. Images compressed.')
                  }}
                  className="h-4 w-4 cursor-pointer rounded text-orange-500 focus:ring-orange-400"
                />
              </label>
              <Link to="/dashboard/service-history" className="flex items-center gap-3 rounded-xl p-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Wrench className="h-4 w-4 text-orange-500" /> Service History <ArrowRight className="ml-auto h-3.5 w-3.5 text-slate-300" />
              </Link>
              <Link to="/dashboard/insurance" className="flex items-center gap-3 rounded-xl p-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Shield className="h-4 w-4 text-orange-500" /> Insurance Records <ArrowRight className="ml-auto h-3.5 w-3.5 text-slate-300" />
              </Link>
              <Link to="/dashboard/partsentry" className="flex items-center gap-3 rounded-xl p-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <PackageSearch className="h-4 w-4 text-orange-500" /> PartSentry <ArrowRight className="ml-auto h-3.5 w-3.5 text-slate-300" />
              </Link>
            </CardContent>
          </Card>

          <Card className={cardClass}>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <CircleDollarSign className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">SafePay status</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {escrow.status === 'ready'
                      ? `${escrow.count} active purchase escrow${escrow.count === 1 ? '' : 's'} on this account.`
                      : escrow.status === 'error'
                        ? 'SafePay status could not be loaded.'
                        : 'Checking your active purchase escrows.'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
