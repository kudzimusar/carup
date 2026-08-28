import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECIPIENT_RESOLUTION_REASONS,
  resolveNotificationRecipient,
} from '../services/communication/emailExperience/recipientResolution.js';

/**
 * G0 — recipient resolution.
 *
 * The defect this closes: `queueFromDomainEvent` writes `payload: { event_type, safe_payload }` with no
 * address, the worker reads the address only from `notification.payload`, and the adapter then hard-fails
 * `recipient_missing`. Address enrichment existed ONLY on the fallback route, so every policy-driven Email
 * failed its first attempt and succeeded — if at all — by fallback.
 *
 * All six email-eligible NOTIFICATION_POLICIES entries route through that path, so this is the whole
 * policy-driven surface, not an edge case.
 */

function repoWith({ identities = [], users = [] } = {}) {
  const calls = [];
  return {
    calls,
    list: async (table, filters) => {
      calls.push({ table, filters });
      if (table !== 'channel_identities') return [];
      return identities.filter((row) => Object.entries(filters)
        .every(([k, v]) => v === undefined || row[k] === v));
    },
    findOne: async (table, filters) => {
      calls.push({ table, filters });
      if (table !== 'users') return null;
      return users.find((u) => u.id === filters.id) || null;
    },
  };
}

const notif = (over = {}) => ({ id: 1, channel: 'email', payload: {}, ...over });

test('an explicit payload address still wins — existing producers keep working', async () => {
  const repo = repoWith({ users: [{ id: 'u1', email: 'profile@example.test' }] });
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1', payload: { email: 'explicit@example.test' } }),
    repository: repo,
  });
  assert.equal(r.ok, true);
  assert.equal(r.address, 'explicit@example.test');
  assert.equal(repo.calls.length, 0, 'an explicit address must not trigger any lookup');
});

test('a verified channel identity resolves the address', async () => {
  const repo = repoWith({
    identities: [{ id: 'ci1', channel: 'email', user_id: 'u1', verified: true, normalized_address: 'verified@example.test' }],
    users: [{ id: 'u1', email: 'profile@example.test' }],
  });
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1' }),
    repository: repo,
  });
  assert.equal(r.ok, true);
  assert.equal(r.address, 'verified@example.test');
  assert.equal(r.identityId, 'ci1');
  assert.equal(r.verified, true);
});

test('an UNVERIFIED channel identity is refused, and the account profile is used instead', async () => {
  const repo = repoWith({
    identities: [{ id: 'ci1', channel: 'email', user_id: 'u1', verified: false, normalized_address: 'unverified@example.test' }],
    users: [{ id: 'u1', email: 'profile@example.test' }],
  });
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1' }),
    repository: repo,
  });
  assert.equal(r.ok, true);
  assert.equal(r.address, 'profile@example.test', 'an unverified identity must never be used as the address');
});

test('the account profile resolves when no channel identity exists', async () => {
  const repo = repoWith({ users: [{ id: 'u1', email: 'profile@example.test' }] });
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1' }),
    repository: repo,
  });
  assert.equal(r.ok, true);
  assert.equal(r.address, 'profile@example.test');
  assert.equal(r.userId, 'u1');
});

test('FAIL CLOSED when nothing resolves — and the reason is not a provider failure', async () => {
  const repo = repoWith({ users: [{ id: 'u1', email: null }] });
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1' }),
    repository: repo,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, RECIPIENT_RESOLUTION_REASONS.NO_VERIFIED_ADDRESS);
  // The whole point of a distinct reason: an unresolved recipient is OUR defect, a provider failure is theirs.
  assert.ok(!String(r.reason).startsWith('provider'));
});

test('no recipient reference at all is a distinct, non-enumerating failure', async () => {
  const r = await resolveNotificationRecipient({ notification: notif(), repository: repoWith() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, RECIPIENT_RESOLUTION_REASONS.NO_RECIPIENT_REFERENCE);
});

test('a failure NEVER echoes an address — no recipient enumeration', async () => {
  const repo = repoWith({ users: [{ id: 'u1', email: null }] });
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1', payload: { probe: 'someone@example.test' } }),
    repository: repo,
  });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('@'), 'a failed resolution must not carry any address');
});

test('a resolved recipient exposes only the four contract fields — no raw user object', async () => {
  const repo = repoWith({ users: [{ id: 'u1', email: 'p@example.test', name: 'Fixture', password_hash: 'SECRET', phone: '+000' }] });
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1' }),
    repository: repo,
  });
  assert.deepEqual(Object.keys(r).sort(), ['address', 'identityId', 'ok', 'userId', 'verified']);
  const s = JSON.stringify(r);
  assert.ok(!s.includes('SECRET') && !s.includes('password'), 'no credential may reach template context');
  assert.ok(!s.includes('Fixture') && !s.includes('+000'), 'no raw user fields may leak');
});

test('a lookup fault is reported as transient, distinct from "no address"', async () => {
  const repo = {
    list: async () => { throw new Error('connection reset'); },
    findOne: async () => { throw new Error('connection reset'); },
  };
  const r = await resolveNotificationRecipient({
    notification: notif({ recipient_user_id: 'u1' }),
    repository: repo,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, RECIPIENT_RESOLUTION_REASONS.LOOKUP_FAILED);
});

test('non-email channels resolve their own address kind', async () => {
  const repo = repoWith({ users: [{ id: 'u1', email: 'e@example.test', phone: '+263771234567' }] });
  const r = await resolveNotificationRecipient({
    notification: notif({ channel: 'sms', recipient_user_id: 'u1' }),
    repository: repo,
  });
  assert.equal(r.ok, true);
  assert.equal(r.address, '+263771234567');
});

// ---------- G0 worker integration ----------

async function worker({ users = [], identities = [], suppressions = [] } = {}) {
  const { CommunicationDeliveryWorker } = await import('../services/communication/communicationDeliveryWorker.js');
  const sent = [];
  const updates = [];
  const repository = {
    list: async (table, filters) => {
      if (table === 'channel_identities') {
        return identities.filter((r) => Object.entries(filters).every(([k, v]) => v === undefined || r[k] === v));
      }
      if (table === 'communication_suppressions') {
        return suppressions.filter((r) => r.channel === filters.channel && r.address === filters.address);
      }
      return [];
    },
    findOne: async (table, filters) => (table === 'users' ? users.find((u) => u.id === filters.id) || null : null),
    updateById: async (t, id, patch) => { updates.push(patch); return { id }; },
    insert: async () => ({ id: 'x' }),
  };
  const adapterRegistry = { get: () => ({ provider: 'resend', send: async (input) => { sent.push(input); return { accepted: true, providerStatus: 'sent' }; } }) };
  return { w: new CommunicationDeliveryWorker({ repository, adapterRegistry }), sent, updates };
}

test('WORKER: a policy-driven notification now resolves its address on the FIRST attempt', async () => {
  // The exact defect: payload is { event_type, safe_payload } with no address.
  const { w, sent } = await worker({ users: [{ id: 'u1', email: 'resolved@example.test' }] });
  await w.deliverNotification({
    id: 1, channel: 'email', recipient_user_id: 'u1', max_attempts: 5, attempt_count: 1,
    // G2: a real policy producer stamps the canonical classification onto the payload.
    payload: { event_type: 'marketplace.inquiry.created', safe_payload: {}, classification: 'transactional' },
  }, { alreadyClaimed: true });
  assert.equal(sent.length, 1, 'the provider must be called on the primary attempt');
  assert.equal(sent[0].recipient.email, 'resolved@example.test');
});

test('WORKER: an unresolved recipient NEVER reaches the provider and is distinctly coded', async () => {
  const { w, sent, updates } = await worker({ users: [{ id: 'u1', email: null }] });
  await w.deliverNotification({
    id: 2, channel: 'email', recipient_user_id: 'u1', max_attempts: 5, attempt_count: 1, payload: {},
  }, { alreadyClaimed: true });
  assert.equal(sent.length, 0, 'fail closed — zero provider calls');
  const code = updates.map((u) => u.last_error_code).find(Boolean);
  assert.match(code, /^recipient_unresolved:/);
  assert.ok(!/^provider/.test(code), 'must not be mistakable for a provider failure');
});

test('WORKER: a transient lookup fault RETRIES rather than dead-lettering', async () => {
  const { CommunicationDeliveryWorker } = await import('../services/communication/communicationDeliveryWorker.js');
  const updates = [];
  let providerCalls = 0;
  const repository = {
    list: async () => { throw new Error('connection reset'); },
    findOne: async () => { throw new Error('connection reset'); },
    updateById: async (t, id, patch) => { updates.push(patch); return { id }; },
    insert: async () => ({ id: 'x' }),
  };
  const w = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: { get: () => ({ provider: 'resend', send: async () => { providerCalls += 1; return { accepted: true }; } }) },
  });
  const r = await w.deliverNotification({
    id: 3, channel: 'email', recipient_user_id: 'u1', max_attempts: 5, attempt_count: 1, payload: {},
  }, { alreadyClaimed: true });
  assert.equal(providerCalls, 0);
  assert.equal(r.status, 'retry_scheduled', 'a transient fault must not be treated as a permanent absence');
  assert.ok(updates.some((u) => u.status === 'retry_scheduled'));
});

test('WORKER: G0 runs BEFORE the suppression guard, so suppression still fires', async () => {
  // Ordering regression. marketingSuppressionFor() reads payload.email; if G0 ran after it, a
  // policy-driven MARKETING notification carrying no address would skip the suppression check
  // entirely and mail somebody who had unsubscribed.
  const { w, sent, updates } = await worker({
    users: [{ id: 'u1', email: 'gone@example.test' }],
    suppressions: [{ channel: 'email', address: 'gone@example.test', scope: 'marketing', reason: 'unsubscribe', released_at: null }],
  });
  await w.deliverNotification({
    id: 4, channel: 'email', recipient_user_id: 'u1', max_attempts: 5, attempt_count: 1,
    payload: { classification: 'marketing' },
  }, { alreadyClaimed: true });
  assert.equal(sent.length, 0, 'a suppressed recipient must never reach the provider');
  assert.ok(updates.some((u) => u.last_error_code === 'recipient_suppressed'));
});
