/**
 * ISSUE #101 — PRODUCTION SCHEMA-SHAPE PROBE (READ-ONLY, ELEVEN TABLES ONLY).
 *
 * WHY THIS EXISTS. Staging holds only 3 of the 14 tables the merged #155 hardening
 * migration targets; 11 are absent, so #155 cannot be certified on staging. Closing
 * that gap requires creating those 11 on staging to PRODUCTION'S ACTUAL SHAPE.
 *
 * The historical creation sources cannot be trusted for this: five registry and three
 * OCR tables come from scripts/deploy-missing-schemas.js, and the three operational
 * tables from 004_add_tamper_proofing.sql — which is SQLite-flavoured and was never run
 * against Postgres. Production may also have drifted since. So the shape must be
 * MEASURED, not inferred.
 *
 * Probes #1 (31749657530), #2 (31759906271) and #3 (31764853958) collected RLS, grants,
 * policies, roles, views, sequences and functions — but NONE of them collects columns,
 * constraints, indexes or foreign keys. This probe collects exactly that, and only for
 * the eleven named tables.
 *
 * HARD LIMITS, enforced by construction and by test:
 *   · READ-ONLY: BEGIN READ ONLY, asserted from the server, bounded statement_timeout,
 *     ROLLBACK in finally. There is no apply mode and no DDL/DML code path;
 *   · CATALOG METADATA ONLY — no application row is selected, counted or emitted;
 *   · SCOPED: every query is bound to the eleven-table allowlist. No other relation is
 *     reconstructed, and triggers are collected only where attached to these eleven;
 *   · NO FUNCTION IS INVOKED. Trigger function names are recorded, never called;
 *   · identity is asserted and the staging ref refused before connecting;
 *   · the connection string and project ref are never printed.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const STATEMENT_TIMEOUT = '30s';

/** The ONLY relations this probe may inspect. Every query binds to this list. */
export const TARGET_TABLES = [
  'cid_clearance_records',
  'cvr_ownership_records',
  'vid_inspections',
  'zimra_declarations',
  'zinara_licensing_records',
  'ocr_customs_declarations',
  'ocr_national_ids',
  'ocr_registration_books',
  'performance_telemetry',
  'signature_verification_logs',
  'system_failures',
];

export const REQUIRED_SECTIONS = [
  'TABLE_IDENTITY',
  'COLUMNS',
  'CONSTRAINTS',
  'FOREIGN_KEYS',
  'INDEXES',
  'POLICIES',
  'RELATION_ACL',
  'SEQUENCE_DEPENDENCIES',
  'TRIGGERS',
];

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

export class ProbeError extends Error {
  constructor(code) { super(code); this.name = 'ProbeError'; this.code = code; }
}

const KNOWN_ERROR_CLASSES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'AggregateError', 'ProbeError', 'DatabaseError',
]);

export function sanitizeError(err) {
  const rawName = err && err.name != null ? String(err.name) : 'Error';
  const cls = KNOWN_ERROR_CLASSES.has(rawName) ? rawName : 'Error';
  const raw = err && err.code != null ? String(err.code) : '';
  const code = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,30}|[A-Z][A-Z0-9_]{2,31})$/.test(raw) ? raw : 'UNSPECIFIED';
  return `${cls}/${code}`;
}

export function assertProductionIdentity(url, prodRef) {
  if (!url) return { ok: false, reason: 'PRODUCTION_DATABASE_URL is not set.' };
  if (!prodRef || !/^[a-z0-9]{20}$/.test(prodRef)) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.' };
  }
  if (prodRef === STAGING_REF) return { ok: false, reason: 'PRODUCTION_PROJECT_REF is the STAGING ref; refusing.' };
  if (!url.includes(prodRef)) return { ok: false, reason: 'connection string does not reference PRODUCTION_PROJECT_REF; refusing.' };
  if (url.includes(STAGING_REF)) return { ok: false, reason: 'connection string references the STAGING project; refusing.' };
  return { ok: true };
}

function tlsConfig() {
  const supplied = process.env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

export async function collectSchemaShape(client) {
  const s = {};
  const T = [TARGET_TABLES];

  // Which of the eleven exist, plus owner and row-security posture.
  const { rows: identity } = await client.query(`
    select t.name as table_name,
           (to_regclass('public.' || t.name) is not null) as exists,
           c.relkind,
           pg_get_userbyid(c.relowner) as owner,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           c.relpersistence
      from unnest($1::text[]) as t(name)
      left join pg_class c on c.oid = to_regclass('public.' || t.name)
     order by 1`, T);
  s.TABLE_IDENTITY = identity;

  const { rows: columns } = await client.query(`
    select c.table_name, c.ordinal_position, c.column_name,
           c.data_type, c.udt_name, c.is_nullable, c.column_default,
           c.character_maximum_length, c.numeric_precision, c.numeric_scale,
           c.datetime_precision, c.is_identity, c.identity_generation,
           c.is_generated, c.generation_expression, c.collation_name
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = any($1::text[])
     order by c.table_name, c.ordinal_position`, T);
  s.COLUMNS = columns;

  // PK / UNIQUE / CHECK / EXCLUDE, with the canonical definition text.
  const { rows: constraints } = await client.query(`
    select rel.relname as table_name, con.conname as constraint_name,
           con.contype as constraint_type,
           pg_get_constraintdef(con.oid) as definition,
           (select array_agg(a.attname::text order by k.ord)
              from unnest(con.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname = any($1::text[])
       and con.contype in ('p','u','c','x')
     order by 1, 3, 2`, T);
  s.CONSTRAINTS = constraints;

  const { rows: fks } = await client.query(`
    select rel.relname as table_name, con.conname as constraint_name,
           pg_get_constraintdef(con.oid) as definition,
           (select array_agg(a.attname::text order by k.ord)
              from unnest(con.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
           fn.nspname as referenced_schema,
           frel.relname as referenced_table,
           (select array_agg(a.attname::text order by k.ord)
              from unnest(con.confkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as referenced_columns,
           con.confupdtype as on_update, con.confdeltype as on_delete,
           con.confmatchtype as match_type
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_class frel on frel.oid = con.confrelid
      join pg_namespace fn on fn.oid = frel.relnamespace
     where n.nspname = 'public' and rel.relname = any($1::text[]) and con.contype = 'f'
     order by 1, 2`, T);
  s.FOREIGN_KEYS = fks;

  const { rows: indexes } = await client.query(`
    select tablename as table_name, indexname as index_name, indexdef as definition
      from pg_indexes
     where schemaname = 'public' and tablename = any($1::text[])
     order by 1, 2`, T);
  s.INDEXES = indexes;

  const { rows: policies } = await client.query(`
    select rel.relname as table_name, p.polname as policy, p.polcmd as command,
           p.polpermissive as permissive,
           coalesce((select array_agg(r.rolname::text order by r.rolname)
                       from pg_roles r where r.oid = any(p.polroles)), array['PUBLIC']) as roles,
           pg_get_expr(p.polqual, p.polrelid) as using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
      from pg_policy p
      join pg_class rel on rel.oid = p.polrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname = any($1::text[])
     order by 1, 2`, T);
  s.POLICIES = policies;

  // Exact ACL decomposition; grantee 0 IS PUBLIC (a pseudo-grantee, never a pg_roles row).
  const { rows: acl } = await client.query(`
    select rel.relname as table_name,
           (rel.relacl is null) as acl_is_default,
           coalesce((
             select jsonb_agg(distinct jsonb_build_object(
                      'grantee', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
                      'privilege', a.privilege_type))
               from aclexplode(coalesce(rel.relacl, acldefault('r', rel.relowner))) a
           ), '[]'::jsonb) as acl
      from pg_class rel
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname = any($1::text[])
     order by 1`, T);
  s.RELATION_ACL = acl;

  // Sequences owned by / defaulted from these eleven, with their own ACL posture.
  const { rows: seqs } = await client.query(`
    select rel.relname as table_name, a.attname as column_name,
           seq.relname as sequence_name,
           pg_get_userbyid(seq.relowner) as sequence_owner,
           dep.deptype as dependency_type,
           coalesce((
             select jsonb_agg(distinct jsonb_build_object(
                      'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                      'privilege', x.privilege_type))
               from aclexplode(coalesce(seq.relacl, acldefault('S', seq.relowner))) x
           ), '[]'::jsonb) as sequence_acl
      from pg_depend dep
      join pg_class seq on seq.oid = dep.objid and seq.relkind = 'S'
      join pg_class rel on rel.oid = dep.refobjid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
     where n.nspname = 'public' and rel.relname = any($1::text[])
       and dep.deptype in ('a','i')
     order by 1, 2`, T);
  s.SEQUENCE_DEPENDENCIES = seqs;

  // Triggers ONLY where attached to these eleven. Function names are recorded, never invoked.
  const { rows: triggers } = await client.query(`
    select rel.relname as table_name, t.tgname as trigger_name,
           t.tgenabled as enabled,
           (t.tgtype & 1) <> 0 as is_row_level,
           (t.tgtype & 64) <> 0 as is_instead_of,
           t.tgfoid::regprocedure::text as function_signature,
           pg_get_triggerdef(t.oid) as definition
      from pg_trigger t
      join pg_class rel on rel.oid = t.tgrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname = any($1::text[]) and not t.tgisinternal
     order by 1, 2`, T);
  s.TRIGGERS = triggers;

  const present = s.TABLE_IDENTITY.filter((t) => t.exists);
  s.TOTALS = {
    targets_requested: TARGET_TABLES.length,
    targets_present: present.length,
    targets_absent: TARGET_TABLES.length - present.length,
    absent_names: s.TABLE_IDENTITY.filter((t) => !t.exists).map((t) => t.table_name),
    distinct_owners: [...new Set(present.map((t) => t.owner))],
    columns: s.COLUMNS.length,
    constraints: s.CONSTRAINTS.length,
    foreign_keys: s.FOREIGN_KEYS.length,
    indexes: s.INDEXES.length,
    policies: s.POLICIES.length,
    sequences: s.SEQUENCE_DEPENDENCIES.length,
    triggers: s.TRIGGERS.length,
    rls_enabled: present.filter((t) => t.rls_enabled).length,
    rls_forced: present.filter((t) => t.rls_forced).length,
  };
  return s;
}

export function assertComplete(s) {
  const missing = REQUIRED_SECTIONS.filter((k) => !(k in s));
  if (missing.length) return { ok: false, reason: `missing section(s): ${missing.join(', ')}` };
  const notArray = REQUIRED_SECTIONS.filter((k) => !Array.isArray(s[k]));
  if (notArray.length) return { ok: false, reason: `section(s) not arrays: ${notArray.join(', ')}` };
  if (!s.TOTALS || typeof s.TOTALS.targets_present !== 'number') {
    return { ok: false, reason: 'TOTALS is missing or malformed' };
  }
  if (s.TABLE_IDENTITY.length !== TARGET_TABLES.length) {
    return { ok: false, reason: 'TABLE_IDENTITY did not cover all eleven targets' };
  }
  // A shape cannot be reconstructed from nothing: every PRESENT table must have columns.
  const presentWithoutColumns = s.TABLE_IDENTITY
    .filter((t) => t.exists)
    .map((t) => t.table_name)
    .filter((name) => !s.COLUMNS.some((c) => c.table_name === name));
  if (presentWithoutColumns.length) {
    return { ok: false, reason: `no columns captured for present table(s): ${presentWithoutColumns.join(', ')}` };
  }
  // Scope guard: nothing outside the allowlist may appear in any section.
  const allowed = new Set(TARGET_TABLES);
  for (const section of ['COLUMNS', 'CONSTRAINTS', 'FOREIGN_KEYS', 'INDEXES', 'POLICIES', 'RELATION_ACL', 'SEQUENCE_DEPENDENCIES', 'TRIGGERS']) {
    const stray = s[section].map((r) => r.table_name).filter((n) => !allowed.has(n));
    if (stray.length) return { ok: false, reason: `${section} contains out-of-scope relation(s): ${[...new Set(stray)].join(', ')}` };
  }
  return { ok: true };
}

function report(s) {
  const L = console.log;
  L('');
  L('══ TABLE_IDENTITY ══');
  for (const t of s.TABLE_IDENTITY) {
    L(t.exists
      ? `   ${t.table_name.padEnd(30)} EXISTS kind=${t.relkind} owner=${t.owner} rls=${t.rls_enabled} forced=${t.rls_forced}`
      : `   ${t.table_name.padEnd(30)} ABSENT in production`);
  }
  L('');
  L('══ COLUMNS ══');
  let current = null;
  for (const c of s.COLUMNS) {
    if (c.table_name !== current) { current = c.table_name; L(`   ── ${current}`); }
    L(`      ${String(c.ordinal_position).padStart(2)} ${c.column_name.padEnd(30)} ${c.udt_name.padEnd(14)} null=${c.is_nullable} default=${c.column_default ?? '-'} identity=${c.is_identity} generated=${c.is_generated}`);
  }
  L('');
  L('══ CONSTRAINTS ══');
  for (const c of s.CONSTRAINTS) L(`   ${c.table_name}.${c.constraint_name} [${c.constraint_type}] ${c.definition}`);
  L('');
  L('══ FOREIGN_KEYS ══');
  for (const f of s.FOREIGN_KEYS) {
    L(`   ${f.table_name}.${f.constraint_name} -> ${f.referenced_schema}.${f.referenced_table}(${(f.referenced_columns || []).join(',')}) on_update=${f.on_update} on_delete=${f.on_delete}`);
    L(`      ${f.definition}`);
  }
  L('');
  L('══ INDEXES ══');
  for (const i of s.INDEXES) L(`   ${i.definition}`);
  L('');
  L('══ POLICIES ══');
  for (const p of s.POLICIES) L(`   ${p.table_name}.${p.policy} cmd=${p.command} roles=${(p.roles || []).join('|')} using=${p.using_expr ?? '-'}`);
  L(`   count = ${s.POLICIES.length}`);
  L('');
  L('══ RELATION_ACL ══');
  for (const a of s.RELATION_ACL) L(`   ${a.table_name} acl_default=${a.acl_is_default} ${JSON.stringify(a.acl)}`);
  L('');
  L('══ SEQUENCE_DEPENDENCIES ══');
  for (const q of s.SEQUENCE_DEPENDENCIES) L(`   ${q.table_name}.${q.column_name} -> ${q.sequence_name} owner=${q.sequence_owner} dep=${q.dependency_type} acl=${JSON.stringify(q.sequence_acl)}`);
  L('');
  L('══ TRIGGERS (attached to these eleven only) ══');
  for (const t of s.TRIGGERS) L(`   ${t.table_name}.${t.trigger_name} fn=${t.function_signature} enabled=${t.enabled} row=${t.is_row_level}`);
  L(`   count = ${s.TRIGGERS.length}`);
  L('');
  L('══ TOTALS ══');
  for (const [k, v] of Object.entries(s.TOTALS)) L(`   ${k} = ${Array.isArray(v) ? JSON.stringify(v) : v}`);
}

async function main() {
  const url = process.env.PRODUCTION_DATABASE_URL;
  const prodRef = process.env.PRODUCTION_PROJECT_REF;
  const identity = assertProductionIdentity(url, prodRef);
  if (!identity.ok) fail(identity.reason);
  console.log('Production identity asserted (ref matched; staging ref refused). Credentials are never printed.');
  console.log(`Scope: ${TARGET_TABLES.length} named tables only — no other relation is inspected.`);

  const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), application_name: 'issue-101-schema-shape' });
  await client.connect();
  console.log('Connected (mode=schema-shape, READ ONLY).');

  let s;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const { rows: ro } = await client.query('show transaction_read_only');
    if (ro[0]?.transaction_read_only !== 'on') throw new ProbeError('TRANSACTION_NOT_READ_ONLY');
    console.log(`Server confirms transaction_read_only=${ro[0].transaction_read_only}; statement_timeout=${STATEMENT_TIMEOUT}.`);
    s = await collectSchemaShape(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    await client.end();
  }

  const complete = assertComplete(s);
  if (!complete.ok) fail(`SCHEMA-SHAPE PROBE INCOMPLETE — ${complete.reason}`);

  report(s);
  console.log('');
  console.log('ISSUE_101_SCHEMA_SHAPE_JSON_BEGIN');
  console.log(JSON.stringify(s, null, 2));
  console.log('ISSUE_101_SCHEMA_SHAPE_JSON_END');
  console.log('');
  console.log('SCHEMA-SHAPE PROBE COMPLETE — nothing was written. Catalog metadata only; no application rows were read; no function was invoked.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => fail(`schema-shape probe failed (sanitized): ${sanitizeError(err)}`));
}
