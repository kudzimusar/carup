/**
 * CARUP-DEALER-ONB-001 D10 — jurisdiction-sensitive candidate checklist.
 * DRAFT policy only; this is not a legal opinion or a regulatory verification.
 * Never infer an official OEM, bonded, PRAZ, tax or lender licence from research
 * categories. A country without approved policy is explicitly unsupported.
 */
import {supabase} from '../../db/supabase.js';
import {requireClaimantSession} from './dealerClaimApplicationService.js';

export const POLICY_VERSION='CARUP_DEALER_ZW_DRAFT_2026_11_03';
export const POLICY_STATUS='DRAFT_REQUIRES_ZW_LEGAL_SIGNOFF';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error=(code,status=400)=>Object.assign(new Error(code),{statusCode:status});
const list=(document,tab)=>{
  const rows=document?.tab_rows?.[tab];
  return Array.isArray(rows)?rows.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)):[];
};
const contains=(value,pattern)=>typeof value==='string'&&pattern.test(value);
const row=(key,label,why,scope='BUSINESS',kind='PLATFORM_VERIFICATION')=>Object.freeze({
  requirement_key:key,label,reason:why,scope,kind,
  applicability:'REQUIRES_HUMAN_DETERMINATION',
  evidence_status:'NOT_INDEPENDENTLY_VERIFIED',
  legal_source_verified:false,compliance_approved:false,
});
export function buildJurisdictionCompliancePreview(document){
  const business=list(document,'BUSINESS')[0]||{};
  const country=typeof business.operating_country==='string'?
    business.operating_country.trim().toUpperCase():'';
  if(!country)return Object.freeze({
    state:'COUNTRY_REQUIRED',country:null,policy_version:null,
    legal_review_complete:false,can_activate:false,can_publish:false,
    requirements:[],unresolved:['Missing declared business country'],
  });
  if(country!=='ZW')return Object.freeze({
    state:'COUNTRY_POLICY_NOT_CONFIGURED',country,policy_version:null,
    legal_review_complete:false,can_activate:false,can_publish:false,
    requirements:[],unresolved:[
      'No approved dealer jurisdiction rule set is available for '+country,
      'Zimbabwe requirements must not be imposed on foreign applicants',
    ],
  });
  const branches=list(document,'BRANCHES');
  const franchises=list(document,'BRANDS_FRANCHISES');
  const sourcing=list(document,'OPERATIONS_SOURCING');
  const finance=list(document,'FINANCE_PAYMENTS');
  const workshop=list(document,'WORKSHOP_WARRANTY');
  const requirements=[
    row('BUSINESS_IDENTITY','Legal business identity and registration evidence',
      'Verify actual legal form, registration issuer and identity against original records'),
    row('AUTHORIZED_SIGNATORY','Company-authorized representative mandate',
      'Original signatory authority and representative scope require independent confirmation'),
    row('TAX_STATUS_APPLICABILITY','Tax registration and clearance applicability',
      'Determine tax obligations for this legal form and activity with current regulator policy'),
    row('BUYER_PROTECTION_TERMS','Buyer contract, disclosure, cancellation and dispute terms',
      'Review the submitted buyer-protection terms and consent without inferring legal compliance'),
  ];
  if(branches.length)requirements.push(row('BRANCH_SITE_SCOPE',
    'Physical location, occupancy and branch authority',
    'Verify location and operating permission separately for each proposed branch',
    'EACH_DECLARED_BRANCH'));
  else requirements.push(row('BRANCH_SITE_UNDECLARED',
    'At least one independently reviewed operating site',
    'No valid declared branch has been provided; site applicability remains unresolved'));
  if(franchises.some(r=>contains(r.relationship,/franchise|official|authori[sz]ed|oem/i))){
    requirements.push(row('OEM_WRITTEN_AUTHORIZATION',
      'Evidence of brand or official franchise authorization',
      'Do not advertise official dealer affiliation without written issuer and scope confirmation',
      'DECLARED_BRAND_RELATIONSHIP','CONDITIONAL_LEGAL_REVIEW'));
  }
  if(sourcing.some(r=>contains(r.sourcing_channels,/bonded|bond warehouse|bond facility/i))||
     contains(business.business_model,/bonded|bond warehouse/i)){
    requirements.push(row('BONDED_FACILITY_AUTHORIZATION',
      'Bonded facility or customs operating authority',
      'Confirm whether the claimed bonded location requires a customs licence',
      'DECLARED_BONDED_FACILITY','CONDITIONAL_LEGAL_REVIEW'));
  }
  if(contains(business.business_model,/government procurement|government tender|public procurement/i)){
    requirements.push(row('PUBLIC_PROCUREMENT_REGISTRATION',
      'Public procurement eligibility and PRAZ applicability',
      'Independent review applies only if government procurement is actually claimed',
      'DECLARED_PUBLIC_PROCUREMENT','CONDITIONAL_LEGAL_REVIEW'));
  }
  if(finance.some(r=>typeof r.finance_partner==='string'&&r.finance_partner.trim())){
    requirements.push(row('FINANCE_PARTNER_AUTHORIZATION',
      'Written finance partner/credit advertisement authority',
      'Verify partner relationship and disclosed terms before any public financing claim',
      'DECLARED_FINANCE_PARTNER','CONDITIONAL_LEGAL_REVIEW'));
  }
  if(workshop.some(r=>typeof r.workshop_services==='string'&&r.workshop_services.trim())){
    requirements.push(row('WORKSHOP_FACILITY_POLICY',
      'Workshop, warranty and service facility policy',
      'Review operating permits where applicable, partner authorizations and warranty exclusions',
      'DECLARED_WORKSHOP','CONDITIONAL_LEGAL_REVIEW'));
  }
  const unresolved=[
    'Zimbabwe regulator rules, effective dates, legal form and licensed facility scope need specialist sign-off',
    'Self-declared workbook values are not independent legal, tax or licence verification',
    'Claim approval does not activate a business, merchant account or dealer inventory',
  ];
  if(!business.legal_name)unresolved.push('Registered legal name has not been declared');
  return Object.freeze({
    state:'DRAFT_POLICY_REVIEW_ONLY',
    country:'ZW',policy_version:POLICY_VERSION,
    policy_status:POLICY_STATUS,
    legal_review_complete:false,can_activate:false,can_publish:false,
    requirements,unresolved,
    declared_branch_count:branches.length,
    source_is_applicant_declaration:true,
  });
}
export async function readMyClaimJurisdictionPreview(claimId,actor){
  requireClaimantSession(actor);
  if(typeof claimId!=='string'||!UUID.test(claimId))
    throw error('INVALID_CLAIM_ID');
  const {data:claim,error:claimError}=await supabase.from('dealer_research_claim_requests')
    .select('claimant_user_id,claim_status').eq('claim_id',claimId).maybeSingle();
  if(claimError)throw error('CLAIM_LOOKUP_UNAVAILABLE',503);
  if(!claim||claim.claimant_user_id!==actor.userId)throw error('CLAIM_NOT_FOUND',404);
  if(claim.claim_status!=='CLAIM_APPROVED')
    throw error('CLAIM_APPROVAL_REQUIRED',403);
  const {data:draft,error:dbError}=await supabase.from('dealer_claim_intake_drafts')
    .select('content,submission_version').eq('claim_id',claimId)
    .eq('claimant_user_id',actor.userId).maybeSingle();
  if(dbError)throw error('PRIVATE_APPLICATION_UNAVAILABLE',503);
  if(!draft)return {state:'AWAITING_APPLICATION',can_activate:false,
    legal_review_complete:false,can_publish:false,requirements:[]};
  return {...buildJurisdictionCompliancePreview(draft.content),
    submission_version:draft.submission_version};
}
