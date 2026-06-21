/**
 * Chain-of-custody / provenance service — Milestone 1 (master plan §5.4 / §5.5).
 *
 * Writes immutable, hash-chained provenance events for an evidence record. Each
 * event links to the previous event via `prev_hash`, making the chain tamper-evident:
 * altering any event breaks the recomputed chain. The DB also blocks UPDATE/DELETE on
 * `evidence_provenance_events` (migration 20260621120000), so this is defence in depth.
 *
 * This service NEVER changes evidence verification state or trust scores — it only
 * records what happened (master plan §2.2 AI-advisory; §2.5 provenance).
 */
import crypto from 'crypto';

export const PROVENANCE_EVENT_TYPES = Object.freeze([
  'created', 'uploaded', 'imported', 'validated', 'transformed',
  'ai_requested', 'ai_completed', 'ai_failed', 'reviewer_opened',
  'approved', 'rejected', 'requested_more_info', 'published', 'unpublished',
  'disputed', 'resolved', 'corrected', 'superseded',
  'retention_hold', 'deleted',
]);

const TABLE = 'evidence_provenance_events';

/**
 * Deterministic canonical hash of an event's content. Excludes the DB-assigned
 * created_at so the hash is reproducible from stored fields during verification.
 */
export function computeContentHash({
  evidence_id, sequence, event_type, actor_user_id, actor_role, actor_type, details, prev_hash,
}) {
  const canonical = JSON.stringify({
    evidence_id: evidence_id || null,
    sequence,
    event_type,
    actor_user_id: actor_user_id || null,
    actor_role: actor_role || null,
    actor_type: actor_type || 'user',
    details: details || {},
    prev_hash: prev_hash || null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function fetchLastEvent(supabase, evidenceId) {
  // Highest sequence wins. The mock + real client both support order+limit.
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('evidence_id', evidenceId)
    .order('sequence', { ascending: false })
    .limit(1);
  if (error) throw new Error(`provenance read failed: ${error.message}`);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows[0] || null;
}

/**
 * Append a provenance event. Returns the inserted row.
 * @param {object} supabase  service-role client (or test mock)
 * @param {object} evt       { evidenceId, vin, eventType, actorUserId, actorRole, actorType,
 *                             sourceRoute, requestId, ipAddress, details }
 */
export async function recordProvenanceEvent(supabase, evt) {
  if (!evt || !evt.evidenceId) throw new Error('recordProvenanceEvent: evidenceId is required');
  if (!PROVENANCE_EVENT_TYPES.includes(evt.eventType)) {
    throw new Error(`recordProvenanceEvent: unknown eventType '${evt.eventType}'`);
  }

  const last = await fetchLastEvent(supabase, evt.evidenceId);
  const sequence = last ? Number(last.sequence) + 1 : 1;
  const prev_hash = last ? last.content_hash : null;

  const base = {
    evidence_id: evt.evidenceId,
    sequence,
    event_type: evt.eventType,
    actor_user_id: evt.actorUserId || null,
    actor_role: evt.actorRole || null,
    actor_type: evt.actorType || 'user',
    details: evt.details || {},
    prev_hash,
  };
  const content_hash = computeContentHash(base);

  const row = {
    ...base,
    vin: evt.vin || null,
    source_route: evt.sourceRoute || null,
    request_id: evt.requestId || null,
    ip_address: evt.ipAddress || null,
    content_hash,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select();
  if (error) throw new Error(`provenance write failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

/** List provenance events for an evidence record in chain order. */
export async function listProvenanceEvents(supabase, evidenceId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('evidence_id', evidenceId)
    .order('sequence', { ascending: true });
  if (error) throw new Error(`provenance list failed: ${error.message}`);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows;
}

/**
 * Verify the hash chain for an evidence record.
 * @returns {{ valid: boolean, length: number, brokenAt: number|null, reason: string|null }}
 */
export async function verifyProvenanceChain(supabase, evidenceId) {
  const events = await listProvenanceEvents(supabase, evidenceId);
  let prev = null;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const expected = computeContentHash({
      evidence_id: e.evidence_id,
      sequence: Number(e.sequence),
      event_type: e.event_type,
      actor_user_id: e.actor_user_id,
      actor_role: e.actor_role,
      actor_type: e.actor_type,
      details: e.details,
      prev_hash: e.prev_hash,
    });
    if (expected !== e.content_hash) {
      return { valid: false, length: events.length, brokenAt: Number(e.sequence), reason: 'content_hash_mismatch' };
    }
    const expectedPrev = prev ? prev.content_hash : null;
    if ((e.prev_hash || null) !== expectedPrev) {
      return { valid: false, length: events.length, brokenAt: Number(e.sequence), reason: 'prev_hash_break' };
    }
    prev = e;
  }
  return { valid: true, length: events.length, brokenAt: null, reason: null };
}

/** Public-safe provenance summary (master plan §5.6) — no IPs, no raw actor IDs. */
export function toPublicProvenanceSummary(events) {
  return (events || []).map((e) => ({
    event_type: e.event_type,
    actor_role: e.actor_role || null,
    actor_type: e.actor_type || 'user',
    at: e.created_at || null,
    sequence: Number(e.sequence),
  }));
}

export default {
  PROVENANCE_EVENT_TYPES,
  computeContentHash,
  recordProvenanceEvent,
  listProvenanceEvents,
  verifyProvenanceChain,
  toPublicProvenanceSummary,
};
