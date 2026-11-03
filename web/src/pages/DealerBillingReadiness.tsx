import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Flow={code:string;payer:string;beneficiary:string;provider:string;status:string;paid:false}
type Readiness={
  organization_id:string;tenant_id:string;product_catalogue_authority:string;
  dealer_first_party_pricing:[];selectable_dealer_plans:[];
  approved_provider_methods:[];billing_transactions:null;receipts:null;
  reconciliation_records:null;payment_initiation_allowed:false;
  has_approved_subscription_entitlement:false;live_payment_enabled:false;
  finance_status:string;external_gates:string[];flows:Flow[];
}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
function auth(userId:string,token:string):AuthHeaders{
  return {'x-session-token':token,'x-user-id':userId}
}
/**
 * There is no nonfunctional "Pay now" CTA: the PAY-03B/05 draft programmes are
 * not accepted into this isolated branch, products lack approved prices and
 * legal beneficiaries, and the owner has authorized no real-money operation.
 */
export default function DealerBillingReadiness(){
  const {user,token}=useAuth()
  const [data,setData]=useState<Readiness|null>(null)
  const [state,setState]=useState<'loading'|'ready'|'denied'>('loading')
  useEffect(()=>{
    let live=true
    if(!user||!token){setState('denied');return}
    apiRequest<{readiness:Readiness}>({
      baseUrl:API,path:'/dealer/commercial-readiness',
      authHeaders:auth(user.id,token),
    }).then(result=>{
      if(!live)return
      setData(result.readiness);setState('ready')
    }).catch(()=>{if(live){setData(null);setState('denied')}})
    return()=>{live=false}
  },[user,token])
  return <main className="min-h-screen bg-slate-50 px-4 py-10">
    <div className="max-w-5xl mx-auto">
      <Link to="/dealers/operating-details" className="text-sm underline text-blue-700">
        Back to operating details
      </Link>
      <h1 className="text-3xl font-bold mt-5">Dealership plans and billing</h1>
      <p className="max-w-3xl text-slate-600 mt-2">
        Your dealership's payment obligations are distinct from customers paying your dealership,
        and from garage customers paying a garage. No unapproved plan, amount or merchant
        connection is presented as available.
      </p>
      {state==='loading'&&<p role="status" className="mt-7">Checking your canonical dealership authority…</p>}
      {state==='denied'&&<p role="alert" className="mt-7 border border-amber-300 bg-amber-50 p-5 rounded-xl">
        An active legal dealership and tenant membership is required before business billing status
        can be inspected. No payment has been initiated.
      </p>}
      {state==='ready'&&data&&<>
        <Card className="mt-8 border-amber-200"><CardContent className="p-6">
          <h2 className="font-semibold text-lg">Dealer subscriptions cannot be purchased yet</h2>
          <p className="text-sm text-slate-700 mt-2">
            PAY-03B dealer plans are under separate unmerged finance review. Owner-authorized
            prices, legal payee, tax/currency, provider and reconciled entitlement are required
            before a checkout or invoice may exist.
          </p>
          <dl className="grid sm:grid-cols-2 gap-3 mt-5 text-sm">
            <div><dt className="text-slate-500">Commercial authority</dt>
              <dd className="font-medium break-words">{data.finance_status.replaceAll('_',' ')}</dd></div>
            <div><dt className="text-slate-500">Approved selectable plans</dt>
              <dd className="font-medium">{data.selectable_dealer_plans.length} — not priced or certified</dd></div>
            <div><dt className="text-slate-500">Payment initiation</dt>
              <dd className="font-medium">Disabled</dd></div>
            <div><dt className="text-slate-500">Historical invoice and receipt totals</dt>
              <dd className="font-medium">Not available — not zero</dd></div>
          </dl>
        </CardContent></Card>
        <h2 className="text-xl font-semibold mt-8 mb-4">Legally distinct financial flows</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {data.flows.map(flow=><Card key={flow.code}><CardContent className="p-5">
            <h3 className="font-semibold text-sm">{flow.code.replaceAll('_',' ')}</h3>
            <p className="text-sm text-slate-600 mt-3">Payer: {flow.payer.replaceAll('_',' ')}</p>
            <p className="text-sm text-slate-600 mt-2">Merchant: {flow.beneficiary.replaceAll('_',' ')}</p>
            <p className="text-xs mt-4 text-amber-800 font-medium">
              {flow.status.replaceAll('_',' ')}
            </p>
          </CardContent></Card>)}
        </div>
        <h2 className="text-xl font-semibold mt-8 mb-4">Activation requirements</h2>
        <ul className="space-y-2 list-disc pl-5 text-sm text-slate-700">
          {data.external_gates.map(gate=><li key={gate}>{gate.replaceAll('_',' ')}</li>)}
        </ul>
        <p className="text-xs text-slate-600 mt-5">
          No Stripe, Paynow, mobile money or merchant request is made on this page.
          A paid subscription can never independently confer company, legal, buyer-trust
          or VIN listing verification.
        </p>
      </>}
    </div>
  </main>
}
