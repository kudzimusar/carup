import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Section='BUSINESS_OVERVIEW'|'BUYER_ASSURANCE'|'FINANCE_TERMS'|
  'SOURCING'|'WARRANTY_AFTERSALES'|'SERVICE_CAPABILITIES'
type Branch={id:string;dealer_id:string;name:string;address:string;created_at:string}
type Workspace={operational:boolean;branches:Branch[];
  recorded_tenant_member_count:number;vehicle_listing_authority:false}
type Versioned={version:number;values:Record<string,string>;recorded_at:string;
  private_declaration_only:true;public_approved:false}
type ReadModel={sections:Section[];latest:Partial<Record<Section,Versioned>>;
  owner_scope:string;publication_approval:false;verified_complaint_count:null;
  measured_sales_revenue:null}
const sections:Record<Section,{heading:string;help:string;fields:Array<[string,string]>}>={
  BUSINESS_OVERVIEW:{heading:'Business overview',help:'These are private operator statements, not approved published corporate facts.',fields:[
    ['public_description','Proposed business description'],
    ['trading_name','Declared trading name'],
    ['declared_contact_email','Proposed business contact email'],
    ['opening_hours_note','Operating hours and availability'],
  ]},
  BUYER_ASSURANCE:{heading:'Buyer assurance',help:'Record actual written terms; CarUp does not certify their legal adequacy.',fields:[
    ['inspection_rights','Pre-purchase inspection rights'],
    ['cancellation_policy','Cancellation terms'],
    ['refund_policy','Refund terms'],
    ['dispute_resolution','Buyer complaints and dispute resolution'],
  ]},
  FINANCE_TERMS:{heading:'Finance and payment disclosures',help:'No merchant activation, lender approval, financing offer or payment is created here.',fields:[
    ['deposit_terms','Deposit and outstanding balance terms'],
    ['accepted_payment_methods','Dealer-declared payment methods, without live claims'],
    ['finance_partner_disclosure','Disclose actual third-party finance relationship'],
    ['currency_disclosure','Actual currencies and applicable charges'],
  ]},
  SOURCING:{heading:'Vehicle sourcing and import processes',help:'Declared sourcing does not verify individual VIN, duty or customs status.',fields:[
    ['sourcing_channels','Sourcing channels and origins'],
    ['import_duty_disclosure','How duty status is disclosed for each vehicle'],
    ['customs_handling','Customs handling and customer obligations'],
  ]},
  WARRANTY_AFTERSALES:{heading:'Warranty and after-sales',help:'Only genuine supported coverage; every warranty is a private proposal until reviewed.',fields:[
    ['warranty_scope','Covered vehicles/components and warranty term'],
    ['warranty_exclusions','Written exclusions and limits'],
    ['repair_support','Repair and after-sales assistance'],
    ['spare_parts_support','Parts availability and supplier arrangements'],
  ]},
  SERVICE_CAPABILITIES:{heading:'Additional services',help:'List actual capabilities and locations, not assumed company credentials.',fields:[
    ['workshop_services','Workshop and maintenance services'],
    ['inspection_services','Inspection, diagnostics and technical capability'],
    ['buyer_support_hours','Buyer assistance days and hours'],
  ]},
}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
const header=(userId:string,token:string):AuthHeaders=>({
  'x-session-token':token,'x-user-id':userId,
})
export default function DealerOperatingDetails(){
  const {user,token}=useAuth()
  const [read,setRead]=useState<ReadModel|null>(null)
  const [workspace,setWorkspace]=useState<Workspace|null>(null)
  const [branchName,setBranchName]=useState('')
  const [branchAddress,setBranchAddress]=useState('')
  const [selected,setSelected]=useState<Section>('BUSINESS_OVERVIEW')
  const [draft,setDraft]=useState<Record<string,string>>({})
  const [status,setStatus]=useState<'loading'|'ready'|'denied'>('loading')
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [error,setError]=useState('')
  const reload=useCallback(async()=>{
    if(!user||!token){setStatus('denied');return}
    try{
      const [result,member]=await Promise.all([
        apiRequest<{declarations:ReadModel}>({
          baseUrl:API,path:'/dealer/operational-declarations',authHeaders:header(user.id,token),
        }),
        apiRequest<{workspace:Workspace}>({
          baseUrl:API,path:'/dealer/operational-workspace',authHeaders:header(user.id,token),
        }),
      ])
      if(!member.workspace.operational)throw new Error('Operational dealer tenant authority is not active')
      setRead(result.declarations);setWorkspace(member.workspace);setStatus('ready')
      setError('')
    }catch(problem){
      setRead(null);setWorkspace(null);setStatus('denied')
      setError(problem instanceof Error?problem.message:'Dealer authority not active')
    }
  },[user,token])
  useEffect(()=>{
    // Defer request-driven state to the async phase, avoiding a redundant
    // synchronous render caused by setting loading state in an effect.
    let mounted=true
    void Promise.resolve().then(()=>{if(mounted)void reload()})
    return()=>{mounted=false}
  },[reload])
  useEffect(()=>{
    let active=true
    void Promise.resolve().then(()=>{
      if(active)setDraft(read?.latest?.[selected]?.values||{})
    })
    return()=>{active=false}
  },[selected,read])
  async function recordBranch(){
    if(!user||!token||busy||!workspace||branchName.trim().length<2||
      branchAddress.trim().length<3)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{branch:Branch}>({
        baseUrl:API,path:'/dealer/operational-branches',
        options:{method:'POST',body:JSON.stringify({
          name:branchName.trim(),address:branchAddress.trim(),
        })},authHeaders:header(user.id,token),
      })
      setNotice('Private branch '+result.branch.name+
        ' saved to the canonical dealer profile. Public site and GPS approval require a separate reviewer.')
      setBranchName('');setBranchAddress('')
      await reload()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Could not persist dealership branch')
    }finally{setBusy(false)}
  }
  async function save(){
    if(!user||!token||busy||!read||status!=='ready')return
    setBusy(true);setError('');setNotice('')
    try{
      const values=Object.fromEntries(Object.entries(draft).
        filter(([,value])=>value.trim().length>0).
        map(([key,value])=>[key,value.trim()]))
      const result=await apiRequest<{receipt:{version:number;idempotent:boolean}}>({
        baseUrl:API,path:'/dealer/operational-declarations/'+selected,
        options:{method:'POST',body:JSON.stringify({
          expected_version:read.latest[selected]?.version||0,values,
        })},authHeaders:header(user.id,token),
      })
      setNotice('Saved private '+sections[selected].heading.toLowerCase()+
        ' version '+result.receipt.version+'. No legal, public, payment or vehicle authorization was granted.')
      await reload()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Could not persist dealership declaration')
    }finally{setBusy(false)}
  }
  return <main className="min-h-screen bg-slate-50 py-10 px-4">
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <Link to="/dealers/claims" className="text-blue-700 text-sm underline">
          Dealership applications
        </Link>
        <Link to="/dealer" className="text-blue-700 text-sm underline">
          Dealer dashboard
        </Link>
      </div>
      <h1 className="text-3xl font-bold text-slate-900">Operate your verified dealership</h1>
      <p className="mt-2 max-w-3xl text-slate-600">
        Record your real business information and customer policies in CarUp. Every saved
        section has a persistent version and audit history. Editing these declarations
        does not independently verify a fact or automatically publish it to buyers.
      </p>
      {status==='loading'&&<p role="status" className="mt-6">
        Checking canonical organization, legal authority and tenant membership…
      </p>}
      {status==='denied'&&<p role="alert" className="mt-6 p-5 border border-amber-300 bg-amber-50 rounded-xl">
        No active, independently approved dealership organization and tenant access
        is available. A source listing or approved ownership claim alone is insufficient.
      </p>}
      {status==='ready'&&workspace&&<section className="mt-8 border border-slate-200 bg-white rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Canonical dealership branches</h2>
          <p className="text-sm text-slate-600 mt-1">
            These real records belong to your active dealer_profile and tenant.
            A private branch is not public-site or GPS certification.
          </p>
        </div>
        {workspace.branches.length===0&&<p className="text-sm text-slate-600">
          No branches recorded in the current canonical dealer profile.
        </p>}
        {workspace.branches.map(branch=><div key={branch.id} className="border-t py-3">
          <h3 className="font-semibold">{branch.name}</h3>
          <p className="text-sm text-slate-600">{branch.address}</p>
          <p className="text-xs text-slate-500">Private branch · not public-approved</p>
        </div>)}
        <div className="grid sm:grid-cols-2 gap-3 border-t pt-4">
          <div>
            <label htmlFor="operating-branch-name" className="block text-sm font-medium mb-1">Branch name</label>
            <input id="operating-branch-name" maxLength={180}
              className="w-full border rounded-lg p-3"
              value={branchName} onChange={e=>setBranchName(e.target.value)}
              placeholder="Registered or trading branch name"/>
          </div>
          <div>
            <label htmlFor="operating-branch-address" className="block text-sm font-medium mb-1">Physical site address</label>
            <input id="operating-branch-address" maxLength={400}
              className="w-full border rounded-lg p-3"
              value={branchAddress} onChange={e=>setBranchAddress(e.target.value)}
              placeholder="Actual operating branch location"/>
          </div>
        </div>
        <Button variant="outline" disabled={busy||branchName.trim().length<2||
          branchAddress.trim().length<3} onClick={()=>{void recordBranch()}}>
          Save branch in canonical dealership database
        </Button>
        <p className="text-xs text-slate-500">
          Recorded tenant memberships: {workspace.recorded_tenant_member_count}.
          Staff headcount, individual licence validity and sales revenue are not inferred.
        </p>
      </section>}
      {status==='ready'&&read&&<div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-6 mt-8">
        <nav aria-label="Dealer operating sections" className="space-y-2">
          {(Object.keys(sections) as Section[]).map(key=><button
            key={key} type="button" onClick={()=>{setSelected(key);setNotice('');setError('')}}
            className={'block w-full text-left rounded-xl border px-4 py-3 text-sm '+
              (key===selected?'bg-blue-50 border-blue-600 text-blue-900 font-semibold':
                'bg-white border-slate-200 hover:border-slate-400')}>
            {sections[key].heading}
            <span className="block text-xs mt-1 text-slate-500">
              {read.latest[key]?'Version '+read.latest[key]?.version:'Not recorded'}
            </span>
          </button>)}
        </nav>
        <Card><CardContent className="p-6 space-y-5">
          <header>
            <h2 className="text-xl font-bold text-slate-900">{sections[selected].heading}</h2>
            <p className="text-sm text-slate-600 mt-2">{sections[selected].help}</p>
            <p className="text-xs text-slate-500 mt-2">
              Current recorded version: {read.latest[selected]?.version||0}.
              Saved material stays private, unverified and unpublished.
            </p>
          </header>
          {sections[selected].fields.map(([field,label])=><div key={field}>
            <label htmlFor={'dealer-'+field} className="font-medium text-sm block mb-2">{label}</label>
            <textarea id={'dealer-'+field} maxLength={750}
              value={draft[field]||''} onChange={event=>setDraft(previous=>({
                ...previous,[field]:event.target.value,
              }))} className="w-full border border-slate-300 rounded-lg p-3 min-h-24
                focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter an accurate declaration, or leave blank if not applicable."/>
          </div>)}
          <div className="flex gap-3 flex-wrap items-center">
            <Button onClick={()=>{void save()}} disabled={busy||
              !Object.values(draft).some(v=>v.trim())}>
              Save this section to CarUp
            </Button>
            <p className="text-xs text-slate-500">
              Version conflict protection · No unverified public claims
            </p>
          </div>
        </CardContent></Card>
      </div>}
      {notice&&<p role="status" className="max-w-3xl mt-5 p-4 rounded-lg bg-blue-50 text-blue-900">{notice}</p>}
      {error&&<p role="alert" className="max-w-3xl mt-5 p-4 rounded-lg bg-red-50 text-red-800">{error}</p>}
    </div>
  </main>
}
