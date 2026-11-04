/**
 * C24 D9: Truthful safe dealer-commerce readiness until PAY-03B/05 source
 * authorities are actually converged and independently accepted. No fake
 * prices, no fake payments, no second money ledger and no provider API calls.
 */
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
import {supabase} from '../../db/supabase.js';
export const FLOW_DISTINCTIONS=Object.freeze([
  Object.freeze({
    code:'DEALER_PAYS_CARUP',payer:'DEALERSHIP_ORGANIZATION',
    beneficiary:'INDEPENDENTLY_APPROVED_CARUP_MERCHANT',
    provider:'SEPARATE_FIRST_PARTY_CHECKOUT_TO_BE_CERTIFIED',
    status:'BLOCKED_PENDING_PAY03B_AND_FIRST_PARTY_MERCHANT',
    paid:false,
  }),
  Object.freeze({
    code:'BUYER_PAYS_DEALER',payer:'END_CUSTOMER',
    beneficiary:'THIS_DEALERSHIP_OWN_VERIFIED_MERCHANT',
    provider:'SEPARATELY_AUTHORIZED_DEALER_COLLECTIONS',
    status:'BLOCKED_PENDING_DEALER_MERCHANT_AND_PROVIDER_CERT',
    paid:false,
  }),
  Object.freeze({
    code:'GARAGE_CUSTOMER_PAYS_GARAGE',payer:'GARAGE_CUSTOMER',
    beneficiary:'GARAGE_OWN_MERCHANT_NOT_CARUP_AND_NOT_DEALERSHIP',
    provider:'PAY05_GARAGE_LINEAGE_UNMERGED',
    status:'OUTSIDE_DEALER_BILLING_SCOPE',
    paid:false,
  }),
]);
/**
 * C24 D9 read-only compatibility bridge to PAY-03B's canonical draft lineage.
 * This is a narrow *read* of the actual commercial tables IF and ONLY IF they
 * exist in the current database. It cannot issue paid status, grant entitlements,
 * start a checkout, modify billing roles, contact Stripe/Paynow or imply a receipt.
 * A failed/unmerged lookup is UNKNOWN/UNAVAILABLE, never zero paid invoices.
 */
const safeEnum=(v,max=90)=>typeof v==='string'&&v.length<=max?v:null;
const safeDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const isId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export function projectDealerCanonicalBillingReadback(subscriptions,invoices,payments){
  if(!Array.isArray(subscriptions)||!Array.isArray(invoices)||!Array.isArray(payments))
    throw new TypeError('Canonical billing records must be authoritative arrays');
  const owned=new Set(subscriptions.map(s=>s.id).filter(isId));
  if(owned.size!==subscriptions.length)throw new Error('SUBSCRIPTION_RECORD_IDENTITY_INVALID');
  const payByReference=new Map(payments.map(p=>[p.reference,p.status]));
  return Object.freeze({
    state:'PAY03B_CANONICAL_SNAPSHOT_READ_ONLY',
    source_authority:'PAY03B_DRAFT_SUBSCRIPTION_AND_PAYMENT_TRANSACTIONS',
    records_queried_not_full_history:true,
    subscriptions:subscriptions.map(s=>({
      subscription_id:s.id,
      status:safeEnum(s.status),
      paid_through:safeDate(s.paid_through),
      current_period_end:safeDate(s.current_period_end),
      // Sandbox or provider 'active' never means a period is paid.
      provider_status_is_entitlement_proof:false,
      tenant_billable_entitlement_approved_by_this_read:false,
    })),
    invoices:invoices.map(i=>{
      if(!owned.has(i.subscription_id))throw new Error('CROSS_TENANT_INVOICE_RECORD');
      const paymentState=i.payment_reference&&payByReference.has(i.payment_reference)
        ?safeEnum(payByReference.get(i.payment_reference)):null;
      return {
        invoice_id:i.id,
        subscription_id:i.subscription_id,
        status:safeEnum(i.provider_status),
        currency:safeEnum(i.currency,8),
        amount_due_minor:Number.isSafeInteger(Number(i.amount_due_minor))&&
          Number(i.amount_due_minor)>=0?Number(i.amount_due_minor):null,
        payment_status:paymentState||'NOT_RECONCILED',
        anomaly:safeEnum(i.anomaly),
        canonical_payment_reference_present:Boolean(i.payment_reference),
        // A transaction labelled paid is not sufficient proof of provider
        // signature/settlement or that a subscription entitlement is eligible.
        reconciliation_attested_by_this_read:false,
      };
    }),
    subscription_rows_returned:subscriptions.length,
    invoice_rows_returned:invoices.length,
    records_missing_is_zero:false,
    payment_initiation_allowed:false,
    provider_account_activated_by_this_read:false,
    storefront_entitlement_granted_by_this_read:false,
  });
}
export async function loadReadOnlyDealerPay03bSnapshot(db,tenantId){
  if(!isId(tenantId))return {
    state:'CANONICAL_TENANT_ID_REQUIRED',subscriptions:null,invoices:null,
    payment_initiation_allowed:false,
  };
  const {data:subscriptions,error:subscriptionError}=await db.from('pay03b_business_subscriptions')
    .select('id,owner_tenant_id,subscription_scope,status,paid_through,current_period_end,created_at')
    .eq('owner_tenant_id',tenantId)
    .eq('subscription_scope','dealer_storefront')
    .order('created_at',{ascending:false}).limit(25);
  if(subscriptionError||!Array.isArray(subscriptions))return {
    state:'PAY03B_SCHEMA_OR_CANONICAL_READ_UNAVAILABLE',
    subscriptions:null,invoices:null,
    payment_initiation_allowed:false,
    no_entitlement_inferred:true,
  };
  if(subscriptions.some(s=>s.owner_tenant_id!==tenantId||
    s.subscription_scope!=='dealer_storefront'||!isId(s.id))){
    return {state:'PAY03B_TENANT_SCOPE_MISMATCH',
      subscriptions:null,invoices:null,payment_initiation_allowed:false};
  }
  if(!subscriptions.length)return projectDealerCanonicalBillingReadback([],[],[]);
  const ids=subscriptions.map(s=>s.id);
  const {data:invoices,error:invoiceError}=await db.from('pay03b_subscription_invoices')
    .select('id,subscription_id,provider_status,currency,amount_due_minor,anomaly,payment_reference,period_start')
    .in('subscription_id',ids)
    .order('period_start',{ascending:false}).limit(100);
  if(invoiceError||!Array.isArray(invoices))return {
    state:'PAY03B_INVOICE_CANONICAL_READ_UNAVAILABLE',
    subscriptions:null,invoices:null,payment_initiation_allowed:false};
  if(invoices.some(i=>!ids.includes(i.subscription_id)))return {
    state:'PAY03B_CROSS_TENANT_INVOICE_REFUSED',
    subscriptions:null,invoices:null,payment_initiation_allowed:false};
  const refs=[...new Set(invoices.map(i=>i.payment_reference).filter(x=>
    typeof x==='string'&&x.length>0&&x.length<=180))];
  if(invoices.some(i=>i.payment_reference&&
    (typeof i.payment_reference!=='string'||i.payment_reference.length>180)))
    return {state:'PAY03B_UNSAFE_PAYMENT_REFERENCE_REFUSED',
      subscriptions:null,invoices:null,payment_initiation_allowed:false};
  let payments=[];
  if(refs.length){
    const {data,error}=await db.from('payment_transactions')
      .select('reference,status').in('reference',refs).limit(100);
    if(error||!Array.isArray(data))return {
      state:'PAY03B_CANONICAL_PAYMENT_READ_UNAVAILABLE',
      subscriptions:null,invoices:null,payment_initiation_allowed:false};
    payments=data;
  }
  return projectDealerCanonicalBillingReadback(subscriptions,invoices,payments);
}

export async function getDealerCommercialReadiness(actor,{db=supabase,resolveOwner=requireApprovedOwnerWorkspace}={}){
  const owner=await resolveOwner(actor);
  const canonicalBilling=await loadReadOnlyDealerPay03bSnapshot(db,owner.tenant_id);
  // The current base deliberately lacks deployed PAY-03B and PAY-05 product
  // authorizations. A UI must never treat this truthful unpriced state as
  // payment history, a real-money provider entitlement or a plan selection.
  return {
    organization_id:owner.organization_id,tenant_id:owner.tenant_id,
    canonical_pay03b_billing_readback:canonicalBilling,
    product_catalogue_authority:'PAY03B_DRAFT_PR_251_NOT_IN_ACCEPTED_MAIN',
    dealer_first_party_pricing:[],
    selectable_dealer_plans:[],
    approved_provider_methods:[],
    billing_transactions:null,
    receipts:null,
    reconciliation_records:null,
    payment_initiation_allowed:false,
    has_approved_subscription_entitlement:false,
    live_payment_enabled:false,
    finance_status:'INTEGRATION_AND_EXTERNAL_COMMERCIAL_APPROVAL_REQUIRED',
    external_gates:[
      'OWNER_APPROVED_DEALER_PRODUCT_TARIFF_AND_JURISDICTION',
      'APPROVED_CARUP_LEGAL_MERCHANT_OF_RECORD',
      'PAY03B_CANONICAL_ENTITLEMENT_AND_FINANCE_CONVERGENCE',
      'PAY05_GARAGE_COLLECTIONS_MUST_REMAIN_SEPARATE',
      'INDEPENDENT_PROVIDER_SANDBOX_AND_SECURITY_CERTIFICATION',
      'EXPLICIT_OWNER_NO_LIVE_ACTIVATION_RELEASE',
    ],
    flows:FLOW_DISTINCTIONS,
  };
}
