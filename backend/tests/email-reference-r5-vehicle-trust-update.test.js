import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMMUNICATION_EVENT_TYPES } from '../services/communication/communicationEventListeners.js';
import { NOTIFICATION_POLICIES, referencePayloadFor } from '../services/communication/communicationNotificationService.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { PRIVATE_VEHICLE_FIELDS } from '../utils/publicVehicleProjection.js';
import { PUBLIC_TRUST_FIELDS, TRUST_EVALUATION_STATES } from '../services/trustDecision/canonicalTrustService.js';
import {
  MATERIAL_TRUST_FIELDS,
  TRUST_PRESENTATION_CHANGED_EVENT,
  emitTrustPresentationChange,
  materialTrustChanges,
  resolveCurrentVehicleOwner,
} from '../services/trustDecision/trustPresentationChangeProducer.js';
import { referenceEntry } from '../services/communication/emailExperience/emailTemplateRegistry.js';
import { TRUST_STATE_PRESENTATION } from '../services/communication/emailExperience/referenceVehicleTrustUpdate.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';

/**
 * R5 — Vehicle Passport / Trust update.
 *
 * The four canonical states are FOUR DIFFERENT FACTS and the whole template turns on keeping them
 * apart. `not_evaluated` is not zero, not `unavailable`, and not a placeholder — rendering an
 * unknown as a number converts an absence of evidence into a claim, which is the single worst thing
 * a trust product can do.
 */

const ENV = {};
const VIN = 'FIXTUREVIN0000001';

function trustRecord(overrides = {}) {
  return {
    vin: VIN, evaluation_state: 'evaluated', score: 78, band: 'moderate', confidence: 'medium',
    evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 3, governed_facts_adverse: 0, connected_sources: 1, unbacked_legacy_claims: 0 },
    calculation_version: 'trust-decision-1.0.0', evaluated_at: '2026-08-26T00:00:00.000Z',
    known_limitations: ['No live government or partner source is connected for this vehicle yet.'],
    source: 'cache', ...overrides,
  };
}

function renderTrust(trust, extra = {}) {
  return renderEmailForNotification({
    title: 'Your Vehicle Passport was updated', message: '',
    payload: {
      classification: 'service', reference_template: 'vehicle_trust_update',
      email: 'fixture.owner@fixture.invalid', recipient_name: 'Fixture Owner',
      vehicle: { year: 2018, make: 'Toyota', model: 'Aqua', mileage: 88000 },
      trust, ...extra,
    },
  }, { env: ENV });
}

/** A supabase stand-in over fixture rows. */
function db({ vehicles = [], users = [] } = {}) {
  return {
    from: (table) => {
      const rows = table === 'vehicles' ? vehicles : table === 'users' ? users : [];
      const filters = [];
      const api = {
        select: () => api,
        eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) || null, error: null }),
      };
      return api;
    },
  };
}

// ============================================================================
// A. MATERIAL CHANGE — derived from the live PUBLIC_TRUST_FIELDS contract
// ============================================================================

test('A1 the comparison contract is derived from PUBLIC_TRUST_FIELDS, not a second list', () => {
  for (const field of MATERIAL_TRUST_FIELDS) {
    assert.ok(PUBLIC_TRUST_FIELDS.includes(field), `${field} is not a published field`);
  }
  // Excluded on purpose: a fresh timestamp is not news, and the VIN cannot change.
  assert.ok(!MATERIAL_TRUST_FIELDS.includes('evaluated_at'));
  assert.ok(!MATERIAL_TRUST_FIELDS.includes('vin'));
  assert.equal(MATERIAL_TRUST_FIELDS.length, PUBLIC_TRUST_FIELDS.length - 2);
});

test('A2 a new evaluated_at alone is NOT material', () => {
  const before = trustRecord();
  const after = trustRecord({ evaluated_at: '2026-09-01T00:00:00.000Z' });
  assert.deepEqual(materialTrustChanges(before, after), [], 're-mailing every recompute teaches people to ignore the ones that matter');
});

test('A3 each customer-visible field IS material', () => {
  const before = trustRecord();
  for (const [field, value] of [
    ['evaluation_state', 'stale'], ['score', 85], ['band', 'high'], ['confidence', 'high'],
    ['known_limitations', ['Something else entirely.']],
    ['evidence_basis', { governed_facts_total: 7, governed_facts_substantiated: 5, governed_facts_adverse: 0, connected_sources: 2, unbacked_legacy_claims: 0 }],
  ]) {
    assert.deepEqual(materialTrustChanges(before, trustRecord({ [field]: value })), [field], `${field} must be material`);
  }
});

test('A4 a first evaluation is announced, not skipped', () => {
  assert.deepEqual(materialTrustChanges(null, trustRecord()).sort(), [...MATERIAL_TRUST_FIELDS].sort());
});

// ============================================================================
// B. THE RECIPIENT POLICY — the current owner, and nobody else
// ============================================================================

test('B1 the current active owner resolves server-side', async () => {
  const client = db({ vehicles: [{ vin: VIN, owner_id: 'owner-1' }], users: [{ id: 'owner-1', status: 'active', deleted_at: null }] });
  assert.equal(await resolveCurrentVehicleOwner(VIN, client), 'owner-1');
});

test('B2 no owner, an inactive owner, or a deleted owner means NO Email', async () => {
  for (const [label, client] of [
    ['no owner_id', db({ vehicles: [{ vin: VIN, owner_id: null }] })],
    ['owner row missing', db({ vehicles: [{ vin: VIN, owner_id: 'ghost' }], users: [] })],
    ['owner deleted', db({ vehicles: [{ vin: VIN, owner_id: 'o' }], users: [{ id: 'o', deleted_at: '2026-01-01' }] })],
    ['owner suspended', db({ vehicles: [{ vin: VIN, owner_id: 'o' }], users: [{ id: 'o', status: 'suspended' }] })],
    ['vehicle missing', db({ vehicles: [] })],
  ]) {
    assert.equal(await resolveCurrentVehicleOwner(VIN, client), null, label);
  }
});

test('B3 there is NO fallback to any other audience', () => {
  // A dealer tenant is organisational scope, not one deterministic human. Guessing a recipient for a
  // message about someone's vehicle is worse than sending nothing.
  const source = fs.readFileSync(
    path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'services/trustDecision/trustPresentationChangeProducer.js'),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  for (const audience of ['tenant_members', 'saved_cars', 'watchers', 'followers', 'previous_owner', 'dealer_profiles', 'message_participants']) {
    assert.ok(!code.includes(audience), `${audience} must not be a fallback recipient`);
  }
});

// ============================================================================
// C. THE REAL PRODUCER
// ============================================================================

function emitHarness({ owner = 'owner-1', ownerRow = { id: 'owner-1', status: 'active', deleted_at: null } } = {}) {
  const emitted = [];
  return {
    emitted,
    client: db({ vehicles: [{ vin: VIN, owner_id: owner }], users: ownerRow ? [ownerRow] : [] }),
    pgClient: { query: async (_sql, params) => { emitted.push({ event_type: params[0], payload: JSON.parse(params[1]) }); return { rows: [{ id: 'e1' }] }; } },
  };
}

test('C1 a material change with a resolvable owner EMITS', async () => {
  const { client, pgClient, emitted } = emitHarness();
  const verdict = await emitTrustPresentationChange({
    vin: VIN, previousRecord: trustRecord({ evaluation_state: 'not_evaluated', score: null, band: null }),
    nextRecord: trustRecord(), client, pgClient,
  });
  assert.equal(verdict.emitted, true);
  assert.equal(verdict.recipientUserId, 'owner-1');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_type, TRUST_PRESENTATION_CHANGED_EVENT);
  assert.equal(emitted[0].payload.recipientUserId, 'owner-1');
  assert.equal(emitted[0].payload.trust.evaluation_state, 'evaluated');
});

test('C2 NO emission when the customer-visible position is unchanged', async () => {
  const { client, pgClient, emitted } = emitHarness();
  const verdict = await emitTrustPresentationChange({
    vin: VIN, previousRecord: trustRecord(), nextRecord: trustRecord({ evaluated_at: '2026-12-01T00:00:00.000Z' }), client, pgClient,
  });
  assert.equal(verdict.emitted, false);
  assert.equal(verdict.reason, 'no_material_change');
  assert.equal(emitted.length, 0);
});

test('C3 NO emission when the owner cannot be deterministically resolved', async () => {
  const { client, pgClient, emitted } = emitHarness({ owner: null, ownerRow: null });
  const verdict = await emitTrustPresentationChange({
    vin: VIN, previousRecord: null, nextRecord: trustRecord(), client, pgClient,
  });
  assert.equal(verdict.emitted, false);
  assert.equal(verdict.reason, 'no_resolvable_owner');
  assert.equal(emitted.length, 0);
});

test('C4 the emitted payload carries NO private field and NO legacy trust score', async () => {
  const { client, pgClient, emitted } = emitHarness();
  await emitTrustPresentationChange({ vin: VIN, previousRecord: null, nextRecord: trustRecord(), client, pgClient });
  const serialized = JSON.stringify(emitted[0].payload);
  for (const field of PRIVATE_VEHICLE_FIELDS) {
    assert.ok(!serialized.includes(`"${field}"`), `${field} must never reach the event payload`);
  }
  assert.ok(!/"owner_id"/.test(serialized), 'owner_id addresses a person; it is never content');
  assert.ok(!/"trust_score"/.test(serialized), 'the legacy column is never carried');
  assert.ok(!/"evidence"|"documents"|"attachments"/.test(serialized));
});

test('C5 the exported event constant and the emitted literal agree', async () => {
  // The literal is inlined at the emit site so the coverage gate can see it; this pins that the
  // exported identity has not drifted from what is actually emitted.
  const { client, pgClient, emitted } = emitHarness();
  await emitTrustPresentationChange({ vin: VIN, previousRecord: null, nextRecord: trustRecord(), client, pgClient });
  assert.equal(emitted[0].event_type, TRUST_PRESENTATION_CHANGED_EVENT);
  assert.equal(TRUST_PRESENTATION_CHANGED_EVENT, 'vehicle.trust.presentation_changed');
});

test('C6 the event is subscribed, classified service, and routed to Resend', () => {
  assert.ok(COMMUNICATION_EVENT_TYPES.includes(TRUST_PRESENTATION_CHANGED_EVENT));
  const policy = NOTIFICATION_POLICIES[TRUST_PRESENTATION_CHANGED_EVENT];
  assert.equal(policy.classification, 'service');
  assert.equal(policy.templateKey, 'vehicle_trust_update_v1');
  assert.ok(policy.channels.includes('email'));
  assert.equal(
    new EmailTransportRouter({ env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'n@mail.carup.dev', BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'm@marketing.carup.dev' } })
      .selectAdapter({ content: { data: { classification: 'service' } } }).adapter.provider,
    'resend',
  );
});

test('C7 the LIVE notification service queues ONE R5 notification from the real event', async () => {
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
    preferenceService: { getPreferences: async () => ({}), selectChannels: () => ['email'], isChannelAllowed: () => true, isInQuietHours: () => false },
    templateService: { render: async () => ({ subject: 'S', body: 'B', templateKey: 'vehicle_trust_update_v1', data: {} }) },
  });

  await service.queueFromDomainEvent({
    id: 'evt-r5', event_type: TRUST_PRESENTATION_CHANGED_EVENT,
    payload: {
      recipientUserId: 'owner-1', vin: VIN, trust: trustRecord(),
      vehicle: { year: 2018, make: 'Toyota', model: 'Aqua', mileage: 88000 },
    },
  });

  assert.equal(rows.length, 1, 'exactly one notification');
  assert.equal(rows[0].payload.classification, 'service');
  assert.equal(rows[0].payload.reference_template, 'vehicle_trust_update');
  assert.equal(rows[0].recipient_user_id, 'owner-1');
  assert.ok(!JSON.stringify(rows[0].payload).includes('owner_id'));

  const rendered = renderEmailForNotification({ title: 'Your Vehicle Passport was updated', message: '', payload: rows[0].payload }, { env: ENV });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.template_key, 'vehicle_trust_update_v1');
  assert.equal(rendered.trust_evaluation_state, 'evaluated');
});

// ============================================================================
// D. THE FOUR STATES
// ============================================================================

test('D1 evaluated publishes the numeric score', () => {
  const r = renderTrust(trustRecord());
  assert.equal(r.trust_evaluation_state, 'evaluated');
  assert.equal(r.trust_score_published, true);
  assert.ok(r.text.includes('78 / 100'));
  assert.ok(r.text.includes('moderate'), 'and the band');
});

test('D2 not_evaluated publishes NO number and is not a low score', () => {
  const r = renderTrust(trustRecord({ evaluation_state: 'not_evaluated', score: null, band: null }));
  assert.equal(r.trust_score_published, false);
  assert.ok(!/\b\d+ ?\/ ?100\b/.test(r.text), 'no score');
  assert.ok(!/\b0\b *\/ *100/.test(r.text), 'never zero');
  assert.ok(!r.text.includes('--/100') && !r.text.includes('—/100'), 'never a placeholder');
  assert.ok(/not a low score/i.test(r.text), 'and it says so explicitly');
});

test('D3 stale does NOT present a stale score as current', () => {
  // A score IS present on the record; the state forbids publishing it.
  const r = renderTrust(trustRecord({ evaluation_state: 'stale' }));
  assert.equal(r.trust_score_published, false);
  assert.ok(!r.text.includes('78 / 100'), 'a stale number must not be shown as the live position');
  assert.ok(/no longer current/i.test(r.text));
});

test('D4 unavailable stays distinct from not_evaluated', () => {
  const unavailable = renderTrust(trustRecord({ evaluation_state: 'unavailable', score: null, band: null }));
  const notEvaluated = renderTrust(trustRecord({ evaluation_state: 'not_evaluated', score: null, band: null }));
  assert.notEqual(
    TRUST_STATE_PRESENTATION.unavailable.headline,
    TRUST_STATE_PRESENTATION.not_evaluated.headline,
    'four states, four presentations',
  );
  assert.ok(/could not determine/i.test(unavailable.text));
  assert.ok(/different from having evaluated it/i.test(unavailable.text));
  assert.notEqual(unavailable.text, notEvaluated.text);
});

test('D5 all four canonical states are supported, and nothing else is', () => {
  for (const state of Object.values(TRUST_EVALUATION_STATES)) {
    assert.ok(TRUST_STATE_PRESENTATION[state], `${state} must have a presentation`);
    assert.equal(renderTrust(trustRecord({ evaluation_state: state, score: null })).ok, true);
  }
  const bogus = renderTrust(trustRecord({ evaluation_state: 'probably_fine' }));
  assert.equal(bogus.ok, false, 'a trust message about a state nobody defined is one nobody can vouch for');
});

// ============================================================================
// E. PRIVACY AND TRUTHFULNESS IN THE RENDERED EMAIL
// ============================================================================

test('E1 no owner id, private field, or legacy trust score is ever rendered', () => {
  const r = renderTrust(trustRecord(), {
    vehicle: {
      year: 2018, make: 'Toyota', model: 'Aqua',
      owner_id: 'PRIVATE-OWNER', current_seller_id: 'PRIVATE-SELLER',
      engine_number: 'PRIVATE-ENGINE', chassis_number: 'PRIVATE-CHASSIS', plate_number: 'PRIVATE-PLATE',
      trust_score: 84,
    },
  });
  const blob = `${r.html}\n${r.text}`;
  for (const secret of ['PRIVATE-OWNER', 'PRIVATE-SELLER', 'PRIVATE-ENGINE', 'PRIVATE-CHASSIS', 'PRIVATE-PLATE']) {
    assert.ok(!blob.includes(secret), `${secret} must never render`);
  }
  assert.ok(!/\b84\b/.test(blob), 'the legacy trust_score once published 84 beside a report saying not_evaluated');
});

test('E2 explanations come from canonical known_limitations, verbatim', () => {
  const limitation = 'No live government or partner source is connected for this vehicle yet.';
  const r = renderTrust(trustRecord({ known_limitations: [limitation] }));
  assert.ok(r.text.includes(limitation));
  // Nothing is written about WHY a position is what it is.
  assert.ok(!/because the vehicle|due to poor|this is low because/i.test(r.text));
});

test('E3 a missing vehicle fact is a stated gap, never backfilled', () => {
  const r = renderTrust(trustRecord(), { vehicle: { make: 'Toyota' } });
  assert.ok(r.text.includes('Year: Not recorded'));
  assert.ok(r.text.includes('Mileage: Not recorded'));
});

test('E4 R5 is service, links a REAL owner route, and carries no unsubscribe or conversation token', () => {
  const entry = referenceEntry('vehicle_trust_update');
  assert.equal(entry.reference, 'R5');
  assert.equal(entry.classification, 'service');
  assert.equal(entry.recipientRole, 'vehicle_owner');
  assert.equal(entry.transport, 'resend');

  const r = renderTrust(trustRecord());
  assert.equal(r.classification, 'service');
  assert.equal(r.cta_route, `/dashboard/garage/${VIN}`, 'the owner vehicle profile, which exists');
  assert.ok(!r.html.includes('data-carup-unsubscribe'));
  assert.ok(!/unsubscribe/i.test(r.text));
  assert.equal(r.reply_to, undefined);
  assert.ok(!/vercel\.app|carup\.app/.test(`${r.html}${r.text}`));
});
