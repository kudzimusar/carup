import {useCallback,useEffect,useState} from 'react'
import { dealerDateTime } from '@/lib/dealerDates'
import { DEALER_WRAP_BUTTON } from '@/components/dealer/dealerButtonWrap'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

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
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Private compliance queue unavailable')
      setCases([])
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
              <Input id="case-password" type="password" autoComplete="current-password"
                value={password} onChange={e=>setPassword(e.target.value)}/>
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
              <Input id="finding-password" type="password" autoComplete="current-password"
                value={password} onChange={e=>setPassword(e.target.value)}/>
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
