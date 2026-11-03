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
  const [draft,setDraft]=useState<Draft|null>(null)
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
  useEffect(()=>{void reload()},[reload])
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
      ])
      setEvidence(results[0].status==='fulfilled'?results[0].value.evidence||[]:[])
      setDraft(results[1].status==='fulfilled'?results[1].value.intake:null)
      setOcrCandidates(results[2].status==='fulfilled'?results[2].value.candidates||[]:[])
      setJurisdiction(results[3].status==='fulfilled'?results[3].value.preview:null)
    }catch{setEvidence([]);setDraft(null);setOcrCandidates([]);setJurisdiction(null)}
  },[selected,user,token])
  useEffect(()=>{void loadDetails()},[loadDetails])

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
                  {['AWAITING_DOCUMENTARY_EVIDENCE','CLAIM_DISPUTED','CLAIM_APPEALED'].includes(chosen.claim_status) && (
                    <Card><CardContent className="p-5 space-y-3">
                      <h2 className="font-semibold text-lg">Original business-authority evidence</h2>
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
                        <Button variant="outline" disabled={busy||manualLegalName.trim().length<2}
                          onClick={()=>{void saveManual()}}>Save manual application into CarUp</Button>
                      </section>
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
