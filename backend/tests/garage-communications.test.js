import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, migrationUpSql } from './helpers/pgliteLedgerHarness.js';
import { createGarageFinalWorld, postgrestOver } from './helpers/garageFinalWorld.js';
import { deterministicEventIdentity, GARAGE_DEDUPED_EVENTS } from '../services/eventBus/eventBusService.js';
import { COMMUNICATION_EVENT_TYPES } from '../services/communication/communicationEventListeners.js';
import { NOTIFICATION_POLICIES, templateVariablesForEvent } from '../services/communication/communicationNotificationService.js';
import { CommunicationTemplateService } from '../services/communication/communicationTemplateService.js';
import { GARAGE_NOTIFICATION_EVENTS, notifyCaseAudience } from '../services/garageOperations/garageNotificationService.js';
import {
  createEstimateForCase, decideMyEstimate, sendEstimate,
} from '../services/garageOperations/garageEstimateService.js';
import { issueInvoice, recordPayment } from '../services/garageOperations/garageInvoiceService.js';
import { confirmGarageAppointment, transitionGarageAppointment } from '../services/garageOperations/garageSchedulingService.js';
import { completeJob, startServiceCase } from '../services/serviceNetwork/serviceCaseService.js';
import { recordService } from '../services/serviceNetwork/serviceRecordService.js';
import { assignMechanic, createWorkOrderForCase } from '../services/serviceNetwork/workOrderAssignmentService.js';

const COMMS_MIGRATION = '20261024140000_garage_communications_events_and_template.sql';
const OPS = [
  '20261024100000_garage_ops04_estimates_and_authorization.sql',
  '20261024110000_garage_ops05_workshop_execution_gates.sql',
  '20261024120000_garage_ops06_parts_stock.sql',
  '20261024130000_garage_ops07_invoice_payment_receipt.sql',
];
const ALL_EVENTS = Object.values(GARAGE_NOTIFICATION_EVENTS);
const read = (f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
let world; let db; let client;

const garageActor = (id, tenant, role = 'admin') => ({ id, role: 'owner', activeTenant: { id: tenant, type: 'garage', role } });
const person = (id) => ({ id, role: 'owner', activeTenant: null });
const adminA = () => garageActor('admin-a', world.T.a);
const mechA = () => garageActor('mech-a', world.T.a, 'mechanic');
const noEmit = { emitDomainEvent: async () => ({}) };
function recorder({ failWith = null } = {}) {
  const emitted = [];
  const deps = { emitDomainEvent: async (...args) => { if (failWith) throw new Error(failWith); emitted.push({ eventType: args[1], payload: args[2], tenantId: args[3] }); return {}; } };
  return { emitted, deps };
}

before(async () => {
  world = await createGarageFinalWorld({ after: OPS });
  db = world.db;
  client = postgrestOver(db);
});
after(async () => { await db?.close(); });

test('every Garage customer event is registered end to end: subscribed, in-app only, governed template, in-code mirror', () => {
  for (const eventType of ALL_EVENTS) {
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} is not subscribed`);
    const policy = NOTIFICATION_POLICIES[eventType];
    assert.ok(policy, `${eventType} has no policy`);
    assert.deepEqual(policy.channels, ['in_app'], `${eventType}: low noise — in-app only`);
    assert.deepEqual(policy.fallbackChannels, []);
    assert.equal(policy.policyChannelsOnly, true, `${eventType}: a user preference must not widen the channels`);
    assert.equal(policy.threadType, 'service_case');
    assert.equal(policy.templateKey, 'garage_commercial_update_v1');
    assert.equal(policy.classification, 'transactional');
  }
  const templates = new CommunicationTemplateService();
  assert.ok(templates.getTemplate('garage_commercial_update_v1'), 'in-code template mirror missing');
  const rendered = templates.render('garage_commercial_update_v1', { headline: 'The garage issued an invoice for your service', listing_id: 'VIN123' });
  assert.match(JSON.stringify(rendered), /The garage issued an invoice for your service \(vehicle VIN123\)/);
  // the governed registry row requires exactly the variables the projection can supply
  const sql = read(COMMS_MIGRATION);
  assert.match(sql, /'garage_commercial_update_v1'/);
  assert.match(sql, /'\["listing_id","headline"\]'::jsonb/);
  assert.match(sql, /'approved'/);
  const vars = templateVariablesForEvent('garage.estimate.sent', { vin: 'VIN1', headline: 'The garage sent you an estimate to review' });
  assert.equal(vars.listing_id, 'VIN1');
  assert.equal(vars.headline, 'The garage sent you an estimate to review');
});

test('the garage-side counterparts are deliberately NOT subscribed (their audience is a tenant, not a user)', () => {
  for (const eventType of ['garage.estimate.accepted', 'garage.estimate.declined', 'garage.payment.received', 'garage.estimate.decided']) {
    assert.ok(!COMMUNICATION_EVENT_TYPES.includes(eventType), eventType);
    assert.equal(NOTIFICATION_POLICIES[eventType], undefined);
  }
});

test('dedupe agreement: the JS identity and the SQL trigger derive the SAME key, and the migration lists exactly the deduped events', async () => {
  const sql = read(COMMS_MIGRATION).split('-- +migrate Down')[0];
  for (const eventType of GARAGE_DEDUPED_EVENTS) {
    assert.ok(sql.includes(`'${eventType}'`), `${eventType} missing from the dedupe branch`);
    const id = deterministicEventIdentity(eventType, { notificationKey: 'ent-1:user-1', occurredAt: new Date().toISOString() });
    assert.equal(id.dedupeKey, `${eventType}:ent-1:user-1`);
  }
  assert.equal(deterministicEventIdentity('garage.appointment.rescheduled', { notificationKey: 'x:y' }), null, 'a reschedule can repeat, so it has no once-only identity');
  // behaviour, on the real trigger
  const pg = new PGlite();
  try {
    await pg.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;");
    const slice = (file, from, to) => { const t = read(file); const a = t.indexOf(from); return t.slice(a, t.indexOf(to, a) + to.length); };
    await pg.exec(slice('011_phase6_schema.sql', 'CREATE TABLE IF NOT EXISTS domain_events (', ');'));
    await pg.exec(slice('20260811132100_communications_2_reliability_closure.sql', 'ALTER TABLE public.domain_events', 'WHERE dedupe_key IS NOT NULL;'));
    await pg.exec(slice('20260826120000_email_1_0_hardening.sql', 'CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()', 'FROM PUBLIC, anon, authenticated;'));
    await pg.exec(migrationUpSql('20261004180600_service_network_o4_event_dedupe.sql'));
    await pg.exec(`CREATE TABLE IF NOT EXISTS communication_templates (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), template_key TEXT UNIQUE, business_workflow TEXT, stakeholder_audience TEXT, classification TEXT, owner_team TEXT, status TEXT, metadata JSONB);
      CREATE TABLE IF NOT EXISTS communication_template_versions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), template_id UUID, version INT, channel TEXT, language TEXT, subject_template TEXT, body_template TEXT, required_variables JSONB, optional_variables JSONB, approval_status TEXT, experiment_metadata JSONB, UNIQUE(template_id, version, channel, language));`);
    await pg.exec(migrationUpSql(COMMS_MIGRATION));
    const insert = (type, payload) => pg.query('INSERT INTO domain_events(event_type, payload) VALUES ($1, $2::jsonb) RETURNING dedupe_key', [type, JSON.stringify(payload)]);
    assert.equal((await insert('garage.estimate.sent', { notificationKey: 'est-1:owner' })).rows[0].dedupe_key, 'garage.estimate.sent:est-1:owner');
    // the same estimate to a DIFFERENT person is a different notification
    assert.equal((await insert('garage.estimate.sent', { notificationKey: 'est-1:requester' })).rows[0].dedupe_key, 'garage.estimate.sent:est-1:requester');
    // a replay to the same person is refused by the database
    await assert.rejects(insert('garage.estimate.sent', { notificationKey: 'est-1:owner' }), /duplicate key|dedupe/i);
    assert.equal((await insert('garage.appointment.rescheduled', { notificationKey: 'a:b' })).rows[0].dedupe_key, null);
    // earlier branches survive (last writer wins, nothing dropped)
    assert.equal((await insert('service.case.accepted', { serviceCaseId: 'c-1' })).rows[0].dedupe_key, 'service.case.accepted:c-1');
    assert.equal((await insert('user.email.verified', { recipientUserId: 'u-1' })).rows[0].dedupe_key, 'user.email.verified:u-1');
    // idempotent: applying twice is safe, and the governed template exists exactly once
    await pg.exec(migrationUpSql(COMMS_MIGRATION));
    const { rows } = await pg.query("SELECT count(*)::int n FROM communication_template_versions v JOIN communication_templates t ON t.id=v.template_id WHERE t.template_key='garage_commercial_update_v1'");
    assert.equal(rows[0].n, 1);
    const { rows: [v] } = await pg.query("SELECT channel, approval_status, required_variables FROM communication_template_versions v JOIN communication_templates t ON t.id=v.template_id WHERE t.template_key='garage_commercial_update_v1'");
    assert.deepEqual(v, { channel: 'in_app', approval_status: 'approved', required_variables: ['listing_id', 'headline'] });
  } finally { await pg.close(); }
});

test('notifyCaseAudience: the owner AND the requester are told once each; a non-owner requester is not forgotten', async () => {
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-b','accepted') RETURNING id, vin, garage_tenant_id, requester_user_id",
    [world.V.a, world.T.a, world.B.a1]);
  const { emitted, deps } = recorder();
  const out = await notifyCaseAudience(client, { eventType: 'garage.estimate.sent', serviceCase: c, entity: { field: 'estimateId', id: 'est-9' } }, deps);
  assert.equal(out.emitted, 2);
  assert.deepEqual(emitted.map((e) => e.payload.recipientUserId).sort(), ['customer-a', 'customer-b']);
  assert.deepEqual(emitted.map((e) => e.payload.notificationKey).sort(), ['est-9:customer-a', 'est-9:customer-b']);
  for (const e of emitted) {
    assert.equal(e.eventType, 'garage.estimate.sent');
    assert.equal(e.tenantId, world.T.a);
    assert.equal(e.payload.headline, 'The garage sent you an estimate to review');
    const { occurredAt: _t, ...facts } = e.payload;
    assert.ok(!Object.keys(facts).some((k) => /amount|total|price|cost|note|internal/i.test(k)), 'no amount, price or private note field leaves the garage in a notification');
    assert.doesNotMatch(facts.headline, /\d/, 'the headline is a fixed sentence with no figures');
  }
  const same = await notifyCaseAudience(client, { eventType: 'garage.estimate.sent', serviceCase: { ...c, requester_user_id: 'customer-a' }, entity: { field: 'estimateId', id: 'est-10' } }, recorder().deps);
  assert.equal(same.emitted, 1, 'owner == requester is one person, one notification');
  assert.deepEqual((await notifyCaseAudience(client, { eventType: 'garage.unknown', serviceCase: c, entity: { field: 'x', id: '1' } }, deps)).failures, ['unregistered garage event: garage.unknown']);
});

test('a Communications failure is reported, never swallowed as "sent", and never undoes the estimate', async () => {
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id",
    [world.V.a, world.T.a, world.B.a1]);
  await createWorkOrderForCase(client, adminA(), c.id, {});
  const est = await createEstimateForCase(client, adminA(), c.id, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: 10 }] });
  const { deps } = recorder({ failWith: 'outbox unavailable' });
  const sent = await sendEstimate(client, adminA(), est.id, deps);
  assert.equal(sent.status, 'sent', 'the estimate stands');
  assert.equal(sent.notification.emitted, 0);
  assert.deepEqual(sent.notification.failures, ['outbox unavailable']);
});

test('THE LIFECYCLE NOTIFIES THE CUSTOMER: estimate sent, work started/completed (existing), invoice issued, payment recorded', async () => {
  const { emitted, deps } = recorder();
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id",
    [world.V.a, world.T.a, world.B.a1]);
  const { workOrder } = await createWorkOrderForCase(client, adminA(), c.id, {});
  const est = await createEstimateForCase(client, adminA(), c.id, { currency: 'USD', lines: [{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }] });
  await sendEstimate(client, adminA(), est.id, deps);
  await decideMyEstimate(client, person('customer-a'), est.id, { decision: 'accept' });
  await assignMechanic(client, adminA(), workOrder.id, { mechanic_user_id: 'mech-a' });
  await startServiceCase(client, adminA(), c.id, deps);
  await recordService(client, mechA(), workOrder.id, { work_performed: 'Done', total_cost: 100, currency: 'USD' });
  await completeJob(client, mechA(), c.id, deps);
  const invoice = await issueInvoice(client, adminA(), c.id, { currency: 'USD', lines: [{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }] }, deps);
  assert.equal(invoice.notification.emitted, 1);
  const paid = await recordPayment(client, adminA(), invoice.id, { amount: 100, method: 'cash', idempotency_key: 'comms-key-0001' }, deps);
  assert.equal(paid.notification.emitted, 1);
  const replay = await recordPayment(client, adminA(), invoice.id, { amount: 100, method: 'cash', idempotency_key: 'comms-key-0001' }, deps);
  assert.equal(replay.notification.emitted, 0, 'a replayed payment record announces nothing new');

  const types = emitted.map((e) => e.eventType);
  assert.deepEqual(types, ['garage.estimate.sent', 'service.work.started', 'service.case.completed', 'garage.invoice.issued', 'garage.payment.recorded']);
  for (const e of emitted) assert.equal(e.payload.recipientUserId, 'customer-a');
  const payment = emitted.find((e) => e.eventType === 'garage.payment.recorded');
  assert.equal(payment.payload.headline, 'The garage recorded a payment on your invoice');
  assert.ok(!/confirmed|verified|settled/i.test(payment.payload.headline), 'the headline claims no verification CarUp did not do');
});

test('appointment decisions reach the requester: declined / cancelled by the garage; a visit marked fulfilled is bookkeeping', async () => {
  const mk = async (status = 'requested') => {
    const { rows: [c] } = await db.query(
      "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id",
      [world.V.a, world.T.a, world.B.a1]);
    const { rows: [appt] } = await db.query(
      status === 'confirmed'
        ? `INSERT INTO garage_appointments (tenant_id,service_case_id,branch_id,status,starts_at,ends_at,appointment_timezone,requested_by_user_id,planned_workforce_profile_id,confirmed_by_user_id,confirmed_at)
           VALUES ($1,$2,$3,'confirmed','2026-10-26T08:00:00Z','2026-10-26T09:00:00Z','Africa/Harare','customer-a','${world.W.a1}','admin-a',now()) RETURNING id`
        : `INSERT INTO garage_appointments (tenant_id,service_case_id,branch_id,status,starts_at,ends_at,appointment_timezone,requested_by_user_id)
           VALUES ($1,$2,$3,'requested','2026-10-26T08:00:00Z','2026-10-26T09:00:00Z','Africa/Harare','customer-a') RETURNING id`,
      [world.T.a, c.id, world.B.a1]);
    return appt;
  };
  const declinedAppt = await mk();
  const r1 = recorder();
  const declined = await transitionGarageAppointment(client, adminA(), declinedAppt.id, 'declined', r1.deps);
  assert.equal(declined.notification.emitted, 1);
  assert.equal(r1.emitted[0].eventType, 'garage.appointment.declined');
  assert.equal(r1.emitted[0].payload.recipientUserId, 'customer-a');
  assert.equal(r1.emitted[0].payload.notificationKey, `${declinedAppt.id}:customer-a`);
  assert.equal(r1.emitted[0].payload.headline, 'The garage could not offer that appointment');

  const cancelledAppt = await mk();
  const r2 = recorder();
  await transitionGarageAppointment(client, adminA(), cancelledAppt.id, 'cancelled', r2.deps);
  assert.equal(r2.emitted[0].eventType, 'garage.appointment.cancelled');

  const fulfilledAppt = await mk('confirmed');
  const r3 = recorder();
  const fulfilled = await transitionGarageAppointment(client, adminA(), fulfilledAppt.id, 'fulfilled', r3.deps);
  assert.equal(fulfilled.notification, undefined, 'marking a visit fulfilled is the garage\'s own bookkeeping');
  assert.deepEqual(r3.emitted, []);
  void confirmGarageAppointment;
});

test('no parallel notification system: Garage services never queue, send or template anything themselves', () => {
  for (const file of ['garageEstimateService.js', 'garageInvoiceService.js', 'garageStockService.js', 'garageNotificationService.js', 'garageSchedulingService.js']) {
    const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../services/garageOperations', file), 'utf8');
    assert.doesNotMatch(source, /notification_queue|queueNotification|sendEmail|sendWhatsApp|sendSms|new Resend|twilio|expo-server/i, file);
  }
});
