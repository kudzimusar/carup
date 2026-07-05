// Pure identity-first inbox projection — the JS mirror of the `communication_inbox_threads` SQL view
// (database/migrations/20260705150000_communication_inbox_projection.sql). Used by the in-memory
// repository and tests so the projection semantics (requester identity, latest message, unread count
// derived from last_read_at, failed-outbound risk) are unit-tested with exactly the shape the view
// materialises in Postgres (Command Center plan §3/§7).

const OUTBOUND_FAILED = new Set(['failed', 'dead_letter', 'retry_scheduled']);

function requesterParticipant(participants) {
  const requesters = participants.filter((p) => p.role === 'requester');
  requesters.sort((a, b) => String(a.joined_at || '').localeCompare(String(b.joined_at || '')));
  return requesters[0] || null;
}

function latestMessage(messages) {
  if (!messages.length) return null;
  return [...messages].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
}

/**
 * Project a single thread into an identity-first inbox row (mirrors the view's columns).
 * @param {object} thread                 a message_threads row
 * @param {object} related                { participants, identities, messages } — may span many threads;
 *                                         rows are filtered to this thread by thread_id.
 */
export function projectInboxThread(thread, { participants = [], identities = [], messages = [] } = {}) {
  const threadParticipants = participants.filter((p) => p.thread_id === thread.id);
  const threadMessages = messages.filter((m) => m.thread_id === thread.id);
  const rp = requesterParticipant(threadParticipants);
  const identity = rp && rp.external_identity_id
    ? identities.find((i) => i.id === rp.external_identity_id) || null
    : null;
  const lm = latestMessage(threadMessages);
  const lastRead = rp?.last_read_at || null;

  const unread = threadMessages.filter((m) =>
    String(m.direction || '').toLowerCase() === 'inbound'
    && (!lastRead || String(m.created_at || '') > String(lastRead))).length;

  const failedOutbound = threadMessages.filter((m) =>
    String(m.direction || '').toLowerCase() === 'outbound'
    && OUTBOUND_FAILED.has(String(m.status || '').toLowerCase())).length;

  return {
    ...thread,
    identity_display_name: identity?.display_name ?? null,
    identity_address: identity?.normalized_address ?? null,
    identity_external_id: identity?.external_id ?? null,
    identity_verified: identity?.verified ?? null,
    identity_channel: identity?.channel ?? null,
    identity_provider: identity?.provider ?? null,
    latest_message_text: lm?.content_text ?? null,
    latest_message_direction: lm?.direction ?? null,
    latest_message_at: lm?.created_at ?? null,
    latest_message_status: lm?.status ?? null,
    latest_provider_message_id: lm?.provider_message_id ?? null,
    unread_count: unread,
    failed_outbound_count: failedOutbound,
  };
}

export function projectInboxThreads(threads = [], related = {}) {
  return threads.map((thread) => projectInboxThread(thread, related));
}
