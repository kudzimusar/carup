/**
 * The one-time staging-UAT bootstrap.
 *
 * This job is the only thing in the certification chain that touches the staging database, and it
 * writes credentials to real identities. Every way it can be pointed somewhere it should not be is
 * a NAMED refusal — and each refusal is tested, because a refusal nobody can break is not a gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../scripts/ci/bootstrap-staging-uat-identities.mjs');
const REF = 'eoyenigwevnxwwhyhaer';
const POOLER = `postgres://postgres.${REF}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;

/** A pg client that records exactly what the bootstrap did, and answers a configurable rowCount. */
function fakeClient({ rowCount = 1 } = {}) {
  const calls = [];
  return {
    calls,
    ended: 0,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^update/i.test(sql) || /^\s*insert/i.test(sql)) return { rowCount };
      return { rowCount: 0 };
    },
    async end() { this.ended += 1; },
  };
}

const ok = async (over = {}) => {
  const m = await load();
  const client = fakeClient(over.clientOptions);
  const result = await m.bootstrapIdentities({
    databaseUrl: POOLER,
    expectedRef: REF,
    password: 'staging-only-secret',
    connect: async () => client,
    ...over,
  });
  return { m, client, result };
};

test('provisions every identity in ONE transaction over ONE connection', async () => {
  const { m, client, result } = await ok();
  assert.equal(result.identities, m.STAGING_UAT_IDENTITIES.length);
  assert.equal(client.calls.filter((c) => c.sql === 'BEGIN').length, 1);
  assert.equal(client.calls.filter((c) => c.sql === 'COMMIT').length, 1);
  assert.equal(
    client.calls.filter((c) => /^update/i.test(c.sql)).length,
    m.STAGING_UAT_IDENTITIES.length,
    'one write per identity — no per-shard duplication',
  );
  assert.equal(client.ended, 1, 'the connection is released');
});

test('every identity gets the SAME hash, so one derivation serves all three shards', async () => {
  const { client } = await ok();
  const hashes = new Set(client.calls.filter((c) => /^update/i.test(c.sql)).map((c) => c.params[0]));
  assert.equal(hashes.size, 1);
  assert.match([...hashes][0], /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
});

test('the plaintext password is never written to the database and never returned', async () => {
  const { client, result } = await ok();
  const serialized = JSON.stringify({ calls: client.calls, result });
  assert.ok(!serialized.includes('staging-only-secret'), 'the plaintext must not appear anywhere');
  assert.equal(result.printed, false);
});

test('the hash is salted per run — two runs of the same password differ', async () => {
  const m = await load();
  const a = await m.hashPassword('same');
  const b = await m.hashPassword('same');
  assert.notEqual(a, b);
});

test('refuses when the staging-only password is not configured', async () => {
  await assert.rejects(ok({ password: '' }), (e) => e.reason === 'missing-password');
});

test('refuses when the database URL is not configured', async () => {
  await assert.rejects(ok({ databaseUrl: '' }), (e) => e.reason === 'missing-database-url');
});

test('refuses a database URL that is not a URL', async () => {
  await assert.rejects(ok({ databaseUrl: 'not a url' }), (e) => e.reason === 'unparseable-database-url');
});

test('refuses a database that is not the approved staging project', async () => {
  const other = 'postgres://postgres.someotherproject:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres';
  await assert.rejects(ok({ databaseUrl: other }), (e) => e.reason === 'wrong-staging-project');
});

test('refuses when the ref appears ONLY in the password — the defect a substring check misses', async () => {
  // The previous check was `dbUrl.includes(expectedRef)`. This URL satisfies it while pointing at a
  // completely different database.
  const impostor = `postgres://postgres.otherproject:${REF}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
  assert.ok(impostor.includes(REF), 'the impostor URL would pass a substring check');
  await assert.rejects(ok({ databaseUrl: impostor }), (e) => e.reason === 'wrong-staging-project');
});

test('accepts the direct-connection host shape as well as the pooler role shape', async () => {
  const m = await load();
  assert.equal(m.assertApprovedStagingConnection(`postgres://postgres:pw@db.${REF}.supabase.co:5432/postgres`, REF).host, `db.${REF}.supabase.co`);
  assert.equal(m.assertApprovedStagingConnection(POOLER, REF).role, `postgres.${REF}`);
});

test('refuses to write any identity that is not a staging-only address', async () => {
  const m = await load();
  assert.throws(
    () => m.assertStagingOnlyIdentities([['uat.buyer@carup.co.zw', 'owner']]),
    (e) => e.reason === 'non-staging-identity',
  );
  assert.ok(m.assertStagingOnlyIdentities(m.STAGING_UAT_IDENTITIES));
});

test('a database missing an identity ROLLS BACK and never commits', async () => {
  // A production database holds none of these rows, so it cannot commit — this is the runtime half
  // of the staging proof.
  const m = await load();
  const client = fakeClient({ rowCount: 0 });
  await assert.rejects(
    m.bootstrapIdentities({ databaseUrl: POOLER, expectedRef: REF, password: 'x', connect: async () => client }),
    (e) => e.reason === 'missing-staging-identity',
  );
  assert.ok(client.calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!client.calls.some((c) => c.sql === 'COMMIT'));
  assert.equal(client.ended, 1, 'the connection is released even on the refusal path');
});

test('strips sslmode, which would otherwise force verification of Supabase self-signed chains', async () => {
  const m = await load();
  assert.equal(m.cleanConnectionString(`${POOLER}?sslmode=require`), POOLER);
  assert.equal(m.cleanConnectionString(`${POOLER}?sslmode=require&application_name=uat`), `${POOLER}?application_name=uat`);
});

test('the exported env-name list covers every identity', async () => {
  const m = await load();
  assert.equal(m.STAGING_UAT_PASSWORD_ENV_NAMES.length, m.STAGING_UAT_IDENTITIES.length);
  assert.equal(new Set(m.STAGING_UAT_PASSWORD_ENV_NAMES).size, m.STAGING_UAT_PASSWORD_ENV_NAMES.length);
});

// ── Per-run, per-viewport Golden Sellers ─────────────────────────────────────

const loadGolden = () => import('../../scripts/ci/golden-seller-identity.mjs');

test('Golden Seller identities are derived identically for bootstrap and shard, one per viewport', async () => {
  const g = await loadGolden();
  const all = g.goldenSellerIdentitiesForRun('seller-123-2');
  assert.deepEqual(all.map((x) => x.email), [
    'golden.seller.123-2-chromium@carup-staging.test',
    'golden.seller.123-2-tablet@carup-staging.test',
    'golden.seller.123-2-mobile@carup-staging.test',
  ]);
  assert.equal(new Set(all.map((x) => x.id)).size, 3, 'three distinct identities — viewports never share a garage');
  assert.deepEqual(g.goldenSellerIdentity('seller-123-2', 'tablet-chromium'), all[1]);
  assert.notEqual(g.goldenSellerIdentity('seller-124-1', 'chromium').email, all[0].email, 'a new run never reuses an old Seller');
});

test('Golden Seller derivation refuses a malformed run id or unknown project', async () => {
  const g = await loadGolden();
  for (const bad of ['', 'seller-abc-1', 'staging-1-1', 'seller-1', 'seller-1-1; rm -rf', undefined]) {
    assert.throws(() => g.goldenSellerIdentity(bad, 'chromium'), /staging run id/);
  }
  assert.throws(() => g.goldenSellerIdentity('seller-1-1', 'firefox'), /unknown gate project/);
});

test('bootstrap upserts the Golden Sellers in the SAME transaction with the SAME hash', async () => {
  const g = await loadGolden();
  const goldenSellers = g.goldenSellerIdentitiesForRun('seller-9-1');
  const { client, result } = await ok({ goldenSellers, clientOptions: { rowCount: 1 } });
  const inserts = client.calls.filter((c) => /^insert into public\.users/i.test(c.sql.trim()));
  assert.equal(inserts.length, 3);
  assert.equal(result.goldenSellers, 3);
  const updateHash = client.calls.find((c) => /^update/i.test(c.sql)).params[0];
  for (const ins of inserts) assert.equal(ins.params[4], updateHash, 'one derivation serves every identity');
  const begin = client.calls.findIndex((c) => c.sql === 'BEGIN');
  const commit = client.calls.findIndex((c) => c.sql === 'COMMIT');
  assert.ok(client.calls.indexOf(inserts[0]) > begin && client.calls.indexOf(inserts[2]) < commit);
});

test('a Golden Seller that cannot be written rolls the WHOLE bootstrap back', async () => {
  const m = await load();
  const g = await loadGolden();
  const client = fakeClient();
  client.query = async function (sql, params) {
    this.calls.push({ sql, params });
    if (/^update/i.test(sql)) return { rowCount: 1 };
    if (/^\s*insert/i.test(sql)) return { rowCount: 0 };
    return { rowCount: 0 };
  };
  await assert.rejects(
    m.bootstrapIdentities({ databaseUrl: POOLER, expectedRef: REF, password: 'x', goldenSellers: g.goldenSellerIdentitiesForRun('seller-9-1'), connect: async () => client }),
    (e) => e.reason === 'golden-seller-not-provisioned',
  );
  assert.equal(client.calls.filter((c) => c.sql === 'COMMIT').length, 0);
  assert.equal(client.calls.filter((c) => c.sql === 'ROLLBACK').length, 1);
});

test('a non-staging Golden Seller address is refused before any connection', async () => {
  const m = await load();
  let connected = false;
  await assert.rejects(
    m.bootstrapIdentities({
      databaseUrl: POOLER, expectedRef: REF, password: 'x',
      goldenSellers: [{ id: 'u_x', email: 'someone@gmail.com', name: 'x', role: 'owner' }],
      connect: async () => { connected = true; return fakeClient(); },
    }),
    (e) => e.reason === 'non-staging-identity',
  );
  assert.equal(connected, false);
});
