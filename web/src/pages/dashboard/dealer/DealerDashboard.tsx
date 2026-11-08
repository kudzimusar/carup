import {useCallback,useEffect,useState,type ReactNode} from 'react'
import { dealerDate, dealerDateTime } from '@/lib/dealerDates'
import {Link} from 'react-router-dom'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Badge} from '@/components/ui/badge'
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible'
import {
  AlertTriangle,ArrowRight,ArrowUpRight,BadgeCheck,Car,CheckCircle2,ChevronDown,Clock,CreditCard,
  FileCheck2,FileText,Heart,ImagePlus,MapPin,MessageSquare,Minus,Navigation,Pencil,Plus,RefreshCw,
  ShieldCheck,Store,TrendingDown,TrendingUp,Users,Warehouse,type LucideIcon,
} from 'lucide-react'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
import {cn} from '@/lib/utils'
import {DEALER_WRAP_BUTTON} from '@/components/dealer/dealerButtonWrap'
import {DealerProfileAvatar,DealerProfileCover} from '@/components/dealer/profile/DealerProfileMedia'
import {
  COMPANY_COVER_IMAGE,COMPANY_PROFILE_IMAGE,humanizeKey,newestMediaOf,plural,
} from '@/components/dealer/profile/dealerProfileLabels'

type Profile={
  id:string;legal_name:string|null;trading_name:string|null;tenant_id:string|null
  registration_number?:string|null
  identity_status:string;compliance_review_state:string
  active_state:string;restriction_state:string;suspension_state:string
  investigation_state:string;expiry_date:string|null
}
type Branch={id:string;dealer_id:string;name:string|null;address:string|null;latitude:number|null;longitude:number|null;opening_hours_text:string|null}
/** UAT-R1: where each branch came from. Absent on older APIs; a null entry means "not recorded". */
type BranchSource={
  kind:'PRIMARY_ACTIVATION'|'ATTACHED_BRANCH_CLAIM'|'OWNER_DECLARED'
  seed_dealer_id:string|null;status:string|null
}
type AttachedClaim={
  attachment_id:string;seed_dealer_id:string;claim_id:string;application_version:number|null
  attach_status:string
  effective_status:'ACTIVE'|'SUSPENDED'|'REVOKED'|'SUSPENDED_WITH_DEALERSHIP'|'LEGAL_REVIEW_EXPIRED'|string
  legal_expires_at:string|null;attached_at:string|null
  branches:{branch_id:string;name:string|null;has_gps:boolean;has_hours:boolean}[]
  sections_carried:string[];sections_preserved:string[];counts?:Record<string,number>
}
type Workspace={
  operational:true;owner_membership_confirmed:true;
  tenant_id:string;organization_id:string;claim_id:string;dealer_profile_id:string;
  seed_dealer_id?:string|null;
  profile:Profile;branches:Branch[];recorded_tenant_member_count:number;
  branch_sources?:Record<string,BranchSource|null>|null;
  attached_claims?:AttachedClaim[]|null;attached_claims_available?:boolean;
  current_staff_headcount:null;actual_revenue:null;vehicle_listing_authority:false;
}
type RecordedVehicle={
  vin:string;make:string|null;model:string|null;year:number|null;
  recorded_lifecycle_state:string|null;
  recorded_marketplace_publication_state:string|null;
  seller_authority:'NOT_DETERMINED_BY_TENANT_INVENTORY_READ';
  public_listing_approved_by_this_read:false;
}
type Inventory={
  owner_tenant_id:string;entries:RecordedVehicle[];returned_count:number;actual_total:null;
  count_scope:'FIRST_100_CANONICAL_TENANT_VEHICLES_ONLY';
  seller_publish_action_enabled:false;
}
type Carryover={
  application_version:number|null;activated_at:string|null
  branches:{branch_ref:string;source_row:number;branch_id:string;name:string|null;has_gps:boolean;has_hours:boolean}[]
  sections:string[];counts:Record<string,number>
  needs_attention:{tab:string;row:number;field:string;disposition:string;reason:string}[]
  independently_verified:false;publicly_approved:false
}
/** UAT-R1 performance cards: exact counts from canonical records, each with its labelled scope. */
type Metric={
  value:number|null;scope?:string;status?:string
  last_30_days?:number|null;previous_30_days?:number|null
}
type PerformanceSummary={tenant_id?:string;generated_at:string|null;metrics:Partial<Record<string,Metric>>}
/** Only the presentation fields are typed: no media identity is ever read from this list. */
type OwnerMediaItem={
  media_category:string;caption?:string|null;alt_text?:string|null
  review_status:'PENDING_INDEPENDENT_REVIEW'|'APPROVED_PUBLIC_DISPLAY'|'REJECTED'|'RETRACTED'|string
  created_at:string|null
}
/** reviewStatus null = could not be determined; then no review badge is claimed either way. */
type OwnerImage={url:string;alt:string;reviewStatus:string|null}
const PENDING_REVIEW='PENDING_INDEPENDENT_REVIEW'
const SERVED_REVIEW_STATES:ReadonlySet<string>=new Set([PENDING_REVIEW,'APPROVED_PUBLIC_DISPLAY'])
const SECTION_LABELS:Record<string,string>={
  BUSINESS_OVERVIEW:'Business overview',BUYER_ASSURANCE:'Buyer assurance',
  FINANCE_TERMS:'Finance terms',SOURCING:'Sourcing',
  WARRANTY_AFTERSALES:'Warranty & aftersales',SERVICE_CAPABILITIES:'Service capabilities',
}
const DEFERRED='DEFERRED_NEW_PRODUCT_CAPABILITY_REQUIRED'
const MEASURED_METRICS:Array<[string,string,LucideIcon]>=[
  ['published_vehicles','Published vehicles',Car],
  ['recorded_vehicles','Recorded vehicles',Warehouse],
  ['buyer_enquiries','Buyer enquiries',MessageSquare],
  ['qualified_enquiries','Qualified enquiries',BadgeCheck],
  ['vehicle_saves','Vehicle saves',Heart],
]
const METRIC_LABELS:Record<string,string>={
  customer_rating:'Customer rating',customer_reviews:'Customer reviews',
  dealership_saves:'Dealership saves',likes:'Likes',
}
// Fills the remainder of the 4-column performance row after the measured tiles.
const DEFERRED_SPAN=['lg:col-span-4','lg:col-span-3','lg:col-span-2','lg:col-span-1']
const QUICK_ACTIONS:Array<[string,string,LucideIcon]>=[
  ['Manage stock','/dealers/stock',Car],
  ['Buyer enquiries','/dealers/inquiries',MessageSquare],
  ['Operating details','/dealers/operating-details',Store],
  ['Staff','/dealers/staff',Users],
]
const CLAIM_STATUS:Record<string,{label:string;className:string}>={
  ACTIVE:{label:'Active',className:'border-emerald-200 bg-emerald-50 text-emerald-800'},
  SUSPENDED:{label:'Suspended',className:'border-amber-200 bg-amber-50 text-amber-900'},
  SUSPENDED_WITH_DEALERSHIP:{label:'Suspended with dealership',className:'border-amber-200 bg-amber-50 text-amber-900'},
  LEGAL_REVIEW_EXPIRED:{label:'Legal review expired',className:'border-red-200 bg-red-50 text-red-800'},
  REVOKED:{label:'Revoked',className:'border-red-200 bg-red-50 text-red-800'},
}
const GOOD_BADGE='border-emerald-200 bg-emerald-50 text-emerald-800'
const WARN_BADGE='border-amber-200 bg-amber-50 text-amber-900'
const BAD_BADGE='border-red-200 bg-red-50 text-red-800'
const NEUTRAL_BADGE='border-slate-200 bg-slate-50 text-slate-700'
const CARD='rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6'
// The theme's outline/ghost hover is white text on --accent orange (#f97415, 2.8:1). Every quiet
// button here hovers to dark orange text on orange-50 instead (≈10:1).
const QUIET_HOVER='hover:bg-orange-50 hover:text-orange-900'
const SOLID_ORANGE='bg-orange-700 text-white shadow-sm hover:bg-orange-800 hover:text-white'
type Status='loading'|'ready'|'missing'|'error'
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
function authHeaders(userId:string,token:string):AuthHeaders{
  return {'x-session-token':token,'x-user-id':userId}
}
function claimStatus(status:string|null|undefined){
  return CLAIM_STATUS[String(status)]||{label:status?humanizeKey(status):'Status not recorded',className:NEUTRAL_BADGE}
}
function branchSourceLabel(source:BranchSource|null|undefined):string|null{
  if(!source)return null
  if(source.kind==='PRIMARY_ACTIVATION')return source.seed_dealer_id?'From claim '+source.seed_dealer_id:'From your approved claim'
  if(source.kind==='ATTACHED_BRANCH_CLAIM')return source.seed_dealer_id?'Attached claim '+source.seed_dealer_id:'Attached claim'
  if(source.kind==='OWNER_DECLARED')return 'Added by you'
  return null
}

function MetricTile({icon:Icon,label,metric,className}:{
  icon:LucideIcon;label:string;metric:Metric|undefined;className?:string
}){
  const value=metric?.value
  const measured=typeof value==='number'&&Number.isFinite(value)
  const last=metric?.last_30_days
  const previous=metric?.previous_30_days
  const trend=typeof last==='number'&&typeof previous==='number'?last-previous:null
  return <div className={cn('flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5',className)}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700" aria-hidden="true">
        <Icon className="h-4 w-4"/>
      </span>
    </div>
    <p className={cn('mt-1',measured?'text-3xl font-black tracking-tight text-slate-950':'pt-1.5 text-base font-semibold text-slate-600')}>
      {measured?value.toLocaleString('en-US'):'Not available'}
    </p>
    {trend!==null&&<p className={cn('mt-1.5 flex items-start gap-1 text-xs font-semibold',
      trend>0?'text-emerald-700':trend<0?'text-red-700':'text-slate-600')}>
      {trend>0?<TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>:trend<0?
        <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>:<Minus className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>}
      <span>{last} in the last 30 days · {previous} in the 30 before</span>
    </p>}
    {metric?.scope&&<p className="mt-auto pt-2 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">{metric.scope}</p>}
  </div>
}

function SideCard({id,title,icon:Icon,children,testId}:{
  id:string;title:ReactNode;icon:LucideIcon;children:ReactNode;testId?:string
}){
  return <section aria-labelledby={id} className={CARD} data-testid={testId}>
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white" aria-hidden="true">
        <Icon className="h-4 w-4"/>
      </span>
      <h2 id={id} className="min-w-0 text-lg font-black leading-tight tracking-tight text-slate-950">{title}</h2>
    </div>
    {children}
  </section>
}

/**
 * Dealer D7: Source of truth is the claim-linked legal activation service,
 * actual canonical organization/tenant membership, real branches and
 * tenant-scoped VIN read. Global user.role is NOT dealership authority.
 * Neither stock possession nor a company profile proves VIN listing rights.
 */
export default function DealerDashboard(){
  const {user,token}=useAuth()
  const [workspace,setWorkspace]=useState<Workspace|null>(null)
  const [status,setStatus]=useState<Status>('loading')
  const [inventory,setInventory]=useState<Inventory|null>(null)
  const [carryover,setCarryover]=useState<Carryover|null>(null)
  const [stockStatus,setStockStatus]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [performance,setPerformance]=useState<PerformanceSummary|null>(null)
  const [performanceStatus,setPerformanceStatus]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [ownerMedia,setOwnerMedia]=useState<{cover:OwnerImage|null;avatar:OwnerImage|null}>({cover:null,avatar:null})
  const [branchName,setBranchName]=useState('')
  const [branchAddress,setBranchAddress]=useState('')
  const [branchLatitude,setBranchLatitude]=useState('')
  const [branchLongitude,setBranchLongitude]=useState('')
  const [branchHours,setBranchHours]=useState('')
  const [editingBranchId,setEditingBranchId]=useState<string|null>(null)
  const [branchFormOpen,setBranchFormOpen]=useState(false)
  const [saving,setSaving]=useState(false)
  const [notice,setNotice]=useState('')
  const [error,setError]=useState('')
  const [revision,setRevision]=useState(0)
  const refresh=useCallback(()=>setRevision(r=>r+1),[])

  useEffect(()=>{
    let live=true
    if(!user||!token){
      void Promise.resolve().then(()=>{
        if(live){setWorkspace(null);setInventory(null);setStatus('missing');setStockStatus('unavailable')}
      })
      return()=>{live=false}
    }
    void Promise.resolve().then(()=>{
      if(live){
        setWorkspace(null);setInventory(null);setStatus('loading');setStockStatus('loading')
        setPerformance(null);setPerformanceStatus('loading')
      }
    })
    const hdr=authHeaders(user.id,token)
    apiRequest<{workspace:Workspace}>({
      baseUrl:API,path:'/dealer/operational-workspace',authHeaders:hdr,
    }).then(async result=>{
      if(!live)return
      if(!result.workspace?.operational||!result.workspace.owner_membership_confirmed||
        !result.workspace.tenant_id||!result.workspace.dealer_profile_id){
        setStatus('error');setStockStatus('unavailable');setPerformanceStatus('unavailable');return
      }
      setWorkspace(result.workspace);setStatus('ready')
      apiRequest<{carryover:Carryover}>({
        baseUrl:API,path:'/dealer/activation-carryover',authHeaders:hdr,
      }).then(response=>{if(live)setCarryover(response.carryover??null)})
        .catch(()=>{if(live)setCarryover(null)})
      // Exact canonical counts only; a summary for any other tenant is never shown here.
      apiRequest<{summary:PerformanceSummary}>({
        baseUrl:API,path:'/dealer/performance-summary',authHeaders:hdr,
      }).then(response=>{
        if(!live)return
        const summary=response.summary
        if(summary?.metrics&&typeof summary.metrics==='object'&&
          (!summary.tenant_id||summary.tenant_id===result.workspace.tenant_id)){
          setPerformance(summary);setPerformanceStatus('ready')
        }else{
          setPerformance(null);setPerformanceStatus('unavailable')
        }
      }).catch(()=>{if(live){setPerformance(null);setPerformanceStatus('unavailable')}})
      try{
        const response=await apiRequest<{inventory:Inventory}>({
          baseUrl:API,path:'/dealer/operational-inventory',authHeaders:hdr,
        })
        if(!live)return
        // Prevent accidental mixing of a prior tenant's data if access changes.
        if(response.inventory&&Array.isArray(response.inventory.entries)&&
          response.inventory.owner_tenant_id===result.workspace.tenant_id&&
          response.inventory.actual_total===null){
          setInventory(response.inventory);setStockStatus('ready')
        }else{
          setInventory(null);setStockStatus('unavailable')
        }
      }catch{
        if(live){setInventory(null);setStockStatus('unavailable')}
      }
    }).catch(problem=>{
      if(!live)return
      const code=(problem as {status?:number})?.status
      setStatus(code===403||code===404?'missing':'error')
      setStockStatus('unavailable')
      setPerformanceStatus('unavailable')
    })
    return()=>{live=false}
  },[user,token,revision])

  // The owner's own current company cover/profile images, including ones still awaiting independent
  // review: a PRIVATE preview fetched by KIND (never by a media identity) with this session's headers
  // and shown only here as revocable blob: URLs.
  const tenantId=workspace?.tenant_id??null
  useEffect(()=>{
    if(!user||!token||!tenantId)return
    let live=true
    const objectUrls:string[]=[]
    void Promise.resolve().then(()=>{if(live)setOwnerMedia({cover:null,avatar:null})})
    const hdr=authHeaders(user.id,token)
    // Review status and alt text per category from the owner's own media list (the newest pending or
    // approved item is exactly what the kind endpoint serves). No media identity is read or sent.
    const listed=apiRequest<{media:{items:OwnerMediaItem[]}}>({
      baseUrl:API,path:'/dealer/operational-media',authHeaders:hdr,
    }).then(result=>Array.isArray(result.media?.items)?result.media.items:null).catch(()=>null)
    const preview=async(kind:'profile'|'cover',items:OwnerMediaItem[]|null):Promise<OwnerImage|null>=>{
      const current=items?newestMediaOf(items.filter(item=>SERVED_REVIEW_STATES.has(item.review_status)),
        kind==='cover'?COMPANY_COVER_IMAGE:COMPANY_PROFILE_IMAGE,'created_at'):null
      if(items&&!current)return null
      try{
        const response=await fetch(API+'/dealer/operational-media/company-image/'+kind,
          {headers:{...hdr},credentials:'include',cache:'no-store'})
        if(!response.ok)return null
        const blob=await response.blob()
        if(!live||!blob.type.startsWith('image/'))return null
        const url=URL.createObjectURL(blob)
        objectUrls.push(url)
        // The header is authoritative when the API exposes it to this origin; otherwise the list.
        const reviewStatus=response.headers.get('X-CarUp-Review-Status')||current?.review_status||null
        return {url,alt:current?.alt_text||current?.caption||'',reviewStatus}
      }catch{
        return null
      }
    }
    void listed.then(items=>Promise.all([preview('cover',items),preview('profile',items)]))
      .then(([cover,avatar])=>{if(live)setOwnerMedia({cover,avatar})})
    return()=>{
      live=false
      objectUrls.forEach(url=>URL.revokeObjectURL(url))
    }
  },[user,token,tenantId])

  function focusBranchEditor(){
    window.setTimeout(()=>{
      const field=document.getElementById('dealer-new-branch-name')
      field?.scrollIntoView({behavior:'smooth',block:'center'})
      field?.focus({preventScroll:true})
    },50)
  }
  function editBranch(branch:Branch){
    setEditingBranchId(branch.id)
    setBranchName(branch.name||'')
    setBranchAddress(branch.address||'')
    setBranchLatitude(branch.latitude===null?'':String(branch.latitude))
    setBranchLongitude(branch.longitude===null?'':String(branch.longitude))
    setBranchHours(branch.opening_hours_text||'')
    setNotice('');setError('')
    setBranchFormOpen(true);focusBranchEditor()
  }
  function resetBranchForm(){
    setEditingBranchId(null);setBranchName('');setBranchAddress('')
    setBranchLatitude('');setBranchLongitude('');setBranchHours('')
  }
  function startNewBranch(){
    resetBranchForm();setNotice('');setError('')
    setBranchFormOpen(true);focusBranchEditor()
  }
  async function saveBranch(){
    if(!user||!token||!workspace||saving||!branchName.trim()||!branchAddress.trim())return
    setSaving(true);setError('');setNotice('')
    const isEditing=Boolean(editingBranchId)
    try{
      const result=await apiRequest<{branch:Branch &{private_declaration_only:true}}>({
        baseUrl:API,
        path:editingBranchId?'/dealer/operational-branches/'+encodeURIComponent(editingBranchId):
          '/dealer/operational-branches',
        options:{method:editingBranchId?'PATCH':'POST',body:JSON.stringify({
          name:branchName.trim(),address:branchAddress.trim(),
          latitude:branchLatitude.trim()||null,longitude:branchLongitude.trim()||null,
          opening_hours_text:branchHours.trim()||null,
        })},
        authHeaders:authHeaders(user.id,token),
      })
      if(!result.branch?.private_declaration_only)throw Error('Private branch receipt unavailable')
      setNotice(isEditing?'Private branch details updated in canonical storage. Public verification is unchanged.':
        'Private branch added to the canonical dealer profile; public verification is unchanged.')
      resetBranchForm();setBranchFormOpen(false);refresh()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Canonical branch submission unavailable')
    }finally{setSaving(false)}
  }

  const p=workspace?.profile
  const branches=workspace?.branches||[]
  const count=workspace?.recorded_tenant_member_count
  const vehicles=stockStatus==='ready'?inventory?.entries||[]:[]
  const displayName=p?(p.trading_name||p.legal_name||'Legal company name unavailable'):''
  const seed=workspace?.seed_dealer_id||null
  const publicHref=seed?'/dealers/'+encodeURIComponent(seed.toLowerCase()):null
  const attachedClaims=Array.isArray(workspace?.attached_claims)?workspace.attached_claims:null
  const metrics=performance?.metrics||{}
  const measuredMetrics=MEASURED_METRICS.filter(([key])=>metrics[key]?.status!==DEFERRED)
  const deferredMetrics=Object.entries(metrics)
    .filter((entry):entry is [string,Metric]=>Boolean(entry[1])&&entry[1]?.status===DEFERRED)
  const statusBadges:Array<[string,string]>=p?[
    [p.active_state==='active'?'Active':'Tenant '+humanizeKey(p.active_state).toLowerCase(),
      p.active_state==='active'?GOOD_BADGE:BAD_BADGE],
    [p.identity_status==='verified'?'Identity verified':'Identity '+humanizeKey(p.identity_status).toLowerCase(),
      p.identity_status==='verified'?GOOD_BADGE:WARN_BADGE],
    [p.compliance_review_state==='passed'?'Compliance passed':'Compliance '+humanizeKey(p.compliance_review_state).toLowerCase(),
      p.compliance_review_state==='passed'?GOOD_BADGE:WARN_BADGE],
    ...(p.suspension_state&&p.suspension_state!=='none'?
      [['Suspension: '+humanizeKey(p.suspension_state).toLowerCase(),BAD_BADGE] as [string,string]]:[]),
    ...(p.restriction_state&&p.restriction_state!=='none'?
      [['Restrictions: '+humanizeKey(p.restriction_state).toLowerCase(),WARN_BADGE] as [string,string]]:[]),
    ...(p.investigation_state&&p.investigation_state!=='none'?
      [['Investigation: '+humanizeKey(p.investigation_state).toLowerCase(),WARN_BADGE] as [string,string]]:[]),
  ]:[]
  const pendingNote='Awaiting independent review — only you can see this'

  return <div className="space-y-6" data-testid="real-dealer-dashboard">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Dealership operations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Your approved dealership at a glance. Every figure comes from live CarUp records.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={refresh} disabled={saving} className={cn('h-9 bg-white',QUIET_HOVER)}>
          <RefreshCw className="h-4 w-4" aria-hidden="true"/>Refresh
        </Button>
        <Button asChild variant="ghost" size="sm" className={cn('h-9 text-slate-700',QUIET_HOVER)}>
          <Link to="/dealers/claims">My claim applications</Link>
        </Button>
      </div>
    </header>
    {status==='loading'&&<div aria-busy="true" className="space-y-4">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="h-32 animate-pulse bg-slate-200 sm:h-44"/>
        <div className="space-y-2 p-6"><div className="h-6 w-1/3 animate-pulse rounded bg-slate-200"/>
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200"/></div>
      </div>
      <p role="status" className="text-sm text-slate-600">Checking independent legal authorization and canonical dealer membership…</p>
    </div>}
    {status==='missing'&&<section className={CARD}>
      <AlertTriangle className="mb-2 h-6 w-6 text-amber-700" aria-hidden="true"/>
      <h2 className="font-semibold">No active, independently approved dealer tenant for this session</h2>
      <p className="mt-2 text-sm text-slate-600">
        Claim approval, an unclaimed research directory listing, or a commercial payment
        alone cannot unlock dealer operations. Complete independent legal review and
        canonical organization/tenant activation first.
      </p>
      <Link className="mt-3 inline-block text-sm font-semibold text-orange-700 underline underline-offset-4" to="/dealers/claims">
        Review my application and compliance status
      </Link>
    </section>}
    {status==='error'&&<p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
      Live canonical dealership authority could not be established.
      No dealer controls or business statistics are assumed available.
    </p>}
    {status==='ready'&&workspace&&p&&<>
      {/* ── Hero: identity images, names, live status and quick actions ── */}
      <section aria-labelledby="dealer-dashboard-name"
        className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <DealerProfileCover src={ownerMedia.cover?.url} alt={ownerMedia.cover?.alt} className="h-32 sm:h-44 lg:h-52">
          {ownerMedia.cover?.reviewStatus===PENDING_REVIEW&&<span
            className="absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-md">
            <Clock className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true"/>{pendingNote}
          </span>}
        </DealerProfileCover>
        <div className="px-4 pb-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
            <div className="shrink-0">
              <DealerProfileAvatar className="-mt-12 sm:-mt-14" src={ownerMedia.avatar?.url}
                alt={ownerMedia.avatar?.alt} name={displayName}/>
              {ownerMedia.avatar?.reviewStatus===PENDING_REVIEW&&<p
                className="mt-2 flex max-w-[11rem] items-start gap-1 text-xs font-medium leading-4 text-amber-900">
                <Clock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true"/>{pendingNote}
              </p>}
            </div>
            <div className="min-w-0 flex-1 sm:pt-4">
              <div className="flex flex-wrap gap-1.5">
                {statusBadges.map(([label,className])=><Badge key={label}
                  className={cn('whitespace-normal text-left',className)}>{label}</Badge>)}
                <Badge className={cn('whitespace-normal text-left',NEUTRAL_BADGE)}>
                  Legal review expires {dealerDate(p.expiry_date)}
                </Badge>
              </div>
              <h2 id="dealer-dashboard-name"
                className="mt-2 text-2xl font-black leading-tight tracking-tight text-slate-950 [overflow-wrap:anywhere] sm:text-3xl">
                {displayName}
              </h2>
              <p className="mt-1 text-sm text-slate-600 [overflow-wrap:anywhere]">
                <span className="font-medium text-slate-700">Registered legal entity: </span>
                <span data-testid="dealer-canonical-registered-legal-name">{p.legal_name||'Not recorded'}</span>
                {p.registration_number&&<span className="text-slate-600"> · Reg. {p.registration_number}</span>}
              </p>
              {(!ownerMedia.cover||!ownerMedia.avatar)&&<Link to="/dealers/operating-details"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700 underline underline-offset-4 hover:text-orange-800">
                <ImagePlus className="h-4 w-4" aria-hidden="true"/>Add a company profile image
              </Link>}
            </div>
          </div>
          <nav aria-label="Dealership quick actions" className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {QUICK_ACTIONS.map(([label,to,Icon])=><Button key={to} asChild variant="outline"
              className={cn(DEALER_WRAP_BUTTON,'min-h-11 justify-start gap-2 bg-white px-4 font-semibold text-slate-900 sm:justify-center',QUIET_HOVER)}>
              <Link to={to}><Icon className="h-4 w-4 text-orange-700" aria-hidden="true"/>{label}</Link>
            </Button>)}
            {publicHref&&<Button asChild
              className={cn(DEALER_WRAP_BUTTON,'col-span-2 min-h-11 justify-center gap-2 px-4 font-semibold',SOLID_ORANGE)}>
              <Link to={publicHref}>View public profile<ArrowUpRight className="h-4 w-4" aria-hidden="true"/></Link>
            </Button>}
          </nav>
        </div>
      </section>

      {/* ── Performance: measured canonical counts; not-yet-existing capabilities say so ── */}
      <section aria-labelledby="dealer-performance-heading">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="dealer-performance-heading" className="text-xl font-black tracking-tight text-slate-950">Performance</h2>
          {performanceStatus==='ready'&&performance?.generated_at&&<p className="text-xs text-slate-600">
            Updated {dealerDateTime(performance.generated_at)}</p>}
        </div>
        {performanceStatus==='loading'&&<div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
          {[0,1,2,3].map(index=><div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-200"/>)}
        </div>}
        {performanceStatus==='unavailable'&&<p role="status"
          className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          Performance figures are not available right now. Nothing is estimated in their place.
        </p>}
        {performanceStatus==='ready'&&<div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {measuredMetrics.map(([key,label,icon],index)=><MetricTile key={key} icon={icon} label={label}
            metric={metrics[key]}
            className={measuredMetrics.length%2===1&&index===measuredMetrics.length-1?'col-span-2 lg:col-span-1':undefined}/>)}
          {deferredMetrics.length>0&&<div className={cn('col-span-2 rounded-2xl border border-dashed border-slate-300 bg-white p-4 sm:p-5',
            DEFERRED_SPAN[measuredMetrics.length%4])}>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Clock className="h-4 w-4 text-slate-500" aria-hidden="true"/>Not available yet
            </p>
            <ul className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {deferredMetrics.map(([key,metric])=><li key={key} className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{METRIC_LABELS[key]||humanizeKey(key)}</p>
                {metric.scope&&<p className="mt-0.5 text-xs leading-5 text-slate-600">{metric.scope}</p>}
              </li>)}
            </ul>
          </div>}
        </div>}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* ── Branches with provenance; the editor stays tucked away until needed ── */}
          <section aria-labelledby="dealer-branches-heading" className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="dealer-branches-heading" className="text-xl font-black tracking-tight text-slate-950">Branches</h2>
                <p className="mt-0.5 text-sm text-slate-600">
                  Recorded company branches: <strong className="text-slate-950">{branches.length}</strong>
                </p>
              </div>
              <Button variant="outline" size="sm" className={cn('h-9',QUIET_HOVER)} onClick={startNewBranch} disabled={saving}>
                <Plus className="h-4 w-4" aria-hidden="true"/>Add a branch
              </Button>
            </div>
            {notice&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
            {error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>}
            {branches.length===0&&<p className="mt-4 text-sm text-slate-600">
              No branches are recorded for this active company.
            </p>}
            {branches.length>0&&<ul className="mt-4 grid gap-3 md:grid-cols-2">
              {branches.map(b=>{
                const source=workspace.branch_sources?.[b.id]
                const sourceLabel=branchSourceLabel(source)
                const hasGps=b.latitude!==null&&b.longitude!==null
                return <li key={b.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 pt-1 font-bold leading-snug text-slate-950 [overflow-wrap:anywhere]">{b.name||'Unnamed branch'}</h3>
                    <Button variant="ghost" size="sm" className={cn('h-8 shrink-0 px-2 text-slate-700',QUIET_HOVER)}
                      aria-label={'Edit '+(b.name||'unnamed branch')} onClick={()=>editBranch(b)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true"/>Edit
                    </Button>
                  </div>
                  {sourceLabel&&<div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge className={cn('whitespace-normal text-left',source?.kind==='OWNER_DECLARED'?NEUTRAL_BADGE:
                      'border-sky-200 bg-sky-50 text-sky-900')}>
                      {source?.kind==='OWNER_DECLARED'?<Pencil aria-hidden="true"/>:<FileCheck2 aria-hidden="true"/>}{sourceLabel}
                    </Badge>
                    {source?.status&&source.status!=='ACTIVE'&&<Badge
                      className={cn('whitespace-normal text-left',claimStatus(source.status).className)}>
                      {claimStatus(source.status).label}</Badge>}
                  </div>}
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    <li className="flex gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true"/>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{b.address||'No address recorded'}</span>
                    </li>
                    <li className="flex gap-2">
                      <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true"/>
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {hasGps?<>Declared GPS {b.latitude}, {b.longitude}{' '}
                          <span className="whitespace-nowrap rounded-full bg-white px-1.5 py-px text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">not verified</span></>
                          :'No GPS declared'}
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true"/>
                      <span className="min-w-0 [overflow-wrap:anywhere]">Declared hours: {b.opening_hours_text||'Not recorded'}</span>
                    </li>
                  </ul>
                </li>
              })}
            </ul>}
            <Collapsible open={branchFormOpen} onOpenChange={setBranchFormOpen}
              className="mt-4 rounded-2xl border border-dashed border-slate-300">
              <CollapsibleTrigger asChild>
                <button type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                  <span className="flex items-center gap-2"><Plus className="h-4 w-4 text-orange-700" aria-hidden="true"/>Add or edit a branch</span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform',branchFormOpen&&'rotate-180')} aria-hidden="true"/>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t border-dashed border-slate-300 px-4 pb-5 pt-4">
                <h3 id="dealer-branch-editor" className="font-semibold text-slate-950">
                  {editingBranchId?'Edit private branch declaration':'Add a private branch declaration'}
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="min-w-0">
                    <label htmlFor="dealer-new-branch-name" className="mb-1.5 block text-sm font-medium">Branch name</label>
                    <Input id="dealer-new-branch-name" value={branchName}
                      maxLength={180} onChange={event=>setBranchName(event.target.value)}/>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="dealer-new-branch-address" className="mb-1.5 block text-sm font-medium">Physical address</label>
                    <Input id="dealer-new-branch-address" value={branchAddress}
                      maxLength={400} onChange={event=>setBranchAddress(event.target.value)}/>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="dealer-branch-latitude" className="mb-1.5 block text-sm font-medium">
                      Latitude (optional)
                    </label>
                    <Input id="dealer-branch-latitude" value={branchLatitude}
                      placeholder="e.g. -17.825500" maxLength={12}
                      onChange={event=>setBranchLatitude(event.target.value)}/>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="dealer-branch-longitude" className="mb-1.5 block text-sm font-medium">
                      Longitude (optional)
                    </label>
                    <Input id="dealer-branch-longitude" value={branchLongitude}
                      placeholder="e.g. 31.050000" maxLength={13}
                      onChange={event=>setBranchLongitude(event.target.value)}/>
                  </div>
                </div>
                <p className="text-xs text-slate-600">
                  Supply both coordinates together or leave both blank. All coordinates remain unverified private declarations.
                </p>
                <div>
                  <label htmlFor="dealer-branch-hours" className="mb-1.5 block text-sm font-medium">
                    Dealer-declared operating hours (optional)
                  </label>
                  <Input id="dealer-branch-hours" value={branchHours} maxLength={350}
                    placeholder="Mon–Fri 08:00–17:00; Sat 09:00–13:00; Sun closed"
                    onChange={event=>setBranchHours(event.target.value)}/>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={()=>{void saveBranch()}} disabled={saving||!branchName.trim()||!branchAddress.trim()}
                    className={cn(DEALER_WRAP_BUTTON,'min-h-10 px-4')}>
                    {editingBranchId?'Save existing branch changes':'Save branch to canonical dealership profile'}
                  </Button>
                  {editingBranchId&&<Button variant="outline" onClick={resetBranchForm} disabled={saving} className={cn('min-h-10',QUIET_HOVER)}>
                    Cancel edit
                  </Button>}
                </div>
                <p className="text-xs text-slate-600">
                  Adding a branch does not grant a franchise, listing, geographic verification or new staff permissions.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </section>

          {/* ── Stock overview: the tenant-scoped first-100 VIN read ── */}
          <section aria-labelledby="dealer-stock-heading" className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 id="dealer-stock-heading" className="text-xl font-black tracking-tight text-slate-950">Stock overview</h2>
              <Button asChild variant="outline" size="sm" className={cn('h-9',QUIET_HOVER)}>
                <Link to="/dealers/stock">Manage stock<ArrowRight className="h-4 w-4" aria-hidden="true"/></Link>
              </Button>
            </div>
            <div className="mt-4 flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white" aria-hidden="true">
                <Car className="h-5 w-5"/>
              </span>
              <div className="min-w-0">
                <p className="text-sm text-slate-600">Recorded VINs · first 100</p>
                <strong className="block text-2xl font-black leading-tight text-slate-950">{stockStatus==='ready'?vehicles.length:'Not available'}</strong>
                <p className="text-xs text-slate-600">Not a total stock count or permission to publish/sell vehicles.</p>
              </div>
            </div>
            {stockStatus==='unavailable'&&<p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Scoped inventory could not be read. This is not proof of zero vehicles.
            </p>}
            {stockStatus==='ready'&&vehicles.length===0&&<p className="mt-4 text-sm text-slate-600">
              No vehicles were returned in the tenant&apos;s first 100 recorded VINs.
            </p>}
            {vehicles.length>0&&<ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {vehicles.slice(0,6).map(v=>{
                const published=v.recorded_marketplace_publication_state==='published'
                return <li key={v.vin} className="flex min-w-0 gap-3 rounded-2xl border border-slate-200 p-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700" aria-hidden="true">
                    <Car className="h-5 w-5"/>
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug text-slate-950 [overflow-wrap:anywhere]">
                      {[v.year,v.make||'Make not recorded',v.model||'Model not recorded'].filter(Boolean).join(' ')}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-600 [overflow-wrap:anywhere]">VIN {v.vin}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge className={cn('whitespace-normal text-left',NEUTRAL_BADGE)}>
                        {v.recorded_lifecycle_state?humanizeKey(v.recorded_lifecycle_state):'Lifecycle status not recorded'}
                      </Badge>
                      <Badge className={cn('whitespace-normal text-left',published?GOOD_BADGE:NEUTRAL_BADGE)}>
                        {published?'Published':v.recorded_marketplace_publication_state?
                          humanizeKey(v.recorded_marketplace_publication_state):'Not published'}
                      </Badge>
                    </div>
                  </div>
                </li>
              })}
            </ul>}
            {vehicles.length>6&&<p className="mt-3 text-sm text-slate-600">
              {vehicles.length-6} more {plural(vehicles.length-6,'vehicle')} in Manage stock.
            </p>}
            <p className="mt-4 text-xs text-slate-600">
              Seller authority, duty, ownership, VIN-specific evidence and listing publication must be separately verified.
            </p>
          </section>

          {carryover&&<SideCard id="dealer-carryover-heading" title="Carried from your approved application"
            icon={CheckCircle2} testId="dealer-activation-carryover">
            <div className="mt-4 grid gap-x-8 gap-y-4 text-sm text-slate-700 md:grid-cols-2">
              <p className="md:col-span-2">
                Application version {carryover.application_version??'—'} was copied into your operating
                profile, so there is nothing to retype. Carried details stay private: none of it is verified or public.
              </p>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">
                  {carryover.branches.length} {plural(carryover.branches.length,'branch','branches')} carried
                </p>
                <ul className="mt-2 space-y-2">
                  {carryover.branches.map(b=><li key={b.branch_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 font-medium text-slate-900 [overflow-wrap:anywhere]">{b.name||'Unnamed branch'}</span>
                    <span className="text-xs text-slate-600">GPS {b.has_gps?'carried':'not provided'} · hours {b.has_hours?'carried':'not provided'}</span>
                  </li>)}
                </ul>
              </div>
              <div className="min-w-0 space-y-4">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-900">Policy sections carried:</span>{' '}
                  {carryover.sections.length?carryover.sections.map(s=><Badge key={s} className={NEUTRAL_BADGE}>
                    {SECTION_LABELS[s]||s}</Badge>):'none'}
                </p>
                {(carryover.counts.RETAINED_PRIVATE_NOT_CANONICAL||0)>0&&<p data-testid="dealer-carryover-retained"
                  className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                  {carryover.counts.RETAINED_PRIVATE_NOT_CANONICAL} other declared detail(s) — for example licences,
                  brand relationships or extra policy wording — stay private in your approved application because
                  CarUp has no operating field for them yet. They are not lost, not published and not verified.
                </p>}
              </div>
              <div className="min-w-0 md:col-span-2">
                {carryover.needs_attention.length===0
                  ?<p className="flex items-start gap-2 text-emerald-800">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true"/>
                    Every carried detail was accepted; none of it needs to be re-entered.
                  </p>
                  :<details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
                    <summary className="cursor-pointer font-semibold">
                      Needs your attention (not carried): {carryover.needs_attention.length}
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {carryover.needs_attention.slice(0,20).map(n=>
                        <li key={n.tab+n.row+n.field} className="[overflow-wrap:anywhere]">
                          {n.tab} row {n.row} · {n.field}: {n.reason}
                        </li>)}
                    </ul>
                    {carryover.needs_attention.length>20&&<p className="mt-1">
                      …and {carryover.needs_attention.length-20} more not shown.</p>}
                  </details>}
              </div>
            </div>
          </SideCard>}
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Claims and compliance">
          <SideCard id="dealer-claims-heading" title="Approved claims" icon={FileCheck2}>
            <ul className="mt-4 space-y-3">
              <li className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-950 [overflow-wrap:anywhere]">{seed||'Primary claim'}</p>
                  <Badge className={claimStatus('ACTIVE').className}>{claimStatus('ACTIVE').label}</Badge>
                </div>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Primary claim</p>
                <p className="mt-2 text-sm text-slate-700">Legal review expires {dealerDate(p.expiry_date)}</p>
              </li>
              {attachedClaims?.map(claim=>{
                const state=claimStatus(claim.effective_status)
                const branchNames=(claim.branches||[]).map(branch=>branch.name||'Unnamed branch')
                return <li key={claim.attachment_id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-slate-950 [overflow-wrap:anywhere]">{claim.seed_dealer_id}</p>
                    <Badge className={cn('whitespace-normal text-left',state.className)}>{state.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Attached claim{claim.application_version?' · version '+claim.application_version:''}
                  </p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <dt className="text-slate-600">Legal expiry</dt><dd className="font-medium text-slate-900">{dealerDate(claim.legal_expires_at)}</dd>
                    </div>
                    {claim.attached_at&&<div className="flex flex-wrap justify-between gap-x-3">
                      <dt className="text-slate-600">Attached</dt><dd className="font-medium text-slate-900">{dealerDate(claim.attached_at)}</dd>
                    </div>}
                    <div>
                      <dt className="text-slate-600">Branches added</dt>
                      <dd className="mt-0.5 font-medium text-slate-900 [overflow-wrap:anywhere]">
                        {branchNames.length?branchNames.join(', '):'None'}
                      </dd>
                    </div>
                    {(claim.sections_carried||[]).length>0&&<div>
                      <dt className="text-slate-600">Sections carried</dt>
                      <dd className="mt-1 flex flex-wrap gap-1.5">
                        {claim.sections_carried.map(section=><Badge key={section} className={NEUTRAL_BADGE}>
                          {SECTION_LABELS[section]||humanizeKey(section)}</Badge>)}
                      </dd>
                    </div>}
                    {(claim.sections_preserved||[]).length>0&&<div>
                      <dt className="text-slate-600">Kept your existing version</dt>
                      <dd className="mt-1 flex flex-wrap gap-1.5">
                        {claim.sections_preserved.map(section=><Badge key={section} className={NEUTRAL_BADGE}>
                          {SECTION_LABELS[section]||humanizeKey(section)}</Badge>)}
                      </dd>
                    </div>}
                  </dl>
                </li>
              })}
            </ul>
            {attachedClaims&&attachedClaims.length===0&&<p className="mt-3 text-sm text-slate-600">
              No other claims are attached to this dealership.
            </p>}
            {workspace.attached_claims===null&&workspace.attached_claims_available!==false&&<p className="mt-3 text-sm text-slate-600">
              Attached claims could not be read right now.
            </p>}
          </SideCard>

          <SideCard id="dealer-compliance-heading" title="Legal & compliance" icon={ShieldCheck}>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                ['Legal identity',humanizeKey(p.identity_status)],
                ['Compliance',humanizeKey(p.compliance_review_state)],
                ['Tenant',humanizeKey(p.active_state)],
                ['Investigation',humanizeKey(p.investigation_state)],
                ['Suspension',humanizeKey(p.suspension_state)],
                ['Restrictions',humanizeKey(p.restriction_state)],
                ['Member role','Canonical legal owner'],
              ].map(([name,value])=><div key={name} className="min-w-0">
                <dt className="text-xs text-slate-500">{name}</dt>
                <dd className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{value}</dd>
              </div>)}
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Canonical tenant memberships</dt>
                <dd className="font-semibold text-slate-900">{Number.isInteger(count)?count:'Not available'}</dd>
              </div>
            </dl>
            <details className="mt-4 text-xs leading-5 text-slate-600">
              <summary className="cursor-pointer font-semibold text-slate-700">What this covers</summary>
              <div className="mt-2 space-y-2">
                <p>
                  Active canonical owner membership checked against the approved company claim,
                  country policy, legal expiry and tenant status.
                </p>
                {p.trading_name&&p.legal_name&&p.trading_name!==p.legal_name&&<p>
                  Trading name and registered legal identity are distinct. Legal review applies
                  to the registered entity; a trading name is not a franchise or brand licence.
                </p>}
                <p>Actual staff headcount, sales, reviews and revenue: Not measured.</p>
              </div>
            </details>
          </SideCard>

          <SideCard id="dealer-tools-heading" title="More tools" icon={FileText}>
            <ul className="mt-3 divide-y divide-slate-100">
              {([
                ['Subscription and merchant readiness','/dealers/billing',CreditCard],
                ['Claim and private evidence history','/dealers/claims',FileCheck2],
                ['Manage operating terms and policies','/dealers/operating-details',Store],
              ] as Array<[string,string,LucideIcon]>).map(([label,url,Icon])=><li key={url+label}>
                <Link to={url}
                  className="flex items-center gap-3 py-2.5 text-sm font-medium text-slate-800 hover:text-orange-700">
                  <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true"/>
                  <span className="min-w-0 flex-1">{label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true"/>
                </Link>
              </li>)}
            </ul>
            <p className="mt-3 text-xs leading-5 text-slate-600">
              Declared terms and branch data stay private until separately approved for public display.
              Invoices, settlement, sales and complaints are never fabricated here.
            </p>
          </SideCard>
        </aside>
      </div>
    </>}
  </div>
}
