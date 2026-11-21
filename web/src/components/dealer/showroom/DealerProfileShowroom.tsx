/**
 * RX05-A — the unified (showroom) presentation of /dealers/:seedId and /dealers/:seedId/claim.
 *
 * The page container keeps every read (profile, reviewed contacts, approved inventory, approved
 * media), the SEO tags, the saved-vehicle hearts and the claim submission; this view only arranges
 * them. Truth rules it holds:
 *  - Standing comes from dealerStanding(); an unclaimed or claimed-unapproved listing never reads as
 *    an approved dealer and never shows stock (the API serves inventory for approved storefronts only).
 *  - "About" for a research listing is composed only of returned fields — no history, certifications,
 *    ratings or testimonials.
 *  - The hero shows an approved public cover image when the API returned one; otherwise an original
 *    illustration with a visible disclosure, labelled as not this dealership's premises.
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Building2, Car, ChevronRight, FileText, Globe, ImageIcon, Info, MapPin,
  Navigation, Phone, RotateCcw, ShieldCheck, Store, Tag,
} from 'lucide-react'
import { SceneDisclosure, ShowroomFloorScene } from '@/components/media/rx05/AutomotiveScenes'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import type { MarketplaceListingSummary } from '@/types'
import { dealerDate } from '@/lib/dealerDates'
import { cn } from '@/lib/utils'
import { declaredFieldLabel, declaredSectionLabel, mediaCategoryLabel, plural } from '@/components/dealer/profile/dealerProfileLabels'
import { dealerStanding, type ShowroomDealer } from './dealerShowroomModel'
import {
  ACTION_GHOST_ON_INK, ACTION_ON_INK, ACTION_PRIMARY, ACTION_SECONDARY, CARD, DealerMark, EYEBROW, EYEBROW_ON_INK, FIELD,
  HINT, LABEL, Notice, PAGE_WIDTH, SectionHeading, SkeletonBlock, StatusChip, TEXTAREA, TEXT_LINK,
} from './ShowroomPrimitives'

export interface ShowroomProfile extends ShowroomDealer {
  approved_branches?: Array<{ branch_id: string; name: string; address: string; display_reviewed: boolean; gps_verified: false }>
  dealer_declared_sections?: Record<string, Record<string, string>>
  disclosure?: string
}

export interface ShowroomGalleryItem {
  media_key: string
  branch_name: string | null
  media_category: string
  caption: string
  alt_text: string
  image_path: string
}

export interface ShowroomReviewedContacts {
  reviewed_public_address: string | null
  reviewed_public_phone: string | null
  reviewed_public_website: string | null
  source_checked_at: string | null
}

export type ClaimScopeValue = 'BRANCH' | 'PARENT_ORGANIZATION'
export type ClaimRelationshipValue = 'LEGAL_OWNER' | 'DIRECTOR' | 'AUTHORIZED_REPRESENTATIVE' | 'BRANCH_MANAGER' | 'PARENT_DELEGATE'

export interface ShowroomClaimForm {
  signedIn: boolean
  signInHref: string
  templateHref: string
  scope: ClaimScopeValue
  onScope: (value: ClaimScopeValue) => void
  relationship: ClaimRelationshipValue
  onRelationship: (value: ClaimRelationshipValue) => void
  legalName: string
  onLegalName: (value: string) => void
  statement: string
  onStatement: (value: string) => void
  submitting: boolean
  outcome: 'pending-evidence' | 'failed' | null
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

type ReadState = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface DealerProfileShowroomProps {
  claimMode: boolean
  loaded: 'loading' | 'ready' | 'missing' | 'error'
  profile: ShowroomProfile | null
  redirectedFrom: string | null
  onRetry: () => void
  apiBase: string
  coverSrc: string | null
  coverAlt?: string | null
  avatarSrc: string | null
  avatarAlt?: string | null
  mediaState: ReadState
  galleryItems: ShowroomGalleryItem[]
  stock: MarketplaceListingSummary[] | null
  stockState: ReadState
  signedIn: boolean
  savedVins: ReadonlySet<string>
  onToggleSaved: (vin: string, vehicleName: string) => void
  onScrollTo: (id: string) => void
  contacts: ShowroomReviewedContacts | null
  contactAvailability: 'loading' | 'ready' | 'unavailable'
  overview?: Record<string, string>
  policySections: Array<[string, Record<string, string>]>
  claim: ShowroomClaimForm
}

function HeroArt({ src, alt }: { src: string | null; alt?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (src && failed !== src) {
    return (
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-card bg-carup-raw-ink-2 ring-1 ring-white/10" data-testid="dealer-showroom-cover">
        <img src={src} alt={alt || ''} className="h-full w-full object-cover" onError={() => setFailed(src)} />
      </div>
    )
  }
  return (
    <div className="relative">
      {/* The disclosure sits on the back wall so it never covers the illustrated cars on phones. */}
      <ShowroomFloorScene
        className="aspect-[16/10] w-full rounded-card ring-1 ring-white/10"
        label="Illustration of a showroom floor — not this dealership’s premises or stock"
        disclosure={false}
      />
      <SceneDisclosure className="absolute right-3 top-[18%]" />
    </div>
  )
}

function ProvenanceCell({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0 bg-carup-bg-raised px-4 py-4 sm:px-5', wide && 'col-span-2 lg:col-span-1')}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">{label}</dt>
      <dd className="mt-1.5 text-sm font-semibold leading-snug text-carup-text [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function ContactCard({ contacts, availability, onRetry }: {
  contacts: ShowroomReviewedContacts | null
  availability: 'loading' | 'ready' | 'unavailable'
  onRetry: () => void
}) {
  const rows = contacts && availability === 'ready'
    ? [contacts.reviewed_public_address, contacts.reviewed_public_phone, contacts.reviewed_public_website].filter(Boolean).length
    : 0
  return (
    <section aria-labelledby="dealer-contact-heading" className={cn(CARD, 'p-5')} data-testid="dealer-showroom-contact">
      <h2 id="dealer-contact-heading" className="flex items-center gap-2 text-base font-semibold">
        <Phone className="h-4 w-4 text-carup-action" aria-hidden="true" />Contact details
      </h2>
      {availability === 'loading' && <div className="mt-4 space-y-2"><SkeletonBlock className="h-4 w-2/3" /><SkeletonBlock className="h-4 w-1/2" /></div>}
      {availability === 'unavailable' && (
        <div className="mt-3">
          <p role="status" className="text-sm leading-6 text-carup-text-2">
            Publication-reviewed source contact details are unavailable. No unreviewed private source values are shown.
          </p>
          <button type="button" onClick={onRetry} className={cn(TEXT_LINK, 'mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm')}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />Try again
          </button>
        </div>
      )}
      {contacts && availability === 'ready' && rows === 0 && (
        <p className="mt-3 text-sm leading-6 text-carup-text-2">No reviewed contact details are published for this listing.</p>
      )}
      {contacts && availability === 'ready' && rows > 0 && (
        <dl className="mt-3 space-y-1 text-sm">
          {contacts.reviewed_public_address && (
            <div className="flex items-start gap-2.5 py-1.5">
              <dt><MapPin className="mt-0.5 h-4 w-4 text-carup-text-3" aria-hidden="true" /><span className="sr-only">Research address reviewed for display</span></dt>
              <dd className="min-w-0 text-carup-text [overflow-wrap:anywhere]">{contacts.reviewed_public_address}</dd>
            </div>
          )}
          {contacts.reviewed_public_phone && (
            <div className="flex items-center gap-2.5">
              <dt><Phone className="h-4 w-4 text-carup-text-3" aria-hidden="true" /><span className="sr-only">Research business phone reviewed for display</span></dt>
              <dd className="min-w-0">
                <a className={cn(TEXT_LINK, 'inline-flex min-h-11 items-center [overflow-wrap:anywhere]')} href={`tel:${contacts.reviewed_public_phone.replace(/[^\d+]/g, '')}`}>
                  {contacts.reviewed_public_phone}
                </a>
              </dd>
            </div>
          )}
          {contacts.reviewed_public_website && (
            <div className="flex items-center gap-2.5">
              <dt><Globe className="h-4 w-4 text-carup-text-3" aria-hidden="true" /><span className="sr-only">Website</span></dt>
              <dd className="min-w-0">
                <a className={cn(TEXT_LINK, 'inline-flex min-h-11 items-center')} target="_blank" rel="noopener noreferrer nofollow" href={contacts.reviewed_public_website}>
                  Reviewed source business website
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}
      {contacts && availability === 'ready' && contacts.source_checked_at && (
        <p className="mt-3 border-t border-carup-line pt-3 text-xs leading-5 text-carup-text-3">
          Contact display review: {dealerDate(contacts.source_checked_at)}. This is not independent legal-business verification.
        </p>
      )}
    </section>
  )
}

function ClaimFormSection({ profile, claim }: { profile: ShowroomProfile; claim: ShowroomClaimForm }) {
  return (
    <section id="claim" aria-labelledby="dealer-claim-heading" className={cn(CARD, 'scroll-mt-24 p-5 sm:p-8')} data-testid="dealer-showroom-claim">
      <p className={EYEBROW}>Claim request · {profile.seed_dealer_id}</p>
      <h2 id="dealer-claim-heading" className="mt-1.5 text-[clamp(1.375rem,2.2vw,1.875rem)] font-bold leading-[1.1] tracking-[-0.025em]">
        Request to claim this business
      </h2>
      <p className="mt-3 max-w-2xl text-[15px] leading-6 text-carup-text-2">
        Submitting a claim only opens an evidence-required request. It does not verify ownership,
        enable editing, grant dealer access or activate a CarUp tenant.
      </p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-carup-text-2">
        <a className={TEXT_LINK} href={claim.templateHref} download data-testid="dealer-blank-intake-template">
          Preview the blank dealership registration workbook (.xlsx)
        </a>
        {' '}— after an approved claim you receive your own prefilled copy to complete once.
      </p>
      <div className="mt-6 border-t border-carup-line pt-6">
        {!claim.signedIn ? (
          <div className="rounded-card bg-carup-bg-surface p-5">
            <p className="text-sm leading-6 text-carup-text">
              <Link className={TEXT_LINK} data-testid="dealer-claim-sign-in" to={claim.signInHref}>
                Sign in to your CarUp account
              </Link> before requesting a business claim.
            </p>
          </div>
        ) : claim.outcome === 'pending-evidence' ? (
          <Notice tone="info" role="status" testId="dealer-showroom-claim-recorded">
            Request recorded, awaiting documentary proof and independent review.
            No dealership control has been granted. Go to My Claim Applications to submit private evidence, follow independent review, and—only after approval—download your prefilled workbook.
            <p className="mt-3"><Link className={TEXT_LINK} to="/dealers/claims">Open My Claim Applications</Link></p>
          </Notice>
        ) : (
          <form onSubmit={claim.onSubmit} className="max-w-3xl space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="dealer-claim-scope" className={LABEL}>Claim scope</label>
                <select id="dealer-claim-scope" className={FIELD} value={claim.scope} onChange={event => claim.onScope(event.target.value as ClaimScopeValue)}>
                  <option value="BRANCH">This business branch</option>
                  <option value="PARENT_ORGANIZATION">Parent legal organization</option>
                </select>
                <p className={HINT} data-testid="dealer-unavailable-multi-branch-parent">
                  Not available yet: one claim covers this researched business only. Managing several
                  branches or research listings under one parent organisation is planned but cannot be
                  requested here today.
                </p>
              </div>
              <div className="min-w-0">
                <label htmlFor="dealer-claim-relationship" className={LABEL}>Your asserted relationship</label>
                <select id="dealer-claim-relationship" className={FIELD} value={claim.relationship} onChange={event => claim.onRelationship(event.target.value as ClaimRelationshipValue)}>
                  <option value="LEGAL_OWNER">Legal owner</option>
                  <option value="DIRECTOR">Company director</option>
                  <option value="AUTHORIZED_REPRESENTATIVE">Authorized representative</option>
                  <option value="BRANCH_MANAGER">Branch manager</option>
                  <option value="PARENT_DELEGATE">Parent-company delegate</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="dealer-claim-legal-name" className={LABEL}>Legal business name (as asserted)</label>
              <input id="dealer-claim-legal-name" className={FIELD} required minLength={2} maxLength={180} value={claim.legalName} onChange={event => claim.onLegalName(event.target.value)} />
            </div>
            <div>
              <label htmlFor="dealer-claim-statement" className={LABEL}>Explain your authority to represent the business</label>
              <textarea id="dealer-claim-statement" className={TEXTAREA} required minLength={30} maxLength={2000} value={claim.statement} onChange={event => claim.onStatement(event.target.value)} />
              <p className={HINT}>
                Do not enter passport numbers, tax IDs or sensitive documents here. Original proof must be submitted through private evidence intake when available.
              </p>
            </div>
            {claim.error && <Notice tone="danger" role="alert">{claim.error}</Notice>}
            <button type="submit" disabled={claim.submitting} className={ACTION_PRIMARY}>
              {claim.submitting ? 'Submitting…' : 'Submit evidence-required claim request'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}

const CLAIM_STEPS: Array<[string, string]> = [
  ['Request recorded', 'Your request opens a private, evidence-required case. No access is granted.'],
  ['Private evidence', 'Upload original authority documents from My Claim Applications.'],
  ['Independent review', 'A CarUp reviewer inspects the originals and decides the claim.'],
  ['Application & legal review', 'Only after approval: your prefilled application, then a separate legal review before any activation.'],
]

export function DealerProfileShowroom(props: DealerProfileShowroomProps) {
  const { claimMode, loaded, profile, redirectedFrom, onRetry } = props

  // RX05 perf (CLS): while the profile loads, reserve the dark identity frame at a stable height with
  // the breadcrumb exactly where the loaded hero puts it, and render nothing below it. Content then
  // arrives INTO the frame; nothing that was on screen moves (the A/B measured CLS 0.57 on phones
  // when a light skeleton block was pushed down by the arriving hero).
  if (loaded === 'loading') {
    return (
      <main className="min-h-screen bg-carup-bg text-carup-text" data-testid="dealer-public-profile" data-presentation="showroom">
        <section className="bg-carup-raw-ink text-carup-raw-paper" aria-busy="true" aria-label="Loading dealership profile">
          <div className={cn(PAGE_WIDTH, 'min-h-[40rem] pb-20 pt-4 sm:pt-6 lg:min-h-[36rem] lg:pb-28')}>
            <nav aria-label="Breadcrumb" className="text-sm">
              <ol className="flex min-w-0 items-center gap-1.5 text-white/70">
                <li>
                  <Link to="/dealers" className="inline-flex min-h-11 items-center gap-1.5 rounded-control font-semibold hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-raw-orange-signal">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />Dealers
                  </Link>
                </li>
              </ol>
            </nav>
            {/* Keyed so React mounts the loaded hero columns fresh instead of reusing (and "moving") these nodes. */}
            <div key="profile-skeleton" className="mt-4 space-y-4 lg:mt-8" aria-hidden="true">
              <div className="h-20 w-20 animate-pulse rounded-card bg-white/10 motion-reduce:animate-none" />
              <div className="h-10 w-3/4 max-w-xl animate-pulse rounded-control bg-white/10 motion-reduce:animate-none" />
              <div className="h-5 w-1/2 max-w-sm animate-pulse rounded-control bg-white/10 motion-reduce:animate-none" />
            </div>
            <p key="profile-loading-status" role="status" className="mt-6 text-sm text-white/75">Loading reviewed research profile…</p>
          </div>
        </section>
      </main>
    )
  }

  if (loaded !== 'ready' || !profile) {
    return (
      <main className="min-h-screen bg-carup-bg text-carup-text" data-testid="dealer-public-profile" data-presentation="showroom">
        <div className="bg-carup-raw-ink">
          <div className={cn(PAGE_WIDTH, 'py-6')}>
            <Link to="/dealers" className="inline-flex min-h-11 items-center gap-1.5 rounded-control text-sm font-semibold text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-raw-orange-signal">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to dealership directory
            </Link>
          </div>
        </div>
        <div className={cn(PAGE_WIDTH, 'py-10')}>
          {loaded === 'error' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold tracking-[-0.02em]">Dealership profile unavailable</h1>
              <Notice tone="warning" role="alert" className="mt-4">The reviewed research profile service is unavailable.</Notice>
              <button type="button" onClick={onRetry} className={cn(ACTION_SECONDARY, 'mt-4')} data-testid="dealer-profile-retry">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />Try again
              </button>
            </div>
          )}
          {loaded === 'missing' && (
            <div className={cn(CARD, 'mx-auto max-w-xl px-6 py-12 text-center')}>
              <Store className="mx-auto h-10 w-10 text-carup-text-3" aria-hidden="true" />
              <h1 className="mt-3 text-xl font-bold">Dealership profile not found</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-carup-text-2" role="alert">
                This research profile has not been published, is withheld, or is no longer available.
              </p>
              <Link className={cn(ACTION_SECONDARY, 'mt-5')} to="/dealers">Browse the dealership directory</Link>
            </div>
          )}
        </div>
      </main>
    )
  }

  const standing = dealerStanding(profile)
  const approved = standing.key === 'approved'
  const unclaimed = standing.key === 'unclaimed' && !profile.claimed
  const branches = profile.approved_branches || []
  const showClaimForm = claimMode && unclaimed
  const revision = typeof profile.revision === 'number' ? profile.revision : null

  const heroActions = claimMode ? (
    <Link to={`/dealers/${profile.slug}`} className={ACTION_GHOST_ON_INK}>View the full profile</Link>
  ) : approved ? (
    <>
      <button type="button" className={ACTION_ON_INK} onClick={() => props.onScrollTo('dealer-vehicles')}>
        <Car className="h-4 w-4" aria-hidden="true" />Browse vehicles
      </button>
      <button type="button" className={ACTION_GHOST_ON_INK} onClick={() => props.onScrollTo('dealer-branches')}>
        <MapPin className="h-4 w-4" aria-hidden="true" />See branches
      </button>
    </>
  ) : unclaimed ? (
    <>
      <Link to={`/dealers/${profile.slug}/claim`} className={ACTION_ON_INK}>
        <BadgeCheck className="h-4 w-4" aria-hidden="true" />Claim this dealership
      </Link>
      <Link to={`/dealers/${profile.slug}/correction`} className={ACTION_GHOST_ON_INK}>Request correction or removal</Link>
    </>
  ) : (
    <Link to={`/dealers/${profile.slug}/correction`} className={ACTION_GHOST_ON_INK}>Request correction, dispute or transfer</Link>
  )

  // Next actions + contact: first on phones, except in claim mode where the form leads.
  const asideNode = (
    <aside className="min-w-0 lg:order-2" aria-label="Next steps and contact">
      <div className="space-y-5 lg:sticky lg:top-24">
        {showClaimForm ? (
          <section aria-labelledby="dealer-claim-steps-heading" className={cn(CARD, 'p-5')}>
            <h2 id="dealer-claim-steps-heading" className="text-base font-semibold">What happens after you submit</h2>
            <ol className="mt-4 space-y-4">
              {CLAIM_STEPS.map(([title, body], index) => (
                <li key={title} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-carup-bg-surface-2 text-xs font-semibold text-carup-text tabular-nums" aria-hidden="true">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-[13px] leading-5 text-carup-text-2">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-carup-line pt-4 text-sm text-carup-text-2">
              Not the owner?{' '}
              <Link className={TEXT_LINK} to={`/dealers/${profile.slug}/correction`}>Report inaccurate information or request correction/removal</Link>
            </p>
          </section>
        ) : (
          <section aria-labelledby="dealer-next-heading" className={cn(CARD, 'p-5')} data-testid="dealer-showroom-next-steps">
            <h2 id="dealer-next-heading" className="text-base font-semibold">
              {unclaimed ? 'Own this business?' : approved ? 'Shop this dealership' : 'Something to correct?'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-carup-text-2">
              {unclaimed
                ? 'Claim the listing to manage it on CarUp. You provide evidence and CarUp reviews it independently before any dealer access is granted.'
                : approved
                  ? 'Open a vehicle to see its own Vehicle Passport and to enquire through CarUp Marketplace.'
                  : 'A claim is already recorded, so the self-service claim is closed. CarUp reviews corrections, disputes and ownership transfers independently.'}
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {unclaimed && !claimMode && (
                <Link to={`/dealers/${profile.slug}/claim`} className={ACTION_PRIMARY}>Start a claim<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              )}
              {approved && (
                <button type="button" className={ACTION_PRIMARY} onClick={() => props.onScrollTo('dealer-vehicles')}>Browse vehicles</button>
              )}
              <Link to={`/dealers/${profile.slug}/correction`} className={ACTION_SECONDARY}>
                {approved ? 'Request correction, dispute or removal' : unclaimed ? 'Request correction or removal' : 'Request correction, dispute or transfer'}
              </Link>
            </div>
          </section>
        )}
        <ContactCard contacts={props.contacts} availability={props.contactAvailability} onRetry={onRetry} />
      </div>
    </aside>
  )
  const mainNode = (
    <div className="min-w-0 space-y-14 lg:order-1">
      {showClaimForm && <ClaimFormSection profile={profile} claim={props.claim} />}

      {!showClaimForm && (approved ? (
        <section id="dealer-vehicles" tabIndex={-1} aria-labelledby="dealer-vehicles-heading" className="scroll-mt-24 focus:outline-none" data-testid="dealer-storefront-inventory">
          <SectionHeading
            id="dealer-vehicles-heading"
            eyebrow="Inventory"
            title="Vehicles on CarUp Marketplace"
            lead={props.stockState === 'ready' && props.stock
              ? `${props.stock.length} ${plural(props.stock.length, 'vehicle')} listed now · open a listing for its own Vehicle Passport`
              : 'Listings published through CarUp Marketplace'}
          />
          {props.stockState === 'loading' && (
            <div className="mt-6">
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(index => <SkeletonBlock key={index} className="h-72" />)}</div>
              <p role="status" className="mt-3 text-sm text-carup-text-2">Loading listed vehicles…</p>
            </div>
          )}
          {props.stockState === 'unavailable' && (
            <div className="mt-6 max-w-2xl">
              <Notice tone="warning" role="alert">Listed vehicles are unavailable right now. This is not a statement that the dealer has no stock.</Notice>
              <button type="button" onClick={onRetry} className={cn(ACTION_SECONDARY, 'mt-3')}><RotateCcw className="h-4 w-4" aria-hidden="true" />Try again</button>
            </div>
          )}
          {props.stockState === 'ready' && props.stock && props.stock.length === 0 && (
            <div className={cn(CARD, 'mt-6 px-6 py-10 text-center')}>
              <Car className="mx-auto h-9 w-9 text-carup-text-3" aria-hidden="true" />
              <p className="mx-auto mt-3 max-w-md text-sm text-carup-text-2">No vehicles from this dealership are currently published on CarUp Marketplace.</p>
              <Link className={cn(TEXT_LINK, 'mt-3 inline-block text-sm')} to="/marketplace">Browse all vehicles on CarUp</Link>
            </div>
          )}
          {props.stockState === 'ready' && props.stock && props.stock.length > 0 && (
            <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
              {props.stock.map(item => {
                const model = marketplaceListingToCardModel(item)
                return (
                  <MarketplaceListingCard
                    key={item.vin}
                    vehicle={model}
                    href={'/marketplace/listing/' + encodeURIComponent(item.vin)}
                    isFavorite={props.signedIn && props.savedVins.has(item.vin)}
                    onFavorite={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      props.onToggleSaved(item.vin, model.name)
                    }}
                    dataTestId="dealer-storefront-vehicle-card"
                    ctaLabel="View vehicle"
                  />
                )
              })}
            </div>
          )}
        </section>
      ) : (
        <section aria-labelledby="dealer-vehicles-heading" data-testid="dealer-showroom-inventory-empty">
          <SectionHeading id="dealer-vehicles-heading" eyebrow="Inventory" title="Vehicles" />
          <div className="mt-5 flex flex-col gap-4 rounded-card border border-dashed border-carup-line-strong bg-carup-bg-raised p-6 sm:flex-row sm:items-center">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-carup-bg-surface text-carup-text-3" aria-hidden="true"><Car className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">No vehicles are shown for this dealership</p>
              <p className="mt-1 text-sm leading-6 text-carup-text-2">
                CarUp shows a dealership’s vehicles only after its storefront is independently approved. This listing has no approved storefront, so no stock is shown — that is not a statement about what the business sells.
              </p>
            </div>
            <Link to="/marketplace" className={cn(ACTION_SECONDARY, 'shrink-0')}>Browse all vehicles</Link>
          </div>
        </section>
      ))}

      {!showClaimForm && (
        <section aria-labelledby="dealer-about-heading" data-testid="dealer-showroom-about">
          {approved && props.overview && Object.keys(props.overview).length > 0 ? (
            <>
              <SectionHeading id="dealer-about-heading" eyebrow="About" title="About the dealership" lead="In the dealer’s own words, reviewed for display" />
              <div className={cn(CARD, 'mt-5 p-5 sm:p-7')}>
                {props.overview.public_description && (
                  <p className="max-w-[68ch] whitespace-pre-wrap text-[17px] leading-8 text-carup-text [overflow-wrap:anywhere]">{props.overview.public_description}</p>
                )}
                {Object.entries(props.overview).some(([field]) => field !== 'public_description') && (
                  <dl className={cn('grid gap-5 sm:grid-cols-2 lg:grid-cols-3', props.overview.public_description && 'mt-6 border-t border-carup-line pt-6')}>
                    {Object.entries(props.overview).filter(([field]) => field !== 'public_description').map(([field, value]) => (
                      <div key={field} className="min-w-0">
                        <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">{declaredFieldLabel(field)}</dt>
                        <dd className="mt-1 whitespace-pre-wrap text-sm text-carup-text [overflow-wrap:anywhere]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </>
          ) : (
            <>
              <SectionHeading id="dealer-about-heading" eyebrow="About" title="About this listing" lead="Composed only from what CarUp has on record" />
              <div className={cn(CARD, 'mt-5 grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]')}>
                <div className="min-w-0 space-y-3 text-[15px] leading-7 text-carup-text [overflow-wrap:anywhere]">
                  <p>
                    <strong className="font-semibold">{profile.name}</strong> appears in CarUp’s dealership directory in {profile.city}, Zimbabwe, under “{profile.category}”.
                  </p>
                  <p className="text-carup-text-2">
                    CarUp published it from {profile.source_attribution} and last reviewed the entry on {dealerDate(profile.reviewed_at)}{revision !== null ? ` (revision ${revision})` : ''}.
                  </p>
                  <p className="text-carup-text-2">
                    {standing.key === 'claimed'
                      ? 'A claim has been recorded for this business, but CarUp has not approved a public storefront, so nothing here is presented as the dealership’s own description.'
                      : 'The business has not claimed this listing, so nothing here comes from the dealership itself.'}
                  </p>
                </div>
                <div className="min-w-0 self-start rounded-card bg-carup-bg-surface p-5">
                  <h3 id="dealer-location-heading" className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-carup-action" aria-hidden="true" />Location</h3>
                  <p className="mt-3 text-xl font-bold tracking-[-0.02em]">{profile.city}, Zimbabwe</p>
                  <p className="mt-1 text-[13px] leading-5 text-carup-text-2">Research city only — not a verified street address.</p>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {!showClaimForm && approved && (
        <section id="dealer-branches" tabIndex={-1} aria-labelledby="dealer-branches-heading" className="scroll-mt-24 focus:outline-none">
          <SectionHeading id="dealer-branches-heading" eyebrow="Locations" title="Reviewed dealership branches" lead="Addresses approved for public display" />
          {branches.length === 0 ? (
            <p className={cn(CARD, 'mt-5 p-5 text-sm text-carup-text-2')}>No individually published branches are available.</p>
          ) : (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {branches.map(branch => (
                <li key={branch.branch_id} className={cn(CARD, 'flex min-w-0 flex-col p-5')}>
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-carup-action-soft text-carup-action" aria-hidden="true"><Store className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      <h3 className="font-semibold [overflow-wrap:anywhere]">{branch.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]">{branch.address}</p>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    {branch.display_reviewed && <StatusChip tone="success">Display reviewed</StatusChip>}
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-carup-bg-surface px-2.5 py-1 text-xs font-semibold text-carup-text-2"><Navigation className="h-3.5 w-3.5" aria-hidden="true" />GPS not verified</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!showClaimForm && approved && (
        <section aria-labelledby="dealer-services-heading">
          <SectionHeading id="dealer-services-heading" eyebrow="Policies" title="Services & policies" lead="Declared by the dealer and reviewed for display — not a CarUp guarantee" />
          {props.policySections.length === 0 ? (
            <p className={cn(CARD, 'mt-5 p-5 text-sm text-carup-text-2')}>No dealer-supplied policy text is published.</p>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {props.policySections.map(([section, fields]) => {
                const rows = Object.entries(fields).filter(([, value]) => typeof value === 'string' && value.trim())
                return (
                  <article key={section} className={cn(CARD, 'min-w-0 p-5')}>
                    <h3 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-carup-action" aria-hidden="true" />{declaredSectionLabel(section)}</h3>
                    {rows.length === 0 ? (
                      <p className="mt-3 text-sm text-carup-text-2">No details are published for this section.</p>
                    ) : (
                      <dl className="mt-3 space-y-3">
                        {rows.map(([field, value]) => (
                          <div key={field} className="min-w-0">
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">{declaredFieldLabel(field)}</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-carup-text [overflow-wrap:anywhere]">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      {!showClaimForm && approved && (props.mediaState === 'loading' || props.mediaState === 'unavailable' || props.galleryItems.length > 0) && (
        <section aria-labelledby="dealer-gallery-heading" data-testid="dealer-storefront-media-gallery">
          <SectionHeading id="dealer-gallery-heading" eyebrow="Gallery" title="Facility & showroom photos" lead="Dealer-owned photos reviewed for display · No OEM/brand logo rights approved" />
          {props.mediaState === 'loading' && (
            <div className="mt-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1, 2].map(index => <SkeletonBlock key={index} className="aspect-[4/3]" />)}</div>
              <p role="status" className="mt-3 text-sm text-carup-text-2">Loading facility photos…</p>
            </div>
          )}
          {props.mediaState === 'unavailable' && <Notice tone="warning" role="alert" className="mt-5">Reviewed dealership facility photos are temporarily unavailable.</Notice>}
          {props.mediaState === 'ready' && props.galleryItems.length > 0 && (
            <div className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3">
              {props.galleryItems.map(item => (
                <figure key={item.media_key} data-testid={`dealer-storefront-media-item-${item.media_key}`} className={cn(CARD, 'min-w-0 overflow-hidden')}>
                  <img src={props.apiBase + item.image_path} alt={item.alt_text} loading="lazy" className="aspect-[4/3] w-full bg-carup-bg-surface object-cover" />
                  <figcaption className="space-y-1 p-3">
                    <p className="text-sm font-semibold [overflow-wrap:anywhere]">{item.caption}</p>
                    <p className="flex items-center gap-1.5 text-xs text-carup-text-2 [overflow-wrap:anywhere]">
                      <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {mediaCategoryLabel(item.media_category)}{item.branch_name ? ` · ${item.branch_name}` : ''}
                    </p>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── How to read this profile ── */}
      <section aria-labelledby="dealer-trust-heading" data-testid="dealer-showroom-trust">
        <SectionHeading id="dealer-trust-heading" eyebrow="Provenance" title="How to read this profile" />
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <article className="min-w-0 rounded-card bg-carup-bg-surface p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-carup-text-2" aria-hidden="true" />What CarUp reviewed</h3>
            <p className="mt-2 text-[13px] leading-5 text-carup-text-2">
              {approved
                ? 'The legal dealership and its current operating authority; branch details and dealer declarations were separately reviewed for display. Each vehicle passed CarUp’s own Marketplace publication checks.'
                : 'This entry was reviewed for limited publication only — not for company authority, ownership or current operation.'}
            </p>
          </article>
          <article className="min-w-0 rounded-card bg-carup-bg-surface p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Info className="h-4 w-4 text-carup-text-2" aria-hidden="true" />What it does not claim</h3>
            <p className="mt-2 text-[13px] leading-5 text-carup-text-2">
              {approved
                ? 'The dealership review does not verify any individual car, franchise, lender, logo or warranty. Buyer reviews and complaint totals are not measured. GPS and live opening status are not verified.'
                : 'No CarUp-verified licence, official franchise affiliation, current stock, reviews, sale record, warranty or payment eligibility is asserted by this listing.'}
            </p>
          </article>
          <article className="min-w-0 rounded-card bg-carup-bg-surface p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-carup-text-2" aria-hidden="true" />Source & ownership</h3>
            <p className="mt-2 text-[13px] leading-5 text-carup-text-2 [overflow-wrap:anywhere]">
              Research source: {profile.source_attribution}. Profile reviewed {dealerDate(profile.reviewed_at)}.{' '}
              {approved
                ? (profile.disclosure || 'Dealer declarations were reviewed for display, not certified as financing offers, legal warranty rights or business guarantees.')
                : standing.key === 'claimed'
                  ? 'A reviewed company claim is already recorded; a different person cannot claim it through the unclaimed form. CarUp independently reviews transfers, disputes and corrections.'
                  : 'Unclaimed: the business can claim this listing with private evidence and independent review.'}
            </p>
          </article>
        </div>
      </section>
    </div>
  )

  return (
    <main className="min-h-screen bg-carup-bg text-carup-text" data-testid="dealer-public-profile" data-presentation="showroom" data-standing={standing.key}>
      {/* ── Identity hero ── */}
      <section className="bg-carup-raw-ink text-carup-raw-paper" aria-labelledby="dealer-profile-name">
        <div className={cn(PAGE_WIDTH, 'pb-20 pt-4 sm:pt-6 lg:pb-28')}>
          <nav aria-label="Breadcrumb" className="text-sm">
            <ol className="flex min-w-0 items-center gap-1.5 text-white/70">
              <li>
                <Link to="/dealers" className="inline-flex min-h-11 items-center gap-1.5 rounded-control font-semibold hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-raw-orange-signal">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />Dealers
                </Link>
              </li>
              <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
              <li className="min-w-0 truncate text-white/85" aria-current="page">{claimMode ? 'Claim' : profile.name}</li>
            </ol>
          </nav>
          {claimMode ? (
            /* Claim: a compact identity strip keeps the form in focus. */
            <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-center lg:mt-8" data-testid="dealer-showroom-claim-identity">
              <DealerMark name={profile.name} src={props.avatarSrc} alt={props.avatarAlt} size="md" onInk />
              <div className="min-w-0 flex-1">
                <p className={EYEBROW_ON_INK}>Claim this dealership</p>
                <h1 id="dealer-profile-name" className="mt-2 text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-[1.08] tracking-[-0.03em] text-white [overflow-wrap:anywhere]">
                  {profile.name}
                </h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/80">
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-carup-raw-orange-signal" aria-hidden="true" />{profile.city}, Zimbabwe</span>
                  <StatusChip tone={standing.tone} testId="dealer-showroom-standing">{standing.chip}</StatusChip>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3">{heroActions}</div>
            </div>
          ) : (
            <div className="mt-4 grid items-center gap-8 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
              <div className="min-w-0">
                <DealerMark name={profile.name} src={props.avatarSrc} alt={props.avatarAlt} size="lg" onInk />
                <p className={cn(EYEBROW_ON_INK, 'mt-6')}>Dealership profile</p>
                <h1 id="dealer-profile-name" className="mt-3 text-[clamp(1.875rem,4.4vw,3.5rem)] font-bold leading-[1.02] tracking-[-0.035em] text-white [overflow-wrap:anywhere]">
                  {profile.name}
                </h1>
                <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-white/80">
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-carup-raw-orange-signal" aria-hidden="true" />{profile.city}, Zimbabwe</span>
                  <span className="inline-flex min-w-0 items-center gap-1.5"><Tag className="h-4 w-4 shrink-0 text-carup-raw-orange-signal" aria-hidden="true" /><span className="[overflow-wrap:anywhere]">{profile.category}</span></span>
                </p>
                <div className="mt-5">
                  <StatusChip tone={standing.tone} testId="dealer-showroom-standing">{standing.chip}</StatusChip>
                </div>
                <div className="mt-7 flex flex-wrap gap-3">{heroActions}</div>
              </div>
              <div className="min-w-0">
                <HeroArt src={props.coverSrc} alt={props.coverAlt} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Status & provenance band ── */}
      <div className={cn(PAGE_WIDTH, 'relative z-10 -mt-12 lg:-mt-16')}>
        <section aria-label="Listing status and source" className={cn(CARD, 'overflow-hidden shadow-sheet')} data-testid="dealer-showroom-provenance">
          <dl className="grid grid-cols-2 gap-px bg-carup-line lg:grid-cols-4">
            <ProvenanceCell label="Listing status" wide>{profile.label}</ProvenanceCell>
            <ProvenanceCell label="Source" wide>{profile.source_attribution}</ProvenanceCell>
            <ProvenanceCell label="Profile reviewed">{dealerDate(profile.reviewed_at)}</ProvenanceCell>
            {approved ? (
              <ProvenanceCell label="Reviewed branches">{branches.length}</ProvenanceCell>
            ) : (
              <ProvenanceCell label="Revision">{revision !== null ? `Revision ${revision}` : 'Not recorded'}</ProvenanceCell>
            )}
          </dl>
        </section>
      </div>

      <div className={cn(PAGE_WIDTH, 'pb-16 pt-8')}>
        {redirectedFrom && /^ZW-DEAL-\d{4}$/i.test(redirectedFrom) && (
          <Notice tone="info" role="status" testId="dealer-duplicate-redirect-banner" className="mb-6">
            Redirected from reconciled duplicate research record <strong>{redirectedFrom.toUpperCase()}</strong> to canonical profile{' '}
            <strong>{profile.seed_dealer_id}</strong>. Original source and claim custody remain preserved without merging legal entities.
          </Notice>
        )}

        <Notice tone={standing.tone} title={approved ? profile.label : standing.chip} testId="dealer-showroom-standing-notice">
          {approved
            ? 'Legal dealership and currently active operating authority were independently reviewed. This does not verify any individual car, franchise, lender, logo, warranty or merchant.'
            : profile.information_notice || standing.meaning}
        </Notice>

        {approved && claimMode && (
          <section aria-labelledby="dealer-claimed-notice-heading" className="mt-6">
            <Notice tone="info" title={<span id="dealer-claimed-notice-heading">This dealership is already claimed</span>}>
              This business already has a claim-linked approved operating organization. New ownership requests must go through a separate independently reviewed transfer or dispute, not the unclaimed self-service flow.
              <p className="mt-2"><Link className={TEXT_LINK} to={`/dealers/${profile.slug}/correction`}>Request correction, dispute or removal</Link></p>
            </Notice>
          </section>
        )}

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:gap-12">
          {showClaimForm ? <>{mainNode}{asideNode}</> : <>{asideNode}{mainNode}</>}
        </div>
      </div>
    </main>
  )
}
