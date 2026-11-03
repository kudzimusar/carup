/**
 * CARUP-DEALER-ONB-001 D1/D2/D4 — research prelisting (not dealer compliance).
 * A private research row is never a company/tenant, dealer stock, role or verification.
 * Public response is an explicit allowlist. No raw source_snapshot or private contacts.
 */
import { supabase } from '../../db/supabase.js';

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
  const reason = trim(data?.reason, 3000, 25);
  if (!reason) throw inputError('A documented source/eligibility review reason is required');
  const { data: recorded, error } = await supabase.rpc('dealer_record_research_publication_review', {
    p_seed_dealer_id: id,
    p_reviewer_id: actor.userId,
    p_decision: data.decision,
    p_reason: reason,
  });
  if (error) throw domainError(error,'research review');
  return recorded;
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
