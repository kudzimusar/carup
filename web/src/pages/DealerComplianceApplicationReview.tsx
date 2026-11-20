import {useCallback,useEffect,useState} from 'react'
import { dealerDateTime } from '@/lib/dealerDates'
import { DEALER_WRAP_BUTTON } from '@/components/dealer/dealerButtonWrap'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
import ReviewerStepUpField from '@/components/dealer/ReviewerStepUpField'
import { useInReviewWorkbench } from '@/components/dealer/reviewWorkbenchContext'
import {
  REVIEW_LABEL, REVIEW_PRIMARY, REVIEW_SECONDARY, ReviewAccessNotice, ReviewAudienceSplit, ReviewAuditTrail, ReviewCaseBody, ReviewCaseHeader, ReviewChoice, ReviewDecisionPanel, ReviewFacts, ReviewMessages, ReviewNoCase, ReviewQueueItem, ReviewQueuePanel, ReviewReasonField, ReviewSection, ReviewStepUp, ReviewWorkbenchGrid, ReviewWorkbenchHeader, type ReviewQueueState,
} from '@/components/dealer/review/ReviewCaseFile'
import { noCaseTitle } from '@/components/dealer/review/reviewTone'

type Submission={
  submission_id:string;claim_id:string;intake_version:number;submitted_at:string;
  independent_review_required:boolean;
}
type Preview={
  submission_id:string;claim_id:string;intake_version:number;submitted_at:string;
  application_snapshot:{tab_rows:Record<string,Array<Record<string,string>>>};
  snapshot_sha256:string;verified:false;can_activate:false;legal_compliance_approved:false;
}
type Outcome='NEEDS_CORRECTIONS'|'EVIDENCE_REQUIRED'|'READY_FOR_REGULATORY_REVIEW'
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
const headers=(id:string,token:string):AuthHeaders=>({'x-session-token':token,'x-user-id':id})
export default function DealerComplianceApplicationReview(){
  const {user,token}=useAuth()
  const allowed=Boolean(user&&token&&['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
  const [cases,setCases]=useState<Submission[]>([])
  const [selected,setSelected]=useState<string>('')
  const [preview,setPreview]=useState<Preview|null>(null)
  const [password,setPassword]=useState('')
  const [outcome,setOutcome]=useState<Outcome>('EVIDENCE_REQUIRED')
  const [reason,setReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  // RX05-D: lets the unified queue tell "loading" and "could not load" apart from "empty" (legacy view unchanged).
  const [readState,setReadState]=useState<'loading'|'ready'|'failed'>('loading')
  const reload=useCallback(async()=>{
    if(!allowed||!user||!token)return
    try{
      const r=await apiRequest<{submissions:Submission[]}>({
        baseUrl:API,path:'/admin/dealership/compliance-submissions/queue',
        authHeaders:headers(user.id,token),
      })
      setCases(r.submissions||[])
      setSelected(current=>r.submissions.some(s=>s.submission_id===current)
        ?current:r.submissions[0]?.submission_id||'')
      setError('')
      setReadState('ready')
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Private compliance queue unavailable')
      setCases([])
      setReadState('failed')
    }
  },[allowed,user,token])
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
      if(active){setPreview(null);setPassword('');setReason('')}
    })
    return()=>{active=false}
  },[selected])
  const current=cases.find(s=>s.submission_id===selected)
  async function openFrozenCase(){
    if(!current||!user||!token||busy||password.length<8)return
    setBusy(true);setError('');setNotice('');setPreview(null)
    try{
      const result=await apiRequest<{preview:Preview}>({
        baseUrl:API,
        path:'/admin/dealership/compliance-submissions/'+encodeURIComponent(current.submission_id)+'/preview',
        options:{method:'POST',body:JSON.stringify({reviewer_password:password})},
        authHeaders:headers(user.id,token),
      })
      setPreview(result.preview)
      setNotice('Applicant snapshot opened privately. Compare declarations with independent original evidence, registered identity, issuer and scope.')
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Independent reviewer reauthentication refused')
    }finally{setBusy(false);setPassword('')}
  }
  async function recordFinding(){
    if(!current||!user||!token||busy||!preview||password.length<8||reason.trim().length<40)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{review:{verdict:string;preliminary_review_only:boolean}}>({
        baseUrl:API,
        path:'/admin/dealership/compliance-submissions/'+encodeURIComponent(current.submission_id)+'/review',
        options:{method:'POST',body:JSON.stringify({
          verdict:outcome,reason:reason.trim(),reviewer_password:password,
        })},authHeaders:headers(user.id,token),
      })
      setNotice('Preliminary finding recorded: '+result.review.verdict
        +'. This does NOT verify an operating business, licence, tax clearance or tenant.')
      setPreview(null);setReason('')
      await reload()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Preliminary review refused')
    }finally{setBusy(false);setPassword('')}
  }
  // RX05-D — unified ReviewWorkbench composition (presentation only; same state, handlers and rules).
  const inWorkbench=useInReviewWorkbench()
  if(inWorkbench){
    const qs:ReviewQueueState=readState==='loading'?'loading':readState==='failed'?'unavailable':cases.length?'ready':'empty'
    const declared=Object.entries(preview?.application_snapshot.tab_rows?.BUSINESS?.[0]||{}).
      filter(([name])=>['legal_name','trading_name','operating_country','research_confirmation','registration_authority'].includes(name))
    const applicantReadsReason=outcome==='NEEDS_CORRECTIONS'||outcome==='EVIDENCE_REQUIRED'
    return <div className="min-w-0 pb-8" data-testid="compliance-review-workbench">
      <ReviewWorkbenchHeader eyebrow="Application evidence workbench" title="Independent dealer application review"
        summaryLabel="What a preliminary finding does — and does not do">
        <p>Claim ownership approval, applicant document submission and actual legal/operational
          business activation are separate authorities. This workbench only records
          preliminary findings for a frozen applicant declaration. No paid or verified
          dealer status can be issued here.</p>
      </ReviewWorkbenchHeader>
      {!allowed?<ReviewAccessNotice>Verified platform reviewer session required. The server independently checks this on every request.</ReviewAccessNotice>:
      <ReviewWorkbenchGrid testId="compliance-review-grid" caseLabel="Selected application"
        queue={<ReviewQueuePanel testId="compliance-queue" listLabel="Submitted private applications" title="Queue"
          count={qs==='ready'||qs==='empty'?cases.length:null} onRefresh={()=>{void reload()}} state={qs}
          loadingText="Loading submitted applications…" unavailableTestId="compliance-queue-unavailable"
          unavailableMessage={<>The private application queue could not be loaded{error?<> ({error})</>:null}.</>}
          emptyTitle="No submitted applications"
          emptyBody="Applicant drafts are not automatically approved. An application appears here only once the applicant submits a frozen declaration.">
          {cases.map(item=><ReviewQueueItem key={item.submission_id} testId={`compliance-queue-item-${item.submission_id}`}
            selected={item.submission_id===selected} title={`Application version ${item.intake_version}`}
            meta={[`Claim ${item.claim_id}`]} since={item.submitted_at} sinceLabel="Submitted"
            flag={!item.independent_review_required?'Self-review forbidden — a different reviewer must decide':undefined}
            onSelect={()=>{setSelected(item.submission_id);setNotice('');setError('')}}/>)}
        </ReviewQueuePanel>}>
        {!current&&<ReviewNoCase title={noCaseTitle(qs,'Select a submitted application.','There is no application to review.')}
          body={qs==='ready'?"Each application is a frozen applicant declaration. Opening it requires your password.":undefined}/>}
        {current&&<>
          <ReviewCaseHeader testId="compliance-case-identity" eyebrow="Frozen application" title={`Application version ${current.intake_version}`}
            statusLabel={preview?'Opened privately · not verified':'Not opened'} status={preview?'UNVERIFIED':'PENDING'}
            facts={[
              {label:'Submitted',value:dealerDateTime(current.submitted_at)},
              {label:'Application',value:current.submission_id,mono:true},
              {label:'Claim',value:current.claim_id,mono:true},
            ]}/>
          {!current.independent_review_required&&<p role="alert" className="rounded-card bg-status-warning-soft p-4 text-sm text-status-warning">
            Self-review forbidden: you cannot open or decide this application. A different independent reviewer must do it.
          </p>}
          <ReviewAudienceSplit audience="applicant"
            facingNote="The applicant sees their submission receipt and its preliminary status. If you record “Applicant corrections required” or “Original evidence still required”, they also read your rationale."
            facing={<ReviewFacts items={[
              {label:'Their receipt',value:`Version ${current.intake_version} · ${dealerDateTime(current.submitted_at)}`},
              {label:'Verified by CarUp',value:'No'},
            ]}/>}
            internal={preview?<ReviewFacts items={[
              {label:'Snapshot fingerprint',value:preview.snapshot_sha256.slice(0,16)+'…',mono:true},
              {label:'Company / legal approval',value:'Not inferred'},
            ]}/>:<p className="text-xs text-carup-text-2">Open the frozen application to see its snapshot fingerprint.</p>}/>
          <ReviewCaseBody
            evidence={<>
              {!preview&&<ReviewSection testId="compliance-evidence-locked" title="Private frozen application" provenance="applicant"
                description="Original evidence preview remains in the separate authorized claim-review workbench. Review the actual issuer, company identity and claimed branch scope before any finding.">
                <p className="rounded-control border border-dashed border-carup-line-strong bg-carup-bg-surface p-4 text-center text-sm text-carup-text-2">
                  Enter your password under Step-up and choose “Inspect private frozen application” to read the declaration here.
                </p>
              </ReviewSection>}
              {preview&&<ReviewSection testId="compliance-evidence" title="Frozen declaration" provenance="applicant"
                description="Applicant declarations only · No legal signatory, company or regulator verification inferred">
                <ul className="grid gap-2 sm:grid-cols-2" aria-label="Declared workbook sections">
                  {Object.entries(preview.application_snapshot.tab_rows||{}).
                    filter(([name])=>name!=='README - Instructions').
                    map(([name,rows])=><li key={name} className="rounded-control bg-carup-bg-surface p-3 text-sm">
                      <span className="block font-semibold text-carup-text">{name.replaceAll('_',' ')}</span>
                      <span className="block text-carup-text-2">{rows.length} candidate row(s)</span>
                    </li>)}
                </ul>
                <p className="rounded-control bg-status-warning-soft p-3 text-sm leading-6 text-status-warning" data-testid="dealer-unavailable-ocr-comparison">
                  Not available yet: CarUp does not automatically compare text read from the uploaded documents
                  (OCR) with the values declared in the workbook. Compare the original documents with the
                  declared legal name, registration number and expiry yourself before recording a finding.
                </p>
                <div className="rounded-control ring-1 ring-carup-line p-3">
                  <h4 className="text-sm font-semibold text-carup-text">Declared legal identity — not verified</h4>
                  {declared.length===0&&<p className="mt-1 text-sm text-carup-text-2">No declared legal identity rows.</p>}
                  {declared.length>0&&<ReviewFacts className="mt-2" items={declared.map(([name,value])=>({label:name.replaceAll('_',' '),value:String(value)}))}/>}
                </div>
                <button type="button" className={REVIEW_SECONDARY} onClick={()=>setPreview(null)}>Close private case</button>
              </ReviewSection>}
            </>}
            decision={<div className="min-w-0 space-y-4" data-testid="compliance-decision">
              {!preview?<>
                <ReviewStepUp actions={<button type="button" className={REVIEW_SECONDARY+' w-full'}
                  disabled={busy||password.length<8||!current.independent_review_required}
                  onClick={()=>{void openFrozenCase()}}>Inspect private frozen application</button>}>
                  <div>
                    <label htmlFor="case-password" className={REVIEW_LABEL}>Reenter your reviewer password to open private application</label>
                    <ReviewerStepUpField id="case-password" value={password} onChange={setPassword} username={user?.email}
                      className="mt-1" inputClassName="bg-carup-bg-raised"/>
                  </div>
                </ReviewStepUp>
                <ReviewNoCase title="Decision available after you open the application"
                  body="A preliminary finding can only be recorded for a frozen application you have inspected in this session."/>
              </>:<>
                <ReviewStepUp note="Your password is asked again for the finding; it is cleared after each attempt.">
                  <div>
                    <label htmlFor="finding-password" className={REVIEW_LABEL}>Reenter reviewer password for final preliminary finding</label>
                    <ReviewerStepUpField id="finding-password" value={password} onChange={setPassword} username={user?.email}
                      className="mt-1" inputClassName="bg-carup-bg-raised"/>
                  </div>
                </ReviewStepUp>
                <ReviewDecisionPanel title="Independent preliminary finding"
                  requirements={[
                    {label:'Reviewer password entered (at least 8 characters)',met:password.length>=8},
                    {label:'Discrepancies, evidence gaps or escalation basis written (at least 40 characters)',met:reason.trim().length>=40},
                  ]}
                  footnote="This does NOT verify an operating business, licence, tax clearance or tenant."
                  submit={<button type="button" className={REVIEW_PRIMARY} disabled={busy||reason.trim().length<40||password.length<8}
                    onClick={()=>{void recordFinding()}}>Record immutable preliminary finding</button>}>
                  <ReviewChoice id="finding" legend="Finding" value={outcome} onChange={setOutcome} options={[
                    ['EVIDENCE_REQUIRED','Original evidence still required'],
                    ['NEEDS_CORRECTIONS','Applicant corrections required'],
                    ['READY_FOR_REGULATORY_REVIEW','Escalate for separate country/legal review — NOT APPROVED'],
                  ]}/>
                  <ReviewReasonField id="finding-reason" label="Describe discrepancies, evidence gaps or escalation basis (40+ characters)"
                    value={reason} onChange={setReason} min={40}
                    audience={applicantReadsReason
                      ?'Applicant-facing: with this finding the applicant reads this text as the reason for the correction or evidence request.'
                      :'Internal reviewer note: with an escalation the applicant sees the status, not this text.'}/>
                </ReviewDecisionPanel>
              </>}
              <ReviewMessages notice={notice} error={error}/>
            </div>}
            audit={<ReviewAuditTrail testId="compliance-audit-trail"
              entries={[{id:'submitted',title:`Application version ${current.intake_version} submitted by the applicant`,at:current.submitted_at}]}
              empty="Nothing recorded yet."
              note="Only the submission receipt is returned to this workbench."/>}/>
        </>}
      </ReviewWorkbenchGrid>}
    </div>
  }
  return <main className="min-h-screen bg-gray-50 section-padding">
    <div className="max-w-6xl mx-auto py-10">
      <Link to="/admin/dealer-claims" className="text-blue-700 underline text-sm">
        Back to independent claim review
      </Link>
      <h1 className="text-3xl font-bold mt-5">Independent dealer application review</h1>
      <p className="mt-3 text-sm">
        <Link to="/admin/dealer-legal-activation" className="text-blue-700 underline">
          Open separate final legal and canonical activation review
        </Link>
      </p>
      <p className="max-w-4xl text-gray-600 mt-2">
        Claim ownership approval, applicant document submission and actual legal/operational
        business activation are separate authorities. This workbench only records
        preliminary findings for a frozen applicant declaration. No paid or verified
        dealer status can be issued here.
      </p>
      {!allowed?<p role="alert" className="mt-6">
        Verified platform reviewer session required. The server independently checks this on every request.
      </p>:<div className="grid lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] gap-5 mt-8">
        <Card><CardContent className="p-5 space-y-3">
          <h2 className="font-semibold text-lg">Submitted private applications</h2>
          <Button size="sm" variant="outline" onClick={()=>{void reload()}}>Refresh</Button>
          {cases.length===0&&<p className="text-sm text-gray-600">
            No submitted applications. Applicant drafts are not automatically approved.
          </p>}
          {cases.map(item=><button key={item.submission_id} type="button"
            onClick={()=>{setSelected(item.submission_id);setNotice('');setError('')}}
            className={'w-full text-left rounded-lg p-3 border '+
              (item.submission_id===selected?'border-blue-700 bg-blue-50':'border-gray-200')}>
            <strong className="text-sm block">Application version {item.intake_version}</strong>
            <span className="text-xs text-gray-600 block break-all">{item.claim_id}</span>
            <span className="text-xs text-gray-500 block mt-1">
              Submitted {dealerDateTime(item.submitted_at)}
            </span>
            {!item.independent_review_required&&<span className="text-xs text-red-700 block">
              Self-review forbidden
            </span>}
          </button>)}
        </CardContent></Card>
        <Card><CardContent className="p-5 space-y-4">
          <h2 className="font-semibold text-lg">Frozen declaration and findings</h2>
          {!current?<p className="text-gray-600 text-sm">Select a submitted application.</p>:<>
            <p className="text-sm [overflow-wrap:anywhere]">Application {current.submission_id} · version {current.intake_version}</p>
            <p className="text-xs text-gray-600">
              Original evidence preview remains in the separate authorized claim-review workbench.
              Review the actual issuer, company identity and claimed branch scope before any finding.
            </p>
            {!preview?<div className="space-y-3">
              <label htmlFor="case-password" className="block text-sm font-semibold">
                Reenter your reviewer password to open private application
              </label>
              <ReviewerStepUpField id="case-password" value={password} onChange={setPassword} username={user?.email}/>
              <Button className={DEALER_WRAP_BUTTON} disabled={busy||password.length<8||!current.independent_review_required}
                onClick={()=>{void openFrozenCase()}}>
                Inspect private frozen application
              </Button>
            </div>:<>
              <p className="text-sm text-amber-800">
                Applicant declarations only · No legal signatory, company or regulator verification inferred
              </p>
              <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                {Object.entries(preview.application_snapshot.tab_rows||{}).
                  filter(([name])=>name!=='README - Instructions').
                  map(([name,rows])=><div key={name} className="border rounded-lg p-3">
                    <dt className="font-semibold">{name.replaceAll('_',' ')}</dt>
                    <dd className="mt-1 text-gray-600">{rows.length} candidate row(s)</dd>
                  </div>)}
              </dl>
              {/* Owner UAT: T15 is deferred — the reviewer is told the comparison is manual. */}
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                data-testid="dealer-unavailable-ocr-comparison">
                Not available yet: CarUp does not automatically compare text read from the uploaded documents
                (OCR) with the values declared in the workbook. Compare the original documents with the
                declared legal name, registration number and expiry yourself before recording a finding.
              </p>
              <section className="border rounded-lg p-4">
                <h3 className="font-semibold">Declared legal identity — not verified</h3>
                {Object.entries(preview.application_snapshot.tab_rows?.BUSINESS?.[0]||{}).
                  filter(([name])=>['legal_name','trading_name','operating_country',
                    'research_confirmation','registration_authority'].includes(name)).
                  map(([name,value])=><p className="text-sm mt-2 break-words" key={name}>
                    <strong>{name.replaceAll('_',' ')}:</strong> {String(value)}
                  </p>)}
              </section>
              <label htmlFor="finding" className="block text-sm font-semibold">
                Independent preliminary finding
              </label>
              <select id="finding" value={outcome}
                onChange={e=>setOutcome(e.target.value as Outcome)}
                className="border rounded-lg p-2 w-full">
                <option value="EVIDENCE_REQUIRED">Original evidence still required</option>
                <option value="NEEDS_CORRECTIONS">Applicant corrections required</option>
                <option value="READY_FOR_REGULATORY_REVIEW">
                  Escalate for separate country/legal review — NOT APPROVED
                </option>
              </select>
              <label htmlFor="finding-reason" className="block text-sm font-semibold">
                Describe discrepancies, evidence gaps or escalation basis (40+ characters)
              </label>
              <textarea id="finding-reason" value={reason} maxLength={3000}
                onChange={e=>setReason(e.target.value)}
                className="border rounded-lg p-3 w-full min-h-32"/>
              <label htmlFor="finding-password" className="block text-sm font-semibold">
                Reenter reviewer password for final preliminary finding
              </label>
              <ReviewerStepUpField id="finding-password" value={password} onChange={setPassword} username={user?.email}/>
              <Button className={DEALER_WRAP_BUTTON} disabled={busy||reason.trim().length<40||password.length<8}
                onClick={()=>{void recordFinding()}}>Record immutable preliminary finding</Button>
              <Button variant="outline" onClick={()=>setPreview(null)}>Close private case</Button>
            </>}
          </>}
        </CardContent></Card>
      </div>}
      {notice&&<p className="mt-5 p-3 rounded-lg bg-slate-100" role="status">{notice}</p>}
      {error&&<p className="mt-5 p-3 rounded-lg bg-red-50 text-red-800" role="alert">{error}</p>}
    </div>
  </main>
}
