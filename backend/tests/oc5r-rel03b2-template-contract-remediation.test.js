import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import {
  NOTIFICATION_POLICIES,
  templateVariablesForEvent,
} from '../services/communication/communicationNotificationService.js';
import { CommunicationTemplateService } from '../services/communication/communicationTemplateService.js';
import { CommunicationGovernedTemplateService } from '../services/communication/communicationGovernedTemplateService.js';
import {
  evaluateRenderContract,
  summarizeClassARenderContracts,
} from '../../scripts/ci/lib/oc5r-rel03-render-contract.mjs';
import { reviewNextWorkerBatch } from '../../scripts/ci/lib/oc5r-rel03-worker-custody.mjs';
import { parseMigrationSource } from '../db/migrationParser.js';

const MIGRATION = readFileSync('database/migrations/20261009090000_oc5r_rel03b2_trade_event_template_contracts.sql', 'utf8');
const PROJECTION_SOURCE = readFileSync('backend/services/communication/communicationNotificationService.js', 'utf8');

const historical = Object.freeze({
  'diaspora.warehouse.cargo_received': { recipientUserId: 'user-1', intakeId: 'in-1', reference: 'WHIN-1', outcome: 'RECEIVED', headline: 'Your cargo has been received at the warehouse.' },
  'diaspora.warehouse.condition_issue': { recipientUserId: 'user-1', intakeId: 'in-1', reference: 'WHIN-1', condition: 'minor_damage', headline: 'The warehouse noted the condition of your cargo when it arrived.', observation_only: true },
  'diaspora.warehouse.measurement_discrepancy': { recipientUserId: 'user-1', intakeId: 'in-1', reference: 'WHIN-1', headline: 'The warehouse measured your cargo and it differs from the estimate.', commercial_effect: 'none' },
  'diaspora.loading.cargo_loaded': { recipientUserId: 'user-1', loadItemId: 'li-1', reference: 'LOAD-1', headline: 'Your cargo has been loaded into the container.', note: 'Loaded does not mean sailed.' },
  'diaspora.loading.cargo_left_behind': { recipientUserId: 'user-1', loadItemId: 'li-2', reference: 'LOAD-1', headline: 'Your cargo was not loaded into this container.', reason: 'There was not enough room left in the container.' },
  'diaspora.shipment.exception': { recipientUserId: 'user-1', shipmentId: 'ship-1', reference: 'SHPM-1', stage: 'EXCEPTION', advisory_only: true },
});

const registryRows = Object.freeze([
  { template_key: 'warehouse_intake_update_v1', template_status: 'active', template_version_id: 'v-wh', version: 1, channel: 'in_app', language: 'en', required_variables: ['reference', 'headline'], approval_status: 'approved' },
  { template_key: 'container_loading_update_v1', template_status: 'active', template_version_id: 'v-load', version: 1, channel: 'in_app', language: 'en', required_variables: ['reference', 'headline'], approval_status: 'approved' },
  { template_key: 'shipment_exception_v1', template_status: 'active', template_version_id: 'v-ship', version: 1, channel: 'in_app', language: 'en', required_variables: ['reference', 'stage'], approval_status: 'approved' },
  { template_key: 'logistics_update_v1', template_status: 'active', template_version_id: 'v-t3', version: 1, channel: 'in_app', language: 'en', required_variables: ['reference', 'status', 'route'], approval_status: 'approved' },
]);

function repositoryFor(key, required) {
  return {
    async findOne(table, where) {
      assert.equal(table, 'communication_templates');
      return where.template_key === key ? { id: `tpl-${key}`, template_key: key, status: 'active', classification: 'transactional' } : null;
    },
    async list(table, where) {
      assert.equal(table, 'communication_template_versions');
      return where.template_id === `tpl-${key}` ? [{ id: `ver-${key}`, version: 1, channel: 'in_app', language: 'en', required_variables: required, approval_status: 'approved', subject_template: `{{reference}}`, body_template: key === 'shipment_exception_v1' ? '{{stage}}' : '{{headline}}' }] : [];
    },
  };
}

test('T7/T9/T10 policies use their own semantic template contracts while T3 remains unchanged', () => {
  for (const type of Object.keys(historical).filter((value) => value.startsWith('diaspora.warehouse.'))) {
    assert.equal(NOTIFICATION_POLICIES[type].templateKey, 'warehouse_intake_update_v1');
  }
  for (const type of Object.keys(historical).filter((value) => value.startsWith('diaspora.loading.'))) {
    assert.equal(NOTIFICATION_POLICIES[type].templateKey, 'container_loading_update_v1');
  }
  assert.equal(NOTIFICATION_POLICIES['diaspora.shipment.exception'].templateKey, 'shipment_exception_v1');
  for (const type of ['diaspora.logistics.quote_submitted', 'diaspora.logistics.quote_accepted', 'diaspora.logistics.quote_not_selected', 'diaspora.logistics.quote_withdrawn']) {
    assert.equal(NOTIFICATION_POLICIES[type].templateKey, 'logistics_update_v1');
  }
});

test('historical T7/T9/T10 payloads render without route and without richer invented facts', async () => {
  const fallback = new CommunicationTemplateService();
  for (const [eventType, payload] of Object.entries(historical)) {
    assert.equal('route' in payload, false, `${eventType} historical payload must have no route`);
    const variables = templateVariablesForEvent(eventType, payload);
    assert.equal(variables.route, '');
    const policy = NOTIFICATION_POLICIES[eventType];
    const required = eventType === 'diaspora.shipment.exception' ? ['reference', 'stage'] : ['reference', 'headline'];
    const preflight = evaluateRenderContract({ event_type: eventType, payload, classification: { effect_class: 'IN_APP_ONLY' } }, registryRows);
    assert.equal(preflight.render_contract_ready, true, eventType);
    assert.deepEqual(preflight.missing_required_variables, []);
    const compatibility = fallback.render(policy.templateKey, variables);
    assert.doesNotMatch(compatibility.body, /\{\{/);
    const governed = new CommunicationGovernedTemplateService({ repository: repositoryFor(policy.templateKey, required) });
    const rendered = await governed.render(policy.templateKey, variables, { channel: 'in_app', language: 'en' });
    assert.equal(rendered.governed, true);
    assert.doesNotMatch(rendered.body, /\{\{/);
    for (const forbidden of ['price', 'payment', 'customs clearance', 'departed', 'trust conclusion']) {
      assert.doesNotMatch(rendered.body.toLowerCase(), new RegExp(forbidden));
    }
  }
});

test('T3 still fails closed when reference, status or route is absent', () => {
  for (const missing of ['reference', 'status', 'route']) {
    const payload = { recipientUserId: 'user-1', reference: 'SHIP-1', status: 'OFFER_ACCEPTED', route: 'Harare → Durban' };
    delete payload[missing];
    const result = evaluateRenderContract({ event_type: 'diaspora.logistics.quote_accepted', payload, classification: { effect_class: 'IN_APP_ONLY' } }, registryRows);
    assert.equal(result.render_contract_ready, false);
    assert.deepEqual(result.missing_required_variables, [missing]);
  }
});

test('forward migration registers only active approved in_app/en versions with exact variables', () => {
  for (const [key, required] of [
    ['warehouse_intake_update_v1', ['reference', 'headline']],
    ['container_loading_update_v1', ['reference', 'headline']],
    ['shipment_exception_v1', ['reference', 'stage']],
  ]) {
    assert.match(MIGRATION, new RegExp(`'${key}'`));
    const compact = MIGRATION.replace(/\s+/g, ' ');
    assert.match(compact, /'in_app', 'en'/);
    assert.match(compact, /'approved'/);
    assert.match(compact, new RegExp(required.map((value) => `\\"${value}\\"`).join(',')));
  }
  assert.doesNotMatch(MIGRATION, /UPDATE\s+communication_template/i);
  assert.doesNotMatch(MIGRATION, /DELETE\s+FROM\s+communication_template/i);
});

test('forward migration applies cleanly on PostgreSQL and reads back exact governed rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table communication_templates (
        id uuid primary key default gen_random_uuid(), template_key text unique not null,
        business_workflow text, stakeholder_audience text, classification text, owner_team text,
        status text, metadata jsonb
      );
      create table communication_template_versions (
        id uuid primary key default gen_random_uuid(), template_id uuid references communication_templates(id),
        version integer, channel text, language text, subject_template text, body_template text,
        required_variables jsonb, optional_variables jsonb, approval_status text, experiment_metadata jsonb,
        unique(template_id, version, channel, language)
      );
    `);
    await db.exec(parseMigrationSource(MIGRATION).up);
    const rows = (await db.query(`
      select t.template_key, t.status, v.channel, v.language, v.approval_status, v.required_variables
      from communication_templates t join communication_template_versions v on v.template_id=t.id
      order by t.template_key
    `)).rows;
    assert.deepEqual(rows.map((row) => ({
      template_key: row.template_key,
      status: row.status,
      channel: row.channel,
      language: row.language,
      approval_status: row.approval_status,
      required_variables: row.required_variables,
    })), [
      { template_key: 'container_loading_update_v1', status: 'active', channel: 'in_app', language: 'en', approval_status: 'approved', required_variables: ['reference', 'headline'] },
      { template_key: 'shipment_exception_v1', status: 'active', channel: 'in_app', language: 'en', approval_status: 'approved', required_variables: ['reference', 'stage'] },
      { template_key: 'warehouse_intake_update_v1', status: 'active', channel: 'in_app', language: 'en', approval_status: 'approved', required_variables: ['reference', 'headline'] },
    ]);
  } finally {
    await db.close();
  }
});

test('Class-A family summary evaluates every live row and emits metadata only', () => {
  const rows = Object.entries(historical).map(([event_type, payload], index) => ({ id: `e-${index}`, event_type, payload }));
  const classifications = new Map(rows.map((row) => [row.event_type, { effect_class: 'IN_APP_ONLY' }]));
  const summary = summarizeClassARenderContracts(rows, registryRows, classifications);
  assert.equal(summary.length, 6);
  assert.equal(summary.every((row) => row.result === 'PASS' && row.historical_live_sample_satisfiable), true);
  assert.equal(JSON.stringify(summary).includes('recipientUserId'), false);
  assert.equal(JSON.stringify(summary).includes('safe_payload'), false);
});

test('REL-03B-2 mutation set kills policy reversion, historical-variable loss, fabricated route and fail-open preflight', () => {
  const expected = {
    'diaspora.warehouse.cargo_received': 'warehouse_intake_update_v1',
    'diaspora.loading.cargo_loaded': 'container_loading_update_v1',
    'diaspora.shipment.exception': 'shipment_exception_v1',
  };
  const policyPasses = (policies) => Object.entries(expected).every(([type, key]) => policies[type]?.templateKey === key);
  assert.equal(policyPasses(NOTIFICATION_POLICIES), true);
  for (const type of Object.keys(expected)) {
    const mutant = { ...NOTIFICATION_POLICIES, [type]: { ...NOTIFICATION_POLICIES[type], templateKey: 'logistics_update_v1' } };
    assert.equal(policyPasses(mutant), false, `${type} reversion survived`);
  }

  const missingHistorical = { ...historical['diaspora.warehouse.cargo_received'] };
  delete missingHistorical.headline;
  const missing = evaluateRenderContract({ event_type: 'diaspora.warehouse.cargo_received', payload: missingHistorical, classification: { effect_class: 'IN_APP_ONLY' } }, registryRows);
  assert.equal(missing.render_contract_ready, false);
  assert.deepEqual(missing.missing_required_variables, ['headline']);

  assert.doesNotMatch(PROJECTION_SOURCE, /route:\s*payload\.route\s*\|\|\s*['"][^'"]+['"]/);
  assert.equal(templateVariablesForEvent('diaspora.warehouse.cargo_received', historical['diaspora.warehouse.cargo_received']).route, '');

  const unregistered = evaluateRenderContract({ event_type: 'diaspora.warehouse.cargo_received', payload: historical['diaspora.warehouse.cargo_received'], classification: { effect_class: 'IN_APP_ONLY' } }, []);
  assert.equal(unregistered.render_contract_ready, false);
  assert.equal(unregistered.stop_reason, 'template_unregistered');

  for (const renderContract of [missing, unregistered]) {
    const review = reviewNextWorkerBatch([{ id: 'e', event_type: renderContract.event_type, classification: { effect_class: 'IN_APP_ONLY' }, render_contract: renderContract }]);
    assert.equal(review.stop_required, true);
    assert.equal(review.combined_batch_gate_passes, false);
  }
});
