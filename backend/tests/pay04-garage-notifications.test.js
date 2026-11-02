/**
 * CARUP-PAY-04-LR01 — the two garage-payment notifications are registered end to end and once-only.
 *
 * garage.payment.confirmed / garage.payment.refunded: emitter (garageNotificationService) -> deterministic identity
 * (eventBusService) -> subscription (communicationEventListeners) -> policy + governed template
 * (communicationNotificationService) -> database identity by PAY-04's OWN trigger (migration 20261102120000), so the
 * shared dedupe function of other lineages is never re-stated for them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const { deterministicEventIdentity, PAY04_DEDUPED_EVENTS, GARAGE_DEDUPED_EVENTS } = await import('../services/eventBus/eventBusService.js');
const { COMMUNICATION_EVENT_TYPES } = await import('../services/communication/communicationEventListeners.js');
const { NOTIFICATION_POLICIES } = await import('../services/communication/communicationNotificationService.js');
const { GARAGE_NOTIFICATION_EVENTS, notifyCaseAudience } = await import('../services/garageOperations/garageNotificationService.js');

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
const read = (file) => readFileSync(path.join(MIGRATIONS, file), 'utf8');
const PAY04_NOTIFY = '20261102120000_carup_pay04_garage_payment_notifications.sql';

test('both events are registered at every layer, on the governed in-app template only', () => {
  assert.deepEqual([...PAY04_DEDUPED_EVENTS].sort(), ['garage.payment.confirmed', 'garage.payment.refunded']);
  assert.equal(GARAGE_NOTIFICATION_EVENTS.paymentConfirmed, 'garage.payment.confirmed');
  assert.equal(GARAGE_NOTIFICATION_EVENTS.paymentRefunded, 'garage.payment.refunded');
  for (const eventType of PAY04_DEDUPED_EVENTS) {
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} subscribed`);
    const policy = NOTIFICATION_POLICIES[eventType];
    assert.equal(policy.templateKey, 'garage_commercial_update_v1');
    assert.deepEqual(policy.channels, ['in_app']);
    assert.equal(policy.policyChannelsOnly, true);
    const id = deterministicEventIdentity(eventType, { notificationKey: 'col-1:rcpt:user-1', occurredAt: new Date().toISOString() });
    assert.equal(id.dedupeKey, `${eventType}:col-1:rcpt:user-1`);
    // they are NOT branches of the shared function, so they are not in its agreement list
    assert.ok(!GARAGE_DEDUPED_EVENTS.includes(eventType));
  }
});

test('the headline says what the PROVIDER confirmed, never an amount, and never that the garage recorded it', async () => {
  const emitted = [];
  const deps = { emitDomainEvent: async (_c, eventType, payload) => { emitted.push({ eventType, payload }); } };
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: 'owner-1' } }) }) }) }) };
  const serviceCase = { id: 'case-1', vin: 'VIN1', garage_tenant_id: 'g-1', requester_user_id: 'req-1' };
  const out = await notifyCaseAudience(client, { eventType: 'garage.payment.confirmed', serviceCase, entity: { field: 'collectionId', id: 'col-1:RCT-000004' } }, deps);
  assert.equal(out.emitted, 2, 'the requester and the registered owner each once');
  for (const e of emitted) {
    assert.equal(e.payload.headline, 'Your payment to the garage was confirmed by its payment provider');
    assert.doesNotMatch(e.payload.headline, /\d|recorded/);
    assert.equal(e.payload.notificationKey, `col-1:RCT-000004:${e.payload.recipientUserId}`);
  }
});

test('the database derives the same once-only key from PAY-04\'s own trigger; the shared function is untouched', async () => {
  const sql = read(PAY04_NOTIFY).split('-- +migrate Down')[0];
  assert.ok(!sql.includes('communication_domain_event_dedupe_key()'.replace('()', '() RETURNS')), 'the shared function is not re-stated');
  assert.match(sql, /WHEN \(NEW\.event_type IN \('garage\.payment\.confirmed', 'garage\.payment\.refunded'\)\)/);
  const pg = new PGlite();
  try {
    await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
    const slice = (file, from, to) => { const t = read(file); const a = t.indexOf(from); return t.slice(a, t.indexOf(to, a) + to.length); };
    await pg.exec(slice('011_phase6_schema.sql', 'CREATE TABLE IF NOT EXISTS domain_events (', ');'));
    await pg.exec(slice('20260811132100_communications_2_reliability_closure.sql', 'ALTER TABLE public.domain_events', 'WHERE dedupe_key IS NOT NULL;'));
    await pg.exec(sql);
    await pg.query("INSERT INTO domain_events (event_type, payload) VALUES ('garage.payment.confirmed', '{\"notificationKey\":\"c1:r1:u1\"}')");
    const { rows: [row] } = await pg.query("SELECT dedupe_key FROM domain_events WHERE event_type = 'garage.payment.confirmed'");
    assert.equal(row.dedupe_key, deterministicEventIdentity('garage.payment.confirmed', { notificationKey: 'c1:r1:u1' }).dedupeKey);
    await assert.rejects(pg.query("INSERT INTO domain_events (event_type, payload) VALUES ('garage.payment.confirmed', '{\"notificationKey\":\"c1:r1:u1\"}')"), /duplicate key|unique/);
    // other event types are not touched by this trigger
    await pg.query("INSERT INTO domain_events (event_type, payload) VALUES ('garage.payment.recorded', '{\"notificationKey\":\"c1:r1:u1\"}')");
    const { rows: [other] } = await pg.query("SELECT dedupe_key FROM domain_events WHERE event_type = 'garage.payment.recorded'");
    assert.equal(other.dedupe_key, null);
  } finally {
    await pg.close();
  }
});
