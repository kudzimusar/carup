import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Candidate={
  seed_dealer_id:string;source_row:number;source_display_name:string;source_city:string
  source_category_unverified:string;grouping_status:string;source_row_sha256:string
  publication_state:string;review_revision:number;legal_business_verified:false
}
type Queue={entries:Candidate[];page:number;limit:number;total:number|null;
  real_review_required:boolean;bulk_publication_available:boolean}
type Decision='PRELISTED_UNCLAIMED'|'WITHHELD'|'SUPPRESSED'|'DUPLICATE'|'UNDER_DISPUTE'
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
const heads=(id:string,token:string):AuthHeaders=>({
  'x-session-token':token,'x-user-id':id
})
export default function DealerResearchReview(){
  const {user,token}=useAuth()
  const allowed=Boolean(user&&token&&
    ['admin','reviewer','platform_admin','super_admin'].includes(String(user.role)))
  const [queue,setQueue]=useState<Queue|null>(null)
  const [page,setPage]=useState(1)
  const [selected,setSelected]=useState('')
  const [decision,setDecision]=useState<Decision>('WITHHELD')
  const [reason,setReason]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const reload=useCallback(async()=>{
    if(!user||!token||!allowed)return
    try{
      const result=await apiRequest<Queue>({
        baseUrl:API,
        path:'/admin/dealership/research/queue?page='+page+'&limit=20',
        authHeaders:heads(user.id,token),
      })
      setQueue(result)
      setSelected(prior=>result.entries.some(e=>e.seed_dealer_id===prior)?
        prior:result.entries[0]?.seed_dealer_id||'')
      setError('')
    }catch(problem){
      setQueue(null)
      setError(problem instanceof Error?problem.message:'Source review queue unavailable')
    }
  },[allowed,user,token,page])
  useEffect(()=>{void reload()},[reload])
  const current=queue?.entries.find(e=>e.seed_dealer_id===selected)
  const minimum=decision==='PRELISTED_UNCLAIMED'?80:25
  async function record(){
    if(!user||!token||!current||busy||reason.trim().length<minimum||
      password.length<8)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await apiRequest<{review:{decision:string;revision:number;public:boolean}}>({
        baseUrl:API,path:'/admin/dealership/research/'
          +encodeURIComponent(current.seed_dealer_id)+'/review',
        options:{method:'POST',body:JSON.stringify({
          decision,reason:reason.trim(),reviewer_password:password,
        })},
        authHeaders:heads(user.id,token),
      })
      setNotice('Independent research decision: '+result.review.decision
        +' · revision '+result.review.revision+'. This does NOT verify a dealer, grant ownership or approve stock.')
      setReason('')
      await reload()
    }catch(problem){
      setError(problem instanceof Error?problem.message:'Research decision refused')
    }finally{
      setPassword('');setBusy(false)
    }
  }
  return <main className="min-h-screen bg-gray-50 section-padding">
    <div className="max-w-6xl mx-auto py-10">
      <Link to="/admin" className="text-sm text-blue-700 underline">Admin dashboard</Link>
      <h1 className="text-3xl font-bold mt-5">Dealer research eligibility review</h1>
      <p className="max-w-4xl text-gray-600 mt-2">
        Review source-backed business research individually before allowing an
        unclaimed directory entry. Source franchise labels, addresses and names
        are unverified until checked. This is not legal company approval.
      </p>
      {!allowed?<p role="alert" className="mt-6">
        Authenticated platform reviewer or administrator required.
      </p>:<div className="grid lg:grid-cols-[minmax(250px,1fr)_minmax(0,2fr)] gap-5 mt-8">
        <Card><CardContent className="p-5">
          <h2 className="text-lg font-semibold">Private source records</h2>
          <p className="text-xs text-gray-600 mt-1">
            {queue?.total??'Unknown'} imported research candidate(s) in the private queue.
            This count is not published or verified companies.
          </p>
          <Button variant="outline" size="sm" className="mt-3"
            onClick={()=>{void reload()}}>Refresh</Button>
          {queue?.entries.map(entry=><button key={entry.seed_dealer_id} type="button"
            onClick={()=>{setSelected(entry.seed_dealer_id);setError('');setNotice('')}}
            className={'text-left block w-full border rounded-lg p-3 mt-3 '+
              (selected===entry.seed_dealer_id?'border-blue-600 bg-blue-50':'border-gray-200')}>
            <strong className="block text-sm">{entry.source_display_name}</strong>
            <span className="text-xs text-gray-600 block">
              {entry.seed_dealer_id} · {entry.source_city}
            </span>
            <span className="text-xs text-amber-800 block mt-1">
              {entry.publication_state.replaceAll('_',' ')}
            </span>
          </button>)}
          {queue&&queue.entries.length===0&&<p className="text-sm mt-4 text-gray-600">
            No private research records available. No synthetic dealers are generated.
          </p>}
          <div className="flex gap-2 items-center mt-4">
            <Button size="sm" variant="outline" disabled={page<=1}
              onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</Button>
            <span className="text-xs">Page {page}</span>
            <Button size="sm" variant="outline" disabled={!queue||queue.entries.length<queue.limit}
              onClick={()=>setPage(p=>p+1)}>Next</Button>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-5 space-y-4">
          <h2 className="font-semibold text-lg">Source eligibility decision</h2>
          {!current?<p className="text-gray-600">Select a private research record.</p>:<>
            <dl className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                ['Research ID',current.seed_dealer_id],
                ['Original row',String(current.source_row)],
                ['Researched name',current.source_display_name],
                ['Researched city',current.source_city],
                ['Unverified category',current.source_category_unverified],
                ['Grouping review',current.grouping_status],
                ['Current status',current.publication_state],
                ['Review revision',String(current.review_revision)],
              ].map(([label,value])=><div key={label}>
                <dt className="text-gray-500">{label}</dt>
                <dd className="break-words font-medium">{value}</dd>
              </div>)}
            </dl>
            <p className="text-xs text-gray-600">
              Independently inspect source legitimacy, operating status, group/branch
              relationship, publicly eligible company name/city, privacy, duplicates,
              source attribution and takedown disputes before publishing.
            </p>
            <label htmlFor="source-decision" className="block text-sm font-semibold">
              Case-by-case disposition
            </label>
            <select id="source-decision" value={decision}
              onChange={e=>setDecision(e.target.value as Decision)}
              className="border rounded-lg w-full p-2">
              <option value="WITHHELD">Withhold pending verification</option>
              <option value="PRELISTED_UNCLAIMED">Publish unclaimed research (NOT verified)</option>
              <option value="SUPPRESSED">Suppress (privacy / takedown)</option>
              <option value="DUPLICATE">Mark duplicate for grouping review</option>
              <option value="UNDER_DISPUTE">Place under identity dispute</option>
            </select>
            <label htmlFor="source-reason" className="block text-sm font-semibold">
              Document source checks and rationale (minimum {minimum} characters)
            </label>
            <textarea id="source-reason" value={reason} onChange={e=>setReason(e.target.value)}
              minLength={minimum} maxLength={3000}
              className="border rounded-lg w-full p-3 min-h-32"/>
            <label htmlFor="source-reviewer-password" className="block text-sm font-semibold">
              Reenter your own reviewer password
            </label>
            <Input id="source-reviewer-password" type="password" autoComplete="current-password"
              value={password} onChange={e=>setPassword(e.target.value)}/>
            <Button disabled={busy||reason.trim().length<minimum||password.length<8}
              onClick={()=>{void record()}}>Record independent eligibility decision</Button>
            <p className="text-xs text-amber-800">
              No bulk approval. An unclaimed public research page is not a
              verified licence, authorized franchise, seller account or tenant.
            </p>
          </>}
        </CardContent></Card>
      </div>}
      {notice&&<p role="status" className="bg-slate-100 p-3 mt-5 rounded-lg">{notice}</p>}
      {error&&<p role="alert" className="bg-red-50 text-red-800 p-3 mt-5 rounded-lg">{error}</p>}
    </div>
  </main>
}
