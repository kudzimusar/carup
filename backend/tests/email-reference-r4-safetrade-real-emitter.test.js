import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CommunicationOrchestratorService } from '../services/communication/communicationOrchestratorService.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import {
  PROVIDER_PAYMENT_STATE_TO_SESSION_STATUS,
  SAFETRADE_ADAPTED_EVENT_TYPES,
  SAFETRADE_ADAPTER_REFUSALS,
  normalizeSafeTradeDomainEvent,
  safeTradeTransactionId,
} from '../services/communication/adapters/safeTradeDomainEventAdapter.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';

/**
 * C1 — R4 proven from the REAL emitter dialect, not from a fixture shaped the way I imagined it.
 *
 * THE DEFECT AND WHY THE OLD TEST MISSED IT
 *
 * The previous R4 producer test drove the real service but handed it a payload it invented:
 *
 *     payload: { recipientUserId: 'u-1', session: { transaction_intent_id: ..., status: ... } }
 *
 * No SQL emitter produces `recipientUserId`, and none produces a `session` object. The real emitters
 * produce `transactionIntentId` + `toStatus`, or `transactionIntentId` + `paymentState`, and NO
 * principal at all. So the test proved the policy and renderer worked given a shape that never
 * occurs, while in production every one of the ten events resolved no recipient and was dropped —
 * silently, because the handler returns [] without throwing and the worker then marks the event
 * processed. Staging: 33 MARKETPLACE_* events emitted, 0 SafeTrade notifications ever queued.
 *
 * HOW THIS FILE AVOIDS REPEATING THAT MISTAKE
 *
 * The payload keys are not written by hand here. They are PARSED OUT OF THE MIGRATION SQL that
 * defines the emitters, so the fixtures cannot drift from the producers: change the emitter and
 * these tests fail. `A1` additionally asserts that the emitters carry no recipient, which is the
 * fact the whole adapter exists to answer — if someone ever adds one, this file says so loudly
 * rather than quietly continuing to pass.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, '..', '..', 'database', 'migrations');
const TRANSITION_SQL = path.join(MIGRATIONS, '20260819121000_issue164_phase6_atomic_session_actions.sql');
const PAYMENT_SQL = path.join(MIGRATIONS, '20260819126000_issue164_phase6_payment_operation_hardening.sql');

const ENV = {};
const TXN = 'e2f0a6d1-0000-4000-8000-000000000001';
const VIN = 'FIXTUREVIN0000001';

/**
 * Pull the payload keys out of `INSERT INTO public.domain_events ... jsonb_build_object(...)`.
 *
 * The argument list has to be matched by BALANCED PARENTHESES, not by the first `),`. The real
 * payment emitter contains `btrim(p_provider),` and a `CASE ... END` inside the object, so a naive
 * scan stops early and silently reports four keys instead of five — which would have made this file
 * assert against a payload shape the emitter does not produce. That is the same class of mistake
 * this test exists to prevent, so it is worth doing properly.
 */
function emittedPayloadKeys(sqlFile) {
  const src = fs.readFileSync(sqlFile, 'utf8');
  const insert = src.slice(src.indexOf('INSERT INTO public.domain_events'));
  const open = insert.indexOf('jsonb_build_object(') + 'jsonb_build_object('.length;
  let depth = 1;
  let i = open;
  for (; i < insert.length && depth > 0; i += 1) {
    if (insert[i] === '(') depth += 1;
    else if (insert[i] === ')') depth -= 1;
  }
  const body = insert.slice(open, i - 1);
  // Keys are the quoted literals at depth 0 of the argument list — i.e. those in odd positions.
  const keys = [];
  let level = 0;
  let expectKey = true;
  const tokens = body.match(/'[^']*'|[(),]|[^,()]+/g) || [];
  for (const token of tokens) {
    if (token === '(') { level += 1; continue; }
    if (token === ')') { level -= 1; continue; }
    if (token === ',') { if (level === 0) expectKey = !expectKey; continue; }
    if (level === 0 && expectKey && /^'[A-Za-z_]+'$/.test(token.trim())) keys.push(token.trim().slice(1, -1));
  }
  return keys;
}

const TRANSITION_KEYS = emittedPayloadKeys(TRANSITION_SQL);
const PAYMENT_KEYS = emittedPayloadKeys(PAYMENT_SQL);

/** Build a payload containing EXACTLY the keys the real emitter builds, and nothing else. */
function realPayload(keys, values) {
  const payload = {};
  for (const key of keys) {
    assert.ok(key in values, `fixture is missing a value for the real emitter key "${key}"`);
    payload[key] = values[key];
  }
  return payload;
}

const transitionPayload = (toStatus, fromStatus = 'initiated') => realPayload(TRANSITION_KEYS, {
  transactionIntentId: TXN, vin: VIN, fromStatus, toStatus,
});

const paymentPayload = (paymentState) => realPayload(PAYMENT_KEYS, {
  transactionIntentId: TXN, vin: VIN, paymentState, provider: 'sandbox',
  settlementOperationKey: paymentState === 'released' ? 'SOK-FIXTURE-1' : null,
});

/** The real service graph the factory wires, with only the I/O boundaries replaced. */
function world({ buyer = 'buyer-1', seller = 'seller-1', sessionStatus = 'initiated' } = {}) {
  const inserted = [];
  const session = { id: TXN, vin: VIN, status: sessionStatus, tenant_id: null, buyer_id: buyer, seller_id: seller };
  const repository = {
    findOne: async (table, filters) => {
      if (table === 'escrow_trust_sessions') return filters.id === session.id ? session : null;
      if (table === 'notification_queue') return inserted.find((r) => r.dedupe_key === filters.dedupe_key) || null;
      return null;
    },
    insert: async (table, row) => {
      if (table !== 'notification_queue') return { ...row, id: `x${inserted.length}` };
      const saved = { ...row, id: `n${inserted.length + 1}` };
      inserted.push(saved);
      return saved;
    },
    list: async () => [], updateById: async (_t, _i, patch) => patch, deleteById: async () => null,
  };
  const notificationService = new CommunicationProductNotificationService({
    repository,
    threadService: {
      resolveOrCreateThread: async () => ({ thread: { id: 'thread-1', tenant_id: null, status: 'open' } }),
      recordMessage: async () => ({ id: 'message-1' }),
    },
    templateService: { render: async () => ({ subject: 'Your SafeTrade journey', body: 'B', templateKey: 'safetrade_transaction_v1', data: {} }) },
    preferenceService: { getPreferences: async () => ({}), selectChannels: () => ['email'] },
  });
  const orchestrator = new CommunicationOrchestratorService({ notificationService, repository });
  return { orchestrator, repository, inserted, session };
}

const drive = (w, eventType, payload, id = 'evt-1') =>
  w.orchestrator.handleDomainEvent({ id, event_type: eventType, payload }, null, null);

// ============================================================================
// A — the emitters really do carry no recipient
// ============================================================================

test('A1 the REAL emitters carry NO recipient field of any kind', () => {
  const recipientish = ['recipientUserId', 'recipient_user_id', 'userId', 'user_id', 'buyerId', 'buyer_id', 'sellerId', 'seller_id'];
  for (const [name, keys] of [['transition', TRANSITION_KEYS], ['payment', PAYMENT_KEYS]]) {
    assert.ok(keys.length >= 4, `${name} emitter keys were not parsed`);
    for (const key of recipientish) {
      assert.equal(keys.includes(key), false, `${name} emitter unexpectedly carries ${key} — the adapter's premise changed`);
    }
  }
  assert.deepEqual(TRANSITION_KEYS, ['transactionIntentId', 'vin', 'fromStatus', 'toStatus']);
  assert.deepEqual(PAYMENT_KEYS, ['transactionIntentId', 'vin', 'paymentState', 'provider', 'settlementOperationKey']);
});

test('A2 the frozen provider->session map matches the live SQL CASE exactly', () => {
  const src = fs.readFileSync(PAYMENT_SQL, 'utf8');
  const block = src.slice(src.indexOf('v_next_status := CASE p_normalized_status'));
  const cases = [...block.slice(0, block.indexOf('END;')).matchAll(/WHEN '([a-z_]+)' THEN '([a-z_]+)'/g)];
  const fromSql = Object.fromEntries(cases.map((m) => [m[1], m[2]]));
  assert.deepEqual(fromSql, { ...PROVIDER_PAYMENT_STATE_TO_SESSION_STATUS },
    'the adapter map and the SQL CASE have diverged — one of them is now lying about journey state');
});

// ============================================================================
// B — the real path, end to end
// ============================================================================

test('B1 REAL transition payload with NO recipient still reaches two addressed notifications', async () => {
  const w = world();
  const payload = transitionPayload('release_approved', 'inspection_pending');
  // The premise, asserted rather than assumed: nothing in this payload names a person.
  assert.equal(payload.recipientUserId, undefined);
  assert.equal(payload.session, undefined);

  const queued = await drive(w, 'MARKETPLACE_RELEASE_APPROVED', payload);
  assert.equal(queued.length, 2, 'both principals are party to the journey');
  assert.equal(w.inserted.length, 2);

  const recipients = w.inserted.map((r) => r.recipient_user_id).sort();
  assert.deepEqual(recipients, ['buyer-1', 'seller-1']);
  // ...and each is addressed ONLY because the adapter read the canonical transaction session.
  assert.equal(w.session.buyer_id, 'buyer-1');
  assert.equal(w.session.seller_id, 'seller-1');
});

test('B2 REAL payment payload maps the PROVIDER dialect to the canonical journey stage', async () => {
  const w = world();
  const queued = await drive(w, 'MARKETPLACE_FUNDS_HELD', paymentPayload('captured'));
  assert.equal(queued.length, 2);
  for (const row of w.inserted) {
    // 'captured' is a provider word and is not a describable SafeTrade stage. R4 would refuse it.
    assert.equal(row.payload.transaction_session.status, 'funds_held');
    assert.equal(row.payload.transaction_session.transaction_intent_id, TXN);
    assert.equal(row.payload.transaction_session.vin, VIN);
  }
});

test('B3 the two notifications carry INDEPENDENT deterministic dedupe identities', async () => {
  const w = world();
  await drive(w, 'MARKETPLACE_PAYMENT_INITIATED', transitionPayload('initiated', 'eligible'), 'evt-dedupe');
  const keys = w.inserted.map((r) => r.dedupe_key);
  assert.equal(new Set(keys).size, 2, 'buyer and seller must not collapse onto one dedupe key');
  assert.ok(keys.some((k) => k.includes('buyer-1')));
  assert.ok(keys.some((k) => k.includes('seller-1')));

  // Deterministic: replaying the SAME durable event queues nothing new.
  const before = w.inserted.length;
  await drive(w, 'MARKETPLACE_PAYMENT_INITIATED', transitionPayload('initiated', 'eligible'), 'evt-dedupe');
  assert.equal(w.inserted.length, before, 'a replayed event must not produce a second pair of Emails');
});

test('B4 the canonical payload renders as R4 through the real renderer', async () => {
  const w = world();
  await drive(w, 'MARKETPLACE_TRANSACTION_SETTLED', paymentPayload('released'));
  const rendered = renderEmailForNotification(
    { title: 'Your SafeTrade journey', message: '', payload: { ...w.inserted[0].payload, email: 'fixture@fixture.invalid', recipient_name: 'Fixture Buyer' } },
    { env: ENV },
  );
  assert.equal(rendered.ok, true, `renderer refused: ${rendered.errorCode || ''}`);
  assert.equal(rendered.template_key, 'safetrade_transaction_v1');
});

test('B5 provider identifiers and the settlement key never leave the adapter', async () => {
  const w = world();
  await drive(w, 'MARKETPLACE_TRANSACTION_SETTLED', paymentPayload('released'));
  for (const row of w.inserted) {
    const serialized = JSON.stringify(row.payload);
    assert.equal(serialized.includes('SOK-FIXTURE-1'), false, 'settlementOperationKey leaked downstream');
    assert.equal(serialized.includes('sandbox'), false, 'provider identifier leaked downstream');
    assert.equal(row.payload.safe_payload?.provider, undefined);
    assert.equal(row.payload.safe_payload?.settlementOperationKey, undefined);
  }
});

// ============================================================================
// C — the synthetic fixture must no longer work
// ============================================================================

test('C1 THE REGRESSION GUARD: the old synthetic payload no longer addresses anyone', async () => {
  // If someone restores `recipientUserId: 'u-1'` + `session: {...}`, the adapter refuses it, because
  // that shape carries no canonical transaction the participants can be read from. The old test
  // passed on exactly this payload; it must not pass again.
  const w = world();
  const queued = await drive(w, 'MARKETPLACE_RELEASE_APPROVED', {
    recipientUserId: 'u-1',
    session: { transaction_intent_id: 'FIXTURE-TXN-0003', vin: VIN, status: 'release_approved' },
  });
  assert.deepEqual(queued, [], 'a hand-invented payload must not be able to manufacture a delivery');
  assert.equal(w.inserted.length, 0);
});

test('C1b the transaction id is NEVER read out of a `session` wrapper, even a real one', async () => {
  // The discriminating test for the synthetic fixture. C1 above refuses the old payload, but it
  // would ALSO refuse it for the uninteresting reason that 'FIXTURE-TXN-0003' is not a real session.
  // This wraps the REAL transaction id in the synthetic `session` shape: if anyone teaches the
  // adapter to look inside `session`, the id resolves, two notifications appear, and this fails.
  assert.equal(safeTradeTransactionId({ session: { transaction_intent_id: TXN } }), null);
  assert.equal(safeTradeTransactionId({ transaction_session: { transaction_intent_id: TXN } }), null);
  assert.equal(safeTradeTransactionId({ transactionIntentId: TXN }), TXN);

  const w = world();
  const queued = await drive(w, 'MARKETPLACE_RELEASE_APPROVED', {
    recipientUserId: 'u-1',
    session: { transaction_intent_id: TXN, vin: VIN, status: 'release_approved' },
  });
  assert.deepEqual(queued, [], 'the emitter dialect is the only accepted source of the transaction id');
  assert.equal(w.inserted.length, 0);
});

test('C2 a synthetic payload naming a REAL session still cannot smuggle in its own recipient', async () => {
  const w = world();
  await drive(w, 'MARKETPLACE_RELEASE_APPROVED', {
    transactionIntentId: TXN, vin: VIN, toStatus: 'release_approved',
    recipientUserId: 'attacker-1', buyer_id: 'attacker-2',
  });
  const recipients = w.inserted.map((r) => r.recipient_user_id).sort();
  assert.deepEqual(recipients, ['buyer-1', 'seller-1'], 'the session is the only participant authority');
});

// ============================================================================
// D — all ten events, table driven
// ============================================================================

const TRANSITION_EVENTS = [
  ['MARKETPLACE_PAYMENT_INITIATED', 'initiated'],
  ['MARKETPLACE_INSPECTION_PENDING', 'inspection_pending'],
  ['MARKETPLACE_RELEASE_APPROVED', 'release_approved'],
  ['MARKETPLACE_TRANSACTION_DISPUTED', 'disputed'],
  ['MARKETPLACE_TRANSACTION_CANCELLED', 'cancelled'],
  ['MARKETPLACE_TRANSACTION_FAILED', 'failed'],
];

const PAYMENT_EVENTS = [
  ['MARKETPLACE_FUNDS_HELD', 'captured', 'funds_held'],
  ['MARKETPLACE_TRANSACTION_SETTLED', 'released', 'settled'],
  ['MARKETPLACE_TRANSACTION_REFUNDED', 'refunded', 'refunded'],
  ['MARKETPLACE_PAYMENT_FAILED', 'failed', 'failed'],
  // TRANSACTION_CANCELLED has TWO emitter shapes; the payment one is proven here and the
  // transition one above, because either can produce it in production.
  ['MARKETPLACE_TRANSACTION_CANCELLED', 'cancelled', 'cancelled'],
];

for (const [eventType, toStatus] of TRANSITION_EVENTS) {
  test(`D-transition ${eventType} -> buyer+seller, status ${toStatus}, renderable`, async () => {
    const w = world();
    const queued = await drive(w, eventType, transitionPayload(toStatus), `evt-${eventType}`);
    assert.equal(queued.length, 2);
    assert.deepEqual(w.inserted.map((r) => r.recipient_user_id).sort(), ['buyer-1', 'seller-1']);
    for (const row of w.inserted) {
      assert.equal(row.payload.transaction_session.status, toStatus);
      assert.equal(row.payload.transaction_session.transaction_intent_id, TXN);
      const rendered = renderEmailForNotification(
        { title: 'Your SafeTrade journey', message: '', payload: { ...row.payload, email: 'f@f.invalid', recipient_name: 'F' } }, { env: ENV },
      );
      assert.equal(rendered.ok, true, `${eventType} not renderable: ${rendered.errorCode || ''}`);
      assert.equal(JSON.stringify(row.payload).includes('sandbox'), false);
    }
    assert.equal(new Set(w.inserted.map((r) => r.dedupe_key)).size, 2);
  });
}

for (const [eventType, paymentState, expected] of PAYMENT_EVENTS) {
  test(`D-payment ${eventType} (${paymentState}) -> buyer+seller, status ${expected}, renderable`, async () => {
    const w = world();
    const queued = await drive(w, eventType, paymentPayload(paymentState), `evt-pay-${eventType}-${paymentState}`);
    assert.equal(queued.length, 2);
    assert.deepEqual(w.inserted.map((r) => r.recipient_user_id).sort(), ['buyer-1', 'seller-1']);
    for (const row of w.inserted) {
      assert.equal(row.payload.transaction_session.status, expected);
      const rendered = renderEmailForNotification(
        { title: 'Your SafeTrade journey', message: '', payload: { ...row.payload, email: 'f@f.invalid', recipient_name: 'F' } }, { env: ENV },
      );
      assert.equal(rendered.ok, true, `${eventType} not renderable: ${rendered.errorCode || ''}`);
      const serialized = JSON.stringify(row.payload);
      assert.equal(serialized.includes('sandbox'), false);
      assert.equal(serialized.includes('SOK-FIXTURE-1'), false);
    }
    assert.equal(new Set(w.inserted.map((r) => r.dedupe_key)).size, 2);
  });
}

test('D-coverage every subscribed SafeTrade event is exercised above', () => {
  const exercised = new Set([...TRANSITION_EVENTS.map((e) => e[0]), ...PAYMENT_EVENTS.map((e) => e[0])]);
  for (const eventType of SAFETRADE_ADAPTED_EVENT_TYPES) {
    assert.ok(exercised.has(eventType), `${eventType} is adapted but never proven`);
  }
  assert.equal(SAFETRADE_ADAPTED_EVENT_TYPES.size, 10);
});

// ============================================================================
// E — refusals: no guessing, ever
// ============================================================================

test('E1 a missing participant addresses only the one that exists — the other is not invented', async () => {
  const w = world({ seller: null });
  const queued = await drive(w, 'MARKETPLACE_RELEASE_APPROVED', transitionPayload('release_approved'));
  assert.equal(queued.length, 1);
  assert.deepEqual(w.inserted.map((r) => r.recipient_user_id), ['buyer-1']);
});

test('E2 no canonical participant at all means NO notification, not a fallback', async () => {
  const w = world({ buyer: null, seller: null });
  const queued = await drive(w, 'MARKETPLACE_RELEASE_APPROVED', transitionPayload('release_approved'));
  assert.deepEqual(queued, []);
  assert.equal(w.inserted.length, 0);
  const adapted = await normalizeSafeTradeDomainEvent({
    eventType: 'MARKETPLACE_RELEASE_APPROVED', payload: transitionPayload('release_approved'), repository: w.repository,
  });
  assert.equal(adapted.refused, SAFETRADE_ADAPTER_REFUSALS.NO_PARTICIPANTS);
});

test('E3 an unresolvable transaction session refuses rather than guessing', async () => {
  const w = world();
  const adapted = await normalizeSafeTradeDomainEvent({
    eventType: 'MARKETPLACE_RELEASE_APPROVED',
    payload: { transactionIntentId: 'no-such-session', vin: VIN, fromStatus: 'initiated', toStatus: 'release_approved' },
    repository: w.repository,
  });
  assert.deepEqual(adapted.events, []);
  assert.equal(adapted.refused, SAFETRADE_ADAPTER_REFUSALS.SESSION_UNRESOLVED);
});

test('E4 an UNMAPPED provider state is refused, never passed through verbatim', async () => {
  const w = world({ sessionStatus: null });
  const adapted = await normalizeSafeTradeDomainEvent({
    eventType: 'MARKETPLACE_FUNDS_HELD',
    payload: { transactionIntentId: TXN, vin: VIN, paymentState: 'authorized', provider: 'sandbox' },
    repository: w.repository,
  });
  assert.deepEqual(adapted.events, []);
  assert.equal(adapted.refused, SAFETRADE_ADAPTER_REFUSALS.STATUS_UNRESOLVED);
});

test('E5 one human holding both roles receives ONE notification, not two', async () => {
  const w = world({ buyer: 'same-person', seller: 'same-person' });
  const queued = await drive(w, 'MARKETPLACE_RELEASE_APPROVED', transitionPayload('release_approved'));
  assert.equal(queued.length, 1);
  assert.deepEqual(w.inserted.map((r) => r.recipient_user_id), ['same-person']);
});

test('E6 a NON-SafeTrade event passes through the adapter completely untouched', async () => {
  const untouched = await normalizeSafeTradeDomainEvent({
    eventType: 'finance.application.approved', payload: { applicationId: 'a1', userId: 'u1' }, repository: null,
  });
  assert.equal(untouched, null, 'null means "not mine" — the caller must pass the event through unchanged');
});
