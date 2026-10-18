/**
 * CA-OWNER-02 (A) — Corporate governance position for the Overview, read THROUGH the frozen People & Access projection
 * (corporatePeopleAccessService.js), so it can never show more than People & Access would show the same actor.
 *
 * Proven against the real accepted Corporate SQL (PGlite, Phase A + B + C):
 *   · a governor sees the ACTIVE memberships and ACTIVE permission assignments of the nodes they govern as a governance
 *     record (GOVERNED_ACTUAL) — the staging shape 2 / 4;
 *   · an actor who governs nothing sees FORBIDDEN statements — never a count, never zero.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { openDatabase, closeAll, seedGovernor, ensureUsers, OWNER } = await import('./helpers/corporateGovernanceDb.js');
const { createServiceClient } = await import('./helpers/pgliteSupabaseClient.js');
const { readGovernanceFacts } = await import('../services/corporate/management/governanceFacts.js');

after(closeAll);

const NOW = new Date();
let client;
before(async () => {
  const db = await openDatabase({ migrate: 'all' });
  await db.exec(`SET ROLE ${OWNER}; ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`);
  await seedGovernor(db, 'gov-a');
  await seedGovernor(db, 'gov-b');
  await ensureUsers(db, ['nobody']);
  client = createServiceClient(db);
});

test('a governor sees the active memberships and assignments of the nodes they govern as a governance record', async () => {
  const { facts } = await readGovernanceFacts(client, { now: NOW, actorUserId: 'gov-a' });
  const f = Object.fromEntries(facts.map((x) => [x.id, x]));
  assert.equal(f['corporate.governance.membership.active'].state, 'GOVERNED_ACTUAL');
  assert.equal(f['corporate.governance.membership.active'].value, 2);
  assert.equal(f['corporate.governance.assignment.active'].value, 4);
  assert.equal(f['corporate.governance.assignment.active'].certification, 'governance_record');
  assert.match(f['corporate.governance.membership.active'].scope, /CARUP_CORPORATE/);
});

test('an actor who governs nothing sees FORBIDDEN statements — never a count, never zero', async () => {
  const { facts } = await readGovernanceFacts(client, { now: NOW, actorUserId: 'nobody' });
  for (const f of facts) {
    assert.equal(f.state, 'FORBIDDEN', f.id);
    assert.equal(f.value, null, f.id);
    assert.match(f.reason, /membership\.manage/);
  }
});
