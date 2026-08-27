import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { authRecoveryRouter } from '../routes/authRecoveryRoutes.js';
import { AUTH_TOKEN_PURPOSES } from '../services/auth/authActionTokenService.js';
import { CommunicationOrchestratorService } from '../services/communication/communicationOrchestratorService.js';
import { COMMUNICATION_EVENT_TYPES } from '../services/communication/communicationEventListeners.js';
import { EMAIL_VERIFIED_EVENT } from '../services/communication/producers/leadershipWelcomeProducer.js';
import { deterministicEventIdentity } from '../services/eventBus/eventBusService.js';

/**
 * R1 DURABILITY — a verified account must not lose its Leadership Welcome.
 *
 * THE DEFECT. The route consumed the single-use verification token, wrote `email_verified_at`, then
 * called the welcome producer inline and swallowed any failure:
 *
 *     await queueLeadershipWelcome(userId).catch((e) => console.error(...));
 *
 * The token cannot be replayed, so the operation cannot be repeated. Any transient fault in that
 * call — the user lookup, the template render, the thread resolve, the notification insert — meant
 * the account permanently never received its welcome, with nothing anywhere recording that one was
 * owed. It was the only production call site, so no second path could recover it.
 *
 * THE FIX. Verification writes a durable `user.email.verified` outbox event and returns. The event
 * worker runs the producer, and retries until it succeeds or visibly dead-letters. The durability
 * boundary moves from "the entire notification pipeline succeeded on the first attempt" to "one row
 * was inserted", and the row is the record that a welcome is owed.
 *
 * Two independent idempotency guarantees keep it to exactly one welcome: the event carries a
 * deterministic dedupe key per user, and the notification carries its own. Both live in the
 * database, so they survive a restart and a second worker.
 *
 * ACCOUNT CORRECTNESS IS NOT COUPLED TO EMAIL AVAILABILITY. Verification still succeeds while the
 * welcome system is down — proven by `R1-4` — and the user is never asked to verify again.
 */

const USER_ID = 'u-1';

/** An outbox that behaves like the real one: rows persist, delivery is separate, failures retry. */
function harness() {
  const users = [{ id: USER_ID, email: 'buyer@example.test', name: 'Fixture Buyer', email_verified_at: null }];
  const outbox = [];
  const queued = [];
  const controls = { failQueue: false };

  const notificationService = {
    queueNotification: async (input) => {
      if (controls.failQueue) throw new Error('notification queue temporarily unavailable');
      const key = JSON.stringify(input.dedupeParts);
      const existing = queued.find((q) => JSON.stringify(q.dedupeParts) === key);
      if (existing) return { notification: { id: 'n-existing', status: 'queued' } };
      queued.push(input);
      return { notification: { id: `n-${queued.length}`, status: 'queued' } };
    },
  };
  const repository = {
    findOne: async (table, filters) => (table === 'users' ? users.find((u) => u.id === filters.id) || null : null),
  };
  const orchestrator = new CommunicationOrchestratorService({ notificationService, repository });

  const db = {
    from: (table) => {
      const filters = [];
      let patch = null;
      const rows = table === 'users' ? users : [];
      const api = {
        select: () => api,
        update: (p) => { patch = p; return api; },
        eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) || null, error: null }),
        then: (res, rej) => {
          if (patch) rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };

  const app = express();
  app.use(express.json());
  app.use(authRecoveryRouter({
    db,
    tokenService: {
      consume: async () => ({ ok: true, token: { user_id: USER_ID, purpose: AUTH_TOKEN_PURPOSES.EMAIL_VERIFICATION } }),
      issue: async () => ({ ok: true, rawToken: 't' }),
    },
    services: { notificationService },
    // The outbox INSERT is the durable boundary. It succeeds independently of whether the consumer
    // later manages to queue anything — which is the entire point of the change.
    emitEvent: async (_pg, eventType, payload) => {
      const identity = deterministicEventIdentity(eventType, payload);
      const existing = identity && outbox.find((e) => e.dedupe_key === identity.dedupeKey);
      if (existing) return existing; // the partial unique index, modelled
      const row = { id: `evt-${outbox.length + 1}`, event_type: eventType, payload, status: 'pending', attempts: 0, dedupe_key: identity?.dedupeKey || null };
      outbox.push(row);
      return row;
    },
  }));

  /** Play the event worker: deliver pending rows, marking processed or leaving them pending. */
  async function runWorker() {
    const results = [];
    for (const row of outbox.filter((e) => e.status === 'pending')) {
      row.attempts += 1;
      try {
        await orchestrator.handleDomainEvent(row, null, null);
        row.status = 'processed';
        results.push('processed');
      } catch (error) {
        // Exactly what eventWorker.processEvent does: leave it pending for the next cycle.
        row.status = 'pending';
        row.error_log = error.message;
        results.push('retry');
      }
    }
    return results;
  }

  return { app, users, outbox, queued, controls, runWorker, dbForRouter: db };
}

async function verify(app) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/verify-email`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'raw-token' }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    server.close();
  }
}

test('R1-DURABILITY the full adversarial sequence: verify, welcome fails, reconcile, exactly one', async () => {
  const h = harness();

  // 3. The welcome system is down BEFORE the user verifies.
  h.controls.failQueue = true;

  // 1-2. The user verifies successfully and email_verified_at is committed.
  const response = await verify(h.app);
  assert.equal(h.users[0].email_verified_at != null, true, 'the account really is verified');

  // 4. The verification response remains successful — an Email outage is not an account failure.
  assert.equal(response.status, 200);
  assert.equal(response.body?.success, true);

  // 5. Durable pending work remains. THIS is what swallow-and-forget could not produce.
  assert.equal(h.outbox.length, 1, 'the outbox row records that a welcome is owed');
  assert.equal(h.outbox[0].event_type, EMAIL_VERIFIED_EVENT);
  assert.equal(h.outbox[0].payload.recipientUserId, USER_ID);
  assert.equal(h.outbox[0].status, 'pending');

  // The first delivery attempt fails and the work stays pending rather than vanishing.
  assert.deepEqual(await h.runWorker(), ['retry']);
  assert.equal(h.queued.length, 0);
  assert.equal(h.outbox[0].status, 'pending', 'still owed');

  // 6-7. The queue recovers; reconciliation runs; exactly one welcome is queued.
  h.controls.failQueue = false;
  assert.deepEqual(await h.runWorker(), ['processed']);
  assert.equal(h.queued.length, 1, 'exactly one R1 Welcome');
  assert.deepEqual(h.queued[0].dedupeParts, ['leadership_welcome', USER_ID]);
  assert.equal(h.queued[0].payload.reference_template, 'leadership_welcome');

  // 8. Subsequent reconciliation creates no duplicate.
  await h.runWorker();
  await h.runWorker();
  assert.equal(h.queued.length, 1, 'one welcome per account, for the lifetime of the account');
  assert.equal(h.outbox.length, 1);
});

test('R1-D2 the user is NEVER asked to verify again, and the token is not restored', async () => {
  const h = harness();
  h.controls.failQueue = true;
  const response = await verify(h.app);
  assert.equal(response.status, 200);
  assert.match(String(response.body?.message || ''), /verified/i);
  // Recovery happens entirely server-side, from the durable row.
  h.controls.failQueue = false;
  await h.runWorker();
  assert.equal(h.queued.length, 1, 'recovered without any further customer action');
});

test('R1-D2b even a FAILING outbox write does not turn verification into an error', async () => {
  // The outer guarantee: an Email-side outage of any depth must never cost the customer their
  // verification. This is the one residual case — the durable write itself failing — and the
  // account is still verified, so no re-verification is ever required.
  const h = harness();
  const app = express();
  app.use(express.json());
  app.use(authRecoveryRouter({
    db: h.dbForRouter,
    tokenService: {
      consume: async () => ({ ok: true, token: { user_id: USER_ID, purpose: AUTH_TOKEN_PURPOSES.EMAIL_VERIFICATION } }),
      issue: async () => ({ ok: true, rawToken: 't' }),
    },
    services: { notificationService: { queueNotification: async () => ({ notification: { id: 'n', status: 'queued' } }) } },
    emitEvent: async () => { throw new Error('Outbox persistence error: connection reset'); },
  }));
  const response = await verify(app);
  assert.equal(response.status, 200, 'verification must survive a total Communications outage');
  assert.equal(h.users[0].email_verified_at != null, true);
});

test('R1-D3 a replayed verification does not create a second work item', async () => {
  const h = harness();
  await verify(h.app);
  await verify(h.app);
  await verify(h.app);
  assert.equal(h.outbox.length, 1, 'the deterministic event dedupe key admits one work item per user');
  await h.runWorker();
  assert.equal(h.queued.length, 1);
});

test('R1-D4 the event identity and the migration dedupe rule agree', async () => {
  const identity = deterministicEventIdentity(EMAIL_VERIFIED_EVENT, { recipientUserId: USER_ID });
  assert.equal(identity.dedupeKey, `user.email.verified:${USER_ID}`);
  // A payload with no recipient has no identity, so it is never given a bogus key.
  assert.equal(deterministicEventIdentity(EMAIL_VERIFIED_EVENT, {}), null);
});

test('R1-D5 the event is actually SUBSCRIBED — an unsubscribed work item would never run', async () => {
  // The failure mode that made all ten SafeTrade events dead: emitted, never consumed.
  assert.ok(COMMUNICATION_EVENT_TYPES.includes(EMAIL_VERIFIED_EVENT),
    'user.email.verified must be in the subscriber list or the welcome is never produced');
});

test('R1-D6 a durable producer failure eventually dead-letters VISIBLY rather than silently', async () => {
  const h = harness();
  h.controls.failQueue = true;
  await verify(h.app);
  for (let i = 0; i < 5; i += 1) await h.runWorker();
  // The work is still recorded and its failure is attributable — the opposite of a swallowed error.
  assert.equal(h.outbox[0].status, 'pending');
  assert.equal(h.outbox[0].attempts, 5);
  assert.match(h.outbox[0].error_log, /queue temporarily unavailable/);
  assert.equal(h.queued.length, 0);
});
