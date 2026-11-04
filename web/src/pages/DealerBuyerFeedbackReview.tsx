import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type QueueRow={case_id:string;seed_dealer_id:string;case_type:string;submitted_at:string}
type PrivateCase={
 case_id:string;seed_dealer_id:string;transaction_intent_id:string;
 buyer_user_id:string;statement:string;case_type:string;
 submitted_rating:number|null;canonical_transaction_state_at_submission:string;
 verified_real_purchase:false;public_review_eligible:false;
}
type Finding={event_id:string;finding:string;public_verified_review:false;
 canonical_dispute_case_modified:false;provider_payment_status_modified:false}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
 typeof window==='undefined'?undefined:window.location.hostname)
const headers=(id:string,token:string):AuthHeaders=>({
 'x-user-id':id,'x-session-token':token,
})
const FINDINGS=[
 ['NEEDS_BUYER_EVIDENCE','Request further buyer evidence outside this immutable finding'],
 ['REFERRED_TO_CANONICAL_DISPUTE','Refer to the independently governed dispute process'],
 ['NOT_ELIGIBLE_FOR_PUBLIC_REVIEW','Not eligible for a verified public review'],
] as const

/** This does not resolve escrow, transfer funds or publish customer stars. */
export default function DealerBuyerFeedbackReview(){
 const {user,token}=useAuth()
 const isReviewer=Boolean(user&&token&&
  ['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
 const [cases,setCases]=useState<QueueRow[]>([])
 const [selected,setSelected]=useState('')
 const [privateCase,setPrivateCase]=useState<PrivateCase|null>(null)
 const [password,setPassword]=useState('')
 const [finding,setFinding]=useState<(typeof FINDINGS)[number][0]>('NEEDS_BUYER_EVIDENCE')
 const [reason,setReason]=useState('')
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [notice,setNotice]=useState('')
 const [error,setError]=useState('')
 const load=useCallback(async()=>{
  if(!user||!token||!isReviewer){setLoading(false);return}
  setLoading(true)
  try{
   const response=await apiRequest<{cases:QueueRow[]}>({
    baseUrl:API,path:'/admin/dealership/buyer-feedback/queue',
    authHeaders:headers(user.id,token),
   })
   if(!Array.isArray(response.cases))throw Error('Private review queue unavailable')
   setCases(response.cases)
   setSelected(prev=>response.cases.some(c=>c.case_id===prev)?prev:
    response.cases[0]?.case_id||'')
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Could not load independent review queue')
   setCases([])
  }finally{setLoading(false)}
 },[user,token,isReviewer])
 useEffect(()=>{void Promise.resolve().then(load)},[load])
 const activeCase=privateCase?.case_id===selected?privateCase:null
 async function inspect(){
  if(!user||!token||!isReviewer||!selected||password.length<8||busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const result=await apiRequest<{preview:PrivateCase}>({
    baseUrl:API,path:'/admin/dealership/buyer-feedback/'+encodeURIComponent(selected)+'/preview',
    options:{method:'POST',body:JSON.stringify({reviewer_password:password})},
    authHeaders:headers(user.id,token),
   })
   if(!result.preview||result.preview.verified_real_purchase!==false||
      result.preview.public_review_eligible!==false||result.preview.case_id!==selected)
    throw Error('Private case preview lacked canonical custody')
   setPrivateCase(result.preview)
   setNotice('Private statement opened after reviewer password verification. A separate password challenge is required for your finding.')
  }catch(problem){
   setPrivateCase(null)
   setError(problem instanceof Error?problem.message:'Private case preview denied')
  }finally{setBusy(false);setPassword('')}
 }
 async function record(){
  if(!user||!token||!isReviewer||!selected||!activeCase||busy||
     password.length<8||reason.trim().length<80)return
  setBusy(true);setError('');setNotice('')
  try{
   const result=await apiRequest<{finding:Finding}>({
    baseUrl:API,path:'/admin/dealership/buyer-feedback/'+encodeURIComponent(selected)+'/review',
    options:{method:'POST',body:JSON.stringify({
     finding,reason:reason.trim(),reviewer_password:password,
    })},authHeaders:headers(user.id,token),
   })
   if(!result.finding||result.finding.public_verified_review!==false||
      result.finding.canonical_dispute_case_modified!==false||
      result.finding.provider_payment_status_modified!==false)
    throw Error('Independent private finding lacked an immutable custody receipt')
   setNotice('Independent private finding recorded. No public rating, payment, escrow or dispute state was changed.')
   setPrivateCase(null);setPassword('');setReason('')
   await load()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Independent case review refused')
  }finally{setBusy(false);setPassword('')}
 }
 return <main className="min-h-screen bg-slate-50 px-4 py-10">
  <div className="mx-auto max-w-6xl space-y-6">
   <Link to="/admin/dealer-claims" className="text-blue-700 underline text-sm">
    Dealer claim review
   </Link>
   <header>
    <h1 className="text-3xl font-bold">Independent buyer complaint review</h1>
    <p className="text-sm text-slate-600 mt-3">
     Canonical transaction-linked, immutable private case records only. A platform
     reviewer must not be the buyer or the dealership owner. No public review,
     star score, payment, settlement or canonical dispute resolution is authorized.
    </p>
   </header>
   {!isReviewer?<p role="alert" className="rounded-lg border p-5 bg-white">
    Verified platform reviewer access and a real authenticated session are required.
   </p>:<>
    {error&&<p role="alert" className="p-4 border bg-red-50 text-red-900 rounded-lg">{error}</p>}
    {notice&&<p role="status" className="p-4 border bg-blue-50 text-blue-950 rounded-lg">{notice}</p>}
    <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
     <section className="rounded-xl border bg-white p-5 space-y-3">
      <h2 className="font-semibold">Private case queue</h2>
      <button onClick={()=>{void load()}} type="button" className="text-blue-800 underline text-sm">
       Refresh queue
      </button>
      {loading?<p>Loading canonical case references…</p>:cases.length===0?
       <p>No pending private buyer findings.</p>:
       cases.map(row=><button key={row.case_id} type="button"
        onClick={()=>{setSelected(row.case_id);setPrivateCase(null);setReason('');setPassword('')}}
        aria-pressed={selected===row.case_id}
        className={'text-left w-full rounded-lg border p-3 '+
         (selected===row.case_id?'border-blue-700 bg-blue-50':'bg-white')}>
        <strong className="block">{row.case_type.replaceAll('_',' ')}</strong>
        <span className="text-sm">{row.seed_dealer_id}</span>
        <span className="block text-xs break-all text-slate-600">{row.case_id}</span>
       </button>)}
     </section>
     <section className="rounded-xl border bg-white p-5 space-y-4">
      <h2 className="text-xl font-semibold">Password-gated case examination</h2>
      {!selected?<p>Select an independently reviewable case.</p>:<>
       <p className="text-sm">No private buyer statement is provided in the queue.
        The reviewer must reauthenticate to read and again to record a decision.</p>
       <label htmlFor="buyer-feedback-review-password" className="block text-sm font-medium">
        Current reviewer account password
       </label>
       <input id="buyer-feedback-review-password" type="password"
        autoComplete="current-password" value={password}
        onChange={e=>setPassword(e.target.value)}
        className="rounded-lg border p-3 w-full"/>
       <button type="button" onClick={()=>{void inspect()}}
        disabled={password.length<8||busy}
        className="border rounded-lg px-4 py-2 disabled:opacity-50">
        Inspect private buyer statement</button>
       {activeCase&&<div className="border-t pt-4 space-y-3">
        <p className="text-sm font-semibold">Canonical buyer reference: {activeCase.buyer_user_id}</p>
        <p className="text-sm break-all">Escrow intent: {activeCase.transaction_intent_id}</p>
        <p className="text-sm">Recorded state: {activeCase.canonical_transaction_state_at_submission}</p>
        <p className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap">{activeCase.statement}</p>
        {activeCase.submitted_rating!==null&&
         <p className="text-sm text-amber-800">Private proposed rating: {activeCase.submitted_rating}/5,
          not certified and not displayed to buyers.</p>}
        <label htmlFor="buyer-case-finding" className="block text-sm font-medium">
         Independent non-public finding
        </label>
        <select id="buyer-case-finding" value={finding}
         onChange={e=>setFinding(e.target.value as (typeof FINDINGS)[number][0])}
         className="w-full border rounded-lg p-3">
         {FINDINGS.map(([value,label])=><option value={value} key={value}>{label}</option>)}
        </select>
        <label htmlFor="buyer-case-rationale" className="block text-sm font-medium">
         Evidence and moderation rationale (80–3,000 characters)
        </label>
        <textarea id="buyer-case-rationale" value={reason}
         onChange={e=>setReason(e.target.value)}
         maxLength={3000} className="w-full border rounded-lg p-3 min-h-32"/>
        <p className="text-xs text-slate-600">
         Reenter the reviewer password above before submission. This appends a finding
         but does not contact a dispute provider or grant refund/verified-review status.
        </p>
        <button type="button" onClick={()=>{void record()}}
         disabled={busy||password.length<8||reason.trim().length<80}
         className="rounded-lg bg-blue-800 text-white px-5 py-3 disabled:opacity-50">
         Record immutable private finding
        </button>
       </div>}
      </>}
     </section>
    </div>
   </>}
  </div>
 </main>
}
