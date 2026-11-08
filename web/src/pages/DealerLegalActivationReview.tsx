import {useCallback,useEffect,useState} from 'react'
import { dealerDate, dealerDateTime } from '@/lib/dealerDates'
import { DEALER_WRAP_BUTTON } from '@/components/dealer/dealerButtonWrap'
import ReviewerStepUpField from '@/components/dealer/ReviewerStepUpField'
import { dealerReviewerErrorMessage, DEALER_REVIEWER_MESSAGES } from '@/lib/dealerReviewerErrors'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {CheckCircle2,XCircle,Building2,GitMerge,ShieldAlert} from 'lucide-react'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Policy={
  country_code:string;policy_version:string;policy_state:string;
  effective_at:string|null;expires_at:string|null;eligibility:string
}
type CaseEvidence={evidence_id:string;document_class:string;mime_type:string;file_bytes:number;uploaded_at:string;
  quarantined?:boolean;quarantine_reason?:string|null}
type LegalCase={
  submission_id:string;claim_id:string;intake_version:number;
  seed_dealer_id?:string|null;declared_legal_name?:string|null;evidence?:CaseEvidence[]
  separate_legal_reviewer_required:boolean;compliance_approved:false
}
const evidenceLabel=(e:CaseEvidence)=>`${e.document_class.replaceAll('_',' ')} · ${e.mime_type} · `+
  `${Math.max(1,Math.round(e.file_bytes/1024))} KB · uploaded ${dealerDateTime(e.uploaded_at)} · ${e.evidence_id}`
// A date picker is what a reviewer can actually use; the API still receives an explicit UTC instant.
const expiryInstant=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v+'T23:59:59.000Z':v
// UAT-R1: the same format the server enforces — never an e-mail address.
const REGISTRATION_NUMBER=/^[A-Za-z0-9][A-Za-z0-9 ./()-]{1,79}$/
type ActivationState='AWAITING_INDEPENDENT_ACTIVATION'|'ACTIVATED'|'ATTACHED_TO_EXISTING_DEALERSHIP'|'LEGAL_REVIEW_EXPIRED'
type ActivationCase={
  legal_review_id:string;submission_id:string;country_code:string;
  policy_version:string;legal_expires_at:string;
  independent_activator_required:boolean
  seed_dealer_id?:string|null;declared_legal_name?:string|null;declared_trading_name?:string|null
  approved_scope?:string|null;state?:ActivationState;attach_status?:string|null
  claimant_operates_existing_dealership?:boolean
}
type PreviewCheck={check:string;ok:boolean}
type Preview={
  state:'READY_TO_ATTACH'|'BLOCKED'|'ALREADY_ATTACHED';blocker:string|null;checks:PreviewCheck[]
  seed_dealer_id?:string;application_version?:number
  incoming?:{declared_legal_name:string;declared_trading_name:string;reviewed_registration_number:string;
    verified_issuer:string;country_code:string;approved_scope:string;legal_expires_at:string;
    branches:{source_row:number;branch_ref:string;name:string;city:string;has_gps:boolean;has_hours:boolean}[]
    declared_sections:string[]}
  target?:{organization_id:string;organization_name:string|null;primary_seed_dealer_id:string;legal_name:string|null;
    trading_name:string|null;registration_number:string|null;verified_issuer:string|null;legal_expires_at:string|null;
    existing_branch_count:number;existing_sections:string[];attached_claims:number}|null
  effects?:{branches_to_add:number;sections_to_carry:string[];sections_preserved:string[]}
}
type Reconciliation={idempotent:boolean;organization_id:string;seed_dealer_id:string;primary_seed_dealer_id?:string
  carryover?:{branches_added:number;sections_carried:string[];sections_preserved:string[]}}
const CHECK_LABELS:Record<string,string>={
  SEPARATE_INDEPENDENT_APPROVER:'You are independent of the applicant and of the legal reviewer',
  NO_REVIEWER_CONFLICT_OF_INTEREST:'No conflict of interest with either dealership',
  CLAIM_STILL_APPROVED:'The research claim is still approved',
  LEGAL_REVIEW_AND_COUNTRY_POLICY_CURRENT:'Legal review and country policy are current',
  LATEST_APPLICATION_VERSION:'The legal review is for the latest application version',
  NO_COMPETING_CLAIM_ON_THIS_RESEARCH_RECORD:'No competing claim on this research record',
  NOT_ALREADY_ITS_OWN_DEALERSHIP:'This claim is not already its own dealership',
  APPROVED_SCOPE_IS_BRANCH:'Approved scope is one branch',
  LEGAL_EVIDENCE_NOT_QUARANTINED:'The legal evidence is not quarantined',
  CLAIMANT_HAS_ONE_EXISTING_DEALERSHIP:'The applicant operates exactly one dealership',
  EXISTING_DEALERSHIP_ACTIVE_AND_CURRENT:'That dealership is active and its authority is current',
  SAME_COUNTRY_OF_REGISTRATION:'Same country of registration',
  SAME_INDEPENDENTLY_REVIEWED_REGISTRATION_NUMBER:'Same independently reviewed registration number',
  SAME_REGISTERED_LEGAL_NAME:'Same registered legal name',
  CLAIMANT_IS_THE_EXISTING_LEGAL_OWNER:'The applicant is the existing dealership’s legal owner',
}
const SECTION_LABELS:Record<string,string>={
  BUSINESS_OVERVIEW:'Business overview',BUYER_ASSURANCE:'Buyer assurance',FINANCE_TERMS:'Finance terms',
  SOURCING:'Sourcing',WARRANTY_AFTERSALES:'Warranty & aftersales',SERVICE_CAPABILITIES:'Service capabilities',
}
const sectionList=(xs?:string[])=>xs&&xs.length?xs.map(s=>SECTION_LABELS[s]||s).join(', '):'none'
const STATE_LABELS:Record<ActivationState,string>={
  AWAITING_INDEPENDENT_ACTIVATION:'awaiting activation',ACTIVATED:'activated',
  ATTACHED_TO_EXISTING_DEALERSHIP:'attached to existing dealership',LEGAL_REVIEW_EXPIRED:'legal review expired',
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
  const [documentsConfirmed,setDocumentsConfirmed]=useState(false)
  const [issuer,setIssuer]=useState('')
  const [registrationNumber,setRegistrationNumber]=useState('')
  const [scope,setScope]=useState('BRANCH')
  const [expiry,setExpiry]=useState('')
  const [reason,setReason]=useState('')
  const [activationReason,setActivationReason]=useState('')
  const [legalPassword,setLegalPassword]=useState('')
  const [finalPassword,setFinalPassword]=useState('')
  const [preview,setPreview]=useState<Preview|null>(null)
  const [previewFor,setPreviewFor]=useState('')
  const [reconcileReason,setReconcileReason]=useState('')
  const [reconcilePassword,setReconcilePassword]=useState('')
  const [reconciled,setReconciled]=useState<Reconciliation|null>(null)
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
      setError(dealerReviewerErrorMessage(problem,'Private legal review unavailable'))
    }
  },[allowed,user,token])
  useEffect(()=>{
    // Defer request-driven state to the async phase, avoiding a redundant
    // synchronous render caused by setting loading state in an effect.
    let mounted=true
    void Promise.resolve().then(()=>{if(mounted)void reload()})
    return()=>{mounted=false}
  },[reload])
  const activePolicy=policies.find(p=>p.policy_version===policyVersion)
  const selectedLegal=legalCases.find(x=>x.submission_id===submission)
  const selectedActivation=activations.find(x=>x.legal_review_id===legalReview)
  const usableEvidence=(selectedLegal?.evidence||[]).filter(e=>!e.quarantined)
  const quarantinedEvidence=(selectedLegal?.evidence||[]).filter(e=>e.quarantined)
  const registrationValid=REGISTRATION_NUMBER.test(registrationNumber.trim())
  const activationDone=selectedActivation?.state==='ACTIVATED'||selectedActivation?.state==='ATTACHED_TO_EXISTING_DEALERSHIP'
  const existingDealer=Boolean(selectedActivation?.claimant_operates_existing_dealership)&&!activationDone
  const currentPreview=previewFor===legalReview?preview:null
  async function legalDecision(){
    if(!selectedLegal||!token||!user||busy||!activePolicy||
      activePolicy.eligibility!=='REQUIRES_INDEPENDENT_CASE_REVIEW'||
      !selectedLegal.separate_legal_reviewer_required||!documentsConfirmed||!registrationValid)return
    setBusy(true);setNotice('');setError('')
    try{
      const result=await apiRequest<{review:{legal_review_id:string;tenant_activated:false}}>({
        baseUrl:API,
        path:'/admin/dealership/legal-cases/'+encodeURIComponent(submission)+'/review',
        options:{method:'POST',body:JSON.stringify({
          reviewer_password:legalPassword,country_policy_version:policyVersion,
          company_registration_evidence_id:companyEvidence.trim(),
          signatory_evidence_id:signerEvidence.trim(),
          verified_issuer:issuer.trim(),reviewed_registration_number:registrationNumber.trim(),
          approved_scope:scope,legal_expires_at:expiryInstant(expiry),
          reason:reason.trim(),documents_confirmed:documentsConfirmed,
        })},authHeaders:headers(user.id,token),
      })
      setNotice('Independent legal review recorded: '+result.review.legal_review_id+
        '. No tenant, public verified status, stock or payments were activated.')
      setReason('');setCompanyEvidence('');setSignerEvidence('');setDocumentsConfirmed(false)
      await reload()
    }catch(problem){setError(dealerReviewerErrorMessage(problem,'Legal policy or evidence refused'))}
    finally{setBusy(false);setLegalPassword('')}
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
          reviewer_password:finalPassword,activation_reason:activationReason.trim(),
        })},authHeaders:headers(user.id,token),
      })
      setNotice('Canonical activation was accepted by the independent server transaction. '+
        'Tenant '+result.activation.tenant_id+' · owner member recorded: '+
        String(result.activation.owner_membership_recorded)+
        '. Separate stock publication, public trust and commercial approvals still apply.')
      setActivationReason('');await reload()
    }catch(problem){setError(dealerReviewerErrorMessage(problem,'Canonical activation refused'))}
    finally{setBusy(false);setFinalPassword('')}
  }
  async function fetchPreview(){
    if(!user||!token)return null
    const result=await apiRequest<{preview:Preview}>({baseUrl:API,
      path:'/admin/dealership/legal-approvals/'+encodeURIComponent(legalReview)+'/reconciliation-preview',
      authHeaders:headers(user.id,token)})
    return result.preview
  }
  async function loadPreview(){
    if(!selectedActivation||busy)return
    setBusy(true);setError('');setNotice('');setReconciled(null)
    try{setPreview(await fetchPreview());setPreviewFor(legalReview)}
    catch(problem){setPreview(null);setError(dealerReviewerErrorMessage(problem,'Reconciliation preview unavailable'))}
    finally{setBusy(false)}
  }
  async function reconcile(){
    const target=currentPreview?.target?.organization_id
    if(!selectedActivation||!user||!token||busy||currentPreview?.state!=='READY_TO_ATTACH'||!target)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{reconciliation:Reconciliation}>({baseUrl:API,
        path:'/admin/dealership/legal-approvals/'+encodeURIComponent(legalReview)+'/reconcile',
        options:{method:'POST',body:JSON.stringify({reviewer_password:reconcilePassword,
          reconciliation_reason:reconcileReason.trim(),expected_organization_id:target})},
        authHeaders:headers(user.id,token)})
      setReconciled(result.reconciliation);setReconcileReason('')
      setNotice('Approved claim '+result.reconciliation.seed_dealer_id+' was attached to the existing dealership '+
        (currentPreview.target?.organization_name||target)+'. No new organization, tenant, membership, public listing or payment was created.')
      await reload()
      try{setPreview(await fetchPreview());setPreviewFor(legalReview)}catch{/* the receipt already reports the outcome */}
    }catch(problem){setError(dealerReviewerErrorMessage(problem,'Reconciliation refused'))}
    finally{setBusy(false);setReconcilePassword('')}
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
          {/* Owner UAT D1: a long policy identifier wraps instead of widening the page on a phone. */}
          {policies.map(p=><p className="rounded-lg border p-3 text-sm [overflow-wrap:anywhere]" key={p.policy_version}>
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
              value={submission} onChange={e=>{setSubmission(e.target.value);setCompanyEvidence('');setSignerEvidence('');setDocumentsConfirmed(false)}}>
              {legalCases.map(c=><option value={c.submission_id} key={c.submission_id}>
                {(c.seed_dealer_id||'Unknown seed')+' · '+(c.declared_legal_name||'No declared legal name')+
                  ' · application version '+c.intake_version+' · '+c.submission_id}
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
            {([
              ['legal-company-evidence','Company registration evidence',companyEvidence,setCompanyEvidence],
              ['legal-signatory-evidence','Independent signatory mandate evidence',signerEvidence,setSignerEvidence],
            ] as [string,string,string,(v:string)=>void][]).map(([id,label,value,setValue])=><div key={id}>
              <label htmlFor={id} className="text-sm font-semibold block">{label}</label>
              <select id={id} className="w-full rounded-lg border p-2" value={value}
                onChange={e=>{setValue(e.target.value);setDocumentsConfirmed(false)}}>
                <option value="">{usableEvidence.length
                  ?'Choose the original you inspected':'No usable private evidence is recorded for this claim'}</option>
                {usableEvidence.map(e=><option key={e.evidence_id} value={e.evidence_id}>
                  {evidenceLabel(e)}</option>)}
              </select>
            </div>)}
            {quarantinedEvidence.length>0&&<p className="text-xs text-amber-900 bg-amber-50 rounded-md p-2 [overflow-wrap:anywhere]"
              data-testid="legal-quarantined-evidence">
              {quarantinedEvidence.length} quarantined document(s) cannot be used as legal proof
              ({quarantinedEvidence.map(e=>(e.quarantine_reason||'QUARANTINED').replaceAll('_',' ').toLowerCase()).join('; ')}).
            </p>}
            <label htmlFor="legal-issuer" className="text-sm font-medium block">Verified issuing authority</label>
            <Input id="legal-issuer" name="verified_issuer" autoComplete="off" value={issuer}
              data-1p-ignore="true" data-lpignore="true" data-form-type="other"
              onChange={e=>setIssuer(e.target.value)}/>
            {/* UAT-R1 defect: a password manager autofilled the reviewer's e-mail here. A distinct name,
                autocomplete off and the step-up field's own username anchor keep credentials out of it;
                the server refuses an e-mail-shaped registration number anyway. */}
            <label htmlFor="legal-registration-number" className="text-sm font-medium block">Reviewed company registration number</label>
            <Input id="legal-registration-number" name="reviewed_company_registration_number" autoComplete="off"
              inputMode="text" spellCheck={false} autoCapitalize="characters" value={registrationNumber}
              data-1p-ignore="true" data-lpignore="true" data-form-type="other" aria-describedby="legal-registration-help"
              aria-invalid={registrationNumber.trim()!==''&&!registrationValid}
              onChange={e=>setRegistrationNumber(e.target.value)}/>
            <p id="legal-registration-help" className={'text-xs '+(registrationNumber.trim()!==''&&!registrationValid?'text-red-800':'text-gray-600')}>
              {registrationNumber.trim()!==''&&!registrationValid
                ?DEALER_REVIEWER_MESSAGES.REGISTRATION_NUMBER_FORMAT_INVALID
                :'As printed on the certificate: letters, digits, spaces and . / ( ) - only.'}
            </p>
            <label htmlFor="legal-scope" className="text-sm font-semibold block">Reviewed scope</label>
            <select id="legal-scope" className="w-full rounded-lg border p-2"
              value={scope} onChange={e=>setScope(e.target.value)}>
              <option value="BRANCH">Branch only</option>
              <option value="PARENT_ORGANIZATION">Parent organization — independently proven</option>
            </select>
            <label className="block text-sm font-medium" htmlFor="legal-expiry">
              Legal proof valid until (end of that day, UTC)
            </label>
            <Input id="legal-expiry" type="date"
              value={expiry} onChange={e=>setExpiry(e.target.value)}/>
            <label htmlFor="legal-reason" className="text-sm font-semibold block">
              Independent legal reasoning (80+ characters)
            </label>
            <textarea id="legal-reason" className="w-full border rounded-lg p-3 min-h-32"
              value={reason} maxLength={3000} onChange={e=>setReason(e.target.value)}/>
            <label className="flex items-start gap-2 text-sm" htmlFor="legal-documents-confirmed">
              <input id="legal-documents-confirmed" type="checkbox" className="mt-1 shrink-0" checked={documentsConfirmed}
                disabled={!companyEvidence||!signerEvidence} onChange={e=>setDocumentsConfirmed(e.target.checked)}/>
              <span className="min-w-0">I opened both originals in the secure claim-review workspace: the first is a company
                registration certificate from the issuer above and the second is a signatory mandate. Neither is a photo of
                premises or any other document.</span>
            </label>
            <label htmlFor="legal-password" className="text-sm font-semibold block">
              Reviewer password reauthentication
            </label>
            <ReviewerStepUpField id="legal-password" value={legalPassword} onChange={setLegalPassword} username={user?.email}/>
            <Button className={DEALER_WRAP_BUTTON} disabled={busy||!selectedLegal?.separate_legal_reviewer_required||
              activePolicy?.eligibility!=='REQUIRES_INDEPENDENT_CASE_REVIEW'||
              !companyEvidence.trim()||!signerEvidence.trim()||reason.trim().length<80||
              legalPassword.length<8||!expiry||!documentsConfirmed||!registrationValid} onClick={()=>{void legalDecision()}}>
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
              value={legalReview} onChange={e=>{setLegalReview(e.target.value);setReconciled(null)}}>
              {activations.map(a=><option key={a.legal_review_id} value={a.legal_review_id}>
                {(a.seed_dealer_id||'Unknown seed')+' · '+(a.declared_legal_name||'No declared legal name')+
                  ' · '+(a.state?STATE_LABELS[a.state]:a.country_code+' '+a.policy_version)+' · '+a.legal_review_id}
              </option>)}
            </select>
            {selectedActivation&&<p className="text-xs text-gray-600 [overflow-wrap:anywhere]">
              Legal review valid until {dealerDate(selectedActivation.legal_expires_at)}
              {selectedActivation.approved_scope?' · scope '+selectedActivation.approved_scope.toLowerCase().replaceAll('_',' '):''}
              {' · '}{selectedActivation.country_code} {selectedActivation.policy_version}
            </p>}
            {selectedActivation&&!selectedActivation.independent_activator_required&&
              <p className="text-sm text-red-800" role="alert">
                You are the original legal reviewer or applicant. A different
                final approver must operate this account.
              </p>}
            {activationDone&&<p role="status" className="text-sm rounded-md bg-slate-100 p-3">
              {selectedActivation?.state==='ACTIVATED'
                ?'This approved claim is already an active dealership.'
                :'This approved claim is already attached to the applicant’s existing dealership.'}
            </p>}
            {existingDealer&&<p role="status" className="text-sm rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-950"
              data-testid="activation-existing-dealer-notice">
              <ShieldAlert className="inline w-4 h-4 mr-1 -mt-0.5" aria-hidden="true"/>
              This applicant already operates an active CarUp dealership. CarUp never creates a second organization
              for the same owner — use “Reconcile approved claim with existing legal dealership” below.
            </p>}
            <label htmlFor="activation-reason" className="block text-sm font-semibold">
              Separate final activation reasoning (80+ characters)
            </label>
            <textarea id="activation-reason" className="w-full border rounded-lg p-3 min-h-32"
              maxLength={3000} value={activationReason} disabled={existingDealer||activationDone}
              onChange={e=>setActivationReason(e.target.value)}/>
            <label htmlFor="final-password" className="block text-sm font-semibold">
              Final approver password
            </label>
            <ReviewerStepUpField id="final-password" value={finalPassword} onChange={setFinalPassword} username={user?.email}/>
            <Button className={DEALER_WRAP_BUTTON} disabled={busy||!selectedActivation?.independent_activator_required||
              existingDealer||activationDone||activationReason.trim().length<80||finalPassword.length<8}
              onClick={()=>{void activate()}}>
              Activate canonical organization, tenant & owner membership
            </Button>
            <p className="text-xs text-gray-500">No bulk activation, payment gateway or country-policy approval exists in this workbench.</p>
          </CardContent></Card>
        </div>
        {selectedActivation&&(existingDealer||selectedActivation.state==='ATTACHED_TO_EXISTING_DEALERSHIP')&&
          <Card data-testid="dealer-reconciliation-workbench"><CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <GitMerge className="w-6 h-6 text-blue-700 shrink-0 mt-0.5" aria-hidden="true"/>
              <div className="min-w-0">
                <h2 className="font-semibold text-lg">3. Reconcile approved claim with existing legal dealership</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Attaches this approved branch claim to the applicant’s existing dealership when — and only when — both
                  independent legal reviews name the same registered company. Check the target and effects first.
                </p>
              </div>
            </div>
            <Button variant="outline" className={DEALER_WRAP_BUTTON+' hover:bg-orange-50 hover:text-orange-900'} disabled={busy} onClick={()=>{void loadPreview()}}>
              {currentPreview?'Re-check reconciliation':'Check reconciliation for this approved claim'}
            </Button>
            {currentPreview&&<div className="space-y-4" data-testid="dealer-reconciliation-preview">
              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-xl border p-4 min-w-0" aria-label="Approved claim">
                  <h3 className="font-semibold">Approved claim {currentPreview.seed_dealer_id}</h3>
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm [overflow-wrap:anywhere]">
                    <dt className="text-gray-500">Legal name</dt><dd>{currentPreview.incoming?.declared_legal_name||'—'}</dd>
                    <dt className="text-gray-500">Registration</dt><dd>{currentPreview.incoming?.reviewed_registration_number||'—'}</dd>
                    <dt className="text-gray-500">Issuer</dt><dd>{currentPreview.incoming?.verified_issuer||'—'}</dd>
                    <dt className="text-gray-500">Scope</dt><dd>{currentPreview.incoming?.approved_scope?.toLowerCase().replaceAll('_',' ')||'—'}</dd>
                    <dt className="text-gray-500">Valid until</dt><dd>{dealerDate(currentPreview.incoming?.legal_expires_at)}</dd>
                  </dl>
                  <p className="mt-3 text-sm font-medium">Branches in this application</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {(currentPreview.incoming?.branches||[]).map(b=><li key={b.source_row} className="[overflow-wrap:anywhere]">
                      {b.name||'Unnamed branch'}{b.city?' · '+b.city:''} · GPS {b.has_gps?'declared':'not given'} · hours {b.has_hours?'declared':'not given'}
                    </li>)}
                  </ul>
                </section>
                <section className="rounded-xl border p-4 min-w-0" aria-label="Existing dealership">
                  <h3 className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4" aria-hidden="true"/>
                    {currentPreview.target?'Existing dealership':'No existing dealership found'}</h3>
                  {currentPreview.target&&<dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm [overflow-wrap:anywhere]">
                    <dt className="text-gray-500">Organization</dt><dd>{currentPreview.target.organization_name||currentPreview.target.organization_id}</dd>
                    <dt className="text-gray-500">Legal name</dt><dd>{currentPreview.target.legal_name||'—'}</dd>
                    <dt className="text-gray-500">Registration</dt><dd>{currentPreview.target.registration_number||'—'}</dd>
                    <dt className="text-gray-500">Issuer</dt><dd>{currentPreview.target.verified_issuer||'—'}</dd>
                    <dt className="text-gray-500">First claim</dt><dd>{currentPreview.target.primary_seed_dealer_id}</dd>
                    <dt className="text-gray-500">Branches now</dt><dd>{currentPreview.target.existing_branch_count}</dd>
                    <dt className="text-gray-500">Valid until</dt><dd>{dealerDate(currentPreview.target.legal_expires_at)}</dd>
                  </dl>}
                </section>
              </div>
              {currentPreview.checks.length>0&&<section aria-label="Reconciliation checks">
                <h3 className="font-semibold text-sm">Checks</h3>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-sm">
                  {currentPreview.checks.map(c=><li key={c.check} className="flex items-start gap-2 min-w-0">
                    {c.ok?<CheckCircle2 className="w-4 h-4 text-green-700 shrink-0 mt-0.5" aria-label="passed"/>
                      :<XCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-label="failed"/>}
                    <span className="min-w-0">{CHECK_LABELS[c.check]||c.check.replaceAll('_',' ').toLowerCase()}</span>
                  </li>)}
                </ul>
              </section>}
              {currentPreview.state==='BLOCKED'&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 [overflow-wrap:anywhere]"
                data-testid="dealer-reconciliation-blocked" data-blocker={currentPreview.blocker||''}>
                <p className="font-semibold">Cannot be attached{currentPreview.blocker?` — ${currentPreview.blocker}`:''}</p>
                <p className="mt-1">{(currentPreview.blocker&&DEALER_REVIEWER_MESSAGES[currentPreview.blocker])||
                  'One or more checks failed. Nothing was attached.'}</p>
              </div>}
              {currentPreview.state==='ALREADY_ATTACHED'&&<p role="status" className="rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-green-900 [overflow-wrap:anywhere]"
                data-testid="dealer-reconciliation-already-attached">
                This claim is attached to {currentPreview.target?.organization_id}. Replaying the decision changes nothing.
              </p>}
              {currentPreview.state==='READY_TO_ATTACH'&&currentPreview.effects&&<div className="space-y-3">
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950" data-testid="dealer-reconciliation-effects">
                  <p className="font-semibold">What will happen</p>
                  <ul className="mt-1 list-disc pl-5 space-y-1">
                    <li>{currentPreview.effects.branches_to_add} branch(es) are added to {currentPreview.target?.organization_name||'the existing dealership'} as private, unverified branches.</li>
                    <li>Policy sections carried: {sectionList(currentPreview.effects.sections_to_carry)}.</li>
                    <li>Kept unchanged (the dealership already has them): {sectionList(currentPreview.effects.sections_preserved)}.</li>
                    <li>No new organization, tenant, membership, public listing, verified badge or payment is created.</li>
                  </ul>
                </div>
                <label htmlFor="reconcile-reason" className="block text-sm font-semibold">Reconciliation reasoning (80+ characters)</label>
                <textarea id="reconcile-reason" className="w-full border rounded-lg p-3 min-h-28" maxLength={3000}
                  value={reconcileReason} onChange={e=>setReconcileReason(e.target.value)}/>
                <label htmlFor="reconcile-password" className="block text-sm font-semibold">Reconciliation approver password</label>
                <ReviewerStepUpField id="reconcile-password" value={reconcilePassword} onChange={setReconcilePassword} username={user?.email}/>
                <Button className={DEALER_WRAP_BUTTON} disabled={busy||reconcileReason.trim().length<80||reconcilePassword.length<8}
                  onClick={()=>{void reconcile()}}>
                  Reconcile approved claim with existing legal dealership
                </Button>
              </div>}
              {reconciled&&<p role="status" className="rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-green-900 [overflow-wrap:anywhere]"
                data-testid="dealer-reconciliation-receipt">
                Attached {reconciled.seed_dealer_id} to {reconciled.organization_id}
                {reconciled.carryover?` · ${reconciled.carryover.branches_added} branch(es) added · carried: ${sectionList(reconciled.carryover.sections_carried)} · kept: ${sectionList(reconciled.carryover.sections_preserved)}`:''}
                {reconciled.idempotent?' (already attached — nothing changed)':''}.
              </p>}
            </div>}
          </CardContent></Card>}
        <Button variant="outline" onClick={()=>{void reload()}}>Refresh independent queues</Button>
      </>}
      {notice&&<p role="status" className="rounded-lg bg-slate-100 p-4">{notice}</p>}
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    </div>
  </main>
}
