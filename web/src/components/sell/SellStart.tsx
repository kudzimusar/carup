/**
 * RX04-D — Sell start (the unified presentation of the seller entry chooser, /sell).
 *
 * The legacy chooser asked a seller to classify their car's identity history before doing anything.
 * The Passport check already runs on the VIN as it is typed, so the start here leads with ONE action
 * (start with the VIN), shows the whole flow up to publication, and motivates with the seller's own
 * facts only: their browser draft's progress, and what their Garage cars already carry on the
 * Passport. Every original path (known / new / resume / Garage / sign in) stays reachable.
 *
 * Nothing here claims a capability that is not live: document scanning is shown as coming (the
 * governed OCR is not wired into the seller journey on this lineage), with the Owner-approved,
 * labelled illustration film and, in launch-preview builds only, a link to the labelled sample.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Camera, Check, Eye, FileSearch, FileText, ListChecks, LockKeyhole, LogIn, Plus, RotateCcw, ScanLine, ShieldCheck, Tag } from 'lucide-react'
import type { Vehicle } from '@/types'
import type { SellerEntryIntent } from './SellIntentRouter'
import { ShowroomListingImage } from '@/components/showroom/ShowroomListingImage'
import { EditorialFilm } from '@/components/showroom/EditorialFilm'
import { HOME_FILM, SCAN_FILM } from '@/content/media/homeFilms.data'
import { playableFilm } from '@/content/media/homeFilm'
import { isLaunchPreviewEnabled } from '@/lib/presentationFlags'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { LISTING_IMAGE_LIMIT } from '@/lib/listingMediaIntake'
import { readGuestSellDraft } from '@/lib/guestSellDraft'
import { sellerDiscoverabilityFacets } from '@/lib/sellerListingPreview'
import { sellerReadiness } from '@/lib/sellerReadiness'
import { readOwnerTrustClaim, statedCount } from '@/pages/dashboard/owner/ownerStatedValues'

export interface SellStartProps {
  isAuthenticated: boolean
  garageState: 'idle' | 'loading' | 'ready' | 'error'
  garageVehicles: Vehicle[]
  hasLocalDraft: boolean
  onResolve: (intent: SellerEntryIntent) => void
  vehicleAction: (vehicle: Vehicle) => { label: string; href: string }
}

const PRIMARY = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-carup-action px-6 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'
const ON_DARK_SECONDARY = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em]'

const FLOW: ReadonlyArray<{ title: string; copy: string; icon: typeof FileSearch; after?: boolean }> = [
  { title: 'Identify the car', copy: 'Type the VIN or chassis number. CarUp checks for an existing Vehicle Passport as you type.', icon: FileSearch },
  { title: 'Describe and price', copy: 'Mileage, condition, price and where the car is — the facts buyers filter by.', icon: Tag },
  { title: 'Add photos', copy: `Up to ${LISTING_IMAGE_LIMIT} photos. Pick the cover buyers see first.`, icon: Camera },
  { title: 'Preview and save', copy: 'See the real buyer card, then save the draft with a CarUp account.', icon: Eye },
  { title: 'Publish', copy: 'Upload ownership evidence. Once CarUp has reviewed it, your listing can go live.', icon: ShieldCheck, after: true },
]

const WHY: ReadonlyArray<{ title: string; copy: string; icon: typeof FileSearch }> = [
  { title: 'The car’s history sells it', copy: 'Buyers see the Vehicle Passport and CarUp Trust beside your price — records you already keep work for you.', icon: FileText },
  { title: 'Private until you choose', copy: 'Your name stays hidden unless you opt in, and the location can be withheld or shown by province only.', icon: LockKeyhole },
  { title: 'Know exactly what’s left', copy: 'The Studio lists what you need to save and what makes the listing stronger. No guesswork, no score.', icon: ListChecks },
  { title: 'Start now, finish later', copy: 'Your draft is kept in this browser, and it comes with you when you sign in.', icon: RotateCcw },
]

function SectionHeading({ id, eyebrow, title, action }: { id?: string; eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className={`${EYEBROW} text-carup-text-2`}>{eyebrow}</p>
        <h2 id={id} className="mt-2 text-[clamp(1.35rem,2.2vw,1.75rem)] font-bold tracking-[-0.02em] text-carup-text">{title}</h2>
      </div>
      {action}
    </div>
  )
}

function DraftResume({ onResolve }: { onResolve: (intent: SellerEntryIntent) => void }) {
  const draft = readGuestSellDraft()
  const name = draft ? [draft.year, draft.make, draft.model].filter(Boolean).join(' ') : ''
  const readiness = draft
    ? sellerReadiness({
        ...draft,
        coverChosen: draft.coverImageIndex !== null,
        discoverabilityFacets: sellerDiscoverabilityFacets(draft),
      }, 'guest')
    : null
  const left = readiness ? readiness.required.length - readiness.requiredDone : null
  return (
    <button
      type="button"
      onClick={() => onResolve('resume_draft')}
      className="group flex w-full flex-col gap-4 rounded-card border border-carup-line-strong bg-carup-bg-raised p-5 text-left transition-colors hover:border-carup-action sm:flex-row sm:items-center sm:justify-between sm:p-6"
      data-testid="sell-intent-resume-draft"
    >
      <span className="min-w-0">
        <span className={`${EYEBROW} text-carup-action`}>Draft found in this browser</span>
        <span className="mt-1 block text-lg font-semibold text-carup-text">{name ? `Continue with your ${name}` : 'Continue where you left off'}</span>
        {readiness && (
          <span className="mt-2 block" data-testid="sell-start-draft-progress">
            <span className="flex items-center gap-2 text-sm text-carup-text-2">
              <span className="font-semibold text-carup-text">{readiness.requiredDone} of {readiness.required.length}</span> needed to save
              {left !== null && left > 0 && <span>· {left} to go</span>}
              {left === 0 && <span>· ready to save</span>}
            </span>
            <span className="mt-2 flex h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-carup-bg-surface-2" aria-hidden="true">
              <span className="h-full rounded-full bg-carup-action" style={{ width: `${Math.round((readiness.requiredDone / readiness.required.length) * 100)}%` }} />
            </span>
          </span>
        )}
      </span>
      <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-carup-action">
        Resume draft <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </button>
  )
}

function GarageCard({ vehicle, action }: { vehicle: Vehicle; action: { label: string; href: string } }) {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'
  const trust = readOwnerTrustClaim(vehicle)
  const facts = [
    typeof vehicle.mileage === 'number' ? `${vehicle.mileage.toLocaleString()} km recorded` : null,
    statedCount(vehicle.counts?.services, 'service record'),
    statedCount(vehicle.counts?.verified_documents, 'verified document'),
  ].filter((fact): fact is string => Boolean(fact) && !String(fact).endsWith('not recorded'))
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-carup-line bg-carup-bg-raised" data-testid={`sell-garage-vehicle-${vehicle.vin}`}>
      <div className="aspect-[16/10] bg-carup-bg-surface">
        <ShowroomListingImage src={primaryListingImageUrl(vehicle.listing_media)} alt={name} plate="compact" bodyStyle={vehicle.body_style ?? null} />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-mono text-[11px] text-carup-text-3">{vehicle.vin}</p>
        <h3 className="mt-1 text-base font-semibold text-carup-text">{name}</h3>
        <p className={`mt-3 ${EYEBROW} text-carup-text-3`}>Already on its Passport</p>
        <ul className="mt-1.5 space-y-1 text-sm text-carup-text-2">
          <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-status-success" aria-hidden="true" /> Identity and specification</li>
          {facts.map(fact => (
            <li key={fact} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-status-success" aria-hidden="true" /> {fact}</li>
          ))}
          <li className="flex items-center gap-1.5 text-carup-text-2">
            <ShieldCheck className="h-3.5 w-3.5 text-carup-text-3" aria-hidden="true" />
            CarUp Trust: {trust.score !== null ? `${trust.score}/100 · ${trust.headline}` : trust.headline}
          </li>
        </ul>
        <div className="mt-auto pt-4">
          <Link to={action.href} className={`${PRIMARY} w-full`}>
            {action.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  )
}

export function SellStart({ isAuthenticated, garageState, garageVehicles, hasLocalDraft, onResolve, vehicleAction }: SellStartProps) {
  const heroPoster = HOME_FILM?.landscape.poster.src ?? null
  const scanFilm = playableFilm(SCAN_FILM)
  const launchPreview = isLaunchPreviewEnabled()
  return (
    <div className="space-y-12 pb-6 text-carup-text sm:space-y-16" data-testid="sell-intent-router" data-presentation="sell-start">
      {/* Hero: one clear action, the promise, and the three facts that lower the bar to start. */}
      <section className="relative overflow-hidden rounded-card bg-carup-raw-ink text-white" data-testid="sell-start-hero" aria-labelledby="sell-start-title">
        {heroPoster && (
          <div className="relative aspect-[16/9] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[62%]">
            <img src={heroPoster} alt="" className="h-full w-full object-cover" loading="eager" decoding="async" />
            <div className="absolute inset-0 hidden lg:block" style={{ background: 'linear-gradient(90deg, var(--carup-raw-ink) 0%, transparent 55%)' }} aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 lg:hidden" style={{ background: 'linear-gradient(0deg, var(--carup-raw-ink), transparent)' }} aria-hidden="true" />
            <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/85" data-testid="sell-start-hero-disclosure">
              {HOME_FILM?.disclosure ?? 'Illustration'}
            </span>
          </div>
        )}
        <div className="relative px-5 pb-7 pt-2 sm:px-8 lg:max-w-[46%] lg:py-14 lg:pl-12 lg:pr-0">
          <p className={`${EYEBROW} text-white/70`}>Sell on CarUp</p>
          <h1 id="sell-start-title" className="mt-3 text-[clamp(2rem,4vw,3.25rem)] font-bold leading-[1.05] tracking-[-0.03em]">
            Sell your car with its story behind it.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-white/75">
            Four short steps. Start without an account, see the exact card buyers will see, and nothing goes public until you choose.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button type="button" className={PRIMARY} onClick={() => onResolve('vin_first')} data-testid="sell-start-vin">
              Start with your VIN <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            {!isAuthenticated && (
              <Link to="/login?returnTo=%2Fsell" className={ON_DARK_SECONDARY} data-testid="sell-start-sign-in">
                <LogIn className="h-4 w-4" aria-hidden="true" /> Sell a car from my Garage
              </Link>
            )}
            {isAuthenticated && (
              <a href="#sell-intent-garage" className={ON_DARK_SECONDARY}>
                Choose from my Garage
              </a>
            )}
          </div>
          <ul className="mt-7 grid gap-2 text-sm text-white/80 sm:grid-cols-3 sm:gap-4">
            {['No account needed to start', 'Private until you publish', 'You choose what buyers see'].map(item => (
              <li key={item} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 flex-none text-carup-raw-orange-signal" aria-hidden="true" /> {item}</li>
            ))}
          </ul>
        </div>
      </section>

      {hasLocalDraft && <DraftResume onResolve={onResolve} />}

      {isAuthenticated && (
        <section id="sell-intent-garage" className="scroll-mt-20 space-y-5" data-testid="sell-intent-garage">
          <SectionHeading
            eyebrow="Your Garage"
            title="Most of the listing is already written"
            action={<Link to="/dashboard/garage" className="text-sm font-semibold text-carup-action underline-offset-2 hover:underline">Open My Garage</Link>}
          />
          <p className="max-w-2xl text-sm leading-6 text-carup-text-2">Cars on your account carry their Vehicle Passport into the listing, so you add the price, the words and the photos — not the identity again.</p>
          {garageState === 'loading' && <p className="text-sm text-carup-text-2">Reading your Garage…</p>}
          {garageState === 'error' && (
            <div className="rounded-card border border-status-warning bg-status-warning-soft p-4 text-sm text-carup-text">
              CarUp could not read your Garage right now. This is not treated as “you have no vehicles”; you can still start with a VIN.
            </div>
          )}
          {garageState === 'ready' && garageVehicles.length === 0 && (
            <p className="rounded-card border border-carup-line bg-carup-bg-raised p-4 text-sm text-carup-text-2">No car is recorded on this account yet. Start with the VIN and it will join your Garage when you save.</p>
          )}
          {garageVehicles.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {garageVehicles.map(vehicle => <GarageCard key={vehicle.vin} vehicle={vehicle} action={vehicleAction(vehicle)} />)}
            </div>
          )}
        </section>
      )}

      {/* Ways to start: the one that works today first; scanning shown honestly as coming. */}
      <section className="space-y-5" aria-labelledby="sell-start-ways">
        <SectionHeading id="sell-start-ways" eyebrow="Ways to start" title="Pick the quickest way in" />
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="flex flex-col rounded-card border border-carup-line bg-carup-bg-raised p-5 sm:p-6">
            <span className="grid h-11 w-11 place-items-center rounded-control bg-carup-action-soft text-carup-action"><FileSearch className="h-5 w-5" aria-hidden="true" /></span>
            <h3 className="mt-5 text-lg font-semibold text-carup-text">Type the VIN</h3>
            <p className="mt-2 text-sm leading-6 text-carup-text-2">The fastest way in. If CarUp already knows the car, you confirm it and the make, model and year fill in for you.</p>
            <div className="mt-5 rounded-control border border-carup-line bg-carup-bg-surface p-3" aria-hidden="true">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">VIN</p>
              <div className="mt-1.5 flex items-center justify-between rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 py-2.5 font-mono text-sm text-carup-text-3">
                <span>17 letters and numbers</span>
                <ScanLine className="h-4 w-4" />
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-status-success"><Check className="h-3.5 w-3.5" /> Passport check runs as you type</p>
            </div>
            <div className="mt-auto pt-5">
              <button type="button" className={`${PRIMARY} w-full`} onClick={() => onResolve('vin_first')}>
                Start with the VIN <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </article>

          <article className="flex flex-col overflow-hidden rounded-card border border-carup-line bg-carup-bg-raised" data-testid="sell-start-scan" data-capability-state="coming">
            <div className="relative aspect-[16/10] bg-carup-raw-ink">
              <EditorialFilm
                film={scanFilm}
                label="the document scan illustration"
                testId="sell-start-scan-film"
                className="h-full w-full"
                fallback={<div className="grid h-full w-full place-items-center text-white/70"><ScanLine className="h-10 w-10" aria-hidden="true" /></div>}
              />
            </div>
            <div className="flex flex-1 flex-col p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-carup-text">Scan a document</h3>
                <span className="rounded-full bg-status-info-soft px-2.5 py-0.5 text-[11px] font-semibold text-status-info">Coming to Seller Studio</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-carup-text-2">Photograph a registration book, customs papers or an auction sheet, and CarUp will suggest the details for you to confirm. Until it arrives, the VIN gets you started.</p>
              <div className="mt-auto flex flex-col gap-2 pt-5">
                <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text ring-1 ring-carup-line hover:bg-carup-bg-surface" onClick={() => onResolve('vin_first')}>
                  Start with the VIN for now
                </button>
                {launchPreview && (
                  <Link to="/#scan-to-start" className="text-center text-xs font-semibold text-carup-action underline-offset-2 hover:underline" data-testid="sell-start-scan-sample">
                    See how scanning will work (labelled sample)
                  </Link>
                )}
              </div>
            </div>
          </article>

          {isAuthenticated ? (
            <article className="flex flex-col rounded-card border border-carup-line bg-carup-bg-raised p-5 sm:p-6">
              <span className="grid h-11 w-11 place-items-center rounded-control bg-carup-action-soft text-carup-action"><ListChecks className="h-5 w-5" aria-hidden="true" /></span>
              <h3 className="mt-5 text-lg font-semibold text-carup-text">Pick up a listing</h3>
              <p className="mt-2 text-sm leading-6 text-carup-text-2">Drafts and live listings on your account — continue a draft, publish one that is ready, or manage what is live.</p>
              <div className="mt-auto pt-5">
                <Link to="/dashboard/listings" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text ring-1 ring-carup-line hover:bg-carup-bg-surface">
                  Open My listings
                </Link>
              </div>
            </article>
          ) : (
            <Link to="/login?returnTo=%2Fsell" className="group flex flex-col rounded-card border border-carup-line bg-carup-bg-raised p-5 transition-colors hover:border-carup-action sm:p-6" data-testid="sell-intent-sign-in">
              <span className="grid h-11 w-11 place-items-center rounded-control bg-carup-action-soft text-carup-action"><LogIn className="h-5 w-5" aria-hidden="true" /></span>
              <span className="mt-5 text-lg font-semibold text-carup-text">Your car is already on CarUp?</span>
              <span className="mt-2 text-sm leading-6 text-carup-text-2">Sign in and sell it from your Garage — its Passport fills the identity, and saved drafts are waiting.</span>
              <span className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-semibold text-carup-action">Sign in to continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
            </Link>
          )}
        </div>
        <p className="text-sm text-carup-text-2">
          Prefer to say up front?{' '}
          <button type="button" className="font-semibold text-carup-action underline-offset-2 hover:underline" onClick={() => onResolve('known_vehicle')} data-testid="sell-intent-known">
            <FileSearch className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />CarUp already knows this car
          </button>
          {' · '}
          <button type="button" className="font-semibold text-carup-action underline-offset-2 hover:underline" onClick={() => onResolve('new_vehicle')} data-testid="sell-intent-new">
            <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Add a car new to CarUp
          </button>
        </p>
      </section>

      {/* The whole flow, including what happens after saving — so nobody wonders "what then?". */}
      <section className="space-y-6" data-testid="sell-start-how" aria-labelledby="sell-start-how-title">
        <div>
          <p className={`${EYEBROW} text-carup-text-2`}>How selling works</p>
          <h2 id="sell-start-how-title" className="mt-2 text-[clamp(1.35rem,2.2vw,1.75rem)] font-bold tracking-[-0.02em] text-carup-text">From VIN to live listing</h2>
        </div>
        <ol className="grid gap-3 md:grid-cols-5 md:gap-0">
          {FLOW.map((item, index) => {
            const Icon = item.icon
            return (
              <li key={item.title} className="relative flex gap-4 md:flex-col md:gap-0 md:pr-5">
                <div className="flex flex-col items-center md:flex-row">
                  <span className={`grid h-10 w-10 flex-none place-items-center rounded-full text-sm font-semibold ${item.after ? 'bg-carup-raw-ink text-white' : 'bg-carup-action text-carup-action-on'}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {index < FLOW.length - 1 && <span className="my-1 w-px flex-1 bg-carup-line-strong md:mx-2 md:my-0 md:h-px md:w-auto" aria-hidden="true" />}
                </div>
                <div className="pb-4 md:pb-0 md:pt-4">
                  <p className={`${EYEBROW} text-carup-text-3`}>{item.after ? 'After saving' : `Step ${index + 1}`}</p>
                  <h3 className="mt-1 text-base font-semibold text-carup-text">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-carup-text-2">{item.copy}</p>
                </div>
              </li>
            )
          })}
        </ol>
        <p className="rounded-control bg-carup-bg-surface px-4 py-3 text-sm text-carup-text-2">
          Stop at any point — the draft stays in this browser, and the Studio shows exactly what is left each time you come back.
        </p>
      </section>

      <section className="space-y-5" data-testid="sell-start-why" aria-labelledby="sell-start-why-title">
        <div>
          <p className={`${EYEBROW} text-carup-text-2`}>Why sellers list on CarUp</p>
          <h2 id="sell-start-why-title" className="mt-2 text-[clamp(1.35rem,2.2vw,1.75rem)] font-bold tracking-[-0.02em] text-carup-text">A listing buyers can believe</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map(item => {
            const Icon = item.icon
            return (
              <div key={item.title} className="rounded-card border border-carup-line bg-carup-bg-raised p-5">
                <Icon className="h-5 w-5 text-carup-action" aria-hidden="true" />
                <h3 className="mt-4 text-base font-semibold text-carup-text">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-carup-text-2">{item.copy}</p>
              </div>
            )
          })}
        </div>
        <div className="flex flex-col items-start gap-3 rounded-card bg-carup-raw-ink p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-lg font-semibold">Ready when you are.</p>
            <p className="mt-1 text-sm text-white/75">Type the VIN and see your buyer card take shape.</p>
          </div>
          <button type="button" className={PRIMARY} onClick={() => onResolve('vin_first')}>
            Start with your VIN <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  )
}
