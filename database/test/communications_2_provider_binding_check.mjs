/**
 * Validate the Meta provider-template binding migration against real PostgreSQL
 * (PGlite, disposable, in-process). Nothing here touches staging or production.
 *
 * The repo's migration_pglite_check.mjs applies a FIXED list of M1–M6 migrations, so it never
 * exercises this file — dropping the draft into database/migrations/ and seeing exit 0 proves
 * nothing. This applies the real Communications chain and then the binding, and checks the
 * things that could actually be wrong: does it bind the right rows, is it idempotent, and does
 * Down undo exactly what Up did and nothing else.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRAFT = path.join(ROOT, 'database', 'migrations', '20260813060000_communications_2_meta_provider_template_binding.sql');

const read = (p) => readFileSync(p, 'utf8');
const up = (sql) => sql.split('-- +migrate Down')[0];
const down = (sql) => (sql.includes('-- +migrate Down') ? sql.split('-- +migrate Down')[1] : '');

const CHAIN = [
  '20260623143000_omnichannel_communication_engine.sql',
  '20260811131500_communications_2_conversation_core.sql',
  '20260811131600_communications_2_delivery_monotonicity.sql',
  '20260811131700_communications_2_workflow_template_foundations.sql',
  '20260811131800_communications_2_participant_auth_hardening.sql',
  '20260811131900_communications_2_privacy_binding_hardening.sql',
  '20260811132000_communications_2_template_runtime_registry.sql',
  '20260811132100_communications_2_reliability_closure.sql',
  '20260811132200_communications_2_product_capabilities.sql',
  '20260811132300_communications_2_completion.sql',
];

// PGlite (PG17) has gen_random_uuid() in core and no pgcrypto — the same accommodation the repo's
// own migration_pglite_check.mjs makes. It is an emulator limitation, not a migration defect.
const forPglite = (sql) => sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto\s*;/gi, '');

const db = new PGlite();
await db.exec(forPglite(read(`${ROOT}/backend/tests/integration/support/bootstrap.sql`)));
for (const f of CHAIN) {
  try {
    await db.exec(forPglite(up(read(`${ROOT}/database/migrations/${f}`))));
  } catch (error) {
    console.error(`FAILED applying ${f}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`chain applied: ${CHAIN.length} migrations`);

async function rows(sql) {
  return (await db.query(sql)).rows;
}

const BINDINGS = `
  select t.template_key, t.classification, v.channel, v.language, v.approval_status,
         v.provider_template_reference, v.required_variables,
         v.experiment_metadata ->> 'provider_approval_status' as provider_approval_status,
         v.approved_by
  from communication_templates t
  join communication_template_versions v on v.template_id = t.id
  where t.template_key in ('conversation_reply_whatsapp_v1','carup_reengagement_v1')
  order by t.template_key, v.channel`;

// ── Pre-state: exactly what migrations 315–323 shipped ──
const before = await rows(BINDINGS);
const utilityBefore = before.find((r) => r.template_key === 'conversation_reply_whatsapp_v1' && r.channel === 'whatsapp');
assert.equal(utilityBefore.provider_template_reference, null, 'utility ships unbound');
assert.equal(utilityBefore.provider_approval_status, 'pending_configuration', 'and explicitly marked pending');
assert.equal(before.filter((r) => r.template_key === 'carup_reengagement_v1' && r.channel === 'whatsapp').length, 0,
  'marketing ships with no whatsapp version');
console.log('pre-state matches the frozen migrations');

// ── Up ──
const draft = read(DRAFT);
await db.exec(up(draft));
const after = await rows(BINDINGS);

const utility = after.find((r) => r.template_key === 'conversation_reply_whatsapp_v1' && r.channel === 'whatsapp');
assert.equal(utility.provider_template_reference, 'carup_conversation_reply|en_US');
assert.equal(utility.provider_approval_status, 'approved');
assert.deepEqual(utility.required_variables, ['message'], 'the utility contract stays one BODY parameter');

const marketing = after.find((r) => r.template_key === 'carup_reengagement_v1' && r.channel === 'whatsapp');
assert.ok(marketing, 'marketing whatsapp version created');
assert.equal(marketing.provider_template_reference, 'carup_reengagement_v1|en',
  'Meta registers the marketing template under `en`; |en_US would look right and never deliver');
assert.equal(marketing.classification, 'marketing');
assert.equal(marketing.approval_status, 'approved');
assert.deepEqual(marketing.required_variables, [], 'the campaign path sends no body parameters');

// The two references must never be the same template.
assert.notEqual(utility.provider_template_reference, marketing.provider_template_reference);
// The language tags legitimately differ, and each must match what the provider actually has.
assert.equal(utility.provider_template_reference.split('|')[1], 'en_US');
assert.equal(marketing.provider_template_reference.split('|')[1], 'en');
assert.ok(!after.some((r) => String(r.provider_template_reference || '').startsWith('carup_reengagement_v1|en_US')),
  'no marketing binding may claim an en_US provider template that does not exist');
assert.ok(!after.some((r) => r.classification === 'marketing' && r.provider_template_reference === 'carup_conversation_reply|en_US'),
  'the utility template must never back a marketing version');

// Untouched siblings.
for (const channel of ['in_app', 'email']) {
  const sibling = after.find((r) => r.template_key === 'carup_reengagement_v1' && r.channel === channel);
  assert.equal(sibling.provider_template_reference, null, `${channel} version must stay unbound`);
}
console.log('Up: both references bound to distinct templates, siblings untouched');

// ── Idempotency ──
await db.exec(up(draft));
const twice = await rows(BINDINGS);
assert.deepEqual(twice, after, 're-running Up must change nothing');
console.log('Up is idempotent');

// ── Down ──
await db.exec(down(draft));
const reverted = await rows(BINDINGS);
const utilityBack = reverted.find((r) => r.template_key === 'conversation_reply_whatsapp_v1' && r.channel === 'whatsapp');
assert.equal(utilityBack.provider_template_reference, null, 'Down unbinds the utility reference');
assert.equal(utilityBack.provider_approval_status, 'pending_configuration', 'and restores the pending marker');
assert.equal(reverted.filter((r) => r.template_key === 'carup_reengagement_v1' && r.channel === 'whatsapp').length, 0,
  'Down removes only the row Up inserted');
assert.equal(reverted.length, before.length, 'Down leaves exactly the pre-state row set');
const markerRows = await rows(`select count(*)::int as c from communication_template_versions
  where experiment_metadata ? 'provider_bound_by'`);
assert.equal(markerRows[0].c, 0, 'Down must remove its own provider_bound_by marker');
console.log('Down reverses Up exactly, marker included');

// ── Down must not touch a reference set by anyone else ──
await db.exec(`update communication_template_versions v
  set provider_template_reference = 'someone_else|en_US'
  from communication_templates t
  where v.template_id = t.id and t.template_key = 'conversation_reply_whatsapp_v1' and v.channel = 'whatsapp'`);
await db.exec(down(draft));
const foreign = (await rows(BINDINGS)).find((r) => r.template_key === 'conversation_reply_whatsapp_v1' && r.channel === 'whatsapp');
assert.equal(foreign.provider_template_reference, 'someone_else|en_US',
  'Down must only unbind what this migration bound');
console.log('Down leaves a foreign binding alone');

console.log('\nBINDING MIGRATION VALIDATED against real PostgreSQL (PGlite).');
await db.close();
