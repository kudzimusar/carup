import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type QueueItem={seed_dealer_id:string;operating_status:string;
  independent_reviewer_required:boolean}
type Candidate={
 seed_dealer_id:string;operating_status:string;
 branches:Array<{branch_id:string;proposed_name:string;proposed_address:string;
   public_approved:false}>;
 proposed_sections:Record<string,{version:number;
   proposed_values:Record<string,string>;source:string}>;
}
type MediaQueueItem={
  media_id:string;seed_dealer_id:string;branch_id:string|null;
  mime_type:string;file_bytes:number;media_category:string;
  caption:string;alt_text:string;rights_attestation:string;
  review_status:string;created_at:string;
  independent_reviewer_required:boolean;logo_rights_approved:false;
}
type MediaPreview={
  media_id:string;seed_dealer_id:string;mime_type:string;
  media_category:string;caption:string;alt_text:string;
  rights_attestation:string;review_status:string;
  sha256:string;expires_seconds:number;signed_url:string;
  logo_rights_approved:false;
}
type MediaDecision='APPROVED_PUBLIC_DISPLAY'|'REJECTED'|'RETRACTED'
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
function headers(id:string,token:string):AuthHeaders{
 return {'x-session-token':token,'x-user-id':id}
}
/** Human maker-checker publication; empty records are NOT a valid approval. */
export default function DealerFullStorefrontReview(){
 const {user,token}=useAuth()
 const reviewer=Boolean(user&&token&&
  ['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
 const [queue,setQueue]=useState<QueueItem[]>([])
 const [mediaQueue,setMediaQueue]=useState<MediaQueueItem[]>([])
 const [selectedMediaId,setSelectedMediaId]=useState('')
 const [mediaPreview,setMediaPreview]=useState<MediaPreview|null>(null)
 const [mediaDecision,setMediaDecision]=useState<MediaDecision>('APPROVED_PUBLIC_DISPLAY')
 const [mediaReason,setMediaReason]=useState('')
 const [seed,setSeed]=useState('')
 const [candidate,setCandidate]=useState<Candidate|null>(null)
 const [password,setPassword]=useState('')
 const [reason,setReason]=useState('')
 const [approvedBranches,setApprovedBranches]=useState<string[]>([])
 const [approvedSections,setApprovedSections]=useState<string[]>([])
 const [disposition,setDisposition]=useState<'PUBLISHED_FULL'|'RETRACTED'>('PUBLISHED_FULL')
 const [busy,setBusy]=useState(false)
 const [status,setStatus]=useState('')
 const [error,setError]=useState('')
 const reload=useCallback(async()=>{
  if(!reviewer||!user||!token)return
  try{
   const [result,mediaResult]=await Promise.all([
    apiRequest<{cases:QueueItem[]}>({
     baseUrl:API,path:'/admin/dealership/full-storefronts/queue',
     authHeaders:headers(user.id,token),
    }),
    apiRequest<{items:MediaQueueItem[]}>({
     baseUrl:API,path:'/admin/dealership/storefront-media/queue',
     authHeaders:headers(user.id,token),
    }).catch(()=>({items:[] as MediaQueueItem[]})),
   ])
   setQueue(result.cases||[])
   setMediaQueue(mediaResult.items||[])
   setSeed(previous=>result.cases.some(x=>x.seed_dealer_id===previous)
    ?previous:result.cases[0]?.seed_dealer_id||'')
   setSelectedMediaId(previous=>(mediaResult.items||[]).some(m=>m.media_id===previous)
    ?previous:mediaResult.items?.[0]?.media_id||'')
  }catch(problem){
   setQueue([])
   setError(problem instanceof Error?problem.message:'Could not load independent publication queue')
  }
 },[reviewer,user,token])
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
   if(active){setCandidate(null);setApprovedBranches([]);setApprovedSections([]);setReason('')}
  })
  return()=>{active=false}
 },[seed])
 async function inspect(){
  if(!user||!token||busy||!seed||password.length<8)return
  setBusy(true);setError('');setStatus('')
  try{
   const result=await apiRequest<{candidate:Candidate}>({
    baseUrl:API,path:'/admin/dealership/full-storefronts/'+encodeURIComponent(seed)+'/preview',
    options:{method:'POST',body:JSON.stringify({reviewer_password:password})},
    authHeaders:headers(user.id,token),
   })
   setCandidate(result.candidate)
   setStatus('Private applicant content opened. Verify each branch and declared section independently before selecting it.')
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Independent review password not accepted')
  }finally{setPassword('');setBusy(false)}
 }
 async function inspectMedia(){
  if(!user||!token||busy||!selectedMediaId||password.length<8)return
  setBusy(true);setError('');setStatus('')
  try{
   const result=await apiRequest<{preview:MediaPreview}>({
    baseUrl:API,path:'/admin/dealership/storefront-media/'+encodeURIComponent(selectedMediaId)+'/preview',
    options:{method:'POST',body:JSON.stringify({reviewer_password:password})},
    authHeaders:headers(user.id,token),
   })
   setMediaPreview(result.preview)
   setStatus('Opened private storefront media preview ('+result.preview.media_id+'). Check alt text, caption and absence of OEM/brand logos before approving.')
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Storefront media preview refused')
  }finally{setPassword('');setBusy(false)}
 }
 async function recordMediaDecision(){
  if(!user||!token||busy||!selectedMediaId||password.length<8||mediaReason.trim().length<40)return
  setBusy(true);setError('');setStatus('')
  try{
   const result=await apiRequest<{review:{media_id:string;decision:string;public_display_approved:boolean}}>({
    baseUrl:API,path:'/admin/dealership/storefront-media/'+encodeURIComponent(selectedMediaId)+'/review',
    options:{method:'POST',body:JSON.stringify({
      decision:mediaDecision,
      reason:mediaReason.trim(),
      reviewer_password:password,
    })},
    authHeaders:headers(user.id,token),
   })
   setStatus('Recorded storefront media decision '+result.review.decision+' for '+result.review.media_id+'.')
   setMediaPreview(null);setMediaReason('')
   await reload()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Storefront media decision refused')
  }finally{setPassword('');setBusy(false)}
 }
 async function record(){
  if(!user||!token||busy||!seed||reason.trim().length<80||password.length<8)return
  if(disposition==='PUBLISHED_FULL'&&(!candidate||!approvedBranches.length))return
  setBusy(true);setStatus('');setError('')
  try{
   const result=await apiRequest<{review:{disposition:string;public_full_approved:boolean}}>({
    baseUrl:API,path:'/admin/dealership/full-storefronts/'+encodeURIComponent(seed)+'/review',
    options:{method:'POST',body:JSON.stringify({
      disposition,reason:reason.trim(),reviewer_password:password,
      approved_branch_ids:disposition==='RETRACTED'?[]:approvedBranches,
      approved_sections:disposition==='RETRACTED'?[]:approvedSections,
    })},authHeaders:headers(user.id,token),
   })
   setStatus(result.review.disposition==='PUBLISHED_FULL'?
    'Independent full storefront publication event recorded. Current tenant, claim and country policy must remain valid for public display.':
    'Independent full storefront retraction recorded. The previous approved display is no longer current.')
   setCandidate(null);setApprovedBranches([]);setApprovedSections([]);setReason('')
   await reload()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Publication decision refused')
  }finally{setBusy(false);setPassword('')}
 }
 const item=queue.find(x=>x.seed_dealer_id===seed)
 const currentMedia=mediaQueue.find(m=>m.media_id===selectedMediaId)
 return <main className="min-h-screen bg-slate-50 px-4 py-10">
  <div className="mx-auto max-w-6xl">
   <Link to="/admin/dealer-claims" className="text-sm text-blue-700 underline">
     Independent claim review
   </Link>
   <h1 className="font-bold text-3xl mt-5">Full dealership publication</h1>
   <p className="max-w-4xl text-slate-600 mt-2">
    This is distinct from prelisting research and legal company activation.
    Reviewed branch data and versioned dealer-declared policies are copied into an
    immutable buyer-safe display snapshot. No unlicensed logo, VIN verification,
    OEM franchise, finance-provider approval or subscription is granted.
   </p>
   {!reviewer?<p className="mt-6" role="alert">
    Sign in as a verified independent CarUp reviewer. The API enforces this separately.
   </p>:<div className="grid lg:grid-cols-[290px_minmax(0,1fr)] gap-6 mt-8">
    <Card><CardContent className="p-5 space-y-3">
     <h2 className="font-semibold">Operational approval candidates</h2>
     <Button variant="outline" size="sm" onClick={()=>{void reload()}}>Refresh queue</Button>
     {queue.length===0&&<p className="text-sm text-slate-500">
      No legal dealer activation candidates. Research-only listings do not qualify.
     </p>}
     {queue.map(x=><button key={x.seed_dealer_id} type="button"
       onClick={()=>{setSeed(x.seed_dealer_id);setError('');setStatus('')}}
       className={'text-left w-full rounded-lg border p-3 '+
        (seed===x.seed_dealer_id?'bg-blue-50 border-blue-700':'bg-white')}>
       <strong className="text-sm block">{x.seed_dealer_id}</strong>
       <span className="text-xs text-slate-500">{x.operating_status}</span>
       {!x.independent_reviewer_required&&<span className="block text-xs text-red-700">
        Self-review not permitted</span>}
     </button>)}
    </CardContent></Card>
    <Card><CardContent className="p-5 space-y-5">
     <h2 className="font-semibold text-xl">Verify selected business</h2>
     {!item?<p>No business candidate selected.</p>:<>
      <p className="text-sm">Research identity: <strong>{seed}</strong>.
       This queue contains no original private evidence, banking or identity document.</p>
      <div className="space-y-2">
       <label htmlFor="storefront-password" className="block text-sm font-medium">
        Reviewer password (required before preview and independently before decision)
       </label>
       <Input id="storefront-password" type="password"
        autoComplete="current-password" value={password}
        onChange={e=>setPassword(e.target.value)}/>
       <Button variant="outline" disabled={busy||password.length<8||
         !item.independent_reviewer_required} onClick={()=>{void inspect()}}>
        Inspect review candidate</Button>
      </div>
      {candidate&&<>
       <div className="border-t pt-4">
        <h3 className="font-semibold">Approve only verified branch display facts</h3>
        {candidate.branches.map(b=><label key={b.branch_id}
          className="flex gap-3 text-sm border rounded-lg p-3 my-2">
         <input type="checkbox" checked={approvedBranches.includes(b.branch_id)}
          onChange={e=>setApprovedBranches(prev=>e.target.checked?
            [...prev,b.branch_id]:prev.filter(v=>v!==b.branch_id))}/>
         <span><strong>{b.proposed_name}</strong>
          <span className="block text-slate-600">{b.proposed_address}</span>
          <span className="block text-xs text-slate-500">Dealer-declared; verify actual site before selecting</span>
         </span>
        </label>)}
       </div>
       <div className="border-t pt-4">
        <h3 className="font-semibold">Independently review dealer-declared sections</h3>
        {Object.entries(candidate.proposed_sections).map(([key,value])=>
         <label key={key} className="block border rounded-lg p-3 mt-2 text-sm">
          <span className="flex gap-2 items-center font-semibold">
           <input type="checkbox" checked={approvedSections.includes(key)}
            onChange={e=>setApprovedSections(prev=>e.target.checked?
              [...prev,key]:prev.filter(x=>x!==key))}/>
           {key.replaceAll('_',' ')} · version {value.version}
          </span>
          <dl className="mt-3 space-y-1">
           {Object.entries(value.proposed_values).map(([field,text])=>
            <div key={field} className="break-words">
             <dt className="font-medium text-slate-600">{field.replaceAll('_',' ')}</dt>
             <dd>{text}</dd>
            </div>)}
          </dl>
          <span className="text-xs text-slate-500">
           Explicit display approval is not a guarantee, legal opinion or payment authorization.
          </span>
         </label>)}
       </div>
      </>}
      <fieldset className="border-t pt-4 space-y-3">
       <legend className="font-semibold">Independent publication decision</legend>
       <label htmlFor="storefront-decision" className="block text-sm">Disposition</label>
       <select id="storefront-decision" value={disposition}
        onChange={e=>setDisposition(e.target.value as 'PUBLISHED_FULL'|'RETRACTED')}
        className="w-full rounded-lg border p-3">
        <option value="PUBLISHED_FULL">Publish independently approved full storefront</option>
        <option value="RETRACTED">Retract existing full storefront</option>
       </select>
       <label htmlFor="storefront-reason" className="block text-sm font-medium">
        Source, branch, legal and policy review rationale (80+ characters)
       </label>
       <textarea id="storefront-reason" value={reason} maxLength={3000}
        onChange={e=>setReason(e.target.value)}
        className="w-full rounded-lg border p-3 min-h-28"/>
       <p className="text-xs text-slate-600">
        Reenter the reviewer password above before recording. A full publication requires
        at least one independently checked, selected branch.
       </p>
       <Button disabled={busy||password.length<8||reason.trim().length<80||
        (disposition==='PUBLISHED_FULL'&&(!candidate||approvedBranches.length===0))}
         onClick={()=>{void record()}}>Record immutable publication decision</Button>
      </fieldset>
      <section className="border-t pt-5 space-y-3" data-testid="dealer-media-review-section">
       <h3 className="font-semibold">Independent storefront media gallery review</h3>
       <p className="text-xs text-slate-600">
        Review dealer-uploaded facility photographs individually. Verify descriptive accessibility
        alt text, caption accuracy, and absence of OEM or third-party brand logos.
       </p>
       {mediaQueue.length===0&&<p className="text-sm text-slate-500">
        No dealership facility media items in queue.
       </p>}
       {mediaQueue.length>0&&<>
        <label htmlFor="storefront-media-select" className="block text-sm font-medium">
         Select dealership media item
        </label>
        <select id="storefront-media-select" className="w-full rounded-lg border p-3 text-sm bg-white"
         value={selectedMediaId}
         onChange={e=>{setSelectedMediaId(e.target.value);setMediaPreview(null)}}>
         {mediaQueue.map(m=><option key={m.media_id} value={m.media_id}>
          {m.seed_dealer_id} · {m.media_category} · {m.caption} ({m.review_status})
         </option>)}
        </select>
        {currentMedia&&<div className="rounded-lg border bg-slate-50 p-3 text-sm space-y-2">
         <p><strong>Seed:</strong> {currentMedia.seed_dealer_id} · <strong>Category:</strong> {currentMedia.media_category} · <strong>Status:</strong> {currentMedia.review_status}</p>
         <p><strong>Caption:</strong> {currentMedia.caption}</p>
         <p><strong>Alt text:</strong> {currentMedia.alt_text}</p>
         <Button variant="outline" size="sm"
          disabled={busy||password.length<8||!currentMedia.independent_reviewer_required}
          onClick={()=>{void inspectMedia()}}>
          Preview private media binary
         </Button>
         {mediaPreview&&mediaPreview.media_id===currentMedia.media_id&&<figure className="mt-2 border rounded-lg bg-white p-3">
          <img src={mediaPreview.signed_url} alt={mediaPreview.alt_text}
           className="max-h-48 rounded-md object-contain"/>
          <figcaption className="text-xs text-slate-600 mt-1">
           SHA-256: {mediaPreview.sha256.slice(0,16)}… · Logo rights approved: false
          </figcaption>
         </figure>}
         <label htmlFor="storefront-media-decision" className="block text-sm font-medium">
          Media review decision
         </label>
         <select id="storefront-media-decision" className="w-full rounded-lg border p-2 bg-white"
          value={mediaDecision}
          onChange={e=>setMediaDecision(e.target.value as MediaDecision)}>
          <option value="APPROVED_PUBLIC_DISPLAY">Approve for public storefront gallery</option>
          <option value="REJECTED">Reject media item</option>
          <option value="RETRACTED">Retract previously approved media item</option>
         </select>
         <label htmlFor="storefront-media-reason" className="block text-sm font-medium">
          Media rights &amp; accessibility review rationale (40+ characters)
         </label>
         <textarea id="storefront-media-reason" value={mediaReason} maxLength={3000}
          onChange={e=>setMediaReason(e.target.value)}
          className="w-full rounded-lg border p-3 min-h-24 bg-white"/>
         <Button variant="outline"
          disabled={busy||password.length<8||mediaReason.trim().length<40||!currentMedia.independent_reviewer_required}
          onClick={()=>{void recordMediaDecision()}}>
          Record storefront media decision
         </Button>
        </div>}
       </>}
      </section>
     </>}
    </CardContent></Card>
   </div>}
   {status&&<p role="status" className="bg-blue-50 p-4 rounded-lg mt-5">{status}</p>}
   {error&&<p role="alert" className="bg-red-50 text-red-800 p-4 rounded-lg mt-5">{error}</p>}
  </div>
 </main>
}
