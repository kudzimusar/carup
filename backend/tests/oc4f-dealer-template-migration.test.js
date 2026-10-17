/**
 * OC-4F — RC1's one new migration, proven on real PostgreSQL (PGlite).
 *
 * `20261004150000_o2_dealer_compliance_decision_template.sql` (OC-4D) registers the governed
 * template the dealer decision event renders. CI's migration check applies a fixed historical set,
 * so this file is the migration's own proof: the real Communications 2.0 table DDL, then Up, a
 * re-run (idempotent), Down (removes only what this migration wrote), and Up again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const read = (file) => readFileSync(`${MIGRATIONS}${file}`, 'utf8');
const FILE = '20261004150000_o2_dealer_compliance_decision_template.sql';
const [UP, DOWN] = read(FILE).split(/^-- \+migrate Down/m);

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
  const t = await db.query(`SELECT template_key, status, classification, metadata->>'source' AS source FROM communication_templates WHERE template_key = 'dealer_compliance_decision_v1'`);
  const v = await db.query(`SELECT v.version, v.channel, v.language, v.approval_status, v.body_template, v.required_variables
    FROM communication_template_versions v JOIN communication_templates t ON t.id = v.template_id
    WHERE t.template_key = 'dealer_compliance_decision_v1'`);
  return { templates: t.rows, versions: v.rows };
};

test('Up registers one active transactional template with one approved default/en version', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    const s = await state(db);
    assert.equal(s.templates.length, 1);
    assert.deepEqual({ ...s.templates[0] }, { template_key: 'dealer_compliance_decision_v1', status: 'active', classification: 'transactional', source: 'o2_p5' });
    assert.equal(s.versions.length, 1);
    const v = s.versions[0];
    assert.equal(v.approval_status, 'approved', 'an unapproved version fails closed at render');
    assert.equal(v.channel, 'default');
    assert.equal(v.language, 'en');
    assert.deepEqual(v.required_variables, ['decision']);
    assert.equal(v.body_template, 'Your dealer application received a CarUp decision: {{decision}}.');
    assert.doesNotMatch(v.body_template, /\{\{\s*reason\s*\}\}/, 'no reviewer free text in governed copy');
  } finally { await db.close(); }
});

test('Up is idempotent — a re-run changes nothing', async () => {
  const db = await registry();
  try {
    await db.exec(UP);
    await db.exec(UP);
    const s = await state(db);
    assert.equal(s.templates.length, 1);
    assert.equal(s.versions.length, 1);
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
    assert.equal(back.templates.length, 1);
    assert.equal(back.versions.length, 1);
  } finally { await db.close(); }
});

test('Down never deletes a same-named template another lane registered', async () => {
  const db = await registry();
  try {
    await db.exec(`INSERT INTO communication_templates (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
      VALUES ('dealer_compliance_decision_v1', 'dealer_compliance', 'dealer', 'transactional', 'compliance', 'active', '{"source":"another_lane"}'::jsonb)`);
    await db.exec(UP);
    const during = await state(db);
    assert.equal(during.templates[0].source, 'another_lane', 'Up does not overwrite an existing registration');
    await db.exec(DOWN);
    const after = await state(db);
    assert.equal(after.templates.length, 1, 'the other lane\'s template survives Down');
    assert.equal(after.templates[0].source, 'another_lane');
  } finally { await db.close(); }
});
