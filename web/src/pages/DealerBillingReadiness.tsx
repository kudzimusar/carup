import {useEffect,useState} from 'react'
import { dealerDate } from '@/lib/dealerDates'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'

type Flow={code:string;payer:string;beneficiary:string;provider:string;status:string;paid:false}
type Subscription={
  subscription_id:string;status:string|null;paid_through:string|null;
  current_period_end:string|null;provider_status_is_entitlement_proof:false;
}
type Invoice={
  invoice_id:string;subscription_id:string;status:string|null;
  currency:string|null;amount_due_minor:number|null;payment_status:string;
  anomaly:string|null;canonical_payment_reference_present:boolean;
  reconciliation_attested_by_this_read:false;
}
type BillingSnapshot={
  state:string;subscriptions:Subscription[]|null;invoices:Invoice[]|null;
  records_queried_not_full_history?:true;
  source_authority?:string;subscription_rows_returned?:number;
  invoice_rows_returned?:number;payment_initiation_allowed:false;
}
type Readiness={
  organization_id:string;tenant_id:string;product_catalogue_authority:string;
  canonical_pay03b_billing_readback:BillingSnapshot;
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
    if(!user||!token){
      void Promise.resolve().then(()=>{if(live)setState('denied')})
      return()=>{live=false}
    }
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
        <Card className="mt-5"><CardContent className="p-6 space-y-3">
          <h2 className="font-semibold text-lg">Canonical subscription and invoice read-back</h2>
          <p className="text-sm text-slate-600">
            Read-only tenant-filtered PAY-03B records, only when the separately governed
            subscription tables exist. This panel never initiates, verifies or
            settles payments and cannot grant a subscription entitlement.
          </p>
          <p className="text-xs font-medium break-words">
            Record authority: {data.canonical_pay03b_billing_readback.state.replaceAll('_',' ')}
          </p>
          {data.canonical_pay03b_billing_readback.subscriptions===null
            ?<p role="status" className="text-sm text-amber-800">
              Canonical dealer billing records are unavailable. No invoice or
              payment total may be inferred from that absence.
            </p>
            :<>
              <p className="text-sm">
                {data.canonical_pay03b_billing_readback.subscriptions.length}
                {' '}subscription record(s) in this scoped read, not a payment count.
              </p>
              {data.canonical_pay03b_billing_readback.subscriptions.map(item=>
                <div key={item.subscription_id} className="border rounded-lg p-3 text-sm">
                  <p className="font-semibold">Subscription {item.subscription_id}</p>
                  <p className="mt-1">Status: {item.status||'Not determined'}</p>
                  <p className="mt-1">Paid-through record: {dealerDate(item.paid_through)}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    A recorded provider state alone is never verified current entitlement.
                  </p>
                </div>)}
              {data.canonical_pay03b_billing_readback.invoices?.map(invoice=>
                <div key={invoice.invoice_id} className="border rounded-lg p-3 text-sm">
                  <p className="font-semibold">Invoice {invoice.invoice_id}</p>
                  <p className="mt-1">Provider record: {invoice.status||'Not determined'}</p>
                  <p className="mt-1">Canonical payment status: {invoice.payment_status}</p>
                  {invoice.anomaly&&<p className="mt-1 text-amber-800">
                    Reconciliation exception: {invoice.anomaly}
                  </p>}
                  <p className="text-xs text-slate-500 mt-2">
                    No provider settlement, receipt, refund completion or access
                    entitlement is independently certified by this view.
                  </p>
                </div>)}
              <p className="text-xs text-slate-500">
                The view is capped at 25 recent subscriptions and 100 recent invoices.
                It is not a complete audited billing statement.
              </p>
            </>}
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
