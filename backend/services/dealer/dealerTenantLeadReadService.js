/**
 * CARUP-DEALER-ONB-001 D7 C15/C20 — real canonical Marketplace buyer
 * inquiry inbox for one independently activated dealership tenant.
 *
 * Dealer-reported contact progress can only advance clear-risk, canonical Marketplace
 * statuses NEW->CONTACTED->QUALIFIED through a DB-atomic legally approved owner RPC.
 * This does not assign/reject, close or moderate inquiries, establish contact
 * delivery, touch transactions/payments or create a second lead status store.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
const error=(code,status=503)=>Object.assign(new Error(code),{statusCode:status,code});
const SAFE_STATES=new Set(['new','assigned','contacted','qualified','closed']);
const RISK_HIDE=new Set(['watch','blocked','high','spam','rejected','under_review']);
const safeValue=(value,max=300)=>typeof value==='string'&&value.length<=max?value:null;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FOLLOW_UP=new Set(['contacted','qualified']);
export function projectCanonicalDealerInquiry(row){
  if(!row||!SAFE_STATES.has(row.status)||RISK_HIDE.has(row.risk_status))
    return null;
  const trustedContact=(row.risk_status==='clear'&&row.status!=='closed');
  return Object.freeze({
    inquiry_id:row.id,
    vin:safeValue(row.listing_id,64),
    inquiry_type:safeValue(row.inquiry_type,80),
    status:row.status,
    source_channel:safeValue(row.source_channel,40),
    created_at:row.created_at,
    customer_contact_available:trustedContact,
    contact_name:trustedContact?safeValue(row.guest_name,160):null,
    contact_email:trustedContact?safeValue(row.guest_email,160):null,
    contact_phone:trustedContact?safeValue(row.guest_phone,40):null,
    message:trustedContact?safeValue(row.message,2000):null,
    risk_state:'SELLER_SAFE_READ_ONLY',
    buyer_transaction_verified:false,
    payment_authority_granted:false,
    staff_assignment_enabled:false,
    allowed_followup_status:row.risk_status==='clear'&&row.status==='new'?'contacted':
      row.risk_status==='clear'&&row.status==='contacted'?'qualified':null,
    seller_followup_self_reported_only:true,
  });
}
export async function getMyCanonicalDealerInquiries(actor,{db=supabase,resolveOwner=requireApprovedOwnerWorkspace}={}){
  const owner=await resolveOwner(actor);
  const tenantId=owner.tenant_id;
  if(typeof tenantId!=='string'||!tenantId)throw error('CANONICAL_TENANT_CONTEXT_REQUIRED',403);
  const {data,error:readError}=await db.from('marketplace_inquiries')
    .select('id,seller_tenant_id,listing_id,inquiry_type,status,risk_status,source_channel,guest_name,guest_email,guest_phone,message,created_at')
    .eq('seller_tenant_id',tenantId)
    .order('created_at',{ascending:false}).limit(100);
  if(readError||!Array.isArray(data))throw error('TENANT_BUYER_INQUIRIES_UNAVAILABLE');
  if(data.some(row=>row.seller_tenant_id!==tenantId))
    throw error('CROSS_TENANT_BUYER_INQUIRY_REFUSED',403);
  const entries=data.map(projectCanonicalDealerInquiry).filter(Boolean);
  return Object.freeze({
    tenant_id:tenantId,
    entries,
    returned_visible_count:entries.length,
    canonical_rows_read:data.length,
    total_available:null,
    data_scope:'FIRST_100_SCOPED_MARKETPLACE_INQUIRIES',
    canonical_source:'marketplace_inquiries',
    seller_private_contact_only:true,
    moderation_and_assignment_require_marketplace_authority:true,
    dealer_followup_uses_canonical_atomic_inquiry_authority:true,
    no_invented_leads_or_sales:true,
    no_buyer_payment_status_inferred:true,
  });
}

/** Owner-only, canonical Marketplace seller follow-up. No moderation or money rights. */
export async function advanceMyCanonicalDealerInquiry(actor,inquiryId,nextStatus,{
  db=supabase,resolveOwner=requireApprovedOwnerWorkspace
}={}){
  if(typeof inquiryId!=='string'||!UUID.test(inquiryId))
    throw error('INVALID_CANONICAL_INQUIRY_ID',400);
  if(typeof nextStatus!=='string'||!FOLLOW_UP.has(nextStatus))
    throw error('DEALER_FOLLOWUP_STATUS_NOT_ALLOWED',400);
  const owner=await resolveOwner(actor);
  if(!owner?.tenant_id||!UUID.test(String(owner.dealer_profile_id||''))||
     typeof actor?.userId!=='string'||!actor.userId)
    throw error('CANONICAL_DEALER_FOLLOWUP_AUTHORITY_REQUIRED',403);
  const {data,error:writeError}=await db.rpc('dealer_advance_marketplace_inquiry',{
    p_profile_id:owner.dealer_profile_id,p_owner_id:actor.userId,
    p_inquiry_id:inquiryId,p_requested_status:nextStatus
  });
  if(writeError)throw error('DEALER_INQUIRY_FOLLOWUP_REFUSED',409);
  if(!data||data.inquiry_id!==inquiryId||data.status!==nextStatus||
    data.seller_reported_only!==true||data.buyer_contact_delivery_verified!==false||
    data.payment_or_transaction_status_modified!==false)
    throw error('CANONICAL_DEALER_INQUIRY_RECEIPT_INVALID');
  return Object.freeze({
    inquiry_id:data.inquiry_id,previous_status:data.previous_status,status:data.status,
    followup_event_id:data.followup_event_id,seller_reported_only:true,
    buyer_contact_delivery_verified:false,payment_or_transaction_status_modified:false
  });
}
