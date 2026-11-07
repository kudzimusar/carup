import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Car,MapPin,ShieldCheck,Users,AlertTriangle,ArrowRight,RefreshCw} from 'lucide-react'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Profile={
  id:string;legal_name:string|null;trading_name:string|null;tenant_id:string|null
  identity_status:string;compliance_review_state:string
  active_state:string;restriction_state:string;suspension_state:string
  investigation_state:string;expiry_date:string|null
}
type Branch={id:string;dealer_id:string;name:string|null;address:string|null;latitude:number|null;longitude:number|null;opening_hours_text:string|null}
type Workspace={
  operational:true;owner_membership_confirmed:true;
  tenant_id:string;organization_id:string;claim_id:string;dealer_profile_id:string;
  profile:Profile;branches:Branch[];recorded_tenant_member_count:number;
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
const SECTION_LABELS:Record<string,string>={
  BUSINESS_OVERVIEW:'Business overview',BUYER_ASSURANCE:'Buyer assurance',
  FINANCE_TERMS:'Finance terms',SOURCING:'Sourcing',
  WARRANTY_AFTERSALES:'Warranty & aftersales',SERVICE_CAPABILITIES:'Service capabilities',
}
type Status='loading'|'ready'|'missing'|'error'
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
function authHeaders(userId:string,token:string):AuthHeaders{
  return {'x-session-token':token,'x-user-id':userId}
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
  const [branchName,setBranchName]=useState('')
  const [branchAddress,setBranchAddress]=useState('')
  const [branchLatitude,setBranchLatitude]=useState('')
  const [branchLongitude,setBranchLongitude]=useState('')
  const [branchHours,setBranchHours]=useState('')
  const [editingBranchId,setEditingBranchId]=useState<string|null>(null)
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
      if(live){setWorkspace(null);setInventory(null);setStatus('loading');setStockStatus('loading')}
    })
    const hdr=authHeaders(user.id,token)
    apiRequest<{workspace:Workspace}>({
      baseUrl:API,path:'/dealer/operational-workspace',authHeaders:hdr,
    }).then(async result=>{
      if(!live)return
      if(!result.workspace?.operational||!result.workspace.owner_membership_confirmed||
        !result.workspace.tenant_id||!result.workspace.dealer_profile_id){
        setStatus('error');setStockStatus('unavailable');return
      }
      setWorkspace(result.workspace);setStatus('ready')
      apiRequest<{carryover:Carryover}>({
        baseUrl:API,path:'/dealer/activation-carryover',authHeaders:hdr,
      }).then(response=>{if(live)setCarryover(response.carryover??null)})
        .catch(()=>{if(live)setCarryover(null)})
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
    })
    return()=>{live=false}
  },[user,token,revision])

  function editBranch(branch:Branch){
    setEditingBranchId(branch.id)
    setBranchName(branch.name||'')
    setBranchAddress(branch.address||'')
    setBranchLatitude(branch.latitude===null?'':String(branch.latitude))
    setBranchLongitude(branch.longitude===null?'':String(branch.longitude))
    setBranchHours(branch.opening_hours_text||'')
    setNotice('');setError('')
  }
  function resetBranchForm(){
    setEditingBranchId(null);setBranchName('');setBranchAddress('')
    setBranchLatitude('');setBranchLongitude('');setBranchHours('')
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
      resetBranchForm();refresh()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Canonical branch submission unavailable')
    }finally{setSaving(false)}
  }

  const p=workspace?.profile
  const branches=workspace?.branches||[]
  const count=workspace?.recorded_tenant_member_count
  const vehicles=stockStatus==='ready'?inventory?.entries||[]:[]
  return <main className="max-w-7xl mx-auto space-y-6" data-testid="real-dealer-dashboard">
    <header className="flex flex-wrap justify-between gap-4 items-start">
      <div>
        <h1 className="text-3xl font-bold">Dealership operations</h1>
        <p className="mt-1 text-gray-600">
          Claim-linked legal authority, verified tenant membership and actual stored records.
        </p>
      </div>
      <div className="flex gap-3 items-center">
        <Button variant="outline" onClick={refresh} disabled={saving}>
          <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true"/>Refresh
        </Button>
        <Link to="/dealers/claims" className="text-blue-700 underline text-sm">
          My claim applications
        </Link>
      </div>
    </header>
    {status==='loading'&&<p role="status">Checking independent legal authorization and canonical dealer membership…</p>}
    {status==='missing'&&<Card><CardContent className="p-6">
      <AlertTriangle className="w-6 h-6 text-amber-700 mb-2" aria-hidden="true"/>
      <h2 className="font-semibold">No active, independently approved dealer tenant for this session</h2>
      <p className="text-sm text-gray-600 mt-2">
        Claim approval, an unclaimed research directory listing, or a commercial payment
        alone cannot unlock dealer operations. Complete independent legal review and
        canonical organization/tenant activation first.
      </p>
      <Link className="text-blue-700 underline text-sm inline-block mt-3" to="/dealers/claims">
        Review my application and compliance status
      </Link>
    </CardContent></Card>}
    {status==='error'&&<p role="alert" className="border rounded-lg p-4 bg-red-50 text-red-900">
      Live canonical dealership authority could not be established.
      No dealer controls or business statistics are assumed available.
    </p>}
    {status==='ready'&&workspace&&p&&<>
      <Card><CardContent className="p-6">
        <div className="flex gap-3">
          <ShieldCheck className="w-6 h-6 text-blue-700 shrink-0" aria-hidden="true"/>
          <div className="min-w-0">
            <h2 className="font-semibold text-lg">{p.trading_name||p.legal_name||'Legal company name unavailable'}</h2>
            <p className="text-sm text-gray-800 mt-2">
              <span className="font-medium">Registered legal entity: </span>
              <span data-testid="dealer-canonical-registered-legal-name">{p.legal_name||'Not recorded'}</span>
            </p>
            {p.trading_name&&p.legal_name&&p.trading_name!==p.legal_name&&
              <p className="text-xs text-gray-600 mt-1">
                Trading name and registered legal identity are distinct. Legal review applies
                to the registered entity; a trading name is not a franchise or brand licence.
              </p>}
            <p className="text-sm text-gray-600 mt-1">
              Active canonical owner membership checked against the approved company claim,
              country policy, legal expiry and tenant status.
            </p>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 text-sm">
              {[
                ['Legal identity',p.identity_status],
                ['Compliance',p.compliance_review_state],
                ['Tenant',p.active_state],
                ['Investigation',p.investigation_state],
                ['Suspension',p.suspension_state],
                ['Restrictions',p.restriction_state],
                ['Expires',p.expiry_date?new Date(p.expiry_date).toLocaleDateString():'Not recorded'],
                ['Member role','Canonical legal owner'],
              ].map(([name,value])=><div key={name}>
                <dt className="text-gray-500 text-xs">{name}</dt>
                <dd className="font-medium break-words">{value}</dd>
              </div>)}
            </dl>
          </div>
        </div>
      </CardContent></Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5">
          <Car className="w-5 h-5 text-blue-700 mb-2" aria-hidden="true"/>
          <p className="text-sm text-gray-600">Recorded VINs · first 100</p>
          <strong className="text-2xl">{stockStatus==='ready'?vehicles.length:'Not available'}</strong>
          <p className="text-xs text-gray-500 mt-2">
            Not a total stock count or permission to publish/sell vehicles.
          </p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <MapPin className="w-5 h-5 text-blue-700 mb-2" aria-hidden="true"/>
          <p className="text-sm text-gray-600">Recorded company branches</p>
          <strong className="text-2xl">{branches.length}</strong>
          <p className="text-xs text-gray-500 mt-2">Includes private declarations; individual locations are not public-verified.</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Users className="w-5 h-5 text-blue-700 mb-2" aria-hidden="true"/>
          <p className="text-sm text-gray-600">Canonical tenant memberships</p>
          <strong className="text-2xl">{Number.isInteger(count)?count:'Not available'}</strong>
          <p className="text-xs text-gray-500 mt-2">
            Actual staff headcount, sales, reviews and revenue: Not measured.
          </p>
        </CardContent></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-6">
          {carryover&&<Card data-testid="dealer-activation-carryover">
            <CardHeader><CardTitle>Carried from your approved application</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-gray-700">
              <p>
                Application version {carryover.application_version??'—'} was carried into your
                operating profile, so you do not need to retype it. Carried details stay private
                declarations: nothing here is verified or public.
              </p>
              <p><strong>{carryover.branches.length}</strong> branch(es) carried:</p>
              <ul className="list-disc pl-5 space-y-1">
                {carryover.branches.map(b=><li key={b.branch_id} className="break-words">
                  {b.name||'Unnamed branch'} · GPS {b.has_gps?'carried':'not provided'} ·
                  hours {b.has_hours?'carried':'not provided'}
                </li>)}
              </ul>
              <p>
                Policy sections carried: {carryover.sections.length
                  ?carryover.sections.map(s=>SECTION_LABELS[s]||s).join(', '):'none'}
              </p>
              {carryover.needs_attention.length===0
                ?<p>Nothing from your application needs to be re-entered.</p>
                :<div>
                  <p className="font-medium">Needs your attention (not carried):</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {carryover.needs_attention.slice(0,20).map(n=>
                      <li key={n.tab+n.row+n.field} className="break-words">
                        {n.tab} row {n.row} · {n.field}: {n.reason}
                      </li>)}
                  </ul>
                </div>}
            </CardContent>
          </Card>}
          <Card><CardHeader><CardTitle>Branches</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {branches.length===0&&<p className="text-sm text-gray-600">
                No branches are recorded for this active company.
              </p>}
              {branches.map(b=><div key={b.id} className="rounded-xl border p-4">
                <strong className="break-words">{b.name||'Unnamed branch'}</strong>
                <p className="text-sm text-gray-600 mt-1 break-words">
                  {b.address||'No address recorded'}
                </p>
                {b.latitude!==null&&b.longitude!==null&&<p className="text-sm text-gray-600 mt-1">
                  Dealer-declared GPS: {b.latitude}, {b.longitude} (not location-verified)
                </p>}
                <p className="text-sm text-gray-600 mt-1">
                  Declared hours: {b.opening_hours_text||'Not recorded'}
                </p>
                <p className="text-xs text-gray-500 mt-2">Company record · independent public display review required</p>
                <Button variant="outline" onClick={()=>editBranch(b)} className="mt-3">
                  Edit private branch details
                </Button>
              </div>)}
              <div className="border-t pt-4 space-y-3">
                <h3 id="dealer-branch-editor" className="font-semibold">
                  {editingBranchId?'Edit private branch declaration':'Add a private branch declaration'}
                </h3>
                <label htmlFor="dealer-new-branch-name" className="block text-sm font-medium">Branch name</label>
                <Input id="dealer-new-branch-name" value={branchName}
                  maxLength={180} onChange={event=>setBranchName(event.target.value)}/>
                <label htmlFor="dealer-new-branch-address" className="block text-sm font-medium">Physical address</label>
                <Input id="dealer-new-branch-address" value={branchAddress}
                  maxLength={400} onChange={event=>setBranchAddress(event.target.value)}/>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="dealer-branch-latitude" className="block text-sm font-medium">
                      Latitude (optional)
                    </label>
                    <Input id="dealer-branch-latitude" value={branchLatitude}
                      placeholder="e.g. -17.825500" maxLength={12}
                      onChange={event=>setBranchLatitude(event.target.value)}/>
                  </div>
                  <div>
                    <label htmlFor="dealer-branch-longitude" className="block text-sm font-medium">
                      Longitude (optional)
                    </label>
                    <Input id="dealer-branch-longitude" value={branchLongitude}
                      placeholder="e.g. 31.050000" maxLength={13}
                      onChange={event=>setBranchLongitude(event.target.value)}/>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Supply both coordinates together or leave both blank. All coordinates remain unverified private declarations.
                </p>
                <label htmlFor="dealer-branch-hours" className="block text-sm font-medium">
                  Dealer-declared operating hours (optional)
                </label>
                <Input id="dealer-branch-hours" value={branchHours} maxLength={350}
                  placeholder="Mon–Fri 08:00–17:00; Sat 09:00–13:00; Sun closed"
                  onChange={event=>setBranchHours(event.target.value)}/>
                <div className="flex gap-2 flex-wrap">
                  <Button onClick={()=>{void saveBranch()}} disabled={saving||!branchName.trim()||!branchAddress.trim()}>
                    {editingBranchId?'Save existing branch changes':'Save branch to canonical dealership profile'}
                  </Button>
                  {editingBranchId&&<Button variant="outline" onClick={resetBranchForm} disabled={saving}>
                    Cancel edit
                  </Button>}
                </div>
                <p className="text-xs text-gray-500">
                  Adding a branch does not grant a franchise, listing, geographic verification or new staff permissions.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle>Actual tenant inventory</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {stockStatus==='unavailable'&&<p role="alert">
                Scoped inventory could not be read. This is not proof of zero vehicles.
              </p>}
              {stockStatus==='ready'&&vehicles.length===0&&<p className="text-sm text-gray-600">
                No vehicles were returned in the tenant's first 100 recorded VINs.
              </p>}
              {vehicles.slice(0,8).map(v=><div key={v.vin}
                className="border rounded-lg p-3">
                <p className="font-semibold">{v.make||'Make not recorded'} {v.model||'Model not recorded'}</p>
                <p className="text-sm text-gray-600 mt-1">
                  VIN {v.vin} · {v.recorded_lifecycle_state||'Lifecycle status not recorded'}
                </p>
                <p className="text-xs text-amber-800 mt-2">
                  Seller authority, duty, ownership, VIN-specific evidence and listing publication must be separately verified.
                </p>
              </div>)}
              <Link className="text-blue-700 underline text-sm inline-block" to="/dealers/stock">
                Inspect complete tenant-scoped inventory read
              </Link>
            </CardContent>
          </Card>
        </section>
        <aside className="space-y-4">
          <Card><CardHeader><CardTitle>Business tools</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                ['Manage operating terms and policies','/dealers/operating-details'],
                ['Manage canonical team membership','/dealers/staff'],
                ['Inspect VIN inventory','/dealers/stock'],
                ['Real Marketplace buyer enquiries','/dealers/inquiries'],
                ['Subscription and merchant readiness','/dealers/billing'],
                ['Claim and private evidence history','/dealers/claims'],
              ].map(([label,url])=><Link key={url} to={url}
                className="flex gap-2 items-center text-blue-700 text-sm font-medium hover:underline">
                <ArrowRight className="w-4 h-4" aria-hidden="true"/>{label}
              </Link>)}
            </CardContent>
          </Card>
          <Card><CardContent className="p-5 text-sm text-gray-600">
            Dealer-declared terms and branch data remain private until separately
            approved for public display. Real invoices, merchant settlement,
            sales and customer complaints are not fabricated here.
          </CardContent></Card>
        </aside>
      </div>
    </>}
    {notice&&<p role="status" className="p-4 rounded-lg bg-blue-50 text-blue-900">{notice}</p>}
    {error&&<p role="alert" className="p-4 rounded-lg bg-red-50 text-red-900">{error}</p>}
  </main>
}
