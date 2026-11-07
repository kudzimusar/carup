/**
 * CARUP-DEALER-ONB-001 D1/D2/D4/R5 — research prelisting (not dealer compliance).
 * A private research row is never a company/tenant, dealer stock, role or verification.
 * Public response is an explicit allowlist. No raw source_snapshot or private contacts.
 *
 * R5 additions:
 *  - S08: directory multi-record browse & filtering by category, verification tier, city, and query,
 *    with truthful counts, empty states, and explicit non-publication of the 104 real records.
 *  - T42: customer/business source correction & takedown reviewer disposition with atomic
 *    publication withdrawal (`dealer_review_research_correction_request`).
 *  - S09: governed duplicate research reconciliation & stable canonical URL redirect
 *    (`dealer_reconcile_duplicate_research_seed` + `getPublicResearchDuplicateRedirect`),
 *    preserving source/claim/legal custody and blocking hostile takeover.
 */
import { supabase } from '../../db/supabase.js';
import { requireReviewerPassword } from './dealerClaimApplicationService.js';
import { getReviewedFullStorefront, listReviewedFullStorefronts } from './dealerFullStorefrontService.js';
import { mapDealerSqlRefusal } from './dealerSqlRefusalMapper.js';
import { loadReviewerConflicts } from './dealerReviewerConflicts.js';

export const PUBLIC_STATUS = 'PRELISTED_UNCLAIMED';
/**
 * R6 round 2 (#2): every public research read goes through this read-time gated view
 * (20261103146000): PRELISTED_UNCLAIMED AND (fictional CI fixture OR a live Owner O12 policy whose
 * approver is not the publishing reviewer). A real seed prelisted before R6, or under a policy that
 * has since been suspended or expired, is therefore not public — without mutating any row.
 * Claims, corrections, contact display and duplicate redirects all resolve through getPublicResearch.
 */
export const PUBLIC_PROFILE_SOURCE = 'dealer_research_public_profiles_current';
export const PUBLIC_COLUMNS =
  'seed_dealer_id,public_slug,public_name,public_city,public_research_category,source_attribution,publication_status,reviewed_at,revision';
export const PUBLIC_RESEARCH_TIERS = Object.freeze([
  'PRELISTED_UNCLAIMED',
  'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED',
  'FULL_DEALER_APPROVED',
]);
export const PUBLIC_RESEARCH_CATEGORIES = Object.freeze([
  'Vehicle sales (research category)',
  'Vehicle imports (research category)',
  'Vehicle sales and services (research category)',
  'Commercial vehicles (research category)',
  'Automotive marketplace (research category)',
  'Automotive assembly (research category)',
  'Compliance-approved dealership (no OEM affiliation implied)',
]);

const DECISIONS = new Set([PUBLIC_STATUS, 'WITHHELD', 'SUPPRESSED', 'DUPLICATE', 'UNDER_DISPUTE']);
const CORRECTION_DECISIONS = new Set([
  'RESOLVED_SUPPRESSED',
  'RESOLVED_WITHHELD',
  'RESOLVED_UNDER_DISPUTE',
  'REJECTED_NO_CHANGE',
]);
const RELATIONSHIPS = new Set([
  'LEGAL_OWNER','DIRECTOR','AUTHORIZED_REPRESENTATIVE','BRANCH_MANAGER','PARENT_DELEGATE',
]);
const SCOPES = new Set(['BRANCH','PARENT_ORGANIZATION']);
const SEED_ID = /^ZW-DEAL-\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSeedId(value) {
  if (typeof value !== 'string' || !SEED_ID.test(value)) {
    const error = new Error('Invalid research seed reference');
    error.statusCode = 400;
    error.code = 'INVALID_RESEARCH_SEED_ID';
    throw error;
  }
  return value;
}
function inputError(message, code = 'INVALID_RESEARCH_INPUT') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}
function domainError(error, operation) {
  const result = new Error(operation + ' unavailable; no state change is confirmed');
  result.statusCode = 503;
  result.code = 'DEALER_RESEARCH_UNAVAILABLE';
  result.cause = error;
  return result;
}
function trim(value, maximum, minimum = 0) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= minimum && text.length <= maximum ? text : null;
}

/** A private source record can NEVER be projected by this function. */
export function publicResearchProjection(row, approvedFull = null, approvedClaimExists = false) {
  if (!row || row.publication_status !== PUBLIC_STATUS) return null;
  if (approvedFull) return Object.freeze({
    ...approvedFull, source_attribution:row.source_attribution,
    source_research_category:row.public_research_category,
    source_reviewed_at:row.reviewed_at,
  });
  return Object.freeze({
    // Research-publication status alone is NOT claim status. A full-storefront
    // review may be retracted or current legal policy may expire without
    // revoking an already approved claimant's exclusive authority.
    // Never re-advertise an existing claimed business as "unclaimed".
    tier:approvedClaimExists?'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED':'PRELISTED_UNCLAIMED',
    seed_dealer_id: row.seed_dealer_id,
    slug: row.public_slug,
    name: row.public_name,
    city: row.public_city,
    category: row.public_research_category,
    source_attribution: row.source_attribution,
    reviewed_at: row.reviewed_at,
    revision: row.revision,
    claimed: approvedClaimExists,
    business_verified: false,
    label: approvedClaimExists
      ?'Existing approved claim — No current independently verified storefront'
      :'Unclaimed — Not independently business-verified',
    information_notice: approvedClaimExists
      ?'A previously approved claimant exists, but current legal, operating or public-display approval cannot be inferred. No new self-service claim, licence verification, vehicle selling or payment authority is available. Contact CarUp for a separate dispute or transfer review.'
      :'CarUp research information may be outdated. This is not a dealer endorsement.',
  });
}

/**
 * Public-safe EXISTENCE only: do not return a claimant ID, email, evidence,
 * legal name or reviewer data. This prevents an approved company from being
 * called "unclaimed" after retraction/expiry of its full public display.
 * Errors are fatal, not silently mapped to "unclaimed" (fail closed).
 */
export async function approvedResearchClaimIds(ids,{db=supabase}={}){
  if(!Array.isArray(ids)||ids.length>50||
    ids.some(id=>typeof id!=='string'||!SEED_ID.test(id)))
    throw inputError('Invalid public claim-state lookup');
  if(!ids.length)return new Set();
  const {data,error}=await db.from('dealer_research_claim_requests')
    .select('seed_dealer_id')
    .in('seed_dealer_id',ids).eq('claim_status','CLAIM_APPROVED');
  if(error||!Array.isArray(data))throw domainError(error,'public-safe existing claim-state read');
  return new Set(data.map(row=>row.seed_dealer_id).filter(id=>ids.includes(id)));
}

export async function listPublicResearch({ q, city, category, tier, page = 1, limit = 30 } = {}) {
  const pageNumber = Math.max(1, Math.min(Number(page) || 1, 100));
  const pageSize = Math.max(1, Math.min(Number(limit) || 30, 50));
  const offset = (pageNumber - 1) * pageSize;

  const cityFilter = city ? trim(city, 80, 1) : null;
  if (city && !cityFilter) throw inputError('Invalid city search', 'INVALID_CITY_FILTER');

  const query = q ? trim(q, 80, 1) : null;
  if (q && !query) throw inputError('Invalid search term', 'INVALID_SEARCH_QUERY');

  const categoryFilter = category ? trim(category, 120, 2) : null;
  if (category && !categoryFilter) throw inputError('Invalid category filter', 'INVALID_CATEGORY_FILTER');

  const tierFilter = tier ? trim(tier, 64, 2) : null;
  if (tier && (!tierFilter || !PUBLIC_RESEARCH_TIERS.includes(tierFilter))) {
    throw inputError('Invalid verification tier filter', 'INVALID_TIER_FILTER');
  }

  let request = supabase.from(PUBLIC_PROFILE_SOURCE)
    .select(PUBLIC_COLUMNS, { count: 'exact' })
    .eq('publication_status', PUBLIC_STATUS)
    .order('public_name', { ascending: true });

  if (cityFilter) request = request.eq('public_city', cityFilter);
  if (query) {
    // Escape PostgREST LIKE wildcards so a visitor cannot change query semantics.
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    request = request.ilike('public_name', '%' + escaped + '%');
  }
  if (categoryFilter && categoryFilter !== 'Compliance-approved dealership (no OEM affiliation implied)'
      && typeof request.eq === 'function') {
    request = request.eq('public_research_category', categoryFilter);
  }
  request = request.range(offset, offset + pageSize - 1);

  const { data, count, error } = await request;
  if (error) throw domainError(error,'research directory');
  // A full storefront is visible ONLY through the live legal/tenant/policy-safe
  // database view. One batched read avoids per-profile private table exposure.
  const ids=(data||[]).map(r=>r.seed_dealer_id);
  const [approved,claimed]=await Promise.all([
    listReviewedFullStorefronts(ids),approvedResearchClaimIds(ids)]);
  let entries = (data||[]).map(row=>publicResearchProjection(
    row,approved.get(row.seed_dealer_id)||null,claimed.has(row.seed_dealer_id)))
    .filter(Boolean);

  if (tierFilter) {
    entries = entries.filter((item) => item.tier === tierFilter);
  }
  if (categoryFilter) {
    entries = entries.filter((item) =>
      item.category === categoryFilter || item.source_research_category === categoryFilter);
  }

  const computedTotal = (tierFilter || categoryFilter === 'Compliance-approved dealership (no OEM affiliation implied)')
    ? entries.length
    : (Number.isInteger(count) ? count : entries.length);

  return {
    entries,
    total: computedTotal,
    page: pageNumber,
    limit: pageSize,
    filters_applied: {
      q: query,
      city: cityFilter,
      category: categoryFilter,
      tier: tierFilter,
    },
    available_tiers: PUBLIC_RESEARCH_TIERS,
    available_categories: PUBLIC_RESEARCH_CATEGORIES,
    real_104_records_published_claim: false,
  };
}

export async function getPublicResearch(seedId) {
  const id = normalizeSeedId(seedId);
  const { data, error } = await supabase.from(PUBLIC_PROFILE_SOURCE)
    .select(PUBLIC_COLUMNS).eq('seed_dealer_id', id)
    .eq('publication_status',PUBLIC_STATUS).maybeSingle();
  if (error) throw domainError(error,'research profile');
  if (!data) return null;
  const [full,claimed]=await Promise.all([
    getReviewedFullStorefront(id),approvedResearchClaimIds([id])]);
  return publicResearchProjection(data,full,claimed.has(id));
}

/**
 * S09: Resolve a governed duplicate research seed redirect only when the canonical target
 * is currently published. Never merges legal entities or transfers claims.
 */
export async function getPublicResearchDuplicateRedirect(seedId, {
  db = supabase,
  silentOnMissingTable = false,
} = {}) {
  const id = normalizeSeedId(seedId);
  let redirectRow = null;
  try {
    const { data, error } = await db.from('dealer_research_duplicate_redirects')
      .select('redirect_id,duplicate_seed_dealer_id,canonical_seed_dealer_id,canonical_slug,reconciled_at,source_custody_preserved,legal_entity_merged')
      .eq('duplicate_seed_dealer_id', id)
      .maybeSingle();
    if (error) {
      if (silentOnMissingTable) return null;
      throw domainError(error, 'duplicate redirect lookup');
    }
    redirectRow = data;
  } catch (err) {
    if (silentOnMissingTable) return null;
    throw err;
  }
  if (!redirectRow) return null;
  const canonicalProfile = await getPublicResearch(redirectRow.canonical_seed_dealer_id);
  if (!canonicalProfile) return null;
  return Object.freeze({
    redirect_id: redirectRow.redirect_id,
    duplicate_seed_dealer_id: redirectRow.duplicate_seed_dealer_id,
    canonical_seed_dealer_id: redirectRow.canonical_seed_dealer_id,
    canonical_slug: redirectRow.canonical_slug,
    canonical_path: `/dealers/${redirectRow.canonical_slug}`,
    canonical_name: canonicalProfile.name,
    canonical_city: canonicalProfile.city,
    canonical_tier: canonicalProfile.tier,
    reconciled_at: redirectRow.reconciled_at,
    source_custody_preserved: true,
    legal_entity_merged: false,
    reason_code: 'RECONCILED_DUPLICATE_RESEARCH_RECORD',
  });
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
  if (error) throw mapDealerSqlRefusal(error, 'research review');
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
  if(error)throw mapDealerSqlRefusal(error,'source grouping review');
  return data;
}

/**
 * S09: Governed duplicate research reconciliation & canonical URL redirect.
 * Marks the duplicate seed as DUPLICATE, records the redirect to the published canonical seed,
 * preserves source/claim/legal custody on both seeds, and refuses if the duplicate seed has
 * any existing claim or approved legal custody.
 */
export async function reconcileDuplicateResearchSeed(seedId, actor, payload = {}) {
  const duplicateId = normalizeSeedId(seedId);
  if (!actor?.userId || actor.authenticationMethod !== 'session' || !actor.isVerified
      || !['admin', 'reviewer', 'platform_admin', 'super_admin'].includes(actor.platformRole)) {
    throw Object.assign(new Error('Independent verified reviewer required'), { statusCode: 403 });
  }
  const canonicalId = normalizeSeedId(payload?.canonical_seed_dealer_id);
  if (duplicateId === canonicalId) {
    throw inputError('Duplicate seed cannot redirect to itself', 'SELF_DUPLICATE_REDIRECT_REFUSED');
  }
  const reason = trim(payload?.reason, 3000, 60);
  if (!reason) {
    throw inputError('Documented duplicate reconciliation rationale (60–3000 characters) required',
      'DUPLICATE_RECONCILIATION_REASON_REQUIRED');
  }
  await requireReviewerPassword(actor, null, payload?.reviewer_password);
  const { data, error } = await supabase.rpc('dealer_reconcile_duplicate_research_seed', {
    p_duplicate_seed_id: duplicateId,
    p_canonical_seed_id: canonicalId,
    p_reviewer_id: actor.userId,
    p_reason: reason,
  });
  if (error) throw mapDealerSqlRefusal(error, 'duplicate research reconciliation');
  return Object.freeze(data);
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
  if(error)throw mapDealerSqlRefusal(error,'source contact review');
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
    const redirect = await getPublicResearchDuplicateRedirect(id, { silentOnMissingTable: true });
    if (redirect) {
      const dupErr = new Error(
        `Research record reconciled as a duplicate of ${redirect.canonical_seed_dealer_id}; submit claims on the canonical profile`
      );
      dupErr.statusCode = 409;
      dupErr.code = 'DUPLICATE_SEED_REDIRECTED_TO_CANONICAL';
      throw dupErr;
    }
    const error = new Error('Research listing unavailable or withheld');
    error.statusCode = 404;
    throw error;
  }
  if(listed.claimed){
    const error=new Error('An approved claim already exists. A new owner requires independent transfer or dispute review.');
    error.statusCode=409;throw error;
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
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
    .select('request_id,seed_dealer_id,request_type,request_summary,contact_email,status,created_at,reviewed_at,reviewed_by,resolution_event_id')
    .order('created_at',{ ascending:false }).limit(100);
  if (error) throw domainError(error,'correction queue');
  // R6 closure: requests (incl. takedowns/disputes and their contact e-mail) about a business the
  // reviewer claims or works for are never shown to that reviewer.
  const conflicts = await loadReviewerConflicts(actor);
  return (data || []).filter((r) => !conflicts.conflicted(r.seed_dealer_id));
}

/**
 * T42: Independent reviewer disposition for a source correction or takedown request.
 * Requires verified platform reviewer + password step-up + 60–3000 character rationale.
 * When RESOLVED_SUPPRESSED / RESOLVED_WITHHELD / RESOLVED_UNDER_DISPUTE is chosen,
 * the SQL RPC atomically updates `dealer_research_public_profiles.publication_status`,
 * immediately withdrawing the record from public directory and profile reads.
 */
export async function reviewResearchCorrectionRequest(requestId, actor, payload = {}) {
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    throw inputError('Invalid correction request reference', 'INVALID_CORRECTION_REQUEST_ID');
  }
  if (!actor?.userId || actor.authenticationMethod !== 'session' || !actor.isVerified
      || !['admin', 'reviewer', 'platform_admin', 'super_admin'].includes(actor.platformRole)) {
    const error = new Error('Independent session-verified reviewer required');
    error.statusCode = 403;
    error.code = 'INDEPENDENT_CORRECTION_REVIEWER_REQUIRED';
    throw error;
  }
  if (!CORRECTION_DECISIONS.has(payload?.decision)) {
    throw inputError('Unsupported correction review decision', 'INVALID_CORRECTION_REVIEW_DECISION');
  }
  const reason = trim(payload?.reason, 3000, 60);
  if (!reason) {
    throw inputError('A documented correction/takedown review rationale (60–3000 characters) is required',
      'CORRECTION_REVIEW_REASON_REQUIRED');
  }
  await requireReviewerPassword(actor, null, payload?.reviewer_password);
  const { data, error } = await supabase.rpc('dealer_review_research_correction_request', {
    p_request_id: requestId,
    p_reviewer_id: actor.userId,
    p_decision: payload.decision,
    p_reason: reason,
  });
  if (error) throw mapDealerSqlRefusal(error, 'correction request review');
  return Object.freeze(data);
}
