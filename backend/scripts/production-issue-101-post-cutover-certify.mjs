/**
 * ISSUE #101 — PRODUCTION POST-CUTOVER CERTIFICATION (READ-ONLY).
 *
 * The cutover run (31808473195) certified itself as it applied. This is the INDEPENDENT
 * confirmation, and it closes the three gaps that self-certification left open:
 *
 *   · the fourteen were measured for ordinary DML only — REFERENCES, TRIGGER and
 *     MAINTAIN were never checked, and MAINTAIN is exactly the PostgreSQL 17 privilege
 *     production was measured carrying;
 *   · evidence_sources_public was checked for security_invoker but not for its exact
 *     ACL, its base-table policy, or which columns it actually projects;
 *   · cutover-seven was never re-measured after the change.
 *
 * THERE IS NO APPLY PATH. This script has no MODE, no phrase gate and no branch that
 * writes. It opens BEGIN READ ONLY, asserts transaction_read_only from the SERVER,
 * bounds statement_timeout, and ROLLBACKs in finally.
 *
 * CATALOG METADATA ONLY. Not one application row is selected, counted or emitted, and
 * no column VALUE is ever read — so no key material can be observed. Every query reads
 * pg_catalog or information_schema; a test asserts none reads FROM a public relation.
 *
 * The production ref is pinned BY SHA256 rather than in plaintext, so no production
 * identifier enters an executable path; the staging ref is refused by the same means.
 */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATEMENT_TIMEOUT = '60s';

/** ALL EIGHT table privileges PostgreSQL 17 tracks. MAINTAIN is the one that matters. */
export const ALL_TABLE_PRIVILEGES = Object.freeze([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN',
]);

export const FOURTEEN = Object.freeze([
  'cid_clearance_records', 'currency_rates', 'cvr_ownership_records', 'dealer_promotions',
  'evidence_class_taxonomy', 'ocr_customs_declarations', 'ocr_national_ids',
  'ocr_registration_books', 'performance_telemetry', 'signature_verification_logs',
  'system_failures', 'vid_inspections', 'zimra_declarations', 'zinara_licensing_records',
]);
/** The ONLY one of the fourteen that keeps a public read, and only SELECT. */
export const KEEPS_PUBLIC_READ = 'evidence_class_taxonomy';

export const CUTOVER_SEVEN = Object.freeze({
  mechanic_work_orders: 'none', mechanic_parts: 'none', rolling_integrity_checkpoints: 'none',
  trust_score_history: 'none', vehicle_ownership_history: 'none',
  vehicle_evidence: 'SELECT', vehicles: 'SELECT',
});

/** public_keys target posture. */
export const PUBLIC_KEYS_SERVICE_ROLE_EXPECTED = 'INSERT,SELECT,UPDATE';
export const PUBLIC_KEYS_SERVICE_ROLE_ABSENT = Object.freeze([
  'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN',
]);

/** The ten columns evidence_sources_public is supposed to project. */
export const VIEW_PROJECTED_COLUMNS = Object.freeze([
  'id', 'code', 'display_name', 'source_type', 'organization', 'country',
  'verification_status', 'trust_tier', 'permitted_evidence_classes', 'active',
]);
/** The two the view exists to hide. */
export const VIEW_HIDDEN_COLUMNS = Object.freeze(['contact_reference', 'credential_reference']);

/** Refs pinned by hash: no production identifier in an executable path. */
export const PRODUCTION_PROJECT_REF_SHA256 = '642e27dacd0666b76e6cd3cdac900481ea8aae3be56bf2971b153a0deeb2ac1b';
export const STAGING_PROJECT_REF_SHA256 = '96fafb02439f5a4bbef8ef21a674e3a9609cece81751f114c4e12f9e675ae3ce';
export const refHash = (v) => createHash('sha256').update(String(v)).digest('hex');

export class CertifyError extends Error {
  constructor(code) { super(code); this.name = 'CertifyError'; this.code = code; }
}

const KNOWN_ERROR_CLASSES = new Set(['Error', 'TypeError', 'RangeError', 'CertifyError', 'AggregateError']);
export function sanitizeError(err) {
  const name = KNOWN_ERROR_CLASSES.has(err?.name) ? err.name : 'Error';
  const code = typeof err?.code === 'string' && /^[0-9A-Z_]{1,32}$/.test(err.code) ? err.code : 'unknown';
  return `${name}(${code})`;
}

export function assertProductionIdentity(url, prodRef) {
  if (!url) return { ok: false, reason: 'PRODUCTION_DATABASE_URL is not set' };
  if (!prodRef) return { ok: false, reason: 'PRODUCTION_PROJECT_REF is not set' };
  const supplied = refHash(prodRef);
  if (supplied === STAGING_PROJECT_REF_SHA256) {
    return { ok: false, reason: 'refusing to run: the supplied ref is the STAGING project' };
  }
  if (supplied !== PRODUCTION_PROJECT_REF_SHA256) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF does not match the pinned production ref' };
  }
  if (!url.includes(prodRef)) {
    return { ok: false, reason: 'the connection string does not contain the pinned production ref' };
  }
  for (const m of String(url).matchAll(/\b([a-z]{20})\b/g)) {
    const h = refHash(m[1]);
    if (h === STAGING_PROJECT_REF_SHA256) {
      return { ok: false, reason: 'refusing to run: the connection string points at the STAGING project' };
    }
    if (h !== PRODUCTION_PROJECT_REF_SHA256) {
      return { ok: false, reason: 'the connection string contains an unrecognised project ref' };
    }
  }
  return { ok: true };
}

const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
const many = async (c, sql, p) => (await c.query(sql, p)).rows;

/**
 * Collect the whole post-cutover picture. Every statement below reads pg_catalog or
 * information_schema. None reads a public relation, so no row and no key value is seen.
 */
export async function collectCertification(client) {
  const s = {};

  s.SERVER = await one(client,
    `select current_database() as db, current_user as usr,
            (select setting from pg_settings where name='server_version') as server_version`);

  // ── 1. the fourteen, across ALL EIGHT for both API roles
  s.FOURTEEN = await many(client,
    `select c.relname as table_name,
            c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
            (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
                       where has_table_privilege('anon', c.oid, pr)),'none') as anon,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
                       where has_table_privilege('authenticated', c.oid, pr)),'none') as authenticated,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
                       where has_table_privilege('service_role', c.oid, pr)),'none') as service_role
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname = any($1::text[])
      order by 1`, [FOURTEEN, ALL_TABLE_PRIVILEGES]);

  // ── 2. public_keys, all eight again
  s.PUBLIC_KEYS = await one(client,
    `select c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
            (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies,
            coalesce((select string_agg(pr,',' order by pr) from unnest($1::text[]) pr
                       where has_table_privilege('anon', c.oid, pr)),'none') as anon,
            coalesce((select string_agg(pr,',' order by pr) from unnest($1::text[]) pr
                       where has_table_privilege('authenticated', c.oid, pr)),'none') as authenticated,
            coalesce((select string_agg(pr,',' order by pr) from unnest($1::text[]) pr
                       where has_table_privilege('service_role', c.oid, pr)),'none') as service_role,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
                       where has_table_privilege('service_role', c.oid, pr)),'') as service_role_withheld_but_present
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='public_keys'`,
    [ALL_TABLE_PRIVILEGES, PUBLIC_KEYS_SERVICE_ROLE_ABSENT]);

  // ── 3. evidence_sources_public: security_invoker, exact ACL, base policy, projection
  s.VIEW = await one(client,
    `select c.reloptions::text as reloptions,
            (c.reloptions is not null and 'security_invoker=true' = any(c.reloptions)) as security_invoker,
            c.relkind::text as relkind,
            pg_get_userbyid(c.relowner) as owner,
            (select jsonb_agg(jsonb_build_object(
                'grantor', pg_get_userbyid(a.grantor),
                'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                'privilege_type', a.privilege_type,
                'is_grantable', a.is_grantable) order by a.grantee, a.privilege_type)
               from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a) as acl,
            (c.relacl is null) as acl_is_default
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='evidence_sources_public'`);

  s.VIEW_COLUMNS = (await many(client,
    `select column_name, ordinal_position::int as ordinal_position
       from information_schema.columns
      where table_schema='public' and table_name='evidence_sources_public'
      order by ordinal_position`)).map((r) => r.column_name);

  s.EVIDENCE_SOURCES = await one(client,
    `select c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
            coalesce((select string_agg(pr,',' order by pr) from unnest($1::text[]) pr
                       where has_table_privilege('anon', c.oid, pr)),'none') as anon_table_level,
            (select jsonb_agg(jsonb_build_object(
                'policy', p.polname,
                'command', case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                                         when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
                'roles', (select array_agg(pg_get_userbyid(r) order by r) from unnest(p.polroles) r),
                'using', pg_get_expr(p.polqual, p.polrelid)) order by p.polname)
               from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='evidence_sources'`, [ALL_TABLE_PRIVILEGES]);

  // column-level grants are what actually hide contact_reference / credential_reference
  s.EVIDENCE_SOURCES_COLUMN_GRANTS = await many(client,
    `select a.attname as column_name,
            coalesce((select string_agg(r, ',' order by r) from unnest(array['anon','authenticated']) r
                       where has_column_privilege(r, c.oid, a.attname, 'SELECT')),'none') as select_granted_to
       from pg_attribute a join pg_class c on c.oid=a.attrelid
       join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='evidence_sources'
        and a.attnum > 0 and not a.attisdropped
      order by a.attnum`);

  // ── 4. cutover-seven
  s.CUTOVER_SEVEN = await many(client,
    `select c.relname as table_name, c.relrowsecurity as rls,
            (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies,
            coalesce((select string_agg(pr,',' order by pr)
                       from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr
                      where has_table_privilege('anon', c.oid, pr)),'none') as anon,
            coalesce((select string_agg(pr,',' order by pr)
                       from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr
                      where has_table_privilege('authenticated', c.oid, pr)),'none') as authenticated,
            coalesce((select string_agg(pr,',' order by pr)
                       from unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr
                      where has_table_privilege('service_role', c.oid, pr)),'none') as service_role,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
                       where has_table_privilege('anon', c.oid, pr)),'none') as anon_all_eight
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname = any($1::text[])
      order by 1`, [Object.keys(CUTOVER_SEVEN), ALL_TABLE_PRIVILEGES]);

  return s;
}

/** Turn the collected picture into pass/fail verdicts. Pure — no database access. */
export function evaluate(s) {
  const problems = [];
  const m = {};

  // ── the fourteen
  const f = s.FOURTEEN;
  m.fourteen_present = f.length;
  if (f.length !== FOURTEEN.length) problems.push(`only ${f.length}/${FOURTEEN.length} targets present`);

  m.fourteen_rls_on = f.filter((t) => t.rls).length;
  if (m.fourteen_rls_on !== FOURTEEN.length) problems.push(`RLS enabled on only ${m.fourteen_rls_on}/14`);
  m.fourteen_force_rls_on = f.filter((t) => t.force_rls).length;

  let anyApiPriv = 0; let unintendedRead = 0; let intentionalRead = 0; let svcLost = 0;
  for (const t of f) {
    const isTaxonomy = t.table_name === KEEPS_PUBLIC_READ;
    for (const role of ['anon', 'authenticated']) {
      const held = t[role] === 'none' ? [] : t[role].split(',');
      const allowed = isTaxonomy ? ['SELECT'] : [];
      const extra = held.filter((p) => !allowed.includes(p));
      if (extra.length) {
        anyApiPriv += extra.length;
        problems.push(`${t.table_name}: ${role} retains ${extra.join(',')}`);
        if (extra.includes('SELECT')) unintendedRead += 1;
      }
      if (isTaxonomy) {
        if (held.includes('SELECT')) intentionalRead += 1;
        else problems.push(`${t.table_name}: ${role} lost the documented public read`);
      }
    }
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      if (!t.service_role.split(',').includes(p)) { svcLost += 1; problems.push(`${t.table_name}: service_role LOST ${p}`); }
    }
  }
  m.fourteen_unexpected_api_privileges_all_eight = anyApiPriv;
  m.unintended_api_read_exposures_after = unintendedRead;
  m.intentional_public_read_surfaces_after = intentionalRead / 2;
  m.service_only_tables_with_select_absent = f.filter((t) =>
    t.table_name !== KEEPS_PUBLIC_READ
    && !t.anon.split(',').includes('SELECT')
    && !t.authenticated.split(',').includes('SELECT')).length;
  m.fourteen_service_role_lost = svcLost;

  if (m.intentional_public_read_surfaces_after !== 1) problems.push('intentional public read surfaces != 1');
  if (m.service_only_tables_with_select_absent !== 13) problems.push('service-only tables with SELECT absent != 13');

  // ── public_keys
  const pk = s.PUBLIC_KEYS;
  m.public_keys = {
    rls: pk?.rls, force_rls: pk?.force_rls, policies: pk?.policies,
    anon: pk?.anon, authenticated: pk?.authenticated, service_role: pk?.service_role,
    withheld_but_present: pk?.service_role_withheld_but_present,
  };
  if (!pk) problems.push('public_keys is absent');
  else {
    if (pk.rls !== true) problems.push('public_keys: RLS not enabled');
    if (pk.policies !== 0) problems.push(`public_keys: ${pk.policies} policies, expected 0`);
    if (pk.anon !== 'none') problems.push(`public_keys: anon retains ${pk.anon}`);
    if (pk.authenticated !== 'none') problems.push(`public_keys: authenticated retains ${pk.authenticated}`);
    if (pk.service_role !== PUBLIC_KEYS_SERVICE_ROLE_EXPECTED) {
      problems.push(`public_keys: service_role is ${pk.service_role}, expected ${PUBLIC_KEYS_SERVICE_ROLE_EXPECTED}`);
    }
    if (pk.service_role_withheld_but_present !== '') {
      problems.push(`public_keys: service_role retains withheld ${pk.service_role_withheld_but_present}`);
    }
  }

  // ── evidence_sources_public
  const v = s.VIEW;
  m.view = { relkind: v?.relkind, security_invoker: v?.security_invoker, reloptions: v?.reloptions };
  if (!v) problems.push('evidence_sources_public is absent');
  else {
    if (v.relkind !== 'v') problems.push(`evidence_sources_public relkind is ${v.relkind}, expected v`);
    if (v.security_invoker !== true) problems.push('evidence_sources_public: security_invoker is not true');
    const apiGrants = (v.acl || []).filter((a) => ['anon', 'authenticated'].includes(a.grantee));
    m.view_api_grants = apiGrants.map((a) => `${a.grantee}:${a.privilege_type}`).sort();
    const nonSelect = apiGrants.filter((a) => a.privilege_type !== 'SELECT');
    if (nonSelect.length) {
      problems.push(`evidence_sources_public: API roles hold ${nonSelect.map((a) => `${a.grantee}.${a.privilege_type}`).join(',')}`);
    }
    for (const role of ['anon', 'authenticated']) {
      if (!apiGrants.some((a) => a.grantee === role && a.privilege_type === 'SELECT')) {
        problems.push(`evidence_sources_public: ${role} lost SELECT`);
      }
    }
    if ((v.acl || []).some((a) => a.is_grantable)) problems.push('evidence_sources_public: a grant is grantable');
  }

  m.view_columns = s.VIEW_COLUMNS;
  const missingProjected = VIEW_PROJECTED_COLUMNS.filter((c) => !(s.VIEW_COLUMNS || []).includes(c));
  const leakedHidden = VIEW_HIDDEN_COLUMNS.filter((c) => (s.VIEW_COLUMNS || []).includes(c));
  if (missingProjected.length) problems.push(`view is missing projected column(s): ${missingProjected.join(',')}`);
  if (leakedHidden.length) problems.push(`view PROJECTS hidden column(s): ${leakedHidden.join(',')}`);
  m.view_hidden_columns_absent = leakedHidden.length === 0;

  const es = s.EVIDENCE_SOURCES;
  m.evidence_sources = { rls: es?.rls, policies: es?.policies };
  if (!es) problems.push('evidence_sources is absent');
  else {
    if (es.rls !== true) problems.push('evidence_sources: RLS not enabled');
    const pols = es.policies || [];
    const readPolicy = pols.find((p) => p.policy === 'evidence_sources_public_read');
    if (!readPolicy) problems.push('evidence_sources: the base read policy is absent');
    else {
      m.evidence_sources_base_policy = readPolicy;
      if (!/active\s*=\s*true/.test(readPolicy.using || '')) {
        problems.push(`evidence_sources: base policy USING is ${readPolicy.using}, expected active = true`);
      }
      if (readPolicy.command !== 'SELECT') problems.push('evidence_sources: base policy is not SELECT-only');
    }
  }

  const hidden = (s.EVIDENCE_SOURCES_COLUMN_GRANTS || [])
    .filter((c) => VIEW_HIDDEN_COLUMNS.includes(c.column_name));
  m.evidence_sources_hidden_column_grants = hidden;
  for (const c of hidden) {
    if (c.select_granted_to !== 'none') {
      problems.push(`evidence_sources.${c.column_name} is SELECT-able by ${c.select_granted_to}`);
    }
  }

  // ── cutover-seven
  let reopened = 0; let lost = 0;
  for (const t of s.CUTOVER_SEVEN || []) {
    const expected = CUTOVER_SEVEN[t.table_name];
    for (const role of ['anon', 'authenticated']) {
      const held = t[role] === 'none' ? [] : t[role].split(',');
      const allowed = expected === 'none' ? [] : expected.split(',');
      const extra = held.filter((p) => !allowed.includes(p));
      if (extra.length) { reopened += 1; problems.push(`cutover ${t.table_name}: ${role} regained ${extra.join(',')}`); }
      if (expected !== 'none' && !held.includes('SELECT')) {
        problems.push(`cutover ${t.table_name}: ${role} lost the intended SELECT`);
      }
    }
    if (t.service_role !== 'DELETE,INSERT,SELECT,UPDATE') {
      lost += 1; problems.push(`cutover ${t.table_name}: service_role is ${t.service_role}`);
    }
  }
  m.cutover_seven_present = (s.CUTOVER_SEVEN || []).length;
  m.cutover_seven_api_reopened = reopened;
  m.cutover_seven_service_role_lost = lost;

  return { ok: problems.length === 0, metrics: m, problems };
}

// ───────────────────────────────────────────────────────────── entry point

function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

function tlsConfig() {
  const supplied = process.env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(join(HERE, '..', '..', 'database', 'certs', 'supabase-prod-ca-2021.crt'), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA.');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

function report(s, verdict) {
  const L = console.log;
  L('');
  L('══ THE FOURTEEN (all eight PostgreSQL 17 privileges) ══');
  L('   %-30s %-4s %-6s %-4s %-8s %-14s %s'.replace(/%-?\d*s/g, (x) => x),
    'table', 'rls', 'force', 'pol', 'anon', 'authenticated', 'service_role');
  for (const t of s.FOURTEEN) {
    L(`   ${t.table_name.padEnd(30)} ${String(t.rls).padEnd(5)} ${String(t.force_rls).padEnd(6)} `
      + `${String(t.policies).padEnd(4)} ${t.anon.padEnd(8)} ${t.authenticated.padEnd(14)} ${t.service_role}`);
  }
  L('');
  L('══ public_keys ══');
  for (const [k, v] of Object.entries(s.PUBLIC_KEYS || {})) L(`   ${k.padEnd(36)} ${JSON.stringify(v)}`);
  L('');
  L('══ evidence_sources_public ══');
  L(`   relkind=${s.VIEW?.relkind} security_invoker=${s.VIEW?.security_invoker} reloptions=${s.VIEW?.reloptions}`);
  L(`   projected columns (${s.VIEW_COLUMNS?.length}): ${(s.VIEW_COLUMNS || []).join(', ')}`);
  L(`   exact ACL: ${JSON.stringify(s.VIEW?.acl)}`);
  L('');
  L('══ evidence_sources (base) ══');
  L(`   rls=${s.EVIDENCE_SOURCES?.rls} policies=${JSON.stringify(s.EVIDENCE_SOURCES?.policies)}`);
  L('   hidden-column grants:');
  for (const c of s.EVIDENCE_SOURCES_COLUMN_GRANTS || []) {
    if (VIEW_HIDDEN_COLUMNS.includes(c.column_name)) L(`     ${c.column_name.padEnd(24)} SELECT granted to: ${c.select_granted_to}`);
  }
  L('');
  L('══ CUTOVER-SEVEN ══');
  for (const t of s.CUTOVER_SEVEN || []) {
    L(`   ${t.table_name.padEnd(30)} rls=${String(t.rls).padEnd(5)} pol=${String(t.policies).padEnd(3)} `
      + `anon=${t.anon.padEnd(8)} auth=${t.authenticated.padEnd(8)} svc=${t.service_role}`);
  }
  L('');
  L('══ VERDICT ══');
  for (const [k, v] of Object.entries(verdict.metrics)) {
    if (typeof v !== 'object') L(`   ${k.padEnd(46)} = ${v}`);
  }
}

async function main() {
  const identity = assertProductionIdentity(process.env.PRODUCTION_DATABASE_URL, process.env.PRODUCTION_PROJECT_REF);
  if (!identity.ok) fail(identity.reason);
  console.log('Production identity asserted; the staging ref is refused. Credentials are never printed.');
  console.log('READ-ONLY certification. This script contains no write path and no mode switch.');

  const client = new pg.Client({
    connectionString: process.env.PRODUCTION_DATABASE_URL,
    ssl: tlsConfig(),
    application_name: 'issue-101-post-cutover-certify',
  });
  await client.connect();

  let s;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const { rows: ro } = await client.query('show transaction_read_only');
    if (ro[0]?.transaction_read_only !== 'on') throw new CertifyError('TRANSACTION_NOT_READ_ONLY');
    console.log(`Server confirms transaction_read_only=${ro[0].transaction_read_only}; statement_timeout=${STATEMENT_TIMEOUT}.`);
    s = await collectCertification(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    await client.end();
  }

  const verdict = evaluate(s);
  report(s, verdict);

  console.log('');
  console.log('ISSUE_101_POST_CUTOVER_CERTIFICATION_JSON_BEGIN');
  console.log(JSON.stringify({ collected: s, verdict }, null, 2));
  console.log('ISSUE_101_POST_CUTOVER_CERTIFICATION_JSON_END');
  console.log('');

  if (!verdict.ok) {
    verdict.problems.forEach((p) => console.error(`::error::${p}`));
    fail(`POST-CUTOVER CERTIFICATION FAILED — ${verdict.problems.length} problem(s). Nothing was written.`);
  }
  console.log('POST-CUTOVER CERTIFICATION PASSED — catalog metadata only; no application row and no key value was read; nothing was written.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => fail(`certification failed (sanitized): ${sanitizeError(err)}`));
}
