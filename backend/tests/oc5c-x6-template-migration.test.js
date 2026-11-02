/**
 * OC-5C — the X6 template registrations, proven on real PostgreSQL (PGlite).
 *
 * `20261004172000_o2_x6_semantic_event_templates.sql` registers the governed templates the three
 * semantic People events render. #208 emitted these events and never registered them: wherever the
 * registry is applied, an unregistered key fails closed (template_not_registered), so the person would
 * never have been told. This file is the migration's own proof — the real Communications 2.0 registry
 * DDL, then Up, a re-run (idempotent), Down (removes only what this migration wrote), and Up again —
 * plus fallback parity: the in-code copy IS the registered copy, and every required variable is one
 * the emitter feeds.
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

const MIGRATIONS = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const read = (file) => readFileSync(`${MIGRATIONS}${file}`, 'utf8');
const FILE = '20261004172000_o2_x6_semantic_event_templates.sql';
const [UP, DOWN] = read(FILE).split(/^-- \+migrate Down/m);

/** event type → its template key and a payload exactly as its emitter builds it. */
const X6 = {
  'identity.lifecycle.changed': { key: 'identity_lifecycle_v1', required: ['status', 'summary'],
    payload: { userId: 'u1', recipientUserId: 'u1', status: 'on hold', summary: 'For your security, CarUp is reviewing this account.', whoMustAct: 'none' } },
  'dealer.compliance.evidence_required': { key: 'dealer_evidence_required_v1', required: ['summary'],
    payload: { dealerId: 'dp-1', recipientUserId: 'd1', missingRequirements: [{ code: 'tax_document', label: 'tax document' }], summary: 'tax document', whoMustAct: 'subject_action' } },
  'seller.authority.superseded': { key: 'seller_authority_superseded_v1', required: ['listing_id'],
    payload: { vin: 'JT123456789012345', recipientUserId: 's1', status: 'revoked', whoMustAct: 'none' } },
};
const KEYS = Object.values(X6).map((x) => x.key);

/** The two registry tables and their unique index, verbatim from Communications 2.0's own migration. */
function registryDdl() {
  const sql = read('20260811131500_communications_2_conversation_core.sql');
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

const state = async (db) => {
  const t = await db.query(`SELECT template_key, status, classification, metadata->>'source' AS source FROM communication_templates
    WHERE template_key = ANY($1) ORDER BY template_key`, [KEYS]);
  const v = await db.query(`SELECT t.template_key, v.version, v.channel, v.language, v.approval_status, v.subject_template, v.body_template, v.required_variables
    FROM communication_template_versions v JOIN communication_templates t ON t.id = v.template_id
    WHERE t.template_key = ANY($1) ORDER BY t.template_key`, [KEYS]);
  return { templates: t.rows, versions: v.rows };
};

test('Up registers each X6 template once: active, transactional, one approved default/en version', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const s = await state(db);
    assert.deepEqual(s.templates.map((t) => t.template_key), [...KEYS].sort());
    for (const t of s.templates) {
      assert.deepEqual([t.status, t.classification, t.source], ['active', 'transactional', 'o2_x6'], t.template_key);
    }
    assert.equal(s.versions.length, 3);
    for (const v of s.versions) {
      assert.deepEqual([v.version, v.channel, v.language, v.approval_status], [1, 'default', 'en', 'approved'], `${v.template_key}: an unapproved version fails closed at render`);
      assert.doesNotMatch(v.body_template, /\{\{\s*(reason|note|reason_code|reasonCode|next_state|newState)\s*\}\}/, `${v.template_key}: no free text or internal state in governed copy`);
      assert.doesNotMatch(`${v.subject_template} ${v.body_template}`, /compromised|takeover/i, `${v.template_key}: never the internal security hypothesis`);
    }
  } finally { await db.close(); }
});

test('the in-code copy IS the registered copy, and every required variable is one the emitter feeds (non-empty)', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const { versions } = await state(db);
    const inCode = new CommunicationTemplateService();
    const notifications = new CommunicationNotificationService({});
    for (const [eventType, spec] of Object.entries(X6)) {
      assert.equal(NOTIFICATION_POLICIES[eventType].templateKey, spec.key, `${eventType} renders ${spec.key}`);
      const registered = versions.find((v) => v.template_key === spec.key);
      assert.deepEqual(registered.required_variables, spec.required);
      const variables = notifications.variablesForEvent(eventType, spec.payload);
      for (const name of registered.required_variables) {
        assert.ok(String(variables[name] ?? '').trim(), `${eventType}: required variable '${name}' is fed by the emitter's payload`);
      }
      const fallback = inCode.render(spec.key, variables);
      const governed = registered.body_template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(variables[name] ?? ''));
      assert.equal(fallback.body, governed, `${spec.key}: fallback parity`);
      assert.equal(fallback.subject, registered.subject_template);
    }
  } finally { await db.close(); }
});

test('Up is idempotent — a re-run changes nothing', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    await db.exec(UP);
    const s = await state(db);
    assert.equal(s.templates.length, 3);
    assert.equal(s.versions.length, 3);
  } finally { await db.close(); }
});

test('Down removes exactly what Up wrote, and Up restores it', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    await db.exec(DOWN);
    const gone = await state(db);
    assert.equal(gone.templates.length, 0);
    assert.equal(gone.versions.length, 0);
    await db.exec(UP);
    const back = await state(db);
    assert.equal(back.templates.length, 3);
    assert.equal(back.versions.length, 3);
  } finally { await db.close(); }
});

test('Down never deletes a same-named template another lane registered', async () => {
  const db = await registry();
  try {
    await db.exec(`INSERT INTO communication_templates (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
      VALUES ('identity_lifecycle_v1', 'identity_lifecycle', 'account_holder', 'transactional', 'compliance', 'active', '{"source":"another_lane"}'::jsonb)`);
    await db.exec(UP);
    const during = await state(db);
    assert.equal(during.templates.find((t) => t.template_key === 'identity_lifecycle_v1').source, 'another_lane', 'Up does not overwrite an existing registration');
    await db.exec(DOWN);
    const after = await state(db);
    assert.deepEqual(after.templates.map((t) => [t.template_key, t.source]), [['identity_lifecycle_v1', 'another_lane']], 'only the other lane\'s template survives Down');
  } finally { await db.close(); }
});
