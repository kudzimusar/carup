import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationCanonicalConversationService } from '../services/communication/communicationCanonicalConversationService.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationPreferenceService } from '../services/communication/communicationPreferenceService.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { PRIVATE_VEHICLE_FIELDS } from '../utils/publicVehicleProjection.js';
import { referenceEntry } from '../services/communication/emailExperience/emailTemplateRegistry.js';
import {
  MESSAGE_EXCERPT_LIMIT,
  messageExcerpt,
  vehicleTitle,
} from '../services/communication/emailExperience/referenceMarketplaceConversation.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';

/**
 * G8 — R3 Marketplace conversation.
 *
 * A message one human wrote, delivered to another, about a specific vehicle — carrying G5's
 * authenticated Reply-To so the answer lands back in the same canonical conversation.
 *
 * The excerpt is the most user-controlled text in the whole system: written by one customer,
 * rendered into an Email read by another. Everything about how it is handled follows from that.
 */

const ENV = {};
const RESEND_ENV = {
  RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'news@marketing.carup.dev',
  CARUP_EMAIL_REPLY_TOKEN_SECRET: 'r3-test-secret',
};

/** An audience-safe listing summary, shaped as `buildMarketplaceListingSummary` returns one. */
const LISTING = Object.freeze({
  vin: 'FIXTUREVIN0000001',
  year: 2018, make: 'Toyota', model: 'Aqua',
  mileage: 88000, price: 9500, currency: 'USD',
  seller_display_label: 'Fixture Motors', seller_display_label_state: 'recorded',
  seller_type: 'dealer',
  primary_image_url: null, primary_image_state: 'none',
  trust: { evaluation_state: 'not_evaluated', known_limitations: ['No live source is connected.'] },
  trust_score: null,
});

function renderConversation(payload = {}) {
  return renderEmailForNotification({
    title: 'You have a new message', message: '',
    payload: {
      classification: 'conversational',
      reference_template: 'marketplace_conversation',
      email: 'fixture.seller@fixture.invalid',
      recipient_name: 'Fixture Seller',
      sender_display_label: 'Fixture Buyer',
      message_excerpt: 'Is this still available, and can I see the service history?',
      listing_summary: LISTING,
      vin: LISTING.vin,
      ...payload,
    },
  }, { env: ENV });
}

// ============================================================================
// A. THE EXCERPT — bounded, escaped, never markup
// ============================================================================

test('A1 a very long message is bounded on a word boundary', () => {
  const long = 'Hello there friend '.repeat(80);
  const excerpt = messageExcerpt(long);
  assert.ok(excerpt.length <= MESSAGE_EXCERPT_LIMIT + 1, `excerpt was ${excerpt.length}`);
  assert.ok(excerpt.endsWith('…'));
  assert.ok(!excerpt.endsWith(' …'), 'trimmed, not cut mid-space');

  const r = renderConversation({ message_excerpt: long });
  assert.ok(r.html.includes('…'), 'and the bound survives into the rendered Email');
  assert.ok(r.html.length < 40_000, 'a long message cannot push the action off a phone screen');
});

test('A2 excerpt markup is neutralised in HTML and literal in text', () => {
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script> is it available?';
  const r = renderConversation({ message_excerpt: hostile });
  assert.ok(!r.html.includes('<script>'), 'never executable');
  assert.ok(!r.html.includes('onerror=alert(1)>'));
  assert.ok(r.html.includes('&lt;script&gt;'));
  assert.ok(!r.html.includes('&amp;amp;'), 'and escaped exactly once');
  assert.ok(r.text.includes(hostile.slice(0, 30)), 'literal in the text part');
});

test('A3 an empty message degrades to a truthful statement rather than an empty quote', () => {
  const r = renderConversation({ message_excerpt: '   ' });
  assert.ok(r.ok);
  assert.ok(r.text.includes('sent you a message'));
  assert.ok(!r.html.includes('<blockquote'), 'no empty quote block');
});

test('A4 the full conversation history is never exposed', () => {
  const r = renderConversation({ message_excerpt: 'Latest message only.' });
  assert.ok(r.text.includes('Latest message only.'));
  // A card, a quote, an action and a safety panel — not a transcript.
  assert.ok(!/earlier message|previous message|conversation history/i.test(r.text));
});

// ============================================================================
// B. VEHICLE CONTEXT — public projection only
// ============================================================================

test('B1 the card renders public identity, and states gaps as gaps', () => {
  const r = renderConversation();
  assert.ok(r.text.includes('2018 Toyota Aqua'));
  assert.ok(r.text.includes(`VIN ${LISTING.vin}`));
  assert.ok(r.text.includes('88,000 km'));
  assert.ok(r.text.includes('Fixture Motors'), 'the published seller LABEL');

  const noFacts = renderConversation({ listing_summary: { vin: 'FIXTUREVIN0000002' } });
  assert.ok(noFacts.text.includes('A CarUp listing'), 'the title degrades');
  assert.ok(noFacts.text.includes('Mileage: Not recorded'), 'a gap is stated, never guessed');
  assert.equal(vehicleTitle({}), 'A CarUp listing');
});

test('B2 no private vehicle field, raw trust score, or seller identity can appear', () => {
  const r = renderConversation({
    listing_summary: {
      ...LISTING,
      // Fields that must never be published, offered deliberately.
      owner_id: 'PRIVATE-OWNER-ID', current_seller_id: 'PRIVATE-SELLER-ID',
      engine_number: 'PRIVATE-ENGINE', chassis_number: 'PRIVATE-CHASSIS',
      plate_number: 'PRIVATE-PLATE', tenant_id: 'PRIVATE-TENANT',
      trust_score: 84,
    },
  });
  const blob = `${r.html}\n${r.text}`;
  for (const field of PRIVATE_VEHICLE_FIELDS) {
    assert.ok(!blob.includes(`PRIVATE-${field.split('_')[0].toUpperCase()}`), `${field} must never reach an Email`);
  }
  assert.ok(!blob.includes('PRIVATE-OWNER-ID'));
  assert.ok(!blob.includes('PRIVATE-SELLER-ID'));
  // The raw legacy column once published `trust_score: 84` beside a report saying `not_evaluated`.
  assert.ok(!/\b84\b/.test(blob), 'the raw trust score must never be rendered');
  assert.ok(!/trust score/i.test(blob), 'R3 makes no trust claim at all — that is R5');
});

test('B3 a seller label that is not publishable is not published', () => {
  const r = renderConversation({
    listing_summary: { ...LISTING, seller_display_label: 'Should Not Appear', seller_display_label_state: 'withheld' },
  });
  assert.ok(!r.text.includes('Should Not Appear'), 'the canonical state governs, not the presence of a value');
});

test('B4 media renders only when the canonical projection published one', () => {
  const withoutMedia = renderConversation();
  assert.ok(!/<img/i.test(withoutMedia.html), 'an excellent card with no image, never a fabricated photo');

  const withMedia = renderConversation({
    listing_summary: { ...LISTING, primary_image_url: 'https://carup.dev/media/fixture.jpg', primary_image_state: 'seller_primary' },
  });
  assert.ok(/<img/i.test(withMedia.html), 'and a real one is used when it exists');
  assert.ok(withMedia.html.includes('https://carup.dev/media/fixture.jpg'));
});

// ============================================================================
// C. THE CTA — a real destination, and an honest one
// ============================================================================

test('C1 the action links the ONLY real conversation route in the application', () => {
  // `/dashboard/communications` is the only buyer/seller conversation route that exists. There is no
  // thread deep-link, so the Email does not invent one — an invented path would answer HTTP 200 with
  // the SPA shell and land the customer nowhere.
  const r = renderConversation();
  assert.equal(r.cta_route, '/dashboard/communications');
  assert.ok(r.text.includes('carup.dev/dashboard/communications'));
  for (const invented of ['/messages', '/dashboard/messages', '/dashboard/inbox', '/conversations']) {
    assert.ok(!r.html.includes(`carup.dev${invented}`), `${invented} does not exist and must not be linked`);
  }
});

test('C2 the listing link IS specific, and takes the VIN', () => {
  const r = renderConversation();
  assert.ok(r.text.includes(`carup.dev/marketplace/listing/${LISTING.vin}`), 'a route that genuinely exists');

  const noVin = renderConversation({ listing_summary: { year: 2018 }, vin: null });
  assert.ok(!noVin.text.includes('/marketplace/listing/'), 'and is omitted when there is no VIN');
});

test('C3 the safety reminder is present', () => {
  const r = renderConversation();
  assert.ok(/Keep the conversation on CarUp/i.test(r.text));
  assert.ok(/never ask you to move a deal/i.test(r.text));
});

// ============================================================================
// D. FAMILY AND G5
// ============================================================================

test('D1 R3 is conversational, routes to Resend, and carries no unsubscribe', () => {
  const entry = referenceEntry('marketplace_conversation');
  assert.equal(entry.reference, 'R3');
  assert.equal(entry.classification, 'conversational');
  assert.equal(entry.consentRequirement, 'none_conversation');

  const r = renderConversation();
  assert.equal(r.classification, 'conversational');
  assert.equal(r.template_key, 'marketplace_conversation_v1');
  assert.ok(!r.html.includes('data-carup-unsubscribe'));
  assert.ok(!/unsubscribe/i.test(r.text));
  assert.equal(new EmailTransportRouter({ env: RESEND_ENV }).selectAdapter({ content: { data: { classification: 'conversational' } } }).adapter.provider, 'resend');
});

test('D2 R3 declares no reply address of its own — G5 owns that', () => {
  const r = renderConversation();
  assert.equal(r.reply_to, undefined, 'two ways to reply, only one of which routes, is worse than one');
});

// ============================================================================
// E. THE REAL PRODUCER, END TO END, WITH THE G5 CREDENTIAL
// ============================================================================

const THREAD_ID = '11111111-1111-4111-8111-1111111111a3';
const BUYER = '22222222-2222-4222-8222-2222222222a3';
const SELLER = '33333333-3333-4333-8333-3333333333a3';
const IDENTITY = '44444444-4444-4444-8444-4444444444a3';
const BINDING = '55555555-5555-4555-8555-5555555555a3';

function conversationWorld() {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{
      id: THREAD_ID, thread_key: 'r3', thread_type: 'marketplace_inquiry', business_workflow: 'marketplace',
      status: 'open', primary_channel: 'email', priority: 'normal', tenant_id: 'platform',
      marketplace_listing_id: LISTING.vin, metadata: {},
    }],
    message_participants: [
      { id: SELLER, thread_id: THREAD_ID, user_id: 'seller-1', role: 'responder', participant_type: 'customer', left_at: null, external_identity_id: IDENTITY },
      { id: BUYER, thread_id: THREAD_ID, user_id: 'buyer-1', role: 'requester', participant_type: 'customer', left_at: null },
    ],
    channel_identities: [{
      id: IDENTITY, channel: 'email', provider: 'resend', user_id: 'seller-1',
      normalized_address: 'fixture.seller@fixture.invalid', external_id: 'fixture.seller@fixture.invalid',
      consent_status: 'granted', verified: true,
    }],
    conversation_channel_bindings: [{
      id: BINDING, thread_id: THREAD_ID, participant_id: SELLER, channel: 'email',
      channel_identity_id: IDENTITY, provider: 'resend', is_primary: true,
      can_send: true, can_receive: true, transactional_consent: true, expires_at: null,
    }],
    communication_preferences: [{ id: 'p', user_id: 'seller-1', tenant_id: null, transactional_enabled: true, email_enabled: true, in_app_enabled: true }],
    users: [{ id: 'seller-1', name: 'Fixture Seller', email: 'fixture.seller@fixture.invalid' }],
    email_reply_tokens: [],
  });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationProductNotificationService({
    repository, threadService,
    preferenceService: new CommunicationPreferenceService({ repository }),
    templateService: { render: async () => ({ subject: 'CarUp conversation', body: '', templateKey: 'admin_reply_v1', data: {} }) },
  });
  const conversationService = new CommunicationCanonicalConversationService({
    repository, threadService, identityService: new CommunicationIdentityService({ repository }), notificationService,
  });
  return { repository, conversationService, notificationService };
}

test('E1 the REAL producer names the reference and carries safe public context', async () => {
  const { repository, conversationService } = conversationWorld();
  const thread = await repository.findOne('message_threads', { id: THREAD_ID });
  const sender = await repository.findOne('message_participants', { id: BUYER });
  const message = await repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform', direction: 'outbound',
    channel: 'email', status: 'queued', sender_participant_id: BUYER,
    content_text: 'Is this still available, and can I see the service history?', content_json: {},
  });

  await conversationService.routeMessage(thread, sender, message, { listingSummary: LISTING });

  const row = repository.rows('notification_queue').find((n) => n.channel === 'email');
  assert.ok(row, 'the real producer queued an email notification');
  assert.equal(row.payload.classification, 'conversational');
  assert.equal(row.payload.reference_template, 'marketplace_conversation');
  assert.equal(row.payload.message_excerpt, message.content_text);
  assert.equal(row.payload.vin, LISTING.vin, 'thread.marketplace_listing_id holds the VIN');
  assert.equal(row.payload.listing_summary.vin, LISTING.vin);
  assert.equal(row.metadata.recipient_participant_id, SELLER, 'the RECIPIENT, never the sender');
  assert.equal(row.metadata.recipient_binding_channel, 'email');
});

test('E2 END TO END: the delivered Email is R3 and carries the G5 authenticated Reply-To', async () => {
  const { repository, conversationService } = conversationWorld();
  const thread = await repository.findOne('message_threads', { id: THREAD_ID });
  const sender = await repository.findOne('message_participants', { id: BUYER });
  const message = await repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform', direction: 'outbound',
    channel: 'email', status: 'queued', sender_participant_id: BUYER,
    content_text: 'Is this still available?', content_json: {},
  });
  await conversationService.routeMessage(thread, sender, message, { listingSummary: LISTING });

  const captured = [];
  const router = new EmailTransportRouter({
    env: RESEND_ENV,
    fetchImpl: async (_u, init) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'r', message_id: '<m@x>' }), headers: new Map() };
    },
  });
  const { EmailReplyTokenService } = await import('../services/communication/emailReplyTokenService.js');
  const supabase = {
    from: (table) => {
      const rows = repository.rows(table);
      const filters = []; let mode = 'select'; let patch = null;
      const run = () => {
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === 'update') matched.forEach((r) => Object.assign(r, patch));
        return matched.map((r) => JSON.parse(JSON.stringify(r)));
      };
      const api = {
        select: () => api, eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
        is: (c) => { filters.push((r) => r[c] == null); return api; },
        gt: (c, v) => { filters.push((r) => new Date(r[c]) > new Date(v)); return api; },
        order: () => api,
        insert: (row) => { const created = { revoked_at: null, use_count: 0, ...row }; rows.push(created); return { select: () => ({ single: async () => ({ data: created, error: null }) }) }; },
        update: (p) => { mode = 'update'; patch = p; return api; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        single: async () => ({ data: run()[0] || null, error: null }),
        then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return api;
    },
  };
  const worker = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: { get: (channel) => (channel === 'email' ? router : null) },
    replyTokenService: new EmailReplyTokenService({ supabase, env: RESEND_ENV }),
  });
  const row = repository.rows('notification_queue').find((n) => n.channel === 'email');
  await worker.deliverNotification(await repository.findOne('notification_queue', { id: row.id }));

  assert.equal(captured.length, 1, 'exactly one provider call');
  const body = captured[0];
  assert.match(body.reply_to, /^conversation\+[A-Za-z0-9_-]{22}@mail\.carup\.dev$/, 'the G5 credential');
  assert.ok(body.html.includes('2018 Toyota Aqua'), 'rendered as R3');
  assert.ok(body.html.includes('Is this still available?'));
  assert.ok(!body.html.includes('data-carup-unsubscribe'));

  const [token] = repository.rows('email_reply_tokens');
  assert.equal(token.participant_id, SELLER, 'bound to the recipient');
  assert.equal(token.thread_id, THREAD_ID);

  const attempt = repository.rows('message_delivery_attempts')[0];
  assert.equal(attempt.response_metadata.provider_metadata.reply_to_set, true);
  assert.equal(attempt.response_metadata.provider_metadata.classification, 'conversational');
  assert.ok(!JSON.stringify(attempt).includes(body.reply_to.split('+')[1].split('@')[0]), 'the credential is not persisted');
});
