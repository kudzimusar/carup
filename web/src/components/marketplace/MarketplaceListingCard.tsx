import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'
import {
  CheckCircle2,
  Fuel,
  Gauge,
  GitCompare,
  Heart,
  MapPin,
  Share2,
  ShieldCheck,
  Settings2,
} from 'lucide-react'

export type MarketplaceTrustEvaluationState = 'evaluated' | 'stale' | 'not_evaluated' | 'unavailable'

export interface MarketplaceCardTrust {
  evaluation_state?: MarketplaceTrustEvaluationState | string | null
  score?: number | null
  band?: string | null
  confidence?: string | null
  calculation_version?: string | null
  known_limitations?: unknown[] | null
}

export interface MarketplaceListingCardModel {
  vin: string
  name: string
  price: number | null
  currency: string | null
  primaryImage: string | null
  primaryImageState?: string | null
  mileage: number | null
  transmission: string | null
  fuel: string | null
  sellerLabel: string
  locationLabel: string
  plateStatus: string
  plateVerified: boolean
  reserved: boolean
  partSentryChecked: boolean
  labels: string[]
  trust?: MarketplaceCardTrust | null
  carupGold?: boolean
  syntheticDemo?: boolean
}

interface MarketplaceListingCardProps {
  vehicle: MarketplaceListingCardModel
  href: string
  isFavorite: boolean
  isCompared: boolean
  onFavorite: (event: React.MouseEvent<HTMLButtonElement>) => void
  onCompare: (event: React.MouseEvent<HTMLButtonElement>) => void
  onShare: (event: React.MouseEvent<HTMLButtonElement>) => void
}

function titleCase(value: string | null | undefined) {
  if (!value) return null
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatMarketplacePrice(price: number | null, currency: string | null) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'Price not recorded'
  if (!currency) return `${price.toLocaleString()} · currency not recorded`
  if (currency.toUpperCase() === 'USD') return `$${price.toLocaleString()}`
  return `${currency.toUpperCase()} ${price.toLocaleString()}`
}

function TrustPreview({ trust }: { trust?: MarketplaceCardTrust | null }) {
  const state = trust?.evaluation_state || null
  const score = trust?.score
  const hasCanonicalScore = state === 'evaluated' && typeof score === 'number' && Number.isFinite(score)

  if (hasCanonicalScore) {
    return (
      <div
        className="relative overflow-hidden rounded-2xl border border-orange-200/80 bg-[linear-gradient(135deg,#fff7ed,#fffaf5)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
        data-testid="marketplace-card-trust"
      >
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-800">
              <ShieldCheck className="h-3.5 w-3.5" /> Canonical Trust
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-950">{titleCase(trust?.band) || 'Evaluated'}</span>
              <span className="text-xs text-slate-500">{score}/100</span>
            </div>
          </div>
          {trust?.confidence && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Confidence</div>
              <div className="text-xs font-medium text-slate-700">{titleCase(trust.confidence)}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const copy = state === 'not_evaluated'
    ? 'Not evaluated yet'
    : state === 'stale'
      ? 'Evaluation update pending'
      : state === 'unavailable'
        ? 'Trust temporarily unavailable'
        : 'Trust details on Vehicle Passport'

  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
      data-testid="marketplace-card-trust"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5" /> CarUp Trust
      </div>
      <p className="mt-1 text-sm font-medium text-slate-800">{copy}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-slate-500">No legacy score is substituted.</p>
    </div>
  )
}

export function MarketplaceListingCard({
  vehicle,
  href,
  isFavorite,
  isCompared,
  onFavorite,
  onCompare,
  onShare,
}: MarketplaceListingCardProps) {
  const renderablePrimaryImage = canRenderMarketplacePrimaryImage(vehicle.primaryImageState, vehicle.primaryImage)
    ? vehicle.primaryImage
    : null

  return (
    <article
      className="group flex h-full flex-col overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-[0_14px_38px_rgba(15,23,42,0.07)] transition duration-300 hover:-translate-y-1 hover:border-orange-200 hover:shadow-[0_26px_60px_rgba(15,23,42,0.14)]"
      data-testid="marketplace-vehicle-card"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-[linear-gradient(135deg,#eef2f7,#e2e8f0)]">
        <Link
          to={href}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-inset"
          aria-label={`View ${vehicle.name}`}
          data-testid="marketplace-view-passport"
        >
          <ListingImage
            src={renderablePrimaryImage}
            alt={vehicle.name}
            className="h-full w-full"
            imgClassName="transition-transform duration-500 group-hover:scale-[1.025]"
          />
        </Link>

        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
          {vehicle.carupGold && (
            <Badge className="border border-amber-200/80 bg-[linear-gradient(135deg,#f59e0b,#facc15)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-950 shadow-[0_8px_20px_rgba(245,158,11,0.28)]" data-testid="carup-gold-badge">
              ★ CarUp Gold
            </Badge>
          )}
          {vehicle.syntheticDemo && (
            <Badge className="border border-sky-200 bg-sky-50/95 px-2 py-1 text-[10px] font-semibold text-sky-800 shadow-sm" data-testid="synthetic-demo-media-badge">
              Demo media
            </Badge>
          )}
          {vehicle.plateVerified && (
            <Badge className="border-0 bg-emerald-700 text-[10px] text-white shadow-sm" data-testid="marketplace-plate-confirmed-badge">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Plate confirmed
            </Badge>
          )}
          {vehicle.reserved && (
            <Badge className="border-0 bg-amber-500 text-[10px] text-white shadow-sm">Reserved</Badge>
          )}
          {vehicle.partSentryChecked && (
            <Badge className="border-0 bg-slate-950 text-[10px] text-white shadow-sm" data-testid="marketplace-partsentry-badge">
              PartSentry checked
            </Badge>
          )}
        </div>

        <div className="absolute right-3 top-3 flex translate-y-9 items-center gap-1.5 sm:translate-y-0">
          <button
            type="button"
            aria-label={isCompared ? 'Remove from compare' : 'Add to compare'}
            aria-pressed={isCompared}
            onClick={onCompare}
            data-testid="marketplace-compare-toggle"
            className={`flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
              isCompared
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-white/80 bg-white/95 text-slate-700 hover:bg-white'
            }`}
          >
            <GitCompare className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Share listing"
            onClick={onShare}
            data-testid="marketplace-share-button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <Share2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={isFavorite ? 'Remove saved listing' : 'Save listing'}
            aria-pressed={isFavorite}
            onClick={onFavorite}
            data-testid="marketplace-save-toggle"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <Heart className={`h-4 w-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col p-5">
        <Link
          to={href}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          aria-label={`Open ${vehicle.name}`}
        >
          <h3 className="line-clamp-2 min-h-[2.5rem] text-[17px] font-bold leading-5 tracking-tight text-slate-950 group-hover:text-orange-700">
            {vehicle.name}
          </h3>
        </Link>

        <p className="mt-1.5 text-2xl font-black tracking-[-0.025em] text-slate-950" data-testid="marketplace-card-price">
          {formatMarketplacePrice(vehicle.price, vehicle.currency)}
        </p>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-slate-500">
          {typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage) && (
            <span className="flex items-center gap-1"><Gauge className="h-3.5 w-3.5" />{vehicle.mileage.toLocaleString()} km</span>
          )}
          {vehicle.transmission && (
            <span className="flex items-center gap-1"><Settings2 className="h-3.5 w-3.5" />{vehicle.transmission}</span>
          )}
          {vehicle.fuel && (
            <span className="flex items-center gap-1"><Fuel className="h-3.5 w-3.5" />{vehicle.fuel}</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {vehicle.labels.slice(0, 3).map((label) => (
            <Badge
              key={label}
              variant="outline"
              className="border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600"
              data-testid="marketplace-condition-tag"
            >
              {label}
            </Badge>
          ))}
        </div>

        <div className="mt-3">
          <TrustPreview trust={vehicle.trust} />
        </div>

        <div className="mt-3 grid gap-1.5 text-xs text-slate-500">
          <div className="flex min-w-0 items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate" data-testid="listing-location">{vehicle.locationLabel}</span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="truncate">{vehicle.sellerLabel}</span>
            <span className="shrink-0 font-medium text-slate-600" data-testid="marketplace-plate-status">{vehicle.plateStatus}</span>
          </div>
        </div>

        <div className="mt-auto pt-4">
          <Button asChild className="h-11 w-full rounded-xl bg-slate-950 font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)] hover:bg-orange-600">
            <Link to={href}>View vehicle &amp; Passport</Link>
          </Button>
        </div>
      </div>
    </article>
  )
}
