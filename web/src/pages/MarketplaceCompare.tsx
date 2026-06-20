import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, ArrowLeft, ShieldCheck } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

interface CompareEntry {
  vin: string
  make: string
  model: string
  year: number
  price: number
  currency: string
  mileage: number
  condition_category: string
  trust_score: number
  marketplace_tags: string[]
  primary_image_url?: string | null
  trust_summary?: { trust_badges: string[]; risk_status: string; partsentry_public_status: string; evidence_status: string }
  pricing_summary?: { estimated_total?: number; currency?: string }
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
    { label: 'Price', render: (e) => `${e.currency} ${(e.price || 0).toLocaleString()}` },
    { label: 'All-in (est.)', render: (e) => e.pricing_summary?.estimated_total ? `${e.pricing_summary.currency} ${e.pricing_summary.estimated_total.toLocaleString()}` : '—' },
    { label: 'Year', render: (e) => e.year || '—' },
    { label: 'Mileage', render: (e) => `${(e.mileage || 0).toLocaleString()} km` },
    { label: 'Condition', render: (e) => (e.condition_category || 'unknown').replace(/_/g, ' ') },
    { label: 'Trust score', render: (e) => e.trust_score ?? '—' },
    { label: 'Trust badges', render: (e) => e.trust_summary?.trust_badges?.length ? <div className="flex flex-wrap gap-1">{e.trust_summary.trust_badges.map((b) => <Badge key={b} variant="outline" className="text-[10px]">{b.replace(/_/g, ' ')}</Badge>)}</div> : '—' },
    { label: 'Evidence', render: (e) => e.trust_summary?.evidence_status?.replace(/_/g, ' ') || '—' },
    { label: 'PartSentry', render: (e) => e.trust_summary?.partsentry_public_status?.replace(/_/g, ' ') || '—' },
    { label: 'Risk', render: (e) => e.trust_summary?.risk_status || '—' },
  ]

  return (
    <div className="min-h-screen bg-gray-50" data-testid="marketplace-compare-page">
      <div className="border-b bg-white">
        <div className="section-padding mx-auto max-w-[1440px] py-6">
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/marketplace"><ArrowLeft className="mr-1 h-4 w-4" /> Back to marketplace</Link>
          </Button>
          <h1 className="text-2xl font-bold">Compare listings</h1>
          <p className="text-sm text-gray-600">Side-by-side trust, pricing and condition — all backend-governed.</p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading comparison…</div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-white p-8 text-center" data-testid="marketplace-compare-empty">
            <p className="text-gray-600">No listings to compare. Pick up to 4 from the marketplace.</p>
            <Button asChild className="mt-4"><Link to="/marketplace">Browse listings</Link></Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
            <table className="w-full text-sm" data-testid="marketplace-compare-table">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-left text-xs font-semibold text-gray-500">Attribute</th>
                  {entries.map((e) => (
                    <th key={e.vin} className="p-3 text-left">
                      <Link to={`/marketplace/${encodeURIComponent(e.vin)}`} className="block">
                        {e.primary_image_url && <img src={e.primary_image_url} alt={`${e.make} ${e.model}`} className="mb-2 h-20 w-full rounded object-cover" />}
                        <span className="font-semibold">{e.year} {e.make} {e.model}</span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b last:border-0">
                    <td className="p-3 font-medium text-gray-600">{r.label}</td>
                    {entries.map((e) => (
                      <td key={e.vin} className="p-3 capitalize text-gray-800">{r.render(e)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 flex items-center gap-1 text-xs text-gray-500">
          <ShieldCheck className="h-3 w-3 text-emerald-500" /> Trust signals are backend-generated and evidence-based.
        </p>
      </div>
    </div>
  )
}
