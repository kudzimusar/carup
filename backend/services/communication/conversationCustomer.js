/**
 * CA-OWNER-02 (H3/H4) — WHO a conversation is with: its customer. PURE.
 *
 * One definition for the Command Center heading (H3) and for the reply-channel authority (H4), so the name an agent reads
 * and the person a reply reaches can never disagree.
 *
 *   · A Marketplace inquiry conversation (subject_type = 'marketplace_inquiry') is WITH its asker. Its message_threads
 *     .primary_user_id is only a compatibility projection of the SELLER (canonicalizeMarketplaceInquiry), so the seller is
 *     context and never the customer — not as a heading, not as a reply recipient.
 *   · Any other conversation is with its primary user (or, without an account, the external contact who wrote in).
 *   · A provider smoke test is recognised only by the server-written `smoke_test` audit event (conversationTruth.js) and
 *     reads as one heading: "Provider smoke test".
 *
 * Display names only. An email address or phone number is never a heading here: an unnamed customer is
 * "Unidentified customer", which is the truth.
 */

export const UNIDENTIFIED_CUSTOMER = 'Unidentified customer';
export const PROVIDER_SMOKE_TEST_LABEL = 'Provider smoke test';

const CUSTOMER_ROLES = new Set(['buyer', 'requester', 'customer']);
const SELLER_ROLES = new Set(['seller']);
const NON_ADDRESSABLE_PARTICIPANT_TYPES = new Set(['system', 'agent', 'bot']);

const freeze = (o) => Object.freeze(o);
const norm = (value) => String(value ?? '').trim().toLowerCase();
const clean = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};
const roleOf = (participant) => norm(participant?.stakeholder_role || participant?.role);
const idOf = (value) => (value === null || value === undefined || value === '' ? null : String(value));

export function isMarketplaceInquiryThread(thread) {
  return norm(thread?.subject_type) === 'marketplace_inquiry' && Boolean(thread?.subject_id);
}

export function participantIsActive(participant) {
  return Boolean(participant)
    && participant.is_active !== false
    && participant.active !== false
    && !participant.left_at;
}

/** A participant that exists to be written to — not a system / agent / bot placeholder, and still in the conversation. */
export function participantIsAddressable(participant) {
  return participantIsActive(participant) && !NON_ADDRESSABLE_PARTICIPANT_TYPES.has(norm(participant.participant_type));
}

/**
 * The customer's CarUp ACCOUNT id, or null when the customer has none (a guest).
 *   · Marketplace inquiry: the inquiry's buyer_id. Without the inquiry row, the buyer participant is the only evidence;
 *     the seller is never returned.
 *   · Any other conversation: its primary user.
 */
export function customerAccountId(thread, { inquiry = null, participants = [] } = {}) {
  if (isMarketplaceInquiryThread(thread)) {
    if (inquiry) return idOf(inquiry.buyer_id);
    const sellerId = idOf(thread?.primary_user_id);
    const buyer = (participants || []).find((p) => roleOf(p) === 'buyer' && p.user_id && idOf(p.user_id) !== sellerId);
    return buyer ? idOf(buyer.user_id) : null;
  }
  return idOf(thread?.primary_user_id);
}

/** Is this participant on the CUSTOMER side of the conversation? The seller is context, never the customer. */
export function isCustomerParticipant(participant, { thread, customerUserId = null } = {}) {
  if (!participantIsAddressable(participant)) return false;
  const userId = idOf(participant.user_id);
  const role = roleOf(participant);
  const customerId = idOf(customerUserId);
  if (isMarketplaceInquiryThread(thread)) {
    const sellerId = idOf(thread?.primary_user_id);
    if (SELLER_ROLES.has(role) || (userId && sellerId && userId === sellerId)) return false;
    if (customerId && userId === customerId) return true;
    return role === 'buyer' || (!userId && Boolean(participant.external_identity_id));
  }
  if (customerId && userId === customerId) return true;
  if (SELLER_ROLES.has(role)) return false;
  return CUSTOMER_ROLES.has(role) || (!userId && Boolean(participant.external_identity_id));
}

const joinedOrder = (a, b) => {
  const ta = Date.parse(a?.joined_at || '') || Number.POSITIVE_INFINITY;
  const tb = Date.parse(b?.joined_at || '') || Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
};

/** The customer-side participants of ONE thread, earliest-joined first (deterministic). */
export function customerParticipants(participants, { thread, customerUserId = null } = {}) {
  return (participants || [])
    .filter((p) => p && (p.thread_id === undefined || idOf(p.thread_id) === idOf(thread?.id)))
    .filter((p) => isCustomerParticipant(p, { thread, customerUserId }))
    .sort(joinedOrder);
}

const party = (displayName, source, identityId = null) => freeze({ display_name: displayName, source, identity_id: identityId });

/**
 * H3 — the conversation's customer (its ONE primary identity) and, on a Marketplace inquiry, the seller as context.
 *
 * @param thread a message_threads row
 * @param ctx { index (createProvenanceIndex — its user(id) gives the account name), inquiryById, smokeThreadIds,
 *              participantsByThread?: Map threadId → participants, identityById?: Map identityId → channel identity }
 * @returns {{ customer: { display_name, source, identity_id }, seller: { display_name } | null }}
 *   source ∈ buyer_account | inquiry_guest | account | channel_identity | provider_smoke_test | unidentified;
 *   identity_id is the customer-side participant's channel identity (an id, never an address), when participants are known.
 */
export function conversationParties(thread, {
  index = null, inquiryById = new Map(), smokeThreadIds = new Set(), participantsByThread = null, identityById = null,
} = {}) {
  const threadId = idOf(thread?.id);
  const participants = (threadId && participantsByThread?.get?.(threadId)) || [];
  if (threadId && smokeThreadIds?.has?.(threadId)) {
    const smokeIdentity = customerParticipants(participants, { thread, customerUserId: idOf(thread?.primary_user_id) })
      .map((p) => idOf(p.external_identity_id)).find(Boolean) || null;
    return freeze({ customer: party(PROVIDER_SMOKE_TEST_LABEL, 'provider_smoke_test', smokeIdentity), seller: null });
  }
  const accountName = (userId) => clean(userId ? index?.user?.(userId)?.name : null);
  const inquiryThread = isMarketplaceInquiryThread(thread);
  const inquiry = inquiryThread ? inquiryById?.get?.(String(thread.subject_id)) || null : null;
  const customerUserId = customerAccountId(thread, { inquiry, participants });
  const side = customerParticipants(participants, { thread, customerUserId });
  const identityId = side.map((p) => idOf(p.external_identity_id)).find(Boolean) || null;

  let customer = null;
  const name = accountName(customerUserId);
  if (name) customer = party(name, inquiryThread ? 'buyer_account' : 'account', identityId);
  else if (inquiryThread && clean(inquiry?.guest_name)) customer = party(clean(inquiry.guest_name), 'inquiry_guest', identityId);

  if (!customer) {
    const fromIdentity = side
      .map((p) => clean(p.external_identity_id ? identityById?.get?.(String(p.external_identity_id))?.display_name : null))
      .find(Boolean);
    const fromParticipant = side.map((p) => clean(p.display_name)).find(Boolean);
    const external = fromIdentity || fromParticipant;
    if (external) customer = party(external, 'channel_identity', identityId);
  }
  if (!customer) customer = party(UNIDENTIFIED_CUSTOMER, 'unidentified', identityId);

  const seller = inquiryThread ? freeze({ display_name: accountName(thread?.primary_user_id) }) : null;
  return freeze({ customer, seller });
}
