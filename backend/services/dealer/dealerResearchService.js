/**
 * CARUP-DEALER-ONB-001 D1/D2/D4 — research prelisting (not dealer compliance).
 * A private research row is never a company/tenant, dealer stock, role or verification.
 * Public response is an explicit allowlist. No raw source_snapshot or private contacts.
 */
import { supabase } from '../../db/supabase.js';
import {requireReviewerPassword} from './dealerClaimApplicationService.js';

export const PUBLIC_STATUS = 'PRELISTED_UNCLAIMED';
export const PUBLIC_COLUMNS =
  'seed_dealer_id,public_slug,public_name,public_city,public_research_category,source_attribution,publication_status,reviewed_at,revision';
const DECISIONS = new Set([PUBLIC_STATUS, 'WITHHELD', 'SUPPRESSED', 'DUPLICATE', 'UNDER_DISPUTE']);
const RELATIONSHIPS = new Set([
  'LEGAL_OWNER','DIRECTOR','AUTHORIZED_REPRESENTATIVE','BRANCH_MANAGER','PARENT_DELEGATE',
]);
const SCOPES = new Set(['BRANCH','PARENT_ORGANIZATION']);
const SEED_ID = /^ZW-DEAL-\d{4}$/;

export function normalizeSeedId(value) {
  if (typeof value !== 'string' || !SEED_ID.test(value)) {
    const error = new Error('Invalid research seed reference');
    error.statusCode = 400;
    throw error;
  }
  return value;
}
function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
function domainError(error, operation) {
  const result = new Error(operation + ' unavailable; no state change is confirmed');
  result.statusCode = 503;
  result.cause = error;
  return result;
}
function trim(value, maximum, minimum = 0) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= minimum && text.length <= maximum ? text : null;
}

/** A private source record can NEVER be projected by this function. */
export function publicResearchProjection(row) {
  if (!row || row.publication_status !== PUBLIC_STATUS) return null;
  return Object.freeze({
    seed_dealer_id: row.seed_dealer_id,
    slug: row.public_slug,
    name: row.public_name,
    city: row.public_city,
    category: row.public_research_category,
    source_attribution: row.source_attribution,
    reviewed_at: row.reviewed_at,
    revision: row.revision,
    claimed: false,
    business_verified: false,
    label: 'Unclaimed — Not independently business-verified',
    information_notice: 'CarUp research information may be outdated. This is not a dealer endorsement.',
  });
}

export async function listPublicResearch({ q, city, page = 1, limit = 30 } = {}) {
  const offset = (Math.max(1,Math.min(Number(page)||1,100)) - 1)
    * Math.max(1,Math.min(Number(limit)||30,50));
  const pageSize = Math.max(1,Math.min(Number(limit)||30,50));
  let request = supabase.from('dealer_research_public_profiles')
    .select(PUBLIC_COLUMNS, { count: 'exact' })
    .eq('publication_status', PUBLIC_STATUS)
    .order('public_name', { ascending: true })
    .range(offset, offset + pageSize - 1);
  const cityFilter = trim(city, 80);
  if (city && !cityFilter) throw inputError('Invalid city search');
  if (cityFilter) request = request.eq('public_city', cityFilter);
  const query = trim(q, 80);
  if (q && !query) throw inputError('Invalid search term');
  if (query) {
    // Escape PostgREST LIKE wildcards so a visitor cannot change query semantics.
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    request = request.ilike('public_name', '%' + escaped + '%');
  }
  const { data, count, error } = await request;
  if (error) throw domainError(error,'research directory');
  return { entries: (data || []).map(publicResearchProjection).filter(Boolean),
    total: Number.isInteger(count) ? count : null, page: Math.floor(offset / pageSize) + 1, limit: pageSize };
}

export async function getPublicResearch(seedId) {
  const id = normalizeSeedId(seedId);
  const { data, error } = await supabase.from('dealer_research_public_profiles')
    .select(PUBLIC_COLUMNS).eq('seed_dealer_id', id)
    .eq('publication_status',PUBLIC_STATUS).maybeSingle();
  if (error) throw domainError(error,'research profile');
  return publicResearchProjection(data);
}

/** Private allowlisted research queue; no source contacts, ownership PII or raw rows. */
export async function listResearchReviewQueue(actor,{page=1,limit=25}={}){
  if (!actor?.userId || actor.authenticationMethod!=='session' || !actor.isVerified ||
      !['admin','reviewer','platform_admin','super_admin'].includes(actor.platformRole)) {
    const error=new Error('Independent session-verified reviewer required');
    error.statusCode=403;throw error;
  }
  const pg=Math.max(1,Math.min(Number(page)||1,100));
  const size=Math.max(1,Math.min(Number(limit)||25,50));
  const {data:rows,count,error}=await supabase.from('dealer_research_seed_records')
    .select('seed_dealer_id,original_source_row,source_snapshot,proposed_source_category,grouping_review,source_row_sha256',
      {count:'exact'})
    .order('original_source_row',{ascending:true})
    .range((pg-1)*size,pg*size-1);
  if(error)throw domainError(error,'research review queue');
  const ids=(rows||[]).map(r=>r.seed_dealer_id);
  let states=[];
  if(ids.length){
    const result=await supabase.from('dealer_research_public_profiles')
      .select('seed_dealer_id,publication_status,revision')
      .in('seed_dealer_id',ids);
    if(result.error)throw domainError(result.error,'research publication read');
    states=result.data||[];
  }
  const statusById=new Map(states.map(row=>[row.seed_dealer_id,row]));
  const entries=(rows||[]).map(row=>{
    const published=statusById.get(row.seed_dealer_id);
    const snapshot=row.source_snapshot||{};
    // Explicit allowlist: no telephone, email, named principal, tax,
    // location contact, private workbook, raw snapshot or reviewer reason.
    return {
      seed_dealer_id:row.seed_dealer_id,
      source_row:row.original_source_row,
      source_display_name:trim(snapshot['Dealer / Company Name'],180)||'RESEARCH_NAME_REQUIRES_CORRECTION',
      source_city:trim(snapshot['City / Town'],100)||'CITY_REQUIRES_CORRECTION',
      source_category_unverified:row.proposed_source_category||'UNCLASSIFIED_RESEARCH',
      grouping_status:row.grouping_review||'UNREVIEWED_PARENT_BRANCH_MATCH',
      source_row_sha256:row.source_row_sha256,
      publication_state:published?.publication_status||'PENDING_HUMAN_SOURCE_ELIGIBILITY',
      review_revision:published?.revision||0,
      legal_business_verified:false,verified_franchise:false,
    };
  });
  return {entries,total:Number.isInteger(count)?count:null,page:pg,limit:size,
    real_review_required:true,bulk_publication_available:false};
}

/** Human review recorded atomically inside a DB-side transaction and append-only ledger. */
export async function reviewResearchSeed(seedId, actor, data) {
  const id = normalizeSeedId(seedId);
  if (!actor?.userId || actor.authenticationMethod !== 'session' || !actor.isVerified
      || !['admin','reviewer','platform_admin','super_admin'].includes(actor.platformRole)) {
    const error = new Error('Independent session-verified reviewer required');
    error.statusCode = 403;
    throw error;
  }
  if (!DECISIONS.has(data?.decision)) throw inputError('Unsupported research-publication disposition');
  const reason = trim(data?.reason, 3000,
    data?.decision===PUBLIC_STATUS?80:25);
  if (!reason) throw inputError('A documented source/eligibility review reason is required');
  // Publishing a third-party listing is consequential: the reviewer must
  // reauthenticate with their saved account secret, not just present a role.
  await requireReviewerPassword(actor,null,data?.reviewer_password);
  const { data: recorded, error } = await supabase.rpc('dealer_record_research_publication_review', {
    p_seed_dealer_id: id,
    p_reviewer_id: actor.userId,
    p_decision: data.decision,
    p_reason: reason,
  });
  if (error) throw domainError(error,'research review');
  return recorded;
}

/** Explicit independent source grouping observations. No legal parent verification. */
export async function recordResearchGroupingReview(seedId,actor,payload={}){
  const id=normalizeSeedId(seedId);
  if(!actor?.userId||actor.authenticationMethod!=='session'||!actor.isVerified||
    !['admin','reviewer','platform_admin','super_admin'].includes(actor.platformRole))
    throw Object.assign(new Error('Independent verified reviewer required'),{statusCode:403});
  const related=payload.related_seed_dealer_id==null||payload.related_seed_dealer_id===''?
    null:normalizeSeedId(payload.related_seed_dealer_id);
  const states=['POTENTIAL_SAME_PARENT','POTENTIAL_DUPLICATE','CONFIRMED_DISTINCT_RESEARCH',
    'REVIEWED_BRANCH_RELATIONSHIP','UNRESOLVED_GROUPING'];
  if(!states.includes(payload.review_state)||typeof payload.reason!=='string'||
    payload.reason.trim().length<60||payload.reason.length>3000)
    throw inputError('Documented independent source-grouping decision required');
  await requireReviewerPassword(actor,null,payload.reviewer_password);
  const {data,error}=await supabase.rpc('dealer_record_research_grouping_review',{
    p_seed_id:id,p_related_seed_id:related,p_reviewer_id:actor.userId,
    p_state:payload.review_state,p_reason:payload.reason.trim(),
  });
  if(error)throw domainError(error,'source grouping review');
  return data;
}

/** Decide precisely which original business-source contact fields can be shown. */
export async function recordResearchContactReview(seedId,actor,payload={}){
  const id=normalizeSeedId(seedId);
  if(!actor?.userId||actor.authenticationMethod!=='session'||!actor.isVerified||
    !['admin','reviewer','platform_admin','super_admin'].includes(actor.platformRole))
    throw Object.assign(new Error('Independent verified reviewer required'),{statusCode:403});
  if(typeof payload.reason!=='string'||payload.reason.trim().length<80||
    payload.reason.length>3000)
    throw inputError('Source and public contact safety rationale requires at least 80 characters');
  const flags=['display_address','display_phone','display_website','retract'];
  for(const field of flags)if(typeof payload[field]!=='boolean')
    throw inputError('Explicit boolean display permissions required: '+field);
  await requireReviewerPassword(actor,null,payload.reviewer_password);
  const {data,error}=await supabase.rpc('dealer_record_research_contact_review',{
    p_seed_id:id,p_reviewer_id:actor.userId,p_reason:payload.reason.trim(),
    p_display_address:payload.display_address,p_display_phone:payload.display_phone,
    p_display_website:payload.display_website,p_retract:payload.retract,
  });
  if(error)throw domainError(error,'source contact review');
  return data;
}

/** Public visibility always follows current source-publication revision, not raw research. */
export async function getReviewedPublicResearchContacts(seedId){
  const profile=await getPublicResearch(seedId);
  if(!profile)return null;
  const {data,error}=await supabase.from('dealer_research_public_contact_events')
    .select('source_row_sha256,publication_revision,public_contact_state,public_address,public_business_phone,public_website,source_checked_at')
    .eq('seed_dealer_id',profile.seed_dealer_id)
    .order('source_checked_at',{ascending:false})
    .order('event_id',{ascending:false}).limit(1);
  if(error)throw domainError(error,'reviewed public business contact');
  const latest=data?.[0];
  if(!latest||latest.publication_revision!==profile.revision||
     latest.public_contact_state!=='DISPLAY_REVIEWED_FIELDS')
    return {seed_dealer_id:profile.seed_dealer_id,reviewed_public_address:null,
      reviewed_public_phone:null,reviewed_public_website:null,source_checked_at:null,
      business_verified:false};
  return {seed_dealer_id:profile.seed_dealer_id,
    reviewed_public_address:latest.public_address||null,
    reviewed_public_phone:latest.public_business_phone||null,
    reviewed_public_website:latest.public_website||null,
    source_checked_at:latest.source_checked_at,
    business_verified:false,logo_rights_approved:false,
    source_label:'Research source contact reviewed for limited display; legal business not independently verified'};
}

/**
 * A claim only creates an applicant-scoped PENDING_EVIDENCE record.
 * No direct role/tenant assignment, no review approval and no private seed disclosure.
 * This is NOT a completed secure claim or independent authority verification.
 */
export async function submitResearchClaim(seedId, actor, payload = {}) {
  const id = normalizeSeedId(seedId);
  if (!actor?.userId || actor.authenticationMethod !== 'session') {
    const error = new Error('A validated account session is required to claim');
    error.statusCode = 401;
    throw error;
  }
  const claimedScope = payload.claimed_scope;
  const relationship = payload.representative_relationship;
  const legalName = trim(payload.asserted_legal_business_name,180,2);
  const statement = trim(payload.claim_statement,2000,30);
  if (!SCOPES.has(claimedScope) || !RELATIONSHIPS.has(relationship)
      || !legalName || !statement) {
    throw inputError('Claim requires branch or parent scope, representative relationship, legal name and statement');
  }
  const listed = await getPublicResearch(id);
  if (!listed) {
    const error = new Error('Research listing unavailable or withheld');
    error.statusCode = 404;
    throw error;
  }
  const { data, error } = await supabase.from('dealer_research_claim_requests')
    .insert({
      seed_dealer_id: id, claimant_user_id: actor.userId,
      claimed_scope: claimedScope, representative_relationship: relationship,
      asserted_legal_business_name: legalName, claim_statement: statement,
    }).select('claim_id,seed_dealer_id,claimed_scope,claim_status,created_at').single();
  if (error?.code === '23505') {
    const conflict = new Error('A claim already exists for this account and research record');
    conflict.statusCode = 409;
    throw conflict;
  }
  if (error) throw domainError(error,'claim intake');
  return { ...data, authorization_granted: false, evidence_required: true,
    next_step: 'Provide original business-authority documents through a governed private evidence workflow. No dealership access has been granted.' };
}

export async function listOwnResearchClaims(actor) {
  if (!actor?.userId || actor.authenticationMethod !== 'session') {
    const error = new Error('A validated account session is required');
    error.statusCode = 401;
    throw error;
  }
  const { data, error } = await supabase.from('dealer_research_claim_requests')
    .select('claim_id,seed_dealer_id,claimed_scope,claim_status,created_at')
    .eq('claimant_user_id',actor.userId).order('created_at',{ ascending: false }).limit(50);
  if (error) throw domainError(error,'my claims');
  return data || [];
}

const CORRECTION_TYPES = new Set(['CORRECTION','REMOVAL','BUSINESS_CLOSED','IDENTITY_DISPUTE']);

/**
 * Guest and business correction/removal request intake. A complaint never auto-suppresses
 * an entity; it is queued for independent reviewer disposition, with private contact.
 */
export async function requestResearchCorrection(seedId, payload = {}) {
  const id = normalizeSeedId(seedId);
  const kind = payload.request_type;
  const reason = trim(payload.request_summary,2000,30);
  const email = payload.contact_email == null || payload.contact_email === ''
    ? null : trim(payload.contact_email,200);
  if (!CORRECTION_TYPES.has(kind) || !reason) {
    throw inputError('Correction requests require a valid request type and a factual explanation');
  }
  if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    throw inputError('Invalid correction contact email');
  }
  if (payload.contact_email && !email) throw inputError('Invalid correction contact email');
  // Do not leak a withheld/disputed source's existence through this endpoint.
  if (!await getPublicResearch(id)) {
    const error = new Error('Research listing unavailable');
    error.statusCode = 404;
    throw error;
  }
  const { data, error } = await supabase.from('dealer_research_correction_requests')
    .insert({ seed_dealer_id:id, request_type:kind, request_summary:reason, contact_email:email })
    .select('request_id,seed_dealer_id,request_type,status,created_at').single();
  if (error) throw domainError(error,'correction intake');
  return data;
}

export async function listResearchCorrectionsForReviewer(actor) {
  if (!actor?.userId || actor.authenticationMethod !== 'session' || !actor.isVerified
      || !['admin','reviewer','platform_admin','super_admin'].includes(actor.platformRole)) {
    const error = new Error('Independent session-verified reviewer required');
    error.statusCode = 403;
    throw error;
  }
  const { data, error } = await supabase.from('dealer_research_correction_requests')
    .select('request_id,seed_dealer_id,request_type,request_summary,contact_email,status,created_at')
    .order('created_at',{ ascending:false }).limit(100);
  if (error) throw domainError(error,'correction queue');
  return data || [];
}
