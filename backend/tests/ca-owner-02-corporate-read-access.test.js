/**
 * CA-OWNER-02 — the read gate in front of every Corporate management read model, against the REAL accepted Corporate SQL.
 *
 * The gate never decides admission itself: it asks the frozen evaluateCorporateAccess (persistent Corporate authority, CA-CLOSE-01)
 * and then requires the ONE capability the Corporate destination already names (web/src/config/corporate/navigation.ts). So it can
 * only ever narrow what admission allows — never widen it.
 *
 * Proven here (PGlite 17 with the accepted Phase A + B + C migrations; service_role through a Supabase-shaped client):
 *   · an admitted governor who is also a legacy platform administrator may read a destination whose read capability the bounded
 *     compatibility adds (Governor A on staging);
 *   · an admitted platform OWNER governor holds governance capabilities only, so a destination read is refused (403) with the
 *     capability named — exactly where the navigation already hides that destination (Governor B on staging);
 *   · a platform administrator without a Corporate membership is refused by admission itself; an asserted identity is a 401;
 *   · an unknown capability is never granted.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { openDatabase, closeAll, seedGovernor, ensureUsers } = await import('./helpers/corporateGovernanceDb.js');
const { createServiceClient } = await import('./helpers/pgliteSupabaseClient.js');
const { authorizeCorporateRead, CORPORATE_READ_CONTRACT } = await import('../services/corporate/management/corporateReadAccess.js');

after(closeAll);

const session = (id, platformRole) => ({ id, platformRole, authenticationMethod: 'session' });
let client;
before(async () => {
  const db = await openDatabase({ migrate: 'all' });
  await seedGovernor(db, 'gov-a');
  await seedGovernor(db, 'gov-b');
  await ensureUsers(db, ['plain-admin']);
  client = createServiceClient(db);
});

test('an admitted governor who is a legacy platform administrator may read a Corporate destination', async () => {
  const d = await authorizeCorporateRead(session('gov-a', 'admin'), 'corporate.overview.read', { supabaseClient: client });
  assert.equal(d.allowed, true);
  assert.equal(d.grant.source, 'persistent_corporate_authority');
  assert.ok(d.grant.capabilities.includes('corporate.overview.read'));
});

test('an admitted platform OWNER governor holds governance capabilities only, so a destination read is refused with the capability named', async () => {
  const d = await authorizeCorporateRead(session('gov-b', 'owner'), 'corporate.overview.read', { supabaseClient: client });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
  assert.equal(d.body.code, 'CORPORATE_CAPABILITY_REQUIRED');
  assert.equal(d.body.capability, 'corporate.overview.read');
  assert.equal(d.body.contract, CORPORATE_READ_CONTRACT);
});

test('a governance capability the governor holds opens the read it governs', async () => {
  const d = await authorizeCorporateRead(session('gov-b', 'owner'), 'corporate.people.membership.manage', { supabaseClient: client });
  assert.equal(d.allowed, true);
});

test('a platform administrator without a Corporate membership is refused by admission itself', async () => {
  const d = await authorizeCorporateRead(session('plain-admin', 'admin'), 'corporate.overview.read', { supabaseClient: client });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
  assert.equal(d.body.code, 'CORPORATE_ACCESS_DENIED');
});

test('an asserted identity is unauthenticated, and an unknown capability is never granted', async () => {
  const asserted = await authorizeCorporateRead({ id: 'gov-a', platformRole: 'admin', authenticationMethod: 'header' }, 'corporate.overview.read', { supabaseClient: client });
  assert.equal(asserted.status, 401);
  const unknown = await authorizeCorporateRead(session('gov-a', 'admin'), 'corporate.everything.write', { supabaseClient: client });
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.status, 403);
});
