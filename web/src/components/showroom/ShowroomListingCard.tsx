import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShowroomListingImage } from '@/components/showroom/ShowroomListingImage'
import { PHOTO_SIZES } from '@/lib/mediaDelivery'
import { displayCurrencyCode } from '@/lib/currencyDisplay'
import { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'
import {
  ArrowUpRight,
  CheckCircle2,
  Eye,
  GitCompare,
  Heart,
  MapPin,
  Share2,
  ShieldCheck,
} from 'lucide-react'

export type ShowroomTrustEvaluationState = 'evaluated' | 'stale' | 'not_evaluated' | 'unavailable'

export interface ShowroomCardTrust {
  evaluation_state?: ShowroomTrustEvaluationState | string | null
  score?: number | null
  band?: string | null
  confidence?: string | null
  calculation_version?: string | null
  known_limitations?: unknown[] | null
}

export interface ShowroomListingCardModel {
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
  trust?: ShowroomCardTrust | null
  carupGold?: boolean
  syntheticDemo?: boolean
  /** Listing body style, used ONLY to pick the studio-plate silhouette when there is no photo. */
  bodyStyle?: string | null
}

interface ShowroomListingCardProps {
  vehicle: ShowroomListingCardModel
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
  /**
   * `feature` renders the same card horizontally (large media left, details right) from 1024 px.
   * Below 1024 px it is identical to `standard`. Presentation only: no data or behaviour differs.
   */
  layout?: 'standard' | 'feature'
  /** Lets the media run edge to edge below 640 px. Only for grids that sit in the page gutter. */
  edgeToEdgeOnPhones?: boolean
  /** Eager, high-priority photo: only for the card most likely to be the page's largest paint. */
  imagePriority?: boolean
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
  return `${displayCurrencyCode(currency)} ${price.toLocaleString()}`
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2'

/** Quiet separator between facts on one line; decorative only. */
function Dot() {
  return <span aria-hidden="true" className="text-slate-300">·</span>
}

/**
 * A wrapping row of facts separated by quiet dots. Each item draws its dot BEFORE itself and the row
 * is pulled left by one dot width inside an overflow-hidden box, so the dot that would start any
 * line is clipped: no line ever begins or ends with a stray separator, at any card width. The dots
 * are CSS-generated, so they are not part of the text (or of any test's textContent).
 */
const SEPARATED_ROW = '-ml-3.5 flex min-w-0 flex-wrap items-center'
const SEPARATED_ITEM = "min-w-0 before:inline-block before:w-3.5 before:text-center before:text-slate-300 before:content-['·']"

/**
 * The card's single Trust line. It renders ONLY what the canonical projection carries: a score,
 * band and confidence when the state is `evaluated` with a finite score, otherwise the state's own
 * sentence. The legacy cached `trust_score` is never read here, and the disclosure sentence stays in
 * the accessible text of every non-evaluated state.
 */
function TrustPreview({ trust }: { trust?: ShowroomCardTrust | null }) {
  const state = trust?.evaluation_state || null
  const score = trust?.score
  const hasCanonicalScore = state === 'evaluated' && typeof score === 'number' && Number.isFinite(score)

  if (hasCanonicalScore) {
    const confidence = titleCase(trust?.confidence)
    return (
      <p
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-5 text-slate-600"
        data-testid="marketplace-card-trust"
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-[#C2410C]" aria-hidden="true" />
        <span className="font-semibold text-[#09122A]">
          CarUp Trust <span className="tabular-nums">{score}</span><span className="font-medium text-slate-500">/100</span>
        </span>
        <Dot />
        <span>{titleCase(trust?.band) || 'Evaluated'}</span>
        {confidence && (
          <>
            <Dot />
            <span>{confidence} confidence</span>
          </>
        )}
      </p>
    )
  }

  const copy = state === 'not_evaluated'
    ? 'Not evaluated yet'
    : state === 'stale'
      ? 'Evaluation update pending'
      : state === 'unavailable'
        ? 'Trust temporarily unavailable'
        : 'Trust details on Vehicle Passport'
  const needsLabel = !/trust/i.test(copy)

  return (
    <p
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-5 text-slate-600"
      data-testid="marketplace-card-trust"
    >
      <ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      {needsLabel && (
        <>
          <span className="font-semibold text-[#09122A]">CarUp Trust</span>
          <Dot />
        </>
      )}
      <span>{copy}</span>
      {' '}
      <span className="sr-only">No legacy score is substituted</span>
    </p>
  )
}

function StatusPill({ children, testId, tone = 'light' }: { children: ReactNode; testId?: string; tone?: 'light' | 'gold' }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold leading-none shadow-[0_1px_2px_rgba(9,18,42,0.14)] ${tone === 'gold'
        ? 'bg-amber-400 text-[#09122A]'
        : 'bg-white/90 text-[#09122A] backdrop-blur-sm'}`}
      data-testid={testId}
    >
      {children}
    </span>
  )
}

const ACTION_BUTTON = 'flex h-11 w-11 items-center justify-center rounded-full shadow-[0_1px_2px_rgba(9,18,42,0.12),0_8px_18px_-10px_rgba(9,18,42,0.45)] backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] focus-visible:ring-offset-2'

export function ShowroomListingCard({
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
  layout = 'standard',
  edgeToEdgeOnPhones = false,
  imagePriority = false,
}: ShowroomListingCardProps) {
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

  // A card without a usable photo never takes the wide feature layout, and on phones its studio
  // plate is a short strip so the name, price and facts arrive at a normal scroll depth.
  const noPhoto = !renderablePrimaryImage
  const feature = layout === 'feature' && !noPhoto
  const actionCount = [onCompare, onShare, onFavorite].filter(Boolean).length
  // Status pills share the top edge with the round actions; reserve the actions' width so the two
  // never collide (44 px buttons, 8 px gaps, 12 px insets, 8 px breathing room).
  const pillRowStyle: CSSProperties | undefined = actionCount > 0
    ? { maxWidth: `calc(100% - ${actionCount * 44 + (actionCount - 1) * 8 + 32}px)` }
    : { maxWidth: 'calc(100% - 24px)' }

  const specs: ReactNode[] = []
  if (typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage)) {
    specs.push(<span key="mileage" className="tabular-nums" data-testid={mileageTestId}>{vehicle.mileage.toLocaleString()} km</span>)
  } else if (showMissingMileage) {
    specs.push(<span key="mileage" className="text-slate-500" data-testid={mileageTestId}>Mileage not recorded</span>)
  }
  if (vehicle.transmission) specs.push(<span key="transmission">{vehicle.transmission}</span>)
  if (vehicle.fuel) specs.push(<span key="fuel">{vehicle.fuel}</span>)

  const image = (
    <ShowroomListingImage
      src={renderablePrimaryImage}
      alt={vehicle.name}
      bodyStyle={vehicle.bodyStyle ?? null}
      sizes={feature ? PHOTO_SIZES.featureCard : PHOTO_SIZES.card}
      loading={imagePriority ? 'eager' : 'lazy'}
      plate={noPhoto ? 'compact' : 'stacked'}
      className="h-full w-full"
      imgClassName="motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-out motion-safe:group-hover:scale-[1.035]"
    />
  )

  const mediaShape = feature
    ? 'aspect-[4/3] rounded-2xl lg:aspect-auto lg:h-full lg:min-h-[400px] lg:rounded-3xl xl:min-h-[460px]'
    : noPhoto
      ? 'max-sm:h-[7.5rem] sm:aspect-[4/3] rounded-2xl'
      : 'aspect-[4/3] rounded-2xl'
  const bleed = edgeToEdgeOnPhones ? 'max-sm:-mx-4 max-sm:rounded-none' : ''
  const titleScale = feature ? 'lg:text-[1.75rem] lg:font-bold lg:leading-[1.1] lg:tracking-[-0.025em]' : ''

  return (
    <article
      className={`group relative flex h-full min-w-0 flex-col ${feature ? 'lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-stretch lg:gap-10 xl:gap-14' : ''}`}
      data-testid={dataTestId}
      data-card-layout={feature ? 'feature' : 'standard'}
      data-card-photo={noPhoto ? 'none' : 'published'}
    >
      <div
        className={`relative isolate overflow-hidden bg-[#EEECE7] shadow-[0_1px_2px_rgba(9,18,42,0.06),0_18px_40px_-18px_rgba(9,18,42,0.28)] motion-safe:transition-shadow motion-safe:duration-500 group-hover:shadow-[0_1px_2px_rgba(9,18,42,0.06),0_26px_50px_-20px_rgba(9,18,42,0.38)] ${mediaShape} ${bleed} ${isCompared ? 'ring-2 ring-[#09122A] ring-offset-2 ring-offset-white' : ''}`}
      >
        {previewMode ? (
          <div
            className="block h-full w-full"
            aria-label={`Draft buyer preview of ${vehicle.name}`}
            data-testid="marketplace-draft-preview-image"
          >
            {image}
          </div>
        ) : (
          <Link
            to={href}
            className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FE7D18]"
            aria-label={`View ${vehicle.name}`}
            data-testid="marketplace-view-passport"
          >
            {image}
          </Link>
        )}

        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5" style={pillRowStyle}>
          {vehicle.carupGold && (
            <StatusPill testId="carup-gold-badge" tone="gold">★ CarUp Gold</StatusPill>
          )}
          {vehicle.syntheticDemo && (
            <StatusPill testId="synthetic-demo-media-badge">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-600" aria-hidden="true" />
              Demo media
            </StatusPill>
          )}
          {vehicle.plateVerified && (
            <StatusPill testId="marketplace-plate-confirmed-badge">
              <CheckCircle2 className="h-3 w-3 text-emerald-700" aria-hidden="true" /> Plate confirmed
            </StatusPill>
          )}
          {vehicle.reserved && (
            <StatusPill>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Reserved
            </StatusPill>
          )}
          {vehicle.partSentryChecked && (
            <StatusPill testId="marketplace-partsentry-badge">
              <ShieldCheck className="h-3 w-3 text-[#09122A]" aria-hidden="true" /> PartSentry checked
            </StatusPill>
          )}
        </div>

        {actionCount > 0 && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            {onCompare && (
              <button
                type="button"
                aria-label={isCompared ? 'Remove from compare' : 'Add to compare'}
                aria-pressed={isCompared}
                onClick={onCompare}
                data-testid="marketplace-compare-toggle"
                className={`${ACTION_BUTTON} ${isCompared
                  ? 'bg-[#09122A] text-white hover:bg-[#111D3D]'
                  : 'bg-white/90 text-[#09122A] hover:bg-white'}`}
              >
                <GitCompare className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
            {onShare && (
              <button
                type="button"
                aria-label="Share listing"
                onClick={onShare}
                data-testid="marketplace-share-button"
                className={`${ACTION_BUTTON} bg-white/90 text-[#09122A] hover:bg-white`}
              >
                <Share2 className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
            {onFavorite && (
              <button
                type="button"
                aria-label={isFavorite ? 'Remove saved listing' : 'Save listing'}
                aria-pressed={isFavorite}
                onClick={onFavorite}
                data-testid="marketplace-save-toggle"
                className={`${ACTION_BUTTON} bg-white/90 text-[#09122A] hover:bg-white`}
              >
                <Heart className={`h-[18px] w-[18px] ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className={`flex min-w-0 flex-1 flex-col pt-4 ${feature ? 'lg:justify-center lg:py-4' : ''}`}>
        <div className="min-h-4 overflow-hidden text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-slate-500">
          <div className={`${SEPARATED_ROW} gap-y-0.5`}>
            {vehicle.labels.slice(0, 3).map(label => (
              <span key={label} className={SEPARATED_ITEM} data-testid="marketplace-condition-tag">
                {label}
              </span>
            ))}
          </div>
        </div>

        {previewMode ? (
          <h3 className={`mt-1.5 line-clamp-2 text-balance text-lg font-semibold leading-6 tracking-[-0.015em] text-[#09122A] ${titleScale}`}>
            {vehicle.name}
          </h3>
        ) : (
          <Link
            to={href}
            className={`mt-1.5 rounded-md ${FOCUS_RING}`}
            aria-label={`Open ${vehicle.name}`}
          >
            <h3 className={`line-clamp-2 text-balance text-lg font-semibold leading-6 tracking-[-0.015em] text-[#09122A] transition-colors group-hover:text-[#C2410C] ${titleScale}`}>
              {vehicle.name}
            </h3>
          </Link>
        )}

        {specs.length > 0 && (
          <div className="mt-1 overflow-hidden text-[14px] leading-5 text-slate-600">
            <p className={SEPARATED_ROW}>
              {specs.map((spec, index) => (
                <span key={index} className={SEPARATED_ITEM}>{spec}</span>
              ))}
            </p>
          </div>
        )}

        <p
          className={`mt-3 text-2xl font-bold leading-tight tabular-nums tracking-[-0.02em] text-[#09122A] ${feature ? 'lg:mt-5 lg:text-[2.5rem]' : ''}`}
          data-testid={priceTestId}
        >
          {formatMarketplacePrice(vehicle.price, vehicle.currency)}
        </p>

        <div className={feature ? 'mt-3 lg:mt-5' : 'mt-3'}>
          <TrustPreview trust={vehicle.trust} />
        </div>

        <div className={`mt-auto pt-4 ${feature ? 'lg:mt-8 lg:max-w-md' : ''}`}>
          <div className="border-t border-slate-200 pt-3">
            <div className="overflow-hidden text-[13px] leading-5 text-slate-500">
              <div className={`${SEPARATED_ROW} gap-y-1`}>
                <span className={`${SEPARATED_ITEM} inline-flex max-w-full items-center`}>
                  <MapPin className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate" data-testid={locationTestId}>{vehicle.locationLabel}</span>
                </span>
                <span className={`${SEPARATED_ITEM} max-w-full truncate`}>{vehicle.sellerLabel}</span>
                <span className={`${SEPARATED_ITEM} shrink-0 font-medium text-slate-600`}>
                  <span data-testid="marketplace-plate-status">{vehicle.plateStatus}</span>
                </span>
              </div>
            </div>

            {previewMode ? (
              <div
                className="mt-1 flex h-11 items-center justify-between text-[14px] font-semibold text-[#09122A]"
                data-testid="marketplace-draft-preview-cta"
              >
                <span>{ctaLabel}</span>
                <Eye className="h-4 w-4 text-[#C2410C]" aria-hidden="true" />
              </div>
            ) : (
              <Link
                to={href}
                className={`group/cta mt-1 flex h-11 items-center justify-between rounded-md text-[14px] font-semibold text-[#09122A] transition-colors hover:text-[#C2410C] ${FOCUS_RING}`}
              >
                <span>{ctaLabel}</span>
                <ArrowUpRight className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover/cta:-translate-y-0.5 motion-safe:group-hover/cta:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
