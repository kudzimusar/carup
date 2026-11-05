import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MapPin, Store, AlertTriangle, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'

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
/** The same stable URL is retained when a full approved dealer eventually upgrades this profile. */
export default function DealerResearchProfile({ claimMode = false }: { claimMode?: boolean }) {
  const { seedId } = useParams<{seedId: string}>()
  const { user, token } = useAuth()
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
    apiRequest<{profile: ResearchProfile}>({
      baseUrl: API, path: '/dealership/research/' + encodeURIComponent(key),
    }).then(result => {
      if (!active) return
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
  }, [seedId])

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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="section-padding mx-auto max-w-3xl py-10">
        <Link className="text-sm text-blue-700 underline underline-offset-4" to="/dealers">Back to dealership directory</Link>
        {loaded === 'loading' && <p role="status" className="mt-7">Loading reviewed research profile…</p>}
        {loaded === 'error' && <p role="alert" className="mt-7">The reviewed research profile service is unavailable.</p>}
        {loaded === 'missing' && <p className="mt-7" role="alert">
          This research profile has not been published, is withheld, or is no longer available.
        </p>}
        {loaded === 'ready' && profile && (
          <>
            <div className="mt-8 flex items-start gap-4">
              <div className="w-16 h-16 rounded-xl bg-slate-800 text-white flex items-center justify-center"
                aria-hidden="true"><Store className="w-8 h-8" /></div>
              <div className="min-w-0">
                <h1 className="text-3xl font-bold break-words">{profile.name}</h1>
                <p className="text-sm text-gray-600 mt-1">{profile.category}</p>
              </div>
            </div>
            <Card className={'mt-7 '+(profile.business_verified?'border-blue-200':'border-amber-200')}>
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <ShieldAlert className={'w-5 h-5 shrink-0 '+
                    (profile.business_verified?'text-blue-700':'text-amber-700')} aria-hidden="true" />
                  <div>
                    <h2 className={'font-bold '+(profile.business_verified?
                      'text-blue-900':'text-amber-900')}>{profile.label}</h2>
                    <p className="text-sm text-gray-700 mt-1">
                      {profile.business_verified
                        ?'Legal dealership and currently active operating authority were independently reviewed. This does not verify any individual car, franchise, lender, logo, warranty or merchant.'
                        :profile.information_notice}
                    </p>
                    <p className="text-xs text-gray-500 mt-3">
                      Research source: {profile.source_attribution}.
                      {profile.business_verified?
                        ' Public branch and dealer-declared details were separately reviewed for display.'
                        :' Reviewed for limited publication, not for company authority.'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            {profile.business_verified&&<div className="space-y-5 mt-6">
              <Card><CardContent className="p-6">
                <h2 className="text-xl font-semibold">Reviewed dealership branches</h2>
                {(!profile.approved_branches||profile.approved_branches.length===0)&&
                  <p className="text-sm text-gray-600 mt-3">No individually published branches are available.</p>}
                {profile.approved_branches?.map(branch=><div key={branch.branch_id}
                  className="mt-4 border-t pt-3">
                  <h3 className="font-semibold">{branch.name}</h3>
                  <p className="text-sm text-gray-700">{branch.address}</p>
                  <p className="text-xs text-gray-500">
                    Branch details independently approved for public display;
                    GPS and live opening status are not verified.
                  </p>
                </div>)}
              </CardContent></Card>
              <Card><CardContent className="p-6">
                <h2 className="text-xl font-semibold">Dealer-declared services and buyer information</h2>
                <p className="text-sm text-gray-600 mt-2">
                  These specific dealer declarations were reviewed for display, not certified as
                  financing offers, legal warranty rights or business guarantees.
                </p>
                {Object.entries(profile.dealer_declared_sections||{}).map(([section,fields])=>
                  <section key={section} className="mt-5 border-t pt-4">
                    <h3 className="font-semibold">{section.replaceAll('_',' ')}</h3>
                    <dl className="mt-2 space-y-3">
                      {Object.entries(fields).map(([field,value])=>
                        <div key={field}>
                          <dt className="text-sm font-medium text-gray-600">{field.replaceAll('_',' ')}</dt>
                          <dd className="text-sm text-gray-900 whitespace-pre-wrap break-words">{value}</dd>
                        </div>)}
                    </dl>
                  </section>)}
                {Object.keys(profile.dealer_declared_sections||{}).length===0&&
                  <p className="mt-3 text-sm text-gray-600">No dealer-supplied policy text is published.</p>}
                <p className="text-xs text-gray-500 mt-4">
                  Buyer reviews and complaint totals: Not measured. VIN-specific inventory
                  and vehicle duty status: Not verified by this company profile.
                </p>
              </CardContent></Card>
            </div>}
            {!profile.business_verified&&<Card className="mt-6">
              <CardContent className="p-6">
                <h2 className="font-semibold text-xl mb-3">Researched business location</h2>
                <div className="flex items-center gap-2 text-gray-700">
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  <span>{profile.city}, Zimbabwe (research city only)</span>
                </div>

                {contactAvailability==='unavailable'&&<p role="status" className="mt-3 text-sm text-amber-800">
                  Publication-reviewed source contact details are unavailable.
                  No unreviewed private source values are shown.
                </p>}
                {reviewedContacts&&contactAvailability==='ready'&&
                  <div className="mt-4 space-y-2 text-sm">
                    {reviewedContacts.reviewed_public_address&&<p>
                      <strong>Research address reviewed for display:</strong>
                      {' '}{reviewedContacts.reviewed_public_address}
                    </p>}
                    {reviewedContacts.reviewed_public_phone&&<p>
                      <strong>Research business phone reviewed for display:</strong>
                      {' '}{reviewedContacts.reviewed_public_phone}
                    </p>}
                    {reviewedContacts.reviewed_public_website&&<p>
                      <a className="text-blue-700 underline" target="_blank"
                        rel="noopener noreferrer nofollow"
                        href={reviewedContacts.reviewed_public_website}>
                        Reviewed source business website
                      </a>
                    </p>}
                    {reviewedContacts.source_checked_at&&<p className="text-xs text-gray-500">
                      Contact display review:
                      {' '}{new Date(reviewedContacts.source_checked_at).toLocaleDateString()}.
                      This is not independent legal-business verification.
                    </p>}
                  </div>}
                <p className="text-sm text-gray-500 mt-3">
                  No CarUp-verified licence, official franchise affiliation, current stock, reviews, sale record, warranty or payment eligibility is asserted by this listing.
                </p>
              </CardContent>
            </Card>}
            {profile.business_verified?(
              <div className="mt-6">
                <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 p-4 rounded-lg">
                  This business already has a claim-linked approved operating organization.
                  New ownership requests must go through a separate independently reviewed
                  transfer or dispute, not the unclaimed self-service flow.
                </p>
                <Link className="inline-block text-sm text-blue-700 underline mt-3"
                  to={`/dealers/${profile.slug}/correction`}>
                  Request correction, dispute or removal
                </Link>
              </div>
            ):profile.claimed ? (
              <div className="mt-6">
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 p-4 rounded-lg">
                  A reviewed company claim is already recorded. This research profile does
                  not currently carry approved full-dealership verification. A different
                  person cannot claim the business through the unclaimed form; CarUp must
                  independently review an ownership transfer, dispute or correction.
                </p>
                <Link className="inline-block text-sm text-blue-700 underline mt-3"
                  to={`/dealers/${profile.slug}/correction`}>
                  Request independent correction, dispute or ownership transfer
                </Link>
              </div>
            ):claimMode ? (
              <Card className="mt-6">
                <CardContent className="p-6">
                  <h2 className="font-semibold text-xl mb-2">Request to claim this business</h2>
                  <p className="text-sm text-gray-600 mb-5">
                    Submitting a claim only opens an evidence-required request. It does not verify ownership,
                    enable editing, grant dealer access or activate a CarUp tenant.
                  </p>
                  {!token || !user ? (
                    <p className="text-sm">
                      <Link className="text-blue-700 underline" to="/login">
                        Sign in to your CarUp account
                      </Link> before requesting a business claim.
                    </p>
                  ) : claimOutcome === 'pending-evidence' ? (
                    <div role="status" className="bg-slate-50 border rounded-lg p-4">
                      Request recorded, awaiting documentary proof and independent review.
                      No dealership control has been granted. Go to My Claim Applications to submit private evidence, follow independent review, and—only after approval—download your prefilled workbook.
                      <p className="mt-3"><Link className="text-blue-700 underline" to="/dealers/claims">Open My Claim Applications</Link></p>
                    </div>
                  ) : (
                    <form onSubmit={submitClaim} className="space-y-4">
                      <div>
                        <label htmlFor="dealer-claim-scope" className="block text-sm font-medium mb-1">Claim scope</label>
                        <select id="dealer-claim-scope" className="w-full border p-2 rounded-md"
                          value={scope} onChange={event => setScope(event.target.value as ClaimScope)}>
                          <option value="BRANCH">This business branch</option>
                          <option value="PARENT_ORGANIZATION">Parent legal organization</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="dealer-claim-relationship" className="block text-sm font-medium mb-1">Your asserted relationship</label>
                        <select id="dealer-claim-relationship" className="w-full border p-2 rounded-md"
                          value={relationship} onChange={event => setRelationship(event.target.value as RepresentativeRelationship)}>
                          <option value="LEGAL_OWNER">Legal owner</option>
                          <option value="DIRECTOR">Company director</option>
                          <option value="AUTHORIZED_REPRESENTATIVE">Authorized representative</option>
                          <option value="BRANCH_MANAGER">Branch manager</option>
                          <option value="PARENT_DELEGATE">Parent-company delegate</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="dealer-claim-legal-name" className="block text-sm font-medium mb-1">Legal business name (as asserted)</label>
                        <Input id="dealer-claim-legal-name" required minLength={2} maxLength={180}
                          value={legalName} onChange={event => setLegalName(event.target.value)} />
                      </div>
                      <div>
                        <label htmlFor="dealer-claim-statement" className="block text-sm font-medium mb-1">Explain your authority to represent the business</label>
                        <textarea id="dealer-claim-statement" className="w-full border rounded-md p-3 min-h-28" required
                          minLength={30} maxLength={2000} value={statement}
                          onChange={event => setStatement(event.target.value)} />
                        <p className="text-xs text-gray-500 mt-1">
                          Do not enter passport numbers, tax IDs or sensitive documents here. Original proof must be submitted through private evidence intake when available.
                        </p>
                      </div>
                      {claimError && (
                        <p role="alert" className="text-sm text-red-700 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" aria-hidden="true" />{claimError}
                        </p>
                      )}
                      <Button type="submit" disabled={submitting}>
                        {submitting ? 'Submitting…' : 'Submit evidence-required claim request'}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-wrap gap-5 mt-8">
                <Link className="text-blue-700 font-semibold underline underline-offset-4"
                  to={`/dealers/${profile.slug}/claim`}>
                  Claim this dealership
                </Link>
                <Link className="text-blue-700 font-semibold underline underline-offset-4" to={`/dealers/${profile.slug}/correction`}>
                  Report inaccurate information or request correction/removal
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
