import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react'
import { DEALER_WRAP_BUTTON } from '@/components/dealer/dealerButtonWrap'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
import {dealerRefusalCode,dealerReviewerErrorMessage} from '@/lib/dealerReviewerErrors'
import ReviewerStepUpField from '@/components/dealer/ReviewerStepUpField'
import { dealerDateTime } from '@/lib/dealerDates'
import { useInReviewWorkbench } from '@/components/dealer/reviewWorkbenchContext'
import {
  REVIEW_LABEL, REVIEW_PRIMARY, REVIEW_SECONDARY, ReviewAccessNotice, ReviewAudienceSplit, ReviewAuditTrail, ReviewCaseBody, ReviewCaseHeader, ReviewChoice, ReviewDecisionPanel, ReviewFacts, ReviewMessages, ReviewNoCase, ReviewQueueItem, ReviewQueuePanel, ReviewQueueTabs, ReviewReasonField, ReviewSection, ReviewStepUp, ReviewWorkbenchGrid, ReviewWorkbenchHeader, type ReviewQueueState,
} from '@/components/dealer/review/ReviewCaseFile'
import { noCaseTitle } from '@/components/dealer/review/reviewTone'

type QueueItem={seed_dealer_id:string;operating_status:string;
  independent_reviewer_required:boolean}
type Candidate={
 seed_dealer_id:string;operating_status:string;
 branches:Array<{branch_id:string;proposed_name:string;proposed_address:string;
   public_approved:false}>;
 proposed_sections:Record<string,{version:number;
   proposed_values:Record<string,string>;source:string}>;
}
type MediaQueueItem={
  media_id:string;seed_dealer_id:string;branch_id:string|null;
  mime_type:string;file_bytes:number;media_category:string;
  caption:string;alt_text:string;rights_attestation:string;
  review_status:string;created_at:string;
  independent_reviewer_required:boolean;
  conflict_of_interest?:boolean;
  ticket_issuance_deferred?:boolean;
  preview_ticket:string|null;
  decision_ticket:string|null;
  ticket_expires_at:string|null;
  logo_rights_approved:false;
}
type MediaRefusal={message:string;ticketInvalid:boolean;operation:'preview'|'decision'}
type MediaPreview={
  media_id:string;seed_dealer_id:string;mime_type:string;
  media_category:string;caption:string;alt_text:string;
  rights_attestation:string;review_status:string;
  sha256:string;expires_seconds:number;signed_url:string;
  logo_rights_approved:false;
}
type MediaDecision='APPROVED_PUBLIC_DISPLAY'|'REJECTED'|'RETRACTED'
const MEDIA_CATEGORY_LABELS:Record<string,string>={
 SHOWROOM_EXTERIOR:'Showroom exterior',SHOWROOM_INTERIOR:'Showroom interior',BRANCH_FACILITY:'Branch facility',
 SERVICE_BAY:'Service bay / workshop',COMPANY_PROFILE_IMAGE:'Company profile image',COMPANY_COVER_IMAGE:'Cover image',
}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
function headers(id:string,token:string):AuthHeaders{
 return {'x-session-token':token,'x-user-id':id}
}
/** Human maker-checker publication; empty records are NOT a valid approval. */
export default function DealerFullStorefrontReview(){
 const {user,token}=useAuth()
 const reviewer=Boolean(user&&token&&
  ['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
 const [queue,setQueue]=useState<QueueItem[]>([])
 const [mediaQueue,setMediaQueue]=useState<MediaQueueItem[]>([])
 const [selectedMediaKey,setSelectedMediaKey]=useState('')
 const [mediaPreview,setMediaPreview]=useState<MediaPreview|null>(null)
 const [mediaDecision,setMediaDecision]=useState<MediaDecision>('APPROVED_PUBLIC_DISPLAY')
 const [mediaReason,setMediaReason]=useState('')
 const [seed,setSeed]=useState('')
 const [candidate,setCandidate]=useState<Candidate|null>(null)
 const [password,setPassword]=useState('')
 const [reason,setReason]=useState('')
 const [approvedBranches,setApprovedBranches]=useState<string[]>([])
 const [approvedSections,setApprovedSections]=useState<string[]>([])
 const [disposition,setDisposition]=useState<'PUBLISHED_FULL'|'RETRACTED'>('PUBLISHED_FULL')
 const [busy,setBusy]=useState(false)
 const [status,setStatus]=useState('')
 const [error,setError]=useState('')
 // Media review tickets are single-use: a ticket that an attempt presented is never presented again from
 // this page. Its refusal stays next to the media actions until a refresh brings newly issued tickets.
 const [spentTickets,setSpentTickets]=useState<string[]>([])
 const [mediaRefusal,setMediaRefusal]=useState<MediaRefusal|null>(null)
 const refreshRef=useRef<HTMLButtonElement>(null)
 // RX05-D: lets the unified queues tell "loading" and "could not load" apart from "empty" (legacy view unchanged).
 const [readState,setReadState]=useState<'loading'|'ready'|'failed'>('loading')
 const [mediaRead,setMediaRead]=useState<'ready'|'failed'>('ready')
 /** Resolves to the refreshed media queue, or null when it could not be read. */
 const reload=useCallback(async():Promise<MediaQueueItem[]|null>=>{
  if(!reviewer||!user||!token)return null
  try{
   const [result,mediaResult]=await Promise.all([
    apiRequest<{cases:QueueItem[]}>({
     baseUrl:API,path:'/admin/dealership/full-storefronts/queue',
     authHeaders:headers(user.id,token),
    }),
    apiRequest<{items:MediaQueueItem[]}>({
     baseUrl:API,path:'/admin/dealership/storefront-media/queue',
     authHeaders:headers(user.id,token),
    }).catch(()=>null),
   ])
   const mediaItems=mediaResult?.items||[]
   setQueue(result.cases||[])
   setMediaQueue(mediaItems)
   setSeed(previous=>result.cases.some(x=>x.seed_dealer_id===previous)
    ?previous:result.cases[0]?.seed_dealer_id||'')
   setSelectedMediaKey(previous=>mediaItems.some(m=>m.media_id===previous)
    ?previous:mediaItems[0]?.media_id||'')
   setReadState('ready');setMediaRead(mediaResult?'ready':'failed')
   return mediaResult?mediaItems:null
  }catch(problem){
   setQueue([])
   setReadState('failed')
   setError(dealerReviewerErrorMessage(problem,'Could not load independent publication queue'))
   return null
  }
 },[reviewer,user,token])
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
   if(active){setCandidate(null);setApprovedBranches([]);setApprovedSections([]);setReason('')}
  })
  return()=>{active=false}
 },[seed])
 const item=queue.find(x=>x.seed_dealer_id===seed)
 const currentMedia=mediaQueue.find(m=>m.media_id===selectedMediaKey)
 const previewSpent=Boolean(currentMedia?.preview_ticket&&spentTickets.includes(currentMedia.preview_ticket))
 const decisionSpent=Boolean(currentMedia?.decision_ticket&&spentTickets.includes(currentMedia.decision_ticket))
 const showMediaRefusal=Boolean(mediaRefusal&&(previewSpent||decisionSpent))
 useEffect(()=>{if(mediaRefusal)refreshRef.current?.focus()},[mediaRefusal])
 /** The attempt presented `ticket`: whatever the outcome, it is spent and never presented again. */
 function refuseMedia(problem:unknown,ticket:string,operation:MediaRefusal['operation'],fallback:string){
  setSpentTickets(previous=>[...previous,ticket])
  setMediaRefusal({
   message:dealerReviewerErrorMessage(problem,fallback),
   ticketInvalid:dealerRefusalCode(problem)==='STOREFRONT_MEDIA_REVIEW_TICKET_INVALID',
   operation,
  })
 }
 /** Reviewer-initiated only: a new queue read issues new tickets; nothing is re-sent or retried. */
 async function refreshReviewQueue(){
  if(busy)return
  const key=selectedMediaKey
  setBusy(true);setError('');setStatus('');setMediaPreview(null)
  try{
   const items=await reload()
   if(!items){
    setError(previous=>previous||'The review queue could not be refreshed. Check your connection, then try again.')
    return
   }
   setSpentTickets([]);setMediaRefusal(null)
   const fresh=items.find(m=>m.media_id===key)
   if(!fresh){setStatus('Review queue refreshed. That media item is no longer waiting for your review.');return}
   if(fresh.preview_ticket&&fresh.decision_ticket){
    setStatus('Review queue refreshed with new single-use review tickets. Enter your password again to continue.')
    document.getElementById('storefront-password')?.focus()
   }
  }finally{setBusy(false)}
 }
 async function inspect(){
  if(!user||!token||busy||!seed||password.length<8)return
  setBusy(true);setError('');setStatus('')
  try{
   const result=await apiRequest<{candidate:Candidate}>({
    baseUrl:API,path:'/admin/dealership/full-storefronts/'+encodeURIComponent(seed)+'/preview',
    options:{method:'POST',body:JSON.stringify({reviewer_password:password})},
    authHeaders:headers(user.id,token),
   })
   setCandidate(result.candidate)
   setStatus('Private applicant content opened. Verify each branch and declared section independently before selecting it.')
  }catch(problem){
   setError(dealerReviewerErrorMessage(problem,'Independent review password not accepted'))
  }finally{setPassword('');setBusy(false)}
 }
 async function inspectMedia(){
  const ticket=currentMedia?.preview_ticket
  if(!user||!token||busy||!currentMedia||!ticket||previewSpent||password.length<8)return
  setBusy(true);setError('');setStatus('')
  try{
   const result=await apiRequest<{preview:MediaPreview}>({
    baseUrl:API,path:'/admin/dealership/storefront-media/'+encodeURIComponent(currentMedia.seed_dealer_id)+'/preview',
    options:{method:'POST',body:JSON.stringify({
      review_ticket:ticket,
      reviewer_password:password,
    })},
    authHeaders:headers(user.id,token),
   })
   setMediaPreview(result.preview)
   setStatus('Opened private storefront media preview ('+result.preview.media_id+'). Check alt text, caption and absence of OEM/brand logos before approving.')
  }catch(problem){
   refuseMedia(problem,ticket,'preview','Storefront media preview refused')
  }finally{setPassword('');setBusy(false)}
 }
 async function recordMediaDecision(){
  const ticket=currentMedia?.decision_ticket
  if(!user||!token||busy||!currentMedia||!ticket||decisionSpent||password.length<8||mediaReason.trim().length<40)return
  setBusy(true);setError('');setStatus('')
  try{
   const result=await apiRequest<{review:{media_id:string;decision:string;public_display_approved:boolean}}>({
    baseUrl:API,path:'/admin/dealership/storefront-media/'+encodeURIComponent(currentMedia.seed_dealer_id)+'/review',
    options:{method:'POST',body:JSON.stringify({
      review_ticket:ticket,
      decision:mediaDecision,
      reason:mediaReason.trim(),
      reviewer_password:password,
    })},
    authHeaders:headers(user.id,token),
   })
   setStatus('Recorded storefront media decision '+result.review.decision+' for '+result.review.media_id+'.')
   setMediaPreview(null);setMediaReason('')
   setSpentTickets([]);setMediaRefusal(null)
   await reload()
  }catch(problem){
   refuseMedia(problem,ticket,'decision','Storefront media decision refused')
  }finally{setPassword('');setBusy(false)}
 }
 async function record(){
  if(!user||!token||busy||!seed||reason.trim().length<80||password.length<8)return
  if(disposition==='PUBLISHED_FULL'&&(!candidate||!approvedBranches.length))return
  setBusy(true);setStatus('');setError('')
  try{
   const result=await apiRequest<{review:{disposition:string;public_full_approved:boolean}}>({
    baseUrl:API,path:'/admin/dealership/full-storefronts/'+encodeURIComponent(seed)+'/review',
    options:{method:'POST',body:JSON.stringify({
      disposition,reason:reason.trim(),reviewer_password:password,
      approved_branch_ids:disposition==='RETRACTED'?[]:approvedBranches,
      approved_sections:disposition==='RETRACTED'?[]:approvedSections,
    })},authHeaders:headers(user.id,token),
   })
   setStatus(result.review.disposition==='PUBLISHED_FULL'?
    'Independent full storefront publication event recorded. Current tenant, claim and country policy must remain valid for public display.':
    'Independent full storefront retraction recorded. The previous approved display is no longer current.')
   setCandidate(null);setApprovedBranches([]);setApprovedSections([]);setReason('')
   await reload()
  }catch(problem){
   setError(dealerReviewerErrorMessage(problem,'Publication decision refused'))
  }finally{setBusy(false);setPassword('')}
 }
 const refusalPanel=mediaRefusal&&<div data-testid="dealer-media-review-refusal"
   className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
   <p role="alert" className="text-red-800">{mediaRefusal.message}</p>
   {!mediaRefusal.ticketInvalid&&<p className="text-slate-700">
    Each review ticket works once. Refresh the review queue before you try again.
   </p>}
   <Button ref={refreshRef} type="button" variant="outline" size="sm" disabled={busy}
    onClick={()=>{void refreshReviewQueue()}}>Refresh review queue</Button>
  </div>
 // RX05-D — unified ReviewWorkbench composition (presentation only; same state, handlers and rules).
 const inWorkbench=useInReviewWorkbench()
 const [pane,setPane]=useState<'storefront'|'media'>('storefront')
 if(inWorkbench){
  const human=(v:string)=>v.replaceAll('_',' ').toLowerCase()
  const storefrontState:ReviewQueueState=readState==='loading'?'loading':readState==='failed'?'unavailable':queue.length?'ready':'empty'
  const mediaState:ReviewQueueState=readState==='loading'?'loading':readState==='failed'||mediaRead==='failed'?'unavailable':mediaQueue.length?'ready':'empty'
  const categoryLabel=(m:{media_category:string})=>MEDIA_CATEGORY_LABELS[m.media_category]||m.media_category
  const unifiedRefusal=mediaRefusal&&<div data-testid="dealer-media-review-refusal" className="space-y-2 rounded-card bg-status-danger-soft p-3 text-sm">
   <p role="alert" className="text-status-danger">{mediaRefusal.message}</p>
   {!mediaRefusal.ticketInvalid&&<p className="text-carup-text">Each review ticket works once. Refresh the review queue before you try again.</p>}
   <button ref={refreshRef} type="button" className={REVIEW_SECONDARY} disabled={busy}
    onClick={()=>{void refreshReviewQueue()}}>Refresh review queue</button>
  </div>
  const stepUp=(actions:ReactNode)=><ReviewStepUp actions={actions}
   note="Reviewer password (required before preview and independently before decision). It is cleared after each attempt.">
   <div>
    <label htmlFor="storefront-password" className={REVIEW_LABEL}>Reviewer password</label>
    <ReviewerStepUpField id="storefront-password" value={password} onChange={setPassword} username={user?.email}
     className="mt-1" inputClassName="bg-carup-bg-raised"/>
   </div>
  </ReviewStepUp>
  const mediaPublic=currentMedia?.review_status==='APPROVED_PUBLIC_DISPLAY'
  return <div className="min-w-0 pb-8" data-testid="storefront-review-workbench">
   <ReviewWorkbenchHeader eyebrow="Public storefront workbench" title="Full dealership publication"
    summaryLabel="What a publication decision does — and does not do">
    <p>This is distinct from prelisting research and legal company activation.
     Reviewed branch data and versioned dealer-declared policies are copied into an
     immutable buyer-safe display snapshot. No unlicensed logo, VIN verification,
     OEM franchise, finance-provider approval or subscription is granted.</p>
   </ReviewWorkbenchHeader>
   {!reviewer?<ReviewAccessNotice>Sign in as a verified independent CarUp reviewer. The API enforces this separately.</ReviewAccessNotice>:
   <ReviewWorkbenchGrid testId="storefront-review-grid" caseLabel={pane==='storefront'?'Selected storefront candidate':'Selected media item'}
    queue={<ReviewQueuePanel testId="storefront-queue" title="Queue" listLabel={pane==='storefront'?'Operational approval candidates':'Dealership media items'}
     onRefresh={()=>{void reload()}} state={pane==='storefront'?storefrontState:mediaState}
     loadingText="Loading the publication queue…" unavailableTestId="storefront-queue-unavailable"
     unavailableMessage={pane==='media'&&readState!=='failed'
      ?<>The storefront media queue could not be loaded.</>
      :<>The independent publication queue could not be loaded{error?<> ({error})</>:null}.</>}
     toolbar={<ReviewQueueTabs label="Storefront review queues" active={pane} onChange={setPane} tabs={[
      {id:'storefront',label:'Storefronts',count:readState==='ready'?queue.length:null},
      {id:'media',label:'Media',count:readState==='ready'&&mediaRead==='ready'?mediaQueue.length:null},
     ]}/>}
     emptyTitle={pane==='storefront'?'No legal dealer activation candidates':'No dealership facility media items in queue'}
     emptyBody={pane==='storefront'?'Research-only listings do not qualify. A storefront appears here only after legal activation.'
      :'A photograph appears here when an activated dealership uploads it. Nothing is shown publicly until it is approved.'}>
     {pane==='storefront'
      ?queue.map(x=><ReviewQueueItem key={x.seed_dealer_id} testId={`storefront-queue-item-${x.seed_dealer_id}`}
       selected={seed===x.seed_dealer_id} title={x.seed_dealer_id} status={x.operating_status} statusLabel={`Operating status: ${human(x.operating_status)}`}
       flag={!x.independent_reviewer_required?'Self-review not permitted':undefined}
       onSelect={()=>{setSeed(x.seed_dealer_id);setError('');setStatus('')}}/>)
      :mediaQueue.map(m=><ReviewQueueItem key={m.media_id} testId={`storefront-media-item-${m.media_id}`}
       selected={selectedMediaKey===m.media_id} title={categoryLabel(m)} status={m.review_status}
       meta={[m.seed_dealer_id]} since={m.created_at} sinceLabel="Uploaded"
       flag={!m.independent_reviewer_required?'Self-review not permitted':m.conflict_of_interest?'Conflict of interest':undefined}
       onSelect={()=>{setSelectedMediaKey(m.media_id);setMediaPreview(null)}}/>)}
    </ReviewQueuePanel>}>
    {pane==='storefront'&&<>
     {!item&&<ReviewNoCase title={noCaseTitle(storefrontState,'No business candidate selected.','There is no storefront to review.')}
      body={storefrontState==='ready'?"Choose a legally activated dealership to review its declared branches and sections for public display.":undefined}/>}
     {item&&<>
      <ReviewCaseHeader testId="storefront-case-identity" eyebrow="Full storefront publication" title={seed}
       status={item.operating_status} statusLabel={`Operating status: ${human(item.operating_status)}`}
       facts={[{label:'Research identity',value:seed,mono:true},{label:'Declared content',value:candidate?'Opened privately · not verified':'Not opened'}]}/>
      {!item.independent_reviewer_required&&<p role="alert" className="rounded-card bg-status-warning-soft p-4 text-sm text-status-warning">
       Self-review not permitted: a different independent reviewer must inspect and decide this storefront.</p>}
      <ReviewAudienceSplit audience="public"
       facingNote="Buyers see only an approved publication snapshot: the branches and sections you select. Nothing you leave unselected is published."
       facing={<ReviewFacts items={[
        {label:'Branches selected',value:String(approvedBranches.length)},
        {label:'Sections selected',value:String(approvedSections.length)},
       ]}/>}
       internal={<p className="text-xs leading-5 text-carup-text-2">This queue contains no original private evidence, banking or identity document.
        Explicit display approval is not a guarantee, legal opinion or payment authorization.</p>}/>
      <ReviewCaseBody
       evidence={<>
        {!candidate&&<ReviewSection testId="storefront-evidence-locked" title="Dealer-declared storefront content" provenance="dealer">
         <p className="rounded-control border border-dashed border-carup-line-strong bg-carup-bg-surface p-4 text-center text-sm text-carup-text-2">
          Enter your password under Step-up and choose “Inspect review candidate” to read the declared branches and sections.</p>
        </ReviewSection>}
        {candidate&&<>
         <ReviewSection testId="storefront-branches" title="Approve only verified branch display facts" provenance="dealer"
          description="Verify the actual site before selecting a branch.">
          {candidate.branches.length===0&&<p className="text-sm text-carup-text-2">No branches declared.</p>}
          {candidate.branches.map(b=><label key={b.branch_id}
           className="flex min-h-11 items-start gap-3 rounded-control p-3 text-sm ring-1 ring-carup-line">
           <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={approvedBranches.includes(b.branch_id)}
            onChange={e=>setApprovedBranches(prev=>e.target.checked?[...prev,b.branch_id]:prev.filter(v=>v!==b.branch_id))}/>
           <span className="min-w-0"><span className="block font-semibold text-carup-text">{b.proposed_name}</span>
            <span className="block text-carup-text-2">{b.proposed_address}</span>
            <span className="block text-xs text-carup-text-3">Dealer-declared; verify actual site before selecting</span></span>
          </label>)}
         </ReviewSection>
         <ReviewSection testId="storefront-sections" title="Independently review dealer-declared sections" provenance="dealer">
          {Object.keys(candidate.proposed_sections).length===0&&<p className="text-sm text-carup-text-2">No sections declared.</p>}
          {Object.entries(candidate.proposed_sections).map(([key,value])=>
           <div key={key} className="rounded-control p-3 text-sm ring-1 ring-carup-line">
            <label className="flex min-h-11 items-center gap-2 font-semibold text-carup-text">
             <input type="checkbox" className="h-4 w-4 shrink-0" checked={approvedSections.includes(key)}
              onChange={e=>setApprovedSections(prev=>e.target.checked?[...prev,key]:prev.filter(x=>x!==key))}/>
             {key.replaceAll('_',' ')} · version {value.version}
            </label>
            <ReviewFacts className="mt-2" items={Object.entries(value.proposed_values).map(([field,text])=>({label:field.replaceAll('_',' '),value:text}))}/>
           </div>)}
         </ReviewSection>
        </>}
       </>}
       decision={<div className="min-w-0 space-y-4" data-testid="storefront-decision">
        {stepUp(<button type="button" className={REVIEW_SECONDARY+' w-full'} disabled={busy||password.length<8||!item.independent_reviewer_required}
         onClick={()=>{void inspect()}}>Inspect review candidate</button>)}
        <ReviewDecisionPanel title="Independent publication decision"
         requirements={[
          {label:'Reviewer password entered again (at least 8 characters)',met:password.length>=8},
          {label:'Source, branch, legal and policy rationale written (at least 80 characters)',met:reason.trim().length>=80},
          ...(disposition==='PUBLISHED_FULL'?[
           {label:'Declared content inspected in this session',met:Boolean(candidate)},
           {label:'At least one independently checked branch selected',met:approvedBranches.length>0},
          ]:[]),
         ]}
         footnote="A full publication requires at least one independently checked, selected branch."
         submit={<button type="button" className={REVIEW_PRIMARY} disabled={busy||password.length<8||reason.trim().length<80||
          (disposition==='PUBLISHED_FULL'&&(!candidate||approvedBranches.length===0))}
          onClick={()=>{void record()}}>Record immutable publication decision</button>}>
         <ReviewChoice id="storefront-decision" legend="Disposition" value={disposition} onChange={setDisposition} options={[
           ['PUBLISHED_FULL','Publish independently approved full storefront'],
           ['RETRACTED','Retract existing full storefront'],
         ]}/>
         <ReviewReasonField id="storefront-reason" label="Source, branch, legal and policy review rationale (80+ characters)"
          value={reason} onChange={setReason} min={80}
          audience="Recorded with this publication event in the private review record; buyers see only the approved snapshot."/>
        </ReviewDecisionPanel>
        <ReviewMessages notice={status} error={error}/>
       </div>}
       audit={<ReviewAuditTrail testId="storefront-audit-trail" entries={[]}
        empty="Earlier publication events are not returned to this workbench; the operating status above is the server's current record."/>}/>
     </>}
    </>}
    {pane==='media'&&<>
     {!currentMedia&&<ReviewNoCase title={noCaseTitle(mediaState,'No media item selected.','There is no photograph to review.')}
      body={mediaState==='ready'?"Each photograph is reviewed on its own with single-use review tickets.":undefined}/>}
     {currentMedia&&<>
      <ReviewCaseHeader testId="storefront-media-identity" eyebrow="Storefront media" title={categoryLabel(currentMedia)}
       status={currentMedia.review_status}
       facts={[
        {label:'Dealership',value:currentMedia.seed_dealer_id},
        {label:'Uploaded',value:dealerDateTime(currentMedia.created_at)},
        {label:'File',value:`${currentMedia.mime_type} · ${Math.max(1,Math.round(currentMedia.file_bytes/1024))} KB`},
        {label:'Review tickets expire',value:currentMedia.ticket_expires_at?dealerDateTime(currentMedia.ticket_expires_at):'Not issued'},
       ]}/>
      <ReviewAudienceSplit audience="public"
       facingNote={mediaPublic
        ?'Approved for the public storefront gallery; it is shown while the dealership and its storefront are current.'
        :'Not public. A submitted photograph is shown publicly only after an independent approval.'}
       facing={<ReviewFacts items={[{label:'Public gallery',value:mediaPublic?'Approved for display':'Not shown'}]}/>}
       internal={<ReviewFacts items={[
        {label:'Rights attestation',value:human(currentMedia.rights_attestation)},
        {label:'Logo rights approved',value:'No'},
        ...(currentMedia.conflict_of_interest?[{label:'Conflict of interest',value:'Yes — you cannot decide this item'}]:[]),
       ]}/>}/>
      <ReviewCaseBody
       evidence={<ReviewSection testId="dealer-media-review-section" title="Submitted photograph" provenance="dealer"
        provenanceLabel={mediaPublic?'Uploaded by the dealership · approved for display':'Uploaded by the dealership · not approved'}
        description="Verify descriptive accessibility alt text, caption accuracy, and absence of OEM or third-party brand logos.">
        {(currentMedia.media_category==='COMPANY_PROFILE_IMAGE'||currentMedia.media_category==='COMPANY_COVER_IMAGE')&&
         <p className="rounded-control bg-carup-bg-surface p-3 text-xs leading-5 text-carup-text-2" data-testid="dealer-media-review-company-image-note">
          Company {currentMedia.media_category==='COMPANY_PROFILE_IMAGE'?'profile':'cover'} image: approve only the dealer’s own
          photograph — never a manufacturer, franchise or third-party logo. It is shown on the public profile while the
          dealership and its storefront are current, and is not legal evidence.
         </p>}
        <dl className="grid gap-3 text-sm">
         <div data-testid="dealer-media-review-caption"><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">Caption</dt>
          <dd className="mt-0.5 break-words text-carup-text">{currentMedia.caption}</dd></div>
         <div data-testid="dealer-media-review-alt"><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">Alt text</dt>
          <dd className="mt-0.5 break-words text-carup-text">{currentMedia.alt_text}</dd></div>
        </dl>
        <div className="flex min-h-40 items-center justify-center rounded-card border border-dashed border-carup-line-strong bg-carup-bg-surface p-3 text-center" data-testid="storefront-media-viewer">
         {mediaPreview&&mediaPreview.media_id===currentMedia.media_id?<figure className="w-full">
          <img src={mediaPreview.signed_url} alt={mediaPreview.alt_text} className="mx-auto max-h-80 max-w-full rounded-control object-contain"/>
          <figcaption className="mt-2 text-xs text-carup-text-2">Private preview · SHA-256: {mediaPreview.sha256.slice(0,16)}… · Logo rights approved: false</figcaption>
         </figure>:<p className="max-w-sm text-sm text-carup-text-2">Enter your password under Step-up and choose “Preview private media binary” to see the photograph here.</p>}
        </div>
        {currentMedia.independent_reviewer_required&&currentMedia.ticket_issuance_deferred&&
         <div className="space-y-2 rounded-control bg-status-warning-soft p-3" data-testid="dealer-media-review-tickets-deferred">
          <p className="text-sm text-status-warning">New review tickets could not be issued for this item just now. Wait a few minutes, then refresh the review queue.</p>
          <button type="button" className={REVIEW_SECONDARY} disabled={busy} onClick={()=>{void refreshReviewQueue()}}>Refresh review queue</button>
         </div>}
        {showMediaRefusal&&mediaRefusal?.operation==='preview'&&unifiedRefusal}
       </ReviewSection>}
       decision={<div className="min-w-0 space-y-4" data-testid="storefront-media-decision">
        {stepUp(<button type="button" className={REVIEW_SECONDARY+' w-full'}
         disabled={busy||password.length<8||!currentMedia.independent_reviewer_required||!currentMedia.preview_ticket||previewSpent}
         onClick={()=>{void inspectMedia()}}>Preview private media binary</button>)}
        <ReviewDecisionPanel title="Media review decision"
         requirements={[
          {label:'Reviewer password entered (at least 8 characters)',met:password.length>=8},
          {label:'Rights & accessibility rationale written (at least 40 characters)',met:mediaReason.trim().length>=40},
          {label:'A current single-use decision ticket',met:Boolean(currentMedia.decision_ticket)&&!decisionSpent},
         ]}
         submit={<button type="button" className={REVIEW_PRIMARY}
          disabled={busy||password.length<8||mediaReason.trim().length<40||!currentMedia.independent_reviewer_required||!currentMedia.decision_ticket||decisionSpent}
          onClick={()=>{void recordMediaDecision()}}>Record storefront media decision</button>}>
         <ReviewChoice id="storefront-media-decision" legend="Decision" value={mediaDecision} onChange={setMediaDecision} options={[
           ['APPROVED_PUBLIC_DISPLAY','Approve for public storefront gallery'],
           ['REJECTED','Reject media item'],
           ['RETRACTED','Retract previously approved media item'],
         ]}/>
         <ReviewReasonField id="storefront-media-reason" label="Media rights & accessibility review rationale (40+ characters)"
          value={mediaReason} onChange={setMediaReason} min={40} minHeight="min-h-24"/>
        </ReviewDecisionPanel>
        {showMediaRefusal&&mediaRefusal?.operation==='decision'&&unifiedRefusal}
        <ReviewMessages notice={status} error={error}/>
       </div>}
       audit={<ReviewAuditTrail testId="storefront-media-audit-trail"
        entries={[{id:'uploaded',title:'Uploaded by the dealership',at:currentMedia.created_at,status:currentMedia.review_status}]}
        empty="Nothing recorded yet."
        note="The media queue returns the upload and the current review status only."/>}/>
     </>}
    </>}
   </ReviewWorkbenchGrid>}
  </div>
 }
 return <main className="min-h-screen bg-slate-50 px-4 py-10">
  <div className="mx-auto max-w-6xl">
   <Link to="/admin/dealer-claims" className="text-sm text-blue-700 underline">
     Independent claim review
   </Link>
   <h1 className="font-bold text-3xl mt-5">Full dealership publication</h1>
   <p className="max-w-4xl text-slate-600 mt-2">
    This is distinct from prelisting research and legal company activation.
    Reviewed branch data and versioned dealer-declared policies are copied into an
    immutable buyer-safe display snapshot. No unlicensed logo, VIN verification,
    OEM franchise, finance-provider approval or subscription is granted.
   </p>
   {!reviewer?<p className="mt-6" role="alert">
    Sign in as a verified independent CarUp reviewer. The API enforces this separately.
   </p>:<div className="grid lg:grid-cols-[290px_minmax(0,1fr)] gap-6 mt-8">
    <Card><CardContent className="p-5 space-y-3">
     <h2 className="font-semibold">Operational approval candidates</h2>
     <Button variant="outline" size="sm" onClick={()=>{void reload()}}>Refresh queue</Button>
     {queue.length===0&&<p className="text-sm text-slate-500">
      No legal dealer activation candidates. Research-only listings do not qualify.
     </p>}
     {queue.map(x=><button key={x.seed_dealer_id} type="button"
       onClick={()=>{setSeed(x.seed_dealer_id);setError('');setStatus('')}}
       className={'text-left w-full rounded-lg border p-3 '+
        (seed===x.seed_dealer_id?'bg-blue-50 border-blue-700':'bg-white')}>
       <strong className="text-sm block">{x.seed_dealer_id}</strong>
       <span className="text-xs text-slate-500">{x.operating_status}</span>
       {!x.independent_reviewer_required&&<span className="block text-xs text-red-700">
        Self-review not permitted</span>}
     </button>)}
    </CardContent></Card>
    <Card><CardContent className="p-5 space-y-5">
     <h2 className="font-semibold text-xl">Verify selected business</h2>
     {!item?<p>No business candidate selected.</p>:<>
      <p className="text-sm">Research identity: <strong>{seed}</strong>.
       This queue contains no original private evidence, banking or identity document.</p>
      <div className="space-y-2">
       <label htmlFor="storefront-password" className="block text-sm font-medium">
        Reviewer password (required before preview and independently before decision)
       </label>
       <ReviewerStepUpField id="storefront-password" value={password} onChange={setPassword} username={user?.email}/>
       <Button variant="outline" disabled={busy||password.length<8||
         !item.independent_reviewer_required} onClick={()=>{void inspect()}}>
        Inspect review candidate</Button>
      </div>
      {candidate&&<>
       <div className="border-t pt-4">
        <h3 className="font-semibold">Approve only verified branch display facts</h3>
        {candidate.branches.map(b=><label key={b.branch_id}
          className="flex gap-3 text-sm border rounded-lg p-3 my-2">
         <input type="checkbox" checked={approvedBranches.includes(b.branch_id)}
          onChange={e=>setApprovedBranches(prev=>e.target.checked?
            [...prev,b.branch_id]:prev.filter(v=>v!==b.branch_id))}/>
         <span><strong>{b.proposed_name}</strong>
          <span className="block text-slate-600">{b.proposed_address}</span>
          <span className="block text-xs text-slate-500">Dealer-declared; verify actual site before selecting</span>
         </span>
        </label>)}
       </div>
       <div className="border-t pt-4">
        <h3 className="font-semibold">Independently review dealer-declared sections</h3>
        {Object.entries(candidate.proposed_sections).map(([key,value])=>
         <label key={key} className="block border rounded-lg p-3 mt-2 text-sm">
          <span className="flex gap-2 items-center font-semibold">
           <input type="checkbox" checked={approvedSections.includes(key)}
            onChange={e=>setApprovedSections(prev=>e.target.checked?
              [...prev,key]:prev.filter(x=>x!==key))}/>
           {key.replaceAll('_',' ')} · version {value.version}
          </span>
          <dl className="mt-3 space-y-1">
           {Object.entries(value.proposed_values).map(([field,text])=>
            <div key={field} className="break-words">
             <dt className="font-medium text-slate-600">{field.replaceAll('_',' ')}</dt>
             <dd>{text}</dd>
            </div>)}
          </dl>
          <span className="text-xs text-slate-500">
           Explicit display approval is not a guarantee, legal opinion or payment authorization.
          </span>
         </label>)}
       </div>
      </>}
      <fieldset className="border-t pt-4 space-y-3">
       <legend className="font-semibold">Independent publication decision</legend>
       <label htmlFor="storefront-decision" className="block text-sm">Disposition</label>
       <select id="storefront-decision" value={disposition}
        onChange={e=>setDisposition(e.target.value as 'PUBLISHED_FULL'|'RETRACTED')}
        className="w-full rounded-lg border p-3">
        <option value="PUBLISHED_FULL">Publish independently approved full storefront</option>
        <option value="RETRACTED">Retract existing full storefront</option>
       </select>
       <label htmlFor="storefront-reason" className="block text-sm font-medium">
        Source, branch, legal and policy review rationale (80+ characters)
       </label>
       <textarea id="storefront-reason" value={reason} maxLength={3000}
        onChange={e=>setReason(e.target.value)}
        className="w-full rounded-lg border p-3 min-h-28"/>
       <p className="text-xs text-slate-600">
        Reenter the reviewer password above before recording. A full publication requires
        at least one independently checked, selected branch.
       </p>
       <Button className={DEALER_WRAP_BUTTON} disabled={busy||password.length<8||reason.trim().length<80||
        (disposition==='PUBLISHED_FULL'&&(!candidate||approvedBranches.length===0))}
         onClick={()=>{void record()}}>Record immutable publication decision</Button>
      </fieldset>
      <section className="border-t pt-5 space-y-3" data-testid="dealer-media-review-section">
       <h3 className="font-semibold">Independent storefront media gallery review</h3>
       <p className="text-xs text-slate-600">
        Review dealer-uploaded facility photographs individually using scope-bound reviewer tickets.
        Verify descriptive accessibility alt text, caption accuracy, and absence of OEM or third-party brand logos.
       </p>
       {mediaQueue.length===0&&<p className="text-sm text-slate-500">
        No dealership facility media items in queue.
       </p>}
       {mediaQueue.length>0&&<>
        <label htmlFor="storefront-media-select" className="block text-sm font-medium">
         Select dealership media item
        </label>
        <select id="storefront-media-select" className="w-full rounded-lg border p-3 text-sm bg-white"
         value={selectedMediaKey}
         onChange={e=>{setSelectedMediaKey(e.target.value);setMediaPreview(null)}}>
         {mediaQueue.map(m=><option key={m.media_id} value={m.media_id}>
          {m.seed_dealer_id} · {MEDIA_CATEGORY_LABELS[m.media_category]||m.media_category} · {m.caption} ({m.review_status})
         </option>)}
        </select>
        {currentMedia&&<div className="rounded-lg border bg-slate-50 p-3 text-sm space-y-2">
         <p><strong>Seed:</strong> {currentMedia.seed_dealer_id} · <strong>Category:</strong> {MEDIA_CATEGORY_LABELS[currentMedia.media_category]||currentMedia.media_category} · <strong>Status:</strong> {currentMedia.review_status}</p>
         {/* UAT-R1: company profile/cover images are reviewed like facility photos — dealer-owned, no OEM logo, never legal evidence. */}
         {(currentMedia.media_category==='COMPANY_PROFILE_IMAGE'||currentMedia.media_category==='COMPANY_COVER_IMAGE')&&
          <p className="text-xs text-slate-700" data-testid="dealer-media-review-company-image-note">
           Company {currentMedia.media_category==='COMPANY_PROFILE_IMAGE'?'profile':'cover'} image: approve only the dealer’s own
           photograph — never a manufacturer, franchise or third-party logo. It is shown on the public profile while the
           dealership and its storefront are current, and is not legal evidence.
          </p>}
         <p data-testid="dealer-media-review-caption"><strong>Caption:</strong> {currentMedia.caption}</p>
         <p data-testid="dealer-media-review-alt"><strong>Alt text:</strong> {currentMedia.alt_text}</p>
         {currentMedia.independent_reviewer_required&&currentMedia.ticket_issuance_deferred&&
          <div className="space-y-2" data-testid="dealer-media-review-tickets-deferred">
           <p className="text-amber-800">
            New review tickets could not be issued for this item just now. Wait a few minutes, then refresh the review queue.
           </p>
           <Button type="button" variant="outline" size="sm" disabled={busy}
            onClick={()=>{void refreshReviewQueue()}}>Refresh review queue</Button>
          </div>}
         <Button variant="outline" size="sm"
          disabled={busy||password.length<8||!currentMedia.independent_reviewer_required||!currentMedia.preview_ticket||previewSpent}
          onClick={()=>{void inspectMedia()}}>
          Preview private media binary
         </Button>
         {showMediaRefusal&&mediaRefusal?.operation==='preview'&&refusalPanel}
         {mediaPreview&&mediaPreview.media_id===currentMedia.media_id&&<figure className="mt-2 border rounded-lg bg-white p-3">
          <img src={mediaPreview.signed_url} alt={mediaPreview.alt_text}
           className="max-h-48 rounded-md object-contain"/>
          <figcaption className="text-xs text-slate-600 mt-1">
           SHA-256: {mediaPreview.sha256.slice(0,16)}… · Logo rights approved: false
          </figcaption>
         </figure>}
         <label htmlFor="storefront-media-decision" className="block text-sm font-medium">
          Media review decision
         </label>
         <select id="storefront-media-decision" className="w-full rounded-lg border p-2 bg-white"
          value={mediaDecision}
          onChange={e=>setMediaDecision(e.target.value as MediaDecision)}>
          <option value="APPROVED_PUBLIC_DISPLAY">Approve for public storefront gallery</option>
          <option value="REJECTED">Reject media item</option>
          <option value="RETRACTED">Retract previously approved media item</option>
         </select>
         <label htmlFor="storefront-media-reason" className="block text-sm font-medium">
          Media rights &amp; accessibility review rationale (40+ characters)
         </label>
         <textarea id="storefront-media-reason" value={mediaReason} maxLength={3000}
          onChange={e=>setMediaReason(e.target.value)}
          className="w-full rounded-lg border p-3 min-h-24 bg-white"/>
         <Button className={DEALER_WRAP_BUTTON} variant="outline"
          disabled={busy||password.length<8||mediaReason.trim().length<40||!currentMedia.independent_reviewer_required||!currentMedia.decision_ticket||decisionSpent}
          onClick={()=>{void recordMediaDecision()}}>
          Record storefront media decision
         </Button>
         {showMediaRefusal&&mediaRefusal?.operation==='decision'&&refusalPanel}
        </div>}
       </>}
      </section>
     </>}
    </CardContent></Card>
   </div>}
   {status&&<p role="status" className="bg-blue-50 p-4 rounded-lg mt-5">{status}</p>}
   {error&&<p role="alert" className="bg-red-50 text-red-800 p-4 rounded-lg mt-5">{error}</p>}
  </div>
 </main>
}
