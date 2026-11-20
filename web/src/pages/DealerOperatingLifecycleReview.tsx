import {useEffect,useState} from 'react'
import { dealerDate, dealerDateTime } from '@/lib/dealerDates'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
import ReviewerStepUpField from '@/components/dealer/ReviewerStepUpField'
import { useInReviewWorkbench } from '@/components/dealer/reviewWorkbenchContext'
import {
  REVIEW_FIELD, REVIEW_LABEL, REVIEW_PRIMARY, ReviewAudienceSplit, ReviewAuditTrail, ReviewCaseBody, ReviewCaseHeader, ReviewChoice, ReviewDecisionPanel, ReviewFacts, ReviewMessages, ReviewNoCase, ReviewQueueItem, ReviewQueuePanel, ReviewReasonField, ReviewSection, ReviewStatusChip, ReviewStepUp, ReviewWorkbenchGrid, ReviewWorkbenchHeader, type ReviewQueueState,
} from '@/components/dealer/review/ReviewCaseFile'
import { noCaseTitle } from '@/components/dealer/review/reviewTone'

/**
 * R4 P0-3 (C12) — independent reviewer workbench for a dealership's operating lifecycle.
 * Every decision is password stepped-up, reasoned and append-only. Suspension, investigation and
 * withdrawal remove public stock at the data layer; reinstatement needs a DIFFERENT reviewer from the
 * one who suspended; renewal needs a newer independent legal review. Nothing here republishes stock,
 * restores a storefront or changes a payment entitlement.
 */
type QueueCase={seed_dealer_id:string;operating_status:string}
type LifecycleEvent={event_id:string;action:string;previous_operating_status:string;
 next_operating_status:string;public_listings_withdrawn:number;created_at:string;recorded_by_this_reviewer:boolean;reason?:string|null}
type RenewalCandidate={legal_review_id:string;reviewed_at:string;legal_expires_at:string;approved_scope:string}
type Lifecycle={seed_dealer_id:string;operating_status:string;events:LifecycleEvent[];renewal_candidates?:RenewalCandidate[]}
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
 // RX05-D: lets the unified queue tell "loading" and "could not load" apart from "empty" (legacy view unchanged).
 const [casesRead,setCasesRead]=useState<'loading'|'ready'|'failed'>('loading')
 const userId=user?.id
 useEffect(()=>{
  if(!userId||!token)return
  let live=true
  apiRequest<{cases:QueueCase[]}>({baseUrl:API,path:'/admin/dealership/operating-lifecycle',
   authHeaders:{'x-session-token':token,'x-user-id':userId}})
   .then(r=>{if(live){setCases(r.cases||[]);setCasesRead('ready')}}).catch(e=>{if(live){setError(message(e));setCasesRead('failed')}})
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
 // RX05-D — unified ReviewWorkbench composition (presentation only; same state, handlers and rules).
 const inWorkbench=useInReviewWorkbench()
 if(inWorkbench){
  const qs:ReviewQueueState=casesRead==='loading'?'loading':casesRead==='failed'?'unavailable':cases.length?'ready':'empty'
  // A detail read for an earlier selection never stands in for the current one.
  const lc=lifecycle&&lifecycle.seed_dealer_id===seed?lifecycle:null
  const human=(v:string)=>v.replaceAll('_',' ').toLowerCase()
  const renewals=lc?.renewal_candidates||[]
  return <div className="min-w-0 pb-8" data-testid="lifecycle-review-workbench">
   <ReviewWorkbenchHeader eyebrow="Operating lifecycle workbench" title="Dealership operating lifecycle"
    summaryLabel="What a lifecycle decision does — and does not do">
    <p>Independent decisions only. You cannot decide for a dealership you belong to,
     and you cannot reinstate a suspension you recorded yourself.</p>
    <p>Suspension, investigation and withdrawal remove public stock at the data layer. Reinstatement needs a different
     reviewer from the one who suspended; renewal needs a newer independent legal review. Nothing here republishes stock,
     restores a storefront or changes a payment entitlement.</p>
   </ReviewWorkbenchHeader>
   <ReviewWorkbenchGrid testId="lifecycle-review-grid" caseLabel="Selected dealership"
    queue={<ReviewQueuePanel testId="lifecycle-queue" listLabel="Activated dealerships" title="Queue"
     count={qs==='ready'||qs==='empty'?cases.length:null} onRefresh={()=>setRefresh(n=>n+1)} state={qs}
     loadingText="Loading activated dealerships…" unavailableTestId="lifecycle-queue-unavailable"
     unavailableMessage={<>The activated dealerships could not be loaded{error?<> ({error})</>:null}.</>}
     emptyTitle="No activated dealerships are recorded"
     emptyBody="A dealership appears here only after a separate final approver has activated it.">
     {cases.map(c=><ReviewQueueItem key={c.seed_dealer_id} testId={`lifecycle-queue-item-${c.seed_dealer_id}`}
      selected={seed===c.seed_dealer_id} title={c.seed_dealer_id} status={c.operating_status}
      onSelect={()=>{setSeed(c.seed_dealer_id);setNotice('');setError('')}}/>)}
    </ReviewQueuePanel>}>
    {!seed&&<ReviewNoCase title={noCaseTitle(qs,'Select an activated dealership from the queue.','There is no activated dealership to review.')}
     body={qs==='ready'?"Its operating status, renewal options and every recorded lifecycle decision open here.":undefined}/>}
    {seed&&<>
     <ReviewCaseHeader testId="lifecycle-case-identity" eyebrow="Activated dealership" title={seed}
      status={lc?lc.operating_status:'LOADING'} statusLabel={lc?undefined:error?'Not loaded':'Loading…'}
      facts={lc?[
       {label:'Operating status',value:human(lc.operating_status)},
       {label:'Decisions on record',value:String(lc.events.length)},
      ]:undefined}/>
     <ReviewAudienceSplit audience="dealer"
      facingNote="The dealership sees its operating status and the effect on its public stock. Lifecycle reasons are reviewer-only and are never shown to the dealership."
      facing={lc?<ReviewFacts items={[{label:'Status they see',value:<ReviewStatusChip status={lc.operating_status}/>}]}/>:undefined}
      internal={lc?<ReviewFacts items={[
       {label:'Recorded by you',value:String(lc.events.filter(e=>e.recorded_by_this_reviewer).length)},
       {label:'Reinstating your own suspension',value:'Not permitted'},
      ]}/>:undefined}/>
     <ReviewCaseBody
      evidence={<ReviewSection testId="lifecycle-evidence" title="Newer independent legal reviews" provenance="server"
       description="Renewal can only move this dealership onto a newer, unexpired independent legal review of the same applicant.">
       {!lc&&<p className="text-sm text-carup-text-2">{error?'The lifecycle record could not be loaded.':'Loading the lifecycle record…'}</p>}
       {lc&&renewals.length===0&&<p className="text-sm text-carup-text-2">No newer unexpired legal review exists for this dealership.</p>}
       {lc&&renewals.length>0&&<ul className="space-y-2">
        {renewals.map(c=><li key={c.legal_review_id} className="rounded-control bg-carup-bg-surface p-3 text-sm text-carup-text">
         Reviewed {dealerDate(c.reviewed_at)} · valid until {dealerDate(c.legal_expires_at)} · {human(c.approved_scope)}
        </li>)}
       </ul>}
      </ReviewSection>}
      decision={<div className="min-w-0 space-y-4" data-testid="lifecycle-decision">
       <ReviewStepUp note="Step-up for this decision only. It is cleared after each attempt.">
        <div>
         <label className={REVIEW_LABEL} htmlFor="lifecycle-password">Your password (step-up for this decision only)</label>
         <ReviewerStepUpField plain id="lifecycle-password" value={password} onChange={setPassword}
          username={user?.email} inputClassName={REVIEW_FIELD}/>
        </div>
       </ReviewStepUp>
       <ReviewDecisionPanel title="Lifecycle decision" ariaLabel={'Lifecycle decision for '+seed}
        requirements={[
         {label:'Reviewer password entered',met:Boolean(password)},
         {label:'Reason written (at least 40 characters)',met:reason.trim().length>=40},
         ...(action==='RENEW'?[{label:'A newer independent legal review chosen',met:Boolean(legalReview)}]:[]),
        ]}
        footnote="Recorded permanently. Nothing here republishes stock, restores a storefront or changes a payment entitlement."
        submit={<button type="button" className={REVIEW_PRIMARY}
         disabled={busy||!password||reason.trim().length<40||(action==='RENEW'&&!legalReview)}
         onClick={()=>{void decide()}}>{busy?'Recording…':'Record immutable lifecycle decision'}</button>}>
        <ReviewChoice id="lifecycle-action" legend="Decision" value={action} onChange={setAction} options={ACTIONS}/>
        {action==='RENEW'&&<div>
         <label htmlFor="lifecycle-legal-review" className={REVIEW_LABEL}>Newer independent legal review</label>
         <select id="lifecycle-legal-review" className={REVIEW_FIELD} value={legalReview} onChange={e=>setLegalReview(e.target.value)} required>
          <option value="">{renewals.length?'Choose the newer legal review':'No newer unexpired legal review exists for this dealership'}</option>
          {renewals.map(c=><option key={c.legal_review_id} value={c.legal_review_id}>
           Reviewed {dealerDate(c.reviewed_at)} · valid until {dealerDate(c.legal_expires_at)} · {c.approved_scope}
          </option>)}
         </select>
        </div>}
        <ReviewReasonField id="lifecycle-reason" label="Reason (40–3000 characters, recorded permanently)"
         value={reason} onChange={setReason} min={40}
         audience="Internal reviewer reason — the next independent reviewer reads it; the dealership never does."/>
       </ReviewDecisionPanel>
       <ReviewMessages notice={notice} error={error} errorPrefix="Not recorded: "/>
      </div>}
      audit={<ReviewAuditTrail testId="lifecycle-history" title="Recorded decisions"
       entries={(lc?.events||[]).map(e=>({id:e.event_id,
        title:`${human(e.action).replace(/^./,x=>x.toUpperCase())}: ${human(e.previous_operating_status)} → ${human(e.next_operating_status)}`,
        at:e.created_at,actor:e.recorded_by_this_reviewer?'recorded by you':undefined,
        detail:<>Public listings withdrawn: {e.public_listings_withdrawn}
         {e.reason&&<span className="mt-1 block rounded-control bg-carup-bg-surface p-2 text-carup-text">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">Internal reason</span>
          <span className="mt-0.5 block whitespace-pre-wrap">{e.reason}</span></span>}</>}))}
       empty={lc?'No lifecycle decisions yet.':'The decision history appears once the lifecycle record has loaded.'}
       note="Every lifecycle decision the server returns for this dealership, newest first."/>}/>
    </>}
   </ReviewWorkbenchGrid>
  </div>
 }
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
     {action==='RENEW'&&<label className="block text-sm">Newer independent legal review
      <select id="lifecycle-legal-review" className={field} value={legalReview}
       onChange={e=>setLegalReview(e.target.value)} required>
       <option value="">{(lifecycle?.renewal_candidates||[]).length
        ?'Choose the newer legal review':'No newer unexpired legal review exists for this dealership'}</option>
       {(lifecycle?.renewal_candidates||[]).map(c=><option key={c.legal_review_id} value={c.legal_review_id}>
        Reviewed {dealerDate(c.reviewed_at)} · valid until {dealerDate(c.legal_expires_at)} · {c.approved_scope}
       </option>)}
      </select></label>}
     <label className="block text-sm">Reason (40–3000 characters, recorded permanently)
      <textarea id="lifecycle-reason" className={field+' min-h-28'} value={reason} minLength={40} maxLength={3000}
       required onChange={e=>setReason(e.target.value)}/></label>
     <label className="block text-sm" htmlFor="lifecycle-password">Your password (step-up for this decision only)</label>
     <ReviewerStepUpField plain id="lifecycle-password" value={password} onChange={setPassword}
      username={user?.email} inputClassName={field}/>
     <button type="submit" disabled={busy||!password||reason.trim().length<40||(action==='RENEW'&&!legalReview)}
      className="min-h-11 rounded bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60">
      {busy?'Recording…':'Record immutable lifecycle decision'}</button>
    </form>
    <h3 className="mt-6 font-semibold">Recorded decisions</h3>
    <ol className="mt-2 space-y-2 text-sm" data-testid="lifecycle-history">
     {(lifecycle?.events||[]).map(e=><li key={e.event_id} className="rounded border border-slate-200 p-2">
      <strong>{e.action}</strong>: {e.previous_operating_status} → {e.next_operating_status} · withdrawn
      {' '}{e.public_listings_withdrawn} · {dealerDateTime(e.created_at)}
      {e.recorded_by_this_reviewer&&' · recorded by you'}
      {e.reason&&<span className="block mt-1 text-slate-700 break-words">Reason: {e.reason}</span>}</li>)}
     {lifecycle&&lifecycle.events.length===0&&<li className="text-slate-600">No lifecycle decisions yet.</li>}
    </ol>
   </section>}
  </div>
 </main>
}
