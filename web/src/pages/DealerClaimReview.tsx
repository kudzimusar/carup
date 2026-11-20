import { useCallback, useEffect, useRef, useState } from 'react'
import { DEALER_WRAP_BUTTON } from '@/components/dealer/dealerButtonWrap'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import ReviewerStepUpField from '@/components/dealer/ReviewerStepUpField'
import { dealerReviewerErrorMessage } from '@/lib/dealerReviewerErrors'
import { dealerDateTime } from '@/lib/dealerDates'
import { useInReviewWorkbench } from '@/components/dealer/reviewWorkbenchContext'
import { FileText } from 'lucide-react'
import {
  REVIEW_FIELD, REVIEW_LABEL, REVIEW_PRIMARY, REVIEW_SECONDARY, ReviewAccessNotice, ReviewAudienceSplit, ReviewAuditTrail,
  ReviewCaseBody, ReviewCaseHeader, ReviewChoice, ReviewDecisionPanel, ReviewFacts, ReviewMessages, ReviewMoreAction, ReviewNoCase,
  ReviewQueueItem, ReviewQueuePanel, ReviewReasonField, ReviewSection, ReviewStatusChip, ReviewStepUp, ReviewWorkbenchGrid,
  ReviewWorkbenchHeader, type ReviewAuditEntry,
} from '@/components/dealer/review/ReviewCaseFile'

type QueueClaim = {
  claim_id:string;seed_dealer_id:string;claimed_scope:string;claim_status:string;created_at:string
}
type PrivateEvidence={evidence_id:string;document_class:string;created_at:string;content_sha256:string
  mime_type?:string;file_bytes?:number;quarantined?:boolean
  quarantine?:{actor_kind:string;reason_code:string;recorded_at:string}|null}
type QuarantineReason='NOT_THE_DECLARED_DOCUMENT_TYPE'|'UNREADABLE_OR_INCOMPLETE'|'NOT_ISSUED_BY_STATED_AUTHORITY'
const QUARANTINE_REASONS:[QuarantineReason,string][]=[
  ['NOT_THE_DECLARED_DOCUMENT_TYPE','It is not the document type it was filed as (e.g. a photo of premises)'],
  ['UNREADABLE_OR_INCOMPLETE','It is unreadable or incomplete'],
  ['NOT_ISSUED_BY_STATED_AUTHORITY','It was not issued by the stated authority'],
]
const DOCUMENT_LABELS:Record<string,string>={
  COMPANY_REGISTRATION:'company registration certificate',DIRECTOR_AUTHORITY:'director authority',
  SIGNATORY_MANDATE:'signatory mandate',BRANCH_AUTHORITY:'branch operating authority',
  PARENT_COMPANY_AUTHORITY:'parent company authority',
}
const evidenceOption=(item:PrivateEvidence)=>`${item.document_class.replaceAll('_',' ')}`+
  `${item.mime_type?' · '+item.mime_type:''}${item.file_bytes?' · '+Math.max(1,Math.round(item.file_bytes/1024))+' KB':''}`+
  ` · ${dealerDateTime(item.created_at)} (${item.evidence_id.slice(0,8)})${item.quarantined?' — QUARANTINED, not usable':''}`
type Verdict='CLAIM_APPROVED'|'CLAIM_REJECTED'|'CLAIM_DISPUTED'|'CLAIM_REVOKED'
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
function headers(token:string,id:string):AuthHeaders {
  return {'x-session-token':token,'x-user-id':id}
}

/**
 * Claim-review workbench: no self-approval, no unconfirmed docs, reviewer password
 * mandatory for each original-evidence preview and each decision. Never stores passwords.
 */
/** HTTP status of a refused/failed request (a session failure counts as 401). */
/** apiClient's SessionExpiredError (matched by its name; it is raised for 401 session failures). */
function isSessionExpired(problem:unknown):boolean{
  return (problem as {name?:string})?.name==='SessionExpiredError'
}
function failureStatus(problem:unknown):number|undefined{
  if(isSessionExpired(problem))return 401
  return (problem as {status?:number})?.status
}
const isAuthorityLoss=(status:number|undefined)=>status===401||status===403

/**
 * RX03-P2-R5 REVIEW-01 — one workbench instance per actor identity (user, role, session token).
 * When any of them changes, the previous instance — with every piece of private case state and
 * every in-flight request callback — is discarded; nothing an earlier actor saw or typed can
 * reach the next actor, and a late response from the former actor lands on an unmounted tree.
 */
export default function DealerClaimReview() {
  const {user,token}=useAuth()
  const actorKey=`${user?.id??'-'}|${user?.role??'-'}|${token??'-'}`
  return <DealerClaimReviewForActor key={actorKey}/>
}

function DealerClaimReviewForActor() {
  const {user,token}=useAuth()
  const authorized=Boolean(user&&['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
  // RX03-P2-R4: the generic /admin dashboard is for administrators only — never link a reviewer to it.
  const isAdministrator=Boolean(user&&['admin','platform_admin','super_admin'].includes(String(user.role)))
  const inWorkbench=useInReviewWorkbench()
  const [mobileView,setMobileView]=useState<'queue'|'case'>('queue')
  const [claims,setClaims]=useState<QueueClaim[]>([])
  // RX03-P2-R4: a refused or failed queue read is never shown as an empty queue.
  const [queueState,setQueueState]=useState<'loading'|'ready'|'forbidden'|'expired'|'failed'>('loading')
  const [selected,setSelected]=useState<string>('')
  const [evidence,setEvidence]=useState<PrivateEvidence[]>([])
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [password,setPassword]=useState('')
  const [reason,setReason]=useState('')
  const [issuer,setIssuer]=useState('')
  const [scope,setScope]=useState<'BRANCH'|'PARENT_ORGANIZATION'>('BRANCH')
  const [evidenceId,setEvidenceId]=useState('')
  const [verdict,setVerdict]=useState<Verdict>('CLAIM_DISPUTED')
  const [preview,setPreview]=useState<{url:string;expires:number;evidenceId:string}|null>(null)
  // UAT-R1: approval needs the reviewer to have OPENED the selected original in this session and to
  // confirm it is what it was filed as; a mis-filed document can be quarantined instead.
  const [opened,setOpened]=useState<string[]>([])
  const [documentConfirmed,setDocumentConfirmed]=useState(false)
  const [quarantineReason,setQuarantineReason]=useState<QuarantineReason|''>('')
  const [quarantineNote,setQuarantineNote]=useState('')

  // RX03-P2-R5 REVIEW-01 — every queue read carries a generation; only the LATEST read may change
  // the workbench, so an older (slower) response can never overwrite a newer outcome.
  const queueGeneration=useRef(0)
  /** Drop every piece of private case state and every consequential input. */
  const clearPrivateCase=useCallback(()=>{
    setClaims([]);setSelected('');setEvidence([]);setEvidenceId('');setPreview(null);setOpened([])
    setPassword('');setDocumentConfirmed(false);setReason('');setIssuer('');setQuarantineReason('');setQuarantineNote('')
    setNotice('');setMobileView('queue')
  },[])
  /** A refused or failed authority read: fail closed, then say which. */
  const loseAuthority=useCallback((problem:unknown,fallback:string)=>{
    queueGeneration.current+=1
    const status=failureStatus(problem)
    clearPrivateCase()
    setQueueState(status===401?'expired':status===403?'forbidden':'failed')
    setError(dealerReviewerErrorMessage(problem,fallback))
  },[clearPrivateCase])
  const reload=useCallback(async()=>{
    if(!authorized||!user||!token)return
    const generation=++queueGeneration.current
    try{
      const result=await apiRequest<{claims:QueueClaim[]}>({
        baseUrl:API,path:'/admin/dealership/claims/queue',
        authHeaders:headers(token,user.id),
      })
      if(generation!==queueGeneration.current)return
      const list=result.claims||[]
      setClaims(list)
      setQueueState('ready')
      setError('')
      setSelected(current=>current&&list.some(c=>c.claim_id===current)
        ?current:list[0]?.claim_id||'')
    }catch(problem){
      if(generation!==queueGeneration.current)return
      loseAuthority(problem,'Claim-review queue unavailable')
    }
  },[authorized,user,token,loseAuthority])
  useEffect(()=>{
    // Defer request-driven state to the async phase, avoiding a redundant
    // synchronous render caused by setting loading state in an effect.
    let mounted=true
    void Promise.resolve().then(()=>{if(mounted)void reload()})
    return()=>{mounted=false}
  },[reload])
  // REVIEW-01: a case exists only while the latest authoritative queue read succeeded.
  const current=queueState==='ready'?claims.find(c=>c.claim_id===selected):undefined
  useEffect(()=>{
    if(!selected||!user||!token||!authorized)return
    let active=true
    // Clear the previous claim's private artifacts before new evidence resolves.
    void Promise.resolve().then(()=>{
      if(active){setPreview(null);setEvidence([]);setEvidenceId('');setDocumentConfirmed(false)}
    })
    apiRequest<{evidence:PrivateEvidence[]}>({
      baseUrl:API,path:'/admin/dealership/claims/'+encodeURIComponent(selected)+'/evidence',
      authHeaders:headers(token,user.id),
    }).then(result=>{
      if(!active)return
      setEvidence(result.evidence||[])
      setEvidenceId((result.evidence||[]).find(e=>!e.quarantined)?.evidence_id||'')
    }).catch(problem=>{
      if(!active)return
      if(isAuthorityLoss(failureStatus(problem))){loseAuthority(problem,'Evidence unavailable');return}
      setEvidence([]);setEvidenceId('');setPreview(null)
      setError(dealerReviewerErrorMessage(problem,'Evidence unavailable'))
    })
    return()=>{active=false}
  },[selected,user,token,authorized,loseAuthority])
  const currentClaimId=current?.claim_id
  const currentClaimScope=current?.claimed_scope
  useEffect(()=>{
    if(!currentClaimId)return
    let active=true
    void Promise.resolve().then(()=>{
      if(active)setScope(currentClaimScope==='PARENT_ORGANIZATION'?'PARENT_ORGANIZATION':'BRANCH')
    })
    return()=>{active=false}
  },[currentClaimId,currentClaimScope])

  async function viewOriginal(){
    if(!current||!user||!token||!evidenceId||!password||busy)return
    setBusy(true);setError('');setNotice('');setPreview(null)
    try{
      const result=await apiRequest<{preview:{signed_url:string;expires_seconds:number}}>({
        baseUrl:API,
        path:'/admin/dealership/claims/'+encodeURIComponent(current.claim_id)
          +'/evidence/'+encodeURIComponent(evidenceId)+'/preview',
        options:{method:'POST',body:JSON.stringify({reviewer_password:password})},
        authHeaders:headers(token,user.id),
      })
      // URL expires after 60 sec; it is never placed in app analytics, public projections or storage.
      setPreview({url:result.preview.signed_url,expires:result.preview.expires_seconds,evidenceId})
      setOpened(previous=>previous.includes(evidenceId)?previous:[...previous,evidenceId])
      setNotice('Private original available temporarily. Verify the issuing authority and legal scope independently.')
    }catch(problem){
      // A wrong step-up password is a refusal of THIS action; a lost session is a loss of authority.
      if(isSessionExpired(problem)){loseAuthority(problem,'Private evidence preview refused');return}
      setError(dealerReviewerErrorMessage(problem,'Private evidence preview refused'))
    }
    finally{setBusy(false);setPassword('')}
  }
  async function decide(){
    if(!current||!user||!token||!password||busy)return
    setBusy(true);setError('');setNotice('');setPreview(null)
    try{
      const payload={
        reviewer_password:password,verdict,reason:reason.trim(),
        evidence_id:verdict==='CLAIM_APPROVED'?evidenceId:null,
        reviewed_issuer:verdict==='CLAIM_APPROVED'?issuer.trim():null,
        verified_scope:verdict==='CLAIM_APPROVED'?scope:null,
        evidence_document_confirmed:verdict==='CLAIM_APPROVED'?documentConfirmed:undefined,
      }
      const result=await apiRequest<{review:{status:string}}>({
        baseUrl:API,path:'/admin/dealership/claims/'+encodeURIComponent(current.claim_id)+'/review',
        options:{method:'POST',body:JSON.stringify(payload)},
        authHeaders:headers(token,user.id),
      })
      setNotice(`Independent claim decision recorded: ${result.review.status}. No business-compliance or tenant activation was executed.`)
      setReason('');setIssuer('');setDocumentConfirmed(false)
      await reload()
    }catch(problem){
      // A wrong step-up password is a refusal of THIS action; a lost session is a loss of authority.
      if(isSessionExpired(problem)){loseAuthority(problem,'Independent decision refused');return}
      setError(dealerReviewerErrorMessage(problem,'Independent decision refused'))
    }
    finally{setBusy(false);setPassword('')}
  }
  async function quarantine(){
    if(!current||!user||!token||!password||!evidenceId||!quarantineReason||busy)return
    setBusy(true);setError('');setNotice('');setPreview(null)
    try{
      await apiRequest({
        baseUrl:API,path:'/admin/dealership/claims/'+encodeURIComponent(current.claim_id)
          +'/evidence/'+encodeURIComponent(evidenceId)+'/quarantine',
        options:{method:'POST',body:JSON.stringify({reviewer_password:password,
          reason_code:quarantineReason,note:quarantineNote.trim()||undefined})},
        authHeaders:headers(token,user.id),
      })
      setNotice('Document quarantined. It keeps its original label for the record but can never support a claim, legal or activation decision.')
      setQuarantineReason('');setQuarantineNote('');setDocumentConfirmed(false)
      const result=await apiRequest<{evidence:PrivateEvidence[]}>({
        baseUrl:API,path:'/admin/dealership/claims/'+encodeURIComponent(current.claim_id)+'/evidence',
        authHeaders:headers(token,user.id),
      })
      setEvidence(result.evidence||[])
      setEvidenceId((result.evidence||[]).find(e=>!e.quarantined)?.evidence_id||'')
    }catch(problem){
      // A wrong step-up password is a refusal of THIS action; a lost session is a loss of authority.
      if(isSessionExpired(problem)){loseAuthority(problem,'Quarantine refused');return}
      setError(dealerReviewerErrorMessage(problem,'Quarantine refused'))
    }
    finally{setBusy(false);setPassword('')}
  }
  const queueMessage=queueState==='expired'?'Your reviewer session is no longer valid — sign in again to continue.'
    :queueState==='forbidden'?'This session is not allowed to read the claim queue.':'The claim queue could not be loaded.'
  const selectedEvidence=evidence.find(e=>e.evidence_id===evidenceId)
  const selectedOpened=Boolean(evidenceId&&opened.includes(evidenceId))

  if(inWorkbench){
    // RX05-D — queue → case → evidence → decision → audit, on the shared reviewer case file.
    // Same state, same handlers, same submit rules as the legacy composition below.
    const approving=verdict==='CLAIM_APPROVED'
    const quarantined=evidence.filter(e=>e.quarantined)
    const decisionRequirements=[
      {label:'Reviewer password entered for this decision',met:Boolean(password)},
      {label:'Findings written (at least 40 characters)',met:reason.trim().length>=40},
      ...(approving?[
        {label:'A usable original document selected',met:Boolean(evidenceId)},
        {label:'Verified document issuer entered (at least 3 characters)',met:issuer.trim().length>=3},
        {label:'You opened the selected original and confirmed what it is',met:documentConfirmed},
      ]:[]),
    ]
    const audit:ReviewAuditEntry[]=current?[
      {id:'filed',title:'Claim filed by the applicant',at:current.created_at,detail:`Claimed scope: ${current.claimed_scope.replaceAll('_',' ').toLowerCase()}`},
      ...evidence.map(item=>({id:'doc-'+item.evidence_id,title:`Document received · ${(DOCUMENT_LABELS[item.document_class]||'document')}`,at:item.created_at,
        detail:<span className="font-mono text-xs">SHA-256 {item.content_sha256.slice(0,16)}…</span>})),
      ...quarantined.filter(item=>item.quarantine).map(item=>({id:'q-'+item.evidence_id,
        title:item.quarantine?.actor_kind==='CLAIMANT_WITHDRAWAL'?'Document withdrawn by the applicant':'Document quarantined by a reviewer',
        at:item.quarantine?.recorded_at,status:'QUARANTINED',
        detail:(item.quarantine?.reason_code||'').replaceAll('_',' ').toLowerCase()||undefined})),
    ]:[]
    return <div className="min-w-0 pb-8" data-testid="claim-review-workbench">
      <ReviewWorkbenchHeader eyebrow="Claims workbench" title="Independent dealership claim review"
        summaryLabel="What a claim decision does — and does not do">
        <p>
          Business authority is approved separately from legal compliance, operational membership,
          vehicle listings and subscription entitlements. Reviewer actions require password step-up.
          Disputed parent/branch ownership and competing claims require documented resolution.
        </p>
      </ReviewWorkbenchHeader>
      {!authorized||!token ? <ReviewAccessNotice>
        Reviewer or administrator session required. <Link className="font-semibold text-carup-action-hover underline" to="/login">Sign in</Link>.
      </ReviewAccessNotice> : (
        <ReviewWorkbenchGrid view={mobileView} onViewChange={setMobileView} testId="claim-review-grid" caseLabel="Selected claim"
          queue={<ReviewQueuePanel testId="claim-queue" ariaLabel="Claim queue" listLabel="Claims" title="Queue"
            count={queueState==='ready'?claims.length:null} onRefresh={()=>{void reload()}}
            state={queueState==='loading'?'loading':queueState==='ready'?(claims.length?'ready':'empty'):'unavailable'}
            loadingText="Loading the claim queue…" unavailableTestId="claim-queue-unavailable" unavailableMessage={queueMessage}
            emptyTitle="No claims are waiting for review"
            emptyBody="No pending/recorded claims in this queue. A claim appears here only after an applicant files it; nothing is approved automatically.">
            {claims.map(claim=><ReviewQueueItem key={claim.claim_id} selected={selected===claim.claim_id}
              title={claim.seed_dealer_id} status={claim.claim_status}
              meta={[`Claimed scope: ${claim.claimed_scope.replaceAll('_',' ').toLowerCase()}`]}
              since={claim.created_at} sinceLabel="Filed"
              onSelect={()=>{
                if(claim.claim_id===selected)return
                setSelected(claim.claim_id);setError('');setNotice('');setPassword('')
                setPreview(null);setEvidence([]);setEvidenceId('');setDocumentConfirmed(false)
              }}/>)}
          </ReviewQueuePanel>}>
          <div data-testid="claim-case" className="min-w-0 space-y-4">
            {!current&&<ReviewNoCase
              title={queueState==='ready'&&claims.length===0?'There is no claim to review.':queueState==='ready'?'Select a claim from the queue.':'No case is open.'}
              body={queueState==='ready'?'Choose a claim to see its documents, the step-up and the decision.':'A case opens only while the latest queue read for your session succeeded.'}/>}
            {current&&<>
              <ReviewCaseHeader testId="claim-case-identity" eyebrow="Dealership claim" title={current.seed_dealer_id}
                status={current.claim_status}
                facts={[
                  {label:'Claimed scope',value:current.claimed_scope.replaceAll('_',' ').toLowerCase()},
                  {label:'Filed',value:dealerDateTime(current.created_at)},
                  {label:'Claim ID',value:current.claim_id,mono:true},
                ]}/>
              <ReviewAudienceSplit audience="applicant"
                facingNote="The applicant sees only this claim's status, scope and filing date — never your findings, document fingerprints or quarantine notes."
                facing={<ReviewFacts items={[
                  {label:'Status they see',value:<ReviewStatusChip status={current.claim_status}/>},
                  {label:'Scope they claimed',value:current.claimed_scope.replaceAll('_',' ').toLowerCase()},
                ]}/>}
                internalNote="Reviewer workbench only. Your findings are recorded with the decision and are not returned to the applicant."
                internal={<ul className="space-y-1.5 text-xs leading-5 text-carup-text-2">
                  <li>{evidence.length} document(s) on file · {quarantined.length} quarantined</li>
                  <li>Originals opened in this session: {opened.length}</li>
                  <li>A clean malware scan does not establish that a certificate is genuine.</li>
                </ul>}/>
              <ReviewCaseBody
                evidence={<ReviewSection testId="claim-evidence" title="Private original document evidence" provenance="applicant"
                  description="Choose a document, then open it with your password. Examine original issuer, dates, names, branch/parent authority and possible competing claims.">
                  {evidence.length===0&&<p className="text-sm text-carup-text-2">No original document is attached to this claim, or the evidence list is still loading.</p>}
                  {evidence.length>0&&<ul className="grid gap-2 sm:grid-cols-2" aria-label="Documents on this claim">
                    {evidence.map(item=><li key={item.evidence_id}>
                      <button type="button" disabled={item.quarantined} aria-pressed={evidenceId===item.evidence_id}
                        onClick={()=>{setEvidenceId(item.evidence_id);setPreview(null);setDocumentConfirmed(false)}}
                        className={`flex w-full min-h-11 items-start gap-2 rounded-control p-3 text-left text-sm ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:cursor-not-allowed ${evidenceId===item.evidence_id?'bg-carup-action-soft ring-carup-action':'bg-carup-bg-raised ring-carup-line hover:ring-carup-text-3'} ${item.quarantined?'bg-carup-bg-surface':''}`}>
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true"/>
                        <span className="min-w-0">
                          <span className="block font-semibold text-carup-text">{item.document_class.replaceAll('_',' ')}</span>
                          <span className="block text-[12px] text-carup-text-3">{[item.mime_type,item.file_bytes?Math.max(1,Math.round(item.file_bytes/1024))+' KB':null,dealerDateTime(item.created_at)].filter(Boolean).join(' · ')}</span>
                          <span className="mt-0.5 block text-[12px] font-semibold text-carup-text-2">
                            {item.quarantined?'Quarantined — not usable':opened.includes(item.evidence_id)?'Opened by you this session · not yet decided':'Not yet opened · not verified'}
                          </span>
                        </span>
                      </button>
                    </li>)}
                  </ul>}
                  {quarantined.length>0&&<p className="rounded-control bg-status-warning-soft p-2.5 text-xs leading-5 text-status-warning" data-testid="claim-quarantined-evidence">
                    {quarantined.length} document(s) quarantined
                    ({quarantined.map(e=>(e.quarantine?.actor_kind==='CLAIMANT_WITHDRAWAL'?'withdrawn by the applicant':'quarantined by a reviewer')).join('; ')}) — they cannot support any decision.
                  </p>}
                  <div className={`flex min-h-40 items-center justify-center rounded-card border border-dashed border-carup-line-strong bg-carup-bg-surface p-3 ${preview?'':'text-center'}`} data-testid="claim-evidence-viewer">
                    {preview&&preview.evidenceId===evidenceId?<div className="w-full space-y-2">
                      <p className="text-xs font-semibold text-carup-text-2">Private original · as uploaded by the applicant · not verified</p>
                      {selectedEvidence?.mime_type?.startsWith('image/')&&
                        <img src={preview.url} alt={'Private original: '+(DOCUMENT_LABELS[selectedEvidence.document_class]||'document')+' as uploaded'}
                          className="mx-auto max-h-[28rem] w-auto max-w-full rounded-control bg-carup-bg-raised object-contain ring-1 ring-carup-line" data-testid="claim-evidence-inline-preview"/>}
                      <p className="text-sm">
                        <a href={preview.url} target="_blank" rel="noopener noreferrer"
                          className="font-semibold text-carup-action-hover underline">Open private original (expires in {preview.expires}s)</a>
                      </p>
                    </div>:<p className="max-w-sm text-sm text-carup-text-2">
                      {evidenceId?'Enter your password under Step-up and choose “View selected original securely” to open this original here.':'Select a document to examine.'}
                    </p>}
                  </div>
                  {selectedEvidence&&!selectedEvidence.quarantined&&<ReviewMoreAction testId="claim-quarantine" title="Not the document it was filed as?"
                    summary="Quarantine it so it can never support a claim, legal or activation decision. Uses the step-up password.">
                    <p className="text-xs leading-5 text-carup-text-2">It keeps its original label for the record.</p>
                    <div>
                      <label htmlFor="claim-quarantine-reason" className={REVIEW_LABEL}>Why</label>
                      <select id="claim-quarantine-reason" className={REVIEW_FIELD} value={quarantineReason}
                        onChange={e=>setQuarantineReason(e.target.value as QuarantineReason|'')}>
                        <option value="">Choose a reason</option>
                        {QUARANTINE_REASONS.map(([code,label])=><option key={code} value={code}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="claim-quarantine-note" className={REVIEW_LABEL}>Note (optional)</label>
                      <input id="claim-quarantine-note" className={REVIEW_FIELD} maxLength={1000} value={quarantineNote} onChange={e=>setQuarantineNote(e.target.value)}/>
                    </div>
                    <button type="button" className={REVIEW_SECONDARY+' w-full'} disabled={busy||!password||!quarantineReason}
                      onClick={()=>{void quarantine()}}>Quarantine this document</button>
                  </ReviewMoreAction>}
                </ReviewSection>}
                decision={<div data-testid="claim-decision" aria-label="Findings and decision" role="region" className="min-w-0 space-y-4">
                  <ReviewStepUp note={<>This one-time password challenge is for the decision or document preview only.
                    Passwordless/SSO-only reviewer accounts cannot certify through this path until
                    a separately governed step-up method is available.</>}
                    actions={<button type="button" className={REVIEW_SECONDARY+' w-full'} disabled={busy||!password||!evidenceId}
                      onClick={()=>{void viewOriginal()}}>View selected original securely</button>}>
                    <div>
                      <label htmlFor="claim-reviewer-password" className={REVIEW_LABEL}>
                        Re-enter your own CarUp account password
                      </label>
                      <ReviewerStepUpField id="claim-reviewer-password" value={password} onChange={setPassword} username={user?.email}
                        className="mt-1" inputClassName="bg-carup-bg-raised"/>
                    </div>
                  </ReviewStepUp>
                  <ReviewDecisionPanel title="Record independent determination" requirements={decisionRequirements}
                    footnote="A claim approval does not award a verification badge or enable inventory listing."
                    submit={<button type="button" className={REVIEW_PRIMARY} disabled={busy||!password||reason.trim().length<40||
                      (verdict==='CLAIM_APPROVED'&&(!evidenceId||issuer.trim().length<3||!documentConfirmed))}
                      onClick={()=>{void decide()}}>Record immutable review decision</button>}>
                    <ReviewChoice id="claim-verdict" legend="Verdict" value={verdict} onChange={setVerdict} options={[
                      ['CLAIM_DISPUTED','Disputed — investigate further'],
                      ['CLAIM_REJECTED','Reject claimant authority'],
                      ['CLAIM_APPROVED','Approve claimant authority only'],
                      ['CLAIM_REVOKED','Revoke previously approved claimant authority'],
                    ]}/>
                    {approving&&<>
                      <div>
                        <label htmlFor="claim-issuer" className={REVIEW_LABEL}>Verified document issuer</label>
                        <input id="claim-issuer" className={REVIEW_FIELD} required minLength={3} value={issuer} onChange={e=>setIssuer(e.target.value)}/>
                      </div>
                      <div>
                        <label htmlFor="claim-confirmed-scope" className={REVIEW_LABEL}>Independently confirmed legal scope</label>
                        <select id="claim-confirmed-scope" className={REVIEW_FIELD} value={scope}
                          onChange={e=>setScope(e.target.value as 'BRANCH'|'PARENT_ORGANIZATION')}>
                          <option value="BRANCH">Branch authority</option>
                          <option value="PARENT_ORGANIZATION">Parent organization authority</option>
                        </select>
                      </div>
                      <label htmlFor="claim-document-confirmed" className="flex items-start gap-2 rounded-control bg-carup-bg-surface p-3 text-sm text-carup-text">
                        <input id="claim-document-confirmed" type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={documentConfirmed}
                          disabled={!selectedOpened} onChange={e=>setDocumentConfirmed(e.target.checked)}/>
                        <span className="min-w-0">{selectedOpened
                          ?`I opened this original and it is a genuine ${DOCUMENT_LABELS[selectedEvidence?.document_class||'']||'document of the stated type'} from the issuer I entered — not a photo of premises or any other document.`
                          :'Open the selected original (“View selected original securely”) before you can confirm what it is.'}</span>
                      </label>
                    </>}
                    <ReviewReasonField id="claim-review-reason" label="Specific independent review findings (40–3000 characters)"
                      value={reason} onChange={setReason} min={40}
                      audience="Internal reviewer note — recorded with this decision. The applicant sees the resulting status, not this text."/>
                  </ReviewDecisionPanel>
                  <ReviewMessages notice={notice} error={error}/>
                </div>}
                audit={<ReviewAuditTrail testId="claim-audit-trail" entries={audit}
                  empty="Nothing has been recorded for this claim yet."
                  note="What the server returned for this claim: filing, documents received and any quarantine. Earlier reviewer decisions are not returned by the queue; the status above is the latest recorded outcome."/>}/>
            </>}
            {!current&&error&&<ReviewMessages error={error}/>}
          </div>
        </ReviewWorkbenchGrid>
      )}
    </div>
  }

  return <main className="min-h-screen bg-gray-50 section-padding">
    <div className="max-w-6xl mx-auto py-10">
      {isAdministrator&&<Link to="/admin" className="text-blue-700 underline text-sm">Admin dashboard</Link>}
      <h1 className="font-bold text-3xl mt-5">Independent dealership claim review</h1>
      <Link to="/admin/dealer-research-review" className="text-sm text-blue-700 underline inline-block mt-3">Review the 104 private dealership research candidates</Link>
      <Link to="/admin/dealer-compliance-submissions" className="text-sm text-blue-700 underline inline-block mt-3 ml-4">Review submitted dealer business applications</Link>
      <Link to="/admin/dealer-full-storefront-review" className="text-sm text-blue-700 underline inline-block mt-3 ml-4">Review full dealership storefront publication</Link>
      <p className="mt-2 text-gray-600 max-w-4xl">
        Business authority is approved separately from legal compliance, operational membership,
        vehicle listings and subscription entitlements. Reviewer actions require password step-up.
        Disputed parent/branch ownership and competing claims require documented resolution.
      </p>
      {!authorized||!token ? <p className="mt-8" role="alert">
        Reviewer or administrator session required. <Link className="underline text-blue-700" to="/login">Sign in</Link>.
      </p> : (
        <div className="grid md:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)] gap-6 mt-8">
          <Card><CardContent className="p-5">
            <h2 className="font-semibold text-lg mb-3">Claim review queue</h2>
            <Button variant="outline" size="sm" onClick={()=>{void reload()}}>Refresh queue</Button>
            {queueState==='loading'&&<p className="text-gray-600 mt-4 text-sm" role="status">Loading the claim queue…</p>}
            {(queueState==='forbidden'||queueState==='expired'||queueState==='failed')&&<p className="text-red-700 mt-4 text-sm" role="alert" data-testid="claim-queue-unavailable">
              {queueMessage} This is not an empty queue.
            </p>}
            {queueState==='ready'&&claims.length===0&&<p className="text-gray-600 mt-4 text-sm">No pending/recorded claims in this queue.</p>}
            {queueState==='ready'&&claims.map(claim=><button key={claim.claim_id} type="button"
              className={`block w-full text-left mt-3 p-3 rounded-lg border ${selected===claim.claim_id?'border-blue-700 bg-blue-50':'border-gray-200'}`}
              onClick={()=>{
                // UAT-R1: re-clicking the claim that is already open must not empty its document list
                // (the loader only re-runs when the selection changes).
                if(claim.claim_id===selected)return
                setSelected(claim.claim_id);setError('');setNotice('');setPassword('')
                setPreview(null);setEvidence([]);setEvidenceId('');setDocumentConfirmed(false)
              }}>
              <strong>{claim.seed_dealer_id}</strong>
              <span className="block text-xs text-gray-600 mt-1">{claim.claim_status.replaceAll('_',' ')}</span>
              <span className="block text-xs text-gray-600 mt-1">Scope {claim.claimed_scope}</span>
            </button>)}
          </CardContent></Card>
          <div className="space-y-5">
            {current&&<>
              <Card><CardContent className="p-5 space-y-3">
                <h2 className="text-xl font-semibold">{current.seed_dealer_id}</h2>
                <p className="text-sm">Claim ID: <code className="break-all">{current.claim_id}</code></p>
                <p className="text-sm">Claimed scope: {current.claimed_scope}</p>
                <h3 className="font-semibold pt-3">Private original document evidence</h3>
                <label htmlFor="dealer-evidence-selection" className="block text-sm font-medium">Select original document</label>
                <select id="dealer-evidence-selection" className="w-full border p-2 rounded-md"
                  value={evidenceId} onChange={event=>{setEvidenceId(event.target.value);setPreview(null);setDocumentConfirmed(false)}}>
                  <option value="">No document selected</option>
                  {evidence.map(item=><option key={item.evidence_id} value={item.evidence_id} disabled={item.quarantined}>
                    {evidenceOption(item)}
                  </option>)}
                </select>
                {evidence.some(e=>e.quarantined)&&<p className="text-xs text-amber-900 bg-amber-50 rounded-md p-2" data-testid="claim-quarantined-evidence">
                  {evidence.filter(e=>e.quarantined).length} document(s) quarantined
                  ({evidence.filter(e=>e.quarantined).map(e=>(e.quarantine?.actor_kind==='CLAIMANT_WITHDRAWAL'?'withdrawn by the applicant':'quarantined by a reviewer')).join('; ')}) — they cannot support any decision.
                </p>}
                <p className="text-xs text-gray-600">
                  A clean malware scan does not establish that a certificate is genuine. Examine
                  original issuer, dates, names, branch/parent authority and possible competing claims.
                </p>
                {preview&&<div className="space-y-2">
                  {/* UAT-R1: an image is SHOWN, so a photo filed as a certificate is obvious at a glance. */}
                  {selectedEvidence?.mime_type?.startsWith('image/')&&preview.evidenceId===evidenceId&&
                    <img src={preview.url} alt={'Private original: '+(DOCUMENT_LABELS[selectedEvidence.document_class]||'document')+' as uploaded'}
                      className="max-h-80 w-auto max-w-full rounded-md border bg-white object-contain" data-testid="claim-evidence-inline-preview"/>}
                  <p className="text-sm">
                    <a href={preview.url} target="_blank" rel="noopener noreferrer"
                      className="underline text-blue-700">Open private original (expires in {preview.expires}s)</a>
                  </p>
                </div>}
                {selectedEvidence&&!selectedEvidence.quarantined&&<details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Not the document it was filed as?</summary>
                  <p className="mt-2 text-xs text-gray-600">Quarantine it so it can never support a claim, legal or activation decision.
                    It keeps its original label for the record. Uses the password below.</p>
                  <label htmlFor="claim-quarantine-reason" className="block text-sm font-medium mt-2">Why</label>
                  <select id="claim-quarantine-reason" className="w-full border p-2 rounded-md" value={quarantineReason}
                    onChange={e=>setQuarantineReason(e.target.value as QuarantineReason|'')}>
                    <option value="">Choose a reason</option>
                    {QUARANTINE_REASONS.map(([code,label])=><option key={code} value={code}>{label}</option>)}
                  </select>
                  <label htmlFor="claim-quarantine-note" className="block text-sm font-medium mt-2">Note (optional)</label>
                  <Input id="claim-quarantine-note" maxLength={1000} value={quarantineNote} onChange={e=>setQuarantineNote(e.target.value)}/>
                  <Button className={DEALER_WRAP_BUTTON+' mt-2'} variant="outline" disabled={busy||!password||!quarantineReason}
                    onClick={()=>{void quarantine()}}>Quarantine this document</Button>
                </details>}
              </CardContent></Card>
              <Card><CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-lg">Record independent determination</h3>
                <div>
                  <label htmlFor="claim-verdict" className="block text-sm font-medium mb-1">Verdict</label>
                  <select id="claim-verdict" value={verdict} className="border p-2 rounded-md w-full"
                    onChange={e=>setVerdict(e.target.value as Verdict)}>
                    <option value="CLAIM_DISPUTED">Disputed — investigate further</option>
                    <option value="CLAIM_REJECTED">Reject claimant authority</option>
                    <option value="CLAIM_APPROVED">Approve claimant authority only</option>
                    <option value="CLAIM_REVOKED">Revoke previously approved claimant authority</option>
                  </select>
                </div>
                {verdict==='CLAIM_APPROVED'&&<>
                  <div>
                    <label htmlFor="claim-issuer" className="block text-sm font-medium mb-1">Verified document issuer</label>
                    <Input id="claim-issuer" required minLength={3} value={issuer} onChange={e=>setIssuer(e.target.value)}/>
                  </div>
                  <div>
                    <label htmlFor="claim-confirmed-scope" className="block text-sm font-medium mb-1">
                      Independently confirmed legal scope
                    </label>
                    <select id="claim-confirmed-scope" className="w-full p-2 border rounded-md" value={scope}
                      onChange={e=>setScope(e.target.value as 'BRANCH'|'PARENT_ORGANIZATION')}>
                      <option value="BRANCH">Branch authority</option>
                      <option value="PARENT_ORGANIZATION">Parent organization authority</option>
                    </select>
                  </div>
                </>}
                {verdict==='CLAIM_APPROVED'&&<label htmlFor="claim-document-confirmed" className="flex items-start gap-2 text-sm">
                  <input id="claim-document-confirmed" type="checkbox" className="mt-1 shrink-0" checked={documentConfirmed}
                    disabled={!selectedOpened} onChange={e=>setDocumentConfirmed(e.target.checked)}/>
                  <span className="min-w-0">{selectedOpened
                    ?`I opened this original and it is a genuine ${DOCUMENT_LABELS[selectedEvidence?.document_class||'']||'document of the stated type'} from the issuer I entered — not a photo of premises or any other document.`
                    :'Open the selected original (“View selected original securely”) before you can confirm what it is.'}</span>
                </label>}
                <div>
                  <label htmlFor="claim-review-reason" className="block text-sm font-medium mb-1">
                    Specific independent review findings (40–3000 characters)
                  </label>
                  <textarea id="claim-review-reason" className="w-full rounded-md border p-3 min-h-32" required
                    minLength={40} maxLength={3000} value={reason}
                    onChange={e=>setReason(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="claim-reviewer-password" className="block text-sm font-medium mb-1">
                    Re-enter your own CarUp account password
                  </label>
                  <ReviewerStepUpField id="claim-reviewer-password" value={password} onChange={setPassword} username={user?.email}/>
                  <p className="mt-2 text-xs text-gray-600">
                    This one-time password challenge is for the decision or document preview only.
                    Passwordless/SSO-only reviewer accounts cannot certify through this path until
                    a separately governed step-up method is available.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button className={DEALER_WRAP_BUTTON} variant="outline" disabled={busy||!password||!evidenceId}
                    onClick={()=>{void viewOriginal()}}>View selected original securely</Button>
                  <Button className={DEALER_WRAP_BUTTON} disabled={busy||!password||reason.trim().length<40||
                    (verdict==='CLAIM_APPROVED'&&(!evidenceId||issuer.trim().length<3||!documentConfirmed))}
                    onClick={()=>{void decide()}}>Record immutable review decision</Button>
                </div>
                <p className="text-xs text-gray-600">A claim approval does not award a verification badge or enable inventory listing.</p>
              </CardContent></Card>
            </>}
            {notice&&<p role="status" className="p-4 bg-slate-100 rounded-lg">{notice}</p>}
            {error&&<p role="alert" className="p-4 border border-red-200 bg-red-50 rounded-lg text-red-700">{error}</p>}
          </div>
        </div>
      )}
    </div>
  </main>
}
