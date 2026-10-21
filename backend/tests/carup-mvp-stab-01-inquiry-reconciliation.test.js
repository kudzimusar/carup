/**
 * CARUP-MVP-STAB-01 F-005 — an inquiry with no conversation can be reconciled, deliberately and silently.
 *
 * Staging (2026-10-21): 325 inquiries, 230 with a conversation, 95 without — 81 governed quarantines that
 * must NEVER be reconciled automatically, and 14 pre-event-era rows that no event will ever thread.
 *
 *   planReconciliation   a dry-run: every inquiry WITHOUT a conversation (decided by the subject link,
 *                        never by the thread key — 16 legacy threads use another key) is classified
 *                        GOVERNED_QUARANTINE / PENDING_DELIVERY / NOT_THREADABLE / NEEDS_REVIEW / ELIGIBLE.
 *   applyReconciliation  acts on ELIGIBLE ids only, re-classified at apply time, through the canonical
 *                        conversation service in `reconciliation` mode: the canonical thread, the exact
 *                        inquiry text at the inquiry's own time, NO notification of any kind, NO funnel
 *                        analytics, NO re-derived guest consent, the inquiry row untouched, one audit
 *                        event per conversation created. A second apply is `already_present` for all.
 *   the admin endpoints  GET is the dry-run (platform admin); POST applies (platform admin + step-up,
 *                        confirm: 'RECONCILE', at most 50 ids). Nothing runs on its own.
 *
 * "Nothing was sent" assertions are only meaningful if the harness would see a send: the negative controls
 * below run the NORMAL creation path over the same world and watch it queue notifications and analytics.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
for (const method of ['log', 'info', 'debug']) console[method] = () => {};

const express = (await import('express')).default;
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { supabase } = await import('../db/supabase.js');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { CommunicationRepository } = await import('../services/communication/communicationRepository.js');
const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js');
const { createAdminCommunicationRouter } = await import('../routes/adminCommunicationRoutes.js');
const {
  planReconciliation,
  applyReconciliation,
  classifyInquiry,
  RECONCILIATION_CATEGORIES: C,
  RECONCILIATION_AUDIT_EVENT,
} = await import('../services/marketplace/inquiryConversationReconciliationService.js');

const VIN = 'GFC27-027051';
const SELLER = 'seller-serena';
const BUYER = 'buyer-signed-in';
const ADMIN = { id: 'admin-1', role: 'admin', platformRole: 'admin', baseRole: 'admin', authenticationMethod: 'session' };
const T_PRE_EVENT = '2026-06-17T09:15:00.000Z';
const T_EVENT = '2026-08-20T10:00:00.000Z';
const T_QUARANTINE = '2026-10-09T11:00:00.000Z';
const CANONICAL_KEY = (id) => `communications-2:marketplace_inquiry:${id}`;
const GUEST_PII = ['chipo.guest@example.com', '+263 77 555 0101', 'Chipo Guest', 'tariro@example.com', 'Tariro'];

const inquiry = (id, extra = {}) => ({
  id,
  listing_id: VIN,
  listing_type: 'vehicle',
  buyer_id: null,
  guest_name: null,
  guest_email: null,
  guest_phone: null,
  seller_id: SELLER,
  seller_tenant_id: null,
  inquiry_type: 'vehicle_purchase_interest',
  message: `Exact buyer question for ${id}`,
  referral_code: null,
  campaign_code: null,
  source_channel: 'web',
  status: 'new',
  risk_status: 'clear',
  metadata: {},
  created_at: T_PRE_EVENT,
  updated_at: T_PRE_EVENT,
  ...extra,
});

const creationEvent = (id, inquiryId, status, extra = {}) => ({
  id,
  event_type: 'marketplace.inquiry.created',
  payload: { inquiryId, listingId: VIN, sellerId: SELLER, inquiry_type: 'vehicle_purchase_interest' },
  status,
  attempts: status === 'dead_letter' ? 5 : 1,
  tenant_id: null,
  dedupe_key: `marketplace.inquiry.created:${inquiryId}`,
  error_log: null,
  created_at: T_EVENT,
  ...extra,
});

const quarantined = (id, inquiryId, reason) => creationEvent(id, inquiryId, 'quarantined', {
  quarantined_at: T_QUARANTINE,
  quarantine_reason: reason,
  quarantine_metadata: { decided_by: 'oc5r-rel03b5', decision: 'governed historical quarantine' },
});

function seed() {
  return {
    users: [
      { id: SELLER, role: 'owner', name: 'Serena Seller', email: 'seller@example.com', is_verified: true },
      { id: BUYER, role: 'owner', name: 'Signed In Buyer', email: 'buyer@example.com', is_verified: true },
      { id: 'admin-1', role: 'admin', name: 'Platform Admin', email: 'admin@example.com', is_verified: true },
      { id: 'owner-1', role: 'owner', name: 'Ordinary Owner', email: 'owner@example.com', is_verified: true },
    ],
    marketplace_inquiries: [
      inquiry('inq-has-canonical', { created_at: '2026-09-01T08:00:00.000Z' }),
      inquiry('inq-has-legacy', { created_at: '2026-07-01T08:00:00.000Z' }),
      inquiry('inq-quarantined-stale'),
      inquiry('inq-quarantined-superseded'),
      inquiry('inq-pending'),
      inquiry('inq-processing'),
      inquiry('inq-no-seller', { seller_id: null }),
      inquiry('inq-diaspora', { inquiry_type: 'diaspora_vehicle_request', listing_id: null, listing_type: 'diaspora_request', seller_id: null }),
      inquiry('inq-spam', { status: 'spam' }),
      inquiry('inq-rejected', { status: 'rejected' }),
      inquiry('inq-legacy-failed'),
      inquiry('inq-pre-event', { guest_email: 'tariro@example.com', guest_name: 'Tariro', created_at: '2026-06-17T09:15:00.000Z' }),
      inquiry('inq-processed', { guest_email: 'tariro@example.com', created_at: '2026-08-20T09:59:00.000Z' }),
      inquiry('inq-dead-letter', { guest_email: 'tariro@example.com', created_at: '2026-08-21T09:59:00.000Z' }),
      inquiry('inq-whatsapp-guest', {
        guest_name: 'Chipo Guest', guest_email: 'chipo.guest@example.com', guest_phone: '+263 77 555 0101',
        metadata: { preferred_contact: 'whatsapp' }, created_at: '2026-06-17T10:30:00.000Z',
      }),
      inquiry('inq-signed-in', { buyer_id: BUYER, created_at: '2026-06-17T11:45:00.000Z' }),
    ],
    message_threads: [
      {
        id: 'thr-canonical', tenant_id: null, thread_key: CANONICAL_KEY('inq-has-canonical'), thread_type: 'marketplace_inquiry',
        subject_type: 'marketplace_inquiry', subject_id: 'inq-has-canonical', marketplace_listing_id: VIN, primary_user_id: SELLER,
        status: 'open', metadata: { marketplace_inquiry_id: 'inq-has-canonical' }, created_at: T_EVENT, updated_at: T_EVENT,
      },
      {
        // A legacy thread: another key, no metadata.marketplace_inquiry_id — still THE conversation.
        id: 'thr-legacy', tenant_id: null, thread_key: 'platform:marketplace_inquiry:marketplace_inquiry:inq-has-legacy',
        thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: 'inq-has-legacy',
        marketplace_listing_id: VIN, primary_user_id: SELLER, status: 'open', metadata: {}, created_at: T_EVENT, updated_at: T_EVENT,
      },
    ],
    message_participants: [],
    messages: [
      {
        id: 'msg-canonical', thread_id: 'thr-canonical', direction: 'inbound', client_message_id: 'marketplace-inquiry:inq-has-canonical',
        content_text: 'Exact buyer question for inq-has-canonical', created_at: '2026-09-01T08:00:00.000Z',
      },
    ],
    domain_events: [
      quarantined('evt-stale', 'inq-quarantined-stale', 'STALE_HISTORICAL_QUARANTINE'),
      quarantined('evt-superseded', 'inq-quarantined-superseded', 'SUPERSEDED_HISTORICAL_WORK'),
      creationEvent('evt-pending', 'inq-pending', 'pending'),
      creationEvent('evt-processing', 'inq-processing', 'processing'),
      creationEvent('evt-failed', 'inq-legacy-failed', 'failed'),
      creationEvent('evt-processed', 'inq-processed', 'processed'),
      creationEvent('evt-dead', 'inq-dead-letter', 'dead_letter'),
      // Another event type that happens to name an inquiry: it is not the creation event and must not count.
      { id: 'evt-other-type', event_type: 'marketplace.inquiry.referral_bridge_requested', payload: { inquiryId: 'inq-pre-event' }, status: 'pending', created_at: T_EVENT },
    ],
    notification_queue: [],
    conversation_events: [],
    channel_identities: [],
    conversation_channel_bindings: [],
    trust_audit_events: [],
    user_sessions: [
      { id: 'sess-admin', token: 'admin-fresh', user_id: 'admin-1', is_valid: true, expires_at: '2099-01-01T00:00:00.000Z', created_at: new Date().toISOString(), auth_method: 'password', step_up_at: new Date().toISOString(), step_up_method: 'password_reauth' },
      { id: 'sess-admin-stale', token: 'admin-stale', user_id: 'admin-1', is_valid: true, expires_at: '2099-01-01T00:00:00.000Z', created_at: new Date().toISOString(), auth_method: 'password', step_up_at: null, step_up_method: null },
      { id: 'sess-owner', token: 'owner-fresh', user_id: 'owner-1', is_valid: true, expires_at: '2099-01-01T00:00:00.000Z', created_at: new Date().toISOString(), auth_method: 'password', step_up_at: new Date().toISOString(), step_up_method: 'password_reauth' },
    ],
  };
}

function harness() {
  const world = createSupabaseWorld(seed());
  const services = createCommunicationServices({ repository: new CommunicationRepository({ client: world.client }) });
  return { world, services, client: world.client };
}

const ELIGIBLE_IDS = ['inq-pre-event', 'inq-processed', 'inq-dead-letter', 'inq-whatsapp-guest', 'inq-signed-in'];
const rowsWhere = (world, table, predicate = () => true) => world.rows(table).filter(predicate);
const snapshot = (value) => JSON.parse(JSON.stringify(value));

async function apply(h, inquiryIds, runId = 'run-1') {
  return applyReconciliation({
    supabase: h.client, conversationService: h.services.conversationService, inquiryIds, actor: ADMIN, runId,
  });
}

// ── The plan ─────────────────────────────────────────────────────────────────────────────────────────

test('the dry-run plan classifies every inquiry without a conversation — by subject link — and writes nothing', async () => {
  const h = harness();
  const writesBefore = h.world.writes.length;
  const plan = await planReconciliation({ supabase: h.client });
  assert.equal(h.world.writes.length, writesBefore, 'a dry-run writes nothing');

  assert.equal(plan.mode, 'dry_run');
  assert.deepEqual(plan.summary.by_category, {
    GOVERNED_QUARANTINE: 2, PENDING_DELIVERY: 2, NOT_THREADABLE: 4, NEEDS_REVIEW: 1, ELIGIBLE: 5,
  });
  assert.equal(plan.summary.inquiries_total, 16);
  assert.equal(plan.summary.with_conversation, 2, 'the legacy-key thread counts: the subject link decides, not the key');
  assert.equal(plan.summary.without_conversation, 14);
  assert.deepEqual(plan.summary.quarantine_reasons, { STALE_HISTORICAL_QUARANTINE: 1, SUPERSEDED_HISTORICAL_WORK: 1 });

  const byId = new Map(plan.items.map((item) => [item.inquiry_id, item]));
  assert.equal(byId.has('inq-has-canonical'), false);
  assert.equal(byId.has('inq-has-legacy'), false);
  const expect = {
    'inq-quarantined-stale': [C.GOVERNED_QUARANTINE, 'STALE_HISTORICAL_QUARANTINE'],
    'inq-quarantined-superseded': [C.GOVERNED_QUARANTINE, 'SUPERSEDED_HISTORICAL_WORK'],
    'inq-pending': [C.PENDING_DELIVERY, 'event_pending'],
    'inq-processing': [C.PENDING_DELIVERY, 'event_processing'],
    'inq-no-seller': [C.NOT_THREADABLE, 'no_seller'],
    'inq-diaspora': [C.NOT_THREADABLE, 'not_vehicle_bound'],
    'inq-spam': [C.NOT_THREADABLE, 'inquiry_status_spam'],
    'inq-rejected': [C.NOT_THREADABLE, 'inquiry_status_rejected'],
    'inq-legacy-failed': [C.NEEDS_REVIEW, 'unrecognized_event_status:failed'],
    'inq-pre-event': [C.ELIGIBLE, 'no_event'],
    'inq-processed': [C.ELIGIBLE, 'event_processed'],
    'inq-dead-letter': [C.ELIGIBLE, 'event_dead_letter'],
    'inq-whatsapp-guest': [C.ELIGIBLE, 'no_event'],
    'inq-signed-in': [C.ELIGIBLE, 'no_event'],
  };
  for (const [id, [category, reason]] of Object.entries(expect)) {
    assert.equal(byId.get(id)?.category, category, `${id} category`);
    assert.equal(byId.get(id)?.reason, reason, `${id} reason`);
  }
  assert.deepEqual(byId.get('inq-quarantined-stale').events, [{ id: 'evt-stale', status: 'quarantined', quarantine_reason: 'STALE_HISTORICAL_QUARANTINE' }]);
  assert.equal(byId.get('inq-signed-in').buyer, 'signed_in');
  assert.equal(byId.get('inq-whatsapp-guest').buyer, 'guest');

  const serialized = JSON.stringify(plan);
  for (const pii of [...GUEST_PII, 'Exact buyer question']) assert.equal(serialized.includes(pii), false, `the plan carries no ${pii}`);
});

test('classifyInquiry: a governed quarantine outranks everything, and an unknown event status is never ELIGIBLE', () => {
  const base = inquiry('x');
  const q = { id: 'e', status: 'quarantined', quarantine_reason: 'STALE_HISTORICAL_QUARANTINE' };
  assert.equal(classifyInquiry({ ...base, seller_id: null }, { threads: [], events: [q] }).category, C.GOVERNED_QUARANTINE);
  assert.equal(classifyInquiry(base, { threads: [], events: [q, { id: 'p', status: 'processed' }] }).category, C.GOVERNED_QUARANTINE);
  assert.equal(classifyInquiry(base, { threads: [], events: [{ id: 'p', status: 'processed' }, { id: 'n', status: 'pending' }] }).category, C.PENDING_DELIVERY);
  assert.equal(classifyInquiry(base, { threads: [], events: [{ id: 'z', status: 'archived' }] }).category, C.NEEDS_REVIEW);
  assert.equal(classifyInquiry(base, { threads: [], events: [] }).category, C.ELIGIBLE);
  const linked = classifyInquiry(base, { threads: [{ id: 't', subject_id: 'x', metadata: {} }], events: [q] });
  assert.equal(linked.has_conversation, true, 'a conversation that exists is reported as present, whatever its event says');
  assert.equal(linked.thread_id, 't');
});

// ── Apply ────────────────────────────────────────────────────────────────────────────────────────────

test('apply creates exactly one canonical conversation per ELIGIBLE inquiry: exact text, original time, and nothing sent', async () => {
  const h = harness();
  const inquiriesBefore = snapshot(h.world.rows('marketplace_inquiries'));
  const eventsBefore = snapshot(h.world.rows('domain_events'));

  const result = await apply(h, ELIGIBLE_IDS, 'run-apply-1');
  assert.equal(result.mode, 'apply');
  assert.equal(result.run_id, 'run-apply-1');
  assert.deepEqual(result.results.map((r) => [r.inquiryId, r.outcome]), ELIGIBLE_IDS.map((id) => [id, 'created']));
  assert.deepEqual(result.summary, { requested: 5, created: 5, already_present: 0, skipped: 0, failed: 0 });
  assert.ok(result.results.every((r) => r.audit_recorded === true), 'every created conversation reports its audit as recorded');

  for (const id of ELIGIBLE_IDS) {
    const source = inquiriesBefore.find((row) => row.id === id);
    const threads = rowsWhere(h.world, 'message_threads', (t) => t.subject_type === 'marketplace_inquiry' && t.subject_id === id);
    assert.equal(threads.length, 1, `${id}: exactly one conversation`);
    const [thread] = threads;
    assert.equal(result.results.find((r) => r.inquiryId === id).threadId, thread.id);
    assert.equal(thread.thread_key, CANONICAL_KEY(id), 'the canonical key');
    assert.equal(thread.thread_type, 'marketplace_inquiry');
    assert.equal(thread.marketplace_listing_id, VIN);
    assert.equal(thread.metadata.marketplace_inquiry_id, id);
    assert.equal(thread.metadata.reconciliation_run_id, 'run-apply-1');
    assert.equal(thread.metadata.reconciled_by, 'admin-1');
    assert.match(thread.metadata.reconciled_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(thread.last_message_at, source.created_at, 'the conversation sits at the inquiry\'s own place in time');

    const messages = rowsWhere(h.world, 'messages', (m) => m.thread_id === thread.id);
    assert.equal(messages.length, 1, `${id}: one message`);
    assert.equal(messages[0].content_text, source.message, 'the exact inquiry text');
    assert.equal(messages[0].created_at, source.created_at, 'at the inquiry\'s own time');
    assert.equal(messages[0].client_message_id, `marketplace-inquiry:${id}`);
    assert.equal(messages[0].direction, 'inbound');

    const participants = rowsWhere(h.world, 'message_participants', (p) => p.thread_id === thread.id && !p.left_at);
    assert.equal(participants.find((p) => p.user_id === SELLER)?.stakeholder_role, 'seller', 'the inquiry\'s own seller');
    const buyers = participants.filter((p) => ['buyer', 'buyer_unresolved'].includes(p.stakeholder_role));
    assert.equal(buyers.length, 1, `${id}: one buyer participant`);
    if (id === 'inq-signed-in') {
      assert.deepEqual([buyers[0].user_id, buyers[0].stakeholder_role], [BUYER, 'buyer']);
    } else {
      assert.equal(buyers[0].stakeholder_role, 'buyer_unresolved', 'a guest is a placeholder: consent is not re-derived');
      assert.equal(buyers[0].permissions.read, false);
      assert.equal(buyers[0].external_identity_id ?? null, null);
    }
  }

  assert.equal(h.world.rows('notification_queue').length, 0, 'no notification of any kind');
  assert.equal(h.world.rows('conversation_events').length, 0, 'no funnel or analytics events');
  assert.equal(h.world.rows('channel_identities').length, 0, 'no guest channel identity');
  assert.equal(h.world.rows('conversation_channel_bindings').length, 0, 'no guest channel binding');
  assert.deepEqual(h.world.rows('marketplace_inquiries'), inquiriesBefore, 'no inquiry row changed');
  assert.deepEqual(h.world.rows('domain_events'), eventsBefore, 'no outbox event changed');

  const audits = rowsWhere(h.world, 'trust_audit_events', (a) => a.event_type === RECONCILIATION_AUDIT_EVENT);
  assert.equal(audits.length, 5, 'one audit event per conversation created');
  for (const audit of audits) {
    assert.equal(audit.actor_user_id, 'admin-1');
    assert.equal(audit.new_value.reconciliation_run_id, 'run-apply-1');
    const created = result.results.find((r) => r.inquiryId === audit.new_value.inquiry_id);
    assert.equal(audit.new_value.thread_id, created.threadId);
    assert.ok(audit.new_value.message_id);
    const serialized = JSON.stringify(audit);
    for (const pii of [...GUEST_PII, 'Exact buyer question']) assert.equal(serialized.includes(pii), false, `the audit carries no ${pii}`);
  }

  // The seller now finds them in the ordinary conversation list — unread, at their original time.
  const inbox = await h.services.conversationService.listConversationsForUser(SELLER);
  const reconciled = inbox.filter((c) => ELIGIBLE_IDS.includes(c.subject_id));
  assert.equal(reconciled.length, 5);
  assert.ok(reconciled.every((c) => c.unread_count === 1 && c.latest_message?.text?.startsWith('Exact buyer question')));
});

test('a second apply is already_present for every id and writes nothing', async () => {
  const h = harness();
  const first = await apply(h, ELIGIBLE_IDS, 'run-a');
  const writes = h.world.writes.length;
  const second = await apply(h, ELIGIBLE_IDS, 'run-b');
  assert.deepEqual(second.results.map((r) => r.outcome), ELIGIBLE_IDS.map(() => 'already_present'));
  assert.deepEqual(second.results.map((r) => r.threadId), first.results.map((r) => r.threadId));
  assert.equal(h.world.writes.length, writes, 'nothing was written by the second apply');
  assert.equal(rowsWhere(h.world, 'trust_audit_events').length, 5, 'no second audit');
});

test('apply refuses every id that is not ELIGIBLE, and leaves governed quarantines exactly as they were', async () => {
  const h = harness();
  const eventsBefore = snapshot(h.world.rows('domain_events'));
  const ids = ['inq-quarantined-stale', 'inq-quarantined-superseded', 'inq-pending', 'inq-processing', 'inq-no-seller',
    'inq-diaspora', 'inq-spam', 'inq-rejected', 'inq-legacy-failed', 'inq-has-canonical', 'inq-has-legacy', 'inq-unknown'];
  const writes = h.world.writes.length;
  const result = await apply(h, ids);
  const outcome = Object.fromEntries(result.results.map((r) => [r.inquiryId, [r.outcome, r.reason]]));
  assert.deepEqual(outcome, {
    'inq-quarantined-stale': ['skipped', C.GOVERNED_QUARANTINE],
    'inq-quarantined-superseded': ['skipped', C.GOVERNED_QUARANTINE],
    'inq-pending': ['skipped', C.PENDING_DELIVERY],
    'inq-processing': ['skipped', C.PENDING_DELIVERY],
    'inq-no-seller': ['skipped', C.NOT_THREADABLE],
    'inq-diaspora': ['skipped', C.NOT_THREADABLE],
    'inq-spam': ['skipped', C.NOT_THREADABLE],
    'inq-rejected': ['skipped', C.NOT_THREADABLE],
    'inq-legacy-failed': ['skipped', C.NEEDS_REVIEW],
    'inq-has-canonical': ['already_present', undefined],
    'inq-has-legacy': ['already_present', undefined],
    'inq-unknown': ['skipped', 'INQUIRY_NOT_FOUND'],
  });
  assert.equal(result.results.find((r) => r.inquiryId === 'inq-quarantined-stale').detail, 'STALE_HISTORICAL_QUARANTINE');
  assert.equal(result.results.find((r) => r.inquiryId === 'inq-has-legacy').threadId, 'thr-legacy');
  assert.equal(h.world.writes.length, writes, 'nothing was written');
  assert.deepEqual(h.world.rows('domain_events'), eventsBefore, 'the governed decisions are untouched');
});

test('apply re-classifies at apply time: an inquiry whose event went back to pending after the plan is left to the worker', async () => {
  const h = harness();
  const plan = await planReconciliation({ supabase: h.client });
  assert.equal(plan.items.find((i) => i.inquiry_id === 'inq-dead-letter').category, C.ELIGIBLE);
  h.world.rows('domain_events').find((e) => e.id === 'evt-dead').status = 'pending'; // an operator requeued it
  const result = await apply(h, ['inq-dead-letter']);
  assert.deepEqual([result.results[0].outcome, result.results[0].reason], ['skipped', C.PENDING_DELIVERY]);
  assert.equal(rowsWhere(h.world, 'message_threads', (t) => t.subject_id === 'inq-dead-letter').length, 0);
});

test('an interrupted reconciliation is completed by the next apply — never duplicated', async () => {
  const h = harness();
  const { threadService } = h.services;
  const original = threadService.recordMessage.bind(threadService);
  threadService.recordMessage = async () => { throw new Error('simulated PostgREST timeout'); };
  const failed = await apply(h, ['inq-whatsapp-guest'], 'run-interrupted');
  threadService.recordMessage = original;
  assert.deepEqual([failed.results[0].outcome, failed.results[0].reason], ['failed', 'APPLY_FAILED']);
  assert.equal(rowsWhere(h.world, 'message_threads', (t) => t.subject_id === 'inq-whatsapp-guest').length, 1, 'the half-built thread exists');
  assert.equal(rowsWhere(h.world, 'trust_audit_events').length, 0, 'no audit for a conversation that was not completed');

  const plan = await planReconciliation({ supabase: h.client });
  const item = plan.items.find((i) => i.inquiry_id === 'inq-whatsapp-guest');
  assert.deepEqual([item.category, item.reason], [C.ELIGIBLE, 'resume_incomplete_reconciliation'], 'an incomplete reconciliation is not a conversation');

  const resumed = await apply(h, ['inq-whatsapp-guest'], 'run-resume');
  assert.equal(resumed.results[0].outcome, 'created');
  const threads = rowsWhere(h.world, 'message_threads', (t) => t.subject_id === 'inq-whatsapp-guest');
  assert.equal(threads.length, 1, 'the same thread was completed');
  assert.equal(threads[0].metadata.reconciliation_run_id, 'run-interrupted', 'the creating run stays on record');
  assert.equal(rowsWhere(h.world, 'messages', (m) => m.thread_id === threads[0].id).length, 1);
  assert.equal(rowsWhere(h.world, 'message_participants', (p) => p.thread_id === threads[0].id && p.stakeholder_role === 'buyer_unresolved').length, 1, 'one placeholder');
  assert.equal(rowsWhere(h.world, 'trust_audit_events').length, 1);
  assert.equal(h.world.rows('notification_queue').length, 0);
});

// ── The conversation service in reconciliation mode ───────────────────────────────────────────────────

test('negative control: the NORMAL creation path over this world does queue a notification and analytics', async () => {
  const h = harness();
  await h.services.conversationService.canonicalizeMarketplaceInquiry({ event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-signed-in' } });
  assert.ok(h.world.rows('notification_queue').length > 0, 'the harness sees a notification when one is queued');
  assert.ok(h.world.rows('conversation_events').length > 0, 'the harness sees analytics when they are written');
});

test('a replayed creation event over a reconciled conversation delivers nothing — its first message stays undelivered', async () => {
  const h = harness();
  await apply(h, ['inq-signed-in', 'inq-pre-event']);
  for (const inquiryId of ['inq-signed-in', 'inq-pre-event']) {
    await h.services.orchestrator.handleDomainEvent({ event_type: 'marketplace.inquiry.created', payload: { inquiryId } }, null, null);
  }
  assert.equal(h.world.rows('notification_queue').length, 0);
  assert.equal(h.world.rows('conversation_events').length, 0);
  assert.equal(rowsWhere(h.world, 'message_threads', (t) => t.subject_id === 'inq-signed-in').length, 1);
});

test('reconciliation mode never edits a conversation it did not create, and never takes the seller from the event', async () => {
  const h = harness();
  const { conversationService } = h.services;
  // The worker's own conversation for this inquiry.
  await conversationService.canonicalizeMarketplaceInquiry({ event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-processed' } });
  const threadsBefore = snapshot(h.world.rows('message_threads'));
  const participantsBefore = snapshot(h.world.rows('message_participants'));
  const [result] = await conversationService.canonicalizeMarketplaceInquiry(
    { event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-processed' } },
    { mode: 'reconciliation', reconciliationRunId: 'run-x', actor: ADMIN },
  );
  assert.equal(result.reconciliation.outcome, 'already_present');
  assert.deepEqual(h.world.rows('message_threads'), threadsBefore);
  assert.deepEqual(h.world.rows('message_participants'), participantsBefore);

  const [forged] = await conversationService.canonicalizeMarketplaceInquiry(
    { event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-pre-event', sellerId: 'someone-else', buyerId: 'someone-else' } },
    { mode: 'reconciliation', reconciliationRunId: 'run-y', actor: ADMIN },
  );
  const participants = rowsWhere(h.world, 'message_participants', (p) => p.thread_id === forged.thread.id);
  assert.deepEqual(participants.map((p) => p.user_id).filter(Boolean), [SELLER], 'the seller is the inquiry\'s own; the payload names no one');
  assert.equal(forged.thread.primary_user_id, SELLER);
  await assert.rejects(
    () => conversationService.canonicalizeMarketplaceInquiry(
      { event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-no-seller', sellerId: 'someone-else' } },
      { mode: 'reconciliation', reconciliationRunId: 'run-z', actor: ADMIN },
    ),
    /no seller participant/,
    'an inquiry with no seller never borrows one from an event payload',
  );

  // Called directly on a conversation reconciliation already finished, it is a read-only no-op.
  const writes = h.world.writes.length;
  const [again] = await conversationService.canonicalizeMarketplaceInquiry(
    { event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-pre-event' } },
    { mode: 'reconciliation', reconciliationRunId: 'run-y2', actor: ADMIN },
  );
  assert.equal(again.reconciliation.outcome, 'already_present');
  assert.equal(again.thread.id, forged.thread.id);
  assert.equal(h.world.writes.length, writes, 'nothing written');

  await assert.rejects(
    () => conversationService.canonicalizeMarketplaceInquiry({ payload: { inquiryId: 'inq-signed-in' } }, { mode: 'reconciliation', actor: ADMIN }),
    /reconciliation run id/i,
    'a reconciliation is always attributable',
  );
});

test('called directly, apply refuses a malformed request with a ValidationError that carries its own code', async () => {
  const h = harness();
  const { ValidationError } = await import('../utils/errors.js');
  for (const [inquiryIds, code] of [[[], 'RECONCILIATION_IDS_REQUIRED'], [Array.from({ length: 51 }, (_, i) => `inq-${i}`), 'RECONCILIATION_TOO_MANY_IDS'], [['a,b'], 'RECONCILIATION_ID_INVALID']]) {
    await assert.rejects(() => apply(h, inquiryIds), (error) => error instanceof ValidationError && error.statusCode === 400 && error.code === code);
  }
});

// ── The admin endpoints ──────────────────────────────────────────────────────────────────────────────

const routeHarness = harness();
const restoreWorld = installSupabaseWorld(supabase, routeHarness.world);
// Session authority on a production-like runtime resolves through these RPCs (CA-K3-AUTH-05), not the test adapter.
const pick = (row, keys) => (row ? Object.fromEntries(keys.map((key) => [key, row[key] ?? null])) : null);
routeHarness.world.rpcs.set('session_authority_resolve_token', ({ p_token }, { rowsOf }) => ({
  data: pick(rowsOf('user_sessions').find((s) => s.token === p_token), ['id', 'user_id', 'active_role', 'active_organization_id', 'is_valid', 'created_at', 'expires_at', 'user_agent']),
  error: null,
}));
routeHarness.world.rpcs.set('session_authority_resolve_assurance', ({ p_token }, { rowsOf }) => ({
  data: pick(rowsOf('user_sessions').find((s) => s.token === p_token), ['id', 'user_id', 'is_valid', 'created_at', 'expires_at', 'auth_method', 'step_up_at', 'step_up_method']),
  error: null,
}));
const app = express();
app.use(express.json());
app.use(createAdminCommunicationRouter({ services: routeHarness.services }));
app.use(errorHandler);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
after(() => { server.close(); restoreWorld(); });

function call(method, path, { token = null, userId = null, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-session-token'] = token;
    if (userId) headers['x-user-id'] = userId;
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch { parsed = { _raw: buf }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const PLAN_PATH = '/api/admin/communications/inquiry-reconciliation';
const APPLY_PATH = '/api/admin/communications/inquiry-reconciliation/apply';

test('GET the plan: a platform admin reads the dry-run; anyone else is refused', async () => {
  const ok = await call('GET', PLAN_PATH, { token: 'admin-fresh' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.mode, 'dry_run');
  assert.equal(ok.body.summary.by_category.ELIGIBLE, 5);
  assert.equal((await call('GET', PLAN_PATH, { token: 'owner-fresh' })).status, 403, 'not a platform admin');
  assert.equal((await call('GET', PLAN_PATH)).status, 401, 'no identity');
  const limited = await call('GET', `${PLAN_PATH}?limit=3`, { token: 'admin-fresh' });
  assert.equal(limited.body.items.length, 3);
  assert.equal(limited.body.items_truncated, true);
  assert.equal(limited.body.summary.without_conversation, 14, 'the summary still counts everything');
});

test('POST apply is refused without a platform admin, without a fresh step-up, and without the exact confirmation — writing nothing', async () => {
  const writes = routeHarness.world.writes.length;
  const body = { inquiry_ids: ['inq-pre-event'], confirm: 'RECONCILE' };

  const owner = await call('POST', APPLY_PATH, { token: 'owner-fresh', body });
  assert.equal(owner.status, 403);
  const stale = await call('POST', APPLY_PATH, { token: 'admin-stale', body });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'STEP_UP_REQUIRED');
  const asserted = await call('POST', APPLY_PATH, { userId: 'admin-1', body });
  assert.equal(asserted.status, 403);
  assert.equal(asserted.body.code, 'STEP_UP_PROVEN_SESSION_REQUIRED', 'an asserted identity never applies');

  for (const [payload, code] of [
    [{ inquiry_ids: ['inq-pre-event'] }, 'RECONCILIATION_CONFIRMATION_REQUIRED'],
    [{ inquiry_ids: ['inq-pre-event'], confirm: 'reconcile' }, 'RECONCILIATION_CONFIRMATION_REQUIRED'],
    [{ confirm: 'RECONCILE' }, 'RECONCILIATION_IDS_REQUIRED'],
    [{ inquiry_ids: [], confirm: 'RECONCILE' }, 'RECONCILIATION_IDS_REQUIRED'],
    [{ inquiry_ids: Array.from({ length: 51 }, (_, i) => `inq-${i}`), confirm: 'RECONCILE' }, 'RECONCILIATION_TOO_MANY_IDS'],
    [{ inquiry_ids: ['inq-pre-event', 'bad id,with()'], confirm: 'RECONCILE' }, 'RECONCILIATION_ID_INVALID'],
    [{ inquiry_ids: [42], confirm: 'RECONCILE' }, 'RECONCILIATION_ID_INVALID'],
  ]) {
    const refused = await call('POST', APPLY_PATH, { token: 'admin-fresh', body: payload });
    assert.equal(refused.status, 400, JSON.stringify(payload));
    assert.equal(refused.body.code, code, JSON.stringify(payload));
  }
  assert.equal(routeHarness.world.writes.length, writes, 'no refusal wrote anything');
});

test('POST apply by a stepped-up platform admin reconciles, and a repeat is already_present', async () => {
  const body = { inquiry_ids: ['inq-pre-event', 'inq-quarantined-stale'], confirm: 'RECONCILE' };
  const applied = await call('POST', APPLY_PATH, { token: 'admin-fresh', body });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.match(applied.body.run_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(applied.body.results.map((r) => [r.inquiryId, r.outcome]), [['inq-pre-event', 'created'], ['inq-quarantined-stale', 'skipped']]);
  const audit = routeHarness.world.rows('trust_audit_events').find((a) => a.new_value?.inquiry_id === 'inq-pre-event');
  assert.equal(audit.actor_user_id, 'admin-1');
  assert.equal(audit.new_value.reconciliation_run_id, applied.body.run_id);
  assert.equal(routeHarness.world.rows('notification_queue').length, 0);

  const again = await call('POST', APPLY_PATH, { token: 'admin-fresh', body });
  assert.deepEqual(again.body.results.map((r) => r.outcome), ['already_present', 'skipped']);
});

test('on a production-like runtime the reconciliation refusals keep their specific codes', async () => {
  const saved = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview';
  try {
    const noConfirm = await call('POST', APPLY_PATH, { token: 'admin-fresh', body: { inquiry_ids: ['inq-processed'] } });
    assert.equal(noConfirm.status, 400, JSON.stringify(noConfirm.body));
    assert.equal(noConfirm.body.code, 'RECONCILIATION_CONFIRMATION_REQUIRED');
    const tooMany = await call('POST', APPLY_PATH, { token: 'admin-fresh', body: { inquiry_ids: Array.from({ length: 51 }, (_, i) => `inq-${i}`), confirm: 'RECONCILE' } });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.code, 'RECONCILIATION_TOO_MANY_IDS');
    const owner = await call('GET', PLAN_PATH, { token: 'owner-fresh' });
    assert.equal(owner.status, 403);
    assert.equal(owner.body.code, 'PLATFORM_ADMIN_REQUIRED');
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = saved;
  }
});
