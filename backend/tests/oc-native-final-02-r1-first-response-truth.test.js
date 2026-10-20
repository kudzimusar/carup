import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationAnalyticsService } from '../services/communication/communicationAnalyticsService.js';

/**
 * OC-NATIVE-FINAL-02-R1 D4 — "median first response 0 min" beside "35 enquiries have had no reply".
 *
 * Measured on staging for the account that owns the Serena: 32 marketplace-enquiry conversations, each
 * holding one buyer message and no reply, plus three CarUp notification threads nobody wrote to. The
 * old metric read `message_threads.first_response_at`, which every templated notification stamps on its
 * own thread seconds after creating it, and silently dropped every unreplied conversation — so the
 * median of three notification stamps (0.03, 0.04 and 54316 min) was published as a 0-minute response
 * while 32 buyers were still waiting.
 *
 * A first response is now measured from the message record: the clock starts at the first customer
 * message and stops at the first reply a person sent after it. A templated notification, a provider
 * smoke test or an unapproved AI auto-reply is not a reply. Unreplied conversations are counted, and
 * no replied conversation means no median — never 0.
 */

const USER = 'owner-1';
const T0 = Date.parse('2026-10-01T09:00:00.000Z');
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();

function thread(id, extra = {}) {
  return { id, status: 'open', thread_type: 'marketplace_inquiry', business_workflow: 'marketplace', created_at: at(0), ...extra };
}

function participant(threadId) {
  return { id: `p-${threadId}`, thread_id: threadId, user_id: USER };
}

function customerMessage(threadId, minutes) {
  return {
    id: `in-${threadId}-${minutes}`,
    thread_id: threadId,
    direction: 'inbound',
    sender_participant_id: `buyer-${threadId}`,
    sender_user_id: `buyer-${threadId}`,
    created_at: at(minutes),
    ai_generated: false,
  };
}

function personReply(threadId, minutes, extra = {}) {
  return {
    id: `out-${threadId}-${minutes}`,
    thread_id: threadId,
    direction: 'outbound',
    sender_participant_id: `p-${threadId}`,
    sender_user_id: USER,
    created_at: at(minutes),
    ai_generated: false,
    human_approved: true,
    ...extra,
  };
}

// Exactly what queueNotification records: outbound, no sender, a rendered template.
function carUpNotification(threadId, minutes) {
  return {
    id: `ntf-${threadId}-${minutes}`,
    thread_id: threadId,
    direction: 'outbound',
    sender_participant_id: null,
    sender_user_id: null,
    created_at: at(minutes),
    ai_generated: false,
    human_approved: false,
    content_json: { template_key: 'message_acknowledgement_v1' },
  };
}

async function responseTimeFor(seed, options = {}, Repository = MemoryCommunicationRepository) {
  const repository = new Repository(seed);
  return (await new CommunicationAnalyticsService({ repository }).getUserAnalytics(USER, options)).response_time;
}

test('no conversations: nothing is measured and no time is stated', async () => {
  const rt = await responseTimeFor({});
  assert.equal(rt.state, 'no_conversations');
  assert.equal(rt.eligible, 0);
  assert.equal(rt.replied, 0);
  assert.equal(rt.unreplied, 0);
  assert.equal(rt.median_minutes, null);
  assert.equal(rt.average_minutes, null);
  assert.equal(rt.p95_minutes, null);
});

test('only unreplied conversations: each is counted as waiting and there is no median', async () => {
  const ids = ['t1', 't2', 't3'];
  const rt = await responseTimeFor({
    message_participants: ids.map(participant),
    message_threads: ids.map((id) => thread(id)),
    messages: ids.map((id) => customerMessage(id, 0)),
  });
  assert.equal(rt.state, 'no_replies');
  assert.equal(rt.eligible, 3);
  assert.equal(rt.replied, 0);
  assert.equal(rt.unreplied, 3);
  assert.equal(rt.median_minutes, null);
  assert.equal(rt.average_minutes, null);
  assert.equal(rt.p95_minutes, null);
});

test('replied conversation: the time runs from the customer message to the first reply a person sent', async () => {
  const rt = await responseTimeFor({
    message_participants: [participant('t1')],
    message_threads: [thread('t1')],
    messages: [customerMessage('t1', 0), personReply('t1', 30), personReply('t1', 90)],
  });
  assert.equal(rt.state, 'measured');
  assert.equal(rt.eligible, 1);
  assert.equal(rt.replied, 1);
  assert.equal(rt.unreplied, 0);
  assert.equal(rt.median_minutes, 30);
  assert.equal(rt.average_minutes, 30);
});

test('mixed: notifications and unapproved AI are not replies, and unreplied conversations stay in the denominator', async () => {
  const rt = await responseTimeFor({
    message_participants: ['a', 'b', 'c', 'd', 'e', 'f'].map(participant),
    message_threads: [
      thread('a'), thread('b'), thread('c'),
      thread('d', { thread_type: 'account', business_workflow: null }),
      thread('e'), thread('f'),
    ],
    messages: [
      customerMessage('a', 0), personReply('a', 10),
      // A CarUp notification seconds after the enquiry is not the seller's reply.
      customerMessage('b', 0), carUpNotification('b', 0.05), personReply('b', 50),
      // An AI auto-reply nobody approved is not a reply; the enquiry is still waiting.
      customerMessage('c', 0), personReply('c', 1, { ai_generated: true, human_approved: false }),
      // A notification thread nobody wrote to is not a conversation awaiting a reply.
      carUpNotification('d', 0.03),
      // A message sent BEFORE the customer wrote does not answer them.
      personReply('e', 0), customerMessage('e', 5),
      // An AI draft a person approved and sent is that person's reply.
      customerMessage('f', 0), personReply('f', 20, { ai_generated: true, human_approved: true }),
    ],
  });
  assert.equal(rt.state, 'measured');
  assert.equal(rt.eligible, 5, 'a, b, c, e and f each had a customer waiting; d did not');
  assert.equal(rt.replied, 3, 'a (10), b (50) and f (20)');
  assert.equal(rt.unreplied, 2, 'c and e');
  assert.equal(rt.median_minutes, 20);
  assert.equal(rt.average_minutes, 26.7);
});

test('a thread stamped by a notification is not a reply: the staging shape publishes no 0-minute response', async () => {
  const rt = await responseTimeFor({
    message_participants: [participant('ntf'), participant('enq')],
    message_threads: [
      thread('ntf', { thread_type: 'account', business_workflow: null, first_response_at: at(0.03) }),
      thread('enq'),
    ],
    messages: [carUpNotification('ntf', 0.03), customerMessage('enq', 0)],
  });
  assert.equal(rt.state, 'no_replies');
  assert.equal(rt.eligible, 1);
  assert.equal(rt.replied, 0);
  assert.equal(rt.unreplied, 1);
  assert.equal(rt.median_minutes, null);
});

test('failed source read: response time is unavailable, never zero, and the rest of the analytics still answers', async () => {
  class FailingMessages extends MemoryCommunicationRepository {
    async list(table, filters, options) {
      if (table === 'messages') throw new Error('messages list failed: timeout');
      return super.list(table, filters, options);
    }
  }
  const repository = new FailingMessages({
    message_participants: [participant('t1')],
    message_threads: [thread('t1')],
    messages: [customerMessage('t1', 0), personReply('t1', 30)],
  });
  const analytics = await new CommunicationAnalyticsService({ repository }).getUserAnalytics(USER);
  assert.equal(analytics.conversations.total, 1);
  const rt = analytics.response_time;
  assert.equal(rt.state, 'unavailable');
  for (const key of ['eligible', 'replied', 'unreplied', 'measured', 'median_minutes', 'average_minutes', 'p95_minutes']) {
    assert.equal(rt[key], null, `${key} must not be stated after a failed read`);
  }
});

test('a capped read that may have missed messages is unavailable rather than a partial median', async () => {
  const rt = await responseTimeFor({
    message_participants: [participant('t1')],
    message_threads: [thread('t1')],
    messages: [customerMessage('t1', 0), personReply('t1', 30), personReply('t1', 40)],
  }, { rowCap: 2 });
  assert.equal(rt.state, 'unavailable');
  assert.equal(rt.median_minutes, null);
  assert.equal(rt.replied, null);
});
