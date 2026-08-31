import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Eye,
  Heart,
  MessageSquare,
  MousePointerClick,
  RefreshCw,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  coverageNote,
  displayMetric,
  displayTrust,
  envelopeMessage,
  formatAsOf,
  type IntelligenceEnvelope,
  type MetricEnvelope,
} from '@/lib/intelligenceDisplay'
import type { Vehicle } from '@/types'
import { SellerWorkspaceHeader } from '@/components/seller/SellerWorkspaceHeader'

type SellerSeriesPoint = {
  date: string
  active_listings: number
  impressions: number
  views: number
  saves: number
  inquiries: number
  inspections: number
}

type SellerPulse = IntelligenceEnvelope & {
  series?: SellerSeriesPoint[]
}

type ListingInsight = IntelligenceEnvelope & {
  listing_id?: string
}

type Inquiry = {
  id?: string
  listing_id?: string
  inquiry_type?: string
  status?: string
}

type Thread = {
  id?: string
  marketplace_listing_id?: string | null
  unread_count?: number
}

const WINDOWS = [7, 30, 90] as const

function metricCopy(metric?: MetricEnvelope | null) {
  return displayMetric(metric)
}

function SignalCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Eye
}) {
  return (
    <div className="bg-white px-4 py-5" data-testid={`seller-intelligence-kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 break-words text-2xl font-black tracking-[-0.04em] text-slate-950">{value}</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">{detail}</p>
        </div>
        <Icon className="h-5 w-5 text-orange-600" aria-hidden="true" />
      </div>
    </div>
  )
}

function DailySeries({ points }: { points: SellerSeriesPoint[] }) {
  const max = Math.max(1, ...points.flatMap(point => [point.views, point.saves, point.inquiries]))
  if (!points.length) {
    return (
      <div className="border-y border-slate-200 py-10 text-sm text-slate-500" data-testid="seller-intelligence-series-empty">
        No computed daily rollup points are available for this window.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto" data-testid="seller-intelligence-time-series">
      <div className="flex min-w-[620px] items-end gap-2 border-b border-slate-200 pb-2">
        {points.map(point => (
          <div key={point.date} className="min-w-0 flex-1">
            <div className="flex h-36 items-end justify-center gap-1" aria-label={`${point.date}: ${point.views} views, ${point.saves} saves, ${point.inquiries} inquiries`}>
              <div className="w-2 bg-slate-900" style={{ height: `${Math.max(2, Math.round((point.views / max) * 100))}%` }} title={`${point.views} views`} />
              <div className="w-2 bg-orange-500" style={{ height: `${Math.max(2, Math.round((point.saves / max) * 100))}%` }} title={`${point.saves} saves`} />
              <div className="w-2 bg-sky-500" style={{ height: `${Math.max(2, Math.round((point.inquiries / max) * 100))}%` }} title={`${point.inquiries} inquiries`} />
            </div>
            <p className="mt-2 truncate text-center text-[9px] font-semibold text-slate-400">{String(point.date).slice(5)}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] font-semibold text-slate-500">
        <span><span className="mr-1 inline-block h-2 w-2 bg-slate-900" />Views</span>
        <span><span className="mr-1 inline-block h-2 w-2 bg-orange-500" />Saves</span>
        <span><span className="mr-1 inline-block h-2 w-2 bg-sky-500" />Inquiries</span>
      </div>
    </div>
  )
}

function UntrackedPanel({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="border-l-2 border-slate-300 bg-slate-50 p-4" data-testid={`seller-intelligence-untracked-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{title}</p>
      <p className="mt-2 text-sm font-bold text-slate-700">Not tracked in the current Seller projection</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{reason}</p>
    </div>
  )
}

export default function SellerIntelligence() {
  const {
    fetchSellerIntelligence,
    fetchListingIntelligence,
    fetchOwnedVehicles,
    fetchMyMarketplaceInquiries,
    fetchCommunicationThreads,
  } = useCarUpApi()

  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(30)
  const [pulse, setPulse] = useState<SellerPulse | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [listingInsights, setListingInsights] = useState<Record<string, ListingInsight | null>>({})
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null)
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // The read this page is currently showing. Returning to 'loading' when the window or a refresh
  // changes is an ADJUSTMENT to a changed input, not a synchronisation with an external system —
  // so it is DERIVED here rather than written by the effect, where a synchronous setState is a
  // cascading render. `settled` records which read produced the outcome, so a stale 'ready' from
  // the previous window can never be shown as the answer for the new one: the moment `readKey`
  // changes, `state` reads 'loading' again on the very same render.
  const readKey = `${windowDays}:${refreshKey}`
  const [settled, setSettled] = useState<{ key: string; status: 'ready' | 'error' } | null>(null)
  const state: 'loading' | 'ready' | 'error' = settled?.key === readKey ? settled.status : 'loading'

  useEffect(() => {
    let active = true

    Promise.allSettled([
      fetchSellerIntelligence(windowDays),
      fetchOwnedVehicles(),
      fetchMyMarketplaceInquiries(),
      fetchCommunicationThreads(),
    ]).then(async ([pulseResult, vehicleResult, inquiryResult, threadResult]) => {
      if (!active) return

      const nextVehicles = vehicleResult.status === 'fulfilled' && Array.isArray(vehicleResult.value)
        ? vehicleResult.value
        : []
      setVehicles(nextVehicles)
      setPulse(pulseResult.status === 'fulfilled' ? pulseResult.value as SellerPulse : null)
      setInquiries(inquiryResult.status === 'fulfilled' ? (inquiryResult.value.inquiries || []) as Inquiry[] : null)
      setThreads(threadResult.status === 'fulfilled' ? (threadResult.value.threads || []) as Thread[] : null)

      const insightPairs = await Promise.all(nextVehicles.map(async vehicle => {
        try {
          const insight = await fetchListingIntelligence(vehicle.vin, windowDays) as ListingInsight
          return [vehicle.vin, insight] as const
        } catch {
          return [vehicle.vin, null] as const
        }
      }))
      if (!active) return
      setListingInsights(Object.fromEntries(insightPairs))
      setSettled({ key: readKey, status: pulseResult.status === 'fulfilled' ? 'ready' : 'error' })
    })

    return () => { active = false }
  }, [
    fetchCommunicationThreads,
    fetchListingIntelligence,
    fetchMyMarketplaceInquiries,
    fetchOwnedVehicles,
    fetchSellerIntelligence,
    readKey,
    refreshKey,
    windowDays,
  ])

  const readable = pulse?.availability === 'value' && Boolean(pulse.metrics)
  const coverage = coverageNote(pulse)
  const asOf = formatAsOf(pulse?.as_of)
  const metrics = pulse?.metrics || {}
  const conversion = pulse?.conversion || {}
  const series = Array.isArray(pulse?.series) ? pulse.series : []

  const inquiryDistribution = useMemo(() => {
    if (!inquiries) return null
    const counts = new Map<string, number>()
    for (const inquiry of inquiries) {
      const key = String(inquiry.inquiry_type || 'type_not_recorded').replace(/_/g, ' ')
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [inquiries])

  const unreadThreads = threads?.reduce((sum, thread) => sum + Number(thread.unread_count || 0), 0) ?? null
  const marketplaceThreads = threads?.filter(thread => Boolean(thread.marketplace_listing_id)).length ?? null

  return (
    <div className="mx-auto max-w-[1440px] space-y-9" data-testid="seller-intelligence-page">
      <SellerWorkspaceHeader
        eyebrow="Decision cockpit"
        title="Seller Intelligence"
        description="Governed Marketplace activity for your own listings. A measured zero is shown as zero; an unread or unmeasured signal is shown in words instead."
        backHref="/dashboard"
        backLabel="Seller / Owner home"
        statusLabel={readable
          ? [asOf ? `As of ${asOf}` : null, coverage].filter(Boolean).join(' · ') || `${windowDays}-day governed window`
          : state === 'loading' ? 'Loading governed Seller metrics' : envelopeMessage(pulse)}
        primaryAction={(
          <Button
            variant="outline"
            className="min-h-11 rounded-none"
            onClick={() => setRefreshKey(key => key + 1)}
            data-testid="seller-intelligence-refresh"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2" aria-label="Seller Intelligence period">
        {WINDOWS.map(days => (
          <Button
            key={days}
            size="sm"
            variant={windowDays === days ? 'default' : 'outline'}
            className="rounded-none"
            onClick={() => setWindowDays(days)}
            aria-pressed={windowDays === days}
          >
            {days} days
          </Button>
        ))}
      </div>

      {state === 'loading' && (
        <div className="border-y border-slate-200 py-14 text-sm text-slate-500" role="status">
          Reading Seller rollups, listing performance and buyer response state…
        </div>
      )}

      {state === 'error' && (
        <div className="border-y border-amber-200 bg-amber-50 px-5 py-9" role="alert">
          <p className="font-black text-slate-950">Seller Intelligence could not be read.</p>
          <p className="mt-1 text-sm text-slate-600">These figures are unavailable, not zero. Your listings and Seller workflow remain available.</p>
        </div>
      )}

      {state === 'ready' && !readable && (
        <div className="border-y border-slate-200 py-10">
          <p className="text-xl font-black text-slate-950">{envelopeMessage(pulse)}</p>
          <p className="mt-2 text-sm text-slate-500">CarUp will not construct a chart from absent rollups.</p>
        </div>
      )}

      {state === 'ready' && readable && (
        <>
          <section className="grid gap-px border-y border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-6" data-testid="seller-intelligence-kpi-band">
            <SignalCard label="Active listings" value={metricCopy(metrics.active_listings)} detail="Measured active inventory" icon={BarChart3} />
            <SignalCard label="Listing views" value={metricCopy(metrics.views)} detail="Listing opens in this window" icon={Eye} />
            <SignalCard label="Unique visitors" value={metricCopy(metrics.unique_viewers)} detail="Governed distinct-viewer basis" icon={Users} />
            <SignalCard label="Saves" value={metricCopy(metrics.saves)} detail="Authoritative saved-listing actions" icon={Heart} />
            <SignalCard label="Inquiries" value={metricCopy(metrics.inquiries)} detail="Authoritative inquiry rows" icon={MessageSquare} />
            <SignalCard
              label="Response state"
              value={threads === null ? 'Unavailable' : `${marketplaceThreads} threads`}
              detail={threads === null ? 'Communications read failed' : `${unreadThreads} unread messages`}
              icon={MousePointerClick}
            />
          </section>

          <section className="grid gap-8 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="border-y border-slate-200 py-6">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Measured activity over time</p>
                  <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950">Views, saves and inquiries</h2>
                </div>
                {coverage && <p className="text-xs font-semibold text-amber-700">{coverage}</p>}
              </div>
              <DailySeries points={series} />
            </div>

            <div className="border-y border-slate-200 py-6" data-testid="seller-intelligence-funnel">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Conversion funnel</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950">From discovery to contact</h2>
              <div className="mt-6 space-y-3">
                {[
                  ['Impressions', metrics.impressions],
                  ['Views', metrics.views],
                  ['Saves', metrics.saves],
                  ['Inquiries', metrics.inquiries],
                ].map(([label, metric]) => (
                  <div key={String(label)} className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <span className="text-sm font-bold text-slate-600">{String(label)}</span>
                    <span className="font-mono text-lg font-black text-slate-950">{metricCopy(metric as MetricEnvelope)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-px bg-slate-200">
                <div className="bg-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">View → save</p>
                  <p className="mt-2 text-lg font-black">{metricCopy(conversion.view_to_save)}</p>
                </div>
                <div className="bg-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">View → inquiry</p>
                  <p className="mt-2 text-lg font-black">{metricCopy(conversion.view_to_inquiry)}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="border-y border-slate-200 py-7" data-testid="seller-intelligence-listing-comparison">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Listing comparison</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950">Where attention is turning into action</h2>
              </div>
              <Link to="/dashboard/listings" className="inline-flex min-h-11 items-center text-sm font-black text-slate-700 hover:text-orange-600">
                Open My Listings <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">
                    <th className="py-3 pr-4">Vehicle</th>
                    <th className="px-4 py-3">Views</th>
                    <th className="px-4 py-3">Saves</th>
                    <th className="px-4 py-3">Inquiries</th>
                    <th className="px-4 py-3">Listing completeness</th>
                    <th className="px-4 py-3">Canonical Trust</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map(vehicle => {
                    const insight = listingInsights[vehicle.vin]
                    return (
                      <tr key={vehicle.vin} className="border-b border-slate-200">
                        <td className="py-4 pr-4">
                          <p className="font-black text-slate-950">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vin}</p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">{vehicle.vin}</p>
                        </td>
                        <td className="px-4 py-4 font-bold">{insight ? metricCopy(insight.metrics?.views) : 'Unavailable'}</td>
                        <td className="px-4 py-4 font-bold">{insight ? metricCopy(insight.metrics?.saves) : 'Unavailable'}</td>
                        <td className="px-4 py-4 font-bold">{insight ? metricCopy(insight.metrics?.inquiries) : 'Unavailable'}</td>
                        <td className="px-4 py-4">
                          {insight?.completeness
                            ? <span><strong>{insight.completeness.percent}%</strong> <span className="text-xs text-slate-500">listing completeness · not Trust</span></span>
                            : 'Unavailable'}
                        </td>
                        <td className="px-4 py-4 font-bold">
                          {insight?.completeness ? displayTrust(insight.completeness.displayed_separately.trust) : 'Unavailable'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
            <div className="border-l-2 border-orange-500 bg-orange-50 p-4" data-testid="seller-intelligence-inquiry-distribution">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">Inquiry distribution</p>
              {inquiryDistribution === null ? (
                <p className="mt-2 text-sm font-bold text-slate-700">Inquiry authority could not be read.</p>
              ) : inquiryDistribution.length === 0 ? (
                <p className="mt-2 text-sm font-bold text-slate-700">0 inquiries recorded</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {inquiryDistribution.map(([type, count]) => (
                    <div key={type} className="flex justify-between gap-3 text-sm">
                      <span className="capitalize text-slate-600">{type}</span>
                      <strong className="text-slate-950">{count}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <UntrackedPanel title="Discovery sources" reason="The current Seller rollup does not expose a seller-scoped source-channel distribution, so CarUp does not infer one from referral URLs." />
            <UntrackedPanel title="Geographic interest" reason="Country/region observations are not currently aggregated into the Seller read model. Viewer location is therefore not asserted." />
            <UntrackedPanel title="Price-change response" reason="Price mutations are now recorded in the governed activity ledger, but a before/after response model is not yet computed. No uplift is claimed." />
          </section>

          <div className="border-l-2 border-sky-500 bg-sky-50 p-4 text-xs leading-5 text-slate-700">
            <strong>Interpretation boundary:</strong> views are not people; inquiries are not sales; listing completeness is not Trust; and unmeasured signals remain unavailable rather than becoming zero.
          </div>
        </>
      )}
    </div>
  )
}
