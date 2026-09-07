/**
 * Trade OS T7.6 — read/unread truthfulness for Trade OS conversations.
 *
 * The T7 closure report admitted unread counts were uncertified. They turn out to be derived
 * correctly by design; what was missing was proof. These tests pin every rule the phase contract
 * names, against the real service with an in-memory repository.
 *
 * The load-bearing property: unread is COMPUTED from canonical facts on every read
 * (`message_participants.last_read_at` vs `messages.created_at`), never cached, so it cannot drift
 * from the truth it claims to summarise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { CommunicationConversationService } = await import('../services/communication/communicationConversationService.js');

const T = 'thread-1';
const T2 = 'thread-2';
const PERMS = { read: true, send: true };

/** The smallest repository that behaves like the real one for these paths. */
function repo(seed) {
  const db = {
    message_threads: seed.threads || [],
    message_participants: seed.participants || [],
    messages: seed.messages || [],
  };
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) =>
    Array.isArray(v) ? v.includes(row[k]) : row[k] === v);
  return {
    db,
    async list(table, filter = {}) { return db[table].filter((r) => matches(r, filter)); },
    async findOne(table, filter = {}) { return db[table].find((r) => matches(r, filter)) || null; },
    async updateById(table, id, patch) {
      const row = db[table].find((r) => r.id === id);
      Object.assign(row, patch);
      return row;
    },
  };
}

// Deliberately in the PAST: markRead writes a real `now()`, and a fixture timestamped in the
// future would leave a message "unread" after it had been read — a fixture bug that reads exactly
// like a product bug.
const at = (min) => new Date(Date.UTC(2026, 8, 1, 10, min, 0)).toISOString();

/** A ↔ B on one Trade OS thread. */
const base = () => ({
  threads: [{ id: T, thread_type: 'marketplace_inquiry', subject_type: 'diaspora_rfq', subject_id: 'o1:sup', status: 'open' }],
  participants: [
    { id: 'pA', thread_id: T, user_id: 'A', permissions: PERMS, last_read_at: null },
    { id: 'pB', thread_id: T, user_id: 'B', permissions: PERMS, last_read_at: null },
  ],
  messages: [],
});

const svc = (r) => new CommunicationConversationService({ repository: r });
const unreadFor = async (r, user, threadId = T) => {
  const list = await svc(r).listConversationsForUser(user);
  return (list.find((c) => c.id === threadId) || {}).unread_count;
};

test('A sends to B: B has one unread', async () => {
  const seed = base();
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'B'), 1);
});

test("A's own message never becomes A's unread", async () => {
  const seed = base();
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'A'), 0, 'a person is not unread on what they said themselves');
});

test('B opens the thread: the count clears through the canonical read marker', async () => {
  const seed = base();
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'B'), 1);
  await svc(r).markRead(T, { id: 'B' });
  assert.equal(await unreadFor(r, 'B'), 0);
  // It cleared because last_read_at moved, not because a counter was decremented somewhere.
  assert.ok(r.db.message_participants.find((p) => p.id === 'pB').last_read_at);
});

test('A sends again: B is unread again', async () => {
  const seed = base();
  seed.participants.find((p) => p.id === 'pB').last_read_at = at(5);
  seed.messages.push(
    { id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' },
    { id: 'm2', thread_id: T, sender_participant_id: 'pA', created_at: at(9), direction: 'inbound' },
  );
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'B'), 1, 'only the message after the read marker counts');
});

test('two Trade OS threads keep independent counts', async () => {
  const seed = base();
  seed.threads.push({ id: T2, thread_type: 'marketplace_inquiry', subject_type: 'diaspora_container_booking', subject_id: 's1:B', status: 'open' });
  seed.participants.push(
    { id: 'pA2', thread_id: T2, user_id: 'A', permissions: PERMS, last_read_at: null },
    { id: 'pB2', thread_id: T2, user_id: 'B', permissions: PERMS, last_read_at: null },
  );
  seed.messages.push(
    { id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' },
    { id: 'm2', thread_id: T2, sender_participant_id: 'pA2', created_at: at(2), direction: 'inbound' },
    { id: 'm3', thread_id: T2, sender_participant_id: 'pA2', created_at: at(3), direction: 'inbound' },
  );
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'B', T), 1);
  assert.equal(await unreadFor(r, 'B', T2), 2);
  await svc(r).markRead(T, { id: 'B' });
  assert.equal(await unreadFor(r, 'B', T), 0);
  assert.equal(await unreadFor(r, 'B', T2), 2, 'reading one trade must not clear another');
});

test("another participant's reading does not clear mine", async () => {
  const seed = base();
  seed.participants.push({ id: 'pC', thread_id: T, user_id: 'C', permissions: PERMS, last_read_at: null });
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  await svc(r).markRead(T, { id: 'C' });
  assert.equal(await unreadFor(r, 'B'), 1);
  assert.equal(await unreadFor(r, 'C'), 0);
});

test('the count persists across reads — it is recomputed, never cached', async () => {
  const seed = base();
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  // Refresh and relogin are just repeated reads of the same canonical facts.
  for (let i = 0; i < 3; i += 1) assert.equal(await unreadFor(r, 'B'), 1);
});

test('a MUTED participant is not silently treated as having read', async () => {
  const seed = base();
  seed.participants.find((p) => p.id === 'pB').notification_muted = true;
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'B'), 1, 'muting notifications silences the alert, not the fact');
});

test('a client-supplied unread_count is ignored — the server computes it', async () => {
  const seed = base();
  seed.threads[0].unread_count = 999;
  seed.participants.find((p) => p.id === 'pB').unread_count = 999;
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'B'), 1);
});

test('a foreign user cannot move another participant\'s read marker', async () => {
  const seed = base();
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  await assert.rejects(() => svc(r).markRead(T, { id: 'STRANGER' }), /not found/i);
  assert.equal(r.db.message_participants.find((p) => p.id === 'pB').last_read_at, null,
    "a stranger's failed call must not touch anybody's marker");
  assert.equal(await unreadFor(r, 'B'), 1);
});

test('a participant who has left the conversation is not listed at all', async () => {
  const seed = base();
  seed.participants.find((p) => p.id === 'pB').left_at = at(2);
  seed.messages.push({ id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'inbound' });
  const r = repo(seed);
  assert.equal((await svc(r).listConversationsForUser('B')).length, 0);
});

test('internal-only messages never inflate a customer\'s unread count', async () => {
  const seed = base();
  seed.messages.push(
    { id: 'm1', thread_id: T, sender_participant_id: 'pA', created_at: at(1), direction: 'internal' },
    { id: 'm2', thread_id: T, sender_participant_id: 'pA', created_at: at(2), direction: 'inbound' },
  );
  const r = repo(seed);
  assert.equal(await unreadFor(r, 'B'), 1, 'an internal note is not a message to the customer');
});

/**
 * §13 — query shape. The inbox must not issue a read per thread. This is the defect that once made
 * this the slowest call in the Seller journey, and it grows silently with a user's thread count.
 */
test('the inbox is bounded: constant queries regardless of thread count', async () => {
  const seed = base();
  for (let i = 0; i < 25; i += 1) {
    const id = `t-${i}`;
    seed.threads.push({ id, thread_type: 'marketplace_inquiry', subject_type: 'diaspora_rfq', subject_id: `o${i}:s`, status: 'open' });
    seed.participants.push({ id: `p-${i}`, thread_id: id, user_id: 'B', permissions: PERMS, last_read_at: null });
    seed.messages.push({ id: `m-${i}`, thread_id: id, sender_participant_id: 'pX', created_at: at(1), direction: 'inbound' });
  }
  const r = repo(seed);
  let calls = 0;
  const counting = { ...r, async list(...a) { calls += 1; return r.list(...a); }, async findOne(...a) { calls += 1; return r.findOne(...a); } };
  const rows = await svc(counting).listConversationsForUser('B');
  assert.equal(rows.length, 26);
  assert.ok(calls <= 4, `26 threads must not cost 26 round trips — took ${calls}`);
});
