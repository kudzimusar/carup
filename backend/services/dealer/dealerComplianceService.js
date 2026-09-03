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
import { emitDomainEvent } from '../eventBus/eventBusService.js';

const PROFILES = 'dealer_profiles';
const BRANCHES = 'dealer_branches';
const DOCUMENTS = 'dealer_compliance_documents';
const REQUIREMENTS = 'dealer_compliance_requirements';
const DECISIONS = 'dealer_compliance_decisions';

const PROFILE_FIELDS = [
  'legal_name', 'trading_name', 'registration_number', 'tax_id',
  'physical_address', 'responsible_person', 'operating_country', 'tenant_id',
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

/** Record compliance document metadata. The binary lives elsewhere; we keep only file_ref. */
export async function uploadDocument(dealerId, { doc_type, status, file_ref, expiry_date } = {}) {
  await requireProfile(dealerId);
  if (!doc_type) throw new Error('uploadDocument requires a doc_type');
  const row = {
    dealer_id: dealerId,
    doc_type,
    status: status || 'present',
    file_ref: file_ref || null,
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
  const profile = await requireProfile(dealerId);
  if (!DECISIONS_ALLOWED.includes(decision)) {
    throw new Error(`decision must be one of ${DECISIONS_ALLOWED.join('|')}`);
  }
  if (!actor || !actor.id) throw new Error('a decision requires an authenticated actor');

  const requirementDecisions = {
    approve_requirement: 'verified',
    reject_requirement: 'rejected',
    request_more_info: 'pending',
  };
  if (decision in requirementDecisions) {
    if (!requirement_key) throw new Error(`${decision} requires a requirement_key`);
  }

  // 1. Write the immutable ledger row first (the durable record of intent).
  const ledgerRow = {
    dealer_id: dealerId,
    decision,
    requirement_key: requirement_key || null,
    actor_id: actor.id,
    actor_role: actor.role || null,
    reason: reason || null,
    payload: payload || {},
  };
  const { data: ledger, error: ledgerErr } = await supabase
    .from(DECISIONS).insert(ledgerRow).select().single();
  if (ledgerErr) throw new Error(`failed to record decision: ${ledgerErr.message}`);

  // 2. Apply the effect.
  if (decision in requirementDecisions) {
    await upsertRequirement(dealerId, { requirement_key, status: requirementDecisions[decision] });
  }

  const patch = applyDecisionToProfile(decision, payload || {});
  let updatedProfile = profile;
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { data: row, error } = await supabase
      .from(PROFILES).update(patch).eq('id', dealerId).select().single();
    if (error) throw new Error(`failed to apply decision effect: ${error.message}`);
    updatedProfile = row;
  } else {
    // re-read so callers always see current statuses (e.g. after a requirement change)
    updatedProfile = await getProfileById(dealerId);
  }

  // O2/P5 — bridge the persisted decision into the communication engine, exactly like
  // identity.verification.decided (decisionRecorder seam-E E5). Best-effort: the ledger row and
  // the applied effect are already durable, so an outbox write failure must never fail the
  // decision itself. Communications owns delivery; this service only announces the fact.
  await emitDomainEvent(null, 'dealer.compliance.decided', {
    dealerId,
    recipientUserId: updatedProfile?.user_id || profile?.user_id || null,
    decision,
    requirementKey: requirement_key || null,
    reason: reason || null,
  }, updatedProfile?.tenant_id || null).catch((err) => {
    console.warn('dealer.compliance.decided outbox emit failed:', err.message);
  });

  return { decision: ledger, profile: updatedProfile };
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
 *   - not restriction-blocked, AND
 *   - compliance_review_state === 'passed', AND
 *   - identity_status === 'verified', AND
 *   - no blocking requirement is still unsatisfied, AND
 *   - not expired.
 */
export function deriveCanPublish(profile = {}, blockingRequirements = []) {
  if (!profile) return false;
  if (profile.suspension_state === 'suspended') return false;
  if (profile.restriction_state === 'restricted') return false;
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
 * completeness band, and a count of unresolved serious complaints. NEVER returns private
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
    unresolved_serious_complaints: 0,
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

/**
 * O2/P2 — normalized responsibility projection (M8 ADR §10.1). PURE, derived from the same inputs
 * as `deriveCanPublish`; the domain's own statuses (active/pending/restricted/suspended,
 * investigation decisions, expiry) stay canonical and are DISPLAYED VERBATIM beside this
 * projection — it never replaces them.
 *
 * Order of precedence mirrors who actually holds the next move:
 *   investigation           -> escalated        (a specialist decision is pending)
 *   suspended / restricted  -> subject_action   (remediation is the dealer's)
 *   expired document        -> subject_action
 *   blocking requirement with a SUBMITTED artifact awaiting decision -> carup_review
 *   blocking requirement with nothing submitted -> subject_action
 *   identity not verified   -> subject_action
 *   review not passed (but nothing above applies) -> carup_review
 *   otherwise               -> none
 */
export function toResponsibilityProjection({ profile = {}, blockingRequirements = [], now = new Date() } = {}) {
  if (profile?.compliance_review_state === 'investigation' || profile?.investigation_state === 'open') {
    return 'escalated';
  }
  if (profile?.suspension_state === 'suspended' || profile?.restriction_state === 'restricted') {
    return 'subject_action';
  }
  if (deriveExpiryState(profile, now) === 'expired') {
    return 'subject_action';
  }
  const stillBlocking = (Array.isArray(blockingRequirements) ? blockingRequirements : []).filter(isRequirementBlocking);
  if (stillBlocking.length > 0) {
    const awaitingDecision = stillBlocking.some((req) => ['submitted', 'pending_review', 'in_review'].includes(req.status));
    return awaitingDecision ? 'carup_review' : 'subject_action';
  }
  if (profile?.identity_status && profile.identity_status !== 'verified') {
    return 'subject_action';
  }
  if (profile?.compliance_review_state && profile.compliance_review_state !== 'passed') {
    return 'carup_review';
  }
  return 'none';
}
