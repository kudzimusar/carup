/**
 * Trade OS T7.5/T7.7 — provider-channel routing, and the action-request boundary.
 *
 * Neither of these is a new subsystem. Canonical Communications already owns delivery, and a
 * "please provide X" is already expressible as a message on a thread bound to a Trade OS object.
 * What T7 owes is proof of the contracts, and a written boundary so a later phase cannot quietly
 * turn a request into a fact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const policies = await import('../services/communication/communicationNotificationService.js');
const listeners = await import('../services/communication/communicationEventListeners.js');

const TRADE_EVENTS = [
  'diaspora.rfq.quote_submitted',
  'diaspora.logistics.quote_submitted',
  'diaspora.logistics.quote_accepted',
  'diaspora.logistics.quote_not_selected',
  'diaspora.logistics.quote_withdrawn',
  'diaspora.shipment.exception',
];

// ── §6 · provider-channel routing ────────────────────────────────────────────────────────────

test('every Trade OS notification is subscribed AND has a policy', () => {
  for (const e of TRADE_EVENTS) {
    assert.ok(listeners.COMMUNICATION_EVENT_TYPES.includes(e), `${e} is not subscribed`);
    assert.ok(policies.NOTIFICATION_POLICIES[e], `${e} has no notification policy`);
  }
});

/**
 * The governed routing DECISION for Trade OS today is: in-app only.
 *
 * `policyChannelsOnly` means the policy's channel list is authoritative and a user preference
 * cannot widen it into an external send. That is the decision, taken deliberately — not an
 * accident of unconfigured providers — and it is what makes "no external delivery happened"
 * truthful rather than a silent failure.
 */
test('Trade OS routes in-app only, by policy rather than by accident', () => {
  for (const e of TRADE_EVENTS) {
    const p = policies.NOTIFICATION_POLICIES[e];
    assert.deepEqual(p.channels, ['in_app'], `${e} must not route externally without a governed decision`);
    assert.deepEqual(p.fallbackChannels, [], `${e} must not silently fall back to another channel`);
    assert.equal(p.policyChannelsOnly, true, `${e} must not let a preference widen its channels`);
    assert.equal(p.transactional, true);
  }
});

test('a stopped shipment is not routine — it is the one Trade OS notice with high priority', () => {
  assert.equal(policies.NOTIFICATION_POLICIES['diaspora.shipment.exception'].priority, 'high');
});

/**
 * The invariant: canonical record FIRST, then the routing decision, then a delivery attempt, then
 * an outcome. Never an external send that a canonical message is invented for afterwards.
 */
test('the canonical record precedes any channel decision', () => {
  const src = readFileSync(new URL('../services/communication/communicationNotificationService.js', import.meta.url), 'utf-8');
  // The thread and the message are created through the thread service BEFORE anything is queued for
  // a channel: resolveOrCreateThread → recordMessage → notification_queue insert.
  const threadIdx = src.indexOf('resolveOrCreateThread');
  const messageIdx = src.indexOf('recordMessage');
  // The QUEUE ROW, not the idempotency lookup that precedes it — a dedupe check reading
  // notification_queue is not a channel decision, and asserting against it measures the wrong line.
  const queueIdx = src.indexOf("status: 'queued'");
  assert.ok(threadIdx > -1 && messageIdx > -1 && queueIdx > -1, 'the canonical path must exist');
  assert.ok(threadIdx < queueIdx, 'a thread must exist before anything is queued to a channel');
  assert.ok(messageIdx < queueIdx, 'the canonical message must exist before the delivery row');

  // And delivery DRAINS that queue rather than originating a send of its own.
  const worker = readFileSync(new URL('../services/communication/communicationDeliveryWorker.js', import.meta.url), 'utf-8');
  assert.ok(/claimDueNotifications|list\('notification_queue'/.test(worker),
    'delivery must consume queued canonical records rather than originate sends');
});

/**
 * Replay must not send twice. The dedupe key discriminates by the OUTBOX RECORD, falling back to a
 * per-domain object id — and `shipmentId` was missing from that fallback chain, so two different
 * shipments raising an exception for the same person could have collapsed into one notification.
 */
test('replay is idempotent, and each Trade OS object is its own dedupe discriminator', () => {
  const src = readFileSync(new URL('../services/communication/communicationNotificationService.js', import.meta.url), 'utf-8');
  assert.ok(/const existingNotification = await this\.repository\.findOne\('notification_queue', \{ dedupe_key/.test(src),
    'an existing notification for the same dedupe key must be found before inserting another');
  for (const key of ['payload.quoteId', 'payload.rfqId', 'payload.reservationId', 'payload.containerId', 'payload.shipmentId']) {
    assert.ok(src.includes(key), `${key} must discriminate the dedupe key, or two distinct events collapse into one`);
  }
});

/**
 * Honesty about what did not happen. Queued is not delivered, and an unavailable provider is
 * recorded as such rather than assumed successful.
 */
test('queued is never reported as delivered', () => {
  const worker = readFileSync(new URL('../services/communication/communicationDeliveryWorker.js', import.meta.url), 'utf-8');
  assert.ok(/classifyError/.test(worker), 'delivery outcomes must be classified, not assumed');
  assert.ok(/ADDRESS_REQUIRED_CHANNELS/.test(worker),
    'a channel needing an external address must resolve one before it can claim a send');
});

// ── §7 · the warehouse / action-request boundary ─────────────────────────────────────────────

/**
 * T7 may carry "please provide / confirm / respond to X". It may NOT make X true.
 *
 * No new entity is needed for this: a request IS a message on a thread already bound to an
 * authoritative Trade OS object through subject_type/subject_id. The boundary that matters is that
 * nothing in the communication layer writes a domain fact — and that is what this asserts, of every
 * Trade OS communication module, rather than trusting a convention.
 */
test('no Trade OS communication module writes a domain fact', () => {
  const modules = [
    'diasporaRfqConversationService.js',
    'diasporaLogisticsConversationService.js',
    'diasporaContainerConversationService.js',
    'shipmentExceptionNotifier.js',
    'logisticsLifecycleNotifier.js',
    'containerBookingNotifier.js',
  ];
  for (const m of modules) {
    const src = readFileSync(new URL(`../services/diaspora/${m}`, import.meta.url), 'utf-8');
    // A conversation module may READ authority to decide membership. It may never WRITE it.
    const writes = src.match(/\.(update|insert|upsert|delete)\s*\(/g) || [];
    assert.deepEqual(writes, [],
      `${m} writes to a table (${writes.join(', ')}) — communication is evidence, never authority`);
  }
});

test('a warehouse fact cannot be created by talking about it', () => {
  // The vocabulary T9 owns. If any of these ever becomes settable from the communication layer,
  // this test is the thing that should stop it.
  const T9_FACTS = ['received', 'measured', 'stored', 'ready', 'damaged', 'loaded'];
  const src = readFileSync(new URL('../services/diaspora/diasporaContainerConversationService.js', import.meta.url), 'utf-8');
  for (const fact of T9_FACTS) {
    assert.ok(!new RegExp(`status\\s*[:=]\\s*['"\`]${fact}`, 'i').test(src),
      `T7 must not set the T9 fact "${fact}"`);
  }
  // And the module says so in its own words, so the next reader inherits the rule.
  assert.ok(/never creates|not capacity|does not approve|NEVER domain authority|is not capacity/i.test(src)
    || /A conversation is NOT capacity/i.test(src));
});
