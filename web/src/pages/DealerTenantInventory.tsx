import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
type Vehicle={
 vin:string;make:string|null;model:string|null;year:number|null;
 recorded_lifecycle_state:string|null;
 recorded_marketplace_publication_state:string|null;
 seller_authority:string;legal_title_certified:false;import_duty_verified:false;
 branch_attribution:string;public_listing_approved_by_this_read:false;
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
 const [result,setResult]=useState<Inventory|null>(null)
 const [status,setStatus]=useState<'loading'|'ready'|'denied'>('loading')
 const [search,setSearch]=useState('')
 useEffect(()=>{
  if(!user||!token){setStatus('denied');return}
  let live=true
  apiRequest<{inventory:Inventory}>({
    baseUrl:API,path:'/dealer/operational-inventory',
    authHeaders:auth(user.id,token),
  }).then(response=>{
    if(live){setResult(response.inventory);setStatus('ready')}
  }).catch(()=>{
    if(live){setResult(null);setStatus('denied')}
  })
  return()=>{live=false}
 },[user,token])
 const filtered=(result?.entries||[]).filter(v=>[
  v.vin,v.make||'',v.model||''].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
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
   {status==='loading'&&<p role="status" className="mt-7">
    Loading tenant-scoped canonical vehicles…
   </p>}
   {status==='denied'&&<p role="alert"
    className="mt-7 rounded-lg bg-amber-50 border border-amber-200 p-5">
    An active, independently approved dealership owner and tenant membership is required.
    An unclaimed research listing or unaudited dealer role does not grant inventory access.
   </p>}
   {status==='ready'&&result&&<>
    <div className="mt-7 flex flex-wrap items-center gap-4">
     <div>
      <p className="font-semibold">{result.returned_count} real tenant vehicle records in first page</p>
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
    {result.entries.length===0&&<Card className="mt-7"><CardContent className="p-6">
     No vehicles are recorded for this canonical tenant in the current read.
     This does not establish that it has no stock outside CarUp.
    </CardContent></Card>}
    {result.entries.length>0&&filtered.length===0&&<p className="mt-7 text-slate-500">
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
      <p className="text-xs text-amber-800 mt-4">
       Tenant association does not prove current seller authority, legal title,
       import duty clearance, buyer-trust approval or physical branch location.
      </p>
     </CardContent></Card>)}
    </div>
    <p className="text-xs text-slate-600 mt-6">
     Publication, ownership evidence and per-VIN checks are controlled in
     CarUp's existing Seller Authority and Marketplace programmes, not here.
     This read-only surface cannot publish an unverified car.
    </p>
   </>}
  </div>
 </main>
}
