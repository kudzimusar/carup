import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ShieldCheck, Wrench, ArrowLeft, Package } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { InquiryModal } from '@/components/marketplace/InquiryModal'
import { captureReferralFromUrl } from '@/lib/marketplaceReferral'
import type { MarketplaceInquiryType } from '@/types'
import { VEHICLE_MAKES, VEHICLE_TAXONOMY_VERSION, modelsForMake } from '@/data/vehicleTaxonomy'
import { isShowroomPagesEnabled } from '@/lib/presentationFlags'
import { DataState, MoneyDisplay } from '@/components/truth'

interface PartCard {
  id: string
  part_name?: string | null
  part_category?: string | null
  condition?: string | null
  price?: number | null
  currency?: string
  price_mode?: string
  compatibility?: string[]
  fitment?: Array<{
    taxonomy_version: string
    make: string
    model: string
    year_from: number | null
    year_to: number | null
    body_style?: string | null
    engine_code?: string | null
    variant?: string | null
  }>
  supplier_label?: string | null
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
  // RX04-B: the showroom view tells a failed read apart from "no providers yet"; the accepted view
  // keeps its previous rendering.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [fitMake, setFitMake] = useState('')
  const [fitModel, setFitModel] = useState('')
  const [fitYear, setFitYear] = useState('')
  const fitModels = useMemo(() => modelsForMake(fitMake).map(item => item.name), [fitMake])
  const fitmentMetadata = useMemo(() => ({
    buyer_intent: 'parts_fitment_quote',
    fitment_taxonomy_version: VEHICLE_TAXONOMY_VERSION,
    ...(fitMake ? { fitment_make: fitMake } : {}),
    ...(fitModel ? { fitment_model: fitModel } : {}),
    ...(fitYear ? { fitment_year: fitYear } : {}),
  }), [fitMake, fitModel, fitYear])

  useEffect(() => {
    captureReferralFromUrl()
    let mounted = true
    const fetcher = kind === 'part' ? fetchMarketplaceParts : fetchMarketplaceServices
    const filters = kind === 'part'
      ? { make: fitMake || undefined, model: fitModel || undefined, year: fitYear || undefined }
      : undefined
    fetcher(filters)
      .then((res) => {
        if (!mounted) return
        setFailed(false)
        if (kind === 'part') setParts((res.listings as PartCard[]) || [])
        else setServices((res.listings as ServiceCard[]) || [])
      })
      .catch(() => { if (mounted) setFailed(true) /* accepted view: governed onboarding state */ })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [kind, fetchMarketplaceParts, fetchMarketplaceServices, fitMake, fitModel, fitYear, attempt])

  const isEmpty = kind === 'part' ? parts.length === 0 : services.length === 0
  const Icon = cfg.icon

  if (isShowroomPagesEnabled()) {
    const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'
    const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em]'
    const FIELD = 'h-12 rounded-xl border-carup-line bg-white text-[15px] text-carup-raw-ink'
    const fitLabel = [fitYear, fitMake, fitModel].filter(Boolean).join(' ')
    const ctaPrimary = 'h-12 w-full rounded-xl bg-carup-raw-ink px-5 text-[15px] font-semibold text-white hover:bg-carup-raw-ink-2'
    const ctaQuiet = 'h-11 w-full rounded-xl border-carup-line text-[14px] font-semibold text-carup-raw-ink'
    const categories = [
      { label: 'Cars', href: '/marketplace', active: false },
      { label: 'Parts', href: '/marketplace/parts', active: kind === 'part' },
      { label: 'Garages & services', href: '/marketplace/services', active: kind === 'service' },
    ]
    return (
      <div className="min-h-screen bg-white text-carup-raw-ink" data-testid={cfg.testid} data-presentation="rx04">
        <header className="section-padding mx-auto max-w-[1440px] pb-2 pt-5 sm:pt-10">
          <Link to="/marketplace" className={`inline-flex min-h-11 items-center gap-2 rounded-full text-[14px] font-semibold text-carup-text-2 hover:text-carup-raw-ink ${FOCUS}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Marketplace
          </Link>
          <p className={`${EYEBROW} mt-3 text-carup-action`}>{kind === 'part' ? 'Parts' : 'Garages & services'}</p>
          <h1 className="mt-2 text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]">
            {kind === 'part' ? 'Parts that fit your car' : 'Garages, mechanics and inspections'}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-6 text-carup-text-2">
            {kind === 'part'
              ? 'Tell us the car and CarUp sources a compatible part. Fitment is the supplier’s claim; a PartSentry “Verified Parts” mark appears only where CarUp’s governance allows it.'
              : 'Ask for a service or a pre-purchase inspection through CarUp. A “Verified” mark appears only on providers CarUp has verified.'}
          </p>
          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Marketplace categories">
            {categories.map(c => (
              <Link
                key={c.href}
                to={c.href}
                aria-current={c.active ? 'page' : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-semibold ${FOCUS} ${c.active ? 'bg-carup-raw-ink text-white' : 'bg-carup-bg-surface text-carup-text hover:text-carup-raw-ink'}`}
                data-testid="marketplace-category-chip"
              >
                {c.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="section-padding mx-auto max-w-[1440px] pb-16 pt-6">
          {kind === 'part' && (
            <section className="rounded-3xl bg-carup-bg-surface p-5 sm:p-7" aria-labelledby="fitment-title" data-testid="parts-fitment-selector">
              <h2 id="fitment-title" className="text-[17px] font-semibold tracking-[-0.01em]">Which car is the part for?</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_9rem_minmax(12rem,auto)] lg:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-carup-text-2">Make</span>
                  <Input list="parts-fitment-makes" value={fitMake} onChange={event => { setFitMake(event.target.value); setFitModel('') }} placeholder="Toyota" className={FIELD} />
                  <datalist id="parts-fitment-makes">{VEHICLE_MAKES.map(make => <option key={make} value={make} />)}</datalist>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-carup-text-2">Model</span>
                  <Input list="parts-fitment-models" value={fitModel} onChange={event => setFitModel(event.target.value)} placeholder="Hilux" className={FIELD} />
                  <datalist id="parts-fitment-models">{fitModels.map(model => <option key={model} value={model} />)}</datalist>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-carup-text-2">Year</span>
                  <Input type="number" inputMode="numeric" value={fitYear} onChange={event => setFitYear(event.target.value)} placeholder="2019" className={FIELD} />
                </label>
                <InquiryModal
                  inquiryTypes={[cfg.inquiryType]}
                  defaultInquiryType={cfg.inquiryType}
                  triggerLabel="Find matching parts"
                  triggerClassName={ctaPrimary}
                  defaultMessage={fitLabel ? `Please source a compatible part for my ${fitLabel}.` : 'Please help me identify and source the correct compatible part.'}
                  intentMetadata={fitmentMetadata}
                />
              </div>
              <p className="mt-3 text-[13px] leading-5 text-carup-text-2">
                Fitment is a supplier compatibility claim. It does not become PartSentry verification or a Vehicle Passport fact because it matches the catalogue.
              </p>
            </section>
          )}

          <div className="mt-8">
            {loading ? (
              <DataState state="loading" subject={kind === 'part' ? 'Parts' : 'Services'} />
            ) : failed ? (
              <DataState state="error" subject={kind === 'part' ? 'Parts' : 'Services'} action={{ label: 'Try again', onClick: () => { setLoading(true); setAttempt(n => n + 1) } }} />
            ) : isEmpty ? (
              <section className="grid items-center gap-6 rounded-3xl border border-carup-line px-6 py-10 sm:px-10 lg:grid-cols-[1fr_auto]" data-testid="marketplace-category-empty">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-carup-action-soft text-carup-action" aria-hidden="true"><Icon className="h-6 w-6" /></span>
                  <div>
                    <h2 className="text-[19px] font-semibold tracking-[-0.015em]">{kind === 'part' ? 'No governed parts listings are live yet' : 'Service providers are onboarding'}</h2>
                    <p className="mt-1.5 max-w-xl text-[15px] leading-6 text-carup-text-2">
                      {kind === 'part'
                        ? 'Parts governed by PartSentry will appear here as suppliers join. Until then, ask for a quote and CarUp sources it for you.'
                        : 'Verified garages and mechanics will appear here. Ask for an inspection or a service and CarUp connects you to a vetted provider.'}
                    </p>
                  </div>
                </div>
                <div className="w-full lg:w-72">
                  <InquiryModal
                    inquiryTypes={[cfg.inquiryType]}
                    defaultInquiryType={cfg.inquiryType}
                    triggerLabel={cfg.inquiryLabel}
                    triggerClassName={ctaPrimary}
                    intentMetadata={kind === 'part' ? fitmentMetadata : undefined}
                    defaultMessage={kind === 'part' && fitLabel ? `Please source parts compatible with my ${fitLabel}.` : ''}
                  />
                </div>
              </section>
            ) : kind === 'part' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="marketplace-parts-grid">
                {parts.map(p => (
                  <article key={p.id} className="flex flex-col rounded-2xl border border-carup-line bg-white p-5" data-testid="marketplace-part-card">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[16px] font-semibold leading-snug">{p.part_name || 'Part'}</h3>
                      {p.partsentry_public_status === 'eligible' && p.verified_parts && (
                        <span className="shrink-0 rounded-full bg-status-success-soft px-2 py-0.5 text-[12px] font-semibold text-status-success" data-testid="marketplace-part-verified-badge">Verified Parts</span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] text-carup-text-2">{[p.part_category, p.condition || 'Condition not recorded'].filter(Boolean).join(' · ')}</p>
                    <div className="mt-3">
                      {p.price_mode === 'quote_required' || p.price == null
                        ? <span className="text-[15px] font-semibold">Quote required</span>
                        : <MoneyDisplay amount={Number(p.price)} currency={p.currency ?? null} size="lg" />}
                    </div>
                    {p.fitment && p.fitment.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-[13px] text-carup-text" data-testid="marketplace-part-fitment">
                        {p.fitment.slice(0, 3).map((fit, index) => (
                          <li key={`${fit.make}-${fit.model}-${fit.year_from}-${fit.year_to}-${index}`}>
                            Fits {fit.make} {fit.model}{fit.year_from || fit.year_to ? ` · ${fit.year_from ?? '…'}–${fit.year_to ?? '…'}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : p.compatibility && p.compatibility.length > 0 ? (
                      <p className="mt-3 text-[13px] text-carup-text-2">Compatibility stated: {p.compatibility.join(', ')}</p>
                    ) : null}
                    {(p.supplier_label || p.location) && (
                      <p className="mt-2 text-[13px] text-carup-text-3">{[p.supplier_label, p.location].filter(Boolean).join(' · ')}</p>
                    )}
                    <div className="mt-auto pt-4">
                      <InquiryModal
                        inquiryTypes={[cfg.inquiryType]}
                        defaultInquiryType={cfg.inquiryType}
                        triggerLabel="Request quote"
                        triggerVariant="outline"
                        triggerClassName={ctaQuiet}
                        intentMetadata={fitmentMetadata}
                        defaultMessage={fitLabel ? `Please confirm whether this part fits my ${fitLabel}.` : 'Please confirm compatibility and quote this part.'}
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="marketplace-services-grid">
                {services.map(s => (
                  <article key={s.id} className="flex flex-col rounded-2xl border border-carup-line bg-white p-5" data-testid="marketplace-service-card">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[16px] font-semibold leading-snug">{s.display_name || 'Provider name not recorded'}</h3>
                      {s.verification_status === 'verified' && (
                        <span className="shrink-0 rounded-full bg-status-success-soft px-2 py-0.5 text-[12px] font-semibold text-status-success">Verified</span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] text-carup-text-2">{(s.service_categories || []).join(', ') || 'Services not recorded'}</p>
                    <p className="mt-2 text-[13px] text-carup-text-3">{[s.location, s.inspection_available ? 'Inspection available' : null].filter(Boolean).join(' · ') || 'Location not recorded'}</p>
                    <div className="mt-auto pt-4">
                      <InquiryModal inquiryTypes={[cfg.inquiryType]} defaultInquiryType={cfg.inquiryType} triggerLabel={cfg.inquiryLabel} triggerVariant="outline" triggerClassName={ctaQuiet} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <p className="mt-8 flex items-center gap-1.5 text-[13px] text-carup-text-2">
            <ShieldCheck className="h-4 w-4 text-status-success" aria-hidden="true" /> Trust and PartSentry claims come from CarUp’s governed records. Never pay outside CarUp.
          </p>
        </main>
      </div>
    )
  }

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
          {kind === 'part' && (
            <div className="mt-5 grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-[1fr_1fr_150px_auto]" data-testid="parts-fitment-selector">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Vehicle make</label>
                <Input list="parts-fitment-makes" value={fitMake} onChange={event => { setFitMake(event.target.value); setFitModel('') }} placeholder="Toyota" />
                <datalist id="parts-fitment-makes">{VEHICLE_MAKES.map(make => <option key={make} value={make} />)}</datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Model</label>
                <Input list="parts-fitment-models" value={fitModel} onChange={event => setFitModel(event.target.value)} placeholder="Hilux" />
                <datalist id="parts-fitment-models">{fitModels.map(model => <option key={model} value={model} />)}</datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Year</label>
                <Input type="number" inputMode="numeric" value={fitYear} onChange={event => setFitYear(event.target.value)} placeholder="2019" />
              </div>
              <div className="flex items-end">
                <InquiryModal
                  inquiryTypes={[cfg.inquiryType]}
                  defaultInquiryType={cfg.inquiryType}
                  triggerLabel="Find matching parts"
                  triggerClassName="w-full"
                  defaultMessage={fitMake || fitModel || fitYear
                    ? `Please source a compatible part for my ${[fitYear, fitMake, fitModel].filter(Boolean).join(' ')}.`
                    : 'Please help me identify and source the correct compatible part.'}
                  intentMetadata={fitmentMetadata}
                />
              </div>
              <p className="text-xs leading-5 text-slate-500 sm:col-span-4">
                Fitment is a seller/supplier compatibility claim. It does not become PartSentry verification or a Vehicle Passport fact merely because it matches the catalogue.
              </p>
            </div>
          )}
          <div className="mt-4">
            <InquiryModal
              inquiryTypes={[cfg.inquiryType]}
              defaultInquiryType={cfg.inquiryType}
              triggerLabel={cfg.inquiryLabel}
              intentMetadata={kind === 'part' ? fitmentMetadata : undefined}
            />
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isEmpty ? (
          <div className="rounded-xl border border-gray-100 bg-white p-10 text-center" data-testid="marketplace-category-empty">
            <Icon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <h3 className="text-lg font-semibold">{kind === 'part' ? 'No governed parts listings are live yet' : 'Service providers are onboarding'}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              {kind === 'part'
                ? 'Verified, PartSentry-governed parts will appear here as suppliers are onboarded. In the meantime, request a quote and our team will source safely.'
                : 'Verified garages and mechanics will appear here. Request an inspection or service and we will connect you to a vetted provider.'}
            </p>
            <div className="mt-4 flex justify-center">
              <InquiryModal
                inquiryTypes={[cfg.inquiryType]}
                defaultInquiryType={cfg.inquiryType}
                triggerLabel={cfg.inquiryLabel}
                triggerVariant="outline"
                intentMetadata={kind === 'part' ? fitmentMetadata : undefined}
                defaultMessage={kind === 'part' && (fitMake || fitModel || fitYear)
                  ? `Please source parts compatible with my ${[fitYear, fitMake, fitModel].filter(Boolean).join(' ')}.`
                  : ''}
              />
            </div>
          </div>
        ) : kind === 'part' ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="marketplace-parts-grid">
            {parts.map((p) => (
              <article key={p.id} className="border border-slate-200 border-t-4 border-t-slate-950 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]" data-testid="marketplace-part-card">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-sm line-clamp-1">{p.part_name || 'Part'}</h3>
                    {/* PartSentry governance: verified badge ONLY when backend public-card eligibility is true */}
                    {p.partsentry_public_status === 'eligible' && p.verified_parts && (
                      <Badge className="rounded-none bg-emerald-600 text-white text-[10px]" data-testid="marketplace-part-verified-badge">Verified Parts</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{p.part_category} · {p.condition || 'unknown'}</p>
                  <p className="mt-2 text-lg font-bold text-orange-600">
                    {p.price_mode === 'quote_required' || p.price == null ? 'Quote required' : `${p.currency || 'USD'} ${Number(p.price).toLocaleString()}`}
                  </p>
                  {p.fitment && p.fitment.length > 0 ? (
                    <div className="mt-2 space-y-1 text-xs text-slate-600" data-testid="marketplace-part-fitment">
                      {p.fitment.slice(0, 3).map((fit, index) => (
                        <p key={`${fit.make}-${fit.model}-${fit.year_from}-${fit.year_to}-${index}`}>
                          Fits {fit.make} {fit.model}
                          {fit.year_from || fit.year_to
                            ? ` · ${fit.year_from ?? '…'}–${fit.year_to ?? '…'}`
                            : ''}
                        </p>
                      ))}
                    </div>
                  ) : p.compatibility && p.compatibility.length > 0 ? (
                    <p className="mt-1 text-xs text-gray-500">Compatibility stated: {p.compatibility.join(', ')}</p>
                  ) : null}
                  {(p.supplier_label || p.location) && (
                    <p className="mt-2 text-xs text-gray-400">{[p.supplier_label, p.location].filter(Boolean).join(' · ')}</p>
                  )}
                  <div className="mt-3">
                    <InquiryModal
                      inquiryTypes={[cfg.inquiryType]}
                      defaultInquiryType={cfg.inquiryType}
                      triggerLabel="Request quote"
                      triggerVariant="outline"
                      triggerClassName="w-full"
                      intentMetadata={fitmentMetadata}
                      defaultMessage={fitMake || fitModel || fitYear
                        ? `Please confirm whether this part fits my ${[fitYear, fitMake, fitModel].filter(Boolean).join(' ')}.`
                        : 'Please confirm compatibility and quote this part.'}
                    />
                  </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="marketplace-services-grid">
            {services.map((s) => (
              <article key={s.id} className="border border-slate-200 border-l-4 border-l-orange-500 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]" data-testid="marketplace-service-card">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-sm">{s.display_name}</h3>
                    {s.verification_status === 'verified' && (
                      <Badge className="rounded-none bg-emerald-600 text-white text-[10px]">Verified</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{(s.service_categories || []).join(', ')}</p>
                  <p className="mt-2 text-xs text-gray-400">{s.location}{s.inspection_available ? ' · Inspection available' : ''}</p>
                  <div className="mt-3">
                    <InquiryModal inquiryTypes={[cfg.inquiryType]} defaultInquiryType={cfg.inquiryType} triggerLabel={cfg.inquiryLabel} triggerVariant="outline" triggerClassName="w-full" />
                  </div>
              </article>
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
