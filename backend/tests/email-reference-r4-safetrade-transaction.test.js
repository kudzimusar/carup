import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMUNICATION_EVENT_TYPES } from '../services/communication/communicationEventListeners.js';
import { NOTIFICATION_POLICIES, referencePayloadFor } from '../services/communication/communicationNotificationService.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { SAFETRADE_APPROVED_LIVE_PROVIDERS } from '../constants/diaspora/diasporaSafeTradeConstants.js';
import { referenceEntry } from '../services/communication/emailExperience/emailTemplateRegistry.js';
import {
  SAFETRADE_STAGE_PRESENTATION,
  describableSafeTradeStatuses,
  stagePresentation,
} from '../services/communication/emailExperience/referenceSafeTradeTransaction.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';

/**
 * G9 — R4 SafeTrade transaction update.
 *
 * The word "Transaction" is the danger here. It invites a payment claim, and CarUp is not in a
 * position to make one: `diaspora_safetrade_transactions` carries a table-level
 * CHECK (live_payment = false), and the approved live-provider allowlist is EMPTY. An Email that
 * implied money moved would be a false financial statement — a different category of wrong from a
 * typo, and the reason every assertion below is about what is NOT said.
 */

const ENV = {};

function renderStage(status, extra = {}) {
  return renderEmailForNotification({
    title: 'Your SafeTrade journey', message: '',
    payload: {
      classification: 'transactional',
      reference_template: 'safetrade_transaction',
      email: 'fixture.buyer@fixture.invalid',
      recipient_name: 'Fixture Buyer',
      transaction_session: {
        transaction_intent_id: 'FIXTURE-TXN-0001', vin: 'FIXTUREVIN0000001', status,
        listing_amount: 9500, listing_currency: 'USD', ...extra,
      },
    },
  }, { env: ENV });
}

// ============================================================================
// A. NO PAYMENT CLAIM THE SYSTEM CANNOT PROVE
// ============================================================================

test('A1 the product cannot record live money at all — the premise of this template', () => {
  assert.deepEqual([...SAFETRADE_APPROVED_LIVE_PROVIDERS], [], 'the approved live-provider allowlist is empty');
});

test('A2 no stage that is not provider-confirmed asserts funds', () => {
  const asserting = Object.entries(SAFETRADE_STAGE_PRESENTATION)
    .filter(([, stage]) => stage.assertsFunds)
    .map(([status]) => status);
  assert.deepEqual(asserting.sort(), ['funds_held', 'refunded', 'settled'],
    'only provider-confirmed states may reference funds at all');
});

test('A3 workflow stages never say money moved', () => {
  for (const status of ['not_requested', 'pending_eligibility', 'eligible', 'initiated', 'inspection_pending', 'release_approved', 'cancelled', 'failed', 'disputed']) {
    const r = renderStage(status);
    assert.equal(r.ok, true, status);
    const blob = `${r.html}\n${r.text}`;
    for (const claim of [/payment (was |has been )?(received|completed)/i, /funds (were |have been )?(received|released)/i, /money (was|has been) (sent|received|released)/i, /paid in full/i, /refund (was )?completed/i]) {
      assert.ok(!claim.test(blob), `${status} must not claim ${claim}`);
    }
  }
});

test('A4 SANDBOX stages say sandbox, out loud', () => {
  for (const status of ['funded_sandbox', 'released_sandbox', 'refunded_sandbox']) {
    const r = renderStage(status);
    const blob = `${r.html}\n${r.text}`;
    assert.ok(/sandbox/i.test(blob), `${status} must be unmistakably labelled`);
    assert.ok(/No real money has moved/i.test(blob));
    assert.equal(stagePresentation(status).assertsFunds, false, 'a sandbox confirmation is not a payment');
  }
});

test('A5 an UNMAPPED state is refused, never described vaguely', () => {
  // A stage nobody mapped is a stage nobody decided what to say about, and inventing reassuring
  // prose for it is how a false financial claim gets written by accident.
  for (const status of ['completed', 'paid', 'in_progress', 'unknown', '', null, 'FUNDS_HELD_MAYBE']) {
    const r = renderStage(status);
    assert.equal(r.ok, false, `${JSON.stringify(status)} must be refused`);
    assert.equal(r.errorCode, 'reference_state_not_describable');
  }
});

test('A6 every canonical escrow_trust_sessions status is mapped — so A5 is not hiding a gap', () => {
  // The DB CHECK constraint's full vocabulary.
  const canonical = [
    'not_requested', 'pending_eligibility', 'eligible', 'initiated', 'funds_held',
    'inspection_pending', 'release_approved', 'settled', 'disputed', 'refunded',
    'cancelled', 'failed', 'funded_sandbox', 'released_sandbox', 'refunded_sandbox',
  ];
  const described = describableSafeTradeStatuses();
  for (const status of canonical) {
    assert.ok(described.includes(status), `canonical status '${status}' has no presentation and would be refused`);
  }
});

// ============================================================================
// B. DATA MINIMISATION — regulated content stays out
// ============================================================================

test('B1 no amount, currency or financial identifier reaches the Email', () => {
  const r = renderStage('funds_held');
  const blob = `${r.html}\n${r.text}`;
  assert.ok(!/9500|9,500/.test(blob), 'the amount exists upstream and does not belong in a forwardable Email');
  assert.ok(!/\bUSD\b/.test(blob));
  assert.ok(!/card|iban|account number|sort code/i.test(blob));
  // The reference and the stage ARE present — enough to act on.
  assert.ok(blob.includes('FIXTURE-TXN-0001'));
  assert.ok(/Funds recorded as held/.test(blob));
});

test('B2 the Email points at the authenticated surface', () => {
  const r = renderStage('inspection_pending');
  assert.ok(r.text.includes('carup.dev/marketplace/listing/FIXTUREVIN0000001'));
  assert.ok(!/vercel\.app|carup\.app/.test(`${r.html}${r.text}`));
});

test('B3 a fraud-safety reminder is present on non-sandbox stages', () => {
  const r = renderStage('funds_held');
  assert.ok(/never send money to someone because an email asked you to/i.test(r.text));
});

// ============================================================================
// C. FAMILY AND TRANSPORT
// ============================================================================

test('C1 R4 is transactional, routes to Resend, and carries neither unsubscribe nor conversation token', () => {
  const entry = referenceEntry('safetrade_transaction');
  assert.equal(entry.reference, 'R4');
  assert.equal(entry.classification, 'transactional');
  assert.equal(entry.regulatedDataPolicy, 'minimise_point_at_surface');

  const r = renderStage('eligible');
  assert.equal(r.classification, 'transactional');
  assert.equal(r.template_key, 'safetrade_transaction_v1');
  assert.ok(!r.html.includes('data-carup-unsubscribe'));
  assert.ok(!/unsubscribe/i.test(r.text));
  assert.equal(r.reply_to, undefined, 'a status notification is not a conversation');
  assert.equal(
    new EmailTransportRouter({ env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'n@mail.carup.dev', BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'm@marketing.carup.dev' } })
      .selectAdapter({ content: { data: { classification: 'transactional' } } }).adapter.provider,
    'resend',
  );
});

// ============================================================================
// D. THE REAL PRODUCER — events that were already emitted and never subscribed
// ============================================================================

test('D1 the canonical marketplace transaction events are now subscribed', () => {
  for (const eventType of [
    'MARKETPLACE_PAYMENT_INITIATED', 'MARKETPLACE_INSPECTION_PENDING', 'MARKETPLACE_RELEASE_APPROVED',
    'MARKETPLACE_TRANSACTION_DISPUTED', 'MARKETPLACE_TRANSACTION_CANCELLED',
  ]) {
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} must be subscribed`);
    const policy = NOTIFICATION_POLICIES[eventType];
    assert.ok(policy, `${eventType} must have a policy`);
    assert.equal(policy.classification, 'transactional', 'explicit, never defaulted');
    assert.equal(policy.templateKey, 'safetrade_transaction_v1');
    assert.ok(policy.channels.includes('email'));
  }
  // The retired SafePay events stay unsubscribed.
  assert.ok(!COMMUNICATION_EVENT_TYPES.includes('ESCROW_CREATED'));
  assert.ok(!COMMUNICATION_EVENT_TYPES.includes('ESCROW_UPDATED'));
});

test('D2 the event payload maps to the audience-safe transaction projection only', () => {
  const mapped = referencePayloadFor('MARKETPLACE_RELEASE_APPROVED', {
    session: {
      transaction_intent_id: 'FIXTURE-TXN-0002', vin: 'FIXTUREVIN0000002', status: 'release_approved',
      listing_amount: 12000, listing_currency: 'USD', escrow_id: 'PRIVATE-PROVIDER-ID',
    },
  });
  assert.equal(mapped.reference_template, 'safetrade_transaction');
  assert.deepEqual(Object.keys(mapped.transaction_session).sort(), ['status', 'transaction_intent_id', 'vin']);
  const serialized = JSON.stringify(mapped);
  assert.ok(!serialized.includes('12000'), 'no amount');
  assert.ok(!serialized.includes('PRIVATE-PROVIDER-ID'), 'no provider identifier');

  // An unrelated event gets nothing.
  assert.deepEqual(referencePayloadFor('finance.application.approved', { session: { status: 'x' } }), {});
});

test('D3 the LIVE notification service carries the reference onto the queued payload', async () => {
  // The canonical subclass reimplements queueFromDomainEvent rather than delegating — proven
  // against the service the factory actually wires, not the base class.
  const rows = [];
  const service = new CommunicationProductNotificationService({
    repository: {
      findOne: async () => null, list: async () => [],
      insert: async (table, row) => { if (table === 'notification_queue') rows.push(row); return { id: `n-${rows.length}`, ...row }; },
      updateById: async (_t, id, patch) => ({ id, ...patch }), deleteById: async () => null,
    },
    threadService: {
      resolveOrCreateThread: async () => ({ thread: { id: 'th-1', tenant_id: 'platform', status: 'open', metadata: {} } }),
      recordMessage: async (_t, m) => ({ id: 'msg-1', ...m }),
    },
    preferenceService: {
      getPreferences: async () => ({}), selectChannels: () => ['email'],
      isChannelAllowed: () => true, isInQuietHours: () => false,
    },
    templateService: { render: async () => ({ subject: 'S', body: 'B', templateKey: 'safetrade_transaction_v1', data: {} }) },
  });

  await service.queueFromDomainEvent({
    id: 'evt-r4', event_type: 'MARKETPLACE_RELEASE_APPROVED',
    payload: {
      recipientUserId: 'u-1',
      session: { transaction_intent_id: 'FIXTURE-TXN-0003', vin: 'FIXTUREVIN0000003', status: 'release_approved' },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.classification, 'transactional');
  assert.equal(rows[0].payload.reference_template, 'safetrade_transaction');
  assert.equal(rows[0].payload.transaction_session.status, 'release_approved');

  // ...and that payload renders as R4.
  const rendered = renderEmailForNotification({ title: 'Your SafeTrade journey', message: '', payload: rows[0].payload }, { env: ENV });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.template_key, 'safetrade_transaction_v1');
  assert.ok(rendered.text.includes('Release approved'));
});
