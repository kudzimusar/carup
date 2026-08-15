import { test } from 'node:test';
import assert from 'node:assert';

const { CommunicationInboundService } = await import('../services/communication/communicationInboundService.js');

/**
 * A bound inbound must be attributed to the conversation's OWN participant.
 *
 * Physically reproduced on staging (Gate E attempt 1): a real Meta webhook from a shared WhatsApp
 * address resolved, correctly, through the provider-ingress fallback to a tenant-owned Marketplace
 * thread and that tenant's bound participant. Ingestion then discarded the resolved participant and
 * called ensureParticipant() with the PLATFORM-CONTEXT ingress identity, minting a second
 * participant that carried the tenant-null identity and its user id into the other tenant's
 * conversation. Routing was right; attribution was wrong.
 *
 * The ingress identity is an ingress identity only. Once a conversation has been resolved, its
 * participant is authoritative, and a broken invariant must fail closed rather than manufacture a
 * replacement — manufacturing one is precisely what caused the defect.
 */

const PLATFORM_IDENTITY = {
  id: 'id-platform', tenant_id: null, user_id: 'u-platform',
  channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  external_id: '818081201356', normalized_address: '818081201356', display_name: 'Platform Ingress',
};
const CROCO_IDENTITY = {
  id: 'id-croco', tenant_id: 'tenant-croco', user_id: null,
  channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  external_id: '818081201356', normalized_address: '818081201356',
};
const THREAD_CROCO = { id: 'thread-croco', tenant_id: 'tenant-croco', primary_channel: 'whatsapp', status: 'open' };
const P_CROCO_BUYER = {
  id: 'p-croco-buyer', thread_id: 'thread-croco', user_id: null,
  participant_type: 'external_contact', stakeholder_role: 'buyer',
  external_identity_id: 'id-croco', left_at: null,
};
const BINDING = { id: 'b-croco', thread_id: 'thread-croco', participant_id: 'p-croco-buyer', channel_identity_id: 'id-croco', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', can_receive: true, can_send: true };

function harness({ boundConversation, participants }) {
  const ensureParticipantCalls = [];
  const recorded = [];
  const analytics = [];
  const state = { participants: [...participants] };

  const repository = {
    async list(table) {
      if (table === 'messages') return [];
      if (table === 'message_participants') return state.participants;
      return [];
    },
    async findOne() { return null; },
    async insert(_t, row) { return row; },
    async updateById(_t, _id, patch) { return patch; },
  };
  const conversationService = {
    async resolveInboundConversation() { return boundConversation; },
    async ensureParticipant(threadId, input) {
      // The defect: this used to run on the bound path too, minting a second participant.
      const created = { id: `p-created-${state.participants.length}`, thread_id: threadId, ...input, left_at: null };
      ensureParticipantCalls.push({ threadId, input });
      state.participants.push(created);
      return created;
    },
    async recordAnalytics(input) { analytics.push(input); },
    async recordInboundBinding() { return null; },
    async participantForUser() { return null; },
  };
  const services = {
    repository,
    identityService: { async resolveOrCreateIdentity() { return PLATFORM_IDENTITY; } },
    threadService: {
      async recordMessage(thread, input) { const m = { id: 'msg-1', thread_id: thread.id, ...input }; recorded.push(m); return m; },
      async resolveOrCreateThread() { return { thread: THREAD_CROCO, created: false }; },
      async addParticipant(threadId, input) { const c = { id: 'p-added', thread_id: threadId, ...input }; state.participants.push(c); return c; },
      async applySlaPolicy() { return THREAD_CROCO; },
      async escalateThread() { return THREAD_CROCO; },
      async teamForThread() { return null; },
      async markRead() { return null; },
    },
    notificationService: { async queueNotification() { return {}; }, async queueExistingMessage() { return { notification: null }; } },
    referralChannelGateway: { async processInbound() { return null; } },
    aiService: { async classify() { return null; }, async safeAnswer() { return null; } },
  };
  const svc = new CommunicationInboundService({ ...services, conversationService });
  return { svc, ensureParticipantCalls, recorded, analytics, state };
}

const INBOUND = {
  channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  externalSenderId: '818081201356', text: 'CarUp GateE',
  providerMessageId: 'wamid.TEST1',
};

test('a bound provider-ingress inbound is attributed to the conversation participant, and creates none', async () => {
  const bound = { thread: THREAD_CROCO, participant: P_CROCO_BUYER, binding: BINDING, resolution: 'provider_ingress_address_binding' };
  const { svc, ensureParticipantCalls, recorded, analytics, state } = harness({
    boundConversation: bound, participants: [P_CROCO_BUYER],
  });
  const before = state.participants.length;
  await svc.ingest(INBOUND);
  const after = state.participants.length;

  assert.equal(before, after, 'participant count must not change');
  assert.equal(ensureParticipantCalls.length, 0, 'ensureParticipant must not run on the bound path');
  assert.equal(recorded[0].sender_participant_id, 'p-croco-buyer');
  // p-croco-buyer.user_id is null, so attribution must be null — NOT the platform identity's user.
  assert.equal(recorded[0].sender_user_id, null, 'must not copy the ingress identity user into a tenant conversation');
  assert.notEqual(recorded[0].sender_user_id, 'u-platform');
  assert.equal(analytics[0]?.participantId, 'p-croco-buyer', 'analytics must use the canonical participant');
  assert.ok(!state.participants.some((p) => p.external_identity_id === 'id-platform'),
    'no participant carrying the platform identity may be created');
});

test('a bound participant WITH a user id attributes sender_user_id to that participant', async () => {
  const owned = { ...P_CROCO_BUYER, user_id: 'u-croco-buyer' };
  const bound = { thread: THREAD_CROCO, participant: owned, binding: BINDING, resolution: 'provider_ingress_address_binding' };
  const { svc, recorded, ensureParticipantCalls } = harness({ boundConversation: bound, participants: [owned] });
  await svc.ingest(INBOUND);
  assert.equal(recorded[0].sender_user_id, 'u-croco-buyer');
  assert.notEqual(recorded[0].sender_user_id, 'u-platform');
  assert.equal(ensureParticipantCalls.length, 0);
});

test('direct-binding inbound reuses its existing participant and creates no additional one', async () => {
  const directParticipant = { id: 'p-direct', thread_id: 'thread-croco', user_id: 'u-direct', participant_type: 'user', stakeholder_role: 'buyer', external_identity_id: 'id-direct', left_at: null };
  const bound = { thread: THREAD_CROCO, participant: directParticipant, binding: BINDING, resolution: 'active_channel_binding' };
  const { svc, recorded, ensureParticipantCalls, state } = harness({ boundConversation: bound, participants: [directParticipant] });
  const before = state.participants.length;
  await svc.ingest(INBOUND);
  assert.equal(state.participants.length, before, 'direct-binding path must not add a participant');
  assert.equal(ensureParticipantCalls.length, 0);
  assert.equal(recorded[0].sender_participant_id, 'p-direct');
  assert.equal(recorded[0].sender_user_id, 'u-direct');
});

test('a genuinely UNBOUND inbound may still create a participant', async () => {
  const { svc, ensureParticipantCalls, recorded } = harness({ boundConversation: null, participants: [] });
  await svc.ingest(INBOUND);
  assert.equal(ensureParticipantCalls.length, 1, 'unbound inbound is the only path allowed to create one');
  assert.equal(recorded[0].sender_user_id, 'u-platform', 'unbound attribution still comes from the ingress identity');
});

test('a resolved participant belonging to another thread fails closed, and no participant is invented', async () => {
  const foreign = { ...P_CROCO_BUYER, id: 'p-foreign', thread_id: 'thread-other' };
  const bound = { thread: THREAD_CROCO, participant: foreign, binding: BINDING, resolution: 'provider_ingress_address_binding' };
  const { svc, ensureParticipantCalls, recorded } = harness({ boundConversation: bound, participants: [foreign] });
  await assert.rejects(() => svc.ingest(INBOUND), (e) => e.code === 'inbound_participant_invariant_failed');
  assert.equal(ensureParticipantCalls.length, 0, 'must not fall back to manufacturing a participant');
  assert.equal(recorded.length, 0, 'no message may be recorded');
});

test('a resolved participant that has left fails closed', async () => {
  const departed = { ...P_CROCO_BUYER, left_at: '2026-08-01T00:00:00Z' };
  const bound = { thread: THREAD_CROCO, participant: departed, binding: BINDING, resolution: 'provider_ingress_address_binding' };
  const { svc, ensureParticipantCalls } = harness({ boundConversation: bound, participants: [departed] });
  await assert.rejects(() => svc.ingest(INBOUND), (e) => e.code === 'inbound_participant_invariant_failed');
  assert.equal(ensureParticipantCalls.length, 0);
});
