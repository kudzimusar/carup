/**
 * ISSUE #101 — public_keys P0 CLOSURE: the transition, on real PostgreSQL.
 *
 * Governed staging is ALREADY in the target posture, because the P2 parity migration
 * created public_keys hardened from birth. Applying the hardening there proves it is a
 * safe no-op, but it can never prove the thing that actually matters for production:
 * that the migration TAKES a broadly-exposed table and CLOSES it, without breaking the
 * two cascades that depend on it.
 *
 * So this harness builds the MEASURED PRODUCTION PRE-STATE — RLS on, zero policies, and
 * anon + authenticated each holding all eight privileges including the ungoverned
 * TRUNCATE, exactly as run 31774496416 recorded — applies the real migration file, and
 * proves the transition end to end.
 *
 * The pre-state is asserted against the committed receipt rather than hand-written, so
 * a fixture that drifts from production stops being evidence and starts failing.
 *
 * NO PRODUCTION KEY MATERIAL. Every value here is a literal placeholder. The string
 * 'SYNTHETIC-NOT-A-KEY' is not a key and is not derived from one.
 */
import { PGlite } from '@electric-sql/pglite';
// The REAL production certifier, exercised against a real database rather than mocked.
import {
  certify, ALL_TABLE_PRIVILEGES as CERT_PRIVS,
  PUBLIC_KEYS_SERVICE_ROLE_ABSENT, PUBLIC_KEYS_SERVICE_ROLE_EXPECTED,
} from '../../backend/scripts/production-issue-101-p0-cutover.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260814085000_issue101_public_keys_hardening.sql';
const RECEIPT = JSON.parse(readFileSync(
  join(HERE, '..', 'parity', 'receipts', 'production-public-keys-run31774496416.json'), 'utf-8'));

/** The eight privilege bits PostgreSQL 17 tracks for a table. */
const ALL_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

const failures = [];
const results = {};
const OPEN = [];
const fail = (m) => failures.push(m);
const eq = (label, actual, expected) => {
  results[label] = actual;
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

function upSectionOf(file) {
  const raw = readFileSync(join(HERE, '..', 'migrations', file), 'utf-8');
  const i = raw.indexOf('-- +migrate Down');
  return (i >= 0 ? raw.slice(0, i) : raw).replace('-- +migrate Up', '');
}

async function asRole(db, role, sql) {
  try {
    await db.exec(`SET ROLE ${role};`); await db.exec(sql); await db.exec('RESET ROLE;');
    return { allowed: true, error: null };
  } catch (e) {
    try { await db.exec('RESET ROLE;'); } catch { /* ignore */ }
    return { allowed: false, error: String(e.message || e).split('\n')[0].slice(0, 100) };
  }
}

const privsOf = async (db, role) => {
  const { rows } = await db.query(
    `select coalesce(string_agg(p, ',' order by p), 'none') as g
       from unnest($1::text[]) p where has_table_privilege($2, 'public.public_keys', p)`,
    [ALL_TABLE_PRIVS, role]);
  return rows[0].g;
};

/**
 * Rebuild public_keys and its neighbours to the MEASURED production shape, then put the
 * ACL into the measured PRE-hardening state.
 */
async function productionPreState() {
  const db = await PGlite.create();
  OPEN.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.users (id text PRIMARY KEY, email text);

    -- the measured eight columns, in measured ordinal order, private_key_pem at 4
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
      id            bigserial PRIMARY KEY,
      payload_hash  text NOT NULL,
      signature     text NOT NULL,
      public_key_id text NOT NULL,
      verified      integer DEFAULT 1,
      timestamp     text NOT NULL,
      CONSTRAINT signature_verification_logs_public_key_id_fkey
        FOREIGN KEY (public_key_id) REFERENCES public.public_keys(id) ON DELETE CASCADE
    );

    -- MEASURED PRE-STATE: RLS on, zero policies, all four roles holding everything.
    ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON TABLE public.public_keys TO anon, authenticated, service_role;
    GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
    GRANT ALL ON TABLE public.signature_verification_logs TO anon, authenticated, service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.signature_verification_logs_id_seq TO service_role;
  `);
  return db;
}

// ═══════════════════════════════════════════════ 1. THE PRE-STATE IS PRODUCTION'S
const db = await productionPreState();

const receiptPrivs = (role) => [...new Set(RECEIPT.RELATION_ACL[0].acl
  .filter((a) => a.grantee === role).map((a) => a.privilege_type))].sort().join(',');

eq('pre.receipt_anon_privileges', receiptPrivs('anon'),
  'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');
eq('pre.fixture_matches_receipt_anon', await privsOf(db, 'anon'), receiptPrivs('anon'));
eq('pre.fixture_matches_receipt_authenticated', await privsOf(db, 'authenticated'), receiptPrivs('authenticated'));

const preRls = (await db.query(
  `select relrowsecurity as rls, relforcerowsecurity as forced,
          (select count(*)::int from pg_policy where polrelid = c.oid) as policies
     from pg_class c where c.oid = 'public.public_keys'::regclass`)).rows[0];
eq('pre.rls_enabled', preRls.rls, true);
eq('pre.rls_forced', preRls.forced, false);
eq('pre.policies', preRls.policies, 0);
eq('pre.receipt_rls_enabled', RECEIPT.TABLE_IDENTITY[0].rls_enabled, true);
eq('pre.receipt_rls_forced', RECEIPT.TABLE_IDENTITY[0].rls_forced, false);

// The exposure is real BEFORE the migration: RLS blocks ordinary DML, but TRUNCATE is
// ungoverned and therefore actually possible. Proving that is the point of the lane.
await db.exec(`INSERT INTO public.users (id,email) VALUES ('u-pre','pre@example.invalid');`);
await db.exec(`INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at)
               VALUES ('k-pre','u-pre','SYNTHETIC-NOT-A-KEY','2026-01-01');`);
// Precisely what "RLS is exactly one control" means: anon HOLDS the SELECT privilege,
// so the statement is permitted and does not error — but RLS with zero applicable
// policies is default-deny, so it returns nothing. Asserting both halves separately is
// the difference between describing the pre-state and hand-waving at it.
await db.exec('SET ROLE anon;');
let preSelectPermitted = true, preSelectRows = -1;
try { preSelectRows = (await db.query(`select count(*)::int as n from public.public_keys`)).rows[0].n; }
catch { preSelectPermitted = false; }
await db.exec('RESET ROLE;');
eq('pre.anon_select_is_permitted', preSelectPermitted, true);
eq('pre.anon_select_returns_zero_rows_under_rls', preSelectRows, 0);
eq('pre.rows_actually_present_as_owner',
  (await db.query(`select count(*)::int as n from public.public_keys`)).rows[0].n, 1);
const preTruncate = await asRole(db, 'anon', `TRUNCATE public.public_keys CASCADE;`);
eq('pre.anon_TRUNCATE_was_possible', preTruncate.allowed, true);
eq('pre.rows_destroyed_by_anon_truncate',
  (await db.query(`select count(*)::int as n from public.public_keys`)).rows[0].n, 0);

// ═══════════════════════════════════════════════ 2. APPLY THE REAL MIGRATION
await db.exec('BEGIN;');
await db.exec(upSectionOf(MIGRATION));
await db.exec('COMMIT;');

// ═══════════════════════════════════════════════ 3. THE POST-STATE
const post = (await db.query(
  `select relrowsecurity as rls, relforcerowsecurity as forced,
          (select count(*)::int from pg_policy where polrelid = c.oid) as policies
     from pg_class c where c.oid = 'public.public_keys'::regclass`)).rows[0];
eq('post.rls_enabled', post.rls, true);
eq('post.rls_forced_unchanged', post.forced, preRls.forced);
eq('post.policies', post.policies, 0);
eq('post.anon_privileges', await privsOf(db, 'anon'), 'none');
eq('post.authenticated_privileges', await privsOf(db, 'authenticated'), 'none');
eq('post.service_role_privileges', await privsOf(db, 'service_role'), 'INSERT,SELECT,UPDATE');
eq('post.service_role_delete_absent',
  !(await db.query(`select has_table_privilege('service_role','public.public_keys','DELETE') as d`)).rows[0].d, true);
eq('post.service_role_truncate_absent',
  !(await db.query(`select has_table_privilege('service_role','public.public_keys','TRUNCATE') as d`)).rows[0].d, true);

// behaviour, not catalog
eq('post.anon_select_denied', !(await asRole(db, 'anon', `SELECT * FROM public.public_keys;`)).allowed, true);
eq('post.anon_insert_denied', !(await asRole(db, 'anon',
  `INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at) VALUES ('x','u-pre','SYNTHETIC-NOT-A-KEY','t');`)).allowed, true);
eq('post.anon_truncate_denied', !(await asRole(db, 'anon', `TRUNCATE public.public_keys;`)).allowed, true);
eq('post.authenticated_select_denied', !(await asRole(db, 'authenticated', `SELECT * FROM public.public_keys;`)).allowed, true);
eq('post.authenticated_truncate_denied', !(await asRole(db, 'authenticated', `TRUNCATE public.public_keys;`)).allowed, true);

eq('post.service_role_insert_allowed', (await asRole(db, 'service_role',
  `INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at) VALUES ('k-1','u-pre','SYNTHETIC-NOT-A-KEY','2026-01-01');`)).allowed, true);
eq('post.service_role_select_allowed', (await asRole(db, 'service_role',
  `SELECT id FROM public.public_keys WHERE id='k-1';`)).allowed, true);
eq('post.service_role_update_allowed', (await asRole(db, 'service_role',
  `UPDATE public.public_keys SET status='REVOKED', revoked_at='2026-01-02' WHERE id='k-1';`)).allowed, true);
eq('post.service_role_delete_denied', !(await asRole(db, 'service_role',
  `DELETE FROM public.public_keys WHERE id='k-1';`)).allowed, true);

// ═══════════════════════════════════════════════ 4. THE CASCADES MUST SURVIVE
// This is the claim the narrow grant rests on: a referential action runs with the
// REFERENCING table's owner privileges, not the caller's, so withholding DELETE from
// service_role does not disarm ON DELETE CASCADE.
await db.exec(`INSERT INTO public.signature_verification_logs (payload_hash,signature,public_key_id,timestamp)
               VALUES ('h','s','k-1','2026-01-01');`);
eq('cascade.svl_rows_before', (await db.query(`select count(*)::int as n from public.signature_verification_logs`)).rows[0].n, 1);

const cascade = await asRole(db, 'service_role', `DELETE FROM public.users WHERE id='u-pre';`);
eq('cascade.driven_by_service_role_allowed', cascade.allowed, true);
eq('cascade.public_keys_emptied',
  (await db.query(`select count(*)::int as n from public.public_keys`)).rows[0].n, 0);
eq('cascade.svl_emptied_transitively',
  (await db.query(`select count(*)::int as n from public.signature_verification_logs`)).rows[0].n, 0);

// and the direct public_keys -> svl cascade, on its own
await db.exec(`
  INSERT INTO public.users (id,email) VALUES ('u-2','u2@example.invalid');
  INSERT INTO public.public_keys (id,user_id,public_key_pem,created_at)
    VALUES ('k-2','u-2','SYNTHETIC-NOT-A-KEY','2026-01-01');
  INSERT INTO public.signature_verification_logs (payload_hash,signature,public_key_id,timestamp)
    VALUES ('h2','s2','k-2','2026-01-01');
  DELETE FROM public.public_keys WHERE id='k-2';`);
eq('cascade.public_keys_to_svl_direct',
  (await db.query(`select count(*)::int as n from public.signature_verification_logs`)).rows[0].n, 0);

// ═══════════════════════════════════════════════ 5. IDEMPOTENCE (the staging case)
// Staging is already in the target posture, so applying there must be a confirmation.
let reapplyOk = true, reapplyErr = '';
try { await db.exec('BEGIN;'); await db.exec(upSectionOf(MIGRATION)); await db.exec('COMMIT;'); }
catch (e) { reapplyOk = false; reapplyErr = String(e.message || e).split('\n')[0]; try { await db.exec('ROLLBACK;'); } catch { /* ignore */ } }
eq('idempotent.reapply_succeeds', reapplyOk, true);
if (!reapplyOk) fail(`  re-apply failed: ${reapplyErr}`);
eq('idempotent.posture_unchanged', await privsOf(db, 'service_role'), 'INSERT,SELECT,UPDATE');
eq('idempotent.anon_still_none', await privsOf(db, 'anon'), 'none');

// ═══════════════════════════════════════════════ 6. FAIL-LOUD ON A WRONG SHAPE
const shapeCases = [
  { label: 'shape.rejects_004_005_lineage',
    // private_key_pem appended LAST, which is what 005 produces — the wrong lineage
    ddl: `CREATE TABLE public.public_keys (
            id text NOT NULL, user_id text NOT NULL, public_key_pem text NOT NULL,
            key_type text DEFAULT 'secp256k1'::text, status text DEFAULT 'ACTIVE'::text,
            created_at text NOT NULL, revoked_at text, private_key_pem text,
            CONSTRAINT public_keys_pkey PRIMARY KEY (id),
            CONSTRAINT public_keys_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text,'REVOKED'::text]))),
            CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE);`,
    expect: /shape does not match/ },
  { label: 'shape.rejects_missing_column',
    ddl: `CREATE TABLE public.public_keys (
            id text NOT NULL, user_id text NOT NULL, public_key_pem text NOT NULL,
            private_key_pem text, key_type text DEFAULT 'secp256k1'::text,
            status text DEFAULT 'ACTIVE'::text, created_at text NOT NULL,
            CONSTRAINT public_keys_pkey PRIMARY KEY (id),
            CONSTRAINT public_keys_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text,'REVOKED'::text]))),
            CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE);`,
    expect: /shape does not match/ },
  { label: 'shape.rejects_absent_table', ddl: null, expect: /does not exist/ },
];
for (const c of shapeCases) {
  const alt = await PGlite.create(); OPEN.push(alt);
  await alt.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.users (id text PRIMARY KEY, email text);`);
  if (c.ddl) await alt.exec(c.ddl);
  let refused = false, msg = '';
  try { await alt.exec(upSectionOf(MIGRATION)); }
  catch (e) { refused = true; msg = String(e.message || e); }
  eq(c.label, refused && c.expect.test(msg), true);
  if (refused && !c.expect.test(msg)) fail(`  ${c.label}: refused but with "${msg.split('\n')[0]}"`);
}

// a broken cascade must also refuse
const noCascade = await PGlite.create(); OPEN.push(noCascade);
await noCascade.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE TABLE public.users (id text PRIMARY KEY, email text);
  CREATE TABLE public.public_keys (
    id text NOT NULL, user_id text NOT NULL, public_key_pem text NOT NULL,
    private_key_pem text, key_type text DEFAULT 'secp256k1'::text,
    status text DEFAULT 'ACTIVE'::text, created_at text NOT NULL, revoked_at text,
    CONSTRAINT public_keys_pkey PRIMARY KEY (id),
    CONSTRAINT public_keys_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text,'REVOKED'::text]))),
    CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE);
  CREATE TABLE public.signature_verification_logs (
    id bigserial PRIMARY KEY, payload_hash text NOT NULL, signature text NOT NULL,
    public_key_id text NOT NULL, verified integer DEFAULT 1, timestamp text NOT NULL,
    CONSTRAINT signature_verification_logs_public_key_id_fkey
      FOREIGN KEY (public_key_id) REFERENCES public.public_keys(id));`);  // NO ON DELETE CASCADE
let cascadeRefused = false, cascadeMsg = '';
try { await noCascade.exec(upSectionOf(MIGRATION)); }
catch (e) { cascadeRefused = true; cascadeMsg = String(e.message || e); }
eq('cascade.missing_cascade_refused', cascadeRefused, true);
eq('cascade.missing_cascade_names_it', /signature_verification_logs_public_key_id_fkey/.test(cascadeMsg), true);

// absent service_role must refuse before any privilege moves
const noSvc = await PGlite.create(); OPEN.push(noSvc);
await noSvc.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE TABLE public.users (id text PRIMARY KEY);`);
let noSvcRefused = false;
try { await noSvc.exec(upSectionOf(MIGRATION)); } catch { noSvcRefused = true; }
eq('missing_service_role.refused', noSvcRefused, true);

// ═══════════════════════════════════════════════ 7. FK ENDPOINT COLUMNS ARE PROVEN
/**
 * conname + referenced-relation + ON DELETE is NOT enough. Each case below builds a
 * constraint that would satisfy a name/referent/action check while pointing at the wrong
 * columns — or, for the incoming FK, hanging off the wrong relation entirely — and proves
 * the migration refuses BEFORE any ALTER/REVOKE/GRANT, leaving the ACL untouched.
 */
const PK_COLUMNS = `
      id              text NOT NULL,
      user_id         text NOT NULL,
      public_key_pem  text NOT NULL,
      private_key_pem text,
      key_type        text DEFAULT 'secp256k1'::text,
      status          text DEFAULT 'ACTIVE'::text,
      created_at      text NOT NULL,
      revoked_at      text,
      CONSTRAINT public_keys_pkey PRIMARY KEY (id),
      CONSTRAINT public_keys_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])))`;

/** Build a fixture whose FK wiring is supplied, then attempt the migration. */
async function fkCase({ label, pkFk, svlDdl, expectRefusal = true }) {
  const alt = await PGlite.create(); OPEN.push(alt);
  await alt.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    -- users carries a SECOND unique column so a wrong-referenced-column FK is buildable
    CREATE TABLE public.users (id text PRIMARY KEY, email text UNIQUE);
    CREATE TABLE public.public_keys (${PK_COLUMNS},
      ${pkFk}
    );
    CREATE INDEX idx_public_keys_user ON public.public_keys USING btree (user_id);
    ${svlDdl}
    ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON TABLE public.public_keys TO anon, authenticated, service_role;
  `);

  const aclBefore = {
    anon: await privsOf(alt, 'anon'),
    authenticated: await privsOf(alt, 'authenticated'),
    service_role: await privsOf(alt, 'service_role'),
  };

  let refused = false; let msg = '';
  try { await alt.exec(upSectionOf(MIGRATION)); }
  catch (e) { refused = true; msg = String(e.message || e); }

  const aclAfter = {
    anon: await privsOf(alt, 'anon'),
    authenticated: await privsOf(alt, 'authenticated'),
    service_role: await privsOf(alt, 'service_role'),
  };

  eq(`fk.${label}.refused`, refused, expectRefusal);
  if (expectRefusal) {
    eq(`fk.${label}.acl_unchanged`,
      JSON.stringify(aclBefore) === JSON.stringify(aclAfter), true);
    eq(`fk.${label}.error_is_the_precondition`, /\[issue-101-pk\]/.test(msg), true);
    if (!/\[issue-101-pk\]/.test(msg)) fail(`  ${label}: refused with "${msg.split('\n')[0].slice(0, 120)}"`);
  } else {
    // the positive control must actually harden
    eq(`fk.${label}.anon_closed`, aclAfter.anon, 'none');
    eq(`fk.${label}.service_role_narrowed`, aclAfter.service_role, 'INSERT,SELECT,UPDATE');
  }
  return msg;
}

const SVL_CORRECT = `
  CREATE TABLE public.signature_verification_logs (
    id bigserial PRIMARY KEY, payload_hash text NOT NULL, signature text NOT NULL,
    public_key_id text NOT NULL, verified integer DEFAULT 1, timestamp text NOT NULL,
    CONSTRAINT signature_verification_logs_public_key_id_fkey
      FOREIGN KEY (public_key_id) REFERENCES public.public_keys(id) ON DELETE CASCADE);`;

// 1. right name, right users referent, right CASCADE — WRONG referencing column on public_keys
await fkCase({
  label: 'outgoing_wrong_referencing_column',
  pkFk: `CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (created_at) REFERENCES public.users(id) ON DELETE CASCADE`,
  svlDdl: SVL_CORRECT,
});

// 2. right referencing column public_keys.user_id — WRONG referenced column on users
await fkCase({
  label: 'outgoing_wrong_referenced_column',
  pkFk: `CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(email) ON DELETE CASCADE`,
  svlDdl: SVL_CORRECT,
});

// 3. incoming FK: right name, right public_keys referent, right CASCADE — WRONG referencing column
await fkCase({
  label: 'incoming_wrong_referencing_column',
  pkFk: `CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
  svlDdl: `
    CREATE TABLE public.signature_verification_logs (
      id bigserial PRIMARY KEY, payload_hash text NOT NULL, signature text NOT NULL,
      public_key_id text NOT NULL, decoy text NOT NULL,
      verified integer DEFAULT 1, timestamp text NOT NULL,
      CONSTRAINT signature_verification_logs_public_key_id_fkey
        FOREIGN KEY (decoy) REFERENCES public.public_keys(id) ON DELETE CASCADE);`,
});

// 4. a same-named incoming constraint hanging off the WRONG relation
await fkCase({
  label: 'incoming_same_name_on_wrong_relation',
  pkFk: `CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
  svlDdl: `
    CREATE TABLE public.signature_verification_logs (
      id bigserial PRIMARY KEY, payload_hash text NOT NULL, signature text NOT NULL,
      public_key_id text NOT NULL, verified integer DEFAULT 1, timestamp text NOT NULL);
    -- the constraint exists, with the right name, referencing public_keys(id) with
    -- CASCADE — but on an unrelated table. A conrelid-blind check would accept it.
    CREATE TABLE public.decoy_relation (
      id bigserial PRIMARY KEY, public_key_id text NOT NULL,
      CONSTRAINT signature_verification_logs_public_key_id_fkey
        FOREIGN KEY (public_key_id) REFERENCES public.public_keys(id) ON DELETE CASCADE);`,
});

// 5. ON DELETE weakened to NO ACTION while everything else is right
await fkCase({
  label: 'outgoing_wrong_on_delete',
  pkFk: `CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)`,
  svlDdl: SVL_CORRECT,
});

// 6. POSITIVE CONTROL — production-shaped constraints must pass and must harden
await fkCase({
  label: 'production_shaped_passes',
  pkFk: `CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
  svlDdl: SVL_CORRECT,
  expectRefusal: false,
});

// ═══════════════════════════════════ 8. THE PRODUCTION CERTIFIER, ON A REAL DATABASE
/**
 * certify(client, 'A') is what decides in production whether migration B is allowed to
 * run at all. It is exercised here against the same PGlite instance that has just been
 * hardened, then against each single surviving privilege — including MAINTAIN, which is
 * new in PostgreSQL 17 and which production actually carries on public_keys.
 *
 * A subset-based certifier would report success while MAINTAIN survived. Each case below
 * proves it does not.
 */
eq('certifier.privilege_set_is_all_eight', CERT_PRIVS.length, 8);
eq('certifier.includes_MAINTAIN', CERT_PRIVS.includes('MAINTAIN'), true);
eq('certifier.withheld_set_includes_MAINTAIN', PUBLIC_KEYS_SERVICE_ROLE_ABSENT.includes('MAINTAIN'), true);

// the hardened database must certify
const certClean = await certify(db, 'A');
eq('certifier.hardened_state_certifies', certClean.ok, true);
eq('certifier.anon', certClean.metrics.anon, 'none');
eq('certifier.authenticated', certClean.metrics.authenticated, 'none');
eq('certifier.service_role', certClean.metrics.service_role, PUBLIC_KEYS_SERVICE_ROLE_EXPECTED);
eq('certifier.service_role_withheld_but_present', certClean.metrics.service_role_withheld_but_present, '');
eq('certifier.service_role_required_but_missing', certClean.metrics.service_role_required_but_missing, '');

/** Grant one privilege, re-certify, revoke it again. */
async function survivingPrivilege(role, priv) {
  await db.exec(`GRANT ${priv} ON TABLE public.public_keys TO ${role};`);
  const c = await certify(db, 'A');
  await db.exec(`REVOKE ${priv} ON TABLE public.public_keys FROM ${role};`);
  const back = await certify(db, 'A');
  eq(`certifier.${role}_${priv}_certification_refused`, !c.ok, true);
  eq(`certifier.${role}_${priv}_recovers_after_revoke`, back.ok, true);
  return c;
}

const anonMaintain = await survivingPrivilege('anon', 'MAINTAIN');
eq('certifier.anon_MAINTAIN_is_reported', /MAINTAIN/.test(anonMaintain.metrics.anon), true);
eq('certifier.anon_MAINTAIN_counted', anonMaintain.metrics.api_privileges, 1);

const authMaintain = await survivingPrivilege('authenticated', 'MAINTAIN');
eq('certifier.authenticated_MAINTAIN_is_reported', /MAINTAIN/.test(authMaintain.metrics.authenticated), true);

const svcMaintain = await survivingPrivilege('service_role', 'MAINTAIN');
eq('certifier.service_role_MAINTAIN_named_as_withheld',
  svcMaintain.metrics.service_role_withheld_but_present, 'MAINTAIN');

const svcRefs = await survivingPrivilege('service_role', 'REFERENCES');
eq('certifier.service_role_REFERENCES_named_as_withheld',
  svcRefs.metrics.service_role_withheld_but_present, 'REFERENCES');

const svcTrig = await survivingPrivilege('service_role', 'TRIGGER');
eq('certifier.service_role_TRIGGER_named_as_withheld',
  svcTrig.metrics.service_role_withheld_but_present, 'TRIGGER');

const svcDel = await survivingPrivilege('service_role', 'DELETE');
eq('certifier.service_role_DELETE_named_as_withheld',
  svcDel.metrics.service_role_withheld_but_present, 'DELETE');

// a LOST required privilege must fail too, not only an extra one
await db.exec(`REVOKE UPDATE ON TABLE public.public_keys FROM service_role;`);
const lost = await certify(db, 'A');
await db.exec(`GRANT UPDATE ON TABLE public.public_keys TO service_role;`);
eq('certifier.lost_required_privilege_refused', !lost.ok, true);
eq('certifier.lost_required_privilege_named', lost.metrics.service_role_required_but_missing, 'UPDATE');
eq('certifier.restored_after_regrant', (await certify(db, 'A')).ok, true);

// the measured production-style PRE-state must report MAINTAIN, not hide it
const pre = await PGlite.create(); OPEN.push(pre);
await pre.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE TABLE public.users (id text PRIMARY KEY);
  CREATE TABLE public.public_keys (id text PRIMARY KEY, user_id text);
  ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;
  GRANT ALL ON TABLE public.public_keys TO anon, authenticated, service_role;`);
const preCert = await certify(pre, 'A');
eq('certifier.production_style_pre_state_reports_MAINTAIN',
  /MAINTAIN/.test(preCert.metrics.anon) && /MAINTAIN/.test(preCert.metrics.authenticated)
  && /MAINTAIN/.test(preCert.metrics.service_role), true);
eq('certifier.production_style_pre_state_refused', !preCert.ok, true);
eq('certifier.production_style_pre_state_counts_16_api_privileges', preCert.metrics.api_privileges, 16);

// ═══════════════════════════════════════════════ REPORT
console.log('\nISSUE #101 — public_keys P0 CLOSURE: TRANSITION PROOF (real PostgreSQL via PGlite)\n');
for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(46)} = ${JSON.stringify(v)}`);
console.log('');
for (const d of OPEN) { try { await d.close(); } catch { /* already closed */ } }
if (failures.length) {
  console.error(`FAILED — ${failures.length} problem(s):`);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('PASS — anon TRUNCATE was possible BEFORE and is denied AFTER; service_role keeps');
console.log('       select/insert/update, loses delete/truncate, and both cascades still fire.');
process.exit(0);
