import {useEffect,useState} from 'react'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

/**
 * R4 P0-3 (C12) — independent reviewer workbench for a dealership's operating lifecycle.
 * Every decision is password stepped-up, reasoned and append-only. Suspension, investigation and
 * withdrawal remove public stock at the data layer; reinstatement needs a DIFFERENT reviewer from the
 * one who suspended; renewal needs a newer independent legal review. Nothing here republishes stock,
 * restores a storefront or changes a payment entitlement.
 */
type QueueCase={seed_dealer_id:string;operating_status:string}
type LifecycleEvent={event_id:string;action:string;previous_operating_status:string;
 next_operating_status:string;public_listings_withdrawn:number;created_at:string;recorded_by_this_reviewer:boolean}
type Lifecycle={seed_dealer_id:string;operating_status:string;events:LifecycleEvent[]}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
 typeof window==='undefined'?undefined:window.location.hostname)
const ACTIONS:[string,string][]= [
 ['SUSPEND','Suspend operations (removes public stock)'],
 ['OPEN_INVESTIGATION','Open an investigation (removes public stock)'],
 ['CLOSE_INVESTIGATION','Close the investigation (does not republish)'],
 ['REINSTATE','Reinstate a suspended dealer (different reviewer required)'],
 ['RENEW','Renew onto a newer independent legal review'],
 ['WITHDRAW','Withdraw permanently (no reinstatement)'],
]
const message=(e:unknown)=>{
 const data=(e as {data?:{error?:unknown}})?.data
 return typeof data?.error==='string'?data.error:e instanceof Error?e.message:'Decision refused'
}
export default function DealerOperatingLifecycleReview(){
 const {user,token}=useAuth()
 const headers:AuthHeaders|null=user&&token?{'x-session-token':token,'x-user-id':user.id}:null
 const [cases,setCases]=useState<QueueCase[]>([])
 const [seed,setSeed]=useState('')
 const [lifecycle,setLifecycle]=useState<Lifecycle|null>(null)
 const [action,setAction]=useState('SUSPEND')
 const [reason,setReason]=useState('')
 const [legalReview,setLegalReview]=useState('')
 const [password,setPassword]=useState('')
 const [busy,setBusy]=useState(false)
 const [notice,setNotice]=useState('')
 const [error,setError]=useState('')
 const [refresh,setRefresh]=useState(0)
 const userId=user?.id
 useEffect(()=>{
  if(!userId||!token)return
  let live=true
  apiRequest<{cases:QueueCase[]}>({baseUrl:API,path:'/admin/dealership/full-storefronts/queue',
   authHeaders:{'x-session-token':token,'x-user-id':userId}})
   .then(r=>{if(live)setCases(r.cases||[])}).catch(e=>{if(live)setError(message(e))})
  return()=>{live=false}
 },[userId,token,refresh])
 useEffect(()=>{
  if(!seed||!userId||!token)return
  let live=true
  apiRequest<{lifecycle:Lifecycle}>({baseUrl:API,path:'/admin/dealership/operating-lifecycle/'+encodeURIComponent(seed),
   authHeaders:{'x-session-token':token,'x-user-id':userId}})
   .then(r=>{if(live)setLifecycle(r.lifecycle)}).catch(e=>{if(live){setLifecycle(null);setError(message(e))}})
  return()=>{live=false}
 },[seed,userId,token,refresh])
 async function decide(){
  if(!headers||!seed||busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const r=await apiRequest<{decision:{action:string;operating_status:string;public_listings_withdrawn:number;
    operating_authority_current:boolean}}>({baseUrl:API,path:'/admin/dealership/operating-lifecycle/'+encodeURIComponent(seed),
    authHeaders:headers,options:{method:'POST',body:JSON.stringify({action,reason:reason.trim(),
     reviewer_password:password,new_legal_review_id:action==='RENEW'?legalReview.trim():undefined})}})
   setNotice(`Lifecycle decision recorded: ${r.decision.action} → ${r.decision.operating_status}. `+
    `Public listings withdrawn: ${r.decision.public_listings_withdrawn}. Operating authority current: `+
    `${r.decision.operating_authority_current?'yes':'no'}. Nothing was republished.`)
   setReason('');setLegalReview('')
   setRefresh(n=>n+1)
  }catch(e){setError(message(e))}
  finally{setBusy(false);setPassword('')}
 }
 const field='mt-1 w-full rounded border border-slate-400 px-3 py-2 text-sm'
 return <main className="mx-auto max-w-5xl px-4 py-8">
  <h1 className="text-2xl font-bold">Dealership operating lifecycle</h1>
  <p className="mt-2 text-sm text-slate-700">Independent decisions only. You cannot decide for a dealership you belong to,
   and you cannot reinstate a suspension you recorded yourself.</p>
  {error&&<p role="alert" className="mt-4 text-sm text-red-700">Not recorded: {error}</p>}
  {notice&&<p role="status" className="mt-4 text-sm text-emerald-800">{notice}</p>}
  <div className="mt-6 grid gap-6 md:grid-cols-[minmax(200px,1fr)_minmax(0,2fr)]">
   <section aria-labelledby="lifecycle-cases"><h2 id="lifecycle-cases" className="font-semibold">Activated dealerships</h2>
    {cases.length===0&&<p className="mt-2 text-sm text-slate-600">No activated dealerships are recorded.</p>}
    {cases.map(c=><button key={c.seed_dealer_id} type="button" onClick={()=>{setSeed(c.seed_dealer_id);setNotice('');setError('')}}
     aria-pressed={seed===c.seed_dealer_id}
     className={'mt-2 block w-full rounded border p-3 text-left text-sm '+(seed===c.seed_dealer_id?'border-blue-800 bg-blue-50':'border-slate-300')}>
     <strong>{c.seed_dealer_id}</strong><span className="block text-xs">{c.operating_status}</span></button>)}
   </section>
   {seed&&<section aria-labelledby="lifecycle-decision">
    <h2 id="lifecycle-decision" className="font-semibold">{seed} · current status: <span data-testid="lifecycle-status">
     {lifecycle?.operating_status||'loading'}</span></h2>
    <form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();void decide()}} aria-label={'Lifecycle decision for '+seed}>
     <label className="block text-sm">Decision
      <select id="lifecycle-action" className={field} value={action} onChange={e=>setAction(e.target.value)}>
       {ACTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     {action==='RENEW'&&<label className="block text-sm">Newer independent legal review ID
      <input id="lifecycle-legal-review" className={field} value={legalReview} onChange={e=>setLegalReview(e.target.value)} required/></label>}
     <label className="block text-sm">Reason (40–3000 characters, recorded permanently)
      <textarea id="lifecycle-reason" className={field+' min-h-28'} value={reason} minLength={40} maxLength={3000}
       required onChange={e=>setReason(e.target.value)}/></label>
     <label className="block text-sm">Your password (step-up for this decision only)
      <input id="lifecycle-password" type="password" autoComplete="current-password" className={field}
       value={password} onChange={e=>setPassword(e.target.value)} required/></label>
     <button type="submit" disabled={busy||!password||reason.trim().length<40}
      className="min-h-11 rounded bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60">
      {busy?'Recording…':'Record immutable lifecycle decision'}</button>
    </form>
    <h3 className="mt-6 font-semibold">Recorded decisions</h3>
    <ol className="mt-2 space-y-2 text-sm" data-testid="lifecycle-history">
     {(lifecycle?.events||[]).map(e=><li key={e.event_id} className="rounded border border-slate-200 p-2">
      <strong>{e.action}</strong>: {e.previous_operating_status} → {e.next_operating_status} · withdrawn
      {' '}{e.public_listings_withdrawn} · {new Date(e.created_at).toLocaleString()}
      {e.recorded_by_this_reviewer&&' · recorded by you'}</li>)}
     {lifecycle&&lifecycle.events.length===0&&<li className="text-slate-600">No lifecycle decisions yet.</li>}
    </ol>
   </section>}
  </div>
 </main>
}
