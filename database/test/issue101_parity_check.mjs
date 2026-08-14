/**
 * ISSUE #101 — PHASE P2 STAGING PARITY: behavioural proof on real PostgreSQL.
 *
 * The parity migration claims to reproduce twelve production relations exactly. That
 * claim is only worth what it can be shown to do, so this harness runs the real file
 * against a real PostgreSQL (PGlite is PostgreSQL compiled to WASM — a genuine planner,
 * a genuine catalog, genuine RLS and genuine privilege checks) and compares the result
 * COLUMN BY COLUMN against the committed production receipts.
 *
 * The receipts are the same JSON the probes emitted from production, committed under
 * database/parity/receipts/. Nothing here is compared against hand-written expectations
 * — if the migration and the measurement disagree anywhere, this fails.
 *
 * WHAT IS DELIBERATELY NOT COPIED. Production grants anon and authenticated all eight
 * privileges on these tables, including TRUNCATE. Structural parity is reproduced;
 * that ACL posture is not, and this harness proves the divergence is real rather than
 * accidental.
 *
 * NO PRODUCTION DATA. Every row used below is synthetic and local to this process. No
 * production key material exists in this file or is reachable from it.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260814080000_issue101_staging_parity.sql';

const RECEIPTS = join(HERE, '..', 'parity', 'receipts');
const ELEVEN = JSON.parse(readFileSync(join(RECEIPTS, 'production-eleven-run31770747669.json'), 'utf-8'));
const PK = JSON.parse(readFileSync(join(RECEIPTS, 'production-public-keys-run31774496416.json'), 'utf-8'));

const DEPENDENCY_ONLY = ['public_keys'];
const TARGET_PARITY = ELEVEN.TABLE_IDENTITY.map((t) => t.table_name).sort();
const TWELVE = [...DEPENDENCY_ONLY, ...TARGET_PARITY];

/** Staging's eight pre-existing sequences, with the exact permissive ACL measured there. */
const PREEXISTING_SEQUENCES = [
  'blockchain_events_id_seq', 'financial_ledger_id_seq', 'notification_queue_id_seq',
  'organization_audit_logs_id_seq', 'partsentry_logs_id_seq', 'role_switch_logs_id_seq',
  'trust_score_history_id_seq', 'vehicle_ownership_history_id_seq',
];

const failures = [];
const results = {};
const fail = (m) => failures.push(m);
const eq = (label, actual, expected) => {
  results[label] = actual;
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
};

function sectionOf(file, which) {
  const raw = readFileSync(join(HERE, '..', 'migrations', file), 'utf-8');
  const i = raw.indexOf('-- +migrate Down');
  return which === 'up'
    ? (i >= 0 ? raw.slice(0, i) : raw).replace('-- +migrate Up', '')
    : raw.slice(i).replace('-- +migrate Down', '');
}

async function asRole(db, role, sql) {
  try {
    await db.exec(`SET ROLE ${role};`);
    await db.exec(sql);
    await db.exec('RESET ROLE;');
    return { allowed: true, error: null };
  } catch (e) {
    try { await db.exec('RESET ROLE;'); } catch { /* ignore */ }
    return { allowed: false, error: String(e.message || e).split('\n')[0].slice(0, 110) };
  }
}

/**
 * Reproduce governed staging as it actually is: the API roles, a service_role that
 * bypasses RLS, permissive DEFAULT PRIVILEGES (this is why new sequences would be born
 * exposed), the three FK referents with text keys, and the eight pre-existing sequences
 * carrying staging's measured anon=rwU grant.
 */
/** Every instance is tracked so teardown cannot miss one and hang the process. */
const OPEN = [];
async function newDb() { const d = await PGlite.create(); OPEN.push(d); return d; }

async function stagingFixture() {
  const db = await newDb();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    -- Supabase grants these by default, which is precisely why SECTION C has to revoke.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

    CREATE TABLE public.users         (id text PRIMARY KEY, email text);
    CREATE TABLE public.vehicles      (vin text PRIMARY KEY, make text);
    CREATE TABLE public.ocr_documents (id text PRIMARY KEY, kind text);
  `);
  for (const s of PREEXISTING_SEQUENCES) {
    await db.exec(`CREATE SEQUENCE public.${s};`);
  }
  return db;
}

const aclSnapshot = async (db) => {
  const { rows } = await db.query(`
    select c.relname as name, coalesce(array_to_string(c.relacl::text[], '|'), '<default>') as acl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
     order by 1`);
  return Object.fromEntries(rows.map((r) => [r.name, r.acl]));
};

// ═══════════════════════════════════════════════ 1. APPLY AND PROVE STRUCTURE
const db = await stagingFixture();
const seqAclBefore = await aclSnapshot(db);

await db.exec('BEGIN;');
await db.exec(sectionOf(MIGRATION, 'up'));
await db.exec('COMMIT;');

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const many = async (sql, params) => (await db.query(sql, params)).rows;

// ---- objects created
const present = await many(
  `select name from unnest($1::text[]) as name where to_regclass('public.' || name) is not null`, [TWELVE]);
eq('objects_created.dependency_only',
  present.filter((r) => DEPENDENCY_ONLY.includes(r.name)).length, 1);
eq('objects_created.issue101_target_parity',
  present.filter((r) => TARGET_PARITY.includes(r.name)).length, 11);
eq('objects_created.total', present.length, 12);

// ---- column-for-column parity against the production receipts
const receiptColumns = [...ELEVEN.COLUMNS, ...PK.COLUMNS].map((c) => ({
  t: c.table_name, n: c.column_name, o: c.ordinal_position,
  u: c.udt_name, l: c.character_maximum_length, p: c.numeric_precision, s: c.numeric_scale,
  nul: c.is_nullable, d: c.column_default,
}));
const liveColumns = (await many(`
  select table_name as t, column_name as n, ordinal_position::int as o,
         udt_name as u, character_maximum_length::int as l,
         numeric_precision::int as p, numeric_scale::int as s,
         is_nullable as nul, column_default as d
    from information_schema.columns
   where table_schema = 'public' and table_name = any($1::text[])
   order by table_name, ordinal_position`, [TWELVE]));

eq('columns.public_keys', liveColumns.filter((c) => c.t === 'public_keys').length, 8);
eq('columns.eleven', liveColumns.filter((c) => TARGET_PARITY.includes(c.t)).length, 100);
eq('columns.total', liveColumns.length, 108);

const key = (c) => `${c.t}.${c.n}`;
const norm = (c) => JSON.stringify([c.o, c.u, c.l ?? null, c.p ?? null, c.s ?? null, c.nul, c.d ?? null]);
const liveByKey = Object.fromEntries(liveColumns.map((c) => [key(c), c]));
const mismatches = [];
for (const rc of receiptColumns) {
  const lc = liveByKey[key(rc)];
  if (!lc) { mismatches.push(`${key(rc)} MISSING`); continue; }
  if (norm(rc) !== norm(lc)) mismatches.push(`${key(rc)} receipt=${norm(rc)} live=${norm(lc)}`);
}
for (const lc of liveColumns) {
  if (!receiptColumns.some((rc) => key(rc) === key(lc))) mismatches.push(`${key(lc)} UNEXPECTED`);
}
eq('columns.exact_parity_mismatches', mismatches.length, 0);
if (mismatches.length) mismatches.slice(0, 12).forEach((m) => fail(`  column mismatch → ${m}`));

// ---- constraints: every measured PK/UNIQUE/CHECK reproduced, by name and definition
const receiptCons = [...ELEVEN.CONSTRAINTS, ...PK.CONSTRAINTS];
const liveCons = await many(`
  select rel.relname as table_name, con.conname as constraint_name,
         con.contype::text as constraint_type, pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public' and rel.relname = any($1::text[]) and con.contype in ('p','u','c')
   order by 1, 2`, [TWELVE]);
eq('constraints.pk_unique_check', liveCons.length, receiptCons.length); // 25 + 2
const conKey = (c) => `${c.table_name}.${c.constraint_name}`;
/**
 * PostgreSQL does not round-trip a CHECK over a varchar column textually: production
 * renders `= ANY ((ARRAY['a'::character varying, ...])::text[])` while re-parsing that
 * same text yields `= ANY (ARRAY[('a'::character varying)::text, ...])`. The two are the
 * SAME constraint with the casts distributed differently. Comparing raw text here would
 * report seven false mismatches and teach us to ignore this check. Casts and grouping are
 * therefore normalised away, leaving the column, the operator and the literal set — which
 * is what actually has to match. The behavioural CHECK proofs below cover the rest.
 */
const canonCon = (d) => d
  .replace(/::character varying(\[\])?/g, '')
  .replace(/::text(\[\])?/g, '')
  .replace(/[()\s]+/g, '');
const liveConMap = Object.fromEntries(liveCons.map((c) => [conKey(c), c]));
const conMismatch = [];
for (const rc of receiptCons) {
  const lc = liveConMap[conKey(rc)];
  if (!lc) { conMismatch.push(`${conKey(rc)} MISSING`); continue; }
  if (lc.constraint_type !== rc.constraint_type) conMismatch.push(`${conKey(rc)} type ${lc.constraint_type}≠${rc.constraint_type}`);
  if (canonCon(lc.definition) !== canonCon(rc.definition)) {
    conMismatch.push(`${conKey(rc)} def receipt=${rc.definition} live=${lc.definition}`);
  }
}
eq('constraints.definition_mismatches', conMismatch.length, 0);
if (conMismatch.length) conMismatch.slice(0, 8).forEach((m) => fail(`  constraint mismatch → ${m}`));

// ---- foreign keys: 10 from the eleven + 1 from public_keys
const liveFks = await many(`
  select rel.relname as table_name, con.conname as constraint_name,
         pg_get_constraintdef(con.oid) as definition,
         con.confdeltype::text as on_delete, con.confupdtype::text as on_update
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public' and rel.relname = any($1::text[]) and con.contype = 'f'
   order by 1, 2`, [TWELVE]);
eq('foreign_keys.from_eleven', liveFks.filter((f) => TARGET_PARITY.includes(f.table_name)).length, 10);
eq('foreign_keys.public_keys_to_users', liveFks.filter((f) => f.table_name === 'public_keys').length, 1);
eq('foreign_keys.total', liveFks.length, 11);

const receiptFks = [...ELEVEN.FOREIGN_KEYS, ...PK.FOREIGN_KEYS];
const fkMismatch = [];
for (const rf of receiptFks) {
  const lf = liveFks.find((f) => f.constraint_name === rf.constraint_name && f.table_name === rf.table_name);
  if (!lf) { fkMismatch.push(`${rf.table_name}.${rf.constraint_name} MISSING`); continue; }
  if (lf.on_delete !== rf.on_delete) fkMismatch.push(`${rf.constraint_name} on_delete ${lf.on_delete}≠${rf.on_delete}`);
  if (lf.on_update !== rf.on_update) fkMismatch.push(`${rf.constraint_name} on_update ${lf.on_update}≠${rf.on_update}`);
}
eq('foreign_keys.semantic_mismatches', fkMismatch.length, 0);
if (fkMismatch.length) fkMismatch.forEach((m) => fail(`  fk mismatch → ${m}`));

const svlFk = liveFks.find((f) => f.constraint_name === 'signature_verification_logs_public_key_id_fkey');
eq('foreign_keys.svl_to_public_keys_cascade',
  Boolean(svlFk && /REFERENCES public_keys\(id\) ON DELETE CASCADE/.test(svlFk.definition)), true);

// ---- indexes: 9 independent, no constraint-created index duplicated
const liveIdx = await many(`
  select tc.relname as table_name, ic.relname as index_name,
         (con.oid is not null) as constraint_backed
    from pg_class ic
    join pg_index pi on pi.indexrelid = ic.oid
    join pg_class tc on tc.oid = pi.indrelid
    join pg_namespace pn on pn.oid = tc.relnamespace
    left join pg_constraint con on con.conindid = ic.oid
   where pn.nspname = 'public' and tc.relname = any($1::text[])
   order by 1, 2`, [TWELVE]);
const distinctIdx = [...new Set(liveIdx.map((i) => i.index_name))];
// A row here is a (index, constraint) BINDING, not an object. Production's own receipts
// report public_keys_pkey twice for exactly this reason — it backs both its own PRIMARY
// KEY and the incoming FK from signature_verification_logs — so 19 bindings over 18
// distinct constraint-created indexes is parity, not duplication.
const receiptBindings = [...ELEVEN.INDEXES, ...PK.INDEXES];
eq('indexes.independent', liveIdx.filter((i) => !i.constraint_backed).length, 9);
eq('indexes.constraint_binding_rows', liveIdx.filter((i) => i.constraint_backed).length,
  receiptBindings.filter((i) => i.constraint_backed).length); // 17 + 2
eq('indexes.distinct_constraint_created',
  new Set(liveIdx.filter((i) => i.constraint_backed).map((i) => i.index_name)).size, 18);
eq('indexes.physical_objects', distinctIdx.length, 27);
// The dedup claim, stated positively: 18 constraint-created + 9 independent = 27 objects,
// and the ONLY index carrying more than one binding is the one production reports twice.
const multiBound = [...new Set(liveIdx.filter((i) =>
  liveIdx.filter((j) => j.index_name === i.index_name).length > 1).map((i) => i.index_name))];
eq('indexes.multiply_bound', JSON.stringify(multiBound), JSON.stringify(['public_keys_pkey']));
eq('indexes.no_index_created_for_a_constraint',
  new Set(liveIdx.filter((i) => i.constraint_backed).map((i) => i.index_name)).size
  + liveIdx.filter((i) => !i.constraint_backed).length, 27);

const receiptIndependent = [...new Set([...ELEVEN.INDEXES, ...PK.INDEXES]
  .filter((i) => !i.constraint_backed).map((i) => i.index_name))].sort();
const liveIndependent = liveIdx.filter((i) => !i.constraint_backed).map((i) => i.index_name).sort();
eq('indexes.independent_names_match',
  JSON.stringify(liveIndependent) === JSON.stringify(receiptIndependent), true);
if (JSON.stringify(liveIndependent) !== JSON.stringify(receiptIndependent)) {
  fail(`  independent index names: receipt=${receiptIndependent} live=${liveIndependent}`);
}

// ---- sequences: exactly 3 new, structurally identical to production
const liveSeq = await many(`
  select c.relname as sequence_name, s.seqtypid::regtype::text as data_type,
         s.seqstart::text, s.seqincrement::text, s.seqmin::text, s.seqmax::text,
         s.seqcache::text, s.seqcycle,
         d.refobjid::regclass::text as owning_table,
         a.attname as owning_column, d.deptype::text as dependency_type
    from pg_sequence s
    join pg_class c on c.oid = s.seqrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_depend d on d.objid = c.oid and d.classid = 'pg_class'::regclass
                         and d.refclassid = 'pg_class'::regclass and d.deptype = 'a'
    left join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
   where n.nspname = 'public' and c.relname = any($1::text[])
   order by 1`, [ELEVEN.SEQUENCE_DEFINITIONS.map((s) => s.sequence_name)]);
eq('sequences.new_owned', liveSeq.length, 3);
const seqMismatch = [];
for (const rs of ELEVEN.SEQUENCE_DEFINITIONS) {
  const ls = liveSeq.find((s) => s.sequence_name === rs.sequence_name);
  if (!ls) { seqMismatch.push(`${rs.sequence_name} MISSING`); continue; }
  const cmp = [['data_type', 'bigint', ls.data_type], ['start', rs.seqstart, ls.seqstart],
    ['increment', rs.seqincrement, ls.seqincrement], ['min', rs.seqmin, ls.seqmin],
    ['max', rs.seqmax, ls.seqmax], ['cache', rs.seqcache, ls.seqcache],
    ['cycle', rs.seqcycle, ls.seqcycle], ['owning_table', `${rs.owning_table}`, `${ls.owning_table}`],
    ['owning_column', rs.owning_column, ls.owning_column],
    ['dependency', rs.dependency_type, ls.dependency_type]];
  for (const [what, want, got] of cmp) {
    if (String(want) !== String(got)) seqMismatch.push(`${rs.sequence_name}.${what} want=${want} got=${got}`);
  }
}
eq('sequences.structural_mismatches', seqMismatch.length, 0);
if (seqMismatch.length) seqMismatch.forEach((m) => fail(`  sequence mismatch → ${m}`));

// ---- nothing unexpected was created
const liveTriggers = await one(`
  select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname = any($1::text[])`, [TWELVE]);
eq('triggers.created', liveTriggers.n, 0);
const livePolicies = await one(`
  select count(*)::int as n from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = any($1::text[])`, [TWELVE]);
eq('policies.created', livePolicies.n, 0);
const liveCustom = await one(`
  select count(*)::int as n from information_schema.columns
   where table_schema = 'public' and table_name = any($1::text[])
     and (domain_name is not null or (udt_schema is not null and udt_schema <> 'pg_catalog'))`, [TWELVE]);
eq('custom_type_or_domain_dependencies', liveCustom.n, 0);

// ═══════════════════════════════════════════════ 2. SECURITY / DEFAULT-ACL POSTURE
const posture = await many(`
  select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
         has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
         has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
         has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
         has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
         has_table_privilege('anon', c.oid, 'TRUNCATE') as anon_truncate,
         has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
         has_table_privilege('authenticated', c.oid, 'TRUNCATE') as auth_truncate,
         has_table_privilege('service_role', c.oid, 'SELECT') as svc_select,
         has_table_privilege('service_role', c.oid, 'INSERT') as svc_insert,
         has_table_privilege('service_role', c.oid, 'UPDATE') as svc_update
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = any($1::text[]) order by 1`, [TWELVE]);

eq('rls.enabled_on_all_twelve', posture.filter((p) => p.rls).length, 12);
eq('rls.forced_anywhere', posture.filter((p) => p.forced).length, 0);
eq('acl.anon_any_privilege', posture.filter((p) =>
  p.anon_select || p.anon_insert || p.anon_update || p.anon_delete || p.anon_truncate).length, 0);
eq('acl.authenticated_any_privilege', posture.filter((p) => p.auth_select || p.auth_truncate).length, 0);
eq('acl.anon_truncate_present', posture.filter((p) => p.anon_truncate).length, 0);
eq('acl.authenticated_truncate_present', posture.filter((p) => p.auth_truncate).length, 0);
eq('acl.service_role_retained_on_twelve',
  posture.filter((p) => p.svc_select && p.svc_insert && p.svc_update).length, 12);

// public_keys is granted narrowly on purpose: the backend selects, inserts and updates.
// The migration REVOKEs from service_role first, because staging's permissive default
// privileges would otherwise have already handed it ALL and the narrow GRANT would be
// decorative. That is the whole point of this assertion.
const pkPosture = posture.find((p) => p.name === 'public_keys');
eq('public_keys.service_role_delete_withheld',
  !(await one(`select has_table_privilege('service_role','public.public_keys','DELETE') as d`)).d, true);
eq('public_keys.service_role_truncate_withheld',
  !(await one(`select has_table_privilege('service_role','public.public_keys','TRUNCATE') as d`)).d, true);
eq('public_keys.rls_enabled', pkPosture.rls, true);
// The eleven keep the broad service_role grant, matching #155 exactly.
eq('eleven.service_role_delete_retained',
  (await one(`select has_table_privilege('service_role','public.system_failures','DELETE') as d`)).d, true);

// ---- sequence exposure: the three new ones closed, the eight pre-existing untouched
const seqPriv = await many(`
  select c.relname as name,
         has_sequence_privilege('anon', c.oid, 'UPDATE') as anon_update,
         has_sequence_privilege('anon', c.oid, 'SELECT') as anon_select,
         has_sequence_privilege('anon', c.oid, 'USAGE')  as anon_usage,
         has_sequence_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
         has_sequence_privilege('service_role', c.oid, 'USAGE') as svc_usage,
         has_sequence_privilege('service_role', c.oid, 'SELECT') as svc_select
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and c.relname = any($1::text[]) order by 1`,
[ELEVEN.SEQUENCE_DEFINITIONS.map((s) => s.sequence_name)]);
eq('new_parity_sequences_api_exposed',
  seqPriv.filter((s) => s.anon_update || s.anon_select || s.anon_usage || s.auth_update).length, 0);
eq('new_parity_sequences.service_role_usable',
  seqPriv.filter((s) => s.svc_usage && s.svc_select).length, 3);

const seqAclAfter = await aclSnapshot(db);
const changed = PREEXISTING_SEQUENCES.filter((s) => seqAclBefore[s] !== seqAclAfter[s]);
eq('existing_staging_sequences_modified', changed.length, 0);
if (changed.length) changed.forEach((s) => fail(`  sequence ACL changed on pre-existing ${s}`));

// ═══════════════════════════════════════════════ 3. BEHAVIOURAL PROOFS
// Zero rows anywhere — this migration creates structure and nothing else.
let seeded = 0;
for (const t of TWELVE) seeded += (await one(`select count(*)::int as n from public.${t}`)).n;
eq('rows_seeded_by_migration', seeded, 0);

// public_keys: the API roles are denied, and denial is proven by attempting it.
const anonRead = await asRole(db, 'anon', `SELECT * FROM public.public_keys;`);
const anonWrite = await asRole(db, 'anon', `INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at) VALUES ('x','u','pem','t');`);
const anonTrunc = await asRole(db, 'anon', `TRUNCATE public.public_keys;`);
const authRead = await asRole(db, 'authenticated', `SELECT * FROM public.public_keys;`);
eq('public_keys.anon_select_denied', !anonRead.allowed, true);
eq('public_keys.anon_insert_denied', !anonWrite.allowed, true);
eq('public_keys.anon_truncate_denied', !anonTrunc.allowed, true);
eq('public_keys.authenticated_select_denied', !authRead.allowed, true);

// A synthetic user, then the FK behaviours. Everything is rolled back.
await db.exec(`INSERT INTO public.users (id,email) VALUES ('u-synthetic','synthetic@example.invalid');`);

const badFk = await asRole(db, 'service_role',
  `INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at)
   VALUES ('k-bad','u-does-not-exist','SYNTHETIC-NOT-A-KEY','2026-01-01');`);
eq('public_keys.invalid_user_id_rejected', !badFk.allowed, true);

const goodFk = await asRole(db, 'service_role',
  `INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at)
   VALUES ('k-1','u-synthetic','SYNTHETIC-NOT-A-KEY','2026-01-01');`);
eq('public_keys.service_role_insert_allowed', goodFk.allowed, true);
const svcUpd = await asRole(db, 'service_role',
  `UPDATE public.public_keys SET status='REVOKED', revoked_at='2026-01-02' WHERE id='k-1';`);
eq('public_keys.service_role_update_allowed', svcUpd.allowed, true);
const svcSel = await asRole(db, 'service_role', `SELECT id FROM public.public_keys WHERE id='k-1';`);
eq('public_keys.service_role_select_allowed', svcSel.allowed, true);

// The CHECK constraint is live, not decorative.
const badStatus = await asRole(db, 'service_role',
  `INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at,status)
   VALUES ('k-2','u-synthetic','SYNTHETIC-NOT-A-KEY','2026-01-01','NOT_A_STATUS');`);
eq('public_keys.status_check_enforced', !badStatus.allowed, true);

// signature_verification_logs FK + the CASCADE that made public_keys necessary at all.
const svlBad = await asRole(db, 'service_role',
  `INSERT INTO public.signature_verification_logs (payload_hash,signature,public_key_id,timestamp)
   VALUES ('h','s','k-does-not-exist','2026-01-01');`);
eq('svl.invalid_public_key_id_rejected', !svlBad.allowed, true);

const svlGood = await asRole(db, 'service_role',
  `INSERT INTO public.signature_verification_logs (payload_hash,signature,public_key_id,timestamp)
   VALUES ('h','s','k-1','2026-01-01');`);
eq('svl.valid_dependency_accepted', svlGood.allowed, true);

// service_role cannot DELETE from public_keys directly — that privilege was withheld.
const svcDelete = await asRole(db, 'service_role', `DELETE FROM public.public_keys WHERE id='k-1';`);
eq('public_keys.service_role_delete_denied', !svcDelete.allowed, true);

// ...yet the cascade still works, because a referential action runs with the privileges
// of the referencing table's OWNER, not those of the role that issued the DELETE. That
// is the assumption the narrow grant rests on, so it is proven rather than asserted:
// deleting the parent users row must remove the public_keys row AND, through the second
// cascade, its signature_verification_logs child.
const beforeCascade = (await one(`select count(*)::int as n from public.signature_verification_logs`)).n;
const cascadeDelete = await asRole(db, 'service_role', `DELETE FROM public.users WHERE id='u-synthetic';`);
eq('cascade.driven_by_service_role_allowed', cascadeDelete.allowed, true);
const afterCascade = (await one(`select count(*)::int as n from public.signature_verification_logs`)).n;
const pkLeft = (await one(`select count(*)::int as n from public.public_keys`)).n;
eq('cascade.users_to_public_keys', pkLeft, 0);
eq('svl.on_delete_cascade_matches_production', beforeCascade === 1 && afterCascade === 0, true);

// service_role can actually drive the sequences it was granted.
const seqUse = await asRole(db, 'service_role',
  `INSERT INTO public.system_failures (error_message,timestamp) VALUES ('synthetic','2026-01-01');`);
eq('sequences.service_role_operation_works', seqUse.allowed, true);

// Clean the synthetic fixture rows back out so the harness leaves nothing behind.
await db.exec(`DELETE FROM public.system_failures;`);

// ═══════════════════════════════════════════════ 4. WRONG-ENVIRONMENT / RE-APPLY
// A second apply must not silently succeed. Neither must an apply against a database
// that already holds one of the twelve — which is exactly production's state.
const reapply = await (async () => {
  try { await db.exec('BEGIN;'); await db.exec(sectionOf(MIGRATION, 'up')); await db.exec('COMMIT;'); return { refused: false, code: null, message: '' }; }
  catch (e) { try { await db.exec('ROLLBACK;'); } catch { /* ignore */ } return { refused: true, code: e.code || null, message: String(e.message || e) }; }
})();
eq('reapply.refused', reapply.refused, true);
eq('reapply.errcode_duplicate_table', reapply.code, '42P07');
// It must be the PRECONDITION that refuses, not CREATE TABLE tripping over the first
// object it happens to hit. Mutation-testing showed the two are indistinguishable by
// exit code alone: deleting the precondition entirely still yields a refusal and a
// rollback, because the migration is atomic. The difference is diagnosability — the
// precondition names EVERY conflicting relation up front — so the message is asserted.
eq('reapply.refused_by_precondition', /\[issue-101-p2\]/.test(reapply.message), true);
eq('reapply.names_all_conflicts',
  TWELVE.every((t) => reapply.message.includes(t)), true);

// Production-like: ONE of the twelve already exists. Nothing may be created.
const prodLike = await stagingFixture();
await prodLike.exec(`CREATE TABLE public.system_failures (id bigserial primary key, note text);`);
const beforeCount = (await prodLike.query(
  `select count(*)::int as n from unnest($1::text[]) as name where to_regclass('public.'||name) is not null`,
  [TWELVE])).rows[0].n;
let prodRefused = false, prodCode = null, prodMsg = '';
try { await prodLike.exec('BEGIN;'); await prodLike.exec(sectionOf(MIGRATION, 'up')); await prodLike.exec('COMMIT;'); }
catch (e) { prodRefused = true; prodCode = e.code || null; prodMsg = String(e.message || e); try { await prodLike.exec('ROLLBACK;'); } catch { /* ignore */ } }
const afterCount = (await prodLike.query(
  `select count(*)::int as n from unnest($1::text[]) as name where to_regclass('public.'||name) is not null`,
  [TWELVE])).rows[0].n;
eq('production_like.refused', prodRefused, true);
eq('production_like.errcode_duplicate_table', prodCode, '42P07');
eq('production_like.refused_by_precondition', /\[issue-101-p2\]/.test(prodMsg), true);
eq('production_like.names_the_conflict', /system_failures/.test(prodMsg), true);
eq('production_like.nothing_created', afterCount, beforeCount);

// A missing FK referent must also fail loud, before anything is built.
const noReferent = await newDb();
await noReferent.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE TABLE public.users (id text PRIMARY KEY);
  CREATE TABLE public.vehicles (vin text PRIMARY KEY);
`); // ocr_documents deliberately absent
let referentRefused = false, referentMsg = '';
try { await noReferent.exec(sectionOf(MIGRATION, 'up')); }
catch (e) { referentRefused = true; referentMsg = String(e.message || e); }
eq('missing_referent.refused', referentRefused, true);
eq('missing_referent.names_the_problem', /ocr_documents/.test(referentMsg), true);
eq('missing_referent.nothing_created',
  (await noReferent.query(`select count(*)::int as n from unnest($1::text[]) as name where to_regclass('public.'||name) is not null`, [TWELVE])).rows[0].n, 0);

// Absent service_role must refuse too — the RLS posture would otherwise lock the backend out.
const noSvc = await newDb();
await noSvc.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE TABLE public.users (id text PRIMARY KEY);
  CREATE TABLE public.vehicles (vin text PRIMARY KEY);
  CREATE TABLE public.ocr_documents (id text PRIMARY KEY);`);
let noSvcRefused = false;
try { await noSvc.exec(sectionOf(MIGRATION, 'up')); } catch { noSvcRefused = true; }
eq('missing_service_role.refused', noSvcRefused, true);

// ═══════════════════════════════════════════════ REPORT
console.log('\nISSUE #101 P2 — STAGING PARITY BEHAVIOURAL PROOF (real PostgreSQL via PGlite)\n');
for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(48)} = ${JSON.stringify(v)}`);
console.log('');
// Close every instance and exit EXPLICITLY. Falling off the end leaves PGlite's WASM
// handles open and the process exits 100 even on success — which would have made this
// CI gate fail while printing PASS.
for (const d of OPEN) { try { await d.close(); } catch { /* already closed */ } }
if (failures.length) {
  console.error(`FAILED — ${failures.length} problem(s):`);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('PASS — twelve relations match the production receipts column-for-column; posture is');
console.log('       deliberately stricter than production; B1-SEQ untouched; nothing seeded.');
process.exit(0);
