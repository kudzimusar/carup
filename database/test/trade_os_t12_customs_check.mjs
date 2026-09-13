/**
 * Trade OS T12 — the customs schema, on a REAL Postgres (PGlite).
 *
 * The unit suite proves the SERVICE refuses things. This proves the DATABASE does — which matters
 * because the whole point of T12 is that a claim on an authority's name must be impossible to make,
 * not merely impolite. A rule that lives only in a service is a rule that a second writer, a
 * migration script or a console session walks straight past.
 *
 * Four families are exercised here and nowhere else:
 *
 *   1. the partial unique indexes (the mock can only approximate a predicate);
 *   2. the CHECK constraints that keep a claim honest — an authority claim without its document, an
 *      amount where an amount cannot mean anything, a rate without provenance;
 *   3. the append-only guards, including the correction path still working;
 *   4. that the vocabulary contains no vehicle-registration type.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260917090000_trade_os_t12_customs_destination.sql', import.meta.url), 'utf-8');
const up = sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = sql.split('-- +migrate Down')[1];

const db = new PGlite();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); }
};
const refuses = async (name, stmt, pattern) => check(name, async () => {
  let threw = null;
  try { await db.exec(stmt); } catch (e) { threw = e; }
  if (!threw) throw new Error('the database ACCEPTED what it must refuse');
  if (pattern && !pattern.test(threw.message)) throw new Error(`refused for the wrong reason: ${threw.message.split('\n')[0]}`);
});

const CASE = 'aaaa0000-0000-0000-0000-000000000001';
const CASE2 = 'aaaa0000-0000-0000-0000-000000000002';
const APPT = 'bbbb0000-0000-0000-0000-000000000001';
const EVENT = 'cccc0000-0000-0000-0000-000000000001';
const SUBJECT = 'dddd0000-0000-0000-0000-000000000001';
const DOC = 'eeee0000-0000-0000-0000-000000000001';

// Stand-ins for the tables the migration references. Only the columns the FKs need.
await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE TABLE public.diaspora_shipments (id uuid PRIMARY KEY);
  CREATE TABLE public.diaspora_import_orders (id uuid PRIMARY KEY);
  INSERT INTO public.diaspora_shipments (id) VALUES ('ffff0000-0000-0000-0000-000000000001');
`);

await check('the migration applies', () => db.exec(up));

// ── 1. Partial unique indexes ──────────────────────────────────────────────

await check('a case can be opened', () => db.exec(`
  INSERT INTO public.diaspora_customs_cases (id, subject_type, subject_id, reference, status)
  VALUES ('${CASE}', 'cargo_reservation', '${SUBJECT}', 'CUST-AAAA0000', 'OPEN');
`));

await refuses('a SECOND live case for the same consignment is refused',
  `INSERT INTO public.diaspora_customs_cases (id, subject_type, subject_id, reference, status)
   VALUES ('${CASE2}', 'cargo_reservation', '${SUBJECT}', 'CUST-AAAA0002', 'OPEN');`,
  /uq_customs_case_live_subject|duplicate key/);

await check('POSITIVE CONTROL: once the first is ABANDONED, the slot is free again', async () => {
  // The predicate is the point. A total unique index would strand the consignment forever after one
  // mistaken case, which is worse than the duplicate it prevents.
  await db.exec(`UPDATE public.diaspora_customs_cases SET status = 'ABANDONED' WHERE id = '${CASE}';`);
  await db.exec(`INSERT INTO public.diaspora_customs_cases (id, subject_type, subject_id, reference, status)
                 VALUES ('${CASE2}', 'cargo_reservation', '${SUBJECT}', 'CUST-AAAA0002', 'OPEN');`);
  // Free the slot again before restoring the original, or the restore collides with the stand-in.
  await db.exec(`UPDATE public.diaspora_customs_cases SET status = 'ABANDONED' WHERE id = '${CASE2}';`);
  await db.exec(`UPDATE public.diaspora_customs_cases SET status = 'OPEN' WHERE id = '${CASE}';`);
});

await check('an agent can be appointed', () => db.exec(`
  INSERT INTO public.diaspora_customs_agent_appointments (id, case_id, agent_kind, agent_user_id, agent_display_name, appointed_by, status)
  VALUES ('${APPT}', '${CASE}', 'PERSON', 'user-agent-1', 'Nyati Clearing', 'user-operator', 'ACTIVE');
`));

await refuses('a SECOND active agent on one case is refused',
  `INSERT INTO public.diaspora_customs_agent_appointments (case_id, agent_kind, agent_user_id, agent_display_name, appointed_by, status)
   VALUES ('${CASE}', 'PERSON', 'user-agent-2', 'Second Agent', 'user-operator', 'ACTIVE');`,
  /uq_customs_case_one_active_agent|duplicate key/);

await check('POSITIVE CONTROL: after the first ends, another may be appointed', async () => {
  await db.exec(`UPDATE public.diaspora_customs_agent_appointments SET status = 'ENDED' WHERE id = '${APPT}';`);
  await db.exec(`INSERT INTO public.diaspora_customs_agent_appointments (case_id, agent_kind, agent_user_id, agent_display_name, appointed_by, status)
                 VALUES ('${CASE}', 'PERSON', 'user-agent-2', 'Second Agent', 'user-operator', 'ACTIVE');`);
});

await check('an agent id is TEXT — real user ids in this schema are not uuids', async () => {
  // The defect a governed staging fixture found: `users.id` is TEXT here, so a uuid column made the
  // appointment path unusable against real identities. A uuid-shaped fixture would have hidden it,
  // which is exactly what the in-memory client did.
  const { rows } = await db.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'diaspora_customs_agent_appointments' AND column_name = 'agent_user_id';`);
  if (rows[0]?.data_type !== 'text') throw new Error(`agent_user_id is ${rows[0]?.data_type}, not text`);
});

await refuses('an appointment naming nobody is refused',
  `INSERT INTO public.diaspora_customs_agent_appointments (case_id, agent_kind, agent_display_name, appointed_by)
   VALUES ('${CASE}', 'ORGANISATION', 'Nobody At All', 'user-operator');`,
  /customs_appointment_names_someone/);

// ── 2. The CHECK constraints that keep a claim honest ──────────────────────

const ev = (cols, vals) => `INSERT INTO public.diaspora_customs_events (case_id, ${cols}) VALUES ('${CASE}', ${vals});`;

await refuses('a claim on an AUTHORITY document without the document is refused',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind",
     "'ASSESSMENT_EVIDENCE_RECEIVED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AUTHORITY_DOCUMENT'"),
  /customs_event_authority_claim_needs_evidence/);

await check('POSITIVE CONTROL: the same claim WITH the document is accepted', () => db.exec(
  ev("id, event_type, assertion_class, asserted_by_relationship, source_kind, evidence_document_id, amount_value, amount_currency",
     `'${EVENT}', 'ASSESSMENT_EVIDENCE_RECEIVED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AUTHORITY_DOCUMENT', '${DOC}', 900.00, 'USD'`)));

await refuses('a CarUp observation cannot claim an outside source',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind, evidence_document_id",
     `'DELIVERY_OBSERVED', 'CARUP_OBSERVED', 'CONTAINER_OPERATOR', 'AUTHORITY_DOCUMENT', '${DOC}'`),
  /customs_event_observation_is_carups/);

await refuses('an attributed claim cannot pose as a CarUp observation',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind",
     "'RELEASE_EVIDENCE_RECEIVED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'CARUP_OBSERVATION'"),
  /customs_event_observation_is_carups/);

await refuses('an amount on an event where an amount cannot mean anything is refused',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind, amount_value, amount_currency",
     "'LODGEMENT_REPORTED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AGENT_REPORT', 500.00, 'USD'"),
  /customs_event_amount_placement/);

await refuses('an amount with no currency is refused',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind, evidence_document_id, amount_value",
     `'ASSESSMENT_EVIDENCE_RECEIVED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AUTHORITY_DOCUMENT', '${DOC}', 500.00`),
  /customs_event_amount_placement/);

await refuses('a customs RATE with no source is refused — this is the removed 13.5',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind, evidence_document_id, customs_rate_value, customs_rate_effective_from",
     `'ASSESSMENT_EVIDENCE_RECEIVED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AUTHORITY_DOCUMENT', '${DOC}', 13.5, '2026-09-07'`),
  /customs_event_rate_has_provenance/);

await refuses('a customs RATE with no effective date is refused',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind, evidence_document_id, customs_rate_value, customs_rate_source",
     `'ASSESSMENT_EVIDENCE_RECEIVED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AUTHORITY_DOCUMENT', '${DOC}', 13.5, 'somebody said so'`),
  /customs_event_rate_has_provenance/);

await check('POSITIVE CONTROL: a rate WITH source and effective date is accepted', () => db.exec(
  ev("event_type, assertion_class, asserted_by_relationship, source_kind, evidence_document_id, customs_rate_value, customs_rate_source, customs_rate_effective_from",
     `'ASSESSMENT_EVIDENCE_RECEIVED', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AUTHORITY_DOCUMENT', '${DOC}', 26.4312, 'ZIMRA rates of exchange for customs purposes, week commencing 2026-09-07', '2026-09-07'`)));

await refuses('a vehicle REGISTRATION is not an event type this phase has',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind",
     "'VEHICLE_REGISTRATION', 'ATTRIBUTED', 'APPOINTED_CLEARING_AGENT', 'AGENT_REPORT'"),
  /diaspora_customs_events_event_type_check|violates check constraint/);

await refuses('a relationship outside the vocabulary is refused',
  ev("event_type, assertion_class, asserted_by_relationship, source_kind",
     "'LODGEMENT_REPORTED', 'ATTRIBUTED', 'ZIMRA_OFFICER', 'AGENT_REPORT'"),
  /asserted_by_relationship_check|violates check constraint/);

// ── 3. Append-only ─────────────────────────────────────────────────────────

// The guard fires on `IS DISTINCT FROM`, so an UPDATE that sets a column to the value it ALREADY
// holds changes nothing and is correctly accepted. Two of these assertions did exactly that on the
// first run and passed by proving nothing. Each one now checks the new value really is different
// before it believes the refusal.
const cannotRewrite = async (what, column, value) => check(`${what} cannot be rewritten`, async () => {
  const { rows } = await db.query(`SELECT ${column}::text AS current FROM public.diaspora_customs_events WHERE id = '${EVENT}';`);
  const { rows: candidate } = await db.query(`SELECT (${value})::text AS proposed;`);
  if (rows[0].current === candidate[0].proposed) {
    throw new Error(`this assertion proves nothing: ${column} is already ${candidate[0].proposed}`);
  }
  let threw = null;
  try { await db.exec(`UPDATE public.diaspora_customs_events SET ${column} = ${value} WHERE id = '${EVENT}';`); } catch (e) { threw = e; }
  if (!threw) throw new Error('the database ACCEPTED what it must refuse');
  if (!/append-only/.test(threw.message)) throw new Error(`refused for the wrong reason: ${threw.message.split('\n')[0]}`);
});

for (const [what, column, value] of [
  ['what was asserted', 'event_type', `'RELEASE_EVIDENCE_RECEIVED'`],
  ['how strong the claim was', 'source_kind', `'AGENT_REPORT'`],
  ['who asserted it', 'asserted_by_user_id', `'somebody-else'`],
  ['what they are to the case', 'asserted_by_relationship', `'PLATFORM_REVIEWER'`],
  ['the amount', 'amount_value', '1.00'],
  ['the customs rate', 'customs_rate_value', '99.0'],
  ['when it happened', 'event_time', `now() - interval '30 days'`],
  ['the evidence it rests on', 'evidence_document_id', `'aaaabbbb-0000-0000-0000-000000000009'`],
  ['the case it belongs to', 'case_id', `'${CASE2}'`],
]) {
  await cannotRewrite(what, column, value);
}

await refuses('a customs event cannot be hard-deleted',
  `DELETE FROM public.diaspora_customs_events WHERE id = '${EVENT}';`,
  /cannot be deleted/);

await check('POSITIVE CONTROL: the correction path still works — supersede and attribute', async () => {
  // The guard must refuse rewriting without refusing the only legitimate way to fix a mistake.
  await db.exec(`UPDATE public.diaspora_customs_events SET deleted_at = now(), updated_by = 'user-reviewer' WHERE id = '${EVENT}';`);
  const { rows } = await db.query(`SELECT deleted_at, updated_by FROM public.diaspora_customs_events WHERE id = '${EVENT}';`);
  if (!rows[0].deleted_at) throw new Error('a mistaken event cannot be superseded');
  if (rows[0].updated_by !== 'user-reviewer') throw new Error('the correction is not attributed');
  await db.exec(`UPDATE public.diaspora_customs_events SET deleted_at = NULL WHERE id = '${EVENT}';`);
});

// ── 4. The migration says what it does not contain ─────────────────────────

await check('the migration introduces no rate, percentage or amount', () => {
  const code = up.replace(/^\s*--.*$/gm, '');
  for (const forbidden of [/13\.5/, /50000/, /\bDEFAULT\s+\d+\.\d+/i]) {
    if (forbidden.test(code)) throw new Error(`the schema carries a numeric default matching ${forbidden}`);
  }
});

await check('no government registry table is referenced', () => {
  for (const table of ['zimra_declarations', 'cvr_ownership_records', 'cid_clearance_records', 'vid_inspections', 'zinara_licensing_records']) {
    if (new RegExp(`\\b${table}\\b`).test(up.replace(/^\s*--.*$/gm, ''))) {
      throw new Error(`the schema references the government registry table ${table}`);
    }
  }
});

await check('the down migration is reversible', () => db.exec(down));

// ── Report ─────────────────────────────────────────────────────────────────
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? `  — ${r.error}` : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 })}`);
// An exit code that says PASS while exiting non-zero is the T8 defect. One statement, one exit.
process.exit(failed.length ? 1 : 0);
