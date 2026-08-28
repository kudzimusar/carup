import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'
import {
  ArrowUpRight,
  CheckCircle2,
  Fuel,
  Gauge,
  GitCompare,
  Heart,
  Eye,
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
  isFavorite?: boolean
  isCompared?: boolean
  onFavorite?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onCompare?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onShare?: (event: React.MouseEvent<HTMLButtonElement>) => void
  dataTestId?: string
  ctaLabel?: string
  priceTestId?: string
  mileageTestId?: string
  locationTestId?: string
  showMissingMileage?: boolean
  /** Explicitly permits only browser-local data:/blob: media for an unpublished Seller preview. */
  allowLocalDraftMedia?: boolean
  /** Removes dead navigation from an unpublished Seller preview while keeping the real card layout. */
  previewMode?: boolean
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
        className="relative overflow-hidden bg-[#0a1220] px-4 py-3 text-white"
        data-testid="marketplace-card-trust"
      >
        <div className="absolute inset-y-0 left-0 w-1 bg-orange-500" />
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">
              <ShieldCheck className="h-3.5 w-3.5" /> CarUp Trust lens
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-black">{score}<span className="text-xs font-semibold text-slate-400">/100</span></span>
              <span className="text-xs font-semibold text-slate-300">{titleCase(trust?.band) || 'Evaluated'}</span>
            </div>
          </div>
          {trust?.confidence && (
            <div className="border-l border-white/10 pl-4 text-right">
              <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Confidence</div>
              <div className="mt-0.5 text-xs font-bold text-white">{titleCase(trust.confidence)}</div>
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
      className="border-y border-slate-200 bg-slate-50 px-4 py-3"
      data-testid="marketplace-card-trust"
    >
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5" /> CarUp Trust lens
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-sm font-bold text-slate-900">{copy}</p>
        <p className="text-[10px] text-slate-500">No legacy score is substituted</p>
      </div>
    </div>
  )
}

export function MarketplaceListingCard({
  vehicle,
  href,
  isFavorite = false,
  isCompared = false,
  onFavorite,
  onCompare,
  onShare,
  dataTestId = 'marketplace-vehicle-card',
  ctaLabel = 'Explore vehicle & Passport',
  priceTestId = 'marketplace-card-price',
  mileageTestId,
  locationTestId = 'listing-location',
  showMissingMileage = false,
  allowLocalDraftMedia = false,
  previewMode = false,
}: MarketplaceListingCardProps) {
  // Seller preview is the ONLY exception to the public-media state machine, and even there it may
  // render only a browser-local data:/blob: locator. A remote URL still has to earn one of the
  // governed Marketplace states, so this cannot become a back door around publication/media policy.
  const localDraftImage = allowLocalDraftMedia
    && vehicle.primaryImageState === 'draft_local'
    && typeof vehicle.primaryImage === 'string'
    && /^(data:image\/|blob:)/i.test(vehicle.primaryImage.trim())
      ? vehicle.primaryImage
      : null
  const renderablePrimaryImage = localDraftImage ?? (
    canRenderMarketplacePrimaryImage(vehicle.primaryImageState, vehicle.primaryImage)
      ? vehicle.primaryImage
      : null
  )

  return (
    <article
      className={`group relative flex h-full flex-col bg-white transition duration-500 hover:-translate-y-1.5 ${isCompared ? 'ring-2 ring-orange-500 ring-offset-4' : ''}`}
      data-testid={dataTestId}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-[linear-gradient(135deg,#e8edf3,#dce3eb)] shadow-[0_18px_44px_rgba(15,23,42,0.16)] transition-shadow duration-500 group-hover:shadow-[0_30px_70px_rgba(15,23,42,0.24)]">
        {previewMode ? (
          <div
            className="block h-full w-full"
            aria-label={`Draft buyer preview of ${vehicle.name}`}
            data-testid="marketplace-draft-preview-image"
          >
            <ListingImage
              src={renderablePrimaryImage}
              alt={vehicle.name}
              className="h-full w-full"
              imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
          </div>
        ) : (
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
              imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
          </Link>
        )}

        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
          {vehicle.carupGold && (
            <Badge className="rounded-none border border-amber-300 bg-amber-400 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-950" data-testid="carup-gold-badge">
              ★ CarUp Gold
            </Badge>
          )}
          {vehicle.syntheticDemo && (
            <Badge className="rounded-none border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-800" data-testid="synthetic-demo-media-badge">
              Demo media
            </Badge>
          )}
          {vehicle.plateVerified && (
            <Badge className="rounded-none border-0 bg-emerald-700 text-[10px] text-white" data-testid="marketplace-plate-confirmed-badge">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Plate confirmed
            </Badge>
          )}
          {vehicle.reserved && (
            <Badge className="rounded-none border-0 bg-amber-500 text-[10px] text-white">Reserved</Badge>
          )}
          {vehicle.partSentryChecked && (
            <Badge className="rounded-none border-0 bg-slate-950 text-[10px] text-white" data-testid="marketplace-partsentry-badge">
              PartSentry checked
            </Badge>
          )}
        </div>

        {(onCompare || onShare || onFavorite) && (
          <div className="absolute right-3 top-3 flex translate-y-9 items-center gap-1.5 sm:translate-y-0">
            {onCompare && (
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
            )}
            {onShare && (
              <button
                type="button"
                aria-label="Share listing"
                onClick={onShare}
                data-testid="marketplace-share-button"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <Share2 className="h-4 w-4" />
              </button>
            )}
            {onFavorite && (
              <button
                type="button"
                aria-label={isFavorite ? 'Remove saved listing' : 'Save listing'}
                aria-pressed={isFavorite}
                onClick={onFavorite}
                data-testid="marketplace-save-toggle"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <Heart className={`h-4 w-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="relative flex flex-1 flex-col border-b border-slate-200 px-1 pb-5 pt-5">
        {previewMode ? (
          <h3 className="line-clamp-2 min-h-[2.75rem] text-2xl font-black leading-[1.05] tracking-[-0.04em] text-slate-950">
            {vehicle.name}
          </h3>
        ) : (
          <Link
            to={href}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            aria-label={`Open ${vehicle.name}`}
          >
            <h3 className="line-clamp-2 min-h-[2.75rem] text-2xl font-black leading-[1.05] tracking-[-0.04em] text-slate-950 transition-colors group-hover:text-orange-700">
              {vehicle.name}
            </h3>
          </Link>
        )}

        <p className="mt-3 text-2xl font-black tracking-[-0.045em] text-slate-950 sm:text-3xl" data-testid={priceTestId}>
          {formatMarketplacePrice(vehicle.price, vehicle.currency)}
        </p>

        <div className="mt-4 grid grid-cols-3 border-y border-slate-200 text-xs text-slate-600">
          {typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage) ? (
            <span data-testid={mileageTestId} className="flex min-h-12 items-center gap-1.5 border-r border-slate-200 pr-2"><Gauge className="h-3.5 w-3.5 text-orange-500" />{vehicle.mileage.toLocaleString()} km</span>
          ) : showMissingMileage ? (
            <span data-testid={mileageTestId} className="flex min-h-12 items-center gap-1.5 border-r border-slate-200 pr-2 text-slate-400"><Gauge className="h-3.5 w-3.5 text-slate-300" />Mileage not recorded</span>
          ) : null}
          {vehicle.transmission && (
            <span className="flex min-h-12 items-center gap-1.5 border-r border-slate-200 px-2"><Settings2 className="h-3.5 w-3.5 text-orange-500" />{vehicle.transmission}</span>
          )}
          {vehicle.fuel && (
            <span className="flex min-h-12 items-center gap-1.5 pl-2"><Fuel className="h-3.5 w-3.5 text-orange-500" />{vehicle.fuel}</span>
          )}
        </div>

        <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
          {vehicle.labels.slice(0, 3).map((label, index) => (
            <span key={label} className="inline-flex items-center gap-2" data-testid="marketplace-condition-tag">
              {index > 0 && <span className="h-1 w-1 bg-orange-500" aria-hidden="true" />}
              {label}
            </span>
          ))}
        </div>

        <div className="mt-4">
          <TrustPreview trust={vehicle.trust} />
        </div>

        <div className="mt-4 grid gap-2 text-xs text-slate-500">
          <div className="flex min-w-0 items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate" data-testid={locationTestId}>{vehicle.locationLabel}</span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="truncate">{vehicle.sellerLabel}</span>
            <span className="shrink-0 font-medium text-slate-600" data-testid="marketplace-plate-status">{vehicle.plateStatus}</span>
          </div>
        </div>

        <div className="mt-auto pt-5">
          {previewMode ? (
            <div
              className="flex items-center justify-between border-t border-slate-950 pt-3 text-sm font-black text-slate-950"
              data-testid="marketplace-draft-preview-cta"
            >
              <span>{ctaLabel}</span>
              <Eye className="h-4 w-4 text-orange-600" />
            </div>
          ) : (
            <Link
              to={href}
              className="group/link flex items-center justify-between border-t border-slate-950 pt-3 text-sm font-black text-slate-950 transition-colors hover:text-orange-700"
            >
              <span>{ctaLabel}</span>
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
