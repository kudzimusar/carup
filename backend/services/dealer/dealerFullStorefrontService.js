/**
 * C18/C19 D8 — full public dealer storefront is a SECOND, independent human
 * publication decision, never a consequence of source or claim approval alone.
 */
import {supabase} from '../../db/supabase.js';
import {requireIndependentReviewer,requireReviewerPassword}
  from './dealerClaimApplicationService.js';

const SEED=/^ZW-DEAL-[0-9]{4}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sections=new Set([
  'BUSINESS_OVERVIEW','BUYER_ASSURANCE','FINANCE_TERMS',
  'SOURCING','WARRANTY_AFTERSALES','SERVICE_CAPABILITIES',
]);
function deny(code,status=400){return Object.assign(new Error(code),{statusCode:status});}
function seedId(value){if(typeof value!=='string'||!SEED.test(value))throw deny('INVALID_RESEARCH_ID');return value;}
export function fullApprovedPublicProjection(row){
  if(!row)return null;
  return Object.freeze({
    seed_dealer_id:row.seed_dealer_id,slug:row.public_slug,
    name:row.public_name,city:row.public_city,
    tier:'FULL_DEALER_APPROVED',claimed:true,business_verified:true,
    label:'Independently reviewed legal dealership — current CarUp authority checked',
    category:'Compliance-approved dealership (no OEM affiliation implied)',
    reviewed_at:row.publication_reviewed_at,
    approved_branches:(row.approved_branch_snapshot||[]).map(b=>({
      branch_id:b.branch_id,name:b.name,address:b.address,
      display_reviewed:true,gps_verified:false,
    })),
    dealer_declared_sections:row.dealer_declared_sections||{},
    disclosure:'Dealer-declared terms were reviewed for display; CarUp does not independently guarantee warranty, lenders, finance offers, vehicle stock, duty or legal advice.',
    logo_rights_approved:false,vin_listings_verified_by_this_projection:false,
    complaint_count:null,review_count:null,merchant_activation:false,
  });
}
export async function getReviewedFullStorefront(seed){
  const id=seedId(seed);
  const {data,error}=await supabase.from('dealer_full_storefront_current')
    .select('seed_dealer_id,public_slug,public_name,public_city,approved_branch_snapshot,dealer_declared_sections,publication_reviewed_at')
    .eq('seed_dealer_id',id).maybeSingle();
  if(error)throw deny('APPROVED_PUBLIC_STORE_FRONT_UNAVAILABLE',503);
  return fullApprovedPublicProjection(data);
}
export async function listReviewedFullStorefronts(ids){
  if(!Array.isArray(ids)||ids.length>50||ids.some(x=>typeof x!=='string'||!SEED.test(x)))
    throw deny('INVALID_PUBLIC_STORE_FRONT_QUERY');
  if(!ids.length)return new Map();
  const {data,error}=await supabase.from('dealer_full_storefront_current')
    .select('seed_dealer_id,public_slug,public_name,public_city,approved_branch_snapshot,dealer_declared_sections,publication_reviewed_at')
    .in('seed_dealer_id',ids).limit(50);
  if(error)throw deny('APPROVED_PUBLIC_STORE_FRONT_UNAVAILABLE',503);
  return new Map((data||[]).map(x=>[x.seed_dealer_id,fullApprovedPublicProjection(x)]));
}
export async function listFullStorefrontReviewQueue(actor){
  requireIndependentReviewer(actor,'');
  const {data,error}=await supabase.from('dealer_approved_seed_links')
    // Canonical dealer_approved_seed_links contains activated_at, not created_at.
    // Never mask a broken queue query as "zero approved dealers".
    .select('seed_dealer_id,link_id,operating_status,activated_at,claimant_user_id')
    .order('activated_at',{ascending:false}).limit(100);
  if(error)throw deny('PRIVATE_FULL_STOREFRONT_QUEUE_UNAVAILABLE',503);
  return (data||[]).map(x=>({
    seed_dealer_id:x.seed_dealer_id,
    operating_status:x.operating_status,
    independent_reviewer_required:x.claimant_user_id!==actor.userId,
    can_publish_without_independent_review:false,
  }));
}
export async function previewFullStorefrontCandidate(seed,actor,password){
  const id=seedId(seed);
  requireIndependentReviewer(actor,'');
  const {data:link,error:linkError}=await supabase.from('dealer_approved_seed_links')
    .select('link_id,claimant_user_id,dealer_profile_id,tenant_id,operating_status')
    .eq('seed_dealer_id',id).maybeSingle();
  if(linkError)throw deny('FULL_STOREFRONT_CANDIDATE_LOOKUP_UNAVAILABLE',503);
  if(!link)throw deny('APPROVED_DEALER_NOT_FOUND',404);
  requireIndependentReviewer(actor,link.claimant_user_id);
  await requireReviewerPassword(actor,{claimant_user_id:link.claimant_user_id},password);
  const [branchesResult,declaredResult]=await Promise.all([
    supabase.from('dealer_branches').select('id,name,address')
      .eq('dealer_id',link.dealer_profile_id).limit(100),
    supabase.from('dealer_operational_declaration_events')
      .select('section,section_version,declared_values,created_at')
      .eq('dealer_profile_id',link.dealer_profile_id)
      .eq('tenant_id',link.tenant_id)
      .order('section_version',{ascending:false}).limit(100),
  ]);
  if(branchesResult.error||declaredResult.error)
    throw deny('PRIVATE_PUBLICATION_PREVIEW_UNAVAILABLE',503);
  const latest={};
  for(const item of declaredResult.data||[]){
    if(!sections.has(item.section)||latest[item.section])continue;
    latest[item.section]={version:item.section_version,
      proposed_values:item.declared_values,source:'DEALER_PRIVATE_DECLARATION_NOT_VERIFIED'};
  }
  return {
    seed_dealer_id:id,operating_status:link.operating_status,
    branches:(branchesResult.data||[]).map(b=>({
      branch_id:b.id,proposed_name:b.name,proposed_address:b.address,
      public_approved:false,
    })),
    proposed_sections:latest,
    company_and_branch_claims_require_independent_display_review:true,
    can_publish_without_legal_and_country_policy:false,
  };
}

export async function recordFullStorefrontPublication(seed,actor,payload={}){
  const id=seedId(seed);
  requireIndependentReviewer(actor,'');
  if(!['PUBLISHED_FULL','RETRACTED'].includes(payload.disposition))
    throw deny('INVALID_PUBLIC_STOREFRONT_DECISION');
  if(typeof payload.reason!=='string'||payload.reason.trim().length<80||
      payload.reason.length>3000)throw deny('DOCUMENTED_INDEPENDENT_PUBLIC_REVIEW_REQUIRED');
  if(!Array.isArray(payload.approved_branch_ids)||payload.approved_branch_ids.length>100||
    payload.approved_branch_ids.some(b=>typeof b!=='string'||!UUID.test(b)))
    throw deny('INVALID_REVIEWED_BRANCH_IDS');
  if(!Array.isArray(payload.approved_sections)||payload.approved_sections.length>6||
    payload.approved_sections.some(s=>typeof s!=='string'||!sections.has(s)))
    throw deny('INVALID_REVIEWED_PUBLIC_SECTIONS');
  if(payload.disposition==='PUBLISHED_FULL'&&!payload.approved_branch_ids.length)
    throw deny('REVIEWED_BRANCH_REQUIRED_BEFORE_FULL_PUBLICATION');
  if(payload.disposition==='RETRACTED'&&(payload.approved_branch_ids.length||
    payload.approved_sections.length))throw deny('RETRACTION_HAS_NO_PUBLIC_CONTENT');
  await requireReviewerPassword(actor,null,payload.reviewer_password);
  const {data,error}=await supabase.rpc('dealer_review_full_storefront_publication',{
    p_seed_id:id,p_reviewer_id:actor.userId,
    p_disposition:payload.disposition,
    p_branch_ids:payload.approved_branch_ids,
    p_section_keys:payload.approved_sections,
    p_reason:payload.reason.trim(),
  });
  if(error)throw deny('INDEPENDENT_FULL_STORE_FRONT_PUBLICATION_REFUSED',409);
  return data;
}
