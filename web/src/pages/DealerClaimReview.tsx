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
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react'

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
    const chip='inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold'
    const statusChip=(status:string)=>`${chip} ${/APPROVED/.test(status)?'bg-status-success-soft text-status-success':/REJECT|REVOK/.test(status)?'bg-status-danger-soft text-status-danger':/DISPUT/.test(status)?'bg-status-warning-soft text-status-warning':'bg-status-info-soft text-status-info'}`
    const field='w-full rounded-lg border border-carup-line bg-white p-2.5 text-sm'
    return <div className="min-w-0 pb-8" data-testid="claim-review-workbench">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Claims workbench</p>
          <h1 className="mt-1 text-xl font-bold tracking-[-0.01em] sm:text-2xl">Independent dealership claim review</h1>
        </div>
        <details className="max-w-xl text-xs text-carup-text-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-carup-text">What a claim decision does — and does not do</summary>
          <p className="mt-1 leading-5">
            Business authority is approved separately from legal compliance, operational membership,
            vehicle listings and subscription entitlements. Reviewer actions require password step-up.
            Disputed parent/branch ownership and competing claims require documented resolution.
          </p>
        </details>
      </div>
      {!authorized||!token ? <p className="mt-4" role="alert">
        Reviewer or administrator session required. <Link className="underline text-carup-action-hover" to="/login">Sign in</Link>.
      </p> : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
          {/* 1 · Queue */}
          <section aria-label="Claim queue" className={`min-w-0 lg:row-span-2 xl:row-span-1 ${mobileView==='case'?'hidden lg:block':''}`} data-testid="claim-queue">
            <div className="rounded-2xl bg-carup-bg-raised ring-1 ring-carup-line">
              <div className="flex items-center justify-between gap-2 border-b border-carup-line px-4 py-2">
                <h2 className="text-sm font-semibold">Queue{queueState==='ready'&&<span className="ml-1.5 font-normal text-carup-text-3">· {claims.length}</span>}</h2>
                <Button variant="ghost" size="sm" className="min-h-11" onClick={()=>{void reload()}}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true"/>Refresh queue
                </Button>
              </div>
              {queueState==='loading'&&<p className="px-4 py-4 text-sm text-carup-text-2" role="status">Loading the claim queue…</p>}
              {(queueState==='forbidden'||queueState==='expired'||queueState==='failed')&&<div className="px-4 py-4 text-sm text-status-danger" role="alert" data-testid="claim-queue-unavailable">
                <p>{queueMessage} This is not an empty queue.</p>
                <Button variant="outline" size="sm" className="mt-3 min-h-11" onClick={()=>{void reload()}}>Try again</Button>
              </div>}
              {queueState==='ready'&&claims.length===0&&<p className="px-4 py-4 text-sm text-carup-text-2">No pending/recorded claims in this queue.</p>}
              {queueState==='ready'&&claims.length>0&&<ul className="max-h-[70vh] divide-y divide-carup-line overflow-y-auto" aria-label="Claims">
                {claims.map(claim=>{
                  const isSelected=selected===claim.claim_id
                  return <li key={claim.claim_id}>
                    <button type="button" aria-current={isSelected?'true':undefined}
                      className={`block w-full min-h-11 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-carup-focus ${isSelected?'bg-carup-action-soft':'hover:bg-carup-bg-surface'}`}
                      onClick={()=>{
                        setMobileView('case')
                        if(claim.claim_id===selected)return
                        setSelected(claim.claim_id);setError('');setNotice('');setPassword('')
                        setPreview(null);setEvidence([]);setEvidenceId('');setDocumentConfirmed(false)
                      }}>
                      <span className="block truncate text-sm font-semibold">{claim.seed_dealer_id}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={statusChip(claim.claim_status)}>{claim.claim_status.replaceAll('_',' ')}</span>
                        <span className="text-[12px] text-carup-text-3">Scope {claim.claimed_scope.replaceAll('_',' ').toLowerCase()}</span>
                      </span>
                      <span className="mt-1 block text-[12px] text-carup-text-3">Filed {dealerDateTime(claim.created_at)}</span>
                    </button>
                  </li>
                })}
              </ul>}
            </div>
          </section>

          {/* 2 · Selected case and its evidence */}
          <section aria-label="Selected claim" className={`min-w-0 space-y-4 ${mobileView==='queue'?'hidden lg:block':''}`} data-testid="claim-case">
            <button type="button" onClick={()=>setMobileView('queue')}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-carup-text-2 lg:hidden">
              <ArrowLeft className="h-4 w-4" aria-hidden="true"/> Back to queue
            </button>
            {!current&&<p className="rounded-2xl bg-carup-bg-raised p-5 text-sm text-carup-text-2 ring-1 ring-carup-line">
              {queueState==='ready'&&claims.length===0?'There is no claim to review.':'Select a claim from the queue.'}
            </p>}
            {current&&<>
              <div className="rounded-2xl bg-carup-raw-ink p-4 text-carup-raw-paper sm:p-5" data-testid="claim-case-identity">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_srgb,var(--carup-raw-paper)_65%,transparent)]">Dealership claim</p>
                <h2 className="mt-1 break-words text-lg font-semibold sm:text-xl">{current.seed_dealer_id}</h2>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-[11px] uppercase tracking-wider text-[color-mix(in_srgb,var(--carup-raw-paper)_60%,transparent)]">Status</dt><dd className="font-medium">{current.claim_status.replaceAll('_',' ')}</dd></div>
                  <div><dt className="text-[11px] uppercase tracking-wider text-[color-mix(in_srgb,var(--carup-raw-paper)_60%,transparent)]">Claimed scope</dt><dd className="font-medium">{current.claimed_scope}</dd></div>
                  <div className="min-w-0"><dt className="text-[11px] uppercase tracking-wider text-[color-mix(in_srgb,var(--carup-raw-paper)_60%,transparent)]">Claim ID</dt><dd className="break-all font-mono text-xs">{current.claim_id}</dd></div>
                </dl>
              </div>

              <div className="rounded-2xl bg-carup-bg-raised p-4 ring-1 ring-carup-line sm:p-5 space-y-3" data-testid="claim-evidence">
                <h3 className="font-semibold">Private original document evidence</h3>
                {evidence.length===0&&<p className="text-sm text-carup-text-2">No original document is attached to this claim, or the evidence list is still loading.</p>}
                {evidence.length>0&&<ul className="grid gap-2 sm:grid-cols-2" aria-label="Documents on this claim">
                  {evidence.map(item=><li key={item.evidence_id}>
                    <button type="button" disabled={item.quarantined} aria-pressed={evidenceId===item.evidence_id}
                      onClick={()=>{setEvidenceId(item.evidence_id);setPreview(null);setDocumentConfirmed(false)}}
                      className={`flex w-full min-h-11 items-start gap-2 rounded-xl p-3 text-left text-sm ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:cursor-not-allowed disabled:opacity-60 ${evidenceId===item.evidence_id?'bg-carup-action-soft ring-carup-action':'ring-carup-line hover:ring-carup-text-3'}`}>
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true"/>
                      <span className="min-w-0">
                        <span className="block font-medium">{item.document_class.replaceAll('_',' ')}</span>
                        <span className="block text-[12px] text-carup-text-3">{[item.mime_type,item.file_bytes?Math.max(1,Math.round(item.file_bytes/1024))+' KB':null,dealerDateTime(item.created_at)].filter(Boolean).join(' · ')}</span>
                        {item.quarantined&&<span className="mt-0.5 block text-[12px] font-semibold text-status-danger">Quarantined — not usable</span>}
                      </span>
                    </button>
                  </li>)}
                </ul>}
                <div>
                  <label htmlFor="dealer-evidence-selection" className="block text-xs font-medium text-carup-text-2">Select original document</label>
                  <select id="dealer-evidence-selection" className={field+' mt-1'}
                    value={evidenceId} onChange={event=>{setEvidenceId(event.target.value);setPreview(null);setDocumentConfirmed(false)}}>
                    <option value="">No document selected</option>
                    {evidence.map(item=><option key={item.evidence_id} value={item.evidence_id} disabled={item.quarantined}>
                      {evidenceOption(item)}
                    </option>)}
                  </select>
                </div>
                {evidence.some(e=>e.quarantined)&&<p className="text-xs text-amber-900 bg-amber-50 rounded-md p-2" data-testid="claim-quarantined-evidence">
                  {evidence.filter(e=>e.quarantined).length} document(s) quarantined
                  ({evidence.filter(e=>e.quarantined).map(e=>(e.quarantine?.actor_kind==='CLAIMANT_WITHDRAWAL'?'withdrawn by the applicant':'quarantined by a reviewer')).join('; ')}) — they cannot support any decision.
                </p>}
                <div className={`flex min-h-40 items-center justify-center rounded-xl border border-dashed border-carup-line bg-carup-bg-surface p-3 ${preview?'':'text-center'}`} data-testid="claim-evidence-viewer">
                  {preview&&preview.evidenceId===evidenceId?<div className="w-full space-y-2">
                    {selectedEvidence?.mime_type?.startsWith('image/')&&
                      <img src={preview.url} alt={'Private original: '+(DOCUMENT_LABELS[selectedEvidence.document_class]||'document')+' as uploaded'}
                        className="mx-auto max-h-[28rem] w-auto max-w-full rounded-md border bg-white object-contain" data-testid="claim-evidence-inline-preview"/>}
                    <p className="text-sm">
                      <a href={preview.url} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-carup-action-hover underline">Open private original (expires in {preview.expires}s)</a>
                    </p>
                  </div>:<p className="max-w-sm text-sm text-carup-text-2">
                    {evidenceId?'Re-enter your password under Step-up and choose “View selected original securely” to open this original here.':'Select a document to examine.'}
                  </p>}
                </div>
                <p className="text-xs text-carup-text-3">
                  A clean malware scan does not establish that a certificate is genuine. Examine
                  original issuer, dates, names, branch/parent authority and possible competing claims.
                </p>
                {selectedEvidence&&!selectedEvidence.quarantined&&<details className="rounded-lg border border-carup-line p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Not the document it was filed as?</summary>
                  <p className="mt-2 text-xs text-carup-text-2">Quarantine it so it can never support a claim, legal or activation decision.
                    It keeps its original label for the record. Uses the step-up password.</p>
                  <label htmlFor="claim-quarantine-reason" className="block text-sm font-medium mt-2">Why</label>
                  <select id="claim-quarantine-reason" className={field} value={quarantineReason}
                    onChange={e=>setQuarantineReason(e.target.value as QuarantineReason|'')}>
                    <option value="">Choose a reason</option>
                    {QUARANTINE_REASONS.map(([code,label])=><option key={code} value={code}>{label}</option>)}
                  </select>
                  <label htmlFor="claim-quarantine-note" className="block text-sm font-medium mt-2">Note (optional)</label>
                  <Input id="claim-quarantine-note" maxLength={1000} value={quarantineNote} onChange={e=>setQuarantineNote(e.target.value)}/>
                  <Button className={DEALER_WRAP_BUTTON+' mt-2'} variant="outline" disabled={busy||!password||!quarantineReason}
                    onClick={()=>{void quarantine()}}>Quarantine this document</Button>
                </details>}
              </div>
            </>}
          </section>

          {/* 3 · Step-up and the consequential decision — only with a selected claim */}
          {current&&<section aria-label="Findings and decision" className={`min-w-0 space-y-4 lg:col-start-2 xl:col-start-auto xl:sticky xl:top-20 xl:self-start ${mobileView==='queue'?'hidden lg:block':''}`} data-testid="claim-decision">
            <div className="rounded-2xl bg-carup-bg-raised p-4 ring-1 ring-carup-line sm:p-5 space-y-3">
              <h3 className="font-semibold">Step-up</h3>
              <div>
                <label htmlFor="claim-reviewer-password" className="block text-sm font-medium mb-1">
                  Re-enter your own CarUp account password
                </label>
                <ReviewerStepUpField id="claim-reviewer-password" value={password} onChange={setPassword} username={user?.email}/>
                <p className="mt-2 text-xs text-carup-text-3">
                  This one-time password challenge is for the decision or document preview only.
                  Passwordless/SSO-only reviewer accounts cannot certify through this path until
                  a separately governed step-up method is available.
                </p>
              </div>
              <Button className={DEALER_WRAP_BUTTON+' w-full'} variant="outline" disabled={busy||!password||!evidenceId}
                onClick={()=>{void viewOriginal()}}>View selected original securely</Button>
            </div>
            <div className="rounded-2xl bg-carup-bg-raised p-4 ring-1 ring-carup-line sm:p-5 space-y-4">
              <h3 className="font-semibold text-lg">Record independent determination</h3>
              <div>
                <label htmlFor="claim-verdict" className="block text-sm font-medium mb-1">Verdict</label>
                <select id="claim-verdict" value={verdict} className={field}
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
                  <select id="claim-confirmed-scope" className={field} value={scope}
                    onChange={e=>setScope(e.target.value as 'BRANCH'|'PARENT_ORGANIZATION')}>
                    <option value="BRANCH">Branch authority</option>
                    <option value="PARENT_ORGANIZATION">Parent organization authority</option>
                  </select>
                </div>
                <label htmlFor="claim-document-confirmed" className="flex items-start gap-2 text-sm">
                  <input id="claim-document-confirmed" type="checkbox" className="mt-1 shrink-0" checked={documentConfirmed}
                    disabled={!selectedOpened} onChange={e=>setDocumentConfirmed(e.target.checked)}/>
                  <span className="min-w-0">{selectedOpened
                    ?`I opened this original and it is a genuine ${DOCUMENT_LABELS[selectedEvidence?.document_class||'']||'document of the stated type'} from the issuer I entered — not a photo of premises or any other document.`
                    :'Open the selected original (“View selected original securely”) before you can confirm what it is.'}</span>
                </label>
              </>}
              <div>
                <label htmlFor="claim-review-reason" className="block text-sm font-medium mb-1">
                  Specific independent review findings (40–3000 characters)
                </label>
                <textarea id="claim-review-reason" className={field+' min-h-32'} required
                  minLength={40} maxLength={3000} value={reason}
                  onChange={e=>setReason(e.target.value)} />
                <p className="mt-1 text-right text-[12px] tabular-nums text-carup-text-3">{reason.trim().length} / 40 minimum</p>
              </div>
              <Button className={DEALER_WRAP_BUTTON+' w-full'} disabled={busy||!password||reason.trim().length<40||
                (verdict==='CLAIM_APPROVED'&&(!evidenceId||issuer.trim().length<3||!documentConfirmed))}
                onClick={()=>{void decide()}}>Record immutable review decision</Button>
              <p className="text-xs text-carup-text-3">A claim approval does not award a verification badge or enable inventory listing.</p>
            </div>
            {notice&&<p role="status" className="rounded-xl bg-carup-bg-surface p-4 text-sm">{notice}</p>}
            {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
          </section>}
          {!current&&error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 lg:col-start-2">{error}</p>}
        </div>
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
