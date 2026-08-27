import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import test from 'node:test';

import { authRecoveryRouter } from '../routes/authRecoveryRoutes.js';
import { AUTH_TOKEN_PURPOSES } from '../services/auth/authActionTokenService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { CommunicationOrchestratorService } from '../services/communication/communicationOrchestratorService.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { EMAIL_TEMPLATE_REGISTRY, referenceEntry } from '../services/communication/emailExperience/emailTemplateRegistry.js';
import { LEADERSHIP_IDENTITY, LEADERSHIP_REPLY_TO, LEADERSHIP_RESPONSE_INVITATION } from '../services/communication/emailExperience/referenceLeadershipWelcome.js';
import { greeting, greetingName } from '../services/communication/emailExperience/recipientPresentation.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';

/**
 * G7 — R1 Leadership Welcome.
 *
 * Two things have to be true at once and are easy to get wrong separately: the message must be
 * warm, and every claim in it must be one CarUp can keep. A welcome Email is the first thing a
 * customer reads, so it is also the first place they can discover the product was described to them
 * inaccurately.
 */

const ENV = {};
const RESEND_ENV = {
  RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  RESEND_AUTH_FROM_EMAIL: 'CarUp Security <auth@mail.carup.dev>',
  BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'news@marketing.carup.dev',
};

function renderWelcome(payload = {}) {
  return renderEmailForNotification({
    title: 'Welcome to CarUp',
    message: '',
    payload: {
      classification: 'transactional',
      reference_template: 'leadership_welcome',
      email: 'fixture.buyer@fixture.invalid',
      ...payload,
    },
  }, { env: ENV });
}

// ============================================================================
// A. IDENTITY — the freeze, enforced rather than trusted
// ============================================================================

test('A1 the leadership identity is the approved one, and is never CEO', () => {
  assert.equal(LEADERSHIP_IDENTITY.name, 'S.K Musarurwa');
  assert.equal(LEADERSHIP_IDENTITY.title, 'Co-Founder & Head of Development');
  assert.equal(LEADERSHIP_IDENTITY.organisation, 'CarUp Technologies');
  assert.notEqual(LEADERSHIP_IDENTITY.title, 'CEO');

  const r = renderWelcome({ recipient_name: 'Tendai' });
  const blob = `${r.html}\n${r.text}`;
  assert.ok(blob.includes('S.K Musarurwa'));
  assert.ok(blob.includes('Co-Founder &amp; Head of Development') || r.text.includes('Co-Founder & Head of Development'));
  assert.ok(!/\bCEO\b/.test(blob), 'CarUp has no CEO identity');
  assert.ok(!/Chief Executive/i.test(blob));
  // The About page's "Founder & CEO" is seeded demo user u1, whose avatar is also a mock seller.
  assert.ok(!/Tendai Moyo/i.test(blob));
  assert.equal(r.leadership_identity_rendered, true);
});

test('A2 no headshot, no signature artwork, no social links, no invented legal identity', () => {
  const r = renderWelcome();
  const blob = `${r.html}\n${r.text}`;
  assert.ok(!/<img/i.test(r.html), 'neither a headshot nor signature artwork exists');
  assert.ok(!/\/email-assets\//.test(blob), 'and no URL is invented for one');
  assert.ok(!/facebook|twitter|linkedin|instagram/i.test(blob));
  assert.ok(!/Pvt Ltd|Private Limited|\bLtd\b/.test(blob));
  assert.ok(!/Registered (office|address)|Reg(istration)? No/i.test(blob));
  assert.ok(blob.includes('CarUp Technologies'));
});

test('A3 the approved response language, and nothing stronger', () => {
  const r = renderWelcome();
  assert.ok(r.text.includes(LEADERSHIP_RESPONSE_INVITATION));
  assert.equal(LEADERSHIP_RESPONSE_INVITATION, 'Reply to this email — it reaches our team.');
  // A promise about one person's attention that nothing in the system can keep.
  assert.ok(!/I personally read/i.test(r.text));
  assert.ok(!/I read what comes through/i.test(r.text));
  assert.ok(!/I read every/i.test(r.text));
});

// ============================================================================
// B. PERSONALISATION — from canonical data, or gracefully absent
// ============================================================================

test('B1 the name renders in title case, never the stored casing', () => {
  // The leak this prevents: `Welcome MUSARURWA SHADRECK` — the customer's own name shouted back at
  // them in whatever casing a form happened to store.
  const r = renderWelcome({ recipient_name: 'MUSARURWA SHADRECK' });
  assert.ok(r.text.includes('Hi Musarurwa,'));
  assert.ok(!r.text.includes('MUSARURWA'));
});

test('B2 an unusable name degrades gracefully rather than fabricating one', () => {
  for (const name of [null, '', '   ', 'user', 'unknown', 'a', 'someone@example.test']) {
    const r = renderWelcome({ recipient_name: name });
    assert.ok(r.text.includes('Hi there,'), `${JSON.stringify(name)} must degrade, not personalise`);
    assert.ok(!r.text.includes('Hi ,'));
    assert.ok(!r.text.includes('undefined'));
    assert.ok(!r.text.includes('null'));
  }
  assert.equal(greetingName('someone@example.test'), null, 'an address is not a name');
  assert.equal(greeting('jean-paul'), 'Hi Jean-Paul,');
  assert.equal(greeting("o'brien"), "Hi O'Brien,");
});

// ============================================================================
// C. TRUTHFULNESS — every claim is one the product can keep
// ============================================================================

test('C1 no capability the product does not have is promised', () => {
  const r = renderWelcome();
  const blob = `${r.html}\n${r.text}`;
  for (const claim of [
    /saved search/i, /watchlist/i, /price drop/i, /price alert/i, /recommend/i,
    /picked for you/i, /personalis|personaliz/i, /\bAI\b/, /24\/7/, /guarantee/i,
    /free trial/i, /discount/i, /verified by law/i,
  ]) {
    assert.ok(!claim.test(blob), `R1 must not promise ${claim}`);
  }
  // ...and it is substantive, so this cannot pass by saying nothing.
  assert.ok(r.text.length > 700);
});

test('C2 the corporate descriptor and canonical links are correct in both representations', () => {
  const r = renderWelcome();
  assert.ok(r.text.includes('Automotive Intelligence & Trust Network'), 'literal in text');
  assert.ok(r.html.includes('Automotive Intelligence &amp; Trust Network'), 'escaped once in HTML');
  assert.ok(!r.html.includes('&amp;amp;'));
  assert.ok(!/vercel\.app|carup\.app/.test(`${r.html}${r.text}`));
  assert.ok(r.html.includes('carup.dev/marketplace'), 'the CTA is a route that exists');
  assert.ok(r.html.includes('carup.dev/privacy'));
});

test('C3 user-controlled text cannot become markup', () => {
  const r = renderWelcome({ recipient_name: '<script>alert(1)</script>Mallory' });
  assert.ok(!r.html.includes('<script>'));
  assert.ok(!r.html.includes('&amp;amp;'));
});

// ============================================================================
// D. SAFETY — no unsubscribe, no conversation token, the right reply address
// ============================================================================

test('D1 R1 carries no marketing unsubscribe and no conversation credential', () => {
  const r = renderWelcome();
  assert.ok(!r.html.includes('data-carup-unsubscribe'), 'a lifecycle Email is not marketing');
  assert.ok(!/unsubscribe/i.test(r.text));
  assert.ok(!/conversation\+/.test(`${r.html}${r.text}`), 'and it is not an authenticated conversation');
});

test('D2 the monitored HUMAN reply address is declared, and it is not a sending identity', () => {
  const r = renderWelcome();
  assert.equal(r.reply_to, LEADERSHIP_REPLY_TO);
  assert.equal(LEADERSHIP_REPLY_TO, 'info@carup.dev');
  // The staff aliases are INBOUND-certified only; OUTBOUND_SENDING_CONFIGURED=NO.
  assert.ok(!`${r.html}${r.text}`.includes('kudzie@carup.dev'));
  assert.equal(r.sender_persona, 'carup_notifications', 'an already-authorised automated mailbox');
});

test('D3 the registry entry and the render agree, and a family mismatch is refused', () => {
  const entry = referenceEntry('leadership_welcome');
  assert.equal(entry.reference, 'R1');
  assert.equal(entry.classification, 'transactional');
  assert.equal(entry.consentRequirement, 'none_lifecycle');
  assert.equal(entry.leadershipRequired, true);
  assert.equal(entry.transport, 'resend');

  const r = renderWelcome();
  assert.equal(r.template_key, entry.templateKey);
  assert.equal(r.classification, entry.classification);
  assert.equal(r.footer_family, entry.footerFamily);
  assert.equal(r.sender_persona, entry.senderPersona);

  // A reference rendered as a family it was not registered as is refused, not silently reclassified.
  const mismatched = renderEmailForNotification({
    title: 'x', message: 'y',
    payload: { classification: 'marketing', reference_template: 'leadership_welcome', unsubscribe_url: 'https://carup.dev/u?t=1' },
  }, { env: ENV });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.errorCode, 'email_classification_conflict');
});

test('D4 R1 routes to Resend, never Brevo', () => {
  const router = new EmailTransportRouter({ env: RESEND_ENV });
  const selected = router.selectAdapter({ content: { data: { classification: referenceEntry('leadership_welcome').classification } } });
  assert.equal(selected.adapter.provider, 'resend');
});

// ============================================================================
// E. THE REAL PRODUCER — verification, not registration, and exactly once
// ============================================================================

/** An express app around the REAL auth recovery router, with the storage layer stubbed. */
function verificationHarness({ userName = 'Fixture Buyer' } = {}) {
  const users = [{ id: 'u-1', email: 'fixture.buyer@fixture.invalid', name: userName, email_verified_at: null }];
  const queued = [];
  const consumed = { ok: true, token: { user_id: 'u-1' } };

  const db = {
    from(table) {
      const api = {
        _filters: {},
        select: () => api,
        update: (patch) => { api._patch = patch; return api; },
        eq: (col, val) => { api._filters[col] = val; return api; },
        maybeSingle: async () => ({ data: users.find((u) => u.id === api._filters.id) || null, error: null }),
        then: (res, rej) => {
          if (api._patch && table === 'users') {
            users.filter((u) => u.id === api._filters.id).forEach((u) => Object.assign(u, api._patch));
          }
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };

  const app = express();
  app.use(express.json());
  const events = [];
  const controls = { failQueue: false };
  let deliverEvents = true;
  const notificationService = {
    queueNotification: async (input) => {
      if (controls.failQueue) throw new Error('notification queue temporarily unavailable');
      // The canonical queue returns the EXISTING row for a repeated dedupe key rather than
      // inserting a second — the property this producer relies on for idempotency.
      const key = JSON.stringify(input.dedupeParts);
      const existing = queued.find((q) => JSON.stringify(q.dedupeParts) === key);
      if (existing) return { notification: { id: 'n-existing', status: 'queued' } };
      queued.push(input);
      return { notification: { id: `n-${queued.length}`, status: 'queued' } };
    },
  };
  const repository = { findOne: async (table, filters) => (table === 'users' ? users.find((u) => u.id === filters.id) || null : null) };
  const orchestrator = new CommunicationOrchestratorService({ notificationService, repository });

  app.use(authRecoveryRouter({
    db,
    tokenService: {
      consume: async () => consumed,
      issue: async () => ({ ok: true, rawToken: 't' }),
    },
    services: { notificationService },
    // R1 is now DURABLE WORK, not an inline side effect. The route writes an outbox event; the
    // event worker runs the producer. This harness plays the worker synchronously so the test
    // drives the REAL chain end to end rather than asserting the route attempted something.
    emitEvent: async (_pg, eventType, payload) => {
      const row = { id: `evt-${events.length + 1}`, event_type: eventType, payload };
      events.push(row);
      if (deliverEvents) await orchestrator.handleDomainEvent(row, null, null);
      return row;
    },
  }));

  return { app, users, queued, consumed, events, orchestrator, controls };
}

async function post(app, path, body) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    server.close();
  }
}

test('E1 the REAL verify-email success path queues R1', async () => {
  const { app, users, queued } = verificationHarness();
  const result = await post(app, '/api/auth/verify-email', { token: 'raw-token' });

  assert.equal(result.status, 200);
  assert.ok(users[0].email_verified_at, 'verification really happened first');
  assert.equal(queued.length, 1, 'the welcome is queued only after verification succeeded');

  const input = queued[0];
  assert.equal(input.channel, 'email');
  assert.equal(input.classification, 'transactional');
  assert.equal(input.payload.reference_template, 'leadership_welcome');
  assert.equal(input.payload.classification, 'transactional');
  assert.equal(input.payload.reply_to, LEADERSHIP_REPLY_TO);
  assert.equal(input.payload.recipient_name, 'Fixture Buyer');
  assert.equal(input.templateKey, 'leadership_welcome_v1');
});

test('E2 a replayed verification does NOT produce a second welcome', async () => {
  // Durable, deterministic dedupe through the canonical queue — not in-memory state, which would
  // not survive a restart or a second worker.
  const { app, queued } = verificationHarness();
  await post(app, '/api/auth/verify-email', { token: 'raw-token' });
  await post(app, '/api/auth/verify-email', { token: 'raw-token' });
  await post(app, '/api/auth/verify-email', { token: 'raw-token' });

  assert.equal(queued.length, 1, 'one welcome per account, for the lifetime of the account');
  assert.deepEqual(queued[0].dedupeParts, ['leadership_welcome', 'u-1']);
});

test('E3 a FAILED verification queues nothing', async () => {
  const { app, users, queued, consumed } = verificationHarness();
  consumed.ok = false;

  const result = await post(app, '/api/auth/verify-email', { token: 'expired' });
  assert.equal(result.status, 400);
  assert.equal(users[0].email_verified_at, null, 'the address is not verified');
  assert.equal(queued.length, 0, 'and no welcome is sent to an address nobody proved they control');
});

test('E4 a welcome that cannot be queued does not break the verification', async () => {
  // A welcome Email must never turn a successful verification into an error the customer sees.
  const { users } = verificationHarness();
  const app = express();
  app.use(express.json());
  app.use(authRecoveryRouter({
    db: {
      from: () => {
        const api = {
          _filters: {}, select: () => api, update: () => api,
          eq: (c, v) => { api._filters[c] = v; return api; },
          maybeSingle: async () => ({ data: users[0], error: null }),
          then: (res) => Promise.resolve({ data: null, error: null }).then(res),
        };
        return api;
      },
    },
    tokenService: { consume: async () => ({ ok: true, token: { user_id: 'u-1' } }), issue: async () => ({ ok: true }) },
    services: { notificationService: { queueNotification: async () => { throw new Error('queue is down'); } } },
  }));

  const result = await post(app, '/api/auth/verify-email', { token: 'raw' });
  assert.equal(result.status, 200, 'verification still succeeds');
  assert.equal(result.body.success, true);
});

// ============================================================================
// F. END TO END — the queued payload renders and transmits correctly
// ============================================================================

test('F1 the queued R1 payload reaches Resend as the leadership welcome', async () => {
  let captured = null;
  const router = new EmailTransportRouter({
    env: RESEND_ENV,
    fetchImpl: async (_u, init) => {
      captured = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'r', message_id: '<m@x>' }), headers: new Map() };
    },
  });
  const attempts = [];
  const worker = new CommunicationDeliveryWorker({
    repository: {
      list: async () => [], findOne: async () => null,
      insert: async (t, row) => { if (t === 'message_delivery_attempts') attempts.push(row); return { id: 'a' }; },
      updateById: async (_t, id) => ({ id }),
    },
    adapterRegistry: { get: (channel) => (channel === 'email' ? router : null) },
  });

  await worker.deliverNotification({
    id: crypto.randomUUID(), channel: 'email', title: 'Welcome to CarUp', message: '',
    payload: {
      classification: 'transactional', reference_template: 'leadership_welcome',
      email: 'fixture.buyer@fixture.invalid', recipient_name: 'Fixture Buyer', reply_to: LEADERSHIP_REPLY_TO,
    },
  });

  assert.ok(captured, 'exactly one provider call');
  assert.equal(captured.from, 'CarUp <notifications@mail.carup.dev>', 'an authorised automated mailbox');
  assert.equal(captured.reply_to, 'info@carup.dev', 'the monitored human reply address');
  assert.ok(captured.html.includes('S.K Musarurwa'));
  assert.ok(!captured.html.includes('data-carup-unsubscribe'));

  const provenance = attempts[0].response_metadata.provider_metadata;
  assert.equal(provenance.classification, 'transactional');
  assert.equal(provenance.reply_to_set, true);
  assert.equal(provenance.leadership_identity_rendered, true);
  assert.equal(provenance.template_key, 'leadership_welcome_v1');
  // A published alias is not a credential, but it is still not recorded.
  assert.ok(!JSON.stringify(provenance).includes('info@carup.dev'));
});

test('F2 the registry declares every field the contract requires', () => {
  for (const [key, entry] of Object.entries(EMAIL_TEMPLATE_REGISTRY)) {
    for (const field of [
      'reference', 'templateKey', 'version', 'family', 'classification', 'senderPersona',
      'transport', 'workflow', 'recipientRole', 'consentRequirement', 'regulatedDataPolicy',
      'primaryAction', 'footerFamily', 'mediaPolicy', 'leadershipRequired',
    ]) {
      assert.ok(entry[field] !== undefined, `${key} is missing ${field}`);
    }
  }
});
