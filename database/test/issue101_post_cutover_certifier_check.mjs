/**
 * ISSUE #101 — the POST-CUTOVER CERTIFIER, proven on real PostgreSQL before it is ever
 * pointed at production.
 *
 * A certifier that cannot fail is worse than none: it converts "we did not look" into
 * "we checked and it was fine". So this builds a correct post-cutover fixture, proves it
 * PASSES, and then breaks one thing at a time and proves each break is CAUGHT and NAMED.
 *
 * The fixture is built by applying the two REAL merged migrations to a production-shaped
 * pre-state, so the certifier is validated against the same DDL production received
 * rather than against a hand-written approximation of it.
 *
 * No production data, no production credential, no key material. Every literal here is
 * synthetic.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  collectCertification, evaluate, FOURTEEN, CUTOVER_SEVEN,
  ALL_TABLE_PRIVILEGES, VIEW_HIDDEN_COLUMNS, VIEW_PROJECTED_COLUMNS,
} from '../../backend/scripts/production-issue-101-post-cutover-certify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG_A = '20260814085000_issue101_public_keys_hardening.sql';
const MIG_B = '20260814090000_issue101_p0_rls_and_view_hardening.sql';

const failures = [];
const results = {};
const OPEN = [];
const fail = (m) => failures.push(m);
const eq = (label, actual, expected) => {
  results[label] = actual;
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

function upOf(file) {
  const raw = readFileSync(join(HERE, '..', 'migrations', file), 'utf8');
  const i = raw.indexOf('-- +migrate Down');
  return (i >= 0 ? raw.slice(0, i) : raw).replace('-- +migrate Up', '');
}

/** Production as it was BEFORE the cutover, then both real migrations applied. */
async function postCutoverFixture() {
  const db = await PGlite.create();
  OPEN.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.users (id text PRIMARY KEY, email text);
    CREATE TABLE public.vehicles (vin text PRIMARY KEY, make text);
    CREATE TABLE public.ocr_documents (id text PRIMARY KEY, kind text);

    CREATE TABLE public.public_keys (
      id              text NOT NULL,
      user_id         text NOT NULL,
      public_key_pem  text NOT NULL,
      private_key_pem text,
      key_type        text DEFAULT 'secp256k1'::text,
      status          text DEFAULT 'ACTIVE'::text,
      created_at      text NOT NULL,
      revoked_at      text,
      CONSTRAINT public_keys_pkey PRIMARY KEY (id),
      CONSTRAINT public_keys_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text]))),
      CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_public_keys_user ON public.public_keys USING btree (user_id);

    CREATE TABLE public.signature_verification_logs (
      id bigserial PRIMARY KEY, payload_hash text NOT NULL, signature text NOT NULL,
      public_key_id text NOT NULL, verified integer DEFAULT 1, timestamp text NOT NULL,
      CONSTRAINT signature_verification_logs_public_key_id_fkey
        FOREIGN KEY (public_key_id) REFERENCES public.public_keys(id) ON DELETE CASCADE);
  `);

  // the remaining twelve of the fourteen, in their pre-hardening exposed state
  for (const t of FOURTEEN.filter((x) => x !== 'signature_verification_logs')) {
    await db.exec(`CREATE TABLE public.${t} (id bigserial PRIMARY KEY, payload text);`);
  }
  for (const t of FOURTEEN) {
    await db.exec(`GRANT ALL ON TABLE public.${t} TO anon, authenticated, service_role;`);
  }
  await db.exec(`ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;
                 GRANT ALL ON TABLE public.public_keys TO anon, authenticated, service_role;`);

  // evidence_sources + its public projection, exactly as #155 expects to find them
  await db.exec(`
    CREATE TABLE public.evidence_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text, display_name text, source_type text, organization text, country text,
      verification_status text, trust_tier text, permitted_evidence_classes text[],
      active boolean NOT NULL DEFAULT true,
      contact_reference text, credential_reference text
    );
    CREATE VIEW public.evidence_sources_public AS
      SELECT id, code, display_name, source_type, organization, country,
             verification_status, trust_tier, permitted_evidence_classes, active
        FROM public.evidence_sources WHERE active = true;
    ALTER TABLE public.evidence_sources ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.evidence_sources FROM anon, authenticated;
    GRANT ALL ON TABLE public.evidence_sources TO service_role;
    GRANT ALL ON TABLE public.evidence_sources_public TO anon, authenticated, service_role;
  `);

  // cutover-seven in their hardened post-cutover posture
  for (const [t, expected] of Object.entries(CUTOVER_SEVEN)) {
    if (t !== 'vehicles') await db.exec(`CREATE TABLE public.${t} (id bigserial PRIMARY KEY, payload text);`);
    await db.exec(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    await db.exec(`REVOKE ALL ON TABLE public.${t} FROM anon, authenticated;`);
    await db.exec(`GRANT ALL ON TABLE public.${t} TO service_role;`);
    if (expected === 'SELECT') await db.exec(`GRANT SELECT ON TABLE public.${t} TO anon, authenticated;`);
  }

  // apply the REAL migrations, in cutover order
  await db.exec('BEGIN;'); await db.exec(upOf(MIG_A)); await db.exec('COMMIT;');
  await db.exec('BEGIN;'); await db.exec(upOf(MIG_B)); await db.exec('COMMIT;');
  return db;
}

// ═══════════════════════════════════════════ 1. THE CORRECT STATE MUST CERTIFY
const db = await postCutoverFixture();
const clean = evaluate(await collectCertification(db));

eq('certifier.privilege_set_is_all_eight', ALL_TABLE_PRIVILEGES.length, 8);
eq('certifier.includes_MAINTAIN', ALL_TABLE_PRIVILEGES.includes('MAINTAIN'), true);
eq('clean.ok', clean.ok, true);
if (!clean.ok) clean.problems.forEach((p) => fail(`  unexpected problem: ${p}`));
eq('clean.fourteen_present', clean.metrics.fourteen_present, 14);
eq('clean.fourteen_rls_on', clean.metrics.fourteen_rls_on, 14);
eq('clean.fourteen_unexpected_api_privileges_all_eight', clean.metrics.fourteen_unexpected_api_privileges_all_eight, 0);
eq('clean.unintended_api_read_exposures_after', clean.metrics.unintended_api_read_exposures_after, 0);
eq('clean.intentional_public_read_surfaces_after', clean.metrics.intentional_public_read_surfaces_after, 1);
eq('clean.service_only_tables_with_select_absent', clean.metrics.service_only_tables_with_select_absent, 13);
eq('clean.fourteen_service_role_lost', clean.metrics.fourteen_service_role_lost, 0);
eq('clean.public_keys_anon', clean.metrics.public_keys.anon, 'none');
eq('clean.public_keys_authenticated', clean.metrics.public_keys.authenticated, 'none');
eq('clean.public_keys_service_role', clean.metrics.public_keys.service_role, 'INSERT,SELECT,UPDATE');
eq('clean.public_keys_withheld_but_present', clean.metrics.public_keys.withheld_but_present, '');
eq('clean.view_security_invoker', clean.metrics.view.security_invoker, true);
eq('clean.view_hidden_columns_absent', clean.metrics.view_hidden_columns_absent, true);
eq('clean.view_api_grants', JSON.stringify(clean.metrics.view_api_grants),
  JSON.stringify(['anon:SELECT', 'authenticated:SELECT']));
eq('clean.cutover_seven_present', clean.metrics.cutover_seven_present, 7);
eq('clean.cutover_seven_api_reopened', clean.metrics.cutover_seven_api_reopened, 0);
eq('clean.cutover_seven_service_role_lost', clean.metrics.cutover_seven_service_role_lost, 0);
eq('clean.projected_columns_complete',
  VIEW_PROJECTED_COLUMNS.every((c) => clean.metrics.view_columns.includes(c)), true);
eq('clean.hidden_columns_not_projected',
  VIEW_HIDDEN_COLUMNS.every((c) => !clean.metrics.view_columns.includes(c)), true);

// ═══════════════════════════════════════════ 2. EACH BREAK MUST BE CAUGHT AND NAMED
/** Break one thing, re-certify, restore, and confirm the certifier recovers. */
async function breakAndCheck(label, breakSql, restoreSql, expectPattern) {
  await db.exec(breakSql);
  const v = evaluate(await collectCertification(db));
  await db.exec(restoreSql);
  const back = evaluate(await collectCertification(db));
  eq(`caught.${label}`, !v.ok, true);
  eq(`caught.${label}.named`, v.problems.some((p) => expectPattern.test(p)), true);
  if (!v.problems.some((p) => expectPattern.test(p))) {
    fail(`  ${label}: problems were ${JSON.stringify(v.problems).slice(0, 200)}`);
  }
  eq(`caught.${label}.recovers`, back.ok, true);
}

// the whole point of this lane: MAINTAIN must be caught on the fourteen
await breakAndCheck('fourteen_anon_MAINTAIN',
  `GRANT MAINTAIN ON TABLE public.system_failures TO anon;`,
  `REVOKE MAINTAIN ON TABLE public.system_failures FROM anon;`,
  /system_failures: anon retains MAINTAIN/);
await breakAndCheck('fourteen_authenticated_MAINTAIN',
  `GRANT MAINTAIN ON TABLE public.zimra_declarations TO authenticated;`,
  `REVOKE MAINTAIN ON TABLE public.zimra_declarations FROM authenticated;`,
  /zimra_declarations: authenticated retains MAINTAIN/);
await breakAndCheck('fourteen_anon_REFERENCES',
  `GRANT REFERENCES ON TABLE public.ocr_national_ids TO anon;`,
  `REVOKE REFERENCES ON TABLE public.ocr_national_ids FROM anon;`,
  /ocr_national_ids: anon retains REFERENCES/);
await breakAndCheck('fourteen_anon_TRIGGER',
  `GRANT TRIGGER ON TABLE public.currency_rates TO anon;`,
  `REVOKE TRIGGER ON TABLE public.currency_rates FROM anon;`,
  /currency_rates: anon retains TRIGGER/);
await breakAndCheck('fourteen_unintended_SELECT',
  `GRANT SELECT ON TABLE public.vid_inspections TO anon;`,
  `REVOKE SELECT ON TABLE public.vid_inspections FROM anon;`,
  /vid_inspections: anon retains SELECT/);
await breakAndCheck('fourteen_rls_disabled',
  `ALTER TABLE public.dealer_promotions DISABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE public.dealer_promotions ENABLE ROW LEVEL SECURITY;`,
  /RLS enabled on only 13\/14/);
await breakAndCheck('fourteen_service_role_lost',
  `REVOKE DELETE ON TABLE public.cid_clearance_records FROM service_role;`,
  `GRANT DELETE ON TABLE public.cid_clearance_records TO service_role;`,
  /cid_clearance_records: service_role LOST DELETE/);
await breakAndCheck('taxonomy_public_read_lost',
  `REVOKE SELECT ON TABLE public.evidence_class_taxonomy FROM anon;`,
  `GRANT SELECT ON TABLE public.evidence_class_taxonomy TO anon;`,
  /evidence_class_taxonomy: anon lost the documented public read/);

await breakAndCheck('public_keys_service_role_MAINTAIN',
  `GRANT MAINTAIN ON TABLE public.public_keys TO service_role;`,
  `REVOKE MAINTAIN ON TABLE public.public_keys FROM service_role;`,
  /public_keys: service_role retains withheld MAINTAIN/);
await breakAndCheck('public_keys_anon_returns',
  `GRANT SELECT ON TABLE public.public_keys TO anon;`,
  `REVOKE SELECT ON TABLE public.public_keys FROM anon;`,
  /public_keys: anon retains SELECT/);
await breakAndCheck('public_keys_rls_disabled',
  `ALTER TABLE public.public_keys DISABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;`,
  /public_keys: RLS not enabled/);

await breakAndCheck('view_security_invoker_reset',
  `ALTER VIEW public.evidence_sources_public RESET (security_invoker);`,
  `ALTER VIEW public.evidence_sources_public SET (security_invoker = true);`,
  /security_invoker is not true/);
await breakAndCheck('view_write_grant_returns',
  `GRANT UPDATE ON TABLE public.evidence_sources_public TO anon;`,
  `REVOKE UPDATE ON TABLE public.evidence_sources_public FROM anon;`,
  /evidence_sources_public: API roles hold anon\.UPDATE/);
await breakAndCheck('base_hidden_column_exposed',
  `GRANT SELECT (contact_reference) ON TABLE public.evidence_sources TO anon;`,
  `REVOKE SELECT (contact_reference) ON TABLE public.evidence_sources FROM anon;`,
  /evidence_sources\.contact_reference is SELECT-able by anon/);
await breakAndCheck('base_read_policy_dropped',
  `DROP POLICY evidence_sources_public_read ON public.evidence_sources;`,
  `CREATE POLICY evidence_sources_public_read ON public.evidence_sources
     FOR SELECT TO anon, authenticated USING (active = true);`,
  /evidence_sources: the base read policy is absent/);

await breakAndCheck('cutover_seven_api_reopened',
  `GRANT INSERT ON TABLE public.trust_score_history TO anon;`,
  `REVOKE INSERT ON TABLE public.trust_score_history FROM anon;`,
  /cutover trust_score_history: anon regained INSERT/);
await breakAndCheck('cutover_seven_service_role_lost',
  `REVOKE UPDATE ON TABLE public.vehicle_evidence FROM service_role;`,
  `GRANT UPDATE ON TABLE public.vehicle_evidence TO service_role;`,
  /cutover vehicle_evidence: service_role is/);

// ═══════════════════════ 2b. THE SIX REVIEW FINDINGS — each break must be caught
/**
 * Six defects found in review, each of which let a genuinely broken production state
 * certify as clean. Every one gets a break here, and every one of these cases fails if
 * its check is removed from evaluate() — proven by the mutation matrix in the PR.
 */

// F1 — a cutover-seven table with RLS silently disabled. Grants still look right.
await breakAndCheck('F1_cutover_seven_rls_disabled',
  `ALTER TABLE public.trust_score_history DISABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE public.trust_score_history ENABLE ROW LEVEL SECURITY;`,
  /cutover trust_score_history: RLS is not enabled/);

// F2 — a cutover-seven target missing entirely. The old loop simply skipped it.
{
  const before = evaluate(await collectCertification(db));
  eq('F2.baseline_clean', before.ok, true);
  await db.exec(`ALTER TABLE public.mechanic_parts RENAME TO mechanic_parts_moved;`);
  const v = evaluate(await collectCertification(db));
  await db.exec(`ALTER TABLE public.mechanic_parts_moved RENAME TO mechanic_parts;`);
  const back = evaluate(await collectCertification(db));
  eq('caught.F2_cutover_seven_target_absent', !v.ok, true);
  eq('caught.F2_cutover_seven_target_absent.named',
    v.problems.some((p) => /cutover-seven: 1 target\(s\) absent: mechanic_parts/.test(p))
    && v.problems.some((p) => /cutover-seven: 6\/7 targets present/.test(p)), true);
  eq('caught.F2_cutover_seven_target_absent.recovers', back.ok, true);
}

// F3 — a grant to PUBLIC on the view. Reaches anon regardless of the per-role grants,
//      and an anon/authenticated-only check cannot see it.
await breakAndCheck('F3_view_granted_to_PUBLIC',
  `GRANT SELECT ON TABLE public.evidence_sources_public TO PUBLIC;`,
  `REVOKE SELECT ON TABLE public.evidence_sources_public FROM PUBLIC;`,
  /evidence_sources_public: unexpected grantee\(s\) PUBLIC/);

// F3b — an unrelated role granted on the view
{
  await db.exec(`CREATE ROLE interloper NOLOGIN;
                 GRANT SELECT ON TABLE public.evidence_sources_public TO interloper;`);
  const v = evaluate(await collectCertification(db));
  await db.exec(`REVOKE SELECT ON TABLE public.evidence_sources_public FROM interloper; DROP ROLE interloper;`);
  const back = evaluate(await collectCertification(db));
  eq('caught.F3b_view_unexpected_role', !v.ok, true);
  eq('caught.F3b_view_unexpected_role.named',
    v.problems.some((p) => /unexpected grantee\(s\) interloper/.test(p)), true);
  eq('caught.F3b_view_unexpected_role.recovers', back.ok, true);
}

// F3c — service_role LOSING its read of the view is a defect too, not just excess
await breakAndCheck('F3c_view_service_role_lost_select',
  `REVOKE SELECT ON TABLE public.evidence_sources_public FROM service_role;`,
  `GRANT SELECT ON TABLE public.evidence_sources_public TO service_role;`,
  /evidence_sources_public: service_role lost SELECT/);

// F4 — an ELEVENTH column reaching the projection. "contains the ten" would accept it.
//      The view must be dropped and rebuilt on both legs: CREATE OR REPLACE VIEW cannot
//      remove a column, and dropping a view discards its reloptions and its whole ACL,
//      so security_invoker and the grants are restored explicitly.
{
  const rebuildView = (columns) => `
    DROP VIEW public.evidence_sources_public;
    CREATE VIEW public.evidence_sources_public AS
      SELECT ${columns} FROM public.evidence_sources WHERE active = true;
    ALTER VIEW public.evidence_sources_public SET (security_invoker = true);
    GRANT SELECT ON TABLE public.evidence_sources_public TO anon, authenticated;
    GRANT ALL    ON TABLE public.evidence_sources_public TO service_role;`;
  const TEN = VIEW_PROJECTED_COLUMNS.join(', ');

  await db.exec(`ALTER TABLE public.evidence_sources ADD COLUMN internal_note text;`);
  await db.exec(rebuildView(`${TEN}, internal_note`));
  const v = evaluate(await collectCertification(db));

  await db.exec(rebuildView(TEN));
  await db.exec(`ALTER TABLE public.evidence_sources DROP COLUMN internal_note;`);
  const back = evaluate(await collectCertification(db));

  eq('caught.F4_view_projects_eleventh_column', !v.ok, true);
  eq('caught.F4_view_projects_eleventh_column.named',
    v.problems.some((p) => /view projects UNEXPECTED column\(s\): internal_note/.test(p)), true);
  eq('caught.F4_view_projects_eleventh_column.recovers', back.ok, true);
  if (!back.ok) fail(`  F4 restore left: ${JSON.stringify(back.problems).slice(0, 200)}`);
}

// F5 — the base read policy widened to PUBLIC (no TO clause) or to an extra role
await breakAndCheck('F5_base_policy_roles_public',
  `DROP POLICY evidence_sources_public_read ON public.evidence_sources;
   CREATE POLICY evidence_sources_public_read ON public.evidence_sources
     FOR SELECT USING (active = true);`,
  `DROP POLICY evidence_sources_public_read ON public.evidence_sources;
   CREATE POLICY evidence_sources_public_read ON public.evidence_sources
     FOR SELECT TO anon, authenticated USING (active = true);`,
  /base policy roles are \[PUBLIC\], expected exactly \[anon,authenticated\]/);

await breakAndCheck('F5b_base_policy_roles_extra',
  `DROP POLICY evidence_sources_public_read ON public.evidence_sources;
   CREATE POLICY evidence_sources_public_read ON public.evidence_sources
     FOR SELECT TO anon, authenticated, service_role USING (active = true);`,
  `DROP POLICY evidence_sources_public_read ON public.evidence_sources;
   CREATE POLICY evidence_sources_public_read ON public.evidence_sources
     FOR SELECT TO anon, authenticated USING (active = true);`,
  /base policy roles are \[anon,authenticated,service_role\]/);

// F6 — a projected column losing its base column-level grant. Because the view is
//      security_invoker, this breaks the read for anon at RUNTIME while every
//      "nothing is over-exposed" check still passes.
await breakAndCheck('F6_projected_column_grant_lost',
  `REVOKE SELECT (display_name) ON TABLE public.evidence_sources FROM anon;`,
  `GRANT SELECT (display_name) ON TABLE public.evidence_sources TO anon;`,
  /projected column\(s\) not SELECT-able by both API roles: display_name\(authenticated\)/);

await breakAndCheck('F6b_projected_column_grant_lost_both',
  `REVOKE SELECT (country) ON TABLE public.evidence_sources FROM anon, authenticated;`,
  `GRANT SELECT (country) ON TABLE public.evidence_sources TO anon, authenticated;`,
  /projected column\(s\) not SELECT-able by both API roles: country\(none\)/);

// ═══════════════════════════════════════════ 3. THE CERTIFIER READS NO ROWS
// Proven by construction: every statement targets pg_catalog or information_schema. The
// source contract test asserts that; here we prove the collected receipt carries no row
// data by checking it contains none of the synthetic values we planted.
await db.exec(`
  INSERT INTO public.users (id,email) VALUES ('cert-user','cert@example.invalid');
  INSERT INTO public.public_keys (id,user_id,public_key_pem,private_key_pem,created_at)
    VALUES ('cert-k','cert-user','SYNTHETIC-PUBLIC-SENTINEL','SYNTHETIC-PRIVATE-SENTINEL','2026-01-01');
  INSERT INTO public.evidence_sources (code, display_name, source_type, active, contact_reference, credential_reference)
    VALUES ('CERT-1','Cert','government', true, 'SYNTHETIC-CONTACT-SENTINEL','SYNTHETIC-CREDENTIAL-SENTINEL');`);
const withRows = await collectCertification(db);
const blob = JSON.stringify(withRows);
for (const sentinel of ['SYNTHETIC-PRIVATE-SENTINEL', 'SYNTHETIC-PUBLIC-SENTINEL',
  'SYNTHETIC-CONTACT-SENTINEL', 'SYNTHETIC-CREDENTIAL-SENTINEL', 'cert@example.invalid']) {
  eq(`no_row_data.${sentinel}`, blob.includes(sentinel), false);
}
eq('no_row_data.certification_still_passes', evaluate(withRows).ok, true);

// ═══════════════════════════════════════════ REPORT
console.log('\nISSUE #101 — POST-CUTOVER CERTIFIER PROOF (real PostgreSQL via PGlite)\n');
for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(52)} = ${JSON.stringify(v)}`);
console.log('');
for (const d of OPEN) { try { await d.close(); } catch { /* already closed */ } }
if (failures.length) {
  console.error(`FAILED — ${failures.length} problem(s):`);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('PASS — the correct post-cutover state certifies; 27 distinct breaks are each caught');
console.log('       and named; and no application row or key value reaches the receipt.');
process.exit(0);
