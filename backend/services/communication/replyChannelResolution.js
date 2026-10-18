/**
 * CA-OWNER-02 (H4) — the SERVER's reply-channel authority for a Command Center reply. PURE.
 *
 * recordAdminThreadReply used to send `body.channel || thread.primary_channel || 'in_app'`. A conversation that began
 * in-app and continued on WhatsApp keeps primary_channel = 'in_app', so a caller that named no channel replied in-app;
 * and an in-app reply on a Marketplace inquiry went to thread.primary_user_id — the SELLER. The channels a reply can
 * reach are now derived from the CUSTOMER's own evidence on this conversation (conversationCustomer.js decides who that
 * is):
 *
 *   deliverable  the customer's bindings that can send (can_send ≠ false, transactional_consent ≠ false, not expired)
 *                + the customer's channel identities whose consent is usable (the web rule CC-REPLY-CHANNEL-01)
 *                + in_app ONLY when the customer has a CarUp account (never the seller's account)
 *   default      the channel of the customer's latest inbound message, or of the binding that last received from them,
 *                when deliverable → else the primary deliverable binding → else in_app for an account → else unresolved.
 *                thread.primary_channel on its own is never the answer.
 *   requested    used only when deliverable; otherwise refused (REPLY_CHANNEL_NOT_DELIVERABLE) — never substituted.
 *
 * Which participant receives the reply WITHIN the channel is still decided by the route's recipient resolver.
 */
import { normalizeChannel } from './communicationUtils.js';
import { customerAccountId, customerParticipants } from './conversationCustomer.js';

export const REPLY_CHANNEL_NOT_DELIVERABLE = 'REPLY_CHANNEL_NOT_DELIVERABLE';
export const REPLY_CHANNEL_UNRESOLVED = 'REPLY_CHANNEL_UNRESOLVED';

// Mirrors the route's UNUSABLE_CONSENT_STATUSES and the web's replyChannels.ts.
const UNUSABLE_CONSENT = new Set(['opted_out', 'revoked']);
const IN_APP = 'in_app';

const norm = (value) => String(value ?? '').trim().toLowerCase();
/** One spelling per channel ('wa' → 'whatsapp'); unknown channels keep their lower-cased name. */
export const channelKey = (value) => (norm(value) ? normalizeChannel(value) || norm(value) : null);

const time = (value) => Date.parse(value || '') || 0;
const bindingTime = (binding) => time(binding?.last_used_at || binding?.updated_at || binding?.created_at);
const sameThread = (row, thread) => row && (row.thread_id === undefined || row.thread_id === null || String(row.thread_id) === String(thread?.id));

function bindingCanSend(binding, now) {
  if (!binding || binding.can_send === false || binding.transactional_consent === false) return false;
  if (!binding.channel_identity_id) return false;
  if (binding.expires_at) {
    const expiry = Date.parse(binding.expires_at);
    if (!Number.isNaN(expiry) && expiry <= now) return false;
  }
  return true;
}

const unique = (values) => [...new Set(values.filter(Boolean))];

/**
 * @param input.thread       the message_threads row
 * @param input.inquiry      its marketplace_inquiries row (Marketplace inquiry conversations), when readable
 * @param input.participants the thread's message_participants
 * @param input.bindings     the thread's conversation_channel_bindings
 * @param input.identities   channel_identities rows for the participants' external identities
 * @param input.messages     the thread's messages (any subset that includes its latest inbound message)
 * @returns {{ customer: { user_id, participant_ids }, deliverable: string[], default_channel: string|null, basis: string }}
 *          basis ∈ latest_inbound | primary_binding | customer_account | unresolved
 */
export function replyChannelAuthority({
  thread, inquiry = null, participants = [], bindings = [], identities = [], messages = [], now = Date.now(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const threadParticipants = (participants || []).filter((p) => sameThread(p, thread));
  const customerUserId = customerAccountId(thread, { inquiry, participants: threadParticipants });
  const side = customerParticipants(threadParticipants, { thread, customerUserId });
  const sideIds = new Set(side.map((p) => String(p.id)));

  // The customer's sendable bindings, primary first, then most recently used (routeMessage's precedent).
  const customerBindings = (bindings || [])
    .filter((b) => sameThread(b, thread) && sideIds.has(String(b.participant_id)) && bindingCanSend(b, nowMs))
    .filter((b) => { const channel = channelKey(b.channel); return channel && channel !== IN_APP; })
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || bindingTime(b) - bindingTime(a));

  const identityById = new Map((identities || []).filter(Boolean).map((i) => [String(i.id), i]));
  const identityChannels = side
    .map((p) => (p.external_identity_id ? identityById.get(String(p.external_identity_id)) : null))
    .filter((identity) => identity && !UNUSABLE_CONSENT.has(norm(identity.consent_status)))
    .map((identity) => channelKey(identity.channel))
    .filter((channel) => channel && channel !== IN_APP);

  const deliverable = unique([
    ...customerBindings.map((b) => channelKey(b.channel)),
    ...identityChannels,
    ...(customerUserId ? [IN_APP] : []),
  ]);

  let defaultChannel = null;
  let basis = 'unresolved';
  const latestInbound = (messages || [])
    .filter((m) => norm(m?.direction) === 'inbound' && sameThread(m, thread))
    .sort((a, b) => time(b.created_at) - time(a.created_at))[0];
  const latestInboundChannel = latestInbound ? channelKey(latestInbound.channel) : null;
  const lastReceivingBinding = customerBindings
    .filter((b) => b.last_inbound_message_id)
    .sort((a, b) => bindingTime(b) - bindingTime(a))[0];
  if (latestInboundChannel && deliverable.includes(latestInboundChannel)) {
    defaultChannel = latestInboundChannel;
    basis = 'latest_inbound';
  } else if (lastReceivingBinding) {
    defaultChannel = channelKey(lastReceivingBinding.channel);
    basis = 'latest_inbound';
  } else if (customerBindings.length) {
    defaultChannel = channelKey(customerBindings[0].channel);
    basis = 'primary_binding';
  } else if (customerUserId) {
    defaultChannel = IN_APP;
    basis = 'customer_account';
  }

  return {
    customer: { user_id: customerUserId, participant_ids: [...sideIds] },
    deliverable,
    default_channel: defaultChannel,
    basis,
  };
}

/**
 * Apply the authority to a reply request. A requested channel is honoured only when deliverable; with none, the default.
 * @returns {{ ok: true, channel, basis } | { ok: false, code, requested?, deliverable }}
 */
export function resolveReplyChannel(authority, requestedChannel = null) {
  const requested = channelKey(requestedChannel);
  if (requested) {
    if (authority.deliverable.includes(requested)) return { ok: true, channel: requested, basis: 'requested' };
    return { ok: false, code: REPLY_CHANNEL_NOT_DELIVERABLE, requested, deliverable: [...authority.deliverable] };
  }
  if (authority.default_channel) return { ok: true, channel: authority.default_channel, basis: authority.basis };
  return { ok: false, code: REPLY_CHANNEL_UNRESOLVED, deliverable: [...authority.deliverable] };
}

const CHANNEL_LABELS = { in_app: 'in-app', whatsapp: 'WhatsApp', telegram: 'Telegram', email: 'email', sms: 'SMS' };
const label = (channel) => CHANNEL_LABELS[channel] || channel;

/** The 409 a refused reply carries. Nothing has been written when it is thrown. */
export function replyChannelRefusal(decision) {
  const reachable = decision.deliverable?.length ? decision.deliverable.map(label).join(', ') : 'none';
  const message = decision.code === REPLY_CHANNEL_NOT_DELIVERABLE
    ? `This conversation's customer cannot be reached by ${label(decision.requested)}. Reachable: ${reachable}. Nothing was sent.`
    : 'No reply channel can be resolved for this conversation\'s customer: no reachable channel and no CarUp account. Nothing was sent.';
  const err = new Error(message);
  err.statusCode = 409;
  err.code = decision.code;
  err.details = { requested: decision.requested ?? null, deliverable: decision.deliverable || [] };
  return err;
}
