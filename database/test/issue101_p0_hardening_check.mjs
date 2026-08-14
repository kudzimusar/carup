/**
 * ISSUE #101 P0 HARDENING — REAL-POSTGRES BEHAVIOURAL PROOF (PGlite).
 *
 * The contract tests assert the migration's shape. This proves its BEHAVIOUR against a
 * real PostgreSQL engine, as the actual anon and authenticated roles:
 *
 *   · all fourteen ordinary-DML exposures go to ZERO for both API roles;
 *   · TRUNCATE is denied — the control RLS can never provide;
 *   · the ONE documented public read (evidence_class_taxonomy) still works;
 *   · evidence_sources_public is read-only, and its write path is closed;
 *   · the base-table protection PROVABLY applies after the security_invoker flip —
 *     the view returns only active rows, and the two hidden columns remain unreachable
 *     even by a direct base-table query;
 *   · service_role remains fully operational on everything touched.
 *
 * Method: build the minimal real shapes the migration targets, create the three Supabase
 * roles, capture a BEFORE posture, apply the migration's Up verbatim from the repo file,
 * capture an AFTER posture, then run positive and negative role tests with SET ROLE.
 *
 * Exit code 0 only if every assertion holds. Prints a deterministic JSON receipt.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260814090000_issue101_p0_rls_and_view_hardening.sql';

const FOURTEEN = [
  'cid_clearance_records', 'currency_rates', 'cvr_ownership_records', 'dealer_promotions',
  'evidence_class_taxonomy', 'ocr_customs_declarations', 'ocr_national_ids',
  'ocr_registration_books', 'performance_telemetry', 'signature_verification_logs',
  'system_failures', 'vid_inspections', 'zimra_declarations', 'zinara_licensing_records',
];
/** The only one of the fourteen that must still be readable by anon/authenticated. */
const KEEPS_READ = 'evidence_class_taxonomy';
const VIEW_COLUMNS = [
  'id', 'code', 'display_name', 'source_type', 'organization', 'country',
  'verification_status', 'trust_tier', 'permitted_evidence_classes', 'active',
];
const HIDDEN_COLUMNS = ['contact_reference', 'credential_reference'];

const results = { before: {}, after: {}, positive: [], negative: [], failures: [] };
const fail = (msg) => { results.failures.push(msg); };

function upSectionOf(file) {
  const raw = readFileSync(join(HERE, '..', 'migrations', file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  return (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
}

/** Run a statement as a role and report whether it was permitted. */
async function asRole(db, role, sql) {
  try {
    await db.exec(`SET ROLE ${role};`);
    await db.exec(sql);
    await db.exec('RESET ROLE;');
    return { allowed: true, error: null };
  } catch (e) {
    try { await db.exec('RESET ROLE;'); } catch { /* ignore */ }
    return { allowed: false, error: String(e.message || e).split('\n')[0].slice(0, 90) };
  }
}

async function posture(db) {
  const { rows } = await db.query(`
    select c.relname as name, c.relkind, c.relrowsecurity as rls,
           (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
           coalesce((select string_agg(distinct pr, ',' order by pr)
                       from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr
                      where has_table_privilege('anon', c.oid, pr)), 'none') as anon,
           coalesce((select string_agg(distinct pr, ',' order by pr)
                       from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr
                      where has_table_privilege('authenticated', c.oid, pr)), 'none') as authenticated,
           coalesce((select string_agg(distinct pr, ',' order by pr)
                       from unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr
                      where has_table_privilege('service_role', c.oid, pr)), 'none') as service_role
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v')
     order by 1`);
  return Object.fromEntries(rows.map((r) => [r.name, r]));
}

const db = await PGlite.create();

// ---------------------------------------------------------------- fixtures
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  -- service_role carries BYPASSRLS in production (measured, probe #2 run 31759906271).
  -- The fixture MUST reproduce that: without it, enabling RLS would break every backend
  -- write, and this proof would be measuring a database CarUp does not have.
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`);

// Minimal real shapes for the fourteen. Column detail is irrelevant to a grant/RLS
// proof; what matters is that each is a real table carrying the pre-migration posture.
for (const t of FOURTEEN) {
  await db.exec(`CREATE TABLE public.${t} (id bigserial primary key, payload text);`);
  await db.exec(`INSERT INTO public.${t} (payload) VALUES ('row-1'), ('row-2');`);
}

// evidence_sources + its public projection, reproducing the real definition.
await db.exec(`
  CREATE TABLE public.evidence_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text, display_name text, source_type text, organization text, country text,
    verification_status text, trust_tier text, permitted_evidence_classes text[],
    active boolean NOT NULL DEFAULT true,
    contact_reference text,
    credential_reference text
  );
  INSERT INTO public.evidence_sources
    (code, display_name, source_type, active, contact_reference, credential_reference)
  VALUES ('ACTIVE-1','Active Source','registry', true,  'contact-secret','credential-secret'),
         ('RETIRED-1','Retired Source','registry', false,'contact-secret','credential-secret');
  CREATE VIEW public.evidence_sources_public AS
    SELECT id, code, display_name, source_type, organization, country,
           verification_status, trust_tier, permitted_evidence_classes, active
    FROM public.evidence_sources
    WHERE active = true;
`);

// Reproduce the PRE-migration production posture: the fourteen inherit full API-role DML
// from the default ACL and have RLS off; evidence_sources is already correctly restricted
// while its view carries the inherited DML bits and owner rights.
for (const t of FOURTEEN) {
  await db.exec(`GRANT ALL ON TABLE public.${t} TO anon, authenticated, service_role;`);
}
// Production's DEFAULT ACL also grants rwU on SEQUENCES in schema public to anon,
// authenticated AND service_role (measured, run 31749657530). The fixture must mirror
// that or the pre-state is not faithful and service_role cannot insert at all.
await db.exec(`
  GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public
    TO anon, authenticated, service_role;
`);
await db.exec(`
  ALTER TABLE public.evidence_sources ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.evidence_sources FROM anon, authenticated;
  GRANT ALL ON TABLE public.evidence_sources TO service_role;
  GRANT ALL ON TABLE public.evidence_sources_public TO anon, authenticated, service_role;
`);

results.before = await posture(db);

// Sanity: the fixture really does reproduce the exposure we are closing.
for (const t of FOURTEEN) {
  if (results.before[t].rls !== false) fail(`fixture: ${t} should start with RLS off`);
  if (!results.before[t].anon.includes('INSERT')) fail(`fixture: ${t} should start anon-writable`);
}
const preWrite = await asRole(db, 'anon', `INSERT INTO public.ocr_national_ids (payload) VALUES ('pre');`);
if (!preWrite.allowed) fail('fixture: anon should be able to write BEFORE the migration');
const preViewWrite = await asRole(db, 'anon',
  `UPDATE public.evidence_sources_public SET display_name = 'hijacked' WHERE code = 'ACTIVE-1';`);
results.positive.push({ check: 'pre-migration anon view write was possible (the exposure)', result: preViewWrite.allowed });

// ---------------------------------------------------------------- apply
await db.exec(upSectionOf(MIGRATION));
results.after = await posture(db);

// ---------------------------------------------------------------- assertions
// 1. all fourteen: RLS on, and zero ordinary-DML for both API roles.
let ordinaryExposures = 0;
for (const t of FOURTEEN) {
  const a = results.after[t];
  if (a.rls !== true) fail(`${t}: RLS not enabled after migration`);
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
      if (a[role].includes(priv)) { fail(`${t}: ${role} retains ${priv}`); ordinaryExposures += 1; }
    }
    if (a[role].includes('TRUNCATE')) fail(`${t}: ${role} retains TRUNCATE — RLS does not govern it`);
    const expectRead = t === KEEPS_READ;
    const hasRead = a[role].includes('SELECT');
    if (expectRead && !hasRead) fail(`${t}: ${role} lost the documented public read`);
    if (!expectRead && hasRead) fail(`${t}: ${role} unexpectedly retains SELECT`);
  }
  for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    if (!a.service_role.includes(priv)) fail(`${t}: service_role LOST ${priv}`);
  }
}
results.ordinary_dml_exposures_after = ordinaryExposures;

// 2. negative role tests — the behaviour, not just the catalog.
for (const t of ['ocr_national_ids', 'cid_clearance_records', 'currency_rates', 'signature_verification_logs']) {
  for (const role of ['anon', 'authenticated']) {
    const ins = await asRole(db, role, `INSERT INTO public.${t} (payload) VALUES ('x');`);
    const sel = await asRole(db, role, `SELECT count(*) FROM public.${t};`);
    const tru = await asRole(db, role, `TRUNCATE TABLE public.${t};`);
    results.negative.push({ table: t, role, insert: ins.allowed, select: sel.allowed, truncate: tru.allowed });
    if (ins.allowed) fail(`${role} can still INSERT into ${t}`);
    if (sel.allowed) fail(`${role} can still SELECT from ${t}`);
    if (tru.allowed) fail(`${role} can still TRUNCATE ${t}`);
  }
}

// 3. the preserved read still works, for both roles.
for (const role of ['anon', 'authenticated']) {
  const r = await asRole(db, role, `SELECT count(*) FROM public.${KEEPS_READ};`);
  results.positive.push({ check: `${role} can still read ${KEEPS_READ}`, result: r.allowed, error: r.error });
  if (!r.allowed) fail(`${role} lost the documented public read on ${KEEPS_READ}`);
  const w = await asRole(db, role, `INSERT INTO public.${KEEPS_READ} (payload) VALUES ('x');`);
  if (w.allowed) fail(`${role} can still WRITE ${KEEPS_READ} — read-only was intended`);
}

// 4. evidence_sources_public — read preserved, write denied, base protection applies.
for (const role of ['anon', 'authenticated']) {
  const w = await asRole(db, role,
    `UPDATE public.evidence_sources_public SET display_name = 'hijacked' WHERE code = 'ACTIVE-1';`);
  if (w.allowed) fail(`${role} can still WRITE through evidence_sources_public`);
  const i = await asRole(db, role,
    `INSERT INTO public.evidence_sources_public (code, display_name, active) VALUES ('X','X',true);`);
  if (i.allowed) fail(`${role} can still INSERT through evidence_sources_public`);
  results.negative.push({ view: 'evidence_sources_public', role, update: w.allowed, insert: i.allowed });
}

// The read must still work AND be RLS-governed (active rows only).
await db.exec('SET ROLE anon;');
let viewRows = null; let viewErr = null;
try {
  const r = await db.query('SELECT code FROM public.evidence_sources_public ORDER BY code;');
  viewRows = r.rows.map((x) => x.code);
} catch (e) { viewErr = String(e.message || e).slice(0, 90); }
// Direct base access must be limited to the granted columns and the active rows.
let baseAllowed = null; let hiddenBlocked = null;
try { await db.query('SELECT code FROM public.evidence_sources;'); baseAllowed = true; }
catch { baseAllowed = false; }
try { await db.query('SELECT contact_reference FROM public.evidence_sources;'); hiddenBlocked = false; }
catch { hiddenBlocked = true; }
await db.exec('RESET ROLE;');

results.positive.push({ check: 'anon reads evidence_sources_public', rows: viewRows, error: viewErr });
results.positive.push({ check: 'anon direct base read (granted columns)', allowed: baseAllowed });
results.positive.push({ check: 'anon hidden columns blocked', blocked: hiddenBlocked });

if (viewErr) fail(`anon lost the evidence read experience: ${viewErr}`);
if (viewRows && viewRows.length !== 1) fail(`view returned ${viewRows.length} rows; base RLS should limit it to the 1 active row`);
if (viewRows && !viewRows.includes('ACTIVE-1')) fail('view no longer returns the active source');
if (viewRows && viewRows.includes('RETIRED-1')) fail('view leaked an inactive row — base policy not applied');
if (!hiddenBlocked) fail('hidden columns are reachable via a direct base-table query');

// 5. the view is genuinely security_invoker now.
const { rows: opt } = await db.query(`
  select coalesce(c.reloptions::text[] @> array['security_invoker=true'], false) as invoker
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relname='evidence_sources_public'`);
results.security_invoker = opt[0].invoker;
if (!opt[0].invoker) fail('evidence_sources_public is not security_invoker — owner-rights bypass remains');

// 6. service_role still operates end to end.
const svc = await asRole(db, 'service_role', `INSERT INTO public.ocr_national_ids (payload) VALUES ('svc');`);
results.positive.push({ check: 'service_role can still write', result: svc.allowed, error: svc.error });
if (!svc.allowed) fail('service_role LOST write access — the backend would break');

// 6b. THE DEPENDENCY THIS MIGRATION RESTS ON, asserted rather than assumed: enabling RLS
// is non-breaking for the backend ONLY because service_role bypasses RLS. If that ever
// changed, every one of the fourteen would start failing backend writes.
const { rows: svcRole } = await db.query(
  "select rolbypassrls from pg_roles where rolname = 'service_role'");
results.service_role_bypassrls = svcRole[0].rolbypassrls;
if (!svcRole[0].rolbypassrls) {
  fail('service_role does not bypass RLS — enabling RLS would break the backend');
}

// 7. SCOPE BOUNDARY, asserted rather than assumed: this migration deliberately does NOT
// touch sequence privileges. That is B1-SEQ's scope. Record the residual honestly so the
// receipt cannot be read as "all anon capability removed".
const { rows: seqAcl } = await db.query(`
  select c.relname,
         has_sequence_privilege('anon', c.oid, 'UPDATE') as anon_update,
         has_sequence_privilege('authenticated', c.oid, 'UPDATE') as auth_update
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='S' order by 1`);
results.residual_sequence_exposure = {
  note: 'OUT OF SCOPE for this migration by design — B1-SEQ owns it. RLS never governs sequences either.',
  sequences_with_anon_update: seqAcl.filter((r) => r.anon_update).length,
  total_sequences: seqAcl.length,
};

results.overall = results.failures.length === 0 ? 'PASS' : 'FAIL';
console.log(JSON.stringify({
  overall: results.overall,
  ordinary_dml_exposures_after: results.ordinary_dml_exposures_after,
  security_invoker: results.security_invoker,
  service_role_bypassrls: results.service_role_bypassrls,
  residual_sequence_exposure: results.residual_sequence_exposure,
  failures: results.failures,
  positive: results.positive,
  negative: results.negative,
}, null, 2));
process.exit(results.failures.length === 0 ? 0 : 1);
