import {useCallback,useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

/**
 * R4 P0-2 — one dealer VIN's journey onto the canonical Marketplace.
 * The dealership domain only PREPARES a listing candidate. Ownership/registration evidence goes
 * through the canonical vehicle evidence route, an independent CarUp reviewer decides it, and
 * publication is the canonical POST /api/vehicles/:vin/publish gate (completeness evaluator) —
 * called with this dealer's verified tenant context, never a global role.
 */
type Requirement={key:string;label:string;status:string;blocking:boolean;who_must_act:string|null}
type Readiness={
 vin:string;dealer_operating_authority_current:boolean;
 governed_seller_is_approved_owner:boolean;listing_candidate_prepared:boolean;
 branch_id:string|null;recorded_marketplace_publication_state:string|null;
 canonical_gate:{is_publishable:boolean;completeness_percent:number|null;requirements:Requirement[]};
 publish_route:string|null;dealer_domain_can_publish:false;
}
type Branch={id:string;name:string|null}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
 typeof window==='undefined'?undefined:window.location.hostname)
// Canonical Zimbabwe registration stages (backend/services/registration/zimbabweRegistrationLifecycle.js).
const STAGES:[string,string][]= [
 ['customs_cleared_cvr_pending','Customs cleared — local registration pending'],
 ['locally_registered','Locally registered in Zimbabwe (plate required)'],
 ['cvr_plate_pending','CVR processing — plate pending'],
 ['arrived_customs_pending','Arrived — customs pending'],
 ['import_in_transit','Import in transit'],
 ['reregistration_pending','Re-registration pending'],
 ['temporary_foreign_tip','Temporary foreign vehicle — TIP (review required)'],
 ['unknown','Registration status not established (blocks publication)'],
]
const STATUS_TEXT:Record<string,string>={
 present:'Met',verified:'Met',pending_review:'Awaiting independent CarUp review',
 missing:'Needed from you',not_available:'Not recorded',
}
const MAX_DOCUMENT_BYTES=5*1024*1024
const readAsDataUrl=(file:File)=>new Promise<string>((resolve,reject)=>{
 const reader=new FileReader()
 reader.onload=()=>resolve(String(reader.result||''))
 reader.onerror=()=>reject(reader.error||new Error('FILE_READ_FAILED'))
 reader.readAsDataURL(file)
})
const errorCode=(error:unknown)=>{
 if(error&&typeof error==='object'){
  const data=(error as {data?:{error?:unknown}}).data
  if(data&&typeof data.error==='string')return data.error
  if('message' in error)return String((error as {message:unknown}).message)
 }
 return 'REQUEST_FAILED'
}

export default function DealerVinListingPanel({vin,tenantId,userId,token,branches,onChanged}:{
 vin:string;tenantId:string;userId:string;token:string;branches:Branch[];onChanged:()=>void;
}){
 const base:AuthHeaders={'x-session-token':token,'x-user-id':userId}
 // Canonical vehicle routes resolve the effective role from this VERIFIED tenant membership.
 const tenantScoped:AuthHeaders={...base,'x-tenant-id':tenantId,'x-stakeholder-role':'dealer'}
 const [readiness,setReadiness]=useState<Readiness|null>(null)
 const [state,setState]=useState<'loading'|'ready'|'unavailable'>('loading')
 const [busy,setBusy]=useState('')
 const [notice,setNotice]=useState('')
 const [problem,setProblem]=useState('')
 const [refusal,setRefusal]=useState<Requirement[]>([])
 const [branchId,setBranchId]=useState(branches[0]?.id||'')
 const [price,setPrice]=useState('')
 const [currency,setCurrency]=useState('USD')
 const [chassis,setChassis]=useState('')
 const [engine,setEngine]=useState('')
 const [stage,setStage]=useState('customs_cleared_cvr_pending')
 const [plate,setPlate]=useState('')
 const [city,setCity]=useState('')
 const [province,setProvince]=useState('')
 const [visibility,setVisibility]=useState('public')
 const [showDealer,setShowDealer]=useState(true)
 const [docFile,setDocFile]=useState<File|null>(null)
 const live=useRef(true)
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 const load=useCallback(async()=>{
  try{
   const response=await apiRequest<{readiness:Readiness}>({baseUrl:API,
    path:`/dealer/operational-inventory/${vin}/listing-readiness`,
    authHeaders:{'x-session-token':token,'x-user-id':userId}})
   if(live.current){setReadiness(response.readiness);setState('ready')}
  }catch{if(live.current){setReadiness(null);setState('unavailable')}}
 },[vin,token,userId])
 // Initial read: state is only ever set from the request's callbacks (never synchronously here).
 useEffect(()=>{
  let active=true
  apiRequest<{readiness:Readiness}>({baseUrl:API,
   path:`/dealer/operational-inventory/${vin}/listing-readiness`,
   authHeaders:{'x-session-token':token,'x-user-id':userId}})
   .then(r=>{if(active){setReadiness(r.readiness);setState('ready')}})
   .catch(()=>{if(active){setReadiness(null);setState('unavailable')}})
  return()=>{active=false}
 },[vin,token,userId])

 const run=async(label:string,action:()=>Promise<void>)=>{
  setBusy(label);setNotice('');setProblem('');setRefusal([])
  try{await action()}catch(error){
   const data=(error as {data?:{requirements?:Requirement[]}}).data
   if(Array.isArray(data?.requirements))setRefusal(data.requirements)
   setProblem(errorCode(error))
  }finally{if(live.current)setBusy('')}
 }
 const prepare=()=>run('prepare',async()=>{
  const amount=Number(price)
  await apiRequest({baseUrl:API,path:`/dealer/operational-inventory/${vin}/listing-preparation`,
   authHeaders:base,options:{method:'POST',body:JSON.stringify({
    branch_id:branchId,price:amount,currency,chassis_number:chassis,engine_number:engine,
    registration_status:stage,plate_number:plate||null,listing_city:city,
    listing_province:province||null,location_visibility:visibility,public_seller_display:showDealer,
   })}})
  setNotice('Listing facts saved as dealer-declared. The vehicle is NOT public yet.')
  await load();onChanged()
 })
 const upload=()=>run('upload',async()=>{
  if(!docFile)throw new Error('CHOOSE_A_DOCUMENT')
  if(docFile.size>MAX_DOCUMENT_BYTES)throw new Error('DOCUMENT_TOO_LARGE')
  if(!['application/pdf','image/jpeg','image/png'].includes(docFile.type))
   throw new Error('DOCUMENT_TYPE_NOT_SUPPORTED')
  const file=await readAsDataUrl(docFile)
  await apiRequest({baseUrl:API,path:`/vehicles/${vin}/evidence/upload`,authHeaders:tenantScoped,
   options:{method:'POST',body:JSON.stringify({vehicle_id:vin,evidence_type:'registration_document',
    evidence_class:'registration',evidence_subtype:'registration_book',
    visibility_level:'restricted',file})}})
  setDocFile(null)
  setNotice('Document received privately. An independent CarUp reviewer must check it before you can publish.')
  await load()
 })
 const publish=()=>run('publish',async()=>{
  await apiRequest({baseUrl:API,path:`/vehicles/${vin}/publish`,authHeaders:tenantScoped,
   options:{method:'POST',body:'{}'}})
  setNotice('Published through the CarUp Marketplace publication checks.')
  await load();onChanged()
 })
 const unpublish=()=>run('unpublish',async()=>{
  await apiRequest({baseUrl:API,path:`/vehicles/${vin}/unpublish`,authHeaders:tenantScoped,
   options:{method:'POST',body:'{}'}})
  setNotice('Removed from public Marketplace search. The vehicle and its history are kept.')
  await load();onChanged()
 })

 if(state==='loading')return <p role="status" className="text-sm">Loading Marketplace checks for {vin}…</p>
 if(state==='unavailable'||!readiness)return <p role="alert" className="text-sm text-red-700">
  Marketplace checks for {vin} are unavailable right now. Nothing has been published.</p>
 const published=readiness.recorded_marketplace_publication_state==='published'
 const sellerAuthority=readiness.canonical_gate.requirements.find(r=>r.key==='seller_authority')
 const needsDocument=readiness.listing_candidate_prepared&&!published&&
  sellerAuthority&&sellerAuthority.status!=='verified'
 const canPublish=readiness.listing_candidate_prepared&&!published&&
  readiness.dealer_operating_authority_current&&readiness.canonical_gate.is_publishable
 const field='mt-1 w-full rounded border border-slate-400 px-2 py-2 text-sm'
 return <section aria-labelledby={`listing-${vin}`} className="mt-3 rounded-lg border border-slate-300 p-3"
  data-testid={`dealer-listing-panel-${vin}`}>
  <h4 id={`listing-${vin}`} className="font-semibold">Marketplace listing — {vin}</h4>
  <p className="text-xs text-slate-700">
   Dealer operating authority: <strong data-testid="dealer-listing-authority">
    {readiness.dealer_operating_authority_current?'current':'NOT current — listing disabled'}</strong>
   {' · '}Publication state: <strong data-testid="dealer-listing-publication-state">
    {readiness.recorded_marketplace_publication_state||'not recorded'}</strong>
  </p>
  {notice&&<p role="status" className="mt-2 text-sm text-emerald-800">{notice}</p>}
  {problem&&<div role="alert" className="mt-2 text-sm text-red-700">
   <p>Not completed: {problem}</p>
   {refusal.length>0&&<ul className="list-disc pl-5">{refusal.map(r=>
    <li key={r.key}>{r.label} — {STATUS_TEXT[r.status]||r.status}</li>)}</ul>}
  </div>}
  {!readiness.listing_candidate_prepared&&readiness.dealer_operating_authority_current&&
   <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void prepare()}}
    aria-label={`Prepare ${vin} for Marketplace`}>
    <p className="sm:col-span-2 text-xs text-slate-700">Every fact below is recorded as
     <strong> declared by your dealership</strong>. CarUp does not verify it by saving it.</p>
    <label className="text-sm">Branch holding this vehicle
     <select required className={field} value={branchId} onChange={e=>setBranchId(e.target.value)}>
      <option value="">Choose a branch</option>
      {branches.map(b=><option key={b.id} value={b.id}>{b.name||'Unnamed branch'}</option>)}
     </select></label>
    <label className="text-sm">Asking price
     <input required inputMode="decimal" className={field} value={price}
      onChange={e=>setPrice(e.target.value.replace(/[^0-9.]/g,''))}/></label>
    <label className="text-sm">Currency
     <select className={field} value={currency} onChange={e=>setCurrency(e.target.value)}>
      <option value="USD">USD</option><option value="ZWG">ZWG</option>
     </select></label>
    <label className="text-sm">Chassis number
     <input required className={field} value={chassis} onChange={e=>setChassis(e.target.value)}/></label>
    <label className="text-sm">Engine number
     <input required className={field} value={engine} onChange={e=>setEngine(e.target.value)}/></label>
    <label className="text-sm">Registration stage
     <select className={field} value={stage} onChange={e=>setStage(e.target.value)}>
      {STAGES.map(([value,label])=><option key={value} value={value}>{label}</option>)}
     </select></label>
    <label className="text-sm">Plate number (if registered)
     <input className={field} value={plate} onChange={e=>setPlate(e.target.value)}/></label>
    <label className="text-sm">City shown to buyers
     <input required className={field} value={city} onChange={e=>setCity(e.target.value)}/></label>
    <label className="text-sm">Province (optional)
     <input className={field} value={province} onChange={e=>setProvince(e.target.value)}/></label>
    <label className="text-sm">Location shown publicly
     <select className={field} value={visibility} onChange={e=>setVisibility(e.target.value)}>
      <option value="public">City and province</option><option value="province_only">Province only</option>
      <option value="withheld">Withheld</option>
     </select></label>
    <label className="flex items-center gap-2 text-sm sm:col-span-2">
     <input type="checkbox" checked={showDealer} onChange={e=>setShowDealer(e.target.checked)}/>
     Show our dealership as the seller on the public listing</label>
    <button type="submit" disabled={busy!==''||!branchId}
     className="min-h-11 rounded bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2">
     {busy==='prepare'?'Saving…':'Save listing facts (stays private)'}</button>
   </form>}
  {readiness.listing_candidate_prepared&&<div className="mt-3">
   <h5 className="text-sm font-semibold">CarUp publication checks
    {readiness.canonical_gate.completeness_percent!==null&&` · ${readiness.canonical_gate.completeness_percent}%`}</h5>
   <ul className="mt-1 space-y-1 text-sm" data-testid="dealer-listing-requirements">
    {readiness.canonical_gate.requirements.filter(r=>r.blocking).map(r=>
     <li key={r.key} data-requirement={r.key} data-status={r.status}>
      <span className="font-medium">{r.label}</span> — {STATUS_TEXT[r.status]||r.status}</li>)}
   </ul>
  </div>}
  {needsDocument&&<div className="mt-3">
   <label className="text-sm">Ownership or registration document (PDF, JPG or PNG, up to 5 MB)
    <input type="file" accept="application/pdf,image/jpeg,image/png" className={field}
     data-testid="dealer-listing-document" onChange={e=>setDocFile(e.target.files?.[0]||null)}/></label>
   <button type="button" onClick={()=>void upload()} disabled={busy!==''||!docFile}
    className="mt-2 min-h-11 rounded border border-slate-900 px-4 text-sm font-semibold disabled:opacity-60">
    {busy==='upload'?'Uploading…':'Send document for independent review'}</button>
  </div>}
  {readiness.listing_candidate_prepared&&!published&&<button type="button" onClick={()=>void publish()}
   disabled={busy!==''||!canPublish}
   className="mt-3 min-h-11 rounded bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60">
   {busy==='publish'?'Publishing…':canPublish?'Publish on CarUp Marketplace':'Publish (blocked until checks are met)'}
  </button>}
  {published&&<div className="mt-3 flex flex-wrap gap-3 text-sm">
   <Link className="underline" to={`/marketplace/listing/${vin}`}>View the public listing</Link>
   <button type="button" onClick={()=>void unpublish()} disabled={busy!==''}
    className="min-h-11 rounded border border-slate-900 px-4 font-semibold disabled:opacity-60">
    {busy==='unpublish'?'Removing…':'Remove from Marketplace'}</button>
  </div>}
 </section>
}
