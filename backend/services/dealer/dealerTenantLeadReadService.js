/**
 * CARUP-DEALER-ONB-001 D7 C15/C20 — real canonical Marketplace buyer
 * inquiry inbox for one independently activated dealership tenant.
 *
 * Reading an inquiry does NOT assign it, amend transaction status, authorize
 * a refund or create a new dealer-specific lead ledger. The existing Marketplace
 * inquiry table and Communications escalation authority remain canonical.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
const error=(code,status=503)=>Object.assign(new Error(code),{statusCode:status,code});
const SAFE_STATES=new Set(['new','assigned','contacted','qualified','closed']);
const RISK_HIDE=new Set(['watch','blocked','high','spam','rejected','under_review']);
const safeValue=(value,max=300)=>typeof value==='string'&&value.length<=max?value:null;
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
    status_updates_require_separate_marketplace_authority:true,
    no_invented_leads_or_sales:true,
    no_buyer_payment_status_inferred:true,
  });
}
