/**
 * Dealer Compliance & Trust service — Workstream B.
 *
 * Owns a dealer's business identity, compliance checklist, evidence metadata, and the
 * APPEND-ONLY governance decision ledger. Every administrative decision both records an
 * immutable ledger row AND applies its effect to the dealer's lifecycle statuses.
 *
 * Honesty guarantees:
 *   - A dealer carries EIGHT independent lifecycle statuses; this service never collapses
 *     them. `evaluateCompliance` reports each one, and `deriveCanPublish` (a pure function)
 *     refuses publication unless identity is verified, the compliance review passed, and the
 *     dealer is neither suspended nor restriction-blocked.
 *   - Governance decisions are written to dealer_compliance_decisions which is append-only at
 *     the database level (governance_block_mutation); a reversal is a NEW decision.
 *   - The buyer-safe summary exposes ONLY a coarse status + evidence completeness band; it
 *     never returns private documents, contacts, internal reasons, or raw decision payloads.
 */
import { supabase } from '../../db/supabase.js';
import { verifyPassword } from '../../utils/passwordAuth.js';

const PROFILES = 'dealer_profiles';
const BRANCHES = 'dealer_branches';
const DOCUMENTS = 'dealer_compliance_documents';
const REQUIREMENTS = 'dealer_compliance_requirements';
const DECISIONS = 'dealer_compliance_decisions';

const PROFILE_FIELDS = [
  'legal_name', 'trading_name', 'registration_number', 'tax_id',
  'physical_address', 'responsible_person', 'operating_country',
];

const DECISIONS_ALLOWED = [
  'approve_requirement', 'reject_requirement', 'request_more_info',
  'restrict', 'suspend', 'reinstate', 'set_expiry',
];

// ── profiles ────────────────────────────────────────────────────────────────────

/**
 * Create the dealer's profile if absent, otherwise patch the editable identity fields.
 * Lifecycle statuses are NEVER set here — only governance decisions move them.
 */
export async function createOrUpdateProfile(userId, data = {}) {
  if (!userId) throw new Error('createOrUpdateProfile requires a userId');
  const existing = await getProfileByUser(userId);
  const patch = {};
  for (const f of PROFILE_FIELDS) {
    if (data[f] !== undefined) patch[f] = data[f];
  }

  if (existing) {
    // Security review #6: once a profile is bound to an approved dealership claim, its business facts
    // change only through the canonical dealership workflows (versioned declarations, reviewed storefront),
    // never through this legacy route.
    const { data: link, error: linkError } = await supabase.from('dealer_approved_seed_links')
      .select('link_id').eq('dealer_profile_id', existing.id).maybeSingle();
    if (linkError) {
      const error = new Error('Dealer profile authority check unavailable');
      error.statusCode = 503;
      throw error;
    }
    if (link) {
      const error = new Error('Activated dealership profiles are edited through the dealership workspace');
      error.statusCode = 409;
      throw error;
    }
    // The applicant must never silently rewrite an identity previously independently verified.
    // Corrections must go through governance, and only the canonical activation authority
    // may assign tenant_id (never user-supplied profile data).
    if (existing.identity_status === 'verified' || existing.compliance_review_state === 'passed') {
      for (const immutableFact of ['legal_name','registration_number','tax_id','operating_country']) {
        if (patch[immutableFact] !== undefined && patch[immutableFact] !== existing[immutableFact]) {
          const error = new Error('Verified legal identity change requires independent correction review');
          error.statusCode = 409;
          throw error;
        }
      }
    }
    patch.updated_at = new Date().toISOString();
    const { data: row, error } = await supabase
      .from(PROFILES).update(patch).eq('id', existing.id).select().single();
    if (error) throw new Error(`failed to update dealer profile: ${error.message}`);
    return row;
  }

  const { data: row, error } = await supabase
    .from(PROFILES).insert({ user_id: userId, ...patch }).select().single();
  if (error) throw new Error(`failed to create dealer profile: ${error.message}`);
  return row;
}

async function getProfileByUser(userId) {
  const { data, error } = await supabase
    .from(PROFILES).select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`dealer profile lookup failed: ${error.message}`);
  return data || null;
}

async function getProfileById(dealerId) {
  const { data, error } = await supabase
    .from(PROFILES).select('*').eq('id', dealerId).maybeSingle();
  if (error) throw new Error(`dealer profile lookup failed: ${error.message}`);
  return data || null;
}

/**
 * Resolve a profile by its id (the profile UUID) or by the owning user_id. Tries id first,
 * then falls back to user_id, so it works whether the caller holds a dealer id or a user id.
 */
export async function getProfile(dealerOrUserId) {
  if (!dealerOrUserId) throw new Error('getProfile requires a dealerId or userId');
  const byId = await getProfileById(dealerOrUserId);
  if (byId) return byId;
  return getProfileByUser(dealerOrUserId);
}

async function requireProfile(dealerId) {
  const profile = await getProfileById(dealerId);
  if (!profile) throw new Error(`Dealer not found: ${dealerId}`);
  return profile;
}

/** Admin/government listing of dealer profiles, scoped by tenant when provided. */
export async function listProfiles({ tenantId } = {}) {
  let q = supabase.from(PROFILES).select('*');
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) throw new Error(`dealer profiles lookup failed: ${error.message}`);
  return data || [];
}

// ── branches ─────────────────────────────────────────────────────────────────────

export async function addBranch(dealerId, { name, address } = {}) {
  await requireProfile(dealerId);
  const { data, error } = await supabase
    .from(BRANCHES).insert({ dealer_id: dealerId, name: name || null, address: address || null })
    .select().single();
  if (error) throw new Error(`failed to add dealer branch: ${error.message}`);
  return data;
}

export async function listBranches(dealerId) {
  const { data, error } = await supabase
    .from(BRANCHES).select('*').eq('dealer_id', dealerId);
  if (error) throw new Error(`dealer branches lookup failed: ${error.message}`);
  return data || [];
}

// ── requirements ──────────────────────────────────────────────────────────────────

/** Insert or update a compliance requirement keyed by (dealer_id, requirement_key). */
export async function upsertRequirement(dealerId, { requirement_key, status, is_blocking } = {}) {
  await requireProfile(dealerId);
  if (!requirement_key) throw new Error('upsertRequirement requires a requirement_key');
  const existing = (await listRequirements(dealerId)).find((r) => r.requirement_key === requirement_key);

  if (existing) {
    const patch = { updated_at: new Date().toISOString() };
    if (status !== undefined) patch.status = status;
    if (is_blocking !== undefined) patch.is_blocking = is_blocking;
    const { data, error } = await supabase
      .from(REQUIREMENTS).update(patch).eq('id', existing.id).select().single();
    if (error) throw new Error(`failed to update requirement: ${error.message}`);
    return data;
  }

  const row = {
    dealer_id: dealerId,
    requirement_key,
    status: status || 'required',
    is_blocking: is_blocking !== undefined ? is_blocking : true,
  };
  const { data, error } = await supabase.from(REQUIREMENTS).insert(row).select().single();
  if (error) throw new Error(`failed to create requirement: ${error.message}`);
  return data;
}

export async function listRequirements(dealerId) {
  const { data, error } = await supabase
    .from(REQUIREMENTS).select('*').eq('dealer_id', dealerId);
  if (error) throw new Error(`requirements lookup failed: ${error.message}`);
  return data || [];
}

// ── documents (metadata only) ──────────────────────────────────────────────────────

/** Record unverified document-intake metadata only; a claimant cannot set verified or select arbitrary private storage refs. */
export async function uploadDocument(dealerId, { doc_type, expiry_date } = {}) {
  await requireProfile(dealerId);
  if (!doc_type) throw new Error('uploadDocument requires a doc_type');
  const row = {
    dealer_id: dealerId,
    doc_type,
    // The existing metadata route is NOT a governed Document Intelligence upload.
    // Until an owned private document is bound through that authority, no binary ref exists.
    status: 'pending',
    file_ref: null,
    expiry_date: expiry_date || null,
  };
  const { data, error } = await supabase.from(DOCUMENTS).insert(row).select().single();
  if (error) throw new Error(`failed to record document: ${error.message}`);
  return data;
}

export async function listDocuments(dealerId) {
  const { data, error } = await supabase
    .from(DOCUMENTS).select('*').eq('dealer_id', dealerId);
  if (error) throw new Error(`documents lookup failed: ${error.message}`);
  return data || [];
}

// ── governance decisions ────────────────────────────────────────────────────────────

/** Map a decision into the profile patch it implies. Pure — no I/O. */
export function applyDecisionToProfile(decision, payload = {}) {
  switch (decision) {
    case 'restrict':
      return { restriction_state: 'restricted' };
    case 'suspend':
      return { suspension_state: 'suspended', active_state: 'inactive' };
    case 'reinstate':
      return { suspension_state: 'none', restriction_state: 'none', active_state: 'active' };
    case 'set_expiry':
      return { expiry_date: payload.expiry_date || null };
    // approve_requirement / reject_requirement / request_more_info affect the requirement
    // row (handled separately), not the profile statuses directly.
    default:
      return {};
  }
}

/**
 * Record a governance decision (append-only) AND apply its effect.
 *   - approve_requirement -> the named requirement becomes 'verified'.
 *   - reject_requirement   -> the named requirement becomes 'rejected'.
 *   - request_more_info    -> the named requirement becomes 'pending'.
 *   - restrict/suspend/reinstate/set_expiry -> patch the profile lifecycle statuses.
 * @returns { decision, profile } the ledger row and the resulting profile.
 */
export async function recordDecision(dealerId, { decision, requirement_key, reason, payload } = {}, actor = {}) {
  // This legacy route is now a fail-closed façade over a single DB transaction.
  // Actor identity, role and step-up come from the authenticated server-side session
  // and password hash, never the client-provided governance payload.
  if (!DECISIONS_ALLOWED.includes(decision)) {
    throw new Error(`decision must be one of ${DECISIONS_ALLOWED.join('|')}`);
  }
  if (!actor?.id) throw new Error('a decision requires an authenticated actor');
  if (typeof reason !== 'string' || reason.trim().length < 40 || reason.length > 3000) {
    const error = new Error('A documented 40–3000 character independent decision reason is required');
    error.statusCode = 400;
    throw error;
  }
  if (['approve_requirement','reject_requirement','request_more_info'].includes(decision) &&
      (!requirement_key || typeof requirement_key !== 'string')) {
    throw new Error(`${decision} requires a requirement_key`);
  }
  if (actor.authenticationMethod !== 'session' || actor.isVerified !== true ||
      !['admin','reviewer','platform_admin','super_admin'].includes(actor.role)) {
    const error = new Error('Independent verified reviewer session is required');
    error.statusCode = 403;
    throw error;
  }
  if (typeof actor.reviewer_password !== 'string' || actor.reviewer_password.length < 8) {
    const error = new Error('Independent reviewer password reauthentication is required');
    error.statusCode = 403;
    throw error;
  }
  const [profile, { data: reviewer, error: reviewerErr }] = await Promise.all([
    requireProfile(dealerId),
    supabase.from('users').select('id,role,is_verified,password_hash')
      .eq('id',actor.id).maybeSingle(),
  ]);
  if (profile.user_id === actor.id || reviewerErr || !reviewer?.password_hash ||
      !reviewer.is_verified || !['admin','reviewer','platform_admin','super_admin'].includes(reviewer.role) ||
      !await verifyPassword(actor.reviewer_password,reviewer.password_hash)) {
    const error = new Error('Independent reviewer reauthentication failed');
    error.statusCode = 403;
    throw error;
  }
  // Do not permit a partial ledger write followed by a failed profile/requirement
  // update. Postgres executes all effects in one transaction, or none of them.
  const { data, error } = await supabase.rpc('dealer_record_atomic_compliance_decision', {
    p_dealer_id: dealerId, p_reviewer_id: actor.id, p_decision: decision,
    p_requirement_key: requirement_key || null, p_reason: reason.trim(),
    p_payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
  });
  if (error || !data?.audit_atomic || !data?.decision || !data?.profile) {
    const refused = new Error('Atomic dealer governance decision rejected; no state change confirmed');
    refused.statusCode = 409;
    throw refused;
  }
  return { decision: data.decision, profile: data.profile };
}
/** Full, immutable decision history for a dealer (admin/owner surface). */
export async function listDecisions(dealerId) {
  const { data, error } = await supabase
    .from(DECISIONS).select('*').eq('dealer_id', dealerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`decisions lookup failed: ${error.message}`);
  return data || [];
}

// ── evaluation (pure decision logic separately unit-testable) ────────────────────────

/**
 * PURE: given a profile and its blocking requirement statuses, decide whether the dealer
 * may publish listings. No I/O. A dealer can publish ONLY when:
 *   - not suspended, AND
 *   - not restriction-blocked or under investigation, AND
 *   - active_state === 'active', AND
 *   - compliance_review_state === 'passed', AND
 *   - identity_status === 'verified', AND
 *   - no blocking requirement is still unsatisfied, AND
 *   - not expired.
 */
export function deriveCanPublish(profile = {}, blockingRequirements = []) {
  if (!profile) return false;
  if (profile.suspension_state === 'suspended') return false;
  if (profile.restriction_state === 'restricted') return false;
  if (profile.investigation_state === 'under_investigation') return false;
  if (profile.active_state !== 'active') return false;
  if (profile.compliance_review_state !== 'passed') return false;
  if (profile.identity_status !== 'verified') return false;
  if (deriveExpiryState(profile) === 'expired') return false;
  if (Array.isArray(blockingRequirements) && blockingRequirements.length > 0) return false;
  return true;
}

/** PURE: classify a profile's expiry. */
export function deriveExpiryState(profile = {}, now = new Date()) {
  if (!profile || !profile.expiry_date) return 'none';
  return new Date(profile.expiry_date).getTime() < now.getTime() ? 'expired' : 'valid';
}

/** PURE: a requirement still blocks if it is blocking and not yet verified/not_applicable. */
export function isRequirementBlocking(req) {
  if (!req || !req.is_blocking) return false;
  return !['verified', 'not_applicable'].includes(req.status);
}

/**
 * Evaluate a dealer's full compliance posture. Reports every independent status and the
 * derived publish gate. The decision logic itself is the pure `deriveCanPublish`.
 */
export async function evaluateCompliance(dealerId) {
  const profile = await requireProfile(dealerId);
  const requirements = await listRequirements(dealerId);
  const blocking_requirements = requirements
    .filter(isRequirementBlocking)
    .map((r) => r.requirement_key);

  return {
    dealer_id: dealerId,
    identity_status: profile.identity_status,
    business_evidence_status: profile.business_evidence_status,
    compliance_review_state: profile.compliance_review_state,
    active_state: profile.active_state,
    restriction_state: profile.restriction_state,
    suspension_state: profile.suspension_state,
    investigation_state: profile.investigation_state,
    expiry_state: deriveExpiryState(profile),
    listing_limit: profile.listing_limit,
    blocking_requirements,
    can_publish: deriveCanPublish(profile, blocking_requirements),
  };
}

// ── buyer-safe summary ────────────────────────────────────────────────────────────

/** PURE: map a profile's lifecycle statuses to a single coarse buyer-facing status. */
export function deriveBuyerStatus(profile = {}) {
  if (profile.suspension_state === 'suspended') return 'suspended';
  if (profile.restriction_state === 'restricted') return 'restricted';
  return profile.active_state === 'active' ? 'active' : 'restricted';
}

/** PURE: bucket how complete a dealer's evidence is into a coarse band. */
export function deriveEvidenceBand(profile = {}, requirements = []) {
  if (profile.business_evidence_status === 'complete') return 'high';
  const total = requirements.length;
  if (total === 0) return 'low';
  const satisfied = requirements.filter((r) => ['verified', 'present', 'not_applicable'].includes(r.status)).length;
  const ratio = satisfied / total;
  if (ratio >= 0.66) return 'high';
  if (ratio >= 0.33) return 'medium';
  return 'low';
}

/**
 * Buyer-safe summary. Returns ONLY a coarse status, the compliance review date, an evidence
 * completeness band, and a nullable unresolved-serious-complaints measurement. NEVER returns private
 * documents, contacts, internal notes, reasons, or raw decision payloads.
 */
export async function getBuyerSafeSummary(dealerId) {
  const profile = await requireProfile(dealerId);
  const requirements = await listRequirements(dealerId);

  // compliance_review_date: when the review last reached a terminal state (best-effort:
  // the most recent governance decision timestamp, else the profile's updated_at).
  const decisions = await listDecisions(dealerId);
  const compliance_review_date =
    (decisions[0] && decisions[0].created_at) ||
    (profile.compliance_review_state !== 'not_started' ? profile.updated_at : null);

  return {
    status: deriveBuyerStatus(profile),
    compliance_review_date: compliance_review_date || null,
    evidence_completeness_band: deriveEvidenceBand(profile, requirements),
    // No authoritative complaints counter is joined in this lineage. Unknown is NOT zero.
    // Wire only transaction-backed, correctly scoped complaint evidence in a separately reviewed change.
    unresolved_serious_complaints: null,
  };
}

export default {
  createOrUpdateProfile,
  getProfile,
  listProfiles,
  addBranch,
  listBranches,
  upsertRequirement,
  listRequirements,
  uploadDocument,
  listDocuments,
  recordDecision,
  listDecisions,
  applyDecisionToProfile,
  evaluateCompliance,
  deriveCanPublish,
  deriveExpiryState,
  isRequirementBlocking,
  deriveBuyerStatus,
  deriveEvidenceBand,
  getBuyerSafeSummary,
};
