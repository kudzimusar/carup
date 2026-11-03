import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Policy={
  country_code:string;policy_version:string;policy_state:string;
  effective_at:string|null;expires_at:string|null;eligibility:string
}
type LegalCase={
  submission_id:string;claim_id:string;intake_version:number;
  separate_legal_reviewer_required:boolean;compliance_approved:false
}
type ActivationCase={
  legal_review_id:string;submission_id:string;country_code:string;
  policy_version:string;legal_expires_at:string;
  independent_activator_required:boolean
}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
const headers=(id:string,token:string):AuthHeaders=>({'x-session-token':token,'x-user-id':id})
export default function DealerLegalActivationReview(){
  const {user,token}=useAuth()
  const allowed=Boolean(user&&token&&
    ['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
  const [policies,setPolicies]=useState<Policy[]>([])
  const [legalCases,setLegalCases]=useState<LegalCase[]>([])
  const [activations,setActivations]=useState<ActivationCase[]>([])
  const [submission,setSubmission]=useState('')
  const [legalReview,setLegalReview]=useState('')
  const [policyVersion,setPolicyVersion]=useState('')
  const [companyEvidence,setCompanyEvidence]=useState('')
  const [signerEvidence,setSignerEvidence]=useState('')
  const [issuer,setIssuer]=useState('')
  const [registrationNumber,setRegistrationNumber]=useState('')
  const [scope,setScope]=useState('BRANCH')
  const [expiry,setExpiry]=useState('')
  const [reason,setReason]=useState('')
  const [activationReason,setActivationReason]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [error,setError]=useState('')
  const reload=useCallback(async()=>{
    if(!allowed||!user||!token)return
    try{
      const auth=headers(user.id,token)
      const [p,c,a]=await Promise.all([
        apiRequest<{policies:Policy[]}>({
          baseUrl:API,path:'/admin/dealership/legal-policy/readiness',authHeaders:auth}),
        apiRequest<{cases:LegalCase[]}>({
          baseUrl:API,path:'/admin/dealership/legal-cases',authHeaders:auth}),
        apiRequest<{cases:ActivationCase[]}>({
          baseUrl:API,path:'/admin/dealership/legal-approvals/queue',authHeaders:auth}),
      ])
      setPolicies(p.policies||[]);setLegalCases(c.cases||[])
      setActivations(a.cases||[])
      setSubmission(prev=>c.cases.some(x=>x.submission_id===prev)
        ?prev:c.cases[0]?.submission_id||'')
      setLegalReview(prev=>a.cases.some(x=>x.legal_review_id===prev)
        ?prev:a.cases[0]?.legal_review_id||'')
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Private legal review unavailable')
    }
  },[allowed,user,token])
  useEffect(()=>{void reload()},[reload])
  const activePolicy=policies.find(p=>p.policy_version===policyVersion)
  const selectedLegal=legalCases.find(x=>x.submission_id===submission)
  const selectedActivation=activations.find(x=>x.legal_review_id===legalReview)
  async function legalDecision(){
    if(!selectedLegal||!token||!user||busy||!activePolicy||
      activePolicy.eligibility!=='REQUIRES_INDEPENDENT_CASE_REVIEW'||
      !selectedLegal.separate_legal_reviewer_required)return
    setBusy(true);setNotice('');setError('')
    try{
      const result=await apiRequest<{review:{legal_review_id:string;tenant_activated:false}}>({
        baseUrl:API,
        path:'/admin/dealership/legal-cases/'+encodeURIComponent(submission)+'/review',
        options:{method:'POST',body:JSON.stringify({
          reviewer_password:password,country_policy_version:policyVersion,
          company_registration_evidence_id:companyEvidence.trim(),
          signatory_evidence_id:signerEvidence.trim(),
          verified_issuer:issuer.trim(),reviewed_registration_number:registrationNumber.trim(),
          approved_scope:scope,legal_expires_at:expiry,
          reason:reason.trim(),
        })},authHeaders:headers(user.id,token),
      })
      setNotice('Independent legal review recorded: '+result.review.legal_review_id+
        '. No tenant, public verified status, stock or payments were activated.')
      setPassword('');setReason('')
      await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Legal policy or evidence refused')}
    finally{setBusy(false);setPassword('')}
  }
  async function activate(){
    if(!selectedActivation||!user||!token||busy||
      !selectedActivation.independent_activator_required)return
    setBusy(true);setNotice('');setError('')
    try{
      const result=await apiRequest<{activation:{
        idempotent:boolean;tenant_id:string;owner_membership_recorded:boolean
      }}>({
        baseUrl:API,
        path:'/admin/dealership/legal-approvals/'+encodeURIComponent(legalReview)+'/activate',
        options:{method:'POST',body:JSON.stringify({
          reviewer_password:password,activation_reason:activationReason.trim(),
        })},authHeaders:headers(user.id,token),
      })
      setNotice('Canonical activation was accepted by the independent server transaction. '+
        'Tenant '+result.activation.tenant_id+' · owner member recorded: '+
        String(result.activation.owner_membership_recorded)+
        '. Separate stock publication, public trust and commercial approvals still apply.')
      setActivationReason('');await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Canonical activation refused')}
    finally{setBusy(false);setPassword('')}
  }
  return <main className="min-h-screen bg-gray-50 section-padding">
    <div className="mx-auto max-w-6xl py-10 space-y-6">
      <Link to="/admin/dealer-compliance-submissions"
        className="text-sm text-blue-700 underline">
        Back to preliminary application reviews
      </Link>
      <header>
        <h1 className="text-3xl font-bold">Dealer legal authorization & canonical activation</h1>
        <p className="mt-3 max-w-4xl text-sm text-gray-600">
          Separate legal reviewer and final approver. Country legal policy
          must be explicitly approved independently of this application.
          No draft Zimbabwe policy, source listing, payment or claimant
          declaration can authorize activation.
        </p>
      </header>
      {!allowed?<p role="alert">A verified independent platform reviewer session is required.</p>:<>
        <Card><CardContent className="p-5 space-y-3">
          <h2 className="font-semibold text-lg">Country policy authorization</h2>
          {policies.length===0&&<p>No country policy contracts are available.</p>}
          {policies.map(p=><p className="rounded-lg border p-3 text-sm" key={p.policy_version}>
            <strong>{p.country_code} · {p.policy_version}</strong>
            <span className="block">State: {p.policy_state} · {p.eligibility.replaceAll('_',' ')}</span>
            <span className="block text-xs text-gray-600">
              This page cannot approve policy, change its effective dates or
              substitute a real legal officer's approval.
            </span>
          </p>)}
        </CardContent></Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardContent className="p-5 space-y-3">
            <h2 className="font-semibold text-lg">1. Independent legal review</h2>
            <p className="text-sm text-gray-600">
              Inspect original company registration and signatory documents in the
              separate secure claim-review workspace. A different reviewer must
              already have escalated this exact frozen application.
            </p>
            <label htmlFor="legal-case" className="text-sm font-semibold block">Frozen application case</label>
            <select id="legal-case" className="w-full rounded-lg border p-2"
              value={submission} onChange={e=>setSubmission(e.target.value)}>
              {legalCases.map(c=><option value={c.submission_id} key={c.submission_id}>
                {c.submission_id} · draft {c.intake_version}
              </option>)}
            </select>
            {selectedLegal&&!selectedLegal.separate_legal_reviewer_required&&
              <p role="alert" className="text-sm text-red-800">You reviewed this case preliminarily. A separate legal reviewer is required.</p>}
            <label htmlFor="legal-policy" className="text-sm font-semibold block">Approved country policy</label>
            <select id="legal-policy" value={policyVersion}
              onChange={e=>setPolicyVersion(e.target.value)}
              className="w-full rounded-lg border p-2">
              <option value="">Choose explicitly approved policy</option>
              {policies.map(p=><option key={p.policy_version} value={p.policy_version}
                disabled={p.eligibility!=='REQUIRES_INDEPENDENT_CASE_REVIEW'}>
                {p.country_code} {p.policy_version} · {p.policy_state}
              </option>)}
            </select>
            {[
              ['Company registration evidence ID',companyEvidence,setCompanyEvidence],
              ['Independent signatory mandate evidence ID',signerEvidence,setSignerEvidence],
              ['Verified issuing authority',issuer,setIssuer],
              ['Reviewed company registration number',registrationNumber,setRegistrationNumber],
            ].map(([label,value,setValue],i)=><label key={i} className="text-sm font-medium block">
              {String(label)}
              <Input value={value as string}
                onChange={e=>(setValue as (v:string)=>void)(e.target.value)}/>
            </label>)}
            <label htmlFor="legal-scope" className="text-sm font-semibold block">Reviewed scope</label>
            <select id="legal-scope" className="w-full rounded-lg border p-2"
              value={scope} onChange={e=>setScope(e.target.value)}>
              <option value="BRANCH">Branch only</option>
              <option value="PARENT_ORGANIZATION">Parent organization — independently proven</option>
            </select>
            <label className="block text-sm font-medium" htmlFor="legal-expiry">
              Legal proof expiry (ISO UTC timestamp)
            </label>
            <Input id="legal-expiry" placeholder="2027-01-01T00:00:00.000Z"
              value={expiry} onChange={e=>setExpiry(e.target.value)}/>
            <label htmlFor="legal-reason" className="text-sm font-semibold block">
              Independent legal reasoning (80+ characters)
            </label>
            <textarea id="legal-reason" className="w-full border rounded-lg p-3 min-h-32"
              value={reason} maxLength={3000} onChange={e=>setReason(e.target.value)}/>
            <label htmlFor="legal-password" className="text-sm font-semibold block">
              Reviewer password reauthentication
            </label>
            <Input id="legal-password" type="password" autoComplete="current-password"
              value={password} onChange={e=>setPassword(e.target.value)}/>
            <Button disabled={busy||!selectedLegal?.separate_legal_reviewer_required||
              activePolicy?.eligibility!=='REQUIRES_INDEPENDENT_CASE_REVIEW'||
              !companyEvidence.trim()||!signerEvidence.trim()||reason.trim().length<80||
              password.length<8||!expiry} onClick={()=>{void legalDecision()}}>
              Record independent legal approval (requires approved real policy)
            </Button>
          </CardContent></Card>
          <Card><CardContent className="p-5 space-y-3">
            <h2 className="font-semibold text-lg">2. Different final activation approver</h2>
            <p className="text-sm text-gray-600">
              Server checks claim ownership, approved current country policy,
              signed legal decision, separate review identities, existing organization
              collisions and tenant-member creation atomically. This action never
              grants public verified storefront, vehicle sale or paid services.
            </p>
            <label htmlFor="activation-case" className="block text-sm font-semibold">Legal approval record</label>
            <select id="activation-case" className="w-full rounded-lg border p-2"
              value={legalReview} onChange={e=>setLegalReview(e.target.value)}>
              {activations.map(a=><option key={a.legal_review_id} value={a.legal_review_id}>
                {a.legal_review_id} · {a.country_code} · {a.policy_version}
              </option>)}
            </select>
            {selectedActivation&&!selectedActivation.independent_activator_required&&
              <p className="text-sm text-red-800" role="alert">
                You are the original legal reviewer or applicant. A different
                final approver must operate this account.
              </p>}
            <label htmlFor="activation-reason" className="block text-sm font-semibold">
              Separate final activation reasoning (80+ characters)
            </label>
            <textarea id="activation-reason" className="w-full border rounded-lg p-3 min-h-32"
              maxLength={3000} value={activationReason}
              onChange={e=>setActivationReason(e.target.value)}/>
            <label htmlFor="final-password" className="block text-sm font-semibold">
              Final approver password
            </label>
            <Input id="final-password" type="password" autoComplete="current-password"
              value={password} onChange={e=>setPassword(e.target.value)}/>
            <Button disabled={busy||!selectedActivation?.independent_activator_required||
              activationReason.trim().length<80||password.length<8}
              onClick={()=>{void activate()}}>
              Activate canonical organization, tenant & owner membership
            </Button>
            <p className="text-xs text-gray-500">No bulk activation, payment gateway or country-policy approval exists in this workbench.</p>
          </CardContent></Card>
        </div>
        <Button variant="outline" onClick={()=>{void reload()}}>Refresh independent queues</Button>
      </>}
      {notice&&<p role="status" className="rounded-lg bg-slate-100 p-4">{notice}</p>}
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    </div>
  </main>
}
