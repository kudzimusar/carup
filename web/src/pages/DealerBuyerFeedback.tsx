import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Transaction={
 transaction_id:string;seed_dealer_id:string;canonical_status:string;
 can_submit_complaint:boolean;can_submit_review_candidate:boolean;
 verified_real_purchase:false;public_review_enabled:false;
}
type Case={
 case_id:string;seed_dealer_id:string;transaction_intent_id:string;
 case_type:'BUYER_COMPLAINT'|'REVIEW_CANDIDATE';submitted_rating:number|null;
 submitted_at:string;
}
type Context={entries:Transaction[];cases:Case[];
 private_cases_only:true;public_ratings_activated:false}
type Receipt={case_id:string;state:string;public_review_eligible:false;
 verified_purchase:false;payment_changed:false}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
 typeof window==='undefined'?undefined:window.location.hostname)
function sessionHeaders(userId:string,token:string):AuthHeaders{
 return {'x-user-id':userId,'x-session-token':token}
}
/**
 * C23: private complaint/feedback intake with a canonical transaction FK.
 * NOT a public review widget and NOT evidence of completed real purchase.
 * Real payment, dispute processing, ratings and settlement remain distinct.
 */
export default function DealerBuyerFeedback(){
 const {user,token}=useAuth()
 const [context,setContext]=useState<Context|null>(null)
 const [selected,setSelected]=useState('')
 const [type,setType]=useState<'BUYER_COMPLAINT'|'REVIEW_CANDIDATE'>('BUYER_COMPLAINT')
 const [rating,setRating]=useState(0)
 const [statement,setStatement]=useState('')
 const [loading,setLoading]=useState(true)
 const [saving,setSaving]=useState(false)
 const [notice,setNotice]=useState('')
 const [error,setError]=useState('')
 const load=useCallback(async()=>{
  if(!user||!token){setContext(null);setLoading(false);return}
  setLoading(true)
  try{
   const result=await apiRequest<Context>({
    baseUrl:API,path:'/dealership/buyer-feedback/mine',
    authHeaders:sessionHeaders(user.id,token),
   })
   if(!result.private_cases_only||result.public_ratings_activated!==false||
      !Array.isArray(result.entries)||!Array.isArray(result.cases))
     throw Error('Canonical private buyer case source unavailable')
   setContext(result)
   setSelected(previous=>result.entries.some(t=>t.transaction_id===previous)
    ?previous:result.entries[0]?.transaction_id||'')
  }catch(problem){
   setContext(null)
   setError(problem instanceof Error?problem.message:'Buyer case source unavailable')
  }finally{setLoading(false)}
 },[user,token])
 useEffect(()=>{void Promise.resolve().then(load)},[load])
 const transaction=context?.entries.find(t=>t.transaction_id===selected)
 const canSubmit=Boolean(user&&token&&transaction&&statement.trim().length>=40&&
  statement.trim().length<=2000&&!saving&&
  (type==='BUYER_COMPLAINT'||(
   transaction.can_submit_review_candidate&&Number.isInteger(rating)&&rating>=1&&rating<=5
  )))
 async function submit(){
  if(!canSubmit||!user||!token||!transaction)return
  setSaving(true);setNotice('');setError('')
  try{
   const result=await apiRequest<{receipt:Receipt}>({
    baseUrl:API,path:'/dealership/buyer-feedback/cases',
    options:{method:'POST',body:JSON.stringify({
     transaction_id:transaction.transaction_id,
     seed_dealer_id:transaction.seed_dealer_id,
     case_type:type,statement:statement.trim(),
     rating:type==='REVIEW_CANDIDATE'?rating:null,
    })},
    authHeaders:sessionHeaders(user.id,token),
   })
   if(!result.receipt||result.receipt.public_review_eligible!==false||
      result.receipt.verified_purchase!==false||
      result.receipt.payment_changed!==false)
    throw Error('Private case receipt was not independently confirmed')
   setStatement('');setRating(0);setType('BUYER_COMPLAINT')
   setNotice('Private buyer case recorded. Independent review is required. No public rating, refund or payment status was created.')
   await load()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Private buyer case submission refused')
  }finally{setSaving(false)}
 }
 return <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
  <div className="max-w-4xl mx-auto space-y-6">
   <Link to="/dealers" className="text-blue-700 underline text-sm">Dealer directory</Link>
   <header>
    <h1 className="text-3xl font-bold">Private buyer feedback and complaints</h1>
    <p className="text-slate-600 mt-3 max-w-3xl">
     Only transactions actually linked to your authenticated account and a canonical
     dealership appear here. Submitting a case does not verify a purchase, publish
     stars, open an escrow dispute, authorize refunds or change any payment.
    </p>
   </header>
   {!user||!token?<section className="rounded-xl border bg-white p-5" role="alert">
    Sign in to access only your own transaction-linked private cases.
    <Link className="text-blue-700 underline ml-2" to="/login">Sign in</Link>
   </section>:<>
    {loading?<p role="status">Checking your canonical transaction history…</p>:<>
     {error&&<p role="alert" className="p-4 border rounded-lg bg-red-50 text-red-900">{error}</p>}
     {notice&&<p role="status" className="p-4 border rounded-lg bg-blue-50 text-blue-950">{notice}</p>}
     {context?.entries.length===0&&<div className="rounded-xl bg-white border p-6">
      <h2 className="font-semibold">No eligible dealership transaction record found</h2>
      <p className="text-sm text-slate-600 mt-2">
       This is not proof you have no purchases. The canonical transaction source
       could not link an eligible dealership transaction to this account.
       A general listing correction is handled separately and cannot become a verified review.
      </p>
     </div>}
     {transaction&&<section className="bg-white rounded-xl border p-6 space-y-4">
      <h2 className="font-semibold text-xl">Submit a private case</h2>
      <label htmlFor="buyer-dealer-transaction" className="block text-sm font-medium">
       Your canonical dealership transaction
      </label>
      <select id="buyer-dealer-transaction" value={selected}
       onChange={e=>{setSelected(e.target.value);setType('BUYER_COMPLAINT');setRating(0)}}
       className="w-full rounded-lg border p-3">
       {context?.entries.map(row=><option value={row.transaction_id} key={row.transaction_id}>
        {row.seed_dealer_id} · {row.transaction_id} · {row.canonical_status}
       </option>)}
      </select>
      <p className="text-xs text-amber-800">
       A canonical status, including sandbox release, is not independent proof of a
       completed real-world purchase or a verified public review.
      </p>
      <fieldset className="space-y-2">
       <legend className="text-sm font-semibold">Case type</legend>
       <label className="flex gap-2 items-center">
        <input type="radio" name="feedback-kind" value="BUYER_COMPLAINT"
         checked={type==='BUYER_COMPLAINT'} onChange={()=>setType('BUYER_COMPLAINT')}/>
        Private buyer complaint
       </label>
       <label className="flex gap-2 items-center">
        <input type="radio" name="feedback-kind" value="REVIEW_CANDIDATE"
         disabled={!transaction.can_submit_review_candidate}
         checked={type==='REVIEW_CANDIDATE'}
         onChange={()=>setType('REVIEW_CANDIDATE')}/>
        Unverified review candidate (never a public rating)
       </label>
      </fieldset>
      {type==='REVIEW_CANDIDATE'&&<>
       <label htmlFor="candidate-rating" className="block text-sm font-medium">
        Proposed rating — for independent private review only
       </label>
       <select id="candidate-rating" value={rating}
        onChange={e=>setRating(Number(e.target.value))}
        className="rounded-lg border p-3">
        <option value={0}>Select 1–5</option>
        {[1,2,3,4,5].map(n=><option value={n} key={n}>{n}</option>)}
       </select>
      </>}
      <label htmlFor="buyer-case-description" className="block text-sm font-medium">
       Your account of the issue (40–2,000 characters)
      </label>
      <textarea id="buyer-case-description" value={statement}
       minLength={40} maxLength={2000}
       onChange={e=>setStatement(e.target.value)}
       className="w-full rounded-lg border p-3 min-h-36" />
      <button type="button" disabled={!canSubmit} onClick={()=>{void submit()}}
       className="rounded-lg bg-blue-800 text-white px-5 py-3 disabled:opacity-50">
       {saving?'Submitting privately…':'Submit private buyer case'}
      </button>
     </section>}
     <section className="rounded-xl border bg-white p-6 space-y-3">
      <h2 className="font-semibold text-xl">Your recorded cases</h2>
      {context?.cases.length===0?<p>No private cases have been submitted.</p>:
       context?.cases.map(row=><div key={row.case_id} className="border-t pt-3 text-sm">
        <p className="font-semibold">{row.case_type.replaceAll('_',' ')} · {row.seed_dealer_id}</p>
        <p className="break-all text-slate-600">Receipt: {row.case_id}</p>
        <p className="text-slate-600">Status: private case; independent finding pending or recorded separately</p>
       </div>)}
      <p className="text-xs text-slate-600">Public verified review count and score are not inferred from private cases.</p>
     </section>
    </>}
   </>}
  </div>
 </main>
}
