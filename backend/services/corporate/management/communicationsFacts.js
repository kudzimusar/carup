/**
 * CA-OWNER-02 (A, H) — the Communications position for the Corporate read model.
 *
 * It uses the SAME conversation truth as the Command Center (services/communication/conversationTruth*.js): a conversation
 * counts as operational only when K2B places its real customer as operational; needs-review is reported apart; certification,
 * UAT, automation and historical conversations are filtered out of the working figures and are never overdue.
 *
 * "Overdue" is measured against the reply targets the product records (a governed SLA policy when one exists, otherwise the
 * default priority response target stamped at creation) and says which. Dead-letter notifications are a technical delivery
 * figure (Platform), with their age and their recipients' K2B classes.
 */
import { loadConversationTruth } from '../../communication/conversationTruthLoader.js';
import { TERMINAL_STATUSES } from '../../communication/conversationTruth.js';
import { readFact, CURRENT_WINDOW } from './managementFact.js';
import { exactCount, readAllRows, shared, provenanceOf, unknownProvenance, extentOf, K2B_AUTHORITY } from './sourceReads.js';
import { createSourceContext } from './sourceContext.js';

export const THREAD_COLUMNS = [
  'id', 'status', 'subject_type', 'subject_id', 'primary_user_id', 'assigned_admin_id', 'assigned_user_id', 'assigned_team',
  'first_response_at', 'sla_due_at', 'first_response_due_at', 'next_response_due_at', 'sla_policy_id', 'sla_paused_at',
  'sla_pause_reason', 'last_inbound_at', 'last_outbound_at', 'created_at',
].join(', ');

const SCOPE = 'Staging · all CarUp organisations · K2B-operational conversations only';
const SOURCE = 'message_threads + messages · conversation truth (K2B on the real customer)';

/** The open conversations and their truth, read once per request. Throws when any source read fails. */
export function conversationTruthSource(client, { now = new Date() } = {}) {
  return shared(async () => {
    const threads = await readAllRows(client, 'message_threads', THREAD_COLUMNS);
    const open = threads.filter((t) => !TERMINAL_STATUSES.includes(String(t.status || '')));
    const [{ truths, summary }, activePolicies] = await Promise.all([
      loadConversationTruth(client, { threads: open, now }),
      exactCount(client, 'communication_sla_policies', { shape: (q) => q.eq('active', true) }),
    ]);
    return { open, truths, summary, activePolicies };
  });
}

export async function readCommunicationsFacts(client, {
  now = new Date(), ctx = createSourceContext(client, { now }), conversations = conversationTruthSource(client, { now }),
} = {}) {
  const spec = (id, label, extra = {}) => ({ id, label, kind: 'operational', source: { authority: SOURCE }, asOf: now, scope: SCOPE, window: CURRENT_WINDOW, ...extra });
  const run = (s, reader) => readFact(s, reader, { now });
  const categoryProvenance = ({ summary, open }) => ({
    authority: `${K2B_AUTHORITY} · conversation truth`,
    raw: open.length,
    operational: summary.operational.open,
    excluded_non_operational: summary.non_operational_open,
    unknown_requires_review: summary.needs_review.open,
    by_category: { ...summary.by_category },
  });

  const facts = await Promise.all([
    run(spec('communications.conversation.open', 'Open operational conversations'), async () => {
      const c = await conversations();
      return { value: c.summary.operational.open, provenance: categoryProvenance(c) };
    }),
    run(spec('communications.conversation.awaiting_reply', 'Operational conversations awaiting a reply', {
      detail: 'The customer spoke last and no reply has been sent since.',
    }), async () => {
      const c = await conversations();
      return { value: c.summary.operational.awaiting_reply, extent: { oldestAt: c.summary.operational.oldest_awaiting_since, newestAt: null } };
    }),
    run(spec('communications.conversation.overdue', 'Operational conversations past their reply target'), async () => {
      const c = await conversations();
      return {
        value: c.summary.operational.overdue,
        detail: c.activePolicies === 0
          ? 'Measured against the default priority response targets stamped at creation — no governed SLA policy is configured.'
          : `Measured against ${c.activePolicies} active SLA polic${c.activePolicies === 1 ? 'y' : 'ies'} and the default priority targets.`,
      };
    }),
    run(spec('communications.conversation.no_individual_assignee', 'Open operational conversations with no individual assignee', {
      detail: 'A team queue is not an individual owner.',
    }), async () => ({ value: (await conversations()).summary.operational.no_individual_assignee })),
    run(spec('communications.conversation.needs_review', 'Conversations needing provenance review', {
      detail: 'K2B cannot place the customer. They stay in the working inbox and are never counted as operational.',
    }), async () => {
      const c = await conversations();
      return { value: c.summary.needs_review.open, extent: { oldestAt: c.summary.needs_review.oldest_awaiting_since, newestAt: null } };
    }),
    run(spec('communications.conversation.non_operational', 'Certification, UAT, automation and historical conversations', {
      detail: 'Filtered out of the working inbox by provenance evidence. Nothing is deleted.',
    }), async () => {
      const c = await conversations();
      return { value: c.summary.non_operational_open, provenance: categoryProvenance(c) };
    }),
    run(spec('communications.notification.dead_letter', 'Dead-letter notifications (delivery failures)', {
      kind: 'technical', scope: 'Staging · all notification deliveries',
      source: { authority: 'notification_queue (status dead_letter)' },
      detail: 'Technical delivery state, owned by Platform. Recipient classes come from K2B.',
    }), async () => {
      const rows = await readAllRows(client, 'notification_queue', 'id, status, channel, recipient_user_id, created_at', (q) => q.eq('status', 'dead_letter'));
      const people = await ctx.users();
      const classified = rows.map((r) => (r.recipient_user_id ? people.index.identity(r.recipient_user_id) : unknownProvenance('no_recipient_account')));
      return { value: rows.length, provenance: provenanceOf(classified), extent: extentOf(rows.map((r) => r.created_at)) };
    }),
  ]);
  return { facts, conversations };
}
