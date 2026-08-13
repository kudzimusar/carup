/**
 * ISSUE #101 — PRODUCTION REACHABILITY PROBE #2 (READ-ONLY ONLY).
 *
 * Probe #1 (run 31749657530) established DB AUTHORIZATION: which roles hold which
 * privileges, and — combined with RLS state and pg_policy — which commands
 * PostgreSQL would permit. It did NOT establish REACHABILITY: whether anything on
 * the internet can actually invoke those commands.
 *
 * Authorization is not exploitability. This probe collects the missing evidence
 * needed to separate:
 *   A DB_AUTHZ_EFFECTIVE     PostgreSQL would permit the command for the role
 *   B API_REACHABLE          the PostgREST/API surface can invoke it
 *   C INDIRECTLY_REACHABLE   an RPC / SECURITY DEFINER bridge can invoke it
 *   D DIRECT_SQL_REACHABLE   a direct database session can assume the role
 *
 * Specifically it answers what probe #1 could not: role state (BYPASSRLS, LOGIN,
 * INHERIT, memberships), table ownership, per-policy roles/commands/expressions,
 * connect/usage/SET ROLE paths, full view internals (security_invoker,
 * security_barrier, is_updatable, rules, INSTEAD OF triggers, base relations and
 * their RLS/owner), the sequence inventory with real ACLs, and — for all
 * API-executable functions — language, volatility, dynamic SQL, and whether a body
 * can mutate data, execute DDL, or issue TRUNCATE (an indirect privilege bridge).
 *
 * SAFETY — identical guarantees to probe #1, and no apply mode exists here either:
 *   · no MODE input, no phrase gate, no DDL/DML code path;
 *   · BEGIN READ ONLY, asserted from the server, bounded statement_timeout, ROLLBACK;
 *   · catalog metadata only — zero application-row reads;
 *   · production identity asserted, staging identity refused, before connecting;
 *   · secrets never printed; identity checks yield booleans.
 *
 * CREDENTIAL HYGIENE: function bodies are inspected for classification. A body is
 * NEVER emitted verbatim. If a body appears to embed a credential, the finding is
 * REPORTED as a boolean flag with the function name only, and the text is redacted.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const STATEMENT_TIMEOUT = '30s';

/** Roles whose state decides the reachability answer. */
export const FOCUS_ROLES = ['anon', 'authenticated', 'authenticator', 'service_role', 'postgres'];

export const FOCUS_VIEWS = [
  'communication_inbox_threads',
  'evidence_sources_public',
  'source_verification_coverage_public',
];

export const REQUIRED_SECTIONS = [
  'ROLE_STATE',
  'ROLE_MEMBERSHIPS',
  'CONNECTIVITY',
  'TABLE_STATE',
  'POLICY_DETAIL',
  'VIEW_STATE',
  'SEQUENCE_STATE',
  'FUNCTION_REACHABILITY',
];

/** Heuristics used only to CLASSIFY a body; the body itself is never emitted. */
const MUTATION_RE = /\b(insert\s+into|update\s+\w|delete\s+from|truncate|merge\s+into)\b/i;
const DDL_RE = /\b(create|alter|drop)\s+(table|view|function|index|schema|policy|role|sequence)\b/i;
const TRUNCATE_RE = /\btruncate\b/i;
const DYNAMIC_RE = /\bexecute\s+(format\(|'|"|\w)/i;
const CREDENTIAL_RE = /(password\s*=|postgres:\/\/[^\s]*:[^\s]*@|service_role_key|secret\s*=\s*'|eyJ[A-Za-z0-9_-]{20,})/i;

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

export async function collectReachability(client) {
  const s = {};

  // ---- D: can these roles even hold a session, and do they bypass RLS? -----
  const { rows: roles } = await client.query(`
    select r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin, r.rolinherit,
           r.rolreplication, r.rolconnlimit, (r.rolvaliduntil is not null) as has_valid_until
      from pg_roles r
     where r.rolname = any($1::text[]) or exists (
       select 1 from pg_policy p where r.oid = any(p.polroles))
     order by 1`, [FOCUS_ROLES]);
  s.ROLE_STATE = roles;

  const { rows: members } = await client.query(`
    select m.roleid::regrole::text as role_granted,
           m.member::regrole::text as member,
           m.admin_option
      from pg_auth_members m
     where m.roleid::regrole::text = any($1::text[])
        or m.member::regrole::text = any($1::text[])
     order by 1, 2`, [FOCUS_ROLES]);
  s.ROLE_MEMBERSHIPS = members;

  // CONNECT on the database, USAGE on public — the preconditions for D.
  const { rows: conn } = await client.query(`
    select r.rolname,
           pg_catalog.has_database_privilege(r.rolname, current_database(), 'CONNECT') as db_connect,
           pg_catalog.has_schema_privilege(r.rolname, 'public', 'USAGE')  as public_usage,
           pg_catalog.has_schema_privilege(r.rolname, 'public', 'CREATE') as public_create
      from pg_roles r where r.rolname = any($1::text[]) order by 1`, [FOCUS_ROLES]);
  s.CONNECTIVITY = conn;

  // ---- table state incl. OWNER (probe #1 did not collect ownership) --------
  const { rows: tables } = await client.query(`
    select c.relname as table_name, c.relkind,
           pg_get_userbyid(c.relowner) as owner,
           c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
     order by 1`);
  s.TABLE_STATE = tables;

  const { rows: policies } = await client.query(`
    select c.relname as table_name, p.polname as policy, p.polcmd as command,
           p.polpermissive as permissive,
           coalesce((select array_agg(r.rolname::text order by r.rolname)
                       from pg_roles r where r.oid = any(p.polroles)), array['PUBLIC']) as roles,
           pg_get_expr(p.polqual, p.polrelid) as using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' order by 1, 2`);
  s.POLICY_DETAIL = policies;

  // ---- view internals: the evidence probe #1 lacked -----------------------
  const { rows: views } = await client.query(`
    select c.relname as view_name, c.relkind,
           pg_get_userbyid(c.relowner) as owner, c.reloptions,
           coalesce(c.reloptions::text[] @> array['security_invoker=true'], false) as security_invoker,
           coalesce(c.reloptions::text[] @> array['security_barrier=true'], false) as security_barrier,
           v.is_updatable, v.is_insertable_into,
           v.is_trigger_updatable, v.is_trigger_insertable_into, v.is_trigger_deletable,
           (select count(*) from pg_rewrite w where w.ev_class = c.oid and w.rulename <> '_RETURN')::int as extra_rules,
           (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal)::int as instead_of_triggers
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join information_schema.views v on v.table_schema = n.nspname and v.table_name = c.relname
     where n.nspname = 'public' and c.relkind in ('v','m')
     order by 1`);

  // Base relations each view depends on, with their RLS/owner.
  const { rows: deps } = await client.query(`
    select dependent.relname as view_name,
           base.relname       as base_relation,
           base.relkind       as base_relkind,
           pg_get_userbyid(base.relowner) as base_owner,
           base.relrowsecurity as base_rls_enabled,
           base.relforcerowsecurity as base_rls_forced,
           (select count(*) from pg_policy p where p.polrelid = base.oid)::int as base_policy_count
      from pg_depend d
      join pg_rewrite w   on w.oid = d.objid
      join pg_class dependent on dependent.oid = w.ev_class
      join pg_class base  on base.oid = d.refobjid
      join pg_namespace bn on bn.oid = base.relnamespace
     where d.classid = 'pg_rewrite'::regclass
       and d.refclassid = 'pg_class'::regclass
       and dependent.relkind in ('v','m')
       and base.oid <> dependent.oid
       and bn.nspname = 'public'
     group by 1,2,3,4,5,6,7
     order by 1,2`);

  const depsByView = new Map();
  for (const d of deps) {
    if (!depsByView.has(d.view_name)) depsByView.set(d.view_name, []);
    depsByView.get(d.view_name).push(d);
  }
  s.VIEW_STATE = views.map((v) => ({
    ...v,
    focus: FOCUS_VIEWS.includes(v.view_name),
    base_relations: depsByView.get(v.view_name) || [],
  }));

  // ---- sequences: real ACLs, owner, and owned-by column mapping -----------
  const { rows: seqs } = await client.query(`
    select c.relname as sequence_name,
           pg_get_userbyid(c.relowner) as owner,
           coalesce((select string_agg(pr, ',' order by pr)
                       from unnest(array['USAGE','SELECT','UPDATE']) pr
                      where pg_catalog.has_sequence_privilege('anon', c.oid, pr)), 'none') as anon,
           coalesce((select string_agg(pr, ',' order by pr)
                       from unnest(array['USAGE','SELECT','UPDATE']) pr
                      where pg_catalog.has_sequence_privilege('authenticated', c.oid, pr)), 'none') as authenticated,
           coalesce((select string_agg(pr, ',' order by pr)
                       from unnest(array['USAGE','SELECT','UPDATE']) pr
                      where pg_catalog.has_sequence_privilege('public', c.oid, pr)), 'none') as public,
           coalesce((select string_agg(pr, ',' order by pr)
                       from unnest(array['USAGE','SELECT','UPDATE']) pr
                      where pg_catalog.has_sequence_privilege('service_role', c.oid, pr)), 'none') as service_role,
           (select dc.relname || '.' || a.attname
              from pg_depend dep
              join pg_class dc on dc.oid = dep.refobjid
              join pg_attribute a on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
             where dep.objid = c.oid and dep.deptype in ('a','i') limit 1) as owned_by
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
     order by 1`);
  s.SEQUENCE_STATE = seqs;

  // ---- function reachability: the indirect-bridge question ----------------
  const { rows: fns } = await client.query(`
    select p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_userbyid(p.proowner) as owner,
           p.prosecdef as security_definer,
           l.lanname as language,
           p.provolatile as volatility,
           p.proconfig,
           (select x from unnest(coalesce(p.proconfig, array[]::text[])) x where x like 'search_path=%' limit 1) as search_path,
           pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as exec_anon,
           pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as exec_authenticated,
           pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as exec_public,
           pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as exec_service_role,
           p.prorettype::regtype::text as returns,
           coalesce(p.prosrc, '') as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_language l on l.oid = p.prolang
     where n.nspname = 'public'
     order by 1, 2`);

  s.FUNCTION_REACHABILITY = fns.map((f) => {
    const body = f.body || '';
    // The body is classified, never emitted.
    const credentialSuspected = CREDENTIAL_RE.test(body);
    return {
      function: f.function_name,
      args: f.args,
      owner: f.owner,
      security_definer: f.security_definer,
      language: f.language,
      volatility: f.volatility === 'i' ? 'immutable' : f.volatility === 's' ? 'stable' : 'volatile',
      returns: f.returns,
      search_path: f.search_path ?? null,
      is_trigger_function: f.returns === 'trigger',
      executable_by: ['anon', 'authenticated', 'public', 'service_role']
        .filter((r) => f[`exec_${r}`]),
      api_executable: !!(f.exec_anon || f.exec_authenticated || f.exec_public),
      body_can_mutate: MUTATION_RE.test(body),
      body_can_ddl: DDL_RE.test(body),
      body_can_truncate: TRUNCATE_RE.test(body),
      body_uses_dynamic_sql: DYNAMIC_RE.test(body),
      body_length: body.length,
      credential_suspected_REDACTED: credentialSuspected,
    };
  }).map((f) => ({
    ...f,
    // An indirect privilege bridge = API-callable AND capable of privileged effect
    // AND not a trigger function (a trigger function invoked as an RPC errors out,
    // so its EXECUTE grant is untidy rather than reachable).
    indirect_bridge_candidate: f.api_executable && !f.is_trigger_function &&
      (f.security_definer || f.body_can_mutate || f.body_can_truncate || f.body_can_ddl),
  }));

  s.TOTALS = {
    roles_examined: s.ROLE_STATE.length,
    roles_with_bypassrls: s.ROLE_STATE.filter((r) => r.rolbypassrls).length,
    roles_with_login: s.ROLE_STATE.filter((r) => r.rolcanlogin).length,
    tables: s.TABLE_STATE.length,
    table_owners: [...new Set(s.TABLE_STATE.map((t) => t.owner))].length,
    policies: s.POLICY_DETAIL.length,
    views: s.VIEW_STATE.length,
    views_updatable: s.VIEW_STATE.filter((v) => v.is_updatable === 'YES').length,
    views_with_instead_of_triggers: s.VIEW_STATE.filter((v) => v.instead_of_triggers > 0).length,
    views_with_extra_rules: s.VIEW_STATE.filter((v) => v.extra_rules > 0).length,
    sequences: s.SEQUENCE_STATE.length,
    sequences_anon_update: s.SEQUENCE_STATE.filter((q) => (q.anon || '').includes('UPDATE')).length,
    functions: s.FUNCTION_REACHABILITY.length,
    functions_api_executable: s.FUNCTION_REACHABILITY.filter((f) => f.api_executable).length,
    functions_trigger: s.FUNCTION_REACHABILITY.filter((f) => f.is_trigger_function).length,
    indirect_bridge_candidates: s.FUNCTION_REACHABILITY.filter((f) => f.indirect_bridge_candidate).length,
    functions_credential_suspected: s.FUNCTION_REACHABILITY.filter((f) => f.credential_suspected_REDACTED).length,
  };
  return s;
}

export function assertComplete(s) {
  const missing = REQUIRED_SECTIONS.filter((k) => !(k in s));
  if (missing.length) return { ok: false, reason: `missing section(s): ${missing.join(', ')}` };
  const notArray = REQUIRED_SECTIONS.filter((k) => !Array.isArray(s[k]));
  if (notArray.length) return { ok: false, reason: `section(s) not arrays: ${notArray.join(', ')}` };
  if (!s.TOTALS || typeof s.TOTALS.tables !== 'number') return { ok: false, reason: 'TOTALS malformed' };
  if (s.TOTALS.tables <= 0) return { ok: false, reason: 'zero tables observed — probe did not see a real schema' };
  if (s.ROLE_STATE.length === 0) return { ok: false, reason: 'no role state collected — reachability is undecidable' };
  const seen = new Set(s.VIEW_STATE.filter((v) => v.focus).map((v) => v.view_name));
  const missingViews = FOCUS_VIEWS.filter((v) => !seen.has(v));
  if (missingViews.length) return { ok: false, reason: `focus view(s) not inventoried: ${missingViews.join(', ')}` };
  return { ok: true };
}

function report(s) {
  const L = console.log;
  L('');
  L('══ ROLE_STATE (decides DIRECT_SQL_REACHABLE and RLS bypass) ══');
  for (const r of s.ROLE_STATE) {
    L(`   ${r.rolname}: super=${r.rolsuper} bypassrls=${r.rolbypassrls} canlogin=${r.rolcanlogin} inherit=${r.rolinherit}`);
  }
  L('');
  L('══ ROLE_MEMBERSHIPS (SET ROLE / privilege inheritance paths) ══');
  for (const m of s.ROLE_MEMBERSHIPS) L(`   ${m.member} -> ${m.role_granted} admin=${m.admin_option}`);
  L(`   count = ${s.ROLE_MEMBERSHIPS.length}`);
  L('');
  L('══ CONNECTIVITY ══');
  for (const c of s.CONNECTIVITY) L(`   ${c.rolname}: db_connect=${c.db_connect} public_usage=${c.public_usage} public_create=${c.public_create}`);
  L('');
  L('══ TABLE_STATE (owner + RLS) ══');
  const owners = {};
  for (const t of s.TABLE_STATE) owners[t.owner] = (owners[t.owner] || 0) + 1;
  for (const [o, n] of Object.entries(owners)) L(`   owner ${o}: ${n} tables`);
  L(`   count = ${s.TABLE_STATE.length}`);
  L('');
  L('══ VIEW_STATE (focus views in full) ══');
  for (const v of s.VIEW_STATE.filter((x) => x.focus)) {
    L(`   ${v.view_name}: kind=${v.relkind} owner=${v.owner} security_invoker=${v.security_invoker} security_barrier=${v.security_barrier}`);
    L(`      is_updatable=${v.is_updatable} is_insertable_into=${v.is_insertable_into} trigger_updatable=${v.is_trigger_updatable}`);
    L(`      extra_rules=${v.extra_rules} instead_of_triggers=${v.instead_of_triggers}`);
    for (const b of v.base_relations) {
      L(`      base ${b.base_relation}: owner=${b.base_owner} rls=${b.base_rls_enabled} forced=${b.base_rls_forced} policies=${b.base_policy_count}`);
    }
  }
  L('');
  L('══ SEQUENCE_STATE ══');
  L(`   sequences=${s.TOTALS.sequences} anon_update=${s.TOTALS.sequences_anon_update}`);
  for (const q of s.SEQUENCE_STATE.filter((x) => (x.anon || '').includes('UPDATE')).slice(0, 40)) {
    L(`   ${q.sequence_name} owned_by=${q.owned_by ?? '-'} anon=[${q.anon}] auth=[${q.authenticated}]`);
  }
  L('');
  L('══ FUNCTION_REACHABILITY (API-executable only) ══');
  for (const f of s.FUNCTION_REACHABILITY.filter((x) => x.api_executable)) {
    L(`   ${f.function}(${f.args}) secdef=${f.security_definer} lang=${f.language} returns=${f.returns} trigger_fn=${f.is_trigger_function}`);
    L(`      exec=${f.executable_by.join(',')} search_path=${f.search_path ?? 'UNPINNED'} volatility=${f.volatility}`);
    L(`      can_mutate=${f.body_can_mutate} can_truncate=${f.body_can_truncate} can_ddl=${f.body_can_ddl} dynamic_sql=${f.body_uses_dynamic_sql} BRIDGE=${f.indirect_bridge_candidate}`);
    if (f.credential_suspected_REDACTED) L('      ::warning:: credential-like text detected in body — REDACTED, not emitted');
  }
  L('');
  L('══ TOTALS ══');
  for (const [k, v] of Object.entries(s.TOTALS)) L(`   ${k} = ${v}`);
}

async function main() {
  const url = process.env.PRODUCTION_DATABASE_URL;
  const prodRef = process.env.PRODUCTION_PROJECT_REF;
  const identity = assertProductionIdentity(url, prodRef);
  if (!identity.ok) fail(identity.reason);
  console.log('Production identity asserted (ref matched; staging ref refused). Credentials are never printed.');

  const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), application_name: 'issue-101-reachability' });
  await client.connect();
  console.log('Connected (mode=reachability, READ ONLY).');

  let s;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const { rows: ro } = await client.query('show transaction_read_only');
    if (ro[0]?.transaction_read_only !== 'on') throw new ProbeError('TRANSACTION_NOT_READ_ONLY');
    console.log(`Server confirms transaction_read_only=${ro[0].transaction_read_only}; statement_timeout=${STATEMENT_TIMEOUT}.`);
    s = await collectReachability(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    await client.end();
  }

  const complete = assertComplete(s);
  if (!complete.ok) fail(`REACHABILITY PROBE INCOMPLETE — ${complete.reason}`);

  report(s);
  console.log('');
  console.log('ISSUE_101_REACHABILITY_JSON_BEGIN');
  console.log(JSON.stringify(s, null, 2));
  console.log('ISSUE_101_REACHABILITY_JSON_END');
  console.log('');
  console.log('REACHABILITY PROBE COMPLETE — nothing was written. Catalog metadata only; no application rows were read; no function body was emitted.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => fail(`reachability probe failed (sanitized): ${sanitizeError(err)}`));
}
