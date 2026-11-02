/**
 * OC-5G — the six policy templates, registered and proven on real PostgreSQL (PGlite).
 *
 * `20261004210000_oc5g_policy_notification_templates.sql` registers the six keys live notification
 * policies bound and no migration ever inserted (they were the coverage gate's KNOWN_UNREGISTERED).
 * Wherever the governed registry is applied, an unregistered key fails closed, the outbox retries,
 * and the event dead-letters: identity decisions, listing moderation, evidence reviews, seller
 * authority, Vehicle Passport trust and every SafeTrade stage reached nobody.
 *
 * Proven here, on the real Communications 2.0 registry DDL:
 *   · Up registers each key once, approved, on the channel its policy allows (in_app for the capped
 *     in-app-only policies, default for the two that route by preference), classified as its policy;
 *   · every required variable is fed by the REAL emitter for all fifteen bound event types — and is
 *     never a placeholder default ('listing', 'CarUp', 'updated' …), which the runtime cannot catch;
 *   · the in-code mirror IS the registered copy (fallback parity);
 *   · the governed renderer serves each key on its policy's channels, and an in-app-only key refuses
 *     email (an off-policy route fails closed);
 *   · the copy keeps R4/R5's rules: no payment, stage or score claim; never the moderator's free text;
 *   · Up is idempotent, Down removes only what Up wrote, a prior registration by another lane governs,
 *     and it coexists with every other template-only migration;
 *   · end to end through the LIVE services: each event becomes a governed notification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { NOTIFICATION_POLICIES, CommunicationNotificationService } = await import('../services/communication/communicationNotificationService.js');
const { CommunicationTemplateService } = await import('../services/communication/communicationTemplateService.js');
const { CommunicationGovernedTemplateService } = await import('../services/communication/communicationGovernedTemplateService.js');
const { MemoryCommunicationRepository } = await import('../services/communication/communicationRepository.js');
const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js');
const { normalizeSafeTradeDomainEvent } = await import('../services/communication/adapters/safeTradeDomainEventAdapter.js');
const { SELLER_AUTHORITY_STATUSES, toPublicSellerAuthorityStatement } = await import('../services/seller/sellerAuthorityService.js');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8');
const MIGRATIONS = 'database/migrations/';
const FILE = '20261004210000_oc5g_policy_notification_templates.sql';
const [UP, DOWN] = read(`${MIGRATIONS}${FILE}`).split(/^-- \+migrate Down/m);

const KEYS = ['evidence_review_v1', 'listing_moderation_v1', 'safetrade_transaction_v1',
  'seller_authority_v1', 'vehicle_trust_update_v1', 'verification_decision_v1'];
const REQUIRED = {
  verification_decision_v1: ['reference', 'decision'],
  listing_moderation_v1: ['listing_id', 'decision', 'status'],
  evidence_review_v1: ['reference', 'listing_id', 'decision'],
  seller_authority_v1: ['listing_id', 'decision'],
  vehicle_trust_update_v1: ['listing_id'],
  safetrade_transaction_v1: ['listing_id'],
};
/** variablesForEvent's fallbacks: present and non-empty, so the runtime's required check passes them. */
const PLACEHOLDERS = new Set(['listing', 'CarUp', 'updated', 'escrow', 'application', 'support']);
const VIN = 'OC5GVIN0000000001';
const TXN = 'e2f0a6d1-0000-4000-8000-0000000000c5';

/** Policies bound to each key; a key is in-app-only when EVERY binding is capped to in_app. */
const BINDINGS = Object.fromEntries(KEYS.map((key) => [key,
  Object.entries(NOTIFICATION_POLICIES).filter(([, policy]) => policy.templateKey === key)]));
const inAppOnly = (key) => BINDINGS[key].every(([, p]) => p.policyChannelsOnly && p.channels.join() === 'in_app');

// ── The real emitters ─────────────────────────────────────────────────────────────────────────────

/** Each non-SafeTrade bound event: its emitter, a pin that fails when the emitter stops building the
 *  payload this way, and payloads exactly as it builds them. */
const EMITTERS = {
  'identity.verification.decided': {
    file: 'backend/services/identity/decisionRecorder.js',
    pin: /'identity\.verification\.decided', \{\s*sessionId: session\.id,\s*userId: session\.user_id,\s*recipientUserId: session\.user_id,\s*decision: action,/,
    payloads: ['approve', 'request_resubmission', 'reject'].map((decision) =>
      ({ sessionId: 'sess-oc5g-1', userId: 'u-1', recipientUserId: 'u-1', decision, reasonCodes: [] })),
  },
  'marketplace.listing.moderated': {
    file: 'backend/services/marketplace/marketplaceModerationService.js',
    pin: /'marketplace\.listing\.moderated', \{\s*vin,\s*action,\s*previousStatus,\s*status: nextStatus,\s*reason: body\.reason \|\| null,\s*recipientUserId: vehicle\.owner_id \|\| null,\s*listingId: vin,/,
    payloads: [['approve', 'Available'], ['reject', 'Banned'], ['suppress', 'Suspended'], ['flag_risk', 'Flagged'],
      ['clear_risk', 'Available'], ['request_evidence', 'Pending']].map(([action, status]) => ({
      vin: VIN, action, previousStatus: 'Pending', status, reason: 'MODERATOR PRIVATE NOTE', recipientUserId: 'owner-1', listingId: VIN })),
  },
  'evidence.review.decided': {
    file: 'backend/services/evidence/evidenceReviewNotifier.js',
    pin: /'evidence\.review\.decided', \{\s*vin: vin \|\| null,\s*evidenceId: evidenceId \|\| null,\s*decision,\s*recipientUserId,\s*listingId: vin \|\| null,/,
    payloads: ['verified', 'rejected'].map((decision) =>
      ({ vin: VIN, evidenceId: 'evidence-oc5g-1', decision, recipientUserId: 'owner-1', listingId: VIN })),
  },
  'seller.authority.decided': {
    file: 'backend/routes/vehiclesRoutes.js',
    pin: /'seller\.authority\.decided', \{\s*vin,\s*recipientUserId: sellerUserId,\s*decision: result\.public_statement,\s*listingId: vin,/,
    // Every decision a reviewer may record (all statuses but the claimant's own `evidence_submitted`).
    payloads: SELLER_AUTHORITY_STATUSES.filter((status) => status !== 'evidence_submitted').map((status) =>
      ({ vin: VIN, recipientUserId: 'seller-1', decision: toPublicSellerAuthorityStatement({ status }), listingId: VIN })),
  },
  'vehicle.trust.presentation_changed': {
    file: 'backend/services/trustDecision/trustPresentationChangeProducer.js',
    pin: /'vehicle\.trust\.presentation_changed', \{[\s\S]{0,400}?\n\s*vin,\n\s*recipientUserId,/,
    payloads: [{ vin: VIN, recipientUserId: 'owner-1', contract_version: 'trust_presentation@1', presentation_fingerprint: 'fp-1',
      changed_fields: ['evaluation_state'], previous_trust: null, trust: { evaluation_state: 'evaluated', band: 'high', score: 82 } }],
  },
};

/** SafeTrade's payload keys, read out of its two SQL emitters by balanced parentheses (the same
 *  method as email-reference-r4-safetrade-real-emitter.test.js, which explains why it must be). */
function emittedPayloadKeys(file) {
  const src = read(`${MIGRATIONS}${file}`);
  const insert = src.slice(src.indexOf('INSERT INTO public.domain_events'));
  const open = insert.indexOf('jsonb_build_object(') + 'jsonb_build_object('.length;
  let depth = 1;
  let i = open;
  for (; i < insert.length && depth > 0; i += 1) {
    if (insert[i] === '(') depth += 1;
    else if (insert[i] === ')') depth -= 1;
  }
  const keys = [];
  let level = 0;
  let expectKey = true;
  for (const token of insert.slice(open, i - 1).match(/'[^']*'|[(),]|[^,()]+/g) || []) {
    if (token === '(') { level += 1; continue; }
    if (token === ')') { level -= 1; continue; }
    if (token === ',') { if (level === 0) expectKey = !expectKey; continue; }
    if (level === 0 && expectKey && /^'[A-Za-z_]+'$/.test(token.trim())) keys.push(token.trim().slice(1, -1));
  }
  return keys;
}
const TRANSITION_KEYS = emittedPayloadKeys('20260819121000_issue164_phase6_atomic_session_actions.sql');
const PAYMENT_KEYS = emittedPayloadKeys('20260819126000_issue164_phase6_payment_operation_hardening.sql');
const exactly = (keys, values) => Object.fromEntries(keys.map((key) => {
  assert.ok(key in values, `fixture lacks the real emitter key "${key}"`);
  return [key, values[key]];
}));
const SAFETRADE = [
  ...[['MARKETPLACE_PAYMENT_INITIATED', 'initiated'], ['MARKETPLACE_INSPECTION_PENDING', 'inspection_pending'],
    ['MARKETPLACE_RELEASE_APPROVED', 'release_approved'], ['MARKETPLACE_TRANSACTION_DISPUTED', 'disputed'],
    ['MARKETPLACE_TRANSACTION_CANCELLED', 'cancelled'], ['MARKETPLACE_TRANSACTION_FAILED', 'failed']]
    .map(([eventType, toStatus]) => [eventType, exactly(TRANSITION_KEYS, { transactionIntentId: TXN, vin: VIN, fromStatus: 'eligible', toStatus })]),
  ...[['MARKETPLACE_FUNDS_HELD', 'captured'], ['MARKETPLACE_TRANSACTION_SETTLED', 'released'],
    ['MARKETPLACE_TRANSACTION_REFUNDED', 'refunded'], ['MARKETPLACE_PAYMENT_FAILED', 'failed']]
    .map(([eventType, paymentState]) => [eventType, exactly(PAYMENT_KEYS, { transactionIntentId: TXN, vin: VIN, paymentState,
      provider: 'sandbox', settlementOperationKey: paymentState === 'released' ? 'SOK-OC5G' : null })]),
];
const sessionRepository = { findOne: async (table, filters) => (table === 'escrow_trust_sessions' && filters.id === TXN
  ? { id: TXN, vin: VIN, status: 'initiated', tenant_id: null, buyer_id: 'buyer-1', seller_id: 'seller-1' } : null) };

/** Every bound event type with the payloads its emitter produces (SafeTrade: after normalization). */
async function emittedEvents() {
  const events = [];
  for (const [eventType, emitter] of Object.entries(EMITTERS)) {
    for (const payload of emitter.payloads) events.push({ eventType, payload });
  }
  for (const [eventType, payload] of SAFETRADE) {
    const normalized = await normalizeSafeTradeDomainEvent({ eventType, payload, repository: sessionRepository });
    assert.ok(normalized?.events?.length, `${eventType}: the SafeTrade adapter refused a real-shaped payload (${normalized?.refused})`);
    for (const one of normalized.events) events.push({ eventType, payload: one.payload ?? one });
  }
  return events;
}

// ── The registry ──────────────────────────────────────────────────────────────────────────────────

/** The two registry tables and their unique index, verbatim from Communications 2.0's own migration. */
function registryDdl() {
  const sql = read(`${MIGRATIONS}20260811131500_communications_2_conversation_core.sql`);
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS communication_templates (');
  const end = sql.indexOf(';', sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_communication_template_version_unique')) + 1;
  assert.ok(start > 0 && end > start, 'the registry DDL must stay locatable in its migration');
  return sql.slice(start, end);
}
async function registry() {
  const db = new PGlite();
  await db.exec(registryDdl());
  return db;
}
const state = async (db, keys = KEYS) => {
  const t = await db.query(`SELECT id, template_key, status, classification, owner_team, metadata FROM communication_templates
    WHERE template_key = ANY($1) ORDER BY template_key`, [keys]);
  const v = await db.query(`SELECT v.id, v.template_id, t.template_key, v.version, v.channel, v.language, v.approval_status, v.subject_template,
      v.body_template, v.required_variables, v.optional_variables, v.experiment_metadata
    FROM communication_template_versions v JOIN communication_templates t ON t.id = v.template_id
    WHERE t.template_key = ANY($1) ORDER BY t.template_key, v.channel`, [keys]);
  return { templates: t.rows, versions: v.rows };
};
const substitute = (text, variables) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(variables[name] ?? ''));
/** The registry rows, as a MemoryCommunicationRepository seed. */
const seedFrom = ({ templates, versions }) => ({
  communication_templates: templates.map((t) => ({ ...t })),
  communication_template_versions: versions.map((v) => ({ ...v, provider_template_reference: null })),
});

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────

test('every bound event\'s emitter still builds the payload this file asserts against', () => {
  for (const [eventType, emitter] of Object.entries(EMITTERS)) {
    assert.match(read(emitter.file), emitter.pin, `${eventType}: ${emitter.file} no longer emits the payload pinned here`);
  }
  assert.deepEqual(TRANSITION_KEYS, ['transactionIntentId', 'vin', 'fromStatus', 'toStatus']);
  assert.deepEqual(PAYMENT_KEYS, ['transactionIntentId', 'vin', 'paymentState', 'provider', 'settlementOperationKey']);
  const bound = Object.entries(NOTIFICATION_POLICIES).filter(([, policy]) => KEYS.includes(policy.templateKey)).map(([type]) => type).sort();
  assert.deepEqual(bound, [...Object.keys(EMITTERS), ...SAFETRADE.map(([type]) => type)].sort(), 'all fifteen bound event types are covered, no more');
});

test('Up registers each key once — active, its policy\'s classification, one approved version on the channel its policy allows', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const { templates, versions } = await state(db);
    assert.deepEqual(templates.map((t) => t.template_key), KEYS);
    for (const t of templates) {
      const classifications = new Set(BINDINGS[t.template_key].map(([, p]) => p.classification));
      assert.deepEqual([...classifications], [t.classification], `${t.template_key}: classified as its policies are`);
      assert.equal(t.status, 'active');
      assert.equal(t.metadata.source, 'oc5g_policy_templates');
      const own = versions.filter((v) => v.template_id === t.id);
      assert.equal(own.length, 1, `${t.template_key}: exactly one version`);
      const [v] = own;
      assert.deepEqual([v.version, v.language, v.approval_status], [1, 'en', 'approved'], `${t.template_key}: an unapproved version fails closed at render`);
      assert.equal(v.channel, inAppOnly(t.template_key) ? 'in_app' : 'default', `${t.template_key}: the registry approves what the policy allows`);
      assert.deepEqual(v.required_variables, REQUIRED[t.template_key]);
      assert.deepEqual(v.optional_variables, []);
      const text = `${v.subject_template} ${v.body_template}`;
      assert.deepEqual([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort(), [...REQUIRED[t.template_key]].sort(),
        `${t.template_key}: renders exactly its required variables — never reason, summary, topic or escrow_id`);
    }
    assert.equal(templates.find((t) => t.template_key === 'vehicle_trust_update_v1').classification, 'service');
  } finally { await db.close(); }
});

test('every required variable is fed by the real emitter, for all fifteen events — and is never a placeholder default', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const { versions } = await state(db);
    const notifications = new CommunicationNotificationService({});
    for (const { eventType, payload } of await emittedEvents()) {
      const key = NOTIFICATION_POLICIES[eventType].templateKey;
      const variables = notifications.variablesForEvent(eventType, payload);
      for (const name of versions.find((v) => v.template_key === key).required_variables) {
        const value = String(variables[name] ?? '').trim();
        assert.ok(value, `${eventType}: required '${name}' is empty`);
        assert.ok(!PLACEHOLDERS.has(value), `${eventType}: required '${name}' fell back to the placeholder '${value}'`);
      }
      if (variables.listing_id !== undefined && REQUIRED[key].includes('listing_id')) assert.equal(variables.listing_id, VIN, `${eventType}: the vehicle`);
    }
  } finally { await db.close(); }
});

test('the in-code mirror IS the registered copy (fallback parity), for every event the emitters produce', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const { versions } = await state(db);
    const inCode = new CommunicationTemplateService();
    const notifications = new CommunicationNotificationService({});
    for (const { eventType, payload } of await emittedEvents()) {
      const key = NOTIFICATION_POLICIES[eventType].templateKey;
      assert.ok(inCode.listTemplates().includes(key), `${key} has an in-code mirror (no acknowledgement fallback)`);
      const variables = notifications.variablesForEvent(eventType, payload);
      const registered = versions.find((v) => v.template_key === key);
      const fallback = inCode.render(key, variables);
      assert.equal(fallback.subject, registered.subject_template, `${key}: subject parity`);
      assert.equal(fallback.body, substitute(registered.body_template, variables), `${key}: body parity`);
    }
  } finally { await db.close(); }
});

test('the governed renderer serves each key on its policy\'s channels, and an in-app-only key refuses email', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const service = new CommunicationGovernedTemplateService({ repository: new MemoryCommunicationRepository(seedFrom(await state(db))) });
    const notifications = new CommunicationNotificationService({});
    for (const { eventType, payload } of await emittedEvents()) {
      const policy = NOTIFICATION_POLICIES[eventType];
      const variables = notifications.variablesForEvent(eventType, payload);
      for (const channel of policy.channels) {
        const rendered = await service.render(policy.templateKey, variables, { channel, language: 'en' });
        assert.equal(rendered.governed, true, `${eventType} on ${channel}`);
        assert.doesNotMatch(rendered.body, /\{\{|\}\}/, `${eventType} on ${channel}: nothing left unrendered`);
      }
      if (inAppOnly(policy.templateKey)) {
        await assert.rejects(() => service.render(policy.templateKey, variables, { channel: 'email', language: 'en' }),
          (error) => error?.code === 'template_not_approved', `${eventType}: an off-policy route fails closed`);
      }
    }
  } finally { await db.close(); }
});

test('the copy keeps R4/R5\'s rules — no payment, stage or score claim; never the moderator\'s free text', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const { versions } = await state(db);
    const copy = (key) => { const v = versions.find((x) => x.template_key === key); return `${v.subject_template} ${v.body_template}`; };
    // R4's forbidden-claim list (email-reference-r4-safetrade-transaction.test.js A3), plus amounts.
    for (const claim of [/payment (was |has been )?(received|completed)/i, /funds (were |have been )?(received|released|held)/i,
      /money (was|has been) (sent|received|released)/i, /paid in full/i, /refund (was )?completed/i, /\d/, /usd|\$|card|iban/i]) {
      assert.doesNotMatch(copy('safetrade_transaction_v1'), claim);
    }
    assert.match(copy('safetrade_transaction_v1'), /Always confirm payment details on CarUp itself/);
    // R5: no number, band or score; four states are four facts, and none is asserted here.
    assert.doesNotMatch(copy('vehicle_trust_update_v1'), /\d|score|band|\/100|trusted|verified/i);
    const notifications = new CommunicationNotificationService({});
    for (const payload of EMITTERS['marketplace.listing.moderated'].payloads) {
      const rendered = substitute(versions.find((v) => v.template_key === 'listing_moderation_v1').body_template,
        notifications.variablesForEvent('marketplace.listing.moderated', payload));
      assert.doesNotMatch(rendered, /MODERATOR PRIVATE NOTE/);
    }
    // Every seller-authority statement reads true — "was reviewed" contradicted `under_review`.
    for (const payload of EMITTERS['seller.authority.decided'].payloads) {
      const rendered = substitute(versions.find((v) => v.template_key === 'seller_authority_v1').body_template,
        notifications.variablesForEvent('seller.authority.decided', payload));
      assert.doesNotMatch(rendered, /was reviewed by CarUp: Seller authority under/);
      assert.match(rendered, new RegExp(`^CarUp updated the seller authority for vehicle ${VIN}: `));
    }
  } finally { await db.close(); }
});

test('Up is idempotent; Down removes exactly what Up wrote; Up restores it', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    await db.exec(UP);
    let s = await state(db);
    assert.equal(s.templates.length, 6);
    assert.equal(s.versions.length, 6);
    await db.exec(DOWN);
    s = await state(db);
    assert.deepEqual([s.templates.length, s.versions.length], [0, 0]);
    await db.exec(UP);
    s = await state(db);
    assert.deepEqual([s.templates.length, s.versions.length], [6, 6]);
  } finally { await db.close(); }
});

test('a prior registration by another lane governs: Up adds nothing beside it, and Down leaves it whole', async () => {
  const db = await registry();
  try {
    await db.exec(`INSERT INTO communication_templates (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
      VALUES ('safetrade_transaction_v1', 'safetrade', 'transaction_party', 'transactional', 'safetrade', 'active', '{"source":"another_lane"}'::jsonb)`);
    await db.exec(`INSERT INTO communication_template_versions (template_id, version, channel, language, subject_template, body_template, required_variables, approval_status, experiment_metadata)
      SELECT id, 1, 'email', 'en', 'Lane subject', 'Lane body {{listing_id}}', '["listing_id"]'::jsonb, 'approved', '{"source":"another_lane"}'::jsonb
      FROM communication_templates WHERE template_key = 'safetrade_transaction_v1'`);
    await db.exec(UP);
    const during = await state(db, ['safetrade_transaction_v1']);
    assert.equal(during.templates[0].metadata.source, 'another_lane');
    assert.deepEqual(during.versions.map((v) => [v.channel, v.experiment_metadata.source]), [['email', 'another_lane']],
      'no OC-5G version is attached to a template another lane registered');
    await db.exec(DOWN);
    const after = await state(db, ['safetrade_transaction_v1']);
    assert.deepEqual([after.templates.length, after.versions.length], [1, 1]);
    assert.equal((await state(db)).templates.length, 1, 'the other five were removed; the lane\'s stays');
  } finally { await db.close(); }
});

test('coexists with every other template-only migration: no shared key, every row lands', async () => {
  const OTHERS = ['20260811132000_communications_2_template_runtime_registry.sql', '20260828220000_passport_ownership_transfer_communications.sql',
    '20260905160000_trade_os_sourcing_logistics_governed_templates.sql', '20261004150000_o2_dealer_compliance_decision_template.sql',
    '20261004172000_o2_x6_semantic_event_templates.sql', '20261004180800_service_network_case_status_template.sql'];
  const db = await registry();
  try {
    for (const file of OTHERS) await db.exec(read(`${MIGRATIONS}${file}`).split(/^-- \+migrate Down/m)[0]);
    const before = (await db.query('SELECT template_key FROM communication_templates')).rows.map((r) => r.template_key);
    assert.deepEqual(before.filter((key) => KEYS.includes(key)), [], 'no earlier migration registers an OC-5G key');
    await db.exec(UP);
    const { templates, versions } = await state(db);
    assert.deepEqual([templates.length, versions.length], [6, 6]);
    const total = (await db.query('SELECT count(*)::int AS n FROM communication_templates')).rows[0].n;
    assert.equal(total, before.length + 6);
  } finally { await db.close(); }
});

test('end to end through the LIVE services: each event becomes a governed notification with this copy', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const rows = await state(db);
    const notifications = new CommunicationNotificationService({});
    let n = 0;
    for (const { eventType, payload } of await emittedEvents()) {
      const repository = new MemoryCommunicationRepository(seedFrom(rows));
      const { notificationService } = createCommunicationServices({ repository });
      n += 1;
      const queued = await notificationService.queueFromDomainEvent({ id: `evt-oc5g-${n}`, event_type: eventType, payload });
      assert.equal(queued.length, 1, `${eventType}: one governed notification`);
      const [message] = repository.rows('messages');
      const registered = rows.versions.find((v) => v.template_key === NOTIFICATION_POLICIES[eventType].templateKey);
      assert.equal(message.content_text, substitute(registered.body_template, notifications.variablesForEvent(eventType, payload)), eventType);
      assert.equal(message.content_json.template_key, registered.template_key);
    }
    assert.ok(n >= 20, `every emitted payload was driven (${n})`);
  } finally { await db.close(); }
});
