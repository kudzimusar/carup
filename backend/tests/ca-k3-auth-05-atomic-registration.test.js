import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import pg from 'pg';
import { BOOTSTRAP, PHASE_A, PHASE_B, PHASE_C } from './helpers/corporateGovernanceDb.js';
import { parseMigrationSource } from '../db/migrationParser.js';

const load = (name) => parseMigrationSource(readFileSync(new URL(`../../database/migrations/${name}`, import.meta.url), 'utf8'), name).up;
const auth05 = load('20261016010000_ca_k3_auth_05_session_identity_authority.sql');
const atomic = load('20261016163834_ca_k3_auth_05_r4_atomic_owner_registration.sql');
const profileSchema = load('20260829123000_user_registration_profiles.sql');
const signature = 'public.session_authority_register_owner(jsonb,jsonb,text,text)';
let db;
let baseline;
let serial = 0;
const hash = `scrypt:${'a'.repeat(32)}:${'b'.repeat(128)}`;
const profile = {
  account_kind: 'business', market_relationship: 'diaspora', country_of_residence: 'Japan',
  city: 'Tokyo', province: null, intended_use: 'sell', organization_name: 'Fixture dealer',
  business_type: 'dealer', onboarding_status: 'requested', marketing_consent: false,
  terms_acknowledged_at: new Date().toISOString(), privacy_acknowledged_at: new Date().toISOString(),
};

async function counts() {
  return (await db.query(`SELECT (SELECT count(*)::int FROM users) AS users,
    (SELECT count(*)::int FROM user_registration_profiles) AS profiles,
    (SELECT count(*)::int FROM user_sessions) AS sessions`)).rows[0];
}
async function as(role, action) {
  await db.exec(`SET ROLE ${role}`);
  try { return await action(); } finally { await db.exec('SET ROLE mig_owner'); }
}
async function register({ role = 'owner', withProfile = true, email = `atomic-${++serial}@example.invalid` } = {}) {
  return as('registration_runtime', async () => (await db.query(
    'SELECT public.session_authority_register_owner($1::jsonb,$2::jsonb,$3,$4) AS data',
    [JSON.stringify({ name: 'Atomic test', email, role, password_hash: hash, phone: '', location: 'Tokyo' }),
      withProfile ? JSON.stringify(profile) : null, '127.0.0.1', 'atomic-test'],
  )).rows[0].data);
}

before(async () => {
  const url = process.env.CA_ATOMIC_TEST_DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname), 'disposable localhost PostgreSQL only');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    assert.equal((await client.query("SELECT to_regclass('public.users') AS t")).rows[0].t, null, 'requires empty disposable database');
    db = { query: (...args) => client.query(...args), exec: (sql) => client.query(sql), close: () => client.end() };
  } else {
    db = await PGlite.create({ extensions: { pgcrypto } });
  }
  await db.exec('CREATE EXTENSION pgcrypto');
  await db.exec(BOOTSTRAP);
  await db.exec(`ALTER TABLE users ADD COLUMN name text, ADD COLUMN phone text, ADD COLUMN location text,
    ADD COLUMN password_hash text, ADD COLUMN join_date timestamptz;
    ALTER TABLE user_sessions ADD COLUMN active_role text, ADD COLUMN active_organization_id text, ADD COLUMN ip_address text;
    CREATE TABLE auth_action_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text REFERENCES users(id),
      purpose text, token_hash text, expires_at timestamptz, used_at timestamptz, revoked_at timestamptz,
      created_at timestamptz DEFAULT now(), requested_ip text, user_agent text, metadata jsonb, created_by text, source text);`);
  await db.exec(PHASE_A.up);
  await db.exec(PHASE_B.up);
  await db.exec(PHASE_C.up);
  await db.exec(profileSchema);
  await db.exec(auth05);
  await db.exec(atomic);
  await db.exec('RESET ROLE; CREATE ROLE registration_runtime LOGIN; GRANT carup_session_authority TO registration_runtime; SET ROLE mig_owner;');
  baseline = await counts();
});
after(async () => { if (db) await db.close(); });

test('RPC ACL: PUBLIC, anon, authenticated and service_role denied; dedicated authority allowed', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, signature])).rows[0].allowed, false);
    await assert.rejects(as(role, () => db.query('SELECT public.session_authority_register_owner(NULL,NULL,NULL,NULL)')), /permission denied/);
  }
  assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', ['registration_runtime', signature])).rows[0].allowed, true);
  const pub = await db.query(`SELECT count(*)::int AS n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
    WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'`, [signature]);
  assert.equal(pub.rows[0].n, 0);
});

for (const [id, table] of [['F2', 'users'], ['F3', 'user_registration_profiles'], ['F4', 'user_sessions']]) {
  test(`${id}: forced ${table} failure rolls back user, profile and session`, async () => {
    const beforeCounts = await counts();
    await db.exec(`CREATE FUNCTION public.atomic_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'CONTROLLED_ATOMIC_FAILURE'; END $$;
      CREATE TRIGGER atomic_test_failure AFTER INSERT ON public.${table}
      FOR EACH ROW EXECUTE FUNCTION public.atomic_test_failure();`);
    try {
      await assert.rejects(register(), /CONTROLLED_ATOMIC_FAILURE/);
      assert.deepEqual(await counts(), beforeCounts);
    } finally {
      await db.exec(`DROP TRIGGER atomic_test_failure ON public.${table}; DROP FUNCTION public.atomic_test_failure();`);
    }
  });
}

test('F3: real profile constraint violation also rolls back all registration writes', async () => {
  const original = profile.market_relationship;
  profile.market_relationship = 'invalid';
  try { await assert.rejects(register(), /check constraint/); } finally { profile.market_relationship = original; }
  assert.deepEqual(await counts(), baseline);
});

test('F6: privileged role is refused by the DB boundary without any writes', async () => {
  await assert.rejects(register({ role: 'admin' }), /REGISTRATION_INPUT_INVALID/);
  assert.deepEqual(await counts(), baseline);
});

test('F5: business intent remains owner; user/profile/password session commit together and resolve', async () => {
  const data = await register();
  assert.equal(data.user.role, 'owner');
  assert.ok(data.token);
  assert.equal('password_hash' in data.user, false);
  const afterCounts = await counts();
  assert.deepEqual(afterCounts, { users: baseline.users + 1, profiles: baseline.profiles + 1, sessions: baseline.sessions + 1 });
  const resolved = await as('service_role', async () => (await db.query('SELECT public.session_authority_resolve_token($1) AS s', [data.token])).rows[0].s);
  assert.equal(resolved.user_id, data.user.id);
  assert.equal(resolved.is_valid, true);
  const session = (await db.query('SELECT auth_method,step_up_at,step_up_method,active_organization_id FROM user_sessions WHERE user_id=$1', [data.user.id])).rows[0];
  assert.deepEqual(session, { auth_method: 'password', step_up_at: null, step_up_method: null, active_organization_id: null });
});

test('F5: optional profile is absent and duplicate email cannot leave a second session', async () => {
  const email = 'atomic-duplicate@example.invalid';
  const beforeCounts = await counts();
  await register({ email, withProfile: false });
  await assert.rejects(register({ email, withProfile: false }), /unique constraint/);
  assert.deepEqual(await counts(), { users: beforeCounts.users + 1, profiles: beforeCounts.profiles, sessions: beforeCounts.sessions + 1 });
});

test('AUTH-05 direct table and mutation function separation survives the additive RPC', async () => {
  for (const role of ['service_role', 'registration_runtime']) {
    for (const table of ['users', 'user_sessions', 'user_registration_profiles']) {
      if (role === 'service_role' && table !== 'user_sessions') continue;
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, `public.${table}`, privilege])).rows[0].allowed, false, `${role} ${table} ${privilege}`);
      }
    }
  }
  const mutations = await db.query(`SELECT p.proname, has_function_privilege('service_role',p.oid,'EXECUTE') AS allowed
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND
    (p.proname LIKE 'session_authority_%' OR p.proname LIKE 'corporate_authority_%')
    AND p.proname NOT IN ('session_authority_resolve_token','session_authority_resolve_assurance',
      'session_authority_list_user_sessions','corporate_authority_evaluate')`);
  for (const row of mutations.rows) assert.equal(row.allowed, false, row.proname);
});
