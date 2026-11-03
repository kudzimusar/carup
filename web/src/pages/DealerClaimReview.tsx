import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'

type QueueClaim = {
  claim_id:string;seed_dealer_id:string;claimed_scope:string;claim_status:string;created_at:string
}
type PrivateEvidence={evidence_id:string;document_class:string;created_at:string;content_sha256:string}
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
export default function DealerClaimReview() {
  const {user,token}=useAuth()
  const authorized=Boolean(user&&['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
  const [claims,setClaims]=useState<QueueClaim[]>([])
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
  const [preview,setPreview]=useState<{url:string;expires:number}|null>(null)

  const reload=useCallback(async()=>{
    if(!authorized||!user||!token)return
    try{
      const result=await apiRequest<{claims:QueueClaim[]}>({
        baseUrl:API,path:'/admin/dealership/claims/queue',
        authHeaders:headers(token,user.id),
      })
      setClaims(result.claims||[])
      setSelected(current=>current&&result.claims.some(c=>c.claim_id===current)
        ?current:result.claims[0]?.claim_id||'')
    }catch(problem){setError(problem instanceof Error?problem.message:'Claim-review queue unavailable')}
  },[authorized,user,token])
  useEffect(()=>{void reload()},[reload])
  const current=claims.find(c=>c.claim_id===selected)
  useEffect(()=>{
    if(!selected||!user||!token||!authorized)return
    let active=true
    setPreview(null);setEvidence([]);setEvidenceId('')
    apiRequest<{evidence:PrivateEvidence[]}>({
      baseUrl:API,path:'/admin/dealership/claims/'+encodeURIComponent(selected)+'/evidence',
      authHeaders:headers(token,user.id),
    }).then(result=>{
      if(!active)return
      setEvidence(result.evidence||[])
      setEvidenceId(result.evidence?.[0]?.evidence_id||'')
    }).catch(problem=>{if(active)setError(problem instanceof Error?problem.message:'Evidence unavailable')})
    return()=>{active=false}
  },[selected,user,token,authorized])
  useEffect(()=>{if(current)setScope(current.claimed_scope==='PARENT_ORGANIZATION'?'PARENT_ORGANIZATION':'BRANCH')},
    [current?.claim_id,current?.claimed_scope])

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
      setPreview({url:result.preview.signed_url,expires:result.preview.expires_seconds})
      setNotice('Private original available temporarily. Verify the issuing authority and legal scope independently.')
    }catch(problem){setError(problem instanceof Error?problem.message:'Private evidence preview refused')}
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
      }
      const result=await apiRequest<{review:{status:string}}>({
        baseUrl:API,path:'/admin/dealership/claims/'+encodeURIComponent(current.claim_id)+'/review',
        options:{method:'POST',body:JSON.stringify(payload)},
        authHeaders:headers(token,user.id),
      })
      setNotice(`Independent claim decision recorded: ${result.review.status}. No business-compliance or tenant activation was executed.`)
      setReason('');setIssuer('')
      await reload()
    }catch(problem){setError(problem instanceof Error?problem.message:'Independent decision refused')}
    finally{setBusy(false);setPassword('')}
  }

  return <main className="min-h-screen bg-gray-50 section-padding">
    <div className="max-w-6xl mx-auto py-10">
      <Link to="/admin" className="text-blue-700 underline text-sm">Admin dashboard</Link>
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
            {claims.length===0&&<p className="text-gray-600 mt-4 text-sm">No pending/recorded claims in this queue.</p>}
            {claims.map(claim=><button key={claim.claim_id} type="button"
              className={`block w-full text-left mt-3 p-3 rounded-lg border ${selected===claim.claim_id?'border-blue-700 bg-blue-50':'border-gray-200'}`}
              onClick={()=>{setSelected(claim.claim_id);setError('');setNotice('');setPassword('')}}>
              <strong>{claim.seed_dealer_id}</strong>
              <span className="block text-xs text-gray-600 mt-1">{claim.claim_status.replaceAll('_',' ')}</span>
              <span className="block text-xs text-gray-500 mt-1">Scope {claim.claimed_scope}</span>
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
                  value={evidenceId} onChange={event=>{setEvidenceId(event.target.value);setPreview(null)}}>
                  <option value="">No document selected</option>
                  {evidence.map(item=><option key={item.evidence_id} value={item.evidence_id}>
                    {item.document_class.replaceAll('_',' ')} ({item.evidence_id.slice(0,8)})
                  </option>)}
                </select>
                <p className="text-xs text-gray-600">
                  A clean malware scan does not establish that a certificate is genuine. Examine
                  original issuer, dates, names, branch/parent authority and possible competing claims.
                </p>
                {preview&&<p className="text-sm">
                  <a href={preview.url} target="_blank" rel="noopener noreferrer"
                    className="underline text-blue-700">Open private original (expires in {preview.expires}s)</a>
                </p>}
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
                  <Input id="claim-reviewer-password" type="password" value={password}
                    autoComplete="off" onChange={e=>setPassword(e.target.value)} />
                  <p className="mt-2 text-xs text-gray-600">
                    This one-time password challenge is for the decision or document preview only.
                    Passwordless/SSO-only reviewer accounts cannot certify through this path until
                    a separately governed step-up method is available.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" disabled={busy||!password||!evidenceId}
                    onClick={()=>{void viewOriginal()}}>View selected original securely</Button>
                  <Button disabled={busy||!password||reason.trim().length<40||
                    (verdict==='CLAIM_APPROVED'&&(!evidenceId||issuer.trim().length<3))}
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
