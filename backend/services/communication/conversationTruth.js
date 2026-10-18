/**
 * CA-OWNER-02 (H1/H2) — conversation truth: whose conversation is this, and is a customer really waiting?
 *
 * PURE. One definition shared by the Command Center and the Corporate read model; the caller reads the rows
 * (conversationTruthLoader.js) and this module only judges them.
 *
 * H1 · provenance. This is NOT a new classifier. The accepted operational-provenance authority (PC01-K2B,
 * services/provenance/recordProvenance.js) is asked about the conversation's REAL customer:
 *   1. a provider smoke test is recognised by the server-written `smoke_test` audit event (communication_audit_events),
 *      the only marker no caller can supply — a thread key or metadata can be set through POST /api/communications/threads;
 *   2. a Marketplace inquiry conversation is judged exactly as K2B judges its INQUIRY (asker + listing), because the
 *      thread's primary_user_id is only a compatibility projection of the SELLER;
 *   3. any other conversation is judged by its account principal (primary_user_id);
 *   4. a conversation with no principal K2B can judge is needs-review — never silently operational, never silently test.
 *
 * H2 · SLA truth. A service level applies only while a customer turn is actually waiting for a reply, on a conversation
 * K2B did not place outside operations. Certification / automation / historical records are never "overdue". The
 * creation-time response stamp (message_threads.sla_due_at, from the priority default) is a FIRST-response target: once
 * a first response is recorded it no longer counts, and a later customer turn without a recorded target is "no reply
 * target", not overdue. No timestamp is ever rewritten here.
 */
import { UNKNOWN } from '../provenance/recordProvenance.js';
import { conversationParties } from './conversationCustomer.js';

export const CONVERSATION_CATEGORIES = Object.freeze(['operational', 'needs_review', 'certification', 'automation', 'historical']);

const CATEGORY_BY_CLASS = Object.freeze({
  real_owner_created: 'operational',
  real_business_operational: 'operational',
  historical_real: 'historical',
  uat: 'certification',
  golden_test: 'certification',
  proof_certification: 'certification',
  ci_automation: 'automation',
  seed_demo: 'historical',
  legacy_synthetic: 'historical',
  [UNKNOWN]: 'needs_review',
});

export function categoryForProvenanceClass(cls) {
  return CATEGORY_BY_CLASS[cls] ?? 'needs_review';
}

/** Statuses after which no service level applies. */
export const TERMINAL_STATUSES = Object.freeze(['resolved', 'closed', 'spam']);

export const SLA_TRUTH_STATES = Object.freeze(['live', 'overdue', 'paused', 'not_applicable', 'certification', 'historical']);

const freeze = (o) => Object.freeze(o);

function verdict(provenance, { basis, rule = provenance.rule }) {
  return freeze({
    class: provenance.class,
    operational: provenance.operational === true,
    category: categoryForProvenanceClass(provenance.class),
    rule,
    signals: Object.freeze([...(provenance.signals || [])]),
    basis,
  });
}

const isInquiryConversation = (thread) => thread?.subject_type === 'marketplace_inquiry' && Boolean(thread?.subject_id);

/**
 * @param thread a message_threads row (id, subject_type, subject_id, primary_user_id)
 * @param ctx { index: createProvenanceIndex(...), inquiryById: Map, smokeThreadIds: Set }
 */
export function classifyConversation(thread, { index, inquiryById = new Map(), smokeThreadIds = new Set() } = {}) {
  if (thread?.id && smokeThreadIds.has(String(thread.id))) {
    return verdict({ class: 'ci_automation', operational: false, signals: ['communication_audit_events.smoke_test'] }, { basis: 'smoke_test_audit', rule: 'audit_event:provider_smoke_test' });
  }
  if (isInquiryConversation(thread)) {
    const inquiry = inquiryById.get(String(thread.subject_id));
    if (!inquiry) {
      return verdict({ class: UNKNOWN, operational: false, signals: ['inquiry_not_found'] }, { basis: 'marketplace_inquiry', rule: 'inquiry_not_found' });
    }
    return verdict(index.inquiry(inquiry), { basis: 'marketplace_inquiry' });
  }
  const principal = thread?.primary_user_id ? index.identity(thread.primary_user_id) : null;
  if (principal) return verdict(principal, { basis: 'account' });
  return verdict({ class: UNKNOWN, operational: false, signals: ['no_account_principal'] }, { basis: 'none', rule: 'no_account_principal' });
}

const ms = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};
const latest = (...isos) => {
  const best = isos.map((v) => ({ v, t: ms(v) })).filter((x) => x.t !== null).sort((a, b) => b.t - a.t)[0];
  return best ? new Date(best.t).toISOString() : null;
};

const sla = (state, { reason = null, due_at = null, due_source = null, awaiting_since = null } = {}) => freeze({ state, reason, due_at, due_source, awaiting_since });

/**
 * @param thread message_threads row (status, first_response_at, sla_due_at, first_response_due_at, next_response_due_at,
 *               sla_policy_id, sla_paused_at, sla_pause_reason)
 * @param opts { category, latestInboundAt, latestOutboundAt, now }
 */
export function slaTruth(thread, { category, latestInboundAt = null, latestOutboundAt = null, now = new Date() } = {}) {
  const status = String(thread?.status || '');
  if (TERMINAL_STATUSES.includes(status)) return sla('not_applicable', { reason: 'Closed — no service level applies.' });
  if (category === 'certification' || category === 'automation') {
    return sla('certification', { reason: 'Certification, UAT or automation record — no customer service level applies.' });
  }
  if (category === 'historical') return sla('historical', { reason: 'Historical / non-operational record — no live service level applies.' });
  if (thread?.sla_paused_at) return sla('paused', { reason: thread.sla_pause_reason ? `SLA paused (${thread.sla_pause_reason}).` : 'SLA paused.' });
  if (status === 'awaiting_user') return sla('not_applicable', { reason: 'Waiting on the customer.' });
  if (status === 'awaiting_ai') return sla('not_applicable', { reason: 'With the AI assistant.' });

  const inbound = ms(latestInboundAt);
  const outbound = ms(latestOutboundAt);
  if (inbound === null) return sla('not_applicable', { reason: 'No customer message is waiting for a reply.' });
  if (outbound !== null && outbound >= inbound) return sla('not_applicable', { reason: 'Replied — waiting on the customer.' });

  const awaitingSince = new Date(inbound).toISOString();
  let dueAt = null;
  let source = null;
  if (!thread?.first_response_at) {
    dueAt = thread?.first_response_due_at || thread?.sla_due_at || null;
    source = thread?.first_response_due_at ? 'service_target' : 'default_priority_target';
  } else if (thread?.next_response_due_at) {
    dueAt = thread.next_response_due_at;
    source = 'service_target';
  }
  if (!dueAt || ms(dueAt) === null) {
    return sla('not_applicable', { reason: 'A customer is waiting, but no reply target is recorded for this turn.', awaiting_since: awaitingSince });
  }
  if (thread?.sla_policy_id) source = 'sla_policy';
  const dueIso = new Date(ms(dueAt)).toISOString();
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  return sla(ms(dueAt) < nowMs ? 'overdue' : 'live', { due_at: dueIso, due_source: source, awaiting_since: awaitingSince });
}

/**
 * The whole truth for one conversation. `ctx.latestByThread` maps thread id → { inbound, outbound } latest message times
 * (from messages), used together with the thread's own last_inbound_at / last_outbound_at stamps.
 *
 * H3 adds WHO the conversation is with (`customer`, and the `seller` as context on a Marketplace inquiry) — see
 * conversationCustomer.js. It is identity only: no classification or SLA verdict reads it.
 */
export function conversationTruth(thread, ctx = {}, now = new Date()) {
  const provenance = classifyConversation(thread, ctx);
  const fromMessages = ctx.latestByThread?.get(String(thread?.id)) || {};
  const latestInboundAt = latest(thread?.last_inbound_at, fromMessages.inbound);
  const latestOutboundAt = latest(thread?.last_outbound_at, fromMessages.outbound);
  const truth = slaTruth(thread, { category: provenance.category, latestInboundAt, latestOutboundAt, now });
  const open = !TERMINAL_STATUSES.includes(String(thread?.status || ''));
  const awaitingReply = open && truth.awaiting_since !== null
    || (open && ['overdue', 'live'].includes(truth.state));
  const parties = conversationParties(thread, ctx);
  return freeze({
    thread_id: thread?.id ?? null,
    status: thread?.status ?? null,
    open,
    provenance,
    category: provenance.category,
    sla: truth,
    awaiting_reply: awaitingReply,
    latest_inbound_at: latestInboundAt,
    latest_outbound_at: latestOutboundAt,
    no_individual_assignee: open && !thread?.assigned_admin_id && !thread?.assigned_user_id,
    assigned_team: thread?.assigned_team ?? null,
    customer: parties.customer,
    seller: parties.seller,
  });
}

const zeroWork = () => ({ open: 0, awaiting_reply: 0, overdue: 0, live: 0, no_individual_assignee: 0, oldest_awaiting_since: null });

function addWork(bucket, t) {
  if (!t.open) return;
  bucket.open += 1;
  if (t.no_individual_assignee) bucket.no_individual_assignee += 1;
  if (t.awaiting_reply) {
    bucket.awaiting_reply += 1;
    const since = t.sla.awaiting_since;
    if (since && (!bucket.oldest_awaiting_since || since < bucket.oldest_awaiting_since)) bucket.oldest_awaiting_since = since;
  }
  if (t.sla.state === 'overdue') bucket.overdue += 1;
  if (t.sla.state === 'live') bucket.live += 1;
}

/** Counts for a header strip or a Corporate fact. Needs-review is never counted as operational. */
export function summarizeConversationTruth(list = []) {
  const byCategory = Object.fromEntries(CONVERSATION_CATEGORIES.map((c) => [c, 0]));
  const operational = zeroWork();
  const needsReview = zeroWork();
  let nonOperationalOpen = 0;
  for (const t of list) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    if (t.category === 'operational') addWork(operational, t);
    else if (t.category === 'needs_review') addWork(needsReview, t);
    else if (t.open) nonOperationalOpen += 1;
  }
  return freeze({ total: list.length, by_category: freeze(byCategory), operational: freeze(operational), needs_review: freeze(needsReview), non_operational_open: nonOperationalOpen });
}
