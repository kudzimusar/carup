import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { dealerDate } from '@/lib/dealerDates'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  AlertTriangle, ArrowLeft, BadgeCheck, Building2, Car, CheckCircle2, ChevronDown, FileText,
  Globe, ImageIcon, Info, MapPin, Navigation, Phone, Settings2, ShieldAlert, ShieldCheck, Ship,
  Store, Tag, Wallet, Wrench, type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import { loginWithReturnTo } from '@/lib/routeAccess'
import { cn } from '@/lib/utils'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import type { MarketplaceListingSummary } from '@/types'
import { DEALER_WRAP_BUTTON } from '@/components/dealer/dealerButtonWrap'
import { DealerProfileAvatar, DealerProfileCover } from '@/components/dealer/profile/DealerProfileMedia'
import { DeclaredSectionCard } from '@/components/dealer/profile/DeclaredSectionCard'
import {
  COMPANY_COVER_IMAGE, COMPANY_PROFILE_IMAGE, IDENTITY_MEDIA_CATEGORIES, declaredFieldLabel,
  declaredSectionLabel, mediaCategoryLabel, newestMediaOf, plural,
} from '@/components/dealer/profile/dealerProfileLabels'

type ResearchProfile = {
  seed_dealer_id: string
  slug: string
  name: string
  city: string
  category: string
  label: string
  source_attribution: string
  reviewed_at: string
  information_notice: string
  claimed: boolean
  business_verified: boolean
  tier?: 'PRELISTED_UNCLAIMED'|'FULL_DEALER_APPROVED'|'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED'
  approved_branches?: Array<{branch_id:string;name:string;address:string;
    display_reviewed:boolean;gps_verified:false}>
  dealer_declared_sections?: Record<string,Record<string,string>>
  disclosure?: string
  publication_event_id?: string
}
type DuplicateRedirectEnvelope = {
  redirect_id: string
  duplicate_seed_dealer_id: string
  canonical_seed_dealer_id: string
  canonical_slug: string
  canonical_path: string
  canonical_name: string
  canonical_city: string
  source_custody_preserved: true
  legal_entity_merged: false
}
// R6 security #3: the public gallery JSON is metadata only; each image is fetched separately
// from `image_path` (relative to the API base), one bounded object per request.
type StorefrontMediaItem = {
  media_key: string
  seed_dealer_id: string
  branch_name: string | null
  mime_type: string
  media_category: string
  caption: string
  alt_text: string
  image_path: string
  rights_attestation: string
  logo_rights_approved: false
  approved_at: string
}
type ReviewedResearchContacts={
  seed_dealer_id:string;reviewed_public_address:string|null;
  reviewed_public_phone:string|null;reviewed_public_website:string|null;
  source_checked_at:string|null;source_label?:string;business_verified:false
}
type ClaimScope = 'BRANCH' | 'PARENT_ORGANIZATION'
type RepresentativeRelationship =
  'LEGAL_OWNER' | 'DIRECTOR' | 'AUTHORIZED_REPRESENTATIVE' |
  'BRANCH_MANAGER' | 'PARENT_DELEGATE'
const API = resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window === 'undefined' ? undefined : window.location.hostname)

/**
 * Stable public canonical metadata. Research prelisting is NOT business, OEM,
 * VIN, title or payment certification. A previously claimed, currently
 * unapproved storefront is noindex to prevent misleading stale snippets.
 */
function applyDealerPublicSeo(profile:ResearchProfile|null){
 if(typeof document==='undefined')return
 document.querySelectorAll('[data-carup-dealer-seo="true"]').forEach(node=>node.remove())
 const robots=document.createElement('meta')
 robots.name='robots'
 robots.content=profile?.business_verified?'index,follow':
  profile?.claimed?'noindex,follow':profile?'index,follow':'noindex,follow'
 robots.setAttribute('data-carup-dealer-seo','true')
 document.head.appendChild(robots)
 if(!profile)return
 const trust=profile.business_verified?
  'Independently reviewed dealership; individual VINs, affiliations and payments remain separate':
  profile.claimed?
  'An approved claim exists but full public legal dealership verification is not current':
  'Research listing only; legal ownership, operation and stock are not independently verified'
 const description=document.createElement('meta')
 description.name='description'
 description.content=profile.name+' in '+profile.city+', Zimbabwe. '+trust+'. CarUp published research subject to correction.'
 description.setAttribute('data-carup-dealer-seo','true')
 document.head.appendChild(description)
 const canonical=document.createElement('link')
 canonical.rel='canonical'
 canonical.href=window.location.origin+'/dealers/'+encodeURIComponent(profile.slug)
 canonical.setAttribute('data-carup-dealer-seo','true')
 document.head.appendChild(canonical)
}
/**
 * The storefront inventory endpoint returns canonical Marketplace listing summaries (the same
 * public summary the Marketplace grid renders), at most a bounded first page of them.
 */
type StorefrontListing=MarketplaceListingSummary

const SECTION_ICONS:Record<string,LucideIcon>={
  BUSINESS_OVERVIEW:Building2,BUYER_ASSURANCE:ShieldCheck,FINANCE_TERMS:Wallet,
  SOURCING:Ship,WARRANTY_AFTERSALES:Wrench,SERVICE_CAPABILITIES:Settings2,
}
const PRIMARY_CTA='bg-orange-700 text-white shadow-sm hover:bg-orange-800 hover:text-white focus-visible:ring-orange-500/50'
// The theme's outline hover is white text on --accent orange (#f97415, 2.8:1); hover to dark orange
// text on orange-50 instead (≈10:1).
const QUIET_HOVER='hover:bg-orange-50 hover:text-orange-900'
/** What the hero badge does — and does not — attest (lead review: never overstate the check). */
const LEGAL_REVIEW_BADGE_NOTE="CarUp independently reviewed this dealership's legal registration and current operating authority; individual cars, franchises, lenders and warranties are not verified by this badge"

function withVin(previous:ReadonlySet<string>,vin:string,saved:boolean):ReadonlySet<string>{
  const next=new Set(previous)
  if(saved)next.add(vin)
  else next.delete(vin)
  return next
}

function SectionHeader({id,icon:Icon,title,meta,children}:{
  id:string;icon:LucideIcon;title:string;meta?:ReactNode;children?:ReactNode
}){
  return <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white"
        aria-hidden="true"><Icon className="h-5 w-5"/></span>
      <div className="min-w-0">
        <h2 id={id} className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h2>
        {meta&&<p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{meta}</p>}
      </div>
    </div>
    {children}
  </div>
}

function ProfileStat({label,value,muted=false}:{label:string;value:ReactNode;muted?:boolean}){
  return <div className="min-w-0 bg-white px-4 py-4 sm:px-6">
    <dt className="text-[13px] font-medium leading-5 text-slate-600">{label}</dt>
    <dd className={cn('mt-1 [overflow-wrap:anywhere]',muted?
      'text-sm font-semibold leading-snug text-slate-700 sm:pt-1':'text-xl font-black leading-tight text-slate-950 sm:text-2xl')}>{value}</dd>
  </div>
}

/** The same stable URL is retained when a full approved dealer eventually upgrades this profile. */
export default function DealerResearchProfile({ claimMode = false }: { claimMode?: boolean }) {
  const { seedId } = useParams<{seedId: string}>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const redirectedFrom = searchParams.get('redirected_from')
  const { user, token } = useAuth()
  // Destructured on purpose: the aggregate object is new every render.
  const { saveMarketplaceListing, unsaveMarketplaceListing, fetchSavedMarketplaceListings } = useCarUpApi()
  const [profile, setProfile] = useState<ResearchProfile | null>(null)
  const [reviewedContacts,setReviewedContacts]=useState<ReviewedResearchContacts|null>(null)
  const [contactAvailability,setContactAvailability]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [loaded, setLoaded] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [scope, setScope] = useState<ClaimScope>('BRANCH')
  const [relationship, setRelationship] = useState<RepresentativeRelationship>('AUTHORIZED_REPRESENTATIVE')
  const [legalName, setLegalName] = useState('')
  const [statement, setStatement] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [claimOutcome, setClaimOutcome] = useState<'pending-evidence' | 'failed' | null>(null)
  const [claimError, setClaimError] = useState('')
  // R4 P0-2 (C19): canonical Marketplace stock of an APPROVED storefront only. Each entry is the
  // canonical public Marketplace detail; nothing here is a dealership-specific vehicle projection.
  const [stock,setStock]=useState<StorefrontListing[]|null>(null)
  const [stockState,setStockState]=useState<'idle'|'loading'|'ready'|'unavailable'>('idle')
  // R5 T22: independently approved dealership facility/showroom gallery media (no OEM/logo rights).
  const [mediaItems,setMediaItems]=useState<StorefrontMediaItem[]|null>(null)
  const [mediaState,setMediaState]=useState<'idle'|'loading'|'ready'|'unavailable'>('idle')
  // The signed-in shopper's own saved Marketplace vehicles (the existing vehicle save capability;
  // CarUp has no dealership save/like).
  const [savedVins,setSavedVins]=useState<ReadonlySet<string>>(()=>new Set())
  const savedMutatedRef=useRef(false)

  useEffect(() => {
    const key = seedId?.toUpperCase()
    let active = true
    const originalTitle=typeof document==='undefined'?'':document.title
    const cleanup=()=>{
      active=false
      if(typeof document!=='undefined'){
        document.querySelectorAll('[data-carup-dealer-seo="true"]').forEach(node=>node.remove())
        document.title=originalTitle
      }
    }
    if (!key || !/^ZW-DEAL-\d{4}$/.test(key)) {
      void Promise.resolve().then(()=>{if(active)setLoaded('missing')})
      applyDealerPublicSeo(null)
      return cleanup
    }
    void Promise.resolve().then(()=>{if(active)setLoaded('loading')})
    apiRequest<{profile: ResearchProfile | null; redirect?: DuplicateRedirectEnvelope}>({
      baseUrl: API, path: '/dealership/research/' + encodeURIComponent(key),
    }).then(result => {
      if (!active) return
      if (!result.profile && result.redirect?.canonical_slug) {
        navigate(
          `/dealers/${encodeURIComponent(result.redirect.canonical_slug)}?redirected_from=${encodeURIComponent(result.redirect.duplicate_seed_dealer_id)}`,
          { replace: true },
        )
        return
      }
      if (!result.profile) {
        setLoaded('missing')
        applyDealerPublicSeo(null)
        return
      }
      setProfile(result.profile)
      setLoaded('ready')
      setReviewedContacts(null)
      setContactAvailability('loading')
      apiRequest<{contacts:ReviewedResearchContacts}>({
        baseUrl:API,
        path:'/dealership/research/'+encodeURIComponent(key)+'/contact',
      }).then(detail=>{
        if(!active)return
        setReviewedContacts(detail.contacts)
        setContactAvailability('ready')
      }).catch(()=>{
        if(!active)return
        setReviewedContacts(null)
        setContactAvailability('unavailable')
      })
      setStock(null)
      setMediaItems(null)
      if(result.profile.business_verified){
        setStockState('loading')
        apiRequest<{inventory:{entries:StorefrontListing[]}}>({baseUrl:API,
          path:'/dealership/research/'+encodeURIComponent(key)+'/inventory'})
          .then(r=>{if(active){setStock(r.inventory.entries||[]);setStockState('ready')}})
          .catch(()=>{if(active){setStock(null);setStockState('unavailable')}})
        setMediaState('loading')
        apiRequest<{media:{items:StorefrontMediaItem[]}}>({baseUrl:API,
          path:'/dealership/research/'+encodeURIComponent(key)+'/media'})
          .then(r=>{if(active){setMediaItems(r.media.items||[]);setMediaState('ready')}})
          .catch(()=>{if(active){setMediaItems(null);setMediaState('unavailable')}})
      }else{
        setStockState('idle')
        setMediaState('idle')
      }
      if(typeof document!=='undefined'){
        document.title=result.profile.name+(result.profile.business_verified?
          ' · Reviewed dealer storefront · CarUp':
           result.profile.claimed?' · Claim recorded; public approval unavailable · CarUp':
           ' · Unclaimed research · CarUp dealers')
        applyDealerPublicSeo(result.profile)
      }
    }).catch((error: unknown) => {
      if (!active) return
      const status = error && typeof error === 'object' && 'status' in error
        ? (error as {status?: number}).status : undefined
      setLoaded(status === 404 ? 'missing' : 'error')
      applyDealerPublicSeo(null)
    })
    return cleanup
  }, [seedId, navigate])

  const signedIn=Boolean(user&&token)
  const hasStock=(stock?.length??0)>0
  // Reflect the shopper's ACTUAL saved state; guests never see a stored or guessed heart.
  useEffect(()=>{
    if(!signedIn||!hasStock)return
    let active=true
    fetchSavedMarketplaceListings()
      .then(response=>{
        // A click already told us the newer truth; never overwrite it with an older read.
        if(active&&!savedMutatedRef.current){
          setSavedVins(new Set((response.listings||[]).map(listing=>listing.vin).filter(Boolean)))
        }
      })
      .catch(()=>{/* hearts stay un-filled rather than guessing */})
    return()=>{active=false}
  },[signedIn,hasStock,fetchSavedMarketplaceListings])

  const persistSaved=useCallback(async(vin:string,save:boolean)=>{
    savedMutatedRef.current=true
    setSavedVins(previous=>withVin(previous,vin,save))
    try{
      if(save)await saveMarketplaceListing(vin)
      else await unsaveMarketplaceListing(vin)
      return true
    }catch{
      setSavedVins(previous=>withVin(previous,vin,!save))
      toast.error('Could not update saved cars. Please try again.')
      return false
    }
  },[saveMarketplaceListing,unsaveMarketplaceListing])

  const toggleSaved=useCallback(async(vin:string,vehicleName:string)=>{
    if(!signedIn){
      toast('Sign in to save vehicles to your CarUp account.',{
        action:{label:'Sign in',onClick:()=>navigate(loginWithReturnTo(location.pathname))},
      })
      return
    }
    const save=!savedVins.has(vin)
    if(!(await persistSaved(vin,save)))return
    toast.success(save?vehicleName+' saved to your cars':vehicleName+' removed from saved cars',{
      action:{label:'Undo',onClick:()=>{
        void persistSaved(vin,!save).then(ok=>{
          if(ok)toast(save?'Removed from saved cars':'Saved to your cars again')
        })
      }},
    })
  },[signedIn,savedVins,persistSaved,navigate,location.pathname])

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !user || !token || submitting) return
    setSubmitting(true)
    setClaimError('')
    setClaimOutcome(null)
    try {
      const authHeaders: AuthHeaders = { 'x-session-token': token, 'x-user-id': user.id }
      await apiRequest({
        baseUrl: API,
        path: '/dealership/research/' + encodeURIComponent(profile.seed_dealer_id) + '/claim',
        options: { method: 'POST', body: JSON.stringify({
          claimed_scope: scope, representative_relationship: relationship,
          asserted_legal_business_name: legalName, claim_statement: statement,
        }) },
        authHeaders,
      })
      setClaimOutcome('pending-evidence')
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'Could not submit the claim')
      setClaimOutcome('failed')
    } finally { setSubmitting(false) }
  }

  function scrollToSection(id:string){
    const target=document.getElementById(id)
    if(!target)return
    target.scrollIntoView({behavior:'smooth',block:'start'})
    target.focus({preventScroll:true})
  }

  const verified=Boolean(profile?.business_verified)
  const branches=profile?.approved_branches||[]
  const coverItem=newestMediaOf(mediaItems,COMPANY_COVER_IMAGE,'approved_at')
  const avatarItem=newestMediaOf(mediaItems,COMPANY_PROFILE_IMAGE,'approved_at')
  const galleryItems=(mediaItems||[]).filter(item=>!IDENTITY_MEDIA_CATEGORIES.has(item.media_category))
  const declaredSections=Object.entries(profile?.dealer_declared_sections||{})
  const overview=profile?.dealer_declared_sections?.BUSINESS_OVERVIEW
  const policySections=declaredSections.filter(([section])=>section!=='BUSINESS_OVERVIEW')
  const contactRows=reviewedContacts&&contactAvailability==='ready'?[
    reviewedContacts.reviewed_public_address,reviewedContacts.reviewed_public_phone,
    reviewedContacts.reviewed_public_website,
  ].filter(Boolean).length:0
  const showGallery=mediaState==='loading'||mediaState==='unavailable'||galleryItems.length>0

  return (
    <div className="min-h-screen bg-slate-50" data-testid="dealer-public-profile">
      <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <Link
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-slate-700 underline-offset-4 hover:text-orange-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          to="/dealers"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to dealership directory
        </Link>
        {loaded === 'loading' && <div className="mt-4" aria-busy="true">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="h-36 animate-pulse bg-slate-200 sm:h-48 lg:h-60" />
            <div className="flex flex-col gap-3 px-4 pb-6 sm:flex-row sm:items-end sm:px-6 lg:px-8">
              <div className="-mt-12 h-24 w-24 shrink-0 rounded-2xl bg-slate-300 ring-4 ring-white sm:-mt-14 sm:h-28 sm:w-28" />
              <div className="w-full max-w-md space-y-2 pb-1">
                <div className="h-7 w-3/4 animate-pulse rounded bg-slate-200" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
              </div>
            </div>
          </div>
          <p role="status" className="mt-4 text-sm text-slate-600">Loading reviewed research profile…</p>
        </div>}
        {loaded === 'error' && <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-950">Dealership profile unavailable</h1>
            <p role="alert" className="mt-1 text-slate-800">The reviewed research profile service is unavailable.</p>
          </div>
        </div>}
        {loaded === 'missing' && <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Store className="mx-auto h-10 w-10 text-slate-500" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-bold text-slate-950">Dealership profile not found</h1>
          <p className="mx-auto mt-2 max-w-md text-slate-700" role="alert">
            This research profile has not been published, is withheld, or is no longer available.
          </p>
          <Link className="mt-4 inline-block text-sm font-semibold text-orange-700 underline underline-offset-4" to="/dealers">
            Browse the dealership directory
          </Link>
        </div>}
        {loaded === 'ready' && profile && (
          <>
            {redirectedFrom && /^ZW-DEAL-\d{4}$/i.test(redirectedFrom) && (
              <div
                role="status"
                data-testid="dealer-duplicate-redirect-banner"
                className="mt-4 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
                <p className="min-w-0 [overflow-wrap:anywhere]">
                  Redirected from reconciled duplicate research record{' '}
                  <strong>{redirectedFrom.toUpperCase()}</strong> to canonical profile{' '}
                  <strong>{profile.seed_dealer_id}</strong>. Original source and claim custody remain
                  preserved without merging legal entities.
                </p>
              </div>
            )}

            {/* ── Hero: cover, avatar, identity, status and the one primary action ── */}
            <section aria-labelledby="dealer-profile-name"
              className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <DealerProfileCover src={coverItem?API+coverItem.image_path:null} alt={coverItem?.alt_text} />
              <div className="px-4 pb-6 sm:px-6 lg:px-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
                  <DealerProfileAvatar className="-mt-12 sm:-mt-14"
                    src={avatarItem?API+avatarItem.image_path:null} alt={avatarItem?.alt_text} name={profile.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-5 sm:pt-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        {verified?<Badge className="border-emerald-200 bg-emerald-50 text-emerald-800"
                          title={LEGAL_REVIEW_BADGE_NOTE}>
                          <BadgeCheck aria-hidden="true" />Legally reviewed dealership
                          <span className="sr-only">: {LEGAL_REVIEW_BADGE_NOTE}</span></Badge>
                        :profile.claimed?<Badge className="border-amber-200 bg-amber-50 text-amber-900">
                          <ShieldAlert aria-hidden="true" />Claim recorded</Badge>
                        :<Badge className="border-slate-200 bg-slate-100 text-slate-800">
                          <FileText aria-hidden="true" />Research listing</Badge>}
                        {verified&&<Badge variant="outline" className="border-slate-200 text-slate-700">
                          <MapPin aria-hidden="true" />{branches.length} reviewed {plural(branches.length,'branch','branches')}
                        </Badge>}
                      </div>
                      <h1 id="dealer-profile-name"
                        className="mt-2 text-2xl font-black leading-tight tracking-tight text-slate-950 [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl">
                        {profile.name}
                      </h1>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />{profile.city}, Zimbabwe
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Tag className="h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
                          <span className="[overflow-wrap:anywhere]">{profile.category}</span>
                        </span>
                      </p>
                    </div>
                    {verified?(
                      <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0 lg:pt-7">
                        <Button type="button" className={cn(PRIMARY_CTA,'h-11 px-5')}
                          onClick={()=>scrollToSection('dealer-vehicles')}>
                          <Car aria-hidden="true" />Browse vehicles
                        </Button>
                        <Button type="button" variant="outline" className={cn('h-11 px-5',QUIET_HOVER)}
                          onClick={()=>scrollToSection('dealer-branches')}>
                          <MapPin aria-hidden="true" />See branches
                        </Button>
                      </div>
                    ):!profile.claimed&&!claimMode?(
                      <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0 lg:pt-7">
                        <Button asChild className={cn(PRIMARY_CTA,'h-11 px-5')}>
                          <Link to={`/dealers/${profile.slug}/claim`}>
                            <BadgeCheck aria-hidden="true" />Claim this dealership
                          </Link>
                        </Button>
                        <Button asChild variant="outline" className={cn('h-11 px-5',QUIET_HOVER)}>
                          <Link to={`/dealers/${profile.slug}/correction`}>Request correction or removal</Link>
                        </Button>
                      </div>
                    ):null}
                  </div>
                </div>
              </div>
              {verified&&<dl className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 lg:grid-cols-4">
                <ProfileStat label="Reviewed branches" value={branches.length} />
                <ProfileStat label="Vehicles listed now"
                  value={stockState==='ready'&&stock?stock.length:stockState==='unavailable'?'Not available':'…'}
                  muted={stockState==='unavailable'} />
                <ProfileStat label="Storefront reviewed" value={dealerDate(profile.reviewed_at)} />
                <ProfileStat label="Customer ratings" value="No customer ratings yet" muted />
              </dl>}
            </section>

            {/* ── Status: what CarUp did (and did not) review, in one short block ── */}
            {verified?(
              <section aria-labelledby="dealer-verification-heading"
                className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white" aria-hidden="true">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="dealer-verification-heading" className="font-bold text-emerald-950 [overflow-wrap:anywhere]">{profile.label}</h2>
                  <p className="mt-1 text-sm leading-6 text-emerald-900">
                    Legal dealership and currently active operating authority were independently reviewed. This does not verify any individual car, franchise, lender, logo, warranty or merchant.
                  </p>
                </div>
              </section>
            ):(
              <section aria-labelledby="dealer-status-heading"
                className={cn('mt-4 flex items-start gap-3 rounded-2xl border p-4 sm:p-5',
                  profile.claimed?'border-amber-200 bg-amber-50':'border-slate-200 bg-white shadow-sm')}>
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white',
                  profile.claimed?'bg-amber-700':'bg-slate-700')} aria-hidden="true">
                  {profile.claimed?<ShieldAlert className="h-5 w-5" />:<Info className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <h2 id="dealer-status-heading"
                    className={cn('font-bold [overflow-wrap:anywhere]',profile.claimed?'text-amber-950':'text-slate-950')}>
                    {profile.label}
                  </h2>
                  <p className={cn('mt-1 text-sm leading-6',profile.claimed?'text-amber-900':'text-slate-700')}>
                    {profile.information_notice}
                  </p>
                  {profile.claimed&&<Link
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-950 underline underline-offset-4 hover:text-amber-800"
                    to={`/dealers/${profile.slug}/correction`}>
                    Request independent correction, dispute or ownership transfer
                  </Link>}
                </div>
              </section>
            )}

            {verified&&claimMode&&<section aria-labelledby="dealer-claimed-notice-heading"
              className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 sm:p-5">
              <h2 id="dealer-claimed-notice-heading" className="font-bold">This dealership is already claimed</h2>
              <p className="mt-1 leading-6">
                This business already has a claim-linked approved operating organization.
                New ownership requests must go through a separate independently reviewed
                transfer or dispute, not the unclaimed self-service flow.
              </p>
              <Link className="mt-3 inline-block font-semibold underline underline-offset-4"
                to={`/dealers/${profile.slug}/correction`}>
                Request correction, dispute or removal
              </Link>
            </section>}

            {/* ── Approved storefront sections ── */}
            {verified&&<>
              <section id="dealer-vehicles" tabIndex={-1} aria-labelledby="dealer-vehicles-heading"
                className="mt-10 scroll-mt-24 focus:outline-none" data-testid="dealer-storefront-inventory">
                <SectionHeader id="dealer-vehicles-heading" icon={Car} title="Vehicles on CarUp Marketplace"
                  meta={stockState==='ready'&&stock?
                    `${stock.length} ${plural(stock.length,'vehicle')} listed now · open a listing for its own Vehicle Passport`:
                    'Listings published through CarUp Marketplace'} />
                {stockState==='loading'&&<div className="mt-5">
                  <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
                    {[0,1,2].map(index=><div key={index} className="h-72 animate-pulse rounded-2xl bg-slate-200" />)}
                  </div>
                  <p role="status" className="mt-3 text-sm text-slate-600">Loading listed vehicles…</p>
                </div>}
                {stockState==='unavailable'&&<p role="alert"
                  className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
                  Listed vehicles are unavailable right now. This is not a statement that the dealer has no stock.</p>}
                {stockState==='ready'&&stock&&stock.length===0&&<div
                  className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
                  <Car className="mx-auto h-9 w-9 text-slate-400" aria-hidden="true" />
                  <p className="mx-auto mt-3 max-w-md text-sm text-slate-700">
                    No vehicles from this dealership are currently published on CarUp Marketplace.</p>
                  <Link className="mt-3 inline-block text-sm font-semibold text-orange-700 underline underline-offset-4"
                    to="/marketplace">Browse all vehicles on CarUp</Link>
                </div>}
                {/* The shared card's "Image unavailable" placeholder text is gray-400 on gray-100 (2.3:1);
                    raise it to an AA-contrast slate within this storefront only. */}
                {stockState==='ready'&&stock&&stock.length>0&&<div
                  className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3 [&_[data-testid=listing-image-placeholder]]:text-slate-600">
                  {stock.map(item=>{
                    const model=marketplaceListingToCardModel(item)
                    return <MarketplaceListingCard
                      key={item.vin}
                      vehicle={model}
                      href={'/marketplace/listing/'+encodeURIComponent(item.vin)}
                      isFavorite={signedIn&&savedVins.has(item.vin)}
                      onFavorite={event=>{
                        event.preventDefault()
                        event.stopPropagation()
                        void toggleSaved(item.vin,model.name)
                      }}
                      dataTestId="dealer-storefront-vehicle-card"
                      ctaLabel="View vehicle"
                    />
                  })}
                </div>}
              </section>

              {overview&&Object.keys(overview).length>0&&<section aria-labelledby="dealer-about-heading" className="mt-12">
                <SectionHeader id="dealer-about-heading" icon={Building2} title="About the dealership"
                  meta="In the dealer's own words, reviewed for display" />
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  {overview.public_description&&<p
                    className="whitespace-pre-wrap text-base leading-7 text-slate-800 [overflow-wrap:anywhere]">
                    {overview.public_description}</p>}
                  {Object.entries(overview).some(([field])=>field!=='public_description')&&<dl
                    className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3',overview.public_description&&'mt-5 border-t border-slate-100 pt-5')}>
                    {Object.entries(overview).filter(([field])=>field!=='public_description').map(([field,value])=>
                      <div key={field} className="min-w-0">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{declaredFieldLabel(field)}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800 [overflow-wrap:anywhere]">{value}</dd>
                      </div>)}
                  </dl>}
                </div>
              </section>}

              <section id="dealer-branches" tabIndex={-1} aria-labelledby="dealer-branches-heading"
                className="mt-12 scroll-mt-24 focus:outline-none">
                <SectionHeader id="dealer-branches-heading" icon={MapPin} title="Reviewed dealership branches"
                  meta="Addresses approved for public display" />
                {branches.length===0&&<p className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
                  No individually published branches are available.</p>}
                {branches.length>0&&<ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {branches.map(branch=><li key={branch.branch_id}
                    className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700" aria-hidden="true">
                        <Store className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-950 [overflow-wrap:anywhere]">{branch.name}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{branch.address}</p>
                      </div>
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      {branch.display_reviewed&&<Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">
                        <CheckCircle2 aria-hidden="true" />Display reviewed</Badge>}
                      <Badge variant="outline" className="border-slate-200 text-slate-700">
                        <Navigation aria-hidden="true" />GPS not verified</Badge>
                    </div>
                  </li>)}
                </ul>}
              </section>

              <section aria-labelledby="dealer-services-heading" className="mt-12">
                <SectionHeader id="dealer-services-heading" icon={ShieldCheck} title="Services & policies"
                  meta="Declared by the dealer and reviewed for display — not a CarUp guarantee" />
                {policySections.length===0&&<p className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
                  No dealer-supplied policy text is published.</p>}
                {policySections.length>0&&<div className="mt-5 grid gap-4 md:grid-cols-2">
                  {policySections.map(([section,fields])=><DeclaredSectionCard key={section}
                    title={declaredSectionLabel(section)} icon={SECTION_ICONS[section]||FileText} fields={fields} />)}
                </div>}
              </section>

              {showGallery&&<section aria-labelledby="dealer-gallery-heading" className="mt-12"
                data-testid="dealer-storefront-media-gallery">
                <SectionHeader id="dealer-gallery-heading" icon={ImageIcon} title="Facility & showroom photos"
                  meta="Dealer-owned photos reviewed for display · No OEM/brand logo rights approved" />
                {mediaState==='loading'&&<div className="mt-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
                    {[0,1,2,3].map(index=><div key={index} className="aspect-[4/3] animate-pulse rounded-2xl bg-slate-200" />)}
                  </div>
                  <p role="status" className="mt-3 text-sm text-slate-600">Loading facility photos…</p>
                </div>}
                {mediaState==='unavailable'&&<p role="alert"
                  className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
                  Reviewed dealership facility photos are temporarily unavailable.
                </p>}
                {mediaState==='ready'&&galleryItems.length>0&&<div className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {galleryItems.map(item=><figure key={item.media_key}
                    data-testid={`dealer-storefront-media-item-${item.media_key}`}
                    className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <img
                      src={API+item.image_path}
                      alt={item.alt_text}
                      loading="lazy"
                      className="aspect-[4/3] w-full bg-slate-100 object-cover"
                    />
                    <figcaption className="space-y-1 p-3">
                      <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{item.caption}</p>
                      <p className="text-xs text-slate-600 [overflow-wrap:anywhere]">
                        {mediaCategoryLabel(item.media_category)}
                        {item.branch_name?` · ${item.branch_name}`:''}
                      </p>
                    </figcaption>
                  </figure>)}
                </div>}
              </section>}
            </>}

            {/* ── Research / claimed listings: location, reviewed contacts, claim ── */}
            {!verified&&<div className={cn('mt-6 grid gap-4 md:grid-cols-2',!profile.claimed&&!claimMode&&'lg:grid-cols-3')}>
              <section aria-labelledby="dealer-location-heading"
                className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700" aria-hidden="true">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <h2 id="dealer-location-heading" className="text-lg font-bold text-slate-950">Location</h2>
                </div>
                <p className="mt-4 text-xl font-black text-slate-950">{profile.city}, Zimbabwe</p>
                <p className="mt-1 text-sm text-slate-600">Research city only — not a verified street address.</p>
              </section>
              <section aria-labelledby="dealer-contact-heading"
                className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700" aria-hidden="true">
                    <Phone className="h-5 w-5" />
                  </span>
                  <h2 id="dealer-contact-heading" className="text-lg font-bold text-slate-950">Contact details</h2>
                </div>
                {contactAvailability==='loading'&&<div className="mt-4 space-y-2" aria-hidden="true">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                </div>}
                {contactAvailability==='unavailable'&&<p role="status" className="mt-4 text-sm text-amber-900">
                  Publication-reviewed source contact details are unavailable.
                  No unreviewed private source values are shown.
                </p>}
                {reviewedContacts&&contactAvailability==='ready'&&contactRows===0&&<p className="mt-4 text-sm text-slate-700">
                  No reviewed contact details are published for this listing.
                </p>}
                {reviewedContacts&&contactAvailability==='ready'&&contactRows>0&&<dl className="mt-4 space-y-3 text-sm">
                  {reviewedContacts.reviewed_public_address&&<div className="flex items-start gap-2">
                    <dt><MapPin className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" /><span className="sr-only">Research address reviewed for display</span></dt>
                    <dd className="min-w-0 text-slate-800 [overflow-wrap:anywhere]">{reviewedContacts.reviewed_public_address}</dd>
                  </div>}
                  {reviewedContacts.reviewed_public_phone&&<div className="flex items-start gap-2">
                    <dt><Phone className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" /><span className="sr-only">Research business phone reviewed for display</span></dt>
                    <dd className="min-w-0 text-slate-800 [overflow-wrap:anywhere]">{reviewedContacts.reviewed_public_phone}</dd>
                  </div>}
                  {reviewedContacts.reviewed_public_website&&<div className="flex items-start gap-2">
                    <dt><Globe className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" /><span className="sr-only">Website</span></dt>
                    <dd className="min-w-0">
                      <a className="font-medium text-orange-700 underline underline-offset-4 [overflow-wrap:anywhere]" target="_blank"
                        rel="noopener noreferrer nofollow"
                        href={reviewedContacts.reviewed_public_website}>
                        Reviewed source business website
                      </a>
                    </dd>
                  </div>}
                </dl>}
                {reviewedContacts&&contactAvailability==='ready'&&reviewedContacts.source_checked_at&&<p className="mt-auto pt-4 text-xs text-slate-600">
                  Contact display review:
                  {' '}{dealerDate(reviewedContacts.source_checked_at)}.
                  This is not independent legal-business verification.
                </p>}
              </section>
              {!profile.claimed&&!claimMode&&<section aria-labelledby="dealer-own-heading"
                className="flex min-w-0 flex-col rounded-2xl border border-orange-200 bg-orange-50 p-5 sm:p-6 md:col-span-2 lg:col-span-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-700 text-white" aria-hidden="true">
                    <BadgeCheck className="h-5 w-5" />
                  </span>
                  <h2 id="dealer-own-heading" className="text-lg font-bold text-slate-950">Own this business?</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">
                  Claim the listing to manage it on CarUp. You provide evidence and CarUp reviews it
                  independently before any dealer access is granted.
                </p>
                <Link className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-orange-800 underline underline-offset-4 hover:text-orange-900"
                  to={`/dealers/${profile.slug}/claim`}>
                  Start a claim
                </Link>
              </section>}
            </div>}

            {!verified&&!profile.claimed&&claimMode&&(
              <section id="claim" aria-labelledby="dealer-claim-heading"
                className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-700 text-white" aria-hidden="true">
                    <BadgeCheck className="h-5 w-5" />
                  </span>
                  <h2 id="dealer-claim-heading" className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">Request to claim this business</h2>
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  Submitting a claim only opens an evidence-required request. It does not verify ownership,
                  enable editing, grant dealer access or activate a CarUp tenant.
                </p>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  <a className="font-semibold text-orange-700 underline underline-offset-4" href={API+'/dealership/intake/template'}
                    download data-testid="dealer-blank-intake-template">
                    Preview the blank dealership registration workbook (.xlsx)
                  </a>
                  {' '}— after an approved claim you receive your own prefilled copy to complete once.
                </p>
                <div className="mt-6 border-t border-slate-100 pt-6">
                  {!token || !user ? (
                    <p className="text-sm text-slate-800">
                      <Link className="font-semibold text-orange-700 underline underline-offset-4" data-testid="dealer-claim-sign-in"
                        to={loginWithReturnTo(location.pathname)}>
                        Sign in to your CarUp account
                      </Link> before requesting a business claim.
                    </p>
                  ) : claimOutcome === 'pending-evidence' ? (
                    <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                      Request recorded, awaiting documentary proof and independent review.
                      No dealership control has been granted. Go to My Claim Applications to submit private evidence, follow independent review, and—only after approval—download your prefilled workbook.
                      <p className="mt-3"><Link className="font-semibold underline underline-offset-4" to="/dealers/claims">Open My Claim Applications</Link></p>
                    </div>
                  ) : (
                    <form onSubmit={submitClaim} className="max-w-3xl space-y-5">
                      <div className="grid gap-5 md:grid-cols-2">
                        <div className="min-w-0">
                          <label htmlFor="dealer-claim-scope" className="mb-1.5 block text-sm font-medium text-slate-900">Claim scope</label>
                          <select id="dealer-claim-scope" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
                            value={scope} onChange={event => setScope(event.target.value as ClaimScope)}>
                            <option value="BRANCH">This business branch</option>
                            <option value="PARENT_ORGANIZATION">Parent legal organization</option>
                          </select>
                          {/* Owner UAT: S14 is deferred — say so instead of implying it works. */}
                          <p className="mt-1.5 text-xs leading-5 text-slate-600" data-testid="dealer-unavailable-multi-branch-parent">
                            Not available yet: one claim covers this researched business only. Managing several
                            branches or research listings under one parent organisation is planned but cannot be
                            requested here today.
                          </p>
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="dealer-claim-relationship" className="mb-1.5 block text-sm font-medium text-slate-900">Your asserted relationship</label>
                          <select id="dealer-claim-relationship" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
                            value={relationship} onChange={event => setRelationship(event.target.value as RepresentativeRelationship)}>
                            <option value="LEGAL_OWNER">Legal owner</option>
                            <option value="DIRECTOR">Company director</option>
                            <option value="AUTHORIZED_REPRESENTATIVE">Authorized representative</option>
                            <option value="BRANCH_MANAGER">Branch manager</option>
                            <option value="PARENT_DELEGATE">Parent-company delegate</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="dealer-claim-legal-name" className="mb-1.5 block text-sm font-medium text-slate-900">Legal business name (as asserted)</label>
                        <Input id="dealer-claim-legal-name" required minLength={2} maxLength={180}
                          value={legalName} onChange={event => setLegalName(event.target.value)} />
                      </div>
                      <div>
                        <label htmlFor="dealer-claim-statement" className="mb-1.5 block text-sm font-medium text-slate-900">Explain your authority to represent the business</label>
                        <textarea id="dealer-claim-statement" className="min-h-28 w-full rounded-md border border-slate-300 p-3 text-sm" required
                          minLength={30} maxLength={2000} value={statement}
                          onChange={event => setStatement(event.target.value)} />
                        <p className="mt-1.5 text-xs leading-5 text-slate-600">
                          Do not enter passport numbers, tax IDs or sensitive documents here. Original proof must be submitted through private evidence intake when available.
                        </p>
                      </div>
                      {claimError && (
                        <p role="alert" className="flex items-center gap-2 text-sm text-red-700">
                          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{claimError}
                        </p>
                      )}
                      <Button type="submit" disabled={submitting} className={cn(PRIMARY_CTA,DEALER_WRAP_BUTTON,'min-h-11 px-5')}>
                        {submitting ? 'Submitting…' : 'Submit evidence-required claim request'}
                      </Button>
                    </form>
                  )}
                </div>
              </section>
            )}

            {/* ── Disclosures: always available, never dominating ── */}
            <details className="group mt-12 rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="dealer-profile-about">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-3">
                  <Info className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-bold text-slate-950">About this profile</span>
                    <span className="block text-sm text-slate-600">Sources, what was reviewed and legal information</span>
                  </span>
                </span>
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="space-y-3 border-t border-slate-100 px-5 py-5 text-sm leading-6 text-slate-700 sm:px-6">
                <li>
                  <strong className="font-semibold text-slate-900">Source. </strong>
                  Research source: {profile.source_attribution}.
                  {verified?
                    ' Public branch and dealer-declared details were separately reviewed for display.'
                    :' Reviewed for limited publication, not for company authority.'}
                  {' '}Profile reviewed {dealerDate(profile.reviewed_at)}.
                </li>
                {verified&&<>
                  <li>
                    <strong className="font-semibold text-slate-900">Services &amp; policies. </strong>
                    {profile.disclosure||'These specific dealer declarations were reviewed for display, not certified as financing offers, legal warranty rights or business guarantees.'}
                  </li>
                  <li>
                    <strong className="font-semibold text-slate-900">Vehicles. </strong>
                    Each vehicle passed CarUp&apos;s own Marketplace publication checks. The dealership&apos;s
                    approval does not verify any individual car; open a listing for its own details.
                  </li>
                  <li>
                    <strong className="font-semibold text-slate-900">Branches &amp; photos. </strong>
                    Branch details were independently approved for public display; GPS and live opening status
                    are not verified. Facility photographs are dealer-owned and reviewed for public storefront
                    display; no OEM or third-party brand logo rights are approved.
                  </li>
                  <li>
                    <strong className="font-semibold text-slate-900">Not measured. </strong>
                    Buyer reviews and complaint totals: Not measured. VIN-specific inventory
                    and vehicle duty status: Not verified by this company profile.
                  </li>
                  {!claimMode&&<li>
                    <strong className="font-semibold text-slate-900">Ownership. </strong>
                    This business already has a claim-linked approved operating organization.
                    New ownership requests must go through a separate independently reviewed
                    transfer or dispute, not the unclaimed self-service flow.
                  </li>}
                </>}
                {!verified&&profile.claimed&&<li>
                  <strong className="font-semibold text-slate-900">Ownership. </strong>
                  A reviewed company claim is already recorded. This research profile does
                  not currently carry approved full-dealership verification. A different
                  person cannot claim the business through the unclaimed form; CarUp must
                  independently review an ownership transfer, dispute or correction.
                </li>}
                {!verified&&<li>
                  <strong className="font-semibold text-slate-900">Not asserted. </strong>
                  No CarUp-verified licence, official franchise affiliation, current stock, reviews, sale record, warranty or payment eligibility is asserted by this listing.
                </li>}
              </ul>
            </details>

            {verified&&!claimMode&&<p className="mt-4 text-sm text-slate-600">
              Spotted something wrong?{' '}
              <Link className="font-semibold text-orange-700 underline underline-offset-4"
                to={`/dealers/${profile.slug}/correction`}>
                Request correction, dispute or removal
              </Link>
            </p>}
            {!verified&&!profile.claimed&&claimMode&&<p className="mt-4 text-sm text-slate-600">
              Not the owner?{' '}
              <Link className="font-semibold text-orange-700 underline underline-offset-4" to={`/dealers/${profile.slug}/correction`}>
                Report inaccurate information or request correction/removal
              </Link>
            </p>}
          </>
        )}
      </div>
    </div>
  )
}
