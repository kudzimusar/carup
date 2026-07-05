// Pure identity-first inbox projection — the JS mirror of the `communication_inbox_threads` SQL view
// (database/migrations/20260705150000_communication_inbox_projection.sql). Used by the in-memory
// repository and tests so the projection semantics (requester identity, latest message, unread count
// derived from last_read_at, failed-outbound risk) are unit-tested with exactly the shape the view
// materialises in Postgres (Command Center plan §3/§7).

const OUTBOUND_FAILED = new Set(['failed', 'dead_letter', 'retry_scheduled']);

// Epoch ms for an ISO timestamp (NaN-safe). Comparing epochs — not raw strings — makes ordering
// correct even if a timestamp ever carries a non-UTC offset (matches Postgres temporal semantics).
function ts(value) {
  const n = value ? Date.parse(value) : NaN;
  return Number.isNaN(n) ? null : n;
}

// Earliest-joined requester wins, matching the SQL view's `ORDER BY joined_at ASC NULLS LAST, id ASC`:
// a missing joined_at sorts LAST, and id breaks ties deterministically.
function requesterParticipant(participants) {
  const requesters = participants.filter((p) => p.role === 'requester');
  requesters.sort((a, b) => {
    const ta = ts(a.joined_at);
    const tb = ts(b.joined_at);
    if (ta !== tb) {
      if (ta === null) return 1;      // NULLS LAST
      if (tb === null) return -1;
      return ta - tb;
    }
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  return requesters[0] || null;
}

// Newest message wins, matching the SQL view's `ORDER BY created_at DESC, id DESC`.
function latestMessage(messages) {
  if (!messages.length) return null;
  return [...messages].sort((a, b) => {
    const diff = (ts(b.created_at) ?? -Infinity) - (ts(a.created_at) ?? -Infinity);
    if (diff !== 0) return diff;
    return String(b.id || '').localeCompare(String(a.id || ''));
  })[0];
}

// Count inbound messages newer than a read marker (all inbound when the marker is null/absent).
function countInboundAfter(threadMessages, markerTs) {
  return threadMessages.filter((m) => {
    if (String(m.direction || '').toLowerCase() !== 'inbound') return false;
    if (markerTs === null) return true;
    const created = ts(m.created_at);
    return created !== null && created > markerTs;
  }).length;
}

// Best display name for a registered CarUp user profile (no raw email if a name exists).
function userDisplayName(user) {
  if (!user) return null;
  return user.display_name || user.full_name || user.name
    || [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.email || null;
}

/**
 * Project a single thread into an identity-first inbox row (mirrors the view's columns).
 * @param {object} thread    a message_threads row
 * @param {object} related   { participants, identities, messages, users } — may span many threads.
 * @param {object} ctx       { agentId } — the ACTING agent, for per-agent unread (P1.7).
 */
export function projectInboxThread(thread, { participants = [], identities = [], messages = [], users = [] } = {}, ctx = {}) {
  const agentId = ctx.agentId ?? null;
  const threadParticipants = participants.filter((p) => p.thread_id === thread.id);
  const threadMessages = messages.filter((m) => m.thread_id === thread.id);
  const rp = requesterParticipant(threadParticipants);

  // Identity: the requester's linked channel identity first; else fall back to the registered CarUp
  // user profile via primary_user_id (P1.8) — never a generic Support/Complaint/General label when an
  // authorized customer name is available.
  const identity = rp && rp.external_identity_id
    ? identities.find((i) => i.id === rp.external_identity_id) || null
    : null;
  const registeredUser = !identity && thread.primary_user_id
    ? users.find((u) => String(u.id) === String(thread.primary_user_id)) || null
    : null;

  const lm = latestMessage(threadMessages);

  // Per-agent unread (P1.7): inbound messages after the ACTING agent's own participant read marker
  // (all inbound if this agent has never read the thread). One agent reading does NOT clear another's.
  const nonRequester = threadParticipants.filter((p) => p.role !== 'requester');
  const actingParticipant = agentId
    ? nonRequester.find((p) => String(p.admin_id ?? '') === String(agentId) || String(p.user_id ?? '') === String(agentId)) || null
    : null;
  const unread = countInboundAfter(threadMessages, ts(actingParticipant?.last_read_at));

  // Team-level "unhandled" signal: inbound after the most recent read by ANY agent (all inbound if no
  // agent has ever opened it). Drives team triage, not an individual agent's badge.
  const agentReadTimes = nonRequester.map((p) => ts(p.last_read_at)).filter((t) => t !== null);
  const teamUnread = countInboundAfter(threadMessages, agentReadTimes.length ? Math.max(...agentReadTimes) : null);

  const failedOutbound = threadMessages.filter((m) =>
    String(m.direction || '').toLowerCase() === 'outbound'
    && OUTBOUND_FAILED.has(String(m.status || '').toLowerCase())).length;

  return {
    ...thread,
    identity_display_name: identity?.display_name ?? userDisplayName(registeredUser),
    identity_address: identity?.normalized_address ?? null,
    identity_external_id: identity?.external_id ?? null,
    identity_verified: identity?.verified ?? (registeredUser ? true : null),
    identity_channel: identity?.channel ?? thread.primary_channel ?? null,
    identity_provider: identity?.provider ?? null,
    identity_user_id: registeredUser?.id ?? thread.primary_user_id ?? null,
    latest_message_text: lm?.content_text ?? null,
    latest_message_direction: lm?.direction ?? null,
    latest_message_at: lm?.created_at ?? null,
    latest_message_status: lm?.status ?? null,
    latest_provider_message_id: lm?.provider_message_id ?? null,
    unread_count: unread,
    team_unread_count: teamUnread,
    failed_outbound_count: failedOutbound,
  };
}

export function projectInboxThreads(threads = [], related = {}, ctx = {}) {
  return threads.map((thread) => projectInboxThread(thread, related, ctx));
}
