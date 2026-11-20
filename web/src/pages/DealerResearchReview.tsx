import {useCallback,useEffect,useState} from 'react'
import { DEALER_WRAP_BUTTON } from '@/components/dealer/dealerButtonWrap'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
import ReviewerStepUpField from '@/components/dealer/ReviewerStepUpField'
import { dealerDateTime } from '@/lib/dealerDates'
import { useInReviewWorkbench } from '@/components/dealer/reviewWorkbenchContext'
import {
  REVIEW_FIELD, REVIEW_LABEL, REVIEW_PRIMARY, REVIEW_SECONDARY, ReviewAccessNotice, ReviewAudienceSplit, ReviewAuditTrail, ReviewCaseBody, ReviewCaseHeader, ReviewChoice, ReviewDecisionPanel, ReviewFacts, ReviewMessages, ReviewMoreAction, ReviewNoCase, ReviewQueueItem, ReviewQueuePanel, ReviewQueueTabs, ReviewReasonField, ReviewSection, ReviewStatusChip, ReviewStepUp, ReviewWorkbenchGrid, ReviewWorkbenchHeader, type ReviewQueueState,
} from '@/components/dealer/review/ReviewCaseFile'
import { noCaseTitle } from '@/components/dealer/review/reviewTone'

type Candidate={
  seed_dealer_id:string;source_row:number;source_display_name:string;source_city:string
  source_category_unverified:string;grouping_status:string;source_row_sha256:string
  publication_state:string;review_revision:number;legal_business_verified:false
}
type Queue={entries:Candidate[];page:number;limit:number;total:number|null;
  real_review_required:boolean;bulk_publication_available:boolean}
type Decision='PRELISTED_UNCLAIMED'|'WITHHELD'|'SUPPRESSED'|'DUPLICATE'|'UNDER_DISPUTE'
type CorrectionRequest={
  request_id:string;seed_dealer_id:string;request_type:string;
  request_summary:string;contact_email:string|null;status:string;
  created_at:string;reviewed_at?:string|null;
}
type CorrectionDecision='RESOLVED_SUPPRESSED'|'RESOLVED_WITHHELD'|'RESOLVED_UNDER_DISPUTE'|'REJECTED_NO_CHANGE'
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
const heads=(id:string,token:string):AuthHeaders=>({
  'x-session-token':token,'x-user-id':id
})
export default function DealerResearchReview(){
  const {user,token}=useAuth()
  const allowed=Boolean(user&&token&&
    ['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
  const [queue,setQueue]=useState<Queue|null>(null)
  const [corrections,setCorrections]=useState<CorrectionRequest[]>([])
  const [selectedCorrectionId,setSelectedCorrectionId]=useState('')
  const [correctionDecision,setCorrectionDecision]=useState<CorrectionDecision>('RESOLVED_SUPPRESSED')
  const [correctionReason,setCorrectionReason]=useState('')
  const [canonicalTargetSeed,setCanonicalTargetSeed]=useState('')
  const [duplicateReason,setDuplicateReason]=useState('')
  const [page,setPage]=useState(1)
  const [selected,setSelected]=useState('')
  const [decision,setDecision]=useState<Decision>('WITHHELD')
  const [reason,setReason]=useState('')
  const [password,setPassword]=useState('')
  const [relatedSeed,setRelatedSeed]=useState('')
  const [groupState,setGroupState]=useState('UNRESOLVED_GROUPING')
  const [groupReason,setGroupReason]=useState('')
  const [contactReason,setContactReason]=useState('')
  const [contactAddress,setContactAddress]=useState(false)
  const [contactPhone,setContactPhone]=useState(false)
  const [contactWebsite,setContactWebsite]=useState(false)
  const [contactRetract,setContactRetract]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const reload=useCallback(async()=>{
    if(!user||!token||!allowed)return
    try{
      const [result,corrResult]=await Promise.all([
        apiRequest<Queue>({
          baseUrl:API,
          path:'/admin/dealership/research/queue?page='+page+'&limit=20',
          authHeaders:heads(user.id,token),
        }),
        apiRequest<{requests:CorrectionRequest[]}>({
          baseUrl:API,
          path:'/admin/dealership/research/corrections',
          authHeaders:heads(user.id,token),
        }),
      ])
      setQueue(result)
      setCorrections(corrResult.requests||[])
      setSelected(prior=>result.entries.some(e=>e.seed_dealer_id===prior)?
        prior:result.entries[0]?.seed_dealer_id||'')
      const pending=(corrResult.requests||[]).filter(r=>r.status==='PENDING_HUMAN_REVIEW')
      setSelectedCorrectionId(prior=>pending.some(r=>r.request_id===prior)?
        prior:pending[0]?.request_id||'')
      setError('')
    }catch(problem){
      setQueue(null)
      setError(problem instanceof Error?problem.message:'Source review queue unavailable')
    }
  },[allowed,user,token,page])
  useEffect(()=>{
    // Defer request-driven state to the async phase, avoiding a redundant
    // synchronous render caused by setting loading state in an effect.
    let mounted=true
    void Promise.resolve().then(()=>{if(mounted)void reload()})
    return()=>{mounted=false}
  },[reload])
  const current=queue?.entries.find(e=>e.seed_dealer_id===selected)
  const currentCorrection=corrections.find(r=>r.request_id===selectedCorrectionId)
  const minimum=decision==='PRELISTED_UNCLAIMED'?80:25
  async function record(){
    if(!user||!token||!current||busy||reason.trim().length<minimum||
      password.length<8)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{review:{decision:string;revision:number;public:boolean}}>({
        baseUrl:API,path:'/admin/dealership/research/'
          +encodeURIComponent(current.seed_dealer_id)+'/review',
        options:{method:'POST',body:JSON.stringify({
          decision,reason:reason.trim(),reviewer_password:password,
        })},
        authHeaders:heads(user.id,token),
      })
      setNotice('Independent research decision: '+result.review.decision
        +' · revision '+result.review.revision+'. This does NOT verify a dealer, grant ownership or approve stock.')
      setReason('')
      await reload()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Research decision refused')
    }finally{
      setPassword('');setBusy(false)
    }
  }

  async function recordGrouping(){
    if(!user||!token||!current||busy||password.length<8||
      groupReason.trim().length<60)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{review:{grouping_status:string;
        legal_parent_verified:false}}>({
        baseUrl:API,path:'/admin/dealership/research/'+
          encodeURIComponent(current.seed_dealer_id)+'/grouping-review',
        options:{method:'POST',body:JSON.stringify({
          related_seed_dealer_id:relatedSeed.trim()||null,
          review_state:groupState,reason:groupReason.trim(),reviewer_password:password,
        })},authHeaders:heads(user.id,token),
      })
      setNotice('Research grouping review recorded: '+result.review.grouping_status+
        '. This did not verify a legal parent, merge organizations or assign membership.')
      setGroupReason('');await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Grouping review refused')}
    finally{setPassword('');setBusy(false)}
  }
  async function recordDuplicateRedirect(){
    if(!user||!token||!current||busy||password.length<8||
      duplicateReason.trim().length<60||!/^ZW-DEAL-\d{4}$/.test(canonicalTargetSeed.trim()))return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{redirect:{duplicate_seed_dealer_id:string;
        canonical_seed_dealer_id:string;canonical_path:string}}>({
        baseUrl:API,path:'/admin/dealership/research/'+
          encodeURIComponent(current.seed_dealer_id)+'/duplicate-redirect',
        options:{method:'POST',body:JSON.stringify({
          canonical_seed_dealer_id:canonicalTargetSeed.trim().toUpperCase(),
          reason:duplicateReason.trim(),
          reviewer_password:password,
        })},authHeaders:heads(user.id,token),
      })
      setNotice('Reconciled duplicate research seed '+result.redirect.duplicate_seed_dealer_id+
        ' -> canonical '+result.redirect.canonical_seed_dealer_id+
        ' ('+result.redirect.canonical_path+'). Source and claim custody preserved.')
      setDuplicateReason('');setCanonicalTargetSeed('');await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Duplicate reconciliation refused')}
    finally{setPassword('');setBusy(false)}
  }
  async function recordCorrectionDisposition(){
    if(!user||!token||!currentCorrection||busy||password.length<8||
      correctionReason.trim().length<60)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{review:{decision:string;seed_dealer_id:string;
        resulting_publication_status:string;public_profile_withdrawn:boolean}}>({
        baseUrl:API,path:'/admin/dealership/research/corrections/'+
          encodeURIComponent(currentCorrection.request_id)+'/review',
        options:{method:'POST',body:JSON.stringify({
          decision:correctionDecision,
          reason:correctionReason.trim(),
          reviewer_password:password,
        })},authHeaders:heads(user.id,token),
      })
      setNotice('Correction/takedown request resolved for '+result.review.seed_dealer_id+
        ': '+result.review.decision+' (resulting public status: '+
        result.review.resulting_publication_status+').')
      setCorrectionReason('');await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Correction review refused')}
    finally{setPassword('');setBusy(false)}
  }
  async function recordContacts(){
    if(!user||!token||!current||busy||password.length<8||
      contactReason.trim().length<80)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{review:{public_contact_state:string;
        business_verified:false}}>({
        baseUrl:API,path:'/admin/dealership/research/'+
          encodeURIComponent(current.seed_dealer_id)+'/contact-review',
        options:{method:'POST',body:JSON.stringify({
          display_address:contactRetract?false:contactAddress,
          display_phone:contactRetract?false:contactPhone,
          display_website:contactRetract?false:contactWebsite,
          retract:contactRetract,reason:contactReason.trim(),reviewer_password:password,
        })},authHeaders:heads(user.id,token),
      })
      setNotice('Reviewed source-contact display: '+result.review.public_contact_state+
        '. No private source email, principal, legal verification or franchise endorsement published.')
      setContactReason('');await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Public contact decision refused')}
    finally{setPassword('');setBusy(false)}
  }
  // RX05-D — unified ReviewWorkbench composition (presentation only; same state, handlers and rules).
  const inWorkbench=useInReviewWorkbench()
  const [pane,setPane]=useState<'source'|'correction'>('source')
  if(inWorkbench){
    const readState:ReviewQueueState=queue?(queue.entries.length?'ready':'empty'):error?'unavailable':'loading'
    const correctionState:ReviewQueueState=queue?(corrections.length?'ready':'empty'):readState
    const pendingCorrections=corrections.filter(r=>r.status==='PENDING_HUMAN_REVIEW').length
    const isPublic=current?.publication_state==='PRELISTED_UNCLAIMED'
    const stepUp=<ReviewStepUp note="Every action on this record re-checks this password on the server. It is cleared after each attempt.">
      <div>
        <label htmlFor="source-reviewer-password" className={REVIEW_LABEL}>Reenter your own reviewer password</label>
        <ReviewerStepUpField id="source-reviewer-password" value={password} onChange={setPassword} username={user?.email}
          className="mt-1" inputClassName="bg-carup-bg-raised"/>
      </div>
    </ReviewStepUp>
    return <div className="min-w-0 pb-8" data-testid="research-review-workbench">
      <ReviewWorkbenchHeader eyebrow="Source review workbench" title="Dealer research eligibility review"
        summaryLabel="What a source decision does — and does not do">
        <p>Review source-backed business research individually before allowing an
          unclaimed directory entry. Source franchise labels, addresses and names
          are unverified until checked. This is not legal company approval.</p>
        <p>No bulk approval. An unclaimed public research page is not a
          verified licence, authorized franchise, seller account or tenant.</p>
      </ReviewWorkbenchHeader>
      {!allowed?<ReviewAccessNotice>Authenticated platform reviewer or administrator required.</ReviewAccessNotice>:
      <ReviewWorkbenchGrid testId="research-review-grid" caseLabel={pane==='source'?'Selected source record':'Selected correction request'}
        queue={<ReviewQueuePanel testId="research-queue" listLabel={pane==='source'?'Private source records':'Correction and takedown requests'}
          title="Queue" onRefresh={()=>{void reload()}}
          state={pane==='source'?readState:correctionState} loadingText="Loading private source records…"
          unavailableTestId="research-queue-unavailable" unavailableMessage={<>The source review queue could not be loaded{error?<> ({error})</>:null}.</>}
          toolbar={<ReviewQueueTabs label="Source review queues" active={pane} onChange={setPane} tabs={[
            {id:'source',label:'Source records',count:queue?.total??null},
            {id:'correction',label:'Corrections',count:queue?pendingCorrections:null},
          ]}/>}
          intro={pane==='source'
            ?<>{queue?.total??'Unknown'} imported research candidate(s) in the private queue. This count is not published or verified companies.</>
            :<>Public correction and removal submissions never auto-suppress a profile. {pendingCorrections} waiting for a disposition.</>}
          emptyTitle={pane==='source'?'No private research records available':'No correction or takedown requests recorded'}
          emptyBody={pane==='source'?'No synthetic dealers are generated.':'A request appears here when a member of the public or a business files one.'}
          footer={pane==='source'&&queue?<div className="flex items-center justify-between gap-2 border-t border-carup-line px-3 py-2">
            <button type="button" className={REVIEW_SECONDARY} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button>
            <span className="text-xs text-carup-text-2">Page {page}</span>
            <button type="button" className={REVIEW_SECONDARY} disabled={!queue||queue.entries.length<queue.limit} onClick={()=>setPage(p=>p+1)}>Next</button>
          </div>:undefined}>
          {pane==='source'
            ?queue?.entries.map(entry=><ReviewQueueItem key={entry.seed_dealer_id} testId={`research-queue-item-${entry.seed_dealer_id}`}
              selected={selected===entry.seed_dealer_id} title={entry.source_display_name} status={entry.publication_state}
              meta={[`${entry.seed_dealer_id} · ${entry.source_city}`]}
              onSelect={()=>{setSelected(entry.seed_dealer_id);setError('');setNotice('')}}/>)
            :corrections.map(req=><ReviewQueueItem key={req.request_id} testId={`research-correction-item-${req.request_id}`}
              selected={selectedCorrectionId===req.request_id} title={`${req.seed_dealer_id} · ${req.request_type.replaceAll('_',' ').toLowerCase()}`}
              status={req.status} since={req.created_at} sinceLabel="Received"
              onSelect={()=>{setSelectedCorrectionId(req.request_id);setError('');setNotice('')}}/>)}
        </ReviewQueuePanel>}>
        {pane==='source'&&<>
          {!current&&<ReviewNoCase title={noCaseTitle(readState,'Select a private research record.','There is no source record to review.')}
            body={readState==='ready'?"Each record is reviewed on its own: source legitimacy, operating status, grouping, privacy, duplicates and takedown disputes.":undefined}/>}
          {current&&<>
            <ReviewCaseHeader testId="research-case-identity" eyebrow="Private source record" title={current.source_display_name}
              status={current.publication_state}
              facts={[
                {label:'Research ID',value:current.seed_dealer_id,mono:true},
                {label:'Original row',value:String(current.source_row)},
                {label:'Review revision',value:String(current.review_revision)},
              ]}/>
            <ReviewAudienceSplit audience="public"
              facingNote={isPublic
                ?'Visitors see this business in the directory as “Listed from public sources · not claimed” — never as a verified or approved CarUp dealer.'
                :'Not in the public directory: only a record with the decision “Publish unclaimed research” is listed, and then only as not claimed and not verified.'}
              facing={<ReviewFacts items={[
                {label:'Directory listing',value:isPublic?'Listed from public sources · not claimed':'Not listed'},
                {label:'Legal business verified',value:'No'},
              ]}/>}
              internal={<ReviewFacts items={[
                {label:'Grouping review',value:current.grouping_status.replaceAll('_',' ').toLowerCase()},
                {label:'Source row fingerprint',value:current.source_row_sha256?current.source_row_sha256.slice(0,16)+'…':'Not recorded',mono:true},
              ]}/>}/>
            <ReviewCaseBody
              evidence={<ReviewSection testId="research-evidence" title="Researched source facts" provenance="source"
                description="Independently inspect source legitimacy, operating status, group/branch relationship, publicly eligible company name/city, privacy, duplicates, source attribution and takedown disputes before publishing.">
                <ReviewFacts items={[
                  {label:'Researched name',value:current.source_display_name},
                  {label:'Researched city',value:current.source_city},
                  {label:'Unverified category',value:current.source_category_unverified},
                  {label:'Current status',value:<ReviewStatusChip status={current.publication_state}/>},
                ]}/>
              </ReviewSection>}
              decision={<div className="min-w-0 space-y-4" data-testid="research-decision">
                {stepUp}
                <ReviewDecisionPanel title="Source eligibility decision"
                  requirements={[
                    {label:'Reviewer password entered (at least 8 characters)',met:password.length>=8},
                    {label:`Source checks and rationale written (at least ${minimum} characters)`,met:reason.trim().length>=minimum},
                  ]}
                  footnote="No bulk approval. An unclaimed public research page is not a verified licence, authorized franchise, seller account or tenant."
                  submit={<button type="button" className={REVIEW_PRIMARY} disabled={busy||reason.trim().length<minimum||password.length<8}
                    onClick={()=>{void record()}}>Record independent eligibility decision</button>}>
                  <ReviewChoice id="source-decision" legend="Case-by-case disposition" value={decision} onChange={setDecision} options={[
                    ['WITHHELD','Withhold pending verification'],
                    ['PRELISTED_UNCLAIMED','Publish unclaimed research (NOT verified)'],
                    ['SUPPRESSED','Suppress (privacy / takedown)'],
                    ['DUPLICATE','Mark duplicate for grouping review'],
                    ['UNDER_DISPUTE','Place under identity dispute'],
                  ]}/>
                  <ReviewReasonField id="source-reason" label={`Document source checks and rationale (minimum ${minimum} characters)`}
                    value={reason} onChange={setReason} min={minimum}
                    audience="Recorded with this decision in the private review record. It is not published with the directory listing."/>
                </ReviewDecisionPanel>
                <ReviewMoreAction testId="research-grouping-action" title="Independent source grouping review"
                  summary="Reported parent names, domain matches and shared addresses are leads, not proof of shared legal ownership.">
                  <p className="text-xs leading-5 text-carup-text-2">No company or branch is merged by this action.</p>
                  <div><label className={REVIEW_LABEL} htmlFor="group-candidate">Other research seed ID (if applicable)</label>
                    <input id="group-candidate" className={REVIEW_FIELD} value={relatedSeed} maxLength={12}
                      placeholder="ZW-DEAL-0002" onChange={e=>setRelatedSeed(e.target.value.toUpperCase())}/></div>
                  <div><label className={REVIEW_LABEL} htmlFor="group-state">Documented grouping observation</label>
                    <select id="group-state" className={REVIEW_FIELD} value={groupState} onChange={e=>setGroupState(e.target.value)}>
                      <option value="UNRESOLVED_GROUPING">Unresolved — review later</option>
                      <option value="POTENTIAL_SAME_PARENT">Possible shared parent (not legally verified)</option>
                      <option value="POTENTIAL_DUPLICATE">Possible duplicate — review before publication</option>
                      <option value="CONFIRMED_DISTINCT_RESEARCH">Distinct research records after comparison</option>
                      <option value="REVIEWED_BRANCH_RELATIONSHIP">Researched branch relationship (not corporate proof)</option>
                    </select></div>
                  <ReviewReasonField id="group-reason" label="Detailed independently reviewed source evidence (60+ characters)"
                    value={groupReason} onChange={setGroupReason} min={60} minHeight="min-h-28"/>
                  <button type="button" className={REVIEW_SECONDARY+' w-full'} disabled={busy||password.length<8||groupReason.trim().length<60}
                    onClick={()=>{void recordGrouping()}}>Record nonlegal grouping observation</button>
                </ReviewMoreAction>
                <ReviewMoreAction testId="dealer-duplicate-reconcile-panel" title="Reconcile duplicate research seed & canonical redirect"
                  summary="Seeds with any existing claim or approved legal custody cannot be redirected.">
                  <p className="text-xs leading-5 text-carup-text-2">Redirects an unclaimed duplicate research record ({current.seed_dealer_id}) to a published
                    canonical research seed while preserving original source, claim and legal custody.</p>
                  <div><label className={REVIEW_LABEL} htmlFor="duplicate-canonical-seed">Published canonical target seed ID</label>
                    <input id="duplicate-canonical-seed" className={REVIEW_FIELD} value={canonicalTargetSeed} maxLength={12}
                      placeholder="ZW-DEAL-0001" onChange={e=>setCanonicalTargetSeed(e.target.value.toUpperCase())}/></div>
                  <ReviewReasonField id="duplicate-reconcile-reason" label="Duplicate reconciliation rationale (60+ characters)"
                    value={duplicateReason} onChange={setDuplicateReason} min={60} minHeight="min-h-24"/>
                  <button type="button" className={REVIEW_SECONDARY+' w-full'} disabled={busy||password.length<8||
                    duplicateReason.trim().length<60||!/^ZW-DEAL-\d{4}$/.test(canonicalTargetSeed.trim())}
                    onClick={()=>{void recordDuplicateRedirect()}}>Reconcile duplicate &amp; activate canonical redirect</button>
                </ReviewMoreAction>
                <ReviewMoreAction testId="research-contact-action" title="Field-level public contact eligibility"
                  summary={isPublic?'Only literal source business address, phone or website — never a principal or private email.':'Available only once this record is published as unclaimed research.'}>
                  <p className="text-xs leading-5 text-carup-text-2">The service copies selected business
                    address/phone/website literally from the source, never a principal,
                    a private email, or arbitrary submitted text. No logo rights implied.</p>
                  {([
                    ['Allow reviewed business physical address',contactAddress,setContactAddress],
                    ['Allow reviewed business phone from source',contactPhone,setContactPhone],
                    ['Allow reviewed HTTPS source website',contactWebsite,setContactWebsite],
                    ['Retract all reviewed contact information',contactRetract,setContactRetract],
                  ] as [string,boolean,(v:boolean)=>void][]).map(([label,value,setter])=><label key={label}
                    className="flex min-h-11 items-start gap-2 text-sm text-carup-text">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={value} onChange={e=>setter(e.target.checked)}/>
                    <span className="min-w-0">{label}</span>
                  </label>)}
                  <ReviewReasonField id="contact-reason" label="Explain lawful public business-contact display and evidence checked (80+ characters)"
                    value={contactReason} onChange={setContactReason} min={80} minHeight="min-h-28"/>
                  <button type="button" className={REVIEW_SECONDARY+' w-full'} disabled={busy||password.length<8||
                    contactReason.trim().length<80||current.publication_state!=='PRELISTED_UNCLAIMED'}
                    onClick={()=>{void recordContacts()}}>Record restricted source-contact decision</button>
                </ReviewMoreAction>
                <ReviewMessages notice={notice} error={error}/>
              </div>}
              audit={<ReviewAuditTrail testId="research-audit-trail"
                entries={[{id:'revision',title:`Review revision ${current.review_revision}`,status:current.publication_state,
                  detail:`Grouping review: ${current.grouping_status.replaceAll('_',' ').toLowerCase()}`}]}
                empty="No review has been recorded for this record."
                note="The research queue returns the current revision and state only; earlier decisions are kept in the server's append-only record, not listed here."/>}/>
          </>}
        </>}
        {pane==='correction'&&<>
          {!currentCorrection&&<ReviewNoCase title={noCaseTitle(correctionState,'Select a correction or takedown request.','There is no correction request to review.')}
            body={correctionState==='ready'?"A request never changes a profile by itself; an independent reviewer records the disposition.":undefined}/>}
          {currentCorrection&&<>
            <ReviewCaseHeader testId="research-correction-identity" eyebrow="Correction / takedown request"
              title={currentCorrection.seed_dealer_id} status={currentCorrection.status}
              facts={[
                {label:'Request type',value:currentCorrection.request_type.replaceAll('_',' ').toLowerCase()},
                {label:'Received',value:dealerDateTime(currentCorrection.created_at)},
                {label:'Request ID',value:currentCorrection.request_id,mono:true},
              ]}/>
            <ReviewAudienceSplit audience="public"
              facingNote="A request never suppresses or changes the public listing by itself. The listing changes only if you record a disposition that withdraws it."
              internalNote="The requester's contact details are private and are not shown in this workbench."/>
            <ReviewCaseBody
              evidence={<ReviewSection testId="dealer-correction-review-panel" title="What the requester says" provenance="public">
                <p className="whitespace-pre-wrap break-words rounded-control bg-carup-bg-surface p-3 text-sm leading-6 text-carup-text">{currentCorrection.request_summary}</p>
              </ReviewSection>}
              decision={<div className="min-w-0 space-y-4" data-testid="research-correction-decision">
                {currentCorrection.status==='PENDING_HUMAN_REVIEW'?<>
                  {stepUp}
                  <ReviewDecisionPanel title="Independent correction disposition"
                    requirements={[
                      {label:'Reviewer password entered (at least 8 characters)',met:password.length>=8},
                      {label:'Correction review rationale written (at least 60 characters)',met:correctionReason.trim().length>=60},
                    ]}
                    submit={<button type="button" className={REVIEW_PRIMARY} disabled={busy||password.length<8||correctionReason.trim().length<60}
                      onClick={()=>{void recordCorrectionDisposition()}}>Record correction/takedown disposition</button>}>
                    <ReviewChoice id="correction-disposition" legend="Disposition" value={correctionDecision} onChange={setCorrectionDecision} options={[
                      ['RESOLVED_SUPPRESSED','Suppress public profile (takedown / privacy)'],
                      ['RESOLVED_WITHHELD','Withhold public profile pending source correction'],
                      ['RESOLVED_UNDER_DISPUTE','Place under identity dispute (withdraw public display)'],
                      ['REJECTED_NO_CHANGE','Reject unsubstantiated request (keep current state)'],
                    ]}/>
                    <ReviewReasonField id="correction-review-reason" label="Correction review rationale (60+ characters)"
                      value={correctionReason} onChange={setCorrectionReason} min={60} minHeight="min-h-24"/>
                  </ReviewDecisionPanel>
                </>:<ReviewNoCase title="A disposition is already recorded for this request."
                  body={currentCorrection.reviewed_at?`Reviewed ${dealerDateTime(currentCorrection.reviewed_at)}.`:undefined}/>}
                <ReviewMessages notice={notice} error={error}/>
              </div>}
              audit={<ReviewAuditTrail testId="research-correction-audit"
                entries={[
                  {id:'received',title:'Request received',at:currentCorrection.created_at},
                  ...(currentCorrection.reviewed_at?[{id:'reviewed',title:'Disposition recorded',at:currentCorrection.reviewed_at,status:currentCorrection.status}]:[]),
                ]}
                empty="Nothing recorded yet."/>}/>
          </>}
        </>}
      </ReviewWorkbenchGrid>}
    </div>
  }
  return <main className="min-h-screen bg-gray-50 section-padding">
    <div className="max-w-6xl mx-auto py-10">
      <Link to="/admin" className="text-sm text-blue-700 underline">Admin dashboard</Link>
      <h1 className="text-3xl font-bold mt-5">Dealer research eligibility review</h1>
      <p className="max-w-4xl text-gray-600 mt-2">
        Review source-backed business research individually before allowing an
        unclaimed directory entry. Source franchise labels, addresses and names
        are unverified until checked. This is not legal company approval.
      </p>
      {!allowed?<p role="alert" className="mt-6">
        Authenticated platform reviewer or administrator required.
      </p>:<div className="grid lg:grid-cols-[minmax(250px,1fr)_minmax(0,2fr)] gap-5 mt-8">
        <Card><CardContent className="p-5">
          <h2 className="text-lg font-semibold">Private source records</h2>
          <p className="text-xs text-gray-600 mt-1">
            {queue?.total??'Unknown'} imported research candidate(s) in the private queue.
            This count is not published or verified companies.
          </p>
          <Button variant="outline" size="sm" className="mt-3"
            onClick={()=>{void reload()}}>Refresh</Button>
          {queue?.entries.map(entry=><button key={entry.seed_dealer_id} type="button"
            data-testid={`research-queue-item-${entry.seed_dealer_id}`}
            onClick={()=>{setSelected(entry.seed_dealer_id);setError('');setNotice('')}}
            className={'text-left block w-full border rounded-lg p-3 mt-3 '+
              (selected===entry.seed_dealer_id?'border-blue-600 bg-blue-50':'border-gray-200')}>
            <strong className="block text-sm">{entry.source_display_name}</strong>
            <span className="text-xs text-gray-600 block">
              {entry.seed_dealer_id} · {entry.source_city}
            </span>
            <span className="text-xs text-amber-800 block mt-1">
              {entry.publication_state.replaceAll('_',' ')}
            </span>
          </button>)}
          {queue&&queue.entries.length===0&&<p className="text-sm mt-4 text-gray-600">
            No private research records available. No synthetic dealers are generated.
          </p>}
          <div className="flex gap-2 items-center mt-4">
            <Button size="sm" variant="outline" disabled={page<=1}
              onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</Button>
            <span className="text-xs">Page {page}</span>
            <Button size="sm" variant="outline" disabled={!queue||queue.entries.length<queue.limit}
              onClick={()=>setPage(p=>p+1)}>Next</Button>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-5 space-y-4">
          <h2 className="font-semibold text-lg">Source eligibility decision</h2>
          {!current?<p className="text-gray-600">Select a private research record.</p>:<>
            <dl className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                ['Research ID',current.seed_dealer_id],
                ['Original row',String(current.source_row)],
                ['Researched name',current.source_display_name],
                ['Researched city',current.source_city],
                ['Unverified category',current.source_category_unverified],
                ['Grouping review',current.grouping_status],
                ['Current status',current.publication_state],
                ['Review revision',String(current.review_revision)],
              ].map(([label,value])=><div key={label}>
                <dt className="text-gray-500">{label}</dt>
                <dd className="break-words font-medium">{value}</dd>
              </div>)}
            </dl>
            <p className="text-xs text-gray-600">
              Independently inspect source legitimacy, operating status, group/branch
              relationship, publicly eligible company name/city, privacy, duplicates,
              source attribution and takedown disputes before publishing.
            </p>
            <label htmlFor="source-decision" className="block text-sm font-semibold">
              Case-by-case disposition
            </label>
            <select id="source-decision" value={decision}
              onChange={e=>setDecision(e.target.value as Decision)}
              className="border rounded-lg w-full p-2">
              <option value="WITHHELD">Withhold pending verification</option>
              <option value="PRELISTED_UNCLAIMED">Publish unclaimed research (NOT verified)</option>
              <option value="SUPPRESSED">Suppress (privacy / takedown)</option>
              <option value="DUPLICATE">Mark duplicate for grouping review</option>
              <option value="UNDER_DISPUTE">Place under identity dispute</option>
            </select>
            <label htmlFor="source-reason" className="block text-sm font-semibold">
              Document source checks and rationale (minimum {minimum} characters)
            </label>
            <textarea id="source-reason" value={reason} onChange={e=>setReason(e.target.value)}
              minLength={minimum} maxLength={3000}
              className="border rounded-lg w-full p-3 min-h-32"/>
            <label htmlFor="source-reviewer-password" className="block text-sm font-semibold">
              Reenter your own reviewer password
            </label>
            <ReviewerStepUpField id="source-reviewer-password" value={password} onChange={setPassword} username={user?.email}/>
            <Button className={DEALER_WRAP_BUTTON} disabled={busy||reason.trim().length<minimum||password.length<8}
              onClick={()=>{void record()}}>Record independent eligibility decision</Button>
            <p className="text-xs text-amber-800">
              No bulk approval. An unclaimed public research page is not a
              verified licence, authorized franchise, seller account or tenant.
            </p>
            <section className="pt-5 border-t space-y-3">
              <h3 className="font-semibold">Independent source grouping review</h3>
              <p className="text-xs text-gray-600">
                Reported parent names, domain matches and shared addresses are
                leads for separate review, not proof that two dealers share
                legal ownership. No company or branch is merged by this action.
              </p>
              <label className="block text-sm font-semibold" htmlFor="group-candidate">
                Other research seed ID (if applicable)
              </label>
              <Input id="group-candidate" value={relatedSeed} maxLength={12}
                placeholder="ZW-DEAL-0002" onChange={e=>setRelatedSeed(e.target.value.toUpperCase())}/>
              <label className="block text-sm font-semibold" htmlFor="group-state">Documented grouping observation</label>
              <select id="group-state" className="w-full border rounded-lg p-2"
                value={groupState} onChange={e=>setGroupState(e.target.value)}>
                <option value="UNRESOLVED_GROUPING">Unresolved — review later</option>
                <option value="POTENTIAL_SAME_PARENT">Possible shared parent (not legally verified)</option>
                <option value="POTENTIAL_DUPLICATE">Possible duplicate — review before publication</option>
                <option value="CONFIRMED_DISTINCT_RESEARCH">Distinct research records after comparison</option>
                <option value="REVIEWED_BRANCH_RELATIONSHIP">Researched branch relationship (not corporate proof)</option>
              </select>
              <label className="block text-sm font-semibold" htmlFor="group-reason">
                Detailed independently reviewed source evidence (60+ characters)
              </label>
              <textarea id="group-reason" value={groupReason} minLength={60}
                maxLength={3000} onChange={e=>setGroupReason(e.target.value)}
                className="border rounded-lg w-full p-3 min-h-28"/>
              <Button className={DEALER_WRAP_BUTTON} variant="outline" disabled={busy||password.length<8||
                groupReason.trim().length<60} onClick={()=>{void recordGrouping()}}>
                Record nonlegal grouping observation
              </Button>
            </section>
            <section className="pt-5 border-t space-y-3" data-testid="dealer-duplicate-reconcile-panel">
              <h3 className="font-semibold">Reconcile duplicate research seed &amp; canonical redirect</h3>
              <p className="text-xs text-gray-600">
                Redirects an unclaimed duplicate research record ({current.seed_dealer_id}) to a published
                canonical research seed while preserving original source, claim and legal custody.
                Seeds with any existing claim or approved legal custody cannot be redirected.
              </p>
              <label className="block text-sm font-semibold" htmlFor="duplicate-canonical-seed">
                Published canonical target seed ID
              </label>
              <Input id="duplicate-canonical-seed" value={canonicalTargetSeed} maxLength={12}
                placeholder="ZW-DEAL-0001"
                onChange={e=>setCanonicalTargetSeed(e.target.value.toUpperCase())}/>
              <label className="block text-sm font-semibold" htmlFor="duplicate-reconcile-reason">
                Duplicate reconciliation rationale (60+ characters)
              </label>
              <textarea id="duplicate-reconcile-reason" value={duplicateReason} minLength={60}
                maxLength={3000} onChange={e=>setDuplicateReason(e.target.value)}
                className="border rounded-lg w-full p-3 min-h-24"/>
              <Button className={DEALER_WRAP_BUTTON} variant="outline" disabled={busy||password.length<8||
                duplicateReason.trim().length<60||!/^ZW-DEAL-\d{4}$/.test(canonicalTargetSeed.trim())}
                onClick={()=>{void recordDuplicateRedirect()}}>
                Reconcile duplicate &amp; activate canonical redirect
              </Button>
            </section>
            <section className="pt-5 border-t space-y-3" data-testid="dealer-correction-review-panel">
              <h3 className="font-semibold">Source correction &amp; takedown requests queue</h3>
              <p className="text-xs text-gray-600">
                Public correction and removal submissions never auto-suppress a profile. An independent
                reviewer must evaluate the request and record a disposition with password step-up.
              </p>
              {corrections.length===0&&<p className="text-sm text-gray-600">
                No correction or takedown requests recorded.
              </p>}
              {corrections.length>0&&<>
                <label htmlFor="correction-request-select" className="block text-sm font-semibold">
                  Select correction or takedown request
                </label>
                <select id="correction-request-select" className="w-full border rounded-lg p-2 text-sm"
                  value={selectedCorrectionId}
                  onChange={e=>setSelectedCorrectionId(e.target.value)}>
                  {corrections.map(req=><option key={req.request_id} value={req.request_id}>
                    {req.seed_dealer_id} · {req.request_type} · {req.status}
                  </option>)}
                </select>
                {currentCorrection&&<div className="rounded-lg border bg-slate-50 p-3 text-sm space-y-2">
                  <p><strong>Seed:</strong> {currentCorrection.seed_dealer_id} · <strong>Type:</strong> {currentCorrection.request_type} · <strong>Status:</strong> {currentCorrection.status}</p>
                  <p className="text-gray-800 break-words">{currentCorrection.request_summary}</p>
                  {currentCorrection.status==='PENDING_HUMAN_REVIEW'&&<>
                    <label htmlFor="correction-disposition" className="block text-sm font-semibold">
                      Independent correction disposition
                    </label>
                    <select id="correction-disposition" className="w-full border rounded-lg p-2"
                      value={correctionDecision}
                      onChange={e=>setCorrectionDecision(e.target.value as CorrectionDecision)}>
                      <option value="RESOLVED_SUPPRESSED">Suppress public profile (takedown / privacy)</option>
                      <option value="RESOLVED_WITHHELD">Withhold public profile pending source correction</option>
                      <option value="RESOLVED_UNDER_DISPUTE">Place under identity dispute (withdraw public display)</option>
                      <option value="REJECTED_NO_CHANGE">Reject unsubstantiated request (keep current state)</option>
                    </select>
                    <label htmlFor="correction-review-reason" className="block text-sm font-semibold">
                      Correction review rationale (60+ characters)
                    </label>
                    <textarea id="correction-review-reason" value={correctionReason} minLength={60}
                      maxLength={3000} onChange={e=>setCorrectionReason(e.target.value)}
                      className="border rounded-lg w-full p-3 min-h-24 bg-white"/>
                    <Button className={DEALER_WRAP_BUTTON} variant="outline" disabled={busy||password.length<8||
                      correctionReason.trim().length<60}
                      onClick={()=>{void recordCorrectionDisposition()}}>
                      Record correction/takedown disposition
                    </Button>
                  </>}
                </div>}
              </>}
            </section>
            <section className="pt-5 border-t space-y-3">
              <h3 className="font-semibold">Field-level public contact eligibility</h3>
              <p className="text-xs text-gray-600">
                Only possible for an individually published unclaimed research
                profile after source checks. The service copies selected business
                address/phone/website literally from the source, never a principal,
                a private email, or arbitrary submitted text. No logo rights implied.
              </p>
              {[
                ['Allow reviewed business physical address',contactAddress,setContactAddress],
                ['Allow reviewed business phone from source',contactPhone,setContactPhone],
                ['Allow reviewed HTTPS source website',contactWebsite,setContactWebsite],
                ['Retract all reviewed contact information',contactRetract,setContactRetract],
              ].map(([label,value,setter],i)=><label key={i}
                className="flex gap-2 items-start text-sm">
                <input type="checkbox" checked={value as boolean}
                  onChange={e=>(setter as (checked:boolean)=>void)(e.target.checked)}/>
                {String(label)}
              </label>)}
              <label htmlFor="contact-reason" className="block text-sm font-semibold">
                Explain lawful public business-contact display and evidence checked (80+ characters)
              </label>
              <textarea id="contact-reason" value={contactReason} minLength={80}
                maxLength={3000} onChange={e=>setContactReason(e.target.value)}
                className="border rounded-lg p-3 w-full min-h-28"/>
              <Button className={DEALER_WRAP_BUTTON} variant="outline" disabled={busy||password.length<8||
                contactReason.trim().length<80||
                current.publication_state!=='PRELISTED_UNCLAIMED'}
                onClick={()=>{void recordContacts()}}>
                Record restricted source-contact decision
              </Button>
            </section>

          </>}
        </CardContent></Card>
      </div>}
      {notice&&<p role="status" className="bg-slate-100 p-3 mt-5 rounded-lg">{notice}</p>}
      {error&&<p role="alert" className="bg-red-50 text-red-800 p-3 mt-5 rounded-lg">{error}</p>}
    </div>
  </main>
}
