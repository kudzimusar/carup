/**
 * CA-OWNER-02 (H1/H2) — reads exactly what the conversation truth needs, for a given set of message_threads rows, IN FULL.
 *
 * SELECT only. Every read is chunked (IN lists) and paged (readAllPages, ordered by id), so nothing is silently truncated at
 * the 1000-row PostgREST limit; any failed read THROWS, so a caller can present the figure as degraded — never as zero.
 *
 *   marketplace_inquiries        the asker + listing of every Marketplace inquiry conversation (judged by K2B)
 *   users / vehicles             loadProvenanceIndex — the K2B identity and vehicle facts (id, email, name; vin, owner…)
 *   communication_audit_events   the server-written `smoke_test` marker
 *   messages                     the latest customer (inbound) and staff (outbound) message per conversation
 *
 * With `withParties: true` (H3, the Command Center), it also reads
 *   message_participants         who is on the customer side of each conversation
 *   channel_identities           the display name of a customer-side channel identity (id, display_name, channel only)
 * so the customer of a guest conversation can be named from the identity that wrote in. The default load is unchanged.
 *
 * Email addresses are read only to classify and are never returned.
 */
import { loadProvenanceIndex } from '../provenance/provenanceContext.js';
import { readAllPages } from '../intelligence/rollupService.js';
import { conversationTruth, summarizeConversationTruth } from './conversationTruth.js';

const CHUNK = 100;
/** Chunk reads of one table that may be in flight at once. Run one after another, a 664-conversation load needed ~20
 *  sequential round trips and overran the Corporate 8 s read budget on staging; bounded, it stays polite to PostgREST. */
const IN_CONCURRENCY = 4;
const VEHICLE_LISTING_TYPES = new Set(['', 'vehicle', 'car', 'marketplace_vehicle']);

const unique = (values) => [...new Set((values || []).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map(String))];

/** Every row whose `key` is in `values`, chunked and paged, chunks read concurrently (bounded), rows in chunk order.
 *  Throws on any read error or overflow. */
export async function readAllIn(client, table, columns, key, values, shape = (query) => query) {
  const slices = [];
  for (let i = 0; i < values.length; i += CHUNK) slices.push(values.slice(i, i + CHUNK));
  const results = new Array(slices.length);
  let next = 0;
  const worker = async () => {
    while (next < slices.length) {
      const index = next;
      next += 1;
      results[index] = await readAllPages(() => shape(client.from(table).select(columns).in(key, slices[index])).order('id'));
    }
  };
  await Promise.all(Array.from({ length: Math.min(IN_CONCURRENCY, slices.length) }, worker));
  return results.flat();
}

const later = (a, b) => (!a ? b : !b ? a : (new Date(b).getTime() > new Date(a).getTime() ? b : a));

const PARTICIPANT_COLUMNS = 'id, thread_id, user_id, external_identity_id, role, stakeholder_role, participant_type, display_name, joined_at, left_at';
const IDENTITY_NAME_COLUMNS = 'id, display_name, channel';

async function loadParties(client, threadIds) {
  const participants = await readAllIn(client, 'message_participants', PARTICIPANT_COLUMNS, 'thread_id', threadIds);
  const participantsByThread = new Map();
  for (const p of participants) {
    const key = String(p.thread_id);
    if (!participantsByThread.has(key)) participantsByThread.set(key, []);
    participantsByThread.get(key).push(p);
  }
  const identityIds = unique(participants.map((p) => p.external_identity_id));
  const identities = identityIds.length ? await readAllIn(client, 'channel_identities', IDENTITY_NAME_COLUMNS, 'id', identityIds) : [];
  return { participantsByThread, identityById: new Map(identities.map((i) => [String(i.id), i])) };
}

/**
 * @param client a service-role Supabase client
 * @param opts.threads message_threads rows (with id, status, subject_type, subject_id, primary_user_id, SLA columns,
 *                     last_inbound_at / last_outbound_at, assigned_* — whatever the caller has; missing stamps are
 *                     completed from messages)
 * @param opts.withParties also read participants + identity names, so a guest's customer can be named (H3)
 * @returns {Promise<{ truths: object[], summary: object }>}
 */
export async function loadConversationTruth(client, { threads = [], now = new Date(), withParties = false } = {}) {
  const list = Array.isArray(threads) ? threads : [];
  const threadIds = unique(list.map((t) => t.id));

  const inquiryIds = unique(list.filter((t) => t.subject_type === 'marketplace_inquiry').map((t) => t.subject_id));
  // The four sources are independent of each other (only the K2B index waits for the inquiries), so they are read at the
  // same time. Any failed read still rejects the whole load — the caller shows DEGRADED, never a partial figure.
  const principals = (async () => {
    const inquiries = inquiryIds.length
      ? await readAllIn(client, 'marketplace_inquiries', 'id, buyer_id, guest_email, guest_name, listing_id, listing_type', 'id', inquiryIds)
      : [];
    const vins = unique(inquiries.filter((i) => VEHICLE_LISTING_TYPES.has(String(i.listing_type ?? '').toLowerCase())).map((i) => i.listing_id));
    const index = await loadProvenanceIndex(client, {
      userIds: unique([...list.map((t) => t.primary_user_id), ...inquiries.map((i) => i.buyer_id)]),
      vins,
    });
    return { inquiries, index };
  })();
  const [{ inquiries, index }, smoke, messages, parties] = await Promise.all([
    principals,
    threadIds.length
      ? readAllIn(client, 'communication_audit_events', 'id, thread_id', 'thread_id', threadIds, (q) => q.eq('event_type', 'smoke_test'))
      : [],
    threadIds.length
      ? readAllIn(client, 'messages', 'id, thread_id, direction, created_at', 'thread_id', threadIds, (q) => q.in('direction', ['inbound', 'outbound']))
      : [],
    withParties && threadIds.length ? loadParties(client, threadIds) : {},
  ]);
  const latestByThread = new Map();
  for (const m of messages) {
    const key = String(m.thread_id);
    const cur = latestByThread.get(key) || { inbound: null, outbound: null };
    if (m.direction === 'inbound') cur.inbound = later(cur.inbound, m.created_at);
    if (m.direction === 'outbound') cur.outbound = later(cur.outbound, m.created_at);
    latestByThread.set(key, cur);
  }

  const ctx = {
    index,
    inquiryById: new Map(inquiries.map((i) => [String(i.id), i])),
    smokeThreadIds: new Set(smoke.map((s) => String(s.thread_id))),
    latestByThread,
    ...parties,
  };
  const truths = list.map((t) => conversationTruth(t, ctx, now));
  return { truths, summary: summarizeConversationTruth(truths) };
}
