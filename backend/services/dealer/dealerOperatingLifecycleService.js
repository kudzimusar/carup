/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-3 (C12): governed dealership operating lifecycle.
 * An independent, password-stepped-up reviewer records SUSPEND / OPEN_INVESTIGATION /
 * CLOSE_INVESTIGATION / REINSTATE / RENEW / WITHDRAW through ONE guarded SQL function
 * (20261103142000). The service never changes listings, storefronts or payments itself; the data
 * layer withdraws public stock whenever authority stops being current and never republishes it.
 */
import { supabase } from '../../db/supabase.js';
import { requireIndependentReviewer, requireReviewerPassword } from './dealerClaimApplicationService.js';
import { rpcWithTransientRetry } from './dealerTransientSqlRetry.js';

const refuse = (code, status = 400) => Object.assign(new Error(code), { statusCode: status, code });
const SEED = /^ZW-DEAL-\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const OPERATING_LIFECYCLE_ACTIONS = Object.freeze([
  'SUSPEND', 'OPEN_INVESTIGATION', 'CLOSE_INVESTIGATION', 'REINSTATE', 'RENEW', 'WITHDRAW',
]);
const SQL_REFUSALS = Object.freeze({
  INDEPENDENT_LIFECYCLE_REVIEWER_REQUIRED: 403,
  REINSTATEMENT_REQUIRES_DIFFERENT_REVIEWER: 403,
  APPROVED_DEALER_LINK_REQUIRED: 404,
  INVALID_OPERATING_LIFECYCLE_ACTION: 400,
  OPERATING_LIFECYCLE_REASON_REQUIRED: 400,
  ONLY_ACTIVE_DEALER_CAN_BE_SUSPENDED: 409,
  INVESTIGATION_REQUIRES_ACTIVE_UNFLAGGED_DEALER: 409,
  NO_OPEN_INVESTIGATION: 409,
  ONLY_SUSPENDED_DEALER_CAN_BE_REINSTATED: 409,
  REVOKED_CLAIM_REQUIRES_NEW_CLAIM: 409,
  REINSTATEMENT_REQUIRES_CURRENT_LEGAL_AND_POLICY: 409,
  WITHDRAWN_DEALER_CANNOT_RENEW: 409,
  NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED: 409,
  RENEWAL_REQUIRES_CURRENT_COUNTRY_POLICY: 409,
  DEALER_ALREADY_WITHDRAWN: 409,
  WITHDRAWN_DEALER_CANNOT_BE_REINSTATED: 409,
  RENEWAL_REQUIRES_SEPARATE_REVIEWER: 403,
  RENEWAL_MUST_BE_SAME_REGISTERED_COMPANY: 409,
  // R6 #7: data-layer conflict-of-interest guard (own claim on the seed / dealer tenant member).
  DEALER_REVIEWER_CONFLICT_OF_INTEREST: 403,
  // R6 round 2: closing an investigation is dual control (never the reviewer who opened it).
  CLOSE_INVESTIGATION_REQUIRES_DIFFERENT_REVIEWER: 403,
});

export function mapLifecycleSqlError(error) {
  const text = String(error?.message || '');
  for (const [code, status] of Object.entries(SQL_REFUSALS)) if (text.includes(code)) return refuse(code, status);
  return refuse('DEALER_OPERATING_LIFECYCLE_UNAVAILABLE', 503);
}

export function parseLifecycleDecision(body = {}) {
  const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (!OPERATING_LIFECYCLE_ACTIONS.includes(action)) throw refuse('INVALID_OPERATING_LIFECYCLE_ACTION');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 40 || reason.length > 3000) throw refuse('OPERATING_LIFECYCLE_REASON_REQUIRED');
  let newLegal = null;
  if (action === 'RENEW') {
    newLegal = typeof body.new_legal_review_id === 'string' ? body.new_legal_review_id.trim() : '';
    if (!UUID_RE.test(newLegal)) throw refuse('NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED', 409);
  }
  return Object.freeze({ action, reason, new_legal_review_id: newLegal });
}

async function loadLink(db, seedId) {
  if (typeof seedId !== 'string' || !SEED.test(seedId)) throw refuse('INVALID_RESEARCH_ID');
  const { data, error } = await db.from('dealer_approved_seed_links')
    .select('link_id,seed_dealer_id,tenant_id,claimant_user_id,operating_status,legal_review_id')
    .eq('seed_dealer_id', seedId).maybeSingle();
  if (error) throw refuse('APPROVED_DEALER_LOOKUP_UNAVAILABLE', 503);
  if (!data) throw refuse('APPROVED_DEALER_LINK_REQUIRED', 404);
  return data;
}

/**
 * R6 closure (security): the reviewer's own conflicts — tenant memberships and research claims —
 * so a reviewer who works for (or claims) a dealership never reads its lifecycle history or
 * reasons, nor sees it in the queue. The data layer separately refuses their DECISIONS (145000).
 */
async function reviewerConflicts(db, actor) {
  const [members, claims] = await Promise.all([
    db.from('tenant_users').select('tenant_id').eq('user_id', actor.userId).limit(500),
    db.from('dealer_research_claim_requests').select('seed_dealer_id').eq('claimant_user_id', actor.userId).limit(500),
  ]);
  if (members.error || claims.error) throw refuse('DEALER_OPERATING_LIFECYCLE_UNAVAILABLE', 503);
  const ids = (rows, key) => new Set((Array.isArray(rows) ? rows : [])
    .map((r) => r?.[key]).filter((v) => typeof v === 'string' && v.length > 0));
  return { tenants: ids(members.data, 'tenant_id'), seeds: ids(claims.data, 'seed_dealer_id') };
}

export async function recordOperatingLifecycleDecision(seedId, actor, body = {}, {
  db = supabase, independent = requireIndependentReviewer, stepUp = requireReviewerPassword, retry = {},
} = {}) {
  const decision = parseLifecycleDecision(body);
  independent(actor, '');
  const link = await loadLink(db, seedId);
  independent(actor, link.claimant_user_id);
  await stepUp(actor, { claimant_user_id: link.claimant_user_id }, body.reviewer_password);
  // One whole-transaction RPC (decision + withdrawal + append-only event, or nothing): retried
  // only if PostgreSQL rolled it back as a deadlock/serialisation victim; refusals are final.
  const { data, error } = await rpcWithTransientRetry(db, 'dealer_record_operating_lifecycle_decision', {
    p_seed_dealer_id: seedId, p_reviewer_id: actor.userId, p_action: decision.action,
    p_reason: decision.reason, p_new_legal_review_id: decision.new_legal_review_id,
  }, retry);
  if (error) throw mapLifecycleSqlError(error);
  if (!data || data.seed_dealer_id !== seedId || data.action !== decision.action
      || data.listings_republished !== false || data.payment_entitlement_changed !== false) {
    throw refuse('DEALER_OPERATING_LIFECYCLE_READBACK_FAILED', 503);
  }
  return Object.freeze(data);
}

/**
 * R6 E: the workbench's OWN queue — every activated dealership and its operating status
 * (it previously borrowed the full-storefront queue, which omits dealers without a
 * storefront case). A reviewer never sees a dealership they claimed themselves.
 */
export async function listOperatingLifecycleCases(actor, { db = supabase, independent = requireIndependentReviewer } = {}) {
  independent(actor, '');
  const { data, error } = await db.from('dealer_approved_seed_links')
    .select('seed_dealer_id,tenant_id,operating_status,activated_at,claimant_user_id')
    .order('activated_at', { ascending: false }).limit(200);
  if (error || !Array.isArray(data)) throw refuse('DEALER_OPERATING_LIFECYCLE_UNAVAILABLE', 503);
  const conflicts = await reviewerConflicts(db, actor);
  return data.filter((c) => c.claimant_user_id !== actor.userId && SEED.test(c.seed_dealer_id)
      && !conflicts.tenants.has(c.tenant_id) && !conflicts.seeds.has(c.seed_dealer_id))
    .map((c) => Object.freeze({ seed_dealer_id: c.seed_dealer_id, operating_status: c.operating_status,
      activated_at: c.activated_at }));
}

/** Newer, unexpired independent legal reviews for the same claimant: RENEW targets (no ID pasting). */
async function renewalCandidates(db, link) {
  const { data: current } = await db.from('dealer_legal_application_reviews')
    .select('created_at').eq('legal_review_id', link.legal_review_id).maybeSingle();
  if (!current?.created_at) return [];
  const { data, error } = await db.from('dealer_legal_application_reviews')
    .select('legal_review_id,created_at,legal_expires_at,approved_scope,claimant_user_id')
    .eq('claimant_user_id', link.claimant_user_id)
    .gt('created_at', current.created_at)
    .gt('legal_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(10);
  if (error || !Array.isArray(data)) return [];
  return data.filter((r) => UUID_RE.test(r.legal_review_id) && r.claimant_user_id === link.claimant_user_id)
    .map((r) => Object.freeze({ legal_review_id: r.legal_review_id, reviewed_at: r.created_at,
      legal_expires_at: r.legal_expires_at, approved_scope: r.approved_scope }));
}

export async function readOperatingLifecycle(seedId, actor, { db = supabase, independent = requireIndependentReviewer } = {}) {
  independent(actor, '');
  const link = await loadLink(db, seedId);
  independent(actor, link.claimant_user_id);
  const conflicts = await reviewerConflicts(db, actor);
  if ((link.tenant_id && conflicts.tenants.has(link.tenant_id)) || conflicts.seeds.has(link.seed_dealer_id))
    throw refuse('DEALER_REVIEWER_CONFLICT_OF_INTEREST', 403);
  const { data, error } = await db.from('dealer_operating_lifecycle_events')
    .select('event_id,action,previous_operating_status,next_operating_status,public_listings_withdrawn,created_at,reviewer_user_id,reason')
    .eq('link_id', link.link_id).order('created_at', { ascending: false }).limit(50);
  if (error || !Array.isArray(data)) throw refuse('DEALER_OPERATING_LIFECYCLE_UNAVAILABLE', 503);
  return Object.freeze({
    seed_dealer_id: link.seed_dealer_id,
    operating_status: link.operating_status,
    renewal_candidates: await renewalCandidates(db, link),
    events: data.map((e) => Object.freeze({
      event_id: e.event_id, action: e.action, previous_operating_status: e.previous_operating_status,
      next_operating_status: e.next_operating_status, public_listings_withdrawn: e.public_listings_withdrawn,
      created_at: e.created_at, recorded_by_this_reviewer: e.reviewer_user_id === actor.userId,
      // R6: the next independent reviewer must see WHY (reviewer-only route; never shown to the dealer).
      reason: typeof e.reason === 'string' ? e.reason.slice(0, 3000) : null,
    })),
  });
}
