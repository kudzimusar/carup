import {useEffect,useState} from 'react'
import { dealerDateTime } from '@/lib/dealerDates'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Lead={
  inquiry_id:string;vin:string|null;inquiry_type:string|null;
  status:string;source_channel:string|null;created_at:string;
  customer_contact_available:boolean;contact_name:string|null;
  contact_email:string|null;contact_phone:string|null;message:string|null;
  risk_state:'SELLER_SAFE_READ_ONLY';
  buyer_transaction_verified:false;payment_authority_granted:false;
  allowed_followup_status:'contacted'|'qualified'|null;
  seller_followup_self_reported_only:true;
}
type Inbox={
  tenant_id:string;entries:Lead[];returned_visible_count:number;
  canonical_rows_read:number;total_available:null;
  data_scope:'FIRST_100_SCOPED_MARKETPLACE_INQUIRIES';
  no_invented_leads_or_sales:true;
}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
const hdr=(id:string,token:string):AuthHeaders=>({
  'x-session-token':token,'x-user-id':id,
})
export default function DealerTenantInquiries(){
  const {user,token}=useAuth()
  const [data,setData]=useState<Inbox|null>(null)
  const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [refresh,setRefresh]=useState(0)
  const [search,setSearch]=useState('')
  const [updatingId,setUpdatingId]=useState<string|null>(null)
  const [actionNotice,setActionNotice]=useState('')
  const [actionError,setActionError]=useState('')
  useEffect(()=>{
    let active=true
    if(!user||!token){
      void Promise.resolve().then(()=>{
        if(active){setStatus('unavailable');setData(null)}
      })
      return()=>{active=false}
    }
    void Promise.resolve().then(()=>{
      if(active){setStatus('loading');setData(null)}
    })
    apiRequest<{inquiries:Inbox}>({
      baseUrl:API,path:'/dealer/operational-inquiries',
      authHeaders:hdr(user.id,token),
    }).then(result=>{
      if(!active)return
      setData(result.inquiries);setStatus('ready')
    }).catch(()=>{
      if(!active)return
      setData(null);setStatus('unavailable')
    })
    return()=>{active=false}
  },[user,token,refresh])
  async function recordDealerFollowup(item:Lead){
    if(!user||!token||!item.allowed_followup_status||updatingId)return
    setUpdatingId(item.inquiry_id);setActionNotice('');setActionError('')
    try{
      const result=await apiRequest<{receipt:{
        inquiry_id:string;status:string;seller_reported_only:true;
        buyer_contact_delivery_verified:false;payment_or_transaction_status_modified:false;
      }}>({
        baseUrl:API,
        path:'/dealer/operational-inquiries/'+encodeURIComponent(item.inquiry_id)+'/follow-up',
        options:{method:'PATCH',body:JSON.stringify({
          next_status:item.allowed_followup_status,
        })},
        authHeaders:hdr(user.id,token),
      })
      if(result.receipt.inquiry_id!==item.inquiry_id||
         result.receipt.status!==item.allowed_followup_status||
         !result.receipt.seller_reported_only||
         result.receipt.payment_or_transaction_status_modified!==false)
        throw Error('Canonical follow-up receipt could not be confirmed')
      setActionNotice('Dealer-reported follow-up saved to the canonical Marketplace inquiry. No message or sale has been recorded by this action.')
      setRefresh(n=>n+1)
    }catch(problem){
      setActionError(problem instanceof Error?problem.message:'Dealer follow-up was not saved')
    }finally{setUpdatingId(null)}
  }
  const filtered=(data?.entries||[]).filter(row=>{
    const needle=search.trim().toLocaleLowerCase()
    return [row.vin,row.inquiry_type,row.status,row.contact_name].
      filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)
  })
  return <main className="min-h-screen bg-slate-50 py-10 px-4">
    <div className="max-w-6xl mx-auto">
      <Link to="/dealer" className="text-blue-700 underline text-sm">
        Back to dealership dashboard
      </Link>
      <div className="mt-5 flex gap-4 flex-wrap items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Marketplace buyer enquiries</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Genuine recorded CarUp Marketplace enquiries for your verified active
            dealership tenant. This is not a fabricated sales pipeline, measured
            revenue, transaction completion or permission to contact a flagged buyer.
          </p>
        </div>
        <Button variant="outline" onClick={()=>setRefresh(n=>n+1)}>Refresh enquiries</Button>
      </div>
      {status==='loading'&&<p role="status" className="mt-7">
        Verifying legal dealer membership and loading actual Marketplace enquiry records…
      </p>}
      {status==='unavailable'&&<p role="alert"
        className="rounded-lg border border-amber-200 bg-amber-50 mt-7 p-5">
        Canonical tenant enquiry access is unavailable. This is not proof that
        your dealership has no customers or enquiries.
      </p>}
      {actionNotice&&<p role="status" className="mt-5 border rounded-lg bg-blue-50 text-blue-900 p-4">
        {actionNotice}
      </p>}
      {actionError&&<p role="alert" className="mt-5 border rounded-lg bg-red-50 text-red-900 p-4">
        {actionError}
      </p>}
      {status==='ready'&&data&&<>
        <div className="mt-7 flex flex-wrap gap-5 items-end">
          <div>
            <p className="text-sm text-slate-600">Visible enquiries in current scoped page</p>
            <strong className="text-2xl">{data.returned_visible_count}</strong>
            <p className="text-xs text-slate-500 mt-1">
              Only first 100 canonical rows examined; no full-history count inferred.
            </p>
          </div>
          <div className="max-w-md flex-1">
            <label htmlFor="dealer-inquiry-filter" className="block text-sm font-medium mb-1">
              Filter loaded enquiries
            </label>
            <input id="dealer-inquiry-filter" value={search}
              onChange={event=>setSearch(event.target.value)}
              className="border rounded-lg p-3 w-full"
              placeholder="VIN, enquiry type, status"/>
          </div>
        </div>
        {filtered.length===0&&<p className="mt-7 text-sm text-slate-600">
          No seller-safe enquiries match this page and filter. Risk-held enquiries
          remain subject to Marketplace moderation.
        </p>}
        <div className="grid lg:grid-cols-2 gap-4 mt-6">
          {filtered.map(item=><Card key={item.inquiry_id}><CardContent className="p-5 space-y-2">
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <h2 className="font-semibold">{item.inquiry_type?.replaceAll('_',' ')||'Marketplace enquiry'}</h2>
              <span className="text-xs bg-slate-100 rounded-lg px-2 py-1">
                {item.status.replaceAll('_',' ')}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {dealerDateTime(item.created_at)}
              {' · '}{item.source_channel||'Source not recorded'}
            </p>
            {item.vin&&<p className="text-sm">Referenced vehicle VIN: <code>{item.vin}</code></p>}
            {item.customer_contact_available?<>
              {item.contact_name&&<p className="text-sm">Buyer: {item.contact_name}</p>}
              {item.contact_email&&<p className="text-sm">Email: {item.contact_email}</p>}
              {item.contact_phone&&<p className="text-sm">Telephone: {item.contact_phone}</p>}
              {item.message&&<p className="text-sm border-t pt-3 whitespace-pre-wrap break-words">
                {item.message}
              </p>}
            </>:<p className="text-sm text-amber-800">
              Contact withheld pending risk and eligibility confirmation.
            </p>}
            {item.allowed_followup_status&&<Button variant="outline" className="mt-3"
              disabled={Boolean(updatingId)}
              onClick={()=>{void recordDealerFollowup(item)}}>
              {updatingId===item.inquiry_id?'Saving...':
                item.allowed_followup_status==='contacted'?'Record dealer-reported contact':
                  'Record dealer-reported qualified enquiry'}
            </Button>}
            <p className="text-xs text-slate-500 border-t pt-3">
              This records a seller-reported, risk-cleared follow-up in the
              canonical Marketplace inquiry only. It does not send a message,
              prove buyer contact, assign a moderator, verify a transaction,
              close a sale or authorize payment.
            </p>
          </CardContent></Card>)}
        </div>
      </>}
    </div>
  </main>
}
