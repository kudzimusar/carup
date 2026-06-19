import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, ShieldCheck, Wrench, ArrowLeft, Package } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { InquiryModal } from '@/components/marketplace/InquiryModal'
import { captureReferralFromUrl } from '@/lib/marketplaceReferral'
import type { MarketplaceInquiryType } from '@/types'

interface PartCard {
  id: string
  part_name?: string | null
  part_category?: string | null
  condition?: string | null
  price?: number | null
  currency?: string
  price_mode?: string
  compatibility?: string[]
  supplier_label?: string
  partsentry_public_status?: string
  verified_parts?: boolean
  location?: string
}
interface ServiceCard {
  id: string
  display_name?: string
  service_categories?: string[]
  location?: string
  verification_status?: string
  inspection_available?: boolean
  verified_reviews_count?: number
}

const CONFIG = {
  part: {
    testid: 'marketplace-parts-page',
    title: 'Parts Marketplace',
    blurb: 'PartSentry-governed parts. Verified-parts and PartSentry claims appear only when backend governance allows.',
    icon: Package,
    inquiryType: 'part_quote_request' as MarketplaceInquiryType,
    inquiryLabel: 'Request a parts quote',
  },
  service: {
    testid: 'marketplace-services-page',
    title: 'Garages & Services',
    blurb: 'Verified garages and mechanics. Request an inspection or service through the governed inquiry flow.',
    icon: Wrench,
    inquiryType: 'garage_service_request' as MarketplaceInquiryType,
    inquiryLabel: 'Request a service / inspection',
  },
}

export default function MarketplaceCategoryPage({ kind }: { kind: 'part' | 'service' }) {
  const { fetchMarketplaceParts, fetchMarketplaceServices } = useCarUpApi()
  const cfg = CONFIG[kind]
  const [parts, setParts] = useState<PartCard[]>([])
  const [services, setServices] = useState<ServiceCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    captureReferralFromUrl()
    let mounted = true
    const fetcher = kind === 'part' ? fetchMarketplaceParts : fetchMarketplaceServices
    fetcher()
      .then((res) => {
        if (!mounted) return
        if (kind === 'part') setParts((res.listings as PartCard[]) || [])
        else setServices((res.listings as ServiceCard[]) || [])
      })
      .catch(() => { /* governed: render onboarding state */ })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [kind, fetchMarketplaceParts, fetchMarketplaceServices])

  const isEmpty = kind === 'part' ? parts.length === 0 : services.length === 0
  const Icon = cfg.icon

  return (
    <div className="min-h-screen bg-gray-50" data-testid={cfg.testid}>
      <div className="border-b bg-white">
        <div className="section-padding mx-auto max-w-[1440px] py-8">
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/marketplace"><ArrowLeft className="mr-1 h-4 w-4" /> Marketplace</Link>
          </Button>
          <div className="flex items-center gap-2">
            <Icon className="h-6 w-6 text-orange-500" />
            <h1 className="text-3xl font-bold">{cfg.title}</h1>
          </div>
          <p className="mt-1 max-w-2xl text-gray-600">{cfg.blurb}</p>
          <div className="mt-4">
            <InquiryModal inquiryTypes={[cfg.inquiryType]} defaultInquiryType={cfg.inquiryType} triggerLabel={cfg.inquiryLabel} />
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isEmpty ? (
          <div className="rounded-xl border border-gray-100 bg-white p-10 text-center" data-testid="marketplace-category-empty">
            <Icon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <h3 className="text-lg font-semibold">{kind === 'part' ? 'Parts listings are onboarding' : 'Service providers are onboarding'}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              {kind === 'part'
                ? 'Verified, PartSentry-governed parts will appear here as suppliers are onboarded. In the meantime, request a quote and our team will source safely.'
                : 'Verified garages and mechanics will appear here. Request an inspection or service and we will connect you to a vetted provider.'}
            </p>
            <div className="mt-4 flex justify-center">
              <InquiryModal inquiryTypes={[cfg.inquiryType]} defaultInquiryType={cfg.inquiryType} triggerLabel={cfg.inquiryLabel} triggerVariant="outline" />
            </div>
          </div>
        ) : kind === 'part' ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="marketplace-parts-grid">
            {parts.map((p) => (
              <Card key={p.id} className="border-0 card-shadow" data-testid="marketplace-part-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-sm line-clamp-1">{p.part_name || 'Part'}</h3>
                    {/* PartSentry governance: verified badge ONLY when backend public-card eligibility is true */}
                    {p.partsentry_public_status === 'eligible' && p.verified_parts && (
                      <Badge className="bg-emerald-600 text-white text-[10px]" data-testid="marketplace-part-verified-badge">Verified Parts</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{p.part_category} · {p.condition || 'unknown'}</p>
                  <p className="mt-2 text-lg font-bold text-orange-600">
                    {p.price_mode === 'quote_required' || p.price == null ? 'Quote required' : `${p.currency || 'USD'} ${Number(p.price).toLocaleString()}`}
                  </p>
                  {p.compatibility && p.compatibility.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">Fits: {p.compatibility.join(', ')}</p>
                  )}
                  <p className="mt-2 text-xs text-gray-400">{p.supplier_label} · {p.location}</p>
                  <div className="mt-3">
                    <InquiryModal inquiryTypes={[cfg.inquiryType]} defaultInquiryType={cfg.inquiryType} triggerLabel="Request quote" triggerVariant="outline" triggerClassName="w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="marketplace-services-grid">
            {services.map((s) => (
              <Card key={s.id} className="border-0 card-shadow" data-testid="marketplace-service-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-sm">{s.display_name}</h3>
                    {s.verification_status === 'verified' && (
                      <Badge className="bg-emerald-600 text-white text-[10px]">Verified</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{(s.service_categories || []).join(', ')}</p>
                  <p className="mt-2 text-xs text-gray-400">{s.location}{s.inspection_available ? ' · Inspection available' : ''}</p>
                  <div className="mt-3">
                    <InquiryModal inquiryTypes={[cfg.inquiryType]} defaultInquiryType={cfg.inquiryType} triggerLabel={cfg.inquiryLabel} triggerVariant="outline" triggerClassName="w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-6 flex items-center gap-1 text-xs text-gray-500">
          <ShieldCheck className="h-3 w-3 text-emerald-500" /> Trust and PartSentry claims are backend-governed. Never pay outside CarUp.
        </p>
      </div>
    </div>
  )
}
