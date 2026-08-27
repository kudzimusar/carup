import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { Loader2, ArrowLeft, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'

interface CompareEntry {
  vin: string
  make: string
  model: string
  year: number | null
  price: number | null
  currency: string | null
  mileage: number | null
  condition_category: string | null
  trust_score: number | null
  trust?: {
    score: number | null
    band: string | null
    evaluation_state: string
    confidence: string | null
  } | null
  marketplace_tags: string[]
  primary_image_url?: string | null
  primary_image_state?: string | null
  trust_summary?: {
    trust_badges: string[]
    risk_status: string
    partsentry_public_status: string
    evidence_status: string
  }
  pricing_summary?: { estimated_total?: number | null; currency?: string | null }
}

function titleCase(value: string | null | undefined) {
  if (!value) return 'Not recorded'
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function money(amount: number | null | undefined, currency: string | null | undefined) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'Price not recorded'
  if (!currency?.trim()) return `${amount.toLocaleString()} · currency not recorded`
  const code = currency.trim().toUpperCase()
  return code === 'USD' ? `$${amount.toLocaleString()}` : `${code} ${amount.toLocaleString()}`
}

function trustLabel(entry: CompareEntry) {
  const trust = entry.trust
  if (!trust || trust.evaluation_state !== 'evaluated' || typeof trust.score !== 'number') return 'Not evaluated'
  return `${titleCase(trust.band)} · ${trust.score}/100`
}

export default function MarketplaceCompare() {
  const [searchParams] = useSearchParams()
  const { compareMarketplaceListings } = useCarUpApi()
  const [entries, setEntries] = useState<CompareEntry[]>([])
  const [loading, setLoading] = useState(true)

  const vins = (searchParams.get('vins') || '').split(',').map((v) => v.trim()).filter(Boolean)

  useEffect(() => {
    let cancelled = false
    if (!vins.length) {
      setLoading(false)
      return
    }
    setLoading(true)
    compareMarketplaceListings(vins)
      .then((res) => { if (!cancelled) setEntries((res.listings as CompareEntry[]) || []) })
      .catch(() => { if (!cancelled) setEntries([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('vins')])

  const rows: { label: string; render: (e: CompareEntry) => React.ReactNode }[] = [
    { label: 'Price', render: (e) => money(e.price, e.currency) },
    {
      label: 'All-in (est.)',
      render: (e) => {
        const amount = e.pricing_summary?.estimated_total
        return typeof amount === 'number' ? money(amount, e.pricing_summary?.currency ?? e.currency) : 'Not available'
      },
    },
    { label: 'Year', render: (e) => e.year ?? 'Not recorded' },
    { label: 'Mileage', render: (e) => typeof e.mileage === 'number' ? `${e.mileage.toLocaleString()} km` : 'Not recorded' },
    { label: 'Condition', render: (e) => titleCase(e.condition_category) },
    { label: 'Canonical Trust', render: (e) => trustLabel(e) },
    { label: 'Confidence', render: (e) => titleCase(e.trust?.confidence) },
    {
      label: 'Trust badges',
      render: (e) => e.trust_summary?.trust_badges?.length
        ? <div className="flex flex-wrap gap-1">{e.trust_summary.trust_badges.map((b) => <Badge key={b} variant="outline" className="text-[10px]">{titleCase(b)}</Badge>)}</div>
        : 'None published',
    },
    { label: 'Evidence', render: (e) => titleCase(e.trust_summary?.evidence_status) },
    { label: 'PartSentry', render: (e) => titleCase(e.trust_summary?.partsentry_public_status) },
    { label: 'Risk', render: (e) => titleCase(e.trust_summary?.risk_status) },
  ]

  return (
    <div className="min-h-screen bg-[#f6f7f9]" data-testid="marketplace-compare-page">
      <div className="border-b border-slate-800 bg-[#0b1220] text-white">
        <div className="section-padding mx-auto max-w-[1440px] py-7">
          <Button asChild variant="ghost" size="sm" className="mb-3 text-slate-300 hover:bg-slate-800 hover:text-white">
            <Link to="/marketplace"><ArrowLeft className="mr-1 h-4 w-4" /> Back to marketplace</Link>
          </Button>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-400">
            <ShieldCheck className="h-4 w-4" /> Evidence-led comparison
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Compare listings</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            Side-by-side price, condition and canonical Trust. Missing data stays missing — CarUp never fills a gap just to make the table look complete.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading comparison…</div>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center" data-testid="marketplace-compare-empty">
            <p className="font-semibold">No public listings to compare.</p>
            <Button asChild className="mt-4"><Link to="/marketplace">Browse marketplace</Link></Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-[760px] w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-52 p-5 text-left text-sm font-semibold text-slate-500">Attribute</th>
                  {entries.map((entry) => {
                    const image = canRenderMarketplacePrimaryImage(entry.primary_image_state, entry.primary_image_url)
                      ? entry.primary_image_url
                      : null
                    return (
                      <th key={entry.vin} className="min-w-[230px] p-5 text-left align-top">
                        <Link to={`/marketplace/${encodeURIComponent(entry.vin)}`} className="group">
                          <div className="aspect-[16/9] overflow-hidden rounded-xl bg-slate-100">
                            <ListingImage src={image} alt={`${entry.year ?? ''} ${entry.make} ${entry.model}`} className="h-full w-full" />
                          </div>
                          <div className="mt-3 flex items-start justify-between gap-2">
                            <div>
                              <p className="text-base font-bold text-slate-950 group-hover:text-orange-700">{entry.year ?? ''} {entry.make} {entry.model}</p>
                              <p className="mt-1 text-sm text-slate-500">{money(entry.price, entry.currency)}</p>
                            </div>
                            {entry.trust?.evaluation_state === 'evaluated' && typeof entry.trust.score === 'number' && entry.trust.score >= 75 && (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Strong canonical Trust" />
                            )}
                          </div>
                        </Link>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-slate-100 last:border-0">
                    <th className="p-5 text-left text-sm font-medium text-slate-500">{row.label}</th>
                    {entries.map((entry) => <td key={entry.vin} className="p-5 text-sm text-slate-800">{row.render(entry)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
