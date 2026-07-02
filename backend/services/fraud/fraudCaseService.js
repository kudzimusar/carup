/**
 * Fraud Case Service — Workstream A.
 *
 * Read + governed-mutation surface over fraud_cases. The investigation queue, the
 * single-case view (with its signals + append-only event trail), and the resolution action.
 *
 * Governance guarantees:
 *   - Every action that changes a case writes an append-only fraud_case_events row carrying
 *     the actor + reason. The case status is the ONLY mutable field touched.
 *   - resolveCase() additionally writes an append-only fraud_case_resolutions row.
 *   - 'identity_merge_approved' NEVER auto-merges passports. It records the APPROVAL INTENT
 *     only — the merge itself is a separate, explicitly-governed action performed elsewhere.
 *     The case is left 'investigating' (not 'resolved') so the merge step is still required.
 */
import { supabase } from '../../db/supabase.js';

const CASES_TABLE = 'fraud_cases';
const SIGNALS_TABLE = 'fraud_signals';
const CASE_EVENTS_TABLE = 'fraud_case_events';
const RESOLUTIONS_TABLE = 'fraud_case_resolutions';

const VALID_RESOLUTIONS = [
  'false_positive',
  'confirmed_duplicate',
  'blocked',
  'released',
  'identity_merge_approved',
];

// How each resolution maps onto the case lifecycle. identity_merge_approved stays
// 'investigating' on purpose — approval is recorded, but the governed merge is still pending.
const RESOLUTION_STATUS = {
  false_positive: 'dismissed',
  confirmed_duplicate: 'resolved',
  blocked: 'resolved',
  released: 'resolved',
  identity_merge_approved: 'investigating',
};

// Whether the resolution leaves the listing blocked.
const RESOLUTION_BLOCKS = {
  false_positive: false,
  confirmed_duplicate: true,
  blocked: true,
  released: false,
  identity_merge_approved: true,
};

/**
 * List open/active investigation cases. Filters: { severity, status, tenant_id }.
 * Defaults to the active queue (open + investigating) when no status filter is given.
 */
export async function listOpenCases(filters = {}) {
  let query = supabase
    .from(CASES_TABLE)
    .select('id, vin, tenant_id, highest_severity, open_signal_count, status, blocks_publication, created_at, updated_at');

  if (filters.status) {
    query = query.eq('status', filters.status);
  } else {
    query = query.in('status', ['open', 'investigating']);
  }
  if (filters.severity) query = query.eq('highest_severity', filters.severity);
  if (filters.tenant_id) query = query.eq('tenant_id', filters.tenant_id);

  query = query.order('updated_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(`failed to list fraud cases: ${error.message}`);
  return data || [];
}

/** Fetch a single case with its vehicle's signals and full append-only event trail. */
export async function getCase(id) {
  const { data: theCase, error } = await supabase
    .from(CASES_TABLE)
    .select('id, vin, tenant_id, highest_severity, open_signal_count, status, blocks_publication, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`failed to load fraud case: ${error.message}`);
  if (!theCase) return null;

  const { data: signals, error: sigErr } = await supabase
    .from(SIGNALS_TABLE)
    .select('id, vin, signal_code, severity, confidence, reason_codes, evidence_refs, related_identities, recommended_action, blocks_publication, requires_review, rule_version, created_at')
    .eq('vin', theCase.vin)
    .order('created_at', { ascending: false });
  if (sigErr) throw new Error(`failed to load case signals: ${sigErr.message}`);

  const { data: events, error: evErr } = await supabase
    .from(CASE_EVENTS_TABLE)
    .select('id, case_id, event_type, actor_id, actor_role, reason, payload, created_at')
    .eq('case_id', id)
    .order('created_at', { ascending: false });
  if (evErr) throw new Error(`failed to load case events: ${evErr.message}`);

  const { data: resolutions, error: resErr } = await supabase
    .from(RESOLUTIONS_TABLE)
    .select('id, case_id, resolution, actor_id, actor_role, reason, created_at')
    .eq('case_id', id)
    .order('created_at', { ascending: false });
  if (resErr) throw new Error(`failed to load case resolutions: ${resErr.message}`);

  return { ...theCase, signals: signals || [], events: events || [], resolutions: resolutions || [] };
}

/**
 * Resolve a case. Writes an append-only fraud_case_resolutions row AND a fraud_case_events
 * row (actor + reason), then moves fraud_cases.status. NEVER auto-merges passports.
 *
 * @param {string} id
 * @param {{ resolution: string, reason?: string }} body
 * @param {{ id?: string, userId?: string, role?: string }} actor
 */
export async function resolveCase(id, { resolution, reason } = {}, actor = {}) {
  if (!VALID_RESOLUTIONS.includes(resolution)) {
    throw new Error(`resolution must be one of ${VALID_RESOLUTIONS.join('|')}`);
  }
  const actorId = actor.id || actor.userId || null;
  if (!actorId) throw new Error('resolution requires an authenticated actor');

  const { data: theCase, error } = await supabase
    .from(CASES_TABLE)
    .select('id, vin, tenant_id, status, blocks_publication')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`failed to load fraud case: ${error.message}`);
  if (!theCase) throw new Error(`Fraud case not found: ${id}`);

  const tenantId = theCase.tenant_id || null;
  const actorRole = actor.role || null;

  // 1) Append-only resolution record (the durable governance fact).
  const { data: resRow, error: resErr } = await supabase
    .from(RESOLUTIONS_TABLE)
    .insert({
      case_id: id,
      tenant_id: tenantId,
      resolution,
      actor_id: actorId,
      actor_role: actorRole,
      reason: reason || null,
    })
    .select()
    .single();
  if (resErr) throw new Error(`failed to record resolution: ${resErr.message}`);

  // 2) Append-only event mirroring the action.
  const { error: evErr } = await supabase.from(CASE_EVENTS_TABLE).insert({
    case_id: id,
    tenant_id: tenantId,
    event_type: 'resolved',
    actor_id: actorId,
    actor_role: actorRole,
    reason: reason || null,
    payload: {
      resolution,
      // Make the governance posture explicit for identity merges.
      identity_merge: resolution === 'identity_merge_approved'
        ? { intent_recorded: true, auto_merged: false, requires_governed_merge_step: true }
        : undefined,
    },
  });
  if (evErr) throw new Error(`failed to write resolution event: ${evErr.message}`);

  // 3) Move the case status (the only mutable field). open_signal_count is cleared on close.
  const newStatus = RESOLUTION_STATUS[resolution];
  const closing = ['resolved', 'dismissed'].includes(newStatus);
  const { data: updated, error: updErr } = await supabase
    .from(CASES_TABLE)
    .update({
      status: newStatus,
      blocks_publication: RESOLUTION_BLOCKS[resolution],
      ...(closing ? { open_signal_count: 0 } : {}),
    })
    .eq('id', id)
    .select()
    .single();
  if (updErr) throw new Error(`failed to update case status: ${updErr.message}`);

  return { case: updated, resolution: resRow };
}

/**
 * Record a governed status change (e.g. an admin starting an investigation) with an
 * append-only event. Does not write a resolution. Allowed transitions are constrained to
 * the lifecycle set; closing is reserved for resolveCase().
 */
export async function updateCaseStatus(id, status, actor = {}, reason = null) {
  const allowed = ['open', 'investigating'];
  if (!allowed.includes(status)) {
    throw new Error(`updateCaseStatus only moves to ${allowed.join('|')}; use resolveCase to close`);
  }
  const actorId = actor.id || actor.userId || null;
  if (!actorId) throw new Error('status change requires an authenticated actor');

  const { data: theCase, error } = await supabase
    .from(CASES_TABLE)
    .select('id, tenant_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`failed to load fraud case: ${error.message}`);
  if (!theCase) throw new Error(`Fraud case not found: ${id}`);

  const { error: evErr } = await supabase.from(CASE_EVENTS_TABLE).insert({
    case_id: id,
    tenant_id: theCase.tenant_id || null,
    event_type: 'status_changed',
    actor_id: actorId,
    actor_role: actor.role || null,
    reason: reason || null,
    payload: { status },
  });
  if (evErr) throw new Error(`failed to write status event: ${evErr.message}`);

  const { data: updated, error: updErr } = await supabase
    .from(CASES_TABLE)
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (updErr) throw new Error(`failed to update case status: ${updErr.message}`);
  return updated;
}

export default {
  listOpenCases,
  getCase,
  resolveCase,
  updateCaseStatus,
};
