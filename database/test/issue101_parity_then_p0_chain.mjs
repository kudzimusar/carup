/**
 * ISSUE #101 — PARITY → P0 CHAIN: proof that #155 still means something afterwards.
 *
 * The whole point of the parity migration is to make #155 certifiable on staging. A
 * parity migration that quietly satisfied #155 by pre-hardening everything, or that
 * broke #155's preconditions, or that left the fourteen in a state where #155's
 * assertions pass vacuously, would defeat its own purpose.
 *
 * So this harness applies BOTH files in order against one real PostgreSQL, unmodified,
 * and then re-proves #155's four published invariants plus the cutover-seven regression
 * checks — the same numbers certified for #155 itself.
 *
 * Two things are checked that a single-migration harness cannot see:
 *   · #155 must run WITHOUT MODIFICATION after parity — its sixteen-object precondition
 *     must be satisfied by what parity created, not by an edit to #155;
 *   · parity must not touch anything outside its twelve. The cutover-seven and the three
 *     pre-existing #155 targets are snapshotted before parity and compared after.
 *
 * All data is synthetic. No production row, key or credential appears here.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARITY = '20260814080000_issue101_staging_parity.sql';
const P0 = '20260814090000_issue101_p0_rls_and_view_hardening.sql';

/** #155's fourteen. Eleven arrive from parity; three already exist on staging. */
const FOURTEEN = [
  'cid_clearance_records', 'currency_rates', 'cvr_ownership_records', 'dealer_promotions',
  'evidence_class_taxonomy', 'ocr_customs_declarations', 'ocr_national_ids',
  'ocr_registration_books', 'performance_telemetry', 'signature_verification_logs',
  'system_failures', 'vid_inspections', 'zimra_declarations', 'zinara_licensing_records',
];
const FROM_PARITY = [
  'cid_clearance_records', 'cvr_ownership_records', 'ocr_customs_declarations',
  'ocr_national_ids', 'ocr_registration_books', 'performance_telemetry',
  'signature_verification_logs', 'system_failures', 'vid_inspections',
  'zimra_declarations', 'zinara_licensing_records',
];
const ALREADY_ON_STAGING = ['currency_rates', 'dealer_promotions', 'evidence_class_taxonomy'];
const KEEPS_READ = 'evidence_class_taxonomy';

/** Hardened by the publication-gate cutover (apply run 31703872197). */
const CUTOVER_SEVEN = ['mechanic_work_orders', 'mechanic_parts', 'rolling_integrity_checkpoints',
  'trust_score_history', 'vehicle_ownership_history', 'vehicle_evidence', 'vehicles'];
const CUTOVER_EXPECTED = {
  mechanic_work_orders: 'none', mechanic_parts: 'none', rolling_integrity_checkpoints: 'none',
  trust_score_history: 'none', vehicle_ownership_history: 'none',
  vehicle_evidence: 'SELECT', vehicles: 'SELECT',
};

const failures = [];
const results = {};
const fail = (m) => failures.push(m);
const eq = (label, actual, expected) => {
  results[label] = actual;
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
};

function upSectionOf(file) {
  const raw = readFileSync(join(HERE, '..', 'migrations', file), 'utf-8');
  const i = raw.indexOf('-- +migrate Down');
  return (i >= 0 ? raw.slice(0, i) : raw).replace('-- +migrate Up', '');
}

async function asRole(db, role, sql) {
  try {
    await db.exec(`SET ROLE ${role};`); await db.exec(sql); await db.exec('RESET ROLE;');
    return { allowed: true };
  } catch {
    try { await db.exec('RESET ROLE;'); } catch { /* ignore */ }
    return { allowed: false };
  }
}

async function posture(db) {
  const { rows } = await db.query(`
    select c.relname as name, c.relrowsecurity as rls,
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
     where n.nspname = 'public' and c.relkind in ('r','v') order by 1`);
  return Object.fromEntries(rows.map((r) => [r.name, r]));
}

// ═══════════════════════════════════════ staging as it is TODAY, before parity
const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

  CREATE TABLE public.users         (id text PRIMARY KEY, email text);
  CREATE TABLE public.ocr_documents (id text PRIMARY KEY, kind text);
`);

// The cutover-seven, in their HARDENED post-cutover posture. vehicles doubles as a
// parity FK referent, so it must be a real table with a text primary key.
await db.exec(`CREATE TABLE public.vehicles (vin text PRIMARY KEY, make text);`);
for (const t of CUTOVER_SEVEN.filter((t) => t !== 'vehicles')) {
  await db.exec(`CREATE TABLE public.${t} (id bigserial PRIMARY KEY, payload text);`);
}
for (const t of CUTOVER_SEVEN) {
  await db.exec(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
  await db.exec(`REVOKE ALL ON TABLE public.${t} FROM anon, authenticated;`);
  await db.exec(`GRANT ALL ON TABLE public.${t} TO service_role;`);
  if (CUTOVER_EXPECTED[t] === 'SELECT') {
    await db.exec(`GRANT SELECT ON TABLE public.${t} TO anon, authenticated;`);
  }
}

// The three #155 targets staging already holds, in their PRE-hardening exposed state,
// plus evidence_sources and its public projection exactly as #155 expects to find them.
for (const t of ALREADY_ON_STAGING) {
  await db.exec(`CREATE TABLE public.${t} (id bigserial PRIMARY KEY, payload text);`);
  await db.exec(`GRANT ALL ON TABLE public.${t} TO anon, authenticated, service_role;`);
}
await db.exec(`
  CREATE TABLE public.evidence_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text, display_name text, source_type text, organization text, country text,
    verification_status text, trust_tier text, permitted_evidence_classes text[],
    active boolean NOT NULL DEFAULT true,
    contact_reference text, credential_reference text
  );
  INSERT INTO public.evidence_sources (code, display_name, source_type, active,
                                       contact_reference, credential_reference)
  VALUES ('ACTIVE-1','Active Source','registry', true,  'synthetic-contact','synthetic-credential'),
         ('RETIRED-1','Retired Source','registry', false,'synthetic-contact','synthetic-credential');
  CREATE VIEW public.evidence_sources_public AS
    SELECT id, code, display_name, source_type, organization, country,
           verification_status, trust_tier, permitted_evidence_classes, active
      FROM public.evidence_sources WHERE active = true;
  ALTER TABLE public.evidence_sources ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.evidence_sources FROM anon, authenticated;
  GRANT ALL ON TABLE public.evidence_sources TO service_role;
  GRANT ALL ON TABLE public.evidence_sources_public TO anon, authenticated, service_role;
`);

// #155 cannot run yet — that is the problem parity exists to solve. Proving it here
// means the chain below is a real unblock and not a coincidence.
let p0BlockedBefore = false, p0BlockedMsg = '';
try { await db.exec(upSectionOf(P0)); }
catch (e) { p0BlockedBefore = true; p0BlockedMsg = String(e.message || e); }
eq('p0_blocked_before_parity', p0BlockedBefore, true);
eq('p0_blocked_names_missing_targets', /cid_clearance_records/.test(p0BlockedMsg), true);

const beforeParity = await posture(db);

// ═══════════════════════════════════════ apply PARITY
await db.exec('BEGIN;');
await db.exec(upSectionOf(PARITY));
await db.exec('COMMIT;');

const afterParity = await posture(db);

// parity must not have touched anything outside its twelve
const outsideChanged = [...CUTOVER_SEVEN, ...ALREADY_ON_STAGING, 'evidence_sources', 'evidence_sources_public']
  .filter((t) => JSON.stringify(beforeParity[t]) !== JSON.stringify(afterParity[t]));
eq('parity.objects_outside_scope_modified', outsideChanged.length, 0);
if (outsideChanged.length) outsideChanged.forEach((t) => fail(`  parity changed out-of-scope ${t}`));
eq('parity.eleven_targets_now_present',
  FROM_PARITY.filter((t) => afterParity[t]).length, 11);

// ═══════════════════════════════════════ apply #155 VERBATIM
let p0Applied = true, p0Error = '';
try { await db.exec(upSectionOf(P0)); }
catch (e) { p0Applied = false; p0Error = String(e.message || e).split('\n')[0]; }
eq('p0_applies_after_parity_unmodified', p0Applied, true);
if (!p0Applied) fail(`  #155 failed after parity: ${p0Error}`);

const after = await posture(db);

// ═══════════════════════════════════════ #155's published invariants, re-proven
let unintendedWrite = 0, unintendedRead = 0, intentionalRead = 0;
for (const t of FOURTEEN) {
  const a = after[t];
  if (!a) { fail(`${t}: missing after the chain`); continue; }
  if (a.rls !== true) fail(`${t}: RLS not enabled after the chain`);
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
      if (a[role].includes(priv)) { fail(`${t}: ${role} retains ${priv}`); unintendedWrite += 1; }
    }
    if (a[role].includes('TRUNCATE')) fail(`${t}: ${role} retains TRUNCATE`);
    const expectRead = t === KEEPS_READ;
    const hasRead = a[role].includes('SELECT');
    if (expectRead && !hasRead) fail(`${t}: ${role} lost the documented public read`);
    if (!expectRead && hasRead) { fail(`${t}: ${role} unexpectedly retains SELECT`); unintendedRead += 1; }
    if (expectRead && hasRead) intentionalRead += 1;
  }
  for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    if (!a.service_role.includes(priv)) fail(`${t}: service_role LOST ${priv}`);
  }
}
eq('unintended_api_write_exposures_after', unintendedWrite, 0);
eq('unintended_api_read_exposures_after', unintendedRead, 0);
eq('intentional_public_read_surfaces_after', intentionalRead / 2, 1);
eq('service_only_tables_with_select_absent', FOURTEEN.filter((t) =>
  t !== KEEPS_READ && !after[t].anon.includes('SELECT')
  && !after[t].authenticated.includes('SELECT')).length, 13);

// the B3-P0 view remedy still holds after the chain
const { rows: inv } = await db.query(
  `select reloptions::text as o from pg_class where relname = 'evidence_sources_public'`);
eq('evidence_sources_public.security_invoker', /security_invoker=(true|on)/.test(inv[0]?.o || ''), true);

// ═══════════════════════════════════════ cutover-seven regression, both directions
let apiReopened = 0, serviceRoleLost = 0;
for (const t of CUTOVER_SEVEN) {
  const a = after[t];
  const expected = CUTOVER_EXPECTED[t];
  for (const role of ['anon', 'authenticated']) {
    const got = a[role];
    const allowed = expected === 'none' ? [] : expected.split(',');
    const extra = (got === 'none' ? [] : got.split(',')).filter((p) => !allowed.includes(p));
    if (extra.length) { apiReopened += 1; fail(`cutover ${t}: ${role} regained ${extra.join(',')}`); }
    if (expected !== 'none' && !got.includes('SELECT')) {
      fail(`cutover ${t}: ${role} lost the intended SELECT`);
    }
  }
  for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    if (!a.service_role.includes(priv)) { serviceRoleLost += 1; fail(`cutover ${t}: service_role LOST ${priv}`); }
  }
}
eq('cutover_seven.api_reopened', apiReopened, 0);
eq('cutover_seven.service_role_lost', serviceRoleLost, 0);

// ═══════════════════════════════════════ #155 must not have widened public_keys
// public_keys is NOT one of #155's fourteen, so the narrow grant parity gave it must
// survive the chain untouched.
const pk = after.public_keys;
eq('public_keys.untouched_by_p0_anon', pk.anon, 'none');
eq('public_keys.untouched_by_p0_authenticated', pk.authenticated, 'none');
eq('public_keys.narrow_service_grant_survives', pk.service_role, 'INSERT,SELECT,UPDATE');
eq('public_keys.rls_still_enabled', pk.rls, true);

// ═══════════════════════════════════════ behaviour, not only catalog
const anonWrite = await asRole(db, 'anon', `INSERT INTO public.ocr_national_ids (ocr_document_id) VALUES ('x');`);
eq('behaviour.anon_write_denied_after_chain', !anonWrite.allowed, true);
const anonReadTaxonomy = await asRole(db, 'anon', `SELECT 1 FROM public.evidence_class_taxonomy;`);
eq('behaviour.intentional_public_read_still_works', anonReadTaxonomy.allowed, true);
const anonViewWrite = await asRole(db, 'anon',
  `UPDATE public.evidence_sources_public SET display_name='hijacked' WHERE code='ACTIVE-1';`);
eq('behaviour.anon_view_write_denied_after_chain', !anonViewWrite.allowed, true);

// ═══════════════════════════════════════ REPORT
console.log('\nISSUE #101 — PARITY → P0 CHAIN (real PostgreSQL via PGlite)\n');
for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(46)} = ${JSON.stringify(v)}`);
console.log('');
// Explicit teardown and exit — see the note in issue101_parity_check.mjs: an unclosed
// PGlite handle makes the process exit 100 even when every assertion passed.
try { await db.close(); } catch { /* already closed */ }
if (failures.length) {
  console.error(`FAILED — ${failures.length} problem(s):`);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('PASS — #155 was blocked before parity, applies unmodified after it, and every');
console.log('       published invariant plus both cutover-seven regression directions hold.');
process.exit(0);
