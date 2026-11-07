import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'

type ClaimState = 'AWAITING_DOCUMENTARY_EVIDENCE' | 'CLAIM_APPROVED' |
  'CLAIM_REJECTED' | 'CLAIM_DISPUTED' | 'CLAIM_APPEALED' | 'CLAIM_REVOKED'
type ClaimItem = {
  claim_id:string;seed_dealer_id:string;claimed_scope:string;claim_status:ClaimState;created_at:string
}
type EvidenceItem = {evidence_id:string;document_class:string;created_at:string}
type OcrCandidate = {
  event_id:string;evidence_id:string;document_class:string;extraction_state:string;
  pages_processed:number;review_flags:string[];created_at:string;
  extracted_fields:Record<string,{value:string;page:number;confidence:null}>
}
type JurisdictionPreview = {
  state:string;country?:string|null;policy_version?:string|null;
  policy_status?:string;can_activate:boolean;can_publish:boolean;
  legal_review_complete:boolean;unresolved?:string[];
  requirements:Array<{requirement_key:string;label:string;reason:string;
    applicability:string;evidence_status:string;legal_source_verified:boolean}>
}

type Draft = {
  schema_version:string;submission_version:number;state:string;updated_at:string
  content:{tab_rows:Record<string,Array<Record<string,string>>>}
}
type ComplianceSubmission = {
  submission_id:string;intake_version:number;schema_version:string;
  submitted_at:string;preliminary_status:string;
  correction_reason:string|null;reviewed_at:string|null;
  legal_compliance_approved:false;tenant_activated:false;
}
type CsvPreview = {
  schema:'CARUP_DEALER_CSV_PREVIEW_1';target_tab:string;csv_sha256:string;
  input_headers:string[];input_rows:number;
  suggestions:Record<string,string>;unmapped:string[];conflicts:string[];
  allowed_targets:Array<{key:string;label:string;data_type:string;required:boolean}>;
  confirmed:false;legal_identity_verified:false;tenant_activated:false
}
const AUTHORITY_REASON_TEXT:Record<string,string>={
  SUSPENDED_BY_INDEPENDENT_REVIEW:'An independent CarUp reviewer suspended your dealership operations.',
  PERMANENTLY_WITHDRAWN:'Your dealership operations were permanently withdrawn.',
  LEGAL_REVIEW_EXPIRED:'Your independent legal review has expired.',
  DEALER_AUTHORITY_EXPIRED:'Your dealership authority period has expired.',
  COUNTRY_POLICY_NOT_CURRENT:'The country compliance policy your approval relied on is no longer current.',
  UNDER_INDEPENDENT_INVESTIGATION:'An independent investigation is open.',
  RESTRICTED_BY_INDEPENDENT_REVIEW:'An independent reviewer restricted your dealership.',
  OWNER_MEMBERSHIP_NOT_CURRENT:'Your owner membership of the dealership is no longer current.',
  TENANT_NOT_ACTIVE:'Your dealership organisation is not active.',
}
const NEXT_STEP_TEXT:Record<string,string>={
  REINSTATEMENT_BY_A_DIFFERENT_INDEPENDENT_REVIEWER:'a different independent CarUp reviewer must review and reinstate your dealership; contact CarUp compliance.',
  INDEPENDENT_TRANSFER_OR_DISPUTE_REVIEW_REQUIRED:'withdrawal is permanent for this activation. Any return needs an independent CarUp transfer or dispute review — contact CarUp compliance; a new claim on the same business is not accepted automatically.',
  SUBMIT_UPDATED_APPLICATION_FOR_RENEWAL:'submit an updated application below for renewal; it goes through preliminary review, a separate legal review and an independent renewal decision.',
  WAIT_FOR_INDEPENDENT_REVIEW_OUTCOME:'wait for the independent review outcome; CarUp compliance can explain the process.',
}
type OperationalAuthority = {
  state:string;operational:boolean;tenant_member_role?:string;
  blocking_reasons?:string[];next_step?:string;legal_expires_at?:string|null;
  public_listings_withdrawn?:boolean|null;public_listings_withdrawal_pending?:boolean|null;
  organization_id?:string;public_storefront_approved?:boolean;
  vehicle_listing_authority_granted?:boolean
}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined' ? undefined : window.location.hostname)

function authHeaders(token:string,userId:string):AuthHeaders {
  return {'x-session-token':token,'x-user-id':userId}
}
async function asDataUri(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onerror=()=>reject(new Error('Could not read the selected file'))
    reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Invalid file data'))
    reader.readAsDataURL(file)
  })
}

export default function DealerClaimWorkspace() {
  const {user,token}=useAuth()
  const [claims,setClaims]=useState<ClaimItem[]>([])
  const [selected,setSelected]=useState<string | null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [evidence,setEvidence]=useState<EvidenceItem[]>([])
  const [documentClass,setDocumentClass]=useState('COMPANY_REGISTRATION')
  const [documentFile,setDocumentFile]=useState<File|null>(null)
  const [workbookFile,setWorkbookFile]=useState<File|null>(null)
  const [csvFile,setCsvFile]=useState<File|null>(null)
  const [csvTab,setCsvTab]=useState('BUSINESS')
  const [csvPreview,setCsvPreview]=useState<CsvPreview|null>(null)
  const [csvMapping,setCsvMapping]=useState<Record<string,string|null>>({})
  const [csvAcknowledged,setCsvAcknowledged]=useState(false)
  const [operationalAuthority,setOperationalAuthority]=useState<OperationalAuthority|null>(null)

  const [draft,setDraft]=useState<Draft|null>(null)
  const [complianceSubmissions,setComplianceSubmissions]=useState<ComplianceSubmission[]>([])
  const [submitAcknowledged,setSubmitAcknowledged]=useState(false)
  const [manualSigner,setManualSigner]=useState('')
  const [manualSignerRole,setManualSignerRole]=useState('')
  const [manualPrivacy,setManualPrivacy]=useState(false)
  const [manualResearchConfirmation,setManualResearchConfirmation]=useState('UNKNOWN')
  const [ocrCandidates,setOcrCandidates]=useState<OcrCandidate[]>([])
  const [jurisdiction,setJurisdiction]=useState<JurisdictionPreview|null>(null)
  const [appealReason,setAppealReason]=useState('')
  const [manualLegalName,setManualLegalName]=useState('')
  const [manualTradingName,setManualTradingName]=useState('')
  const [manualCity,setManualCity]=useState('')
  const [manualCountry,setManualCountry]=useState('ZW')
  const [manualBranchName,setManualBranchName]=useState('')

  const reload=useCallback(async()=>{
    if(!user||!token){setLoading(false);return}
    try{
      const result=await apiRequest<{claims:ClaimItem[]}>({
        baseUrl:API,path:'/dealership/claims/mine',
        authHeaders:authHeaders(token,user.id),
      })
      setClaims(result.claims||[])
      setSelected(current=>current && result.claims.some(x=>x.claim_id===current)
        ? current : result.claims[0]?.claim_id || null)
      setError('')
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Claims unavailable')
    }finally{setLoading(false)}
  },[token,user])
  useEffect(()=>{
    // Defer request-driven state to the async phase, avoiding a redundant
    // synchronous render caused by setting loading state in an effect.
    let mounted=true
    void Promise.resolve().then(()=>{if(mounted)void reload()})
    return()=>{mounted=false}
  },[reload])
  const chosen=claims.find(c=>c.claim_id===selected)
  const loadDetails=useCallback(async()=>{
    if(!user||!token||!selected)return
    const auth=authHeaders(token,user.id)
    try{
      const results=await Promise.allSettled([
        apiRequest<{evidence:EvidenceItem[]}>({
          baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/evidence',
          authHeaders:auth,
        }),
        apiRequest<{intake:Draft}>({
          baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/intake',
          authHeaders:auth,
        }),
        apiRequest<{candidates:OcrCandidate[]}>({
          baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/ocr-candidates',
          authHeaders:auth,
        }),
        apiRequest<{preview:JurisdictionPreview}>({
          baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/jurisdiction-preview',
          authHeaders:auth,
        }),
        apiRequest<{submissions:ComplianceSubmission[]}>({
          baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/compliance-submissions',
          authHeaders:auth,
        }),
        apiRequest<{authority:OperationalAuthority}>({
          baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/operational-authority',
          authHeaders:auth,
        }),
      ])
      setEvidence(results[0].status==='fulfilled'?results[0].value.evidence||[]:[])
      setDraft(results[1].status==='fulfilled'?results[1].value.intake:null)
      setOcrCandidates(results[2].status==='fulfilled'?results[2].value.candidates||[]:[])
      setJurisdiction(results[3].status==='fulfilled'?results[3].value.preview:null)
      setComplianceSubmissions(results[4].status==='fulfilled'?results[4].value.submissions||[]:[])
      setOperationalAuthority(results[5].status==='fulfilled'?results[5].value.authority:null)
    }catch{setEvidence([]);setDraft(null);setOcrCandidates([]);setJurisdiction(null);setComplianceSubmissions([]);setOperationalAuthority(null)}
  },[selected,user,token])
  useEffect(()=>{
    let mounted=true
    void Promise.resolve().then(()=>{if(mounted)void loadDetails()})
    return()=>{mounted=false}
  },[loadDetails])

  async function uploadEvidence(){
    if(!user||!token||!selected||!documentFile||busy)return
    setError('');setNotice('');setBusy(true)
    try{
      if(documentFile.size>6*1024*1024)throw new Error('Document exceeds 6MB maximum')
      if(!['image/jpeg','image/png','application/pdf'].includes(documentFile.type))
        throw new Error('Only JPEG, PNG or PDF originals are accepted')
      const fileData=await asDataUri(documentFile)
      await apiRequest({
        baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/evidence',
        options:{method:'POST',body:JSON.stringify({
          document_class:documentClass,mime_type:documentFile.type,document:fileData,
        })},authHeaders:authHeaders(token,user.id),
      })
      setNotice('Original document stored privately. This is not proof of independent approval.')
      setDocumentFile(null)
      await loadDetails()
    }catch(problem){setError(problem instanceof Error?problem.message:'Document upload failed')}
    finally{setBusy(false)}
  }
  async function extractEvidenceCandidates(evidenceId:string){
    if(!user||!token||!selected||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{receipt:{state:string;candidate_only:boolean}}>({
        baseUrl:API,
        path:'/dealership/claims/'+encodeURIComponent(selected)
          +'/evidence/'+encodeURIComponent(evidenceId)+'/extract',
        options:{method:'POST',body:JSON.stringify({})},
        authHeaders:authHeaders(token,user.id),
      })
      setNotice('Document extraction: '+result.receipt.state.replaceAll('_',' ')
        +'. Any observed fields are only candidates for manual review; no company verification or licence was granted.')
      await loadDetails()
    }catch(problem){setError(problem instanceof Error?problem.message:'Candidate extraction failed')}
    finally{setBusy(false)}
  }

  async function downloadPrefilled(){
    if(!user||!token||!selected||busy)return
    setError('');setNotice('');setBusy(true)
    try{
      const response=await fetch(API+'/dealership/claims/'+encodeURIComponent(selected)+'/workbook',{
        method:'GET',headers:authHeaders(token,user.id) as Record<string,string>,
        cache:'no-store',credentials:'same-origin',
      })
      if(!response.ok)throw new Error('Prefilled workbook is unavailable without an approved claim')
      const blob=await response.blob()
      const href=URL.createObjectURL(blob)
      const a=document.createElement('a')
      a.href=href;a.download='carup-dealer-'+selected+'-prefilled.xlsx'
      document.body.appendChild(a);a.click();a.remove()
      window.setTimeout(()=>URL.revokeObjectURL(href),30000)
      setNotice('Download prepared. Research facts remain unverified until you confirm them.')
    }catch(problem){setError(problem instanceof Error?problem.message:'Download failed')}
    finally{setBusy(false)}
  }
  async function uploadWorkbook(){
    if(!user||!token||!selected||!workbookFile||busy)return
    setError('');setNotice('');setBusy(true)
    try{
      if(!workbookFile.name.toLowerCase().endsWith('.xlsx')||workbookFile.size>8*1024*1024)
        throw new Error('Upload one valid .xlsx file no larger than 8MB')
      const content=await asDataUri(workbookFile)
      const base64=content.split(',')[1]
      if(!base64)throw new Error('Invalid workbook upload')
      const result=await apiRequest<{receipt:{version:number,duplicate:boolean}}>({
        baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/workbook',
        options:{method:'POST',body:JSON.stringify({
          workbook_base64:base64,expected_version:draft?.submission_version||0,
        })},authHeaders:authHeaders(token,user.id),
      })
      setNotice(`Application draft saved (version ${result.receipt.version}). No compliance, tenant or inventory privileges have been granted.`)
      setWorkbookFile(null)
      await loadDetails()
    }catch(problem){setError(problem instanceof Error?problem.message:'Workbook import rejected')}
    finally{setBusy(false)}
  }

  async function previewLegacyCsv(){
    if(!selected||!token||!user||busy||!csvFile)return
    setBusy(true);setError('');setNotice('');setCsvPreview(null)
    try{
      if(!csvFile.name.toLowerCase().endsWith('.csv')||csvFile.size>2*1024*1024)
        throw new Error('Choose an UTF-8 CSV smaller than 2 MB')
      const base64=(await asDataUri(csvFile)).split(',')[1]
      const result=await apiRequest<{preview:CsvPreview}>({
        baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/csv-preview',
        options:{method:'POST',body:JSON.stringify({csv_base64:base64,target_tab:csvTab})},
        authHeaders:authHeaders(token,user.id),
      })
      setCsvPreview(result.preview)
      setCsvMapping(Object.fromEntries(result.preview.input_headers.map(header=>[
        header,result.preview.suggestions[header]||null,
      ])))
      setCsvAcknowledged(false)
      setNotice('Import preview ready. Review and confirm every column. No candidate data or privileges have been saved.')
    }catch(problem){setError(problem instanceof Error?problem.message:'CSV preview rejected')}
    finally{setBusy(false)}
  }
  async function importMappedCsv(){
    if(!selected||!token||!user||busy||!csvFile||!csvPreview||!csvAcknowledged)return
    setBusy(true);setError('');setNotice('')
    try{
      const dest=Object.values(csvMapping).filter((x):x is string=>typeof x==='string')
      if(dest.length===0||new Set(dest).size!==dest.length)
        throw new Error('Choose at least one valid, nonduplicated destination field')
      if(csvPreview.input_headers.some(x=>!Object.hasOwn(csvMapping,x)))
        throw new Error('Every CSV header requires an explicit mapping decision')
      const base64=(await asDataUri(csvFile)).split(',')[1]
      const result=await apiRequest<{receipt:{version:number;duplicate:boolean}}>({
        baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/csv-import',
        options:{method:'POST',body:JSON.stringify({
          csv_base64:base64,target_tab:csvPreview.target_tab,
          csv_sha256:csvPreview.csv_sha256,
          approved_mapping:csvMapping,acknowledge_mapping:true,
          expected_version:draft?.submission_version||0,
        })},
        authHeaders:authHeaders(token,user.id),
      })
      setNotice('CSV mapping imported into canonical 12-tab private draft version '+
        result.receipt.version+'. No legal approval or tenant privileges granted.')
      setCsvPreview(null);setCsvAcknowledged(false);setCsvFile(null)
      await loadDetails()
    }catch(problem){setError(problem instanceof Error?problem.message:'CSV import rejected')}
    finally{setBusy(false)}
  }

  async function saveManual(){
    if(!selected||!token||!user||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      if(!manualLegalName.trim())throw new Error('Enter the registered legal company name')
      const fields={
        BUSINESS:{
          legal_name:manualLegalName.trim(),
          trading_name:manualTradingName.trim(),
          operating_country:manualCountry.trim().toUpperCase(),
          research_confirmation:manualResearchConfirmation,
        },
        CONSENTS_DECLARATIONS:{
          signer_name:manualSigner.trim(),
          signer_role:manualSignerRole.trim(),
          privacy_acknowledgment:manualPrivacy?'YES':'NO',
        },
        BRANCHES:{
          ...(manualCity.trim()?{city:manualCity.trim()}:{}),
          ...(manualBranchName.trim()?{branch_name:manualBranchName.trim()}:{}),
        },
      }
      const result=await apiRequest<{receipt:{version:number}}>({
        baseUrl:API,
        path:'/dealership/claims/'+encodeURIComponent(selected)+'/manual-draft',
        options:{method:'POST',body:JSON.stringify({
          fields,expected_version:draft?.submission_version||0,
        })},
        authHeaders:authHeaders(token,user.id),
      })
      setNotice(`Manual application version ${result.receipt.version} saved for independent compliance review. No operational rights were granted.`)
      await loadDetails()
    }catch(problem){setError(problem instanceof Error?problem.message:'Manual draft rejected')}
    finally{setBusy(false)}
  }

  async function submitFrozenApplication(){
    if(!selected||!token||!user||busy||!draft||!submitAcknowledged)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{receipt:{submission_id:string;intake_version:number;state:string}}>({
        baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/compliance-submissions',
        options:{method:'POST',body:JSON.stringify({
          expected_version:draft.submission_version,
          attestation_version:'CARUP_DEALER_APPLICANT_DECLARATION_1',
          acknowledge_applicant_declaration:true,
        })},authHeaders:authHeaders(token,user.id),
      })
      setNotice('Application version '+result.receipt.intake_version
        +' submitted for independent preliminary review. No legal compliance approval, verified company badge, tenant or stock listing was granted.')
      setSubmitAcknowledged(false)
      await loadDetails()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Application submission failed')
    }finally{setBusy(false)}
  }

  async function appeal(){
    if(!selected||!token||!user||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      await apiRequest({
        baseUrl:API,path:'/dealership/claims/'+encodeURIComponent(selected)+'/appeal',
        options:{method:'POST',body:JSON.stringify({reason:appealReason})},
        authHeaders:authHeaders(token,user.id),
      })
      setNotice('Appeal recorded for separate independent review; no authority has changed.')
      await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Appeal could not be recorded')}
    finally{setBusy(false)}
  }

  return (
    <main className="min-h-screen bg-gray-50 section-padding">
      <div className="max-w-5xl mx-auto py-10">
        <Link to="/dealers" className="text-blue-700 underline text-sm">Back to dealership directory</Link>
        <h1 className="text-3xl font-bold mt-5">My dealership claim applications</h1>
        <p className="text-gray-600 mt-2 max-w-3xl">
          Claims, company verification and dealer operations are separate processes.
          Only authorized claimants may receive prefilled private workbooks.
        </p>
        {!user||!token ? (
          <p className="mt-8"><Link to="/login" className="text-blue-700 underline">Sign in</Link> to review your claims.</p>
        ) : loading ? <p className="mt-8" role="status">Loading your claim applications…</p> : (
          <div className="grid md:grid-cols-[minmax(210px,1fr)_minmax(0,2fr)] gap-6 mt-8">
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold text-lg mb-3">My research claims</h2>
                {claims.length===0 && <p className="text-sm text-gray-600">No claim requests yet. Find a published unclaimed business in the directory.</p>}
                {claims.map(c=>(
                  <button type="button" key={c.claim_id}
                    className={`w-full text-left p-3 border rounded-lg mb-3 ${selected===c.claim_id?'border-blue-600 bg-blue-50':'border-gray-200'}`}
                    onClick={()=>{setSelected(c.claim_id);setError('');setNotice('')}}>
                    <strong className="block">{c.seed_dealer_id}</strong>
                    <span className="block text-xs text-gray-600 mt-1 break-words">{c.claim_status.replaceAll('_',' ')}</span>
                    <span className="block text-xs text-gray-500">{c.claimed_scope}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
            <div className="space-y-5">
              {chosen && (
                <>
                  <Card><CardContent className="p-5">
                    <h2 className="font-semibold text-xl">Claim {chosen.seed_dealer_id}</h2>
                    <p className="mt-2 text-sm">Current status: <strong>{chosen.claim_status.replaceAll('_',' ')}</strong></p>
                    <p className="text-sm text-gray-600 mt-2">
                      A verified account email or submitted document alone does not prove company ownership.
                      An independent reviewer must inspect the original evidence and determine branch/parent scope.
                    </p>
                    <Link className="inline-block mt-3 underline text-blue-700 text-sm"
                      to={`/dealers/${chosen.seed_dealer_id.toLowerCase()}`}>View the public research profile</Link>
                  </CardContent></Card>
                  {['AWAITING_DOCUMENTARY_EVIDENCE','CLAIM_DISPUTED','CLAIM_APPEALED',
                    'CLAIM_APPROVED'].includes(chosen.claim_status) && (
                    <Card><CardContent className="p-5 space-y-3">
                      <h2 className="font-semibold text-lg">
                        {chosen.claim_status==='CLAIM_APPROVED'
                          ?'Additional original documents for separate compliance review'
                          :'Original business-authority evidence'}
                      </h2>
                      <p className="text-sm text-gray-600">
                        JPEG, PNG or PDF, maximum 6MB. Only the private CarUp evidence store is used;
                        acceptance requires a real ClamAV clean scan, with manual verification afterwards.
                      </p>
                      <label htmlFor="claim-document-class" className="text-sm font-medium block">Evidence type</label>
                      <select id="claim-document-class" className="border rounded-lg p-2 w-full" value={documentClass}
                        onChange={e=>setDocumentClass(e.target.value)}>
                        <option value="COMPANY_REGISTRATION">Company registration certificate</option>
                        <option value="DIRECTOR_AUTHORITY">Director authority</option>
                        <option value="SIGNATORY_MANDATE">Authorized representative mandate</option>
                        <option value="BRANCH_AUTHORITY">Branch operating authority</option>
                        <option value="PARENT_COMPANY_AUTHORITY">Parent legal company authority</option>
                      </select>
                      <label htmlFor="claim-document-file" className="text-sm font-medium block">Original document</label>
                      <Input id="claim-document-file" type="file" accept="image/jpeg,image/png,application/pdf"
                        onChange={e=>setDocumentFile(e.target.files?.[0]||null)} />
                      <Button disabled={busy||!documentFile} onClick={()=>{void uploadEvidence()}}>Upload private evidence</Button>
                      {evidence.length>0 && (
                        <div className="text-sm mt-3">
                          <strong>{evidence.length} private evidence record(s)</strong>
                          {evidence.map(e=><p className="mt-1" key={e.evidence_id}>
                            {e.document_class.replaceAll('_',' ')} · Submitted {new Date(e.created_at).toLocaleDateString()}
                          </p>)}
                        </div>
                      )}
                    </CardContent></Card>
                  )}
                  {evidence.length>0 && (
                    <Card><CardContent className="p-5 space-y-4">
                      <h2 className="font-semibold text-lg">Document intelligence — candidate observations</h2>
                      <p className="text-sm text-gray-600">
                        Uses a separately authorized local OCR provider only when qualified.
                        Missing tools or unreadable pages require manual review, never automatic
                        business approval. Results and originals stay private to your claim.
                      </p>
                      {evidence.map(item=><div key={item.evidence_id}
                        className="border rounded-lg p-3 flex flex-wrap gap-3 items-center justify-between">
                        <div className="text-sm">
                          <strong>{item.document_class.replaceAll('_',' ')}</strong>
                          <p className="text-xs text-gray-500">Original evidence recorded</p>
                        </div>
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={()=>{void extractEvidenceCandidates(item.evidence_id)}}>
                          Extract candidate fields
                        </Button>
                      </div>)}
                      {ocrCandidates.length===0 && <p className="text-sm text-gray-500">
                        No OCR attempts recorded. The original document still needs independent human review.
                      </p>}
                      {ocrCandidates.map(candidate=><section key={candidate.event_id}
                        className="rounded-lg border p-3 text-sm" aria-label="Unverified document candidate">
                        <strong>{candidate.document_class.replaceAll('_',' ')} ·
                          {' '}{candidate.extraction_state.replaceAll('_',' ')}</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          {candidate.pages_processed} page(s) processed · Confidence unknown · Not verified
                        </p>
                        {Object.entries(candidate.extracted_fields).map(([name,field])=><p
                          className="mt-2 break-words" key={name}>
                          <span className="font-medium">{name.replaceAll('_',' ')}:</span> {field.value}
                          <span className="text-gray-500"> (page {field.page}, unconfirmed)</span>
                        </p>)}
                        {candidate.review_flags?.length>0 && <p className="text-amber-800 mt-2">
                          Review needed: {candidate.review_flags.join(', ').replaceAll('_',' ')}
                        </p>}
                      </section>)}
                    </CardContent></Card>
                  )}
                  {chosen.claim_status==='CLAIM_APPROVED' && (
                    <Card><CardContent className="p-5 space-y-4">
                      <h2 className="font-semibold text-lg">Prefilled Excel and application</h2>
                      <p className="text-sm text-gray-600">
                        Your approved business claim allows a private prefilled workbook.
                        Research values are candidates needing your confirmation, not independently verified
                        legal facts. Complete the missing legal, branch, service and buyer-policy fields.
                      </p>
                      <Button disabled={busy} onClick={()=>{void downloadPrefilled()}}>Download my prefilled Excel workbook</Button>
                      <label htmlFor="claim-workbook-file" className="text-sm font-medium block">Completed .xlsx workbook</label>
                      <Input id="claim-workbook-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={e=>setWorkbookFile(e.target.files?.[0]||null)}/>
                      <Button disabled={busy||!workbookFile} onClick={()=>{void uploadWorkbook()}}>
                        Upload completed workbook and populate application
                      </Button>
                      <section className="border-t pt-5 space-y-3" aria-labelledby="csv-dealer-title">
                        <h3 id="csv-dealer-title" className="font-semibold text-lg">
                          Import an existing CSV with confirmed field mapping
                        </h3>
                        <p className="text-sm text-gray-600">
                          Import one business or child-record section at a time. CarUp suggests
                          recognized column mappings but never guesses legal identity, tenant
                          permissions, approvals, or verification. Unmapped columns must be
                          deliberately ignored or assigned by you.
                        </p>
                        <label htmlFor="claim-csv-target" className="block text-sm font-medium">
                          Destination application section
                        </label>
                        <select id="claim-csv-target" value={csvTab}
                          onChange={e=>{
                            setCsvTab(e.target.value);setCsvPreview(null);
                            setCsvAcknowledged(false)
                          }} className="w-full border rounded-lg p-2">
                          {['BUSINESS','BRANCHES','LICENCES_AUTHORIZATIONS',
                            'BRANDS_FRANCHISES','OPERATIONS_SOURCING','FINANCE_PAYMENTS',
                            'WORKSHOP_WARRANTY','BUYER_PROTECTION','DIGITAL_MEDIA',
                            'VEHICLE_INVENTORY_REFERENCE','CONSENTS_DECLARATIONS'].
                            map(tab=><option key={tab} value={tab}>{tab.replaceAll('_',' ')}</option>)}
                        </select>
                        <label htmlFor="claim-csv-file" className="block text-sm font-medium">
                          Existing UTF-8 CSV file (2MB max)
                        </label>
                        <Input id="claim-csv-file" type="file" accept=".csv,text/csv"
                          onChange={e=>{setCsvFile(e.target.files?.[0]||null);
                            setCsvPreview(null);setCsvAcknowledged(false)}}/>
                        <Button variant="outline" disabled={busy||!csvFile}
                          onClick={()=>{void previewLegacyCsv()}}>Preview CSV mappings without saving</Button>
                        {csvPreview && <div className="space-y-3 border rounded-xl p-4">
                          <p className="text-sm font-semibold">
                            {csvPreview.input_rows} candidate record(s) ·
                            {' '}{csvPreview.input_headers.length} source column(s)
                          </p>
                          <p className="text-xs text-gray-600 break-all">
                            Source SHA-256: {csvPreview.csv_sha256}. A changed
                            file must be previewed again. No automatic mapping is approved.
                          </p>
                          {csvPreview.conflicts.length>0 && <p role="alert" className="text-sm text-amber-800">
                            Mapping conflicts: {csvPreview.conflicts.join('; ')}
                          </p>}
                          {csvPreview.input_headers.map(header=><div key={header}>
                            <label className="block text-sm font-medium"
                              htmlFor={'csv-map-'+csvPreview.input_headers.indexOf(header)}>
                              CSV column: {header}
                            </label>
                            <select id={'csv-map-'+csvPreview.input_headers.indexOf(header)}
                              value={csvMapping[header]??''}
                              onChange={e=>{
                                setCsvMapping(old=>({...old,[header]:e.target.value||null}));
                                setCsvAcknowledged(false)
                              }} className="w-full rounded-lg border p-2">
                              <option value="">Ignore this source column</option>
                              {csvPreview.allowed_targets.map(field=><option
                                key={field.key} value={field.key}>
                                {field.label} ({field.key})
                              </option>)}
                            </select>
                          </div>)}
                          <label className="flex items-start gap-2 text-sm">
                            <input type="checkbox" checked={csvAcknowledged}
                              onChange={e=>setCsvAcknowledged(e.target.checked)}/>
                            I reviewed every source column, confirm the mapping and understand
                            these imported values are unverified candidate declarations
                            requiring independent review.
                          </label>
                          <Button disabled={busy||!csvAcknowledged}
                            onClick={()=>{void importMappedCsv()}}>
                            Confirm mapped CSV and save the private application draft
                          </Button>
                        </div>}
                      </section>
                      <section className="border-t pt-5 space-y-3" aria-labelledby="manual-dealer-title">
                        <h3 id="manual-dealer-title" className="font-semibold text-lg">Or enter your application manually</h3>
                        <p className="text-xs text-gray-600">
                          This alternative uses the same versioned 12-tab field registry and
                          import validation. Any researched branch/city values not changed here
                          are preserved as unverified candidates, not asserted approvals.
                        </p>
                        <label htmlFor="manual-legal-name" className="block text-sm font-medium">Registered legal company name</label>
                        <Input id="manual-legal-name" required maxLength={180} value={manualLegalName}
                          onChange={e=>setManualLegalName(e.target.value)}
                          placeholder={draft?.content.tab_rows.BUSINESS?.[0]?.legal_name || 'Legal name shown on incorporation evidence'}/>
                        <label htmlFor="manual-trading-name" className="block text-sm font-medium">Trading name (if different)</label>
                        <Input id="manual-trading-name" value={manualTradingName} maxLength={180}
                          onChange={e=>setManualTradingName(e.target.value)}/>
                        <label htmlFor="manual-country" className="block text-sm font-medium">Operating country (ISO two-letter code)</label>
                        <Input id="manual-country" value={manualCountry} maxLength={2}
                          onChange={e=>setManualCountry(e.target.value)}/>
                        <label htmlFor="manual-city" className="block text-sm font-medium">Correct city (leave blank to preserve researched candidate)</label>
                        <Input id="manual-city" value={manualCity} maxLength={180}
                          onChange={e=>setManualCity(e.target.value)}/>
                        <label htmlFor="manual-branch" className="block text-sm font-medium">Branch name (optional)</label>
                        <Input id="manual-branch" value={manualBranchName} maxLength={180}
                          onChange={e=>setManualBranchName(e.target.value)}/>
                        <label htmlFor="manual-research-confirm" className="block text-sm font-medium">
                          Confirm researched business identity and branch facts
                        </label>
                        <select id="manual-research-confirm" value={manualResearchConfirmation}
                          onChange={e=>setManualResearchConfirmation(e.target.value)}
                          className="border rounded-lg p-2 w-full">
                          <option value="UNKNOWN">Not yet confirmed</option>
                          <option value="YES">Confirmed as currently correct</option>
                          <option value="CORRECT">I supplied corrections</option>
                        </select>
                        <label htmlFor="manual-signer" className="block text-sm font-medium">
                          Name of proposed authorized company signatory
                        </label>
                        <Input id="manual-signer" value={manualSigner} maxLength={180}
                          onChange={e=>setManualSigner(e.target.value)}/>
                        <label htmlFor="manual-signer-role" className="block text-sm font-medium">
                          Proposed signatory role (independent authority proof is still required)
                        </label>
                        <Input id="manual-signer-role" value={manualSignerRole} maxLength={180}
                          onChange={e=>setManualSignerRole(e.target.value)}/>
                        <label className="flex gap-2 items-start text-sm">
                          <input type="checkbox" checked={manualPrivacy}
                            onChange={e=>setManualPrivacy(e.target.checked)}/>
                          I acknowledge CarUp will handle my private application data for
                          dealership eligibility review. This is not proof that the named
                          signatory has independently verified authority.
                        </label>
                        <Button variant="outline" disabled={busy||manualLegalName.trim().length<2}
                          onClick={()=>{void saveManual()}}>Save manual application into CarUp</Button>
                      </section>
                      {operationalAuthority && <section className="border-t pt-4 space-y-2 text-sm">
                        <h3 className="font-semibold">Operational dealership authority</h3>
                        <p className={operationalAuthority.operational?'text-green-800':'text-amber-800'}>
                          {operationalAuthority.state.replaceAll('_',' ')}
                        </p>
                        <p className="text-gray-600">
                          Claim approval alone never grants stock listing, finance entitlement or
                          a public verified badge. Every operation requires canonical tenant
                          membership and live country-compliance policy.
                        </p>
                        {!operationalAuthority.operational&&(operationalAuthority.blocking_reasons||[]).length>0&&
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1"
                            data-testid="dealer-authority-status">
                            <p className="font-medium">Why your dealership cannot operate right now:</p>
                            <ul className="list-disc pl-5">
                              {(operationalAuthority.blocking_reasons||[]).map(r=><li key={r}>
                                {AUTHORITY_REASON_TEXT[r]||r.replaceAll('_',' ').toLowerCase()}</li>)}
                            </ul>
                            {operationalAuthority.public_listings_withdrawn===true&&<p>
                              Your vehicles are not public while this applies. Nothing is republished automatically.</p>}
                            {operationalAuthority.public_listings_withdrawal_pending===true&&<p>
                              Your remaining public listings are being withdrawn automatically (normally within minutes).
                              Nothing is republished automatically.</p>}
                            {operationalAuthority.next_step&&<p className="font-medium">
                              Next step: {NEXT_STEP_TEXT[operationalAuthority.next_step]||operationalAuthority.next_step}</p>}
                          </div>}
                        {operationalAuthority.operational&&<Link to="/dealer/dashboard"
                          className="inline-block text-blue-700 underline">
                          Open my authorized dealer workspace
                        </Link>}
                      </section>}
                      {jurisdiction && (
                        <section className="border-t pt-5 space-y-3" aria-labelledby="jurisdiction-preview-title">
                          <h3 id="jurisdiction-preview-title" className="font-semibold text-lg">
                            Jurisdiction and compliance applicability
                          </h3>
                          <p className="text-sm text-gray-700">
                            {jurisdiction.state.replaceAll('_',' ')} ·
                            {' '}{jurisdiction.country||'Country not declared'} ·
                            {' '}No legal approval or operating rights have been granted.
                          </p>
                          {jurisdiction.policy_status && <p className="text-xs text-amber-800">
                            {jurisdiction.policy_status.replaceAll('_',' ')}
                          </p>}
                          {jurisdiction.requirements.map(item=><div key={item.requirement_key}
                            className="rounded-lg border p-3 text-sm">
                            <strong>{item.label}</strong>
                            <p className="text-gray-600 mt-1">{item.reason}</p>
                            <p className="text-xs text-amber-800 mt-1">
                              Applicability requires human determination · Evidence not verified
                            </p>
                          </div>)}
                          {jurisdiction.unresolved?.map(item=><p key={item}
                            className="text-xs text-gray-600">{item}</p>)}
                        </section>
                      )}
                      {draft && <section className="border-t pt-5 space-y-3">
                        <h3 className="font-semibold text-lg">Submit version {draft.submission_version} for preliminary review</h3>
                        <p className="text-sm text-gray-600">
                          The entire current 12-tab application, corrections, source version and
                          consent fields will be frozen as a private review snapshot. Ensure
                          that researched facts are confirmed, at least one branch is recorded,
                          original company-authority evidence exists, and your signer and
                          privacy acknowledgement are present in the saved workbook.
                        </p>
                        <label className="flex gap-2 items-start text-sm">
                          <input type="checkbox" checked={submitAcknowledged}
                            onChange={e=>setSubmitAcknowledged(e.target.checked)}/>
                          I declare that I have reviewed the submitted business and branch details
                          and authorize CarUp to send this applicant declaration for
                          independent preliminary review. This does not constitute company
                          ownership verification, regulatory approval or a legal electronic signature.
                        </label>
                        <Button disabled={busy||!submitAcknowledged}
                          onClick={()=>{void submitFrozenApplication()}}>
                          Submit frozen application for independent review
                        </Button>
                      </section>}
                      {complianceSubmissions.length>0 && <section className="border-t pt-5 space-y-3">
                        <h3 className="font-semibold text-lg">Application review history</h3>
                        {complianceSubmissions.map(item=><div key={item.submission_id}
                          className="border rounded-lg p-3 text-sm">
                          <p className="font-semibold">
                            Version {item.intake_version} · {item.preliminary_status.replaceAll('_',' ')}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Submitted {new Date(item.submitted_at).toLocaleString()}
                          </p>
                          {item.correction_reason&&<p className="mt-2 text-amber-800">
                            Required action: {item.correction_reason}
                          </p>}
                          <p className="text-xs text-gray-600 mt-2">
                            Preliminary review only — legal compliance and dealer operations not approved.
                          </p>
                        </div>)}
                      </section>}
                      {draft && (
                        <section className="border-t pt-3 text-sm">
                          <h3 className="font-semibold">Saved application version {draft.submission_version}</h3>
                          <p className="text-gray-600">State: {draft.state.replaceAll('_',' ')}</p>
                          <p className="text-gray-600">Saved: {new Date(draft.updated_at).toLocaleString()}</p>
                          <ul className="list-disc pl-5 mt-2">
                            {Object.entries(draft.content.tab_rows).filter(([name])=>name!=='README - Instructions')
                              .map(([name,rows])=><li key={name}>{name.replaceAll('_',' ')}: {rows.length} row(s)</li>)}
                          </ul>
                        </section>
                      )}
                    </CardContent></Card>
                  )}
                  {['CLAIM_REJECTED','CLAIM_DISPUTED','CLAIM_REVOKED'].includes(chosen.claim_status) && (
                    <Card><CardContent className="p-5 space-y-3">
                      <h2 className="font-semibold text-lg">Appeal the claim decision</h2>
                      <label htmlFor="claim-appeal-reason" className="text-sm font-medium block">
                        Explain the contested decision and new evidence (at least 40 characters)
                      </label>
                      <textarea id="claim-appeal-reason" className="w-full border p-3 rounded-lg min-h-28"
                        minLength={40} maxLength={3000} value={appealReason}
                        onChange={e=>setAppealReason(e.target.value)}/>
                      <Button disabled={busy||appealReason.trim().length<40} onClick={()=>{void appeal()}}>Submit appeal for review</Button>
                    </CardContent></Card>
                  )}
                </>
              )}
              {notice && <p role="status" className="p-4 bg-slate-100 text-slate-900 rounded-lg">{notice}</p>}
              {error && <p role="alert" className="p-4 border border-red-200 bg-red-50 text-red-800 rounded-lg">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
