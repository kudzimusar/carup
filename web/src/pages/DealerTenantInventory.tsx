import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
type Vehicle={
 vin:string;make:string|null;model:string|null;year:number|null;
 recorded_mileage:number|null;
 recorded_lifecycle_state:string|null;
 recorded_marketplace_publication_state:string|null;
 seller_authority:string;legal_title_certified:false;import_duty_verified:false;
 branch_attribution:string;public_listing_approved_by_this_read:false;
 listing_structural_precheck:{
  source:'EXISTING_MARKETPLACE_LISTING_ELIGIBILITY_RULES';
  blocking_reason_codes:string[];
  result:'DATA_PRECHECK_ONLY'|'REQUIRES_DATA_CORRECTION';
  seller_authority_check:'NOT_EVALUATED';
  vehicle_passport_review:'NOT_EVALUATED';
  human_publication_authorized:false;merchant_payment_authorized:false;
 };
}
type Inventory={owner_tenant_id:string;entries:Vehicle[];returned_count:number;
 count_scope:string;actual_total:null;non_tenant_vehicle_visibility:false;
 seller_publish_action_enabled:false}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
 typeof window==='undefined'?undefined:window.location.hostname)
const auth=(id:string,token:string):AuthHeaders=>({
 'x-session-token':token,'x-user-id':id,
})
export default function DealerTenantInventory(){
 const {user,token}=useAuth()
 // AuthContext can publish a new user object with unchanged authenticated
 // identity; using that object in effect dependencies used to issue several
 // identical inventory reads on one navigation (confirmed Chromium trace).
 const userId=user?.id
 const authScope=userId&&token ? JSON.stringify([userId,token]) : ''
 const currentScopeRef=useRef(authScope)
 useEffect(()=>{currentScopeRef.current=authScope},[authScope])
 const [loadedScope,setLoadedScope]=useState('')
 const [result,setResult]=useState<Inventory|null>(null)
 const [status,setStatus]=useState<'loading'|'ready'|'denied'|'unavailable'>('loading')
 const [search,setSearch]=useState('')
 const [draftVin,setDraftVin]=useState('')
 const [draftMake,setDraftMake]=useState('')
 const [draftModel,setDraftModel]=useState('')
 const [draftYear,setDraftYear]=useState(String(new Date().getFullYear()))
 const [draftMileage,setDraftMileage]=useState('')
 const [draftSaving,setDraftSaving]=useState(false)
 const [draftNotice,setDraftNotice]=useState('')
 const [draftError,setDraftError]=useState('')
 const [draftReadWarning,setDraftReadWarning]=useState('')
 const [editingVin,setEditingVin]=useState('')
 const [editMake,setEditMake]=useState('')
 const [editModel,setEditModel]=useState('')
 const [editYear,setEditYear]=useState('')
 const [editMileage,setEditMileage]=useState('')
 const [editSaving,setEditSaving]=useState(false)
 const [editNotice,setEditNotice]=useState('')
 const [editError,setEditError]=useState('')
 // The PATCH reply is an authority-checked PostgreSQL readback of the saved
 // vehicle; its listing structural precheck is not refreshed by that write.
 const [pendingPrecheckVin,setPendingPrecheckVin]=useState('')
 useEffect(()=>{
  // Session changes must not carry draft inputs, review notices or private VIN
  // filters into a different signed-in dealership identity.
  setSearch('');setDraftVin('');setDraftMake('');setDraftModel('')
  setDraftMileage('');setDraftNotice('');setDraftError('')
  setDraftReadWarning('');setEditNotice('');setEditError('')
  setEditingVin('');setPendingPrecheckVin('')
 },[authScope])
 useEffect(()=>{
  let live=true
  if(!userId||!token){
    void Promise.resolve().then(()=>{if(live){
      setResult(null);setLoadedScope('');setStatus('denied')
    }})
    return()=>{live=false}
  }
  apiRequest<{inventory:Inventory}>({
    baseUrl:API,path:'/dealer/operational-inventory',
    authHeaders:auth(userId,token),
  }).then(response=>{
    if(live&&currentScopeRef.current===authScope){
      setResult(response.inventory);setLoadedScope(authScope);setStatus('ready')
    }
  }).catch((error:unknown)=>{
   const code=error&&typeof error==='object'&&'status' in error
    ?(error as {status?:number}).status:undefined
   if(live&&currentScopeRef.current===authScope){
    setResult(null);setLoadedScope(authScope)
    setStatus([401,403,404].includes(code||0)?'denied':'unavailable')
   }
  })
  return()=>{live=false}
 },[userId,token,authScope])
 // Never render tenant-private data from a prior authentication identity:
 // changing accounts while staying on /dealers/stock must hide the prior
 // response BEFORE the replacement session's GET resolves (or fails).
 const visibleResult=authScope&&loadedScope===authScope?result:null
 const visibleStatus=!authScope?'denied':
  loadedScope===authScope?status:'loading'
 const filtered=(visibleResult?.entries||[]).filter(v=>[
  v.vin,v.make||'',v.model||''].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
 async function createPrivateDraft(){
  if(!user||!token||draftSaving)return
  const actionScope=authScope
  setDraftSaving(true);setDraftError('');setDraftNotice('');setDraftReadWarning('')
  try{
   const created=await apiRequest<{draft:{vin:string;private_tenant_draft_only:true}}>({
    baseUrl:API,path:'/dealer/operational-inventory/private-drafts',
    options:{method:'POST',body:JSON.stringify({
     vin:draftVin.trim().toUpperCase(),make:draftMake.trim(),
     model:draftModel.trim(),year:Number(draftYear),
      mileage:Number(draftMileage),
    })},authHeaders:auth(user.id,token),
   })
   if(!created.draft?.private_tenant_draft_only)throw Error('Private draft receipt unavailable')
   if(currentScopeRef.current!==actionScope)return
   // Canonical write receipt is independent of subsequent list availability.
   // Never tell the owner a committed VIN was not saved when GET fails.
   setDraftVin('');setDraftMake('');setDraftModel('');setDraftMileage('')
   setDraftNotice('Private VIN '+created.draft.vin+
    ' saved to this canonical tenant. It is NOT approved for listing or sale.')
   try{
    const updated=await apiRequest<{inventory:Inventory}>({
     baseUrl:API,path:'/dealer/operational-inventory',
     authHeaders:auth(user.id,token),
    })
    if(currentScopeRef.current===actionScope)setResult(updated.inventory)
   }catch{
    if(currentScopeRef.current===actionScope)setDraftReadWarning('The VIN was saved, but the inventory list could not refresh. '+
     'Do not submit that VIN again; reload this page to verify later.')
   }
  }catch(problem){
   if(currentScopeRef.current===actionScope)setDraftError(
    problem instanceof Error?problem.message:
    'Private VIN submission could not be confirmed. Check its existence before retrying.')
  }finally{setDraftSaving(false)}
 }
 function beginPrivateEdit(v:Vehicle){
  setEditingVin(v.vin)
  setEditMake(v.make||'');setEditModel(v.model||'')
  setEditYear(v.year==null?'':String(v.year))
  setEditMileage(v.recorded_mileage==null?'':String(v.recorded_mileage))
  setEditNotice('');setEditError('')
 }

 async function savePrivateEdit(){
  if(!user||!token||editSaving||!editingVin)return
  const actionScope=authScope
  setEditSaving(true);setEditError('');setEditNotice('')
  try{
   const receipt=await apiRequest<{draft:{
    vin:string;make:string;model:string;year:number;mileage:number;
    recorded_marketplace_publication_state:'draft';
    private_tenant_draft_only:true;seller_publish_action_enabled:false}}>({
    baseUrl:API,path:'/dealer/operational-inventory/private-drafts/'+encodeURIComponent(editingVin),
    options:{method:'PATCH',body:JSON.stringify({
     make:editMake.trim(),model:editModel.trim(),year:Number(editYear),
     mileage:Number(editMileage),
    })},authHeaders:auth(user.id,token),
   })
   const saved=receipt.draft
   if(!saved?.private_tenant_draft_only||
     saved.seller_publish_action_enabled!==false||
     saved.recorded_marketplace_publication_state!=='draft'||
     saved.vin!==editingVin||!Number.isInteger(saved.mileage))
    throw Error('Private VIN correction receipt unavailable')
   if(currentScopeRef.current!==actionScope)return
   // The server has ALREADY checked the canonical PostgreSQL UPDATE readback
   // before returning this success receipt. Do not immediately issue another
   // full inventory GET just to display this same saved make/model/odometer:
   // a genuine shared-IP read limiter can reject that GET with 429 during
   // busy operations, previously hiding a successful correction from users.
   // Update only the fields verified by the server and explicitly withhold
   // the OLD structural eligibility precheck until a fresh list is loaded.
   setResult(previous=>previous?{
    ...previous,
    entries:previous.entries.map(vehicle=>vehicle.vin===saved.vin?{
     ...vehicle,make:saved.make,model:saved.model,year:saved.year,
     recorded_mileage:saved.mileage,
    }:vehicle),
   }:previous)
   setPendingPrecheckVin(saved.vin)
   setEditingVin('')
   setEditNotice('Private VIN '+saved.vin+
    ' corrected and persisted in CarUp\'s canonical vehicle record. '+
    'It remains a private draft, not approved for listing, sale or payment.')
  }catch(error){
   if(currentScopeRef.current===actionScope)setEditError(
    error instanceof Error?error.message:
    'Private VIN correction not confirmed; check the current data before retrying.')
  }finally{setEditSaving(false)}
 }
 return <main className="min-h-screen bg-slate-50 px-4 py-10">
  <div className="max-w-6xl mx-auto">
   <Link to="/dealers/operating-details" className="text-blue-700 text-sm underline">
    Dealership operating details
   </Link>
   <h1 className="text-3xl font-bold mt-5">Actual dealership vehicle inventory</h1>
   <p className="max-w-3xl text-slate-600 mt-2">
    Vehicles in this view come directly from the active CarUp tenant's canonical vehicle
    records. The legal business, seller authority, vehicle Passport and each individual
    listing's publication eligibility remain distinct governed decisions.
   </p>
   {visibleStatus==='loading'&&<p role="status" className="mt-7">
    Loading tenant-scoped canonical vehicles…
   </p>}
   {visibleStatus==='denied'&&<p role="alert"
    className="mt-7 rounded-lg bg-amber-50 border border-amber-200 p-5">
    An active, independently approved dealership owner and tenant membership is required.
    An unclaimed research listing or unaudited dealer role does not grant inventory access.
   </p>}
   {visibleStatus==='unavailable'&&<p role="alert"
    className="mt-7 rounded-lg bg-amber-50 border border-amber-200 p-5">
    The canonical inventory service could not be reached or verified. This outage
    does not establish that your dealership or stock is inactive or empty.
    Refresh after service is restored.
   </p>}
   {visibleStatus==='ready'&&visibleResult&&<>
    <Card className="mt-7"><CardContent className="p-6">
     <h2 className="text-xl font-semibold">Register a private vehicle draft</h2>
     <p className="text-sm text-slate-600 mt-2">
      This stores an unverified VIN in your actual canonical tenant only.
      It grants no seller authority, listing approval, vehicle title, duty clearance,
      finance, public Passport verification or merchant permission.
     </p>
     <form className="grid sm:grid-cols-2 gap-4 mt-5"
      onSubmit={event=>{event.preventDefault();void createPrivateDraft()}}>
      <div>
       <label className="text-sm block font-medium mb-1" htmlFor="private-draft-vin">
        VIN — 17 characters
       </label>
       <input id="private-draft-vin" className="p-3 rounded-lg border w-full"
        required maxLength={17} minLength={17} pattern="[A-HJ-NPR-Z0-9]{17}"
        autoComplete="off" value={draftVin}
        onChange={event=>setDraftVin(event.target.value.toUpperCase())}/>
      </div>
      <div>
       <label className="text-sm block font-medium mb-1" htmlFor="private-draft-year">
        Model year
       </label>
       <input id="private-draft-year" className="p-3 rounded-lg border w-full"
        required type="number" min={1950} max={new Date().getFullYear()+1}
        value={draftYear} onChange={event=>setDraftYear(event.target.value)}/>
      </div>
      <div>
       <label className="text-sm block font-medium mb-1" htmlFor="private-draft-make">
        Manufacturer
       </label>
       <input id="private-draft-make" className="p-3 rounded-lg border w-full"
        required minLength={2} maxLength={80} value={draftMake}
        onChange={event=>setDraftMake(event.target.value)}/>
      </div>
      <div>
       <label className="text-sm block font-medium mb-1" htmlFor="private-draft-model">
        Model
       </label>
       <input id="private-draft-model" className="p-3 rounded-lg border w-full"
        required minLength={1} maxLength={100} value={draftModel}
        onChange={event=>setDraftModel(event.target.value)}/>
      </div>
      <div>
        <label className="text-sm block font-medium mb-1" htmlFor="private-draft-mileage">
         Dealer-declared odometer (km) — unverified
        </label>
        <input id="private-draft-mileage" type="number" required min={0}
         max={2000000} step={1} placeholder="Recorded kilometres"
         className="p-3 rounded-lg border w-full"
         value={draftMileage} onChange={e=>setDraftMileage(e.target.value)}/>
       </div>
       <button type="submit" disabled={draftSaving}
       className="rounded-lg bg-slate-900 text-white px-5 py-3 font-medium disabled:opacity-60">
       Register private VIN draft
      </button>
     </form>
     {draftNotice&&<p role="status" className="mt-4 bg-blue-50 text-blue-900 p-3 rounded-lg">
      {draftNotice}
     </p>}
     {draftError&&<p role="alert" className="mt-4 bg-amber-50 text-amber-900 p-3 rounded-lg">
      {draftError}
     </p>}
     {draftReadWarning&&<p role="alert" className="mt-4 bg-amber-50 text-amber-900 p-3 rounded-lg">
      {draftReadWarning}
     </p>}
    </CardContent></Card>
    {editingVin&&<Card className="mt-7"><CardContent className="p-6">
      <h2 className="text-lg font-semibold">Correct private VIN draft</h2>
      <p className="text-sm text-slate-600 mt-2">
       VIN {editingVin} is immutable. Only make, model, model year and unverified odometer are
       editable. Seller Authority, public listing, payment, title and duty
       verification remain expressly unavailable.
      </p>
      <form className="grid sm:grid-cols-3 gap-3 mt-4"
       onSubmit={e=>{e.preventDefault();void savePrivateEdit()}}>
       <div>
        <label htmlFor="edit-private-make" className="block text-sm font-medium mb-1">
         Manufacturer
        </label>
        <input id="edit-private-make" required minLength={2} maxLength={80}
         className="w-full border rounded-lg p-3" value={editMake}
         onChange={e=>setEditMake(e.target.value)}/>
       </div>
       <div>
        <label htmlFor="edit-private-model" className="block text-sm font-medium mb-1">
         Model
        </label>
        <input id="edit-private-model" required minLength={1} maxLength={100}
         className="w-full border rounded-lg p-3" value={editModel}
         onChange={e=>setEditModel(e.target.value)}/>
       </div>
       <div>
        <label htmlFor="edit-private-year" className="block text-sm font-medium mb-1">
         Model year
        </label>
        <input id="edit-private-year" required type="number" min={1950}
         max={new Date().getFullYear()+1}
         className="w-full border rounded-lg p-3" value={editYear}
         onChange={e=>setEditYear(e.target.value)}/>
       </div>
       <div>
         <label htmlFor="edit-private-mileage" className="block text-sm font-medium mb-1">
          Dealer-declared odometer (km) — unverified
         </label>
         <input id="edit-private-mileage" type="number" required min={0}
          max={2000000} step={1} className="w-full border rounded-lg p-3"
          value={editMileage} onChange={e=>setEditMileage(e.target.value)}/>
        </div>
        <button type="submit" disabled={editSaving}
        className="rounded-lg bg-slate-900 p-3 text-white disabled:opacity-60">
        Save private draft correction
       </button>
       <button type="button" disabled={editSaving}
        onClick={()=>setEditingVin('')}
        className="rounded-lg border p-3">Cancel correction</button>
      </form>
      {editError&&<p role="alert" className="text-amber-900 mt-3">{editError}</p>}
     </CardContent></Card>}
     {editNotice&&<p role="status" className="mt-4 rounded-lg bg-blue-50 p-3">{editNotice}</p>}
     <div className="mt-7 flex flex-wrap items-center gap-4">
     <div>
      <p className="font-semibold">{visibleResult.returned_count} real tenant vehicle records in first page</p>
      <p className="text-xs text-slate-500">
       Total dealership stock is not calculated from a truncated page.
       No synthetic vehicles or branches are added.
      </p>
     </div>
     <div className="flex-1 max-w-md">
      <label htmlFor="tenant-stock-search" className="block text-sm font-medium mb-1">
       Search the loaded vehicle records
      </label>
      <input id="tenant-stock-search" className="w-full border rounded-lg p-3"
       value={search} onChange={e=>setSearch(e.target.value)}
       placeholder="VIN, make or model"/>
     </div>
    </div>
    {visibleResult.entries.length===0&&<Card className="mt-7"><CardContent className="p-6">
     No vehicles are recorded for this canonical tenant in the current read.
     This does not establish that it has no stock outside CarUp.
    </CardContent></Card>}
    {visibleResult.entries.length>0&&filtered.length===0&&<p className="mt-7 text-slate-500">
     No vehicle on this loaded page matches your filter.
    </p>}
    <div className="grid md:grid-cols-2 gap-4 mt-6">
     {filtered.map(v=><Card key={v.vin}><CardContent className="p-5">
      <h2 className="font-semibold">
       {[v.year,v.make,v.model].filter(x=>x!==null&&x!==undefined).join(' ')||'Unspecified vehicle'}
      </h2>
      <p className="text-sm text-slate-700 break-all mt-2">
       Recorded VIN: <code>{v.vin}</code>
      </p>
      <dl className="grid grid-cols-2 gap-3 mt-4 text-sm">
       <div><dt className="text-slate-500">Recorded lifecycle</dt>
        <dd>{v.recorded_lifecycle_state||'Not recorded'}</dd></div>
       <div><dt className="text-slate-500">Marketplace publication</dt>
        <dd>{v.recorded_marketplace_publication_state||'Not recorded'}</dd></div>
      </dl>
      <p className="text-sm mt-3">
       Recorded odometer (source and accuracy not independently verified):
       {' '}{v.recorded_mileage==null?'Not recorded':
        v.recorded_mileage.toLocaleString('en-US')+' km'}
      </p>
      {v.recorded_lifecycle_state==='Pending'&&
        v.recorded_marketplace_publication_state==='draft'&&
        <button type="button" onClick={()=>beginPrivateEdit(v)}
         aria-label={'Edit private draft '+v.vin}
         className="mt-3 rounded-lg border border-slate-400 px-3 py-2 text-sm font-medium">
         Edit private draft details
        </button>}
       <section className="border-t mt-4 pt-3 space-y-2">
       <h3 className="text-sm font-semibold">Structural listing precheck</h3>
       {pendingPrecheckVin===v.vin?(
        <p className="text-xs text-amber-800" role="status">
         The private correction has been confirmed by the server.
         Structural listing eligibility has not been rechecked since the edit.
         Reload when the inventory read is available; no publication rights are granted.
        </p>
       ):<>
        <p className="text-xs text-slate-600">
         {v.listing_structural_precheck.result==='DATA_PRECHECK_ONLY'
          ?'Recorded fields pass the existing Marketplace data-shape precheck.'
          :'The existing Marketplace rules identified missing or invalid listing data.'}
        </p>
        {v.listing_structural_precheck.blocking_reason_codes.length>0&&
         <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
          {v.listing_structural_precheck.blocking_reason_codes.map(code=>
           <li key={code}>{code.replaceAll('_',' ')}</li>)}
         </ul>}
       </>}
       <p className="text-xs text-amber-800">
        Seller Authority and Vehicle Passport review: not evaluated.
        This data check cannot publish, verify ownership or process a payment,
        even when no structural issues remain.
       </p>
      </section>
      <p className="text-xs text-amber-800 mt-4">
       Tenant association does not prove current seller authority, legal title,
       import duty clearance, buyer-trust approval or physical branch location.
      </p>
     </CardContent></Card>)}
    </div>
    <p className="text-xs text-slate-600 mt-6">
     Publication, ownership evidence and per-VIN checks are controlled in
     CarUp's existing Seller Authority and Marketplace programmes, not here.
     This private draft workspace cannot publish an unverified car.
    </p>
   </>}
  </div>
 </main>
}
