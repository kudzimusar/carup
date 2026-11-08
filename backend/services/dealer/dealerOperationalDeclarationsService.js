/**
 * D7 C13/C20/C21/C22 — private persistent, immutable dealer declarations.
 * This deliberately does NOT write canonical finance, licence, buyer-review,
 * staff, vehicle, invoice, merchant or public publication authorities.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
const sections=Object.freeze({
  BUSINESS_OVERVIEW:['public_description','trading_name','declared_contact_email','opening_hours_note'],
  BUYER_ASSURANCE:['inspection_rights','cancellation_policy','refund_policy','dispute_resolution'],
  FINANCE_TERMS:['deposit_terms','accepted_payment_methods','finance_partner_disclosure','currency_disclosure'],
  SOURCING:['sourcing_channels','import_duty_disclosure','customs_handling'],
  WARRANTY_AFTERSALES:['warranty_scope','warranty_exclusions','repair_support','spare_parts_support'],
  SERVICE_CAPABILITIES:['workshop_services','inspection_services','buyer_support_hours'],
});
export const dealerOperationSections=Object.freeze(Object.keys(sections));
function refuse(code,status=400){return Object.assign(new Error(code),{statusCode:status,code});}
export function normalizeDealerOperationDeclaration(section,values){
  if(!Object.hasOwn(sections,section))throw refuse('UNSUPPORTED_DEALER_OPERATING_SECTION');
  if(!values||typeof values!=='object'||Array.isArray(values))throw refuse('INVALID_OPERATION_FIELDS');
  const clean={};
  for(const [key,value] of Object.entries(values)){
    if(!sections[section].includes(key)||typeof value!=='string')throw refuse('UNAPPROVED_OPERATION_FIELD');
    if(value.length>750||/[\u0000-\u001f\u007f]/.test(value)||/<\s*[/!a-z]/i.test(value))
      throw refuse('UNSAFE_OPERATION_DECLARATION');
    const trimmed=value.trim();
    if(trimmed)clean[key]=trimmed;
  }
  if(!Object.keys(clean).length||JSON.stringify(clean).length>6500)
    throw refuse('EMPTY_OPERATION_DECLARATION');
  return clean;
}
export async function listMyOperationalDeclarations(actor){
  const owner=await requireApprovedOwnerWorkspace(actor);
  const {data,error}=await supabase.from('dealer_operational_declaration_events')
    .select('section,section_version,declared_values,created_at')
    .eq('dealer_profile_id',owner.dealer_profile_id)
    .eq('tenant_id',owner.tenant_id)
    .order('section_version',{ascending:false}).limit(250);
  if(error)throw refuse('PRIVATE_OPERATIONS_READ_UNAVAILABLE',503);
  const latest={};
  for(const item of data||[]){
    if(!Object.hasOwn(sections,item.section)||latest[item.section])continue;
    latest[item.section]={
      version:item.section_version,values:item.declared_values,
      recorded_at:item.created_at,private_declaration_only:true,
      public_approved:false,independently_verified:false,
    };
  }
  return {
    sections:dealerOperationSections,
    latest,owner_scope:'CANONICAL_CLAIM_LINKED_TENANT_OWNER',
    publication_approval:false,verified_complaint_count:null,
    measured_sales_revenue:null,
  };
}
export async function recordMyOperationalDeclaration(actor,section,payload={}){
  const owner=await requireApprovedOwnerWorkspace(actor);
  const values=normalizeDealerOperationDeclaration(section,payload.values);
  if(!Number.isInteger(payload.expected_version)||payload.expected_version<0)
    throw refuse('EXPECTED_SECTION_VERSION_REQUIRED');
  const {data,error}=await supabase.rpc('dealer_record_operational_declaration',{
    p_profile_id:owner.dealer_profile_id,p_tenant_id:owner.tenant_id,
    p_actor_id:owner.actor_id,p_section:section,
    p_expected_version:payload.expected_version,p_values:values,
  });
  if(error)throw refuse('CANONICAL_PRIVATE_OPERATION_WRITE_REFUSED',409);
  return data;
}
/**
 * R6 C02 — what the governed activation carried from the approved, frozen application
 * into canonical branches and private declarations, and what still needs the owner.
 * Provenance only: nothing here is verified, public or approved.
 */
export async function readMyActivationCarryover(actor,{db=supabase,resolveOwner=requireApprovedOwnerWorkspace}={}){
  const owner=await resolveOwner(actor);
  const {data,error}=await db.rpc('dealer_read_activation_carryover',{
    p_profile_id:owner.dealer_profile_id,p_tenant_id:owner.tenant_id,
  });
  if(error)throw refuse('ACTIVATION_CARRYOVER_READ_UNAVAILABLE',503);
  if(!data||typeof data!=='object')throw refuse('ACTIVATION_CARRYOVER_NOT_FOUND',404);
  return Object.freeze({
    application_version:data.application_version??null,
    activated_at:data.activated_at??null,
    branches:Array.isArray(data.branches)?data.branches.map(b=>({
      branch_ref:b.branch_ref,source_row:b.source_row,branch_id:b.branch_id,name:b.name,
      has_gps:b.has_gps===true,has_hours:b.has_hours===true,
    })):[],
    sections:Array.isArray(data.sections)?data.sections.filter(s=>dealerOperationSections.includes(s)):[],
    counts:data.counts&&typeof data.counts==='object'?data.counts:{},
    needs_attention:Array.isArray(data.needs_attention)?data.needs_attention.slice(0,200):[],
    independently_verified:false,publicly_approved:false,
  });
}
